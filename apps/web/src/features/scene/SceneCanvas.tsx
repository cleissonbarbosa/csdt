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
 *
 * While an incident capture is open (`stores/capture.ts`) the bridge hands
 * the controller the capture instead, and nothing of the simulation reaches
 * the scene: its stream, its selection and its filters wait, and are laid
 * over the model again when the capture is closed. What the viewer selects
 * or points at in a capture goes to the capture's store, never to the
 * simulation's.
 *
 * The platform editor (`stores/editor.ts`) is the same again: while a
 * platform is drawn the controller is handed the draft, in the swimlanes,
 * and the selection and the pointer go to the editor. Each change to the
 * draft is handed over as an edit, so the pieces keep their places and
 * walk to new ones, and the camera stays where the viewer left it.
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
import { frameAt, stepAt } from '@/features/capture/capture';
import { attachEditor } from '@/features/editor/interaction';
import { phaseReach } from '@/features/editor/incident/effects';
import { draftScene } from '@/features/editor/scene';
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
import { useCapture } from '@/stores/capture';
import { editing, useEditor } from '@/stores/editor';
import { useIncident } from '@/stores/incident';
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
    /** Whether an incident capture is open: then it, not the simulation, is drawn. */
    const captured = () => useCapture.getState().capture !== null;
    const instance = new SceneController(
      gl,
      scene,
      camera,
      gl.domElement,
      backend,
      {
        onHover: (id) => {
          if (captured()) useCapture.getState().hover(id);
          else if (editing()) useEditor.getState().hover(id);
          else useUi.getState().setHovered(id);
        },
        // In the overview a piece is a kind of service, and only pieces can
        // be selected there: a connection between two kinds is a summary.
        onSelect: (selection) => {
          if (captured()) useCapture.getState().select(selection);
          else if (editing()) {
            // While a flow is drawn, a piece clicked is the next one it passes.
            const drawing = useIncident.getState().drawing;
            if (drawing !== null && useEditor.getState().tab === 'incident') {
              if (selection?.kind === 'node' && drawing.at(-1) !== selection.id) {
                useIncident.getState().draw([...drawing, selection.id]);
              }
              return;
            }
            useEditor.getState().select(selection);
          } else if (useUi.getState().layoutMode !== 'layers') useUi.getState().select(selection);
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

    /** The overview being shown, or null in the detailed arrangements and in a capture. */
    const summary = (): Overview | null => {
      if (captured() || editing()) return null;
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
    /** The services a trial reached, at the level being shown. */
    const applyReach = () => {
      const reach = useUi.getState().reach ?? [];
      const overview = summary();
      instance.setReached(overview ? projectNodeIds(overview, reach) : reach);
    };
    /** Hands the scene the simulation's topology and everything that is read against it. */
    const applyAll = () => {
      instance.setPieceCursor('pointer');
      applyTopology();
      applySnapshot();
      applySelection();
      applyVisibility();
      applyReach();
      if (useUi.getState().tracedDecision) applyTrace();
    };

    /** The stretch of the capture last drawn (`stepAt`): the frame changes only with it. */
    let drawnStep = -1;
    const applyCaptureFrame = () => {
      const { capture, atMs } = useCapture.getState();
      if (!capture) return;
      drawnStep = stepAt(capture, atMs);
      instance.applySnapshot(frameAt(capture, atMs));
    };
    /**
     * Hands the scene the open capture, in the arrangement by region, and
     * clears everything the simulation had laid over the model: a capture
     * has no incident route, traced request, reach, filter or overview.
     */
    const applyCapture = () => {
      const { capture, topology, selection, hovered } = useCapture.getState();
      if (!capture || !topology) return;
      instance.setPieceCursor('pointer');
      instance.setTopology(topology, 'regions');
      applyCaptureFrame();
      instance.setSelection(selection);
      instance.setHoveredNode(hovered);
      instance.clearTrace();
      instance.setRoute([], []);
      instance.setImpacted([]);
      instance.setReached([]);
      instance.setVisibility(null);
      instance.setPartial(null);
    };

    /**
     * On the incident, the model keeps in front what is being placed: while
     * an effect is carried, what it would be placed on; while a flow is
     * drawn, the services it passes; otherwise what the phase in hand holds
     * is placed on. On the platform, nothing.
     */
    const applyIncident = () => {
      const { draft, tab, carrying, drag } = useEditor.getState();
      const { scenario, phase, drawing } = useIncident.getState();
      if (!draft || tab !== 'incident' || !scenario) {
        instance.setReached([]);
        return;
      }
      if (carrying?.kind === 'effect') {
        instance.setReached(drag?.placing?.reach.nodes ?? [], drag?.placing?.reach.edges ?? []);
        return;
      }
      if (drawing !== null) {
        instance.setReached(drawing);
        return;
      }
      const reach = phaseReach(draft, scenario, phase);
      instance.setReached(reach.nodes, reach.edges);
    };

    /**
     * Hands the scene the draft being edited, in the swimlanes, with what
     * the engine last made of it. `edit` when it is the draft already on
     * show, changed: the pieces keep their places and walk to new ones.
     */
    const applyEditor = (edit: boolean) => {
      const { draft, lastRun, selection, hovered } = useEditor.getState();
      if (!draft) return;
      const { topology, frame } = draftScene(draft, lastRun);
      // A piece on the table is there to be picked up; on the incident it is only selected.
      instance.setPieceCursor(useEditor.getState().tab === 'platform' ? 'grab' : 'pointer');
      instance.setTopology(topology, 'dependencies', null, edit);
      instance.applySnapshot(frame);
      instance.setSelection(selection);
      instance.setHoveredNode(hovered);
      instance.clearTrace();
      instance.setRoute([], []);
      instance.setImpacted([]);
      instance.setVisibility(null);
      instance.setPartial(null);
      applyIncident();
    };
    // An answer that has just come: it reaches the pieces along the path.
    const applyEditorFrame = () => {
      const { draft, lastRun } = useEditor.getState();
      if (draft) instance.applySnapshot(draftScene(draft, lastRun).frame, true);
    };
    // A piece being carried is held up over the slot it would take; over
    // another piece, to be connected to it, or over nothing, it is held
    // over its own place.
    const applyCarry = () => {
      const { carrying, drag } = useEditor.getState();
      if (carrying?.kind !== 'move') {
        instance.setCarried(null, null);
        return;
      }
      const slot = drag && drag.target === null ? drag.slot : null;
      instance.setCarried(
        carrying.id,
        slot
          ? { x: (slot.rect.x0 + slot.rect.x1) / 2, z: (slot.rect.z0 + slot.rect.z1) / 2 }
          : null,
      );
    };

    if (captured()) applyCapture();
    else if (editing()) applyEditor(false);
    else applyAll();

    // A piece on the table can be carried while a platform is drawn.
    const stage = gl.domElement.parentElement ?? gl.domElement;
    const detachEditor = attachEditor(stage);

    const unsubscribe = [
      detachEditor,
      useEditor.subscribe((state, previous) => {
        if (captured()) return;
        if (state.draft !== previous.draft) {
          if (state.draft && !previous.draft) applyEditor(false);
          else if (!state.draft) applyAll();
          else applyEditor(true);
          return;
        }
        if (!state.draft) return;
        if (state.tab !== previous.tab) {
          instance.setPieceCursor(state.tab === 'platform' ? 'grab' : 'pointer');
          applyIncident();
        }
        if (state.carrying !== previous.carrying || state.drag !== previous.drag) {
          applyCarry();
          applyIncident();
        }
        if (state.lastRun !== previous.lastRun) applyEditorFrame();
        if (state.selection !== previous.selection) instance.setSelection(state.selection);
        if (state.hovered !== previous.hovered) instance.setHoveredNode(state.hovered);
      }),
      useIncident.subscribe((state, previous) => {
        if (captured() || !editing()) return;
        if (
          state.scenario !== previous.scenario ||
          state.phase !== previous.phase ||
          state.drawing !== previous.drawing
        ) {
          applyIncident();
        }
      }),
      useCapture.subscribe((state, previous) => {
        if (state.capture !== previous.capture || state.topology !== previous.topology) {
          // Opened, replaced by another, or closed: the simulation comes back.
          if (state.capture) applyCapture();
          else if (editing()) applyEditor(false);
          else applyAll();
          return;
        }
        if (!state.capture) return;
        if (state.atMs !== previous.atMs && stepAt(state.capture, state.atMs) !== drawnStep) {
          applyCaptureFrame();
        }
        if (state.selection !== previous.selection) instance.setSelection(state.selection);
        if (state.hovered !== previous.hovered) instance.setHoveredNode(state.hovered);
      }),
      useTelemetry.subscribe((state, previous) => {
        // The stream goes on behind a capture or a draft; it is drawn again on closing it.
        if (captured() || editing()) return;
        if (state.topology && state.topology !== previous.topology) applyAll();
        if (state.snapshot && state.snapshot !== previous.snapshot) {
          applySnapshot();
          // Health and impact filters depend on live data.
          const { filters } = useUi.getState();
          if (filters.health.length > 0 || filters.impactedOnly) applyVisibility();
        }
      }),
      useUi.subscribe((state, previous) => {
        if (captured() || editing()) return;
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
        aria-label={t('Interactive 3D view of the infrastructure topology')}
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
