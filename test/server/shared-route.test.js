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

describe('Shared route — /shared/', () => {
  const { spawn } = require('child_process');
  const http = require('http');

  function startServer(p) {
    return new Promise((resolve) => {
      const srv = spawn('node', ['server.js', '--config=/dev/null', '--port', String(p)], {
        cwd: ROOT,
        env: { ...process.env, MPCHESS_PORT: String(p) },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let attempts = 0;
      const tryConnect = () => {
        attempts++;
        http
          .get(`http://127.0.0.1:${p}/`, (res) => {
            resolve({ srv, port: p });
          })
          .on('error', () => {
            if (attempts < 20) setTimeout(tryConnect, 100);
            else resolve({ srv, port: p });
          });
      };
      setTimeout(tryConnect, 500);
    });
  }

  function httpGet(p, path) {
    return new Promise((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${p}${path}`, (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve({ status: res.statusCode, body: data }));
        })
        .on('error', reject);
    });
  }

  test('serves chess.mjs', async () => {
    const { srv, port } = await startServer(13991);
    try {
      const r = await httpGet(port, '/shared/chess.mjs');
      assert.strictEqual(r.status, 200);
      assert.ok(r.body.includes('export {'));
    } finally {
      srv.kill();
    }
  });

  test('serves i18n.mjs', async () => {
    const { srv, port } = await startServer(13992);
    try {
      const r = await httpGet(port, '/shared/i18n.mjs');
      assert.strictEqual(r.status, 200);
      assert.ok(r.body.includes('export const LOCALES'));
    } finally {
      srv.kill();
    }
  });

  test('serves locale file', async () => {
    const { srv, port } = await startServer(13993);
    try {
      const r = await httpGet(port, '/shared/locales/en-US.mjs');
      assert.strictEqual(r.status, 200);
      assert.ok(r.body.includes('export default'));
    } finally {
      srv.kill();
    }
  });

  test('blocks disallowed file (403)', async () => {
    const { srv, port } = await startServer(13994);
    try {
      const r = await httpGet(port, '/shared/stockfish_engine.js');
      assert.strictEqual(r.status, 403);
    } finally {
      srv.kill();
    }
  });

  test('blocks path traversal (403)', async () => {
    const { srv, port } = await startServer(13995);
    try {
      const r = await httpGet(port, '/shared/../../../etc/passwd');
      assert.strictEqual(r.status, 403);
    } finally {
      srv.kill();
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
