# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- Added contributor guidance (`CONTRIBUTING.md`) and per-change changelog requirements (`AGENTS.md`).

### Fixed

- **WebSocket origin check**: default `allowedOrigins` is now `"*"` (accept all) instead of an empty array, which previously rejected all browser connections in production. The wildcard `*` is supported in the origin comparison logic. Narrow `allowedOrigins` to specific domains for production deployments exposed to the public internet.
- README: corrected insufficient material draw rules to match implementation (K vs K, K+B vs K, K+N vs K, K+B vs K+B same-colored bishops; K+N vs K+N is not auto-drawn).
