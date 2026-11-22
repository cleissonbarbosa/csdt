/**
 * The card of what is selected in the editor: a service, a connection, or,
 * with nothing selected, the platform itself.
 *
 * Every field is a field of the file, under the name the file gives it in
 * `docs/WORKSPACE.md`. A figure the file need not state (a capacity, a rate
 * limit) is off until it is asked for, and then starts from what the engine
 * gave the draft at rest where it gave one, so turning it on changes
 * nothing until the figure is changed. What the engine made of the draft is
 * shown beside the figures as what it is: the engine's, at rest.
 */
import {
  SERVICE_TYPES,
  type Protocol,
  type Relationship,
  type ServiceType,
} from '@aegis/contracts';
import { ArrowRight, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/Button';
import { NumberField, Select, Switch, TextArea, TextField } from '@/components/ui/Field';
import { Section } from '@/components/ui/Section';
import { t } from '@/i18n';
import { formatMs, formatRate } from '@/lib/format';
import { HEALTH_LABEL, RELATIONSHIP_LABEL, SERVICE_TYPE } from '@/lib/palette';
import {
  addRegion,
  connect,
  connectable,
  disconnect,
  draftProblems,
  edgeId,
  PROTOCOLS,
  RELATIONSHIPS,
  removeRegion,
  removeService,
  renameService,
  ROLES,
  setRole,
  updateConnection,
  updateRegion,
  updateService,
  type EdgeDraft,
  type NodeDraft,
  type TopologyDraft,
} from '@/lib/topologyFile';
import { useEditor } from '@/stores/editor';

import { KIND_GLYPH } from './Palette';

const change = (next: (draft: TopologyDraft) => TopologyDraft, key?: string) =>
  useEditor.getState().change(next, key);

/** A figure the file may leave out: off, or on with its value. */
function Optional({
  label,
  hint,
  value,
  start,
  onValue,
  testId,
}: {
  label: string;
  hint: string;
  value: number | null;
  /** What it starts at when turned on. */
  start: number;
  onValue: (value: number | null) => void;
  testId?: string;
}) {
  return (
    <div data-testid={testId}>
      <Switch
        checked={value !== null}
        onCheckedChange={(on) => onValue(on ? start : null)}
        label={label}
        hint={hint}
      />
      {value !== null && (
        <NumberField label={label} hideLabel value={value} onValue={onValue} className="mb-1.5" />
      )}
    </div>
  );
}

/** An id is typed in full and given when the field is left, so a half-typed one renames nothing. */
function IdField({ value, onCommit }: { value: string; onCommit: (id: string) => boolean }) {
  const [text, setText] = useState(value);
  const [refused, setRefused] = useState(false);
  useEffect(() => {
    setText(value);
    setRefused(false);
  }, [value]);
  return (
    <TextField
      label={t('Id')}
      value={text}
      spellCheck={false}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        if (text === value) return;
        const kept = onCommit(text);
        setRefused(!kept);
        if (!kept) setText(value);
      }}
      hint={
        refused
          ? t(
              'Not changed: an id is 1 to 64 letters, digits, "-", "_" or ".", and no other service may have it.',
            )
          : t('What scenarios and recordings name the service by.')
      }
    />
  );
}

function AtRest({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-[11px] leading-snug text-ink-dim">{children}</p>;
}

function ServiceCard({ draft, node }: { draft: TopologyDraft; node: NodeDraft }) {
  const lastRun = useEditor((state) => state.lastRun);
  const run = lastRun?.topology.nodes.find((entry) => entry.id === node.id) ?? null;
  const k = lastRun?.topology.nodes.findIndex((entry) => entry.id === node.id) ?? -1;
  const rps = k >= 0 ? lastRun?.snapshot.nodes.throughputRps[k] : undefined;
  const key = (field: string) => `node:${node.id}:${field}`;
  const set = (patch: Partial<Omit<NodeDraft, 'id'>>, field: string) =>
    change((current) => updateService(current, node.id, patch), key(field));
  const Glyph = KIND_GLYPH[node.type];
  const client = node.type === 'external-client';
  const open = [...connectable(draft, node.id)].filter((id) => id !== node.id);
  const outgoing = draft.edges.filter((edge) => edge.source === node.id);
  const incoming = draft.edges.filter((edge) => edge.target === node.id);
  const nameOf = (id: string) => draft.nodes.find((entry) => entry.id === id)?.name ?? id;
  const roles = ROLES.filter(
    (role) => role.points === 'node' && (role.types.length === 0 || role.types.includes(node.type)),
  );
  const derived = run?.capacityRps ?? 1000;

  return (
    <div data-testid="editor-service-card">
      <header className="flex items-center gap-2 border-b border-line px-3 py-3">
        <Glyph size={16} strokeWidth={1.6} aria-hidden className="text-ink-dim" />
        <h2 className="min-w-0 truncate text-sm font-bold text-ink">{node.name}</h2>
        <span className="ml-auto text-[11px] text-ink-faint">{SERVICE_TYPE[node.type].label}</span>
      </header>

      <Section title={t('The service')}>
        <div className="grid gap-2">
          <TextField
            label={t('Name')}
            value={node.name}
            onChange={(event) => set({ name: event.target.value }, 'name')}
          />
          <IdField
            value={node.id}
            onCommit={(id) => {
              const before = useEditor.getState().draft;
              change((current) => renameService(current, node.id, id));
              const after = useEditor.getState().draft;
              if (after !== before) useEditor.getState().select({ kind: 'node', id });
              return after !== before;
            }}
          />
          <Select
            label={t('Kind')}
            value={node.type}
            onChange={(event) => set({ type: event.target.value as ServiceType }, 'type')}
          >
            {SERVICE_TYPES.map((type) => (
              <option key={type} value={type}>
                {SERVICE_TYPE[type].label}
              </option>
            ))}
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <Select
              label={t('Region')}
              value={node.region}
              onChange={(event) => set({ region: event.target.value }, 'region')}
            >
              {draft.regions.map((region) => (
                <option key={region.id} value={region.id}>
                  {region.name}
                </option>
              ))}
            </Select>
            <NumberField
              label={t('Tier')}
              value={node.tier}
              onValue={(tier) => set({ tier }, 'tier')}
              min={0}
              max={255}
              step={1}
            />
          </div>
        </div>
        {run && (
          <AtRest>
            {t(
              'At rest the engine gives it {rps} requests a second, of a capacity of {capacity}, and finds it {state}.',
              {
                rps: formatRate(rps ?? 0),
                capacity: formatRate(run.capacityRps),
                state: HEALTH_LABEL[run.metrics.health].toLowerCase(),
              },
            )}
          </AtRest>
        )}
      </Section>

      <Section title={t('Figures')}>
        <div className="grid gap-2">
          <NumberField
            label={t('Own latency when idle (ms)')}
            value={node.baseLatencyMs}
            min={0}
            onValue={(baseLatencyMs) =>
              set({ baseLatencyMs: Math.max(0, baseLatencyMs) }, 'latency')
            }
          />
          {client && (
            <NumberField
              label={t('Requests a second it sends')}
              value={node.baseRps ?? 0}
              min={0}
              onValue={(baseRps) => set({ baseRps: Math.max(0, baseRps) }, 'demand')}
            />
          )}
          {!client && (
            <Optional
              label={t('State a capacity')}
              hint={t('Without one the engine sizes it from its load at rest, and says so.')}
              value={node.capacityRps}
              start={Math.round(derived)}
              onValue={(capacityRps) => set({ capacityRps }, 'capacity')}
              testId="editor-capacity"
            />
          )}
        </div>
      </Section>

      {!client && (
        <Section title={t('What it does about load')}>
          <Optional
            label={t('Rate limit (requests a second)')}
            hint={t('Turns away what arrives beyond it, whoever sent it.')}
            value={node.rateLimitRps}
            start={Math.round(derived)}
            onValue={(rateLimitRps) => set({ rateLimitRps }, 'rate-limit')}
            testId="editor-rate-limit"
          />
          <Optional
            label={t('Filter of suspicious traffic (0 to 1)')}
            hint={t('The share of what a scenario marks suspicious it turns away as it arrives.')}
            value={node.suspiciousFilter}
            start={0.9}
            onValue={(suspiciousFilter) =>
              set(
                {
                  suspiciousFilter:
                    suspiciousFilter === null ? null : Math.min(1, Math.max(0, suspiciousFilter)),
                },
                'filter',
              )
            }
          />
          <Switch
            checked={node.autoscale !== null}
            onCheckedChange={(on) =>
              set({ autoscale: on ? { maxFactor: 3, seconds: 20 } : null }, 'autoscale')
            }
            label={t('Autoscale')}
            hint={t('Capacity follows the load, up to a multiple of its capacity at rest.')}
          />
          {node.autoscale && (
            <div className="mb-1.5 grid grid-cols-2 gap-2">
              <NumberField
                label={t('Up to (times)')}
                value={node.autoscale.maxFactor}
                onValue={(maxFactor) =>
                  set({ autoscale: { ...node.autoscale!, maxFactor } }, 'autoscale-factor')
                }
              />
              <NumberField
                label={t('Follows within (s)')}
                value={node.autoscale.seconds}
                onValue={(seconds) =>
                  set({ autoscale: { ...node.autoscale!, seconds } }, 'autoscale-seconds')
                }
              />
            </div>
          )}
        </Section>
      )}

      <Section title={t('Connections')}>
        {outgoing.length + incoming.length === 0 && (
          <p className="text-[11px] text-ink-faint">
            {t('None yet. Carry this piece onto another to connect them.')}
          </p>
        )}
        <ul className="grid gap-1">
          {[...outgoing, ...incoming].map((edge) => {
            const out = edge.source === node.id;
            return (
              <li key={edgeId(edge)}>
                <button
                  type="button"
                  className="flex w-full items-center gap-1.5 rounded-control px-1.5 py-1 text-left text-xs text-ink hover:bg-raised"
                  onClick={() => useEditor.getState().select({ kind: 'edge', id: edgeId(edge) })}
                >
                  <span className="text-ink-dim">{RELATIONSHIP_LABEL[edge.relationship]}</span>
                  {out ? (
                    <ArrowRight size={12} aria-hidden className="text-ink-faint" />
                  ) : (
                    <span className="text-ink-faint">{t('from#connection')}</span>
                  )}
                  <span className="min-w-0 truncate">
                    {nameOf(out ? edge.target : edge.source)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {open.length > 0 && (
          <Select
            label={t('Connect to')}
            value=""
            className="mt-2"
            onChange={(event) => {
              const target = event.target.value;
              const outcome = connect(draft, node.id, target);
              if ('draft' in outcome) {
                change(() => outcome.draft);
                useEditor
                  .getState()
                  .select({ kind: 'edge', id: edgeId({ source: node.id, target }) });
              }
            }}
            data-testid="editor-connect-to"
          >
            <option value="">{t('Choose a service…')}</option>
            {open.map((id) => (
              <option key={id} value={id}>
                {nameOf(id)}
              </option>
            ))}
          </Select>
        )}
      </Section>

      {roles.length > 0 && (
        <Section title={t('Roles')}>
          {roles.map((role) => {
            const holder = draft.roles[role.name];
            const mine = holder === node.id;
            return (
              <Switch
                key={role.name}
                checked={mine}
                onCheckedChange={(on) =>
                  change((current) => setRole(current, role.name, on ? node.id : null))
                }
                label={role.name}
                hint={
                  holder && !mine
                    ? t('{use} Now on {name}.', { use: role.use, name: nameOf(holder) })
                    : role.use
                }
              />
            );
          })}
        </Section>
      )}

      <div className="px-3 py-3">
        <Button
          variant="danger"
          icon={<Trash2 size={13} aria-hidden />}
          onClick={() => change((current) => removeService(current, node.id))}
          data-testid="editor-remove-service"
        >
          {t('Take this service away')}
        </Button>
      </div>
    </div>
  );
}

function ConnectionCard({ draft, edge }: { draft: TopologyDraft; edge: EdgeDraft }) {
  const lastRun = useEditor((state) => state.lastRun);
  const id = edgeId(edge);
  const k = lastRun?.topology.edges.findIndex((entry) => entry.id === id) ?? -1;
  const traffic = k >= 0 ? lastRun?.snapshot.edges.trafficRps[k] : undefined;
  const latency = k >= 0 ? lastRun?.snapshot.edges.latencyMs[k] : undefined;
  const nameOf = (node: string) => draft.nodes.find((entry) => entry.id === node)?.name ?? node;
  const set = (patch: Partial<Omit<EdgeDraft, 'source' | 'target'>>, field: string) =>
    change((current) => updateConnection(current, id, patch), `edge:${id}:${field}`);
  return (
    <div data-testid="editor-connection-card">
      <header className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-3 text-sm font-bold text-ink">
        <span className="min-w-0 truncate">{nameOf(edge.source)}</span>
        <ArrowRight size={14} aria-hidden className="text-ink-faint" />
        <span className="min-w-0 truncate">{nameOf(edge.target)}</span>
      </header>
      <Section title={t('The connection')}>
        <div className="grid gap-2">
          <Select
            label={t('Relationship')}
            value={edge.relationship}
            onChange={(event) =>
              set({ relationship: event.target.value as Relationship }, 'relationship')
            }
          >
            {RELATIONSHIPS.map((relationship) => (
              <option key={relationship} value={relationship}>
                {RELATIONSHIP_LABEL[relationship]}
              </option>
            ))}
          </Select>
          <Select
            label={t('Protocol')}
            value={edge.protocol}
            onChange={(event) => set({ protocol: event.target.value as Protocol }, 'protocol')}
          >
            {PROTOCOLS.map((protocol) => (
              <option key={protocol} value={protocol}>
                {protocol}
              </option>
            ))}
          </Select>
          <NumberField
            label={t('Calls per request')}
            value={edge.weight}
            min={0}
            onValue={(weight) => set({ weight: Math.max(0, weight) }, 'weight')}
          />
          <Optional
            label={t('State how strongly a failure reaches the caller (0 to 1)')}
            hint={t('Without it the relationship decides.')}
            value={edge.criticality}
            start={1}
            onValue={(criticality) =>
              set(
                {
                  criticality: criticality === null ? null : Math.min(1, Math.max(0, criticality)),
                },
                'criticality',
              )
            }
          />
          <Optional
            label={t('State the network latency (ms)')}
            hint={t('Without it: 1.2 ms inside a region, 60 ms across regions.')}
            value={edge.latencyMs}
            start={latency ?? 1.2}
            onValue={(latencyMs) =>
              set({ latencyMs: latencyMs === null ? null : Math.max(0, latencyMs) }, 'latency')
            }
          />
        </div>
        {traffic !== undefined && (
          <AtRest>
            {t('At rest the engine sends {rps} requests a second along it, {ms} each way.', {
              rps: formatRate(traffic),
              ms: formatMs(latency ?? 0),
            })}
          </AtRest>
        )}
      </Section>
      <div className="px-3 py-3">
        <Button
          variant="danger"
          icon={<Trash2 size={13} aria-hidden />}
          onClick={() => change((current) => disconnect(current, id))}
          data-testid="editor-remove-connection"
        >
          {t('Take this connection away')}
        </Button>
      </div>
    </div>
  );
}

function PlatformCard({ draft }: { draft: TopologyDraft }) {
  const problems = draftProblems(draft);
  const set = (patch: Partial<TopologyDraft>, field: string) =>
    change((current) => ({ ...current, ...patch }), `platform:${field}`);
  const holders = Object.entries(draft.roles);
  const nameOf = (id: string) =>
    draft.nodes.find((node) => node.id === id)?.name ??
    draft.regions.find((region) => region.id === id)?.name ??
    id;
  return (
    <div data-testid="editor-platform-card">
      <header className="border-b border-line px-3 py-3">
        <h2 className="text-sm font-bold text-ink">{draft.name || t('Untitled platform')}</h2>
        <p className="mt-0.5 text-[11px] text-ink-faint">
          {t(draft.nodes.length === 1 ? '{n} service' : '{n} services', { n: draft.nodes.length })}
        </p>
      </header>
      {problems.length > 0 && (
        <Section title={t('Before the engine can run it')}>
          <ul className="grid gap-1 text-[11px] leading-snug text-warning">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </Section>
      )}
      <Section title={t('The platform')}>
        <div className="grid gap-2">
          <TextField
            label={t('Name')}
            value={draft.name}
            onChange={(event) => set({ name: event.target.value }, 'name')}
          />
          <TextField
            label={t('Id')}
            value={draft.id}
            spellCheck={false}
            onChange={(event) => set({ id: event.target.value }, 'id')}
          />
          <TextArea
            label={t('Description')}
            value={draft.description}
            onChange={(event) => set({ description: event.target.value }, 'description')}
          />
        </div>
      </Section>
      <Section
        title={t('Regions')}
        aside={
          <Button
            size="sm"
            variant="ghost"
            icon={<Plus size={12} aria-hidden />}
            onClick={() => change((current) => addRegion(current).draft)}
          >
            {t('Add a region')}
          </Button>
        }
      >
        <ul className="grid gap-3">
          {draft.regions.map((region) => {
            const count = draft.nodes.filter((node) => node.region === region.id).length;
            const setRegion = (patch: Parameters<typeof updateRegion>[2], field: string) =>
              change(
                (current) => updateRegion(current, region.id, patch),
                `region:${region.id}:${field}`,
              );
            return (
              <li key={region.id} className="grid gap-1.5">
                <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                  <TextField
                    label={t('Name')}
                    hint={t('Its id is {id}.', { id: region.id })}
                    value={region.name}
                    onChange={(event) => setRegion({ name: event.target.value }, 'name')}
                  />
                  <Select
                    label={t('Kind of region')}
                    hideLabel
                    value={region.kind}
                    onChange={(event) =>
                      setRegion({ kind: event.target.value as 'cloud' | 'edge' }, 'kind')
                    }
                  >
                    <option value="cloud">{t('Cloud region')}</option>
                    <option value="edge">{t('Global edge')}</option>
                  </Select>
                </div>
                <p className="flex items-center justify-between gap-2 text-[11px] text-ink-faint">
                  {count === 0
                    ? t(
                        'No service yet: carry one past the last lane, or choose this region on its card.',
                      )
                    : t(count === 1 ? '{n} service' : '{n} services', { n: count })}
                  {count === 0 && draft.regions.length > 1 && (
                    <button
                      type="button"
                      className="text-ink-dim underline-offset-2 hover:underline"
                      onClick={() => change((current) => removeRegion(current, region.id))}
                    >
                      {t('Take it away')}
                    </button>
                  )}
                </p>
              </li>
            );
          })}
        </ul>
      </Section>
      <Section title={t('Roles')}>
        {holders.length === 0 ? (
          <p className="text-[11px] leading-snug text-ink-faint">
            {t(
              'None yet. The bundled incidents and the request tracer ask for roles: give them on a service’s card.',
            )}
          </p>
        ) : (
          <ul className="grid gap-1 text-xs">
            {holders.map(([role, holder]) => (
              <li key={role} className="flex items-baseline justify-between gap-2">
                <span className="code text-[11px]">{role}</span>
                <span className="min-w-0 truncate text-ink-dim">{nameOf(holder)}</span>
              </li>
            ))}
          </ul>
        )}
        {draft.regions.length > 1 && (
          <div className="mt-2 grid gap-2">
            {ROLES.filter((role) => role.points === 'region').map((role) => (
              <Select
                key={role.name}
                label={role.name}
                value={draft.roles[role.name] ?? ''}
                onChange={(event) =>
                  change((current) => setRole(current, role.name, event.target.value || null))
                }
              >
                <option value="">{t('None')}</option>
                {draft.regions.map((region) => (
                  <option key={region.id} value={region.id}>
                    {region.name}
                  </option>
                ))}
              </Select>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

export function EditorCard() {
  const draft = useEditor((state) => state.draft);
  const selection = useEditor((state) => state.selection);
  if (!draft) return null;
  if (selection?.kind === 'node') {
    const node = draft.nodes.find((entry) => entry.id === selection.id);
    if (node) return <ServiceCard key={node.id} draft={draft} node={node} />;
  }
  if (selection?.kind === 'edge') {
    const edge = draft.edges.find((entry) => edgeId(entry) === selection.id);
    if (edge) return <ConnectionCard key={selection.id} draft={draft} edge={edge} />;
  }
  return <PlatformCard draft={draft} />;
}
