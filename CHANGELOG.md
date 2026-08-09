# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- Added comprehensive full-browser Playwright E2E coverage spanning join, moves, game-over, camera controls, and mobile flows.
- Added shared localization framework (`shared/i18n.mjs`, `shared/locales/*.mjs`). All ~150 user-facing strings are resolved via `t(key, params?)` lookups. The server sends machine-readable keys (e.g., `game.checkmate_white`, `error.not_your_turn`) instead of display strings, keeping it locale-agnostic. Static HTML strings use `data-i18n`/`data-i18n-aria-label`/`data-i18n-placeholder` attributes resolved on page load and live refresh.
- Added 4 new locales (Español, Français, Deutsch, 简体中文) with full translations verified against FIDE chess terminology sources. Language selector in Settings overlay with `localStorage` persistence and live UI refresh via `refreshI18n()` — no page reload required.
- Added Settings menu (accessible from the main menu) with mouse sensitivity slider, virtual joystick toggle, and dropdown selectors for 2D piece set and 3D model set. Selections persist in `localStorage` and apply in-place without a page reload.
- Added contributor guidance (`CONTRIBUTING.md`) and per-change changelog requirements (`AGENTS.md`).
- Added all 42 2D piece sets from Lichess (`client/files/pieces/2d/`) with consolidated license attribution in `client/files/LICENSE`.
- Added `jeu`, `low-poly`, `simple-classic`, and `afnafziger` 3D model sets (`client/files/pieces/3d/`) with CC0/public domain license, and made the 3D model set selectable via `getModelSet()`/`setModelSet()` in `client/pieces.js`. Default is `simple-classic`.
- Added `samurai` 3D model set (`client/files/pieces/3d/samurai/`) converted from FBX source ("Samurai chess" by 3DWorkbench, CC BY 4.0), decimated to ~712 KB total.
- Added `ornate` 3D model set (`client/files/pieces/3d/ornate/`) extracted from GLB source ("Ornate Golden Chess Pieces" by iGauravRajput, CC BY 4.0), decimated to ~986 KB total.
- Added `scrollsaw` 3D model set (`client/files/pieces/3d/scrollsaw/`) converted from FBX source ("ScrollSaw Chess Set" by trinityscsp, CC BY 4.0), topology-preserved, oriented Y-up, and reduced to ~976 KB total.

### Changed

- **Deduplicated client/server code**: `shared/chess.js` → `shared/chess.mjs` (single ES module used by both Node.js and browser, no build step). Deleted `build_chess_mjs.js`, `client/chess.mjs`, `client/i18n.js`, `shared/i18n.js`. Added `/shared/` HTTP route with whitelist for serving `.mjs` files to the browser. Zobrist uses lazy singleton pattern (`initZobrist`/`getZobrist`) instead of eager initialization.
- Replaced Unicode 2D board pieces and captured-piece indicators with configurable SVG assets, defaulting to the `mpchess` set. Controlled via `getSvgPieceSet()`/`setSvgPieceSet()` in `client/pieces.js`.
- Reorganized 3D models into `client/files/pieces/3d/chuckamcknight/`.
- Reduced 3D model file sizes for `afnafziger`, `simple-classic`, and `jeu` sets via mesh decimation (quadric edge collapse), bringing each set from 3–16 MB down to ~892 KB (3,000 triangles per piece). Total 3D folder reduced from 24 MB to 2 MB.
- Improved captured-piece visibility on desktop and mobile with a light-square-colored inner background.
- Consolidated duplicated server WebSocket mocks (`MockWebSocket` / `MockWebSocketServer`) into `test/server/test-helpers.js`.
- Extracted duplicated `isActuallyVisible()` from `client/ui.js` and `client/ui/help.js` into shared `client/ui/focus-utils.js`.
- Extracted duplicated `COLORS` + modifier-priority logic from `client/arrows.js` and `client/highlights.js` into shared `client/annotation-colors.js`.
- Extracted shared 2D/3D selection-highlight orchestration into `client/highlight-orchestration.js`, eliminating ~12 duplicated clear/select/highlight sequences across `client/controls.js` and `client/board_2d.js`.
- Consolidated FEN and PGN clipboard export fallback handling into a shared `copyOrDownload()` helper in `client/network.js`.
- Extracted `sendToServer(msg)` helper in `client/network.js`, eliminating 14 duplicated `ws.readyState === 1` guards across all 15 `send*` functions.
- Extracted `parseUciMove(uci)` helper in `server/ws-handlers.js`, eliminating duplicated UCI coordinate parsing (magic number `97` replaced with `'a'.charCodeAt(0)`).
- Consolidated duplicated rate limiter logic from `server.js` and `server/ws-handlers.js` into shared `server/rate-limiter.js` (`createRateLimiter` factory).
- Removed redundant `isFiftyMoveRule()` alias from `shared/chess.mjs` (identical to `canClaimDrawByFiftyMoves()`). Updated tests to use the canonical name.
- Split `test/server/chess.test.js` (3,540 lines) into 10 focused test files by domain (`chess-engine`, `game-rules`, `fen-pgn`, `algebraic-notation`, `static-server`, `client-rebuild`, `build-regression`, `shared-route`, `tls-cli`, `game-state-api`).

### Fixed

- **Move log scrollbar on desktop**: `#move-log` now has `pointer-events: auto` so the scrollbar is interactive.
- **3D model orientation**: all STL files pre-rotated upright so the loader no longer applies runtime rotation. Pawn pieces use a smaller target footprint (0.55) than other pieces (0.7) for better proportional sizing.
- **3D model scaling**: pieces are now centered and scaled from their bottom base geometry (bottom 5% of height) rather than the whole-model bounding box, ensuring consistent base sizes across all model sets even when upper geometry (wings, swords) extends beyond the base.
- **2D board right-click square highlight**: highlight overlay now renders behind pieces so only the square background is highlighted, not the piece on top of it.
- **2D board size toggle on touch devices**: now uses `isMobileLayout()` based on `(pointer: coarse)` CSS media queries, mirroring the exact breakpoints used by the mobile/desktop render path. Hybrid-pointer devices (touch-capable with fine primary pointer) and large-screen touch devices (Steam Deck, tablets) now get the same two board sizes as desktop.
- **WebSocket origin check**: default `allowedOrigins` is now `"*"` (accept all) instead of an empty array, which previously rejected all browser connections in production. The wildcard `*` is supported in the origin comparison logic. Narrow `allowedOrigins` to specific domains for production deployments exposed to the public internet.
- README: corrected insufficient material draw rules to match implementation (K vs K, K+B vs K, K+N vs K, K+B vs K+B same-colored bishops; K+N vs K+N is not auto-drawn).
- Documented provenance and licensing for bundled `background.png` and `pickup.wav` assets in `client/files/LICENSE`; removed references to non-existent `.step` files.
- **Arrow annotations**: arrows and square highlights are now fully independent — drawing an arrow no longer removes highlights at its endpoints, and placing a highlight no longer removes incident arrows. Arrows are removed only by retracing the same path with the same color; highlights are removed only by re-highlighting the same square with the same color.
