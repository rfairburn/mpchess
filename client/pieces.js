// ═══════════════════════════════════════════════════════════
//  PIECES — 3D model loading, creation, rebuild, animations
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { serverBoard, onStateUpdate, onRestart } from './network.js';
import { clearHighlights, highlightCheck } from './board.js';

// Piece constants (duplicated from server — will be de-duplicated later)
const W_PAWN = 1, W_KNIGHT = 2, W_BISHOP = 3, W_ROOK = 4, W_QUEEN = 5, W_KING = 6;
const B_PAWN = 7, B_KNIGHT = 8, B_BISHOP = 9, B_ROOK = 10, B_QUEEN = 11, B_KING = 12;

function pieceColor(p) { if (p === 0) return null; return p >= 7 ? 'black' : 'white'; }
function pieceType(p) {
  if (p === 0) return null;
  const t = p >= 7 ? p - 7 : p - 1;
  return ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'][t] || null;
}

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
  pieceMeshes.forEach(p => scene.remove(p.mesh));
  pieceMeshes.length = 0;
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const piece = serverBoard[r][f];
      if (piece === 0) continue;
      const color = pieceColor(piece);
      const type = pieceType(piece);
      const mesh = createPiece(type, color);
      mesh.position.set(f - 3.5, 0.01, 3.5 - r);
      mesh.rotation.y = color === 'black' ? 0 : Math.PI;
      if (type === 'knight') mesh.rotation.y += Math.PI / 2;
      scene.add(mesh);
      pieceMeshes.push({ mesh, file: f, rank: r, type, color });
    }
  }
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
        fromPiece.file = toFile;
        fromPiece.rank = toRank;
        return true;
      }
      return false;
    }
  });

  // Animate castled rook
  if (castled) {
    const rook = pieceMeshes.find(p => p.file === castled.from && p.rank === castled.rank && p.type === 'rook');
    if (rook) {
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
            rook.file = castled.to;
            rook.rank = castled.rank;
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
