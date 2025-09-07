import {load} from '@loaders.gl/core';
import {Tileset3D} from '@loaders.gl/tiles';
import {Tiles3DLoader} from '@loaders.gl/3d-tiles';
import {WebMercatorViewport} from '@deck.gl/core';

export class SingleSceneFetcher {
  constructor() {
    // Constructor can be empty for now
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
    const sessionKey = this.getSessionKey(tileset);
    let tiles = tileset.tiles || [];
    
    // sort tiles to have the most accurate tiles first
    tiles = tiles.sort((tileA, tileB) => {
      return tileA.header.geometricError - tileB.header.geometricError;
    });

    const glbUrls = [];
    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i];
      const errorDiff = Math.abs(targetScreenSpaceError - tile.header.geometricError);
      if (errorDiff <= targetScreenSpaceError) {
        // tile.contentUrl may be relative and may require both key & session params.
        try {
          const u = new URL(tile.contentUrl, tilesetUrl);
          if (!u.searchParams.has('key')) u.searchParams.set('key', apiKey);
          if (sessionKey && !u.searchParams.has('session')) u.searchParams.set('session', sessionKey);
          glbUrls.push(u.toString());
        } catch (e) {
          // fallback: append params conservatively
          let url = tile.contentUrl;
          const sep = url.indexOf('?') === -1 ? '?' : '&';
          url += `${sep}key=${apiKey}` + (sessionKey ? `&session=${sessionKey}` : '');
          glbUrls.push(url);
        }
      }

      if (glbUrls.length > 100) {
        if (logFn) logFn("==== Exceeded maximum glTFs! Capping at 100 =====");
        break;
      }
    }

    if (glbUrls.length == 0) {
      let firstSSEFound = null;
      for (let i = 0; i < tiles.length; i++) {
        const tile = tiles[i];
        if (firstSSEFound == null) firstSSEFound = Math.round(tile.header.geometricError);
        const errorDiff = Math.abs(targetScreenSpaceError - tile.header.geometricError);
        if (errorDiff <= firstSSEFound * 2) {
          try {
            const u = new URL(tile.contentUrl, tilesetUrl);
            if (!u.searchParams.has('key')) u.searchParams.set('key', apiKey);
            if (sessionKey && !u.searchParams.has('session')) u.searchParams.set('session', sessionKey);
            glbUrls.push(u.toString());
          } catch (e) {
            let url = tile.contentUrl;
            const sep = url.indexOf('?') === -1 ? '?' : '&';
            url += `${sep}key=${apiKey}` + (sessionKey ? `&session=${sessionKey}` : '');
            glbUrls.push(url);
          }
        }

        if (glbUrls.length > 100) {
          if (logFn) logFn("==== Exceeded maximum glTFs! Capping at 100 =====");
          break;
        }
      }
      if (logFn) logFn(`==== No tiles found for screen space error ${targetScreenSpaceError}. Getting tiles that are within 2x of ${firstSSEFound} ===`);
    }

    return glbUrls;
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
      if (!tileset || !tileset.queryParams) return null;
      const params = new URLSearchParams(tileset.queryParams);
      return params.get('session');
    } catch (e) {
      return null;
    }
  }
}
