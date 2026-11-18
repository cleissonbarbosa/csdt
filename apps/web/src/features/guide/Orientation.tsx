/**
 * The first visit: what this is for, and three ways in.
 *
 * The model alone says little to someone who has just arrived about what
 * can be learnt from it. This card says it once, offers the three things
 * the application is for, and is gone for good the moment one of them is
 * taken or the card is dismissed. After that the screen is the top bar and
 * the model again.
 */
import { Activity, KeyRound, Play, X } from 'lucide-react';
import type { ReactNode } from 'react';

import { useReportedHeight } from '@/app/hooks';
import { IconButton } from '@/components/ui/Button';
import { t } from '@/i18n';
import { tr } from '@/i18n/rich';
import { useGuide } from '@/stores/guide';
import { useTelemetry } from '@/stores/telemetry';
import { useUi } from '@/stores/ui';

function Path({
  icon,
  title,
  children,
  onClick,
  testId,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  onClick: () => void;
  testId: string;
}) {
  return (
    <li className="min-w-0 flex-1">
      <button
        type="button"
        onClick={() => {
          useGuide.getState().setOriented();
          onClick();
        }}
        className="flex h-full w-full items-start gap-2 rounded-control border border-line-strong bg-paper px-2.5 py-2 text-left transition-colors hover:border-ink hover:bg-raised"
        data-testid={testId}
      >
        <span aria-hidden className="mt-0.5 shrink-0 text-ink-dim">
          {icon}
        </span>
        <span className="min-w-0">
          <span className="block text-xs font-bold text-ink">{title}</span>
          <span className="mt-0.5 block text-[11px] leading-snug text-ink-dim">{children}</span>
        </span>
      </button>
    </li>
  );
}

/** Whether the orientation is on screen: only before it has been used. */
export function useOrientationVisible(): boolean {
  const oriented = useGuide((state) => state.oriented);
  const ready = useTelemetry((state) => state.topology !== null);
  return ready && !oriented;
}

/**
 * `bottom` keeps it clear of the timeline. `onHeight` reports how much of
 * the stage it covers, so the model can be framed above it.
 */
export function Orientation({
  bottom,
  onHeight,
}: {
  bottom: number;
  onHeight: (height: number) => void;
}) {
  const visible = useOrientationVisible();
  const kinds = useTelemetry(
    (state) => new Set(state.topology?.nodes.map((node) => node.serviceType)).size,
  );
  const element = useReportedHeight<HTMLElement>(visible, onHeight);

  if (!visible) return null;
  return (
    <section
      ref={element}
      className="panel floating absolute left-1/2 z-20 w-[min(44rem,calc(100%-1.5rem))] -translate-x-1/2 animate-rise p-3"
      style={{ bottom }}
      aria-label={t('Where to start')}
      data-testid="orientation"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-ink">
            {t('A fictional cloud platform, simulated, to take apart')}
          </h2>
          <p className="mt-0.5 text-[11px] leading-relaxed text-ink-dim">
            {t(
              'Each piece is a kind of service. Select one to see what it does and how it is doing; everything you see is computed by the simulation, and Cedar decides every authorization. Where would you like to start?',
            )}
          </p>
        </div>
        <IconButton
          label={t('Dismiss; this does not come back')}
          size="sm"
          onClick={() => useGuide.getState().setOriented()}
          data-testid="orientation-dismiss"
        >
          <X size={14} />
        </IconButton>
      </div>
      <ul className="mt-2.5 flex gap-2 max-sm:flex-col">
        <Path
          icon={<Activity size={15} />}
          title={t('Understand the platform')}
          testId="orientation-platform"
          onClick={() => {
            // The platform's own card: what it is, its signals, its regions.
            const ui = useUi.getState();
            ui.select(null);
            ui.setPanel(null);
            ui.setInspectorOpen(true);
          }}
        >
          {kinds > 0
            ? t(
                'Its {n} kinds of service, the path a request takes through them, and the signals that say how it is doing.',
                { n: kinds },
              )
            : t(
                'Its services, the path a request takes through them, and the signals that say how it is doing.',
              )}
        </Path>
        <Path
          icon={<Play size={15} />}
          title={t('Investigate a failure')}
          testId="orientation-incident"
          onClick={() => useUi.getState().setLeftTab('incidents')}
        >
          {t(
            'Start an incident, watch it spread, and read back where it began and why each service followed.',
          )}
        </Path>
        <Path
          icon={<KeyRound size={15} />}
          title={t('Test an authorization')}
          testId="orientation-authorization"
          onClick={() => {
            const ui = useUi.getState();
            if (ui.openPanel !== 'authorization') ui.togglePanel('authorization');
          }}
        >
          {t(
            'Ask Cedar who may do what, see which policy decides, and follow the request across the model.',
          )}
        </Path>
      </ul>
      <p className="caption mt-2">
        {tr(
          'Or <guide>take a guided challenge</guide>: a question about the platform, checked against the model. All of this stays in the menu at the end of the bar.',
          {
            guide: (children) => (
              <button
                type="button"
                onClick={() => useGuide.getState().setOpen(true)}
                className="text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink"
                data-testid="orientation-guide"
              >
                {children}
              </button>
            ),
          },
        )}
      </p>
    </section>
  );
}
