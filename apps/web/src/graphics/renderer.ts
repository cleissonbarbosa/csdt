/**
 * Renderer creation and capability detection.
 *
 * WebGPU is preferred. Three's `WebGPURenderer` carries a WebGL 2 backend that
 * runs the same TSL materials, so the fallback is a different backend, not a
 * different renderer. If neither API is available the application shows its
 * non-3D topology view instead.
 */
import * as THREE from 'three/webgpu';

export type Backend = 'webgpu' | 'webgl2';
export type RendererPreference = 'auto' | 'webgl2';

export interface RenderingSupport {
  webgpu: boolean;
  webgl2: boolean;
}

export function detectRenderingSupport(): RenderingSupport {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { webgpu: false, webgl2: false };
  }
  const webgpu = typeof navigator !== 'undefined' && 'gpu' in navigator && !!navigator.gpu;
  let webgl2 = false;
  try {
    if (typeof WebGL2RenderingContext !== 'undefined') {
      const probe = document.createElement('canvas').getContext('webgl2');
      webgl2 = probe !== null;
      probe?.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    webgl2 = false;
  }
  return { webgpu, webgl2 };
}

/**
 * `navigator.gpu` exists in browsers that have no usable adapter (blocked GPU,
 * headless, remote desktop), so presence alone proves nothing: ask for one.
 */
export async function probeRenderingSupport(): Promise<RenderingSupport> {
  const quick = detectRenderingSupport();
  if (!quick.webgpu) return quick;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    return { ...quick, webgpu: adapter !== null };
  } catch {
    return { ...quick, webgpu: false };
  }
}

export function canRender3D(support: RenderingSupport = detectRenderingSupport()): boolean {
  return support.webgpu || support.webgl2;
}

export interface CreatedRenderer {
  renderer: THREE.WebGPURenderer;
  backend: Backend;
}

export async function createRenderer(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  preference: RendererPreference,
): Promise<CreatedRenderer> {
  const renderer = new THREE.WebGPURenderer({
    canvas: canvas as HTMLCanvasElement,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
    forceWebGL: preference === 'webgl2',
  });
  // Throws when no backend can be initialised; the caller falls back to the
  // non-3D view.
  await renderer.init();
  const backend: Backend =
    (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true
      ? 'webgpu'
      : 'webgl2';
  // Colours are design tokens, shown as chosen: no tone mapping, no grading.
  renderer.toneMapping = THREE.NoToneMapping;
  return { renderer, backend };
}
