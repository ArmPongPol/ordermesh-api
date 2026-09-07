# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# deps - full install, needed to compile
# ---------------------------------------------------------------------------
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------------------
# build - compile TypeScript to dist/
# ---------------------------------------------------------------------------
FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---------------------------------------------------------------------------
# prod-deps - runtime dependencies only
# ---------------------------------------------------------------------------
FROM node:24-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---------------------------------------------------------------------------
# runner
# ---------------------------------------------------------------------------
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001
ENV HOST=0.0.0.0

# dumb-init reaps zombies and forwards SIGTERM so enableShutdownHooks() runs.
RUN apk add --no-cache dumb-init

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./

USER node
EXPOSE 3001

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main"]
