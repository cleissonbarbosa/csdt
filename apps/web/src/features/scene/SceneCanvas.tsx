/**
 * The 3D canvas. React Three Fiber owns the canvas element, its size, the
 * device pixel ratio and the render loop; a `SceneController` owns everything
 * drawn inside it. State reaches the controller through store subscriptions,
 * so telemetry never causes this component to re-render.
 *
 * The bridge is also where the two levels of the model meet. In the overview
 * the controller is handed the platform reduced to its kinds of service
 * (`lib/overview.ts`), and everything that names a service or a connection
 * (the selection, an incident's route, a traced request) is translated to
 * the kind it belongs to on the way in, and back on the way out. The
 * controller itself draws a topology and does not know which it was given.
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
import { t } from '@/i18n';
import {
  overviewOf,
  partialGroups,
  projectHops,
  projectMask,
  projectNodeIds,
  projectSnapshot,
  type Overview,
} from '@/lib/overview';
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
      /** The names on screen, each with the box it is drawn in (CSS pixels). */
      labels: SceneController['labelBoxes'];
      /** Development builds only. */
      debug?: { scene: THREE.Scene; renderer: THREE.WebGPURenderer };
    };
  }
}

export interface SceneRuntime {
  backend: Backend;
  quality: QualityLevel;
}

export function sceneOptions(theme: ThemeName): SceneOptions {
  const settings = useSettings.getState();
  return {
    theme,
    quality: settings.quality,
    labels: settings.labels,
    autoRotate: settings.autoRotate,
    reducedMotion: prefersReducedMotion(settings.motion),
  };
}

export interface CanvasBridgeProps {
  backend: Backend;
  pieces: PieceSet;
  onQuality: (level: QualityLevel) => void;
}

interface BridgeProps extends CanvasBridgeProps {
  theme: ThemeName;
  tooltip: HTMLElement | null;
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
        // In the overview a piece is a kind of service, and only pieces can
        // be selected there: a connection between two kinds is a summary.
        onSelect: (selection) => {
          if (useUi.getState().layoutMode !== 'layers') useUi.getState().select(selection);
          else if (selection?.kind === 'node') {
            useUi.getState().select({ kind: 'group', id: selection.id });
          } else useUi.getState().select(null);
        },
        onQuality: (level) => onQualityRef.current(level),
        onTraceEnd: () => useUi.getState().setTracing(false),
      },
      sceneOptions(themeRef.current),
      pieces,
    );
    controller.current = instance;
    sceneHandle.current = instance;

    /** The overview being shown, or null in the detailed arrangements. */
    const summary = (): Overview | null => {
      const { topology } = useTelemetry.getState();
      return topology && useUi.getState().layoutMode === 'layers' ? overviewOf(topology) : null;
    };
    /** A service's id, as the id of the piece that stands for it right now. */
    const shownAs = (id: string | null): string | null => {
      const overview = summary();
      return id && overview ? (overview.groupOfNode.get(id) ?? id) : id;
    };

    // Read-only handle for the developer console, benchmarks and E2E tests.
    window.__aegis = {
      backend,
      stats: () => instance.getStats(),
      projectNode: (id) => instance.projectNode(shownAs(id) ?? id),
      captureFrame: () => instance.captureFrame(),
      labels: () => instance.labelBoxes(),
      ...(import.meta.env.DEV ? { debug: { scene, renderer: gl } } : {}),
    };

    const applyTopology = () => {
      const { topology } = useTelemetry.getState();
      if (!topology) return;
      const overview = summary();
      instance.setTopology(
        overview?.topology ?? topology,
        useUi.getState().layoutMode,
        overview?.labels ?? null,
      );
    };
    const applySelection = () => {
      const { selection } = useUi.getState();
      const overview = summary();
      if (!selection) instance.setSelection(null);
      else if (selection.kind === 'group') {
        instance.setSelection(overview ? { kind: 'node', id: selection.id } : null);
      } else instance.setSelection(overview ? null : selection);
    };
    const applyVisibility = () => {
      const { topology, snapshot } = useTelemetry.getState();
      if (!topology) return;
      const mask = computeVisibilityMask(topology, snapshot, useUi.getState().filters);
      const overview = summary();
      instance.setVisibility(overview ? projectMask(overview, mask) : mask);
    };
    /** Everything the scene takes from a snapshot, in the level being shown. */
    const applySnapshot = () => {
      const { topology, snapshot } = useTelemetry.getState();
      if (!topology || !snapshot) return;
      // A snapshot of another topology (mid-switch) cannot be read against this one.
      if (
        snapshot.topologyId !== topology.id ||
        snapshot.nodes.health.length !== topology.nodes.length ||
        snapshot.edges.trafficRps.length !== topology.edges.length
      ) {
        return;
      }
      const overview = summary();
      const shown = overview ? projectSnapshot(overview, snapshot) : snapshot;
      instance.applySnapshot(shown);
      instance.setPartial(overview ? partialGroups(overview, snapshot) : null);
      instance.setImpacted(shown.incident ? shown.incident.impactedNodeIds : []);
      // The route of an incident: every connection its injected traffic
      // crosses, and the pieces at which that traffic is being stopped.
      const hops = new Set<string>();
      const stopped = new Set<string>();
      for (const flow of shown.flows) {
        for (const hop of flow.hops) hops.add(hop);
        if (flow.blockedAt !== null) stopped.add(flow.blockedAt);
      }
      instance.setRoute([...hops], [...stopped]);
    };
    const applyTrace = () => {
      const decision = useUi.getState().tracedDecision;
      if (!decision) {
        instance.clearTrace();
        return;
      }
      const overview = summary();
      instance.playDecision(
        overview
          ? {
              decision: decision.decision,
              hops: projectHops(overview, decision.hops),
              blockedAt:
                decision.blockedAt === null
                  ? null
                  : (projectNodeIds(overview, [decision.blockedAt])[0] ?? null),
            }
          : decision,
      );
    };
    /** Hands the scene a topology and everything that is read against it. */
    /** The services a trial reached, at the level being shown. */
    const applyReach = () => {
      const reach = useUi.getState().reach ?? [];
      const overview = summary();
      instance.setReached(overview ? projectNodeIds(overview, reach) : reach);
    };
    const applyAll = () => {
      applyTopology();
      applySnapshot();
      applySelection();
      applyVisibility();
      applyReach();
      if (useUi.getState().tracedDecision) applyTrace();
    };

    applyAll();

    const unsubscribe = [
      useTelemetry.subscribe((state, previous) => {
        if (state.topology && state.topology !== previous.topology) applyAll();
        if (state.snapshot && state.snapshot !== previous.snapshot) {
          applySnapshot();
          // Health and impact filters depend on live data.
          const { filters } = useUi.getState();
          if (filters.health.length > 0 || filters.impactedOnly) applyVisibility();
        }
      }),
      useUi.subscribe((state, previous) => {
        if (state.layoutMode !== previous.layoutMode) {
          // Between the two detailed arrangements the pieces walk; to and
          // from the overview the model is a different one, and is rebuilt.
          const level = (state.layoutMode === 'layers') !== (previous.layoutMode === 'layers');
          if (level) applyAll();
          else {
            instance.setLayoutMode(state.layoutMode);
            applySelection();
            applyVisibility();
          }
        } else if (state.selection !== previous.selection) applySelection();
        if (state.hoveredNodeId !== previous.hoveredNodeId) {
          instance.setHoveredNode(shownAs(state.hoveredNodeId));
        }
        if (state.filters !== previous.filters) applyVisibility();
        if (state.tracedDecision !== previous.tracedDecision) applyTrace();
        if (state.reach !== previous.reach) applyReach();
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

interface TopologyCanvasProps {
  renderBridge: (props: CanvasBridgeProps) => ReactNode;
  onRuntime: (runtime: SceneRuntime) => void;
  onUnavailable: (reason: string) => void;
}

export function TopologyCanvas({ renderBridge, onRuntime, onUnavailable }: TopologyCanvasProps) {
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
        aria-label={t('Interactive 3D view of the infrastructure topology')}
        role="img"
      >
        {backend && pieces && renderBridge({ backend, pieces, onQuality: setQuality })}
      </Canvas>
    </SceneBoundary>
  );
}

interface SceneCanvasProps extends Omit<TopologyCanvasProps, 'renderBridge'> {
  theme: ThemeName;
  tooltip: HTMLElement | null;
}

export function SceneCanvas({ theme, tooltip, ...props }: SceneCanvasProps) {
  return (
    <TopologyCanvas
      {...props}
      renderBridge={(bridge) => <SceneBridge {...bridge} theme={theme} tooltip={tooltip} />}
    />
  );
}
