/**
 * Lets the browser keep the static site, so it opens with no network.
 *
 * Only the static build has a worker to register (`vite.config.ts` writes
 * it): it is the only build that is complete without a server. Where there
 * is none, or the browser has no service workers, nothing happens and
 * nothing is said: the site works as it did.
 */
export function keepOffline(): void {
  if (import.meta.env.MODE !== 'static' || !import.meta.env.PROD) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    // Beside the page, wherever the site is served from.
    void navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => undefined);
  });
}
