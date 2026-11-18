import type { AccessCell, AccessMatrix, AuthorizationCatalog } from '@aegis/contracts';

import { t } from '@/i18n';

/** What one principal may do with one action: an answer per resource. */
export interface ActionAccess {
  action: string;
  /** In the catalogue's order. */
  cells: AccessCell[];
  allowed: number;
  /** How many of the answers differ from the matrix this one is set against. */
  changed: number;
}

export interface PrincipalAccess {
  principal: string;
  actions: ActionAccess[];
}

export interface Tabulated {
  rows: PrincipalAccess[];
  asked: number;
  allowed: number;
  /** Answers that differ from the matrix this one is set against. */
  changed: number;
}

export const cellKey = (cell: Pick<AccessCell, 'principal' | 'action' | 'resource'>) =>
  `${cell.principal}\n${cell.action}\n${cell.resource}`;

/**
 * The matrix laid out as a table: a row for each principal and a column for
 * each action, in the catalogue's order. Every figure is a count of Cedar's
 * answers; `against`, when given, is another matrix over the same requests
 * (all policies in force, say) and what differs from it is counted too.
 */
export function tabulate(
  matrix: AccessMatrix,
  catalog: AuthorizationCatalog,
  against: AccessMatrix | null = null,
): Tabulated {
  const before = new Map((against?.cells ?? []).map((cell) => [cellKey(cell), cell.decision]));
  const cells = new Map<string, AccessCell[]>();
  for (const cell of matrix.cells) {
    const key = `${cell.principal}\n${cell.action}`;
    const list = cells.get(key);
    if (list) list.push(cell);
    else cells.set(key, [cell]);
  }
  let allowed = 0;
  let changed = 0;
  const rows = catalog.principals.map((principal) => ({
    principal: principal.uid,
    actions: catalog.actions.map((action) => {
      const answers = cells.get(`${principal.uid}\n${action.uid}`) ?? [];
      const yes = answers.filter((cell) => cell.decision === 'allow').length;
      const moved = answers.filter((cell) => {
        const was = before.get(cellKey(cell));
        return was !== undefined && was !== cell.decision;
      }).length;
      allowed += yes;
      changed += moved;
      return { action: action.uid, cells: answers, allowed: yes, changed: moved };
    }),
  }));
  return { rows, asked: matrix.cells.length, allowed, changed };
}

/** How many of its resources an action is allowed on, in words. */
export function describeAccess(access: Pick<ActionAccess, 'allowed' | 'cells'>): string {
  const total = access.cells.length;
  if (total === 0) return t('not asked');
  if (access.allowed === 0) return t('none#resources');
  if (access.allowed === total) return total === 1 ? t('yes') : t('all {n}', { n: total });
  return t('{n} of {total}', { n: access.allowed, total });
}
