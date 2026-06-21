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

const PIECE_TYPES = ['pawn', 'rook', 'knight', 'bishop', 'queen', 'king'];
const PIECE_CACHE = {};
export const pieceMeshes = [];
export let modelsLoaded = false;

export function loadPieceModels(scene, onReady) {
  const loader = new STLLoader();
  let loaded = 0;
  PIECE_TYPES.forEach(type => {
    loader.load(
      `../files/${type}.stl`,
      geometry => {
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
      err => console.error(`Failed to load ${type}.stl`, err)
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

  // Build a map of existing meshes by position
  const existing = new Map();
  for (const pm of pieceMeshes) {
    const key = `${pm.file},${pm.rank}`;
    existing.set(key, pm);
  }

  // Remove meshes no longer on the board, update changed ones, keep unchanged
  const toKeep = new Set();
  for (const [key, pm] of existing) {
    const desiredPiece = desired.get(key);
    if (!desiredPiece) {
      // Piece no longer exists — remove immediately (no fade for removed pieces)
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

  // Add new pieces that don't have meshes yet
  for (const [key, desiredPiece] of desired) {
    if (!toKeep.has(key)) {
      const [f, r] = key.split(',').map(Number);
      const mesh = createPiece(desiredPiece.type, desiredPiece.color);
      mesh.position.set(f - 3.5, 0.01, 3.5 - r);
      mesh.rotation.y = desiredPiece.color === 'black' ? 0 : Math.PI;
      if (desiredPiece.type === 'knight') mesh.rotation.y += Math.PI / 2;
      scene.add(mesh);
      pieceMeshes.push({ mesh, file: f, rank: r, type: desiredPiece.type, color: desiredPiece.color });
    }
  }

  // Rebuild the pieceMeshes array to remove deleted entries
  const finalMeshes = [];
  for (const pm of pieceMeshes) {
    const key = `${pm.file},${pm.rank}`;
    if (desired.has(key)) {
      finalMeshes.push(pm);
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

export function animateMove(scene, fromFile, fromRank, toFile, toRank, castled, enPassant, captured) {
  const fromPiece = pieceMeshes.find(p => p.file === fromFile && p.rank === fromRank);
  if (!fromPiece) return;

  // Update logical position immediately so rebuildPieces (which runs right after
  // this call) sees the piece at its destination and does not remove it.
  fromPiece.file = toFile;
  fromPiece.rank = toRank;

  const startX = fromFile - 3.5, startY = 0.01, startZ = 3.5 - fromRank;
  const endX = toFile - 3.5, endY = 0.01, endZ = 3.5 - toRank;
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
        return true;
      }
      return false;
    }
  });

  // Animate castled rook
  if (castled) {
    const rook = pieceMeshes.find(p => p.file === castled.from && p.rank === castled.rank && p.type === 'rook');
    if (rook) {
      // Update logical position immediately (same reason as fromPiece above)
      rook.file = castled.to;
      rook.rank = castled.rank;
      const rookStartX = castled.from - 3.5, rookStartY = 0.01, rookStartZ = 3.5 - castled.rank;
      const rookEndX = castled.to - 3.5, rookEndY = 0.01, rookEndZ = 3.5 - castled.rank;
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
            return true;
          }
          return false;
        }
      });
    }
  }

  // Remove captured piece with animation
  if (captured && !enPassant) {
    const capPiece = pieceMeshes.find(p => p.file === toFile && p.rank === toRank);
    if (capPiece) {
      const capStartY = capPiece.mesh.position.y;
      animations.push({
        update(time) {
          const t = Math.min((time - startTime) / duration, 1);
          capPiece.mesh.position.y = capStartY + t * 2;
          capPiece.mesh.children[0].material.opacity = 1 - t;
          capPiece.mesh.children[0].material.transparent = true;
          if (t >= 1) {
            scene.remove(capPiece.mesh);
            const idx = pieceMeshes.indexOf(capPiece);
            if (idx > -1) pieceMeshes.splice(idx, 1);
            return true;
          }
          return false;
        }
      });
    }
  }

  // En passant: remove the captured pawn
  if (enPassant) {
    const epRank = fromPiece.color === 'white' ? toRank - 1 : toRank + 1;
    const epPawn = pieceMeshes.find(p => p.file === toFile && p.rank === epRank && p.type === 'pawn');
    if (epPawn) {
      const epStartY = epPawn.mesh.position.y;
      animations.push({
        update(time) {
          const t = Math.min((time - startTime) / duration, 1);
          epPawn.mesh.position.y = epStartY + t * 2;
          epPawn.mesh.children[0].material.opacity = 1 - t;
          epPawn.mesh.children[0].material.transparent = true;
          if (t >= 1) {
            scene.remove(epPawn.mesh);
            const idx = pieceMeshes.indexOf(epPawn);
            if (idx > -1) pieceMeshes.splice(idx, 1);
            return true;
          }
          return false;
        }
      });
    }
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
