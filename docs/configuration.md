# Configuration

mpchess uses a layered configuration system with the following priority (highest to lowest):

1. **CLI flags** — passed after `--` to `npm start`
2. **Environment variables** — prefixed with `MPCHESS_`
3. **Config file** — `config.jsonc` (JSON with comments) or `config.json`
4. **Built-in defaults**

## Config File

By default, the server looks for `config.jsonc` in the current working directory. A plain `config.json` is also accepted for backwards compatibility. Use `--config=<path>` to specify a custom location.

See [config.example.jsonc](../config.example.jsonc) for a reference.

## CLI Options

All options are passed after `--` to forward them to the Node.js process:

```bash
npm start -- --port=8080 --fen="4k3/8/8/8/8/8/8/4K2R w K - 0 1"
```

| Option                                | Env Var                                | Description                                        | Default                                      |
| ------------------------------------- | -------------------------------------- | -------------------------------------------------- | -------------------------------------------- |
| `--help`, `-h`                        | —                                      | Show usage and exit                                | —                                            |
| `--config=<path>`                     | —                                      | Config file path                                   | `config.jsonc` (falls back to `config.json`) |
| `--port=<number>`                     | `MPCHESS_PORT`                         | HTTP/WebSocket listen port                         | `3000`                                       |
| `--host=<address>`                    | `MPCHESS_HOST`                         | Listen address                                     | `0.0.0.0`                                    |
| `--fen=<fen_string>`                  | `MPCHESS_FEN`                          | Custom starting position (FEN)                     | Standard setup                               |
| `--init-halfmove-clock=<n>`           | `MPCHESS_INIT_HALFMOVE_CLOCK`          | Initial halfmove clock value (testing)             | `0`                                          |
| `--cert=<path>`                       | `MPCHESS_CERT`                         | TLS certificate file (PEM); enables HTTPS          | —                                            |
| `--key=<path>`                        | `MPCHESS_KEY`                          | TLS private key file (PEM); required with `--cert` | —                                            |
| `--chain=<path>`                      | `MPCHESS_CHAIN`                        | TLS certificate chain file (PEM)                   | —                                            |
| `--allowed-origins=<o1,o2>`           | `MPCHESS_ALLOWED_ORIGINS`              | Comma-separated allowed WebSocket origins          | `*` (accept all)                             |
| `--debug=<true\|false>`               | `MPCHESS_DEBUG`                        | Enable debug logging for piece rebuilding          | `false`                                      |
| `--prefix=<path>`                     | `MPCHESS_PREFIX`                       | URL prefix for subpath deployments (e.g. `/chess`) | —                                            |
| `--seat-timeout=<ms>`                 | `MPCHESS_SEAT_TIMEOUT`                 | Reconnect seat reservation timeout                 | `60000`                                      |
| `--join-timeout=<ms>`                 | `MPCHESS_JOIN_TIMEOUT`                 | Join handshake completion timeout                  | `5000`                                       |
| `--rate-limit-max=<n>`                | `MPCHESS_RATE_LIMIT_MAX`               | Max messages per rate-limit window                 | `60`                                         |
| `--rate-limit-window=<ms>`            | `MPCHESS_RATE_LIMIT_WINDOW`            | Rate-limit sliding window duration                 | `10000`                                      |
| `--connection-rate-limit-max=<n>`     | `MPCHESS_CONNECTION_RATE_LIMIT_MAX`    | Max connections per rate-limit window              | `5`                                          |
| `--connection-rate-limit-window=<ms>` | `MPCHESS_CONNECTION_RATE_LIMIT_WINDOW` | Connection rate-limit window duration              | `10000`                                      |
| `--slow-client-threshold=<bytes>`     | `MPCHESS_SLOW_CLIENT_THRESHOLD`        | Slow-client buffered-amount threshold              | `1048576`                                    |
| `--min-move-delay=<ms>`               | `MPCHESS_MIN_MOVE_DELAY`               | Minimum delay between moves for animation          | `500`                                        |
| `--computer-enabled=<bool>`           | `MPCHESS_COMPUTER_ENABLED`             | Enable/disable computer player                     | `true`                                       |
| `--computer-stockfish-path=<path>`    | `MPCHESS_COMPUTER_STOCKFISH_PATH`      | Path to Stockfish binary                           | Auto-resolved                                |
| `--computer-spawn-timeout=<ms>`       | `MPCHESS_COMPUTER_SPAWN_TIMEOUT`       | Max ms to wait for engine startup                  | `10000`                                      |
| `--computer-move-timeout=<ms>`        | `MPCHESS_COMPUTER_MOVE_TIMEOUT`        | Max ms to wait for a move                          | `30000`                                      |
| `--computer-skills=<json>`            | `MPCHESS_COMPUTER_SKILLS`              | JSON string overriding skill-level presets         | Built-in                                     |

### TLS Behavior

When `--cert` is given without `--key` (or vice versa), the server logs a warning and falls back to HTTP. Invalid cert/key files produce an error and also fall back to HTTP.

When TLS is enabled, open `https://localhost:<port>` instead of `http://`. The client auto-selects `wss://` for WebSocket connections.

## Computer Player Configuration

The computer player uses Stockfish with configurable skill levels. Skills are defined as presets (beginner, novice, intermediate, advanced, master, grandmaster) and can be overridden via `--computer-skills` or the `computerPlayer.skills` config key.

The `skills` option accepts a JSON object when set via config file, and a JSON string when set via env var or CLI. Overrides are merged over the built-in presets.

## Rate Limiting

Two independent rate limiters protect the server:

- **Message rate limiting**: Per-IP sliding window for WebSocket messages. Default: 60 messages per 10 seconds. Excess messages are silently dropped.
- **Connection rate limiting**: Per-IP sliding window for WebSocket connection attempts. Default: 5 connections per 10 seconds. Checked during the WebSocket handshake before upgrade.

Both are per-IP, not per-connection. Multiple connections from the same IP share a single bucket, which persists across disconnects.

## WebSocket Origin Checking

The `allowedOrigins` setting controls which browser origins are permitted to open WebSocket connections. The default value is `*` (accept all origins), which is convenient for development and local deployments.

For production deployments exposed to the public internet, narrow `allowedOrigins` to your actual domain(s):

```jsonc
"allowedOrigins": ["chess.example.com"]
```

This prevents unauthorized websites from opening WebSocket connections to your game server.

## WebSocket Payload Limit

The server enforces a 64 KB (`65536` bytes) maximum payload per WebSocket message.
