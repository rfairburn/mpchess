# mpchess

Multiplayer 3D chess with a Node.js server-authority backend and a browser-based Three.js client.

## Features

- **Full chess rules**: castling, en passant, pawn promotion, check/checkmate/stalemate
- **Draw rules**: insufficient material, threefold repetition (Zobrist hashing), 50-move rule
- **Real-time multiplayer** over WebSockets with server-authority move validation
- **3D rendered board** with low-poly piece models (Three.js)
- **Session management**: token-based reconnection, seat holding with countdowns, drop player
- **FEN import/export**: load custom positions via menu dialog or `--fen=` CLI; export FEN/PGN to clipboard
- **PGN export**: full game notation with tags and result
- **TLS/HTTPS support**: `--cert=` / `--key=` / `--chain=` for secure deployments
- **Config system**: CLI > env vars (`MPCHESS_*`) > config file > defaults
- **Origin checking**: `--allowed-origins=` restricts WebSocket connections
- **Rate limiting**: per-connection sliding window (60 msg/10s default)
- **300+ passing tests**: chess engine, reconnection, config, UCI transport, client controls (run with `npm test`)

## Usage

```bash
npm install
npm start
```

Open `http://localhost:3000` in two browser tabs to play.

### CLI Options

Pass options after `--` to forward them to the server:

```bash
# Run on a custom port
npm start -- --port=8080

# Load a custom starting position
npm start -- --fen="4k3/8/8/8/8/8/8/4K2R w K - 0 1"

# Enable TLS/HTTPS
npm start -- --cert=server.crt --key=server.key

# With certificate chain
npm start -- --cert=server.crt --key=server.key --chain=chain.pem

# Combine options
npm start -- --port=8443 --cert=server.crt --key=server.key
```

| Option                      | Description                                          |
| --------------------------- | ---------------------------------------------------- |
| `--help`, `-h`              | Show usage and exit                                  |
| `--config=<path>`           | Config file path (default: `config.json` in cwd)     |
| `--port=<number>`           | Override the listen port (default: 3000, or `$PORT`) |
| `--fen=<fen_string>`        | Load a custom starting position (FEN format)         |
| `--cert=<path>`             | TLS certificate file (PEM); enables HTTPS            |
| `--key=<path>`              | TLS private key file (PEM); required with `--cert`   |
| `--chain=<path>`            | TLS certificate chain file (PEM); optional           |
| `--allowed-origins=<o1,o2>` | Comma-separated list of allowed WebSocket origins    |

All options can also be set via environment variables (`MPCHESS_PORT`, `MPCHESS_FEN`, etc.) or a `config.json` file. See [config.example.json](config.example.json) for reference. Config priority: CLI > env vars > config file > defaults.

When TLS is enabled, open `https://localhost:<port>` instead. The client auto-selects `wss://` for WebSocket connections.

If `--cert` is given without `--key` (or vice versa), the server logs a warning and falls back to HTTP. Invalid cert/key files produce an error and also fall back to HTTP.

## Testing & Linting

```bash
npm test             # lint + format check + server tests + client tests
npm run test:server  # server tests (chess, reconnect, config, stockfish)
npm run test:client  # client tests (controls, network)
npm run test:all     # same as npm test
npm run lint         # ESLint
npm run lint:fix     # auto-fix ESLint issues
npm run format       # Prettier format all files
npm run format:check # Prettier check (also included in npm test)
npm run ci           # full CI check (build + lint + format + test + helm)
```

### Test Structure

```
test/
├── client/
│   ├── controls.test.js      — Vitest + jsdom; camera, clicks, keyboard, pointer lock
│   ├── network.test.js       — Vitest + jsdom; WebSocket client, reconnection, callbacks
│   ├── mocks/three.js        — Three.js mock classes for unit tests
│   └── setup.js              — jsdom polyfills (requestPointerLock, etc.)
└── server/
    ├── chess.test.js         — Chess engine, moves, castling, promotion, FEN, security
    ├── reconnect.test.js     — WebSocket sessions, reconnection, rate limiting
    ├── config.test.js        — Config loading, CLI/env/file parsing, merge priority
    └── stockfish.test.js     — UCI transport against live Stockfish binary (skipped if unavailable)
```

Server tests use a minimal custom `describe`/`test` runner with Node's built-in `assert`. Client tests use Vitest with jsdom and a Three.js mock.

### Stockfish Tests

The `stockfish.test.js` suite requires a Stockfish binary. It resolves the binary in this order:

1. `MPCHESS_STOCKFISH` environment variable (explicit override)
2. `stockfish/bin/stockfish` (built via `bash scripts/build_stockfish.sh`)
3. `stockfish` on `PATH`

If none are found, the Stockfish tests are skipped and the rest of the suite runs normally. To run the full suite including Stockfish tests, build the binary first:

```bash
bash scripts/build_stockfish.sh
npm test
```

## Project Structure

```
server.js              — HTTP/HTTPS server, WebSocket handlers, game session management
loadConfig.js          — Config loading (CLI > env > file > defaults)
shared/chess.js        — Chess engine (CommonJS for Node.js/server/tests)
client/                — All browser-served assets (static server serves only this dir)
  chess.mjs            — Auto-generated ESM build for browser (`npm run build:chess`)
  app.js               — Three.js scene setup, game loop
  board.js             — Board rendering, square highlights
  pieces.js            — Piece meshes, animations, rebuild diffing
  controls.js          — Camera controls, WASD movement, click handling
  ui.js                — HUD overlays, menus, promotion picker, toasts
  network.js           — WebSocket client, reconnection, message routing
  index.html           — Entry point, importmap, UI markup
  style.css            — All UI styling
  files/               — 3D piece models (STL)
build_chess_mjs.js     — Build script: chess.js → client/chess.mjs (with regression checks)
test/                  — All tests (see Testing section)
chart/                 — Helm chart for Kubernetes deployment
docs/                  — Deployment guides
scripts/               — CI and utility scripts
Dockerfile             — Multi-stage Docker build
.dockerignore          — Excludes secrets, dev files from Docker build context
```

## Deployment

- **[Deployment Guide](docs/deployment.md)** — Docker, microk8s, Gateway API, TLS with cert-manager
- **[Helm Chart](chart/)** — Kubernetes deployment with Gateway API HTTPRoute support

## License

Code is licensed under MIT. See [LICENSE](LICENSE).

The 3D model files in `client/files/` are licensed separately under CC BY-NC-SA 4.0. See [client/files/LICENSE](client/files/LICENSE).
