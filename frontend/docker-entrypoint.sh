#!/bin/sh
set -e

# ── 1. Generate self-signed TLS certificate if not present ────────
# This ensures HTTPS works out of the box in docker-compose and any
# environment where the dashboard-tls secret isn't mounted.
if [ ! -f /etc/nginx/ssl/tls.crt ] || [ ! -f /etc/nginx/ssl/tls.key ]; then
  echo "→ Generating self-signed TLS certificate..."
  mkdir -p /etc/nginx/ssl
  openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout /etc/nginx/ssl/tls.key \
    -out /etc/nginx/ssl/tls.crt \
    -subj "/O=Dashboard/CN=localhost" \
    -addext "subjectAltName=DNS:localhost,DNS:dashboard.local"
  echo "✔ Self-signed certificate generated at /etc/nginx/ssl/"
fi

# ── 2. No runtime config ──────────────────────────────────────────
# The browser needs no secrets or API keys: all backend calls go through
# the same-origin nginx proxy, and privileged operations mint a short-lived
# session token via POST /api/config/auth. (The old config.js mechanism that
# published an API key to every visitor has been removed.)

exec nginx -g "daemon off;"
