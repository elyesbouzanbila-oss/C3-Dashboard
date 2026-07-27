# ---- Build Stage ----
FROM node:22-alpine AS build

WORKDIR /app

# Fix OpenSSL 3.x cipher incompatibility with npm on Alpine
ENV NODE_OPTIONS="--openssl-legacy-provider"

COPY package.json package-lock.json* ./
RUN npm cache clean --force && \
    npm install --omit=optional --no-audit --no-fund --network-timeout=120000

# Install native binding for Alpine (musl) — otherwise rolldown fails
RUN npm install @rolldown/binding-linux-x64-musl --no-save --no-audit --no-fund --network-timeout=120000

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
