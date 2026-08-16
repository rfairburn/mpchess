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
  sendPremove,
  cancelPremove,
  onRestart,
  onStateUpdate,
} from './network.js';
import { getPremove } from './premove.js';
import {
  menuOpen,
  helpOpen,
  settingsOpen,
  showMenu,
  hideMenu,
  hideHelp,
  hideSettings,
  updateMouseModeDisplay,
  hidePromotionPicker,
  hideConcedeConfirm,
  mouseSensitivity,
  showError,
  showPromotionPicker,
} from './ui.js';
import { t } from '../shared/i18n.mjs';
import { saveAndHide2DBoard, restore2DBoard } from './board_2d.js';
import {
  squares,
  clearHighlights as clearBoardHighlights,
  highlightSelected as highlightSelected3D,
  highlightValidMoves as highlightValidMoves3D,
  highlightCheck as highlightCheck3D,
  highlightPreviousMove as highlightPreviousMove3D,
  highlightPremoveSelected as highlightPremoveSelected3D,
  highlightPremoveMoves as highlightPremoveMoves3D,
} from './board.js';
import { createHighlightOrchestrator, bindSelectionChange } from './highlight-orchestration.js';
import { pieceColor, pieceType, getValidMoves, getPremoveMoves } from '../shared/chess.mjs';
import { pieceMeshes } from './pieces.js';
import { playMove } from './sound.js';
import { addArrow, clearArrows, getArrowColor } from './arrows.js';
import {
  addHighlight,
  clearHighlights as clearSquareHighlights,
  getHighlightColor,
} from './highlights.js';
import {
  setSelectedSquare,
  getSelectedSquare,
  getValidMovesList,
  getSelectionMode,
  onSelectionChange,
} from './selection.js';

// ── Controls configuration (from standalone module, re-exported) ──

import { CONTROLS_CONFIG as _CONTROLS_CONFIG } from './controls_config.js';
export { _CONTROLS_CONFIG as CONTROLS_CONFIG };
const CONTROLS_CONFIG = _CONTROLS_CONFIG;
import { hasPointerLock } from './capabilities.js';

// Backward-compatible export
export const CAMERA_POSITIONS = CONTROLS_CONFIG.cameraPositions;

// ── Camera state ─────────────────────────────────────────

export const keys = {};
export let yaw = 0,
  pitch = 0;
const euler = new THREE.Euler(0, 0, 0, 'YXZ');

export let mouseLookOn = false;

// ── Joystick state (M4.0) ────────────────────────────────

let joystickEnabled = navigator.maxTouchPoints > 0;

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
  const show = mouseLookOn && joystickEnabled && !menuOpen && !helpOpen && !settingsOpen;

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
    saveAndHide2DBoard();
    // Try to acquire pointer lock whenever the API is available.
    // On iPadOS (Safari/Chrome) requestPointerLock does not exist, so
    // this is a no-op and the virtual joystick provides camera control.
    if (hasPointerLock(_renderer?.domElement)) {
      _renderer.domElement.requestPointerLock();
    }
  } else {
    restore2DBoard();
    if (document.pointerLockElement) document.exitPointerLock();
  }
  updateJoystickVisibility();
}

let _renderer = null;
let _camera = null;
let _scene = null;
let _hud = null;

export function setScene(scene) {
  _scene = scene;
}

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

export function clearHeldKeys() {
  for (const code of Object.keys(keys)) {
    keys[code] = false;
  }
}

export function handleKeyDown(e) {
  // When settings is open, only Escape closes it; all other game shortcuts
  // and movement keys are suppressed. Tab navigates the form naturally.
  if (settingsOpen) {
    if (e.code === 'Escape') {
      hideSettings();
    }
    return;
  }
  // When help is open, only Escape is allowed (to close it); all other
  // game shortcuts and movement keys are suppressed.
  if (helpOpen) {
    if (e.code === 'Escape') {
      hideHelp();
    }
    return;
  }
  keys[e.code] = true;
  if (e.code === 'Escape') {
    if (menuOpen) {
      hideMenu();
    } else if (getPremove()) {
      // ESC cancels a confirmed premove (instead of opening the menu).
      // Existing behavior is preserved: an open menu still closes, and with
      // no premove pending ESC still opens the menu.
      cancelPremove();
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
}

document.addEventListener('keydown', handleKeyDown);

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
      saveAndHide2DBoard();
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
      restore2DBoard();
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

// ── Highlight orchestrator (3D) ──────────────────────────

const orchestrator = createHighlightOrchestrator({
  clearHighlights: clearBoardHighlights,
  highlightPreviousMove: highlightPreviousMove3D,
  highlightSelected: highlightSelected3D,
  highlightValidMoves: (moves) => {
    if (_scene) highlightValidMoves3D(_scene, moves);
  },
  highlightCheck: highlightCheck3D,
  // Off-turn (premode) selection uses the dedicated deep-blue premove
  // materials; on-turn rendering keeps the normal selected/valid/capture
  // highlights.
  highlightPremoveSelected: highlightPremoveSelected3D,
  highlightPremoveMoves: (moves) => {
    if (_scene) highlightPremoveMoves3D(_scene, moves);
  },
});
bindSelectionChange(orchestrator, () => !!_scene);

// Selection state is now in selection.js — re-export for backward compat
export let selectedSquare;
export let validMoves;

// Sync exports with shared state (updated via selection change callbacks)
function syncSelectionExports() {
  selectedSquare = getSelectedSquare();
  validMoves = getValidMovesList();
}
syncSelectionExports();

// Keep exports in sync
onSelectionChange(syncSelectionExports);

// ── Drag state ───────────────────────────────────────────

let dragging = false; // true once drag threshold is crossed
let dragCandidate = null; // { file, rank } — piece under mousedown (not yet committed)
let dragPiece = null; // { file, rank } — committed drag piece (after threshold)
let dragStartX = 0; // clientX at mousedown
let dragStartY = 0; // clientY at mousedown
let dragCompleted = false; // true after a committed drag mouseup (suppresses click)
let dragTouchId = null; // touch identifier that owns the board drag gesture
let touchDragCommitted = false; // true once a touch drag crosses the threshold

// ── Arrow drawing state (3D) ─────────────────────────────

let arrowStart = null; // { file, rank } — right-click start square

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

// ── Selection helpers (3D) ───────────────────────────────

/**
 * Select a piece on-turn and show its legal moves (getValidMoves).
 */
function selectPiece(file, rank) {
  const moves = getValidMoves(
    serverBoard.map((r) => [...r]),
    file,
    rank,
    castlingRights,
    enPassantTarget
  );
  setSelectedSquare({ file, rank }, moves);
  orchestrator.selectPiece(file, rank, moves);
}

/**
 * Select an own piece off-turn and show its premove candidate moves.
 * Candidates use the permissive getPremoveMoves() on a cloned board —
 * getValidMoves() is too restrictive for premoves (it rejects recaptures
 * onto currently friendly-occupied squares, pinned pieces, and pawn
 * destinations the opponent will vacate).
 */
function selectPremovePiece(file, rank) {
  const moves = getPremoveMoves(
    serverBoard.map((r) => [...r]),
    file,
    rank,
    castlingRights,
    enPassantTarget
  );
  setSelectedSquare({ file, rank }, moves, 'premove');
  orchestrator.selectPremove(file, rank, moves);
}

/**
 * Complete a premove: sends `premove` (the server decides execute-now vs
 * store, so a late turn flip between click and send is safe). A pawn
 * promotion destination opens the promotion picker in premove mode instead
 * of sending immediately — the chosen piece is then sent atomically with
 * the premove.
 */
function executePremove(fromFile, fromRank, toFile, toRank) {
  const piece = serverBoard[fromRank][fromFile];
  if (pieceType(piece) === 'pawn' && (toRank === 0 || toRank === 7)) {
    orchestrator.deselect();
    showPromotionPicker(toFile, toRank, pieceColor(piece), {
      mode: 'premove',
      fromFile,
      fromRank,
      toFile,
      toRank,
    });
    return;
  }
  sendPremove(fromFile, fromRank, toFile, toRank);
  orchestrator.deselect();
}

// ── Click handler ────────────────────────────────────────

export function setClickHandler(renderer) {
  _renderer = renderer;
  renderer.domElement.addEventListener('click', (event) => {
    if (menuOpen || helpOpen || settingsOpen) return;
    if (serverPromotingPiece) return;
    if (serverGameOver) return;
    if (dragCompleted) {
      dragCompleted = false;
      return;
    }
    if (mouseLookOn) {
      // Re-acquire pointer lock if available (e.g. after clicking away).
      // On iPadOS this is a no-op — virtual joystick handles camera control.
      if (hasPointerLock(renderer.domElement)) {
        renderer.domElement.requestPointerLock();
      }
      return;
    }
    if (!serverBoard) return;

    // Clear arrows and highlights on left-click on the 3D board
    clearArrows();
    clearSquareHighlights();

    const sq = getBoardSquareFromRay(event);
    if (!sq) return;
    const { file, rank } = sq;
    const piece = serverBoard[rank][file];

    // Re-clicking the confirmed premove's origin cancels it (sends
    // premoveCancel + clears local state optimistically). This takes priority
    // over selection: the origin is always the user's own piece, and clicking
    // it while a premove is confirmed is the cancel gesture.
    const pre = getPremove();
    if (pre && pre.fromFile === file && pre.fromRank === rank) {
      cancelPremove();
      return;
    }

    const offTurn = myRole && myRole !== serverTurn;
    const sel = getSelectedSquare();
    const vm = getValidMovesList();
    if (sel) {
      // Clicking the same piece again deselects it
      if (sel.file === file && sel.rank === rank) {
        orchestrator.deselect();
        return;
      }
      const isValid = vm.some((m) => m.file === file && m.rank === rank);
      if (!isValid) {
        // Clicked an invalid square — if it's one of our pieces, select it
        // instead (premove mode off-turn, normal mode on-turn)
        if (piece !== 0 && pieceColor(piece) === myRole) {
          if (offTurn) selectPremovePiece(file, rank);
          else selectPiece(file, rank);
        } else {
          orchestrator.deselect();
        }
        return;
      }
      // The message type follows the selection mode, not the turn at send
      // time: a premove selection always sends `premove`, so a late turn
      // flip between click and send still sends `premove` (the server
      // decides execute-now vs store).
      if (getSelectionMode() === 'premove') {
        executePremove(sel.file, sel.rank, file, rank);
      } else {
        sendMove(sel.file, sel.rank, file, rank);
        orchestrator.deselect();
      }
      return;
    }

    if (piece !== 0 && pieceColor(piece) === myRole) {
      if (offTurn) selectPremovePiece(file, rank);
      else selectPiece(file, rank);
    } else {
      orchestrator.deselect();
      // Immediate local feedback when clicking an enemy piece off-turn
      if (offTurn && piece !== 0) {
        showError(t('error.not_your_turn'));
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

  // Off-turn drags select in premove mode (permissive candidates);
  // on-turn drags keep the normal legal selection.
  if (myRole && myRole !== serverTurn) selectPremovePiece(file, rank);
  else selectPiece(file, rank);

  const pm = pieceMeshes.find((p) => p.file === file && p.rank === rank);
  if (!pm) {
    // No mesh found — abort drag
    dragCandidate = null;
    return;
  }

  dragging = true;
  dragPiece = { file, rank };
  // Remember that a touch gesture committed so a state-interrupted release
  // can still suppress its compatibility click (see touchEndHandler).
  if (dragTouchId !== null) touchDragCommitted = true;
  pm.mesh.position.y = DRAG_HEIGHT;
  playMove();
  dragCandidate = null;
}

// Return the dragged piece's mesh to its canonical square position and clear
// the committed-drag state. The position is derived from the piece's
// (file, rank) rather than a captured snapshot, so restoration is correct even
// if the mesh was already displaced when the drag committed. Every
// completion/cancel/error path that leaves the board unchanged goes through
// this helper, so a lifted mesh can never be stranded at drag height.
function restoreDraggedMesh() {
  if (dragPiece) {
    const pm = pieceMeshes.find((p) => p.file === dragPiece.file && p.rank === dragPiece.rank);
    if (pm) {
      pm.mesh.position.set(dragPiece.file - 3.5, 0.01, 3.5 - dragPiece.rank);
    }
  }
  dragging = false;
  dragPiece = null;
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
        getValidMovesList().some((m) => m.file === file && m.rank === rank);

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

  dragCompleted = true;

  // Capture the drag coordinates before restoreDraggedMesh() clears them.
  const fromFile = dragPiece.file;
  const fromRank = dragPiece.rank;

  // Find the square under the cursor
  const sq = getBoardSquareFromRay(event);

  const vm = getValidMovesList();
  if (sq && vm.some((m) => m.file === sq.file && m.rank === sq.rank)) {
    // Valid drop — execute the move (or premove, per the selection mode
    // chosen at drag start: a late turn flip still sends `premove`). The
    // lifted mesh is always returned to its square first: a stored premove
    // never changes the board (no re-render to fix the mesh), and a live
    // move's animation starts from the canonical origin anyway.
    restoreDraggedMesh();
    if (getSelectionMode() === 'premove') {
      executePremove(fromFile, fromRank, sq.file, sq.rank);
    } else {
      sendMove(fromFile, fromRank, sq.file, sq.rank);
      orchestrator.deselect();
    }
  } else {
    // Invalid drop — return piece to original position
    restoreDraggedMesh();
    orchestrator.deselect();
  }
}

// ── Touch helpers for drag-to-move ──────────────────────
// Do NOT call preventDefault() on touchstart — that would suppress the
// compatibility click generated after a tap, breaking tap-to-select and
// tap-to-move.  Instead, rely on touch-action: none on the canvas to
// prevent scroll/zoom, and only call preventDefault() in touchmove once
// the drag threshold is crossed.

function touchStartHandler(event) {
  if (menuOpen || helpOpen || settingsOpen || serverPromotingPiece || serverGameOver || mouseLookOn)
    return;
  if (!serverBoard) return;

  // Ignore secondary touchstart while a gesture is already active.
  // A second finger landing can reorder TouchList entries, so we must
  // not overwrite dragTouchId or gesture state from touches[0].
  if (dragTouchId !== null || dragCandidate !== null || dragging) return;

  // Use changedTouches to get the newly started touch — TouchList
  // ordering in event.touches is not guaranteed to put the new touch
  // at index 0.
  const t = event.changedTouches[0];

  // Validate the board square and piece BEFORE claiming ownership.
  // If the touch is on an invalid square we must not set dragTouchId,
  // otherwise the active-gesture guard would reject every subsequent
  // touchstart.
  const sq = getBoardSquareFromRay(t);
  if (!sq) return;
  const { file, rank } = sq;
  const piece = serverBoard[rank][file];

  // Own pieces are touch-draggable on- and off-turn (off-turn drags
  // complete as premoves); enemy pieces and empty squares are ignored.
  if (piece === 0 || pieceColor(piece) !== myRole) return;

  // Only assign ownership when creating a valid drag candidate.
  dragTouchId = t.identifier;
  dragStartX = t.clientX;
  dragStartY = t.clientY;
  dragCandidate = { file, rank };
  dragging = false;
  dragPiece = null;
}

function touchMoveHandler(event) {
  if (!dragCandidate && !dragging) return;

  // Find the touch that owns this drag gesture by identifier.
  // TouchList is array-like but lacks .find() — iterate by index.
  // Ignore additional touches so a second finger cannot hijack the drag.
  const touches = event.touches;
  let t = null;
  for (let i = 0; i < touches.length; i++) {
    if (touches[i].identifier === dragTouchId) {
      t = touches[i];
      break;
    }
  }
  if (!t) return; // owning touch disappeared — drag will be cancelled on touchcancel

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
  // Also proceed when a state update interrupted the drag: dragging and
  // dragCandidate are cleared, but dragTouchId is preserved so the owning
  // touch release can still be cleaned up.
  if (!dragging && !dragCandidate && dragTouchId === null) return;

  // Find the owning touch in changedTouches.
  // TouchList is array-like but lacks .find() — iterate by index.
  const changed = event.changedTouches;
  let t = null;
  for (let i = 0; i < changed.length; i++) {
    if (changed[i].identifier === dragTouchId) {
      t = changed[i];
      break;
    }
  }
  if (!t) {
    // A different finger lifted — ignore it. The drag gesture is still
    // owned by the original touch and will complete when that finger lifts.
    return;
  }

  // A state-interrupted committed drag has dragging cleared but
  // touchDragCommitted set, so it still suppresses its compatibility click.
  const wasCommittedDrag = dragging || touchDragCommitted;
  onDragEnd(t);

  // If this was a committed drag (normal or state-interrupted), suppress the
  // compatibility click by calling preventDefault() on touchend.
  if (wasCommittedDrag) {
    event.preventDefault();
  }
  // For below-threshold taps (candidate only), do NOT call preventDefault()
  // so the browser fires a compatibility click for normal tap-to-select.

  // Clear any pending click suppression and the committed flag so the next
  // legitimate tap is not eaten and no stale flag remains.
  dragCompleted = false;
  touchDragCommitted = false;
  dragTouchId = null;
}

function touchCancelHandler(event) {
  // Only cancel the board gesture if the owning touch is the one being
  // cancelled. A touchcancel for a secondary finger must not interrupt
  // the owner's drag.
  if (dragTouchId !== null && event && event.changedTouches) {
    const changed = event.changedTouches;
    let owningTouchCancelled = false;
    for (let i = 0; i < changed.length; i++) {
      if (changed[i].identifier === dragTouchId) {
        owningTouchCancelled = true;
        break;
      }
    }
    if (!owningTouchCancelled) return;
  }

  dragTouchId = null;
  dragCandidate = null;
  // A touchcancel generates no compatibility click, so clear any pending
  // click suppression (e.g. from a state-interrupted drag) so the next
  // legitimate tap is not eaten.
  dragCompleted = false;
  touchDragCommitted = false;
  restoreDraggedMesh();
  orchestrator.deselect();
}

export function setDragHandlers(renderer) {
  _renderer = renderer;

  renderer.domElement.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return; // only left button
    if (
      menuOpen ||
      helpOpen ||
      settingsOpen ||
      serverPromotingPiece ||
      serverGameOver ||
      mouseLookOn
    )
      return;
    if (!serverBoard) return;

    dragStartX = event.clientX;
    dragStartY = event.clientY;

    const sq = getBoardSquareFromRay(event);
    if (!sq) return;
    const { file, rank } = sq;
    const piece = serverBoard[rank][file];

    // Own pieces are draggable on- and off-turn (off-turn drags complete as
    // premoves); enemy pieces and empty squares are ignored.
    if (piece === 0 || pieceColor(piece) !== myRole) return;

    // Store as candidate — do NOT select yet (click handler will handle that)
    dragCandidate = { file, rank };
    dragging = false;
    dragPiece = null;
  });

  // ── Touch handlers for drag-to-move ──
  renderer.domElement.addEventListener('touchstart', touchStartHandler, { passive: false });
  document.addEventListener('touchmove', touchMoveHandler, { passive: false });
  document.addEventListener('touchend', touchEndHandler, { passive: false });
  document.addEventListener('touchcancel', touchCancelHandler);

  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragEnd);

  // ── Right-click arrow drawing (3D) ──
  renderer.domElement.addEventListener('contextmenu', (event) => {
    event.preventDefault();
  });

  renderer.domElement.addEventListener('mousedown', (event) => {
    if (event.button !== 2) return;
    if (mouseLookOn) return;

    const sq = getBoardSquareFromRay(event);
    if (!sq) return;
    arrowStart = sq;
  });

  document.addEventListener('mouseup', (event) => {
    if (event.button !== 2) return;
    if (mouseLookOn) return;
    if (!arrowStart) return;

    // Resolve the release square — off-board release cancels the annotation
    const sq = getBoardSquareFromRay(event);
    if (!sq) {
      arrowStart = null;
      return;
    }

    // If release square differs from start, always draw an arrow regardless of pixel distance.
    // A drag (press ≠ release) NEVER cancels the premove — including a drag that
    // ends on the premove origin — it always draws its annotation arrow.
    if (sq.file !== arrowStart.file || sq.rank !== arrowStart.rank) {
      const color = getArrowColor(event);
      addArrow(arrowStart, sq, color);
    } else {
      // Same square (press === release). The ONLY right-click that cancels: a
      // same-square right-click whose press AND release are both the confirmed
      // premove's origin. It takes priority over the highlight gesture.
      const pre = getPremove();
      if (
        pre &&
        arrowStart.file === pre.fromFile &&
        arrowStart.rank === pre.fromRank &&
        sq.file === pre.fromFile &&
        sq.rank === pre.fromRank
      ) {
        cancelPremove();
      } else {
        // Same square — highlight it
        const color = getHighlightColor(event);
        addHighlight(arrowStart.file, arrowStart.rank, color);
      }
    }
    arrowStart = null;
  });
}

// ── Cancel drag on board state change ────────────────────

onStateUpdate(() => {
  // A state update cancels an active drag, but the pointer is still down.
  // When it is released, the browser generates a compatibility click that
  // would otherwise execute the (now stale) selection.
  const wasDragging = dragging;
  const wasTouch = dragTouchId !== null;
  restoreDraggedMesh();
  dragCandidate = null;
  if (wasTouch) {
    // Touch gesture: keep dragTouchId so the matching touchend/touchcancel
    // can preventDefault() (suppressing the compatibility click) and clean
    // up. Do NOT set dragCompleted — a committed touch drag generates no
    // compatibility click, so a stale dragCompleted would swallow the next
    // legitimate tap.
  } else if (wasDragging) {
    // Mouse gesture: suppress the release click via the click handler.
    dragCompleted = true;
  }
});

// ── Restart handler ──────────────────────────────────────

onRestart(() => {
  orchestrator.deselect();
  hidePromotionPicker();
  hideConcedeConfirm();
  restoreDraggedMesh();
  dragCandidate = null;
  dragCompleted = false;
  touchDragCommitted = false;
  dragTouchId = null;
});

// Re-render 3D board when selection changes (e.g. from 2D board)
// Handled by bindSelectionChange(orchestrator) above — no duplicate callback needed.

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
  document.addEventListener(
    'touchmove',
    function (e) {
      if (joystickTouchId !== null) {
        e.preventDefault();
        handleJoystickMove(e);
      }
    },
    { passive: false }
  );
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
