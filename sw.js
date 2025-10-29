// Minimal service worker to opportunistically cache Google Photorealistic Tiles root.json
// Scope: only caches successful GETs for root.json, relies on server Cache-Control / ETag.
// It will serve from cache when fresh; otherwise falls back to network and updates cache.

const ROOT_CACHE = 'root-json-v2';
const TTL_MS = 2.75 * 60 * 60 * 1000; // ~2h45m within 3h session window
const META_REQ = new Request('/__g3dt_root_ts'); // local timestamp marker

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (evt) => {
  evt.waitUntil(self.clients.claim());
});

self.addEventListener('message', (evt) => {
  if (evt.data && evt.data.type === 'CLEAR_ROOT_CACHE') {
    evt.waitUntil(caches.delete(ROOT_CACHE));
  }
});

function isRootJsonRequest(req) {
  try {
    const url = new URL(req.url);
    // Match .../v1/3dtiles/root.json (with or without query params)
    return /\/v1\/3dtiles\/root\.json$/i.test(url.pathname);
  } catch {
    return false;
  }
}

self.addEventListener('fetch', (evt) => {
  const { request } = evt;
  if (request.method !== 'GET' || !isRootJsonRequest(request)) return; // ignore others

  evt.respondWith((async () => {
    const cache = await caches.open(ROOT_CACHE);
    const cached = await cache.match(request);
    const tsRes  = await cache.match(META_REQ);
    let ts = 0;
    if (tsRes) {
      try { ts = parseInt(await tsRes.text(), 10) || 0; } catch {}
    }
    const age = Date.now() - ts;

    // Serve cached immediately if within TTL
    if (cached && age < TTL_MS) {
      return cached;
    }

    // Otherwise try network; if it fails fallback to stale cache
    try {
      const network = await fetch(request, { cache: 'default' });
      if (network.ok) {
        cache.put(request, network.clone());
        cache.put(META_REQ, new Response(String(Date.now())));
        return network;
      }
      // If non-OK and cache is fresh, use it; stale cache should not mask errors
      if (cached && age < TTL_MS) return cached;
      return network; // propagate error response
    } catch (e) {
      if (cached) return cached; // stale fallback offline
      throw e;
    }
  })());
});
