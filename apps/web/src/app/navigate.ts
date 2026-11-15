/** Ways of getting somewhere on the model that more than one feature uses. */
import { sceneHandle } from '@/graphics/handle';
import { useUi } from '@/stores/ui';

/**
 * Moves in on a region. Regions are places, and the overview is not laid
 * out by place: from there this goes to the arrangement that is.
 */
export function showRegion(id: string): void {
  const ui = useUi.getState();
  if (ui.layoutMode !== 'layers') {
    sceneHandle.current?.frameRegion(id);
    return;
  }
  ui.setLayoutMode('regions');
  // The scene lays the regions out on the next frame; then there is a plate to go to.
  requestAnimationFrame(() => requestAnimationFrame(() => sceneHandle.current?.frameRegion(id)));
}
