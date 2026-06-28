# Deployment Guide

This guide covers deploying mpchess with Docker and Kubernetes (microk8s + Envoy Gateway).

## Table of Contents

- [Building the Docker Image](#building-the-docker-image)
- [Local Kubernetes with microk8s](#local-kubernetes-with-microk8s)
- [Envoy Gateway Setup](#envoy-gateway-setup)
- [TLS with Certbot](#tls-with-certbot)
- [Deploying with Helm](#deploying-with-helm)
- [Helm Values Reference](#helm-values-reference)

---

## Building the Docker Image

```bash
# Build locally
docker build -t mpchess:latest .

# Tag for microk8s import (optional)
docker tag mpchess:latest mpchess:$(git rev-parse --short HEAD)
```

The Dockerfile uses a multi-stage build:

1. **Builder stage**: installs dependencies, builds the shared ESM module
2. **Production stage**: copies only runtime files, runs as non-root user, includes healthcheck

### Import into microk8s

microk8s uses `containerd` (ctr) instead of Docker. To avoid pulling from a registry:

```bash
# Export from Docker
docker save mpchess:latest | gzip > mpchess-latest.tar.gz

# Import into microk8s
microk8s ctr image import mpchess-latest.tar.gz

# Verify
microk8s ctr images ls | grep mpchess
```

The deployment defaults to `imagePullPolicy: IfNotPresent`, so it will use the imported image. For production with a registry, set `image.pullPolicy: Always` in `values.yaml`.

---

## Local Kubernetes with microk8s

### Install microk8s

```bash
sudo snap install microk8s --classic

# Enable required addons
microk8s enable helm helm3 registry
microk8s enable dns
```

### Configure `kubectl`

```bash
# Alias for convenience
alias kubectl='microk8s kubectl'

# Or add to ~/.bashrc
echo "alias kubectl='microk8s kubectl'" >> ~/.bashrc
```

---

## Envoy Gateway Setup

Envoy Gateway is the modern replacement for ingress-nginx. It uses the Gateway API (CRDs) instead of the legacy Ingress resource.

### Install Envoy Gateway on microk8s

```bash
# Add the Envoy Gateway Helm repo
helm repo add envoy-gateway https://charts.envoyproxy.io
helm repo update

# Install Envoy Gateway
helm install envoy-gateway envoy-gateway/envoy-gateway \
  --namespace envoy-gateway \
  --create-namespace

# Verify
kubectl get pods -n envoy-gateway
kubectl get gatewayclass
```

### Create a Gateway

The Gateway resource tells Envoy Gateway to listen on a port and route traffic:

```yaml
# gateway.yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: envoy-gateway
  namespace: envoy-gateway
spec:
  gatewayClassName: envoy-gateway
  listeners:
    - name: http
      protocol: HTTP
      port: 80
      allowedRoutes:
        namespaces:
          from: All
    - name: https
      protocol: HTTPS
      port: 443
      allowedRoutes:
        namespaces:
          from: All
      tls:
        mode: Terminate
        certificateRefs:
          - name: mpchess-tls
            kind: Secret
```

```bash
kubectl apply -f gateway.yaml
```

### Verify the Gateway

```bash
# Check Gateway status
kubectl get gateway -n envoy-gateway

# Check the Envoy proxy pod
kubectl get pods -n envoy-gateway

# Get the external IP (for microk8s, use NodePort)
kubectl get svc -n envoy-gateway
```

For microk8s, the gateway service is typically a LoadBalancer. Get the IP:

```bash
kubectl get svc -n envoy-gateway -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}'
```

If using `NodePort`, find the port:

```bash
kubectl get svc -n envoy-gateway -o jsonpath='{.items[0].spec.ports[0].nodePort}'
```

Then access via `http://<microk8s-ip>:<nodeport>`.

---

## TLS with Certbot

For production, terminate TLS at the Envoy Gateway using a Let's Encrypt certificate.

### Option A: Certbot standalone (recommended for microk8s/local)

```bash
# Install certbot
sudo apt install certbot

# Get certificate (standalone mode — stops any web server on port 80 temporarily)
sudo certbot certonly --standalone -d chess.example.com

# Certs are stored at:
#   /etc/letsencrypt/live/chess.example.com/fullchain.pem
#   /etc/letsencrypt/live/chess.example.com/privkey.pem
```

### Create the TLS Secret

```bash
kubectl create secret tls mpchess-tls \
  --cert=/etc/letsencrypt/live/chess.example.com/fullchain.pem \
  --key=/etc/letsencrypt/live/chess.example.com/privkey.pem \
  -n envoy-gateway
```

### Option B: cert-manager (production clusters)

For automatic certificate renewal, use [cert-manager](https://cert-manager.io/):

```bash
# Install cert-manager
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.15.0/cert-manager.yaml

# Create a ClusterIssuer for Let's Encrypt
cat << 'EOF' | kubectl apply -f -
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
            class: envoy-gateway
EOF
```

Then reference the issuer in a `Certificate` resource. Note: Envoy Gateway HTTP01 challenge support depends on your version — check the [Envoy Gateway docs](https://gateway.envoyproxy.io/docs/tasks/traffic_management/_tls/).

### Auto-renewal

Certbot certificates expire in 90 days. Set up renewal:

```bash
# Test renewal
sudo certbot renew --dry-run

# Add cron job (runs twice daily, renews only if expiring)
echo "0 0,12 * * * root certbot renew --quiet --deploy-hook 'kubectl create secret tls mpchess-tls --cert=/etc/letsencrypt/live/chess.example.com/fullchain.pem --key=/etc/letsencrypt/live/chess.example.com/privkey.pem -n envoy-gateway --dry-run || kubectl create secret tls mpchess-tls --cert=/etc/letsencrypt/live/chess.example.com/fullchain.pem --key=/etc/letsencrypt/live/chess.example.com/privkey.pem -n envoy-gateway --dry-run=client || true'" | sudo tee /etc/cron.d/certbot-renew
```

Or simpler — use a systemd timer or the built-in certbot timer:

```bash
sudo systemctl enable --now certbot.timer
```

---

## Deploying with Helm

### Quick start (local microk8s)

```bash
# 1. Build and import the image
docker build -t mpchess:latest .
docker save mpchess:latest | gzip > mpchess.tar.gz
microk8s ctr image import mpchess.tar.gz

# 2. Create a namespace
kubectl create namespace mpchess

# 3. Deploy with Helm
helm install mpchess ./chart \
  --namespace mpchess \
  --set gateway.host=localhost \
  --set gateway.enabled=false \
  --set image.tag=latest

# 4. Access the game
kubectl port-forward -n mpchess svc/mpchess-mpchess 3000:3000
# Open http://localhost:3000
```

### With Envoy Gateway + TLS

```bash
# 1. Create TLS secret (from certbot or self-signed)
kubectl create secret tls mpchess-tls \
  --cert=/path/to/fullchain.pem \
  --key=/path/to/privkey.pem \
  -n envoy-gateway

# 2. Deploy
helm install mpchess ./chart \
  --namespace mpchess \
  --set gateway.enabled=true \
  --set gateway.host=chess.example.com \
  --set gateway.tlsSecretName=mpchess-tls \
  --set tls.enabled=true \
  --set server.allowedOrigins=chess.example.com

# 3. Verify
kubectl get httproute -n mpchess
kubectl get pods -n mpchess

# 4. Access at https://chess.example.com
```

### Upgrade

```bash
helm upgrade mpchess ./chart \
  --namespace mpchess \
  --set image.tag=v1.0.1
```

### Uninstall

```bash
helm uninstall mpchess --namespace mpchess
```

---

## Helm Values Reference

| Parameter                  | Description                               | Default             |
| -------------------------- | ----------------------------------------- | ------------------- |
| `replicaCount`             | Number of pods                            | `1`                 |
| `image.repository`         | Image name                                | `mpchess`           |
| `image.tag`                | Image tag                                 | `latest`            |
| `image.pullPolicy`         | Pull policy                               | `IfNotPresent`      |
| `service.type`             | Kubernetes service type                   | `ClusterIP`         |
| `service.port`             | Service port                              | `3000`              |
| `gateway.enabled`          | Create HTTPRoute for Envoy Gateway        | `true`              |
| `gateway.host`             | Hostname for the route                    | `chess.example.com` |
| `gateway.gatewayName`      | Gateway resource name                     | `envoy-gateway`     |
| `gateway.gatewayNamespace` | Gateway namespace                         | `envoy-gateway`     |
| `gateway.tlsSecretName`    | TLS secret name                           | `mpchess-tls`       |
| `server.port`              | Server listen port                        | `3000`              |
| `server.fen`               | Custom starting FEN                       | _(none)_            |
| `server.allowedOrigins`    | Allowed WebSocket origins                 | _(none)_            |
| `config.enabled`           | Mount config.json from ConfigMap          | `false`             |
| `config.content`           | JSON config content                       | _(none)_            |
| `tls.enabled`              | Mount TLS certs and pass `--cert`/`--key` | `false`             |
| `resources`                | Kubernetes resource limits/requests       | see values.yaml     |

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

### Using TLS from secret

```yaml
tls:
  enabled: true
gateway:
  tlsSecretName: mpchess-tls
```

This mounts the TLS secret at `/etc/tls/` and passes `--cert=/etc/tls/tls.crt --key=/etc/tls/tls.key` to the server. The secret must contain `tls.crt` and `tls.key` keys (standard for `kubectl create secret tls`).

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

### Gateway not routing

```bash
# Check Gateway status
kubectl describe gateway envoy-gateway -n envoy-gateway

# Check HTTPRoute
kubectl describe httproute -n mpchess

# Check Envoy proxy logs
kubectl logs -n envoy-gateway -l app=envoy-gateway
```

### TLS errors

```bash
# Verify the secret exists
kubectl get secret mpchess-tls -n envoy-gateway

# Check cert contents
kubectl get secret mpchess-tls -n envoy-gateway -o jsonpath='{.data.tls\.crt}' | base64 -d | openssl x509 -text -noout
```

### WebSocket connection refused

Make sure `server.allowedOrigins` includes your domain. Without it, the server rejects connections from unknown origins.

```bash
helm upgrade mpchess ./chart \
  --namespace mpchess \
  --set server.allowedOrigins=chess.example.com
```
