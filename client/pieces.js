// ═══════════════════════════════════════════════════════════
//  PIECES — 3D model loading, creation, rebuild, animations
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { serverBoard, debugEnabled, onStateUpdate, onRestart, onPromotion } from './network.js';
import { clearHighlights, highlightCheck, highlightPreviousMove } from './board.js';
import { diffBoardState } from './board_diff.js';
import { pieceColor, pieceType } from './chess.mjs';
import { playMove } from './sound.js';

// 3D model set name — directory under files/pieces/3d/
export const MODEL_SETS = [
  'afnafziger',
  'chuckamcknight',
  'jeu',
  'low-poly',
  'ornate',
  'samurai',
  'simple-classic',
];
let _modelSet = 'simple-classic';
export function getModelSet() {
  return _modelSet;
}
// Test-only setter — Object.defineProperty on the module namespace cannot
// update a local binding, so expose a function that can.
export function setModelSet(value) {
  _modelSet = value;
}

// ── 2D SVG piece set ─────────────────────────────────────

// 2D SVG piece set name — directory under files/pieces/2d/
export const SVG_PIECE_SETS = [
  'alpha',
  'anarcandy',
  'caliente',
  'california',
  'cardinal',
  'cburnett',
  'celtic',
  'chess7',
  'chessnut',
  'companion',
  'cooke',
  'disguised',
  'dubrovny',
  'fantasy',
  'firi',
  'fresca',
  'gioco',
  'governor',
  'horsey',
  'icpieces',
  'kiwen-suwi',
  'kosal',
  'leipzig',
  'letter',
  'maestro',
  'merida',
  'monarchy',
  'mono',
  'mpchess',
  'papercut',
  'pirouetti',
  'pixel',
  'reillycraig',
  'rhosgfx',
  'riohacha',
  'shahi-ivory-brown',
  'shapes',
  'spatial',
  'staunty',
  'tatiana',
  'totoy',
  'xkcd',
];
let _svgPieceSet = 'mpchess';
export function getSvgPieceSet() {
  return _svgPieceSet;
}
export function setSvgPieceSet(value) {
  _svgPieceSet = value;
}

// Maps piece IDs (1-12) to file names (without extension)
// 1-6 = white (pawn..king), 7-12 = black (pawn..king)
const PIECE_ID_TO_FILE = {
  1: 'wP',
  2: 'wN',
  3: 'wB',
  4: 'wR',
  5: 'wQ',
  6: 'wK',
  7: 'bP',
  8: 'bN',
  9: 'bB',
  10: 'bR',
  11: 'bQ',
  12: 'bK',
};

// Piece sets that use WebP instead of SVG
const PIECE_SET_EXTENSIONS = {
  monarchy: 'webp',
};

/**
 * Get the file extension for the current SVG piece set.
 * @returns {string}
 */
export function getPieceSetExtension() {
  return PIECE_SET_EXTENSIONS[_svgPieceSet] ?? 'svg';
}

/**
 * Get the asset URL for a given piece file name (without extension).
 * @param {string} fileName
 * @returns {string}
 */
export function getPieceAssetUrl(fileName) {
  const ext = getPieceSetExtension();
  return `files/pieces/2d/${_svgPieceSet}/${fileName}.${ext}`;
}

/**
 * Get the SVG URL for a given piece ID.
 * @param {number} pieceId
 * @returns {string}
 */
export function getPieceSvgUrl(pieceId) {
  const fileName = PIECE_ID_TO_FILE[pieceId];
  if (!fileName) return '';
  return getPieceAssetUrl(fileName);
}

// Materials — set from app.js
let matWhite, matBlack;

/**
 * Set the Three.js materials for white and black pieces.
 * @param {import('three').Material} white
 * @param {import('three').Material} black
 */
export function setMaterials(white, black) {
  matWhite = white;
  matBlack = black;
}

const PIECE_TYPES = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
const PIECE_CACHE = {};
export const pieceMeshes = [];
export let modelsLoaded = false;
// Monotonically increasing generation counter for atomic model loads.
// Both loadPieceModels and reloadPieceModels increment it; stale callbacks
// are discarded so only the latest successful load installs its geometries.
let _modelLoadGeneration = 0;

// Test-only setter — Object.defineProperty on the module namespace cannot
// update a local `export let` binding, so expose a function that can.
export function setModelsLoaded(value) {
  modelsLoaded = value;
}

/**
 * Process a loaded STL geometry: normalize scale, center, compute normals.
 * @param {import('three').BufferGeometry} geometry
 * @param {string} type
 * @returns {import('three').BufferGeometry}
 */
function processGeometry(geometry, type) {
  geometry.computeBoundingBox();
  const size = geometry.boundingBox.getSize(new THREE.Vector3());
  const targetSize = type === 'pawn' ? 0.55 : 0.7;

  // Find base vertices (bottom 5% of height) and compute their center + radius
  const pos = geometry.attributes?.position;
  let baseRadius = 0;
  let baseCx = 0,
    baseCz = 0,
    baseVertexCount = 0;
  if (pos) {
    const epsilon = size.y * 0.05;
    const bottomThreshold = geometry.boundingBox.min.y + epsilon;
    // First pass: find center of base vertices
    let sx = 0,
      sz = 0;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) <= bottomThreshold) {
        sx += pos.getX(i);
        sz += pos.getZ(i);
        baseVertexCount++;
      }
    }
    if (baseVertexCount > 0) {
      baseCx = sx / baseVertexCount;
      baseCz = sz / baseVertexCount;
      // Second pass: find max radius from base center
      for (let i = 0; i < pos.count; i++) {
        if (pos.getY(i) <= bottomThreshold) {
          const r = Math.sqrt((pos.getX(i) - baseCx) ** 2 + (pos.getZ(i) - baseCz) ** 2);
          if (r > baseRadius) baseRadius = r;
        }
      }
    }
  }
  if (baseRadius === 0) baseRadius = Math.max(size.x, size.z) / 2;

  // Center on base center, not bounding box center
  geometry.translate(-baseCx, 0, -baseCz);
  const baseScale = targetSize / (baseRadius * 2);
  geometry.scale(baseScale, baseScale, baseScale);
  geometry.computeBoundingBox();
  geometry.translate(0, -geometry.boundingBox.min.y, 0);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Install a fully-loaded temporary cache into the live PIECE_CACHE.
 * Removes current meshes, disposes old cache, installs new geometries,
 * sets modelsLoaded, and rebuilds pieces.
 * @param {import('three').Scene} scene
 * @param {Object<string, import('three').BufferGeometry>} tempCache
 */
function installCache(scene, tempCache) {
  // Remove all existing piece meshes from the scene
  while (pieceMeshes.length > 0) {
    const pm = pieceMeshes.pop();
    scene.remove(pm.mesh);
    const child = pm.mesh.children[0];
    if (child) {
      // Geometry is shared (PIECE_CACHE) — never dispose here.
      // Material is shared (matWhite/matBlack) except when animateCapture
      // cloned it — check by identity before disposing.
      if (child.material && child.material !== matWhite && child.material !== matBlack) {
        child.material.dispose();
      }
    }
  }

  // Dispose old cache
  for (const key of Object.keys(PIECE_CACHE)) {
    PIECE_CACHE[key].dispose();
    delete PIECE_CACHE[key];
  }

  // Install new cache
  for (const key of Object.keys(tempCache)) PIECE_CACHE[key] = tempCache[key];
  modelsLoaded = true;

  // Cancel any in-flight animations
  animations.length = 0;
  animatingPieces.clear();

  // Rebuild pieces if we have board state
  if (serverBoard) rebuildPieces(scene);
}

/**
 * Shared generation-aware loader used by both loadPieceModels and
 * reloadPieceModels. Loads into a temporary cache; only the latest
 * generation installs its geometries.
 * @param {import('three').Scene} scene
 * @param {string} modelSet
 * @param {() => void} onReady
 * @param {(type: string) => void} onError
 */
function loadModelsInternal(scene, modelSet, onReady, onError) {
  const generation = ++_modelLoadGeneration;
  const tempCache = {};
  let loaded = 0;
  let failed = false;
  const loader = new STLLoader();

  PIECE_TYPES.forEach((type) => {
    loader.load(
      `files/pieces/3d/${modelSet}/${type}.stl`,
      (geometry) => {
        if (failed) {
          geometry.dispose();
          return;
        }
        tempCache[type] = processGeometry(geometry, type);
        loaded++;
        if (loaded === PIECE_TYPES.length) {
          // Discard if a newer load was started while we were loading
          if (generation !== _modelLoadGeneration) {
            for (const key of Object.keys(tempCache)) tempCache[key].dispose();
            onReady();
            return;
          }
          // Install the new cache atomically
          installCache(scene, tempCache);
          onReady();
        }
      },
      undefined,
      (_err) => {
        if (failed) return;
        failed = true;
        onError(type);
        // Discard if a newer load was started while we were loading
        if (generation !== _modelLoadGeneration) {
          for (const key of Object.keys(tempCache)) tempCache[key].dispose();
          onReady();
          return;
        }
        // Dispose any partially loaded temp geometries
        for (const key of Object.keys(tempCache)) tempCache[key].dispose();
        onReady();
      }
    );
  });
}

/**
 * Load all piece STL models. Calls onReady when all are loaded.
 * @param {import('three').Scene} scene
 * @param {() => void} onReady
 */
export function loadPieceModels(scene, onReady) {
  loadModelsInternal(scene, _modelSet, onReady, (type) => {
    console.error(`Failed to load ${type}.stl`);
  });
}

/**
 * Reload all piece STL models for the current model set.
 * Atomic, generation-aware: loads into a temporary cache, discards stale
 * callbacks, and only swaps the cache/meshes after the latest request
 * completes successfully. Preserves existing pieces on failure.
 * @param {import('three').Scene} scene
 * @param {() => void} onReady
 */
export function reloadPieceModels(scene, onReady) {
  loadModelsInternal(scene, _modelSet, onReady, (type) => {
    console.error(`Failed to reload ${type}.stl`);
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

/**
 * Rebuild piece meshes to match the server board state.
 * @param {import('three').Scene} scene
 * @param {boolean} [force] — If true, process animating pieces too (for promotions/restarts)
 */
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

  // Track positions occupied by animating pieces so we don't create duplicates
  const skipPositions = new Set();
  for (const pm of pieceMeshes) {
    if (animatingPieces.has(pm)) {
      skipPositions.add(`${pm.file},${pm.rank}`);
    }
  }

  // Compute the diff between desired state and existing meshes
  const { toRemove, toUpdate, toAdd } = diffBoardState(
    desired,
    pieceMeshes,
    skipPositions,
    force,
    animatingPieces
  );

  // Apply removals — remove from scene and from pieceMeshes
  const toRemoveSet = new Set(toRemove);
  for (const pm of toRemove) {
    scene.remove(pm.mesh);
    if (debugEnabled && typeof console !== 'undefined' && console.debug) {
      console.debug('[rebuildPieces] REMOVED (no longer on board):', `${pm.file},${pm.rank}`);
    }
  }
  // Filter removed pieces out of pieceMeshes before dedup runs
  for (let i = pieceMeshes.length - 1; i >= 0; i--) {
    if (toRemoveSet.has(pieceMeshes[i])) {
      pieceMeshes.splice(i, 1);
    }
  }

  // Apply updates (type/color changed, e.g. promotion)
  for (const entry of toUpdate) {
    const pm = entry.piece;
    {
      scene.remove(pm.mesh);
      const newMesh = createPiece(entry.newType, entry.newColor);
      newMesh.position.copy(pm.mesh.position);
      newMesh.rotation.y = pm.mesh.rotation.y;
      scene.add(newMesh);
      pm.mesh = newMesh;
      pm.type = entry.newType;
      pm.color = entry.newColor;
      if (debugEnabled && typeof console !== 'undefined' && console.debug) {
        console.debug('[rebuildPieces] REPLACED:', {
          key: `${entry.file},${entry.rank}`,
          old: { type: entry.type, color: entry.color },
          new: { type: entry.newType, color: entry.newColor },
        });
      }
    }
  }

  // Apply additions
  for (const entry of toAdd) {
    const mesh = createPiece(entry.type, entry.color);
    mesh.position.set(entry.file - 3.5, 0.01, 3.5 - entry.rank);
    mesh.rotation.y = entry.color === 'black' ? 0 : Math.PI;
    scene.add(mesh);
    pieceMeshes.push({
      mesh,
      file: entry.file,
      rank: entry.rank,
      type: entry.type,
      color: entry.color,
    });
    if (debugEnabled && typeof console !== 'undefined' && console.debug) {
      console.debug('[rebuildPieces] CREATED NEW:', {
        key: `${entry.file},${entry.rank}`,
        type: entry.type,
        color: entry.color,
      });
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

/**
 * Update a piece mesh's position on the board.
 * @param {PieceMesh} pieceObj
 * @param {number} file
 * @param {number} rank
 */
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

// Test-only access to the animating pieces set.
export { animatingPieces as _animatingPieces };

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
        playMove();
        return true;
      }
      return false;
    },
  });
}

/**
 * Animate a piece move, including capture fade-out and castling rook slide.
 * @param {import('three').Scene} scene
 * @param {number} fromFile
 * @param {number} fromRank
 * @param {number} toFile
 * @param {number} toRank
 * @param {{from: number, to: number, rank: number}|null} castled
 * @param {boolean} enPassant
 * @param {boolean} captured
 */
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

/**
 * Set the Three.js scene reference for state update handlers.
 * @param {import('three').Scene} scene
 */
export function setScene(scene) {
  _scene = scene;
}

onStateUpdate(() => {
  if (_scene) rebuildPieces(_scene);
  clearHighlights();
  highlightPreviousMove();
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
