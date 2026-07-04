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

The Dockerfile uses a multi-stage build:

1. **Builder stage**: installs dependencies, builds the shared ESM module
2. **Production stage**: copies only runtime files, runs as non-root user

### Stockfish in Docker

The Dockerfile does not yet include a Stockfish build stage. For deployments that need the computer player feature, Stockfish must be built as a separate stage (see [stockfish_policy.md §8](../stockfish_policy.md) for the design). Until then, the Stockfish binary is not included in production images.

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

| Parameter                               | Description                                                | Default                 |
| --------------------------------------- | ---------------------------------------------------------- | ----------------------- |
| `image.repository`                      | Image name                                                 | `mpchess`               |
| `image.tag`                             | Image tag                                                  | `latest`                |
| `image.pullPolicy`                      | Pull policy                                                | `IfNotPresent`          |
| `service.type`                          | Kubernetes service type                                    | `ClusterIP`             |
| `service.port`                          | Service port                                               | `3000`                  |
| `gateway.type`                          | Gateway type: `httproute` or `ingress`                     | `httproute`             |
| `gateway.name`                          | Gateway resource name                                      | `mpchess`               |
| `gateway.className`                     | Gateway class name                                         | `traefik`               |
| `gateway.host`                          | Hostname for the route                                     | `chess.example.com`     |
| `gateway.tlsSecretName`                 | TLS secret name                                            | `mpchess-tls`           |
| `gateway.issuer`                        | cert-manager ClusterIssuer name                            | `letsencrypt-prod`      |
| `server.port`                           | Server listen port                                         | `3000`                  |
| `server.fen`                            | Custom starting FEN                                        | _(none)_                |
| `server.allowedOrigins`                 | Allowed WebSocket origins                                  | _(none)_                |
| `config.enabled`                        | Mount config.json from ConfigMap                           | `false`                 |
| `config.content`                        | JSON config content                                        | _(none)_                |
| `tls.enabled`                           | Pod-level TLS (sets `MPCHESS_CERT`/`MPCHESS_KEY` env vars) | `false`                 |
| `tls.secretName`                        | TLS secret for pod certificate                             | `mpchess-tls`           |
| `tls.caConfigMap`                       | CA ConfigMap for backend TLS verification                  | _(<tls.secretName>-ca)_ |
| `gateway.backendTls.enabled`            | Backend TLS to pod: `auto`/`true`/`false`                  | `auto`                  |
| `gateway.backendTls.insecureSkipVerify` | Skip backend cert verification (testing only)              | `false`                 |
| `resources`                             | Kubernetes resource limits/requests                        | see values.yaml         |

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

Make sure `server.allowedOrigins` includes your domain. Without it, the server rejects connections from unknown origins:

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
