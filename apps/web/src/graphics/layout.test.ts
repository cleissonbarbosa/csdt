import { describe, expect, it } from 'vitest';

import { largeTopology, topology } from '@/test/fixtures';

import {
  bezierPoint,
  computeLayout,
  curveLength,
  edgeControl,
  nodePosition,
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

describe('layout', () => {
  const helios = topology();

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
    const original = computeLayout(helios, 'regions');
    const reordered = computeLayout(shuffled, 'regions');
    helios.nodes.forEach((node, i) => {
      const j = shuffled.nodes.findIndex((other) => other.id === node.id);
      expect(nodePosition(reordered, j)).toEqual(nodePosition(original, i));
    });
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

  it('gives every cloud region its own platform, without overlap', () => {
    const layout = computeLayout(helios, 'regions');
    const cloud = layout.regions.filter((region) => region.kind === 'cloud');
    expect(cloud.map((r) => r.id)).toEqual(['us-east', 'eu-west', 'ap-southeast']);
    for (let i = 0; i < cloud.length; i++) {
      for (let j = i + 1; j < cloud.length; j++) {
        const a = cloud[i]!;
        const b = cloud[j]!;
        const distance = Math.hypot(a.center[0] - b.center[0], a.center[2] - b.center[2]);
        expect(distance).toBeGreaterThanOrEqual(a.radius + b.radius);
      }
    }
    // Every node stands on its own region's platform.
    helios.nodes.forEach((node, i) => {
      const region = cloud.find((r) => r.id === node.region);
      if (!region) return;
      const p = nodePosition(layout, i);
      expect(Math.hypot(p[0] - region.center[0], p[2] - region.center[2])).toBeLessThanOrEqual(
        region.radius,
      );
    });
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
    }
  });

  it('runs tiers outward from a raised hub', () => {
    const layout = computeLayout(helios, 'regions');
    const at = (id: string) =>
      nodePosition(
        layout,
        helios.nodes.findIndex((n) => n.id === id),
      );
    const gateway = at('use-gateway');
    const database = at('use-orders-db');
    expect(Math.hypot(gateway[0], gateway[2])).toBeLessThan(Math.hypot(database[0], database[2]));
    // The edge router is the centre of the hub, which stands above the regions.
    const router = at('edge-router');
    expect(router[0]).toBe(0);
    expect(router[2]).toBe(0);
    const hub = layout.regions.find((r) => r.kind === 'edge')!;
    for (const region of layout.regions) {
      if (region.kind === 'cloud') expect(hub.center[1]).toBeGreaterThan(region.center[1]);
    }
    // The monitor watches from above the router.
    const monitor = at('threat-monitor');
    expect(monitor[1]).toBeGreaterThan(router[1]);
    expect(layout.board).toBeNull();
  });

  it('lays dependencies out left to right by tier', () => {
    const layout = computeLayout(helios, 'dependencies');
    expect(layout.regions).toEqual([]);
    // One board under the whole graph, large enough for every service.
    expect(layout.board).not.toBeNull();
    for (let i = 0; i < helios.nodes.length; i++) {
      const p = nodePosition(layout, i);
      expect(Math.abs(p[0])).toBeLessThan(layout.board!.halfWidth);
      expect(Math.abs(p[2])).toBeLessThan(layout.board!.halfDepth);
    }
    const x = (id: string) =>
      nodePosition(
        layout,
        helios.nodes.findIndex((n) => n.id === id),
      )[0];
    expect(x('clients-na')).toBeLessThan(x('edge-router'));
    expect(x('edge-router')).toBeLessThan(x('use-gateway'));
    expect(x('use-gateway')).toBeLessThan(x('use-orders'));
    expect(x('use-orders')).toBeLessThan(x('use-orders-db'));
  });

  it('stays readable with hundreds of services', () => {
    const big = largeTopology(6, 40);
    expect(big.nodes.length).toBeGreaterThan(240);
    for (const mode of ['regions', 'dependencies'] as const) {
      const layout = computeLayout(big, mode);
      expect(minimumSeparation(layout)).toBeGreaterThan(2.4);
      expect(Array.from(layout.positions).every(Number.isFinite)).toBe(true);
    }
    const cloud = computeLayout(big, 'regions').regions.filter((r) => r.kind === 'cloud');
    expect(cloud).toHaveLength(6);
    const [a, b] = [cloud[0]!, cloud[1]!];
    expect(Math.hypot(a.center[0] - b.center[0], a.center[2] - b.center[2])).toBeGreaterThanOrEqual(
      a.radius + b.radius,
    );
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
    const layout = computeLayout(single, 'regions');
    expect(Array.from(layout.positions).every(Number.isFinite)).toBe(true);
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
