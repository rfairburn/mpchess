# mpchess

Multiplayer 3D chess with a Node.js server-authority backend and a browser-based Three.js client.

## Features

- **Full chess rules**: castling, en passant, pawn promotion, check/checkmate/stalemate
- **Draw rules**: insufficient material (K vs K, K+B vs K, K+N vs K, K+B vs K+B same-colored bishops), threefold repetition (Zobrist hashing), 50-move rule (manual claim), 75-move rule (forced)
- **Real-time multiplayer** over WebSockets with server-authority move validation
- **3D rendered board** with low-poly piece models (Three.js)
- **Spectator mode**: watch a game in progress; take a seat if a player disconnects
- **Session management**: token-based reconnection, seat holding with countdowns, drop player
- **FEN import/export**: load custom positions via menu dialog or `--fen=` CLI; export FEN/PGN to clipboard
- **PGN export**: full game notation with tags and result
- **Computer player**: Stockfish engine with skill levels (beginner through grandmaster)
- **TLS/HTTPS support**: `--cert=` / `--key=` / `--chain=` for secure deployments
- **Config system**: CLI > env vars (`MPCHESS_*`) > config file > defaults
- **Origin checking**: `--allowed-origins=` restricts WebSocket connections
- **Rate limiting**: per-IP sliding window for both connections and messages
- **WebSocket payload limit**: 64 KB per message
- **42 test files, all passing**: chess engine, reconnection, config, UCI transport, client controls, Playwright browser tests (run with `npm test`)
- **Mobile support**: compact top bar, collapsible status drawer, responsive landscape layout, safe-area insets, Camera Mode camera buttons

## Quick Start

```bash
npm install
npm start
```

Open `http://localhost:3000` in two browser tabs to play.

## Documentation

- **[Architecture](docs/architecture.md)** — Server, client, shared code, data flow
- **[Configuration](docs/configuration.md)** — CLI options, environment variables, config file
- **[Testing](docs/testing.md)** — Test structure, how to run tests, CI pipeline
- **[Deployment](docs/deployment.md)** — Docker, microk8s, Gateway API, TLS with cert-manager
- **[Helm Chart](chart/)** — Kubernetes deployment with Gateway API HTTPRoute support

## License

Code is licensed under MIT. See [LICENSE](LICENSE).

The 3D model files in `client/files/` are licensed separately under CC BY-NC-SA 4.0. See [client/files/LICENSE](client/files/LICENSE).
