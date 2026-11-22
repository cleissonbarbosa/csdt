/**
 * The keys while a platform is drawn. Nothing here reaches the simulation:
 * Space does not play it, `L` does not change the arrangement (the editor
 * draws the swimlanes, where a lane is a region and a column a tier) and
 * `T` does not leave the model for the simulation's table.
 */
import { sceneHandle } from '@/graphics/handle';
import { disconnect, removeService } from '@/lib/topologyFile';
import { useEditor } from '@/stores/editor';

/**
 * Returns whether the key was the editor's. `typing` is whether the key
 * went to a field, where it belongs to the field.
 */
export function editorKey(event: KeyboardEvent, typing: boolean): boolean {
  const editor = useEditor.getState();
  const command = event.metaKey || event.ctrlKey;
  if (command && !event.altKey) {
    const key = event.key.toLowerCase();
    if (typing) return false;
    if (key === 'z') {
      if (event.shiftKey) editor.redo();
      else editor.undo();
      return true;
    }
    if (key === 'y') {
      editor.redo();
      return true;
    }
    // Ctrl K reaches the simulation's commands, which are not the editor's.
    return key === 'k';
  }
  if (typing || event.altKey) return false;
  switch (event.key) {
    case 'Delete':
    case 'Backspace': {
      const selection = editor.selection;
      if (!selection) return false;
      editor.change((draft) =>
        selection.kind === 'node'
          ? removeService(draft, selection.id)
          : disconnect(draft, selection.id),
      );
      return true;
    }
    case 'Escape':
      if (editor.selection) {
        editor.select(null);
        return true;
      }
      return false;
    case 'f':
    case 'F':
      if (editor.selection?.kind === 'node') sceneHandle.current?.focusNode(editor.selection.id);
      else sceneHandle.current?.frameAll();
      return true;
    case 'r':
    case 'R':
      sceneHandle.current?.resetView();
      return true;
    default:
      return false;
  }
}
