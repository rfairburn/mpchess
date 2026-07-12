// ═══════════════════════════════════════════════════════════
//  CONTROLS — keyboard, mouse, raycasting, click handling, move validation
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import {
  myRole,
  serverBoard,
  serverTurn,
  serverPromotingPiece,
  serverGameOver,
  castlingRights,
  enPassantTarget,
  sendMove,
  onRestart,
  onStateUpdate,
} from './network.js';
import {
  menuOpen,
  showMenu,
  hideMenu,
  updateMouseModeDisplay,
  hidePromotionPicker,
  hideConcedeConfirm,
  mouseSensitivity,
  showError,
} from './ui.js';
import {
  squares,
  clearHighlights,
  highlightSelected,
  highlightValidMoves,
  highlightCheck,
} from './board.js';
import { pieceColor, getValidMoves } from './chess.mjs';
import { pieceMeshes } from './pieces.js';

// ── Camera state ─────────────────────────────────────────

export const keys = {};
export let yaw = 0,
  pitch = 0;
const euler = new THREE.Euler(0, 0, 0, 'YXZ');

export let mouseLookOn = false;
let _renderer = null;
let _camera = null;
let _hud = null;

export function setRenderer(renderer, camera) {
  _renderer = renderer;
  _camera = camera;
  _hud = document.getElementById('hud');
  _hud.classList.remove('hidden');

  // Init yaw/pitch from camera quaternion
  euler.setFromQuaternion(camera.quaternion);
  yaw = euler.y;
  pitch = euler.x;
}

// Camera starting positions per role
const CAM_POS = {
  spectator: { x: -10, y: 7, z: 0 }, // west side, between ranks 4-5, rank labels visible
  white: { x: 0, y: 7, z: 10 }, // south side, between files d-e
  black: { x: 0, y: 7, z: -10 }, // north side, between files d-e
};

export function setCameraForRole(role) {
  if (!_camera) return;
  const p = CAM_POS[role];
  if (!p) return;

  _camera.position.set(p.x, p.y, p.z);
  _camera.lookAt(0, 0, 0);

  // Sync yaw/pitch from the new quaternion
  euler.setFromQuaternion(_camera.quaternion);
  yaw = euler.y;
  pitch = euler.x;
}

// ── Mouse movement ───────────────────────────────────────

document.addEventListener('mousemove', (e) => {
  if (!mouseLookOn) return;
  if (!_renderer) return;
  if (document.pointerLockElement !== _renderer.domElement) return;
  yaw -= e.movementX * mouseSensitivity;
  pitch -= e.movementY * mouseSensitivity;
  pitch = Math.max(-Math.PI / 2.1, Math.min(Math.PI / 2.1, pitch));
});

// ── Keyboard ─────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Escape') {
    if (menuOpen) {
      hideMenu();
    } else {
      showMenu();
    }
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

document.addEventListener('keyup', (e) => {
  keys[e.code] = false;
});

document.addEventListener('pointerlockchange', () => {
  if (!_renderer) return;
  const locked = document.pointerLockElement === _renderer.domElement;
  if (!locked && mouseLookOn) {
    mouseLookOn = false;
    updateMouseModeDisplay(mouseLookOn);
  }
});

// ── Raycasting ───────────────────────────────────────────

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
// Built lazily after createBoard() populates the squares array — avoids
// allocating a 64-item array on every click.
let allSquares = null;
function ensureAllSquares() {
  if (!allSquares) {
    allSquares = [];
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) allSquares.push(squares[r][f]);
  }
}

export let selectedSquare = null;
export let validMoves = [];

// ── Drag state ───────────────────────────────────────────

let dragging = false; // true once drag threshold is crossed
let dragCandidate = null; // { file, rank } — piece under mousedown (not yet committed)
let dragPiece = null; // { file, rank } — committed drag piece (after threshold)
let dragStartPos = null; // { x, y, z } — original 3D position of committed piece
let dragStartX = 0; // clientX at mousedown
let dragStartY = 0; // clientY at mousedown
let dragCompleted = false; // true after a committed drag mouseup (suppresses click)

function getBoardSquareFromRay(event) {
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, _camera);
  ensureAllSquares();
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

// ── Click handler ────────────────────────────────────────

export function setClickHandler(renderer) {
  _renderer = renderer;
  renderer.domElement.addEventListener('click', (event) => {
    if (menuOpen) return;
    if (serverPromotingPiece) return;
    if (serverGameOver) return;
    if (dragCompleted) {
      dragCompleted = false;
      return;
    }
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
      // Clicking the same piece again deselects it
      if (selectedSquare.file === file && selectedSquare.rank === rank) {
        selectedSquare = null;
        validMoves = [];
        clearHighlights();
        highlightCheck();
        return;
      }
      const isValid = validMoves.some((m) => m.file === file && m.rank === rank);
      if (!isValid) {
        // Clicked an invalid square — if it's one of our pieces on our turn, select it instead
        if (piece !== 0 && pieceColor(piece) === myRole && myRole === serverTurn) {
          selectedSquare = { file, rank };
          validMoves = getValidMoves(
            serverBoard.map((r) => [...r]),
            file,
            rank,
            castlingRights,
            enPassantTarget
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
        return;
      }
      sendMove(selectedSquare.file, selectedSquare.rank, file, rank);
      selectedSquare = null;
      validMoves = [];
      clearHighlights();
      highlightCheck();
      return;
    }

    if (piece !== 0 && pieceColor(piece) === myRole && myRole === serverTurn) {
      selectedSquare = { file, rank };
      validMoves = getValidMoves(
        serverBoard.map((r) => [...r]),
        file,
        rank,
        castlingRights,
        enPassantTarget
      );
      clearHighlights();
      highlightSelected(file, rank);
      highlightValidMoves(validMoves);
    } else {
      selectedSquare = null;
      validMoves = [];
      clearHighlights();
      highlightCheck();
      // Immediate local feedback when clicking on own piece but it's not your turn
      if (myRole && piece !== 0 && pieceColor(piece) === myRole && myRole !== serverTurn) {
        showError('Not your turn');
      }
    }
  });
}

// ── Drag-to-move handlers ────────────────────────────────

const DRAG_THRESHOLD = 5; // pixels — movement below this is treated as a click
const DRAG_HEIGHT = 0.6; // piece elevation during drag

function commitDrag() {
  // Transition from candidate to committed drag: select, highlight, lift piece
  if (!dragCandidate) return;
  const { file, rank } = dragCandidate;

  selectedSquare = { file, rank };
  validMoves = getValidMoves(
    serverBoard.map((r) => [...r]),
    file,
    rank,
    castlingRights,
    enPassantTarget
  );
  clearHighlights();
  highlightSelected(file, rank);
  highlightValidMoves(validMoves);

  const pm = pieceMeshes.find((p) => p.file === file && p.rank === rank);
  if (!pm) {
    // No mesh found — abort drag
    dragCandidate = null;
    return;
  }

  dragging = true;
  dragPiece = { file, rank };
  dragStartPos = { x: pm.mesh.position.x, y: pm.mesh.position.y, z: pm.mesh.position.z };
  pm.mesh.position.y = DRAG_HEIGHT;
  dragCandidate = null;
}

function onDragMove(event) {
  if (!dragCandidate && !dragging) return;

  // Check if mouse moved beyond threshold (only matters before commit)
  if (!dragging) {
    const dx = event.clientX - dragStartX;
    const dy = event.clientY - dragStartY;
    if (Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) return;
    commitDrag();
    if (!dragging) return; // commit may have aborted
  }

  if (!dragPiece) return;

  // Raycast to find position under cursor
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, _camera);
  ensureAllSquares();
  const hits = raycaster.intersectObjects(allSquares);
  if (hits.length > 0) {
    const pm = pieceMeshes.find((p) => p.file === dragPiece.file && p.rank === dragPiece.rank);
    if (pm) {
      // Check if hovering over a valid destination — snap to square center
      const x = hits[0].point.x + 3.5;
      const z = 3.5 - hits[0].point.z;
      const file = Math.round(x);
      const rank = Math.round(z);
      const isValidTarget =
        file >= 0 &&
        file < 8 &&
        rank >= 0 &&
        rank < 8 &&
        validMoves.some((m) => m.file === file && m.rank === rank);

      if (isValidTarget) {
        pm.mesh.position.set(file - 3.5, DRAG_HEIGHT, 3.5 - rank);
      } else {
        pm.mesh.position.set(hits[0].point.x, DRAG_HEIGHT, hits[0].point.z);
      }
    }
  }
}

function onDragEnd(event) {
  if (!dragging && !dragCandidate) return;

  // Check if this was a committed drag or just a candidate (click)
  if (!dragging) {
    // Never crossed threshold — release candidate, let click handler handle selection
    dragCandidate = null;
    return;
  }

  dragging = false;
  dragCompleted = true;

  // Find the square under the cursor
  const sq = getBoardSquareFromRay(event);
  const pm = pieceMeshes.find((p) => p.file === dragPiece.file && p.rank === dragPiece.rank);

  if (sq && validMoves.some((m) => m.file === sq.file && m.rank === sq.rank)) {
    // Valid drop — execute the move
    sendMove(dragPiece.file, dragPiece.rank, sq.file, sq.rank);
    selectedSquare = null;
    validMoves = [];
    clearHighlights();
    highlightCheck();
  } else {
    // Invalid drop — return piece to original position
    if (pm && dragStartPos) {
      pm.mesh.position.set(dragStartPos.x, dragStartPos.y, dragStartPos.z);
    }
    selectedSquare = null;
    validMoves = [];
    clearHighlights();
    highlightCheck();
  }

  dragPiece = null;
  dragStartPos = null;
}

export function setDragHandlers(renderer) {
  _renderer = renderer;

  renderer.domElement.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return; // only left button
    if (menuOpen || serverPromotingPiece || serverGameOver || mouseLookOn) return;
    if (!serverBoard) return;

    dragStartX = event.clientX;
    dragStartY = event.clientY;

    const sq = getBoardSquareFromRay(event);
    if (!sq) return;
    const { file, rank } = sq;
    const piece = serverBoard[rank][file];

    if (piece === 0 || pieceColor(piece) !== myRole || myRole !== serverTurn) return;

    // Store as candidate — do NOT select yet (click handler will handle that)
    dragCandidate = { file, rank };
    dragging = false;
    dragPiece = null;
    dragStartPos = null;
  });

  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragEnd);
}

// ── Cancel drag on board state change ────────────────────

onStateUpdate(() => {
  if (dragging && dragPiece) {
    const pm = pieceMeshes.find((p) => p.file === dragPiece.file && p.rank === dragPiece.rank);
    if (pm && dragStartPos) {
      pm.mesh.position.set(dragStartPos.x, dragStartPos.y, dragStartPos.z);
    }
    dragging = false;
    dragPiece = null;
    dragStartPos = null;
  }
  dragCandidate = null;
});

// ── Restart handler ──────────────────────────────────────

onRestart(() => {
  selectedSquare = null;
  validMoves = [];
  hidePromotionPicker();
  hideConcedeConfirm();
  clearHighlights();
  dragging = false;
  dragCandidate = null;
  dragPiece = null;
  dragStartPos = null;
  dragCompleted = false;
});
