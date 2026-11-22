/**
 * Carrying things over the model: a kind of service from the palette, or a
 * piece already on the table.
 *
 * One gesture does what the hand means by where it ends. Let go over the
 * table and the piece stands there (the slot under the pointer is its
 * region and tier); let go over another piece and the two are connected,
 * from the one carried to the one under it; let go anywhere else and
 * nothing changes. A press that does not move is a click: on a piece it
 * selects it, on a palette tile it adds that kind next to what is selected,
 * which is also how the keyboard adds one.
 *
 * The camera is held still while something is carried, and given back
 * after. Everything that changes the draft goes through `useEditor.change`,
 * so every gesture is one step to undo.
 */
import type { ServiceType } from '@aegis/contracts';

import { sceneHandle } from '@/graphics/handle';
import { t } from '@/i18n';
import { connect, edgeId, type Refusal, type TopologyDraft } from '@/lib/topologyFile';
import { editing, useEditor, type Carrying, type Drag } from '@/stores/editor';

import { addNear, dropMove, dropNew } from './drop';

/** How far a press has to move, in pixels, before it is a carry and not a click. */
const CLICK_SLOP = 5;

const nameOf = (draft: TopologyDraft, id: string) =>
  draft.nodes.find((node) => node.id === id)?.name ?? id;

/** Why a connection cannot be drawn, in the editor's words. `null` for no reason to say. */
export function refusalText(draft: TopologyDraft, refusal: Refusal): string | null {
  switch (refusal.reason) {
    case 'exists':
      return t('These two are already connected.');
    case 'cycle':
      return t('That would close a circle: {circle}. Load runs one way along the connections.', {
        circle: refusal.circle.map((id) => nameOf(draft, id)).join(' → '),
      });
    default:
      return null;
  }
}

/** Where the carried thing would go, under a point of the page. */
function aimAt(carrying: Carrying, x: number, y: number): Drag {
  const stage = sceneHandle.current;
  const draft = useEditor.getState().draft;
  if (!stage || !draft) return { x, y, slot: null, target: null, refusal: null };
  const hit = stage.pointAt(x, y);
  if (carrying.kind === 'move' && hit.node !== null && hit.node !== carrying.id) {
    const outcome = connect(draft, carrying.id, hit.node);
    return {
      x,
      y,
      slot: null,
      target: hit.node,
      refusal: 'refused' in outcome ? refusalText(draft, outcome.refused) : null,
    };
  }
  // Over its own piece a carried piece is going nowhere yet.
  if (carrying.kind === 'move' && hit.node === carrying.id) {
    return { x, y, slot: null, target: null, refusal: null };
  }
  return { x, y, slot: hit.slot, target: null, refusal: null };
}

/** Does what letting go at `drag` means. */
function release(carrying: Carrying, drag: Drag): void {
  const editor = useEditor.getState();
  const draft = editor.draft;
  if (!draft) return;
  if (carrying.kind === 'move' && drag.target !== null) {
    const outcome = connect(draft, carrying.id, drag.target);
    if ('refused' in outcome) {
      const message = refusalText(draft, outcome.refused);
      if (message) {
        editor.refuse({
          message,
          circle: outcome.refused.reason === 'cycle' ? outcome.refused.circle : [],
          link: { from: carrying.id, to: drag.target },
        });
      }
      return;
    }
    editor.change(() => outcome.draft);
    editor.select({ kind: 'edge', id: edgeId({ source: carrying.id, target: drag.target }) });
    return;
  }
  if (!drag.slot) return;
  const slot = drag.slot;
  if (carrying.kind === 'new') {
    let id = '';
    editor.change((current) => {
      const made = dropNew(current, carrying.type, slot);
      id = made.id;
      return made.draft;
    });
    if (id) editor.select({ kind: 'node', id });
    return;
  }
  if (carrying.kind === 'move') editor.change((current) => dropMove(current, carrying.id, slot));
}

/**
 * Follows one press from `start` until it is let go: a click when it did
 * not move, a carry when it did. `element` holds the pointer meanwhile.
 */
function follow(
  start: PointerEvent,
  element: HTMLElement,
  carrying: Carrying,
  onClick: () => void,
): void {
  const editor = useEditor.getState();
  const stage = sceneHandle.current;
  let carried = false;
  try {
    element.setPointerCapture(start.pointerId);
  } catch {
    // An element that cannot hold the pointer still gets the events it is under.
  }
  const move = (event: PointerEvent) => {
    if (event.pointerId !== start.pointerId) return;
    if (!carried) {
      if (Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) < CLICK_SLOP) {
        return;
      }
      carried = true;
      stage?.setCameraHeld(true);
      // Whatever the pointer is over, it shows a hand that holds something.
      document.documentElement.dataset.carrying = 'true';
      // A piece picked up is the one in hand: its card is the one shown.
      if (carrying.kind === 'move') editor.select({ kind: 'node', id: carrying.id });
      editor.carry(carrying);
    }
    useEditor.getState().setDrag(aimAt(carrying, event.clientX, event.clientY));
  };
  const finish = (cancelled: boolean) => {
    element.removeEventListener('pointermove', move, true);
    element.removeEventListener('pointerup', up, true);
    element.removeEventListener('pointercancel', cancel, true);
    window.removeEventListener('keydown', escape, true);
    try {
      element.releasePointerCapture(start.pointerId);
    } catch {
      // Already released.
    }
    stage?.setCameraHeld(false);
    delete document.documentElement.dataset.carrying;
    const drag = useEditor.getState().drag;
    useEditor.getState().carry(null);
    if (!carried) {
      if (!cancelled) onClick();
      return;
    }
    if (!cancelled && drag) release(carrying, drag);
  };
  const up = (event: PointerEvent) => {
    if (event.pointerId === start.pointerId) finish(false);
  };
  const cancel = (event: PointerEvent) => {
    if (event.pointerId === start.pointerId) finish(true);
  };
  const escape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !carried) return;
    event.preventDefault();
    event.stopPropagation();
    // As a cancelled press: nothing changes, and the pointer is let go.
    finish(true);
  };
  // Before the camera and the scene's own handlers, which would otherwise
  // turn the view or select what the pointer is let go over.
  element.addEventListener('pointermove', move, true);
  element.addEventListener('pointerup', up, true);
  element.addEventListener('pointercancel', cancel, true);
  window.addEventListener('keydown', escape, true);
}

/** A press on a palette tile: carried to the table, or clicked to add one next to the selection. */
export function pressTile(event: PointerEvent, element: HTMLElement, type: ServiceType): void {
  if (event.button !== 0) return;
  event.preventDefault();
  follow(event, element, { kind: 'new', type }, () => addKind(type));
}

/** Adds a service of `type` next to what is selected, and selects it. */
export function addKind(type: ServiceType): void {
  const editor = useEditor.getState();
  if (!editor.draft) return;
  const near = editor.selection?.kind === 'node' ? editor.selection.id : null;
  let id = '';
  editor.change((current) => {
    const made = addNear(current, type, near);
    id = made.id;
    return made.draft;
  });
  if (id) editor.select({ kind: 'node', id });
}

/**
 * Lets the pieces on the model be carried. Listens on the stage before the
 * camera does, and takes a press only when it starts on a piece; any other
 * press turns the camera or selects a connection, as it always does.
 */
export function attachEditor(stage: HTMLElement): () => void {
  const down = (event: PointerEvent) => {
    if (!editing() || event.button !== 0 || !event.isPrimary) return;
    const hit = sceneHandle.current?.pointAt(event.clientX, event.clientY);
    if (!hit?.node) return;
    const id = hit.node;
    event.stopPropagation();
    event.preventDefault();
    follow(event, stage, { kind: 'move', id }, () =>
      useEditor.getState().select({ kind: 'node', id }),
    );
  };
  // The scene's own click would select again under a piece just carried.
  const up = (event: PointerEvent) => {
    if (editing() && useEditor.getState().carrying) event.stopPropagation();
  };
  stage.addEventListener('pointerdown', down, true);
  stage.addEventListener('pointerup', up, true);
  return () => {
    stage.removeEventListener('pointerdown', down, true);
    stage.removeEventListener('pointerup', up, true);
  };
}
