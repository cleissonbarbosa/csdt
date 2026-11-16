import { SERVICE_TYPES, TopologySchema } from '@aegis/contracts';
import { describe, expect, it } from 'vitest';

import {
  computeLayout,
  headingOf,
  nameAnchor,
  nodePosition,
  VIEW,
  viewOf,
} from '@/graphics/layout';
import * as fixtures from '@/test/fixtures';

import {
  buildOverview,
  LAYERS,
  overviewOf,
  partialGroups,
  projectHops,
  projectMask,
  projectNodeIds,
  projectSnapshot,
} from './overview';

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

describe('the overview', () => {
  const source = fixtures.topology();
  const overview = buildOverview(source);

  it('reduces the platform to its kinds of service, in four layers', () => {
    // Fifty-one services, twelve kinds: one piece for each.
    expect(source.nodes).toHaveLength(51);
    expect(overview.topology.nodes).toHaveLength(SERVICE_TYPES.length);
    expect(overview.topology.regions.map((region) => region.name)).toEqual([
      '01 Entry',
      '02 Identity',
      '03 Compute',
      '04 Data',
    ]);
    // It is a topology in its own right, and not mistaken for its source.
    expect(() => TopologySchema.parse(overview.topology)).not.toThrow();
    expect(overview.topology.id).not.toBe(source.id);
  });

  it('accounts for every service exactly once', () => {
    expect(sum(overview.members.map((members) => members.length))).toBe(source.nodes.length);
    source.nodes.forEach((node, i) => {
      const group = overview.topology.nodes[overview.groupOf[i]!]!;
      expect(group.serviceType).toBe(node.serviceType);
      expect(overview.groupOfNode.get(node.id)).toBe(group.id);
    });
  });

  it('names a kind by what it is, and says how many it stands for', () => {
    const gateways = overview.groupIndex.get('kind:api-gateway')!;
    expect(overview.topology.nodes[gateways]!.name).toBe('API gateways');
    expect(overview.labels[gateways]).toBe('3 API gateways');
    // A kind with one member is that member, under its own name.
    const router = overview.groupIndex.get('kind:network-gateway')!;
    expect(overview.members[router]).toHaveLength(1);
    expect(overview.labels[router]).toBe('Global Edge Router');
  });

  it('adds up the connections between two kinds, and leaves out those inside one', () => {
    const inside = source.edges.filter((_, e) => overview.edgeOf[e] === -1);
    for (const edge of inside) {
      expect(overview.groupOfNode.get(edge.source)).toBe(overview.groupOfNode.get(edge.target));
    }
    expect(sum(overview.memberEdges.map((edges) => edges.length)) + inside.length).toBe(
      source.edges.length,
    );
    for (const edge of overview.topology.edges) {
      expect(edge.source).not.toBe(edge.target);
      expect(edge.id).toBe(`${edge.source}->${edge.target}`);
    }
    // Every gateway authorizes with its region's Cedar: one line for all three.
    const authz = overview.topology.edges.find(
      (edge) => edge.id === 'kind:api-gateway->kind:cedar-authorizer',
    )!;
    expect(authz.relationship).toBe('authz');
    expect(overview.memberEdges[overview.topology.edges.indexOf(authz)]).toHaveLength(3);
  });

  it('derives every figure from the services it summarises', () => {
    const snapshot = fixtures.snapshot();
    const view = projectSnapshot(overview, snapshot);
    expect(view.topologyId).toBe(overview.topology.id);
    expect(view.nodes.health).toHaveLength(overview.topology.nodes.length);
    expect(view.edges.trafficRps).toHaveLength(overview.topology.edges.length);
    overview.members.forEach((members, g) => {
      // Rates are summed, and a kind is as unwell as its worst member.
      expect(view.nodes.throughputRps[g]).toBeCloseTo(
        sum(members.map((i) => snapshot.nodes.throughputRps[i]!)),
        6,
      );
      expect(view.nodes.health[g]).toBe(Math.max(...members.map((i) => snapshot.nodes.health[i]!)));
      // An average lies between the smallest and the largest of what it averages.
      const latencies = members.map((i) => snapshot.nodes.latencyMs[i]!);
      expect(view.nodes.latencyMs[g]).toBeGreaterThanOrEqual(Math.min(...latencies) - 1e-9);
      expect(view.nodes.latencyMs[g]).toBeLessThanOrEqual(Math.max(...latencies) + 1e-9);
      expect(view.nodes.errorRate[g]).toBeLessThanOrEqual(1);
    });
    overview.memberEdges.forEach((edges, k) => {
      expect(view.edges.trafficRps[k]).toBeCloseTo(
        sum(edges.map((e) => snapshot.edges.trafficRps[e]!)),
        6,
      );
    });
    // The incident names kinds, each once.
    const impacted = view.incident?.impactedNodeIds ?? [];
    expect(new Set(impacted).size).toBe(impacted.length);
    for (const id of impacted) expect(overview.groupIndex.has(id)).toBe(true);
  });

  it('tells a kind that is partly affected from one that is wholly so', () => {
    const snapshot = fixtures.snapshot();
    const partial = partialGroups(overview, snapshot);
    overview.members.forEach((members, g) => {
      const unwell = members.filter((i) => snapshot.nodes.health[i]! > 0).length;
      expect(partial[g]).toBe(unwell > 0 && unwell < members.length ? 1 : 0);
    });
    // In the sample, one of three identity services is critical.
    expect(partial[overview.groupIndex.get('kind:auth-service')!]).toBe(1);
  });

  it('translates paths, selections and filters to the kinds they touch', () => {
    const hops = [
      'partner-api->edge-router',
      'edge-router->use-gateway',
      'use-gateway->use-auth',
      'use-gateway->use-cedar',
    ];
    for (const hop of hops) expect(source.edges.some((edge) => edge.id === hop)).toBe(true);
    expect(projectHops(overview, hops)).toEqual([
      'kind:external-client->kind:network-gateway',
      'kind:network-gateway->kind:api-gateway',
      'kind:api-gateway->kind:auth-service',
      'kind:api-gateway->kind:cedar-authorizer',
    ]);
    expect(projectNodeIds(overview, ['use-cedar', 'euw-cedar', 'use-gateway'])).toEqual([
      'kind:cedar-authorizer',
      'kind:api-gateway',
    ]);
    // A kind stays in view while any of its services passes the filter.
    const mask = new Float32Array(source.nodes.length);
    mask[source.nodes.findIndex((node) => node.id === 'use-cedar')] = 1;
    const shown = projectMask(overview, mask)!;
    expect(sum([...shown])).toBe(1);
    expect(shown[overview.groupIndex.get('kind:cedar-authorizer')!]).toBe(1);
    expect(projectMask(overview, null)).toBeNull();
  });

  it('is built once for a topology and is the same every time', () => {
    expect(overviewOf(source)).toBe(overviewOf(source));
    expect(buildOverview(source).topology).toEqual(overview.topology);
  });

  it('is laid out as layers a request crosses from left to right', () => {
    const layout = computeLayout(overview.topology, 'layers');
    expect(layout.mode).toBe('layers');
    expect(layout.regions.map((region) => region.id)).toEqual(LAYERS.map((layer) => layer.id));
    // Layers follow one another along x and do not overlap.
    for (let k = 1; k < layout.regions.length; k++) {
      const before = layout.regions[k - 1]!;
      const after = layout.regions[k]!;
      expect(after.center[0] - after.halfWidth).toBeGreaterThan(
        before.center[0] + before.halfWidth,
      );
    }
    // Every piece stands on the plate of its own layer.
    overview.topology.nodes.forEach((node, i) => {
      const plate = layout.regions.find((region) => region.id === node.region)!;
      const [x, , z] = nodePosition(layout, i);
      const reach = layout.scales[i]!;
      expect(Math.abs(x - plate.center[0]) + reach).toBeLessThanOrEqual(plate.halfWidth);
      expect(Math.abs(z - plate.center[2]) + reach).toBeLessThanOrEqual(plate.halfDepth);
    });
    // A request meets clients, the edge and the gateway in that order.
    const at = (id: string) => nodePosition(layout, overview.groupIndex.get(id)!)[0];
    expect(at('kind:external-client')).toBeLessThan(at('kind:network-gateway'));
    expect(at('kind:network-gateway')).toBeLessThan(at('kind:api-gateway'));
    expect(at('kind:api-gateway')).toBeLessThan(at('kind:cedar-authorizer'));
    expect(at('kind:cedar-authorizer')).toBeLessThan(at('kind:microservice'));
    expect(at('kind:microservice')).toBeLessThan(at('kind:database'));
    // The same topology always gives the same picture.
    expect(computeLayout(overview.topology, 'layers').positions).toEqual(layout.positions);
  });

  it('is seen along the path on a stage taller than wide, and only the overview is', () => {
    expect(viewOf('layers', false)).toBe(VIEW.layers);
    expect(viewOf('regions', true)).toBe(VIEW.regions);
    expect(viewOf('dependencies', true)).toBe(VIEW.dependencies);
    // The camera stands on the ground at the entry's side of the model, so
    // the layers, which follow one another along x, run into the picture.
    const { azimuth, elevation } = viewOf('layers', true);
    expect(Math.sin(azimuth)).toBeLessThan(-0.9);
    expect(elevation).toBeGreaterThan(VIEW.layers.elevation);

    // There a heading stands beside its layer: off the rim that is on the
    // left of the picture, level with the middle of the plate.
    const layout = computeLayout(overview.topology, 'layers');
    for (const region of layout.regions) {
      const heading = headingOf(region, true)!;
      expect(heading.anchor[0]).toBeCloseTo(region.center[0], 6);
      expect(heading.anchor[2]).toBeLessThan(region.center[2] - region.halfDepth);
      expect(heading.align[0]).toBeLessThan(0);
      expect(nameAnchor(region, true)).toEqual(heading.anchor);
      // The usual attitude keeps the place it had.
      expect(nameAnchor(region)).toEqual(region.heading!.anchor);
      expect(headingOf(region)).toBe(region.heading);
    }
  });
});
