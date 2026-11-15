import type {
  AuthorizationCatalog,
  AuthorizationDecision,
  EvaluateRequest,
} from '@aegis/contracts';
import { useQuery } from '@tanstack/react-query';
import { Check, Play, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { actions } from '@/app/actions';
import { evaluationTime, HOST } from '@/app/host';
import { queryKeys } from '@/app/queryClient';
import { Badge, DecisionTag, SourceBadge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Segmented, Select, Switch } from '@/components/ui/Field';
import { EmptyState, Section } from '@/components/ui/Section';
import { cn } from '@/lib/cn';
import { entityId, formatClock } from '@/lib/format';
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
  gateway: 'API gateway',
  authentication: 'Authentication',
  authorization: 'Cedar authorizer',
  resource: 'Resource',
} as const;

function DecisionCard({ decision }: { decision: AuthorizationDecision }) {
  const topology = useTelemetry((state) => state.topology);
  const traced = useUi((state) => state.tracedDecision?.id === decision.id);
  const tracing = useUi((state) => state.tracing) && traced;
  const allowed = decision.decision === 'allow';
  const nameOf = (id: string) => topology?.nodes.find((n) => n.id === id)?.name ?? id;
  return (
    <div
      className={cn(
        'overflow-hidden rounded-control border',
        allowed ? 'border-line-strong' : 'border-critical',
      )}
      data-testid="decision-card"
      data-decision={decision.decision}
      aria-live="polite"
    >
      {/* The request the viewer is following either arrived or was stopped.
          Stopped is the event: it takes the incident colour, and a cross,
          and the solid form, so it is not told from Allow by hue alone. */}
      <div
        className={cn(
          'flex items-center justify-between gap-2 px-3 py-2',
          allowed ? 'border-b border-line text-ink' : 'bg-critical text-on-accent',
        )}
      >
        <div className="flex items-center gap-2">
          {allowed ? <Check size={18} aria-hidden /> : <X size={18} aria-hidden />}
          <span className="text-lg font-bold leading-none" data-testid="decision-result">
            {allowed ? 'Allow' : 'Deny'}
          </span>
        </div>
        <Button
          size="sm"
          variant="outline"
          icon={<Play size={12} aria-hidden />}
          disabled={tracing || decision.hops.length === 0}
          onClick={() => useUi.getState().traceDecision({ ...decision })}
          data-testid="decision-trace"
        >
          {tracing ? 'Tracing…' : traced ? 'Trace again' : 'Show the path'}
        </Button>
      </div>
      <div className="p-3">
        <p className="code break-all text-[11px] text-ink-dim">
          {entityId(decision.request.principal)} → {entityId(decision.request.action)} →{' '}
          {entityId(decision.request.resource)}
        </p>

        <div className="mt-3">
          <p className="caption mb-1">Determining policies</p>
          {decision.determiningPolicies.length > 0 ? (
            <ul className="flex flex-wrap gap-1" data-testid="decision-policies">
              {decision.determiningPolicies.map((id) => (
                <li key={id}>
                  <Badge className="code border-line-strong text-ink">{id}</Badge>
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
            <p className="caption mb-1">Evaluation diagnostics</p>
            <ul className="space-y-1" data-testid="decision-errors">
              {decision.errors.map((error) => (
                <li
                  key={error}
                  className="numeric rounded-control border border-warning/40 bg-warning/10 px-2 py-1 text-[11px] leading-relaxed text-warning"
                >
                  {error}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-3">
          <p className="caption mb-1.5">Path through the platform</p>
          {decision.path.length === 0 && (
            // A topology from a workspace may not say which of its services
            // are the gateway and the authorizer. The decision is still
            // Cedar's; there is only nowhere to draw it.
            <p className="text-xs text-ink-dim" data-testid="decision-path-none">
              None to draw. This platform does not name its gateway, authentication service and
              authorizer.
            </p>
          )}
          <ol className="space-y-1" data-testid="decision-path">
            {decision.path.map((stage, i) => {
              const blocked = decision.blockedAt === stage.nodeId;
              return (
                <li key={`${stage.nodeId}-${i}`} className="flex items-center gap-2 text-xs">
                  {/* Where the request got through, where it was stopped, and
                    what it never reached. Marks, not boxes: these are not controls. */}
                  <span
                    aria-hidden
                    className={cn(
                      'flex size-4 shrink-0 items-center justify-center',
                      blocked
                        ? 'rounded-full bg-critical text-on-accent'
                        : stage.reached
                          ? 'text-ink'
                          : 'text-ink-faint',
                    )}
                  >
                    {blocked ? (
                      <X size={11} />
                    ) : stage.reached ? (
                      <Check size={12} />
                    ) : (
                      <span className="h-px w-2 bg-current" />
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => useUi.getState().selectNode(stage.nodeId)}
                    className={cn(
                      'min-w-0 flex-1 truncate text-left hover:underline hover:underline-offset-2',
                      blocked
                        ? 'font-bold text-critical'
                        : stage.reached
                          ? 'text-ink'
                          : 'text-ink-faint',
                    )}
                  >
                    {nameOf(stage.nodeId)}
                  </button>
                  <span className="shrink-0 text-[11px] text-ink-faint">
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

        <dl className="numeric mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-2 text-[11px] text-ink-faint">
          <div>
            <dt className="sr-only">Engine</dt>
            <dd data-testid="decision-engine">
              {ENGINE_LABEL[decision.engine.kind]}
              {decision.engine.version ? ` ${decision.engine.version}` : ' (version not reported)'}
            </dd>
          </div>
          <div>
            <dt className="sr-only">Evaluation time</dt>
            <dd data-testid="decision-time">{evaluationTime(decision.evaluationMicros)}</dd>
          </div>
          <div>
            <dt className="sr-only">Virtual time</dt>
            <dd>at {formatClock(decision.virtualTimeMs)}</dd>
          </div>
          <SourceBadge source={decision.dataSource} />
        </dl>
      </div>
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
                {p.label}, {p.note}
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
                {r.label}, tenant {r.tenant}
              </option>
            ))}
          </Select>
          {principalInfo && resourceInfo && (
            <p className="text-[11px] text-ink-faint">
              {principalInfo.label} belongs to tenant{' '}
              <span className="text-ink-dim">{principalInfo.tenant}</span>
              {principalInfo.roles.length === 0 ? (
                ' and has no role'
              ) : (
                <>
                  {' '}
                  with role{principalInfo.roles.length === 1 ? '' : 's'}{' '}
                  <span className="text-ink-dim">{principalInfo.roles.join(', ')}</span>
                </>
              )}
              ; the resource belongs to <span className="text-ink-dim">{resourceInfo.tenant}</span>.
            </p>
          )}
          <fieldset hidden={catalog.contextKeys.length === 0}>
            <legend className="caption mb-1.5">Context</legend>
            <div className="space-y-1.5">
              {catalog.contextKeys.map((key) => (
                <div key={key.key} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 text-xs text-ink" title={key.description}>
                    {key.label}
                    <span className="numeric ml-1.5 text-[11px] text-ink-faint">
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
            <span className="caption">Engine</span>
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
          {!agentAvailable && <p className="text-[11px] text-ink-faint">{HOST.agent}</p>}
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
              className="rounded-control border border-critical/50 bg-critical/10 px-2 py-1.5 text-xs text-critical"
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
          <span className="numeric text-[11px] text-ink-faint">
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
                  'rounded-control border px-2 py-1.5',
                  determining ? 'border-ink bg-raised' : 'border-line',
                  off && 'opacity-55',
                )}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'inline-flex h-5 w-12 shrink-0 items-center justify-center rounded-control border border-ink text-[11px]',
                      policy.effect === 'forbid' ? 'bg-ink text-on-accent' : 'text-ink',
                    )}
                  >
                    {policy.effect === 'forbid' ? 'Forbid' : 'Permit'}
                  </span>
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
                  <summary className="text-[11px] text-ink-dim hover:text-ink">
                    Cedar source
                  </summary>
                  <pre className="code mt-1 overflow-x-auto whitespace-pre-wrap rounded-control bg-sunken p-2 text-[11px] leading-relaxed text-ink-dim">
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
                className="flex w-full items-center gap-2 rounded-control px-1.5 py-1 text-left hover:bg-raised"
                title="Trace this decision through the scene"
              >
                <DecisionTag decision={decision.decision} />
                <span className="min-w-0 flex-1 truncate text-xs text-ink">
                  {entityId(decision.request.principal)} → {entityId(decision.request.action)}
                </span>
                <span className="numeric text-[11px] text-ink-faint">
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
  if (isError) return <EmptyState title="Authorization unavailable">{HOST.unreachable}</EmptyState>;
  if (!catalog) return <EmptyState title="Loading policies" />;
  const embedded = catalog.engines.find((e) => e.kind === 'embedded-cedar');
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-testid="authorization-explorer">
      <header className="border-b border-line px-3 py-3">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-base font-bold text-ink">Trace a request</h2>
          <IconButton
            label="Close and put the path away"
            onClick={() => useUi.getState().setInspectorOpen(false)}
          >
            <X size={15} />
          </IconButton>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-ink-dim">
          Choose who asks for what, and follow the request across the model to where Cedar allows it
          or stops it. The decision is computed by the Cedar policy engine
          {embedded?.version ? ` (cedar-policy ${embedded.version})` : ''} over the principals and
          resources in its entity store; nothing is scripted.
        </p>
      </header>
      <RequestForm catalog={catalog} />
      <RecentDecisions />
    </div>
  );
}
