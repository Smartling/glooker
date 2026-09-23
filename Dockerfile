# Node 22 required: @mastra/* declare engines.node >= 22.13.0 (was node:20-alpine).
FROM node:22-alpine AS base

# Install dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
# --legacy-peer-deps required: @mastra/* force zod@4 while openai@4.104.0
# declares peerOptional zod@^3.23.8. Removing this needs an openai SDK major bump.
RUN npm ci --legacy-peer-deps
# libsql ships per-platform native bindings. Building linux/amd64 under QEMU on an
# arm64 host, npm's libc detection picks linux-x64-gnu even though this is Alpine
# (musl), so the runtime dies with "Cannot find module '@libsql/linux-x64-musl'".
# Force the musl binding explicitly.
RUN npm i --no-save --force @libsql/linux-x64-musl

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
FROM node:22-alpine AS runner
# Only the C++ runtime is needed for better-sqlite3 (not the compiler toolchain)
RUN apk add --no-cache libstdc++
WORKDIR /app

# Standalone output includes server.js + minimal node_modules
COPY --from=base /app/.next/standalone ./
# Static assets and public files must be copied separately
COPY --from=base /app/.next/static ./.next/static
COPY --from=base /app/public ./public
COPY --from=base /app/schema.sql ./
COPY --from=base /app/prompts ./prompts

ENV NODE_ENV=production
# Next's standalone server binds process.env.HOSTNAME, which Docker/ECS set to the
# container ID — so it listens ONLY on the container IP and NOT on loopback. The app
# calls its own /api/mcp server-side, so it must be reachable at 127.0.0.1.
ENV HOSTNAME=0.0.0.0
EXPOSE 3000

CMD ["node", "server.js"]
