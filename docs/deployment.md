# Deployment Guide

This guide covers deploying mpchess on [microk8s](https://microk8s.io/) with Traefik Gateway and automatic TLS via cert-manager.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Building the Docker Image](#building-the-docker-image)
- [Developer Quality Gates](#developer-quality-gates)
- [Gateway & TLS Setup](#gateway--tls-setup)
- [Deploying with Helm](#deploying-with-helm)
- [Helm Values Reference](#helm-values-reference)
- [Ingress (Alternative)](#ingress-alternative)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Install microk8s

```bash
sudo snap install microk8s --classic

# Wait for it to be ready
microk8s status --wait-ready
```

### Enable required addons

```bash
# Core addons
microk8s enable helm3 dns hostpath-storage

# Traefik Gateway (implements the Gateway API)
microk8s enable traefik

# Automatic TLS certificates
microk8s enable cert-manager
```

Verify everything is running:

```bash
microk8s kubectl get pods -A
```

You should see pods in `traefik` and `cert-manager` namespaces.

### Configure `kubectl`

```bash
# Alias for convenience
alias kubectl='microk8s kubectl'

# Or add to ~/.bashrc
echo "alias kubectl='microk8s kubectl'" >> ~/.bashrc
```

---

## Building the Docker Image

```bash
# Build locally
docker build -t mpchess:latest .
```

The Dockerfile uses a multi-stage build based on `node:24-alpine`:

1. **Stockfish builder stage**: builds Stockfish from source (`sf_18` tag, `x86-64` arch) on Alpine Linux. Customize via `--build-arg STOCKFISH_TAG=...` and `--build-arg STOCKFISH_ARCH=...`.
2. **Builder stage**: installs dependencies, builds the shared ESM module
3. **Production stage**: copies only runtime files, runs as non-root user (`appuser`, UID 100)

A volume is declared at `/app/config` for mounting a custom config file at runtime.

### Stockfish in Docker

The Dockerfile includes a `stockfish-builder` stage that builds Stockfish from source (sf_18 tag) and copies the binary into the production image.

### Import into microk8s

microk8s uses `containerd` (ctr) instead of Docker. To avoid pulling from a registry:

```bash
# Export from Docker and import into microk8s
docker save mpchess:latest | microk8s ctr image import -

# Verify
microk8s ctr images ls | grep mpchess
```

The deployment defaults to `imagePullPolicy: IfNotPresent`, so it will use the imported image.

---

## Developer Quality Gates

The project treats linting and formatting as required quality gates. `npm test` runs the full sequence:

```bash
npm test
# 1. npm run lint          (ESLint)
# 2. npm run format:check  (Prettier)
# 3. npm run test:server   (chess, reconnect, config, stockfish)
# 4. npm run test:client   (Vitest + jsdom)
# 5. npx playwright install chromium  (browser installation — idempotent)
# 6. npx playwright test   (browser integration)
```

Standalone commands are also available:

```bash
npm run lint         # ESLint check
npm run lint:fix     # auto-fix ESLint issues where possible
npm run format       # Prettier format all tracked files
npm run format:check # Prettier check (fails on formatting violations)
npm run ci           # full CI check: build + lint + format + tests + helm
```

Run these locally before committing or building a Docker image. CI runs the same checks via `bash scripts/ci.sh`.

The CI script ensures dependencies are installed (`npm install` if `node_modules` is missing) before running any checks. It also installs Playwright Chromium unconditionally (`npx playwright install chromium`) before running browser tests. The installation is idempotent — it verifies the package-matched browser version and skips if already installed. In CI environments, use `npx playwright install --with-deps chromium` to install system dependencies as well.

---

## Gateway & TLS Setup

### Create a ClusterIssuer for Let's Encrypt

cert-manager is already enabled via `microk8s enable cert-manager`. Create a ClusterIssuer so it knows how to obtain certificates:

```bash
cat << EOF | microk8s kubectl apply -f -
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: your@email.com
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
      - http01:
          ingress:
            class: traefik
EOF
```

For testing with Let's Encrypt staging (won't get real certs, but avoids rate limits):

```bash
cat << EOF | microk8s kubectl apply -f -
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-staging
spec:
  acme:
    server: https://acme-staging-v02.api.letsencrypt.org/directory
    email: your@email.com
    privateKeySecretRef:
      name: letsencrypt-staging
    solvers:
      - http01:
          ingress:
            class: traefik
EOF
```

### How it works

The Helm chart creates a `Gateway` resource in your namespace with the annotation `cert-manager.io/cluster-issuer: letsencrypt-prod`. When you deploy:

1. cert-manager sees the annotation on the Gateway
2. It provisions a Let's Encrypt certificate via HTTP-01 challenge
3. It stores the certificate in a `Secret` (named `mpchess-tls` by default)
4. The Gateway references that Secret for TLS termination
5. The HTTPRoute routes traffic to your service

The chart also creates an HTTP-to-HTTPS redirect route, so `http://` automatically redirects to `https://`.

**No manual certificate management needed.** cert-manager renews automatically before expiry.

### Finding your gateway IP

```bash
# Get the Traefik load balancer IP or NodePort
microk8s kubectl get svc -n traefik

# The gateway is accessible at:
# http://<microk8s-node-ip>:<nodeport>
# or with DNS pointing to the node IP
```

For a real domain, point your DNS A record at the microk8s node's IP.

---

## Deploying with Helm

### Quick start (local, no TLS)

```bash
# 1. Create a namespace
microk8s kubectl create namespace mpchess

# 2. Deploy with Helm (disable gateway for direct access)
microk8s helm install mpchess ./chart \
  --namespace mpchess \
  --set gateway.type=none \
  --set image.tag=latest

# 3. Access via port-forward
microk8s kubectl port-forward -n mpchess svc/mpchess 3000:3000
# Open http://localhost:3000
```

### Production (Gateway + automatic TLS)

```bash
# 1. Create namespace
microk8s kubectl create namespace mpchess

# 2. Deploy with defaults (Gateway API + cert-manager)
microk8s helm install mpchess ./chart \
  --namespace mpchess \
  --set gateway.host=chess.example.com \
  --set server.allowedOrigins=chess.example.com

# 3. Wait for cert-manager to provision the certificate
microk8s kubectl get certificate -n mpchess
microk8s kubectl get secret mpchess-tls -n mpchess

# 4. Access at https://chess.example.com
```

### With staging certificates (testing)

```bash
microk8s helm install mpchess ./chart \
  --namespace mpchess \
  --set gateway.host=chess.example.com \
  --set gateway.issuer=letsencrypt-staging \
  --set server.allowedOrigins=chess.example.com
```

### Upgrade

```bash
microk8s helm upgrade mpchess ./chart \
  --namespace mpchess \
  --set image.tag=v1.0.1
```

### Uninstall

```bash
microk8s helm uninstall mpchess --namespace mpchess
```

---

## Helm Values Reference

| Parameter                                            | Description                                                 | Default                 |
| ---------------------------------------------------- | ----------------------------------------------------------- | ----------------------- |
| `image.repository`                                   | Image name                                                  | `mpchess`               |
| `image.tag`                                          | Image tag                                                   | `latest`                |
| `image.pullPolicy`                                   | Pull policy                                                 | `IfNotPresent`          |
| `image.pullSecrets`                                  | Registry pull secrets (list of `{name}`)                    | _(none)_                |
| `service.type`                                       | Kubernetes service type                                     | `ClusterIP`             |
| `service.port`                                       | Service port                                                | `3000`                  |
| `gateway.type`                                       | Gateway type: `httproute`, `ingress`, or `none`             | `httproute`             |
| `gateway.name`                                       | Gateway resource name                                       | `mpchess`               |
| `gateway.className`                                  | Gateway class name                                          | `traefik`               |
| `gateway.host`                                       | Hostname for the route                                      | `chess.example.com`     |
| `gateway.tlsSecretName`                              | TLS secret name                                             | `mpchess-tls`           |
| `gateway.issuer`                                     | cert-manager ClusterIssuer name                             | `letsencrypt-prod`      |
| `gateway.ingressClassName`                           | Ingress class name (when `type=ingress`)                    | `nginx`                 |
| `gateway.ingressController`                          | Controller type for rewrite annotations (`traefik`/`nginx`) | _(none)_                |
| `gateway.ingressAnnotations`                         | Additional Ingress annotations                              | _(none)_                |
| `gateway.backendTls.enabled`                         | Backend TLS to pod: `auto`/`true`/`false`                   | `auto`                  |
| `gateway.backendTls.insecureSkipVerify`              | Skip backend cert verification (testing only)               | `false`                 |
| `server.port`                                        | Server listen port                                          | `3000`                  |
| `server.host`                                        | Listen address                                              | `0.0.0.0`               |
| `server.debug`                                       | Enable debug logging                                        | `false`                 |
| `server.fen`                                         | Custom starting FEN                                         | _(none)_                |
| `server.initHalfmoveClock`                           | Initial halfmove clock (testing)                            | `0`                     |
| `server.allowedOrigins`                              | Allowed WebSocket origins                                   | _(none)_                |
| `server.prefix`                                      | URL prefix for subpath deployments                          | _(none)_                |
| `server.seatTimeout`                                 | Reconnect seat reservation timeout (ms)                     | `60000`                 |
| `server.joinTimeout`                                 | Join handshake timeout (ms)                                 | `5000`                  |
| `server.rateLimitMax`                                | Max messages per rate-limit window                          | `60`                    |
| `server.rateLimitWindow`                             | Rate-limit window duration (ms)                             | `10000`                 |
| `server.slowClientThreshold`                         | Slow-client buffered-amount threshold (bytes)               | `1048576`               |
| `server.minMoveDelay`                                | Minimum delay between moves (ms)                            | `500`                   |
| `server.computerPlayer.enabled`                      | Enable computer player (Stockfish)                          | `true`                  |
| `server.computerPlayer.stockfishPath`                | Path to Stockfish binary (empty = auto-resolve)             | _(auto)_                |
| `server.computerPlayer.spawnTimeout`                 | Engine startup timeout (ms)                                 | `10000`                 |
| `server.computerPlayer.moveTimeout`                  | Engine move timeout (ms)                                    | `30000`                 |
| `server.computerPlayer.skills`                       | JSON skill-level overrides (merged with built-in presets)   | _(built-in)_            |
| `config.enabled`                                     | Mount config.jsonc from ConfigMap                           | `false`                 |
| `config.content`                                     | JSON config content                                         | _(none)_                |
| `tls.enabled`                                        | Pod-level TLS (sets `MPCHESS_CERT`/`MPCHESS_KEY` env vars)  | `false`                 |
| `tls.secretName`                                     | TLS secret for pod certificate                              | `mpchess-tls`           |
| `tls.caConfigMap`                                    | CA ConfigMap for backend TLS verification (Gateway API)     | _(<tls.secretName>-ca)_ |
| `tls.caSecretName`                                   | CA Secret for backend TLS verification (Ingress)            | _(<tls.secretName>-ca)_ |
| `resources`                                          | Kubernetes resource limits/requests                         | see values.yaml         |
| `nodeSelector`                                       | Node selector map                                           | `{}`                    |
| `tolerations`                                        | Tolerations list                                            | `[]`                    |
| `affinity`                                           | Affinity rules                                              | `{}`                    |
| `securityContext.enabled`                            | Enable pod/container security contexts                      | `true`                  |
| `securityContext.pod.runAsNonRoot`                   | Force non-root user                                         | `true`                  |
| `securityContext.pod.runAsUser`                      | User ID                                                     | `100`                   |
| `securityContext.pod.runAsGroup`                     | Group ID                                                    | `101`                   |
| `securityContext.pod.fsGroup`                        | Filesystem group ID                                         | `101`                   |
| `securityContext.pod.seccompProfile.type`            | Seccomp profile                                             | `RuntimeDefault`        |
| `securityContext.container.allowPrivilegeEscalation` | Allow privilege escalation                                  | `false`                 |
| `securityContext.container.readOnlyRootFilesystem`   | Read-only root filesystem                                   | `true`                  |
| `securityContext.container.capabilities.drop`        | Dropped Linux capabilities                                  | `ALL`                   |

### Using a config file

```yaml
config:
  enabled: true
  content: |
    {
      "port": 3000,
      "allowedOrigins": ["chess.example.com"]
    }
```

The Dockerfile also declares a volume at `/app/config` for mounting a custom config file from the host or a PersistentVolumeClaim. When using the Helm chart with `config.enabled: true`, the config is mounted as a ConfigMap at `/app/config.json`.

### TLS Modes

The chart supports three TLS configurations:

#### 1. Edge TLS only (default, recommended)

Gateway/Ingress terminates TLS; pod serves plain HTTP.

```yaml
tls:
  enabled: false
gateway:
  tlsSecretName: mpchess-tls
```

#### 2. Pod TLS only (no gateway)

Pod serves HTTPS; no Gateway/Ingress.

```yaml
tls:
  enabled: true
gateway:
  type: none
```

Access via `kubectl port-forward` or a Service with external access.

#### 3. Full end-to-end TLS

Gateway/Ingress terminates TLS at the edge **and** connects to the pod over HTTPS.

```yaml
tls:
  enabled: true
  secretName: mpchess-tls
  # For self-signed certs, create a CA ConfigMap:
  # kubectl create configmap mpchess-tls-ca --from-file=ca.crt=tls.crt
gateway:
  tlsSecretName: mpchess-tls
  backendTls:
    enabled: auto # auto-enables when tls.enabled=true
```

When `gateway.backendTls.enabled` is `auto` (default), backend TLS is enabled automatically whenever `tls.enabled=true`. The chart renders:

- **Ingress**: controller-specific backend protocol annotations (`nginx.ingress.kubernetes.io/backend-protocol: "HTTPS"` for nginx, equivalent for Traefik)
- **HTTPRoute** (Gateway API): a `BackendTLSPolicy` resource that validates the pod's certificate using the CA from `tls.caConfigMap` (defaults to `<tls.secretName>-ca`)

For **testing with self-signed certificates and Ingress**, set `gateway.backendTls.insecureSkipVerify: true` to skip certificate verification. This is supported for `gateway.type=ingress` (Traefik and nginx) but **not for `gateway.type=httproute`** (the Gateway API has no standard mechanism for insecure backend TLS). **Not recommended for production.**

### Creating a TLS secret

```bash
# Generate a self-signed cert for testing
openssl req -x509 -newkey rsa:4096 -keyout tls.key -out tls.crt -days 365 -nodes \
  -subj "/CN=chess.example.com" -addext "subjectAltName=DNS:chess.example.com"

# Create the Kubernetes secret
kubectl create secret tls mpchess-tls --cert=tls.crt --key=tls.key -n mpchess

# For full end-to-end TLS with self-signed certs, also create a CA ConfigMap
# (for Gateway API BackendTLSPolicy) and a CA Secret (for Traefik/nginx Ingress):
kubectl create configmap mpchess-tls-ca --from-file=ca.crt=tls.crt -n mpchess
kubectl create secret generic mpchess-tls-ca --from-file=ca.crt=tls.crt -n mpchess
```

The TLS secret must contain `tls.crt` and `tls.key` keys (standard for `kubectl create secret tls`). For end-to-end TLS:

- **Gateway API** (HTTPRoute): the CA ConfigMap must contain a `ca.crt` key
- **Traefik/nginx Ingress**: the CA Secret must contain a `ca.crt` key

---

## Ingress (Alternative)

If you prefer the legacy Ingress resource over the Gateway API:

**Note on path-prefix stripping:** When deploying under a non-root `server.prefix`, set `gateway.ingressController` to `traefik` or `nginx` so the chart renders the correct rewrite annotations for your controller.

```bash
microk8s helm install mpchess ./chart \
  --namespace mpchess \
  --set gateway.type=ingress \
  --set gateway.host=chess.example.com \
  --set gateway.ingressClassName=nginx \
  --set gateway.ingressAnnotations.'cert-manager\.io/cluster-issuer'=letsencrypt-prod \
  --set server.allowedOrigins=chess.example.com
```

**Note on CLI escaping:** When passing comma-separated values like `server.allowedOrigins` or numeric annotation values via `--set`, Helm may parse them incorrectly. Use a values file or quote numeric annotation values (e.g., `"3600"`) to avoid issues.

---

## Environment Variable Reference

All server settings can be configured via environment variables (prefixed `MPCHESS_`).
The Helm chart exposes a subset as `server.*` values; the rest can be set via the
`config` ConfigMap or by adding env entries directly to the deployment.

| Env Var                                | Helm Value                            | Description                           | Default        |
| -------------------------------------- | ------------------------------------- | ------------------------------------- | -------------- |
| `MPCHESS_PORT`                         | `server.port`                         | HTTP/WebSocket listen port            | `3000`         |
| `MPCHESS_FEN`                          | `server.fen`                          | Custom starting FEN position          | standard setup |
| `MPCHESS_INIT_HALFMOVE_CLOCK`          | `server.initHalfmoveClock`            | Initial halfmove clock (testing)      | `0`            |
| `MPCHESS_ALLOWED_ORIGINS`              | `server.allowedOrigins`               | Comma-separated WebSocket origins     | _(accept all)_ |
| `MPCHESS_PREFIX`                       | `server.prefix`                       | URL prefix for subpath deployments    | _(none)_       |
| `MPCHESS_DEBUG`                        | `server.debug`                        | Enable debug logging                  | `false`        |
| `MPCHESS_HOST`                         | `server.host`                         | Listen address                        | `0.0.0.0`      |
| `MPCHESS_CONNECTION_RATE_LIMIT_MAX`    | _(not exposed)_                       | Max connections per rate-limit window | `5`            |
| `MPCHESS_CONNECTION_RATE_LIMIT_WINDOW` | _(not exposed)_                       | Connection rate-limit window (ms)     | `10000`        |
| `MPCHESS_SEAT_TIMEOUT`                 | `server.seatTimeout`                  | Reconnect seat reservation (ms)       | `60000`        |
| `MPCHESS_JOIN_TIMEOUT`                 | `server.joinTimeout`                  | Join handshake timeout (ms)           | `5000`         |
| `MPCHESS_RATE_LIMIT_MAX`               | `server.rateLimitMax`                 | Max messages per window               | `60`           |
| `MPCHESS_RATE_LIMIT_WINDOW`            | `server.rateLimitWindow`              | Rate-limit window duration (ms)       | `10000`        |
| `MPCHESS_SLOW_CLIENT_THRESHOLD`        | `server.slowClientThreshold`          | Slow-client buffer threshold (bytes)  | `1048576`      |
| `MPCHESS_MIN_MOVE_DELAY`               | `server.minMoveDelay`                 | Min delay between moves (ms)          | `500`          |
| `MPCHESS_COMPUTER_ENABLED`             | `server.computerPlayer.enabled`       | Enable computer player                | `true`         |
| `MPCHESS_COMPUTER_STOCKFISH_PATH`      | `server.computerPlayer.stockfishPath` | Path to Stockfish binary              | _(auto)_       |
| `MPCHESS_COMPUTER_SPAWN_TIMEOUT`       | `server.computerPlayer.spawnTimeout`  | Engine startup timeout (ms)           | `10000`        |
| `MPCHESS_COMPUTER_MOVE_TIMEOUT`        | `server.computerPlayer.moveTimeout`   | Engine move timeout (ms)              | `30000`        |
| `MPCHESS_COMPUTER_SKILLS`              | `server.computerPlayer.skills`        | JSON skill-level overrides            | _(built-in)_   |
| `MPCHESS_CERT`                         | _(auto, via `tls`)_                   | TLS certificate file path             | _(none)_       |
| `MPCHESS_KEY`                          | _(auto, via `tls`)_                   | TLS private key file path             | _(none)_       |
| `MPCHESS_CHAIN`                        | _(not exposed)_                       | TLS certificate chain file path       | _(none)_       |

---

## Rate Limiting

The server enforces two independent per-IP rate limiters:

### Message Rate Limiting

WebSocket messages are rate-limited to prevent abuse:

- **Default**: 60 messages per 10-second sliding window.
- **Configurable** via `rateLimitMax` and `rateLimitWindow` (see env var table above).
- Excess messages are silently dropped; the client is not disconnected.

### Connection Rate Limiting

WebSocket connection attempts are rate-limited before the handshake completes:

- **Default**: 5 connections per 10-second sliding window.
- **Configurable** via `connectionRateLimitMax` and `connectionRateLimitWindow` (see env var table above).
- Checked during the WebSocket `verifyClient` callback. Excess connection attempts are rejected.

Both limiters are per-IP, not per-connection. Multiple connections from the same IP share a single bucket, which persists across disconnects. A single abusive connection can temporarily rate-limit all other connections from the same IP (e.g., behind NAT).

For high-traffic deployments, consider increasing the limits or shortening the windows.

---

## Health Probes

The Helm chart configures liveness and readiness probes on the root path (`/`), which serves the static client files:

| Probe     | Initial Delay | Period | Scheme                           |
| --------- | ------------- | ------ | -------------------------------- |
| Liveness  | 10s           | 30s    | HTTP (or HTTPS if `tls.enabled`) |
| Readiness | 5s            | 10s    | HTTP (or HTTPS if `tls.enabled`) |

These are defined in `chart/templates/deployment.yaml` and adapt automatically to TLS mode.
Tune them by editing the template or applying a post-install patch.

**Note:** The server does not expose a dedicated health endpoint (e.g., `/health`). The probes
rely on the root path serving the static client files, which returns 200 as long as the process
is running.

---

## Scaling

**The server holds all game state in-memory. Replicas are fixed at 1.**

Multiple replicas would each run an independent game with no shared state — there is no
external database or message bus for state synchronization. If you need high availability,
consider running a single replica with a liveness probe and relying on Kubernetes to restart
the pod on failure. Active games will be lost on pod restart.

---

## Troubleshooting

### Image not found

If the deployment shows `ImagePullBackOff`, the image wasn't imported correctly:

```bash
# Check imported images
microk8s ctr images ls | grep mpchess

# Re-import
docker save mpchess:latest | microk8s ctr image import -
```

### Certificate not issued

```bash
# Check certificate status
microk8s kubectl describe certificate -n mpchess

# Check cert-manager pods
microk8s kubectl get pods -n cert-manager

# Check ClusterIssuer
microk8s kubectl describe clusterissuer letsencrypt-prod

# Check Gateway status
microk8s kubectl describe gateway -n mpchess
```

Common issues:

- DNS not pointing to the microk8s node
- Port 80 not accessible from the internet (HTTP-01 challenge requires it)
- Wrong email in ClusterIssuer

### Gateway not routing

```bash
# Check Gateway status
microk8s kubectl describe gateway -n mpchess

# Check HTTPRoute
microk8s kubectl describe httproute -n mpchess

# Check Traefik pods
microk8s kubectl get pods -n traefik

# Check Traefik logs
microk8s kubectl logs -n traefik -l app.kubernetes.io/name=traefik
```

### WebSocket connection refused

If `server.allowedOrigins` is set and your domain is not included, the server rejects
the connection with HTTP 403. Add your domain:

```bash
microk8s helm upgrade mpchess ./chart \
  --namespace mpchess \
  --set server.allowedOrigins=chess.example.com
```

### Check all resources

```bash
microk8s kubectl get all -n mpchess
microk8s kubectl get gateway -n mpchess
microk8s kubectl get httproute -n mpchess
microk8s kubectl get certificate -n mpchess
microk8s kubectl get secret mpchess-tls -n mpchess
```
