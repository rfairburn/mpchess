// ═══════════════════════════════════════════════════════════
//  CONTROLS — keyboard, mouse, raycasting, click handling, move validation
// ═══════════════════════════════════════════════════════════

import * as THREE from 'three';
import {
  myRole, serverBoard, serverTurn, serverPromotingPiece, serverGameOver,
  castlingRights, enPassantTarget, sendMove, onRestart
} from './network.js';
import { menuOpen, showMenu, hideMenu, updateMouseModeDisplay, hidePromotionPicker, hideConcedeConfirm, mouseSensitivity } from './ui.js';
import { squares, clearHighlights, highlightSelected, highlightValidMoves, highlightCheck } from './board.js';
import { pieceColor, getValidMoves } from '../shared/chess.mjs';

// ── Camera state ─────────────────────────────────────────

export const keys = {};
export let yaw = 0, pitch = 0;
const euler = new THREE.Euler(0, 0, 0, 'YXZ');

export let mouseLookOn = true;
let _renderer = null;
let _camera = null;
let _hud = null;

export function setRenderer(renderer, camera) {
  _renderer = renderer;
  _camera = camera;
  _hud = document.getElementById('hud');

  // Init yaw/pitch from camera quaternion
  euler.setFromQuaternion(camera.quaternion);
  yaw = euler.y;
  pitch = euler.x;
}

// ── Mouse movement ───────────────────────────────────────

document.addEventListener('mousemove', e => {
  if (!mouseLookOn) return;
  if (!_renderer) return;
  if (document.pointerLockElement !== _renderer.domElement) return;
  yaw -= e.movementX * mouseSensitivity;
  pitch -= e.movementY * mouseSensitivity;
  pitch = Math.max(-Math.PI / 2.1, Math.min(Math.PI / 2.1, pitch));
});

// ── Keyboard ─────────────────────────────────────────────

document.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'Escape') {
    if (menuOpen) { hideMenu(); }
    else { showMenu(); }
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

document.addEventListener('keyup', e => { keys[e.code] = false; });

document.addEventListener('pointerlockchange', () => {
  if (!_renderer) return;
  const locked = document.pointerLockElement === _renderer.domElement;
  _hud?.classList.toggle('hidden', locked);
  if (!locked && mouseLookOn) {
    mouseLookOn = false;
    updateMouseModeDisplay(mouseLookOn);
  }
});

// ── Raycasting ───────────────────────────────────────────

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
export let selectedSquare = null;
export let validMoves = [];

function getBoardSquareFromRay(event) {
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, _camera);
  const allSquares = [];
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) allSquares.push(squares[r][f]);
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
  renderer.domElement.addEventListener('click', event => {
    if (menuOpen) return;
    if (serverPromotingPiece) return;
    if (serverGameOver) return;
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
        serverBoard.map(r => [...r]), file, rank,
        castlingRights, enPassantTarget
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
  });
}

// ── Restart handler ──────────────────────────────────────

onRestart(() => {
  selectedSquare = null;
  validMoves = [];
  hidePromotionPicker();
  hideConcedeConfirm();
  clearHighlights();
});
