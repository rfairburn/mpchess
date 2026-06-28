# ── Build stage ──────────────────────────────────────────────
FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS builder

WORKDIR /app

# Copy package files first (layer caching)
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source and build shared module
COPY . .
RUN npm run build:chess

# ── Production stage ─────────────────────────────────────────
FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS production

# Security: run as non-root
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

WORKDIR /app

# Copy only what's needed from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server.js ./
COPY --from=builder /app/loadConfig.js ./
COPY --from=builder /app/shared/chess.js ./shared/
COPY --from=builder /app/shared/chess.mjs ./shared/
COPY --from=builder /app/client ./client/
COPY --from=builder /app/files ./files/
COPY --from=builder /app/package.json ./

# TLS certs are mounted at runtime (not baked in)
# Volume for config (optional)
VOLUME ["/app/config"]

EXPOSE 3000

# Healthcheck is out-of-scope for the Dockerfile:
# - Port is configurable at runtime (--port)
# - TLS vs HTTP is a runtime decision
# - Certificates will never be for localhost
# Kubernetes probes handle health checking when deployed.
# For standalone Docker: docker run --health-cmd="wget -qO- http://localhost:$PORT/" ...

CMD ["node", "server.js"]
