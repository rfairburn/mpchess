// ═══════════════════════════════════════════════════════════
//  SHARED MOCK SETUP — side-effect module.
//  Import once in each mobile UI test suite:
//    import './mobile-mocks.js';
//
//  All vi.mock() calls are top-level here, so Vitest hoists
//  them correctly. No factories, no dynamic imports needed.
// ═══════════════════════════════════════════════════════════

import { vi } from 'vitest';

vi.mock('../../client/network.js', () => ({
  myRole: null,
  serverBoard: null,
  serverTurn: 'white',
  serverPromotingPiece: null,
  serverGameOver: false,
  serverGameResult: null,
  moveHistory: [],
  seatStatus: {},
  tokenKey: (color) => `mpchess_session_${color}`,
  halfmoveClock: 0,
  threefoldCount: 0,
  canClaimDraw: false,
  sendPromotion: vi.fn(),
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
}));

vi.mock('../../client/controls.js', () => ({
  setCameraForRole: vi.fn(),
  toggleMouseMode: vi.fn(),
  setJoystickEnabled: vi.fn(),
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
}));

vi.mock('../../client/ui/join.js', () => ({
  showJoinOverlay: vi.fn(),
  hideJoinOverlay: vi.fn(),
  updateJoinButtons: vi.fn(),
}));

vi.mock('../../client/ui/computer.js', () => ({
  updateMenuComputerSections: vi.fn(),
  initComputerMenu: vi.fn(),
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
