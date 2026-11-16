/**
 * Everything the command palette can do, as data.
 *
 * Building the list is a pure function of application state, so it can be
 * tested without rendering anything; running a command is the only part with
 * side effects.
 */
import type { Scenario, Topology } from '@aegis/contracts';

import { SERVICE_TYPE } from '@/lib/palette';
import type { LayoutMode, PanelId } from '@/stores/ui';

export type CommandGroup = 'Services' | 'Scenarios' | 'Regions' | 'Actions';

export interface Command {
  id: string;
  group: CommandGroup;
  title: string;
  /** Shown beside the title, and searched along with it. */
  hint?: string;
  run: () => void;
}

export interface CommandContext {
  topology: Topology | null;
  scenarios: Scenario[];
  playing: boolean;
  viewMode: 'scene' | 'table';
  layoutMode: LayoutMode;
  /** The effects commands have, supplied by the application. */
  do: {
    selectService: (id: string) => void;
    frameRegion: (id: string) => void;
    startScenario: (id: string) => void;
    togglePlay: () => void;
    resetCamera: () => void;
    setViewMode: (mode: 'scene' | 'table') => void;
    setLayoutMode: (mode: LayoutMode) => void;
    setTheme: (theme: 'system' | 'light' | 'night') => void;
    openPanel: (panel: PanelId) => void;
    openGuide: () => void;
    toggleOverlay: () => void;
  };
}

const ARRANGEMENTS: { mode: LayoutMode; title: string }[] = [
  { mode: 'layers', title: 'Show the overview' },
  { mode: 'regions', title: 'Show every service, by region' },
  { mode: 'dependencies', title: 'Show every service, by dependency tier' },
];

export function buildCommands(context: CommandContext): Command[] {
  const { topology, scenarios } = context;
  const act = context.do;
  const regionName = new Map(topology?.regions.map((r) => [r.id, r.name]));
  const commands: Command[] = [];

  commands.push(
    {
      id: 'play',
      group: 'Actions',
      title: context.playing ? 'Pause the simulation' : 'Resume the simulation',
      hint: 'Space',
      run: act.togglePlay,
    },
    { id: 'camera', group: 'Actions', title: 'Reset the camera', hint: 'R', run: act.resetCamera },
    {
      id: 'view',
      group: 'Actions',
      title: context.viewMode === 'scene' ? 'Show the table view' : 'Show the 3D model',
      hint: 'T',
      run: () => act.setViewMode(context.viewMode === 'scene' ? 'table' : 'scene'),
    },
    // The arrangements other than the one on show.
    ...ARRANGEMENTS.filter((entry) => entry.mode !== context.layoutMode).map((entry): Command => ({
      id: `layout-${entry.mode}`,
      group: 'Actions',
      title: entry.title,
      hint: 'L',
      run: () => act.setLayoutMode(entry.mode),
    })),
    {
      id: 'theme-light',
      group: 'Actions',
      title: 'Use the light theme',
      run: () => act.setTheme('light'),
    },
    {
      id: 'theme-night',
      group: 'Actions',
      title: 'Use the night theme',
      run: () => act.setTheme('night'),
    },
    {
      id: 'theme-system',
      group: 'Actions',
      title: 'Follow the system theme',
      run: () => act.setTheme('system'),
    },
    {
      id: 'authorization',
      group: 'Actions',
      title: 'Open the authorization explorer',
      hint: 'Cedar',
      run: () => act.openPanel('authorization'),
    },
    {
      id: 'experiment',
      group: 'Actions',
      title: 'Compare an intervention',
      hint: 'the same incident twice, A/B',
      run: () => act.openPanel('experiment'),
    },
    {
      id: 'guide',
      group: 'Actions',
      title: 'Take a guided challenge',
      hint: 'objectives, training',
      run: act.openGuide,
    },
    {
      id: 'session',
      group: 'Actions',
      title: 'Save or share this session',
      hint: 'link, file, reproduce',
      run: () => act.openPanel('session'),
    },
    {
      id: 'scenario-editor',
      group: 'Actions',
      title: 'Write a scenario',
      hint: 'editor, phases, effects',
      run: () => act.openPanel('scenario-editor'),
    },
    {
      id: 'integrations',
      group: 'Actions',
      title: 'Open integrations',
      run: () => act.openPanel('integrations'),
    },
    {
      id: 'workspace',
      group: 'Actions',
      title: 'Import or export the platform files',
      hint: 'topology, scenarios, Cedar policies',
      run: () => act.openPanel('workspace'),
    },
    {
      id: 'settings',
      group: 'Actions',
      title: 'Open settings',
      run: () => act.openPanel('settings'),
    },
    {
      id: 'help',
      group: 'Actions',
      title: 'Open help and legend',
      hint: '?',
      run: () => act.openPanel('help'),
    },
    {
      id: 'overlay',
      group: 'Actions',
      title: 'Toggle the performance overlay',
      hint: 'P',
      run: act.toggleOverlay,
    },
  );

  for (const scenario of scenarios) {
    if (!scenario.available) continue;
    commands.push({
      id: `scenario-${scenario.id}`,
      group: 'Scenarios',
      title: `Start ${scenario.name}`,
      hint: 'incident scenario',
      run: () => act.startScenario(scenario.id),
    });
  }

  for (const region of topology?.regions ?? []) {
    commands.push({
      id: `region-${region.id}`,
      group: 'Regions',
      title: `Frame ${region.name}`,
      hint: region.location,
      run: () => act.frameRegion(region.id),
    });
  }

  for (const node of topology?.nodes ?? []) {
    commands.push({
      id: `service-${node.id}`,
      group: 'Services',
      title: node.name,
      hint: `${SERVICE_TYPE[node.serviceType].label}, ${regionName.get(node.region) ?? node.region}`,
      run: () => act.selectService(node.id),
    });
  }
  return commands;
}

/**
 * Commands matching every word of the query, best first: a title that starts
 * with the query, then one that contains it, then a match in the hint.
 * With no query, the actions and scenarios are offered.
 */
export function searchCommands(commands: Command[], query: string, limit = 12): Command[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return commands.filter((c) => c.group === 'Actions' || c.group === 'Scenarios').slice(0, limit);
  }
  const phrase = words.join(' ');
  const scored: { command: Command; score: number }[] = [];
  for (const command of commands) {
    const title = command.title.toLowerCase();
    const haystack = `${title} ${command.hint?.toLowerCase() ?? ''}`;
    if (!words.every((word) => haystack.includes(word))) continue;
    const score = title.startsWith(phrase)
      ? 0
      : title.includes(phrase)
        ? 1
        : words.every((word) => title.includes(word))
          ? 2
          : 3;
    scored.push({ command, score });
  }
  scored.sort((a, b) => a.score - b.score || a.command.title.localeCompare(b.command.title));
  return scored.slice(0, limit).map((entry) => entry.command);
}
