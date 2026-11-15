import { describe, expect, it } from 'vitest';

import { largeTopology, topology } from '@/test/fixtures';

import {
  bezierPoint,
  computeLayout,
  curveLength,
  edgeControl,
  hang,
  nameAnchor,
  nodePosition,
  VIEW,
  type RegionLayout,
  type SceneLayout,
} from './layout';

function minimumSeparation(layout: SceneLayout): number {
  const n = layout.positions.length / 3;
  let closest = Infinity;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = nodePosition(layout, i);
      const b = nodePosition(layout, j);
      closest = Math.min(closest, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
    }
  }
  return closest;
}

/** Table showing between two round plates; negative when they overlap. */
function gapBetween(a: RegionLayout, b: RegionLayout): number {
  return Math.hypot(a.center[0] - b.center[0], a.center[2] - b.center[2]) - a.radius - b.radius;
}

describe('layout', () => {
  const helios = topology();
  const indexOf = (id: string) => helios.nodes.findIndex((n) => n.id === id);

  it('is deterministic', () => {
    for (const mode of ['regions', 'dependencies'] as const) {
      const a = computeLayout(helios, mode);
      const b = computeLayout(helios, mode);
      expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
      expect(a.regions).toEqual(b.regions);
    }
  });

  it('does not depend on the order nodes are listed in', () => {
    const shuffled = { ...helios, nodes: [...helios.nodes].reverse() };
    for (const mode of ['regions', 'dependencies'] as const) {
      const original = computeLayout(helios, mode);
      const reordered = computeLayout(shuffled, mode);
      helios.nodes.forEach((node, i) => {
        const j = shuffled.nodes.findIndex((other) => other.id === node.id);
        expect(nodePosition(reordered, j)).toEqual(nodePosition(original, i));
      });
    }
  });

  it('places every node at a finite position with a positive scale', () => {
    for (const mode of ['regions', 'dependencies'] as const) {
      const layout = computeLayout(helios, mode);
      expect(layout.positions).toHaveLength(helios.nodes.length * 3);
      expect(Array.from(layout.positions).every(Number.isFinite)).toBe(true);
      expect(Array.from(layout.scales).every((s) => s > 0)).toBe(true);
      expect(layout.radius).toBeGreaterThan(10);
    }
  });

  it('keeps nodes apart', () => {
    expect(minimumSeparation(computeLayout(helios, 'regions'))).toBeGreaterThan(2.4);
    expect(minimumSeparation(computeLayout(helios, 'dependencies'))).toBeGreaterThan(2.4);
  });

  it('keeps a piece the same size in both arrangements', () => {
    // A piece that walks to a new place has no reason to change size on the way.
    expect(Array.from(computeLayout(helios, 'dependencies').scales)).toEqual(
      Array.from(computeLayout(helios, 'regions').scales),
    );
  });

  it('stands every service on a surface, as pieces of a scale model', () => {
    for (const mode of ['regions', 'dependencies'] as const) {
      const layout = computeLayout(helios, mode);
      expect(layout.ground).toHaveLength(helios.nodes.length);
      helios.nodes.forEach((node, i) => {
        // Geometry rests on y = -1, so centre = ground + scale means "standing".
        const lift = nodePosition(layout, i)[1] - layout.scales[i]! - layout.ground[i]!;
        expect(lift).toBeGreaterThan(-1e-4);
        // Only the security monitor is raised, on its mast above the router.
        if (node.serviceType !== 'security-monitor') expect(lift).toBeCloseTo(0, 4);
      });
      // The monitor watches from above the router, wherever the router stands.
      const router = nodePosition(layout, indexOf('edge-router'));
      const monitor = nodePosition(layout, indexOf('threat-monitor'));
      expect(monitor[0]).toBeCloseTo(router[0], 5);
      expect(monitor[2]).toBeCloseTo(router[2], 5);
      expect(monitor[1]).toBeGreaterThan(router[1] + layout.scales[indexOf('edge-router')]!);
    }
  });

  describe('by region', () => {
    const layout = computeLayout(helios, 'regions');
    const cloud = layout.regions.filter((region) => region.kind === 'cloud');
    const hub = layout.regions.find((region) => region.kind === 'edge')!;
    const at = (id: string) => nodePosition(layout, indexOf(id));
    const plateOf = (id: string) => cloud.find((r) => r.id === helios.nodes[indexOf(id)]!.region)!;
    /** Distance of a node from the hub's side of its plate, along the plate's axis. */
    const depth = (id: string) => {
      const plate = plateOf(id);
      const p = at(id);
      return (
        (p[0] - plate.center[0]) * plate.outward[0] + (p[2] - plate.center[2]) * plate.outward[1]
      );
    };

    it('gives every region a round plate of its own', () => {
      expect(cloud.map((r) => r.id)).toEqual(['us-east', 'eu-west', 'ap-southeast']);
      expect(layout.regions.every((r) => r.shape === 'disc')).toBe(true);
      // Every node stands on its own region's plate, clear of the rim.
      helios.nodes.forEach((node, i) => {
        const region = layout.regions.find((r) => r.id === node.region)!;
        const p = nodePosition(layout, i);
        expect(Math.hypot(p[0] - region.center[0], p[2] - region.center[2])).toBeLessThanOrEqual(
          region.radius - layout.scales[i]!,
        );
      });
    });

    it('lets no plate stand over another, so nothing is hidden under one', () => {
      for (let i = 0; i < layout.regions.length; i++) {
        for (let j = i + 1; j < layout.regions.length; j++) {
          expect(gapBetween(layout.regions[i]!, layout.regions[j]!)).toBeGreaterThan(1);
        }
      }
    });

    it('makes a plate as large as what stands on it', () => {
      const radius = (id: string) => cloud.find((r) => r.id === id)!.radius;
      // 23, 13 and 8 services.
      expect(radius('us-east')).toBeGreaterThan(radius('eu-west'));
      expect(radius('eu-west')).toBeGreaterThan(radius('ap-southeast'));
      // The plates stand as close to the hub as they can: each is a gap away.
      for (const region of cloud) expect(gapBetween(hub, region)).toBeLessThan(2.5);
    });

    it('puts the edge on a plinth at the centre, the router in the middle', () => {
      expect(hub.center[0]).toBe(0);
      expect(hub.center[2]).toBe(0);
      for (const region of cloud) expect(hub.center[1]).toBeGreaterThan(region.center[1]);
      const router = at('edge-router');
      expect(router[0]).toBe(0);
      expect(router[2]).toBe(0);
    });

    it('runs tiers outward from the hub as lines, a tier further out than the one before', () => {
      const gateway = at('use-gateway');
      const database = at('use-orders-db');
      expect(Math.hypot(gateway[0], gateway[2])).toBeLessThan(Math.hypot(database[0], database[2]));
      for (const region of cloud) {
        const members = helios.nodes.filter((node) => node.region === region.id);
        const tiers = [...new Set(members.map((node) => node.tier))].sort((a, b) => a - b);
        let previous = -Infinity;
        for (const tier of tiers) {
          const depths = members.filter((node) => node.tier === tier).map((node) => depth(node.id));
          // More room between two tiers than between two pieces of one tier,
          // which is what makes the lines readable.
          if (previous > -Infinity) expect(Math.min(...depths) - previous).toBeGreaterThan(3.6);
          previous = Math.max(...depths);
        }
      }
    });

    it('turns the first region to face the default camera', () => {
      const { azimuth } = VIEW.regions;
      expect(cloud[0]!.outward[0]).toBeCloseTo(Math.sin(azimuth), 5);
      expect(cloud[0]!.outward[1]).toBeCloseTo(Math.cos(azimuth), 5);
    });

    it('keeps the clients off the line of sight through the router', () => {
      const { azimuth } = VIEW.regions;
      const clients = helios.nodes.filter((node) => node.serviceType === 'external-client');
      expect(clients.length).toBeGreaterThan(0);
      for (const client of clients) {
        const p = at(client.id);
        // Distance from the vertical plane through the camera and the router.
        const aside = Math.abs(p[0] * Math.cos(azimuth) - p[2] * Math.sin(azimuth));
        expect(aside).toBeGreaterThan(1.2);
      }
    });
  });

  describe('by dependency', () => {
    const layout = computeLayout(helios, 'dependencies');
    const lanes = layout.regions.filter((region) => region.kind === 'cloud');
    const edge = layout.regions.find((region) => region.kind === 'edge')!;
    const at = (id: string) => nodePosition(layout, indexOf(id));

    it('runs tiers left to right, in the direction requests travel', () => {
      const x = (id: string) => at(id)[0];
      expect(x('clients-na')).toBeLessThan(x('edge-router'));
      expect(x('edge-router')).toBeLessThan(x('use-gateway'));
      expect(x('use-gateway')).toBeLessThan(x('use-orders'));
      expect(x('use-orders')).toBeLessThan(x('use-orders-db'));
    });

    it('gives every region a lane of its own across the tiers', () => {
      expect(lanes.map((r) => r.id)).toEqual(['us-east', 'eu-west', 'ap-southeast']);
      expect(layout.regions.every((r) => r.shape === 'slab')).toBe(true);
      helios.nodes.forEach((node, i) => {
        const region = layout.regions.find((r) => r.id === node.region)!;
        const p = nodePosition(layout, i);
        expect(Math.abs(p[0] - region.center[0])).toBeLessThan(region.halfWidth);
        expect(Math.abs(p[2] - region.center[2])).toBeLessThan(region.halfDepth);
      });
      // Lanes are one length, stacked in the order of the regions, and apart.
      for (let k = 0; k < lanes.length; k++) {
        expect(lanes[k]!.center[0]).toBeCloseTo(lanes[0]!.center[0], 5);
        expect(lanes[k]!.halfWidth).toBeCloseTo(lanes[0]!.halfWidth, 5);
        if (k === 0) continue;
        const before = lanes[k - 1]!;
        const gap =
          lanes[k]!.center[2] - lanes[k]!.halfDepth - (before.center[2] + before.halfDepth);
        expect(gap).toBeGreaterThan(1);
      }
      // The edge stands before them, clear of every lane.
      expect(edge.center[0] + edge.halfWidth).toBeLessThan(
        lanes[0]!.center[0] - lanes[0]!.halfWidth,
      );
    });

    it('lines a tier up across the lanes', () => {
      const x = (id: string) => at(id)[0];
      expect(x('euw-gateway')).toBeCloseTo(x('use-gateway'), 5);
      expect(x('aps-gateway')).toBeCloseTo(x('use-gateway'), 5);
      // A lane is centred on its gateway.
      for (const lane of lanes) {
        const gateway = helios.nodes.find(
          (node) => node.region === lane.id && node.serviceType === 'api-gateway',
        )!;
        expect(at(gateway.id)[2]).toBeCloseTo(lane.center[2], 5);
      }
    });

    it('is centred on the origin', () => {
      let low = Infinity;
      let high = -Infinity;
      for (const region of layout.regions) {
        low = Math.min(low, region.center[0] - region.halfWidth);
        high = Math.max(high, region.center[0] + region.halfWidth);
      }
      expect(low + high).toBeCloseTo(0, 4);
    });
  });

  it('stays readable with hundreds of services', () => {
    const big = largeTopology(6, 40);
    expect(big.nodes.length).toBeGreaterThan(240);
    for (const mode of ['regions', 'dependencies'] as const) {
      const layout = computeLayout(big, mode);
      expect(minimumSeparation(layout)).toBeGreaterThan(2.4);
      expect(Array.from(layout.positions).every(Number.isFinite)).toBe(true);
      expect(layout.regions).toHaveLength(7);
    }
    const plates = computeLayout(big, 'regions').regions;
    for (let i = 0; i < plates.length; i++) {
      for (let j = i + 1; j < plates.length; j++) {
        expect(gapBetween(plates[i]!, plates[j]!)).toBeGreaterThan(1);
      }
    }
  });

  it('handles degenerate topologies', () => {
    const empty = { ...helios, nodes: [], edges: [] };
    expect(computeLayout(empty, 'regions').positions).toHaveLength(0);
    expect(computeLayout(empty, 'dependencies').radius).toBeGreaterThan(0);
    const single = {
      ...helios,
      nodes: [helios.nodes.find((n) => n.id === 'use-gateway')!],
      edges: [],
    };
    for (const mode of ['regions', 'dependencies'] as const) {
      const layout = computeLayout(single, mode);
      expect(Array.from(layout.positions).every(Number.isFinite)).toBe(true);
      expect(layout.regions).toHaveLength(1);
    }
    // The edge alone, with no region to serve.
    const edgeOnly = { ...helios, nodes: helios.nodes.filter((n) => n.region === 'global') };
    for (const mode of ['regions', 'dependencies'] as const) {
      const layout = computeLayout(edgeOnly, mode);
      expect(Array.from(layout.positions).every(Number.isFinite)).toBe(true);
      expect(minimumSeparation(layout)).toBeGreaterThan(2.4);
    }
  });
});

describe('plate names', () => {
  it('are anchored off the rim, on the outward side', () => {
    for (const mode of ['regions', 'dependencies'] as const) {
      for (const region of computeLayout(topology(), mode).regions) {
        const anchor = nameAnchor(region);
        const dx = anchor[0] - region.center[0];
        const dz = anchor[2] - region.center[2];
        expect(dx * region.outward[0] + dz * region.outward[1]).toBeGreaterThan(0);
        if (region.shape === 'disc') expect(Math.hypot(dx, dz)).toBeGreaterThan(region.radius);
        else {
          expect(Math.abs(dx) > region.halfWidth || Math.abs(dz) > region.halfDepth).toBe(true);
        }
      }
    }
  });

  it('hang on the side they are pointed to, touching their anchor', () => {
    // Straight to one side: the box starts at the anchor.
    expect(hang(1, 0, 200, 27)).toEqual([0.5, 0]);
    expect(hang(-3, 0, 200, 27)).toEqual([-0.5, 0]);
    expect(hang(0, 2, 200, 27)).toEqual([0, 0.5]);
    expect(hang(0, -1, 200, 27)).toEqual([0, -0.5]);
    // Mostly downward: the box hangs below the anchor and slides a little aside.
    const [x, y] = hang(0.2, -1, 200, 27);
    expect(y).toBeCloseTo(-0.5, 5);
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(0.5);
    // The anchor is never inside the box, whatever the direction.
    for (let k = 0; k < 16; k++) {
      const angle = (k / 16) * Math.PI * 2;
      const [ax, ay] = hang(Math.cos(angle), Math.sin(angle), 200, 27);
      expect(Math.max(Math.abs(ax), Math.abs(ay))).toBeCloseTo(0.5, 5);
    }
    // No direction at all: stand on the anchor, as a service's name does.
    expect(hang(0, 0, 200, 27)).toEqual([0, 0.5]);
  });
});

describe('edge curves', () => {
  it('start and end at their nodes and arc upward between them', () => {
    const a: [number, number, number] = [0, 1, 0];
    const b: [number, number, number] = [10, 3, 0];
    const control = edgeControl(a, b);
    expect(bezierPoint(a, control, b, 0)).toEqual(a);
    expect(bezierPoint(a, control, b, 1)).toEqual(b);
    expect(bezierPoint(a, control, b, 0.5)[1]).toBeGreaterThan(3);
    expect(curveLength(a, control, b)).toBeGreaterThan(Math.hypot(10, 2));
  });

  it('lift longer edges higher, up to a ceiling', () => {
    const short = edgeControl([0, 0, 0], [4, 0, 0])[1];
    const long = edgeControl([0, 0, 0], [40, 0, 0])[1];
    const huge = edgeControl([0, 0, 0], [4000, 0, 0])[1];
    expect(long).toBeGreaterThan(short);
    expect(huge).toBe(13);
  });
});
