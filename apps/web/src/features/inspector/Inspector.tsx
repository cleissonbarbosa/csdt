import {
  SECURITY_STATUS_BY_CODE,
  type SecurityEvent,
  type TelemetrySnapshot,
  type Topology,
} from '@aegis/contracts';
import { ArrowRight, Crosshair, X } from 'lucide-react';
import { useMemo } from 'react';

import { useThrottledSnapshot } from '@/app/hooks';
import { Badge, HealthBadge, SeverityBadge, SourceBadge, StatusDot } from '@/components/ui/Badge';
import { IconButton } from '@/components/ui/Button';
import { EmptyState, Section, Stat } from '@/components/ui/Section';
import { Sparkline } from '@/components/ui/Sparkline';
import { sceneHandle } from '@/graphics/handle';
import { entityId, formatClock, formatMs, formatPercent, formatRate } from '@/lib/format';
import {
  COLOR,
  HEALTH_COLOR,
  HEALTH_LABEL,
  RELATIONSHIP_LABEL,
  SECURITY_COLOR,
  SECURITY_LABEL,
  SERVICE_TYPE,
  SEVERITY_COLOR,
} from '@/lib/palette';
import {
  liveEdge,
  liveNode,
  NODE_HISTORY,
  useTelemetry,
  type TopologyIndex,
} from '@/stores/telemetry';
import { useUi } from '@/stores/ui';

function EventRow({ event }: { event: SecurityEvent }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => useUi.getState().inspectEvent(event.seq)}
        className="flex w-full items-start gap-2 rounded-[3px] px-1.5 py-1 text-left hover:bg-raised/70"
      >
        <span
          aria-hidden
          className="mt-1.5 size-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: SEVERITY_COLOR[event.severity] }}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs text-ink">{event.title}</span>
          <span className="numeric block text-[10px] text-ink-faint">
            {formatClock(event.virtualTimeMs)} · <span className="sr-only">severity </span>
            {event.severity}
          </span>
        </span>
      </button>
    </li>
  );
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
  const errorTone =
    live.errorRate >= 0.2 ? COLOR.critical : live.errorRate >= 0.04 ? COLOR.warning : undefined;

  const connection = (edgeIndex: number, outgoing: boolean) => {
    const edge = liveEdge(topology, snapshot, edgeIndex);
    if (!edge) return null;
    const peerId = outgoing ? edge.edge.target : edge.edge.source;
    const peer = topology.nodes[index.nodeIndex.get(peerId) ?? -1];
    const status = SECURITY_STATUS_BY_CODE[edge.securityCode] ?? 'secure';
    return (
      <li key={edge.edge.id} className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => useUi.getState().selectNode(peerId)}
          onMouseEnter={() => useUi.getState().setHovered(peerId)}
          onMouseLeave={() => useUi.getState().setHovered(null)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-[3px] px-1.5 py-1 text-left hover:bg-raised/70"
        >
          <StatusDot color={SECURITY_COLOR[status]} label={SECURITY_LABEL[status]} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs text-ink">{peer?.name ?? peerId}</span>
            <span className="block truncate text-[10px] text-ink-faint">
              {RELATIONSHIP_LABEL[edge.edge.relationship]} · {edge.edge.protocol.toUpperCase()}
              {edge.edge.crossRegion && ' · cross-region'}
            </span>
          </span>
          <span className="numeric shrink-0 text-right text-[10px] text-ink-dim">
            {formatRate(edge.trafficRps)}/s
            {edge.errorRate >= 0.01 && (
              <span className="block" style={{ color: COLOR.critical }}>
                {formatPercent(edge.errorRate)} err
              </span>
            )}
          </span>
        </button>
        <IconButton
          label={`Inspect connection to ${peer?.name ?? peerId}`}
          size="sm"
          onClick={() => useUi.getState().select({ kind: 'edge', id: edge.edge.id })}
        >
          <ArrowRight size={13} />
        </IconButton>
      </li>
    );
  };

  return (
    <div data-testid="node-inspector" data-node-id={node.id}>
      <header className="border-b border-line/70 px-3 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="eyebrow" style={{ color: type.color }}>
              {type.label}
            </p>
            <h2
              className="mt-0.5 truncate font-display text-lg font-semibold text-ink"
              data-testid="inspector-title"
            >
              {node.name}
            </h2>
            <p className="numeric mt-0.5 truncate text-[11px] text-ink-faint">{node.id}</p>
          </div>
          <div className="flex shrink-0 gap-0.5">
            <IconButton
              label="Focus camera on this service"
              onClick={() => sceneHandle.current?.focusNode(node.id)}
            >
              <Crosshair size={15} />
            </IconButton>
            <IconButton label="Clear selection" onClick={() => useUi.getState().select(null)}>
              <X size={15} />
            </IconButton>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <HealthBadge health={live.health} />
          <SourceBadge source={node.dataSource} />
          <Badge color={COLOR.inkDim}>{region?.name ?? node.region}</Badge>
          <Badge color={COLOR.inkFaint}>{node.environment}</Badge>
        </div>
        {node.description && (
          <p className="mt-2 text-xs leading-relaxed text-ink-dim">{node.description}</p>
        )}
      </header>

      <Section title="Metrics">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-3" data-testid="inspector-metrics">
          <div>
            <Stat label="Throughput" value={formatRate(live.throughputRps)} unit="req/s" />
            {series && (
              <Sparkline
                values={series.throughput}
                length={history.length}
                color={COLOR.cyan}
                label="Throughput over the last 90 seconds"
                width={136}
              />
            )}
          </div>
          <div>
            <Stat label="Latency" value={formatMs(live.latencyMs)} />
            {series && (
              <Sparkline
                values={series.latency}
                length={history.length}
                color={COLOR.violet}
                label="Latency over the last 90 seconds"
                width={136}
              />
            )}
          </div>
          <div>
            <Stat label="Error rate" value={formatPercent(live.errorRate)} tone={errorTone} />
            {series && (
              <Sparkline
                values={series.error}
                length={history.length}
                color={COLOR.critical}
                max={1}
                label="Error rate over the last 90 seconds"
                width={136}
              />
            )}
          </div>
          <div className="space-y-3">
            <Stat
              label="Saturation"
              value={node.capacityRps > 0 ? formatPercent(live.saturation) : 'n/a'}
              tone={
                live.saturation >= 1
                  ? COLOR.critical
                  : live.saturation >= 0.88
                    ? COLOR.warning
                    : undefined
              }
            />
            {node.serviceType === 'message-queue' ? (
              <Stat label="Backlog" value={formatRate(live.queueDepth)} unit="msgs" />
            ) : (
              <Stat
                label="Capacity"
                value={node.capacityRps > 0 ? formatRate(node.capacityRps) : 'unbounded'}
                unit={node.capacityRps > 0 ? 'req/s' : undefined}
              />
            )}
          </div>
        </dl>
        <p className="mt-2 text-[10px] text-ink-faint">
          Sparklines cover the last {NODE_HISTORY} s of virtual time. Baseline latency{' '}
          <span className="numeric">{formatMs(node.baselineLatencyMs)}</span>.
        </p>
      </Section>

      <Section
        title="Calls"
        aside={
          <span className="numeric text-[10px] text-ink-faint">
            {index.outgoing[nodeIndex]?.length ?? 0}
          </span>
        }
      >
        {index.outgoing[nodeIndex]?.length ? (
          <ul>{index.outgoing[nodeIndex]!.map((e) => connection(e, true))}</ul>
        ) : (
          <p className="text-xs text-ink-faint">This service calls nothing.</p>
        )}
      </Section>
      <Section
        title="Called by"
        aside={
          <span className="numeric text-[10px] text-ink-faint">
            {index.incoming[nodeIndex]?.length ?? 0}
          </span>
        }
      >
        {index.incoming[nodeIndex]?.length ? (
          <ul>{index.incoming[nodeIndex]!.map((e) => connection(e, false))}</ul>
        ) : (
          <p className="text-xs text-ink-faint">Nothing calls this service.</p>
        )}
      </Section>

      {decisions.length > 0 && (
        <Section title="Authorization decisions">
          <ul className="space-y-1" data-testid="inspector-decisions">
            {decisions.map((event) => {
              const decision = decisionOf(event);
              const denied = decision?.decision === 'deny';
              return (
                <li key={event.seq}>
                  <button
                    type="button"
                    onClick={() => useUi.getState().inspectEvent(event.seq)}
                    className="w-full rounded-[3px] px-1.5 py-1 text-left hover:bg-raised/70"
                  >
                    <span className="flex items-center gap-2">
                      <Badge color={denied ? COLOR.critical : COLOR.healthy}>
                        {denied ? 'Deny' : 'Allow'}
                      </Badge>
                      <span className="min-w-0 flex-1 truncate text-xs text-ink">
                        {entityId(decision?.request?.principal ?? '')} →{' '}
                        {entityId(decision?.request?.action ?? '')}
                      </span>
                      <span className="numeric text-[10px] text-ink-faint">
                        {formatClock(event.virtualTimeMs)}
                      </span>
                    </span>
                    {decision?.determiningPolicies && decision.determiningPolicies.length > 0 && (
                      <span className="numeric mt-0.5 block truncate text-[10px] text-ink-faint">
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

      <Section title="Event history">
        {other.length > 0 ? (
          <ul data-testid="inspector-events">
            {other.map((event) => (
              <EventRow key={event.seq} event={event} />
            ))}
          </ul>
        ) : (
          <p className="text-xs text-ink-faint">No events involve this service yet.</p>
        )}
      </Section>
    </div>
  );
}

function EdgeInspector({
  topology,
  index,
  snapshot,
  edgeIndex,
}: {
  topology: Topology;
  index: TopologyIndex;
  snapshot: TelemetrySnapshot | null;
  edgeIndex: number;
}) {
  const live = liveEdge(topology, snapshot, edgeIndex);
  if (!live) return null;
  const { edge } = live;
  const source = topology.nodes[index.nodeIndex.get(edge.source) ?? -1];
  const target = topology.nodes[index.nodeIndex.get(edge.target) ?? -1];
  const status = SECURITY_STATUS_BY_CODE[live.securityCode] ?? 'secure';
  const endpoint = (label: string, id: string, name: string | undefined) => (
    <button
      type="button"
      onClick={() => useUi.getState().selectNode(id)}
      className="min-w-0 flex-1 rounded-[3px] border border-line px-2 py-1.5 text-left hover:border-line-bright hover:bg-raised/70"
    >
      <span className="eyebrow block">{label}</span>
      <span className="block truncate text-xs text-ink">{name ?? id}</span>
    </button>
  );
  return (
    <div data-testid="edge-inspector">
      <header className="border-b border-line/70 px-3 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="eyebrow">Connection</p>
            <h2 className="mt-0.5 font-display text-base font-semibold text-ink">
              {RELATIONSHIP_LABEL[edge.relationship]}
            </h2>
          </div>
          <IconButton label="Clear selection" onClick={() => useUi.getState().select(null)}>
            <X size={15} />
          </IconButton>
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          {endpoint('From', edge.source, source?.name)}
          <ArrowRight size={14} aria-hidden className="shrink-0 text-ink-faint" />
          {endpoint('To', edge.target, target?.name)}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge color={SECURITY_COLOR[status]} dot>
            {SECURITY_LABEL[status]}
          </Badge>
          <Badge color={COLOR.inkDim}>{edge.protocol}</Badge>
          {edge.crossRegion && <Badge color={COLOR.violet}>Cross-region</Badge>}
        </div>
      </header>
      <Section title="Traffic">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-3">
          <Stat label="Traffic" value={formatRate(live.trafficRps)} unit="req/s" />
          <Stat label="Network latency" value={formatMs(live.latencyMs)} />
          <Stat
            label="Error rate"
            value={formatPercent(live.errorRate)}
            tone={live.errorRate >= 0.04 ? COLOR.critical : undefined}
          />
          <Stat
            label="Rejected"
            value={formatRate(live.rejectedRps)}
            unit="req/s"
            tone={live.rejectedRps > live.trafficRps * 0.25 ? COLOR.warning : undefined}
          />
          <Stat
            label="Suspicious"
            value={formatRate(live.suspiciousRps)}
            unit="req/s"
            tone={live.suspiciousRps > 0 ? COLOR.magenta : undefined}
          />
          <Stat label="Calls per request" value={edge.weight.toFixed(2)} />
        </dl>
      </Section>
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
  const alerts = useMemo(() => {
    const out: SecurityEvent[] = [];
    for (let i = events.length - 1; i >= 0 && out.length < 8; i--) {
      const event = events[i]!;
      if (
        event.virtualTimeMs <= cursor &&
        (event.severity === 'warning' || event.severity === 'critical')
      ) {
        out.push(event);
      }
    }
    return out;
  }, [events, cursor]);
  return (
    <div data-testid="overview">
      <header className="border-b border-line/70 px-3 py-3">
        <p className="eyebrow">Platform</p>
        <h2 className="mt-0.5 font-display text-lg font-semibold text-ink">{topology.name}</h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-dim">{topology.description}</p>
        <p className="mt-2 text-[11px] text-ink-faint">
          Select a service in the scene or the explorer to inspect it. Double-click to focus the
          camera.
        </p>
      </header>
      <Section title="Regions">
        <ul className="space-y-1.5">
          {(snapshot?.regions ?? []).map((status) => {
            const region = topology.regions.find((r) => r.id === status.id);
            return (
              <li key={status.id}>
                <button
                  type="button"
                  onClick={() => sceneHandle.current?.frameRegion(status.id)}
                  className="flex w-full items-center gap-2 rounded-[3px] px-1.5 py-1 text-left hover:bg-raised/70"
                >
                  <StatusDot
                    color={HEALTH_COLOR[status.health]}
                    pulse={status.health !== 'healthy'}
                    label={HEALTH_LABEL[status.health]}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-ink">
                      {region?.name ?? status.id}
                    </span>
                    <span className="block text-[10px] text-ink-faint">
                      {status.nodesUnhealthy === 0
                        ? `${status.nodesTotal} services healthy`
                        : `${status.nodesUnhealthy} of ${status.nodesTotal} services unhealthy`}
                    </span>
                  </span>
                  <span className="numeric text-right text-[10px] text-ink-dim">
                    {formatRate(status.rps)}/s
                    {status.errorRate >= 0.01 && (
                      <span className="block" style={{ color: COLOR.critical }}>
                        {formatPercent(status.errorRate)} err
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Section>
      <Section title="Recent alerts">
        {alerts.length > 0 ? (
          <ul>
            {alerts.map((event) => (
              <li key={event.seq} className="flex items-start gap-2 px-1.5 py-1">
                <SeverityBadge severity={event.severity} />
                <button
                  type="button"
                  onClick={() => useUi.getState().inspectEvent(event.seq)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-xs text-ink hover:text-cyan">
                    {event.title}
                  </span>
                  <span className="numeric text-[10px] text-ink-faint">
                    {formatClock(event.virtualTimeMs)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-ink-faint">Nothing needs attention.</p>
        )}
      </Section>
    </div>
  );
}

export function Inspector() {
  const topology = useTelemetry((state) => state.topology);
  const index = useTelemetry((state) => state.index);
  const selection = useUi((state) => state.selection);
  const snapshot = useThrottledSnapshot(500);
  if (!topology || !index) return <EmptyState title="Loading" />;
  const live = snapshot?.topologyId === topology.id ? snapshot : null;

  if (selection?.kind === 'node') {
    const nodeIndex = index.nodeIndex.get(selection.id);
    if (nodeIndex !== undefined) {
      return (
        <NodeInspector topology={topology} index={index} snapshot={live} nodeIndex={nodeIndex} />
      );
    }
  }
  if (selection?.kind === 'edge') {
    const edgeIndex = index.edgeIndex.get(selection.id);
    if (edgeIndex !== undefined) {
      return (
        <EdgeInspector topology={topology} index={index} snapshot={live} edgeIndex={edgeIndex} />
      );
    }
  }
  return <Overview topology={topology} snapshot={live} />;
}
