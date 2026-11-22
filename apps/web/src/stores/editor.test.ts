import { afterEach, describe, expect, it } from 'vitest';

import { topology as sampleTopology, snapshot as sampleSnapshot } from '@/test/fixtures';
import {
  addService,
  blankTopology,
  draftText,
  removeService,
  updateService,
  type TopologyDraft,
} from '@/lib/topologyFile';

import { HISTORY_LIMIT, selectCanRedo, selectCanUndo, selectEditing, useEditor } from './editor';

const editor = () => useEditor.getState();
const draft = () => editor().draft as TopologyDraft;

afterEach(() => editor().close());

describe('the editor store', () => {
  it('opens on a draft with nothing to undo, and closes to nothing', () => {
    expect(selectEditing(editor())).toBe(false);
    editor().open(blankTopology(), { kind: 'blank', name: 'My platform' });
    expect(selectEditing(editor())).toBe(true);
    expect(selectCanUndo(editor())).toBe(false);
    editor().close();
    expect(editor().draft).toBeNull();
    expect(editor().origin).toBeNull();
  });

  it('keeps each change as a step to undo and redo', () => {
    editor().open(blankTopology(), { kind: 'blank', name: 'x' });
    const first = draft();
    editor().change((d) => addService(d, 'api-gateway', 'main', 1).draft);
    const second = draft();
    editor().change((d) => addService(d, 'database', 'main', 2).draft);
    expect(draft().nodes).toHaveLength(3);
    editor().undo();
    expect(draft()).toBe(second);
    editor().undo();
    expect(draft()).toBe(first);
    expect(selectCanUndo(editor())).toBe(false);
    editor().redo();
    expect(draft()).toBe(second);
    expect(selectCanRedo(editor())).toBe(true);
    // A new change after undoing forgets what could have been redone.
    editor().change((d) => addService(d, 'cache', 'main', 2).draft);
    expect(selectCanRedo(editor())).toBe(false);
  });

  it('is not changed by a change that changes nothing', () => {
    editor().open(blankTopology(), { kind: 'blank', name: 'x' });
    editor().change((d) => d);
    expect(selectCanUndo(editor())).toBe(false);
  });

  it('makes one step of a run of changes to one field', () => {
    editor().open(blankTopology(), { kind: 'blank', name: 'x' });
    const before = draft();
    for (const name of ['S', 'Sh', 'Sho', 'Shop']) {
      editor().change((d) => updateService(d, 'clients', { name }), 'node:clients:name');
    }
    expect(draft().nodes[0]?.name).toBe('Shop');
    expect(editor().past).toHaveLength(1);
    editor().undo();
    expect(draft()).toBe(before);
  });

  it('keeps no more steps than its limit', () => {
    editor().open(blankTopology(), { kind: 'blank', name: 'x' });
    for (let i = 0; i < HISTORY_LIMIT + 10; i += 1) {
      editor().change((d) => updateService(d, 'clients', { baseRps: i + 1 }));
    }
    expect(editor().past).toHaveLength(HISTORY_LIMIT);
  });

  it('lets go of a selection whose service is taken away, also by undoing', () => {
    editor().open(blankTopology(), { kind: 'blank', name: 'x' });
    editor().change((d) => addService(d, 'database', 'main', 1).draft);
    editor().select({ kind: 'node', id: 'database' });
    editor().change((d) => removeService(d, 'database'));
    expect(editor().selection).toBeNull();
    editor().undo();
    editor().select({ kind: 'node', id: 'database' });
    editor().undo();
    expect(editor().selection).toBeNull();
    editor().select({ kind: 'node', id: 'nowhere' });
    expect(editor().selection).toBeNull();
  });

  it('keeps an answer of the engine only for the draft as it now is', () => {
    editor().open(blankTopology(), { kind: 'blank', name: 'x' });
    const asked = draftText(draft());
    editor().change((d) => updateService(d, 'clients', { baseRps: 300 }));
    editor().answered({
      text: asked,
      state: 'ran',
      topology: sampleTopology(),
      snapshot: sampleSnapshot(),
    });
    expect(editor().answer).toBeNull();
    editor().answered({ text: draftText(draft()), state: 'refused', message: 'no' });
    expect(editor().answer).toMatchObject({ state: 'refused' });
  });
});
