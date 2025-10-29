import {load} from '@loaders.gl/core';
import {Tileset3D} from '@loaders.gl/tiles';
import {Tiles3DLoader} from '@loaders.gl/3d-tiles';
import {WebMercatorViewport} from '@deck.gl/core';

const SESSION_MAX_AGE_MS = 2.5 * 60 * 60 * 1000;

export class SingleSceneFetcher {
  constructor() {
    this._sessionKey = null;
    this._sessionTs = 0;
  }

  /**
   * Fetch visible 3D Tiles GLBs for a lat/lng, sized by radius (meters).
   * If radiusMeters is provided, zoom is auto-computed to fit that diameter across viewport width.
   */
  async fetch3DTiles(lat, lng, zoom, targetScreenSpaceError, apiKey, logFn, radiusMeters) {
    const tilesetUrl = 'https://tile.googleapis.com/v1/3dtiles/root.json?key=' + apiKey;
    
    if (logFn) logFn(`Fetching tiles at (${lat} ${lng}, zoom: ${zoom}, sse: ${targetScreenSpaceError})`);
    const widthPx = 230;
    const heightPx = 175; // mini map dims
    const z = (Number.isFinite(radiusMeters) && radiusMeters > 0)
      ? this._zoomForRadius(lat, radiusMeters, widthPx)
      : (Number.isFinite(zoom) ? zoom : 16);

    const viewport = new WebMercatorViewport({
      width: widthPx,
      height: heightPx,
      latitude: lat,
      longitude: lng,
      zoom: z
    });

    const tileset = await this.load3DTileset(tilesetUrl, viewport, targetScreenSpaceError);
    this.getSessionKey(tileset); // updates _sessionKey/_sessionTs when fresh tokens seen
    const firstPassSession = this._isSessionFresh() ? this._sessionKey : null;
    if (!firstPassSession) this._sessionKey = null;

    const firstPass = this._collectGlbUrls(tileset.tiles || [], tilesetUrl, apiKey, targetScreenSpaceError, firstPassSession, logFn, false);
    if (firstPass.length > 0) {
      return firstPass;
    }

    const urlNoCache = tilesetUrl + (tilesetUrl.includes('?') ? '&' : '?') + '_=' + Date.now();
    const tilesetRetry = await this.load3DTileset(urlNoCache, viewport, targetScreenSpaceError);
    this.getSessionKey(tilesetRetry);
    const retrySession = this._isSessionFresh() ? this._sessionKey : null;
    if (!retrySession) this._sessionKey = null;

    return this._collectGlbUrls(tilesetRetry.tiles || [], urlNoCache, apiKey, targetScreenSpaceError, retrySession, logFn, true);
  }

  /**
   * Compute mercator zoom level fitting diameter (2*radius) into viewport width.
   */
  _zoomForRadius(latDeg, radiusMeters, viewportWidthPx) {
    const EARTH_CIRCUMFERENCE_M = 40075016.68557849;
    const latRad = (latDeg * Math.PI) / 180;
    const cosLat = Math.max(0.01, Math.cos(latRad));
    const margin = 1.10; // 10% padding
    const metersPerPixel = (2 * radiusMeters * margin) / Math.max(1, viewportWidthPx);
    const rawZoom = Math.log2((cosLat * EARTH_CIRCUMFERENCE_M) / (256 * metersPerPixel));
    return Math.max(0, Math.min(22, rawZoom));
  }

  async load3DTileset(tilesetUrl, viewport, screenSpaceError) {
    const tilesetJson = await load(tilesetUrl, Tiles3DLoader, {
      // Prefer browser HTTP cache when fresh (still respects Cache-Control / ETag)
      fetch: { cache: 'force-cache' },
      '3d-tiles': { loadGLTF: false }
    });
    const tileset3d = new Tileset3D(tilesetJson, {
      throttleRequests: false,
      maximumScreenSpaceError: screenSpaceError
    });

    while (!tileset3d.isLoaded()) {
      await tileset3d.selectTiles(viewport);
    }

    return tileset3d;
  }

  // Try to extract the tileset session key (if present) from the tileset queryParams
  getSessionKey(tileset) {
    try {
      if (!tileset || !tileset.queryParams) return this._sessionKey;
      const params = new URLSearchParams(tileset.queryParams);
      const s = params.get('session');
      if (s) {
        if (s !== this._sessionKey) {
          this._sessionKey = s;
          this._sessionTs = Date.now();
        }
      } else {
        this._sessionKey = null;
      }
      return this._sessionKey;
    } catch (e) {
      return this._sessionKey;
    }
  }

  _collectGlbUrls(tiles, baseUrl, apiKey, targetScreenSpaceError, sessionKey, logFn, isRetry) {
    const sorted = (tiles || []).slice().sort((a, b) => a.header.geometricError - b.header.geometricError);
    const glbUrls = [];
    const sessionParam = sessionKey || null;
    const logCap = () => {
      if (glbUrls.length > 100 && logFn) logFn('==== Exceeded maximum glTFs! Capping at 100 =====');
    };

    const pushUrl = (tile) => {
      if (!tile || !tile.contentUrl) return;
      try {
        const u = new URL(tile.contentUrl, baseUrl);
        if (!u.searchParams.has('key')) u.searchParams.set('key', apiKey);
        if (sessionParam && !u.searchParams.has('session')) u.searchParams.set('session', sessionParam);
        glbUrls.push(u.toString());
      } catch (e) {
        let url = tile.contentUrl;
        const hasQuery = url.indexOf('?') !== -1;
        url += `${hasQuery ? '&' : '?'}key=${apiKey}`;
        if (sessionParam && !/[?&]session=/.test(url)) {
          url += `&session=${sessionParam}`;
        }
        glbUrls.push(url);
      }
    };

    for (let i = 0; i < sorted.length; i++) {
      const tile = sorted[i];
      const errorDiff = Math.abs(targetScreenSpaceError - tile.header.geometricError);
      if (errorDiff <= targetScreenSpaceError) {
        pushUrl(tile);
        if (glbUrls.length > 100) {
          logCap();
          break;
        }
      }
    }

    if (glbUrls.length === 0 && sorted.length) {
      let firstSSEFound = null;
      for (let i = 0; i < sorted.length; i++) {
        const tile = sorted[i];
        if (firstSSEFound == null) firstSSEFound = Math.round(tile.header.geometricError);
        const errorDiff = Math.abs(targetScreenSpaceError - tile.header.geometricError);
        if (errorDiff <= firstSSEFound * 2) {
          pushUrl(tile);
          if (glbUrls.length > 100) {
            logCap();
            break;
          }
        }
      }
      if (logFn && !isRetry) {
        logFn(`==== No tiles found for screen space error ${targetScreenSpaceError}. Getting tiles that are within 2x of ${firstSSEFound} ===`);
      }
    }

    return glbUrls;
  }

  _isSessionFresh() {
    return !!(this._sessionKey && (Date.now() - this._sessionTs < SESSION_MAX_AGE_MS));
  }
}
