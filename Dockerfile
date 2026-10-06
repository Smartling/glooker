# Node 22 LTS, pinned by digest.
#
# Was node:20-alpine on a floating tag. Node 20 reached end of life on
# 2026-04-30, so the runtime had stopped receiving upstream security patches
# altogether — in a product whose job is tracking its customers' overdue CVEs.
# Next 16 requires >=20.9.0; 22 is the supported LTS. The digest makes the build
# reproducible and stops a retagged or compromised upstream being picked up
# silently.
FROM node:22.23.3-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS base

# Install dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy source
COPY . .

# Ensure public dir exists (may not in all setups)
RUN mkdir -p public

# Pass commit SHA for version footer (git is unavailable in container)
ARG COMMIT_SHA
ENV COMMIT_SHA=$COMMIT_SHA

# Build (standalone output — includes only required node_modules)
RUN npm run build

# Production
FROM node:22.23.3-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS runner
# Only the C++ runtime is needed for better-sqlite3 (not the compiler toolchain).
# The server runs `node server.js` and never uses a package manager, so drop the
# npm/npx/corepack/yarn bundled with the base image: their vendored dependencies were
# the only fixable HIGH findings in the image scan, and they are attack surface.
RUN apk add --no-cache libstdc++ wget \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app

# Standalone output includes server.js + minimal node_modules.
# Owned by the non-root `node` user that ships with the image.
COPY --from=base --chown=node:node /app/.next/standalone ./
# Static assets and public files must be copied separately
COPY --from=base --chown=node:node /app/.next/static ./.next/static
COPY --from=base --chown=node:node /app/public ./public
COPY --from=base --chown=node:node /app/schema.sql ./
COPY --from=base --chown=node:node /app/prompts ./prompts

ENV NODE_ENV=production
EXPOSE 3000

# Drop root. The server has no reason to run privileged, and without this any
# RCE in the Node process (the framework had four critical unauthenticated-RCE
# advisories open before the Next 16 upgrade) started as uid 0 — free to
# backdoor server.js for persistence, apk add tooling, read /proc/1/environ, and
# attempt any escape needing privileged operations.
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
