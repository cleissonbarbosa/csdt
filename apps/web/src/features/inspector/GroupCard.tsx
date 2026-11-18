import {
  HEALTH_BY_CODE,
  type Health,
  type TelemetrySnapshot,
  type Topology,
} from '@aegis/contracts';
import { X } from 'lucide-react';
import { useMemo } from 'react';

import { HealthGlyph, HealthMark } from '@/components/ui/Badge';
import { IconButton } from '@/components/ui/Button';
import { Fold, Section, Stat } from '@/components/ui/Section';
import { RangeBar, Sparkline } from '@/components/ui/Sparkline';
import { t } from '@/i18n';
import { formatMs, formatPercent, formatRate } from '@/lib/format';
import { LAYERS, overviewOf, projectSnapshot } from '@/lib/overview';
import { COLOR, HEALTH_COLOR, SERVICE_TYPE } from '@/lib/palette';
import { NODE_HISTORY, useTelemetry, type NodeSeries } from '@/stores/telemetry';
import { useUi } from '@/stores/ui';

/** Colour for a value that is fine below `warn` and alarming above `alarm`. */
function grade(value: number, warn: number, alarm: number): string | undefined {
  if (value >= alarm) return COLOR.critical;
  if (value >= warn) return COLOR.warning;
  return undefined;
}

/**
 * The last minute and a half of a kind of service, from its members': their
 * throughput added up, their latency and error rate averaged by the traffic
 * that saw them.
 */
function groupSeries(series: readonly NodeSeries[], members: readonly number[], length: number) {
  const throughput = new Float32Array(NODE_HISTORY);
  const latency = new Float32Array(NODE_HISTORY);
  const error = new Float32Array(NODE_HISTORY);
  for (let t = 0; t < length; t++) {
    let rate = 0;
    let slow = 0;
    let failed = 0;
    let plainSlow = 0;
    let plainFailed = 0;
    let counted = 0;
    for (const i of members) {
      const one = series[i];
      if (!one) continue;
      const r = one.throughput[t] ?? 0;
      rate += r;
      slow += (one.latency[t] ?? 0) * r;
      failed += (one.error[t] ?? 0) * r;
      plainSlow += one.latency[t] ?? 0;
      plainFailed += one.error[t] ?? 0;
      counted++;
    }
    throughput[t] = rate;
    latency[t] = rate > 0 ? slow / rate : counted > 0 ? plainSlow / counted : 0;
    error[t] = rate > 0 ? failed / rate : counted > 0 ? plainFailed / counted : 0;
  }
  return { throughput, latency, error };
}

/**
 * What the overview has to say about one of its pieces: a kind of service,
 * taken together. The first question is how the kind is doing, so its
 * signals come first, each against its normal range. Who it is made of and
 * what it talks to are folded below, and each instance is a way into the
 * detailed arrangement where it stands on its own.
 */
export function GroupCard({
  topology,
  snapshot,
  id,
}: {
  topology: Topology;
  snapshot: TelemetrySnapshot | null;
  id: string;
}) {
  const overview = overviewOf(topology);
  const g = overview.groupIndex.get(id);
  const history = useTelemetry((state) => state.nodeHistory);
  const historyVersion = useTelemetry((state) => state.nodeHistoryVersion);
  const view = useMemo(
    () => (snapshot ? projectSnapshot(overview, snapshot) : null),
    [overview, snapshot],
  );
  const members = g === undefined ? undefined : overview.members[g];
  const series = useMemo(
    () => (members ? groupSeries(history.series, members, history.length) : null),
    // The rings are mutated in place; the version says when.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [history, members, historyVersion],
  );
  if (g === undefined || !members) return null;
  const node = overview.topology.nodes[g]!;
  const type = SERVICE_TYPE[node.serviceType];
  const layer = LAYERS.find((entry) => entry.id === node.region);
  const single = members.length === 1;

  const throughput = view?.nodes.throughputRps[g] ?? node.metrics.throughputRps;
  const latency = view?.nodes.latencyMs[g] ?? node.metrics.latencyMs;
  const errorRate = view?.nodes.errorRate[g] ?? node.metrics.errorRate;
  const saturation = view?.nodes.saturation[g] ?? node.metrics.saturation;
  const worst: Health = HEALTH_BY_CODE[view?.nodes.health[g] ?? 0] ?? 'healthy';
  const healthOf = (i: number): Health =>
    HEALTH_BY_CODE[snapshot?.nodes.health[i] ?? 0] ?? topology.nodes[i]!.metrics.health;
  const unwell = members.filter((i) => healthOf(i) !== 'healthy').length;

  const baselineRps = node.metrics.throughputRps;
  const baselineLatency = Math.max(0.1, node.baselineLatencyMs);
  const latencyTone = grade(latency / baselineLatency, 2.5, 6);
  const errorTone = grade(errorRate, 0.04, 0.2);
  const saturationTone = grade(saturation, 0.88, 1);

  const regionName = new Map(topology.regions.map((region) => [region.id, region.name]));
  const select = (group: string) => useUi.getState().select({ kind: 'group', id: group });
  const peers = (outgoing: boolean) =>
    overview.topology.edges
      .map((edge, k) => ({ edge, k }))
      .filter(({ edge }) => (outgoing ? edge.source : edge.target) === id)
      .map(({ edge, k }) => {
        const peerId = outgoing ? edge.target : edge.source;
        const peer = overview.topology.nodes[overview.groupIndex.get(peerId) ?? -1];
        return {
          id: peerId,
          name: peer?.name ?? peerId,
          rps: view?.edges.trafficRps[k] ?? edge.metrics.trafficRps,
        };
      });
  const calls = peers(true);
  const calledBy = peers(false);
  const peerList = (list: typeof calls) => (
    <ul className="-mx-1.5">
      {list.map((peer) => (
        <li key={peer.id}>
          <button
            type="button"
            onClick={() => select(peer.id)}
            onMouseEnter={() => useUi.getState().setHovered(peer.id)}
            onMouseLeave={() => useUi.getState().setHovered(null)}
            className="flex w-full items-baseline gap-2 rounded-control px-1.5 py-1 text-left hover:bg-raised"
          >
            <span className="min-w-0 flex-1 truncate text-xs text-ink">{peer.name}</span>
            <span className="numeric shrink-0 text-[11px] text-ink-faint">
              {formatRate(peer.rps)}/s
            </span>
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="cascade" data-testid="group-card" data-group-id={id}>
      <header className="border-b border-line px-3 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold text-ink" data-testid="inspector-title">
              {node.name}
            </h2>
            <p className="caption mt-0.5">
              {single
                ? t('{kind} in the {layer} layer', {
                    kind: type.label,
                    layer: layer?.name.toLowerCase() ?? '',
                  })
                : t('{n} {kinds} in the {layer} layer', {
                    n: members.length,
                    kinds: type.plural,
                    layer: layer?.name.toLowerCase() ?? '',
                  })}
            </p>
          </div>
          <IconButton label={t('Clear selection')} onClick={() => useUi.getState().select(null)}>
            <X size={15} />
          </IconButton>
        </div>
        {/* Normal is silent: the state is spelled out only when it is not. */}
        {unwell > 0 && (
          <p
            className="mt-2 flex items-center gap-1.5 text-[11px] font-bold"
            style={{ color: HEALTH_COLOR[worst] }}
            data-testid="group-state"
          >
            <HealthGlyph health={worst} />
            {single
              ? t('Not normal')
              : t('{unwell} of {total} not normal', { unwell, total: members.length })}
          </p>
        )}
      </header>

      <Section title={t('Signals')}>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3" data-testid="inspector-metrics">
          <div>
            <Stat label={t('Throughput')} value={formatRate(throughput)} unit="req/s" />
            {series && (
              <Sparkline
                values={series.throughput}
                length={history.length}
                normal={baselineRps > 0 ? [baselineRps * 0.5, baselineRps * 1.5] : undefined}
                label={t('Throughput over the last 90 seconds')}
                width={132}
              />
            )}
          </div>
          <div>
            <Stat label={t('Latency')} value={formatMs(latency)} tone={latencyTone} />
            {series && (
              <Sparkline
                values={series.latency}
                length={history.length}
                color={latencyTone}
                normal={[0, baselineLatency * 2.5]}
                label={t('Latency over the last 90 seconds')}
                width={132}
              />
            )}
          </div>
          <div>
            <Stat label={t('Error rate')} value={formatPercent(errorRate)} tone={errorTone} />
            {series && (
              <Sparkline
                values={series.error}
                length={history.length}
                color={errorTone}
                max={Math.max(0.1, errorRate * 1.3)}
                normal={[0, 0.04]}
                label={t('Error rate over the last 90 seconds')}
                width={132}
              />
            )}
          </div>
          <div>
            <Stat
              label={single ? t('Saturation') : t('Fullest instance')}
              value={node.capacityRps > 0 ? formatPercent(saturation) : t('n/a')}
              tone={saturationTone}
            />
            {node.capacityRps > 0 && (
              <RangeBar
                value={saturation}
                max={1.2}
                normal={[0, 0.88]}
                tone={saturationTone}
                className="mb-2 mt-2.5 w-[132px]"
              />
            )}
          </div>
        </dl>
        <p className="caption mt-2.5">
          {t(
            single
              ? 'Last {seconds} s; the grey band is the normal range.'
              : 'All of them together, last {seconds} s; the grey band is the normal range.',
            { seconds: NODE_HISTORY },
          )}
        </p>
      </Section>

      {node.serviceType === 'cedar-authorizer' && snapshot && (
        <Section title={t('Authorization')}>
          <dl className="grid grid-cols-2 gap-x-4" data-testid="group-authorization">
            <Stat
              label={t('Checks')}
              value={formatRate(snapshot.global.authzChecksRps)}
              unit={t('per s')}
            />
            <Stat
              label={t('Denied')}
              value={formatPercent(snapshot.global.authzDenialRate)}
              tone={grade(snapshot.global.authzDenialRate, 0.15, 0.3)}
            />
          </dl>
        </Section>
      )}

      <Fold
        title={single ? t('The service') : t('Instances')}
        count={single ? undefined : members.length}
        open={members.length <= 5}
        testId="group-members"
      >
        <ul className="-mx-1.5">
          {members.map((i) => {
            const member = topology.nodes[i]!;
            const health = healthOf(i);
            return (
              <li key={member.id}>
                <button
                  type="button"
                  onClick={() => useUi.getState().selectNode(member.id)}
                  title={t('Open this service where it stands')}
                  data-testid={`member-${member.id}`}
                  className="flex w-full items-center gap-2 rounded-control px-1.5 py-1 text-left hover:bg-raised"
                >
                  <HealthMark health={health} />
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate text-xs text-ink ${health === 'healthy' ? '' : 'font-bold'}`}
                    >
                      {member.name}
                    </span>
                    <span className="caption block truncate">
                      {regionName.get(member.region) ?? member.region}
                    </span>
                  </span>
                  <span className="numeric shrink-0 text-[11px] text-ink-faint">
                    {formatRate(snapshot?.nodes.throughputRps[i] ?? member.metrics.throughputRps)}/s
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Fold>
      {calls.length > 0 && (
        <Fold title={t('Calls')} count={calls.length} open={calls.length <= 3}>
          {peerList(calls)}
        </Fold>
      )}
      {calledBy.length > 0 && (
        <Fold title={t('Called by')} count={calledBy.length} open={calledBy.length <= 3}>
          {peerList(calledBy)}
        </Fold>
      )}
    </div>
  );
}
