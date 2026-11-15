import { useEffect, useState } from 'react';

import type { ThemeName } from '@/lib/palette';
import { resolveTheme, useSettings } from '@/stores/ui';

/**
 * Applies the chosen theme to the document and returns the one in effect.
 * With the setting on "system" it follows the OS, live.
 */
export function useTheme(): ThemeName {
  const setting = useSettings((state) => state.theme);
  const [theme, setTheme] = useState<ThemeName>(() => resolveTheme(setting));

  useEffect(() => {
    setTheme(resolveTheme(setting));
    if (setting !== 'system' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setTheme(resolveTheme('system'));
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [setting]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return theme;
}
