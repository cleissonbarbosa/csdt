/**
 * What to bring from a cloud inventory among the staged files.
 *
 * Everything on show is the server's reading of the file (its survey): what
 * there is to choose from, each with how many resources have it, and what
 * the selection in the file brings and leaves. A choice made here is
 * written into the file's own selection and the file is read again, so what
 * is applied is a file that says of itself what it was narrowed to.
 */
import type { InventorySelection, InventorySurvey } from '@aegis/contracts';
import { RotateCcw, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { Button, IconButton } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Select, Switch, TextField } from '@/components/ui/Field';
import { t } from '@/i18n';
import { tr } from '@/i18n/rich';
import { SERVICE_TYPE } from '@/lib/palette';

import { PROVIDER_NAME } from './cloudCommand';
import {
  EVERYTHING,
  asksForEverything,
  drawsNetworkRules,
  toggled,
  withExcluded,
  withNetworkRules,
  withTag,
} from './inventory';

/** Most resources listed one by one before the list asks to be searched. */
const LISTED = 50;
/** Most connections left out for running in a circle that are named. */
const CIRCLES_NAMED = 5;
/** How long the name waits for the next letter before it is asked for. */
const TYPING_MS = 300;

function Count({ children }: { children: number }) {
  return <span className="numeric opacity-70">{children}</span>;
}

/** Several things to choose between, each with how many resources have it. */
function Facets({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="mt-2.5">
      <p className="caption mb-1">{label}</p>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

export function InventoryFilters({
  survey,
  onSelect,
}: {
  survey: InventorySurvey;
  /** Hands on the selection the file should carry from now on. */
  onSelect: (selection: InventorySelection) => void;
}) {
  // What was chosen shows at once; what it brings follows when the server
  // has read the file again.
  const [selection, setSelection] = useState(survey.selection);
  const latest = useRef(survey.selection);
  const hand = useRef(onSelect);
  useEffect(() => {
    hand.current = onSelect;
  }, [onSelect]);
  const change = useCallback((part: Partial<InventorySelection>) => {
    const next = { ...latest.current, ...part };
    latest.current = next;
    setSelection(next);
    hand.current(next);
  }, []);

  const [name, setName] = useState(survey.selection.name ?? '');
  useEffect(() => {
    const wanted = name.trim() || null;
    if (wanted === (latest.current.name ?? null)) return;
    const timer = setTimeout(() => change({ name: wanted }), TYPING_MS);
    return () => clearTimeout(timer);
  }, [name, change]);

  const [tagKey, setTagKey] = useState(survey.selection.tags[0]?.key ?? '');
  const tag = survey.tags.find((one) => one.key === tagKey);
  const asked = selection.tags.find((one) => one.key === tagKey);
  const [search, setSearch] = useState('');

  const { kept, leftOut } = survey;
  const notBrought = [
    leftOut.unselected > 0 && t('{n} that the filters do not ask for', { n: leftOut.unselected }),
    leftOut.excluded > 0 && t('{n} left out by hand', { n: leftOut.excluded }),
    leftOut.unconnected > 0 && t('{n} that no connection touches', { n: leftOut.unconnected }),
  ].filter((part): part is string => part !== false);
  const circles = leftOut.circular
    .slice(0, CIRCLES_NAMED)
    .map((pair) => t('{from} to {to}', { from: pair.from, to: pair.to }));
  if (leftOut.circular.length > CIRCLES_NAMED) {
    circles.push(t('{n} more', { n: leftOut.circular.length - CIRCLES_NAMED }));
  }
  const rows: [string, string][] = [
    [
      t('Resources brought'),
      t('{kept} of {total}', { kept: kept.resources, total: survey.resources }),
    ],
    [
      t('Connections drawn'),
      t('{kept} of {total}', { kept: kept.relations, total: survey.relations }),
    ],
    [
      t('Where clients enter'),
      t(kept.entries === 1 ? '{n} resource' : '{n} resources', { n: kept.entries }),
    ],
  ];
  if (notBrought.length > 0) rows.push([t('Not brought'), notBrought.join(', ')]);
  if (circles.length > 0) {
    rows.push([t('Left out so that calls run one way'), circles.join(', ')]);
  }

  const rules = survey.bases.find((basis) => basis.value === 'network')?.count ?? 0;
  const wanted = search.trim().toLowerCase();
  const found = survey.listed.filter(
    (item) =>
      wanted === '' ||
      item.name.toLowerCase().includes(wanted) ||
      item.id.toLowerCase().includes(wanted),
  );

  return (
    <section
      aria-label={t('What to bring from {file}', { file: survey.path })}
      className="mt-3 rounded-control border border-line p-3"
      data-testid="inventory-filters"
    >
      <p className="text-xs leading-relaxed text-ink">
        {tr('<c>{file}</c> is an inventory of {provider}.', {
          c: (children) => <span className="code">{children}</span>,
          file: survey.path,
          provider: PROVIDER_NAME[survey.provider],
        })}{' '}
        {survey.collectedAt && (
          <span className="text-ink-dim">
            {/* When, as the file wrote it. */}
            {tr('Read <n>{when}</n>.', {
              n: (children) => <span className="numeric">{children}</span>,
              when: survey.collectedAt,
            })}
          </span>
        )}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-ink-dim">
        {t(
          'Its resources and the connections the provider states between them are read as a platform. Choose what to bring: each choice is written into the file, and what it brings is counted again.',
        )}
      </p>

      <dl
        className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]"
        data-testid="inventory-kept"
      >
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-ink">{label}</dt>
            <dd className="numeric min-w-0 break-words text-ink-dim">{value}</dd>
          </div>
        ))}
      </dl>

      {survey.regions.length > 1 && (
        <Facets label={t('Regions')}>
          {survey.regions.map((region) => (
            <Chip
              key={region.value}
              active={selection.regions?.includes(region.value) ?? false}
              onClick={() => change({ regions: toggled(latest.current.regions, region.value) })}
            >
              <span className="code truncate">{region.value}</span>
              <Count>{region.count}</Count>
            </Chip>
          ))}
        </Facets>
      )}
      {survey.networks.length > 1 && (
        <Facets label={t('Networks')}>
          {survey.networks.map((network) => (
            <Chip
              key={network.value ?? ''}
              active={selection.networks?.includes(network.value) ?? false}
              onClick={() => change({ networks: toggled(latest.current.networks, network.value) })}
            >
              {network.value === null ? (
                t('In no network')
              ) : (
                <span className="code truncate">{network.value}</span>
              )}
              <Count>{network.count}</Count>
            </Chip>
          ))}
        </Facets>
      )}
      {survey.kinds.length > 1 && (
        <Facets label={t('Kinds of service')}>
          {survey.kinds.map((kind) => (
            <Chip
              key={kind.value}
              active={selection.kinds?.includes(kind.value) ?? false}
              onClick={() => change({ kinds: toggled(latest.current.kinds, kind.value) })}
            >
              {SERVICE_TYPE[kind.value].label}
              <Count>{kind.count}</Count>
            </Chip>
          ))}
        </Facets>
      )}

      {survey.tags.length > 0 && (
        <div className="mt-2.5" data-testid="inventory-tags">
          <div className="flex flex-wrap items-end gap-2">
            <Select
              label={t('Tag')}
              value={tagKey}
              onChange={(event) => setTagKey(event.target.value)}
              className="w-44"
            >
              <option value="">{t('Choose a tag')}</option>
              {survey.tags.map((one) => (
                <option key={one.key} value={one.key}>
                  {`${one.key} (${one.count})`}
                </option>
              ))}
            </Select>
            {selection.tags.map((filter) => (
              <button
                key={filter.key}
                type="button"
                aria-label={t('Stop asking for the tag {key}', { key: filter.key })}
                onClick={() =>
                  change({ tags: latest.current.tags.filter((one) => one.key !== filter.key) })
                }
                className="mb-1 inline-flex h-6 max-w-full items-center gap-1 rounded-control border border-line-strong px-1.5 text-[11px] text-ink hover:bg-raised"
              >
                <span className="code truncate">
                  {filter.values.length > 0
                    ? `${filter.key}: ${filter.values.join(', ')}`
                    : filter.key}
                </span>
                <X size={11} aria-hidden />
              </button>
            ))}
          </div>
          {tag && (
            <div
              role="group"
              aria-label={t('Values of {key}', { key: tag.key })}
              className="mt-1.5 flex flex-wrap gap-1"
            >
              <Chip
                active={asked?.values.length === 0}
                onClick={() => change({ tags: withTag(latest.current.tags, tag.key, null) })}
              >
                {t('Any value')}
              </Chip>
              {tag.values.map((value) => (
                <Chip
                  key={value.value}
                  active={asked?.values.includes(value.value) ?? false}
                  onClick={() =>
                    change({ tags: withTag(latest.current.tags, tag.key, value.value) })
                  }
                >
                  <span className="code truncate">{value.value || t('(empty)')}</span>
                  <Count>{value.count}</Count>
                </Chip>
              ))}
            </div>
          )}
        </div>
      )}

      <TextField
        label={t('Name has')}
        value={name}
        onChange={(event) => setName(event.target.value)}
        className="mt-2.5 max-w-64"
        autoComplete="off"
        spellCheck={false}
        data-testid="inventory-name"
      />

      <div className="mt-2">
        <Switch
          checked={selection.alongPaths}
          onCheckedChange={(checked) => change({ alongPaths: checked })}
          label={t('Also what leads to them and what they lead to')}
          hint={t(
            'From what the filters choose, follows the connections both ways: what a tag misses on the same path comes too.',
          )}
        />
        <Switch
          checked={selection.connectedOnly}
          onCheckedChange={(checked) => change({ connectedOnly: checked })}
          label={t('Only what a connection touches')}
          hint={t(
            'A resource nothing leads to and that leads nowhere is left out. A security monitor stays: it watches, and nothing calls it.',
          )}
        />
        <Switch
          checked={drawsNetworkRules(selection.bases)}
          onCheckedChange={(checked) =>
            change({ bases: withNetworkRules(latest.current.bases, checked) })
          }
          label={t('Draw connections from network rules')}
          hint={t(
            'A rule that admits one group to another is a permission to reach, not a call that was seen. The file states {n} of them.',
            { n: rules },
          )}
        />
      </div>

      <details className="group mt-2 border-t border-line pt-2" data-testid="inventory-resources">
        <summary className="flex cursor-default list-none items-baseline justify-between gap-2 text-[11px] text-ink hover:text-ink [&::-webkit-details-marker]:hidden">
          <span>{t('Resources, one by one')}</span>
          <span className="flex items-baseline gap-2 text-ink-faint">
            <span className="numeric">{survey.listed.length}</span>
            <span aria-hidden className="group-open:hidden">
              {t('Show')}
            </span>
            <span aria-hidden className="hidden group-open:inline">
              {t('Hide')}
            </span>
          </span>
        </summary>
        <TextField
          label={t('Find a resource')}
          hideLabel
          placeholder={t('Find a resource')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="mt-2"
          autoComplete="off"
          spellCheck={false}
        />
        <ul className="mt-1.5 max-h-48 divide-y divide-line overflow-y-auto rounded-control border border-line">
          {found.slice(0, LISTED).map((item) => {
            // Left out a moment ago, before the server has said so.
            const out = selection.exclude.includes(item.id) || !item.kept;
            return (
              <li key={item.id} className="flex items-center gap-2 px-2 py-0.5 text-[11px]">
                <span
                  className={
                    out
                      ? 'min-w-0 flex-1 truncate text-ink-faint line-through'
                      : 'min-w-0 flex-1 truncate text-ink'
                  }
                  title={item.name}
                >
                  {item.name}
                </span>
                <span className="shrink-0 text-ink-faint">
                  {SERVICE_TYPE[item.type].short} · <span className="code">{item.region}</span>
                </span>
                <IconButton
                  size="sm"
                  label={
                    out
                      ? t('Bring back {name}', { name: item.name })
                      : t('Leave out {name}', { name: item.name })
                  }
                  onClick={() =>
                    change({ exclude: withExcluded(latest.current.exclude, item.id, !out) })
                  }
                >
                  {out ? <RotateCcw size={12} /> : <X size={12} />}
                </IconButton>
              </li>
            );
          })}
        </ul>
        {found.length > LISTED && (
          <p className="caption mt-1">
            {t('{n} more: search to find one of them.', { n: found.length - LISTED })}
          </p>
        )}
      </details>

      {survey.notes.length > 0 && (
        <div className="mt-2 border-t border-line pt-2" data-testid="inventory-notes">
          <p className="caption">{t('Notes in the file')}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] leading-relaxed text-ink-dim">
            {survey.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      )}

      {!asksForEverything(selection) && (
        <div className="mt-2.5">
          <Button
            size="sm"
            variant="ghost"
            icon={<RotateCcw size={12} aria-hidden />}
            onClick={() => {
              setName('');
              setTagKey('');
              change(EVERYTHING);
            }}
            data-testid="inventory-clear"
          >
            {t('Bring everything')}
          </Button>
        </div>
      )}
    </section>
  );
}
