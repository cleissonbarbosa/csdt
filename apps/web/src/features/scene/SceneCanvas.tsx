/**
 * The 3D canvas. React Three Fiber owns the canvas element, its size, the
 * device pixel ratio and the render loop; a `SceneController` owns everything
 * drawn inside it. State reaches the controller through store subscriptions,
 * so telemetry never causes this component to re-render.
 */
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type * as THREE from 'three/webgpu';

import { sceneHandle } from '@/graphics/handle';
import { loadPieces, type PieceSet } from '@/graphics/pieces';
import { QUALITY, type QualityLevel } from '@/graphics/quality';
import { createRenderer, type Backend } from '@/graphics/renderer';
import {
  FOV,
  SceneController,
  type SceneOptions,
  type SceneStats,
} from '@/graphics/SceneController';
import { computeVisibilityMask } from '@/features/explorer/filtering';
import type { ThemeName } from '@/lib/palette';
import { useTelemetry } from '@/stores/telemetry';
import { prefersReducedMotion, useSettings, useUi } from '@/stores/ui';

declare global {
  interface Window {
    __aegis?: {
      backend: Backend;
      stats: () => SceneStats;
      projectNode: (nodeId: string) => { x: number; y: number } | null;
      captureFrame: SceneController['captureFrame'];
      /** Development builds only. */
      debug?: { scene: THREE.Scene; renderer: THREE.WebGPURenderer };
    };
  }
}

export interface SceneRuntime {
  backend: Backend;
  quality: QualityLevel;
}

function sceneOptions(theme: ThemeName): SceneOptions {
  const settings = useSettings.getState();
  return {
    theme,
    quality: settings.quality,
    labels: settings.labels,
    autoRotate: settings.autoRotate,
    reducedMotion: prefersReducedMotion(settings.motion),
  };
}

interface BridgeProps {
  backend: Backend;
  pieces: PieceSet;
  theme: ThemeName;
  tooltip: HTMLElement | null;
  onQuality: (level: QualityLevel) => void;
}

function SceneBridge({ backend, pieces, theme, tooltip, onQuality }: BridgeProps) {
  const gl = useThree((state) => state.gl) as unknown as THREE.WebGPURenderer;
  const scene = useThree((state) => state.scene) as unknown as THREE.Scene;
  const camera = useThree((state) => state.camera) as unknown as THREE.PerspectiveCamera;
  const controller = useRef<SceneController | null>(null);
  const onQualityRef = useRef(onQuality);
  onQualityRef.current = onQuality;
  const themeRef = useRef(theme);
  themeRef.current = theme;

  useEffect(() => {
    const instance = new SceneController(
      gl,
      scene,
      camera,
      gl.domElement,
      backend,
      {
        onHover: (id) => useUi.getState().setHovered(id),
        onSelect: (selection) => useUi.getState().select(selection),
        onQuality: (level) => onQualityRef.current(level),
        onTraceEnd: () => useUi.getState().traceDecision(null),
      },
      sceneOptions(themeRef.current),
      pieces,
    );
    controller.current = instance;
    sceneHandle.current = instance;
    // Read-only handle for the developer console, benchmarks and E2E tests.
    window.__aegis = {
      backend,
      stats: () => instance.getStats(),
      projectNode: (id) => instance.projectNode(id),
      captureFrame: () => instance.captureFrame(),
      ...(import.meta.env.DEV ? { debug: { scene, renderer: gl } } : {}),
    };

    const applyVisibility = () => {
      const { topology, snapshot } = useTelemetry.getState();
      if (!topology) return;
      instance.setVisibility(computeVisibilityMask(topology, snapshot, useUi.getState().filters));
    };
    const applyImpacted = () => {
      const incident = useTelemetry.getState().snapshot?.incident;
      instance.setImpacted(incident ? incident.impactedNodeIds : []);
    };

    const telemetry = useTelemetry.getState();
    if (telemetry.topology) instance.setTopology(telemetry.topology, useUi.getState().layoutMode);
    if (telemetry.snapshot) instance.applySnapshot(telemetry.snapshot);
    instance.setSelection(useUi.getState().selection);
    applyVisibility();
    applyImpacted();

    const unsubscribe = [
      useTelemetry.subscribe((state, previous) => {
        if (state.topology && state.topology !== previous.topology) {
          instance.setTopology(state.topology, useUi.getState().layoutMode);
          instance.setSelection(useUi.getState().selection);
          applyVisibility();
        }
        if (state.snapshot && state.snapshot !== previous.snapshot) {
          instance.applySnapshot(state.snapshot);
          if (state.snapshot.incident !== previous.snapshot?.incident) applyImpacted();
          // Health and impact filters depend on live data.
          const { filters } = useUi.getState();
          if (filters.health.length > 0 || filters.impactedOnly) applyVisibility();
        }
      }),
      useUi.subscribe((state, previous) => {
        if (state.selection !== previous.selection) instance.setSelection(state.selection);
        if (state.hoveredNodeId !== previous.hoveredNodeId) {
          instance.setHoveredNode(state.hoveredNodeId);
        }
        if (state.filters !== previous.filters) applyVisibility();
        if (state.layoutMode !== previous.layoutMode) {
          instance.setLayoutMode(state.layoutMode);
          instance.setSelection(state.selection);
          applyVisibility();
        }
        if (state.tracedDecision !== previous.tracedDecision) {
          if (state.tracedDecision) instance.playDecision(state.tracedDecision);
          else instance.clearTrace();
        }
      }),
      useSettings.subscribe(() => instance.setOptions(sceneOptions(themeRef.current))),
    ];

    return () => {
      for (const off of unsubscribe) off();
      if (sceneHandle.current === instance) sceneHandle.current = null;
      delete window.__aegis;
      controller.current = null;
      instance.dispose();
    };
  }, [gl, scene, camera, backend, pieces]);

  useEffect(() => {
    controller.current?.setTooltipElement(tooltip);
  }, [tooltip]);

  useEffect(() => {
    controller.current?.setOptions(sceneOptions(theme));
  }, [theme]);

  // Priority 1 hands rendering to the controller.
  useFrame((_, delta) => {
    controller.current?.update(delta);
    controller.current?.render();
  }, 1);

  return null;
}

interface BoundaryProps {
  onError: (error: Error) => void;
  children: ReactNode;
}

/** Catches renderer start-up failures so the app can show its non-3D view. */
class SceneBoundary extends Component<BoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: Error) {
    this.props.onError(error);
  }

  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

interface SceneCanvasProps {
  theme: ThemeName;
  tooltip: HTMLElement | null;
  onRuntime: (runtime: SceneRuntime) => void;
  onUnavailable: (reason: string) => void;
}

export function SceneCanvas({ theme, tooltip, onRuntime, onUnavailable }: SceneCanvasProps) {
  const preference = useSettings((state) => state.renderer);
  const [backend, setBackend] = useState<Backend | null>(null);
  const [quality, setQuality] = useState<QualityLevel>('high');
  const [pieces, setPieces] = useState<PieceSet | null>(null);
  const onRuntimeRef = useRef(onRuntime);
  onRuntimeRef.current = onRuntime;
  const onUnavailableRef = useRef(onUnavailable);
  onUnavailableRef.current = onUnavailable;

  // The modelled pieces are part of the scene: without them there is nothing
  // to stand on the plates, and the application shows its table instead.
  useEffect(() => {
    let cancelled = false;
    loadPieces().then(
      (loaded) => {
        if (!cancelled) setPieces(loaded);
      },
      (error: unknown) => {
        if (!cancelled) {
          onUnavailableRef.current(error instanceof Error ? error.message : String(error));
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (backend) onRuntimeRef.current({ backend, quality });
  }, [backend, quality]);

  const dpr = useMemo(
    () =>
      Math.min(
        typeof window === 'undefined' ? 1 : window.devicePixelRatio,
        QUALITY[quality].maxDpr,
      ),
    [quality],
  );

  return (
    <SceneBoundary onError={(error) => onUnavailable(error.message)}>
      <Canvas
        // Remount when the backend preference changes: a renderer cannot
        // switch backends in place.
        key={preference}
        dpr={dpr}
        // Colours are design tokens and must reach the screen as chosen:
        // `flat` stops React Three Fiber from switching tone mapping on.
        flat
        frameloop="always"
        camera={{ fov: FOV, near: 2, far: 8000, position: [-120, 190, 270] }}
        gl={async (defaults) => {
          const created = await createRenderer(defaults.canvas as HTMLCanvasElement, preference);
          setBackend(created.backend);
          return created.renderer;
        }}
        aria-label="Interactive 3D view of the infrastructure topology"
        role="img"
      >
        {backend && pieces && (
          <SceneBridge
            backend={backend}
            pieces={pieces}
            theme={theme}
            tooltip={tooltip}
            onQuality={setQuality}
          />
        )}
      </Canvas>
    </SceneBoundary>
  );
}
