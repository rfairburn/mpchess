# Agent instructions

## Testing

- `npm test` is the gold-standard full CI run. It executes `scripts/ci.sh`. Run it before issuing a pull request. Individual tests work between given how expensive this is.
- `npm test` can take up to 900 seconds due to the Stockfish build step and the full Playwright test suite. Use a 900s timeout when running it.
- Always check `npm run lint` and `npm run format:check` for any code changes.
- New features must include appropriate automated tests. Add or update tests in the relevant server, client, or integration suite so the new behavior is covered.
- Before returning after code changes, run `npm test` unless the user explicitly asked not to run tests or the change is documentation-only and cannot affect behavior.
- If `npm test` cannot be run, fails for an environmental reason, or times out, say that clearly in the final response and include the exact command attempted.
- Unrelated failing tests still block acceptance. Investigate them, identify the cause, and correct them or clearly document why they are environmental before considering the change complete.
- Do not treat focused test scripts as a substitute for the final `npm test` run. Use them only for local iteration while making changes.
- The CI script collects failures and prints one combined summary at the end. It does not stop at the first failure.
- Use focused scripts for local iteration:
  - `npm run test:server`
  - `npm run test:client`
  - `npm run lint`
  - `npm run format:check`
- Do not change `npm test` back to a short-circuiting chain.

## Changelog

- Every feature, fix, or notable change must be documented in `CHANGELOG.md` under `[Unreleased]` using [Keep a Changelog](https://keepachangelog.com/) categories (Added, Changed, Deprecated, Removed, Fixed, Security).
- Add a one-line entry describing the change. Do not skip this step.
