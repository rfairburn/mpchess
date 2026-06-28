#!/usr/bin/env bash
set -euo pipefail

# CI script — runs all checks locally (same steps as CI pipeline)
# Usage: bash scripts/ci.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PASS=0
FAIL=0
FAILURES=""

run_check() {
  local name="$1"
  shift
  echo -e "${YELLOW}→ $name${NC}"
  if "$@"; then
    echo -e "${GREEN}✓ $name passed${NC}"
    PASS=$((PASS + 1))
  else
    echo -e "${RED}✗ $name failed${NC}"
    FAIL=$((FAIL + 1))
    FAILURES="$FAILURES\n  - $name"
    return 1
  fi
}

echo "========================================"
echo "  mpchess CI"
echo "========================================"
echo ""

# Check Node version
NODE_VERSION=$(node --version | cut -d'v' -f2)
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d'.' -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo -e "${RED}✗ Node.js >= 18 required (found $NODE_VERSION)${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Node.js $NODE_VERSION${NC}"
PASS=$((PASS + 1))

echo ""

# 1. Build shared module
run_check "Build shared module" npm run build:chess || true

# 2. Lint
run_check "ESLint" npm run lint || true

# 3. Format check
run_check "Prettier" npm run format:check || true

# 4. Server tests
run_check "Server tests" npm run test:server || true

# 5. Client tests
run_check "Client tests" npm run test:client || true

# 6. Helm chart checks
HELM_CMD=""
if command -v helm &>/dev/null; then
  HELM_CMD="helm"
elif command -v microk8s &>/dev/null && microk8s helm3 version &>/dev/null; then
  HELM_CMD="microk8s helm3"
fi

if [ -n "$HELM_CMD" ] && [ -d chart ]; then
  run_check "Helm lint" $HELM_CMD lint chart || true
  run_check "Helm template" $HELM_CMD template mpchess chart --set gateway.type=none || true

  # helm-unittest (optional — requires plugin)
  if $HELM_CMD plugin list 2>/dev/null | grep -q unittest; then
    run_check "Helm unittest" $HELM_CMD unittest chart || true
  else
    echo -e "${YELLOW}→ Helm unittest skipped (plugin not installed)${NC}"
  fi

  # helm lint with TLS enabled
  run_check "Helm lint (TLS)" $HELM_CMD lint chart --set gateway.type=none --set tls.enabled=true || true
else
  if [ -d chart ]; then
    echo -e "${YELLOW}→ Helm checks skipped (no helm binary found)${NC}"
  fi
fi

echo ""
echo "========================================"
if [ "$FAIL" -eq 0 ]; then
  echo -e "${GREEN}All $PASS checks passed.${NC}"
  echo "========================================"
  exit 0
else
  echo -e "${RED}$FAIL of $((PASS + FAIL)) checks failed:${NC}$FAILURES"
  echo "========================================"
  exit 1
fi
