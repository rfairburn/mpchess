import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('mobile move log', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    document.body.innerHTML = `
      <div id="move-log"></div>
      <div id="menu-overlay"><div id="menu-box"></div></div>
      <button id="btn-menu-toggle" aria-label="Menu"></button>
      <button id="btn-fullscreen" aria-label="Toggle fullscreen">⛶</button>
      <div id="hud" class="hidden"></div>
      <div id="role-badge"></div>
      <div id="player-count"></div>
      <div id="turn-indicator"></div>
      <div id="mouse-mode"></div>
      <div id="draw-info"></div>
      <div id="promo-overlay"><div id="promo-choices"><button data-type="queen"></button><button data-type="rook"></button><button data-type="bishop"></button><button data-type="knight"></button></div></div>
      <div id="concede-overlay"><div id="concede-box"><button id="btn-concede-confirm"></button><button id="btn-concede-cancel"></button></div></div>
      <div id="give-up-spot-overlay"><div id="give-up-spot-box"><button id="btn-give-up-spot-confirm"></button><button id="btn-give-up-spot-cancel"></button></div></div>
      <div id="draw-offer-overlay"><div id="draw-offer-box"><p id="draw-offer-text"></p><button id="btn-draw-accept"></button><button id="btn-draw-decline"></button></div></div>
      <div id="import-fen-overlay"><div id="import-fen-box"><textarea id="fen-input"></textarea><button id="btn-import-fen-confirm"></button><button id="btn-import-fen-cancel"></button></div></div>
      <div id="game-over-overlay"><div id="game-over-box"><p id="game-over-text"></p><button id="btn-new-game"></button></div></div>
      <div id="error-toast"></div>
      <div id="join-overlay"><div id="join-box"><button id="btn-join-white"></button><button id="btn-join-black"></button><button id="btn-join-spectator"></button></div></div>
      <div id="reconnecting-overlay"><div id="reconnecting-box"><button id="btn-give-up"></button></div></div>
      <div id="connection-error-overlay"><div id="connection-error-box"><button id="btn-retry-connection"></button></div></div>
      <div id="opponent-disconnected-banner"><button id="btn-drop-player"></button></div>
      <div id="second-disconnected-banner"></div>
      <div id="game-available-banner"><button id="btn-join-game"></button></div>
      <button id="btn-resume"></button>
      <button id="btn-give-up-spot"></button>
      <button id="btn-reconnect-as-player"></button>
      <button id="btn-restart"></button>
      <button id="btn-offer-draw"></button>
      <button id="btn-concede"></button>
      <button id="btn-export-fen"></button>
      <button id="btn-export-pgn"></button>
      <button id="btn-import-fen"></button>
      <div id="menu-computer-section" class="hidden"><select id="menu-computer-skill-dropdown"></select><button id="btn-menu-activate-computer"></button></div>
      <div id="menu-skill-change-section" class="hidden"><select id="menu-skill-change-dropdown"></select><button id="btn-menu-change-skill"></button></div>
      <div id="sensitivity-row"><input type="range" id="sensitivity-slider" /><span id="sensitivity-value"></span></div>
      <div id="btn-claim-draw" class="hidden"></div>
      <div id="captured-white"><span class="cap-pieces"></span></div>
      <div id="captured-black"><span class="cap-pieces"></span></div>
      <div id="computer-thinking"></div>
    `;
  });

  afterEach(() => {
    delete globalThis.screen;
  });

  function commonMocks() {
    vi.mock('../../client/network.js', () => ({
      myRole: null,
      serverBoard: null,
      serverTurn: 'white',
      serverPromotingPiece: null,
      serverGameOver: false,
      serverGameResult: null,
      moveHistory: [],
      seatStatus: {},
      tokenKey: () => '',
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
    }));

    vi.mock('../../client/dom_ref.js', () => ({
      domRef: vi.fn((id) => document.getElementById(id)),
      domRefOptional: vi.fn((id) => document.getElementById(id)),
      domRefQuery: vi.fn((sel) => document.querySelector(sel)),
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
      initComputerMenu: vi.fn(() => {}),
    }));

    vi.mock('../../client/ui/connection.js', () => ({}));
  }

  it('should show full move history on desktop', async () => {
    commonMocks();

    // Desktop: no touch, large viewport
    Object.defineProperty(globalThis.navigator, 'maxTouchPoints', { value: 0, configurable: true });
    globalThis.window.matchMedia = vi.fn().mockReturnValue({ matches: false });
    Object.defineProperty(globalThis.window, 'innerWidth', { value: 1920, configurable: true });
    Object.defineProperty(globalThis.window, 'innerHeight', { value: 1080, configurable: true });

    const network = await import('../../client/network.js');
    const ui = await import('../../client/ui.js');

    // 10 moves (5 pairs)
    network.moveHistory = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'O-O', 'Nf6', 'd3', 'Be7'];

    ui.updateMoveLog();

    const rows = document.querySelectorAll('#move-log div');
    expect(rows.length).toBe(5); // all 5 move pairs
  });

  it('should cap move history at 6 pairs on mobile', async () => {
    commonMocks();

    // Mobile: touch, small viewport
    Object.defineProperty(globalThis.navigator, 'maxTouchPoints', { value: 5, configurable: true });
    globalThis.window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    Object.defineProperty(globalThis.window, 'innerWidth', { value: 390, configurable: true });
    Object.defineProperty(globalThis.window, 'innerHeight', { value: 844, configurable: true });

    const network = await import('../../client/network.js');
    const ui = await import('../../client/ui.js');

    // 14 half-moves (7 pairs) — should show last 6 pairs
    network.moveHistory = [
      'e4',
      'e5',
      'Nf3',
      'Nc6',
      'Bb5',
      'a6',
      'O-O',
      'Nf6',
      'd3',
      'Be7',
      'c4',
      'd6',
      'Nc3',
      'O-O',
    ];

    ui.updateMoveLog();

    const rows = document.querySelectorAll('#move-log div');
    expect(rows.length).toBe(6);
  });

  it('should preserve move numbers when capped', async () => {
    commonMocks();

    // Mobile
    Object.defineProperty(globalThis.navigator, 'maxTouchPoints', { value: 5, configurable: true });
    globalThis.window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    Object.defineProperty(globalThis.window, 'innerWidth', { value: 390, configurable: true });
    Object.defineProperty(globalThis.window, 'innerHeight', { value: 844, configurable: true });

    const network = await import('../../client/network.js');
    const ui = await import('../../client/ui.js');

    // 16 half-moves (8 pairs) — should show last 6 pairs (moves 3-8)
    network.moveHistory = [
      'e4',
      'e5',
      'Nf3',
      'Nc6',
      'Bb5',
      'a6',
      'O-O',
      'Nf6',
      'd3',
      'Be7',
      'c4',
      'd6',
      'Nc3',
      'O-O',
      'Bg5',
      'h6',
    ];

    ui.updateMoveLog();

    const rows = document.querySelectorAll('#move-log div');
    expect(rows.length).toBe(6);

    // First visible row should be move 3
    const firstNum = rows[0].querySelector('b');
    expect(firstNum.textContent).toBe('3.');
  });

  it('should show all moves when fewer than 6 pairs on mobile', async () => {
    commonMocks();

    // Mobile
    Object.defineProperty(globalThis.navigator, 'maxTouchPoints', { value: 5, configurable: true });
    globalThis.window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    Object.defineProperty(globalThis.window, 'innerWidth', { value: 390, configurable: true });
    Object.defineProperty(globalThis.window, 'innerHeight', { value: 844, configurable: true });

    const network = await import('../../client/network.js');
    const ui = await import('../../client/ui.js');

    // Only 4 moves (2 pairs)
    network.moveHistory = ['e4', 'e5', 'Nf3', 'Nc6'];

    ui.updateMoveLog();

    const rows = document.querySelectorAll('#move-log div');
    expect(rows.length).toBe(2);
  });

  it('should align to white move when history has odd length on mobile', async () => {
    commonMocks();

    // Mobile
    Object.defineProperty(globalThis.navigator, 'maxTouchPoints', { value: 5, configurable: true });
    globalThis.window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    Object.defineProperty(globalThis.window, 'innerWidth', { value: 390, configurable: true });
    Object.defineProperty(globalThis.window, 'innerHeight', { value: 844, configurable: true });

    const network = await import('../../client/network.js');
    const ui = await import('../../client/ui.js');

    // 13 half-moves (odd — white just moved, no black reply)
    // totalRows = ceil(13/2) = 7, firstRow = max(1, 7-5) = 2, start = 2
    // slice(2) = 11 moves → 6 rows (moves 2-7)
    network.moveHistory = [
      'e4',
      'e5',
      'Nf3',
      'Nc6',
      'Bb5',
      'a6',
      'O-O',
      'Nf6',
      'd3',
      'Be7',
      'c4',
      'd6',
      'Nc3',
    ];

    ui.updateMoveLog();

    const rows = document.querySelectorAll('#move-log div');
    expect(rows.length).toBe(6);

    // First row should be move 2 (Nf3 Nc6), aligned to white move
    const firstNum = rows[0].querySelector('b');
    expect(firstNum.textContent).toBe('2.');
    // Verify row contents: "2. Nf3 Nc6"
    expect(rows[0].textContent).toContain('Nf3');
    expect(rows[0].textContent).toContain('Nc6');
    // Last row should be move 7 (Nc3 only, no black reply)
    const lastNum = rows[rows.length - 1].querySelector('b');
    expect(lastNum.textContent).toBe('7.');
    expect(rows[rows.length - 1].textContent).toContain('Nc3');
  });
});
