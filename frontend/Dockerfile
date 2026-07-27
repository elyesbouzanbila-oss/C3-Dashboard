# ---- Build Stage ----
# Using bookworm-slim (Debian 12 + glibc) instead of Alpine because
# the Alpine + OpenSSL 3.x combination has known TLS stream corruption
# issues (ERR_SSL_CIPHER_OPERATION_FAILED) when npm downloads packages.
FROM node:22-bookworm-slim AS build

WORKDIR /app

# npm config: retry on transient network failures, prefer local cache
RUN npm config set fetch-retries 5 && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000

COPY package.json package-lock.json* ./

# Use npm ci (clean install) — faster, strict lockfile checking, and
# avoids the SSL cipher corruption issue seen with npm install on Alpine.
RUN npm ci --omit=optional --no-audit --no-fund --prefer-offline

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
