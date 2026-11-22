/**
 * What a drop does to the draft.
 *
 * A slot of the swimlanes (`slotAt` in `graphics/layout.ts`) is a region and
 * a tier, possibly a region or a column that is not there yet. These turn a
 * slot into the change it means, out of the changes of `lib/topologyFile.ts`,
 * so the palette, a piece carried across the table and the keyboard all
 * change the file the same way.
 */
import type { ServiceType } from '@aegis/contracts';

import type { DropSlot } from '@/graphics/layout';
import {
  addRegion,
  addService,
  insertTier,
  moveService,
  type TopologyDraft,
} from '@/lib/topologyFile';

/** The slot as fields of the file: a region that exists, made first when it does not. */
function settle(draft: TopologyDraft, slot: DropSlot): { draft: TopologyDraft; region: string } {
  let next = draft;
  let region = slot.region;
  if (slot.newRegion || region === null) {
    const made = addRegion(next);
    next = made.draft;
    region = made.id;
  }
  if (slot.insert) next = insertTier(next, slot.tier);
  return { draft: next, region };
}

/** A new service of `type` where it was dropped. */
export function dropNew(
  draft: TopologyDraft,
  type: ServiceType,
  slot: DropSlot,
): { draft: TopologyDraft; id: string } {
  const settled = settle(draft, slot);
  return addService(settled.draft, type, settled.region, slot.tier);
}

/** The service `id` stood where it was dropped. */
export function dropMove(draft: TopologyDraft, id: string, slot: DropSlot): TopologyDraft {
  if (!slot.newRegion && !slot.insert) {
    return moveService(draft, id, slot.region as string, slot.tier);
  }
  const settled = settle(draft, slot);
  return moveService(settled.draft, id, settled.region, slot.tier);
}

/**
 * Where a service added without being carried goes (a click on the
 * palette, or the keyboard): one tier past the one selected, in its
 * region; with nothing selected, past the last tier of the first region.
 * A client starts the path, at tier 0.
 */
export function placeFor(
  draft: TopologyDraft,
  type: ServiceType,
  near: string | null,
): { region: string; tier: number } {
  const from = draft.nodes.find((node) => node.id === near);
  if (from) return { region: from.region, tier: type === 'external-client' ? 0 : from.tier + 1 };
  const region = draft.regions.find((r) => r.kind === 'cloud') ?? draft.regions[0];
  const regionId = region?.id ?? 'main';
  if (type === 'external-client') return { region: regionId, tier: 0 };
  const tiers = draft.nodes.filter((node) => node.region === regionId).map((node) => node.tier);
  return { region: regionId, tier: tiers.length > 0 ? Math.max(...tiers) + 1 : 1 };
}

/** A service added without being carried, at `placeFor`. */
export function addNear(
  draft: TopologyDraft,
  type: ServiceType,
  near: string | null,
): { draft: TopologyDraft; id: string } {
  const at = placeFor(draft, type, near);
  return addService(draft, type, at.region, at.tier);
}
