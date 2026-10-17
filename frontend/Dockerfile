# ---- Build Stage ----
FROM node:22-alpine AS build

WORKDIR /app

# npm TLS verification is on by default. The legacy VirtualBox lab saw TLS
# packet corruption (ERR_SSL_CIPHER_OPERATION_FAILED) on the virtio/e1000
# driver — if that strikes, build once with:
#   docker build --build-arg NPM_STRICT_SSL=false ...
# which is scoped to that single build instead of silently disabling
# certificate validation everywhere.
ARG NPM_STRICT_SSL=true
ENV npm_config_strict_ssl=${NPM_STRICT_SSL}

COPY package.json package-lock.json* ./
# npm ci (not install): installs exactly what package-lock.json pins, so a
# build cannot silently drift from the audited dependency tree.
RUN npm ci --omit=optional --no-audit --no-fund --network-timeout=300000 --maxsockets=3

# Install native binding for Alpine (musl) — otherwise rolldown fails.
# Pin it to the EXACT rolldown JS version installed from the lock file.
# Installing the latest musl binding here causes a native/JS version skew
# that breaks the build with:
#   value "builtin:vite-wasm-fallback" does not match any variant of
#   enum BindingBuiltinPluginName on BindingBuiltinPlugin.__name
RUN npm install @rolldown/binding-linux-x64-musl@$(node -p "require('./node_modules/rolldown/package.json').version") --no-save --no-audit --no-fund --network-timeout=120000

COPY . .

RUN npm run build

# ---- Production Stage ----
FROM nginx:alpine

# Copy nginx config (with reverse proxy to backend)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets from build stage
COPY --from=build /app/dist /usr/share/nginx/html

# Copy runtime config generator
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 5173

# Non-root runtime (matches k8s runAsUser: 101) — take ownership of every
# path nginx/entrypoint writes at startup:
#   /etc/nginx/ssl        — self-signed cert generation (compose dev)
#   /usr/share/nginx/html — static assets (read) and SPA files
#   /var/cache/nginx      — client/fastcgi temp dirs written by nginx master
#   /var/run              — pid file
# Kubernetes mounts dashboard-tls at /etc/nginx/ssl (readOnly) so generation
# is skipped there; the chown lives in the image layer and can't affect mounts.
RUN chown -R 101:101 /etc/nginx /usr/share/nginx/html /var/cache/nginx /var/run
USER 101

ENTRYPOINT ["/docker-entrypoint.sh"]
