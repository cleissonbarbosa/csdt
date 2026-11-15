import { SERVICE_TYPES } from '@aegis/contracts';

import { Dialog } from '@/components/ui/Dialog';
import {
  HEALTH_COLOR,
  HEALTH_LABEL,
  SERVICE_TYPE,
  TRAFFIC_COLOR,
  TRAFFIC_LEGEND,
} from '@/lib/palette';
import { useUi } from '@/stores/ui';

const SHAPES: Record<(typeof SERVICE_TYPES)[number], string> = {
  'api-gateway': 'An upright ring: a portal requests pass through',
  'auth-service': 'A shield with a keyhole',
  'cedar-authorizer': 'A stylised cedar tree',
  microservice: 'A hexagonal cell with a lifted lid',
  container: 'A crate in a luminous frame',
  serverless: 'A bolt inside a ring',
  'message-queue': 'Slabs lined up on rails',
  database: 'A stack of platters',
  storage: 'A lattice of blocks around a lit core',
  'network-gateway': 'A faceted globe with orbits',
  'security-monitor': 'A crystal eye with a scanning halo',
  'external-client': 'A pawn',
};

const KEYS: [string, string][] = [
  ['Space', 'Play or pause the simulation'],
  ['R', 'Reset the camera'],
  ['F', 'Focus the selected service'],
  ['Esc', 'Clear the selection or close a dialog'],
  ['/', 'Search services'],
  ['L', 'Switch layout: regions or dependencies'],
  ['T', 'Switch between the 3D view and the table'],
  ['P', 'Toggle the performance overlay'],
  ['?', 'Open this help'],
  ['← / →', 'On the timeline: step 5 s (hold Shift for 30 s)'],
];

function Key({ children }: { children: string }) {
  return (
    <kbd className="numeric inline-flex h-5 min-w-5 items-center justify-center rounded-[3px] border border-line-bright bg-abyss px-1.5 text-[10px] text-ink">
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
      description="How to read the scene and move around it."
      width="max-w-3xl"
    >
      <div className="grid gap-6 md:grid-cols-2">
        <section>
          <h3 className="eyebrow mb-2">Camera</h3>
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
              <span className="text-ink">Double-click</span> a service to focus the camera on it
            </li>
          </ul>

          <h3 className="eyebrow mb-2 mt-5">Keyboard</h3>
          <dl className="space-y-1.5">
            {KEYS.map(([key, description]) => (
              <div key={key} className="flex items-center gap-3 text-xs">
                <dt className="w-16 shrink-0">
                  <Key>{key}</Key>
                </dt>
                <dd className="text-ink-dim">{description}</dd>
              </div>
            ))}
          </dl>

          <h3 className="eyebrow mb-2 mt-5">Health</h3>
          <ul className="space-y-1.5">
            {(['healthy', 'degraded', 'critical', 'down'] as const).map((health) => (
              <li key={health} className="flex items-center gap-2 text-xs text-ink-dim">
                <span
                  aria-hidden
                  className="size-2 rounded-full"
                  style={{ backgroundColor: HEALTH_COLOR[health] }}
                />
                <span className="w-16 text-ink">{HEALTH_LABEL[health]}</span>
                {health === 'healthy' && 'Wears its service-type colour'}
                {health === 'degraded' && 'Amber, slow pulse'}
                {health === 'critical' && 'Red, fast pulse, shockwave on transition'}
                {health === 'down' && 'Dark and still'}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className="eyebrow mb-2">Traffic particles</h3>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {TRAFFIC_LEGEND.map(({ key, label }) => (
              <li key={key} className="flex items-center gap-2 text-xs text-ink-dim">
                <span
                  aria-hidden
                  className="size-2 rounded-full"
                  style={{
                    backgroundColor: TRAFFIC_COLOR[key],
                    boxShadow: `0 0 8px ${TRAFFIC_COLOR[key]}`,
                  }}
                />
                {label}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
            Density follows request rate. Responses travel back toward the caller. Rejected requests
            stop short of their target and flare.
          </p>

          <h3 className="eyebrow mb-2 mt-5">Service shapes</h3>
          <ul className="space-y-1.5">
            {SERVICE_TYPES.map((type) => (
              <li key={type} className="flex items-baseline gap-2 text-xs">
                <span
                  aria-hidden
                  className="size-2 shrink-0 translate-y-px rounded-full"
                  style={{ backgroundColor: SERVICE_TYPE[type].color }}
                />
                <span className="w-32 shrink-0 text-ink">{SERVICE_TYPE[type].label}</span>
                <span className="text-ink-dim">{SHAPES[type]}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <p className="mt-6 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-faint">
        AEGIS is a simulation. The platform, its metrics and every incident are synthetic and
        deterministic; no real system is observed, scanned or attacked.
      </p>
    </Dialog>
  );
}
