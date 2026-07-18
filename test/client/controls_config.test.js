import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Standalone module tests (no mocks needed) ──

describe('controls_config.js — standalone module', () => {
  it('should export CONTROLS_CONFIG without depending on ui.js or controls.js', async () => {
    const { CONTROLS_CONFIG } = await import('../../client/controls_config.js');
    expect(CONTROLS_CONFIG).toBeDefined();
    expect(typeof CONTROLS_CONFIG).toBe('object');
  });

  it('should have all expected keys', async () => {
    const { CONTROLS_CONFIG } = await import('../../client/controls_config.js');
    const expectedKeys = [
      'dragThreshold',
      'dragHeight',
      'pitchMin',
      'pitchMax',
      'cameraPositions',
      'roleKey',
      'defaultMouseSensitivity',
      'sensitivityMin',
      'sensitivityMax',
      'sensitivitySliderMin',
      'sensitivitySliderMax',
      'sensitivitySliderBase',
    ];
    for (const key of expectedKeys) {
      expect(CONTROLS_CONFIG).toHaveProperty(key);
    }
  });

  it('should have correct values', async () => {
    const { CONTROLS_CONFIG } = await import('../../client/controls_config.js');
    expect(CONTROLS_CONFIG.dragThreshold).toBe(5);
    expect(CONTROLS_CONFIG.dragHeight).toBe(0.6);
    expect(CONTROLS_CONFIG.pitchMin).toBe(-Math.PI / 2.1);
    expect(CONTROLS_CONFIG.pitchMax).toBe(Math.PI / 2.1);
    expect(CONTROLS_CONFIG.defaultMouseSensitivity).toBe(0.002);
    expect(CONTROLS_CONFIG.sensitivityMin).toBe(0.0002);
    expect(CONTROLS_CONFIG.sensitivityMax).toBe(0.004);
    expect(CONTROLS_CONFIG.sensitivitySliderMin).toBe(1);
    expect(CONTROLS_CONFIG.sensitivitySliderMax).toBe(100);
    expect(CONTROLS_CONFIG.sensitivitySliderBase).toBe(20);
  });

  it('should be the same object when re-imported (module caching)', async () => {
    const { CONTROLS_CONFIG: cfg1 } = await import('../../client/controls_config.js');
    const { CONTROLS_CONFIG: cfg2 } = await import('../../client/controls_config.js');
    expect(cfg1).toBe(cfg2);
  });
});

// ── Integration: real ui.js + real controls.js, no mocking of either ──
// This test verifies that the circular dependency between ui.js and
// controls.js does not cause a temporal-dead-zone ReferenceError.
// Only unrelated dependencies (network, board, chess, pieces, ui sub-modules)
// are mocked. Both ui.js and controls.js are loaded as real modules.

describe('ui.js + controls.js — real dependency graph, no circular-dead-zone', () => {
  const DOM_HTML = `
<div id="hud"></div>
<div id="turn-indicator"></div>
<div id="computer-thinking"></div>
<div id="mouse-mode"></div>
<div id="role-badge"></div>
<div id="player-count"></div>
<div id="captured-white"><span class="cap-pieces"></span></div>
<div id="captured-black"><span class="cap-pieces"></span></div>
<div id="move-log"></div>
<div id="draw-info"></div>
<div id="menu-overlay">
  <button id="btn-resume">Resume</button>
  <button id="btn-give-up-spot">Give Up Spot</button>
  <button id="btn-reconnect-as-player">Reconnect as Player</button>
  <button id="btn-restart">New Game</button>
  <button id="btn-offer-draw">Offer Draw</button>
  <button id="btn-concede">Concede Game</button>
  <button id="btn-claim-draw">Claim Draw</button>
  <button id="btn-export-fen">Export FEN</button>
  <button id="btn-export-pgn">Export PGN</button>
  <button id="btn-import-fen">Import FEN</button>
  <div id="menu-computer-section" class="hidden">
    <select id="menu-computer-skill-dropdown">
      <option value="beginner">Beginner</option>
      <option value="novice">Novice</option>
      <option value="intermediate">Intermediate</option>
      <option value="advanced">Advanced</option>
      <option value="master" selected>Master</option>
      <option value="grandmaster">Grandmaster</option>
    </select>
    <button id="btn-menu-activate-computer">Start Game</button>
  </div>
  <div id="menu-skill-change-section" class="hidden">
    <select id="menu-skill-change-dropdown">
      <option value="beginner">Beginner</option>
      <option value="novice">Novice</option>
      <option value="intermediate">Intermediate</option>
      <option value="advanced">Advanced</option>
      <option value="master" selected>Master</option>
      <option value="grandmaster">Grandmaster</option>
    </select>
    <button id="btn-menu-change-skill">Change Skill</button>
  </div>
  <input type="range" id="sensitivity-slider" min="1" max="100" value="20" />
  <span id="sensitivity-value">20</span>
</div>
<div id="promo-overlay">
  <div id="promo-choices">
    <button data-type="queen">Q</button>
    <button data-type="rook">R</button>
    <button data-type="bishop">B</button>
    <button data-type="knight">N</button>
  </div>
</div>
<div id="concede-overlay">
  <button id="btn-concede-cancel">Cancel</button>
  <button id="btn-concede-confirm">Concede</button>
</div>
<div id="give-up-spot-overlay">
  <button id="btn-give-up-spot-cancel">Cancel</button>
  <button id="btn-give-up-spot-confirm">Give Up</button>
</div>
<div id="draw-offer-overlay">
  <p id="draw-offer-text"></p>
  <button id="btn-draw-accept">Accept</button>
  <button id="btn-draw-decline">Decline</button>
</div>
<div id="import-fen-overlay">
  <textarea id="fen-input"></textarea>
  <button id="btn-import-fen">Import FEN</button>
  <button id="btn-import-fen-confirm">Import</button>
  <button id="btn-import-fen-cancel">Cancel</button>
</div>
<div id="game-over-overlay">
  <p id="game-over-text"></p>
  <button id="btn-new-game">New Game</button>
</div>
<div id="error-toast"></div>
<div id="join-overlay">
  <button id="btn-join-white" disabled>
    <span class="join-label">White</span>
    <span class="join-status"></span>
  </button>
  <button id="btn-join-black" disabled>
    <span class="join-label">Black</span>
    <span class="join-status"></span>
  </button>
  <button id="btn-join-spectator">
    <span class="join-label">Spectator</span>
    <span class="join-status"></span>
  </button>
  <button id="btn-join-game">Join Game</button>
</div>
<div id="disconnected-banner">
  <button id="btn-drop-disconnected">Drop Disconnected Player</button>
</div>
<div id="toast-container"></div>
`;

  beforeEach(async () => {
    vi.resetModules();

    // Set up DOM
    document.body.innerHTML = DOM_HTML;

    // Mock localStorage for sensitivity default
    // eslint-disable-next-line no-undef
    Storage.prototype.getItem = vi.fn(() => null);
    // eslint-disable-next-line no-undef
    Storage.prototype.setItem = vi.fn();

    // Mock only unrelated dependencies — NOT ui.js or controls.js
    vi.doMock('../../client/network.js', () => ({
      myRole: null,
      serverBoard: null,
      serverTurn: 'white',
      serverPromotingPiece: null,
      serverGameOver: false,
      serverGameResult: null,
      moveHistory: [],
      seatStatus: { white: { status: 'unknown' }, black: { status: 'unknown' } },
      tokenKey: vi.fn(),
      halfmoveClock: 0,
      threefoldCount: 0,
      canClaimDraw: false,
      castlingRights: { wK: true, wQ: true, bK: true, bQ: true },
      enPassantTarget: null,
      disconnectedPlayersInfo: [],
      validatedTokens: {},
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
      sendMove: vi.fn(),
      onStateUpdate: vi.fn(),
      onRestart: vi.fn(),
      onError: vi.fn(),
      onInfo: vi.fn(),
      onDrawOffer: vi.fn(),
      onDrawResult: vi.fn(),
      onDrawOfferCancelled: vi.fn(),
      onPlayerLeft: vi.fn(),
      onFenImportWarning: vi.fn(),
      onReconnecting: vi.fn(),
      onReconnected: vi.fn(),
      onPlayerDisconnected: vi.fn(),
      onPlayerDropped: vi.fn(),
      onGameAvailable: vi.fn(),
      onReconnectFailed: vi.fn(),
      onConnected: vi.fn(),
      onMove: vi.fn(),
      onPromotion: vi.fn(),
      onComputerActivated: vi.fn(),
      onComputerSkillChanged: vi.fn(),
      onComputerThinking: vi.fn(),
      onComputerUnavailable: vi.fn(),
      debugEnabled: false,
    }));

    vi.doMock('../../client/board.js', () => ({
      squares: [],
      clearHighlights: vi.fn(),
      highlightSelected: vi.fn(),
      highlightValidMoves: vi.fn(),
      highlightCheck: vi.fn(),
    }));

    vi.doMock('../../client/chess.mjs', () => ({
      pieceColor: vi.fn(),
      getValidMoves: vi.fn(),
      findKing: vi.fn(),
      isInCheck: vi.fn(),
      pieceType: vi.fn(),
    }));

    vi.doMock('../../client/pieces.js', () => ({
      pieceMeshes: [],
    }));

    vi.doMock('../../client/ui/toast.js', () => ({
      showError: vi.fn(),
      showInfo: vi.fn(),
      showWarning: vi.fn(),
    }));

    vi.doMock('../../client/ui/disconnected.js', () => ({
      syncDisconnectedBanners: vi.fn(),
    }));

    vi.doMock('../../client/ui/join.js', () => ({
      showJoinOverlay: vi.fn(),
      hideJoinOverlay: vi.fn(),
      updateJoinButtons: vi.fn(),
    }));

    vi.doMock('../../client/ui/computer.js', () => ({
      updateMenuComputerSections: vi.fn(),
      initComputerMenu: vi.fn(),
    }));

    vi.doMock('../../client/ui/connection.js', () => ({}));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should load real ui.js and real controls.js without temporal-dead-zone error', async () => {
    // Import real modules — this would throw a ReferenceError if the
    // circular dependency caused CONTROLS_CONFIG to be uninitialized
    // when ui.js reads it at top-level.
    const ui = await import('../../client/ui.js');
    const controls = await import('../../client/controls.js');
    const config = await import('../../client/controls_config.js');

    // Both modules should have initialized successfully
    expect(ui).toBeDefined();
    expect(controls).toBeDefined();

    // controls.js should re-export the same CONTROLS_CONFIG
    expect(controls.CONTROLS_CONFIG).toBe(config.CONTROLS_CONFIG);

    // ui.js should have used CONTROLS_CONFIG for its default sensitivity
    expect(ui.mouseSensitivity).toBe(config.CONTROLS_CONFIG.defaultMouseSensitivity);

    // Verify key exports exist
    expect(controls.setCameraForRole).toBeDefined();
    expect(controls.warpCamera).toBeDefined();
    expect(controls.CAMERA_POSITIONS).toBe(config.CONTROLS_CONFIG.cameraPositions);
    expect(ui.menuOpen).toBeDefined();
    expect(ui.showError).toBeDefined();
  });

  it('should share the same CONTROLS_CONFIG identity across all three modules', async () => {
    const ui = await import('../../client/ui.js');
    const controls = await import('../../client/controls.js');
    const config = await import('../../client/controls_config.js');

    // All references must be the exact same object
    expect(controls.CONTROLS_CONFIG).toBe(config.CONTROLS_CONFIG);

    // ui.js uses CONTROLS_CONFIG internally — verify the sensitivity
    // was initialized from the config default (no localStorage override)
    expect(ui.mouseSensitivity).toBe(0.002);
  });
});
