import { SERVICE_TYPES } from '@aegis/contracts';

import { HealthGlyph } from '@/components/ui/Badge';
import { Dialog } from '@/components/ui/Dialog';
import { COLOR, HEALTH_LABEL, SERVICE_TYPE, TRAFFIC_LEGEND, type BeadShape } from '@/lib/palette';
import { useUi } from '@/stores/ui';

const SHAPES: Record<(typeof SERVICE_TYPES)[number], string> = {
  'api-gateway': 'A gate; its door turns as requests pass',
  'auth-service': 'A shield; its lock turns for each sign-in',
  'cedar-authorizer': 'A cedar; its tiers turn a notch for each decision',
  microservice: 'A hexagonal cell; its lid turns one side on',
  container: 'A shipping container; its doors open to take work in',
  serverless: 'A lightning bolt; it strikes once for each call',
  'message-queue': 'Slabs standing in line; the line moves up as they are taken',
  database: 'A stack of platters, turning',
  storage: 'A bucket; objects are lifted out and put back',
  'network-gateway': 'A desk globe, turning',
  'security-monitor': 'A lighthouse above the edge; its lamp sweeps round',
  'external-client': 'A pawn; its head lifts as it asks',
};

const KEYS: [string, string][] = [
  ['Space', 'Play or pause the simulation'],
  ['R', 'Reset the camera'],
  ['F', 'Move in on what is selected'],
  ['Esc', 'Let go of the selection, then put the panels away'],
  ['Ctrl K', 'Go to anything: a service, a region, a scenario, an action'],
  ['/', 'Search services'],
  ['L', 'Next arrangement: overview, by region, by dependency'],
  ['T', 'Switch between the 3D view and the table'],
  ['P', 'Toggle the performance overlay'],
  ['?', 'Open this help'],
  ['← / →', 'On the timeline: step 5 s (hold Shift for 30 s)'],
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

function Key({ children }: { children: string }) {
  return (
    <kbd className="code inline-flex h-5 min-w-5 items-center justify-center rounded-control border border-line-strong bg-sunken px-1.5 text-[11px] text-ink">
      {children}
    </kbd>
  );
}

export function HelpDialog() {
  const open = useUi((state) => state.openPanel === 'help');
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => useUi.getState().setPanel(next ? 'help' : null)}
      title="Help and legend"
      description="How to read the model and move around it."
      width="max-w-3xl"
    >
      <div className="grid gap-6 md:grid-cols-2">
        <section>
          <Heading first>Two levels</Heading>
          <p className="mb-5 text-xs leading-relaxed text-ink-dim">
            The <span className="text-ink">overview</span> shows the platform as its kinds of
            service, in the four layers a request crosses: entry, identity, compute, data. A piece
            there stands for every service of its kind and says how many; its figures are theirs,
            added up. The two detailed arrangements show every service on its own, by region or by
            dependency tier. Opening a service from a list or from a kind takes you to it there.
          </p>

          <Heading>Camera</Heading>
          <ul className="space-y-1.5 text-xs text-ink-dim">
            <li>
              <span className="text-ink">Drag</span> to orbit
            </li>
            <li>
              <span className="text-ink">Right-drag</span> or{' '}
              <span className="text-ink">two-finger drag</span> to pan
            </li>
            <li>
              <span className="text-ink">Scroll</span> or <span className="text-ink">pinch</span> to
              zoom toward the pointer
            </li>
            <li>
              <span className="text-ink">Click</span> a service or a connection to inspect it
            </li>
            <li>
              <span className="text-ink">Double-click</span> a service to move in on it, or a plate
              to move in on its region
            </li>
            <li>
              <span className="text-ink">Point</span> at a service to see what it is connected to;
              selecting it keeps that neighbourhood in front while the rest recedes
            </li>
            <li>
              Tracing a request, or an incident among every service, takes the camera to its path;
              taking the camera yourself stops that
            </li>
          </ul>

          <Heading>Keyboard</Heading>
          <dl className="space-y-1.5">
            {KEYS.map(([key, description]) => (
              <div key={key} className="flex items-center gap-3 text-xs">
                <dt className="w-[4.5rem] shrink-0">
                  <Key>{key}</Key>
                </dt>
                <dd className="text-ink-dim">{description}</dd>
              </div>
            ))}
          </dl>

          <Heading>State of a service</Heading>
          <p className="mb-2 text-xs leading-relaxed text-ink-dim">
            Colour is an answer. <span style={{ color: COLOR.focus }}>Blue</span> answers you: what
            you selected, the request you are following. The other colours answer the data:
            something is not normal. A service that is well is neutral, and has no mark in any list.
          </p>
          <ul className="space-y-1.5">
            {(['healthy', 'degraded', 'critical', 'down'] as const).map((health) => (
              <li key={health} className="flex items-center gap-2 text-xs text-ink-dim">
                <span className="inline-flex w-3 justify-center">
                  <HealthGlyph health={health} />
                </span>
                <span className="w-16 text-ink">{HEALTH_LABEL[health]}</span>
                {health === 'healthy' && 'Neutral piece, no mark; its part runs evenly'}
                {health === 'degraded' && 'Amber piece and a lamp; its part hesitates'}
                {health === 'critical' && 'Red piece and a lamp; its part is jammed'}
                {health === 'down' && 'Pale piece; its part hangs crooked and still'}
              </li>
            ))}
          </ul>
          <p className="caption mt-2 leading-relaxed">
            In the overview a lamp under a neutral piece means some of that kind are affected, and
            its part hesitates; the piece itself takes the colour, and the manner, when all of them
            are. A red badge with a cross marks where a request was stopped.
          </p>
        </section>

        <section>
          <Heading first>Traffic</Heading>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {TRAFFIC_LEGEND.map(({ key, label, shape, tone }) => (
              <li key={key} className="flex items-center gap-2 text-xs text-ink-dim">
                <Bead shape={shape} color={tone ? TONE[tone] : COLOR.ink} />
                {label}
              </li>
            ))}
          </ul>
          <p className="caption mt-2 leading-relaxed">
            Every bead is a share of the requests on a connection; how many there are follows the
            request rate. Ordinary traffic is told apart by shape. Traffic that went wrong takes a
            colour once it amounts to something: errors above one request in a hundred, rejections
            above one in ten. Below that it keeps its shape and stays ink. Rejected requests stop
            short of their target.
          </p>

          <Heading>Kinds of service</Heading>
          <ul className="space-y-1.5">
            {SERVICE_TYPES.map((type) => (
              <li key={type} className="flex items-baseline gap-2 text-xs">
                <span className="w-32 shrink-0 text-ink">{SERVICE_TYPE[type].label}</span>
                <span className="text-ink-dim">{SHAPES[type]}</span>
              </li>
            ))}
          </ul>
          <p className="caption mt-2 leading-relaxed">
            The part of a piece that moves runs at the pace of its service&apos;s traffic: faster
            under a surge, slower as traffic thins, and still when nothing passes.
          </p>
        </section>
      </div>
      <p className="caption mt-6 border-t border-line pt-3 leading-relaxed">
        AEGIS is a simulation. The platform, its metrics and every incident are synthetic and
        deterministic; no real system is observed, scanned or attacked.
      </p>
    </Dialog>
  );
}
