import { describe, expect, it, vi } from 'vitest';

import * as fixtures from '@/test/fixtures';

import { buildCommands, searchCommands, type CommandContext } from './commands';

function context(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    topology: fixtures.topology(),
    scenarios: fixtures.scenarios().scenarios,
    playing: true,
    viewMode: 'scene',
    layoutMode: 'regions',
    do: {
      selectService: vi.fn(),
      frameRegion: vi.fn(),
      startScenario: vi.fn(),
      togglePlay: vi.fn(),
      resetCamera: vi.fn(),
      setViewMode: vi.fn(),
      setLayoutMode: vi.fn(),
      setTheme: vi.fn(),
      openPanel: vi.fn(),
      openGuide: vi.fn(),
      toggleOverlay: vi.fn(),
    },
    ...overrides,
  };
}

describe('the command palette', () => {
  it('reaches an incident capture, except inside another page', () => {
    expect(buildCommands(context()).some((command) => command.id === 'capture')).toBe(true);
    expect(buildCommands(context({ embedded: false })).some((c) => c.id === 'capture')).toBe(true);
    const embedded = buildCommands(context({ embedded: true }));
    expect(embedded.some((command) => command.id === 'capture')).toBe(false);
    expect(searchCommands(embedded, 'capture')).toEqual([]);
  });

  it('offers every service, region and available scenario', () => {
    const ctx = context();
    const commands = buildCommands(ctx);
    const count = (group: string) => commands.filter((c) => c.group === group).length;
    expect(count('Services')).toBe(ctx.topology!.nodes.length);
    expect(count('Regions')).toBe(ctx.topology!.regions.length);
    expect(count('Scenarios')).toBe(ctx.scenarios.filter((s) => s.available).length);
    expect(new Set(commands.map((c) => c.id)).size).toBe(commands.length);
  });

  it('finds a service by name, kind and region together', () => {
    const commands = buildCommands(context());
    expect(searchCommands(commands, 'orders db')[0]!.title).toBe('Orders DB');
    const databases = searchCommands(commands, 'database eu west', 50);
    expect(databases.length).toBeGreaterThan(0);
    for (const command of databases) expect(command.hint).toMatch(/Database, EU West/);
    expect(searchCommands(commands, 'zzz-nothing')).toEqual([]);
  });

  it('ranks a title that starts with the query first', () => {
    const commands = buildCommands(context());
    const results = searchCommands(commands, 'cedar');
    expect(results[0]!.title.toLowerCase().startsWith('cedar')).toBe(true);
  });

  it('with no query, offers actions and scenarios rather than a wall of services', () => {
    const results = searchCommands(buildCommands(context()), '   ');
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((c) => c.group === 'Actions' || c.group === 'Scenarios')).toBe(true);
  });

  it('runs what it says', () => {
    const ctx = context();
    const commands = buildCommands(ctx);
    searchCommands(commands, 'orders db')[0]!.run();
    expect(ctx.do.selectService).toHaveBeenCalledWith('use-orders-db');
    searchCommands(commands, 'start ddos')[0]!.run();
    expect(ctx.do.startScenario).toHaveBeenCalledWith('ddos-surge');
    searchCommands(commands, 'night theme')[0]!.run();
    expect(ctx.do.setTheme).toHaveBeenCalledWith('night');
    searchCommands(commands, 'frame eu west')[0]!.run();
    expect(ctx.do.frameRegion).toHaveBeenCalledWith('eu-west');
  });

  it('words its toggles for the state they are in', () => {
    const paused = buildCommands(context({ playing: false, viewMode: 'table' }));
    expect(paused.find((c) => c.id === 'play')!.title).toBe('Resume the simulation');
    expect(paused.find((c) => c.id === 'view')!.title).toBe('Show the 3D model');
  });
});
