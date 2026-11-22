/**
 * Everything the command palette can do, as data.
 *
 * Building the list is a pure function of application state, so it can be
 * tested without rendering anything; running a command is the only part with
 * side effects.
 */
import type { Scenario, Topology } from '@aegis/contracts';

import { t } from '@/i18n';
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
  /**
   * Whether the page is shown inside another one (`?embed=1`). An embed
   * reaches no incident capture: it has no bar to say what one is, nor a
   * way back from it.
   */
  embedded?: boolean;
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
    /** Opens the editor on the platform in use, writing an incident. */
    writeIncident: () => void;
    toggleOverlay: () => void;
  };
}

const ARRANGEMENTS: { mode: LayoutMode; title: string }[] = [
  { mode: 'layers', title: t('Show the overview') },
  { mode: 'regions', title: t('Show every service, by region') },
  { mode: 'dependencies', title: t('Show every service, by dependency tier') },
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
      title: context.playing ? t('Pause the simulation') : t('Resume the simulation'),
      hint: t('Space'),
      run: act.togglePlay,
    },
    {
      id: 'camera',
      group: 'Actions',
      title: t('Reset the camera'),
      hint: 'R',
      run: act.resetCamera,
    },
    {
      id: 'view',
      group: 'Actions',
      title: context.viewMode === 'scene' ? t('Show the table view') : t('Show the 3D model'),
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
      title: t('Use the light theme'),
      run: () => act.setTheme('light'),
    },
    {
      id: 'theme-night',
      group: 'Actions',
      title: t('Use the night theme'),
      run: () => act.setTheme('night'),
    },
    {
      id: 'theme-system',
      group: 'Actions',
      title: t('Follow the system theme'),
      run: () => act.setTheme('system'),
    },
    {
      id: 'authorization',
      group: 'Actions',
      title: t('Open the authorization explorer'),
      hint: 'Cedar',
      run: () => act.openPanel('authorization'),
    },
    {
      id: 'matrix',
      group: 'Actions',
      title: t('See who may do what'),
      hint: 'Cedar',
      run: () => act.openPanel('matrix'),
    },
    {
      id: 'policies',
      group: 'Actions',
      title: t('Edit the Cedar policies'),
      hint: 'Cedar',
      run: () => act.openPanel('policies'),
    },
    {
      id: 'experiment',
      group: 'Actions',
      title: t('Compare an intervention'),
      hint: t('the same incident twice, A/B'),
      run: () => act.openPanel('experiment'),
    },
    {
      id: 'limits',
      group: 'Actions',
      title: t('Find where the platform gives'),
      hint: t('headroom, single points of failure'),
      run: () => act.openPanel('limits'),
    },
    {
      id: 'guide',
      group: 'Actions',
      title: t('Take a guided challenge'),
      hint: t('objectives, training'),
      run: act.openGuide,
    },
    {
      id: 'session',
      group: 'Actions',
      title: t('Save or share this session'),
      hint: t('link, file, reproduce'),
      run: () => act.openPanel('session'),
    },
    {
      id: 'integrations',
      group: 'Actions',
      title: t('Open integrations'),
      run: () => act.openPanel('integrations'),
    },
    {
      id: 'workspace',
      group: 'Actions',
      title: t('Import or export the platform files'),
      hint: t('topology, scenarios, Cedar policies'),
      run: () => act.openPanel('workspace'),
    },
    // The editor has a bar of its own, which an embed does not show.
    ...(context.embedded
      ? []
      : [
          {
            id: 'scenario-editor',
            group: 'Actions' as const,
            title: t('Write a scenario'),
            hint: t('editor, phases, effects'),
            run: act.writeIncident,
          },
        ]),
    ...(context.embedded
      ? []
      : [
          {
            id: 'capture',
            group: 'Actions' as const,
            title: t('Open an incident capture'),
            hint: t('a real incident, not simulated'),
            run: () => act.openPanel('capture'),
          },
        ]),
    {
      id: 'settings',
      group: 'Actions',
      title: t('Open settings'),
      run: () => act.openPanel('settings'),
    },
    {
      id: 'help',
      group: 'Actions',
      title: t('Open help and legend'),
      hint: '?',
      run: () => act.openPanel('help'),
    },
    {
      id: 'overlay',
      group: 'Actions',
      title: t('Toggle the performance overlay'),
      hint: 'P',
      run: act.toggleOverlay,
    },
  );

  for (const scenario of scenarios) {
    if (!scenario.available) continue;
    commands.push({
      id: `scenario-${scenario.id}`,
      group: 'Scenarios',
      title: t('Start {scenario}', { scenario: scenario.name }),
      hint: t('incident scenario'),
      run: () => act.startScenario(scenario.id),
    });
  }

  for (const region of topology?.regions ?? []) {
    commands.push({
      id: `region-${region.id}`,
      group: 'Regions',
      title: t('Frame {region}', { region: region.name }),
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
