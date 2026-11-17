import { describe, expect, it } from 'vitest';

import * as fixtures from '@/test/fixtures';

import { cellKey, describeAccess, tabulate } from './accessMatrix';

const catalog = fixtures.catalog();
const matrix = fixtures.accessMatrix();

describe('the access matrix as a table', () => {
  it('has a row for each principal and a column for each action, and loses no answer', () => {
    const table = tabulate(matrix, catalog);
    expect(table.rows.map((row) => row.principal)).toEqual(catalog.principals.map((p) => p.uid));
    for (const row of table.rows) {
      expect(row.actions.map((entry) => entry.action)).toEqual(catalog.actions.map((a) => a.uid));
    }
    const listed = table.rows.flatMap((row) => row.actions.flatMap((entry) => entry.cells));
    expect(listed).toHaveLength(matrix.cells.length);
    expect(new Set(listed.map(cellKey)).size).toBe(matrix.cells.length);
    expect(table.asked).toBe(matrix.cells.length);
    expect(table.allowed).toBe(matrix.cells.filter((cell) => cell.decision === 'allow').length);
    expect(table.changed).toBe(0);
  });

  it('counts what Cedar answered, for the principal and the action it was asked about', () => {
    const table = tabulate(matrix, catalog);
    const of = (principal: string, action: string) =>
      table.rows
        .find((row) => row.principal === principal)!
        .actions.find((entry) => entry.action === action)!;
    // With a fresh MFA assertion a finance analyst may export her tenant's
    // ledger, and not the other tenant's.
    const exporting = of('User::"alice"', 'Action::"exportLedger"');
    expect(describeAccess(exporting)).toBe('1 of 2');
    expect(exporting.cells.find((cell) => cell.decision === 'allow')?.determiningPolicies).toEqual([
      'finance-export-ledger-mfa',
    ]);
    // A suspended principal may do nothing at all.
    for (const action of catalog.actions) {
      expect(describeAccess(of('User::"erin"', action.uid))).toBe('none');
    }
  });

  it('counts the answers that differ from another matrix over the same requests', () => {
    // The same requests with one answer turned round.
    const flipped = {
      ...matrix,
      cells: matrix.cells.map((cell, i) =>
        i === 0 ? { ...cell, decision: cell.decision === 'allow' ? 'deny' : 'allow' } : cell,
      ),
    } as typeof matrix;
    const table = tabulate(flipped, catalog, matrix);
    expect(table.changed).toBe(1);
    expect(table.rows[0]!.actions[0]!.changed).toBe(1);
    expect(table.rows.flatMap((row) => row.actions).filter((a) => a.changed > 0)).toHaveLength(1);
  });

  it('says how much of an action is allowed in a word or two', () => {
    const cells = matrix.cells.slice(0, 3);
    expect(describeAccess({ allowed: 0, cells })).toBe('none');
    expect(describeAccess({ allowed: 3, cells })).toBe('all 3');
    expect(describeAccess({ allowed: 2, cells })).toBe('2 of 3');
    expect(describeAccess({ allowed: 1, cells: cells.slice(0, 1) })).toBe('yes');
    expect(describeAccess({ allowed: 0, cells: [] })).toBe('not asked');
  });
});
