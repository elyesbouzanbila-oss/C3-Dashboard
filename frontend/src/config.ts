/**
 * The SPA requires no runtime configuration or secrets: every backend call
 * targets the same origin (empty base URL) through the nginx proxy. The old
 * /config.js mechanism that published an API key to every visitor has been
 * removed — privileged operations mint a short-lived session token via
 * POST /api/config/auth instead.
 */
