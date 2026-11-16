/**
 * The guide: a short list of challenges, and the one under way.
 *
 * It is a card on the stage, not a dialog: a challenge is answered by using
 * the model, the incidents panel and the request tracer, so those have to
 * stay within reach while it is open. It comes when asked for and goes when
 * closed.
 */
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronLeft, X } from 'lucide-react';
import { useState } from 'react';

import { actions } from '@/app/actions';
import { useReportedHeight } from '@/app/hooks';
import { queryClient, queryKeys } from '@/app/queryClient';
import { Button, IconButton } from '@/components/ui/Button';
import { BasisTag } from '@/features/scenarios/IncidentReport';
import { cn } from '@/lib/cn';
import { api } from '@/providers/api';
import { useGuide, type Feedback, type FeedbackLine } from '@/stores/guide';
import { useTelemetry } from '@/stores/telemetry';
import { useUi } from '@/stores/ui';

import { challengeById, CHALLENGES, type Challenge, type Evidence } from './challenges';

const TAG: Record<'observed' | 'cedar', { label: string; hint: string }> = {
  observed: {
    label: 'Observed',
    hint: 'Read from the events and figures the engine recorded in this run.',
  },
  cedar: {
    label: 'Cedar',
    hint: 'What the Cedar policy engine answered, or the text of a policy it holds.',
  },
};

function LineTag({ basis }: { basis: NonNullable<FeedbackLine['basis']> }) {
  if (basis !== 'observed' && basis !== 'cedar') return <BasisTag basis={basis} />;
  return (
    <span
      title={TAG[basis].hint}
      data-basis={basis}
      className="inline-flex h-[18px] shrink-0 items-center rounded-control border border-ink px-1.5 text-[10px] leading-none text-ink"
    >
      {TAG[basis].label}
    </span>
  );
}

/** The latest incident of a scenario on this timeline, read back in full. */
async function reportOf(scenarioId: string) {
  try {
    const { incidents } = await queryClient.fetchQuery({
      queryKey: queryKeys.incidents,
      queryFn: api.incidents,
      staleTime: 0,
    });
    const incident = incidents.findLast((entry) => entry.scenarioId === scenarioId);
    if (!incident) return null;
    return await queryClient.fetchQuery({
      queryKey: queryKeys.report(incident.id),
      queryFn: () => api.incidentReport(incident.id),
      staleTime: 0,
    });
  } catch {
    return null;
  }
}

/** What a challenge reads, gathered at the moment it is asked. */
function useEvidence(): Omit<Evidence, 'report'> {
  const topology = useTelemetry((state) => state.topology);
  const selection = useUi((state) => state.selection);
  const decision = useUi((state) => state.lastDecision);
  const { data: scenarios } = useQuery({ queryKey: queryKeys.scenarios, queryFn: api.scenarios });
  const { data: catalog } = useQuery({
    queryKey: queryKeys.catalog,
    queryFn: api.authorizationCatalog,
  });
  return {
    topology,
    // Read when the answer is given: it changes several times a second.
    snapshot: null,
    scenarios: scenarios?.scenarios ?? [],
    catalog: catalog ?? null,
    selection,
    decision,
  };
}

async function start(challenge: Challenge): Promise<boolean> {
  const ui = useUi.getState();
  if (challenge.setup.kind === 'scenario') {
    const ok = await actions.restartScenario(challenge.setup.scenarioId);
    if (!ok) return false;
    // The answer is one service, and those are in the detailed arrangements.
    ui.select(null);
    if (ui.layoutMode === 'layers') ui.setLayoutMode(ui.detailMode);
  } else {
    // An answer given before the challenge began is not an answer to it.
    ui.setLastDecision(null);
    ui.presetAuthorization(challenge.setup.request);
  }
  useGuide.getState().begin(challenge.id);
  return true;
}

function FeedbackBlock({ feedback }: { feedback: Feedback }) {
  return (
    <div
      className="mt-3 border-t border-line pt-2.5"
      role="status"
      data-testid="guide-feedback"
      data-correct={feedback.correct}
    >
      <p className="flex items-start gap-1.5 text-xs font-bold text-ink">
        <span aria-hidden className="mt-px shrink-0">
          {feedback.correct ? <Check size={14} /> : <X size={14} />}
        </span>
        {feedback.headline}
      </p>
      <ul className="mt-1.5 space-y-1.5">
        {feedback.lines.map((line) => (
          <li
            key={line.text}
            className="flex items-baseline gap-1.5 text-[11px] leading-snug text-ink-dim"
          >
            {line.basis && <LineTag basis={line.basis} />}
            <span className="min-w-0">{line.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Active({ challenge }: { challenge: Challenge }) {
  const evidence = useEvidence();
  const feedback = useGuide((state) => state.feedback);
  const [busy, setBusy] = useState(false);
  const answer = challenge.answerWith({ ...evidence, report: null });
  const next = CHALLENGES[(CHALLENGES.indexOf(challenge) + 1) % CHALLENGES.length]!;

  const check = async () => {
    setBusy(true);
    const report =
      challenge.setup.kind === 'scenario' ? await reportOf(challenge.setup.scenarioId) : null;
    const { snapshot } = useTelemetry.getState();
    useGuide.getState().answer(challenge.check({ ...evidence, snapshot, report }));
    setBusy(false);
  };

  return (
    <div data-testid="guide-challenge" data-challenge={challenge.id}>
      <button
        type="button"
        onClick={() => useGuide.getState().leave()}
        className="inline-flex items-center gap-1 text-[11px] text-ink underline decoration-line-strong underline-offset-2 hover:decoration-ink"
      >
        <ChevronLeft size={13} aria-hidden /> All challenges
      </button>
      <h3 className="mt-2 text-sm font-bold text-ink">{challenge.title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-ink-dim">{challenge.brief}</p>
      <p className="mt-2 text-xs leading-relaxed text-ink">{challenge.prompt}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {'label' in answer ? (
          <Button
            variant="primary"
            size="sm"
            disabled={busy}
            onClick={() => void check()}
            data-testid="guide-answer"
          >
            {answer.label}
          </Button>
        ) : (
          <p className="text-[11px] text-ink-faint" data-testid="guide-waiting">
            {answer.waiting}
          </p>
        )}
        {feedback?.correct && (
          <Button
            size="sm"
            onClick={() => void start(next)}
            disabled={next.unavailable({ ...evidence, report: null }) !== null}
            data-testid="guide-next"
          >
            Next: {next.title}
          </Button>
        )}
      </div>
      {feedback && <FeedbackBlock feedback={feedback} />}
    </div>
  );
}

function List() {
  const evidence = useEvidence();
  const completed = useGuide((state) => state.completed);
  const [starting, setStarting] = useState<string | null>(null);
  return (
    <div data-testid="guide-list">
      <h3 className="text-sm font-bold text-ink">Guided challenges</h3>
      <p className="mt-1 text-[11px] leading-relaxed text-ink-dim">
        Each asks one question about the platform. Your answer is checked against the model itself:
        the record of the incident, or Cedar&apos;s own decision.
      </p>
      <ul className="mt-2 divide-y divide-line">
        {CHALLENGES.map((challenge) => {
          const reason = challenge.unavailable({ ...evidence, report: null });
          const solved = completed.includes(challenge.id);
          return (
            <li key={challenge.id} className="py-2.5">
              <div className="flex items-start justify-between gap-2">
                <h4 className="min-w-0 text-xs font-bold text-ink">
                  {challenge.title}
                  {solved && (
                    <span className="ml-1.5 inline-flex items-center gap-0.5 font-normal text-ink-faint">
                      <Check size={12} aria-hidden /> solved
                    </span>
                  )}
                </h4>
                <Button
                  size="sm"
                  variant={solved ? 'outline' : 'primary'}
                  disabled={reason !== null || starting !== null}
                  onClick={async () => {
                    setStarting(challenge.id);
                    await start(challenge);
                    setStarting(null);
                  }}
                  data-testid={`guide-start-${challenge.id}`}
                >
                  {starting === challenge.id ? 'Starting…' : solved ? 'Again' : 'Start'}
                </Button>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-dim">{challenge.brief}</p>
              <p className="caption mt-1">{reason ?? challenge.starts}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * `left` and `bottom` keep the card clear of the panel and the timeline
 * beside it. Where the stage has no room for it beside the panels it lies
 * `alongFoot`, and `onHeight` reports how much of the stage it covers so
 * that the panels can end above it.
 */
export function GuideCard({
  left,
  bottom,
  alongFoot,
  onHeight,
}: {
  left: number;
  bottom: number;
  alongFoot: boolean;
  onHeight: (height: number) => void;
}) {
  const open = useGuide((state) => state.open);
  const challenge = useGuide((state) => challengeById(state.activeId));
  const element = useReportedHeight<HTMLElement>(open, onHeight);
  if (!open) return null;
  return (
    <aside
      ref={element}
      // Along the foot it shares the height of the screen with the panel
      // the challenge is answered in, so it takes less than half of it.
      className={cn(
        'panel floating absolute z-20 flex w-[min(21rem,calc(100%-1.5rem))] animate-rise flex-col overflow-hidden transition-[left,bottom] duration-200 ease-arrive',
        alongFoot ? 'max-h-[46%]' : 'max-h-[min(70%,30rem)]',
      )}
      style={{ left, bottom }}
      aria-label="Guided challenges"
      data-testid="guide"
    >
      <div className="flex justify-end px-1 pt-1">
        <IconButton
          label="Close the guide"
          size="sm"
          onClick={() => useGuide.getState().setOpen(false)}
          data-testid="guide-close"
        >
          <X size={14} />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {challenge ? <Active challenge={challenge} /> : <List />}
      </div>
    </aside>
  );
}
