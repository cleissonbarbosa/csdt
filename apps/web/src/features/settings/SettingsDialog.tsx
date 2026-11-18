import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Segmented, Switch } from '@/components/ui/Field';
import { IN_BROWSER } from '@/app/host';
import { t, type LanguageSetting } from '@/i18n';
import {
  useSettings,
  useUi,
  type LayoutMode,
  type MotionSetting,
  type QualitySetting,
  type RendererSetting,
  type ThemeSetting,
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

const LANGUAGE: { value: LanguageSetting; label: string }[] = [
  { value: 'auto', label: t('Browser#language') },
  // not-interface-text: each language is named in its own words
  { value: 'en', label: 'English' },
  // not-interface-text: each language is named in its own words
  { value: 'pt-BR', label: 'Português (Brasil)' },
];

const THEME: { value: ThemeSetting; label: string }[] = [
  { value: 'system', label: t('System') },
  { value: 'light', label: t('Light') },
  { value: 'night', label: t('Night') },
];
const QUALITY: { value: QualitySetting; label: string }[] = [
  { value: 'auto', label: t('Auto') },
  { value: 'low', label: t('Low') },
  { value: 'medium', label: t('Medium') },
  { value: 'high', label: t('High') },
  { value: 'ultra', label: t('Ultra') },
];
const MOTION: { value: MotionSetting; label: string }[] = [
  { value: 'system', label: t('System') },
  { value: 'reduced', label: t('Reduced') },
  { value: 'full', label: t('Full') },
];
const RENDERER: { value: RendererSetting; label: string }[] = [
  { value: 'auto', label: t('WebGPU (auto)') },
  { value: 'webgl2', label: 'WebGL 2' },
];
const LAYOUT: { value: LayoutMode; label: string }[] = [
  { value: 'layers', label: t('Overview') },
  { value: 'regions', label: t('Regions') },
  { value: 'dependencies', label: t('Dependencies') },
];

export function SettingsDialog() {
  const open = useUi((state) => state.openPanel === 'settings');
  const layoutMode = useUi((state) => state.layoutMode);
  const settings = useSettings();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => useUi.getState().setPanel(next ? 'settings' : null)}
      title={t('Settings')}
      description={t('Preferences are stored in this browser only.')}
      width="max-w-xl"
    >
      <h3 className="mb-1 text-xs font-bold text-ink">{t('Appearance')}</h3>
      <Row
        label={t('Language')}
        hint={
          IN_BROWSER
            ? t(
                "The interface's words. Changing it reloads the page, which starts the simulation in this tab again.",
              )
            : t(
                "The interface's words. Changing it reloads the page; the simulation on the server goes on as it is.",
              )
        }
      >
        <Segmented
          label={t('Language')}
          value={settings.language}
          options={LANGUAGE}
          onChange={(value) => {
            settings.set('language', value);
            // The language is read when the page loads. The setting is
            // written before this returns, so the reload finds it.
            if (value !== settings.language) window.location.reload();
          }}
        />
      </Row>
      <Row
        label={t('Theme')}
        hint={t(
          'Light for a lit room, night for a dark one. Both follow the same rule: a colour is an answer, to you or to the data.',
        )}
      >
        <Segmented
          label={t('Theme')}
          value={settings.theme}
          options={THEME}
          onChange={(value) => settings.set('theme', value)}
        />
      </Row>

      <h3 className="mb-1 mt-5 text-xs font-bold text-ink">{t('Model')}</h3>
      <Row
        label={t('Topology layout')}
        hint={t(
          'The overview by kind of service, or every service on its own: by cloud region, or by dependency tier.',
        )}
      >
        <Segmented
          label={t('Topology layout')}
          value={layoutMode}
          options={LAYOUT}
          onChange={(mode) => useUi.getState().setLayoutMode(mode)}
        />
      </Row>
      <Row
        label={t('Rendering quality')}
        hint={t(
          'Auto lowers resolution and bead density when frames get slow, and raises them back.',
        )}
      >
        <Segmented
          label={t('Rendering quality')}
          value={settings.quality}
          options={QUALITY}
          onChange={(value) => settings.set('quality', value)}
        />
      </Row>
      <Row
        label={t('Graphics backend')}
        hint={t(
          'WebGPU is used when the browser offers it; WebGL 2 runs the same shaders. Changing this restarts the scene.',
        )}
      >
        <Segmented
          label={t('Graphics backend')}
          value={settings.renderer}
          options={RENDERER}
          onChange={(value) => settings.set('renderer', value)}
        />
      </Row>
      <Switch
        label={t('Labels')}
        hint={t('Service and region names in the model.')}
        checked={settings.labels}
        onCheckedChange={(v) => settings.set('labels', v)}
      />
      <Switch
        label={t('Idle camera drift')}
        hint={t('Turns the model slowly until you move the camera. Off by default.')}
        checked={settings.autoRotate}
        onCheckedChange={(v) => settings.set('autoRotate', v)}
      />

      <h3 className="mb-1 mt-5 text-xs font-bold text-ink">{t('Accessibility')}</h3>
      <Row
        label={t('Motion')}
        hint={t(
          'Reduced motion stops camera animation, the working parts of the pieces, the blink of a new alarm and interface transitions.',
        )}
      >
        <Segmented
          label={t('Motion')}
          value={settings.motion}
          options={MOTION}
          onChange={(value) => settings.set('motion', value)}
        />
      </Row>

      <h3 className="mb-1 mt-5 text-xs font-bold text-ink">{t('Developer')}</h3>
      <Switch
        label={t('Performance overlay')}
        hint={t('Frame rate, frame time, draw calls, bead count and backend.')}
        checked={settings.devOverlay}
        onCheckedChange={(v) => settings.set('devOverlay', v)}
      />
      <div className="mt-4 flex justify-end">
        <Button variant="ghost" size="sm" onClick={settings.reset}>
          {t('Restore defaults')}
        </Button>
      </div>
    </Dialog>
  );
}
