// ═══════════════════════════════════════════════════════════
//  PROMOTION PICKER — live vs premove mode (context API)
// ═══════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Module mocks ──────────────────────────────────────────

vi.mock('../../client/network.js', () => ({
  onEvaluation: vi.fn(),
  serverEvaluation: null,
  myRole: 'white',
  serverTurn: 'white',
  serverPromotingPiece: null,
  serverGameOver: false,
  serverGameResult: null,
  moveHistory: [],
  previousMove: null,
  seatStatus: {},
  tokenKey: vi.fn(),
  halfmoveClock: 0,
  threefoldCount: 0,
  canClaimDraw: false,
  sendPromotion: vi.fn(),
  sendPremove: vi.fn(),
  cancelPremove: vi.fn(),
  sendRestart: vi.fn(),
  sendConcede: vi.fn(),
  sendLeave: vi.fn(),
  sendExportFen: vi.fn(),
  sendExportPgn: vi.fn(),
  sendImportFen: vi.fn(),
  sendOfferDraw: vi.fn(),
  sendDrawResponse: vi.fn(),
  sendClaimDraw: vi.fn(),
  onStateUpdate: vi.fn(),
  onRestart: vi.fn(),
  onError: vi.fn(),
  onInfo: vi.fn(),
  onDrawOffer: vi.fn(),
  onDrawResult: vi.fn(),
  onDrawOfferCancelled: vi.fn(),
  onPlayerLeft: vi.fn(),
  onFenImportWarning: vi.fn(),
  onPromotion: vi.fn(),
  onPremoveSet: vi.fn(),
  onPremovePlayed: vi.fn(),
  onPremoveDiscarded: vi.fn(),
}));

vi.mock('../../client/pieces.js', () => ({
  setSvgPieceSet: vi.fn(),
  getModelSet: () => 'simple-classic',
  setModelSet: vi.fn(),
  SVG_PIECE_SETS: ['mpchess', 'maestro', 'dubrovny'],
  MODEL_SETS: ['simple-classic', 'low-poly', 'jeu'],
  getSvgPieceSet: () => 'mpchess',
  getPieceSetExtension: () => 'svg',
  getPieceAssetUrl(fileName) {
    return `files/pieces/2d/mpchess/${fileName}.svg`;
  },
  reloadPieceModels: vi.fn(),
  getPieceSvgUrl(pieceId) {
    const files = {
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
    return `files/pieces/2d/mpchess/${files[pieceId]}.svg`;
  },
}));

vi.mock('../../client/controls.js', () => ({
  setCameraForRole: vi.fn(),
  toggleMouseMode: vi.fn(),
  setJoystickEnabled: vi.fn(),
  clearHeldKeys: vi.fn(),
  mouseLookOn: vi.fn(),
  CONTROLS_CONFIG: {
    defaultMouseSensitivity: 0.002,
    sensitivityMin: 0.0002,
    sensitivityMax: 0.004,
    sensitivitySliderMin: 1,
    sensitivitySliderMax: 100,
    sensitivitySliderBase: 20,
  },
}));

vi.mock('../../client/ui/toast.js', () => ({
  showError: vi.fn(),
  showInfo: vi.fn(),
  showWarning: vi.fn(),
}));

vi.mock('../../client/ui/disconnected.js', () => ({
  syncDisconnectedBanners: vi.fn(),
  refreshDisconnectedText: vi.fn(),
}));

vi.mock('../../client/ui/join.js', () => ({
  showJoinOverlay: vi.fn(),
  hideJoinOverlay: vi.fn(),
  updateJoinButtons: vi.fn(),
}));

vi.mock('../../client/ui/computer.js', () => ({
  updateMenuComputerSections: vi.fn(),
  initComputerMenu: vi.fn(),
  refreshComputerThinking: vi.fn(),
}));

vi.mock('../../client/ui/connection.js', () => ({}));

// ── Helper: create minimal DOM elements ui.js needs at load time ──

function createMinimalDOM() {
  document.body.innerHTML = '';
  const ids = [
    'role-badge',
    'player-count',
    'turn-indicator',
    'mouse-mode',
    'btn-menu-toggle',
    'menu-overlay',
    'menu-box',
    'btn-resume',
    'btn-give-up-spot',
    'btn-reconnect-as-player',
    'btn-restart',
    'btn-concede',
    'btn-offer-draw',
    'promo-overlay',
    'concede-overlay',
    'btn-concede-confirm',
    'btn-concede-cancel',
    'give-up-spot-overlay',
    'btn-give-up-spot-confirm',
    'btn-give-up-spot-cancel',
    'import-fen-overlay',
    'fen-input',
    'btn-import-fen',
    'btn-import-fen-confirm',
    'btn-import-fen-cancel',
    'btn-join-game',
    'draw-offer-overlay',
    'draw-offer-text',
    'btn-draw-accept',
    'btn-draw-decline',
    'btn-export-fen',
    'btn-export-pgn',
    'btn-new-game',
    'move-log',
    'draw-info',
    'game-over-text',
    'game-over-overlay',
    'error-toast',
    'sensitivity-value',
  ];
  for (const id of ids) {
    const el = document.createElement('div');
    el.id = id;
    document.body.appendChild(el);
  }

  // Nest menu-box inside menu-overlay (matches real DOM structure)
  const menuOverlay = document.getElementById('menu-overlay');
  const menuBox = document.getElementById('menu-box');
  menuOverlay.appendChild(menuBox);

  // sensitivity-slider is an <input type="range">
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.id = 'sensitivity-slider';
  slider.min = '1';
  slider.max = '100';
  slider.value = '20';
  document.body.appendChild(slider);

  // promo-choices with buttons
  const promoOverlay = document.getElementById('promo-overlay');
  promoOverlay.innerHTML =
    '<div id="promo-box"><div id="promo-choices">' +
    '<button data-type="queen"></button>' +
    '<button data-type="rook"></button>' +
    '<button data-type="bishop"></button>' +
    '<button data-type="knight"></button>' +
    '</div></div>';

  // captured pieces containers
  const capWhite = document.createElement('div');
  capWhite.id = 'captured-white';
  capWhite.innerHTML = '<span class="cap-label"></span><span class="cap-pieces"></span>';
  document.body.appendChild(capWhite);

  const capBlack = document.createElement('div');
  capBlack.id = 'captured-black';
  capBlack.innerHTML = '<span class="cap-label"></span><span class="cap-pieces"></span>';
  document.body.appendChild(capBlack);
}

// ── Tests ─────────────────────────────────────────────────

describe('promotion picker — live vs premove mode', () => {
  let network;
  let ui;

  function promoButton(type) {
    return document.querySelector(`#promo-choices button[data-type="${type}"]`);
  }

  function overlayVisible() {
    return document.getElementById('promo-overlay').classList.contains('visible');
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    createMinimalDOM();

    network = await import('../../client/network.js');
    ui = await import('../../client/ui.js');
  });

  // ── Live mode (existing flow) ───────────────────────────

  it('live mode (default): button click sends promotion', () => {
    ui.showPromotionPicker(4, 7, 'white');
    expect(overlayVisible()).toBe(true);
    expect(ui.getPromotionPickerContext()).toEqual({ mode: 'live' });

    promoButton('queen').click();
    expect(network.sendPromotion).toHaveBeenCalledWith('queen');
    expect(network.sendPremove).not.toHaveBeenCalled();
  });

  it('live mode: overlay stays visible until the state update hides it', () => {
    ui.showPromotionPicker(4, 7, 'white');
    promoButton('rook').click();
    expect(network.sendPromotion).toHaveBeenCalledWith('rook');
    // Existing live flow: the picker is hidden by the next state update
    // (promotingPiece cleared), not by the click itself.
    expect(overlayVisible()).toBe(true);
  });

  it('live mode: black symbols are used for a black pawn', () => {
    ui.showPromotionPicker(4, 0, 'black');
    expect(promoButton('queen').textContent).toBe('♛');
    expect(promoButton('knight').textContent).toBe('♞');
  });

  // ── Premove mode ────────────────────────────────────────

  it('premove mode: button click sends one atomic premove with the chosen piece', () => {
    ui.showPromotionPicker(4, 7, 'white', {
      mode: 'premove',
      fromFile: 4,
      fromRank: 6,
      toFile: 4,
      toRank: 7,
    });
    expect(ui.getPromotionPickerContext()).toEqual({
      mode: 'premove',
      fromFile: 4,
      fromRank: 6,
      toFile: 4,
      toRank: 7,
    });

    promoButton('knight').click();
    expect(network.sendPremove).toHaveBeenCalledWith(4, 6, 4, 7, 'knight');
    expect(network.sendPromotion).not.toHaveBeenCalled();
  });

  it('premove mode: picker hides after the choice', () => {
    ui.showPromotionPicker(4, 7, 'white', {
      mode: 'premove',
      fromFile: 4,
      fromRank: 6,
      toFile: 4,
      toRank: 7,
    });
    expect(overlayVisible()).toBe(true);

    promoButton('queen').click();
    expect(overlayVisible()).toBe(false);
  });

  it('premove mode: each choice sends the full coordinates plus that piece', () => {
    ui.showPromotionPicker(0, 0, 'black', {
      mode: 'premove',
      fromFile: 0,
      fromRank: 1,
      toFile: 0,
      toRank: 0,
    });
    promoButton('bishop').click();
    expect(network.sendPremove).toHaveBeenCalledWith(0, 1, 0, 0, 'bishop');
  });

  // ── Cancel / dismiss safety ─────────────────────────────

  it('dismiss (hide) resets the context: no stale premove is sent later', () => {
    ui.showPromotionPicker(4, 7, 'white', {
      mode: 'premove',
      fromFile: 4,
      fromRank: 6,
      toFile: 4,
      toRank: 7,
    });
    ui.hidePromotionPicker();
    expect(overlayVisible()).toBe(false);
    expect(ui.getPromotionPickerContext()).toBeNull();

    // A later live show + click sends promotion, not the stale premove
    ui.showPromotionPicker(4, 7, 'white');
    promoButton('bishop').click();
    expect(network.sendPromotion).toHaveBeenCalledWith('bishop');
    expect(network.sendPremove).not.toHaveBeenCalled();
  });

  it('dismissed picker is inactive: a stale button activation sends neither promotion nor premove', () => {
    // Dismiss a premove-mode picker
    ui.showPromotionPicker(4, 7, 'white', {
      mode: 'premove',
      fromFile: 4,
      fromRank: 6,
      toFile: 4,
      toRank: 7,
    });
    ui.hidePromotionPicker();
    expect(overlayVisible()).toBe(false);
    expect(ui.getPromotionPickerContext()).toBeNull();

    // A stale/queued activation immediately after dismissal must not send
    // the stale premove or a live promotion.
    promoButton('queen').click();
    expect(network.sendPromotion).not.toHaveBeenCalled();
    expect(network.sendPremove).not.toHaveBeenCalled();

    // Same guarantee for a dismissed live-mode picker
    ui.showPromotionPicker(4, 7, 'white');
    ui.hidePromotionPicker();
    expect(ui.getPromotionPickerContext()).toBeNull();
    promoButton('rook').click();
    expect(network.sendPromotion).not.toHaveBeenCalled();
    expect(network.sendPremove).not.toHaveBeenCalled();
  });

  it('showing live after a premove picker replaces the premove context', () => {
    ui.showPromotionPicker(4, 7, 'white', {
      mode: 'premove',
      fromFile: 4,
      fromRank: 6,
      toFile: 4,
      toRank: 7,
    });
    // A live promotion is now pending (state update re-shows the picker)
    ui.showPromotionPicker(4, 7, 'white');
    expect(ui.getPromotionPickerContext()).toEqual({ mode: 'live' });

    promoButton('queen').click();
    expect(network.sendPromotion).toHaveBeenCalledWith('queen');
    expect(network.sendPremove).not.toHaveBeenCalled();
  });

  it('invalid or missing context falls back to live mode', () => {
    ui.showPromotionPicker(4, 7, 'white', null);
    expect(ui.getPromotionPickerContext()).toEqual({ mode: 'live' });

    ui.showPromotionPicker(4, 7, 'white', undefined);
    expect(ui.getPromotionPickerContext()).toEqual({ mode: 'live' });

    ui.showPromotionPicker(4, 7, 'white', { mode: 'bogus' });
    expect(ui.getPromotionPickerContext()).toEqual({ mode: 'live' });

    promoButton('rook').click();
    expect(network.sendPromotion).toHaveBeenCalledWith('rook');
    expect(network.sendPremove).not.toHaveBeenCalled();
  });
});
