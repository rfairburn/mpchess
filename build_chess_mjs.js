// Generates shared/chess.mjs (ES module) from shared/chess.js (CommonJS source of truth)
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'shared', 'chess.js'), 'utf8');

// Strip everything from the module.exports block to end of file
const exportsIdx = src.indexOf('//  EXPORTS');
if (exportsIdx === -1) {
  console.error('ERROR: could not find EXPORTS marker in chess.js');
  process.exit(1);
}
const body = src.slice(0, exportsIdx).trimEnd();

// Append ES module exports
const exportsList = [
  'EMPTY, W_PAWN, W_KNIGHT, W_BISHOP, W_ROOK, W_QUEEN, W_KING,',
  'B_PAWN, B_KNIGHT, B_BISHOP, B_ROOK, B_QUEEN, B_KING,',
  'pieceColor, pieceType, isOwn, isEnemy,',
  'startingBoard, cloneBoard, findKing,',
  'isAttacked, isInCheck, getValidMoves, hasAnyMoves,',
  'buildNotation, Game,',
  'ZOBRIST, toFen, fromFen',
];

const mjs =
  body +
  '\n\n// ═══════════════════════════════════════════════════════════\n//  EXPORTS (ES Module — generated from chess.js)\n// ═══════════════════════════════════════════════════════════\n\nexport {' +
  exportsList.join(' ') +
  '};\n';

// Regression check: generated mjs must not contain bare `require(` calls
// (chess.js wraps `require('crypto')` in try/catch, but catch any future regressions)
const requireMatches = mjs.match(/(?<!catch\s*\{\s*\/\*\s*browser)[^/]*\brequire\s*\(/g);
if (requireMatches && requireMatches.some((m) => !m.includes('try') && !m.includes('catch'))) {
  // More precise check: look for require( not inside a try/catch block
  const lines = mjs.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // Skip lines that are the guarded try/catch pattern
    if (line.includes("try { crypto = require('crypto'); }") || line.includes('try{')) continue;
    if (line.includes('require(') && !line.startsWith('//') && !line.startsWith('*')) {
      console.error(`ERROR: bare require() found in generated chess.mjs at line ${i + 1}:`);
      console.error(`  ${line}`);
      console.error('  Browser ES modules cannot use require(). Wrap in try/catch or strip it.');
      process.exit(1);
    }
  }
}

fs.writeFileSync(path.join(__dirname, 'shared', 'chess.mjs'), mjs);
console.log('Generated shared/chess.mjs');
