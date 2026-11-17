/**
 * Challenges: a question about the platform, answered by using it.
 *
 * A challenge sets something going (an incident, a request) and asks what
 * the viewer makes of it. The answer is checked against the model itself:
 * the incident's report, the snapshot, Cedar's own decision. So is the
 * feedback: a wrong answer is told what the run shows about it, never a
 * canned hint. A challenge whose scenario or request the platform in use
 * does not have is not offered.
 */
import type {
  AuthorizationCatalog,
  AuthorizationDecision,
  EvaluateRequest,
  IncidentReport,
  Scenario,
  TelemetrySnapshot,
  Topology,
} from '@aegis/contracts';

import { entityId, formatPercent } from '@/lib/format';
import { nodeLabel } from '@/lib/names';
import { describeOrigin, describePrescribed, explainCause, sinceStart } from '@/lib/report';
import type { Feedback, FeedbackLine } from '@/stores/guide';
import type { Selection } from '@/stores/ui';

/** Everything a challenge may read. All of it comes from the server. */
export interface Evidence {
  topology: Topology | null;
  snapshot: TelemetrySnapshot | null;
  scenarios: Scenario[];
  catalog: AuthorizationCatalog | null;
  selection: Selection;
  /** The report of the incident under way, when there is one. */
  report: IncidentReport | null;
  /** The latest decision Cedar gave in this page. */
  decision: AuthorizationDecision | null;
}

export type Setup =
  { kind: 'scenario'; scenarioId: string } | { kind: 'request'; request: EvaluateRequest };

export interface Challenge {
  id: string;
  title: string;
  /** What to find out. */
  brief: string;
  /** What starting it does to the simulation, so nobody is surprised. */
  starts: string;
  setup: Setup;
  /** How to answer, said once it has started. */
  prompt: string;
  /** Why it cannot be offered on this platform, or `null` when it can. */
  unavailable: (evidence: Evidence) => string | null;
  /**
   * The words on the answer button for what the viewer has in hand, or the
   * reason there is nothing to answer with yet.
   */
  answerWith: (evidence: Evidence) => { label: string } | { waiting: string };
  check: (evidence: Evidence) => Feedback;
}

const hasScenario = (evidence: Evidence, id: string) =>
  evidence.scenarios.some((scenario) => scenario.id === id && scenario.available)
    ? null
    : 'The platform in use cannot run the scenario this challenge needs.';

/** A selected service; a kind of service in the overview is not one. */
function selectedService(evidence: Evidence): { label: string } | { waiting: string } {
  const { selection, topology } = evidence;
  if (selection?.kind === 'node') {
    return { label: `Answer: ${nodeLabel(topology, selection.id)}` };
  }
  if (selection?.kind === 'group') {
    return { waiting: 'That is a kind of service. Open it and select one service.' };
  }
  return { waiting: 'Select a service on the model to answer with it.' };
}

const CASCADE: Challenge = {
  id: 'cascade-origin',
  title: 'Find where the cascade begins',
  brief:
    'Services start failing one after another. One of them is where it began; the rest follow from it.',
  starts: 'Starts the cascading failure scenario from a clean simulation.',
  setup: { kind: 'scenario', scenarioId: 'cascading-failure' },
  prompt:
    'Watch which services leave their normal state, and in what order. Then select the service you think it began at.',
  unavailable: (evidence) => hasScenario(evidence, 'cascading-failure'),
  answerWith: selectedService,
  check: ({ selection, report, topology }) => {
    if (!report || selection?.kind !== 'node') {
      return {
        correct: false,
        headline: 'There is no incident to answer about yet.',
        lines: [{ text: 'Start the challenge again and let the incident run.' }],
      };
    }
    const name = nodeLabel(topology, selection.id);
    const lines: FeedbackLine[] = [];
    if (report.origin?.nodeId === selection.id) {
      const origin = describeOrigin(report, topology);
      if (origin) lines.push({ basis: 'prescribed', text: origin });
      const first = report.phases[0]?.prescribed[0];
      if (first) {
        lines.push({
          basis: 'prescribed',
          text: `In its first phase the scenario holds it to ${describePrescribed(first, topology)}.`,
        });
      }
      for (const next of report.propagation
        .filter((t) => t.nodeId !== selection.id && t.cause?.kind === 'dependency')
        .slice(0, 2)) {
        const why = explainCause(next.cause!, topology);
        lines.push({
          basis: why.basis,
          text: `${nodeLabel(topology, next.nodeId)} became ${next.to} at ${sinceStart(report, next.atMs)} because ${why.text}.`,
        });
      }
      return { correct: true, headline: `Yes: it begins at ${name}.`, lines };
    }
    const seen = report.propagation.find((t) => t.nodeId === selection.id);
    if (!seen) {
      lines.push({
        basis: 'observed',
        text:
          report.propagation.length === 0
            ? 'No service has left its normal state yet. Let the incident run a little longer.'
            : `${name} has stayed normal so far: the incident has not reached it. Look at the services whose lamp is lit.`,
      });
      return { correct: false, headline: `Not ${name}.`, lines };
    }
    const why = seen.cause ? explainCause(seen.cause, topology) : null;
    lines.push({
      basis: why?.basis ?? 'observed',
      text: `${name} became ${seen.to} at ${sinceStart(report, seen.atMs)}${why ? ` because ${why.text}` : ''}.`,
    });
    const earlier = report.propagation.filter((t) => t.atMs < seen.atMs).length;
    lines.push({
      basis: 'observed',
      text:
        earlier > 0
          ? `${earlier} service${earlier === 1 ? '' : 's'} left the normal state before it did. Follow what it depends on.`
          : 'Nothing was seen to fail before it, but the run says something acts on another service first. Follow what it calls.',
    });
    return { correct: false, headline: `Not ${name}: it is a consequence.`, lines };
  },
};

/**
 * The check of a challenge that asks where an incident's injected traffic is
 * being stopped. `rule` is what can be said of why it is stopped there: who
 * decides it, the scenario or something the scenario cannot write.
 */
function stoppedAt(rule: FeedbackLine): Challenge['check'] {
  return ({ selection, snapshot, report, topology }) => {
    if (selection?.kind !== 'node' || !snapshot?.incident) {
      return {
        correct: false,
        headline: 'There is no incident to answer about.',
        lines: [{ text: 'Start the challenge again and let the incident run.' }],
      };
    }
    const name = nodeLabel(topology, selection.id);
    const stopped = snapshot.flows.filter((flow) => flow.blockedAt !== null);
    if (stopped.length === 0) {
      const flow = snapshot.flows[0];
      const mitigation = report?.phases.find((phase) => phase.status === 'mitigating');
      return {
        correct: false,
        headline: 'Nothing is stopping it yet.',
        lines: [
          {
            basis: 'observed',
            text: flow
              ? `Right now ${formatPercent(flow.rps > 0 ? flow.deliveredRps / flow.rps : 0)} of “${flow.label}” still gets through.`
              : 'The injected traffic has not started or has already ended.',
          },
          {
            basis: 'prescribed',
            text: mitigation
              ? `The scenario's mitigation phase, “${mitigation.name}”, began at ${sinceStart(report!, mitigation.atMs)}; it takes a few seconds to ease in.`
              : 'The scenario has not reached its mitigation phase. Let it run.',
          },
        ],
      };
    }
    const here = stopped.find((flow) => flow.blockedAt === selection.id);
    if (here) {
      return {
        correct: true,
        headline: `Yes: it is stopped at ${name}.`,
        lines: [
          {
            basis: 'observed',
            text: `Of ${Math.round(here.rps)} req/s of “${here.label}”, ${Math.round(here.deliveredRps)} req/s get past it${
              here.blockedReason ? ` (turned away by: ${here.blockedReason})` : ''
            }.`,
          },
          rule,
        ],
      };
    }
    const flow = stopped[0]!;
    const onRoute = flow.hops.some((hop) => {
      const edge = topology?.edges.find((e) => e.id === hop);
      return edge?.source === selection.id || edge?.target === selection.id;
    });
    return {
      correct: false,
      headline: `Not ${name}.`,
      lines: [
        {
          basis: 'observed',
          text: onRoute
            ? `${name} is on the route, but it is not where most of this traffic is turned away.`
            : `This traffic does not pass through ${name}. Its route is the one drawn on the model.`,
        },
        {
          basis: 'observed',
          text: `Only ${formatPercent(flow.rps > 0 ? flow.deliveredRps / flow.rps : 0)} of “${flow.label}” is still delivered: look for where the route's beads stop.`,
        },
      ],
    };
  };
}

const FLOOD: Challenge = {
  id: 'flood-stopped',
  title: 'Find where the flood is stopped',
  brief:
    'Hostile traffic pours in from outside. After a while a mitigation engages and most of it is turned away at one service.',
  starts: 'Starts the DDoS surge scenario from a clean simulation.',
  setup: { kind: 'scenario', scenarioId: 'ddos-surge' },
  prompt:
    'Follow the incident’s route across the model. When the mitigation has engaged, select the service the flood is being stopped at.',
  unavailable: (evidence) => hasScenario(evidence, 'ddos-surge'),
  answerWith: selectedService,
  check: stoppedAt({
    basis: 'prescribed',
    text: 'The scenario prescribes the rejection at this service; how much load that takes off what lies behind it is the model’s doing.',
  }),
};

const CONTRACTOR: Challenge = {
  id: 'contractor-stopped',
  title: 'Find where the contractor is stopped',
  brief:
    'A contractor of another tenant is signed in, and asks for things that are not theirs to have. None of it reaches the data.',
  starts: 'Starts the Cedar authorization denial scenario from a clean simulation.',
  setup: { kind: 'scenario', scenarioId: 'cedar-denial' },
  prompt:
    'Follow the route of the contractor’s requests. Once they ask for what they may not have, select the service they are stopped at.',
  unavailable: (evidence) => hasScenario(evidence, 'cedar-denial'),
  answerWith: selectedService,
  check: stoppedAt({
    basis: 'cedar',
    text: 'No scenario can write a denial. This traffic stops at the authorizer because Cedar, asked the request it is made of, denies it under the policies in force.',
  }),
};

const REGION: Challenge = {
  id: 'region-dark',
  title: 'Find the region that went dark',
  brief:
    'A whole cloud region stops answering. Traffic that went to it is sent elsewhere, and what stands there is out of reach.',
  starts: 'Starts the regional outage scenario from a clean simulation.',
  setup: { kind: 'scenario', scenarioId: 'regional-outage' },
  prompt:
    'Watch the model, by region if you like. When a region has gone dark, select any service that stands in it.',
  unavailable: (evidence) => hasScenario(evidence, 'regional-outage'),
  answerWith: selectedService,
  check: ({ selection, snapshot, report, topology }) => {
    const chosen =
      selection?.kind === 'node' ? topology?.nodes.find((node) => node.id === selection.id) : null;
    if (!chosen || !snapshot?.incident || !topology) {
      return {
        correct: false,
        headline: 'There is no incident to answer about.',
        lines: [{ text: 'Start the challenge again and let the incident run.' }],
      };
    }
    const regionName = (id: string) => topology.regions.find((r) => r.id === id)?.name ?? id;
    const dark = snapshot.regions.filter((region) => region.health === 'down');
    const mine = snapshot.regions.find((region) => region.id === chosen.region);
    if (dark.length === 0) {
      const worst = [...snapshot.regions].sort((a, b) => b.nodesUnhealthy - a.nodesUnhealthy)[0];
      return {
        correct: false,
        headline: 'No region is dark yet.',
        lines: [
          {
            basis: 'observed',
            text:
              worst && worst.nodesUnhealthy > 0
                ? `${regionName(worst.id)} has ${worst.nodesUnhealthy} of ${worst.nodesTotal} services out of their normal state, and still answers ${formatPercent(1 - worst.errorRate)} of what it is asked.`
                : 'Every region is still serving. Let the incident run a little longer.',
          },
        ],
      };
    }
    if (mine?.health === 'down') {
      const lines: FeedbackLine[] = [
        {
          basis: 'observed',
          text: `${mine.nodesUnhealthy} of the ${mine.nodesTotal} services that stand in ${regionName(mine.id)} are out of their normal state.`,
        },
      ];
      const origin = report ? describeOrigin(report, topology) : null;
      if (origin) lines.push({ basis: 'prescribed', text: origin });
      const elsewhere = snapshot.regions.filter(
        (region) => region.id !== mine.id && region.health !== 'down' && region.nodesTotal > 0,
      );
      if (elsewhere.length > 0) {
        lines.push({
          basis: 'observed',
          text: `${elsewhere.map((region) => regionName(region.id)).join(', ')} ${elsewhere.length === 1 ? 'is' : 'are'} still serving.`,
        });
      }
      return { correct: true, headline: `Yes: ${regionName(mine.id)} is dark.`, lines };
    }
    return {
      correct: false,
      headline: `Not ${nodeLabel(topology, chosen.id)}.`,
      lines: [
        {
          basis: 'observed',
          text: `It stands in ${regionName(chosen.region)}, where ${mine ? `${mine.nodesUnhealthy} of ${mine.nodesTotal} services are` : 'no service is'} out of their normal state: that region still answers.`,
        },
        {
          basis: 'observed',
          text: `One region has ${dark[0]!.nodesUnhealthy} of its ${dark[0]!.nodesTotal} services out at once. Arranged by region, its plate is the one that has gone dark.`,
        },
      ],
    };
  },
};

const EXPORT_REQUEST: EvaluateRequest = {
  principal: 'User::"alice"',
  action: 'Action::"exportLedger"',
  resource: 'Ledger::"acme-ledger-2026"',
  context: {},
};

const sameRequest = (decision: AuthorizationDecision, request: EvaluateRequest) =>
  decision.request.principal === request.principal &&
  decision.request.action === request.action &&
  decision.request.resource === request.resource;

/**
 * A challenge that hands the tracer a request Cedar denies and asks for the
 * one circumstance under which it is allowed. `keep` names what may not be
 * changed; `lesson` is what the two answers, side by side, show.
 */
function circumstance(
  spec: Pick<Challenge, 'id' | 'title' | 'brief'> & {
    request: EvaluateRequest;
    keep: string;
    lesson: string;
  },
): Challenge {
  const { request } = spec;
  return {
    id: spec.id,
    title: spec.title,
    brief: spec.brief,
    starts: 'Opens the request tracer with the request. The simulation is left as it is.',
    setup: { kind: 'request', request },
    prompt:
      'Evaluate the request and read the policies. Then change one thing about the circumstances of the request (not who asks, nor for what) so that Cedar allows it, and evaluate again.',
    unavailable: ({ catalog }) =>
      catalog &&
      catalog.principals.some((p) => p.uid === request.principal) &&
      catalog.actions.some((a) => a.uid === request.action) &&
      catalog.resources.some((r) => r.uid === request.resource)
        ? null
        : 'The policies in use do not know this request.',
    answerWith: ({ decision }) =>
      decision
        ? { label: 'Check my latest result' }
        : { waiting: 'Evaluate the request in the tracer first.' },
    check: ({ decision, catalog }) => {
      if (!decision) {
        return {
          correct: false,
          headline: 'Nothing has been evaluated yet.',
          lines: [{ text: 'Press “Evaluate with Cedar” in the tracer.' }],
        };
      }
      const policies = decision.determiningPolicies;
      const effectOf = (id: string) => catalog?.policies.find((policy) => policy.id === id)?.effect;
      const context = Object.entries(decision.request.context)
        .map(([key, value]) => `${key} = ${JSON.stringify(value)}`)
        .join(', ');
      if (!sameRequest(decision, request)) {
        return {
          correct: false,
          headline: 'That is another request.',
          lines: [
            {
              basis: 'cedar',
              text: `Cedar answered for ${entityId(decision.request.principal)} asking to ${entityId(decision.request.action)} ${entityId(decision.request.resource)}. ${spec.keep}`,
            },
          ],
        };
      }
      if (decision.decision === 'allow') {
        const lines: FeedbackLine[] = [
          {
            basis: 'cedar',
            text: `Cedar allows it under ${context || 'an empty context'}, and names ${policies.join(', ')} as the policy that decides.`,
          },
        ];
        const source = catalog?.policies.find((policy) => policy.id === policies[0])?.content;
        if (source) lines.push({ basis: 'cedar', text: source.replace(/\s+/g, ' ').trim() });
        lines.push({ text: spec.lesson });
        return { correct: true, headline: 'Yes: now it is allowed.', lines };
      }
      const forbids = policies.filter((id) => effectOf(id) === 'forbid');
      return {
        correct: false,
        headline: 'Still denied.',
        lines: [
          policies.length === 0
            ? {
                basis: 'cedar',
                text: `Under ${context || 'an empty context'} no policy decided this: nothing permits it, and Cedar denies by default. The decision lists, policy by policy, the permit that came closest; read its “when”.`,
              }
            : {
                basis: 'cedar',
                text: `Cedar names ${policies.join(', ')}${forbids.length > 0 ? ': a forbid, which no permit overrides. Read what it makes an exception for' : ''}.`,
              },
          ...(decision.disabledPolicies.length > 0
            ? [
                {
                  basis: 'cedar' as const,
                  text: `${decision.disabledPolicies.join(', ')} ${decision.disabledPolicies.length === 1 ? 'was' : 'were'} switched off for this evaluation; the answer asked for is the one under every policy.`,
                },
              ]
            : []),
        ],
      };
    },
  };
}

const EXPORT = circumstance({
  id: 'export-denied',
  title: 'Explain why this export was denied',
  brief:
    'Alice is a finance analyst of the tenant that owns the ledger. She asks to export it, and Cedar says no.',
  request: EXPORT_REQUEST,
  keep: 'Keep Alice, the export and the Acme ledger; change only the context or the policies.',
  lesson:
    'So the first answer was no for want of a permit, not because anything forbade it: Cedar denies whatever no policy permits.',
});

const DELETION = circumstance({
  id: 'deletion-denied',
  title: 'Find when a customer may be deleted',
  brief:
    'Carol administers her tenant and may do anything in it. She asks to delete one of its customers, and Cedar says no.',
  request: {
    principal: 'User::"carol"',
    action: 'Action::"deleteCustomer"',
    resource: 'Customer::"acme-cust-77"',
    context: {},
  },
  keep: 'Keep Carol, the deletion and the Acme customer; change only the context.',
  lesson:
    'So the first answer was no although a permit held: a forbid held too, and a forbid is never overridden. What changed is the one thing that forbid makes an exception for.',
});

export const CHALLENGES: readonly Challenge[] = [
  CASCADE,
  FLOOD,
  REGION,
  CONTRACTOR,
  EXPORT,
  DELETION,
];

export function challengeById(id: string | null): Challenge | undefined {
  return CHALLENGES.find((challenge) => challenge.id === id);
}
