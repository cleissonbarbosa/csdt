import { describe, expect, it } from 'vitest';

import { topology as sampleTopology } from '@/test/fixtures';

import { labelOf, listNames, namedFrom, nodeLabel, nodeLabels, serviceNames } from './names';

describe('service names', () => {
  const topology = sampleTopology();

  it('say the region only where a name repeats', () => {
    const names = serviceNames(topology);
    // The orders database runs in two regions under one name.
    expect(names.get('use-orders-db')).toEqual({ name: 'Orders DB', region: 'US East · Primary' });
    expect(names.get('euw-orders-db')).toEqual({ name: 'Orders DB', region: 'EU West' });
    expect(labelOf(names.get('euw-orders-db')!)).toBe('Orders DB, EU West');
    // The edge router is the only one of its name.
    expect(names.get('edge-router')?.region).toBeNull();
    expect(nodeLabels(topology).get('edge-router')).toBe(names.get('edge-router')?.name);
  });

  it('give every service a label, and no two services the same one', () => {
    const labels = nodeLabels(topology);
    expect(labels.size).toBe(topology.nodes.length);
    const repeated = [...labels.values()].filter(
      (label, index, all) => all.indexOf(label) !== index,
    );
    expect(repeated).toEqual([]);
  });

  it('fall back to the id for a service the topology does not have', () => {
    expect(nodeLabel(topology, 'ghost')).toBe('ghost');
    expect(nodeLabel(null, 'ghost')).toBe('ghost');
  });

  it('say where a call goes when it leaves the region it is read from', () => {
    // Read in the table of the edge: three gateways, each somewhere else.
    expect(namedFrom(topology, 'global', ['use-gateway', 'euw-gateway', 'aps-gateway'])).toEqual([
      'API Gateway, US East · Primary',
      'API Gateway, EU West',
      'API Gateway, AP Southeast',
    ]);
    // Read in the table of US East: its own database needs no more than its
    // name, the replica it writes to does, and a name nothing shares never does.
    expect(
      namedFrom(topology, 'us-east', ['use-orders-db', 'euw-orders-db', 'edge-router', 'ghost']),
    ).toEqual(['Orders DB', 'Orders DB, EU West', 'Global Edge Router', 'ghost']);
  });

  it('set names apart by semicolons once one of them carries a region', () => {
    expect(listNames(['Payments', 'Inventory'])).toBe('Payments, Inventory');
    expect(listNames(['Orders DB, EU West', 'Inventory'])).toBe('Orders DB, EU West; Inventory');
    expect(listNames([])).toBe('');
  });

  it('are worked out once per topology', () => {
    expect(serviceNames(topology)).toBe(serviceNames(topology));
    expect(nodeLabels(topology)).toBe(nodeLabels(topology));
  });
});
