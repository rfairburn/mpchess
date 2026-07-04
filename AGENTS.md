# Agent instructions

## Testing

- `npm test` is the gold-standard full CI run. It executes `scripts/ci.sh`. Always run it for full acceptance before considering a change complete.  If the full suite has not been run, the change will be rejected.
- Always check `npm run lint` and `npm run format:check` for any code changes.
- New features must include appropriate automated tests. Add or update tests in the relevant server, client, or integration suite so the new behavior is covered.
- Before returning after code changes, run `npm test` unless the user explicitly asked not to run tests or the change is documentation-only and cannot affect behavior.
- If `npm test` cannot be run, fails for an environmental reason, or times out, say that clearly in the final response and include the exact command attempted.
- Unrelated failing tests still block acceptance. Investigate them, identify the cause, and correct them or clearly document why they are environmental before considering the change complete.
- Do not treat focused test scripts as a substitute for the final `npm test` run. Use them only for local iteration while making changes.
- The CI script collects failures and prints one combined summary at the end. It does not stop at the first failure.
- Use focused scripts for local iteration only:
  - `npm run test:server`
  - `npm run test:client`
  - `npm run lint`
  - `npm run format:check`
  - `npm run build:chess`
- Do not change `npm test` back to a short-circuiting chain.
