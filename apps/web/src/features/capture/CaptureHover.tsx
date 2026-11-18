import { t } from '@/i18n';
import { SERVICE_TYPE } from '@/lib/palette';
import { useCapture } from '@/stores/capture';

import { readingOf } from './capture';
import { ConditionBadge, regionName, sampledIn, useMoment } from './present';

/**
 * The card that follows the pointer over a captured service: what it is,
 * where, and what the capture says of it at the cursor, in words. It is
 * the capture's version of the scene's hover card, filled from the capture
 * and never from the simulation.
 */
export function CaptureHover() {
  const capture = useCapture((state) => state.capture);
  const hovered = useCapture((state) => state.hovered);
  const moment = useMoment();
  const node = capture && hovered ? capture.nodes.find((n) => n.id === hovered) : undefined;
  if (!capture || !node) return null;
  const reading = readingOf(capture, node, moment);
  return (
    <div
      // Keyed by the piece so the card arrives again for each new one.
      key={node.id}
      className="-translate-x-1/2 -translate-y-[calc(100%+22px)]"
      data-testid="capture-hover"
    >
      <div className="panel floating animate-rise whitespace-nowrap px-2.5 py-1.5">
        <p className="text-xs font-bold text-ink">{node.name}</p>
        <p className="caption">
          {t('{kind} in {region}', {
            kind: SERVICE_TYPE[node.type].label,
            region: regionName(capture, node.region),
          })}
        </p>
        <p className="mt-1 text-[11px]">
          <ConditionBadge condition={reading.condition} sampled={sampledIn(reading)} />
        </p>
      </div>
    </div>
  );
}
