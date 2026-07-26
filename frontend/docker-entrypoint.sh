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

# ── 2. Write runtime config for the SPA ───────────────────────────
# The config.js file is loaded by index.html before the app bundle
# and provides runtime environment variables (e.g. API key) that are
# NOT baked into the static build.
cat > /usr/share/nginx/html/config.js << EOF
window.__ENV__ = {
  VITE_API_KEY: "${API_KEY:-}",
};
EOF

echo "→ Runtime config written (API_KEY is $( [ -n "$API_KEY" ] && echo 'set' || echo 'not set' ))"

exec nginx -g "daemon off;"
