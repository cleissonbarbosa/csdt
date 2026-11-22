import * as RadixDialog from '@radix-ui/react-dialog';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { actions } from '@/app/actions';
import { embedFromSearch } from '@/app/embed';
import { showRegion } from '@/app/navigate';
import { queryKeys } from '@/app/queryClient';
import { writeIncident } from '@/features/editor/open';
import { sceneHandle } from '@/graphics/handle';
import { t } from '@/i18n';
import { cn } from '@/lib/cn';
import { api } from '@/providers/api';
import { selectOpen, useCapture } from '@/stores/capture';
import { useGuide } from '@/stores/guide';
import { useTelemetry } from '@/stores/telemetry';
import { useSettings, useUi } from '@/stores/ui';

import { buildCommands, searchCommands, type Command } from './commands';

/**
 * One box to reach anything by name: a service, a region, a scenario, an
 * action. Opened with Ctrl or ⌘ and K. It exists so that the rest of the
 * interface does not have to show every control all the time.
 *
 * Everything it reaches is the simulation's, so it is not there while an
 * incident capture is open.
 */
export function CommandPalette() {
  const captured = useCapture(selectOpen);
  const open = useUi((state) => state.commandOpen) && !captured;
  const setOpen = useUi((state) => state.setCommandOpen);
  const topology = useTelemetry((state) => state.topology);
  const playing = useTelemetry((state) => state.playback?.status === 'playing');
  const viewMode = useUi((state) => state.viewMode);
  const layoutMode = useUi((state) => state.layoutMode);
  const { data: scenarios } = useQuery({ queryKey: queryKeys.scenarios, queryFn: api.scenarios });
  // Read once, as the page reads it (`App.tsx`).
  const [embedded] = useState(() => embedFromSearch(window.location.search) !== null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const commands = useMemo(
    () =>
      buildCommands({
        topology,
        scenarios: scenarios?.scenarios ?? [],
        playing,
        viewMode,
        layoutMode,
        embedded,
        do: {
          selectService: (id) => {
            useUi.getState().selectNode(id);
            sceneHandle.current?.focusNode(id);
          },
          frameRegion: showRegion,
          startScenario: (id) => {
            useUi.getState().setLeftTab('incidents');
            void actions.startScenario(id);
          },
          togglePlay: () => void actions.control({ action: playing ? 'pause' : 'play' }),
          resetCamera: () => sceneHandle.current?.resetView(),
          setViewMode: (mode) => useUi.getState().setViewMode(mode),
          setLayoutMode: (mode) => useUi.getState().setLayoutMode(mode),
          setTheme: (theme) => useSettings.getState().set('theme', theme),
          openPanel: (panel) => useUi.getState().setPanel(panel),
          openGuide: () => useGuide.getState().setOpen(true),
          writeIncident: () => void writeIncident(),
          toggleOverlay: () => {
            const settings = useSettings.getState();
            settings.set('devOverlay', !settings.devOverlay);
          },
        },
      }),
    [topology, scenarios, playing, viewMode, layoutMode, embedded],
  );
  const results = useMemo(() => searchCommands(commands, query), [commands, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);
  useEffect(() => setActive(0), [query]);

  const run = (command: Command | undefined) => {
    if (!command) return;
    setOpen(false);
    command.run();
  };

  return (
    <RadixDialog.Root open={open} onOpenChange={setOpen}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 animate-fade bg-black/40" />
        <RadixDialog.Content
          aria-describedby={undefined}
          className="panel fixed left-1/2 top-[18vh] z-50 w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 animate-rise"
          data-testid="command-palette"
        >
          <RadixDialog.Title className="sr-only">
            {t('Go to a service or run a command')}
          </RadixDialog.Title>
          <div className="flex items-center gap-2 border-b border-line px-3">
            <Search size={15} aria-hidden className="shrink-0 text-ink-faint" />
            <input
              type="text"
              role="combobox"
              aria-expanded
              aria-controls="command-results"
              aria-activedescendant={results[active] ? `command-${results[active].id}` : undefined}
              aria-label={t('Search services, regions, scenarios and actions')}
              placeholder={t('Orders DB, frame EU West, start a scenario…')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  setActive((i) => Math.min(results.length - 1, i + 1));
                } else if (event.key === 'ArrowUp') {
                  setActive((i) => Math.max(0, i - 1));
                } else if (event.key === 'Enter') {
                  run(results[active]);
                } else {
                  return;
                }
                event.preventDefault();
              }}
              className="h-11 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
              data-testid="command-input"
            />
          </div>
          {results.length === 0 ? (
            <p className="px-3 py-4 text-xs text-ink-faint">
              {t('Nothing matches. Try the name of a service, a region or a scenario.')}
            </p>
          ) : (
            <ul
              id="command-results"
              role="listbox"
              aria-label={t('Results')}
              className="max-h-[50vh] overflow-y-auto p-1"
            >
              {results.map((command, i) => (
                <li
                  key={command.id}
                  id={`command-${command.id}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseMove={() => setActive(i)}
                  onClick={() => run(command)}
                  className={cn(
                    'flex cursor-pointer items-baseline justify-between gap-3 rounded-control px-2 py-1.5 text-xs',
                    i === active ? 'bg-accent text-on-accent' : 'text-ink',
                  )}
                >
                  <span className="min-w-0 truncate">{command.title}</span>
                  {command.hint && (
                    <span
                      className={cn(
                        'shrink-0 text-[11px]',
                        i === active ? 'text-on-accent/80' : 'text-ink-faint',
                      )}
                    >
                      {command.hint}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
