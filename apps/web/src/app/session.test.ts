import { beforeEach, describe, expect, it } from 'vitest';

import { useTelemetry } from '@/stores/telemetry';
import { useUi } from '@/stores/ui';
import * as fixtures from '@/test/fixtures';

import {
  applyView,
  composeSession,
  currentView,
  describeSession,
  MAX_LINK_CHARS,
  parseSession,
  restoreView,
  selectionFromText,
  selectionToText,
  sessionFromHash,
  sessionLink,
} from './session';
import { searchWithView, viewFromSearch } from './urlState';

beforeEach(() => {
  useTelemetry.setState(useTelemetry.getInitialState(), true);
  useUi.setState(useUi.getInitialState(), true);
  useTelemetry.getState().setTopology(fixtures.topology());
});

describe('a session', () => {
  const exported = fixtures.session();

  it('is the server’s recording with the moment and the view', () => {
    const session = composeSession(exported, { arrangement: 'regions', select: 'node:use-auth' });
    expect(session).toEqual({
      format: 'aegis-session',
      version: 1,
      recording: exported.recording,
      cursorMs: exported.cursorMs,
      view: { arrangement: 'regions', select: 'node:use-auth' },
    });
    // The default view is not written, and neither are files it does not need.
    expect(composeSession(exported, {})).not.toHaveProperty('view');
    expect(composeSession(exported, {})).not.toHaveProperty('workspace');
  });

  it('travels in a link and comes back the same', () => {
    const session = composeSession(exported, { arrangement: 'dependencies' });
    const link = sessionLink(session, 'https://example.test/app/?arrangement=regions#old');
    expect(typeof link).toBe('string');
    const url = new URL(link as string);
    // It rides in the fragment, which is not sent to a server.
    expect(url.search).toBe('?arrangement=regions');
    expect(url.hash.startsWith('#session=')).toBe(true);
    expect(sessionFromHash(url.hash)).toEqual({ session });
  });

  it('carries names that are not ASCII', () => {
    const session = composeSession(
      { ...exported, recording: { ...exported.recording, name: 'Sessão São Paulo ✓' } },
      {},
    );
    const link = sessionLink(session, 'https://example.test/');
    expect(sessionFromHash(new URL(link as string).hash)).toEqual({ session });
  });

  it('is not put in a link when it carries files or is too long', () => {
    const withFiles = composeSession(exported, {}, fixtures.workspaceExport());
    expect(sessionLink(withFiles, 'https://example.test/')).toEqual({
      reason: expect.stringContaining('a link cannot carry its files'),
    });
    const many = {
      ...exported,
      recording: {
        ...exported.recording,
        commands: Array.from({ length: 400 }, (_, i) => ({
          atMs: i * 200,
          command: { type: 'abortScenario' as const },
        })),
      },
    };
    const link = sessionLink(composeSession(many, {}), 'https://example.test/');
    expect(link).toEqual({ reason: expect.stringContaining('too many commands') });
    expect(MAX_LINK_CHARS).toBeLessThan(8000);
  });

  it('is read from a file, and a file that is not one is refused with the reason', () => {
    const session = composeSession(exported, {});
    expect(parseSession(JSON.stringify(session))).toEqual({ session });
    expect(parseSession('not json')).toEqual({ problem: expect.stringContaining('not JSON') });
    expect(parseSession(JSON.stringify(fixtures.workspaceExport()))).toEqual({
      problem: expect.stringContaining('This is not a session file'),
    });
    expect(parseSession(JSON.stringify({ ...session, version: 2 }))).toEqual({
      problem: expect.stringContaining('not in a format this version reads'),
    });
    expect(sessionFromHash('#other')).toBeNull();
    expect(sessionFromHash('#session=%%%')).toEqual({
      problem: expect.stringContaining('damaged'),
    });
  });

  it('cannot state an outcome', () => {
    const forged = structuredClone(composeSession(exported, {})) as unknown as {
      recording: { commands: unknown[] };
    };
    forged.recording.commands.push({
      atMs: 0,
      command: { type: 'recordDecision', decision: fixtures.decisionAllow() },
    });
    expect(parseSession(JSON.stringify(forged))).toHaveProperty('problem');
  });

  it('says what it holds in lines someone can check', () => {
    expect(describeSession(exported.recording, fixtures.scenarios().scenarios)).toEqual([
      '0:08 starts Credential Stuffing',
      '0:30 places a fault by hand (latency)',
    ]);
    expect(describeSession({ ...exported.recording, commands: [] })).toEqual([
      'No command: time simply passes.',
    ]);
  });
});

describe('the view', () => {
  it('is written as text and read back', () => {
    expect(selectionToText({ kind: 'node', id: 'use-auth' })).toBe('node:use-auth');
    expect(selectionFromText('edge:use-gateway->use-auth')).toEqual({
      kind: 'edge',
      id: 'use-gateway->use-auth',
    });
    expect(selectionFromText('nonsense')).toBeNull();
    expect(selectionFromText(undefined)).toBeNull();
  });

  it('is what the interface shows, less what is the default', () => {
    expect(currentView()).toEqual({});
    useUi.getState().selectNode('use-auth');
    useUi.getState().setViewMode('table');
    expect(currentView()).toEqual({
      arrangement: 'regions',
      view: 'table',
      select: 'node:use-auth',
    });
  });

  it('is applied to the platform on screen, and only what that platform has', () => {
    applyView({ arrangement: 'dependencies', select: 'node:use-orders-db', view: 'table' });
    expect(useUi.getState().layoutMode).toBe('dependencies');
    expect(useUi.getState().viewMode).toBe('table');
    expect(useUi.getState().selection).toEqual({ kind: 'node', id: 'use-orders-db' });
    // A service of some other platform is not selected.
    useUi.getState().select(null);
    applyView({ select: 'node:not-here' });
    expect(useUi.getState().selection).toBeNull();
    // A kind of service is a piece of the overview.
    useUi.getState().setLayoutMode('layers');
    applyView({ select: 'group:kind:database' });
    expect(useUi.getState().selection).toEqual({ kind: 'group', id: 'kind:database' });
  });

  it('is put back whole when a session is opened, defaults included', () => {
    // Someone looking at one service, in the table, by dependency tier…
    applyView({ arrangement: 'dependencies', select: 'node:use-orders-db', view: 'table' });
    // …opens a session saved on the overview with nothing selected. A view
    // is written without its defaults, so that one says nothing at all.
    restoreView({});
    expect(useUi.getState().layoutMode).toBe('layers');
    expect(useUi.getState().viewMode).toBe('scene');
    expect(useUi.getState().selection).toBeNull();
    // What a session does say is applied as before.
    restoreView({ arrangement: 'regions', select: 'node:use-auth' });
    expect(useUi.getState().layoutMode).toBe('regions');
    expect(useUi.getState().selection).toEqual({ kind: 'node', id: 'use-auth' });
  });

  it('is read from an address, leaving out what it does not understand', () => {
    expect(viewFromSearch('?arrangement=regions&select=node:use-auth&view=table')).toEqual({
      arrangement: 'regions',
      select: 'node:use-auth',
      view: 'table',
    });
    expect(viewFromSearch('?arrangement=sideways&view=table')).toEqual({ view: 'table' });
    expect(viewFromSearch('')).toEqual({});
  });

  it('is written into an address without disturbing what else is there', () => {
    expect(searchWithView('?debug=1', { arrangement: 'regions', select: 'node:use-auth' })).toBe(
      '?debug=1&arrangement=regions&select=node%3Ause-auth',
    );
    expect(searchWithView('?arrangement=regions&debug=1&select=node:x', {})).toBe('?debug=1');
    expect(searchWithView('?arrangement=regions', {})).toBe('');
  });
});
