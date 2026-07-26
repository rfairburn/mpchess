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

// ── Controls configuration (from standalone module, re-exported) ──

import { CONTROLS_CONFIG as _CONTROLS_CONFIG } from './controls_config.js';
export { _CONTROLS_CONFIG as CONTROLS_CONFIG };
const CONTROLS_CONFIG = _CONTROLS_CONFIG;

// Backward-compatible export
export const CAMERA_POSITIONS = CONTROLS_CONFIG.cameraPositions;

// ── Camera state ─────────────────────────────────────────

export const keys = {};
export let yaw = 0,
  pitch = 0;
const euler = new THREE.Euler(0, 0, 0, 'YXZ');

export let mouseLookOn = false;

// ── Joystick state (M4.0) ────────────────────────────────

let joystickEnabled = false;

export function setJoystickEnabled(state) {
  joystickEnabled = state;
  updateJoystickVisibility();
}

export function isJoystickEnabled() {
  return joystickEnabled;
}

function updateJoystickVisibility() {
  const joystickEl = document.getElementById('virtual-joystick');
  const lookAreaEl = document.getElementById('virtual-look-area');
  const vJoyEl = document.getElementById('vertical-joystick');
  const show = mouseLookOn && joystickEnabled && !menuOpen;

  if (joystickEl) joystickEl.classList.toggle('visible', show);
  if (lookAreaEl) lookAreaEl.classList.toggle('visible', show);
  if (vJoyEl) vJoyEl.classList.toggle('visible', show);

  // When controls become inactive, clear all touch state to prevent
  // stale input after pointer-lock loss, fullscreen exit, or orientation change.
  if (!show) {
    joystickTouchId = null;
    vJoyTouchId = null;
    lookTouchId = null;
    joystickVector.x = 0;
    joystickVector.y = 0;
    vJoyValue = 0;
    if (joystickStick) {
      joystickStick.style.transform = 'translate(-50%, -50%)';
    }
    if (vJoyThumb) {
      vJoyThumb.style.top = '50%';
      vJoyThumb.style.transform = 'translate(-50%, -50%)';
    }
  }
}

// Tracks whether pointer lock was actually acquired. Used by the
// pointerlockchange handler to distinguish "lock was lost (ESC)" from
// "lock was never available (iPadOS)".
let pointerLockAcquired = false;

export function toggleMouseMode() {
  mouseLookOn = !mouseLookOn;
  updateMouseModeDisplay(mouseLookOn);
  if (mouseLookOn) {
    // Try to acquire pointer lock whenever the API is available.
    // On iPadOS (Safari/Chrome) requestPointerLock does not exist, so
    // this is a no-op and the virtual joystick provides camera control.
    if (_renderer?.domElement?.requestPointerLock) {
      _renderer.domElement.requestPointerLock();
    }
  } else {
    if (document.pointerLockElement) document.exitPointerLock();
  }
  updateJoystickVisibility();
}

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

// Warp camera to a position from CONTROLS_CONFIG.cameraPositions by key
export function warpCamera(key) {
  if (!_camera) return;
  const cfg = CONTROLS_CONFIG.cameraPositions[key];
  if (!cfg) return;

  _camera.position.set(cfg.x, cfg.y, cfg.z);

  if (cfg.euler) {
    // Overhead view: use explicit euler angles for precise orientation
    const _euler = new THREE.Euler(cfg.euler[0], cfg.euler[1], cfg.euler[2], 'YXZ');
    _camera.quaternion.setFromEuler(_euler);
  } else {
    // Standard view: look at target
    _camera.lookAt(cfg.lookAt[0], cfg.lookAt[1], cfg.lookAt[2]);
  }

  // Sync yaw/pitch from the new quaternion
  euler.setFromQuaternion(_camera.quaternion);
  yaw = euler.y;
  pitch = euler.x;
}

export function setCameraForRole(role) {
  const key = CONTROLS_CONFIG.roleKey[role];
  if (key == null) return;
  warpCamera(key);
}

// ── Mouse movement ───────────────────────────────────────

document.addEventListener('mousemove', (e) => {
  if (!mouseLookOn) return;
  if (!_renderer) return;
  if (document.pointerLockElement !== _renderer.domElement) return;
  yaw -= e.movementX * mouseSensitivity;
  pitch -= e.movementY * mouseSensitivity;
  pitch = Math.max(CONTROLS_CONFIG.pitchMin, Math.min(CONTROLS_CONFIG.pitchMax, pitch));
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
    toggleMouseMode();
    return;
  }
  // Camera warp keys: 1-6
  const digitKey = parseInt(e.code.replace('Digit', ''), 10);
  if (digitKey >= 1 && digitKey <= 6) {
    warpCamera(digitKey);
    return;
  }
});

document.addEventListener('keyup', (e) => {
  keys[e.code] = false;
});

document.addEventListener('pointerlockchange', () => {
  if (!_renderer) return;
  const locked = document.pointerLockElement === _renderer.domElement;
  if (locked) {
    // Pointer lock was acquired — track it so we can detect loss.
    pointerLockAcquired = true;
    if (!mouseLookOn) {
      mouseLookOn = true;
      updateMouseModeDisplay(mouseLookOn);
      updateJoystickVisibility();
    }
  } else {
    // Always clear the acquired flag when unlocked, regardless of
    // mouseLookOn state.  If Camera Mode was manually toggled off
    // before this event fires, we must still clear the stale flag
    // so a subsequent unlock event does not re-trigger mode exit.
    const wasAcquired = pointerLockAcquired;
    pointerLockAcquired = false;
    if (mouseLookOn && wasAcquired) {
      // Pointer lock was lost while in Camera Mode (e.g. ESC) — exit.
      mouseLookOn = false;
      updateMouseModeDisplay(mouseLookOn);
      updateJoystickVisibility();
    }
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
      // Re-acquire pointer lock if available (e.g. after clicking away).
      // On iPadOS this is a no-op — virtual joystick handles camera control.
      if (renderer.domElement.requestPointerLock) {
        renderer.domElement.requestPointerLock();
      }
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

const DRAG_THRESHOLD = CONTROLS_CONFIG.dragThreshold;
const DRAG_HEIGHT = CONTROLS_CONFIG.dragHeight;

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

// ── Touch helpers for drag-to-move ──────────────────────
// Do NOT call preventDefault() on touchstart — that would suppress the
// compatibility click generated after a tap, breaking tap-to-select and
// tap-to-move.  Instead, rely on touch-action: none on the canvas to
// prevent scroll/zoom, and only call preventDefault() in touchmove once
// the drag threshold is crossed.

function touchStartHandler(event) {
  if (menuOpen || serverPromotingPiece || serverGameOver || mouseLookOn) return;
  if (!serverBoard) return;

  const t = event.touches[0];
  dragStartX = t.clientX;
  dragStartY = t.clientY;

  const sq = getBoardSquareFromRay(t);
  if (!sq) return;
  const { file, rank } = sq;
  const piece = serverBoard[rank][file];

  if (piece === 0 || pieceColor(piece) !== myRole || myRole !== serverTurn) return;

  dragCandidate = { file, rank };
  dragging = false;
  dragPiece = null;
  dragStartPos = null;
}

function touchMoveHandler(event) {
  if (!dragCandidate && !dragging) return;

  const t = event.touches[0];

  // Only preventDefault once the drag threshold is crossed — before that,
  // let the browser generate a compatibility click for a simple tap.
  if (!dragging) {
    const dx = t.clientX - dragStartX;
    const dy = t.clientY - dragStartY;
    if (Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) return;
  }
  event.preventDefault();
  onDragMove(t);
}

function touchEndHandler(event) {
  if (!dragging && !dragCandidate) return;
  const t = event.changedTouches[0];
  const wasCommittedDrag = dragging;
  onDragEnd(t);

  // If this was a committed drag, suppress the compatibility click by
  // calling preventDefault() on touchend, and clear dragCompleted so
  // the next tap's click is not discarded.
  if (wasCommittedDrag) {
    event.preventDefault();
    dragCompleted = false;
  }
  // For below-threshold taps (candidate only), do NOT call preventDefault()
  // so the browser fires a compatibility click for normal tap-to-select.
}

function touchCancelHandler() {
  dragCandidate = null;
  if (dragging && dragPiece) {
    const pm = pieceMeshes.find((p) => p.file === dragPiece.file && p.rank === dragPiece.rank);
    if (pm && dragStartPos) {
      pm.mesh.position.set(dragStartPos.x, dragStartPos.y, dragStartPos.z);
    }
    dragging = false;
    dragPiece = null;
    dragStartPos = null;
  }
  selectedSquare = null;
  validMoves = [];
  clearHighlights();
  highlightCheck();
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

  // ── Touch handlers for drag-to-move ──
  renderer.domElement.addEventListener('touchstart', touchStartHandler, { passive: false });
  document.addEventListener('touchmove', touchMoveHandler, { passive: false });
  document.addEventListener('touchend', touchEndHandler, { passive: false });
  document.addEventListener('touchcancel', touchCancelHandler);

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

// ── M4.1 — Virtual joystick touch handlers ───────────────

const joystickBase = document.getElementById('joystick-base');
const joystickStick = document.getElementById('joystick-stick');
const lookArea = document.getElementById('virtual-look-area');
const vJoyTrack = document.getElementById('vjoy-track');
const vJoyThumb = document.getElementById('vjoy-thumb');

let joystickTouchId = null;
let lookTouchId = null;
let vJoyTouchId = null;
let joystickCenterX = 0;
let joystickCenterY = 0;
let joystickVector = { x: 0, y: 0 }; // normalized -1..1
const JOYSTICK_RADIUS = 50; // half of 100px base
let lookPrevX = 0;
let lookPrevY = 0;
let vJoyValue = 0; // normalized -1..1 (up=+1, down=-1)

function handleJoystickStart(e) {
  if (!mouseLookOn || !joystickEnabled) return;
  const t = e.changedTouches?.[0] || e.touches?.[0];
  if (!t) return;
  joystickTouchId = t.identifier;
  const rect = joystickBase.getBoundingClientRect();
  joystickCenterX = rect.left + rect.width / 2;
  joystickCenterY = rect.top + rect.height / 2;
  handleJoystickMove(e);
}

function handleJoystickMove(e) {
  if (joystickTouchId === null) return;
  for (const t of e.touches) {
    if (t.identifier === joystickTouchId) {
      let dx = t.clientX - joystickCenterX;
      let dy = t.clientY - joystickCenterY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > JOYSTICK_RADIUS) {
        dx = (dx / dist) * JOYSTICK_RADIUS;
        dy = (dy / dist) * JOYSTICK_RADIUS;
      }
      joystickStick.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      joystickVector.x = dx / JOYSTICK_RADIUS;
      joystickVector.y = dy / JOYSTICK_RADIUS;
      break;
    }
  }
}

function handleJoystickEnd(e) {
  for (const t of e.changedTouches) {
    if (t.identifier === joystickTouchId) {
      joystickTouchId = null;
      joystickStick.style.transform = 'translate(-50%, -50%)';
      joystickVector.x = 0;
      joystickVector.y = 0;
      break;
    }
  }
}

function handleVJoyStart(e) {
  if (!mouseLookOn || !joystickEnabled) return;
  const t = e.changedTouches?.[0] || e.touches?.[0];
  if (!t) return;
  vJoyTouchId = t.identifier;
  handleVJoyMove(e);
}

function handleVJoyMove(e) {
  if (vJoyTouchId === null) return;
  const trackRect = vJoyTrack.getBoundingClientRect();
  const trackHeight = trackRect.height;
  for (const t of e.touches) {
    if (t.identifier === vJoyTouchId) {
      // Normalize touch Y within the track: -1 (top) to +1 (bottom)
      let val = ((t.clientY - trackRect.top) / trackHeight) * 2 - 1;
      val = Math.max(-1, Math.min(1, val));
      vJoyValue = val;
      // Position thumb
      const pct = (val + 1) / 2; // 0..1
      vJoyThumb.style.top = `${pct * 100}%`;
      vJoyThumb.style.transform = 'translate(-50%, -50%)';
      break;
    }
  }
}

function handleVJoyEnd(e) {
  for (const t of e.changedTouches) {
    if (t.identifier === vJoyTouchId) {
      vJoyTouchId = null;
      vJoyValue = 0;
      vJoyThumb.style.top = '50%';
      vJoyThumb.style.transform = 'translate(-50%, -50%)';
      break;
    }
  }
}

if (joystickBase) {
  joystickBase.addEventListener('touchstart', handleJoystickStart, { passive: false });
  document.addEventListener('touchmove', handleJoystickMove, { passive: false });
  document.addEventListener('touchend', handleJoystickEnd, { passive: false });
  document.addEventListener('touchcancel', handleJoystickEnd);
}

if (vJoyTrack) {
  vJoyTrack.addEventListener('touchstart', handleVJoyStart, { passive: false });
  document.addEventListener(
    'touchmove',
    function (e) {
      if (vJoyTouchId !== null) {
        e.preventDefault();
        handleVJoyMove(e);
      }
    },
    { passive: false }
  );
  document.addEventListener('touchend', handleVJoyEnd, { passive: false });
  document.addEventListener('touchcancel', handleVJoyEnd);
}

// ── Look area: touch-drag for yaw/pitch (mouse look) ────

function handleLookStart(e) {
  if (!mouseLookOn || !joystickEnabled) return;
  // Only handle touches that started directly on the look area,
  // not on child elements like the vertical joystick.
  if (e.target !== lookArea) return;
  const t = e.changedTouches?.[0] || e.touches?.[0];
  if (!t) return;
  lookTouchId = t.identifier;
  lookPrevX = t.clientX;
  lookPrevY = t.clientY;
}

function handleLookMove(e) {
  if (lookTouchId === null) return;
  for (const t of e.changedTouches) {
    if (t.identifier === lookTouchId) {
      const dx = t.clientX - lookPrevX;
      const dy = t.clientY - lookPrevY;
      lookPrevX = t.clientX;
      lookPrevY = t.clientY;
      yaw -= dx * mouseSensitivity * 3;
      pitch -= dy * mouseSensitivity * 3;
      pitch = Math.max(CONTROLS_CONFIG.pitchMin, Math.min(CONTROLS_CONFIG.pitchMax, pitch));
      break;
    }
  }
}

function handleLookEnd(e) {
  for (const t of e.changedTouches) {
    if (t.identifier === lookTouchId) {
      lookTouchId = null;
      break;
    }
  }
}

if (lookArea) {
  lookArea.addEventListener('touchstart', handleLookStart, { passive: false });
  document.addEventListener(
    'touchmove',
    function (e) {
      if (lookTouchId !== null) {
        e.preventDefault();
        handleLookMove(e);
      }
    },
    { passive: false }
  );
  document.addEventListener('touchend', handleLookEnd, { passive: false });
  document.addEventListener('touchcancel', handleLookEnd);
}

// ── M4.1 — Apply joystick WASD movement in animation loop ─

export function getJoystickVector() {
  return { ...joystickVector };
}

export function getVJoyValue() {
  return vJoyValue;
}

// ── M4.2 — Camera position buttons ──────────────────────

document.addEventListener('click', (e) => {
  const btn = e.target.closest('#camera-positions button');
  if (btn) {
    const pos = parseInt(btn.dataset.pos, 10);
    if (pos >= 1 && pos <= 6) {
      warpCamera(pos);
    }
  }
});
