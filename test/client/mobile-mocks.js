// ═══════════════════════════════════════════════════════════
//  SHARED MOCK SETUP — side-effect module.
//  Import once in each mobile UI test suite:
//    import './mobile-mocks.js';
//
//  All vi.mock() calls are top-level here, so Vitest hoists
//  them correctly. No factories, no dynamic imports needed.
// ═══════════════════════════════════════════════════════════

import { vi } from 'vitest';

// i18n mock — stateful so tests can switch locales
const _i18nState = { locale: 'en-US' };
const _i18nCatalog = {
  'en-US': {
    'ui.language': 'Language',
    'ui.settings': 'Settings',
    'ui.settings_title': 'Settings',
    'ui.mouse_sensitivity': 'Mouse Sensitivity',
    'ui.virtual_joystick': 'Virtual Joystick',
    'ui.piece_set_2d': '2D Piece Set',
    'ui.piece_set_3d': '3D Model Set',
    'ui.title': '♔ 3D Chess ♚',
    'ui.fullscreen_enter': 'Toggle fullscreen',
    'ui.fullscreen_exit': 'Exit fullscreen',
    'ui.sound_on': 'Mute sound',
    'ui.sound_off': 'Enable sound',
    'game.checkmate_white': 'Checkmate! White wins!',
  },
  es: {
    'ui.language': 'Idioma',
    'ui.settings': 'Configuración',
    'ui.settings_title': 'Configuración',
    'ui.mouse_sensitivity': 'Sensibilidad del ratón',
    'ui.virtual_joystick': 'Joystick virtual',
    'ui.piece_set_2d': 'Juego de piezas 2D',
    'ui.piece_set_3d': 'Juego de modelos 3D',
    'ui.title': '♔ Ajedrez 3D ♚',
    'game.checkmate_white': '¡Jaque mate! ¡Ganan las Blancas!',
  },
  fr: {
    'ui.language': 'Langue',
    'ui.settings': 'Paramètres',
    'ui.settings_title': 'Paramètres',
    'ui.mouse_sensitivity': 'Sensibilité de la souris',
    'ui.virtual_joystick': 'Joystick virtuel',
    'ui.piece_set_2d': 'Ensemble de pièces 2D',
    'ui.piece_set_3d': 'Ensemble de modèles 3D',
    'ui.title': '♔ Échecs 3D ♚',
    'game.checkmate_white': 'Échec et mat ! Les Blancs gagnent !',
  },
  de: {
    'ui.language': 'Sprache',
    'ui.settings': 'Einstellungen',
    'ui.settings_title': 'Einstellungen',
    'ui.mouse_sensitivity': 'Mausempfindlichkeit',
    'ui.virtual_joystick': 'Virtueller Joystick',
    'ui.piece_set_2d': '2D-Figur-Set',
    'ui.piece_set_3d': '3D-Modell-Set',
    'ui.title': '♔ 3D-Schach ♚',
    'game.checkmate_white': 'Schachmatt! Weiß gewinnt!',
  },
  'zh-CN': {
    'ui.language': '语言',
    'ui.settings': '设置',
    'ui.settings_title': '设置',
    'ui.mouse_sensitivity': '鼠标灵敏度',
    'ui.virtual_joystick': '虚拟摇杆',
    'ui.piece_set_2d': '2D棋子套装',
    'ui.piece_set_3d': '3D模型套装',
    'ui.title': '♔ 3D国际象棋 ♚',
    'game.checkmate_white': '将死！白方获胜！',
  },
};

vi.mock('../../shared/i18n.mjs', () => ({
  t: vi.fn((key) => {
    const dict = _i18nCatalog[_i18nState.locale] || _i18nCatalog['en-US'];
    return dict?.[key] || key;
  }),
  setLocale: vi.fn((loc) => {
    if (_i18nCatalog[loc]) _i18nState.locale = loc;
  }),
  getLocale: vi.fn(() => _i18nState.locale),
  LOCALES: {
    'en-US': 'English',
    es: 'Español',
    fr: 'Français',
    de: 'Deutsch',
    'zh-CN': '简体中文',
  },
}));

// Exported for tests that need to reset i18n state
export function resetI18nMockState() {
  _i18nState.locale = 'en-US';
}

vi.mock('../../client/network.js', () => ({
  onEvaluation: vi.fn(),
  serverEvaluation: null,
  myRole: null,
  serverBoard: null,
  serverTurn: 'white',
  serverPromotingPiece: null,
  serverGameOver: false,
  serverGameResult: null,
  moveHistory: [],
  previousMove: null,
  seatStatus: {},
  validatedTokens: {},
  tokenKey: (color) => `mpchess_session_${color}`,
  halfmoveClock: 0,
  threefoldCount: 0,
  canClaimDraw: false,
  sendPromotion: vi.fn(),
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
  getSvgPieceSet: () => 'mpchess',
  setSvgPieceSet: vi.fn(),
  getModelSet: () => 'simple-classic',
  setModelSet: vi.fn(),
  SVG_PIECE_SETS: ['mpchess', 'maestro', 'dubrovny'],
  MODEL_SETS: ['simple-classic', 'low-poly', 'jeu'],
  reloadPieceModels: vi.fn(),
  getPieceSetExtension: () => 'svg',
  getPieceAssetUrl(fileName) {
    return `files/pieces/2d/mpchess/${fileName}.svg`;
  },
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
  mouseLookOn: false,
}));

vi.mock('../../client/dom_ref.js', () => ({
  domRef: vi.fn((id) => document.getElementById(id)),
  domRefOptional: vi.fn((id) => document.getElementById(id)),
  domRefQuery: vi.fn((selector) => document.querySelector(selector)),
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

// Stateful sound mock — reads localStorage on each isMuted() call,
// persists on setMute, so tests can set localStorage before importing.
const _soundState = { muted: false };
vi.mock('../../client/sound.js', () => ({
  init: vi.fn().mockResolvedValue(undefined),
  playMove: vi.fn(),
  setMute: vi.fn((val) => {
    _soundState.muted = val;
    try {
      localStorage.setItem('mpchessSoundMuted', String(val));
    } catch {
      /* noop */
    }
  }),
  isMuted: vi.fn(() => {
    // Read from localStorage first (simulates real module behavior),
    // fall back to in-memory state
    try {
      const val = localStorage.getItem('mpchessSoundMuted');
      if (val !== null) return val === 'true';
    } catch {
      /* noop */
    }
    return _soundState.muted;
  }),
}));

// Exported for tests that need to reset sound state between tests
export function resetSoundMockState() {
  _soundState.muted = false;
  try {
    localStorage.removeItem('mpchessSoundMuted');
  } catch {
    /* noop */
  }
}
