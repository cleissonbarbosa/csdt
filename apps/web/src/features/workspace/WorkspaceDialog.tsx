/**
 * The files the platform, its incidents and its Cedar policies come from:
 * what is in use, a way to save it, and a way to put others in its place.
 *
 * Files are staged first. The server says what applying them would give, or
 * what is wrong and in which file, before anything changes; it is the same
 * check a workspace directory gets when the server starts.
 */
import type { WorkspaceCheck, WorkspaceFile, WorkspaceStatus } from '@aegis/contracts';
import { useQuery } from '@tanstack/react-query';
import { Download, FileUp, FolderUp, RotateCcw, X } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';

import { actions } from '@/app/actions';
import { HOST } from '@/app/host';
import { queryKeys } from '@/app/queryClient';
import { Button, IconButton } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { cn } from '@/lib/cn';
import { formatPercent } from '@/lib/format';
import { api, ApiError } from '@/providers/api';
import { useUi } from '@/stores/ui';

import { PolicyDiff } from './PolicyDiff';
import {
  download,
  formatBytes,
  fromDrop,
  fromInput,
  stage,
  type Picked,
  type Skipped,
} from './files';

const ORIGIN: Record<WorkspaceStatus['origin'], string> = {
  bundled: 'The platform that ships with AEGIS.',
  startup: 'The workspace this server was started with.',
  imported: HOST.imported,
};

function plural(count: number, noun: string, many = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : many}`;
}

function message(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong.';
}

/** What a set of files amounts to: the platforms, the incidents, the policies. */
function Contents({ workspace }: { workspace: WorkspaceStatus }) {
  const rows: [string, ReactNode][] = [
    [
      plural(workspace.topologies.length, 'platform'),
      workspace.topologies
        .map((topology) => `${topology.name} (${plural(topology.nodeCount, 'service')})`)
        .join(', '),
    ],
    [
      plural(workspace.scenarioIds.length, 'scenario'),
      <span key="scenarios" className="code">
        {workspace.scenarioIds.join(', ')}
      </span>,
    ],
    [
      plural(workspace.recordingIds.length, 'recording'),
      <span key="recordings" className="code">
        {workspace.recordingIds.join(', ')}
      </span>,
    ],
    [
      plural(workspace.policyCount, 'Cedar policy', 'Cedar policies'),
      `Cedar denies ${formatPercent(workspace.baselineDenyFraction)} of ordinary requests`,
    ],
  ];
  return (
    <>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-ink">{label}</dt>
            <dd className="min-w-0 break-words text-ink-dim">{value}</dd>
          </div>
        ))}
      </dl>
      {workspace.unavailable.length > 0 && (
        <div className="mt-2 text-[11px] text-ink-dim" data-testid="workspace-unavailable">
          <p className="text-ink">
            {plural(workspace.unavailable.length, 'scenario')} cannot run on a platform
          </p>
          <ul className="mt-1 space-y-0.5">
            {workspace.unavailable.map((entry) => (
              <li key={`${entry.scenarioId}:${entry.topologyId}`}>
                <span className="code">{entry.scenarioId}</span> on{' '}
                <span className="code">{entry.topologyId}</span>: {entry.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {workspace.ignored.length > 0 && (
        <p className="mt-2 text-[11px] text-ink-faint">
          Not read: <span className="code">{workspace.ignored.join(', ')}</span>
        </p>
      )}
    </>
  );
}

function Problem({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-control border border-critical/40 bg-critical/10 px-2 py-1.5 text-[11px] leading-relaxed text-critical"
      data-testid="workspace-problem"
    >
      {children}
    </p>
  );
}

/** The answer to "what would these files give?", for the files it was asked about. */
type Checked = { files: WorkspaceFile[]; outcome: WorkspaceCheck | string };

function Import() {
  const [staged, setStaged] = useState<WorkspaceFile[]>([]);
  const [skipped, setSkipped] = useState<Skipped[]>([]);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  // Ask about the staged files a moment after they stop changing. An answer
  // is kept with the files it is about, so a late one for an earlier set is
  // never shown against the current one.
  useEffect(() => {
    if (staged.length === 0) return;
    let stale = false;
    const timer = setTimeout(() => {
      api.checkWorkspace(staged).then(
        (outcome) => !stale && setChecked({ files: staged, outcome }),
        (error: unknown) => !stale && setChecked({ files: staged, outcome: message(error) }),
      );
    }, 150);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [staged]);

  const outcome = checked?.files === staged ? checked.outcome : null;
  const valid = typeof outcome === 'object' && outcome?.valid === true;

  const add = async (picked: Picked[]) => {
    if (picked.length === 0) return;
    const result = await stage(staged, picked);
    setFailure(null);
    setSkipped(result.skipped);
    setStaged(result.files);
  };
  const clear = () => {
    setStaged([]);
    setSkipped([]);
    setFailure(null);
  };
  const drop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    void fromDrop(event.dataTransfer).then(add);
  };
  const startFromCurrent = async () => {
    setBusy(true);
    try {
      const bundle = await api.exportWorkspace();
      // What was added by hand stays on top of what is in use.
      const mine = new Set(staged.map((file) => file.path));
      setStaged([...bundle.files.filter((file) => !mine.has(file.path)), ...staged]);
      setFailure(null);
    } catch (error) {
      setFailure(message(error));
    }
    setBusy(false);
  };
  const apply = async () => {
    setBusy(true);
    const result = await actions.importWorkspace(staged);
    setBusy(false);
    if (result instanceof ApiError) {
      setFailure(result.message);
      return;
    }
    clear();
    // Out of the way: the model is what changed.
    useUi.getState().setPanel(null);
  };

  return (
    <section aria-labelledby="workspace-import">
      <h3 id="workspace-import" className="text-xs font-bold text-ink">
        Import
      </h3>
      <p className="mt-1 text-xs leading-relaxed text-ink-dim">
        A topology, scenarios, recordings, Cedar policies, entities, a catalogue, a whole workspace
        folder, or a file saved from here. Each kind of file you add replaces that part of{' '}
        {HOST.started}; the rest stays. A Compose file (<span className="code">.yml</span>) is read
        as a topology: its services and what each depends on are taken from it, and its traffic and
        latencies, which it does not state, are defaults.
      </p>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        className={cn(
          'mt-3 flex flex-wrap items-center gap-2 rounded-control border border-dashed border-line-strong px-3 py-3 transition-colors',
          over && 'bg-raised',
        )}
        data-testid="workspace-drop"
      >
        <Button
          size="sm"
          icon={<FileUp size={12} aria-hidden />}
          onClick={() => filesInput.current?.click()}
        >
          Choose files
        </Button>
        <Button
          size="sm"
          icon={<FolderUp size={12} aria-hidden />}
          onClick={() => folderInput.current?.click()}
        >
          Choose a folder
        </Button>
        <span className="text-[11px] text-ink-faint">or drop them here</span>
        <input
          ref={filesInput}
          type="file"
          multiple
          hidden
          accept=".json,.cedar,.cedarschema,.yml,.yaml"
          aria-label="Files to import"
          data-testid="workspace-files"
          onChange={(event) => {
            void add(fromInput(event.target.files ?? []));
            // The same file can be picked again after it is edited.
            event.target.value = '';
          }}
        />
        <input
          ref={folderInput}
          type="file"
          multiple
          hidden
          aria-label="Folder to import"
          data-testid="workspace-folder"
          // Not in React's types; every current browser has it.
          {...({ webkitdirectory: '' } as object)}
          onChange={(event) => {
            void add(fromInput(event.target.files ?? []));
            event.target.value = '';
          }}
        />
      </div>
      <button
        type="button"
        className="mt-1.5 text-[11px] text-ink-dim underline decoration-line-strong underline-offset-2 hover:text-ink hover:decoration-ink disabled:opacity-40"
        disabled={busy}
        onClick={() => void startFromCurrent()}
        data-testid="workspace-start-from-current"
      >
        Start from the files in use, to add to them
      </button>

      {skipped.length > 0 && (
        <p className="mt-2 text-[11px] text-ink-faint" data-testid="workspace-skipped">
          Left out:{' '}
          {skipped.map((entry, i) => (
            <span key={entry.path}>
              {i > 0 && '; '}
              <span className="code">{entry.path}</span> ({entry.reason})
            </span>
          ))}
        </p>
      )}

      {staged.length > 0 && (
        <>
          <ul
            className="mt-3 max-h-40 divide-y divide-line overflow-y-auto rounded-control border border-line"
            aria-label="Files to import"
            data-testid="workspace-staged"
          >
            {staged.map((file) => (
              <li key={file.path} className="flex items-center gap-2 px-2 py-1 text-[11px]">
                <span className="code min-w-0 flex-1 truncate text-ink" title={file.path}>
                  {file.path}
                </span>
                <span className="numeric shrink-0 text-ink-faint">
                  {formatBytes(new Blob([file.text]).size)}
                </span>
                <IconButton
                  size="sm"
                  label={`Remove ${file.path}`}
                  onClick={() => setStaged(staged.filter((other) => other !== file))}
                >
                  <X size={12} />
                </IconButton>
              </li>
            ))}
          </ul>

          <div className="mt-3" role="status" aria-live="polite" data-testid="workspace-check">
            {outcome === null ? (
              <p className="text-[11px] text-ink-faint">Checking…</p>
            ) : typeof outcome === 'string' ? (
              <Problem>{outcome}</Problem>
            ) : outcome.workspace ? (
              <div data-valid="true">
                <p className="mb-1.5 text-xs text-ink">
                  These files are valid. Applying them gives:
                </p>
                <Contents workspace={outcome.workspace} />
                <PolicyDiff files={staged} />
              </div>
            ) : (
              <Problem>
                {outcome.problem?.path && (
                  <>
                    <span className="code font-bold">{outcome.problem.path}</span>:{' '}
                  </>
                )}
                {outcome.problem?.message ?? 'These files are not a valid workspace.'}
              </Problem>
            )}
          </div>

          {failure && (
            <div className="mt-2">
              <Problem>{failure}</Problem>
            </div>
          )}
          <div className="mt-3 flex items-center gap-2">
            <Button
              variant="primary"
              disabled={!valid || busy}
              onClick={() => void apply()}
              data-testid="workspace-apply"
            >
              Apply
            </Button>
            <Button disabled={busy} onClick={clear}>
              Clear
            </Button>
            <span className="text-[11px] text-ink-faint">
              Applying starts a new timeline for everyone connected.
            </span>
          </div>
        </>
      )}
      {staged.length === 0 && failure && (
        <div className="mt-2">
          <Problem>{failure}</Problem>
        </div>
      )}
    </section>
  );
}

export function WorkspaceDialog() {
  const open = useUi((state) => state.openPanel === 'workspace');
  const setPanel = useUi((state) => state.setPanel);
  const { data: workspace, error } = useQuery({
    queryKey: queryKeys.workspace,
    queryFn: api.workspace,
    enabled: open,
  });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    try {
      download(await api.exportWorkspace());
      setFailure(null);
    } catch (cause) {
      setFailure(message(cause));
    }
    setBusy(false);
  };
  const reset = async () => {
    setBusy(true);
    const result = await actions.resetWorkspace();
    setBusy(false);
    setFailure(result instanceof ApiError ? result.message : null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => setPanel(next ? 'workspace' : null)}
      title="Platform files"
      description="The platform, its incidents and its Cedar policies are read from files. Yours can take their place. What is shown stays a simulation of whatever they describe."
    >
      <section aria-labelledby="workspace-in-use" data-testid="workspace-in-use">
        <h3 id="workspace-in-use" className="text-xs font-bold text-ink">
          In use
        </h3>
        {workspace ? (
          <div data-origin={workspace.origin}>
            <p className="mb-2 mt-1 text-xs leading-relaxed text-ink-dim">
              {ORIGIN[workspace.origin]}
              {workspace.origin !== 'bundled' && workspace.replaced.length > 0 && (
                <>
                  {' '}
                  From them: <span className="code">{workspace.replaced.join(', ')}</span>.
                </>
              )}
            </p>
            <Contents workspace={workspace} />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                icon={<Download size={12} aria-hidden />}
                disabled={busy}
                onClick={() => void save()}
                data-testid="workspace-export"
              >
                Save as one file
              </Button>
              {workspace.origin === 'imported' && workspace.importEnabled && (
                <Button
                  size="sm"
                  icon={<RotateCcw size={12} aria-hidden />}
                  disabled={busy}
                  onClick={() => void reset()}
                  data-testid="workspace-reset"
                >
                  Return to {HOST.started}
                </Button>
              )}
            </div>
          </div>
        ) : (
          <p className="mt-1 text-xs text-ink-faint">{error ? message(error) : HOST.asking}</p>
        )}
        {failure && (
          <div className="mt-2">
            <Problem>{failure}</Problem>
          </div>
        )}
      </section>

      <div className="mt-4 border-t border-line pt-4">
        {workspace?.importEnabled === false ? (
          <p className="text-xs leading-relaxed text-ink-dim" data-testid="workspace-import-off">
            Importing is switched off on this server (<span className="code">AEGIS_IMPORT=off</span>
            ). Files can still be saved from here and given to it when it starts, with{' '}
            <span className="code">AEGIS_WORKSPACE</span>.
          </p>
        ) : (
          <Import />
        )}
      </div>
    </Dialog>
  );
}
