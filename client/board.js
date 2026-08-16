// ═══════════════════════════════════════════════════════════
//  BOARD — squares, highlights, coordinate labels
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';

import { serverBoard, serverTurn, previousMove } from './network.js';
import { findKing, isInCheck } from '../shared/chess.mjs';
import { getArrows, onArrowChange, getArrowPath } from './arrows.js';
import { getHighlights, onHighlightChange } from './highlights.js';
import { getPremove, onPremoveChange } from './premove.js';
import { getSelectedSquare, getSelectionMode } from './selection.js';

// Materials — created in app.js, referenced here
let matLight,
  matDark,
  matSelected,
  matValidMove,
  matCaptureMove,
  matCheck,
  matPreviousMove,
  matPremoveSelected,
  matPremoveMove,
  matPremoveCapture,
  matPremoveConfirmed;

export function setMaterials(
  light,
  dark,
  selected,
  validMove,
  captureMove,
  check,
  previousMove,
  premoveSelected,
  premoveMove,
  premoveCapture,
  premoveConfirmed
) {
  matLight = light;
  matDark = dark;
  matSelected = selected;
  matValidMove = validMove;
  matCaptureMove = captureMove;
  matCheck = check;
  matPreviousMove = previousMove;
  matPremoveSelected = premoveSelected;
  matPremoveMove = premoveMove;
  matPremoveCapture = premoveCapture;
  matPremoveConfirmed = premoveConfirmed;
  // Material reset (theme change): re-render any confirmed premove squares
  // with the new materials.
  applyPremoveConfirmed();
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

// Confirmed-premove system arrow — dashed, deep royal blue (same hue as
// the premove square fill, clearly darker than the bright Alt annotation
// blue 0x4488ff). Sourced from premove.js, never from the annotation list.
export const PREMOVE_ARROW_HUE = 0x1e5ac8;
export const PREMOVE_DASH_LEN = 0.24; // world units (2:1 dash:gap, as in 2D)
export const PREMOVE_GAP_LEN = 0.12;
const PREMOVE_ARROW_RENDER_ORDER = 100; // system overlay: above annotations

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
 * The body end of the path: the tip pulled back by HEAD_LEN along the last
 * segment, so the arrowhead fills the gap. Shared by the solid and dashed
 * builders and by the per-frame width updates.
 */
function getBodyEnd(worldPoints) {
  const tip = worldPoints[worldPoints.length - 1];
  const prev = worldPoints[worldPoints.length - 2];
  const dx = tip.x - prev.x;
  const dz = tip.z - prev.z;
  const len = Math.sqrt(dx * dx + dz * dz) || 1;
  const fx = dx / len;
  const fz = dz / len;
  return { x: tip.x - fx * HEAD_LEN, z: tip.z - fz * HEAD_LEN, fx, fz };
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
  const bodyEnd = getBodyEnd(worldPoints);

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
  const px = -bodyEnd.fz;
  const pz = bodyEnd.fx;
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
  const bodyEnd = getBodyEnd(worldPoints);

  // Update body vertices with miter joins at bends
  for (let i = 0; i < n; i++) {
    const p = i === n - 1 ? bodyEnd : worldPoints[i];
    const { px, pz } = getPerpAtVertex(worldPoints, i);

    pos.setXYZ(i * 2, p.x + px * hw, y, p.z + pz * hw);
    pos.setXYZ(i * 2 + 1, p.x - px * hw, y, p.z - pz * hw);
  }

  // Arrowhead: IDENTICAL to original per-segment version
  const px = -bodyEnd.fz;
  const pz = bodyEnd.fx;
  const bodyEndX = bodyEnd.x;
  const bodyEndZ = bodyEnd.z;
  const headHw = hw * HEAD_HALF_W_RATIO;
  const headStartIdx = n * 2;

  pos.setXYZ(headStartIdx, bodyEndX + px * headHw, y, bodyEndZ + pz * headHw);
  pos.setXYZ(headStartIdx + 1, bodyEndX - px * headHw, y, bodyEndZ - pz * headHw);
  pos.setXYZ(headStartIdx + 2, tip.x, y, tip.z);

  pos.needsUpdate = true;
}

// ── Confirmed premove arrow (3D) ─────────────────────────
// A confirmed premove renders as an independent dashed system arrow
// sourced directly from premove.js — never from the mutable annotation
// list (arrows.js). It lives in its own group, so annotation
// clear/toggle/dedup (including identical endpoints) can only affect
// arrowGroup and can never remove or hide this arrow. The body
// centerline is split into dash intervals and ribbon quads are emitted
// only for the dash intervals; a dash interval that crosses a centerline
// bend includes the bend vertex so the ribbon follows the bend (never
// shortcuts the corner diagonally). The arrowhead stays solid and the
// screen-space width updates exactly like the annotation arrows.

let premoveArrowGroup = null;
let premoveArrowMesh = null; // at most one system arrow

/**
 * Centerline point + perpendicular at arc length s along the body
 * polyline. At a bend vertex the miter perpendicular keeps the dash
 * edge aligned with the solid ribbon's edge.
 */
function pointAtArcLength(bodyPoints, s) {
  let acc = 0;
  for (let i = 0; i < bodyPoints.length - 1; i++) {
    const a = bodyPoints[i];
    const b = bodyPoints[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len === 0) continue;
    if (s <= acc + len + 1e-9) {
      const t = (s - acc) / len;
      const x = a.x + dx * t;
      const z = a.z + dz * t;
      let px, pz;
      if (t <= 1e-6) {
        ({ px, pz } = getPerpAtVertex(bodyPoints, i));
      } else if (t >= 1 - 1e-6) {
        ({ px, pz } = getPerpAtVertex(bodyPoints, i + 1));
      } else {
        px = -dz / len;
        pz = dx / len;
      }
      return { x, z, px, pz };
    }
    acc += len;
  }
  // s past the end (floating point) — clamp to the last point
  const last = bodyPoints.length - 1;
  const p = bodyPoints[last];
  const perp = getPerpAtVertex(bodyPoints, last);
  return { x: p.x, z: p.z, px: perp.px, pz: perp.pz };
}

/**
 * Split [0, totalLen] into alternating dash/gap intervals, starting with
 * a dash. The final interval is clamped to totalLen.
 */
function computeDashIntervals(totalLen, dashLen, gapLen) {
  const intervals = [];
  let s = 0;
  let dash = true;
  while (s < totalLen - 1e-9) {
    const end = Math.min(s + (dash ? dashLen : gapLen), totalLen);
    if (dash) intervals.push([s, end]);
    s = end;
    dash = !dash;
  }
  return intervals;
}

/**
 * Build the dashed premove arrow geometry: ribbon quads for the dash
 * intervals of the body centerline (shortened by HEAD_LEN at the end) +
 * a solid triangle arrowhead. Unit half-width = 1, scaled at render
 * time (same convention as buildPathGeometry).
 *
 * Each dash is a polyline: its two arc-length endpoints plus every
 * interior bend vertex the interval crosses (with the miter
 * perpendicular), so a dash crossing a bend is triangulated
 * segment-by-segment and follows the bend instead of cutting the corner
 * diagonally. Straight dashes have exactly two points.
 *
 * Returns { geometry, userData }; userData carries the dash polylines
 * and head anchor that updateDashedArrowWidth re-scales each frame.
 */
export function buildDashedPathGeometry(worldPoints, y, dashLen, gapLen) {
  const n = worldPoints.length;
  const tip = worldPoints[n - 1];
  const bodyEnd = getBodyEnd(worldPoints);
  const bodyPoints = [...worldPoints.slice(0, n - 1), { x: bodyEnd.x, z: bodyEnd.z }];

  // Cumulative arc length at each body vertex (cum[0] = 0, cum[last] = totalLen)
  const m = bodyPoints.length;
  const cum = [0];
  for (let i = 0; i < m - 1; i++) {
    const dx = bodyPoints[i + 1].x - bodyPoints[i].x;
    const dz = bodyPoints[i + 1].z - bodyPoints[i].z;
    cum.push(cum[i] + Math.sqrt(dx * dx + dz * dz));
  }
  const totalLen = cum[m - 1];

  const dashSegments = [];
  const positions = [];
  const indices = [];
  for (const [s0, s1] of computeDashIntervals(totalLen, dashLen, gapLen)) {
    // Dash polyline: endpoints + every interior bend vertex strictly
    // inside (s0, s1). Endpoints landing exactly on a bend already carry
    // the miter perpendicular from pointAtArcLength, so no duplication.
    const pts = [pointAtArcLength(bodyPoints, s0)];
    for (let i = 1; i < m - 1; i++) {
      if (cum[i] > s0 + 1e-9 && cum[i] < s1 - 1e-9) {
        const perp = getPerpAtVertex(bodyPoints, i);
        pts.push({ x: bodyPoints[i].x, z: bodyPoints[i].z, px: perp.px, pz: perp.pz });
      }
    }
    pts.push(pointAtArcLength(bodyPoints, s1));
    dashSegments.push(pts);

    const base = positions.length / 3;
    for (const p of pts) {
      positions.push(p.x + p.px, y, p.z + p.pz);
      positions.push(p.x - p.px, y, p.z - p.pz);
    }
    // Triangulate segment-by-segment (miter join at the bend vertex)
    for (let i = 0; i < pts.length - 1; i++) {
      const a = base + i * 2;
      indices.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  }

  // Solid arrowhead — identical to the solid arrow's
  const px = -bodyEnd.fz;
  const pz = bodyEnd.fx;
  const headStartIdx = positions.length / 3;
  positions.push(
    bodyEnd.x + px * HEAD_HALF_W_RATIO,
    y,
    bodyEnd.z + pz * HEAD_HALF_W_RATIO,
    bodyEnd.x - px * HEAD_HALF_W_RATIO,
    y,
    bodyEnd.z - pz * HEAD_HALF_W_RATIO,
    tip.x,
    y,
    tip.z
  );
  indices.push(headStartIdx, headStartIdx + 1, headStartIdx + 2);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return {
    geometry,
    userData: {
      worldPoints,
      y,
      dashSegments,
      head: {
        x: bodyEnd.x,
        z: bodyEnd.z,
        px,
        pz,
        tipX: tip.x,
        tipZ: tip.z,
      },
    },
  };
}

/**
 * Update the dashed premove arrow's position attribute so its width
 * matches the current camera distance (same screen-space logic as the
 * solid arrows). The dash polylines are fixed along the centerline;
 * only the perpendicular offset magnitude changes.
 */
function updateDashedArrowWidth(mesh, camera) {
  const pos = mesh.geometry.attributes.position;
  const hw = worldHalfWidth(camera, camera.position.distanceTo(mesh.position));
  const { y, dashSegments, head } = mesh.userData;

  // Each dash is a polyline (endpoints + any bend vertices it crosses);
  // 2 vertices per point, in the order buildDashedPathGeometry emitted.
  let v = 0;
  for (const pts of dashSegments) {
    for (const p of pts) {
      pos.setXYZ(v, p.x + p.px * hw, y, p.z + p.pz * hw);
      pos.setXYZ(v + 1, p.x - p.px * hw, y, p.z - p.pz * hw);
      v += 2;
    }
  }

  const headHw = hw * HEAD_HALF_W_RATIO;
  pos.setXYZ(v, head.x + head.px * headHw, y, head.z + head.pz * headHw);
  pos.setXYZ(v + 1, head.x - head.px * headHw, y, head.z - head.pz * headHw);
  pos.setXYZ(v + 2, head.tipX, y, head.tipZ);

  pos.needsUpdate = true;
}

/**
 * Remove the current system arrow, disposing its generated geometry and
 * material (per-arrow resources, unlike the shared annotation material
 * cache). Called on replace, clear, scene recreation, and teardown.
 */
function removePremoveArrowMesh() {
  if (!premoveArrowMesh) return;
  if (premoveArrowGroup) premoveArrowGroup.remove(premoveArrowMesh);
  premoveArrowMesh.geometry.dispose();
  premoveArrowMesh.material.dispose();
  premoveArrowMesh = null;
}

/**
 * Render the confirmed premove arrow from premove.js state. Idempotent:
 * the previous mesh is removed first, so repeated notifications and
 * scene re-creation can never produce more than one system arrow.
 */
function renderPremoveArrow3D() {
  if (!premoveArrowGroup) return;
  removePremoveArrowMesh();
  const pre = getPremove();
  if (!pre) return;
  if (pre.fromFile === pre.toFile && pre.fromRank === pre.toRank) return;

  const path = getArrowPath(
    { file: pre.fromFile, rank: pre.fromRank },
    { file: pre.toFile, rank: pre.toRank }
  );
  const worldPoints = path.map((p) => squareToWorld(p.file, p.rank));
  const { geometry, userData } = buildDashedPathGeometry(
    worldPoints,
    ARROW_Y,
    PREMOVE_DASH_LEN,
    PREMOVE_GAP_LEN
  );
  const material = new THREE.MeshBasicMaterial({
    color: new THREE.Color(PREMOVE_ARROW_HUE),
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 1,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData = userData;
  mesh.renderOrder = PREMOVE_ARROW_RENDER_ORDER;
  premoveArrowGroup.add(mesh);
  premoveArrowMesh = mesh;
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

export function updateAllArrowWidths() {
  if (!arrowCamera) return;
  if (arrowGroup) {
    for (const child of arrowGroup.children) {
      updateArrowWidth(child, arrowCamera);
    }
  }
  if (premoveArrowGroup) {
    for (const child of premoveArrowGroup.children) {
      updateDashedArrowWidth(child, arrowCamera);
    }
  }
}

let arrowRafId = null;

export function initArrows3D(scene, camera) {
  arrowScene = scene;
  arrowCamera = camera;

  // A re-init (board/scene recreation) starts a fresh loop and groups;
  // the old premove arrow is disposed below.
  if (arrowRafId !== null) {
    cancelAnimationFrame(arrowRafId);
    arrowRafId = null;
  }

  arrowGroup = new THREE.Group();
  arrowGroup.name = 'arrowGroup';
  arrowGroup.sortObjects = false; // preserve insertion order: newest on top
  scene.add(arrowGroup);

  // The premove system arrow lives in its own group: annotation
  // add/remove/clear (renderArrows3D) can never touch it.
  if (premoveArrowGroup && premoveArrowGroup.parent) {
    premoveArrowGroup.parent.remove(premoveArrowGroup);
  }
  removePremoveArrowMesh();
  premoveArrowGroup = new THREE.Group();
  premoveArrowGroup.name = 'premoveArrowGroup';
  premoveArrowGroup.sortObjects = false;
  scene.add(premoveArrowGroup);

  onArrowChange(renderArrows3D);

  // Restore a pending premove arrow in the (re)created scene
  renderPremoveArrow3D();

  // Update arrow widths every frame
  const animate = () => {
    updateAllArrowWidths();
  };
  const loop = () => {
    animate();
    arrowRafId = requestAnimationFrame(loop);
  };
  loop();
}

export function disposeArrows3D() {
  if (arrowRafId !== null) {
    cancelAnimationFrame(arrowRafId);
    arrowRafId = null;
  }
  // Dispose the active premove arrow's per-arrow resources, then detach
  // and null the groups/references: a later premove state change on a
  // disposed renderer must not resurrect anything in the scene.
  removePremoveArrowMesh();
  if (premoveArrowGroup && premoveArrowGroup.parent) {
    premoveArrowGroup.parent.remove(premoveArrowGroup);
  }
  premoveArrowGroup = null;
  premoveArrowMesh = null;
  if (arrowGroup && arrowGroup.parent) {
    arrowGroup.parent.remove(arrowGroup);
  }
  arrowGroup = null;
  arrowScene = null;
  arrowCamera = null;
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

  // Board rebuild: the fresh square meshes start at base materials, so
  // re-render any confirmed premove squares on top of them.
  applyPremoveConfirmed();
}

// ── Highlights ───────────────────────────────────────────

export function clearHighlights() {
  if (!squares.length) return;
  for (let r = 0; r < 8; r++)
    for (let f = 0; f < 8; f++) {
      const sq = squares[r][f];
      const isLight = (f + r) % 2 === 1;
      // Replace the emissive reference rather than mutating it: after a
      // renderSquareState() copy the square may share the state material's
      // Color instance, and .set() would corrupt the shared material.
      sq.material.emissive = new THREE.Color(0x000000);
      sq.material.emissiveIntensity = 0;
      sq.material.color.copy(isLight ? matLight.color : matDark.color);
    }
  removeMoveDots();
  // Confirmed premove squares persist across selection changes (2D intent:
  // premove-from/to survive deselect and re-selection).
  applyPremoveConfirmed();
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

// ── Square-state recomposition ───────────────────────────
// The visible state of a square is a pure function of the global highlight
// state (check, confirmed premove, selection, previous move). Every highlight
// entry point recomposes the squares it affects through renderSquareState(),
// so the final appearance is deterministic and independent of the order in
// which highlight events arrive.
//
// Precedence (highest wins):
//   check > confirmed premove > selection (normal/premove) > previous move > base

function setSquareMaterial(sq, mat) {
  // Guard against a missing material (e.g. a highlight requested before
  // setMaterials has run in a test harness) — never copy() undefined.
  if (!mat) return;
  sq.material.copy(mat);
}

function renderSquareState(file, rank) {
  if (file < 0 || file >= 8 || rank < 0 || rank >= 8) return;
  const sq = squares[rank]?.[file];
  if (!sq) return;

  // 1. Check — derived from the board, so it is always current and beats
  //    every other state, including the confirmed-premove fill.
  if (boardIsReady() && isInCheck(serverBoard, serverTurn)) {
    const king = findKing(serverBoard, serverTurn);
    if (king && king.file === file && king.rank === rank) {
      setSquareMaterial(sq, matCheck);
      return;
    }
  }
  // 2. Confirmed premove — persists across selection changes.
  if (isConfirmedPremoveSquare(file, rank)) {
    setSquareMaterial(sq, matPremoveConfirmed);
    return;
  }
  // 3. Current selection — normal or premove material per the selection mode.
  const sel = getSelectedSquare();
  if (sel && sel.file === file && sel.rank === rank) {
    setSquareMaterial(sq, getSelectionMode() === 'premove' ? matPremoveSelected : matSelected);
    return;
  }
  // 4. Previous move.
  if (previousMove) {
    const { fromFile, fromRank, toFile, toRank } = previousMove;
    if ((file === fromFile && rank === fromRank) || (file === toFile && rank === toRank)) {
      setSquareMaterial(sq, matPreviousMove);
      return;
    }
  }
  // 5. Base.
  resetSquareToBase(file, rank);
}

// ── Dot indicators for valid moves ───────────────────────

function removeMoveDots() {
  for (const dot of moveDots) {
    dot.mesh.parent?.remove(dot.mesh);
    // Meshes reuse shared geometries and materials — no dispose needed.
  }
  moveDots = [];
}

function renderMoveDots(scene, moves, moveMat, captureMat) {
  removeMoveDots();
  ensureDotGeometry();

  for (const m of moves) {
    const isCapture = serverBoard && (serverBoard[m.rank][m.file] !== 0 || m.enPassant);
    // Reuse shared materials directly — no cloning needed.
    const dotMat = isCapture ? captureMat : moveMat;

    const mesh = new THREE.Mesh(isCapture ? ringGeometry : dotGeometry, dotMat);
    // Both are flat rings lying on the board
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(m.file - 3.5, 0.06, 3.5 - m.rank);
    scene.add(mesh);
    moveDots.push({ mesh, file: m.file, rank: m.rank });
  }
}

export function highlightValidMoves(scene, moves) {
  renderMoveDots(scene, moves, matValidMove, matCaptureMove);
}

export function highlightSelected(file, rank) {
  renderSquareState(file, rank);
}

export function highlightPremoveSelected(file, rank) {
  renderSquareState(file, rank);
}

export function highlightPremoveMoves(scene, moves) {
  renderMoveDots(scene, moves, matPremoveMove, matPremoveCapture);
}

// ── Confirmed premove squares (3D) ───────────────────────
// The confirmed premove's origin + destination are rendered through the
// normal square-material (emissive) path — the same path as
// selected/valid/check/previous — NOT the annotation overlay-plane path
// (which is reserved for right-click highlights). Deep royal blue 0x1e5ac8,
// clearly darker than the bright Alt annotation blue 0x4488ff.
//
// State is driven solely by premove.js (server confirmation echo, reconnect
// restore, discard/clear/execution). Spectators/opponents never see these:
// their premove state stays null.

let premoveConfirmed = null; // { fromFile, fromRank, toFile, toRank } | null

function isConfirmedPremoveSquare(file, rank) {
  if (!premoveConfirmed) return false;
  const { fromFile, fromRank, toFile, toRank } = premoveConfirmed;
  return (file === fromFile && rank === fromRank) || (file === toFile && rank === toRank);
}

function applyPremoveConfirmed() {
  if (!premoveConfirmed) return;
  const { fromFile, fromRank, toFile, toRank } = premoveConfirmed;
  // Recompose (do not force): check on the same square still wins over the
  // confirmed fill, keeping the precedence deterministic.
  renderSquareState(fromFile, fromRank);
  renderSquareState(toFile, toRank);
}

function resetSquareToBase(file, rank) {
  if (file < 0 || file >= 8 || rank < 0 || rank >= 8) return;
  const sq = squares[rank]?.[file];
  if (!sq) return;
  const isLight = (file + rank) % 2 === 1;
  // Replace the emissive reference (see clearHighlights) so a shared state
  // material's Color is never mutated.
  sq.material.emissive = new THREE.Color(0x000000);
  sq.material.emissiveIntensity = 0;
  sq.material.color.copy(isLight ? matLight.color : matDark.color);
}

/**
 * True when serverBoard is a full 8x8 board (guards against stub/empty
 * boards in tests and transient states before the first real state).
 */
function boardIsReady() {
  return !!(
    serverBoard &&
    serverBoard.length === 8 &&
    serverBoard[0] &&
    serverBoard[0].length === 8
  );
}

function clearConfirmedSquares() {
  if (!premoveConfirmed) return;
  const { fromFile, fromRank, toFile, toRank } = premoveConfirmed;
  premoveConfirmed = null;
  // Recompose the freed squares: the underlying check/selection/previous-move
  // state is revealed in the correct precedence order.
  renderSquareState(fromFile, fromRank);
  renderSquareState(toFile, toRank);
}

export function setPremoveConfirmedSquares(fromFile, fromRank, toFile, toRank) {
  // A replacement premove must drop the old fill first (2D intent:
  // renderPremoveSquares removes all premove-from/to before re-adding).
  clearConfirmedSquares();
  premoveConfirmed = { fromFile, fromRank, toFile, toRank };
  applyPremoveConfirmed();
}

export function clearPremoveConfirmedSquares() {
  clearConfirmedSquares();
}

export function getPremoveConfirmedSquares() {
  return premoveConfirmed;
}

// Render the confirmed premove squares whenever the shared premove state
// changes: server confirmation, reconnect restore, clear/discard/execution.
onPremoveChange(() => {
  const pre = getPremove();
  if (pre) {
    setPremoveConfirmedSquares(pre.fromFile, pre.fromRank, pre.toFile, pre.toRank);
  } else {
    clearPremoveConfirmedSquares();
  }
});

// Render the confirmed premove arrow on the same state changes. The arrow
// is a system overlay sourced from premove.js — annotation clear/toggle/
// dedup (arrows.js) can never remove or hide it.
onPremoveChange(renderPremoveArrow3D);

export function highlightCheck() {
  if (!serverBoard) return;
  const king = findKing(serverBoard, serverTurn);
  // Recompose the king's square: check wins while the board is in check, and
  // a resolved check reveals the underlying state (no stale check fill).
  if (king) renderSquareState(king.file, king.rank);
}

// ── Previous move highlight ──────────────────────────────

export function highlightPreviousMove() {
  if (!previousMove) return;
  const { fromFile, fromRank, toFile, toRank } = previousMove;
  renderSquareState(fromFile, fromRank);
  renderSquareState(toFile, toRank);
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
