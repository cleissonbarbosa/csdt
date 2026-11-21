/**
 * The service pieces: one modelled solid per service type.
 *
 * They are built in Blender by `scripts/build-pieces.py` and shipped as one
 * GLB next to this file. Every type keeps its own recognisable silhouette and
 * renders in one instanced draw call, so a piece is a single geometry here
 * whatever number of materials it had in the file.
 *
 * The file is read by the small parser below instead of a general glTF
 * loader: the asset is ours, it uses a narrow part of the format (float
 * positions, normals and vertex colours, indexed triangles, no textures, no
 * transforms), and reading exactly that keeps a loader and its material
 * system out of the bundle.
 *
 * Geometry attributes the piece material reads:
 *   `aPart`  x: 0 body, 1 lighter detail, 2 the contrasting mark
 *            y: the mechanism the vertex belongs to, 0 when it is fixed
 *   `aAo`    how open the vertex is to the sky, 0…1, baked in Blender
 * Every geometry rests on the plane `y = -1`.
 *
 * Every piece has a part that works: a door that turns, a line that
 * advances. The file says what moves and how (a kind of motion about a pivot
 * and an axis, and the way the part hangs when its service is down, all
 * declared where the part is modelled), and the parser lays those mechanisms
 * out as a small table the piece material reads, one column each. `aPart.y`
 * is a vertex's column, so one material moves all seventeen.
 *
 * not-interface-text: whole file. What it throws is for whoever built a
 * file it cannot read, in the console; a viewer is told the scene could not
 * start, in words of the interface's own.
 */
import { SERVICE_TYPES, type ServiceType } from '@aegis/contracts';
import * as THREE from 'three/webgpu';

import piecesUrl from './pieces.glb?url';

/**
 * The kinds of motion a mechanism can have, numbered as the build script
 * writes them. `createPieceMaterial` implements each.
 */
export const MOTION = { spin: 1, index: 2, swing: 3, slide: 4, convey: 5 } as const;
/**
 * A piece counts the time it has worked in seconds and starts again at this
 * many. Every mechanism's period divides it, so the wrap never shows.
 */
export const WORK_CYCLE = 720;
/** Rows of the mechanism table; see `PieceSet.table`. */
export const MECHANISM_ROWS = 4;
/** A vertex's mechanism number is this fraction of its first texture coordinate. */
const MECHANISM_STEP = 1 / 16;

type Triple = [number, number, number];

/** One working part of a piece, in the piece's own space. */
export interface Mechanism {
  /** One of `MOTION`. */
  kind: number;
  /** A point on the axis the part turns about or travels along. */
  pivot: Triple;
  axis: Triple;
  /** Seconds per cycle at the pace of normal traffic. */
  period: number;
  /** Notches per turn, radians or distance, depending on the kind. */
  amount: number;
  /** Where in its period the part starts, 0…1. */
  offset: number;
  /** The share of an index's period spent moving; whether a conveyed part grows or shrinks. */
  extra: number;
  /**
   * How the part hangs when its service is down: an axis through the pivot
   * and the angle, in radians, it is turned about it.
   */
  slump: [number, number, number, number];
}

export interface PieceSet {
  /** One geometry per service type. */
  shapes: Record<ServiceType, THREE.BufferGeometry>;
  /** What works on each piece. */
  mechanisms: Record<ServiceType, Mechanism[]>;
  /**
   * Every mechanism as texels: `MECHANISM_ROWS` rows of `columns` RGBA
   * floats. Column 0 is all zeros and stands for what is fixed.
   *
   *   row 0: pivot.xyz, kind      row 1: axis.xyz, cycles per second of work
   *   row 2: offset, amount, extra, _      row 3: slump axis.xyz, slump angle
   */
  table: { data: Float32Array; columns: number };
}

/** Material name in the file → part id read by the piece material. */
const PART: Record<string, number> = {
  'aegis-body': 0,
  'aegis-detail': 1,
  'aegis-mark': 2,
};

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const FLOAT = 5126;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_INT = 5125;
const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

interface Accessor {
  bufferView: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
}

interface GltfDocument {
  accessors: Accessor[];
  bufferViews: { byteOffset?: number; byteLength: number; byteStride?: number }[];
  materials?: { name?: string }[];
  meshes: {
    primitives: { attributes: Record<string, number>; indices?: number; material?: number }[];
  }[];
  nodes: { name?: string; mesh?: number; extras?: { mechanisms?: unknown } }[];
}

function readChunks(buffer: ArrayBuffer): { document: GltfDocument; binary: ArrayBuffer } {
  const view = new DataView(buffer);
  if (view.byteLength < 20 || view.getUint32(0, true) !== GLB_MAGIC) {
    throw new Error('pieces: not a GLB file');
  }
  let document: GltfDocument | null = null;
  let binary: ArrayBuffer | null = null;
  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (type === CHUNK_JSON) {
      document = JSON.parse(
        new TextDecoder().decode(new Uint8Array(buffer, start, length)),
      ) as GltfDocument;
    } else if (type === CHUNK_BIN) {
      // A copy starts at offset zero, so typed views over it are aligned.
      binary = buffer.slice(start, start + length);
    }
    offset = start + length;
  }
  if (!document || !binary) throw new Error('pieces: the GLB has no geometry');
  return { document, binary };
}

function readAccessor(
  document: GltfDocument,
  binary: ArrayBuffer,
  index: number,
): { values: Float32Array | Uint16Array | Uint32Array; size: number } {
  const accessor = document.accessors[index];
  const view = accessor && document.bufferViews[accessor.bufferView];
  const size = accessor && COMPONENTS[accessor.type];
  if (!accessor || !view || !size) throw new Error(`pieces: accessor ${index} is unreadable`);
  if (view.byteStride) throw new Error('pieces: interleaved buffers are not supported');
  const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const length = accessor.count * size;
  switch (accessor.componentType) {
    case FLOAT:
      return { values: new Float32Array(binary.slice(offset, offset + length * 4)), size };
    case UNSIGNED_SHORT:
      return { values: new Uint16Array(binary.slice(offset, offset + length * 2)), size };
    case UNSIGNED_INT:
      return { values: new Uint32Array(binary.slice(offset, offset + length * 4)), size };
    default:
      throw new Error(`pieces: component type ${accessor.componentType} is not supported`);
  }
}

const isNumbers = (value: unknown, count: number): value is number[] =>
  Array.isArray(value) && value.length === count && value.every((item) => Number.isFinite(item));
const isTriple = (value: unknown): value is Triple => isNumbers(value, 3);

/** A node's mechanisms, which the build script writes as a JSON string. */
function readMechanisms(source: unknown, type: ServiceType): Mechanism[] {
  const unreadable = new Error(`pieces: ${type} has an unreadable mechanism`);
  let list: unknown;
  try {
    list = typeof source === 'string' ? JSON.parse(source) : [];
  } catch {
    throw unreadable;
  }
  if (!Array.isArray(list)) throw unreadable;
  return list.map((entry: unknown) => {
    const { kind, pivot, axis, period, amount, offset, extra, slump } = (entry ?? {}) as Record<
      string,
      unknown
    >;
    const numbers = [kind, period, amount, offset, extra];
    if (
      !isTriple(pivot) ||
      !isTriple(axis) ||
      !isNumbers(slump, 4) ||
      !numbers.every((n) => Number.isFinite(n))
    ) {
      throw unreadable;
    }
    const [k, p, a, o, x] = numbers as number[];
    if (!(p! > 0)) throw unreadable;
    return {
      kind: k!,
      pivot: [...pivot],
      axis: [...axis],
      period: p!,
      amount: a!,
      offset: o!,
      extra: x!,
      slump: [slump[0]!, slump[1]!, slump[2]!, slump[3]!],
    };
  });
}

/** Reads every piece out of the GLB. Throws if a service type has none. */
export function parsePieces(buffer: ArrayBuffer): PieceSet {
  const { document, binary } = readChunks(buffer);
  const shapes: Partial<PieceSet['shapes']> = {};
  const mechanisms: Partial<PieceSet['mechanisms']> = {};
  // Column 0 of the table is what does not move.
  const columns: Mechanism[] = [];

  for (const node of document.nodes) {
    const type = SERVICE_TYPES.find((candidate) => candidate === node.name);
    const mesh = node.mesh === undefined ? undefined : document.meshes[node.mesh];
    if (!type || !mesh) continue;

    const working = readMechanisms(node.extras?.mechanisms, type);
    const firstColumn = columns.length + 1;
    const position: number[] = [];
    const normal: number[] = [];
    const part: number[] = [];
    const occlusion: number[] = [];
    const indices: number[] = [];
    for (const primitive of mesh.primitives) {
      const { POSITION, NORMAL, COLOR_0, TEXCOORD_0 } = primitive.attributes;
      if (POSITION === undefined || NORMAL === undefined) {
        throw new Error(`pieces: ${type} has a primitive without positions or normals`);
      }
      const positions = readAccessor(document, binary, POSITION).values;
      const normals = readAccessor(document, binary, NORMAL).values;
      const colours = COLOR_0 === undefined ? null : readAccessor(document, binary, COLOR_0);
      const tags = TEXCOORD_0 === undefined ? null : readAccessor(document, binary, TEXCOORD_0);
      const material =
        primitive.material === undefined ? undefined : document.materials?.[primitive.material];
      const partId = PART[material?.name ?? ''] ?? 0;
      const base = position.length / 3;
      const count = positions.length / 3;
      for (let i = 0; i < positions.length; i++) {
        position.push(positions[i]!);
        normal.push(normals[i]!);
      }
      for (let i = 0; i < count; i++) {
        const moves = tags ? Math.round((tags.values[i * tags.size] ?? 0) / MECHANISM_STEP) : 0;
        if (moves > working.length) {
          throw new Error(`pieces: ${type} has a vertex on a mechanism it does not declare`);
        }
        part.push(partId, moves === 0 ? 0 : firstColumn + moves - 1);
        // Occlusion is grey: any one channel carries it.
        occlusion.push(colours ? (colours.values[i * colours.size] ?? 1) : 1);
      }
      if (primitive.indices === undefined) {
        for (let i = 0; i < count; i++) indices.push(base + i);
      } else {
        for (const index of readAccessor(document, binary, primitive.indices).values) {
          indices.push(base + index);
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
    geometry.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 2));
    geometry.setAttribute('aAo', new THREE.Float32BufferAttribute(occlusion, 1));
    geometry.setIndex(indices);
    // Every piece rests on the same base plane (y = -1), so a node of scale
    // `s` placed `s` above a surface stands exactly on it.
    geometry.computeBoundingBox();
    const lift = -1 - geometry.boundingBox!.min.y;
    geometry.translate(0, lift, 0);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    // What a part turns about moves with the piece.
    for (const mechanism of working) mechanism.pivot[1] += lift;
    shapes[type] = geometry;
    mechanisms[type] = working;
    columns.push(...working);
  }

  const missing = SERVICE_TYPES.filter((type) => !shapes[type]);
  if (missing.length > 0) throw new Error(`pieces: no model for ${missing.join(', ')}`);

  const width = columns.length + 1;
  const data = new Float32Array(width * MECHANISM_ROWS * 4);
  columns.forEach((mechanism, index) => {
    const column = index + 1;
    data.set([...mechanism.pivot, mechanism.kind], column * 4);
    data.set([...mechanism.axis, 1 / mechanism.period], (width + column) * 4);
    data.set([mechanism.offset, mechanism.amount, mechanism.extra, 0], (2 * width + column) * 4);
    data.set(mechanism.slump, (3 * width + column) * 4);
  });
  return {
    shapes: shapes as PieceSet['shapes'],
    mechanisms: mechanisms as PieceSet['mechanisms'],
    table: { data, columns: width },
  };
}

let pending: Promise<PieceSet> | null = null;

/** Fetches and parses the pieces once; later calls share the result. */
export function loadPieces(): Promise<PieceSet> {
  pending ??= fetch(piecesUrl)
    .then((response) => {
      if (!response.ok) throw new Error(`pieces: the server answered ${response.status}`);
      return response.arrayBuffer();
    })
    .then(parsePieces)
    .catch((error: unknown) => {
      // Let a later attempt try again instead of caching the failure.
      pending = null;
      throw error;
    });
  return pending;
}
