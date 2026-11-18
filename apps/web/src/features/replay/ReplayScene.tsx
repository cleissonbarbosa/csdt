import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import type * as THREE from 'three/webgpu';

import {
  TopologyCanvas,
  sceneOptions,
  type CanvasBridgeProps,
  type SceneRuntime,
} from '@/features/scene/SceneCanvas';
import type { SceneFrame, SceneTopology } from '@/graphics/sceneData';
import { SceneController, type SceneSelection } from '@/graphics/SceneController';
import type { ThemeName } from '@/lib/palette';
import { useSettings } from '@/stores/ui';

interface ReplaySceneProps {
  theme: ThemeName;
  topology: SceneTopology;
  frame: SceneFrame;
  selection: SceneSelection;
  onSelect: (selection: SceneSelection) => void;
  onRuntime: (runtime: SceneRuntime) => void;
  onUnavailable: (reason: string) => void;
}

type BridgeProps = CanvasBridgeProps & Omit<ReplaySceneProps, 'onRuntime' | 'onUnavailable'>;

const ignore = () => {};

function ReplayBridge({
  backend,
  pieces,
  onQuality,
  theme,
  topology,
  frame,
  selection,
  onSelect,
}: BridgeProps) {
  const gl = useThree((state) => state.gl) as unknown as THREE.WebGPURenderer;
  const scene = useThree((state) => state.scene) as unknown as THREE.Scene;
  const camera = useThree((state) => state.camera) as unknown as THREE.PerspectiveCamera;
  const controller = useRef<SceneController | null>(null);
  const themeRef = useRef(theme);
  themeRef.current = theme;

  useEffect(() => {
    const options = () => ({ ...sceneOptions(themeRef.current), autoRotate: false });
    const instance = new SceneController(
      gl,
      scene,
      camera,
      gl.domElement,
      backend,
      { onHover: (id) => instance.setHoveredNode(id), onSelect, onQuality, onTraceEnd: ignore },
      options(),
      pieces,
    );
    controller.current = instance;
    instance.setTopology(topology, 'regions');
    const off = useSettings.subscribe(() => instance.setOptions(options()));
    window.__aegis = {
      backend,
      stats: () => instance.getStats(),
      projectNode: (id) => instance.projectNode(id),
      captureFrame: () => instance.captureFrame(),
      labels: () => instance.labelBoxes(),
    };
    return () => {
      off();
      delete window.__aegis;
      controller.current = null;
      instance.dispose();
    };
  }, [gl, scene, camera, backend, pieces, topology, onQuality, onSelect]);

  useEffect(() => {
    controller.current?.setOptions({ ...sceneOptions(theme), autoRotate: false });
  }, [theme]);

  useEffect(() => {
    controller.current?.applySnapshot(frame);
  }, [frame]);

  useEffect(() => {
    controller.current?.setSelection(selection);
  }, [selection]);

  useFrame((_, delta) => {
    controller.current?.update(delta);
    controller.current?.render();
  }, 1);

  return null;
}

export function ReplayScene({ onRuntime, onUnavailable, ...props }: ReplaySceneProps) {
  return (
    <TopologyCanvas
      onRuntime={onRuntime}
      onUnavailable={onUnavailable}
      renderBridge={(bridge) => <ReplayBridge {...bridge} {...props} />}
    />
  );
}
