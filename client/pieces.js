// ═══════════════════════════════════════════════════════════
//  PIECES — 3D model loading, creation, rebuild, animations
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { serverBoard, onStateUpdate, onRestart } from './network.js';
import { clearHighlights, highlightCheck } from './board.js';
import { pieceColor, pieceType } from '../shared/chess.mjs';

// Materials — set from app.js
let matWhite, matBlack;

export function setMaterials(white, black) {
  matWhite = white;
  matBlack = black;
}

const PIECE_TYPES = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
const PIECE_CACHE = {};
export const pieceMeshes = [];
export let modelsLoaded = false;

export function loadPieceModels(scene, onReady) {
  const loader = new STLLoader();
  let loaded = 0;
  PIECE_TYPES.forEach((type) => {
    loader.load(
      `../files/${type}.stl`,
      (geometry) => {
        geometry.rotateX(-Math.PI / 2);
        geometry.computeBoundingBox();
        const size = geometry.boundingBox.getSize(new THREE.Vector3());
        const baseScale = 0.7 / Math.max(size.x, size.z);
        geometry.scale(baseScale, baseScale, baseScale);
        geometry.computeBoundingBox();
        const cx = (geometry.boundingBox.min.x + geometry.boundingBox.max.x) / 2;
        const cz = (geometry.boundingBox.min.z + geometry.boundingBox.max.z) / 2;
        geometry.translate(-cx, -geometry.boundingBox.min.y, -cz);
        geometry.computeVertexNormals();
        PIECE_CACHE[type] = geometry;
        loaded++;
        if (loaded === PIECE_TYPES.length) {
          modelsLoaded = true;
          onReady();
          // If we already have board state, rebuild pieces now that models are ready
          if (serverBoard) rebuildPieces(scene);
        }
      },
      undefined,
      (err) => console.error(`Failed to load ${type}.stl`, err)
    );
  });
}

function createPiece(type, color) {
  const geo = PIECE_CACHE[type];
  if (!geo) return new THREE.Group();
  const mat = color === 'white' ? matWhite : matBlack;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.add(mesh);
  return group;
}

export function rebuildPieces(scene) {
  if (!serverBoard || !modelsLoaded) return;

  // Build a map of what should be on the board: "file,rank" -> {type, color}
  const desired = new Map();
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const piece = serverBoard[r][f];
      if (piece === 0) continue;
      const key = `${f},${r}`;
      desired.set(key, { type: pieceType(piece), color: pieceColor(piece) });
    }
  }

  // Build a map of existing meshes by position (skip animating pieces)
  const existing = new Map();
  for (const pm of pieceMeshes) {
    if (animatingPieces.has(pm)) continue; // let animations finish undisturbed
    const key = `${pm.file},${pm.rank}`;
    existing.set(key, pm);
  }

  // Remove meshes no longer on the board, update changed ones, keep unchanged
  const toKeep = new Set();
  // Track positions occupied by animating pieces so we don't create duplicates
  const skipPositions = new Set();
  for (const pm of pieceMeshes) {
    if (animatingPieces.has(pm)) {
      skipPositions.add(`${pm.file},${pm.rank}`);
    }
  }

  for (const [key, pm] of existing) {
    const desiredPiece = desired.get(key);
    if (!desiredPiece) {
      // Piece no longer exists — remove
      scene.remove(pm.mesh);
    } else if (desiredPiece.type !== pm.type || desiredPiece.color !== pm.color) {
      // Piece changed type or color — recreate the mesh
      scene.remove(pm.mesh);
      const newMesh = createPiece(desiredPiece.type, desiredPiece.color);
      newMesh.position.copy(pm.mesh.position);
      newMesh.rotation.y = pm.mesh.rotation.y;
      scene.add(newMesh);
      pm.mesh = newMesh;
      pm.type = desiredPiece.type;
      pm.color = desiredPiece.color;
      toKeep.add(key);
    } else {
      // Unchanged
      toKeep.add(key);
    }
  }

  // Add new pieces that don't have meshes yet (skip animating pieces)
  for (const [key, desiredPiece] of desired) {
    if (!toKeep.has(key) && !skipPositions.has(key)) {
      const [f, r] = key.split(',').map(Number);
      const mesh = createPiece(desiredPiece.type, desiredPiece.color);
      mesh.position.set(f - 3.5, 0.01, 3.5 - r);
      mesh.rotation.y = desiredPiece.color === 'black' ? 0 : Math.PI;
      scene.add(mesh);
      pieceMeshes.push({
        mesh,
        file: f,
        rank: r,
        type: desiredPiece.type,
        color: desiredPiece.color,
      });
    }
  }

  // Rebuild the pieceMeshes array: keep animating pieces + pieces in desired state
  const finalMeshes = [];
  for (const pm of pieceMeshes) {
    if (animatingPieces.has(pm)) {
      finalMeshes.push(pm); // keep animating pieces alive
    } else {
      const key = `${pm.file},${pm.rank}`;
      if (desired.has(key)) {
        finalMeshes.push(pm);
      }
    }
  }
  pieceMeshes.length = 0;
  pieceMeshes.push(...finalMeshes);
}

export function updatePiecePosition(pieceObj, file, rank) {
  pieceObj.mesh.position.set(file - 3.5, 0.01, 3.5 - rank);
  pieceObj.file = file;
  pieceObj.rank = rank;
}

// ── Animated moves ───────────────────────────────────────

export const animations = [];

// Tracks pieces currently being animated so rebuildPieces skips them.
// This prevents rebuildPieces from removing/creating meshes mid-animation,
// which would cause duplicate pieces or kill capture fade-out animations.
const animatingPieces = new Set();

export function animateMove(
  scene,
  fromFile,
  fromRank,
  toFile,
  toRank,
  castled,
  enPassant,
  captured
) {
  const fromPiece = pieceMeshes.find((p) => p.file === fromFile && p.rank === fromRank);
  if (!fromPiece) return;

  // Update logical position immediately so rebuildPieces sees the piece at
  // its destination. Mark as animating so rebuildPieces skips it entirely.
  fromPiece.file = toFile;
  fromPiece.rank = toRank;
  animatingPieces.add(fromPiece);

  const startX = fromFile - 3.5,
    startY = 0.01,
    startZ = 3.5 - fromRank;
  const endX = toFile - 3.5,
    endY = 0.01,
    endZ = 3.5 - toRank;
  const duration = 300;
  const startTime = performance.now();

  animations.push({
    update(time) {
      const t = Math.min((time - startTime) / duration, 1);
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      fromPiece.mesh.position.set(
        startX + (endX - startX) * ease,
        startY + (endY - startY) * ease + Math.sin(t * Math.PI) * 0.3,
        startZ + (endZ - startZ) * ease
      );
      if (t >= 1) {
        animatingPieces.delete(fromPiece);
        return true;
      }
      return false;
    },
  });

  // Animate castled rook
  if (castled) {
    const rook = pieceMeshes.find(
      (p) => p.file === castled.from && p.rank === castled.rank && p.type === 'rook'
    );
    if (rook) {
      rook.file = castled.to;
      rook.rank = castled.rank;
      animatingPieces.add(rook);
      const rookStartX = castled.from - 3.5,
        rookStartY = 0.01,
        rookStartZ = 3.5 - castled.rank;
      const rookEndX = castled.to - 3.5,
        rookEndY = 0.01,
        rookEndZ = 3.5 - castled.rank;
      animations.push({
        update(time) {
          const t = Math.min((time - startTime) / duration, 1);
          const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
          rook.mesh.position.set(
            rookStartX + (rookEndX - rookStartX) * ease,
            rookStartY + (rookEndY - rookStartY) * ease,
            rookStartZ + (rookEndZ - rookStartZ) * ease
          );
          if (t >= 1) {
            animatingPieces.delete(rook);
            return true;
          }
          return false;
        },
      });
    }
  }

  // Animate captured piece fading out
  function animateCapture(target) {
    if (!target) return;
    animatingPieces.add(target);
    const startY = target.mesh.position.y;
    const child = target.mesh.children[0];
    // Clone the material so the shared matWhite/matBlack is not mutated
    // (all pieces of the same color share one material instance)
    child.material = child.material.clone();
    child.material.transparent = true;
    animations.push({
      update(time) {
        const t = Math.min((time - startTime) / duration, 1);
        target.mesh.position.y = startY + t * 2;
        child.material.opacity = 1 - t;
        if (t >= 1) {
          // Dispose Three.js resources to avoid memory leaks
          child.geometry?.dispose();
          child.material?.dispose();
          scene.remove(target.mesh);
          const idx = pieceMeshes.indexOf(target);
          if (idx > -1) pieceMeshes.splice(idx, 1);
          animatingPieces.delete(target);
          return true;
        }
        return false;
      },
    });
  }

  if (captured && !enPassant) {
    // Exclude fromPiece — its file/rank was already updated to destination
    const capPiece = pieceMeshes.find(
      (p) => p !== fromPiece && p.file === toFile && p.rank === toRank
    );
    animateCapture(capPiece);
  }

  if (enPassant) {
    const epRank = fromPiece.color === 'white' ? toRank - 1 : toRank + 1;
    const epPawn = pieceMeshes.find(
      (p) => p.file === toFile && p.rank === epRank && p.type === 'pawn'
    );
    animateCapture(epPawn);
  }
}

// ── State update handlers ────────────────────────────────

let _scene = null;

export function setScene(scene) {
  _scene = scene;
}

onStateUpdate(() => {
  if (_scene) rebuildPieces(_scene);
  clearHighlights();
  highlightCheck();
});

onRestart(() => {
  if (_scene && serverBoard && modelsLoaded) rebuildPieces(_scene);
  clearHighlights();
});
