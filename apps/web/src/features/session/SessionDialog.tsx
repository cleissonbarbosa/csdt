/**
 * Saving a session, sharing it, and opening one.
 *
 * A session is what reproduces the experiment on screen: the seed and the
 * commands of the timeline, where the cursor is, how the model is being
 * looked at, and the platform's files when they are not the bundled ones.
 * It can be saved as a file or, when small enough, carried by a link.
 * Opening one replaces the timeline in use, so it is always shown first
 * and opened only when asked.
 */
import { useQuery } from '@tanstack/react-query';
import { Download, FileUp, Link2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { queryKeys } from '@/app/queryClient';
import {
  composeSession,
  currentView,
  describeSession,
  openSession,
  parseSession,
  sessionFromHash,
  sessionLink,
  type Parsed,
  type SessionFile,
} from '@/app/session';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { downloadJson } from '@/features/workspace/files';
import { formatClock } from '@/lib/format';
import { api, ApiError } from '@/providers/api';
import { useNotices } from '@/stores/notices';
import { useUi } from '@/stores/ui';

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function Problem({ children }: { children: string }) {
  return (
    <p
      role="alert"
      className="mt-2 rounded-control border border-critical/40 bg-critical/10 px-2 py-1.5 text-[11px] leading-relaxed text-critical"
      data-testid="session-problem"
    >
      {children}
    </p>
  );
}

/** What a session holds, to check before saving it or opening it. */
function Contents({ session }: { session: SessionFile }) {
  const { data: scenarios } = useQuery({ queryKey: queryKeys.scenarios, queryFn: api.scenarios });
  const { recording } = session;
  return (
    <dl
      className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]"
      data-testid="session-contents"
    >
      <dt className="text-ink-faint">Platform</dt>
      <dd className="text-ink">
        <span className="code">{recording.topologyId}</span>
        {session.workspace
          ? `, with its ${plural(session.workspace.files.length, 'file')}`
          : ', as bundled with AEGIS'}
      </dd>
      <dt className="text-ink-faint">Seed</dt>
      <dd className="numeric text-ink">{recording.seed}</dd>
      <dt className="text-ink-faint">Length</dt>
      <dd className="numeric text-ink">
        {formatClock(recording.durationMs)}
        {session.cursorMs !== undefined && (
          <span className="font-normal text-ink-dim">
            , opened paused at {formatClock(session.cursorMs)}
          </span>
        )}
      </dd>
      <dt className="text-ink-faint">Commands</dt>
      <dd className="min-w-0 text-ink">
        <ul className="space-y-0.5">
          {describeSession(recording, scenarios?.scenarios).map((line, index) => (
            // The same command can be issued twice in one second.
            <li key={`${index}:${line}`} className="numeric">
              {line}
            </li>
          ))}
        </ul>
      </dd>
      {session.view && (
        <>
          <dt className="text-ink-faint">View</dt>
          <dd className="text-ink">
            {[
              session.view.arrangement && `arranged by ${session.view.arrangement}`,
              session.view.view === 'table' && 'as a table',
              session.view.select && `with ${session.view.select.replace(':', ' ')} selected`,
            ]
              .filter(Boolean)
              .join(', ') || 'the overview'}
          </dd>
        </>
      )}
    </dl>
  );
}

function Save() {
  const { data: exported, error } = useQuery({
    queryKey: ['session'],
    queryFn: api.session,
    // The timeline moves on while the dialog is open; what is shown follows it.
    staleTime: 0,
    gcTime: 0,
    refetchInterval: 2000,
  });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  /** The session as it is at the moment of asking, not as it was last shown. */
  const compose = async (): Promise<SessionFile | null> => {
    try {
      const fresh = await api.session();
      const workspace =
        fresh.workspaceOrigin === 'bundled' ? undefined : await api.exportWorkspace();
      return composeSession(fresh, currentView(), workspace);
    } catch (cause) {
      setFailure(cause instanceof ApiError ? cause.message : 'The session could not be read.');
      return null;
    }
  };
  const save = async () => {
    setBusy(true);
    setFailure(null);
    const session = await compose();
    if (session) downloadJson(session, 'aegis-session.json');
    setBusy(false);
  };
  const copy = async () => {
    setBusy(true);
    setFailure(null);
    const session = await compose();
    if (session) {
      const link = sessionLink(session, window.location.href);
      if (typeof link !== 'string') setFailure(link.reason);
      else {
        try {
          await navigator.clipboard.writeText(link);
          useNotices.getState().push('info', 'Link to this session copied.');
        } catch {
          setFailure('The link could not be copied to the clipboard.');
        }
      }
    }
    setBusy(false);
  };

  if (error) {
    return (
      <Problem>
        {error instanceof ApiError ? error.message : 'The session could not be read.'}
      </Problem>
    );
  }
  if (!exported) return <p className="mt-2 text-xs text-ink-faint">Reading the timeline…</p>;
  const omitted = exported.omitted.decisions + exported.omitted.importedEvents;
  return (
    <div data-testid="session-save" data-reproducible={exported.reproducible}>
      <Contents session={composeSession(exported, currentView())} />
      {exported.workspaceOrigin !== 'bundled' && (
        <p className="mt-2 text-[11px] leading-relaxed text-ink-dim">
          This platform is not the bundled one, so the file carries its files too. A link cannot.
        </p>
      )}
      {omitted > 0 && (
        <p className="mt-2 text-[11px] leading-relaxed text-ink-dim" data-testid="session-omitted">
          Not carried:{' '}
          {[
            exported.omitted.decisions > 0 &&
              `${plural(exported.omitted.decisions, 'authorization decision')} evaluated by hand`,
            exported.omitted.importedEvents > 0 &&
              `${plural(exported.omitted.importedEvents, 'import')} from an integration`,
          ]
            .filter(Boolean)
            .join(' and ')}
          . A session never states an outcome: Cedar and the importers have to give those again.
        </p>
      )}
      {!exported.reproducible && (
        <Problem>{`This timeline cannot be reproduced from a session: ${exported.note ?? 'part of it is missing'}.`}</Problem>
      )}
      {failure && <Problem>{failure}</Problem>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          icon={<Download size={12} aria-hidden />}
          disabled={busy || !exported.reproducible}
          onClick={() => void save()}
          data-testid="session-download"
        >
          Save as a file
        </Button>
        <Button
          size="sm"
          icon={<Link2 size={12} aria-hidden />}
          disabled={busy || !exported.reproducible || exported.workspaceOrigin !== 'bundled'}
          onClick={() => void copy()}
          data-testid="session-copy-link"
          title="The session travels in the part of the address after #, which is not sent to any server"
        >
          Copy a link
        </Button>
      </div>
    </div>
  );
}

function Open({
  offered,
  onDone,
  onDecline,
}: {
  offered: Parsed | null;
  onDone: () => void;
  /** The session on offer was turned down. */
  onDecline: () => void;
}) {
  const [picked, setPicked] = useState<Parsed | null>(offered);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setPicked(offered), [offered]);

  const open = async (session: SessionFile) => {
    setBusy(true);
    setFailure(null);
    const problem = await openSession(session);
    setBusy(false);
    if (problem) {
      setFailure(problem);
      return;
    }
    useNotices.getState().push('info', 'Session opened: its timeline was simulated again.');
    onDone();
  };

  return (
    <div data-testid="session-open">
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          icon={<FileUp size={12} aria-hidden />}
          onClick={() => input.current?.click()}
        >
          Choose a session file
        </Button>
        <input
          ref={input}
          type="file"
          hidden
          accept=".json,application/json"
          aria-label="Session file to open"
          data-testid="session-file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            setFailure(null);
            void file.text().then(
              (text) => setPicked(parseSession(text)),
              () => setPicked({ problem: 'The file could not be read.' }),
            );
          }}
        />
      </div>
      {picked && 'problem' in picked && <Problem>{picked.problem}</Problem>}
      {picked && 'session' in picked && (
        <div className="mt-3 rounded-control border border-line px-2.5 py-2">
          <p className="text-xs text-ink">This session holds:</p>
          <Contents session={picked.session} />
          {failure && <Problem>{failure}</Problem>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="primary"
              disabled={busy}
              onClick={() => void open(picked.session)}
              data-testid="session-open-confirm"
            >
              {busy ? 'Simulating it again…' : 'Open this session'}
            </Button>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                setPicked(null);
                onDecline();
              }}
            >
              Not now
            </Button>
            <span className="caption">
              Opening replaces the timeline in use
              {picked.session.workspace ? ' and the platform files' : ''} for everyone connected.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export function SessionDialog() {
  const open = useUi((state) => state.openPanel === 'session');
  // A link that carries a session is shown, never opened by itself: the
  // person who followed it decides whether to replace what is running.
  const [offered, setOffered] = useState<Parsed | null>(() =>
    typeof window === 'undefined' ? null : sessionFromHash(window.location.hash),
  );
  useEffect(() => {
    if (offered) useUi.getState().setPanel('session');
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const forget = () => {
    if (!offered) return;
    setOffered(null);
    // The link has been dealt with; a reload should not offer it again.
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${window.location.search}`,
    );
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) forget();
        useUi.getState().setPanel(next ? 'session' : null);
      }}
      title="Session"
      description="What reproduces the experiment on screen: the platform, the seed, the commands issued, the moment and the view. Opening a session simulates it again; no figure travels with it."
    >
      {offered && (
        <p className="mb-3 text-xs leading-relaxed text-ink" data-testid="session-offered">
          The link you followed carries a session. Nothing has been changed yet.
        </p>
      )}
      {!offered && (
        <section aria-labelledby="session-save-title">
          <h3 id="session-save-title" className="text-xs font-bold text-ink">
            This session
          </h3>
          {open && <Save />}
        </section>
      )}
      <section
        aria-labelledby="session-open-title"
        className={offered ? undefined : 'mt-4 border-t border-line pt-4'}
      >
        <h3 id="session-open-title" className="text-xs font-bold text-ink">
          Open a session
        </h3>
        <Open
          offered={offered}
          onDone={() => {
            forget();
            useUi.getState().setPanel(null);
          }}
          // Turned down, a link's session is dealt with: the dialog is the
          // ordinary one again, and a reload does not offer it a second time.
          onDecline={forget}
        />
      </section>
    </Dialog>
  );
}
