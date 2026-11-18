import type {
  EdgeColumns,
  InfrastructureEdge,
  InfrastructureNode,
  NodeColumns,
  Region,
  RegionStatus,
} from '@aegis/contracts';

// The scene draws a graph. It does not need the simulation model or its bounds.
export type SceneNode = Pick<
  InfrastructureNode,
  'id' | 'name' | 'serviceType' | 'region' | 'tier'
> & {
  metrics: Pick<InfrastructureNode['metrics'], 'health' | 'throughputRps'>;
};

export interface SceneTopology {
  id: string;
  regions: Pick<Region, 'id' | 'name' | 'kind'>[];
  nodes: SceneNode[];
  edges: (Pick<InfrastructureEdge, 'id' | 'source' | 'target' | 'relationship'> & {
    metrics: Pick<InfrastructureEdge['metrics'], 'trafficRps' | 'errorRate'>;
  })[];
}

export interface SceneFrame {
  nodes: Pick<NodeColumns, 'health' | 'throughputRps'> & {
    /**
     * 1 where the service's state is known, 0 where the data does not give
     * it (an incident capture's "no data"). Left out, every state is known,
     * as it always is in the simulation.
     */
    known?: ArrayLike<number>;
    /**
     * 1 where the service's traffic was measured, 0 where it was not: that
     * piece's part rests as it was modelled, so its stillness says nothing.
     * Left out, all traffic is measured.
     */
    measured?: ArrayLike<number>;
  };
  edges: Pick<
    EdgeColumns,
    'trafficRps' | 'errorRate' | 'rejectedRps' | 'suspiciousRps' | 'securityStatus'
  >;
  regions: Pick<RegionStatus, 'id' | 'health'>[];
}

// ---------------------------------------------------------------------------
// How one piece is drawn
// ---------------------------------------------------------------------------

/** How present a piece outside the selection's neighbourhood stays. */
export const FOCUS_DIM = 0.48;
/** How present a filtered-out piece stays: `createPieceMaterial` mixes it this far from the plate. */
export const FILTERED_PRESENCE = 0.14;
/**
 * How far from the plate a receded piece is drawn: `createPieceMaterial`
 * mixes it from the plate by `FILTERED_PRESENCE` plus the rest times its
 * presence, `FOCUS_DIM`.
 */
export const RECEDED_MIX = FILTERED_PRESENCE + (1 - FILTERED_PRESENCE) * FOCUS_DIM;
/**
 * How much of its own tone a piece whose state is unknown keeps; the rest
 * is the plate's. It is mixed into the piece's colour, not into its
 * presence, so the piece keeps its shading and stays in front. It lies
 * between a receded piece and a normal one, nearer the normal: a shade
 * fainter than a piece in its normal state, never as faint as one that
 * receded (a test holds both themes to it). In the light theme a piece is
 * nearly the colour of its plate, so the tone alone cannot tell; the dashed
 * ring under the piece does (`UNKNOWN_RING`).
 */
export const UNKNOWN_TONE = 0.75;
/** The tone index of a piece whose state is unknown, after the four health codes. */
export const UNKNOWN = 4;
/**
 * Where the dashed ring under an unknown piece lies between the track tone
 * and the dim ink: three fifths of the way to the ink, which keeps it
 * without hue and clear of the plate in both themes (a test holds it to a
 * contrast of 3:1, the least WCAG asks of a mark that has to be seen).
 */
export const UNKNOWN_RING = 0.6;

type Triple = readonly [number, number, number];

const mixed = (from: Triple, to: Triple, amount: number): [number, number, number] =>
  [0, 1, 2].map((k) => from[k]! + (to[k]! - from[k]!) * amount) as [number, number, number];

/** The colour an unknown piece is drawn in: the piece's tone, a quarter of the way to the plate's. */
export function unknownTone(piece: Triple, plate: Triple): [number, number, number] {
  return mixed(plate, piece, UNKNOWN_TONE);
}

/** The colour of the dashed ring under an unknown piece, from the track tone and the dim ink. */
export function unknownRingTone(track: Triple, inkDim: Triple): [number, number, number] {
  return mixed(track, inkDim, UNKNOWN_RING);
}

/** What a piece is aimed at this frame. */
export interface PieceAim {
  /** A health code 0 to 3 for the piece's colour, or `UNKNOWN`. */
  tone: number;
  /** 1, or `FOCUS_DIM` for a piece that recedes. */
  focus: number;
  /** The state its mechanism works in, 0 evenly to 3 hanging down. */
  manner: number;
  /** How strongly its lamp shows, before presence. */
  lamp: number;
  /** 1 where the piece stands on a dashed ring, without hue: its state is not given. */
  open: 0 | 1;
  /** How much its name matters: 3 failing, 2 deviating, 1 reached by an incident, 0 the rest. */
  alarm: number;
}

/**
 * The rules for one piece, as a pure function so they can be tested
 * without a scene. A piece that is not in its normal state never recedes;
 * nor does one whose state is unknown, which is not normal either. An
 * unknown piece stands upright and works evenly, in a tone of its own, on
 * a dashed ring instead of a lamp: down is still the pale piece that hangs
 * crooked.
 */
export function aimPiece(
  out: PieceAim,
  code: number,
  known: boolean,
  partial: boolean,
  impacted: boolean,
  focusActive: boolean,
  related: boolean,
): PieceAim {
  const state = known ? code : 0;
  out.tone = known ? (partial ? 0 : state) : UNKNOWN;
  out.focus = !focusActive || related || state > 0 || impacted || !known ? 1 : FOCUS_DIM;
  // A piece that stands for several services, only some of them unwell,
  // still works, but not evenly: it hesitates, whatever the worst of them.
  out.manner = partial ? Math.min(state, 1) : state;
  out.lamp = state > 0 ? 1 : impacted ? 0.7 : 0;
  out.open = known ? 0 : 1;
  out.alarm = state === 2 ? 3 : state > 0 ? 2 : impacted ? 1 : 0;
  return out;
}

/** The presence a piece is drawn with: what the filters leave of it, times its focus. */
export const presenceOf = (visibility: number, aim: Pick<PieceAim, 'focus'>): number =>
  visibility * aim.focus;

/**
 * What the ground mark under a piece is told (`aRing.y` in
 * `createGroundMaterial`): how strongly its lamp shows, or, negative, how
 * strongly the dashed ring of an unknown state does. Either fades with the
 * piece's presence.
 */
export const groundMarkOf = (aim: Pick<PieceAim, 'lamp' | 'open'>, presence: number): number =>
  aim.open ? -presence : aim.lamp * presence;
