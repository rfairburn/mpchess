# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- Replaced Unicode 2D board pieces and captured-piece indicators with configurable SVG assets, defaulting to the `mpchess` set. Controlled via `getSvgPieceSet()`/`setSvgPieceSet()` in `client/pieces.js`.
- Added contributor guidance (`CONTRIBUTING.md`) and per-change changelog requirements (`AGENTS.md`).
- Added all 42 2D piece sets from Lichess (`client/files/pieces/2d/`) with consolidated license attribution in `client/files/LICENSE`.
- Reorganized 3D models into `client/files/pieces/3d/chuckamcknight/`.
- Added `jeu`, `low-poly`, `simple-classic`, and `afnafziger` 3D model sets (`client/files/pieces/3d/`) with CC0/public domain license, and made the 3D model set selectable via `getModelSet()`/`setModelSet()` in `client/pieces.js`. Default is `simple-classic`.

### Changed

- Improved captured-piece visibility on desktop and mobile with a light-square-colored inner background.

### Fixed

- **3D model orientation**: all STL files pre-rotated upright so the loader no longer applies runtime rotation. Pawn pieces use a smaller target footprint (0.55) than other pieces (0.7) for better proportional sizing.
- **2D board right-click square highlight**: highlight overlay now renders behind pieces so only the square background is highlighted, not the piece on top of it.
- **2D board size toggle on touch devices**: now uses `isMobileLayout()` based on `(pointer: coarse)` CSS media queries, mirroring the exact breakpoints used by the mobile/desktop render path. Hybrid-pointer devices (touch-capable with fine primary pointer) and large-screen touch devices (Steam Deck, tablets) now get the same two board sizes as desktop.
- **WebSocket origin check**: default `allowedOrigins` is now `"*"` (accept all) instead of an empty array, which previously rejected all browser connections in production. The wildcard `*` is supported in the origin comparison logic. Narrow `allowedOrigins` to specific domains for production deployments exposed to the public internet.
- README: corrected insufficient material draw rules to match implementation (K vs K, K+B vs K, K+N vs K, K+B vs K+B same-colored bishops; K+N vs K+N is not auto-drawn).
- Documented provenance and licensing for bundled `background.png` and `pickup.wav` assets in `client/files/LICENSE`; removed references to non-existent `.step` files.
