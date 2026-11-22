/**
 * A Cedar policy written as a sentence, added to the policies being edited.
 *
 * The sentence is made of choices the files in use offer (`lib/policySentence.ts`):
 * who from the catalogue and the groups the entity store gives them, what
 * from the catalogue's actions, on what from its resources and their types,
 * and conditions from its context keys (and the tenant, where the entity
 * store gives every principal and resource one). What it adds is the text
 * shown under it, which is the policy: the editor checks it with Cedar and
 * says what it changes before anything is applied. It reads no policy.
 */
import type { AuthorizationCatalog } from '@aegis/contracts';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Segmented, Select, TextField } from '@/components/ui/Field';
import { t } from '@/i18n';
import { tr } from '@/i18n/rich';
import {
  allHave,
  blankSentence,
  groupsOf,
  readEntities,
  sentenceAsCedar,
  suggestedId,
  typesOf,
  uidText,
  type On,
  type Sentence,
  type What,
  type Who,
} from '@/lib/policySentence';

/** A choice of a sentence's select, by a value that says which kind it is. */
const ANY = 'any';

function whoValue(who: Who): string {
  return who.kind === 'anyone' ? ANY : `${who.kind}|${who.uid}`;
}
function readWho(value: string): Who {
  const [kind, uid] = value.split(/\|(.*)/s) as [string, string | undefined];
  if (kind === 'one' && uid) return { kind: 'one', uid };
  if (kind === 'member' && uid) return { kind: 'member', uid };
  return { kind: 'anyone' };
}
function onValue(on: On): string {
  return on.kind === 'anything' ? ANY : on.kind === 'type' ? `type|${on.type}` : `one|${on.uid}`;
}
function readOn(value: string): On {
  const [kind, rest] = value.split(/\|(.*)/s) as [string, string | undefined];
  if (kind === 'type' && rest) return { kind: 'type', type: rest };
  if (kind === 'one' && rest) return { kind: 'one', uid: rest };
  return { kind: 'anything' };
}

const CONDITION = [
  { value: 'when' as const, label: t('Only when these hold') },
  { value: 'unless' as const, label: t('Except when these hold') },
];

export function PolicySentence({
  catalog,
  entitiesText,
  taken,
  onAdd,
}: {
  catalog: AuthorizationCatalog;
  /** The entity store in use, as its file holds it. */
  entitiesText: string;
  /** Ids already given to a policy, which a new one may not take. */
  taken: readonly string[];
  onAdd: (policy: string, id: string) => void;
}) {
  const [sentence, setSentence] = useState<Sentence>(blankSentence);
  // The id follows the sentence until it is typed in by hand.
  const [idTyped, setIdTyped] = useState(false);
  const entities = useMemo(() => readEntities(entitiesText), [entitiesText]);
  const principals = catalog.principals.map((principal) => principal.uid);
  const resources = catalog.resources.map((resource) => resource.uid);
  const groups = useMemo(() => groupsOf(entities, principals), [entities, principals]);
  const types = typesOf(resources);
  const tenants = allHave(entities, principals, 'tenant') && allHave(entities, resources, 'tenant');
  const id = idTyped ? sentence.id : suggestedId(sentence, taken);
  const policy = sentenceAsCedar({ ...sentence, id });
  const set = (patch: Partial<Sentence>) => setSentence((current) => ({ ...current, ...patch }));
  const conditions = sentence.ownTenant || sentence.context.length > 0;
  const idFree = id.trim() !== '' && !taken.includes(id.trim());

  const effect = (
    <Select
      label={t('Permit or forbid')}
      hideLabel
      quiet
      fit
      value={sentence.effect}
      onChange={(event) => set({ effect: event.target.value as Sentence['effect'] })}
      data-testid="sentence-effect"
    >
      <option value="permit">{t('Permit')}</option>
      <option value="forbid">{t('Forbid')}</option>
    </Select>
  );
  const who = (
    <Select
      label={t('Who')}
      hideLabel
      quiet
      fit
      value={whoValue(sentence.who)}
      onChange={(event) => set({ who: readWho(event.target.value) })}
      data-testid="sentence-who"
    >
      <option value={ANY}>{t('anyone')}</option>
      {groups.length > 0 && (
        <optgroup label={t('A group, as the entity store has it')}>
          {groups.map((group) => (
            <option key={uidText(group)} value={`member|${uidText(group)}`}>
              {t('members of {group}', { group: `${group.type} ${group.id}` })}
            </option>
          ))}
        </optgroup>
      )}
      <optgroup label={t('One principal')}>
        {catalog.principals.map((principal) => (
          <option key={principal.uid} value={`one|${principal.uid}`}>
            {principal.label}
          </option>
        ))}
      </optgroup>
    </Select>
  );
  const what = (
    <Select
      label={t('To do what')}
      hideLabel
      quiet
      fit
      value={sentence.what.kind === 'anything' ? ANY : sentence.what.uid}
      onChange={(event) =>
        set({
          what: (event.target.value === ANY
            ? { kind: 'anything' }
            : { kind: 'one', uid: event.target.value }) satisfies What,
        })
      }
      data-testid="sentence-what"
    >
      <option value={ANY}>{t('do anything')}</option>
      {catalog.actions.map((action) => (
        <option key={action.uid} value={action.uid}>
          {action.label}
        </option>
      ))}
    </Select>
  );
  const on = (
    <Select
      label={t('On what')}
      hideLabel
      quiet
      fit
      value={onValue(sentence.on)}
      onChange={(event) => set({ on: readOn(event.target.value) })}
      data-testid="sentence-on"
    >
      <option value={ANY}>{t('anything')}</option>
      <optgroup label={t('Every resource of a type')}>
        {types.map((type) => (
          <option key={type} value={`type|${type}`}>
            {t('any {type}', { type })}
          </option>
        ))}
      </optgroup>
      <optgroup label={t('One resource')}>
        {catalog.resources.map((resource) => (
          <option key={resource.uid} value={`one|${resource.uid}`}>
            {resource.label}
          </option>
        ))}
      </optgroup>
    </Select>
  );

  return (
    <section
      className="rounded-control border border-line p-3"
      aria-labelledby="policy-sentence-title"
      data-testid="policy-sentence"
    >
      <h3 id="policy-sentence-title" className="text-xs font-bold text-ink">
        {t('Write one as a sentence')}
      </h3>
      <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-ink">
        {tr('{effect} {who} to {what} on {on}', { effect, who, what, on })}
      </div>

      <fieldset className="mt-2.5">
        <legend className="text-[11px] text-ink-dim">{t('Conditions')}</legend>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {tenants && (
            <label className="flex items-center gap-1.5 text-xs text-ink">
              <input
                type="checkbox"
                checked={sentence.ownTenant}
                onChange={(event) => set({ ownTenant: event.target.checked })}
                data-testid="sentence-tenant"
              />
              {t('the resource is of the principal’s own tenant')}
            </label>
          )}
          {catalog.contextKeys.map((key) => (
            <label
              key={key.key}
              className="flex items-center gap-1.5 text-xs text-ink"
              title={key.description}
            >
              <input
                type="checkbox"
                checked={sentence.context.includes(key.key)}
                onChange={(event) =>
                  set({
                    context: event.target.checked
                      ? [...sentence.context, key.key]
                      : sentence.context.filter((entry) => entry !== key.key),
                  })
                }
              />
              {key.label}
            </label>
          ))}
        </div>
        {conditions && (
          <div className="mt-1.5">
            <Segmented
              label={t('What the conditions do')}
              value={sentence.condition}
              options={CONDITION}
              onChange={(condition) => set({ condition })}
              size="sm"
              testId="sentence-condition"
            />
          </div>
        )}
      </fieldset>

      <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
        <TextField
          label={t('Its id')}
          value={id}
          spellCheck={false}
          onChange={(event) => {
            setIdTyped(true);
            set({ id: event.target.value });
          }}
          hint={idFree ? undefined : t('Another policy goes by this id.')}
          data-testid="sentence-id"
        />
        <TextField
          label={t('What it is for, in a sentence')}
          value={sentence.description}
          onChange={(event) => set({ description: event.target.value })}
        />
      </div>

      <pre
        className="code mt-2.5 overflow-x-auto whitespace-pre-wrap rounded-control border border-line bg-sunken p-2 text-[11px] leading-relaxed text-ink"
        data-testid="sentence-cedar"
      >
        {policy}
      </pre>
      <div className="mt-2 flex items-center gap-2">
        <Button
          size="sm"
          icon={<Plus size={12} aria-hidden />}
          disabled={!idFree}
          onClick={() => {
            onAdd(policy, id.trim());
            setSentence(blankSentence());
            setIdTyped(false);
          }}
          data-testid="sentence-add"
        >
          {t('Add it to the policies')}
        </Button>
        <span className="text-[11px] text-ink-faint">
          {t('Cedar checks it with the rest before anything is applied.')}
        </span>
      </div>
    </section>
  );
}
