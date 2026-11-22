/**
 * The files to import, laid out by the part of a workspace each one goes
 * to: a slot for the platforms, the scenarios, the recordings and each of
 * the Cedar files, and one for what is not read.
 *
 * Where a file goes is the server's answer (`sorted` in the check, the same
 * reading the import itself sorts files with); the page decides nothing of
 * it. Until the answer about the files as they now are has come, a file
 * stands where the last answer put it, or among those being read. A slot
 * no file goes to says that part stays as it is; one that files go to says
 * they replace it, and its files are listed in it, each one taken out with
 * its own button. A file arrives in its slot once, rising into place.
 */
import type { SortedFile, WorkspaceFile, WorkspacePart } from '@aegis/contracts';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

import { IconButton } from '@/components/ui/Button';
import { t } from '@/i18n';
import { cn } from '@/lib/cn';

import { formatBytes } from './files';

/** The slots, in the order a workspace is laid out, with what each holds. */
const SLOTS: { part: WorkspacePart; name: string; holds: string }[] = [
  { part: 'topologies', name: t('Platforms'), holds: t('topologies, Compose files, inventories') },
  { part: 'scenarios', name: t('Scenarios'), holds: t('incidents to run') },
  { part: 'recordings', name: t('Recordings'), holds: t('incidents to replay') },
  { part: 'cedar/policies', name: t('Cedar policies'), holds: t('what Cedar decides by') },
  { part: 'cedar/entities', name: t('Entities'), holds: t('who and what Cedar knows') },
  { part: 'cedar/catalog', name: t('Catalogue'), holds: t('requests, and ordinary traffic') },
  {
    part: 'cedar/schema',
    name: t('Schema'),
    holds: t('optional: what policies are checked against'),
  },
];

function Row({
  file,
  note,
  onRemove,
}: {
  file: WorkspaceFile;
  note?: string;
  onRemove: () => void;
}) {
  return (
    <li className="flex animate-rise items-center gap-2 py-0.5 text-[11px]">
      <span className="code min-w-0 flex-1 truncate text-ink" title={file.path}>
        {file.path}
      </span>
      {note && <span className="shrink-0 text-ink-faint">{note}</span>}
      <span className="numeric shrink-0 text-ink-faint">
        {formatBytes(new Blob([file.text]).size)}
      </span>
      <IconButton size="sm" label={t('Remove {file}', { file: file.path })} onClick={onRemove}>
        <X size={12} />
      </IconButton>
    </li>
  );
}

function Slot({
  name,
  holds,
  filled,
  testId,
  children,
}: {
  name: string;
  holds: string;
  filled: boolean;
  testId: string;
  children?: ReactNode;
}) {
  return (
    <section
      className={cn(
        'min-w-0 rounded-control border px-2.5 py-2 transition-colors',
        filled ? 'border-line-strong bg-paper' : 'border-dashed border-line',
      )}
      data-testid={testId}
      data-filled={filled || undefined}
    >
      <header className="flex items-baseline justify-between gap-2">
        <h4 className="truncate text-xs font-bold text-ink">{name}</h4>
        <span className="shrink-0 text-[10px] text-ink-faint">
          {filled ? t('replaced by these') : t('stays as it is')}
        </span>
      </header>
      <p className="truncate text-[10px] text-ink-faint" title={holds}>
        {holds}
      </p>
      {children}
    </section>
  );
}

export function Board({
  staged,
  sorted,
  answered,
  onRemove,
}: {
  staged: readonly WorkspaceFile[];
  /** Where the server last said each file goes. */
  sorted: readonly SortedFile[];
  /** Whether that answer is about the files as they now are. */
  answered: boolean;
  onRemove: (file: WorkspaceFile) => void;
}) {
  const byPath = new Map(staged.map((file) => [file.path, file]));
  const told = new Set(sorted.map((entry) => entry.path));
  // A bundle holds many files: it is listed once, and its files in their slots.
  const bundles = staged.filter((file) =>
    sorted.some((entry) => entry.path === file.path && entry.within),
  );
  const waiting = staged.filter((file) => !told.has(file.path));
  const manifests = sorted.filter((entry) => entry.part === 'manifest' && !entry.within);
  const inSlot = (part: WorkspacePart) =>
    sorted.filter((entry) => entry.part === part && byPath.has(entry.path));

  return (
    <div
      className="mt-3"
      data-testid="workspace-staged"
      aria-label={t('Files to import')}
      role="group"
    >
      {(bundles.length > 0 || waiting.length > 0 || manifests.length > 0) && (
        <ul className="mb-2 divide-y divide-line rounded-control border border-line px-2">
          {manifests.map((entry) => (
            <Row
              key={entry.path}
              file={byPath.get(entry.path)!}
              note={t('the manifest: which version of the format the files are in')}
              onRemove={() => onRemove(byPath.get(entry.path)!)}
            />
          ))}
          {bundles.map((file) => (
            <Row
              key={file.path}
              file={file}
              note={t('a saved workspace: its files are in the slots below')}
              onRemove={() => onRemove(file)}
            />
          ))}
          {waiting.map((file) => (
            <Row
              key={file.path}
              file={file}
              note={answered ? t('not told: see what is wrong below') : t('being read…')}
              onRemove={() => onRemove(file)}
            />
          ))}
        </ul>
      )}
      <div className="grid gap-2 sm:grid-cols-2" data-testid="workspace-slots">
        {SLOTS.map((slot) => {
          const entries = inSlot(slot.part);
          return (
            <Slot
              key={slot.part}
              name={slot.name}
              holds={slot.holds}
              filled={entries.length > 0}
              testId={`workspace-slot-${slot.part.replace('/', '-')}`}
            >
              {entries.length > 0 && (
                <ul className="mt-1 divide-y divide-line">
                  {entries.map((entry) => {
                    const file = byPath.get(entry.path)!;
                    return entry.within ? (
                      // A file inside a bundle is taken out with the bundle.
                      <li
                        key={`${entry.path}:${entry.within}`}
                        className="flex animate-rise items-center gap-2 py-0.5 text-[11px]"
                        role="presentation"
                      >
                        <span
                          className="code min-w-0 flex-1 truncate text-ink-dim"
                          title={entry.within}
                        >
                          {entry.within}
                        </span>
                        <span className="shrink-0 text-ink-faint">
                          {t('in {bundle}', { bundle: entry.path })}
                        </span>
                      </li>
                    ) : (
                      <Row key={entry.path} file={file} onRemove={() => onRemove(file)} />
                    );
                  })}
                </ul>
              )}
            </Slot>
          );
        })}
        {inSlot('ignored').length > 0 && (
          <Slot
            name={t('Not read')}
            holds={t('no part of a workspace')}
            filled
            testId="workspace-slot-ignored"
          >
            <ul className="mt-1 divide-y divide-line">
              {inSlot('ignored').map((entry) =>
                entry.within ? (
                  <li
                    key={`${entry.path}:${entry.within}`}
                    role="presentation"
                    className="py-0.5 text-[11px]"
                  >
                    <span className="code text-ink-dim">{entry.within}</span>
                  </li>
                ) : (
                  <Row
                    key={entry.path}
                    file={byPath.get(entry.path)!}
                    onRemove={() => onRemove(byPath.get(entry.path)!)}
                  />
                ),
              )}
            </ul>
          </Slot>
        )}
      </div>
    </div>
  );
}
