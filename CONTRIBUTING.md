# Contributing to mpchess

## Setup

```bash
git clone https://github.com/rfairburn/mpchess.git
cd mpchess
npm install
```

Node.js ≥ 20.19.0 is required. Use `nvm use` to select the version in `.nvmrc`.

## Development Workflow

1. Make your changes.
2. Run the focused checks for local iteration:
   ```bash
   npm run lint
   npm run format:check
   npm run test:server   # or test:client
   ```
3. Run the full CI suite before committing:
   ```bash
   npm test
   ```
   This runs `scripts/ci.sh` (build, lint, format, all tests, Docker build, Helm checks, Playwright). It can take up to 180 seconds.
4. Update `CHANGELOG.md` under `[Unreleased]` with a one-line entry describing the change.
5. Commit and push.

## Coding Conventions

- **Formatting**: Prettier (`.prettierrc`). Run `npm run format` to auto-format.
- **Linting**: ESLint (`eslint.config.js`). Run `npm run lint:fix` to auto-fix.
- **Style**: Semicolons required, 2-space indent, single quotes. Follow the existing codebase.
- **JSDoc**: Type definitions live in `shared/types.js`. Update them when changing interfaces.
- **No comments unless necessary**: The code should be self-documenting.

## Adding Tests

New features must include automated tests. Place them in the appropriate directory:

- **Server tests** (`test/server/`): Custom test runner using Node.js built-in `assert`.
- **Client tests** (`test/client/`): Vitest with jsdom and Three.js mocks.
- **Browser tests** (`test/browser/`): Playwright with Chromium.
- **Shared tests** (`test/shared/`): Tests for shared modules.

See [docs/testing.md](docs/testing.md) for the full test structure.

## Changelog

Every feature, fix, or notable change should be documented in `CHANGELOG.md` under `[Unreleased]` using [Keep a Changelog](https://keepachangelog.com/) categories:

- **Added** — new features
- **Changed** — changes in existing functionality
- **Deprecated** — soon-to-be removed
- **Removed** — now removed
- **Fixed** — bug fixes
- **Security** — vulnerability fixes

Example:

```markdown
## [Unreleased]

### Added

- Right-click annotation replace/remove behavior for arrows and highlights.

### Fixed

- README: corrected insufficient material draw rules.
```

## Documentation

- [Architecture](docs/architecture.md) — Server, client, shared code, data flow
- [Configuration](docs/configuration.md) — CLI options, env vars, config file
- [Testing](docs/testing.md) — Test structure, how to run tests, CI pipeline
- [Deployment](docs/deployment.md) — Docker, microk8s, Gateway API, TLS
