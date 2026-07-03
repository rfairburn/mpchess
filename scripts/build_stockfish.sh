#!/usr/bin/env bash
set -euo pipefail

# Build Stockfish from source and place the binary at stockfish/bin/stockfish.
# Usage: bash scripts/build_stockfish.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

STOCKFISH_TAG="sf_18"
BUILD_DIR="$(mktemp -d)"
OUTPUT_DIR="$ROOT_DIR/stockfish/bin"

trap 'rm -rf "$BUILD_DIR"' EXIT

echo "=== Building Stockfish ${STOCKFISH_TAG} ==="
echo "Source: https://github.com/official-stockfish/Stockfish"
echo "Output: $OUTPUT_DIR/stockfish"
echo ""

# Check prerequisites
for cmd in git g++ make; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: '$cmd' is required but not found." >&2
    exit 1
  fi
done

# Clone the pinned tag
echo "→ Cloning Stockfish ${STOCKFISH_TAG}..."
git clone --depth 1 --branch "$STOCKFISH_TAG" \
  https://github.com/official-stockfish/Stockfish "$BUILD_DIR"

cd "$BUILD_DIR/src"

# Detect architecture and build
ARCH=""
if grep -q bmi2 /proc/cpuinfo 2>/dev/null; then
  ARCH="x86-64-bmi2"
else
  ARCH="x86-64"
fi

echo "→ Building with ARCH=${ARCH}..."
if make -j"$(nproc)" ARCH="$ARCH" build 2>/dev/null; then
  echo "✓ Build succeeded (ARCH=${ARCH})"
else
  echo "⚠ ARCH=${ARCH} failed, falling back to x86-64..."
  ARCH="x86-64"
  make -j"$(nproc)" ARCH="$ARCH" build
  echo "✓ Build succeeded (ARCH=${ARCH})"
fi

# Install the binary
mkdir -p "$OUTPUT_DIR"
cp stockfish "$OUTPUT_DIR/stockfish"
chmod +x "$OUTPUT_DIR/stockfish"

echo ""
echo "=== Stockfish installed ==="
"$OUTPUT_DIR/stockfish" bench 1 1 128 1 none none 1 1 2>/dev/null | grep -i nodes || true
echo "Path: $OUTPUT_DIR/stockfish"
