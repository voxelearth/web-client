// Minimal service worker to opportunistically cache Google Photorealistic Tiles root.json
// Scope: only caches successful GETs for root.json, relies on server Cache-Control / ETag.
// It will serve from cache when fresh; otherwise falls back to network and updates cache.

const ROOT_CACHE = 'root-json-v3';
const TTL_MS = 2.25 * 60 * 60 * 1000; // keep root < Google session window (2h15m)
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
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return false;
    // Match .../v1/3dtiles/root.json (with or without query params)
    return /\/v1\/3dtiles\/root\.json$/i.test(url.pathname);
  } catch {
    return false;
  }
}

self.addEventListener('fetch', (evt) => {
  const { request } = evt;
  if (request.method !== 'GET' || !isRootJsonRequest(request)) return; // ignore others

  evt.respondWith(handleRootJson(request));
});

async function handleRootJson(request) {
  const cache = await caches.open(ROOT_CACHE);
  const [cached, tsRes] = await Promise.all([
    cache.match(request),
    cache.match(META_REQ),
  ]);

  let ts = 0;
  if (tsRes) {
    try { ts = parseInt(await tsRes.text(), 10) || 0; } catch { }
  }
  const age = Date.now() - ts;

  const cacheControl = request.headers.get('cache-control');
  const wantsReload =
    request.cache === 'reload' ||
    (typeof cacheControl === 'string' && cacheControl.toLowerCase().includes('no-cache'));

  if (cached && age < TTL_MS && !wantsReload) {
    return cached;
  }

  try {
    const network = await fetch(request, {
      cache: wantsReload ? 'reload' : 'default',
    });

    if (network.ok) {
      cache.put(request, network.clone());
      cache.put(META_REQ, new Response(String(Date.now())));
      return network;
    }

    if (network.status === 304 && cached) {
      cache.put(META_REQ, new Response(String(Date.now())));
      return cached;
    }

    if (cached) {
      return cached;
    }

    return network;
  } catch (err) {
    if (cached) return cached;
    throw err;
  }
}
