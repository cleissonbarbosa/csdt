/*
 * The static site's service worker: it keeps the site's own files so that
 * the site opens with no network. `vite.config.ts` writes the two
 * placeholders below when it builds: the name of this build's cache and the
 * files to keep in it.
 *
 * It answers only for requests to its own origin that it was built with a
 * file for. Nothing is fetched from anywhere else, by it or through it.
 */
const CACHE = '__AEGIS_CACHE__';
const FILES = '__AEGIS_FILES__';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith('aegis-') && name !== CACHE)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    // The page: the published one when it can be had, the kept one when not.
    event.respondWith(
      fetch(request).catch(() =>
        caches
          .open(CACHE)
          .then((cache) => cache.match('./').then((kept) => kept ?? Response.error())),
      ),
    );
    return;
  }
  // Its other files carry a hash of their content in their name: the kept
  // copy is the file, and the network is asked only for one that is not kept.
  // A host may answer with `Vary: Origin`, and the page asks for its module
  // scripts with an Origin header the worker did not send when it kept them:
  // matched by that header the kept copy would not be found. The name is
  // what says which file it is, so the header is left out of the match.
  event.respondWith(
    caches
      .open(CACHE)
      .then((cache) => cache.match(request, { ignoreSearch: true, ignoreVary: true }))
      .then((kept) => kept ?? fetch(request)),
  );
});
