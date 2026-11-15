import type {
  AuthorizationCatalog,
  AuthorizationDecision,
  EvaluateRequest,
} from '@aegis/contracts';
import { useQuery } from '@tanstack/react-query';
import { Check, Play, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { actions } from '@/app/actions';
import { queryKeys } from '@/app/queryClient';
import { Badge, SourceBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Segmented, Select, Switch } from '@/components/ui/Field';
import { EmptyState, Section } from '@/components/ui/Section';
import { cn } from '@/lib/cn';
import { entityId, formatClock } from '@/lib/format';
import { COLOR } from '@/lib/palette';
import { api, ApiError } from '@/providers/api';
import { useTelemetry } from '@/stores/telemetry';
import { useUi } from '@/stores/ui';

type Tri = 'absent' | 'true' | 'false';
const TRI: { value: Tri; label: string }[] = [
  { value: 'absent', label: 'Absent' },
  { value: 'true', label: 'True' },
  { value: 'false', label: 'False' },
];

const ENGINE_LABEL = { 'embedded-cedar': 'Embedded Cedar', 'cedar-agent': 'cedar-agent' } as const;

const STAGE_LABEL = {
  client: 'Client',
  edge: 'Edge',
  gateway: 'API Gateway',
  authentication: 'Authentication',
  authorization: 'Cedar Authorizer',
  resource: 'Resource',
} as const;

function DecisionCard({ decision }: { decision: AuthorizationDecision }) {
  const topology = useTelemetry((state) => state.topology);
  const tracing = useUi((state) => state.tracedDecision?.id === decision.id);
  const allowed = decision.decision === 'allow';
  const color = allowed ? COLOR.healthy : COLOR.critical;
  const nameOf = (id: string) => topology?.nodes.find((n) => n.id === id)?.name ?? id;
  return (
    <div
      className="rounded-[4px] border p-3"
      style={{
        borderColor: `color-mix(in oklab, ${color} 55%, transparent)`,
        backgroundColor: `color-mix(in oklab, ${color} 7%, transparent)`,
      }}
      data-testid="decision-card"
      data-decision={decision.decision}
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2" style={{ color }}>
          {allowed ? <ShieldCheck size={22} aria-hidden /> : <ShieldAlert size={22} aria-hidden />}
          <span
            className="font-display text-xl font-semibold uppercase tracking-[0.14em]"
            data-testid="decision-result"
          >
            {allowed ? 'Allow' : 'Deny'}
          </span>
        </div>
        <Button
          size="sm"
          variant="outline"
          icon={<Play size={12} aria-hidden />}
          disabled={tracing || decision.hops.length === 0}
          onClick={() => useUi.getState().traceDecision({ ...decision })}
        >
          {tracing ? 'Tracing…' : 'Trace again'}
        </Button>
      </div>
      <p className="numeric mt-2 break-all text-[11px] text-ink-dim">
        {entityId(decision.request.principal)} → {entityId(decision.request.action)} →{' '}
        {entityId(decision.request.resource)}
      </p>

      <div className="mt-3">
        <p className="eyebrow mb-1">Determining policies</p>
        {decision.determiningPolicies.length > 0 ? (
          <ul className="flex flex-wrap gap-1" data-testid="decision-policies">
            {decision.determiningPolicies.map((id) => (
              <li key={id}>
                <Badge color={color}>{id}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-ink-dim">
            None. No policy permits this request, so Cedar denies it by default.
          </p>
        )}
      </div>

      {decision.errors.length > 0 && (
        <div className="mt-3">
          <p className="eyebrow mb-1">Evaluation diagnostics</p>
          <ul className="space-y-1" data-testid="decision-errors">
            {decision.errors.map((error) => (
              <li
                key={error}
                className="numeric rounded-[3px] border border-warning/40 bg-warning/10 px-2 py-1 text-[10px] leading-relaxed text-warning"
              >
                {error}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3">
        <p className="eyebrow mb-1.5">Path through the platform</p>
        <ol className="space-y-1" data-testid="decision-path">
          {decision.path.map((stage, i) => {
            const blocked = decision.blockedAt === stage.nodeId;
            return (
              <li key={`${stage.nodeId}-${i}`} className="flex items-center gap-2 text-xs">
                <span
                  aria-hidden
                  className="flex size-4 shrink-0 items-center justify-center rounded-full border"
                  style={{
                    borderColor: blocked
                      ? COLOR.critical
                      : stage.reached
                        ? COLOR.healthy
                        : COLOR.line,
                    color: blocked
                      ? COLOR.critical
                      : stage.reached
                        ? COLOR.healthy
                        : COLOR.inkFaint,
                  }}
                >
                  {blocked ? <X size={10} /> : stage.reached ? <Check size={10} /> : null}
                </span>
                <button
                  type="button"
                  onClick={() => useUi.getState().selectNode(stage.nodeId)}
                  className={cn(
                    'min-w-0 flex-1 truncate text-left hover:text-cyan',
                    stage.reached ? 'text-ink' : 'text-ink-faint',
                  )}
                >
                  {nameOf(stage.nodeId)}
                </button>
                <span className="shrink-0 text-[10px] text-ink-faint">
                  {STAGE_LABEL[stage.kind]}
                  <span className="sr-only">
                    {blocked ? ', blocked here' : stage.reached ? ', reached' : ', not reached'}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      <dl className="numeric mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line/60 pt-2 text-[10px] text-ink-faint">
        <div>
          <dt className="sr-only">Engine</dt>
          <dd data-testid="decision-engine">
            {ENGINE_LABEL[decision.engine.kind]}
            {decision.engine.version ? ` ${decision.engine.version}` : ' (version not reported)'}
          </dd>
        </div>
        <div>
          <dt className="sr-only">Evaluation time</dt>
          <dd>{decision.evaluationMicros} µs measured</dd>
        </div>
        <div>
          <dt className="sr-only">Virtual time</dt>
          <dd>at {formatClock(decision.virtualTimeMs)}</dd>
        </div>
        <SourceBadge source={decision.dataSource} />
      </dl>
    </div>
  );
}

function RequestForm({ catalog }: { catalog: AuthorizationCatalog }) {
  const [principal, setPrincipal] = useState(catalog.principals[0]?.uid ?? '');
  const [action, setAction] = useState(catalog.actions[0]?.uid ?? '');
  const actionInfo = catalog.actions.find((a) => a.uid === action);
  const resources = useMemo(
    () =>
      catalog.resources.filter((r) => !actionInfo || r.resourceType === actionInfo.resourceType),
    [catalog, actionInfo],
  );
  const [resource, setResource] = useState(resources[0]?.uid ?? '');
  const [context, setContext] = useState<Record<string, Tri>>({});
  const [disabled, setDisabled] = useState<string[]>([]);
  const [engine, setEngine] = useState<'embedded' | 'cedar-agent'>('embedded');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AuthorizationDecision | null>(null);

  // Keep the resource valid for the chosen action.
  useEffect(() => {
    if (!resources.some((r) => r.uid === resource)) setResource(resources[0]?.uid ?? '');
  }, [resources, resource]);

  const agent = catalog.engines.find((e) => e.kind === 'cedar-agent');
  const agentAvailable = agent?.available ?? false;
  useEffect(() => {
    if (!agentAvailable && engine === 'cedar-agent') setEngine('embedded');
  }, [agentAvailable, engine]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const request: EvaluateRequest = {
      principal,
      action,
      resource,
      context: Object.fromEntries(
        Object.entries(context)
          .filter(([, value]) => value !== 'absent')
          .map(([key, value]) => [key, value === 'true']),
      ),
      engine,
      ...(engine === 'embedded' && disabled.length > 0 ? { disabledPolicies: disabled } : {}),
    };
    const outcome = await actions.evaluate(request);
    setBusy(false);
    if (outcome instanceof ApiError) {
      setError(outcome.message);
      setResult(null);
    } else {
      setResult(outcome);
    }
  };

  const principalInfo = catalog.principals.find((p) => p.uid === principal);
  const resourceInfo = catalog.resources.find((r) => r.uid === resource);

  return (
    <>
      <Section title="Request">
        <form
          className="space-y-2.5"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          data-testid="authz-form"
        >
          <Select
            label="Principal"
            value={principal}
            onChange={(e) => setPrincipal(e.target.value)}
            data-testid="authz-principal"
          >
            {catalog.principals.map((p) => (
              <option key={p.uid} value={p.uid}>
                {p.label} — {p.note}
              </option>
            ))}
          </Select>
          <Select
            label="Action"
            value={action}
            onChange={(e) => setAction(e.target.value)}
            data-testid="authz-action"
          >
            {catalog.actions.map((a) => (
              <option key={a.uid} value={a.uid}>
                {a.label}
              </option>
            ))}
          </Select>
          <Select
            label="Resource"
            value={resource}
            onChange={(e) => setResource(e.target.value)}
            data-testid="authz-resource"
          >
            {resources.map((r) => (
              <option key={r.uid} value={r.uid}>
                {r.label} — tenant {r.tenant}
              </option>
            ))}
          </Select>
          {principalInfo && resourceInfo && (
            <p className="text-[11px] text-ink-faint">
              {principalInfo.label} belongs to tenant{' '}
              <span className="text-ink-dim">{principalInfo.tenant}</span> with role
              {principalInfo.roles.length === 1 ? '' : 's'}{' '}
              <span className="text-ink-dim">{principalInfo.roles.join(', ')}</span>; the resource
              belongs to <span className="text-ink-dim">{resourceInfo.tenant}</span>.
            </p>
          )}
          <fieldset>
            <legend className="eyebrow mb-1.5">Context</legend>
            <div className="space-y-1.5">
              {catalog.contextKeys.map((key) => (
                <div key={key.key} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 text-xs text-ink" title={key.description}>
                    {key.label}
                    <span className="numeric ml-1.5 text-[10px] text-ink-faint">
                      context.{key.key}
                    </span>
                  </span>
                  <Segmented<Tri>
                    label={key.label}
                    size="sm"
                    value={context[key.key] ?? 'absent'}
                    options={TRI}
                    onChange={(value) =>
                      setContext((current) => ({ ...current, [key.key]: value }))
                    }
                  />
                </div>
              ))}
            </div>
          </fieldset>
          <div className="flex items-center justify-between gap-2">
            <span className="eyebrow">Engine</span>
            <Segmented
              label="Policy engine"
              size="sm"
              value={engine}
              options={[
                { value: 'embedded' as const, label: 'Embedded' },
                ...(agentAvailable
                  ? [{ value: 'cedar-agent' as const, label: 'cedar-agent' }]
                  : []),
              ]}
              onChange={setEngine}
            />
          </div>
          {!agentAvailable && (
            <p className="text-[11px] text-ink-faint">
              Connect a local cedar-agent under Integrations to evaluate with it instead.
            </p>
          )}
          <Button
            type="submit"
            variant="primary"
            disabled={busy || !principal || !action || !resource}
            className="w-full"
            data-testid="authz-evaluate"
          >
            {busy ? 'Evaluating…' : 'Evaluate with Cedar'}
          </Button>
          {error && (
            <p
              role="alert"
              className="rounded-[3px] border border-critical/50 bg-critical/10 px-2 py-1.5 text-xs text-critical"
            >
              {error}
            </p>
          )}
        </form>
      </Section>

      {result && (
        <Section title="Decision">
          <DecisionCard decision={result} />
        </Section>
      )}

      <Section
        title="Policies"
        aside={
          <span className="numeric text-[10px] text-ink-faint">
            {catalog.policies.length - disabled.length}/{catalog.policies.length} active
          </span>
        }
      >
        <p className="mb-2 text-[11px] leading-relaxed text-ink-faint">
          These are the real Cedar policies being evaluated. Switch one off to see how the decision
          changes
          {engine === 'cedar-agent'
            ? ' (embedded engine only; the agent uses its own policy store).'
            : '.'}
        </p>
        <ul className="space-y-1.5" data-testid="policy-list">
          {catalog.policies.map((policy) => {
            const off = disabled.includes(policy.id);
            const determining = result?.determiningPolicies.includes(policy.id) ?? false;
            return (
              <li
                key={policy.id}
                className={cn(
                  'rounded-[3px] border px-2 py-1.5',
                  determining ? 'border-cyan/70 bg-cyan/10' : 'border-line',
                  off && 'opacity-55',
                )}
              >
                <div className="flex items-center gap-2">
                  <Badge color={policy.effect === 'forbid' ? COLOR.critical : COLOR.healthy}>
                    {policy.effect}
                  </Badge>
                  <span className="numeric min-w-0 flex-1 truncate text-[11px] text-ink">
                    {policy.id}
                  </span>
                </div>
                <Switch
                  label={policy.description}
                  checked={!off}
                  disabled={engine === 'cedar-agent'}
                  onCheckedChange={(on) =>
                    setDisabled((current) =>
                      on ? current.filter((id) => id !== policy.id) : [...current, policy.id],
                    )
                  }
                />
                <details>
                  <summary className="text-[10px] text-cyan hover:underline">Cedar source</summary>
                  <pre className="numeric mt-1 overflow-x-auto whitespace-pre-wrap rounded-[3px] bg-abyss p-2 text-[10px] leading-relaxed text-ink-dim">
                    {policy.content}
                  </pre>
                </details>
              </li>
            );
          })}
        </ul>
      </Section>
    </>
  );
}

function RecentDecisions() {
  const { data } = useQuery({ queryKey: queryKeys.decisions, queryFn: api.authorizationDecisions });
  if (!data || data.length === 0) return null;
  return (
    <Section title="Evaluated in this timeline">
      <ul className="space-y-1" data-testid="recent-decisions">
        {data
          .slice(-6)
          .reverse()
          .map((decision) => (
            <li key={decision.id}>
              <button
                type="button"
                onClick={() => useUi.getState().traceDecision({ ...decision })}
                className="flex w-full items-center gap-2 rounded-[3px] px-1.5 py-1 text-left hover:bg-raised/70"
                title="Trace this decision through the scene"
              >
                <Badge color={decision.decision === 'allow' ? COLOR.healthy : COLOR.critical}>
                  {decision.decision}
                </Badge>
                <span className="min-w-0 flex-1 truncate text-xs text-ink">
                  {entityId(decision.request.principal)} → {entityId(decision.request.action)}
                </span>
                <span className="numeric text-[10px] text-ink-faint">
                  {formatClock(decision.virtualTimeMs)}
                </span>
              </button>
            </li>
          ))}
      </ul>
    </Section>
  );
}

export function AuthorizationExplorer() {
  const { data: catalog, isError } = useQuery({
    queryKey: queryKeys.catalog,
    queryFn: api.authorizationCatalog,
  });
  if (isError)
    return (
      <EmptyState title="Authorization unavailable">The server could not be reached.</EmptyState>
    );
  if (!catalog) return <EmptyState title="Loading policies" />;
  const embedded = catalog.engines.find((e) => e.kind === 'embedded-cedar');
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-testid="authorization-explorer">
      <header className="border-b border-line/70 px-3 py-3">
        <p className="eyebrow">Cedar</p>
        <h2 className="mt-0.5 font-display text-lg font-semibold text-ink">
          Authorization explorer
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-dim">
          Build a request and watch it travel client → gateway → authentication → Cedar → resource.
          Decisions are computed by the Cedar policy engine
          {embedded?.version ? ` (cedar-policy ${embedded.version})` : ''} over synthetic principals
          and resources; nothing is scripted.
        </p>
      </header>
      <RequestForm catalog={catalog} />
      <RecentDecisions />
    </div>
  );
}
