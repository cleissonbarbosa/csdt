import { describe, expect, it } from 'vitest';

import * as fixtures from '@/test/fixtures';

import { exposureOf, guardedBy, resourceTypesAt } from './exposure';

const topology = fixtures.topology();
const typeOf = (id: string) => topology.nodes.find((node) => node.id === id)!.serviceType;
const callsOf = (id: string) =>
  topology.edges.filter((edge) => edge.source === id).map((edge) => edge.target);

describe('what a service is exposed to and exposes', () => {
  it('follows the connections a service opens, and the ones those open', () => {
    const exposure = exposureOf(topology, 'use-orders');
    // Everything it calls is reached, and reached before what is further on.
    const direct = callsOf('use-orders');
    expect(direct.length).toBeGreaterThan(0);
    for (const id of direct) expect(exposure.reaches).toContain(id);
    expect(exposure.reaches.slice(0, direct.length).sort()).toEqual([...direct].sort());
    // What it reaches is closed: nothing reached calls something that is not.
    const reached = new Set([...exposure.reaches, 'use-orders']);
    for (const id of exposure.reaches) {
      for (const next of callsOf(id)) expect(reached.has(next)).toBe(true);
    }
    expect(exposure.reaches).not.toContain('use-orders');
    expect(new Set(exposure.reaches).size).toBe(exposure.reaches.length);
  });

  it('counts the stores among what is reached', () => {
    const exposure = exposureOf(topology, 'use-orders');
    expect(exposure.stores).toContain('use-orders-db');
    for (const id of exposure.stores) {
      expect(['database', 'storage', 'message-queue']).toContain(typeOf(id));
    }
    expect(exposure.stores).toEqual(
      exposure.reaches.filter((id) =>
        ['database', 'storage', 'message-queue'].includes(typeOf(id)),
      ),
    );
  });

  it('finds the shortest way in from outside, hop by hop', () => {
    const { wayIn, reachedBy } = exposureOf(topology, 'use-orders-db');
    expect(wayIn).not.toBeNull();
    expect(typeOf(wayIn![0]!)).toBe('external-client');
    expect(wayIn!.at(-1)).toBe('use-orders-db');
    // Each step is a connection the topology draws.
    for (let i = 1; i < wayIn!.length; i++) {
      expect(callsOf(wayIn![i - 1]!)).toContain(wayIn![i]);
    }
    // Client, edge, gateway, a service that reads the store, the store.
    expect(wayIn!.length).toBe(5);
    expect(reachedBy).toContain('use-gateway');
    // Nothing leads to a client, and a client reaches the platform.
    const client = exposureOf(topology, wayIn![0]!);
    expect(client.reachedBy).toEqual([]);
    expect(client.wayIn).toBeNull();
    expect(client.reaches.length).toBeGreaterThan(20);
  });

  it('names the kinds of resource a service stands for', () => {
    expect(resourceTypesAt(topology, 'use-orders')).toEqual(['Order']);
    expect(resourceTypesAt(topology, 'use-ledger-db')).toEqual(['Ledger']);
    expect(resourceTypesAt(topology, 'use-gateway')).toEqual([]);
  });

  it('counts what Cedar answers about one kind of resource', () => {
    const matrix = fixtures.accessMatrix();
    const catalog = fixtures.catalog();
    const orders = guardedBy(matrix, catalog, 'Order');
    const cells = matrix.cells.filter((cell) => cell.resource.startsWith('Order::'));
    expect(orders.asked).toBe(cells.length);
    expect(orders.allowed).toBe(cells.filter((cell) => cell.decision === 'allow').length);
    expect(orders.ofPrincipals).toBe(catalog.principals.length);
    expect(orders.principals).toBeGreaterThan(0);
    expect(orders.principals).toBeLessThanOrEqual(orders.ofPrincipals);
    // A kind of resource nobody asks about has nothing counted.
    expect(guardedBy(matrix, catalog, 'Invoice')).toMatchObject({
      asked: 0,
      allowed: 0,
      principals: 0,
    });
  });
});
