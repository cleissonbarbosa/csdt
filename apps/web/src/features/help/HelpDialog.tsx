import { SERVICE_TYPES } from '@aegis/contracts';
import type { ReactNode } from 'react';

import { HealthGlyph } from '@/components/ui/Badge';
import { Dialog } from '@/components/ui/Dialog';
import { UnknownGlyph } from '@/features/capture/present';
import { t } from '@/i18n';
import { tr } from '@/i18n/rich';
import {
  CAPTURE_STATE_LABEL,
  CAPTURE_UNMEASURED_LABEL,
  COLOR,
  HEALTH_LABEL,
  SERVICE_TYPE,
  TRAFFIC_LEGEND,
  type BeadShape,
} from '@/lib/palette';
import { selectOpen, useCapture } from '@/stores/capture';
import { useUi } from '@/stores/ui';

const SHAPES: Record<(typeof SERVICE_TYPES)[number], string> = {
  'api-gateway': t('A gate; its door turns as requests pass'),
  'auth-service': t('A shield; its lock turns for each sign-in'),
  'cedar-authorizer': t('A cedar; its tiers turn a notch for each decision'),
  microservice: t('A hexagonal cell; its lid turns one side on'),
  container: t('A shipping container; its doors open to take work in'),
  serverless: t('A lightning bolt; it strikes once for each call'),
  'message-queue': t('Slabs standing in line; the line moves up as they are taken'),
  database: t('A stack of platters, turning'),
  storage: t('A bucket; objects are lifted out and put back'),
  'network-gateway': t('A desk globe, turning'),
  'security-monitor': t('A lighthouse above the edge; its lamp sweeps round'),
  'external-client': t('A pawn; its head lifts as it asks'),
};

const KEYS: [string, string][] = [
  [t('Space'), t('Play or pause the simulation')],
  ['R', t('Reset the camera')],
  ['F', t('Move in on what is selected')],
  ['Esc', t('Let go of the selection, then put the panels away')],
  ['Ctrl K', t('Go to anything: a service, a region, a scenario, an action')],
  ['/', t('Search services')],
  ['L', t('Next arrangement: overview, by region, by dependency')],
  ['T', t('Switch between the 3D view and the table')],
  ['P', t('Toggle the performance overlay')],
  ['?', t('Open this help')],
  ['← / →', t('On the timeline: step 5 s (hold Shift for 30 s)')],
];

/**
 * The keys while an incident capture is open. Its clock is its own, it is
 * drawn by region only, and the simulation's search and palette are not
 * there, so those keys are left out rather than listed as doing nothing.
 */
const CAPTURE_KEYS: [string, string][] = [
  [t('Space'), t('Play or pause the capture')],
  ['R', t('Reset the camera')],
  ['F', t('Move in on what is selected')],
  ['Esc', t('Let go of the selection, then put the panels away')],
  ['/', t('List the services of the capture')],
  ['T', t('Switch between the 3D view and the table')],
  ['P', t('Toggle the performance overlay')],
  ['?', t('Open this help')],
  [
    '← / →',
    t(
      "On the capture's timeline: step one sampling period, or a hundredth of the window where there is none (hold Shift for ten)",
    ),
  ],
  [t('Home / End'), t('The start or the end of the capture')],
];

/** The same shapes the scene draws its traffic beads with. */
function Bead({ shape, color }: { shape: BeadShape; color: string }) {
  const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 2 } as const;
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden
      className="shrink-0"
      style={{ color }}
    >
      {shape === 'disc' && <circle cx="6" cy="6" r="4" fill="currentColor" />}
      {shape === 'ring' && <circle cx="6" cy="6" r="3.500" {...stroke} />}
      {shape === 'diamond' && <path d="M6 0.8 11.200 6 6 11.200 0.800 6Z" fill="currentColor" />}
      {shape === 'square' && <rect x="2.4" y="2.4" width="7.2" height="7.2" fill="currentColor" />}
      {shape === 'frame' && <rect x="2.6" y="2.6" width="6.8" height="6.8" {...stroke} />}
      {shape === 'bar' && <rect x="0.6" y="4.2" width="10.8" height="3.6" fill="currentColor" />}
      {shape === 'triangle' && <path d="M6 1.200 11.200 10.200H0.800Z" fill="currentColor" />}
    </svg>
  );
}

const TONE = { warning: COLOR.warning, critical: COLOR.critical, hostile: COLOR.hostile } as const;

function Heading({ children, first }: { children: string; first?: boolean }) {
  return <h3 className={`mb-2 text-xs font-bold text-ink ${first ? '' : 'mt-5'}`}>{children}</h3>;
}

/** A word the text names: a gesture, a term of the legend. */
const ink = (children: ReactNode) => <span className="text-ink">{children}</span>;

function Key({ children }: { children: string }) {
  return (
    <kbd className="code inline-flex h-5 min-w-5 items-center justify-center rounded-control border border-line-strong bg-sunken px-1.5 text-[11px] text-ink">
      {children}
    </kbd>
  );
}

export function HelpDialog() {
  const open = useUi((state) => state.openPanel === 'help');
  const captured = useCapture(selectOpen);
  const keys = captured ? CAPTURE_KEYS : KEYS;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => useUi.getState().setPanel(next ? 'help' : null)}
      title={t('Help and legend')}
      description={t('How to read the model and move around it.')}
      width="max-w-3xl"
    >
      <div className="grid gap-6 md:grid-cols-2">
        <section>
          <Heading first>{t('Two levels')}</Heading>
          <p className="mb-5 text-xs leading-relaxed text-ink-dim">
            {tr(
              'The <ink>overview</ink> shows the platform as its kinds of service, in the four layers a request crosses: entry, identity, compute, data. A piece there stands for every service of its kind and says how many; its figures are theirs, added up. The two detailed arrangements show every service on its own, by region or by dependency tier. Opening a service from a list or from a kind takes you to it there.',
              { ink },
            )}
          </p>

          <Heading>{t('Camera')}</Heading>
          <ul className="space-y-1.5 text-xs text-ink-dim">
            <li>{tr('<ink>Drag</ink> to orbit', { ink })}</li>
            <li>{tr('<ink>Right-drag</ink> or <ink>two-finger drag</ink> to pan', { ink })}</li>
            <li>
              {tr('<ink>Scroll</ink> or <ink>pinch</ink> to zoom toward the pointer', { ink })}
            </li>
            <li>{tr('<ink>Click</ink> a service or a connection to inspect it', { ink })}</li>
            <li>
              {tr(
                '<ink>Double-click</ink> a service to move in on it, or a plate to move in on its region',
                { ink },
              )}
            </li>
            <li>
              {tr(
                '<ink>Point</ink> at a service to see what it is connected to; selecting it keeps that neighbourhood in front while the rest recedes',
                { ink },
              )}
            </li>
            <li>
              {t(
                'Tracing a request, or an incident among every service, takes the camera to its path; taking the camera yourself stops that',
              )}
            </li>
          </ul>

          <Heading>{t('Keyboard')}</Heading>
          <dl className="space-y-1.5" data-testid="help-keys">
            {keys.map(([key, description]) => (
              <div key={key} className="flex items-center gap-3 text-xs">
                <dt className="w-[4.5rem] shrink-0">
                  <Key>{key}</Key>
                </dt>
                <dd className="text-ink-dim">{description}</dd>
              </div>
            ))}
          </dl>

          <Heading>{t('State of a service')}</Heading>
          <p className="mb-2 text-xs leading-relaxed text-ink-dim">
            {tr(
              'Colour is an answer. <blue>Blue</blue> answers you: what you selected, the request you are following. The other colours answer the data: something is not normal. A service that is well is neutral, and has no mark in any list.',
              { blue: (children) => <span style={{ color: COLOR.focus }}>{children}</span> },
            )}
          </p>
          <ul className="space-y-1.5">
            {(['healthy', 'degraded', 'critical', 'down'] as const).map((health) => (
              <li key={health} className="flex items-center gap-2 text-xs text-ink-dim">
                <span className="inline-flex w-3 justify-center">
                  <HealthGlyph health={health} />
                </span>
                <span className="w-16 text-ink">{HEALTH_LABEL[health]}</span>
                {health === 'healthy' && t('Neutral piece, no mark; its part runs evenly')}
                {health === 'degraded' && t('Amber piece and a lamp; its part hesitates')}
                {health === 'critical' && t('Red piece and a lamp; its part is jammed')}
                {health === 'down' && t('Pale piece; its part hangs crooked and still')}
              </li>
            ))}
            {/* One drawing, three wordings: the one for no sample is the row's
                name, and the other two are said beside it as the interface
                says them, from the same table. */}
            <li className="flex items-start gap-2 text-xs text-ink-dim" data-testid="help-unknown">
              <span className="inline-flex h-4 w-3 shrink-0 items-center justify-center">
                <UnknownGlyph />
              </span>
              <span className="w-16 shrink-0 leading-4 text-ink">
                {CAPTURE_STATE_LABEL.unknown}
              </span>
              <span className="min-w-0 flex-1 leading-4">
                {t(
                  'Upright piece on a dashed ring, a shade fainter: in an incident capture, a service whose state the source does not give',
                )}
                <span className="caption mt-0.5 block leading-relaxed">
                  {t(
                    "Where a sample has no count to take an error rate from, the state reads “{unmeasured}”; in a provider's report, “{unstated}”.",
                    {
                      unmeasured: CAPTURE_UNMEASURED_LABEL,
                      unstated: CAPTURE_STATE_LABEL['not-stated'],
                    },
                  )}
                </span>
              </span>
            </li>
          </ul>
          <p className="caption mt-2 leading-relaxed">
            {t(
              'In the overview a lamp under a neutral piece means some of that kind are affected, and its part hesitates; the piece itself takes the colour, and the manner, when all of them are. A red badge with a cross marks where a request was stopped.',
            )}
          </p>
        </section>

        <section>
          <Heading first>{t('Traffic')}</Heading>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {TRAFFIC_LEGEND.map(({ key, label, shape, tone }) => (
              <li key={key} className="flex items-center gap-2 text-xs text-ink-dim">
                <Bead shape={shape} color={tone ? TONE[tone] : COLOR.ink} />
                {label}
              </li>
            ))}
          </ul>
          <p className="caption mt-2 leading-relaxed">
            {t(
              'Every bead is a share of the requests on a connection; how many there are follows the request rate. Ordinary traffic is told apart by shape. Traffic that went wrong takes a colour once it amounts to something: errors above one request in a hundred, rejections above one in ten. Below that it keeps its shape and stays ink. Rejected requests stop short of their target.',
            )}
          </p>

          <Heading>{t('Time')}</Heading>
          <p className="text-xs leading-relaxed text-ink-dim">
            {tr(
              "The clock is the simulation's own. The cursor is either at the <ink>simulation's now</ink>, where new history is being made, or in its <ink>history</ink>, which is re-simulated exactly as it happened; either can be <ink>paused</ink>. A phase of an incident is timed from the start of that incident (<n>+0:14</n>); an event shows both that and the simulation clock, which differ by when the incident began.",
              { ink, n: (children) => <span className="numeric">{children}</span> },
            )}
          </p>

          <Heading>{t('Why something happened')}</Heading>
          <p className="mb-2 text-xs leading-relaxed text-ink-dim">
            {t(
              'An incident can be read back from its own record: select a phase, an event or the summary. Each line says what kind of statement it is.',
            )}
          </p>
          <ul className="space-y-1.5 text-xs text-ink-dim">
            <li>
              {tr('{term}: written in the scenario file. The scenario does this by itself.', {
                term: ink(t('Prescribed')),
              })}
            </li>
            <li>
              {tr(
                '{term}: a relation of the topology the model follows. A dependency carries failures back to its callers; added traffic flows on to what is called.',
                { term: ink(t('Modelled')) },
              )}
            </li>
            <li>
              {tr('{term}: an event or a figure the engine recorded during the run.', {
                term: ink(t('Observed')),
              })}
            </li>
            <li>
              {tr(
                '{term}: none of the relations the report knows accounts for it, and it does not guess.',
                { term: ink(t('Not explained')) },
              )}
            </li>
          </ul>

          <Heading>{t('Kinds of service')}</Heading>
          <ul className="space-y-1.5">
            {SERVICE_TYPES.map((type) => (
              <li key={type} className="flex items-baseline gap-2 text-xs">
                <span className="w-32 shrink-0 text-ink">{SERVICE_TYPE[type].label}</span>
                <span className="text-ink-dim">{SHAPES[type]}</span>
              </li>
            ))}
          </ul>
          <p className="caption mt-2 leading-relaxed">
            {t(
              "The part of a piece that moves runs at the pace of its service's traffic: faster under a surge, slower as traffic thins, and still when nothing passes.",
            )}
          </p>
        </section>
      </div>
      <p className="caption mt-6 border-t border-line pt-3 leading-relaxed">
        {t(
          'AEGIS is a simulation. The platform, its metrics and every incident are synthetic and deterministic; no real system is scanned or attacked.',
        )}{' '}
        {t(
          'Apart from what a connected local instance reports (labelled Live), an incident capture is the one exception: a real incident as its source gave it, read in this browser, labelled as not simulated and never mixed into the simulation.',
        )}
      </p>
    </Dialog>
  );
}
