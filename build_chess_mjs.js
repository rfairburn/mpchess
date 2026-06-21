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
  'buildNotation, Game',
];

const mjs = body + '\n\n// ═══════════════════════════════════════════════════════════\n//  EXPORTS (ES Module — generated from chess.js)\n// ═══════════════════════════════════════════════════════════\n\nexport {' + exportsList.join(' ') + '};\n';

fs.writeFileSync(path.join(__dirname, 'shared', 'chess.mjs'), mjs);
console.log('Generated shared/chess.mjs');
