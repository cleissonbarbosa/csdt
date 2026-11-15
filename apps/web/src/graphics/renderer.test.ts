import { afterEach, describe, expect, it, vi } from 'vitest';

import { canRender3D, detectRenderingSupport, probeRenderingSupport } from './renderer';

describe('rendering support detection', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reports no 3D support in an environment without WebGPU or WebGL 2', () => {
    // jsdom implements neither.
    const support = detectRenderingSupport();
    expect(support).toEqual({ webgpu: false, webgl2: false });
    expect(canRender3D(support)).toBe(false);
  });

  it('detects WebGPU from navigator.gpu', () => {
    vi.stubGlobal('navigator', { ...navigator, gpu: {} });
    expect(detectRenderingSupport().webgpu).toBe(true);
    expect(canRender3D()).toBe(true);
  });

  it('detects WebGL 2 by creating a context', () => {
    vi.stubGlobal('WebGL2RenderingContext', function WebGL2RenderingContext() {});
    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({ getExtension: () => null } as never);
    expect(detectRenderingSupport()).toEqual({ webgpu: false, webgl2: true });
    expect(getContext).toHaveBeenCalledWith('webgl2');
  });

  it('treats a context that cannot be created as unsupported', () => {
    vi.stubGlobal('WebGL2RenderingContext', function WebGL2RenderingContext() {});
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(detectRenderingSupport().webgl2).toBe(false);
  });

  it('does not count WebGPU until an adapter is actually available', async () => {
    // No navigator.gpu at all: nothing to ask.
    expect(await probeRenderingSupport()).toEqual({ webgpu: false, webgl2: false });

    const requestAdapter = vi.fn().mockResolvedValue(null);
    vi.stubGlobal('navigator', { ...navigator, gpu: { requestAdapter } });
    expect(detectRenderingSupport().webgpu).toBe(true);
    expect((await probeRenderingSupport()).webgpu).toBe(false);

    requestAdapter.mockResolvedValue({});
    expect((await probeRenderingSupport()).webgpu).toBe(true);

    requestAdapter.mockRejectedValue(new Error('blocked by policy'));
    expect((await probeRenderingSupport()).webgpu).toBe(false);
  });

  it('either backend is enough', () => {
    expect(canRender3D({ webgpu: true, webgl2: false })).toBe(true);
    expect(canRender3D({ webgpu: false, webgl2: true })).toBe(true);
    expect(canRender3D({ webgpu: false, webgl2: false })).toBe(false);
  });
});
