# Testing

## Running Tests

```bash
npm test              # Full CI check (build + lint + format + test + helm)
npm run test:server   # Server tests only
npm run test:client   # Client tests only (Vitest + jsdom)
npm run test:report   # Tests with consolidated JSON report
npm run lint          # ESLint
npm run lint:fix      # Auto-fix ESLint issues
npm run format        # Prettier format all files
npm run format:check  # Prettier check
npm run ci            # Full CI check (same as npm test)
```

`npm test` runs `scripts/ci.sh`, which executes all checks in a single pass (does not stop at the first failure) and prints a consolidated summary at the end. It can take up to 180 seconds due to the Stockfish build step.

## CI Pipeline (`scripts/ci.sh`)

1. Install dependencies (`npm install` if `node_modules` missing)
2. Node version check (requires ≥ 20.19.0)
3. Build Stockfish from source (`scripts/build_stockfish.sh`)
4. Docker build (`docker build -t mpchess:test .`)
5. ESLint (`npm run lint`)
6. Prettier check (`npm run format:check`)
7. Helm checks (lint, template render, optional unittest)
8. All tests (`node scripts/test_orchestrator.js`)
9. Playwright browser tests (installs Chromium, then runs `npx playwright test`)

## Test Structure

### Server Tests (`test/server/`)

Run via Node.js with a custom `describe`/`test` runner and built-in `assert`.

| File                           | Coverage                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------- |
| `chess-engine.test.js`         | Chess engine: pieces, moves, check, castling, en passant, promotion, checkmate/stalemate    |
| `game-rules.test.js`           | Game rules: state management, draws, Zobrist, half-move clock, position history, repetition |
| `fen-pgn.test.js`              | FEN export/import, PGN export, FEN engine-compatibility validation                          |
| `algebraic-notation.test.js`   | Algebraic notation disambiguation                                                           |
| `static-server.test.js`        | Static file server, MIME types, security                                                    |
| `client-rebuild.test.js`       | Client-side 3D board rebuildPieces                                                          |
| `build-regression.test.js`     | Shared chess.mjs build verification                                                         |
| `shared-route.test.js`         | /shared/ HTTP endpoint                                                                      |
| `tls-cli.test.js`              | TLS CLI arguments                                                                           |
| `game-state-api.test.js`       | getState fields, castlingRights copy, addMove integrity                                     |
| `config.test.js`               | Config loading, CLI/env/file parsing, merge priority                                        |
| `reconnect.test.js`            | WebSocket sessions, reconnection, rate limiting, FEN import                                 |
| `stockfish.test.js`            | UCI transport against live Stockfish binary (skipped if unavailable)                        |
| `computer_player.test.js`      | Computer player server integration with mock engine                                         |
| `engine_serialization.test.js` | StockfishEngine serialization queue                                                         |
| `leave.test.js`                | Player leave, disconnect, seat management                                                   |
| `security.test.js`             | Max payload, IP rate limiting                                                               |
| `error_handling.test.js`       | Async error handling, graceful shutdown                                                     |
| `sound_mime.test.js`           | WAV MIME type serving                                                                       |

### Client Tests (`test/client/`)

Run via Vitest with jsdom and Three.js mocks.

| File                              | Coverage                                  |
| --------------------------------- | ----------------------------------------- |
| `board_2d.test.js`                | 2D board mode cycling                     |
| `board_2d_interaction.test.js`    | 2D board click interaction                |
| `board_2d_rendering.test.js`      | Black perspective rendering               |
| `board_diff.test.js`              | Piece state diff algorithm                |
| `board_labels.test.js`            | Coordinate labels                         |
| `controls.test.js`                | Camera, clicks, keyboard, pointer lock    |
| `controls_config.test.js`         | Controls configuration                    |
| `ui.test.js`                      | HUD overlays, menus, state sync           |
| `help.test.js`                    | Help overlay                              |
| `css_reset.test.js`               | CSS reset verification                    |
| `dom_ref.test.js`                 | DOM element lookups                       |
| `computer_player.test.js`         | Computer player network messages          |
| `computer_player_ui.test.js`      | Computer player UI rendering              |
| `network.test.js`                 | WebSocket client, reconnection, callbacks |
| `sound.test.js`                   | Sound playback                            |
| `zz_sound_initial_render.test.js` | Sound initial render timing               |
| `background.test.js`              | Background rendering                      |
| `portrait_fov.test.js`            | Portrait mode field of view               |
| `promotion_color.test.js`         | Promotion piece color                     |
| `rebuild_pieces.test.js`          | Piece rebuild diffing                     |
| `mobile_camera_buttons.test.js`   | Camera buttons in mobile mode             |
| `mobile_fullscreen.test.js`       | Fullscreen API on mobile                  |
| `mobile_joystick_toggle.test.js`  | Virtual joystick toggle                   |
| `mobile_menu.test.js`             | Mobile menu behavior                      |
| `mobile_move_log.test.js`         | Mobile move log display                   |
| `mobile_pointer_lock.test.js`     | Pointer lock on mobile                    |
| `mobile_portrait_hud.test.js`     | Portrait mode HUD layout                  |
| `mobile_sound.test.js`            | Sound on mobile                           |
| `mobile_touch_drag.test.js`       | Touch drag interaction                    |
| `mobile_virtual_joystick.test.js` | Virtual joystick controls                 |

### Browser Tests (`test/browser/`)

Run via Playwright with Chromium.

| File                       | Coverage                                                |
| -------------------------- | ------------------------------------------------------- |
| `camera-buttons.spec.js`   | Camera buttons visible in compact landscape Camera Mode |
| `background-image.spec.js` | Background image rendering                              |

### Test Helpers

| File                            | Purpose                                      |
| ------------------------------- | -------------------------------------------- |
| `client/setup.js`               | jsdom polyfills (`requestPointerLock`, etc.) |
| `client/mocks/three.js`         | Three.js mock classes                        |
| `client/mocks/font_loader.js`   | Font loader mock                             |
| `client/mocks/stl_loader.js`    | STL loader mock                              |
| `client/mocks/text_geometry.js` | Text geometry mock                           |
| `client/mobile-mocks.js`        | Mobile test mocks                            |
| `client/mobile-test-helpers.js` | Mobile test helpers                          |

## Stockfish Tests

The `stockfish.test.js` suite requires a Stockfish binary. It resolves the binary in this order:

1. `MPCHESS_STOCKFISH` environment variable
2. `stockfish/bin/stockfish` (built via `bash scripts/build_stockfish.sh`)
3. `stockfish` on `PATH`

If none are found, the Stockfish tests are skipped. To run the full suite including Stockfish tests:

```bash
bash scripts/build_stockfish.sh
npm test
```
