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
CYAN='\033[0;36m'
NC='\033[0m' # No Color

PASS=0
FAIL=0
FAILURES=""

# Helm unittest test count (populated if helm-unittest runs)
HELM_TESTS=0
HELM_FAILED=0

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
  fi
  # Always return success — failures are tracked via the FAIL counter.
  # This lets the script run all checks in one pass without || true.
  return 0
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

# 1. Stockfish compile (long-running — start early)
if [ -f scripts/build_stockfish.sh ]; then
  run_check "Stockfish build" bash scripts/build_stockfish.sh
else
  echo -e "${YELLOW}→ Stockfish build skipped (scripts/build_stockfish.sh not found)${NC}"
fi

# 2. Docker image build (long-running)
if command -v docker &>/dev/null; then
  run_check "Docker build (mpchess:test)" docker build -t mpchess:test .
else
  echo -e "${YELLOW}→ Docker build skipped (docker not found)${NC}"
fi

# 3. Build shared module
run_check "Build shared module" npm run build:chess

# 4. Lint
run_check "ESLint" npm run lint

# 5. Format check
run_check "Prettier" npm run format:check

# 6. Helm chart checks
HELM_CMD=""
if command -v helm &>/dev/null; then
  HELM_CMD="helm"
elif command -v microk8s &>/dev/null && microk8s helm3 version &>/dev/null; then
  HELM_CMD="microk8s helm3"
fi

if [ -n "$HELM_CMD" ] && [ -d chart ]; then
  run_check "Helm lint" $HELM_CMD lint chart
  run_check "Helm template" $HELM_CMD template mpchess chart --set gateway.type=none

  # helm-unittest (optional — requires plugin)
  if $HELM_CMD plugin list 2>/dev/null | grep -q unittest; then
    # Capture output and exit status without triggering set -e on failure.
    if HELM_UNITTEST_OUTPUT=$($HELM_CMD unittest chart 2>&1); then
      HELM_EXIT=0
    else
      HELM_EXIT=$?
    fi
    # Parse test counts from helm-unittest output for summary display.
    # Format: "Tests:       63 passed, 63 total" (passed may come before or after failed)
    # Extract the Tests: line and scan for N passed / N failed / N errored tokens.
    # Use grep -oE (extended regex) — POSIX-compatible on Linux and macOS, unlike grep -oP (Perl).
    HELM_TESTS_LINE=$(echo "$HELM_UNITTEST_OUTPUT" | grep '^Tests:' || true)
    HELM_TESTS=$(echo "$HELM_TESTS_LINE" | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+' || echo "0")
    HELM_TESTS=${HELM_TESTS:-0}
    HELM_FAILED=$(echo "$HELM_TESTS_LINE" | grep -oE '[0-9]+ failed' | grep -oE '[0-9]+' || echo "0")
    HELM_FAILED=${HELM_FAILED:-0}
    # Treat errored tests as failures too.
    HELM_ERRORED=$(echo "$HELM_TESTS_LINE" | grep -oE '[0-9]+ errored' | grep -oE '[0-9]+' || echo "0")
    HELM_ERRORED=${HELM_ERRORED:-0}
    HELM_FAILED=$((HELM_FAILED + HELM_ERRORED))
    if [ "$HELM_EXIT" -ne 0 ]; then
      echo -e "${RED}✗ Helm unittest failed${NC}"
      FAIL=$((FAIL + 1))
      FAILURES="$FAILURES\n  - Helm unittest"
    else
      echo -e "${GREEN}✓ Helm unittest passed${NC}"
      PASS=$((PASS + 1))
    fi
  else
    echo -e "${YELLOW}→ Helm unittest skipped (plugin not installed)${NC}"
  fi

  # helm lint with TLS enabled
  run_check "Helm lint (TLS)" $HELM_CMD lint chart --set gateway.type=none --set tls.enabled=true
else
  if [ -d chart ]; then
    echo -e "${YELLOW}→ Helm checks skipped (no helm binary found)${NC}"
  fi
fi

# 7. All tests (consolidated — runs server + client suites, writes results JSON)
run_check "All tests" node scripts/test_orchestrator.js --no-summary

# ---- CI check summary (before consolidated test summary so grand total is last) ----
echo ""
echo "========================================"
if [ "$FAIL" -eq 0 ]; then
  echo -e "${GREEN}All $PASS CI checks passed.${NC}"
else
  echo -e "${RED}$FAIL of $((PASS + FAIL)) CI checks failed:${NC}$FAILURES"
fi
echo "========================================"

# ---- Consolidated grand summary (final output) ----
echo ""
echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  Consolidated Test Results${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

# Export Helm counts so the Node summary script can read them
export HELM_TESTS HELM_FAILED

# Read test results from the orchestrator's JSON output and print grand summary
if [ -f .ci-test-results.json ]; then
  node -e "
    const data = require('./.ci-test-results.json');
    const helmTests = parseInt(process.env.HELM_TESTS || '0', 10);
    const helmFailed = parseInt(process.env.HELM_FAILED || '0', 10);
    const RED = '\033[0;31m';
    const GREEN = '\033[0;32m';
    const NC = '\033[0m';
    let totalPassed = 0;
    let totalFailed = 0;
    let errorSuites = 0;
    for (const s of data.suites) {
      if (s.failed === -1) {
        console.log('  ' + RED + '✗' + NC + ' ' + s.name.padEnd(30) + 'error (results could not be parsed)');
        errorSuites++;
      } else {
        const status = s.failed > 0 ? RED + '✗' + NC : GREEN + '✓' + NC;
        console.log('  ' + status + ' ' + s.name.padEnd(30) + s.passed + ' passed, ' + s.failed + ' failed');
        totalPassed += s.passed;
        totalFailed += s.failed;
      }
    }
    if (helmTests > 0 || helmFailed > 0) {
      const status = helmFailed > 0 ? RED + '✗' + NC : GREEN + '✓' + NC;
      console.log('  ' + status + ' ' + 'helm'.padEnd(30) + helmTests + ' passed, ' + helmFailed + ' failed');
      totalPassed += helmTests;
      totalFailed += helmFailed;
    }
    console.log();
    const grandTotal = totalPassed + totalFailed;
    if (totalFailed === 0 && errorSuites === 0) {
      console.log('  ' + GREEN + 'Total: ' + totalPassed + '/' + grandTotal + ' passed, 0 failed' + NC);
    } else {
      const parts = [];
      if (totalFailed > 0) parts.push(totalFailed + ' failed');
      if (errorSuites > 0) parts.push(errorSuites + ' error');
      console.log('  ' + RED + 'Total: ' + totalPassed + '/' + grandTotal + ' passed, ' + parts.join(', ') + NC);
    }
  "
else
  echo -e "  ${RED}✗ No test results file found${NC}"
fi

echo -e "${CYAN}========================================${NC}"

# Clean up temp file
rm -f .ci-test-results.json

exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)
