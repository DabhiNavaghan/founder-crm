# syntax=docker/dockerfile:1.7
# FoundReach: Vite SPA (dist/) + the api/ functions, served by server.mjs in one Node process.
# Built for linux/arm64 (the Oracle server) and linux/amd64 by .github/workflows/docker.yml.
ARG NODE_VERSION=24

# --- 1. Build the SPA -------------------------------------------------------------------------
# Runs on the CI machine's own architecture: dist/ is plain HTML/JS/CSS, so it is the same for every
# target platform and never has to be built under emulation.
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY . .
# Public, browser-visible values that Vite bakes into the bundle. They are not secrets.
ARG VITE_CLERK_PUBLISHABLE_KEY=""
ARG VITE_SUPABASE_URL=""
ARG VITE_SUPABASE_PUBLISHABLE_KEY=""
RUN VITE_CLERK_PUBLISHABLE_KEY="$VITE_CLERK_PUBLISHABLE_KEY" \
    VITE_SUPABASE_URL="$VITE_SUPABASE_URL" \
    VITE_SUPABASE_PUBLISHABLE_KEY="$VITE_SUPABASE_PUBLISHABLE_KEY" \
    npm run build

# --- 2. Runtime packages ----------------------------------------------------------------------
# Runs on the target architecture. Installs the production dependencies, then keeps only the
# packages that server.mjs and api/ actually import (see docker/runtime-deps.mjs).
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --no-audit --no-fund
COPY server.mjs ./
COPY api ./api
COPY docker/runtime-deps.mjs ./docker/runtime-deps.mjs
RUN node docker/runtime-deps.mjs /runtime/node_modules

# --- 3. Runtime image -------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runtime
LABEL org.opencontainers.image.source="https://github.com/DabhiNavaghan/founder-crm" \
      org.opencontainers.image.title="foundreach" \
      org.opencontainers.image.description="FoundReach web app and API" \
      dev.navaghandabhi.app="foundreach"
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app
COPY --from=deps /runtime/node_modules ./node_modules
COPY package.json vercel.json server.mjs ./
COPY api ./api
COPY --from=build /app/dist ./dist
# The app only reads its files; it runs as the unprivileged "node" user (uid 1000) of the base image.
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/healthz" || exit 1
STOPSIGNAL SIGTERM
CMD ["node", "server.mjs"]
