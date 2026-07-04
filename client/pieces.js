// ═══════════════════════════════════════════════════════════
//  PIECES — 3D model loading, creation, rebuild, animations
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { serverBoard, debugEnabled, onStateUpdate, onRestart, onPromotion } from './network.js';
import { clearHighlights, highlightCheck } from './board.js';
import { pieceColor, pieceType } from './chess.mjs';

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

// Test-only setter — Object.defineProperty on the module namespace cannot
// update a local `export let` binding, so expose a function that can.
export function setModelsLoaded(value) {
  modelsLoaded = value;
}

export function loadPieceModels(scene, onReady) {
  const loader = new STLLoader();
  let loaded = 0;
  PIECE_TYPES.forEach((type) => {
    loader.load(
      `files/${type}.stl`,
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

export function rebuildPieces(scene, force = false) {
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

  // Debug: Log desired board state
  if (debugEnabled && typeof console !== 'undefined' && console.debug) {
    const desiredState = [];
    for (const [key, piece] of desired) {
      desiredState.push({ key, type: piece.type, color: piece.color });
    }
    console.debug('[rebuildPieces] DESIRED board state:', desiredState);
  }

  // Build a list of existing meshes by position (not a Map — multiple pieces
  // can occupy the same square during animations, e.g. capture).
  const existing = [];
  for (const pm of pieceMeshes) {
    existing.push(pm);
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

  for (const pm of existing) {
    const isAnimating = animatingPieces.has(pm);
    const key = `${pm.file},${pm.rank}`;

    // Debug: Log each piece being processed
    if (debugEnabled && typeof console !== 'undefined' && console.debug) {
      console.debug('[rebuildPieces] Processing piece:', {
        key,
        type: pm.type,
        color: pm.color,
        isAnimating,
        force,
      });
    }

    // When force=true (promotion / restart), update animating pieces too so
    // the mesh type matches the authoritative serverBoard immediately.
    // Otherwise skip animating pieces — let animations handle their own cleanup
    // (capture fade-out, slide completion, etc.)
    if (isAnimating && !force) {
      toKeep.add(key);
      if (debugEnabled && typeof console !== 'undefined' && console.debug) {
        console.debug('[rebuildPieces] SKIPPED (animating, force=false):', key);
      }
      continue;
    }

    const desiredPiece = desired.get(key);
    if (!desiredPiece) {
      // Piece no longer exists — remove
      scene.remove(pm.mesh);
      if (debugEnabled && typeof console !== 'undefined' && console.debug) {
        console.debug('[rebuildPieces] REMOVED (no longer on board):', key);
      }
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
      if (debugEnabled && typeof console !== 'undefined' && console.debug) {
        console.debug('[rebuildPieces] REPLACED:', {
          key,
          old: { type: pm.type, color: pm.color },
          new: { type: desiredPiece.type, color: desiredPiece.color },
        });
      }
    } else {
      // Unchanged
      toKeep.add(key);
      if (debugEnabled && typeof console !== 'undefined' && console.debug) {
        console.debug('[rebuildPieces] KEPT (unchanged):', key);
      }
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
      if (debugEnabled && typeof console !== 'undefined' && console.debug) {
        console.debug('[rebuildPieces] CREATED NEW:', {
          key,
          type: desiredPiece.type,
          color: desiredPiece.color,
        });
      }
    }
  }

  // Rebuild the pieceMeshes array: keep animating pieces + pieces in desired state.
  // De-duplicate by position — if two meshes occupy the same square, the last one
  // wins (newest data is most correct). The losing duplicate's mesh is removed
  // from the scene to prevent orphaned geometry.
  const animating = [];
  const byPosition = new Map();
  for (const pm of pieceMeshes) {
    if (animatingPieces.has(pm)) {
      animating.push(pm);
    } else {
      const key = `${pm.file},${pm.rank}`;
      if (desired.has(key)) {
        const existing = byPosition.get(key);
        if (existing) {
          // Duplicate at same position — remove the losing mesh from the scene
          scene.remove(existing.mesh);
        }
        byPosition.set(key, pm);
      }
    }
  }
  pieceMeshes.length = 0;
  pieceMeshes.push(...animating, ...byPosition.values());

  // Debug: Log final pieceMeshes state
  if (debugEnabled && typeof console !== 'undefined' && console.debug) {
    const finalState = [];
    for (const pm of pieceMeshes) {
      finalState.push({ key: `${pm.file},${pm.rank}`, type: pm.type, color: pm.color });
    }
    console.debug('[rebuildPieces] FINAL pieceMeshes:', finalState);
  }
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

// Create a slide animation for a piece from one square to another.
// arcHeight adds a vertical arc (default 0 = flat slide).
function createSlideAnimation(
  piece,
  startX,
  startY,
  startZ,
  endX,
  endY,
  endZ,
  startTime,
  duration,
  arcHeight = 0
) {
  animations.push({
    update(time) {
      const t = Math.min((time - startTime) / duration, 1);
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      piece.mesh.position.set(
        startX + (endX - startX) * ease,
        startY + (endY - startY) * ease + arcHeight * Math.sin(t * Math.PI),
        startZ + (endZ - startZ) * ease
      );
      if (t >= 1) {
        animatingPieces.delete(piece);
        return true;
      }
      return false;
    },
  });
}

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

  createSlideAnimation(
    fromPiece,
    startX,
    startY,
    startZ,
    endX,
    endY,
    endZ,
    startTime,
    duration,
    0.3
  );

  // Animate castled rook
  if (castled) {
    const rook = pieceMeshes.find(
      (p) => p.file === castled.from && p.rank === castled.rank && p.type === 'rook'
    );
    if (rook) {
      rook.file = castled.to;
      rook.rank = castled.rank;
      animatingPieces.add(rook);
      createSlideAnimation(
        rook,
        castled.from - 3.5,
        0.01,
        3.5 - castled.rank,
        castled.to - 3.5,
        0.01,
        3.5 - castled.rank,
        startTime,
        duration
      );
    }
  }

  // Animate captured piece fading out
  function animateCapture(target) {
    if (!target) return;
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
    // Mark captured piece as animating IMMEDIATELY so rebuildPieces won't
    // remove it from the scene before the fade-out animation starts.
    if (capPiece) animatingPieces.add(capPiece);
    animateCapture(capPiece);
  }

  if (enPassant) {
    const epRank = fromPiece.color === 'white' ? toRank - 1 : toRank + 1;
    const epPawn = pieceMeshes.find(
      (p) => p.file === toFile && p.rank === epRank && p.type === 'pawn'
    );
    if (epPawn) animatingPieces.add(epPawn);
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
  // Brute-force re-sync: nuke all client-side piece meshes and rebuild from
  // server state. This prevents duplicate pieces on the same square (a
  // client-only desync that can occur after promotions).
  if (_scene && serverBoard && modelsLoaded) {
    // Cancel in-flight animations — their callbacks won't fire, so any
    // cloned capture materials won't get their normal dispose() path.
    animations.length = 0;
    animatingPieces.clear();

    // Remove every piece mesh from the scene with proper cleanup
    while (pieceMeshes.length > 0) {
      const pm = pieceMeshes.pop();
      _scene.remove(pm.mesh);
      // Dispose resources. Geometry is shared (PIECE_CACHE) — never dispose.
      // Material is shared (matWhite/matBlack) except when animateCapture
      // cloned it — check by identity before disposing.
      const child = pm.mesh.children[0];
      if (child) {
        if (child.material && child.material !== matWhite && child.material !== matBlack) {
          child.material.dispose();
        }
      }
    }

    rebuildPieces(_scene, true);
  }
  clearHighlights();
});

onPromotion((_msg) => {
  // The server confirmed the promoted piece type. Force rebuild so the
  // animating pawn mesh is immediately updated to the promoted piece type.
  if (_scene) rebuildPieces(_scene, true);
});
