// ═══════════════════════════════════════════════════════════
//  TEST SUITE — Stockfish UCI transport (shared/uci.js)
//  Run:  node test/server/stockfish.test.js
//  Skips all tests if the Stockfish binary is not found.
// ═══════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const { UciTransport } = require('../../shared/uci');

// ── Resolve Stockfish binary ─────────────────────────────
// Priority: (1) MPCHESS_STOCKFISH env var  (2) built binary  (3) PATH
function findStockfish() {
  // 1. Explicit env var override (highest priority)
  const p = process.env.MPCHESS_STOCKFISH;
  if (p && fs.existsSync(p) && fs.statSync(p).isFile()) return p;

  // 2. Built binary at stockfish/bin/stockfish (relative to project root)
  const built = path.resolve(ROOT, 'stockfish', 'bin', 'stockfish');
  if (fs.existsSync(built) && fs.statSync(built).isFile()) return built;

  // 3. stockfish on PATH
  try {
    const { execSync } = require('child_process');
    const which = execSync('which stockfish 2>/dev/null || command -v stockfish 2>/dev/null', {
      encoding: 'utf8',
    }).trim();
    if (which && fs.existsSync(which)) return which;
  } catch {
    // stockfish not on PATH
  }

  return null;
}

const STOCKFISH = findStockfish();

if (!STOCKFISH) {
  console.log('\nStockfish binary not found — skipping all tests.');
  console.log('  Build it with: bash scripts/build_stockfish.sh');
  console.log('  Or install stockfish on your PATH.');
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: 0/0 passed, 0 failed (skipped)`);
  process.exit(0);
}

// ── Async test runner ────────────────────────────────────
let passed = 0;
let failed = 0;
let total = 0;

const tests = [];

function describe(label, fn) {
  const suite = { label, tests: [] };
  tests.push(suite);
  // Override test temporarily to push into this suite
  const origTest = global.test;
  global.test = (name, fn) => suite.tests.push({ name, fn });
  try {
    fn();
  } finally {
    global.test = origTest;
  }
}

async function withUci(fn) {
  const uci = new UciTransport(STOCKFISH);
  await uci.spawn();
  try {
    await fn(uci);
  } finally {
    await uci.quit().catch(() => {});
  }
}

async function run() {
  for (const suite of tests) {
    console.log(`\n${suite.label}`);
    for (const t of (suite.tests || [])) {
      total++;
      try {
        await t.fn();
        passed++;
        console.log(`  ✓ ${t.name}`);
      } catch (e) {
        failed++;
        console.log(`  ✗ ${t.name}`);
        console.log(`    ${e.message}`);
      }
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed}/${total} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

// ── Tests ────────────────────────────────────────────────

describe('UciTransport — spawn & handshake', () => {
  test('spawns and responds to uci', async () => {
    await withUci(async (uci) => {
      uci.send('uci');
      const banner = await uci.next();
      assert.ok(!banner.startsWith('id '), `banner should not start with "id ": ${banner}`);
      const name = await uci.next();
      assert.ok(name.startsWith('id name'), `expected "id name", got: ${name}`);
      const author = await uci.next();
      assert.ok(author.startsWith('id author'), `expected "id author", got: ${author}`);
      const ok = await uci.next();
      assert.strictEqual(ok, 'uciok');
    });
  });

  test('isready returns readyok', async () => {
    await withUci(async (uci) => {
      uci.send('uci');
      await uci.next(); // banner
      await uci.next(); // id name
      await uci.next(); // id author
      await uci.next(); // uciok
      uci.send('isready');
      const resp = await uci.next();
      assert.strictEqual(resp, 'readyok');
    });
  });
});

describe('UciTransport — options & moves', () => {
  test('setoption + position + go returns bestmove', async () => {
    await withUci(async (uci) => {
      uci.send('uci');
      await uci.next(); await uci.next(); await uci.next(); await uci.next();
      uci.send('isready');
      await uci.next();

      uci.send('setoption name Skill Level value 0');
      uci.send('setoption name Threads value 1');
      uci.send('setoption name Hash value 16');

      uci.send('position startpos');
      uci.send('go movetime 500');
      const bm = await uci.next(6000);
      assert.ok(bm.startsWith('bestmove'), `expected "bestmove", got: ${bm}`);
    });
  });

  test('FEN position + go depth returns bestmove', async () => {
    await withUci(async (uci) => {
      uci.send('uci');
      await uci.next(); await uci.next(); await uci.next(); await uci.next();
      uci.send('isready');
      await uci.next();

      const fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
      uci.send(`position fen ${fen}`);
      uci.send('go depth 10');
      const bm = await uci.next(6000);
      assert.ok(bm.startsWith('bestmove'), `expected "bestmove", got: ${bm}`);
    });
  });

  test('changing skill level mid-session works', async () => {
    await withUci(async (uci) => {
      uci.send('uci');
      await uci.next(); await uci.next(); await uci.next(); await uci.next();
      uci.send('isready');
      await uci.next();

      uci.send('setoption name Skill Level value 0');
      uci.send('position startpos');
      uci.send('go movetime 500');
      const bm1 = await uci.next(6000);
      assert.ok(bm1.startsWith('bestmove'), `beginner bestmove`);

      uci.send('setoption name Skill Level value 20');
      uci.send('setoption name Threads value 2');
      uci.send('setoption name Hash value 256');
      uci.send('position startpos');
      uci.send('go movetime 1000');
      const bm2 = await uci.next(6000);
      assert.ok(bm2.startsWith('bestmove'), `grandmaster bestmove`);
    });
  });
});

describe('UciTransport — line parsing', () => {
  test('filters option lines during uci handshake', async () => {
    await withUci(async (uci) => {
      uci.send('uci');
      await uci.next(); // banner
      await uci.next(); // id name
      await uci.next(); // id author
      const resp = await uci.next();
      assert.strictEqual(resp, 'uciok', 'option lines should be filtered');
    });
  });

  test('filters info lines during search', async () => {
    await withUci(async (uci) => {
      uci.send('uci');
      await uci.next(); await uci.next(); await uci.next(); await uci.next();
      uci.send('isready');
      await uci.next();
      uci.send('position startpos');
      uci.send('go depth 5');
      const resp = await uci.next(6000);
      assert.ok(resp.startsWith('bestmove'), 'info lines should be filtered');
    });
  });
});

describe('UciTransport — readUntil', () => {
  test('readUntil finds bestmove after go', async () => {
    await withUci(async (uci) => {
      uci.send('uci');
      await uci.next(); await uci.next(); await uci.next(); await uci.next();
      uci.send('isready');
      await uci.next();
      uci.send('position startpos');
      uci.send('go depth 5');
      const line = await uci.readUntil('bestmove', 10000);
      assert.ok(line.startsWith('bestmove'), `readUntil found bestmove: ${line}`);
    });
  });
});

describe('UciTransport — quit', () => {
  test('quit exits cleanly', async () => {
    await withUci(async (uci) => {
      uci.send('uci');
      await uci.next(); await uci.next(); await uci.next(); await uci.next();
      // quit is called by withUci in the finally block
    });
  });
});

// ── Run ──────────────────────────────────────────────────
run().catch((err) => {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});
