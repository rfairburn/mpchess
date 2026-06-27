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
- **193 passing tests**: chess engine, reconnection, TLS CLI (run with `npm test`)

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

| Option | Description |
|--------|-------------|
| `--help`, `-h` | Show usage and exit |
| `--port=<number>` | Override the listen port (default: 3000, or `$PORT`) |
| `--fen=<fen_string>` | Load a custom starting position (FEN format) |
| `--cert=<path>` | TLS certificate file (PEM); enables HTTPS |
| `--key=<path>` | TLS private key file (PEM); required with `--cert` |
| `--chain=<path>` | TLS certificate chain file (PEM); optional |

When TLS is enabled, open `https://localhost:<port>` instead. The client auto-selects `wss://` for WebSocket connections.

If `--cert` is given without `--key` (or vice versa), the server logs a warning and falls back to HTTP. Invalid cert/key files produce an error and also fall back to HTTP.

## Testing

```bash
npm test
```

Runs the full test suite (193 tests: 142 chess engine + 51 reconnection).

## Project Structure

```
server.js              — HTTP/HTTPS server, WebSocket handlers, game session management
shared/chess.js        — Chess engine (CommonJS for Node.js/server/tests)
shared/chess.mjs       — Auto-generated ESM build for browser (`npm run build:chess`)
client/
  app.js               — Three.js scene setup, game loop
  board.js             — Board rendering, square highlights
  pieces.js            — Piece meshes, animations, rebuild diffing
  controls.js          — Camera controls, WASD movement, click handling
  ui.js                — HUD overlays, menus, promotion picker, toasts
  network.js           — WebSocket client, reconnection, message routing
  index.html           — Entry point, importmap, UI markup
  style.css            — All UI styling
build_chess_mjs.js     — Build script: chess.js → chess.mjs (with regression checks)
test_chess.js          — Chess engine tests (142 tests)
test_reconnect.js      — Reconnection / session tests (51 tests)
files/                 — 3D piece models (STL)
```

## License

Code is licensed under MIT. See [LICENSE](LICENSE).

The 3D model files in `files/` are licensed separately under CC BY-NC-SA 4.0. See [files/LICENSE](files/LICENSE).
