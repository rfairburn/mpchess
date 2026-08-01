# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- Added contributor guidance (`CONTRIBUTING.md`) and per-change changelog requirements (`AGENTS.md`).

### Fixed

- **2D board right-click square highlight**: highlight overlay now renders behind pieces so only the square background is highlighted, not the piece on top of it.
- **2D board size toggle on touch devices**: now uses `isMobileLayout()` based on `(pointer: coarse)` CSS media queries, mirroring the exact breakpoints used by the mobile/desktop render path. Hybrid-pointer devices (touch-capable with fine primary pointer) and large-screen touch devices (Steam Deck, tablets) now get the same two board sizes as desktop.
- **WebSocket origin check**: default `allowedOrigins` is now `"*"` (accept all) instead of an empty array, which previously rejected all browser connections in production. The wildcard `*` is supported in the origin comparison logic. Narrow `allowedOrigins` to specific domains for production deployments exposed to the public internet.
- README: corrected insufficient material draw rules to match implementation (K vs K, K+B vs K, K+N vs K, K+B vs K+B same-colored bishops; K+N vs K+N is not auto-drawn).
