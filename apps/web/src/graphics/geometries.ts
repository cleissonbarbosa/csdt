/**
 * Procedural geometry for each service type.
 *
 * Every type gets its own recognisable silhouette, assembled from primitives
 * and merged into a single geometry so that all nodes of a type render in one
 * instanced draw call. A per-vertex `aPart` attribute marks which pieces are
 * dark structural body (0), luminous accent (1) or bright core (2); the node
 * material turns that into emissive intensity.
 */
import type { ServiceType } from '@aegis/contracts';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as THREE from 'three/webgpu';

const BODY = 0;
const ACCENT = 1;
const CORE = 2;

interface Placement {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number] | number;
}

const scratch = new THREE.Matrix4();
const quaternion = new THREE.Quaternion();
const euler = new THREE.Euler();

/** Tags a primitive with its part id and bakes its placement in. */
function piece(
  geometry: THREE.BufferGeometry,
  part: number,
  placement: Placement = {},
): THREE.BufferGeometry {
  const prepared = geometry.index ? geometry.toNonIndexed() : geometry;
  if (prepared !== geometry) geometry.dispose();
  const { position = [0, 0, 0], rotation = [0, 0, 0], scale = 1 } = placement;
  const s: [number, number, number] = typeof scale === 'number' ? [scale, scale, scale] : scale;
  quaternion.setFromEuler(euler.set(rotation[0], rotation[1], rotation[2]));
  scratch.compose(new THREE.Vector3(...position), quaternion, new THREE.Vector3(...s));
  prepared.applyMatrix4(scratch);
  const count = prepared.getAttribute('position').count;
  prepared.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(count).fill(part), 1));
  prepared.deleteAttribute('uv');
  return prepared;
}

function assemble(pieces: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(pieces, false);
  for (const p of pieces) p.dispose();
  if (!merged) throw new Error('node geometry could not be merged');
  merged.computeBoundingSphere();
  return merged;
}

const HALF_PI = Math.PI / 2;

/** A vertical ring you can look through: the gateway as a portal. */
function apiGateway(): THREE.BufferGeometry {
  return assemble([
    piece(new THREE.TorusGeometry(0.82, 0.1, 10, 40), ACCENT),
    piece(new THREE.TorusGeometry(1.04, 0.028, 6, 48), ACCENT),
    piece(new THREE.OctahedronGeometry(0.4), CORE),
    piece(new THREE.CylinderGeometry(0.5, 0.62, 0.16, 6), BODY, { position: [0, -1.0, 0] }),
    piece(new THREE.BoxGeometry(0.1, 0.24, 0.1), BODY, { position: [0, -0.86, 0] }),
  ]);
}

function shieldShape(scale: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0, 0.92 * scale);
  s.lineTo(0.72 * scale, 0.62 * scale);
  s.lineTo(0.72 * scale, -0.02 * scale);
  s.quadraticCurveTo(0.66 * scale, -0.62 * scale, 0, -0.98 * scale);
  s.quadraticCurveTo(-0.66 * scale, -0.62 * scale, -0.72 * scale, -0.02 * scale);
  s.lineTo(-0.72 * scale, 0.62 * scale);
  s.closePath();
  return s;
}

/** A shield with a keyhole: who are you? */
function authService(): THREE.BufferGeometry {
  const body = new THREE.ExtrudeGeometry(shieldShape(1), {
    depth: 0.26,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.05,
    bevelSegments: 2,
    curveSegments: 10,
  });
  const keyhole = (z: number, flip: number) => [
    piece(new THREE.TorusGeometry(0.2, 0.055, 8, 24), ACCENT, {
      position: [0, 0.16, z],
      rotation: [0, flip, 0],
    }),
    piece(new THREE.BoxGeometry(0.11, 0.42, 0.06), ACCENT, { position: [0, -0.22, z] }),
  ];
  return assemble([
    piece(body, BODY, { position: [0, 0, -0.13] }),
    ...keyhole(0.2, 0),
    ...keyhole(-0.2, Math.PI),
    piece(new THREE.TorusGeometry(0.98, 0.022, 6, 6), ACCENT, { rotation: [0, 0, HALF_PI / 3] }),
  ]);
}

/** A stylised cedar: three stacked canopies over a glowing trunk. */
function cedarAuthorizer(): THREE.BufferGeometry {
  return assemble([
    piece(new THREE.ConeGeometry(0.86, 0.72, 6, 1), BODY, { position: [0, -0.2, 0] }),
    piece(new THREE.ConeGeometry(0.66, 0.66, 6, 1), BODY, { position: [0, 0.3, 0] }),
    piece(new THREE.ConeGeometry(0.44, 0.62, 6, 1), BODY, { position: [0, 0.78, 0] }),
    piece(new THREE.TorusGeometry(0.8, 0.03, 6, 6), ACCENT, {
      position: [0, -0.52, 0],
      rotation: [HALF_PI, 0, 0],
    }),
    piece(new THREE.TorusGeometry(0.6, 0.028, 6, 6), ACCENT, {
      position: [0, 0, 0],
      rotation: [HALF_PI, 0, 0],
    }),
    piece(new THREE.TorusGeometry(0.4, 0.026, 6, 6), ACCENT, {
      position: [0, 0.5, 0],
      rotation: [HALF_PI, 0, 0],
    }),
    piece(new THREE.CylinderGeometry(0.11, 0.14, 0.5, 6), CORE, { position: [0, -0.8, 0] }),
    piece(new THREE.OctahedronGeometry(0.1), CORE, { position: [0, 1.2, 0] }),
  ]);
}

/** A hexagonal cell with a lid lifting off a lit seam. */
function microservice(): THREE.BufferGeometry {
  return assemble([
    piece(new THREE.CylinderGeometry(0.74, 0.74, 0.5, 6), BODY, { position: [0, -0.12, 0] }),
    piece(new THREE.CylinderGeometry(0.6, 0.6, 0.08, 6), ACCENT, { position: [0, 0.2, 0] }),
    piece(new THREE.CylinderGeometry(0.74, 0.66, 0.14, 6), BODY, { position: [0, 0.38, 0] }),
    piece(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 6), CORE, { position: [0, 0.48, 0] }),
  ]);
}

/** A shipping container: a crate held by a luminous frame. */
function container(): THREE.BufferGeometry {
  const h = 0.56;
  const bar = 0.045;
  const pieces: THREE.BufferGeometry[] = [piece(new THREE.BoxGeometry(1.0, 1.0, 1.0), BODY)];
  for (const [a, b] of [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ] as const) {
    pieces.push(
      piece(new THREE.BoxGeometry(bar, 2 * h, bar), ACCENT, { position: [a * h, 0, b * h] }),
      piece(new THREE.BoxGeometry(2 * h, bar, bar), ACCENT, { position: [0, a * h, b * h] }),
      piece(new THREE.BoxGeometry(bar, bar, 2 * h), ACCENT, { position: [a * h, b * h, 0] }),
    );
  }
  return assemble(pieces);
}

/** A bolt inside a ring: compute that appears when called. */
function serverless(): THREE.BufferGeometry {
  const bolt = new THREE.Shape();
  bolt.moveTo(0.12, 0.72);
  bolt.lineTo(-0.34, -0.06);
  bolt.lineTo(-0.02, -0.06);
  bolt.lineTo(-0.16, -0.72);
  bolt.lineTo(0.34, 0.1);
  bolt.lineTo(0.02, 0.1);
  bolt.closePath();
  return assemble([
    piece(new THREE.ExtrudeGeometry(bolt, { depth: 0.16, bevelEnabled: false }), CORE, {
      position: [0, 0, -0.08],
    }),
    piece(new THREE.TorusGeometry(0.9, 0.05, 8, 40), BODY),
    piece(new THREE.TorusGeometry(0.9, 0.022, 6, 40), ACCENT, { rotation: [HALF_PI, 0, 0] }),
  ]);
}

/** Messages lined up on rails, waiting their turn. */
function messageQueue(): THREE.BufferGeometry {
  const pieces: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    pieces.push(
      piece(new THREE.BoxGeometry(0.14, 0.74, 0.74), i % 2 === 0 ? ACCENT : BODY, {
        position: [(i - 2) * 0.36, 0, 0],
      }),
    );
  }
  for (const [y, z] of [
    [0.48, 0.48],
    [0.48, -0.48],
    [-0.48, 0.48],
    [-0.48, -0.48],
  ] as const) {
    pieces.push(
      piece(new THREE.CylinderGeometry(0.035, 0.035, 2.0, 6), BODY, {
        position: [0, y, z],
        rotation: [0, 0, HALF_PI],
      }),
    );
  }
  return assemble(pieces);
}

/** The classic stack of platters, separated by lit seams. */
function database(): THREE.BufferGeometry {
  const pieces: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const y = (i - 1) * 0.46;
    pieces.push(
      piece(new THREE.CylinderGeometry(0.72, 0.72, 0.32, 28), BODY, { position: [0, y, 0] }),
    );
    if (i < 2) {
      pieces.push(
        piece(new THREE.CylinderGeometry(0.6, 0.6, 0.14, 28), ACCENT, {
          position: [0, y + 0.23, 0],
        }),
      );
    }
  }
  pieces.push(
    piece(new THREE.CylinderGeometry(0.44, 0.44, 0.04, 28), CORE, { position: [0, 0.64, 0] }),
  );
  return assemble(pieces);
}

/** A lattice of blocks around a lit core: objects in a bucket. */
function storage(): THREE.BufferGeometry {
  const pieces: THREE.BufferGeometry[] = [piece(new THREE.BoxGeometry(0.5, 0.5, 0.5), CORE)];
  for (const x of [-1, 1]) {
    for (const y of [-1, 1]) {
      for (const z of [-1, 1]) {
        pieces.push(
          piece(new THREE.BoxGeometry(0.46, 0.46, 0.46), BODY, {
            position: [x * 0.3, y * 0.3, z * 0.3],
          }),
        );
      }
    }
  }
  pieces.push(
    piece(new THREE.TorusGeometry(0.86, 0.024, 6, 4), ACCENT, {
      rotation: [HALF_PI, 0, Math.PI / 4],
    }),
  );
  return assemble(pieces);
}

/** A faceted globe with orbits: the network itself. */
function networkGateway(): THREE.BufferGeometry {
  return assemble([
    piece(new THREE.IcosahedronGeometry(0.66, 1), BODY),
    piece(new THREE.IcosahedronGeometry(0.3, 0), CORE),
    piece(new THREE.TorusGeometry(0.92, 0.03, 6, 56), ACCENT, { rotation: [HALF_PI, 0, 0] }),
    piece(new THREE.TorusGeometry(0.92, 0.024, 6, 56), ACCENT, { rotation: [0.5, 0, 0.6] }),
    piece(new THREE.TorusGeometry(0.92, 0.024, 6, 56), ACCENT, { rotation: [-0.5, 0, -0.6] }),
  ]);
}

/** A watchful eye: an elongated crystal with an iris and a scanning halo. */
function securityMonitor(): THREE.BufferGeometry {
  return assemble([
    piece(new THREE.OctahedronGeometry(0.7), BODY, { scale: [0.82, 1.3, 0.82] }),
    piece(new THREE.SphereGeometry(0.22, 16, 12), CORE),
    piece(new THREE.TorusGeometry(0.36, 0.035, 8, 28), ACCENT, { rotation: [HALF_PI, 0, 0] }),
    piece(new THREE.TorusGeometry(1.0, 0.022, 6, 56), ACCENT, { rotation: [HALF_PI, 0, 0] }),
    piece(new THREE.TorusGeometry(1.18, 0.014, 6, 56), ACCENT, { rotation: [HALF_PI, 0, 0] }),
  ]);
}

/** A person-shaped pawn: the people on the other end. */
function externalClient(): THREE.BufferGeometry {
  return assemble([
    piece(new THREE.SphereGeometry(0.3, 16, 12), CORE, { position: [0, 0.5, 0] }),
    piece(new THREE.CylinderGeometry(0.16, 0.5, 0.74, 14), BODY, { position: [0, -0.16, 0] }),
    piece(new THREE.TorusGeometry(0.56, 0.03, 6, 32), ACCENT, {
      position: [0, -0.56, 0],
      rotation: [HALF_PI, 0, 0],
    }),
  ]);
}

const BUILDERS: Record<ServiceType, () => THREE.BufferGeometry> = {
  'api-gateway': apiGateway,
  'auth-service': authService,
  'cedar-authorizer': cedarAuthorizer,
  microservice,
  container,
  serverless,
  'message-queue': messageQueue,
  database,
  storage,
  'network-gateway': networkGateway,
  'security-monitor': securityMonitor,
  'external-client': externalClient,
};

export function buildNodeGeometry(type: ServiceType): THREE.BufferGeometry {
  return BUILDERS[type]();
}

/** How fast each type spins about its vertical axis, in radians per second. */
export const SPIN_RATE: Record<ServiceType, number> = {
  'api-gateway': 0.5,
  'auth-service': 0.3,
  'cedar-authorizer': 0.22,
  microservice: 0.18,
  container: 0.14,
  serverless: 0.6,
  'message-queue': 0,
  database: 0.12,
  storage: 0.2,
  'network-gateway': 0.35,
  'security-monitor': 0.45,
  'external-client': 0,
};
