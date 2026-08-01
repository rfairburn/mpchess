// ═══════════════════════════════════════════════════════════
//  BOARD — squares, highlights, coordinate labels
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';

import { serverBoard, serverTurn, previousMove } from './network.js';
import { findKing, isInCheck } from './chess.mjs';
import { getArrows, onArrowChange, getArrowPath } from './arrows.js';
import { getHighlights, onHighlightChange } from './highlights.js';

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

// ── Arrow rendering (3D) ────────────────────────────────
// Unified geometry: line body + arrowhead as a single flat mesh.
// Width is updated each frame to maintain constant screen-space thickness.

let arrowGroup = null;
let arrowScene = null;
let arrowCamera = null;
const ARROW_Y = 0.065; // slightly above board to avoid z-fight
const TARGET_LINEWIDTH = 20; // pixels — 2.5x original 8px
const HEAD_LEN = 0.25; // 1/4 of a square
const HEAD_HALF_W_RATIO = 1.5; // arrowhead base wider than line

const materialCache = new Map();

function getArrowMaterial(color) {
  if (!materialCache.has(color)) {
    materialCache.set(
      color,
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color),
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 1,
        depthWrite: false,
      })
    );
  }
  return materialCache.get(color);
}

function squareToWorld(file, rank) {
  return { x: file - 3.5, z: 3.5 - rank };
}

/**
 * Compute perpendicular offset for a path vertex, using miter at bends
 * to maintain uniform ribbon thickness.
 * Returns { px, pz } = unit perpendicular * miter extension.
 */
function getPerpAtVertex(worldPoints, i) {
  const n = worldPoints.length;

  if (i === 0) {
    const dx = worldPoints[1].x - worldPoints[0].x;
    const dz = worldPoints[1].z - worldPoints[0].z;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    return { px: -dz / len, pz: dx / len };
  }
  if (i === n - 1) {
    const dx = worldPoints[i].x - worldPoints[i - 1].x;
    const dz = worldPoints[i].z - worldPoints[i - 1].z;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    return { px: -dz / len, pz: dx / len };
  }

  // Bend: compute miter perpendicular that maintains uniform ribbon thickness.
  // Miter = bisector of the two segment perpendiculars, extended by 2/||p1+p2||
  // so the edge stays at unit distance from both centerlines.
  const bend = worldPoints[i];
  const dx1 = bend.x - worldPoints[i - 1].x;
  const dz1 = bend.z - worldPoints[i - 1].z;
  const dx2 = worldPoints[i + 1].x - bend.x;
  const dz2 = worldPoints[i + 1].z - bend.z;
  const len1 = Math.sqrt(dx1 * dx1 + dz1 * dz1) || 1;
  const len2 = Math.sqrt(dx2 * dx2 + dz2 * dz2) || 1;

  const p1x = -dz1 / len1;
  const p1z = dx1 / len1;
  const p2x = -dz2 / len2;
  const p2z = dx2 / len2;

  const bx = p1x + p2x;
  const bz = p1z + p2z;
  const blen = Math.sqrt(bx * bx + bz * bz);
  if (blen < 0.01) {
    // Nearly opposite perpendiculars (straight line) — use either
    return { px: p1x, pz: p1z };
  }

  // Miter factor: 2/||p1+p2||. For 90° bend: 2/√2 = √2 ≈ 1.414
  const miter = 2 / blen;
  return { px: (bx / blen) * miter, pz: (bz / blen) * miter };
}

/**
 * Build a continuous ribbon body for the entire path + triangle arrowhead.
 * Body is shortened by HEAD_LEN at the end so the arrowhead fills the gap.
 * Miter joins at bends maintain uniform thickness.
 * Arrowhead is identical to original per-segment version.
 * Unit half-width = 1, scaled at render time.
 */
function buildPathGeometry(worldPoints, y) {
  const n = worldPoints.length;
  const positions = [];
  const indices = [];

  // Compute last segment direction for shortening the body end
  const tip = worldPoints[n - 1];
  const prev = worldPoints[n - 2];
  const lastDx = tip.x - prev.x;
  const lastDz = tip.z - prev.z;
  const lastLen = Math.sqrt(lastDx * lastDx + lastDz * lastDz) || 1;
  const lastFx = lastDx / lastLen;
  const lastFz = lastDz / lastLen;
  const bodyEnd = {
    x: tip.x - lastFx * HEAD_LEN,
    z: tip.z - lastFz * HEAD_LEN,
  };

  // Build ribbon with miter joins at bends
  for (let i = 0; i < n; i++) {
    const p = i === n - 1 ? bodyEnd : worldPoints[i];
    const { px, pz } = getPerpAtVertex(worldPoints, i);

    positions.push(p.x + px, y, p.z + pz);
    positions.push(p.x - px, y, p.z - pz);
  }

  // Triangulate ribbon
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    const b = i * 2 + 1;
    const c = (i + 1) * 2;
    const d = (i + 1) * 2 + 1;
    indices.push(a, b, d, a, d, c);
  }

  // Arrowhead: IDENTICAL to original per-segment version
  const px = -lastFz;
  const pz = lastFx;
  const bodyEndX = bodyEnd.x;
  const bodyEndZ = bodyEnd.z;

  const headStartIdx = positions.length / 3;
  positions.push(
    bodyEndX + px * HEAD_HALF_W_RATIO,
    y,
    bodyEndZ + pz * HEAD_HALF_W_RATIO,
    bodyEndX - px * HEAD_HALF_W_RATIO,
    y,
    bodyEndZ - pz * HEAD_HALF_W_RATIO,
    tip.x,
    y,
    tip.z
  );
  indices.push(headStartIdx, headStartIdx + 1, headStartIdx + 2);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Compute the world-space half-width that gives TARGET_LINEWIDTH pixels
 * on screen at the given distance from the camera.
 */
function worldHalfWidth(camera, dist) {
  const fovRad = camera.fov * (Math.PI / 180);
  const frustumHeight = 2 * dist * Math.tan(fovRad / 2);
  const pixelsHeight = window.innerHeight;
  const worldPerPx = frustumHeight / pixelsHeight;
  return (TARGET_LINEWIDTH / 2) * worldPerPx;
}

/**
 * Update the position attribute so width matches current camera distance.
 * Body is shortened by HEAD_LEN at the end; arrowhead is identical to original.
 */
function updateArrowWidth(mesh, camera) {
  const pos = mesh.geometry.attributes.position;
  const hw = worldHalfWidth(camera, camera.position.distanceTo(mesh.position));
  const { worldPoints, y } = mesh.userData;
  const n = worldPoints.length;

  // Compute body end (shortened by HEAD_LEN)
  const tip = worldPoints[n - 1];
  const prev = worldPoints[n - 2];
  const lastDx = tip.x - prev.x;
  const lastDz = tip.z - prev.z;
  const lastLen = Math.sqrt(lastDx * lastDx + lastDz * lastDz) || 1;
  const lastFx = lastDx / lastLen;
  const lastFz = lastDz / lastLen;
  const bodyEnd = {
    x: tip.x - lastFx * HEAD_LEN,
    z: tip.z - lastFz * HEAD_LEN,
  };

  // Update body vertices with miter joins at bends
  for (let i = 0; i < n; i++) {
    const p = i === n - 1 ? bodyEnd : worldPoints[i];
    const { px, pz } = getPerpAtVertex(worldPoints, i);

    pos.setXYZ(i * 2, p.x + px * hw, y, p.z + pz * hw);
    pos.setXYZ(i * 2 + 1, p.x - px * hw, y, p.z - pz * hw);
  }

  // Arrowhead: IDENTICAL to original per-segment version
  const px = -lastFz;
  const pz = lastFx;
  const bodyEndX = bodyEnd.x;
  const bodyEndZ = bodyEnd.z;
  const headHw = hw * HEAD_HALF_W_RATIO;
  const headStartIdx = n * 2;

  pos.setXYZ(headStartIdx, bodyEndX + px * headHw, y, bodyEndZ + pz * headHw);
  pos.setXYZ(headStartIdx + 1, bodyEndX - px * headHw, y, bodyEndZ - pz * headHw);
  pos.setXYZ(headStartIdx + 2, tip.x, y, tip.z);

  pos.needsUpdate = true;
}

function renderArrows3D() {
  if (!arrowGroup || !arrowScene) return;

  // Remove old arrows
  while (arrowGroup.children.length > 0) {
    const child = arrowGroup.children[0];
    arrowGroup.remove(child);
    if (child.geometry) child.geometry.dispose();
  }

  const arrows = getArrows();
  for (let i = 0; i < arrows.length; i++) {
    const arrow = arrows[i];
    const path = getArrowPath(arrow.from, arrow.to);
    const color = arrow.color;
    const mat = getArrowMaterial(color);

    const worldPoints = path.map((p) => squareToWorld(p.file, p.rank));
    const geo = buildPathGeometry(worldPoints, ARROW_Y);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData = { worldPoints, y: ARROW_Y };
    mesh.renderOrder = i + 1; // newer arrows (higher index) render on top
    arrowGroup.add(mesh);
  }
}

function updateAllArrowWidths() {
  if (!arrowCamera || !arrowGroup) return;
  for (const child of arrowGroup.children) {
    updateArrowWidth(child, arrowCamera);
  }
}

export function initArrows3D(scene, camera) {
  arrowScene = scene;
  arrowCamera = camera;
  arrowGroup = new THREE.Group();
  arrowGroup.name = 'arrowGroup';
  arrowGroup.sortObjects = false; // preserve insertion order: newest on top
  scene.add(arrowGroup);

  onArrowChange(renderArrows3D);

  // Update arrow widths every frame
  const animate = () => {
    updateAllArrowWidths();
  };
  const loop = () => {
    animate();
    requestAnimationFrame(loop);
  };
  loop();
}

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

// ── Square highlight overlays (3D) ──────────────────────

let highlightGroup = null;
const HIGHLIGHT_Y = 0.042; // 0.001 above square surface (0.041)
const HIGHLIGHT_SCALE = 1.0; // full square size

const highlightMaterialCache = new Map();
// Shared geometry for all highlight planes — created once, never disposed
let highlightGeometry = null;

function getHighlightGeometry() {
  if (!highlightGeometry) {
    highlightGeometry = new THREE.PlaneGeometry(HIGHLIGHT_SCALE, HIGHLIGHT_SCALE);
  }
  return highlightGeometry;
}

function getHighlightMaterial(color) {
  if (!highlightMaterialCache.has(color)) {
    highlightMaterialCache.set(
      color,
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color),
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: true,
      })
    );
  }
  return highlightMaterialCache.get(color);
}

function removeHighlightOverlays() {
  if (!highlightGroup) return;
  while (highlightGroup.children.length > 0) {
    const child = highlightGroup.children[0];
    highlightGroup.remove(child);
    // Do NOT dispose geometry — it's shared across all highlights
  }
}

function renderHighlights3D() {
  if (!highlightGroup) return;
  removeHighlightOverlays();

  const hl = getHighlights();
  const geo = getHighlightGeometry();

  for (const h of hl) {
    const mat = getHighlightMaterial(h.color);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(h.file - 3.5, HIGHLIGHT_Y, 3.5 - h.rank);
    mesh.renderOrder = -1; // render before arrows (default 0)
    highlightGroup.add(mesh);
  }
}

export function initHighlights3D(scene) {
  highlightGroup = new THREE.Group();
  highlightGroup.name = 'highlightGroup';
  highlightGroup.sortObjects = false; // preserve insertion order
  scene.add(highlightGroup);

  onHighlightChange(renderHighlights3D);
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
