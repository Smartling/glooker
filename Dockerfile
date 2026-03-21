FROM node:20-alpine AS base

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

# Build
RUN npm run build

# Production
FROM node:20-alpine AS runner
RUN apk add --no-cache python3 make g++
WORKDIR /app

COPY --from=base /app/.next ./.next
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/package.json ./
COPY --from=base /app/next.config.ts ./
COPY --from=base /app/schema.sql ./
COPY --from=base /app/public ./public
COPY --from=base /app/prompts ./prompts

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "start"]
