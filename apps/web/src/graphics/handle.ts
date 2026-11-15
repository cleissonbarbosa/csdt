import type { SceneController } from './SceneController';

/**
 * The live scene controller, for interface code that needs to command the
 * camera (focus, reset, frame) without going through React state.
 */
export const sceneHandle: { current: SceneController | null } = { current: null };
