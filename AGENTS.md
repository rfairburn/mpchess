# Agent instructions

## Testing

- `npm test` is the gold-standard full CI run. It executes `scripts/ci.sh`, which attempts to build and verify everything.
- Before returning after code changes, run `npm test` unless the user explicitly asked not to run tests or the change is documentation-only and cannot affect behavior.
- If `npm test` cannot be run, fails for an environmental reason, or times out, say that clearly in the final response and include the exact command attempted.
- Do not treat focused test scripts as a substitute for the final `npm test` run. Use them only for local iteration while making changes.
- The CI script collects failures and prints one combined summary at the end. It does not stop at the first failure.
- Use focused scripts for local iteration only:
  - `npm run test:server`
  - `npm run test:client`
  - `npm run lint`
  - `npm run format:check`
  - `npm run build:chess`
- Do not change `npm test` back to a short-circuiting chain.
