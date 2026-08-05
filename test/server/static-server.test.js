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

describe('Static file server — requestHandler', () => {
  const { requestHandler, setPrefix, MIME, CLIENT_ROOT } = require('../../server');

  function mockReq(urlPath) {
    return { url: urlPath };
  }

  function mockRes() {
    const res = {
      statusCode: null,
      headers: null,
      body: null,
      writeHead(code, headers) {
        this.statusCode = code;
        this.headers = headers;
      },
      end(body) {
        this.body = body;
      },
    };
    return res;
  }

  // ── Root redirect ──

  test('root / serves client/index.html', () => {
    const res = mockRes();
    requestHandler(mockReq('/'), res);
    assert.strictEqual(res.statusCode, 200);
    assert.ok(
      res.body.includes('<!doctype html>') || res.body.includes('<html'),
      'should serve HTML'
    );
  });

  // ── Allowed extensions ──

  test('serves .html files', () => {
    const res = mockRes();
    requestHandler(mockReq('/client/index.html'), res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers['Content-Type'], MIME['.html']);
  });

  test('injects window.__DEV__=true in development mode', () => {
    const hadEnv = 'NODE_ENV' in process.env;
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const res = mockRes();
      requestHandler(mockReq('/client/index.html'), res);
      assert.strictEqual(res.statusCode, 200);
      assert.ok(res.body.includes('window.__DEV__=true'), 'should inject __DEV__=true');
    } finally {
      if (hadEnv) process.env.NODE_ENV = origEnv;
      else delete process.env.NODE_ENV;
    }
  });

  test('injects window.__DEV__=false in production mode', () => {
    const hadEnv = 'NODE_ENV' in process.env;
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const res = mockRes();
      requestHandler(mockReq('/client/index.html'), res);
      assert.strictEqual(res.statusCode, 200);
      assert.ok(res.body.includes('window.__DEV__=false'), 'should inject __DEV__=false');
    } finally {
      if (hadEnv) process.env.NODE_ENV = origEnv;
      else delete process.env.NODE_ENV;
    }
  });

  test('prefixed index includes base href, prefix, and dev flag', () => {
    const hadEnv = 'NODE_ENV' in process.env;
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      setPrefix('/chess');
      const res = mockRes();
      requestHandler(mockReq('/chess/'), res);
      assert.strictEqual(res.statusCode, 200);
      assert.ok(res.body.includes('<base href="/chess/client/" />'), 'should rewrite base href');
      assert.ok(res.body.includes('window.__mpchess_prefix="/chess"'), 'should inject prefix');
      assert.ok(res.body.includes('window.__DEV__=false'), 'should inject dev flag');
    } finally {
      setPrefix('');
      if (hadEnv) process.env.NODE_ENV = origEnv;
      else delete process.env.NODE_ENV;
    }
  });

  test('serves .js files', () => {
    const res = mockRes();
    requestHandler(mockReq('/client/app.js'), res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers['Content-Type'], MIME['.js']);
  });

  test('serves .mjs files via /shared/ route', () => {
    const res = mockRes();
    requestHandler(mockReq('/shared/chess.mjs'), res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers['Content-Type'], 'application/javascript');
  });

  test('serves .css files', () => {
    const res = mockRes();
    requestHandler(mockReq('/client/style.css'), res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers['Content-Type'], MIME['.css']);
  });

  test('serves .stl model files from client/files/', () => {
    const res = mockRes();
    requestHandler(mockReq('/client/files/pieces/3d/chuckamcknight/king.stl'), res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers['Content-Type'], MIME['.stl']);
  });

  // ── 3D model set integrity ──

  const EXPECTED_3D_SETS = [
    'afnafziger',
    'chuckamcknight',
    'jeu',
    'low-poly',
    'ornate',
    'samurai',
    'scrollsaw',
    'simple-classic',
  ];
  const PIECE_3D_NAMES = ['bishop', 'king', 'knight', 'pawn', 'queen', 'rook'];
  const PIECES3D_DIR = path.join(__dirname, '../../client/files/pieces/3d');

  test('3D model sets: expected sets present', () => {
    const actual = fs
      .readdirSync(PIECES3D_DIR)
      .filter((d) => fs.statSync(path.join(PIECES3D_DIR, d)).isDirectory())
      .sort();
    assert.deepStrictEqual(
      actual,
      EXPECTED_3D_SETS,
      '3D model set directories should match expected manifest'
    );
  });

  test('all 3D model sets contain valid files', () => {
    for (const set of EXPECTED_3D_SETS) {
      const dir = path.join(PIECES3D_DIR, set);
      const files = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.stl'))
        .map((f) => f.replace('.stl', ''))
        .sort();
      assert.deepStrictEqual(files, PIECE_3D_NAMES, `3D set ${set} should have all 6 piece files`);
    }
  });

  test('serves .svg piece files from client/files/', () => {
    const res = mockRes();
    requestHandler(mockReq('/client/files/pieces/2d/cburnett/wK.svg'), res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers['Content-Type'], MIME['.svg']);
  });

  test('serves .webp piece files from client/files/', () => {
    const res = mockRes();
    requestHandler(mockReq('/client/files/pieces/2d/monarchy/wK.webp'), res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers['Content-Type'], MIME['.webp']);
  });

  // ── 2D piece set integrity ──

  const PIECE_NAMES = ['wK', 'wQ', 'wR', 'wB', 'wN', 'wP', 'bK', 'bQ', 'bR', 'bB', 'bN', 'bP'];
  const EXPECTED_SETS = [
    'alpha',
    'anarcandy',
    'caliente',
    'california',
    'cardinal',
    'cburnett',
    'celtic',
    'chess7',
    'chessnut',
    'companion',
    'cooke',
    'disguised',
    'dubrovny',
    'fantasy',
    'firi',
    'fresca',
    'gioco',
    'governor',
    'horsey',
    'icpieces',
    'kiwen-suwi',
    'kosal',
    'leipzig',
    'letter',
    'maestro',
    'merida',
    'monarchy',
    'mono',
    'mpchess',
    'papercut',
    'pirouetti',
    'pixel',
    'reillycraig',
    'rhosgfx',
    'riohacha',
    'shahi-ivory-brown',
    'shapes',
    'spatial',
    'staunty',
    'tatiana',
    'totoy',
    'xkcd',
  ];
  const PIECES2D_DIR = path.join(__dirname, '../../client/files/pieces/2d');

  test('2D piece sets: expected sets present', () => {
    const actual = fs
      .readdirSync(PIECES2D_DIR)
      .filter((d) => fs.statSync(path.join(PIECES2D_DIR, d)).isDirectory())
      .sort();
    assert.deepStrictEqual(
      actual,
      EXPECTED_SETS,
      '2D piece set directories should match expected manifest'
    );
  });

  test('all 2D piece sets contain valid files', () => {
    for (const set of EXPECTED_SETS) {
      const dir = path.join(PIECES2D_DIR, set);
      const ext = set === 'monarchy' ? 'webp' : 'svg';
      const expectedFiles = PIECE_NAMES.map((n) => `${n}.${ext}`).sort();
      const actualFiles = fs.readdirSync(dir).sort();
      assert.deepStrictEqual(
        actualFiles,
        expectedFiles,
        `Set ${set} should have exactly ${expectedFiles.length} files`
      );
      for (const f of actualFiles) {
        const fp = path.join(dir, f);
        if (ext === 'svg') {
          const content = fs.readFileSync(fp, 'utf8');
          assert.ok(
            content.startsWith('<svg') || content.startsWith('<?xml'),
            `${set}/${f} should be valid SVG`
          );
        } else {
          const buf = fs.readFileSync(fp);
          assert.ok(buf.length > 100, `${set}/${f} should be a valid WebP file`);
          assert.strictEqual(
            buf.toString('ascii', 0, 4),
            'RIFF',
            `${set}/${f} should have RIFF header`
          );
          assert.strictEqual(
            buf.toString('ascii', 8, 12),
            'WEBP',
            `${set}/${f} should have WEBP header`
          );
        }
      }
    }
  });

  // ── Forbidden: outside client/ ──

  test('rejects /server.js with 403', () => {
    const res = mockRes();
    requestHandler(mockReq('/server.js'), res);
    assert.strictEqual(res.statusCode, 403);
  });

  test('rejects /package.json with 403', () => {
    const res = mockRes();
    requestHandler(mockReq('/package.json'), res);
    assert.strictEqual(res.statusCode, 403);
  });

  test('rejects /shared/chess.js with 403', () => {
    const res = mockRes();
    requestHandler(mockReq('/shared/chess.js'), res);
    assert.strictEqual(res.statusCode, 403);
  });

  test('rejects /review.md with 403', () => {
    const res = mockRes();
    requestHandler(mockReq('/review.md'), res);
    assert.strictEqual(res.statusCode, 403);
  });

  // ── Forbidden: path traversal ──

  test('rejects /client/../server.js with 403', () => {
    const res = mockRes();
    requestHandler(mockReq('/client/../server.js'), res);
    assert.strictEqual(res.statusCode, 403);
  });

  test('rejects /client/../../etc/passwd with 403', () => {
    const res = mockRes();
    requestHandler(mockReq('/client/../../etc/passwd'), res);
    assert.strictEqual(res.statusCode, 403);
  });

  test('rejects /client/..%2f..%2fserver.js with 403', () => {
    const res = mockRes();
    requestHandler(mockReq('/client/..%2f..%2fserver.js'), res);
    assert.strictEqual(res.statusCode, 403);
  });

  // ── Forbidden: disallowed extensions ──

  test('rejects .step files (not in MIME allowlist)', () => {
    const res = mockRes();
    requestHandler(mockReq('/client/files/king.step'), res);
    assert.strictEqual(res.statusCode, 403);
  });

  test('rejects .txt files', () => {
    const res = mockRes();
    requestHandler(mockReq('/client/readme.txt'), res);
    assert.strictEqual(res.statusCode, 403);
  });

  test('rejects .key files', () => {
    const res = mockRes();
    requestHandler(mockReq('/client/server.key'), res);
    assert.strictEqual(res.statusCode, 403);
  });

  test('rejects .pem files', () => {
    const res = mockRes();
    requestHandler(mockReq('/client/cert.pem'), res);
    assert.strictEqual(res.statusCode, 403);
  });

  test('rejects .md files', () => {
    const res = mockRes();
    requestHandler(mockReq('/client/notes.md'), res);
    assert.strictEqual(res.statusCode, 403);
  });

  // ── 404 for missing files ──

  test('returns 404 for non-existent .html file', () => {
    const res = mockRes();
    requestHandler(mockReq('/client/nonexistent.html'), res);
    assert.strictEqual(res.statusCode, 404);
  });

  test('returns 404 for non-existent .stl file', () => {
    const res = mockRes();
    requestHandler(mockReq('/client/files/unicorn.stl'), res);
    assert.strictEqual(res.statusCode, 404);
  });

  // ── CLIENT_ROOT is under project root ──

  test('CLIENT_ROOT resolves to client/ directory', () => {
    assert.ok(
      CLIENT_ROOT.endsWith('client'),
      `CLIENT_ROOT should end with 'client', got ${CLIENT_ROOT}`
    );
  });

  // ── MIME allowlist is exhaustive ──

  test('MIME map covers all expected extensions', () => {
    const expected = ['.html', '.js', '.mjs', '.css', '.json', '.stl', '.png', '.jpg', '.ico'];
    for (const ext of expected) {
      assert.ok(MIME[ext] !== undefined, `MIME map should include ${ext}`);
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
