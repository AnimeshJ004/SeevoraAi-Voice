# ------------------------------------------------------------------------------
# SeevoraVoice Production Dockerfile
# Hardened, Multi-Stage, Non-Root User, Healthcheck Probed
# ------------------------------------------------------------------------------

# Stage 1: Dependencies Cache Layer
FROM node:20-slim AS dependencies
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY dashboard/package*.json ./dashboard/
WORKDIR /app/dashboard
RUN npm ci --omit=dev && npm cache clean --force

# Stage 2: Build Layer (Static Charts & Bundles)
FROM node:20-slim AS builder
WORKDIR /app/dashboard
COPY dashboard/package*.json ./
RUN npm ci
COPY dashboard/ ./
RUN npm run build || true

# Stage 3: Hardened Production Runtime Layer
FROM node:20-slim AS runner

WORKDIR /app/dashboard

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=8080

# Prepare data directories and assign unprivileged node ownership
RUN mkdir -p /app/dashboard/data /app/dashboard/public \
    && chown -R node:node /app

# Copy production artifacts
COPY --from=dependencies --chown=node:node /app/dashboard/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dashboard/package*.json ./
COPY --from=builder --chown=node:node /app/dashboard/lib ./lib
COPY --from=builder --chown=node:node /app/dashboard/public ./public
COPY --from=builder --chown=node:node /app/dashboard/server.js ./server.js

# Security Hardening: Run as unprivileged non-root user
USER node

# Healthcheck probing the liveness endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:${PORT}/healthz || exit 1

EXPOSE 8080

CMD ["node", "server.js"]
