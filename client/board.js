// ═══════════════════════════════════════════════════════════
//  BOARD — squares, highlights, coordinate labels
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { serverBoard, serverTurn, previousMove } from './network.js';
import { findKing, isInCheck } from './chess.mjs';

// Materials — created in app.js, referenced here
let matLight, matDark, matSelected, matValidMove, matCaptureMove, matCheck, matPreviousMove;

export function setMaterials(light, dark, selected, validMove, captureMove, check, previousMove) {
  matLight = light;
  matDark = dark;
  matSelected = selected;
  matValidMove = validMove;
  matCaptureMove = captureMove;
  matCheck = check;
  matPreviousMove = previousMove;
}

export const squares = [];

// Dot indicators for valid moves (3D)
let moveDots = []; // { mesh, file, rank }[]
// Shared geometries — created once, reused across selections
let dotGeometry = null;
let ringGeometry = null;

function ensureDotGeometry() {
  // Solid ring (filled circle) for valid moves on empty squares
  if (!dotGeometry) dotGeometry = new THREE.RingGeometry(0, 0.18, 16);
  // Hollow ring for capture moves
  if (!ringGeometry) ringGeometry = new THREE.RingGeometry(0.32, 0.48, 20);
}

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
}

// ── Highlights ───────────────────────────────────────────

export function clearHighlights() {
  for (let r = 0; r < 8; r++)
    for (let f = 0; f < 8; f++) {
      const sq = squares[r][f];
      const isLight = (f + r) % 2 === 1;
      sq.material.emissive.set(0x000000);
      sq.material.emissiveIntensity = 0;
      sq.material.color.copy(isLight ? matLight.color : matDark.color);
    }
  removeMoveDots();
}

function highlightSquare(file, rank, mat) {
  if (file < 0 || file >= 8 || rank < 0 || rank >= 8) return;
  squares[rank][file].material.copy(mat);
}

// ── Dot indicators for valid moves ───────────────────────

function removeMoveDots() {
  for (const dot of moveDots) {
    dot.mesh.parent?.remove(dot.mesh);
    // Meshes reuse shared geometries and materials — no dispose needed.
  }
  moveDots = [];
}

export function highlightValidMoves(scene, moves) {
  removeMoveDots();
  ensureDotGeometry();

  for (const m of moves) {
    const isCapture = serverBoard && (serverBoard[m.rank][m.file] !== 0 || m.enPassant);
    // Reuse shared materials directly — no cloning needed.
    const dotMat = isCapture ? matCaptureMove : matValidMove;

    const mesh = new THREE.Mesh(isCapture ? ringGeometry : dotGeometry, dotMat);
    // Both are flat rings lying on the board
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(m.file - 3.5, 0.06, 3.5 - m.rank);
    scene.add(mesh);
    moveDots.push({ mesh, file: m.file, rank: m.rank });
  }
}

export function highlightSelected(file, rank) {
  highlightSquare(file, rank, matSelected);
}

export function highlightCheck() {
  if (!serverBoard) return;
  const king = findKing(serverBoard, serverTurn);
  if (king && isInCheck(serverBoard, serverTurn)) {
    highlightSquare(king.file, king.rank, matCheck);
  }
}

// ── Previous move highlight ──────────────────────────────

export function highlightPreviousMove() {
  if (!previousMove) return;
  const { fromFile, fromRank, toFile, toRank } = previousMove;
  highlightSquare(fromFile, fromRank, matPreviousMove);
  highlightSquare(toFile, toRank, matPreviousMove);
}

// ── Coordinate labels ────────────────────────────────────

export function createLabels(scene, font) {
  const fileMat = new THREE.MeshStandardMaterial({ color: 0xf0d9b5, roughness: 0.6 });
  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const ranks = ['1', '2', '3', '4', '5', '6', '7', '8'];
  const textOpts = {
    font,
    size: 0.18,
    height: 0.025,
    curveSegments: 4,
    bevelEnabled: true,
    bevelThickness: 0.003,
    bevelSize: 0.003,
    bevelSegments: 2,
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
    // Top side (mirrored)
    const g2 = new TextGeometry(ch, textOpts);
    g2.computeBoundingBox();
    g2.boundingBox.getCenter(center);
    g2.translate(-center.x, -center.y, -center.z);
    const m2 = new THREE.Mesh(g2, fileMat);
    m2.position.set(i - 3.5, 0.02, -4.15);
    m2.rotation.x = -Math.PI / 2;
    m2.rotation.z = Math.PI;
    scene.add(m2);
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
    // Right side (mirrored)
    const g2 = new TextGeometry(ch, textOpts);
    g2.computeBoundingBox();
    g2.boundingBox.getCenter(center);
    g2.translate(-center.x, -center.y, -center.z);
    const m2 = new THREE.Mesh(g2, fileMat);
    m2.position.set(4.15, 0.02, 3.5 - i);
    m2.rotation.x = -Math.PI / 2;
    m2.rotation.z = Math.PI / 2;
    scene.add(m2);
  });
}
