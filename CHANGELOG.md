# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- Added Settings menu (accessible from the main menu) with mouse sensitivity slider, virtual joystick toggle, and dropdown selectors for 2D piece set and 3D model set. Selections persist in `localStorage` and apply in-place without a page reload.
- Replaced Unicode 2D board pieces and captured-piece indicators with configurable SVG assets, defaulting to the `mpchess` set. Controlled via `getSvgPieceSet()`/`setSvgPieceSet()` in `client/pieces.js`.
- Added contributor guidance (`CONTRIBUTING.md`) and per-change changelog requirements (`AGENTS.md`).
- Added all 42 2D piece sets from Lichess (`client/files/pieces/2d/`) with consolidated license attribution in `client/files/LICENSE`.
- Reorganized 3D models into `client/files/pieces/3d/chuckamcknight/`.
- Added `jeu`, `low-poly`, `simple-classic`, and `afnafziger` 3D model sets (`client/files/pieces/3d/`) with CC0/public domain license, and made the 3D model set selectable via `getModelSet()`/`setModelSet()` in `client/pieces.js`. Default is `simple-classic`.
- Added `samurai` 3D model set (`client/files/pieces/3d/samurai/`) converted from FBX source ("Samurai chess" by 3DWorkbench, CC BY 4.0), decimated to ~712 KB total.
- Added `ornate` 3D model set (`client/files/pieces/3d/ornate/`) extracted from GLB source ("Ornate Golden Chess Pieces" by iGauravRajput, CC BY 4.0), decimated to ~450 KB total.

### Changed

- Reduced 3D model file sizes for `afnafziger`, `simple-classic`, and `jeu` sets via mesh decimation (quadric edge collapse), bringing each set from 3–16 MB down to ~892 KB (3,000 triangles per piece). Total 3D folder reduced from 24 MB to 2 MB.
- Improved captured-piece visibility on desktop and mobile with a light-square-colored inner background.

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
