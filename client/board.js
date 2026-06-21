// ═══════════════════════════════════════════════════════════
//  BOARD — squares, highlights, coordinate labels
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { serverBoard, serverTurn } from './network.js';

// Piece constants (duplicated from server — will be de-duplicated later)
const W_PAWN = 1, W_KNIGHT = 2, W_BISHOP = 3, W_ROOK = 4, W_QUEEN = 5, W_KING = 6;
const B_PAWN = 7, B_KNIGHT = 8, B_BISHOP = 9, B_ROOK = 10, B_QUEEN = 11, B_KING = 12;

// Materials — created in app.js, referenced here
let matLight, matDark, matSelected, matValidMove, matCaptureMove, matCheck;

export function setMaterials(light, dark, selected, validMove, captureMove, check) {
  matLight = light;
  matDark = dark;
  matSelected = selected;
  matValidMove = validMove;
  matCaptureMove = captureMove;
  matCheck = check;
}

export const squares = [];

export function createBoard(scene, matBorder) {
  const sq = new THREE.PlaneGeometry(1, 1);
  for (let rank = 0; rank < 8; rank++) {
    squares[rank] = [];
    for (let file = 0; file < 8; file++) {
      const isLight = (file + rank) % 2 === 1;
      const material = isLight ? matLight.clone() : matDark.clone();
      const mesh = new THREE.Mesh(sq, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(file - 3.5, 0.041, 3.5 - rank);
      mesh.receiveShadow = true;
      scene.add(mesh);
      squares[rank][file] = mesh;
    }
  }
  const borderGeo = new THREE.BoxGeometry(8.6, 0.18, 8.6);
  const border = new THREE.Mesh(borderGeo, matBorder);
  border.position.y = -0.06;
  border.receiveShadow = true;
  scene.add(border);
  const lipGeo = new THREE.BoxGeometry(8.1, 0.06, 8.1);
  const lip = new THREE.Mesh(lipGeo, matBorder.clone());
  lip.material.color.set(0x6b4423);
  lip.position.y = 0.01;
  lip.receiveShadow = true;
  scene.add(lip);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 12),
    new THREE.MeshStandardMaterial({ color: 0x1a1008, roughness: 0.9 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.12;
  ground.receiveShadow = true;
  scene.add(ground);
}

// ── Highlights ───────────────────────────────────────────

export function clearHighlights() {
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const sq = squares[r][f];
    const isLight = (f + r) % 2 === 1;
    sq.material.emissive.set(0x000000);
    sq.material.emissiveIntensity = 0;
    sq.material.color.copy(isLight ? matLight.color : matDark.color);
  }
}

function highlightSquare(file, rank, mat) {
  if (file < 0 || file >= 8 || rank < 0 || rank >= 8) return;
  squares[rank][file].material.copy(mat);
}

export function highlightValidMoves(moves) {
  for (const m of moves) {
    if (serverBoard && serverBoard[m.rank][m.file] !== 0 || m.enPassant) {
      highlightSquare(m.file, m.rank, matCaptureMove);
    } else {
      highlightSquare(m.file, m.rank, matValidMove);
    }
  }
}

export function highlightSelected(file, rank) {
  highlightSquare(file, rank, matSelected);
}

// Client-side check detection for highlighting
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

export function highlightCheck() {
  if (!serverBoard) return;
  const king = findKing(serverBoard, serverTurn);
  if (king && isInCheck(serverBoard, serverTurn)) {
    highlightSquare(king.file, king.rank, matCheck);
  }
}

// ── Coordinate labels ────────────────────────────────────

export function createLabels(scene, font) {
  const fileMat = new THREE.MeshStandardMaterial({ color: 0xf0d9b5, roughness: 0.6 });
  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const ranks = ['1', '2', '3', '4', '5', '6', '7', '8'];
  const textOpts = {
    font, size: 0.18, height: 0.025, curveSegments: 4,
    bevelEnabled: true, bevelThickness: 0.008,
    bevelSize: 0.008, bevelSegments: 2
  };
  files.forEach((ch, i) => {
    const g = new TextGeometry(ch, textOpts);
    g.computeBoundingBox();
    const center = new THREE.Vector3();
    g.boundingBox.getCenter(center);
    g.translate(-center.x, -center.y, -center.z);
    const m = new THREE.Mesh(g, fileMat);
    m.position.set(i - 3.5, 0.02, 4.15);
    m.rotation.x = -Math.PI / 2;
    scene.add(m);
  });
  ranks.forEach((ch, i) => {
    const g = new TextGeometry(ch, textOpts);
    g.computeBoundingBox();
    const center = new THREE.Vector3();
    g.boundingBox.getCenter(center);
    g.translate(-center.x, -center.y, -center.z);
    const m = new THREE.Mesh(g, fileMat);
    m.position.set(-4.15, 0.02, 3.5 - i);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = -Math.PI / 2;
    scene.add(m);
  });
}
