#!/usr/bin/env bash
set -euo pipefail

# Interactive Stockfish UCI console — shows raw output including info/option lines.
#
# Usage:
#   bash scripts/uci_console.sh [OPTIONS]
#
# Options:
#   --stockfish=PATH   Path to Stockfish binary (default: stockfish/bin/stockfish)
#   --fen=FEN          Starting position (default: standard)
#   --skill=N          Skill level 0–20 (default: 20)
#   --threads=N        Threads (default: 1)
#   --hash=N           Hash MB (default: 16)
#   --movetime=MS      Per-move time limit in ms (default: 2000)
#   --depth=N          Depth limit (default: none)
#   --moves=N          Number of moves to play (default: 1)
#   --raw              Show all raw UCI output (default: filtered)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

exec node "$SCRIPT_DIR/uci_console.mjs" "$@"
