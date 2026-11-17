import { describe, expect, it } from 'vitest';

import * as fixtures from '@/test/fixtures';

import { challengeById, CHALLENGES, type Evidence } from './challenges';

const report = fixtures.incidentReport();
const evidence = (over: Partial<Evidence> = {}): Evidence => ({
  topology: fixtures.topology(),
  snapshot: fixtures.snapshot(),
  scenarios: fixtures.scenarios().scenarios,
  catalog: fixtures.catalog(),
  selection: null,
  report,
  decision: null,
  ...over,
});
const cascade = challengeById('cascade-origin')!;
const flood = challengeById('flood-stopped')!;
const exported = challengeById('export-denied')!;

describe('challenges', () => {
  it('are offered only where the platform has what they need', () => {
    for (const challenge of CHALLENGES) expect(challenge.unavailable(evidence())).toBeNull();
    const bare = evidence({ scenarios: [], catalog: null });
    for (const challenge of CHALLENGES) expect(challenge.unavailable(bare)).toMatch(/\./);
    // A scenario that is listed but cannot run does not count.
    const unavailable = evidence({
      scenarios: fixtures.scenarios().scenarios.map((s) => ({ ...s, available: false })),
    });
    expect(cascade.unavailable(unavailable)).not.toBeNull();
  });

  it('say what there is to answer with', () => {
    expect(cascade.answerWith(evidence())).toEqual({ waiting: expect.stringMatching(/Select/) });
    expect(
      cascade.answerWith(evidence({ selection: { kind: 'group', id: 'kind:database' } })),
    ).toEqual({ waiting: expect.stringMatching(/kind of service/) });
    expect(cascade.answerWith(evidence({ selection: { kind: 'node', id: 'use-auth' } }))).toEqual({
      label: 'Answer: Identity Service, US East · Primary',
    });
    expect(exported.answerWith(evidence())).toHaveProperty('waiting');
    expect(exported.answerWith(evidence({ decision: fixtures.decisionAllow() }))).toHaveProperty(
      'label',
    );
  });
});

describe('finding where an incident begins', () => {
  // The check reads the report; any incident's report will do.
  it('accepts the origin the report names, with the evidence for it', () => {
    const feedback = cascade.check(
      evidence({ selection: { kind: 'node', id: report.origin!.nodeId } }),
    );
    expect(feedback.correct).toBe(true);
    expect(feedback.headline).toBe('Yes: it begins at Identity Service, US East · Primary.');
    expect(feedback.lines[0]).toEqual({
      basis: 'prescribed',
      text: expect.stringContaining('the scenario names it as the root cause'),
    });
  });

  it('says so when what changed a service was a fault placed by hand', () => {
    // The sample was taken with the search service slowed down by hand.
    const feedback = cascade.check(evidence({ selection: { kind: 'node', id: 'use-search' } }));
    expect(feedback.correct).toBe(false);
    expect(feedback.lines[0]).toEqual({
      basis: 'by-hand',
      text: expect.stringContaining('a fault placed by hand is in force on it (latency ×3)'),
    });
  });

  it('tells a consequence from the origin by what the run says about it', () => {
    const other = report.propagation.find(
      (t) => t.nodeId !== report.origin!.nodeId && t.cause?.kind !== 'fault',
    )!;
    const feedback = cascade.check(evidence({ selection: { kind: 'node', id: other.nodeId } }));
    expect(feedback.correct).toBe(false);
    expect(feedback.headline).toMatch(/it is a consequence\.$/);
    expect(feedback.lines[0]!.text).toContain(`became ${other.to} at +`);
    expect(feedback.lines[1]!.text).toMatch(/left the normal state before it did/);
  });

  it('says so when the service was never affected, or nothing has happened yet', () => {
    const spared = fixtures
      .topology()
      .nodes.find((node) => !report.propagation.some((t) => t.nodeId === node.id))!;
    const untouched = cascade.check(evidence({ selection: { kind: 'node', id: spared.id } }));
    expect(untouched.correct).toBe(false);
    expect(untouched.lines[0]!.text).toMatch(/has stayed normal so far/);
    const early = cascade.check(
      evidence({
        selection: { kind: 'node', id: 'use-search' },
        report: { ...report, propagation: [] },
      }),
    );
    expect(early.lines[0]!.text).toMatch(/No service has left its normal state yet/);
    expect(cascade.check(evidence({ report: null })).correct).toBe(false);
  });
});

describe('finding where traffic is stopped', () => {
  it('is checked against the flows of the snapshot', () => {
    const snapshot = fixtures.snapshot();
    const flow = snapshot.flows[0]!;
    const stopped = { ...snapshot, flows: [{ ...flow, blockedAt: 'use-auth', deliveredRps: 10 }] };
    const right = flood.check(
      evidence({ snapshot: stopped, selection: { kind: 'node', id: 'use-auth' } }),
    );
    expect(right.correct).toBe(true);
    expect(right.lines[0]!.text).toContain(`“${flow.label}”`);
    const wrong = flood.check(
      evidence({ snapshot: stopped, selection: { kind: 'node', id: 'use-search' } }),
    );
    expect(wrong.correct).toBe(false);
    expect(wrong.lines[0]!.text).toMatch(/does not pass through/);
  });

  it('says nothing is stopping it while nothing is', () => {
    const snapshot = fixtures.snapshot();
    const open = { ...snapshot, flows: snapshot.flows.map((f) => ({ ...f, blockedAt: null })) };
    const feedback = flood.check(
      evidence({ snapshot: open, selection: { kind: 'node', id: 'use-auth' } }),
    );
    expect(feedback.correct).toBe(false);
    expect(feedback.headline).toBe('Nothing is stopping it yet.');
  });
});

describe('explaining a denied export', () => {
  const alice = fixtures.decisionAllow();

  it('is solved by Cedar allowing the same request, and quotes the policy that does', () => {
    const feedback = exported.check(evidence({ decision: alice }));
    expect(feedback.correct).toBe(true);
    expect(feedback.lines[0]!.text).toContain('finance-export-ledger-mfa');
    expect(feedback.lines[0]!.text).toContain('mfa = true');
    // The policy's own text, from the catalogue.
    expect(feedback.lines[1]!.text).toContain('context.mfa == true');
  });

  it('is not solved by a denial, and says what Cedar named', () => {
    const denied = {
      ...alice,
      decision: 'deny' as const,
      determiningPolicies: [],
      request: { ...alice.request, context: {} },
    };
    const feedback = exported.check(evidence({ decision: denied }));
    expect(feedback.correct).toBe(false);
    expect(feedback.lines[0]!.text).toMatch(/no policy decided this.*denies by default/);
    const forbidden = exported.check(
      evidence({ decision: { ...denied, determiningPolicies: ['forbid-suspended'] } }),
    );
    expect(forbidden.lines[0]!.text).toMatch(/forbid-suspended: a forbid/);
  });

  it('is not solved by asking something else', () => {
    const feedback = exported.check(evidence({ decision: fixtures.decisionDeny() }));
    expect(feedback.correct).toBe(false);
    expect(feedback.headline).toBe('That is another request.');
    expect(exported.check(evidence()).headline).toBe('Nothing has been evaluated yet.');
  });
});

describe('finding where a request of an incident is stopped', () => {
  const contractor = challengeById('contractor-stopped')!;
  it('reads where the snapshot says the traffic stops, whichever incident it is', () => {
    const snapshot = fixtures.snapshot();
    const stopped = snapshot.flows.find((flow) => flow.blockedAt !== null);
    if (!stopped) throw new Error('the sample has no stopped flow');
    for (const challenge of [flood, contractor]) {
      const right = challenge.check(
        evidence({ selection: { kind: 'node', id: stopped.blockedAt! } }),
      );
      expect(right.correct).toBe(true);
      expect(right.lines[0]).toEqual({
        basis: 'observed',
        text: expect.stringContaining(stopped.label),
      });
    }
    // What differs is who is said to decide the stop: the scenario may
    // prescribe a rejection, but a denial is only ever Cedar's.
    const said = (challenge: typeof flood) =>
      challenge.check(evidence({ selection: { kind: 'node', id: stopped.blockedAt! } })).lines[1]!;
    expect(said(flood).basis).toBe('prescribed');
    expect(said(contractor)).toEqual({
      basis: 'cedar',
      text: expect.stringContaining('No scenario can write a denial'),
    });
  });
});

describe('finding the region that went dark', () => {
  const region = challengeById('region-dark')!;
  const topology = fixtures.topology();
  /** The sample's snapshot with one region out, as the engine reports one. */
  const outage = (down: string) => {
    const snapshot = fixtures.snapshot();
    snapshot.regions = snapshot.regions.map((status) =>
      status.id === down
        ? { ...status, health: 'down' as const, nodesUnhealthy: status.nodesTotal }
        : { ...status, health: 'healthy' as const, nodesUnhealthy: 0 },
    );
    return snapshot;
  };
  const inRegion = (id: string) => topology.nodes.find((node) => node.region === id)!;

  it('accepts any service that stands in the region the snapshot reports down', () => {
    const snapshot = outage('eu-west');
    const feedback = region.check(
      evidence({ snapshot, selection: { kind: 'node', id: inRegion('eu-west').id } }),
    );
    expect(feedback.correct).toBe(true);
    expect(feedback.headline).toBe('Yes: EU West is dark.');
    const total = snapshot.regions.find((status) => status.id === 'eu-west')!.nodesTotal;
    expect(feedback.lines[0]).toEqual({
      basis: 'observed',
      text: `${total} of the ${total} services that stand in EU West are out of their normal state.`,
    });
  });

  it('says where a wrong answer stands, and that its region still answers', () => {
    const chosen = inRegion('us-east');
    const feedback = region.check(
      evidence({ snapshot: outage('eu-west'), selection: { kind: 'node', id: chosen.id } }),
    );
    expect(feedback.correct).toBe(false);
    expect(feedback.lines[0]!.text).toContain('It stands in US East · Primary');
    expect(feedback.lines[1]!.text).toContain('its plate is the one that has gone dark');
  });

  it('gives away nothing while no region is down', () => {
    const snapshot = fixtures.snapshot();
    snapshot.regions = snapshot.regions.map((status) => ({
      ...status,
      health: 'degraded' as const,
    }));
    const feedback = region.check(
      evidence({ snapshot, selection: { kind: 'node', id: inRegion('eu-west').id } }),
    );
    expect(feedback.correct).toBe(false);
    expect(feedback.headline).toBe('No region is dark yet.');
  });
});

describe('finding the circumstance a forbid makes an exception for', () => {
  const deletion = challengeById('deletion-denied')!;
  const asked = {
    principal: 'User::"carol"',
    action: 'Action::"deleteCustomer"',
    resource: 'Customer::"acme-cust-77"',
  };
  const decided = (over: Partial<ReturnType<typeof fixtures.decisionDeny>>) => ({
    ...fixtures.decisionDeny(),
    request: { ...asked, context: {} },
    ...over,
  });

  it('is offered for a request the catalogue knows', () => {
    expect(deletion.unavailable(evidence())).toBeNull();
    expect(deletion.setup).toEqual({ kind: 'request', request: { ...asked, context: {} } });
  });

  it('says a forbid decided, and that no permit overrides one', () => {
    const feedback = deletion.check(
      evidence({
        decision: decided({ determiningPolicies: ['forbid-destructive-outside-change-window'] }),
      }),
    );
    expect(feedback.correct).toBe(false);
    expect(feedback.lines[0]).toEqual({
      basis: 'cedar',
      text: expect.stringContaining('a forbid, which no permit overrides'),
    });
  });

  it('accepts the answer Cedar allows, and says what it shows', () => {
    const feedback = deletion.check(
      evidence({
        decision: decided({
          decision: 'allow',
          determiningPolicies: ['admin-own-tenant'],
          request: { ...asked, context: { changeWindow: true } },
        }),
      }),
    );
    expect(feedback.correct).toBe(true);
    expect(feedback.lines[0]!.text).toContain('changeWindow = true');
    expect(feedback.lines.at(-1)!.text).toContain('a forbid is never overridden');
  });

  it('does not take another request for an answer', () => {
    const feedback = deletion.check(evidence({ decision: fixtures.decisionAllow() }));
    expect(feedback.correct).toBe(false);
    expect(feedback.lines[0]!.text).toContain('Keep Carol, the deletion and the Acme customer');
  });
});
