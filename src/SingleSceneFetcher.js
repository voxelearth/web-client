const EARTH_A = 6378137.0;
const EARTH_F = 1 / 298.257223563;
const EARTH_E2 = EARTH_F * (2 - EARTH_F);
const RAD2DEG = 180 / Math.PI;
const MAX_TILE_RESULTS = Number.POSITIVE_INFINITY;
const SESSION_MAX_AGE_MS = 2.5 * 60 * 60 * 1000;

function cartesianFromDegrees(lonDeg, latDeg, height = 0) {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const N = EARTH_A / Math.sqrt(1 - EARTH_E2 * sinLat * sinLat);
  const x = (N + height) * cosLat * Math.cos(lon);
  const y = (N + height) * cosLat * Math.sin(lon);
  const z = (N * (1 - EARTH_E2) + height) * sinLat;
  return [x, y, z];
}

class Sphere {
  constructor(center, radius) {
    this.center = center;
    this.radius = Math.max(0, radius || 0);
  }

  intersects(other) {
    if (!other) return true;
    const dx = other.center[0] - this.center[0];
    const dy = other.center[1] - this.center[1];
    const dz = other.center[2] - this.center[2];
    const dist = Math.hypot(dx, dy, dz);
    return dist <= (this.radius + other.radius);
  }
}

function distance(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.hypot(dx, dy, dz);
}

function obbToSphere(boxSpec) {
  if (!Array.isArray(boxSpec) || boxSpec.length < 12) return null;
  const cx = boxSpec[0], cy = boxSpec[1], cz = boxSpec[2];
  const h1 = [boxSpec[3], boxSpec[4], boxSpec[5]];
  const h2 = [boxSpec[6], boxSpec[7], boxSpec[8]];
  const h3 = [boxSpec[9], boxSpec[10], boxSpec[11]];
  const corners = [];
  for (let i = 0; i < 8; i++) {
    const s1 = (i & 1) ? 1 : -1;
    const s2 = (i & 2) ? 1 : -1;
    const s3 = (i & 4) ? 1 : -1;
    corners.push([
      cx + s1 * h1[0] + s2 * h2[0] + s3 * h3[0],
      cy + s1 * h1[1] + s2 * h2[1] + s3 * h3[1],
      cz + s1 * h1[2] + s2 * h2[2] + s3 * h3[2],
    ]);
  }
  let minX = corners[0][0], maxX = corners[0][0];
  let minY = corners[0][1], maxY = corners[0][1];
  let minZ = corners[0][2], maxZ = corners[0][2];
  for (const [x, y, z] of corners) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const midX = 0.5 * (minX + maxX);
  const midY = 0.5 * (minY + maxY);
  const midZ = 0.5 * (minZ + maxZ);
  const dx = maxX - minX;
  const dy = maxY - minY;
  const dz = maxZ - minZ;
  const radius = 0.5 * Math.sqrt(dx * dx + dy * dy + dz * dz);
  return new Sphere([midX, midY, midZ], radius);
}

function regionToSphere(region) {
  if (!Array.isArray(region) || region.length < 6) return null;
  const west = region[0], south = region[1], east = region[2], north = region[3];
  const minH = region[4] || 0;
  const maxH = region[5] || 0;
  const centerLon = ((west + east) * 0.5) * RAD2DEG;
  const centerLat = ((south + north) * 0.5) * RAD2DEG;
  const center = cartesianFromDegrees(centerLon, centerLat, (minH + maxH) * 0.5);
  let radius = 0;
  const lonVals = [west, east];
  const latVals = [south, north];
  for (const lonRad of lonVals) {
    for (const latRad of latVals) {
      const corner = cartesianFromDegrees(lonRad * RAD2DEG, latRad * RAD2DEG, maxH);
      radius = Math.max(radius, distance(center, corner));
    }
  }
  return new Sphere(center, radius || Math.abs(maxH - minH));
}

function boundingVolumeToSphere(volume) {
  if (!volume) return null;
  if (volume.sphere && Array.isArray(volume.sphere)) {
    const [x, y, z, r] = volume.sphere;
    return new Sphere([x, y, z], Math.abs(r || 0));
  }
  if (volume.box) return obbToSphere(volume.box);
  if (volume.region) return regionToSphere(volume.region);
  return null;
}

function getSharedSession() {
  const state = globalThis.__photorealSession;
  if (!state || !state.id) return null;
  if (Date.now() - (state.ts || 0) > SESSION_MAX_AGE_MS) return null;
  return state.id;
}

function setSharedSession(id) {
  if (!id) {
    globalThis.__photorealSession = null;
    return;
  }
  globalThis.__photorealSession = { id, ts: Date.now() };
}

export class SingleSceneFetcher {
  constructor() {
    this._sessionKey = null;
    this._sessionTs = 0;
  }

  async fetch3DTiles(lat, lng, zoom, targetScreenSpaceError, apiKey, logFn, radiusMeters) {
    const radius = Math.max(50, Number.isFinite(radiusMeters) ? radiusMeters : 500);
    const centerECEF = cartesianFromDegrees(lng, lat, 0);
    const regionSphere = new Sphere(centerECEF, radius);
    const startingSession = this._isSessionFresh() ? this._sessionKey : (getSharedSession() || null);
    const sessionRef = { value: startingSession };
    if (startingSession) {
      this._sessionKey = startingSession;
      this._sessionTs = Date.now();
    }
    this._visitedTilesets = new Set();
    const urls = [];
    const rootUrl = new URL('https://tile.googleapis.com/v1/3dtiles/root.json');
    rootUrl.searchParams.set('key', apiKey);
    if (sessionRef.value && !rootUrl.searchParams.has('session')) {
      rootUrl.searchParams.set('session', sessionRef.value);
    }

    logFn?.(`Fetching tiles within ${radius.toFixed(0)} m, SSE ${targetScreenSpaceError}`);

    await this._walkTileset(rootUrl, regionSphere, apiKey, sessionRef, targetScreenSpaceError, urls, logFn, 0);

    if (sessionRef.value) {
      this._sessionKey = sessionRef.value;
      this._sessionTs = Date.now();
      setSharedSession(sessionRef.value);
    }

    logFn?.(`Found ${urls.length} tile(s).`);
    return urls;
  }

  async _walkTileset(url, regionSphere, apiKey, sessionRef, targetSSE, urls, logFn, depth, attempt = 0) {
    if (!url || urls.length >= MAX_TILE_RESULTS) return;
    const urlStr = url.toString();
    if (attempt === 0 && this._visitedTilesets.has(urlStr)) return;

    const urlObj = url instanceof URL ? new URL(url) : new URL(String(url));
    if (!urlObj.searchParams.has('key')) urlObj.searchParams.set('key', apiKey);
    if (sessionRef.value && !urlObj.searchParams.has('session')) {
      urlObj.searchParams.set('session', sessionRef.value);
    } else if (!sessionRef.value) {
      const shared = getSharedSession();
      if (shared) {
        urlObj.searchParams.set('session', shared);
        sessionRef.value = shared;
      }
    }

    let resp;
    try {
      resp = await fetch(urlObj.toString(), { cache: 'force-cache' });
    } catch (err) {
      logFn?.(`Failed to load ${urlObj.toString()}: ${err?.message || err}`);
      return;
    }
    if (!resp.ok) {
      if (sessionRef.value && [400,401,403].includes(resp.status)) {
        logFn?.(`Session rejected (HTTP ${resp.status}); retrying without session.`);
        this._clearSession(sessionRef);
        if (attempt < 1) {
          return this._walkTileset(new URL(urlStr), regionSphere, apiKey, sessionRef, targetSSE, urls, logFn, depth, attempt + 1);
        }
      }
      logFn?.(`HTTP ${resp.status} for ${urlObj.toString()}`);
      return;
    }
    let json;
    try {
      json = await resp.json();
    } catch (err) {
      logFn?.(`Invalid JSON for ${urlObj.toString()}: ${err?.message || err}`);
      return;
    }
    this._visitedTilesets.add(urlStr);
    try {
      const respSession = new URL(resp.url).searchParams.get('session');
      if (respSession) this._setSession(sessionRef, respSession);
    } catch {}
    if (!json?.root) return;
    await this._walkNode(json.root, urlObj, regionSphere, apiKey, sessionRef, targetSSE, urls, logFn, depth);
  }

  async _walkNode(node, baseUrl, regionSphere, apiKey, sessionRef, targetSSE, urls, logFn, depth) {
    if (!node || urls.length >= MAX_TILE_RESULTS) return;
    const boundingSphere = boundingVolumeToSphere(node.boundingVolume);
    if (boundingSphere && !regionSphere.intersects(boundingSphere)) return;

    const error = Number.isFinite(node.geometricError) ? node.geometricError : 0;
    const hasChildren = Array.isArray(node.children) && node.children.length > 0;
    const shouldRefine = hasChildren && error > targetSSE;

    if (shouldRefine) {
      for (const child of node.children) {
        if (urls.length >= MAX_TILE_RESULTS) break;
        await this._walkNode(child, baseUrl, regionSphere, apiKey, sessionRef, targetSSE, urls, logFn, depth + 1);
      }
      return;
    }

    const contents = this._gatherContents(node);
    if (!contents.length && hasChildren) {
      for (const child of node.children) {
        if (urls.length >= MAX_TILE_RESULTS) break;
        await this._walkNode(child, baseUrl, regionSphere, apiKey, sessionRef, targetSSE, urls, logFn, depth + 1);
      }
      return;
    }

    for (const content of contents) {
      if (urls.length >= MAX_TILE_RESULTS) break;
      await this._handleContent(content, baseUrl, regionSphere, apiKey, sessionRef, targetSSE, urls, logFn, depth);
    }
  }

  _gatherContents(node) {
    const contents = [];
    if (node?.content?.uri) contents.push(node.content);
    if (Array.isArray(node?.contents)) contents.push(...node.contents);
    const gltfExt = node?.extensions?.['3DTILES_content_gltf'];
    if (gltfExt) {
      if (Array.isArray(gltfExt.contents)) contents.push(...gltfExt.contents);
      else if (gltfExt.content) contents.push(gltfExt.content);
      else if (gltfExt.uri) contents.push({ uri: gltfExt.uri, type: gltfExt.mimeType || gltfExt.type });
    }
    return contents;
  }

  async _handleContent(content, baseUrl, regionSphere, apiKey, sessionRef, targetSSE, urls, logFn, depth) {
    if (!content?.uri || urls.length >= MAX_TILE_RESULTS) return;
    let contentURL;
    try {
      contentURL = new URL(content.uri, baseUrl);
    } catch (e) {
      logFn?.(`Bad content URI ${content.uri}`);
      return;
    }
    if (!contentURL.searchParams.has('key')) contentURL.searchParams.set('key', apiKey);
    if (sessionRef.value && !contentURL.searchParams.has('session')) {
      contentURL.searchParams.set('session', sessionRef.value);
    }
    const sessionParam = contentURL.searchParams.get('session');
    if (sessionParam) this._setSession(sessionRef, sessionParam);

    const href = contentURL.toString();
    const mime = (content.type || content.mimeType || content.contentType || '').toLowerCase();
    const pathLower = (contentURL.pathname || '').toLowerCase();
    const isJson = pathLower.endsWith('.json') || mime.includes('json');
    const isGltf = pathLower.endsWith('.glb') || pathLower.endsWith('.gltf') || mime.includes('gltf');

    if (isJson) {
      if (depth < 32) {
        await this._walkTileset(contentURL, regionSphere, apiKey, sessionRef, targetSSE, urls, logFn, depth + 1);
      }
      return;
    }

    if (isGltf) {
      urls.push(href);
      return;
    }

    logFn?.(`Skipping non-GLB content (${content.type || 'unknown'}): ${href}`);
  }

  _isSessionFresh() {
    return !!(this._sessionKey && (Date.now() - this._sessionTs < SESSION_MAX_AGE_MS));
  }

  _setSession(sessionRef, value) {
    if (!value || sessionRef.value === value) return;
    sessionRef.value = value;
    this._sessionKey = value;
    this._sessionTs = Date.now();
    setSharedSession(value);
  }

  _clearSession(sessionRef) {
    sessionRef.value = null;
    this._sessionKey = null;
    this._sessionTs = 0;
    setSharedSession(null);
  }
}
