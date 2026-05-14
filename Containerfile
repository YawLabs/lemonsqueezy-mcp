# syntax=docker/dockerfile:1.7

# ---------- Stage 1: builder ----------
FROM node:20-alpine AS builder

WORKDIR /build

# Install deps with a deterministic lockfile-driven install. Copy manifests
# first so this layer caches independently of source changes.
COPY package.json package-lock.json ./
RUN npm ci

# Copy build inputs.
COPY tsconfig.json build.mjs ./
COPY src ./src

# Bundle to dist/index.js (tsc typecheck + esbuild bundle).
RUN npm run build

# ---------- Stage 2: runtime ----------
FROM node:20-alpine AS runtime

WORKDIR /app

# Copy only the bundled artifact. The bundle has zero runtime deps, so we
# don't need node_modules in the final image.
COPY --from=builder /build/dist/index.js /app/dist/index.js

# Drop privileges. The `node` user ships with node:20-alpine.
USER node

# stdio MCP server -- no port to EXPOSE.
# Pass LEMONSQUEEZY_API_KEY (or LEMONSQUEEZY_API_KEY_COMMAND) via `podman run -e`.
ENTRYPOINT ["node", "/app/dist/index.js"]
