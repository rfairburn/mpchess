#!/usr/bin/env node

// Test orchestrator — runs all test suites, writes results to a JSON file.
// The CI script reads this file to print the consolidated grand summary.
//
// Usage: node scripts/test_orchestrator.js [--server] [--client] [--output FILE]
//   --server  run server tests (default: yes)
//   --client  run client tests (default: yes)
//   --output  path to write JSON results (default: .ci-test-results.json)

const { execSync } = require('child_process');
const { writeFileSync } = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const SERVER_TESTS = [
  'test/server/chess.test.js',
  'test/server/reconnect.test.js',
  'test/server/config.test.js',
  'test/server/stockfish.test.js',
  'test/server/leave.test.js',
  'test/server/engine_serialization.test.js',
  'test/server/computer_player.test.js',
];

const RED = '\033[0;31m';
const GREEN = '\033[0;32m';
const YELLOW = '\033[1;33m';
const CYAN = '\033[0;36m';
const NC = '\033[0m';

const args = process.argv.slice(2);
const hasSuiteSelector = args.includes('--server') || args.includes('--client');
const runServer = !hasSuiteSelector || args.includes('--server');
const runClient = !hasSuiteSelector || args.includes('--client');
const noSummary = args.includes('--no-summary');
const outputArg = args.indexOf('--output');
const outputFile =
  outputArg >= 0 && args[outputArg + 1]
    ? args[outputArg + 1]
    : path.join(ROOT, '.ci-test-results.json');

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;
function stripAnsi(str) {
  return str.replace(ANSI_RE, '');
}

function parseServerResults(output) {
  // Match "Results: 192/192 passed, 0 failed"
  const clean = stripAnsi(output);
  const m = clean.match(/Results:\s*(\d+)\/\d+\s+passed,\s*(\d+)\s+failed/);
  if (m) return { passed: parseInt(m[1], 10), failed: parseInt(m[2], 10) };
  return null;
}

function parseClientResults(output) {
  // Vitest summary formats (may appear on stdout or stderr, with or without ANSI):
  //   Success: "Tests  75 passed (75)"
  //   Failure (failed first): "Tests  1 failed | 74 passed (75)"
  //   Failure (passed first): "Tests  74 passed | 1 failed (75)"
  //
  // Strategy: find all "N passed" / "N failed" tokens in the output and
  // extract the counts regardless of ordering.
  const clean = stripAnsi(output);
  let passed = 0;
  let failed = 0;
  let found = false;
  // Match "N passed" or "N failed" anywhere (after stripping ANSI)
  const tokenRe = /(\d+)\s+(passed|failed)/g;
  let m;
  while ((m = tokenRe.exec(clean)) !== null) {
    const n = parseInt(m[1], 10);
    if (m[2] === 'passed') passed = n;
    else if (m[2] === 'failed') failed = n;
    found = true;
  }
  if (found) return { passed, failed };
  return null;
}

const results = { suites: [], helm: null };
let anyError = false;

function recordSuite(label, result) {
  if (result) {
    results.suites.push({ name: label, passed: result.passed, failed: result.failed });
    if (result.failed > 0) {
      console.log(`    ${RED}✗ ${result.failed} failed${NC}`);
      anyError = true;
    } else {
      console.log(`    ${GREEN}✓ ${result.passed} passed${NC}`);
    }
  } else {
    results.suites.push({ name: label, passed: 0, failed: -1 });
    console.log(`    ${RED}✗ error (could not parse results)${NC}`);
    anyError = true;
  }
}

if (runServer) {
  console.log(`${CYAN}========================================${NC}`);
  console.log(`${CYAN}  Server Tests${NC}`);
  console.log(`${CYAN}========================================${NC}`);
  console.log();

  for (const file of SERVER_TESTS) {
    const label = file.replace('test/server/', '').replace('.test.js', '');
    process.stdout.write(`  ${YELLOW}→ ${label}${NC}\n`);
    try {
      const output = execSync(`node ${path.join(ROOT, file)}`, {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['inherit', 'pipe', 'inherit'],
      });
      recordSuite(label, parseServerResults(output));
    } catch (err) {
      const output = err.stdout ? err.stdout.toString() : '';
      const result = parseServerResults(output);
      if (result) {
        recordSuite(label, result);
      } else {
        console.log(`    ${RED}✗ test runner error (exit ${err.status})${NC}`);
        results.suites.push({ name: label, passed: 0, failed: -1 });
        anyError = true;
      }
    }
    console.log();
  }
}

if (runClient) {
  console.log(`${CYAN}========================================${NC}`);
  console.log(`${CYAN}  Client Tests${NC}`);
  console.log(`${CYAN}========================================${NC}`);
  console.log();

  process.stdout.write(`  ${YELLOW}→ vitest${NC}\n`);
  try {
    const output = execSync('npx vitest run 2>&1', {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    process.stdout.write(output);
    recordSuite('client', parseClientResults(output));
  } catch (err) {
    const stdout = err.stdout ? err.stdout.toString() : '';
    const stderr = err.stderr ? err.stderr.toString() : '';
    const output = stdout + stderr;
    process.stdout.write(output);
    const result = parseClientResults(output);
    if (result) {
      recordSuite('client', result);
    } else {
      console.log(`    ${RED}✗ vitest error (exit ${err.status})${NC}`);
      results.suites.push({ name: 'client', passed: 0, failed: -1 });
      anyError = true;
    }
  }
  console.log();
}

// Write results JSON for the CI script to read and print the grand summary.
writeFileSync(outputFile, JSON.stringify(results, null, 2));

// Print summary for standalone use (CI script prints its own at the end).
if (!noSummary) {
  console.log(`${CYAN}========================================${NC}`);
  console.log(`${CYAN}  Consolidated Test Results${NC}`);
  console.log(`${CYAN}========================================${NC}`);
  console.log();
  let totalPassed = 0;
  let totalFailed = 0;
  let errorSuites = 0;
  for (const s of results.suites) {
    if (s.failed === -1) {
      console.log(`  ${RED}✗${NC} ${s.name.padEnd(30)} error (results could not be parsed)`);
      errorSuites++;
    } else {
      const status = s.failed > 0 ? `${RED}✗${NC}` : `${GREEN}✓${NC}`;
      console.log(`  ${status} ${s.name.padEnd(30)} ${s.passed} passed, ${s.failed} failed`);
      totalPassed += s.passed;
      totalFailed += s.failed;
    }
  }
  console.log();
  const grandTotal = totalPassed + totalFailed;
  if (totalFailed === 0 && errorSuites === 0) {
    console.log(`  ${GREEN}Total: ${totalPassed}/${grandTotal} passed, 0 failed${NC}`);
  } else {
    const parts = [];
    if (totalFailed > 0) parts.push(`${totalFailed} failed`);
    if (errorSuites > 0) parts.push(`${errorSuites} error`);
    console.log(`  ${RED}Total: ${totalPassed}/${grandTotal} passed, ${parts.join(', ')}${NC}`);
  }
  console.log(`${CYAN}========================================${NC}`);
}

process.exit(anyError ? 1 : 0);
