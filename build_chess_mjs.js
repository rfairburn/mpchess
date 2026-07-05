// ═══════════════════════════════════════════════════════════
//  build_chess_mjs.js — generates client/chess.mjs (ES module)
//  from shared/chess.js (CommonJS source of truth)
// ═══════════════════════════════════════════════════════════
//
//  DESIGN RATIONALE — why the export list is derived, not hand-written
//  ─────────────────────────────────────────────────────────────
//  shared/chess.js is CommonJS and exports ~30 symbols via
//  module.exports.  The browser build (chess.mjs) is an ES module
//  consumed only by client/*.js.  Not every server-side export is
//  needed in the browser — some are server-only utilities, some
//  pull in Node-only dependencies, and exporting them unnecessarily
//  bloats the client bundle and widens the attack/debug surface.
//
//  Previous versions of this script maintained a hand-written
//  exportsList array that drifted from module.exports whenever a
//  new symbol was added to chess.js but not to the array (or vice
//  versa).  The boundary between "what chess.js exports" and "what
//  the client needs" was implicit and unverified.
//
//  This script instead derives the ES-module export list by scanning
//  client/*.js for `import { … } from './chess.mjs'` statements.
//  The set of names the client actually imports IS the browser
//  boundary — nothing more, nothing less.  This means:
//
//    • Adding a new export to chess.js does NOT automatically expose
//      it to the browser.  A developer must explicitly import it
//      from a client module, which is the correct, intentional act.
//
//    • Adding a new import in a client module automatically includes
//      it in the next build — no second list to forget.
//
//    • Importing a symbol that does not exist in chess.js's
//      module.exports is a build-time error, not a runtime
//      undefined-export bug.
//
//  A companion test (see "Build regression — chess.mjs export
//  boundary" in test/server/chess.test.js) independently verifies
//  that the generated chess.mjs exports exactly match the union of
//  all client imports, so the two cannot silently drift.
//
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const CHESS_SRC = path.join(ROOT, 'shared', 'chess.js');
const CLIENT_DIR = path.join(ROOT, 'client');
const MJS_OUT = path.join(CLIENT_DIR, 'chess.mjs');

// ── 1. Read the CommonJS source ──────────────────────────────

const src = fs.readFileSync(CHESS_SRC, 'utf8');

// ── 2. Parse module.exports names from chess.js ──────────────
//    We extract the { … } block of `module.exports = { … }`
//    and collect every identifier, skipping comments and the
//    `module.exports =` prefix itself.  This gives us the
//    authoritative list of symbols that exist in the source.

function parseCommonJsExports(source) {
  const match = source.match(/module\.exports\s*=\s*\{([\s\S]*)\}/);
  if (!match) {
    throw new Error('Could not find module.exports block in shared/chess.js');
  }
  const body = match[1];
  // Strip line comments and block comments
  const cleaned = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  // Each export entry is either `name,` or `name: alias,` or `name }`
  // We only need the key (the exported local name).
  const names = [];
  for (const line of cleaned.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    // Match `identifier` or `identifier,` or `identifier:` (shorthand or keyed)
    const idMatch = trimmed.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\s*[:,]?/);
    if (idMatch) {
      names.push(idMatch[1]);
    }
  }
  return names;
}

const cjsExports = parseCommonJsExports(src);
const cjsExportSet = new Set(cjsExports);

// ── 3. Scan client/*.js for imports from './chess.mjs' ───────
//    This is the browser boundary: the union of every symbol the
//    client actually imports.  We parse `import { a, b } from
//    './chess.mjs'` statements (including multi-line) across all
//    non-test client source files.

function parseClientImports(clientDir) {
  const files = fs
    .readdirSync(clientDir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.join(clientDir, f));

  const imported = new Set();

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    // Match `import { … } from './chess.mjs'` (single or multi-line)
    const importRegex = /import\s*\{([^}]*)\}\s*from\s*['"]\.\/chess\.mjs['"]/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      const names = match[1]
        .split(',')
        .map((s) => s.trim())
        // Strip `as alias` — we export the original name, not the alias
        .map((s) => s.split(/\s+as\s+/)[0].trim())
        .filter((s) => s.length > 0);
      for (const name of names) {
        imported.add(name);
      }
    }
  }

  return [...imported].sort();
}

const clientImports = parseClientImports(CLIENT_DIR);

if (clientImports.length === 0) {
  console.error('ERROR: no client imports from ./chess.mjs found in client/*.js');
  console.error(
    '       The browser build would export nothing — check that client modules still import from chess.mjs.'
  );
  process.exit(1);
}

// ── 4. Verify every client import exists in module.exports ──
//    This catches the case where a client module imports a symbol
//    that chess.js does not actually export.

const missing = clientImports.filter((name) => !cjsExportSet.has(name));
if (missing.length > 0) {
  console.error('ERROR: client imports symbols not exported by shared/chess.js:');
  for (const name of missing) {
    console.error(`  ${name}`);
  }
  console.error('       Add them to module.exports in shared/chess.js or remove the import.');
  process.exit(1);
}

// ── 5. Slice the body (everything before the EXPORTS marker) ─

const MARKER = '//  EXPORTS';
const markerIdx = src.indexOf(MARKER);
if (markerIdx === -1) {
  console.error(`ERROR: could not find EXPORTS marker ("${MARKER}") in chess.js`);
  process.exit(1);
}
const body = src.slice(0, markerIdx).trimEnd();

// ── 6. Generate the ES module ───────────────────────────────

const exportNames = clientImports.join(', ');

const mjs =
  body +
  '\n\n// ═══════════════════════════════════════════════════════════\n' +
  '//  EXPORTS (ES Module — generated by build_chess_mjs.js)\n' +
  '//  The export list below is derived from `import { … } from\n' +
  "//  './chess.mjs'` statements in client/*.js.  It is NOT a copy\n" +
  '//  of module.exports — only symbols the browser actually needs\n' +
  '//  are exposed.  See build_chess_mjs.js header for rationale.\n' +
  '// ═══════════════════════════════════════════════════════════\n\n' +
  `export { ${exportNames} };\n`;

// ── 7. Regression check: no bare require() calls ───────────
//    chess.js wraps `require('crypto')` in try/catch so it degrades
//    gracefully in the browser.  This check catches any future
//    require() that is NOT guarded, which would crash the ES module.

const lines = mjs.split('\n');
for (let i = 0; i < lines.length; i++) {
  const line = lines[i].trim();
  if (line.startsWith('//') || line.startsWith('*')) continue;
  if (!line.includes('require(')) continue;
  // Allow the guarded try/catch pattern
  if (line.includes('try') && line.includes('require(')) continue;
  // Check preceding lines for a try block (multi-line try/catch)
  let insideTry = false;
  for (let j = Math.max(0, i - 3); j < i; j++) {
    if (lines[j].trim().includes('try')) {
      insideTry = true;
      break;
    }
  }
  if (!insideTry) {
    console.error(`ERROR: bare require() found in generated chess.mjs at line ${i + 1}:`);
    console.error(`  ${line}`);
    console.error('  Browser ES modules cannot use require(). Wrap in try/catch or strip it.');
    process.exit(1);
  }
}

// ── 8. Write the output ──────────────────────────────────────

fs.writeFileSync(MJS_OUT, mjs);

console.log(`Generated ${path.relative(ROOT, MJS_OUT)}`);
console.log(`  Client imports: ${clientImports.join(', ')}`);
console.log(`  Total exports:  ${clientImports.length}`);
console.log(
  `  chess.js CJS exports: ${cjsExports.length} (only ${clientImports.length} exposed to browser)`
);
