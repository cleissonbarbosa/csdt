import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Segmented, Switch } from '@/components/ui/Field';
import {
  useSettings,
  useUi,
  type LayoutMode,
  type MotionSetting,
  type QualitySetting,
  type RendererSetting,
} from '@/stores/ui';

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 py-1.5">
      <div className="min-w-0">
        <p className="text-xs text-ink">{label}</p>
        {hint && <p className="mt-0.5 text-[11px] text-ink-faint">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

const QUALITY: { value: QualitySetting; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'ultra', label: 'Ultra' },
];
const MOTION: { value: MotionSetting; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'reduced', label: 'Reduced' },
  { value: 'full', label: 'Full' },
];
const RENDERER: { value: RendererSetting; label: string }[] = [
  { value: 'auto', label: 'WebGPU (auto)' },
  { value: 'webgl2', label: 'WebGL 2' },
];
const LAYOUT: { value: LayoutMode; label: string }[] = [
  { value: 'regions', label: 'Regions' },
  { value: 'dependencies', label: 'Dependencies' },
];

export function SettingsDialog() {
  const open = useUi((state) => state.openPanel === 'settings');
  const layoutMode = useUi((state) => state.layoutMode);
  const settings = useSettings();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => useUi.getState().setPanel(next ? 'settings' : null)}
      title="Settings"
      description="Preferences are stored in this browser only."
      width="max-w-xl"
    >
      <h3 className="eyebrow mb-1">Scene</h3>
      <Row
        label="Topology layout"
        hint="Cluster by cloud region, or lay services out by dependency tier."
      >
        <Segmented
          label="Topology layout"
          value={layoutMode}
          options={LAYOUT}
          onChange={(mode) => useUi.getState().setLayoutMode(mode)}
        />
      </Row>
      <Row
        label="Rendering quality"
        hint="Auto lowers resolution and particle density when frames get slow, and raises them back."
      >
        <Segmented
          label="Rendering quality"
          value={settings.quality}
          options={QUALITY}
          onChange={(value) => settings.set('quality', value)}
        />
      </Row>
      <Row
        label="Graphics backend"
        hint="WebGPU is used when the browser offers it; WebGL 2 runs the same shaders. Changing this restarts the scene."
      >
        <Segmented
          label="Graphics backend"
          value={settings.renderer}
          options={RENDERER}
          onChange={(value) => settings.set('renderer', value)}
        />
      </Row>
      <Switch
        label="Bloom"
        hint="Glow around bright accents."
        checked={settings.bloom}
        onCheckedChange={(v) => settings.set('bloom', v)}
      />
      <Switch
        label="Labels"
        hint="Service and region names in the scene."
        checked={settings.labels}
        onCheckedChange={(v) => settings.set('labels', v)}
      />
      <Switch
        label="Idle camera drift"
        hint="Slow orbit until you move the camera."
        checked={settings.autoRotate}
        onCheckedChange={(v) => settings.set('autoRotate', v)}
      />

      <h3 className="eyebrow mb-1 mt-5">Accessibility</h3>
      <Row
        label="Motion"
        hint="Reduced motion stops camera animation, spinning, pulsing and interface transitions."
      >
        <Segmented
          label="Motion"
          value={settings.motion}
          options={MOTION}
          onChange={(value) => settings.set('motion', value)}
        />
      </Row>

      <h3 className="eyebrow mb-1 mt-5">Developer</h3>
      <Switch
        label="Performance overlay"
        hint="Frame rate, frame time, draw calls, particle count and backend."
        checked={settings.devOverlay}
        onCheckedChange={(v) => settings.set('devOverlay', v)}
      />
      <div className="mt-4 flex justify-end">
        <Button variant="ghost" size="sm" onClick={settings.reset}>
          Restore defaults
        </Button>
      </div>
    </Dialog>
  );
}
