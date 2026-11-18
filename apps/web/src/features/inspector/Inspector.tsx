import {
  SECURITY_STATUS_BY_CODE,
  type DataSource,
  type Health,
  type SecurityEvent,
  type SecurityStatus,
  type Severity,
  type TelemetrySnapshot,
  type Topology,
} from '@aegis/contracts';
import { ArrowRight, Crosshair, X } from 'lucide-react';
import { useMemo } from 'react';

import { useThrottledSnapshot } from '@/app/hooks';
import { showRegion } from '@/app/navigate';
import { DecisionTag, HealthBadge, HealthGlyph, HealthMark } from '@/components/ui/Badge';
import { IconButton } from '@/components/ui/Button';
import { EmptyState, Fold, Section, Stat } from '@/components/ui/Section';
import { ServiceName } from '@/components/ui/ServiceName';
import { RangeBar, Sparkline } from '@/components/ui/Sparkline';
import { Hud } from '@/features/hud/Hud';
import { askedByViewer, foldEvents } from '@/features/scenarios/events';
import { sceneHandle } from '@/graphics/handle';
import { t } from '@/i18n';
import { tr } from '@/i18n/rich';
import { entityId, formatClock, formatMs, formatPercent, formatRate } from '@/lib/format';
import { nodeLabel } from '@/lib/names';
import {
  COLOR,
  RELATIONSHIP_LABEL,
  SECURITY_COLOR,
  SECURITY_LABEL,
  SERVICE_TYPE,
  SEVERITY_LABEL,
} from '@/lib/palette';
import {
  liveEdge,
  liveNode,
  NODE_HISTORY,
  useTelemetry,
  type TopologyIndex,
} from '@/stores/telemetry';
import { useUi, type Selection } from '@/stores/ui';

import { Exposure } from './Exposure';
import { Faults } from './Faults';
import { GroupCard } from './GroupCard';

/** How long an alert stays under "Needs attention", in virtual time. */
const ALERT_WINDOW_MS = 90_000;

/** Where a service's figures come from, said as a whole phrase in every language. */
const SOURCE_LABEL: Record<DataSource, string> = {
  synthetic: t('Synthetic data'),
  recording: t('Capture data'),
  live: t('Live data'),
};

const SEVERITY_GLYPH: Record<Severity, Health> = {
  info: 'healthy',
  notice: 'healthy',
  warning: 'degraded',
  critical: 'critical',
};

function EventRow({ event }: { event: SecurityEvent }) {
  const loud = event.severity === 'warning' || event.severity === 'critical';
  return (
    <li>
      <button
        type="button"
        onClick={() => useUi.getState().inspectEvent(event.seq)}
        className="grid w-full grid-cols-[0.75rem_1fr_auto] items-baseline gap-x-1.5 rounded-control px-1.5 py-1 text-left hover:bg-raised"
      >
        <span className="self-center">
          <HealthGlyph health={SEVERITY_GLYPH[event.severity]} size={8} />
        </span>
        <span className={`min-w-0 truncate text-xs text-ink ${loud ? 'font-bold' : ''}`}>
          {event.title}
          <span className="sr-only">
            {t(', severity {severity}', { severity: SEVERITY_LABEL[event.severity] })}
          </span>
        </span>
        <span className="numeric text-[11px] text-ink-faint">
          {formatClock(event.virtualTimeMs)}
        </span>
      </button>
    </li>
  );
}

/** A connection that is being throttled, denied or abused says so; others stay quiet. */
function SecurityMark({ status }: { status: SecurityStatus }) {
  const quiet = status === 'secure' || status === 'authorized';
  return (
    <span
      className="inline-flex w-[9px] shrink-0 justify-center"
      title={quiet ? undefined : SECURITY_LABEL[status]}
      style={{ color: SECURITY_COLOR[status] }}
    >
      {!quiet && (
        <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden>
          <path d="M5 0.8 9.6 9.2H0.4Z" fill="currentColor" />
        </svg>
      )}
      <span className="sr-only">{SECURITY_LABEL[status]}</span>
    </span>
  );
}

/** Colour for a value that is fine below `warn` and alarming above `alarm`. */
function grade(value: number, warn: number, alarm: number): string | undefined {
  if (value >= alarm) return COLOR.critical;
  if (value >= warn) return COLOR.warning;
  return undefined;
}

interface DecisionDetails {
  decision?: string;
  request?: { principal?: string; action?: string; resource?: string };
  determiningPolicies?: string[];
}

function decisionOf(event: SecurityEvent): DecisionDetails | null {
  if (event.kind !== 'authz-decision' || typeof event.details !== 'object' || !event.details)
    return null;
  const details = event.details as { decision?: unknown } & DecisionDetails;
  // Decisions made in the explorer nest the full record under `decision`.
  if (typeof details.decision === 'object' && details.decision !== null) {
    return details.decision as DecisionDetails;
  }
  return details;
}

function NodeInspector({
  topology,
  index,
  snapshot,
  nodeIndex,
}: {
  topology: Topology;
  index: TopologyIndex;
  snapshot: TelemetrySnapshot | null;
  nodeIndex: number;
}) {
  const live = liveNode(topology, snapshot, nodeIndex);
  const history = useTelemetry((state) => state.nodeHistory);
  useTelemetry((state) => state.nodeHistoryVersion);
  const events = useTelemetry((state) => state.events);
  const cursor = snapshot?.virtualTimeMs ?? Infinity;

  const nodeEvents = useMemo(() => {
    const id = topology.nodes[nodeIndex]?.id;
    if (!id) return [];
    const matching: SecurityEvent[] = [];
    for (let i = events.length - 1; i >= 0 && matching.length < 40; i--) {
      const event = events[i]!;
      if (event.virtualTimeMs <= cursor && event.nodeIds.includes(id)) matching.push(event);
    }
    return matching;
  }, [events, topology, nodeIndex, cursor]);

  if (!live) return null;
  const { node } = live;
  const series = history.series[nodeIndex];
  const type = SERVICE_TYPE[node.serviceType];
  const region = topology.regions.find((r) => r.id === node.region);
  const decisions = nodeEvents.filter((event) => event.kind === 'authz-decision').slice(0, 6);
  const other = nodeEvents.filter((event) => event.kind !== 'authz-decision').slice(0, 8);
  const outgoing = index.outgoing[nodeIndex] ?? [];
  const incoming = index.incoming[nodeIndex] ?? [];
  const errorTone = grade(live.errorRate, 0.04, 0.2);
  const baselineLatency = Math.max(0.1, node.baselineLatencyMs);
  const latencyTone = grade(live.latencyMs / baselineLatency, 2.5, 6);
  const saturationTone = grade(live.saturation, 0.88, 1);
  const baselineRps = node.metrics.throughputRps;

  const connection = (edgeIndex: number, outgoing: boolean) => {
    const edge = liveEdge(topology, snapshot, edgeIndex);
    if (!edge) return null;
    const peerId = outgoing ? edge.edge.target : edge.edge.source;
    const status = SECURITY_STATUS_BY_CODE[edge.securityCode] ?? 'secure';
    return (
      <li key={edge.edge.id} className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => useUi.getState().selectNode(peerId)}
          onMouseEnter={() => useUi.getState().setHovered(peerId)}
          onMouseLeave={() => useUi.getState().setHovered(null)}
          // How the two are related is one hover away, and in full when the
          // connection itself is inspected.
          title={`${RELATIONSHIP_LABEL[edge.edge.relationship]}, ${edge.edge.protocol.toUpperCase()}${edge.edge.crossRegion ? t(', cross-region') : ''}`}
          className="flex min-w-0 flex-1 items-baseline gap-2 rounded-control px-1.5 py-1 text-left hover:bg-raised"
        >
          <SecurityMark status={status} />
          {/* Several services share a name across regions; in a list of
              them the region is what tells one from another. */}
          <span className="min-w-0 flex-1 truncate text-xs text-ink">
            <ServiceName topology={topology} id={peerId} />
            <span className="sr-only">
              , {RELATIONSHIP_LABEL[edge.edge.relationship]}, {edge.edge.protocol.toUpperCase()}
            </span>
          </span>
          {edge.errorRate >= 0.01 && (
            <span
              className="numeric shrink-0 text-[11px] font-bold"
              style={{ color: COLOR.critical }}
            >
              {t('{percent} errors', { percent: formatPercent(edge.errorRate) })}
            </span>
          )}
          <span className="numeric shrink-0 text-[11px] text-ink-faint">
            {formatRate(edge.trafficRps)}/s
          </span>
        </button>
        <IconButton
          label={t('Inspect connection to {service}', { service: nodeLabel(topology, peerId) })}
          size="sm"
          onClick={() => useUi.getState().select({ kind: 'edge', id: edge.edge.id })}
        >
          <ArrowRight size={13} />
        </IconButton>
      </li>
    );
  };

  return (
    <div className="cascade" data-testid="node-inspector" data-node-id={node.id}>
      <header className="border-b border-line px-3 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold text-ink" data-testid="inspector-title">
              {node.name}
            </h2>
            <p className="caption mt-0.5 truncate">
              {t('{kind} in {region}', { kind: type.label, region: region?.name ?? node.region })}
            </p>
          </div>
          <div className="flex shrink-0 gap-0.5">
            <IconButton
              label={t('Focus camera on this service')}
              onClick={() => sceneHandle.current?.focusNode(node.id)}
            >
              <Crosshair size={15} />
            </IconButton>
            <IconButton label={t('Clear selection')} onClick={() => useUi.getState().select(null)}>
              <X size={15} />
            </IconButton>
          </div>
        </div>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <HealthBadge health={live.health} />
          <span className="caption">{SOURCE_LABEL[node.dataSource]}</span>
          <span className="code caption truncate">{node.id}</span>
        </p>
        {node.description && (
          <p className="mt-2 text-xs leading-relaxed text-ink-dim">{node.description}</p>
        )}
      </header>

      <Section title={t('Signals')}>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3" data-testid="inspector-metrics">
          <div>
            <Stat label={t('Throughput')} value={formatRate(live.throughputRps)} unit="req/s" />
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
            <Stat label={t('Latency')} value={formatMs(live.latencyMs)} tone={latencyTone} />
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
            <Stat label={t('Error rate')} value={formatPercent(live.errorRate)} tone={errorTone} />
            {series && (
              <Sparkline
                values={series.error}
                length={history.length}
                color={errorTone}
                max={Math.max(0.1, live.errorRate * 1.3)}
                normal={[0, 0.04]}
                label={t('Error rate over the last 90 seconds')}
                width={132}
              />
            )}
          </div>
          <div>
            <Stat
              label={t('Saturation')}
              value={node.capacityRps > 0 ? formatPercent(live.saturation) : t('n/a')}
              tone={saturationTone}
            />
            {node.capacityRps > 0 && (
              <RangeBar
                value={live.saturation}
                max={1.2}
                normal={[0, 0.88]}
                tone={saturationTone}
                className="mb-2 mt-2.5 w-[132px]"
              />
            )}
            <p className="caption">
              {node.serviceType === 'message-queue'
                ? t('Backlog {n} messages', { n: formatRate(live.queueDepth) })
                : node.capacityRps > 0
                  ? t('Capacity {n} req/s', { n: formatRate(node.capacityRps) })
                  : t('No capacity limit')}
            </p>
          </div>
        </dl>
        <p className="caption mt-2.5">
          {tr(
            'Last {seconds} s; the grey band is the normal range. Baseline latency <n>{latency}</n>.',
            {
              seconds: NODE_HISTORY,
              latency: formatMs(node.baselineLatencyMs),
              n: (children) => <span className="numeric">{children}</span>,
            },
          )}
        </p>
      </Section>

      {/* What it depends on and what depends on it: a short list is shown,
          a long one waits to be asked for. */}
      <Fold
        title={t('Calls')}
        count={outgoing.length}
        open={outgoing.length <= 3}
        testId="node-calls"
      >
        {outgoing.length > 0 ? (
          <ul className="-mx-1.5">{outgoing.map((e) => connection(e, true))}</ul>
        ) : (
          <p className="text-xs text-ink-faint">{t('This service calls nothing.')}</p>
        )}
      </Fold>
      <Fold
        title={t('Called by')}
        count={incoming.length}
        open={incoming.length <= 3}
        testId="node-callers"
      >
        {incoming.length > 0 ? (
          <ul className="-mx-1.5">{incoming.map((e) => connection(e, false))}</ul>
        ) : (
          <p className="text-xs text-ink-faint">{t('Nothing calls this service.')}</p>
        )}
      </Fold>
      <Exposure topology={topology} nodeId={topology.nodes[nodeIndex]!.id} />
      <Faults topology={topology} snapshot={snapshot} position={{ node: nodeIndex }} />

      {decisions.length > 0 && (
        <Section title={t('Authorization decisions')}>
          <ul className="space-y-1" data-testid="inspector-decisions">
            {decisions.map((event) => {
              const decision = decisionOf(event);
              const denied = decision?.decision === 'deny';
              return (
                <li key={event.seq}>
                  <button
                    type="button"
                    onClick={() => useUi.getState().inspectEvent(event.seq)}
                    className="w-full rounded-control px-1.5 py-1 text-left hover:bg-raised"
                  >
                    <span className="flex items-center gap-2">
                      <DecisionTag decision={denied ? 'deny' : 'allow'} />
                      <span className="min-w-0 flex-1 truncate text-xs text-ink">
                        {entityId(decision?.request?.principal ?? '')} →{' '}
                        {entityId(decision?.request?.action ?? '')}
                      </span>
                      <span className="numeric text-[11px] text-ink-faint">
                        {formatClock(event.virtualTimeMs)}
                      </span>
                    </span>
                    {decision?.determiningPolicies && decision.determiningPolicies.length > 0 && (
                      <span className="numeric mt-0.5 block truncate text-[11px] text-ink-faint">
                        {decision.determiningPolicies.join(', ')}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {other.length > 0 && (
        <Fold title={t('Events')} count={other.length} open={other.length <= 3}>
          <ul className="-mx-1.5" data-testid="inspector-events">
            {other.map((event) => (
              <EventRow key={event.seq} event={event} />
            ))}
          </ul>
        </Fold>
      )}
    </div>
  );
}

function EdgeInspector({
  topology,
  snapshot,
  edgeIndex,
}: {
  topology: Topology;
  snapshot: TelemetrySnapshot | null;
  edgeIndex: number;
}) {
  const live = liveEdge(topology, snapshot, edgeIndex);
  if (!live) return null;
  const { edge } = live;
  const status = SECURITY_STATUS_BY_CODE[live.securityCode] ?? 'secure';
  const endpoint = (label: string, id: string) => (
    <button
      type="button"
      onClick={() => useUi.getState().selectNode(id)}
      className="min-w-0 flex-1 rounded-control border border-line px-2 py-1.5 text-left hover:border-line-strong hover:bg-raised"
    >
      <span className="caption block">{label}</span>
      <span className="block truncate text-xs text-ink">
        <ServiceName topology={topology} id={id} />
      </span>
    </button>
  );
  return (
    <div className="cascade" data-testid="edge-inspector">
      <header className="border-b border-line px-3 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-ink">
              {RELATIONSHIP_LABEL[edge.relationship]}
            </h2>
            <p className="caption mt-0.5">
              {t(
                edge.crossRegion
                  ? 'Connection over {protocol}, between regions'
                  : 'Connection over {protocol}',
                { protocol: edge.protocol.toUpperCase() },
              )}
            </p>
          </div>
          <IconButton label={t('Clear selection')} onClick={() => useUi.getState().select(null)}>
            <X size={15} />
          </IconButton>
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          {endpoint(t('From'), edge.source)}
          <ArrowRight size={14} aria-hidden className="shrink-0 text-ink-faint" />
          {endpoint(t('To'), edge.target)}
        </div>
        <p
          className="mt-2 flex items-center gap-1.5 text-[11px]"
          style={{ color: SECURITY_COLOR[status] }}
        >
          <SecurityMark status={status} />
          <span className={status === 'secure' || status === 'authorized' ? '' : 'font-bold'}>
            {SECURITY_LABEL[status]}
          </span>
        </p>
      </header>
      <Section title={t('Traffic')}>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-3">
          <Stat label={t('Traffic')} value={formatRate(live.trafficRps)} unit="req/s" />
          <Stat label={t('Network latency')} value={formatMs(live.latencyMs)} />
          <Stat
            label={t('Error rate')}
            value={formatPercent(live.errorRate)}
            tone={live.errorRate >= 0.04 ? COLOR.critical : undefined}
          />
          <Stat
            label={t('Rejected')}
            value={formatRate(live.rejectedRps)}
            unit="req/s"
            tone={live.rejectedRps > live.trafficRps * 0.25 ? COLOR.warning : undefined}
          />
          <Stat
            label={t('Suspicious')}
            value={formatRate(live.suspiciousRps)}
            unit="req/s"
            tone={live.suspiciousRps > 0 ? COLOR.hostile : undefined}
          />
          <Stat label={t('Calls per request')} value={edge.weight.toFixed(2)} />
        </dl>
      </Section>
      <Faults topology={topology} snapshot={snapshot} position={{ edge: edgeIndex }} />
    </div>
  );
}

function Overview({
  topology,
  snapshot,
}: {
  topology: Topology;
  snapshot: TelemetrySnapshot | null;
}) {
  const events = useTelemetry((state) => state.events);
  const cursor = snapshot?.virtualTimeMs ?? Infinity;
  // What needs attention is what went wrong lately, not everything that ever
  // did: alerts older than a minute and a half have had their moment. A
  // request the viewer had Cedar deny in the tracer is not one of them: it
  // was listed here as a warning beside a bar that said "all normal".
  const alerts = useMemo(() => {
    const recent: SecurityEvent[] = [];
    for (let i = events.length - 1; i >= 0 && recent.length < 60; i--) {
      const event = events[i]!;
      if (event.virtualTimeMs > cursor) continue;
      if (cursor - event.virtualTimeMs > ALERT_WINDOW_MS) break;
      const loud = event.severity === 'warning' || event.severity === 'critical';
      if (loud && !askedByViewer(event)) recent.push(event);
    }
    return foldEvents(recent).slice(0, 8);
  }, [events, cursor]);
  const global = snapshot?.global;
  return (
    <div className="cascade" data-testid="overview">
      <header className="border-b border-line px-3 py-3">
        <div className="flex items-start justify-between gap-2">
          <h2 className="min-w-0 text-base font-bold text-ink">{topology.name}</h2>
          <IconButton
            label={t('Close the overview')}
            onClick={() => useUi.getState().setInspectorOpen(false)}
          >
            <X size={15} />
          </IconButton>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-ink-dim">{topology.description}</p>
      </header>
      <Section title={t('Signals')}>
        <Hud />
      </Section>
      <Section title={t('Needs attention')}>
        {alerts.length > 0 ? (
          <ul className="-mx-1.5">
            {alerts.map((entry) =>
              entry.kind === 'event' ? (
                <EventRow key={entry.event.seq} event={entry.event} />
              ) : (
                <li key={`run-${entry.key}`}>
                  <button
                    type="button"
                    onClick={() => useUi.getState().setLeftTab('incidents')}
                    title={t('Show these events')}
                    className="grid w-full grid-cols-[0.75rem_1fr_auto] items-baseline gap-x-1.5 rounded-control px-1.5 py-1 text-left hover:bg-raised"
                  >
                    <span className="self-center">
                      <HealthGlyph health={SEVERITY_GLYPH[entry.severity]} size={8} />
                    </span>
                    <span className="min-w-0 truncate text-xs text-ink">
                      {t('{n} services changed state', { n: entry.events.length })}
                    </span>
                    <span className="numeric text-[11px] text-ink-faint">
                      {formatClock(entry.events[0]!.virtualTimeMs)}
                    </span>
                  </button>
                </li>
              ),
            )}
          </ul>
        ) : (
          <p className="text-xs text-ink-faint">{t('Nothing needs attention.')}</p>
        )}
      </Section>
      <Section title={t('Regions')}>
        <ul className="-mx-1.5">
          {(snapshot?.regions ?? []).map((status) => {
            const region = topology.regions.find((r) => r.id === status.id);
            const abnormal = status.health !== 'healthy';
            return (
              <li key={status.id}>
                <button
                  type="button"
                  onClick={() => showRegion(status.id)}
                  title={t('Frame {region}', { region: region?.name ?? status.id })}
                  className="flex w-full items-center gap-2 rounded-control px-1.5 py-1 text-left hover:bg-raised"
                  data-testid={`region-${status.id}`}
                  data-health={status.health}
                >
                  <HealthMark health={status.health} />
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate text-xs text-ink ${abnormal ? 'font-bold' : ''}`}
                    >
                      {region?.name ?? status.id}
                    </span>
                    <span className="caption block">
                      {status.nodesUnhealthy === 0
                        ? t('{total} services, all normal', { total: status.nodesTotal })
                        : t('{unhealthy} of {total} services not normal', {
                            unhealthy: status.nodesUnhealthy,
                            total: status.nodesTotal,
                          })}
                    </span>
                  </span>
                  <span className="numeric text-right text-[11px] text-ink-dim">
                    {formatRate(status.rps)}/s
                    {status.errorRate >= 0.01 && (
                      <span className="block font-bold" style={{ color: COLOR.critical }}>
                        {t('{percent} errors', { percent: formatPercent(status.errorRate) })}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Section>
      {global && (
        <Section title={t('Platform figures')}>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5" data-testid="platform-figures">
            <Stat label={t('Average latency')} value={formatMs(global.avgLatencyMs)} />
            <Stat label={t('Latency p99')} value={formatMs(global.p99LatencyMs)} />
            <Stat
              label={t('Authorization checks')}
              value={formatRate(global.authzChecksRps)}
              unit={t('per s')}
            />
            <Stat
              label={t('Checks denied')}
              value={formatPercent(global.authzDenialRate)}
              tone={grade(global.authzDenialRate, 0.15, 0.3)}
            />
            <Stat
              label={t('Rejected at the edge')}
              value={formatRate(global.rejectedRps)}
              unit="req/s"
              tone={global.rejectedRps > global.rps * 0.25 ? COLOR.warning : undefined}
            />
            <Stat
              label={t('Suspicious traffic')}
              value={formatRate(global.suspiciousRps)}
              unit="req/s"
              tone={global.suspiciousRps > 0 ? COLOR.hostile : undefined}
            />
          </dl>
        </Section>
      )}
    </div>
  );
}

/**
 * `selection` is what to inspect; with none, the platform itself. The caller
 * passes it so the panel can go on showing what it showed while it leaves.
 */
export function Inspector({ selection }: { selection: Selection }) {
  const topology = useTelemetry((state) => state.topology);
  const index = useTelemetry((state) => state.index);
  const snapshot = useThrottledSnapshot(500);
  if (!topology || !index) return <EmptyState title={t('Loading')} />;
  const live = snapshot?.topologyId === topology.id ? snapshot : null;

  if (selection?.kind === 'group') {
    return <GroupCard key={selection.id} topology={topology} snapshot={live} id={selection.id} />;
  }
  if (selection?.kind === 'node') {
    const nodeIndex = index.nodeIndex.get(selection.id);
    if (nodeIndex !== undefined) {
      return (
        // Keyed by what is selected, so the panel's contents arrive anew
        // when the selection moves from one service to another.
        <NodeInspector
          key={selection.id}
          topology={topology}
          index={index}
          snapshot={live}
          nodeIndex={nodeIndex}
        />
      );
    }
  }
  if (selection?.kind === 'edge') {
    const edgeIndex = index.edgeIndex.get(selection.id);
    if (edgeIndex !== undefined) {
      return (
        <EdgeInspector
          key={selection.id}
          topology={topology}
          snapshot={live}
          edgeIndex={edgeIndex}
        />
      );
    }
  }
  return <Overview topology={topology} snapshot={live} />;
}
