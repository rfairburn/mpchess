// ═══════════════════════════════════════════════════════════
//  TEST SUITE — chess engine + security fixes
//  Run:  npm test
// ═══════════════════════════════════════════════════════════

const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..'); // project root

const {
  EMPTY,
  W_PAWN,
  W_KNIGHT,
  W_BISHOP,
  W_ROOK,
  W_QUEEN,
  W_KING,
  B_PAWN,
  B_KNIGHT,
  B_BISHOP,
  B_ROOK,
  B_QUEEN,
  B_KING,
  pieceColor,
  pieceType,
  isOwn,
  isEnemy,
  startingBoard,
  cloneBoard,
  findKing,
  isAttacked,
  isInCheck,
  getValidMoves,
  hasAnyMoves,
  isInsufficientMaterial,
  Game,
  Zobrist,
  MAX_POSITION_HISTORY,
  toFen,
  fromFen,
  validateFenForEngine,
  initZobrist,
  getZobrist,
} = require('../../shared/chess.mjs');

const { randomBytes } = require('node:crypto');
const fs = require('fs');

// Initialize Zobrist for tests
initZobrist(randomBytes);
const zobrist = getZobrist();

// ── Test runner — buffered output, prints in declaration order ──
let passed = 0;
let failed = 0;
let total = 0;
const pendingPromises = [];
const results = []; // { label | null, name, ok, err }

function test(name, fn) {
  total++;
  const idx = results.length;
  results.push({ label: null, name, ok: null, err: null });
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      pendingPromises.push(
        result.then(
          () => {
            passed++;
            results[idx].ok = true;
          },
          (e) => {
            failed++;
            results[idx].ok = false;
            results[idx].err = e.message;
          }
        )
      );
    } else {
      passed++;
      results[idx].ok = true;
    }
  } catch (e) {
    failed++;
    results[idx].ok = false;
    results[idx].err = e.message;
  }
}

function describe(label, fn) {
  results.push({ label, name: null, ok: null, err: null });
  fn();
}

// ── Helper: create a fresh game with mock ws objects ─────
function makeGame() {
  const g = new Game();
  const ws1 = { _id: 'p1' };
  const ws2 = { _id: 'p2' };
  g.addPlayer(ws1); // white
  g.addPlayer(ws2); // black
  return { game: g, white: ws1, black: ws2 };
}

describe('TLS CLI arguments', () => {
  const { execSync, spawn } = require('child_process');
  const serverPath = path.join(ROOT, 'server.js');

  // Each test gets a unique port to avoid EADDRINUSE / TIME_WAIT conflicts
  let portCounter = 49000;

  // Track all child processes so we can kill them on exit
  const childProcesses = [];
  const killAllChildren = () => {
    for (const child of childProcesses) {
      try {
        child.kill('SIGKILL');
      } catch {}
    }
    childProcesses.length = 0;
  };
  process.on('exit', killAllChildren);
  process.on('SIGINT', killAllChildren);
  process.on('SIGTERM', killAllChildren);
  function nextPort() {
    return ++portCounter;
  }

  function runServer(args, timeout) {
    const t = timeout || 3000;
    let port = nextPort();

    // Use spawn so we can explicitly kill the child after capturing output.
    // execSync with a timeout leaves the process in an undefined state,
    // causing EADDRINUSE on subsequent test runs.
    const child = spawn(
      'node',
      [serverPath, '--config=/dev/null', ...args.split(/\s+/).filter(Boolean)],
      {
        env: { ...process.env, MPCHESS_PORT: String(port) },
        timeout: t,
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    childProcesses.push(child);
    child.on('close', () => {
      const idx = childProcesses.indexOf(child);
      if (idx >= 0) childProcesses.splice(idx, 1);
    });

    let stdout = '';
    let stderr = '';

    // Wait for the startup banner (or TLS warning/fallback) then kill immediately
    return new Promise((resolve) => {
      let killed = false;
      let resolved = false;
      const resolveOnce = (result) => {
        if (!resolved) {
          resolved = true;
          resolve(result);
        }
      };
      const tryKill = () => {
        if (!killed) {
          killed = true;
          try {
            child.kill('SIGTERM');
          } catch {}
        }
      };
      const handleStdout = (data) => {
        stdout += data.toString();
        if (stdout.includes('Chess server running on')) tryKill();
      };
      const handleStderr = (data) => {
        stderr += data.toString();
        // Do NOT kill on TLS warnings/fallbacks — the banner with (http)/(https)
        // is printed asynchronously in the listen callback; let handleStdout kill.
        // If the port was already in use, the child crashes with EADDRINUSE.
        // Resolve immediately so the test can report the error.
        if (stderr.includes('EADDRINUSE')) {
          tryKill();
        }
      };
      child.stdout.on('data', handleStdout);
      child.stderr.on('data', handleStderr);

      // Safety net: kill after timeout regardless
      const safety = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {}
        resolveOnce({ stdout, stderr, port });
      }, t);

      child.on('close', () => {
        clearTimeout(safety);
        resolveOnce({ stdout, stderr, port });
      });
      child.on('error', () => {
        clearTimeout(safety);
        resolveOnce({ stdout, stderr, port });
      });
    });
  }

  test('--help mentions TLS options', () => {
    const { execSync: exec } = require('child_process');
    const result = exec(`node "${serverPath}" --help`, { encoding: 'utf8', timeout: 5000 });
    assert.ok(result.includes('--cert='), 'help should mention --cert');
    assert.ok(result.includes('--key='), 'help should mention --key');
    assert.ok(result.includes('--chain='), 'help should mention --chain');
  });

  test('no TLS args — starts in HTTP mode', async () => {
    const result = await runServer('', 3000);
    const output = result.stdout + result.stderr;
    assert.ok(output.includes('(http)'), 'should indicate HTTP mode');
    assert.ok(output.includes(`http://localhost:${result.port}`), 'should show http:// URL');
  });

  test('--cert without --key — warns and falls back to HTTP', async () => {
    const result = await runServer('--cert=/tmp/nonexistent.crt', 3000);
    const output = result.stdout + result.stderr;
    assert.ok(output.includes('both --cert and --key'), 'should warn about missing --key');
    assert.ok(output.includes('(http)'), 'should fall back to HTTP');
  });

  test('--key without --cert — warns and falls back to HTTP', async () => {
    const result = await runServer('--key=/tmp/nonexistent.key', 3000);
    const output = result.stdout + result.stderr;
    assert.ok(output.includes('both --cert and --key'), 'should warn about missing --cert');
    assert.ok(output.includes('(http)'), 'should fall back to HTTP');
  });

  test('--cert + --key with nonexistent files — error logged, falls back to HTTP', async () => {
    const result = await runServer('--cert=/tmp/no_such_cert.crt --key=/tmp/no_such_key.key', 3000);
    const output = result.stdout + result.stderr;
    assert.ok(output.includes('TLS error'), 'should log TLS error');
    assert.ok(output.includes('Falling back to HTTP'), 'should log fallback');
    assert.ok(output.includes('(http)'), 'should run in HTTP mode');
  });

  test('--cert + --key with valid self-signed cert — starts HTTPS', async () => {
    const { execSync: exec } = require('child_process');
    const certPath = '/tmp/mpchess_test.crt';
    const keyPath = '/tmp/mpchess_test.key';
    try {
      exec(
        `openssl req -x509 -newkey rsa:2048 -keyout ${keyPath} -out ${certPath} -days 1 -nodes -subj '/CN=localhost' 2>/dev/null`
      );

      const result = await runServer(`--cert=${certPath} --key=${keyPath}`, 3000);
      const output = result.stdout + result.stderr;
      assert.ok(output.includes('(https)'), 'should indicate HTTPS mode');
      assert.ok(output.includes(`https://localhost:${result.port}`), 'should show https:// URL');
    } finally {
      try {
        fs.unlinkSync(certPath);
      } catch {}
      try {
        fs.unlinkSync(keyPath);
      } catch {}
    }
  });

  test('--cert + --key + --chain with valid files — starts HTTPS', async () => {
    const { execSync: exec } = require('child_process');
    const certPath = '/tmp/mpchess_test2.crt';
    const keyPath = '/tmp/mpchess_test2.key';
    const chainPath = '/tmp/mpchess_test2.chain.pem';
    try {
      exec(
        `openssl req -x509 -newkey rsa:2048 -keyout ${keyPath} -out ${certPath} -days 1 -nodes -subj '/CN=localhost' 2>/dev/null`
      );
      // Use the cert itself as the chain (valid PEM)
      fs.copyFileSync(certPath, chainPath);

      const result = await runServer(
        `--cert=${certPath} --key=${keyPath} --chain=${chainPath}`,
        3000
      );
      const output = result.stdout + result.stderr;
      assert.ok(output.includes('(https)'), 'should indicate HTTPS mode');
    } finally {
      try {
        fs.unlinkSync(certPath);
      } catch {}
      try {
        fs.unlinkSync(keyPath);
      } catch {}
      try {
        fs.unlinkSync(chainPath);
      } catch {}
    }
  });
});

async function printResults() {
  if (pendingPromises.length > 0) {
    await Promise.all(pendingPromises);
  }
  for (const r of results) {
    if (r.label) {
      console.log(`\n${r.label}`);
    } else {
      if (r.ok) {
        console.log(`  ✓ ${r.name}`);
      } else {
        console.log(`  ✗ ${r.name}`);
        console.log(`    ${r.err}`);
      }
    }
  }
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed}/${total} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}
printResults();
