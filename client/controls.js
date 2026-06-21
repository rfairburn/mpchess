// ═══════════════════════════════════════════════════════════
//  CONTROLS — keyboard, mouse, raycasting, click handling, move validation
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import {
  myRole, serverBoard, serverTurn, serverPromotingPiece, serverGameOver,
  castlingRights, enPassantTarget, sendMove, onRestart
} from './network.js';
import { menuOpen, showMenu, hideMenu, updateMouseModeDisplay, hidePromotionPicker, hideConcedeConfirm, mouseSensitivity } from './ui.js';
import { squares, clearHighlights, highlightSelected, highlightValidMoves, highlightCheck } from './board.js';

// Piece constants (duplicated from server — will be de-duplicated later)
const W_PAWN = 1, W_KNIGHT = 2, W_BISHOP = 3, W_ROOK = 4, W_QUEEN = 5, W_KING = 6;
const B_PAWN = 7, B_KNIGHT = 8, B_BISHOP = 9, B_ROOK = 10, B_QUEEN = 11, B_KING = 12;

function pieceColor(p) { if (p === 0) return null; return p >= 7 ? 'black' : 'white'; }
function pieceType(p) {
  if (p === 0) return null;
  const t = p >= 7 ? p - 7 : p - 1;
  return ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'][t] || null;
}
function isOwn(p, color) { return pieceColor(p) === color; }
function isEnemy(p, color) { return p !== 0 && pieceColor(p) !== color; }

// ── Camera state ─────────────────────────────────────────

export const keys = {};
export let yaw = 0, pitch = 0;
const euler = new THREE.Euler(0, 0, 0, 'YXZ');

export let mouseLookOn = true;
let _renderer = null;
let _camera = null;
let _hud = null;

export function setRenderer(renderer, camera) {
  _renderer = renderer;
  _camera = camera;
  _hud = document.getElementById('hud');

  // Init yaw/pitch from camera quaternion
  euler.setFromQuaternion(camera.quaternion);
  yaw = euler.y;
  pitch = euler.x;
}

// ── Mouse movement ───────────────────────────────────────

document.addEventListener('mousemove', e => {
  if (!mouseLookOn) return;
  if (!_renderer) return;
  if (document.pointerLockElement !== _renderer.domElement) return;
  yaw -= e.movementX * mouseSensitivity;
  pitch -= e.movementY * mouseSensitivity;
  pitch = Math.max(-Math.PI / 2.1, Math.min(Math.PI / 2.1, pitch));
});

// ── Keyboard ─────────────────────────────────────────────

document.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'Escape') {
    if (menuOpen) { hideMenu(); }
    else { showMenu(); }
    return;
  }
  if (e.code === 'Tab') {
    e.preventDefault();
    mouseLookOn = !mouseLookOn;
    updateMouseModeDisplay(mouseLookOn);
    if (mouseLookOn) {
      _renderer?.domElement?.requestPointerLock();
    } else {
      if (document.pointerLockElement) document.exitPointerLock();
    }
    return;
  }
});

document.addEventListener('keyup', e => { keys[e.code] = false; });

document.addEventListener('pointerlockchange', () => {
  if (!_renderer) return;
  const locked = document.pointerLockElement === _renderer.domElement;
  _hud?.classList.toggle('hidden', locked);
  if (!locked && mouseLookOn) {
    mouseLookOn = false;
    updateMouseModeDisplay(mouseLookOn);
  }
});

// ── Raycasting ───────────────────────────────────────────

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
export let selectedSquare = null;
export let validMoves = [];

function getBoardSquareFromRay(event) {
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, _camera);
  const allSquares = [];
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) allSquares.push(squares[r][f]);
  const hits = raycaster.intersectObjects(allSquares);
  if (hits.length > 0) {
    const hit = hits[0];
    const x = hit.point.x + 3.5;
    const z = 3.5 - hit.point.z;
    const file = Math.round(x);
    const rank = Math.round(z);
    if (file >= 0 && file < 8 && rank >= 0 && rank < 8) return { file, rank };
  }
  return null;
}

// ── Client-side move validation ──────────────────────────

function findKing(board, color) {
  const k = color === 'white' ? W_KING : B_KING;
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) if (board[r][f] === k) return { file: f, rank: r };
  return null;
}

function isAttacked(board, file, rank, byColor) {
  if (byColor === 'white') {
    if (rank - 1 >= 0 && file - 1 >= 0 && board[rank - 1][file - 1] === W_PAWN) return true;
    if (rank - 1 >= 0 && file + 1 < 8 && board[rank - 1][file + 1] === W_PAWN) return true;
  } else {
    if (rank + 1 < 8 && file - 1 >= 0 && board[rank + 1][file - 1] === B_PAWN) return true;
    if (rank + 1 < 8 && file + 1 < 8 && board[rank + 1][file + 1] === B_PAWN) return true;
  }
  const knight = byColor === 'white' ? W_KNIGHT : B_KNIGHT;
  for (const [df, dr] of [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]) {
    const nf = file + df, nr = rank + dr;
    if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8 && board[nr][nf] === knight) return true;
  }
  const king = byColor === 'white' ? W_KING : B_KING;
  for (let dr = -1; dr <= 1; dr++) for (let df = -1; df <= 1; df++) {
    if (dr === 0 && df === 0) continue;
    const nf = file + df, nr = rank + dr;
    if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8 && board[nr][nf] === king) return true;
  }
  const bishop = byColor === 'white' ? W_BISHOP : B_BISHOP;
  const queen = byColor === 'white' ? W_QUEEN : B_QUEEN;
  for (const [df, dr] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    for (let i = 1; i < 8; i++) {
      const nf = file + df * i, nr = rank + dr * i;
      if (nf < 0 || nf >= 8 || nr < 0 || nr >= 8) break;
      const p = board[nr][nf];
      if (p !== 0) { if (p === bishop || p === queen) return true; break; }
    }
  }
  const rook = byColor === 'white' ? W_ROOK : B_ROOK;
  for (const [df, dr] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    for (let i = 1; i < 8; i++) {
      const nf = file + df * i, nr = rank + dr * i;
      if (nf < 0 || nf >= 8 || nr < 0 || nr >= 8) break;
      const p = board[nr][nf];
      if (p !== 0) { if (p === rook || p === queen) return true; break; }
    }
  }
  return false;
}

function isInCheck(board, color) {
  const k = findKing(board, color);
  if (!k) return false;
  return isAttacked(board, k.file, k.rank, color === 'white' ? 'black' : 'white');
}

function getValidMovesClient(board, file, rank, castlingRights, enPassantTarget) {
  const piece = board[rank][file];
  if (piece === 0) return [];
  const color = pieceColor(piece);
  const moves = [];
  const type = pieceType(piece);

  function addMove(tf, tr, isEnPassant) {
    if (tf < 0 || tf >= 8 || tr < 0 || tr >= 8) return false;
    const target = board[tr][tf];
    if (target !== 0 && isOwn(target, color)) return true;
    const saved = board[tr][tf];
    board[tr][tf] = piece;
    board[rank][file] = 0;
    let epCaptured = null;
    if (type === 'pawn' && enPassantTarget && tf === enPassantTarget.file && tr === enPassantTarget.rank) {
      const capturedRank = color === 'white' ? tr - 1 : tr + 1;
      epCaptured = board[capturedRank][tf];
      board[capturedRank][tf] = 0;
    }
    const inCheck = isInCheck(board, color);
    board[rank][file] = piece;
    board[tr][tf] = saved;
    if (epCaptured !== null) {
      const capturedRank = color === 'white' ? tr - 1 : tr + 1;
      board[capturedRank][tf] = epCaptured;
    }
    if (!inCheck) moves.push({ file: tf, rank: tr, enPassant: isEnPassant });
    return target !== 0;
  }

  if (type === 'pawn') {
    const dir = color === 'white' ? 1 : -1;
    const startRank = color === 'white' ? 1 : 6;
    const nr = rank + dir;
    if (nr >= 0 && nr < 8 && board[nr][file] === 0) {
      addMove(file, nr);
      const nr2 = rank + 2 * dir;
      if (rank === startRank && nr2 >= 0 && nr2 < 8 && board[nr2][file] === 0) {
        addMove(file, nr2);
      }
    }
    for (const df of [-1, 1]) {
      const nf = file + df;
      if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) {
        if (isEnemy(board[nr][nf], color)) addMove(nf, nr);
        if (enPassantTarget && nf === enPassantTarget.file && nr === enPassantTarget.rank) {
          addMove(nf, nr, true);
        }
      }
    }
  } else if (type === 'knight') {
    for (const [df, dr] of [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]) {
      addMove(file + df, rank + dr);
    }
  } else if (type === 'bishop') {
    for (const [df, dr] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      for (let i = 1; i < 8; i++) { if (addMove(file + df * i, rank + dr * i)) break; }
    }
  } else if (type === 'rook') {
    for (const [df, dr] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      for (let i = 1; i < 8; i++) { if (addMove(file + df * i, rank + dr * i)) break; }
    }
  } else if (type === 'queen') {
    for (const [df, dr] of [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]) {
      for (let i = 1; i < 8; i++) { if (addMove(file + df * i, rank + dr * i)) break; }
    }
  } else if (type === 'king') {
    for (let dr = -1; dr <= 1; dr++) for (let df = -1; df <= 1; df++) {
      if (dr === 0 && df === 0) continue;
      addMove(file + df, rank + dr);
    }
    if (color === 'white' && rank === 0 && file === 4) {
      if (castlingRights.wK && board[0][5] === 0 && board[0][6] === 0 && board[0][7] === W_ROOK) {
        if (!isInCheck(board, 'white') && !isAttacked(board, 5, 0, 'black') && !isAttacked(board, 6, 0, 'black')) {
          moves.push({ file: 6, rank: 0, castle: 'K' });
        }
      }
      if (castlingRights.wQ && board[0][3] === 0 && board[0][2] === 0 && board[0][1] === 0 && board[0][0] === W_ROOK) {
        if (!isInCheck(board, 'white') && !isAttacked(board, 3, 0, 'black') && !isAttacked(board, 2, 0, 'black')) {
          moves.push({ file: 2, rank: 0, castle: 'Q' });
        }
      }
    }
    if (color === 'black' && rank === 7 && file === 4) {
      if (castlingRights.bK && board[7][5] === 0 && board[7][6] === 0 && board[7][7] === B_ROOK) {
        if (!isInCheck(board, 'black') && !isAttacked(board, 5, 7, 'white') && !isAttacked(board, 6, 7, 'white')) {
          moves.push({ file: 6, rank: 7, castle: 'K' });
        }
      }
      if (castlingRights.bQ && board[7][3] === 0 && board[7][2] === 0 && board[7][1] === 0 && board[7][0] === B_ROOK) {
        if (!isInCheck(board, 'black') && !isAttacked(board, 3, 7, 'white') && !isAttacked(board, 2, 7, 'white')) {
          moves.push({ file: 2, rank: 7, castle: 'Q' });
        }
      }
    }
  }
  return moves;
}

// ── Click handler ────────────────────────────────────────

export function setClickHandler(renderer) {
  _renderer = renderer;
  renderer.domElement.addEventListener('click', event => {
    if (menuOpen) return;
    if (serverPromotingPiece) return;
    if (serverGameOver) return;
    if (mouseLookOn) {
      renderer.domElement.requestPointerLock();
      return;
    }
    if (!serverBoard) return;

    const sq = getBoardSquareFromRay(event);
    if (!sq) return;
    const { file, rank } = sq;
    const piece = serverBoard[rank][file];

    if (selectedSquare) {
      sendMove(selectedSquare.file, selectedSquare.rank, file, rank);
      selectedSquare = null;
      validMoves = [];
      clearHighlights();
      highlightCheck();
      return;
    }

    if (piece !== 0 && pieceColor(piece) === myRole && myRole === serverTurn) {
      selectedSquare = { file, rank };
      validMoves = getValidMovesClient(
        serverBoard.map(r => [...r]), file, rank,
        castlingRights, enPassantTarget
      );
      clearHighlights();
      highlightSelected(file, rank);
      highlightValidMoves(validMoves);
    } else {
      selectedSquare = null;
      validMoves = [];
      clearHighlights();
      highlightCheck();
    }
  });
}

// ── Restart handler ──────────────────────────────────────

onRestart(() => {
  selectedSquare = null;
  validMoves = [];
  hidePromotionPicker();
  hideConcedeConfirm();
  clearHighlights();
});
