/**
 * The draft as the scene draws it.
 *
 * The scene draws whatever topology it is handed and does not know it is a
 * draft. Every figure on it comes from the engine: until the engine has run
 * the draft, a piece is drawn as unknown (fainter, on a dashed ring) and
 * rests as it was modelled, because nothing has said how it is; once it
 * has, each piece takes the state and the throughput the engine gave it at
 * rest, and the connections carry the traffic it computed. A piece the last
 * run did not have (one just added) is unknown until the next.
 */
import { HEALTH_BY_CODE } from '@aegis/contracts';

import type { SceneFrame, SceneTopology } from '@/graphics/sceneData';
import { edgeId, type TopologyDraft } from '@/lib/topologyFile';
import type { Answer } from '@/stores/editor';

/**
 * The id the scene knows the draft by. It does not follow the draft's own
 * id, so that renaming the platform is a change to the same model, not a
 * new one laid out afresh.
 */
export const DRAFT_SCENE_ID = 'draft:editor';

type Run = Extract<Answer, { state: 'ran' }>;

/** Each id of the run, at its index in the run's own columns. */
function indexOf(ids: readonly string[]): Map<string, number> {
  return new Map(ids.map((id, i) => [id, i]));
}

export function draftScene(
  draft: TopologyDraft,
  run: Run | null,
): { topology: SceneTopology; frame: SceneFrame } {
  const nodesRun = run ? indexOf(run.topology.nodes.map((node) => node.id)) : new Map();
  const edgesRun = run ? indexOf(run.topology.edges.map((edge) => edge.id)) : new Map();
  const columns = run?.snapshot;
  const at = (map: Map<string, number>, id: string): number | undefined => map.get(id);

  const health: number[] = [];
  const throughputRps: number[] = [];
  const known: number[] = [];
  for (const node of draft.nodes) {
    const k = at(nodesRun, node.id);
    const ran = columns !== undefined && k !== undefined;
    health.push(ran ? (columns.nodes.health[k] ?? 0) : 0);
    throughputRps.push(ran ? (columns.nodes.throughputRps[k] ?? 0) : 0);
    known.push(ran ? 1 : 0);
  }

  const edges = {
    trafficRps: [] as number[],
    errorRate: [] as number[],
    rejectedRps: [] as number[],
    suspiciousRps: [] as number[],
    securityStatus: [] as number[],
  };
  for (const edge of draft.edges) {
    const k = at(edgesRun, edgeId(edge));
    const ran = columns !== undefined && k !== undefined;
    edges.trafficRps.push(ran ? (columns.edges.trafficRps[k] ?? 0) : 0);
    edges.errorRate.push(ran ? (columns.edges.errorRate[k] ?? 0) : 0);
    edges.rejectedRps.push(ran ? (columns.edges.rejectedRps[k] ?? 0) : 0);
    edges.suspiciousRps.push(ran ? (columns.edges.suspiciousRps[k] ?? 0) : 0);
    edges.securityStatus.push(ran ? (columns.edges.securityStatus[k] ?? 0) : 0);
  }

  const regionIds = new Set(draft.regions.map((region) => region.id));
  const topology: SceneTopology = {
    id: DRAFT_SCENE_ID,
    regions: draft.regions.map((region) => ({
      id: region.id,
      name: region.name,
      kind: region.kind,
    })),
    nodes: draft.nodes.map((node, i) => ({
      id: node.id,
      name: node.name,
      serviceType: node.type,
      // A piece in a region the draft does not have still has to stand
      // somewhere; the first region is as good as any, and the bar names
      // the mistake.
      region: regionIds.has(node.region) ? node.region : (draft.regions[0]?.id ?? node.region),
      tier: node.tier,
      metrics: {
        health: HEALTH_BY_CODE[health[i] ?? 0] ?? 'healthy',
        throughputRps: throughputRps[i] ?? 0,
      },
    })),
    edges: draft.edges.map((edge, e) => ({
      id: edgeId(edge),
      source: edge.source,
      target: edge.target,
      relationship: edge.relationship,
      metrics: { trafficRps: edges.trafficRps[e] ?? 0, errorRate: edges.errorRate[e] ?? 0 },
    })),
  };

  const frame: SceneFrame = {
    nodes: { health, throughputRps, known, measured: known },
    edges,
    regions: columns
      ? columns.regions
          .filter((region) => regionIds.has(region.id))
          .map((region) => ({ id: region.id, health: region.health }))
      : [],
  };
  return { topology, frame };
}
