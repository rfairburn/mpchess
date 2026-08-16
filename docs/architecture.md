# Architecture

mpchess is a multiplayer 3D chess application with a Node.js server-authority backend and a browser-based Three.js client.

## High-Level Overview

```
Browser Client (Three.js)
  │
  │ WebSocket (ws:// or wss://)
  │
Node.js Server (server.js)
  ├── shared/chess.mjs       — Chess engine (ESM, move validation, FEN, rules)
  ├── shared/uci.js          — UCI protocol transport
  ├── shared/stockfish_engine.js — Stockfish engine wrapper
  └── server/ws-handlers.js  — WebSocket game session handlers
```

## Server

### `server.js`

Entry point. Handles:

- HTTP/HTTPS static file serving (serves the `client/` directory)
- WebSocket upgrade with origin checking and connection rate limiting
- Graceful shutdown (SIGTERM/SIGINT)
- CLI argument parsing and config loading via `loadConfig.js`

### `server/ws-handlers.js`

`setupWebSocketHandlers()` — all WebSocket game logic:

- Player join/seat assignment with timeout-based reconnection
- Move and premove validation through the chess engine
- Private per-color premove storage, cancellation, reconnect restoration, and automatic execution
- Game state broadcasting to connected clients
- Computer player (Stockfish) integration
- Message rate limiting per IP
- Slow client detection (skips sending to clients with large send buffers)

### `loadConfig.js`

Config loading with priority: CLI flags > environment variables (`MPCHESS_*`) > config file (`config.jsonc` / `config.json`) > built-in defaults.

See [Configuration](configuration.md) for the full option reference.

## Shared Code

The `shared/` directory contains code used by both the server and the browser client.

| File                  | Purpose                                                                                                                                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chess.mjs`           | Chess engine: board state, move generation/validation, castling, en passant, promotion, check/checkmate/stalemate, draw rules (insufficient material, threefold repetition via Zobrist hashing, 50-move/75-move rules). ES module format. |
| `uci.js`              | `UciTransport` — bidirectional stdio driver that spawns and communicates with a Stockfish subprocess using the UCI protocol.                                                                                                              |
| `stockfish_engine.js` | Singleton wrapper around `UciTransport`. Manages engine spawn/respawn, skill-level configuration, and move execution with serialization (one move at a time).                                                                             |
| `types.js`            | JSDoc typedefs for shared interfaces (`Piece`, etc.).                                                                                                                                                                                     |

## Client

All browser-served assets live in `client/`. The server serves this directory statically.

### Core Modules

| File                 | Purpose                                                                |
| -------------------- | ---------------------------------------------------------------------- |
| `app.js`             | Three.js scene setup, camera, renderer, animation loop                 |
| `board.js`           | 3D board rendering, square highlights, coordinate labels               |
| `board_2d.js`        | Interactive 2D board overlay                                           |
| `board_diff.js`      | Pure diff algorithm for piece state synchronization                    |
| `controls.js`        | Camera controls, WASD movement, click/raycasting, pointer lock         |
| `controls_config.js` | Shared configuration to break circular dependencies                    |
| `premove.js`         | Pending premove state and persisted premove preferences                |
| `pieces.js`          | 3D STL piece model loading, mesh creation, animations, rebuild diffing |
| `network.js`         | WebSocket client, auto-reconnection, message routing, game state       |
| `ui.js`              | HUD overlays, menus, promotion picker, toasts, state sync              |
| `constants.js`       | Shared constants (skill labels)                                        |
| `capabilities.js`    | Device/browser feature detection (touch, mobile, fullscreen)           |
| `dom_ref.js`         | Validated DOM element lookups                                          |
| `event_emitter.js`   | Lightweight pub/sub event system                                       |
| `navigation.js`      | `window.location.reload()` wrapper                                     |
| `sound.js`           | Web Audio API wrapper for move sounds                                  |

### UI Components

| File                 | Purpose                                       |
| -------------------- | --------------------------------------------- |
| `ui/toast.js`        | Toast notifications                           |
| `ui/join.js`         | Join selection overlay                        |
| `ui/connection.js`   | Reconnecting/connection error overlays        |
| `ui/computer.js`     | Computer player indicator and skill selection |
| `ui/disconnected.js` | Disconnected banners, drop player             |
| `ui/help.js`         | Help overlay with tab-trap                    |

### Build

| File               | Purpose                                                                                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/chess.mjs` | Shared ES module used by both Node.js (`require()`) and browser (`import`). No build step.                                                                      |
| `shared/i18n.mjs`  | Shared ES module for translations, browser-consumed and Node-compatible. The server sends machine-readable keys rather than localizing messages. No build step. |
| `index.html`       | Entry point with importmap and UI markup                                                                                                                        |
| `style.css`        | All UI styling                                                                                                                                                  |
| `files/`           | 3D piece models (STL format), sound assets (WAV), textures (PNG)                                                                                                |

## Data Flow

1. Client connects via WebSocket to the server
2. Server assigns a seat (white or black) and sends the initial game state
3. Player makes a move via the 3D board or 2D overlay
4. Client sends the move to the server
5. Server validates the move through `shared/chess.mjs`
6. If valid, server updates game state and broadcasts to all connected clients
7. If a computer player is configured, the server requests a move from Stockfish via `shared/stockfish_engine.js`
8. Clients render the updated board state using diff-based piece rebuilding

### Premove protocol

Premoves are server-authoritative and private until execution. During the opponent's turn, a player may send one pending move; a replacement overwrites the previous value for that color. When the turn arrives, the server runs it through the same validation, move broadcast, turn-finalization, promotion, game-over, and computer-player pipeline as a live move. An illegal premove is discarded without changing the board.

| Direction       | Message                                                                         | Purpose                                                                             |
| --------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Client → server | `premove` with `fromFile`, `fromRank`, `toFile`, `toRank`, optional `promotion` | Store/replace a premove, or execute immediately if it is already the sender's turn. |
| Client → server | `premoveCancel`                                                                 | Clear the sender's pending premove.                                                 |
| Server → owner  | `premove`                                                                       | Private confirmation echo used to render confirmed state.                           |
| Server → owner  | `premoveDiscarded` with `reason`                                                | The move was illegal when execution was attempted. Client feedback is optional.     |
| Server → owner  | `premoveCleared`                                                                | Pending state was cancelled or removed by lifecycle cleanup.                        |
| Server → owner  | `state.premove`                                                                 | Private pending value (or `null`) for initial sync and reconnect restoration.       |
| Server → all    | `move` with `premove: true` and mover `color`                                   | Ordinary public move broadcast after successful premove execution.                  |

Pending values are keyed by color, retained through a temporary disconnected-seat hold, and cleared when that seat is permanently released or the game resets/terminates. Opponents and spectators never receive another player's pending coordinates. The client keeps a single shared state for the 2D and 3D renderers; deep-blue squares, a dashed independent system arrow, and destination ghosts subscribe to that state. Disabling premoves cancels a pending value, and the default-off discard-notification preference controls only the toast, not protocol behavior.

## Security

- **Server-authority**: All moves are validated server-side. The client never trusts its own move results.
- **Origin checking**: `--allowed-origins` restricts which domains can establish WebSocket connections.
- **Connection rate limiting**: Per-IP sliding window (default: 5 connections / 10s).
- **Message rate limiting**: Per-IP sliding window (default: 60 messages / 10s).
- **WebSocket payload limit**: 64 KB per message.
- **Slow client detection**: Messages are skipped for clients with buffered amounts exceeding 1 MB.
