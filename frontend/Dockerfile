# ---- Build Stage ----
FROM node:22-alpine AS build

WORKDIR /app

# VirtualBox workaround: disable npm strict SSL to avoid TLS packet
# corruption (ERR_SSL_CIPHER_OPERATION_FAILED) on the virtio/e1000 driver.
# This is safe for a private lab cluster behind VirtualBox NAT.
ENV npm_config_strict_ssl=false

COPY package.json package-lock.json* ./
RUN npm cache clean --force && \
    npm install --omit=optional --no-audit --no-fund --network-timeout=300000 --maxsockets=3

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

# Copy runtime env injection script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 5173

ENTRYPOINT ["/docker-entrypoint.sh"]
