import { useMemo } from 'react';

import { t } from '@/i18n';
import { cn } from '@/lib/cn';
import { formatMs, formatRate } from '@/lib/format';
import { formatErrorRate } from '@/lib/thresholds';
import { SERVICE_TYPE, TYPE_SOURCE_HINT } from '@/lib/palette';
import { useCapture } from '@/stores/capture';

import { isReport, nodeReadings, typeSourceOf, type Reading } from './capture';
import { ConditionBadge, sampledIn, useMoment } from './present';

/** A figure of the sample at the cursor, or words for one it does not hold. */
function Figure({ value, missing }: { value: string | null; missing: string }) {
  return value === null ? <span className="text-ink-faint">{missing}</span> : <>{value}</>;
}

function missingOf(reading: Reading): string {
  return reading.sample ? t('Not measured') : t('No data');
}

/**
 * An incident capture without 3D: one table per region, in the table
 * view's style, with what the capture says of each service at the cursor.
 * A report has no measurements, so its tables have no columns for them.
 */
export function CaptureTable({ notice }: { notice?: string | null }) {
  const capture = useCapture((state) => state.capture);
  const selection = useCapture((state) => state.selection);
  const moment = useMoment();

  const groups = useMemo(() => {
    if (!capture) return [];
    const readings = nodeReadings(capture, moment);
    return capture.regions
      .map((region) => ({
        region,
        rows: capture.nodes
          .map((node, i) => ({ node, reading: readings[i]! }))
          .filter(({ node }) => node.region === region.id)
          .sort((a, b) => a.node.name.localeCompare(b.node.name)),
      }))
      .filter((group) => group.rows.length > 0);
  }, [capture, moment]);

  if (!capture) return null;
  const measured = !isReport(capture);
  const headings = measured
    ? [t('Service'), t('Kind'), t('State'), t('Requests'), t('Error rate'), t('Latency p95')]
    : [t('Service'), t('Kind'), t('State')];

  return (
    <div className="h-full overflow-y-auto px-4 pb-6 pt-4" data-testid="capture-table">
      {notice && (
        <p role="status" className="panel mb-4 px-3 py-2 text-xs text-ink">
          {notice}
        </p>
      )}
      <div className="mx-auto max-w-5xl space-y-5">
        {groups.map(({ region, rows }) => (
          <table
            key={region.id}
            className="panel w-full border-collapse text-left text-xs"
            data-testid={`capture-table-region-${region.id}`}
          >
            <caption className="px-3 pb-2 pt-3 text-left">
              <span className="text-sm font-bold text-ink">{region.name}</span>
              <span className="ml-2 text-[11px] text-ink-faint">
                {t(rows.length === 1 ? '{n} service' : '{n} services', { n: rows.length })}
              </span>
            </caption>
            <thead>
              <tr className="border-y border-line">
                {headings.map((heading, i) => (
                  <th
                    key={heading}
                    scope="col"
                    className={cn('caption px-3 py-1.5', i >= 3 && 'text-right')}
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ node, reading }) => {
                const selected = selection?.kind === 'node' && selection.id === node.id;
                const missing = missingOf(reading);
                return (
                  <tr
                    key={node.id}
                    aria-selected={selected}
                    className={cn(
                      'border-b border-line last:border-b-0',
                      selected ? 'bg-raised' : 'hover:bg-raised',
                    )}
                  >
                    <th scope="row" className="px-3 py-1.5 font-normal">
                      <button
                        type="button"
                        onClick={() => useCapture.getState().select({ kind: 'node', id: node.id })}
                        className="text-left text-ink hover:underline hover:underline-offset-2"
                        data-testid={`capture-table-service-${node.id}`}
                      >
                        {node.name}
                      </button>
                      {node.note && (
                        <span className="mt-0.5 block max-w-[48ch] text-[11px] leading-snug text-ink-faint">
                          {node.note}
                        </span>
                      )}
                    </th>
                    <td
                      className="px-3 py-1.5 text-ink-dim"
                      title={TYPE_SOURCE_HINT[typeSourceOf(node)]}
                    >
                      {SERVICE_TYPE[node.type].label}
                    </td>
                    <td className="px-3 py-1.5" data-testid={`capture-table-state-${node.id}`}>
                      <ConditionBadge condition={reading.condition} sampled={sampledIn(reading)} />
                    </td>
                    {measured && (
                      <>
                        <td className="numeric px-3 py-1.5 text-right text-ink">
                          <Figure
                            value={
                              reading.requestsPerSecond === null
                                ? null
                                : `${formatRate(reading.requestsPerSecond)}/s`
                            }
                            missing={missing}
                          />
                        </td>
                        <td className="numeric px-3 py-1.5 text-right text-ink">
                          <Figure
                            value={
                              reading.errorRate === null ? null : formatErrorRate(reading.errorRate)
                            }
                            missing={reading.sample?.requests === 0 ? t('No requests') : missing}
                          />
                        </td>
                        <td className="numeric px-3 py-1.5 text-right text-ink">
                          <Figure
                            value={
                              reading.sample?.p95Ms === undefined
                                ? null
                                : formatMs(reading.sample.p95Ms)
                            }
                            missing={missing}
                          />
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        ))}
      </div>
    </div>
  );
}
