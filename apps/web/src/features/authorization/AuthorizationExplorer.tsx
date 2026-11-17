import type { AuthorizationCatalog, AuthorizationDecision } from '@aegis/contracts';
import { useQuery } from '@tanstack/react-query';
import { Check, GitCompareArrows, Grid3x3, PencilLine, Play, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { actions } from '@/app/actions';
import { evaluationTime, HOST } from '@/app/host';
import { queryKeys } from '@/app/queryClient';
import { Badge, DecisionTag, SourceBadge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { Segmented, Select, Switch } from '@/components/ui/Field';
import { EmptyState, Section } from '@/components/ui/Section';
import { cn } from '@/lib/cn';
import {
  compare,
  contextRows,
  policyFingerprint,
  requestOf,
  staleReasons,
  type EngineChoice,
  type Evaluation,
  type EvaluationInputs,
} from '@/lib/evaluation';
import { entityId, formatClock } from '@/lib/format';
import { nodeLabels } from '@/lib/names';
import { api, ApiError } from '@/providers/api';
import { useTelemetry } from '@/stores/telemetry';
import { useUi } from '@/stores/ui';

import { PolicyByPolicy } from './PolicyByPolicy';

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

/** The configuration a decision answers, written out under it. */
function EvaluatedWith({
  decision,
  catalog,
  policyCount,
  action,
}: {
  decision: AuthorizationDecision;
  catalog: AuthorizationCatalog;
  policyCount: number;
  /**
   * What can be done with this configuration and its answer. It sits here,
   * on the card's own surface: the header is the incident colour when Cedar
   * denied, and quiet ink cannot be read on it.
   */
  action?: ReactNode;
}) {
  const rows = contextRows(decision.request.context, catalog.contextKeys);
  const off = decision.disabledPolicies;
  return (
    <div className="mt-3" data-testid="decision-inputs">
      <div className="mb-1 flex min-h-6 items-center justify-between gap-2">
        <p className="caption">Evaluated with</p>
        {action}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
        {rows.map((row) => (
          <div key={row.key} className="contents">
            <dt className="text-ink-faint">{row.label}</dt>
            <dd
              className={cn('numeric', row.value === 'absent' ? 'text-ink-faint' : 'text-ink')}
              data-testid={`decision-context-${row.key}`}
            >
              {row.value}
            </dd>
          </div>
        ))}
        <dt className="text-ink-faint">Policies</dt>
        <dd className="text-ink" data-testid="decision-policies-used">
          {decision.engine.kind === 'cedar-agent' ? (
            "the agent's own policy store"
          ) : (
            <>
              <span className="numeric">
                {policyCount - off.length} of {policyCount}
              </span>{' '}
              active
              {off.length > 0 && (
                <>
                  ; off: <span className="code">{off.join(', ')}</span>
                </>
              )}
            </>
          )}
        </dd>
      </dl>
    </div>
  );
}

function DecisionCard({
  evaluation,
  catalog,
  stale,
  aside,
}: {
  evaluation: Evaluation;
  catalog: AuthorizationCatalog;
  /** Why this no longer answers what the form holds; empty when it does. */
  stale: string[];
  aside?: ReactNode;
}) {
  const { decision } = evaluation;
  const topology = useTelemetry((state) => state.topology);
  const names = useMemo(() => (topology ? nodeLabels(topology) : null), [topology]);
  const traced = useUi((state) => state.tracedDecision?.id === decision.id);
  const tracing = useUi((state) => state.tracing) && traced;
  const allowed = decision.decision === 'allow';
  const outdated = stale.length > 0;
  const nameOf = (id: string) => names?.get(id) ?? id;
  return (
    <div
      className={cn(
        'overflow-hidden rounded-control border',
        // A decision that answers something else is not the event any more:
        // it loses the incident colour and its firm edge.
        outdated
          ? 'border-dashed border-line-strong'
          : allowed
            ? 'border-line-strong'
            : 'border-critical',
      )}
      data-testid="decision-card"
      data-decision={decision.decision}
      data-stale={outdated}
      aria-live="polite"
    >
      {outdated && (
        <div
          className="border-b border-dashed border-line-strong bg-sunken px-3 py-2"
          role="status"
          data-testid="decision-stale"
        >
          <p className="text-xs font-bold text-ink">Configuration changed. Evaluate again.</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-ink-dim">
            The result below answers the earlier configuration, not the one in the form.
          </p>
          <ul className="mt-1 space-y-0.5 text-[11px] text-ink-dim" data-testid="decision-changes">
            {stale.map((reason) => (
              <li key={reason}>{reason}.</li>
            ))}
          </ul>
        </div>
      )}
      {/* The request the viewer is following either arrived or was stopped.
          Stopped is the event: it takes the incident colour, and a cross,
          and the solid form, so it is not told from Allow by hue alone. */}
      <div
        className={cn(
          'flex items-center justify-between gap-2 px-3 py-2',
          outdated
            ? 'border-b border-line text-ink-faint'
            : allowed
              ? 'border-b border-line text-ink'
              : 'bg-critical text-on-accent',
        )}
      >
        <div className="flex items-center gap-2">
          {allowed ? <Check size={18} aria-hidden /> : <X size={18} aria-hidden />}
          <span className="text-lg font-bold leading-none" data-testid="decision-result">
            {outdated && <span className="text-xs font-normal">Was </span>}
            {allowed ? 'Allow' : 'Deny'}
          </span>
        </div>
        <span className="flex items-center gap-1">
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
        </span>
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

        <PolicyByPolicy decision={decision} catalog={catalog} />

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

        <EvaluatedWith
          decision={decision}
          catalog={catalog}
          policyCount={evaluation.policyCount}
          action={aside}
        />

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

function Verdict({ decision }: { decision: 'allow' | 'deny' }) {
  const allowed = decision === 'allow';
  return (
    <span className={cn('inline-flex items-center gap-1 font-bold', !allowed && 'text-critical')}>
      {allowed ? <Check size={13} aria-hidden /> : <X size={13} aria-hidden />}
      {allowed ? 'Allow' : 'Deny'}
    </span>
  );
}

/**
 * Two evaluations side by side: the one kept, and the latest. Both are
 * Cedar's answers as they came back; this only lays them next to each other
 * and says in what their configurations differ.
 */
function ComparisonSection({
  a,
  b,
  catalog,
  onClear,
}: {
  a: Evaluation;
  b: Evaluation | null;
  catalog: AuthorizationCatalog;
  onClear: () => void;
}) {
  const labels = useMemo(
    () => ({ context: Object.fromEntries(catalog.contextKeys.map((k) => [k.key, k.label])) }),
    [catalog.contextKeys],
  );
  const result = b ? compare(a, b, labels) : null;
  const contextA = contextRows(a.decision.request.context, catalog.contextKeys);
  const contextB = b ? contextRows(b.decision.request.context, catalog.contextKeys) : null;
  const policies = (side: Evaluation) =>
    side.decision.determiningPolicies.length > 0 ? (
      <span className="code break-words">{side.decision.determiningPolicies.join(', ')}</span>
    ) : (
      <span className="text-ink-faint">none: denied by default</span>
    );
  const off = (side: Evaluation) =>
    side.decision.disabledPolicies.length > 0 ? (
      <span className="code break-words">{side.decision.disabledPolicies.join(', ')}</span>
    ) : (
      <span className="text-ink-faint">none</span>
    );
  const cell = 'min-w-0 px-2 py-1 align-top';
  const pending = <span className="text-ink-faint">not evaluated yet</span>;
  return (
    <Section
      title="Comparison"
      aside={
        <Button size="sm" variant="ghost" onClick={onClear} data-testid="comparison-clear">
          Clear
        </Button>
      }
    >
      <p className="mb-2 text-[11px] leading-relaxed text-ink-dim" data-testid="comparison-verdict">
        {!result
          ? 'A is kept. Change the context or switch a policy, then evaluate: the new result appears here as B.'
          : !result.sameRequest
            ? 'A and B are different requests, so the two decisions answer different questions.'
            : result.decisionChanged
              ? `The decision changed from ${a.decision.decision === 'allow' ? 'Allow' : 'Deny'} to ${b!.decision.decision === 'allow' ? 'Allow' : 'Deny'}.`
              : 'The decision is the same on both sides.'}
      </p>
      <table className="w-full table-fixed border-collapse text-[11px]" data-testid="comparison">
        <thead>
          <tr className="text-left text-ink-faint">
            <th className="w-[6.5rem] py-1 font-normal" />
            <th className={cn(cell, 'font-bold text-ink')}>
              A{' '}
              <span className="numeric font-normal">
                at {formatClock(a.decision.virtualTimeMs)}
              </span>
            </th>
            <th className={cn(cell, 'font-bold text-ink')}>
              B{' '}
              {b && (
                <span className="numeric font-normal">
                  at {formatClock(b.decision.virtualTimeMs)}
                </span>
              )}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line border-y border-line">
          <tr>
            <th scope="row" className="py-1 text-left font-normal text-ink-faint">
              Decision
            </th>
            <td className={cell} data-testid="comparison-a">
              <Verdict decision={a.decision.decision} />
            </td>
            <td className={cell} data-testid="comparison-b">
              {b ? <Verdict decision={b.decision.decision} /> : pending}
            </td>
          </tr>
          <tr>
            <th scope="row" className="py-1 text-left font-normal text-ink-faint">
              Decided by
            </th>
            <td className={cell}>{policies(a)}</td>
            <td className={cell}>{b ? policies(b) : pending}</td>
          </tr>
          {contextA.map((row, i) => {
            const other = contextB?.[i]?.value;
            const differs = other !== undefined && other !== row.value;
            return (
              <tr key={row.key} className={differs ? 'font-bold' : undefined}>
                {/* In the form's own words, as the card above has them: a
                    key cut to `changeWind…` names nothing. */}
                <th
                  scope="row"
                  className="py-1 text-left font-normal text-ink-faint"
                  title={`context.${row.key}`}
                >
                  {row.label}
                </th>
                <td className={cn(cell, 'numeric text-ink')}>{row.value}</td>
                <td className={cn(cell, 'numeric text-ink')}>{other ?? ''}</td>
              </tr>
            );
          })}
          <tr>
            <th scope="row" className="py-1 text-left font-normal text-ink-faint">
              Policies off
            </th>
            <td className={cell}>{off(a)}</td>
            <td className={cell}>{b ? off(b) : ''}</td>
          </tr>
        </tbody>
      </table>
      {result && (
        <div className="mt-2 text-[11px] leading-relaxed text-ink-dim">
          <p className="caption mb-0.5">What differs from A to B</p>
          {result.differences.length > 0 ? (
            <ul className="space-y-0.5" data-testid="comparison-differences">
              {result.differences.map((line) => (
                <li key={line}>{line}.</li>
              ))}
            </ul>
          ) : (
            <p>Nothing: the same request under the same context and policies.</p>
          )}
          {result.sameRequest && (result.onlyInA.length > 0 || result.onlyInB.length > 0) && (
            <p className="mt-1" data-testid="comparison-attribution">
              {result.onlyInA.length > 0 && (
                <>
                  Only A is decided by <span className="code">{result.onlyInA.join(', ')}</span>
                  .{' '}
                </>
              )}
              {result.onlyInB.length > 0 && (
                <>
                  Only B is decided by <span className="code">{result.onlyInB.join(', ')}</span>.
                </>
              )}
            </p>
          )}
        </div>
      )}
    </Section>
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
  const [engine, setEngine] = useState<EngineChoice>('embedded');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Evaluation | null>(null);
  // An evaluation kept aside, to set the next one against.
  const [kept, setKept] = useState<Evaluation | null>(null);

  // Keep the resource valid for the chosen action.
  useEffect(() => {
    if (!resources.some((r) => r.uid === resource)) setResource(resources[0]?.uid ?? '');
  }, [resources, resource]);

  const agent = catalog.engines.find((e) => e.kind === 'cedar-agent');
  const agentAvailable = agent?.available ?? false;
  useEffect(() => {
    if (!agentAvailable && engine === 'cedar-agent') setEngine('embedded');
  }, [agentAvailable, engine]);

  // A policy that is no longer loaded cannot stay switched off.
  useEffect(() => {
    setDisabled((current) => {
      const known = current.filter((id) => catalog.policies.some((policy) => policy.id === id));
      return known.length === current.length ? current : known;
    });
  }, [catalog.policies]);

  // A request handed over from elsewhere (a guided challenge, a link).
  const preset = useUi((state) => state.authorizationPreset);
  useEffect(() => {
    if (!preset) return;
    if (catalog.principals.some((p) => p.uid === preset.principal)) setPrincipal(preset.principal);
    if (catalog.actions.some((a) => a.uid === preset.action)) setAction(preset.action);
    if (catalog.resources.some((r) => r.uid === preset.resource)) setResource(preset.resource);
    setContext(
      Object.fromEntries(
        Object.entries(preset.context ?? {})
          .filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean')
          .map(([key, value]) => [key, value ? 'true' : 'false']),
      ),
    );
    // The policies the request was asked without, where it says: a cell of
    // the access matrix is followed under the policies it was counted with.
    setDisabled(
      (preset.disabledPolicies ?? []).filter((id) =>
        catalog.policies.some((policy) => policy.id === id),
      ),
    );
    useUi.getState().presetAuthorization(null);
  }, [preset, catalog]);

  /** What the form holds right now: what the next evaluation will be made with. */
  const inputs = useMemo<EvaluationInputs>(
    () => ({
      principal,
      action,
      resource,
      context: Object.fromEntries(
        Object.entries(context)
          .filter(([, value]) => value !== 'absent')
          .map(([key, value]) => [key, value === 'true']),
      ),
      disabled: engine === 'embedded' ? [...disabled].sort() : [],
      engine,
    }),
    [principal, action, resource, context, disabled, engine],
  );
  const labels = useMemo(
    () => ({ context: Object.fromEntries(catalog.contextKeys.map((k) => [k.key, k.label])) }),
    [catalog.contextKeys],
  );
  const stale = useMemo(
    () => (result ? staleReasons(result, inputs, catalog, labels) : []),
    [result, inputs, catalog, labels],
  );
  const current = result !== null && stale.length === 0;

  const submit = async () => {
    setBusy(true);
    setError(null);
    const made = inputs;
    const outcome = await actions.evaluate(requestOf(made));
    setBusy(false);
    if (outcome instanceof ApiError) {
      setError(outcome.message);
      setResult(null);
    } else {
      setResult({
        decision: outcome,
        inputs: made,
        policies: policyFingerprint(catalog),
        policyCount: catalog.policies.length,
      });
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
          {/* A fieldset is as wide as its content unless told otherwise. */}
          <fieldset className="min-w-0" hidden={catalog.contextKeys.length === 0}>
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
            {busy ? 'Evaluating…' : result && !current ? 'Evaluate again' : 'Evaluate with Cedar'}
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
          <DecisionCard
            evaluation={result}
            catalog={catalog}
            stale={stale}
            aside={
              current && kept?.decision.id !== result.decision.id ? (
                <button
                  type="button"
                  onClick={() => setKept(result)}
                  className="inline-flex items-center gap-1 text-[11px] text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink"
                  title="Keep this result, change the context or the policies, and evaluate again to see the two side by side"
                  data-testid="decision-keep"
                >
                  <GitCompareArrows size={12} aria-hidden /> Keep to compare
                </button>
              ) : null
            }
          />
        </Section>
      )}

      {kept && (
        <ComparisonSection
          a={kept}
          b={current && result.decision.id !== kept.decision.id ? result : null}
          catalog={catalog}
          onClear={() => setKept(null)}
        />
      )}

      <Section
        title="Policies"
        aside={
          <span className="numeric text-[11px] text-ink-faint">
            {catalog.policies.length - disabled.length}/{catalog.policies.length} active
          </span>
        }
      >
        <div className="mb-2 flex flex-wrap gap-1.5">
          <Button
            size="sm"
            icon={<Grid3x3 size={12} aria-hidden />}
            onClick={() => useUi.getState().setPanel('matrix')}
            data-testid="open-matrix"
          >
            Who may do what
          </Button>
          <Button
            size="sm"
            icon={<PencilLine size={12} aria-hidden />}
            onClick={() => useUi.getState().setPanel('policies')}
            data-testid="open-policy-editor"
          >
            Edit the policies
          </Button>
        </div>
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
            // Only a result that answers the form says which policies decide.
            const determining = current && result.decision.determiningPolicies.includes(policy.id);
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
