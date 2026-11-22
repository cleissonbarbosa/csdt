/**
 * The kinds of service a platform can be built of, to carry onto the table.
 *
 * They are grouped by the layer a request meets them in, the overview's own
 * (`LAYERS` in `lib/overview.ts`), so the palette reads in the order a
 * platform is drawn: what sends requests, what lets them in, what checks
 * who they are, what does the work, what keeps the data. Each kind is told
 * by its name and a glyph, in ink: nothing normal has a hue.
 *
 * A tile is carried with the pointer; pressed with the keyboard (or clicked
 * without moving), it adds its kind one tier past what is selected. While
 * its kind is carried the tile it came from says so, in the viewer's blue.
 *
 * Where the stage has no room for the palette beside the draft's card it is
 * a `rail`: a column of glyphs, each named for the pointer and for the
 * keyboard as a tile is, and the layers apart by a rule.
 */
import type { ServiceType } from '@aegis/contracts';
import {
  Archive,
  AudioWaveform,
  Boxes,
  Container,
  Database,
  DoorOpen,
  Globe,
  Hexagon,
  Lock,
  MemoryStick,
  Rows3,
  Server,
  Split,
  TowerControl,
  TreePine,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import { t } from '@/i18n';
import { LAYERS } from '@/lib/overview';
import { SERVICE_TYPE } from '@/lib/palette';
import { useEditor } from '@/stores/editor';

import { addKind, pressTile } from './interaction';

/** A glyph for each kind, after the working part of its piece. */
export const KIND_GLYPH: Record<ServiceType, LucideIcon> = {
  'external-client': Users,
  'network-gateway': Globe,
  'load-balancer': Split,
  'api-gateway': DoorOpen,
  'auth-service': Lock,
  'cedar-authorizer': TreePine,
  'security-monitor': TowerControl,
  'virtual-machine': Server,
  microservice: Hexagon,
  container: Container,
  'kubernetes-cluster': Boxes,
  serverless: Zap,
  'message-queue': Rows3,
  'event-stream': AudioWaveform,
  database: Database,
  cache: MemoryStick,
  storage: Archive,
};

function Tile({ type, rail }: { type: ServiceType; rail: boolean }) {
  const Glyph = KIND_GLYPH[type];
  const label = SERVICE_TYPE[type].label;
  const carried = useEditor(
    (state) => state.carrying?.kind === 'new' && state.carrying.type === type,
  );
  return (
    <button
      type="button"
      className={`group flex touch-none select-none items-center rounded-control border bg-paper text-left text-xs text-ink transition-[border-color,background-color,scale] duration-150 hover:border-line-strong hover:bg-raised active:scale-[0.98] cursor-grab active:cursor-grabbing ${
        rail ? 'size-10 justify-center' : 'h-9 gap-2 px-2'
      } ${carried ? 'border-focus bg-raised' : 'border-line'}`}
      onPointerDown={(event) => pressTile(event.nativeEvent, event.currentTarget, type)}
      onClick={(event) => {
        // A pointer's click was a press, already dealt with; this is the keyboard's.
        if (event.detail === 0) addKind(type);
      }}
      aria-label={t('Add: {kind}', { kind: label })}
      title={
        rail
          ? t('{kind}: drag onto the table, or press to add one after the selection', {
              kind: label,
            })
          : t('Drag onto the table, or press to add one after the selection')
      }
      data-testid={`palette-${type}`}
      data-carried={carried || undefined}
    >
      <Glyph
        size={rail ? 17 : 15}
        strokeWidth={1.6}
        aria-hidden
        className={`shrink-0 group-hover:text-ink ${carried ? 'text-focus' : 'text-ink-dim'}`}
      />
      {!rail && <span className="min-w-0 truncate">{label}</span>}
    </button>
  );
}

export function Palette({ rail = false }: { rail?: boolean }) {
  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto"
      data-testid="editor-palette"
      data-rail={rail || undefined}
    >
      {!rail && (
        <p className="border-b border-line px-3 py-2.5 text-[11px] leading-snug text-ink-dim">
          {t(
            'Drag a piece onto the table: its lane is its region, its column how far along the path it stands. Carry a piece onto another to connect them.',
          )}
        </p>
      )}
      {LAYERS.map((layer) => (
        <section
          key={layer.id}
          className={`border-b border-line last:border-b-0 ${rail ? 'px-2.5 py-2' : 'px-3 py-2.5'}`}
          aria-label={rail ? layer.name : undefined}
        >
          {!rail && <h3 className="mb-2 text-xs font-bold text-ink">{layer.name}</h3>}
          <div className={rail ? 'grid grid-cols-1 gap-1.5' : 'grid grid-cols-2 gap-1.5'}>
            {layer.columns.flat().map((type) => (
              <Tile key={type} type={type} rail={rail} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
