# ── Stockfish build stage ────────────────────────────────────
# Use Alpine so the resulting musl-linked binary is compatible with the
# node:alpine production image — no glibc dependency.
FROM alpine:3.21@sha256:48b0309ca019d89d40f670aa1bc06e426dc0931948452e8491e3d65087abc07d AS stockfish-builder
RUN apk add --no-cache g++ make git
ARG STOCKFISH_TAG=sf_18
ARG STOCKFISH_ARCH=x86-64
RUN git clone --depth 1 --branch ${STOCKFISH_TAG} \
    https://github.com/official-stockfish/Stockfish /tmp/stockfish
WORKDIR /tmp/stockfish/src
RUN make -j$(nproc) ARCH=${STOCKFISH_ARCH} build

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

WORKDIR /app

# Install production-only dependencies (no devDependencies)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy only what's needed from builder
COPY --from=builder /app/server.js ./
COPY --from=builder /app/server/ws-handlers.js ./server/
COPY --from=builder /app/loadConfig.js ./
COPY --from=builder /app/shared/chess.js ./shared/
COPY --from=builder /app/shared/stockfish_engine.js ./shared/
COPY --from=builder /app/shared/uci.js ./shared/
COPY --from=builder /app/client ./client/

# Copy Stockfish binary (musl-linked from Alpine builder, compatible with this image)
COPY --from=stockfish-builder /tmp/stockfish/src/stockfish /usr/local/bin/stockfish

# Security: run as non-root
RUN addgroup -S appgroup && adduser -S appuser -G appgroup && \
    chown -R appuser:appgroup /app
USER appuser

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
