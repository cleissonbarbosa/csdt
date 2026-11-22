/**
 * The keys while a platform is drawn. Nothing here reaches the simulation:
 * Space does not play it, `L` does not change the arrangement (the editor
 * draws the swimlanes, where a lane is a region and a column a tier) and
 * `T` does not leave the model for the simulation's table.
 */
import { sceneHandle } from '@/graphics/handle';
import { disconnect, removeService } from '@/lib/topologyFile';
import { useEditor } from '@/stores/editor';
import { useIncident } from '@/stores/incident';

import { finishFlow } from './incident/IncidentPalette';

/**
 * The keys of the incident: undo and redo its own history; Delete takes out
 * the effect or flow open in the card; Enter finishes a flow being drawn
 * and Escape stops drawing it, or closes what is open.
 */
function incidentKey(event: KeyboardEvent, typing: boolean): boolean | null {
  const incident = useIncident.getState();
  const command = event.metaKey || event.ctrlKey;
  if (command && !event.altKey && !typing) {
    const key = event.key.toLowerCase();
    if (key === 'z') {
      if (event.shiftKey) incident.redo();
      else incident.undo();
      return true;
    }
    if (key === 'y') {
      incident.redo();
      return true;
    }
    return null;
  }
  if (typing || event.altKey) return null;
  switch (event.key) {
    case 'Enter':
      if (incident.drawing === null) return null;
      finishFlow();
      return true;
    case 'Escape':
      if (incident.drawing !== null) {
        incident.draw(null);
        return true;
      }
      if (incident.item !== null) {
        incident.selectItem(null);
        return true;
      }
      return null;
    case 'Delete':
    case 'Backspace': {
      const item = incident.item;
      if (item === null) return false;
      incident.change((scenario) => {
        const flow = scenario.flows.find((entry) => entry.key === item);
        const gone = flow?.kind === 'flow' ? flow.id : null;
        return {
          ...scenario,
          flows: scenario.flows.filter((entry) => entry.key !== item),
          phases: scenario.phases.map((phase) => ({
            ...phase,
            effects: phase.effects.filter(
              (effect) =>
                effect.key !== item && !(effect.kind === 'flowRate' && effect.flow === gone),
            ),
          })),
        };
      });
      return true;
    }
    default:
      return null;
  }
}

/**
 * Returns whether the key was the editor's. `typing` is whether the key
 * went to a field, where it belongs to the field.
 */
export function editorKey(event: KeyboardEvent, typing: boolean): boolean {
  const editor = useEditor.getState();
  if (editor.tab === 'incident') {
    const used = incidentKey(event, typing);
    if (used !== null) return used;
    // The platform stands as it is: a selection is not removed from here.
    if (!typing && (event.key === 'Delete' || event.key === 'Backspace')) return false;
  }
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
