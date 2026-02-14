/**
 * config.js - Centralized configuration for tile server endpoints.
 */

export const TILE_SERVERS = {
    google: (apiKey) => `https://tile.googleapis.com/v1/3dtiles/root.json?key=${apiKey}`,
    local: () => `http://localhost:8787/v1/3dtiles/root.json`,
    custom: () => `https://edu.voxelearth.org/v1/3dtiles/root.json`,
};

// Set the active server here
export const ACTIVE_SERVER = 'custom'; // 'google' | 'local' | 'custom'

// If using 'custom', set this URL
export const CUSTOM_SERVER_URL = '';

export function getActiveServerUrl(apiKey) {
    // If the user provided an API key, always use Google directly
    if (apiKey) {
        return TILE_SERVERS.google(apiKey);
    }
    // No API key → use the configured fallback server
    if (ACTIVE_SERVER === 'custom' && CUSTOM_SERVER_URL) {
        return CUSTOM_SERVER_URL;
    }
    const factory = TILE_SERVERS[ACTIVE_SERVER];
    return factory ? factory(apiKey) : TILE_SERVERS.google(apiKey);
}

export function isLocalServer() {
    return ACTIVE_SERVER === 'local' || (ACTIVE_SERVER === 'custom' && CUSTOM_SERVER_URL.includes('localhost'));
}
