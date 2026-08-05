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

describe('Build regression — shared chess.mjs', () => {
  test('shared/chess.mjs exists and has no require() calls', () => {
    const mjsPath = path.join(ROOT, 'shared', 'chess.mjs');
    const mjs = fs.readFileSync(mjsPath, 'utf8');
    assert.ok(mjs.includes('export {'), 'shared/chess.mjs must use ESM exports');
    assert.ok(!mjs.includes('require('), 'shared/chess.mjs must not contain require()');
  });

  test('shared/chess.mjs exports initZobrist and getZobrist', () => {
    const mjs = fs.readFileSync(path.join(ROOT, 'shared', 'chess.mjs'), 'utf8');
    assert.ok(mjs.includes('export {'), 'has export block');
    assert.ok(mjs.includes('initZobrist'), 'exports initZobrist');
    assert.ok(mjs.includes('getZobrist'), 'exports getZobrist');
  });

  test('client/chess.mjs does not exist (deleted)', () => {
    const mjsPath = path.join(ROOT, 'client', 'chess.mjs');
    assert.ok(!fs.existsSync(mjsPath), 'client/chess.mjs should be deleted');
  });

  test('build_chess_mjs.js does not exist (deleted)', () => {
    const scriptPath = path.join(ROOT, 'build_chess_mjs.js');
    assert.ok(!fs.existsSync(scriptPath), 'build_chess_mjs.js should be deleted');
  });

  test('Zobrist is initialized via initZobrist', () => {
    assert.ok(zobrist !== null, 'zobrist should be initialized in tests');
    assert.ok(typeof zobrist.compute === 'function', 'zobrist.compute must exist');
  });

  test('_computeZobrist guards against null Zobrist', () => {
    const src = fs.readFileSync(path.join(ROOT, 'shared', 'chess.mjs'), 'utf8');
    assert.ok(src.includes('if (!z)'), '_computeZobrist must guard against null Zobrist');
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
