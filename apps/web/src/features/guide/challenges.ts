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
  Health,
  IncidentReport,
  Scenario,
  TelemetrySnapshot,
  Topology,
} from '@aegis/contracts';

import { t } from '@/i18n';
import { entityId, formatPercent } from '@/lib/format';
import { nodeLabel } from '@/lib/names';
import { HEALTH_LABEL } from '@/lib/palette';
import {
  describeOrigin,
  describePrescribed,
  explainCause,
  sinceStart,
  type Explained,
} from '@/lib/report';
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
    : t('The platform in use cannot run the scenario this challenge needs.');

/** A selected service; a kind of service in the overview is not one. */
function selectedService(evidence: Evidence): { label: string } | { waiting: string } {
  const { selection, topology } = evidence;
  if (selection?.kind === 'node') {
    return { label: t('Answer: {service}', { service: nodeLabel(topology, selection.id) }) };
  }
  if (selection?.kind === 'group') {
    return { waiting: t('That is a kind of service. Open it and select one service.') };
  }
  return { waiting: t('Select a service on the model to answer with it.') };
}

/** `Orders DB became degraded at +0:16 because …`, with the cause when there is one. */
function became(service: string, to: Health, at: string, why: Explained | null): string {
  const values = { service, health: HEALTH_LABEL[to].toLowerCase(), at };
  if (!why) return t('{service} became {health} at {at}.', values);
  // In Portuguese this case cannot follow the word for "because".
  if (why.basis === 'unexplained') {
    return t(
      '{service} became {health} at {at} because of nothing the report can point to.',
      values,
    );
  }
  return t('{service} became {health} at {at} because {why}.', { ...values, why: why.text });
}

const CASCADE: Challenge = {
  id: 'cascade-origin',
  title: t('Find where the cascade begins'),
  brief: t(
    'Services start failing one after another. One of them is where it began; the rest follow from it.',
  ),
  starts: t('Starts the cascading failure scenario from a clean simulation.'),
  setup: { kind: 'scenario', scenarioId: 'cascading-failure' },
  prompt: t(
    'Watch which services leave their normal state, and in what order. Then select the service you think it began at.',
  ),
  unavailable: (evidence) => hasScenario(evidence, 'cascading-failure'),
  answerWith: selectedService,
  check: ({ selection, report, topology }) => {
    if (!report || selection?.kind !== 'node') {
      return {
        correct: false,
        headline: t('There is no incident to answer about yet.'),
        lines: [{ text: t('Start the challenge again and let the incident run.') }],
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
          text: t('In its first phase the scenario holds it to {effect}.', {
            effect: describePrescribed(first, topology),
          }),
        });
      }
      for (const next of report.propagation
        .filter((t) => t.nodeId !== selection.id && t.cause?.kind === 'dependency')
        .slice(0, 2)) {
        const why = explainCause(next.cause!, topology);
        lines.push({
          basis: why.basis,
          text: became(
            nodeLabel(topology, next.nodeId),
            next.to,
            sinceStart(report, next.atMs),
            why,
          ),
        });
      }
      return {
        correct: true,
        headline: t('Yes: it begins at {service}.', { service: name }),
        lines,
      };
    }
    const seen = report.propagation.find((t) => t.nodeId === selection.id);
    if (!seen) {
      lines.push({
        basis: 'observed',
        text:
          report.propagation.length === 0
            ? t('No service has left its normal state yet. Let the incident run a little longer.')
            : t(
                '{service} has stayed normal so far: the incident has not reached it. Look at the services whose lamp is lit.',
                { service: name },
              ),
      });
      return { correct: false, headline: t('Not {service}.', { service: name }), lines };
    }
    const why = seen.cause ? explainCause(seen.cause, topology) : null;
    lines.push({
      basis: why?.basis ?? 'observed',
      text: became(name, seen.to, sinceStart(report, seen.atMs), why),
    });
    const earlier = report.propagation.filter((t) => t.atMs < seen.atMs).length;
    lines.push({
      basis: 'observed',
      text:
        earlier > 0
          ? t(
              earlier === 1
                ? '{n} service left the normal state before it did. Follow what it depends on.'
                : '{n} services left the normal state before it did. Follow what it depends on.',
              { n: earlier },
            )
          : t(
              'Nothing was seen to fail before it, but the run says something acts on another service first. Follow what it calls.',
            ),
    });
    return {
      correct: false,
      headline: t('Not {service}: it is a consequence.', { service: name }),
      lines,
    };
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
        headline: t('There is no incident to answer about.'),
        lines: [{ text: t('Start the challenge again and let the incident run.') }],
      };
    }
    const name = nodeLabel(topology, selection.id);
    const stopped = snapshot.flows.filter((flow) => flow.blockedAt !== null);
    if (stopped.length === 0) {
      const flow = snapshot.flows[0];
      const mitigation = report?.phases.find((phase) => phase.status === 'mitigating');
      return {
        correct: false,
        headline: t('Nothing is stopping it yet.'),
        lines: [
          {
            basis: 'observed',
            text: flow
              ? t('Right now {share} of “{flow}” still gets through.', {
                  share: formatPercent(flow.rps > 0 ? flow.deliveredRps / flow.rps : 0),
                  flow: flow.label,
                })
              : t('The injected traffic has not started or has already ended.'),
          },
          {
            basis: 'prescribed',
            text: mitigation
              ? t(
                  "The scenario's mitigation phase, “{phase}”, began at {at}; it takes a few seconds to ease in.",
                  { phase: mitigation.name, at: sinceStart(report!, mitigation.atMs) },
                )
              : t('The scenario has not reached its mitigation phase. Let it run.'),
          },
        ],
      };
    }
    const here = stopped.find((flow) => flow.blockedAt === selection.id);
    if (here) {
      return {
        correct: true,
        headline: t('Yes: it is stopped at {service}.', { service: name }),
        lines: [
          {
            basis: 'observed',
            text: here.blockedReason
              ? t(
                  'Of {total} req/s of “{flow}”, {passed} req/s get past it (turned away by: {reason}).',
                  {
                    total: Math.round(here.rps),
                    flow: here.label,
                    passed: Math.round(here.deliveredRps),
                    reason: here.blockedReason,
                  },
                )
              : t('Of {total} req/s of “{flow}”, {passed} req/s get past it.', {
                  total: Math.round(here.rps),
                  flow: here.label,
                  passed: Math.round(here.deliveredRps),
                }),
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
      headline: t('Not {service}.', { service: name }),
      lines: [
        {
          basis: 'observed',
          text: onRoute
            ? t(
                '{service} is on the route, but it is not where most of this traffic is turned away.',
                { service: name },
              )
            : t(
                'This traffic does not pass through {service}. Its route is the one drawn on the model.',
                { service: name },
              ),
        },
        {
          basis: 'observed',
          text: t(
            "Only {share} of “{flow}” is still delivered: look for where the route's beads stop.",
            {
              share: formatPercent(flow.rps > 0 ? flow.deliveredRps / flow.rps : 0),
              flow: flow.label,
            },
          ),
        },
      ],
    };
  };
}

const FLOOD: Challenge = {
  id: 'flood-stopped',
  title: t('Find where the flood is stopped'),
  brief: t(
    'Hostile traffic pours in from outside. After a while a mitigation engages and most of it is turned away at one service.',
  ),
  starts: t('Starts the DDoS surge scenario from a clean simulation.'),
  setup: { kind: 'scenario', scenarioId: 'ddos-surge' },
  prompt: t(
    'Follow the incident’s route across the model. When the mitigation has engaged, select the service the flood is being stopped at.',
  ),
  unavailable: (evidence) => hasScenario(evidence, 'ddos-surge'),
  answerWith: selectedService,
  check: stoppedAt({
    basis: 'prescribed',
    text: t(
      'The scenario prescribes the rejection at this service; how much load that takes off what lies behind it is the model’s doing.',
    ),
  }),
};

const CONTRACTOR: Challenge = {
  id: 'contractor-stopped',
  title: t('Find where the contractor is stopped'),
  brief: t(
    'A contractor of another tenant is signed in, and asks for things that are not theirs to have. None of it reaches the data.',
  ),
  starts: t('Starts the Cedar authorization denial scenario from a clean simulation.'),
  setup: { kind: 'scenario', scenarioId: 'cedar-denial' },
  prompt: t(
    'Follow the route of the contractor’s requests. Once they ask for what they may not have, select the service they are stopped at.',
  ),
  unavailable: (evidence) => hasScenario(evidence, 'cedar-denial'),
  answerWith: selectedService,
  check: stoppedAt({
    basis: 'cedar',
    text: t(
      'No scenario can write a denial. This traffic stops at the authorizer because Cedar, asked the request it is made of, denies it under the policies in force.',
    ),
  }),
};

const REGION: Challenge = {
  id: 'region-dark',
  title: t('Find the region that went dark'),
  brief: t(
    'A whole cloud region stops answering. Traffic that went to it is sent elsewhere, and what stands there is out of reach.',
  ),
  starts: t('Starts the regional outage scenario from a clean simulation.'),
  setup: { kind: 'scenario', scenarioId: 'regional-outage' },
  prompt: t(
    'Watch the model, by region if you like. When a region has gone dark, select any service that stands in it.',
  ),
  unavailable: (evidence) => hasScenario(evidence, 'regional-outage'),
  answerWith: selectedService,
  check: ({ selection, snapshot, report, topology }) => {
    const chosen =
      selection?.kind === 'node' ? topology?.nodes.find((node) => node.id === selection.id) : null;
    if (!chosen || !snapshot?.incident || !topology) {
      return {
        correct: false,
        headline: t('There is no incident to answer about.'),
        lines: [{ text: t('Start the challenge again and let the incident run.') }],
      };
    }
    const regionName = (id: string) => topology.regions.find((r) => r.id === id)?.name ?? id;
    const dark = snapshot.regions.filter((region) => region.health === 'down');
    const mine = snapshot.regions.find((region) => region.id === chosen.region);
    if (dark.length === 0) {
      const worst = [...snapshot.regions].sort((a, b) => b.nodesUnhealthy - a.nodesUnhealthy)[0];
      return {
        correct: false,
        headline: t('No region is dark yet.'),
        lines: [
          {
            basis: 'observed',
            text:
              worst && worst.nodesUnhealthy > 0
                ? t(
                    '{region} has {n} of {total} services out of their normal state, and still answers {share} of what it is asked.',
                    {
                      region: regionName(worst.id),
                      n: worst.nodesUnhealthy,
                      total: worst.nodesTotal,
                      share: formatPercent(1 - worst.errorRate),
                    },
                  )
                : t('Every region is still serving. Let the incident run a little longer.'),
          },
        ],
      };
    }
    if (mine?.health === 'down') {
      const lines: FeedbackLine[] = [
        {
          basis: 'observed',
          text: t(
            '{n} of the {total} services that stand in {region} are out of their normal state.',
            { n: mine.nodesUnhealthy, total: mine.nodesTotal, region: regionName(mine.id) },
          ),
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
          text: t(
            elsewhere.length === 1 ? '{regions} is still serving.' : '{regions} are still serving.',
            {
              regions: elsewhere.map((region) => regionName(region.id)).join(', '),
            },
          ),
        });
      }
      return {
        correct: true,
        headline: t('Yes: {region} is dark.', { region: regionName(mine.id) }),
        lines,
      };
    }
    return {
      correct: false,
      headline: t('Not {service}.', { service: nodeLabel(topology, chosen.id) }),
      lines: [
        {
          basis: 'observed',
          text: mine
            ? t(
                'It stands in {region}, where {n} of {total} services are out of their normal state: that region still answers.',
                {
                  region: regionName(chosen.region),
                  n: mine.nodesUnhealthy,
                  total: mine.nodesTotal,
                },
              )
            : t(
                'It stands in {region}, where no service is out of their normal state: that region still answers.',
                { region: regionName(chosen.region) },
              ),
        },
        {
          basis: 'observed',
          text: t(
            'One region has {n} of its {total} services out at once. Arranged by region, its plate is the one that has gone dark.',
            { n: dark[0]!.nodesUnhealthy, total: dark[0]!.nodesTotal },
          ),
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
    starts: t('Opens the request tracer with the request. The simulation is left as it is.'),
    setup: { kind: 'request', request },
    prompt: t(
      'Evaluate the request and read the policies. Then change one thing about the circumstances of the request (not who asks, nor for what) so that Cedar allows it, and evaluate again.',
    ),
    unavailable: ({ catalog }) =>
      catalog &&
      catalog.principals.some((p) => p.uid === request.principal) &&
      catalog.actions.some((a) => a.uid === request.action) &&
      catalog.resources.some((r) => r.uid === request.resource)
        ? null
        : t('The policies in use do not know this request.'),
    answerWith: ({ decision }) =>
      decision
        ? { label: t('Check my latest result') }
        : { waiting: t('Evaluate the request in the tracer first.') },
    check: ({ decision, catalog }) => {
      if (!decision) {
        return {
          correct: false,
          headline: t('Nothing has been evaluated yet.'),
          lines: [{ text: t('Press “Evaluate with Cedar” in the tracer.') }],
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
          headline: t('That is another request.'),
          lines: [
            {
              basis: 'cedar',
              text: t('Cedar answered for {principal} asking to {action} {resource}. {keep}', {
                principal: entityId(decision.request.principal),
                action: entityId(decision.request.action),
                resource: entityId(decision.request.resource),
                keep: spec.keep,
              }),
            },
          ],
        };
      }
      if (decision.decision === 'allow') {
        const lines: FeedbackLine[] = [
          {
            basis: 'cedar',
            text: t(
              'Cedar allows it under {context}, and names {policies} as the policy that decides.',
              {
                context: context || t('an empty context'),
                policies: policies.join(', '),
              },
            ),
          },
        ];
        const source = catalog?.policies.find((policy) => policy.id === policies[0])?.content;
        if (source) lines.push({ basis: 'cedar', text: source.replace(/\s+/g, ' ').trim() });
        lines.push({ text: spec.lesson });
        return { correct: true, headline: t('Yes: now it is allowed.'), lines };
      }
      const forbids = policies.filter((id) => effectOf(id) === 'forbid');
      return {
        correct: false,
        headline: t('Still denied.'),
        lines: [
          policies.length === 0
            ? {
                basis: 'cedar',
                text: t(
                  'Under {context} no policy decided this: nothing permits it, and Cedar denies by default. The decision lists, policy by policy, the permit that came closest; read its “when”.',
                  { context: context || t('an empty context') },
                ),
              }
            : {
                basis: 'cedar',
                text: t(
                  forbids.length > 0
                    ? 'Cedar names {policies}: a forbid, which no permit overrides. Read what it makes an exception for.'
                    : 'Cedar names {policies}.',
                  { policies: policies.join(', ') },
                ),
              },
          ...(decision.disabledPolicies.length > 0
            ? [
                {
                  basis: 'cedar' as const,
                  text: t(
                    decision.disabledPolicies.length === 1
                      ? '{policies} was switched off for this evaluation; the answer asked for is the one under every policy.'
                      : '{policies} were switched off for this evaluation; the answer asked for is the one under every policy.',
                    { policies: decision.disabledPolicies.join(', ') },
                  ),
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
  title: t('Explain why this export was denied'),
  brief: t(
    'Alice is a finance analyst of the tenant that owns the ledger. She asks to export it, and Cedar says no.',
  ),
  request: EXPORT_REQUEST,
  keep: t('Keep Alice, the export and the Acme ledger; change only the context or the policies.'),
  lesson: t(
    'So the first answer was no for want of a permit, not because anything forbade it: Cedar denies whatever no policy permits.',
  ),
});

const DELETION = circumstance({
  id: 'deletion-denied',
  title: t('Find when a customer may be deleted'),
  brief: t(
    'Carol administers her tenant and may do anything in it. She asks to delete one of its customers, and Cedar says no.',
  ),
  request: {
    principal: 'User::"carol"',
    action: 'Action::"deleteCustomer"',
    resource: 'Customer::"acme-cust-77"',
    context: {},
  },
  keep: t('Keep Carol, the deletion and the Acme customer; change only the context.'),
  lesson: t(
    'So the first answer was no although a permit held: a forbid held too, and a forbid is never overridden. What changed is the one thing that forbid makes an exception for.',
  ),
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
