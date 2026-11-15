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
 *   `aPart`  0 body, 1 lighter detail, 2 the contrasting mark
 *   `aAo`    how open the vertex is to the sky, 0…1, baked in Blender
 * Every geometry rests on the plane `y = -1`.
 */
import { SERVICE_TYPES, type ServiceType } from '@aegis/contracts';
import * as THREE from 'three/webgpu';

import piecesUrl from './pieces.glb?url';

export type PieceSet = Record<ServiceType, THREE.BufferGeometry>;

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
  nodes: { name?: string; mesh?: number }[];
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

/** Reads every piece out of the GLB. Throws if a service type has none. */
export function parsePieces(buffer: ArrayBuffer): PieceSet {
  const { document, binary } = readChunks(buffer);
  const pieces: Partial<PieceSet> = {};

  for (const node of document.nodes) {
    const type = SERVICE_TYPES.find((candidate) => candidate === node.name);
    const mesh = node.mesh === undefined ? undefined : document.meshes[node.mesh];
    if (!type || !mesh) continue;

    const position: number[] = [];
    const normal: number[] = [];
    const part: number[] = [];
    const occlusion: number[] = [];
    const indices: number[] = [];
    for (const primitive of mesh.primitives) {
      const { POSITION, NORMAL, COLOR_0 } = primitive.attributes;
      if (POSITION === undefined || NORMAL === undefined) {
        throw new Error(`pieces: ${type} has a primitive without positions or normals`);
      }
      const positions = readAccessor(document, binary, POSITION).values;
      const normals = readAccessor(document, binary, NORMAL).values;
      const colours = COLOR_0 === undefined ? null : readAccessor(document, binary, COLOR_0);
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
        part.push(partId);
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
    geometry.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
    geometry.setAttribute('aAo', new THREE.Float32BufferAttribute(occlusion, 1));
    geometry.setIndex(indices);
    // Every piece rests on the same base plane (y = -1), so a node of scale
    // `s` placed `s` above a surface stands exactly on it.
    geometry.computeBoundingBox();
    geometry.translate(0, -1 - geometry.boundingBox!.min.y, 0);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    pieces[type] = geometry;
  }

  const missing = SERVICE_TYPES.filter((type) => !pieces[type]);
  if (missing.length > 0) throw new Error(`pieces: no model for ${missing.join(', ')}`);
  return pieces as PieceSet;
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
