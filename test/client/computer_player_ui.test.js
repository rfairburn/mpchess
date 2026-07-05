import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ===========================================================
//  TEST SUITE -- Computer-player UI rendering
//  Covers S3 client-side: computer seat labels in join buttons,
//  skill-change section visibility/value, activation controls,
//  computerUnavailable error display, computerThinking indicator,
//  computerActivated/computerSkillChanged info toasts.
//  Drives the real client/network.js + client/ui.js with a full
//  DOM fixture and mock WebSocket.
// ===========================================================

// Mock controls.js -- we only need setCameraForRole (no-op)
vi.mock('../../client/controls.js', () => ({
  setCameraForRole: vi.fn(),
}));

// -- DOM fixture -------------------------------------------
// Must include every element ui.js accesses at module load time.

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
    <span class="join-label">Spectate</span>
    <span class="join-status">Always available</span>
  </button>
</div>

<div id="reconnecting-overlay">
  <p id="reconnecting-status"></p>
  <button id="btn-give-up">Give Up</button>
</div>

<div id="connection-error-overlay">
  <p id="connection-error-message"></p>
  <button id="btn-retry-connection">Retry</button>
</div>

<div id="opponent-disconnected-banner">
  <span id="opponent-disconnected-text"></span>
  <button id="btn-drop-player" disabled>Drop Player</button>
</div>

<div id="second-disconnected-banner">
  <span id="second-disconnected-text"></span>
</div>

<div id="game-available-banner">
  <button id="btn-join-game">Join Game</button>
</div>
`;

// -- Mock WebSocket -----------------------------------------

class TrackableWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url) {
    this.url = url;
    this.readyState = TrackableWebSocket.CONNECTING;
    this._onopen = null;
    this._onclose = null;
    this._onerror = null;
    this._onmessage = null;
    this.sentData = [];
  }

  set onopen(fn) {
    this._onopen = fn;
  }
  set onclose(fn) {
    this._onclose = fn;
  }
  set onerror(fn) {
    this._onerror = fn;
  }
  set onmessage(fn) {
    this._onmessage = fn;
  }

  send(data) {
    this.sentData.push(data);
  }
  close() {}
}

describe('computer player UI -- DOM rendering via real network + ui modules', () => {
  let mockWsInstance;
  let network;
  let ui;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // Set up the full DOM before importing ui.js
    document.body.innerHTML = DOM_HTML;

    // Polyfill pointerLock for jsdom
    document.pointerLockElement = null;
    document.exitPointerLock = vi.fn();

    globalThis.WebSocket = TrackableWebSocket;

    const store = {};
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (key) => store[key] ?? null,
        setItem: (key, val) => {
          store[key] = val;
        },
        removeItem: (key) => {
          delete store[key];
        },
      },
      writable: true,
    });

    Object.defineProperty(globalThis, 'location', {
      value: { protocol: 'http:', host: 'localhost:3000' },
      writable: true,
    });

    vi.spyOn(console, 'error').mockImplementation(() => {});

    // Import real network.js (auto-connects with mock WebSocket)
    network = await import('../../client/network.js');

    // Capture the WebSocket instance by patching the constructor
    // The module already created one; we need to find it.
    // Since we can't easily intercept it, we'll use a different approach:
    // re-import with a tracking constructor.
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  // Helper to set up modules with a capturable WebSocket
  async function setupModules() {
    vi.resetModules();
    document.body.innerHTML = DOM_HTML;
    document.pointerLockElement = null;
    document.exitPointerLock = vi.fn();

    let capturedWs = null;

    class CapturingWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;

      constructor(url) {
        this.url = url;
        this.readyState = CapturingWebSocket.CONNECTING;
        this._onopen = null;
        this._onclose = null;
        this._onerror = null;
        this._onmessage = null;
        this.sentData = [];
        capturedWs = this;
      }

      set onopen(fn) {
        this._onopen = fn;
      }
      set onclose(fn) {
        this._onclose = fn;
      }
      set onerror(fn) {
        this._onerror = fn;
      }
      set onmessage(fn) {
        this._onmessage = fn;
      }

      send(data) {
        this.sentData.push(data);
      }
      close() {}
    }

    globalThis.WebSocket = CapturingWebSocket;

    const store = {};
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (key) => store[key] ?? null,
        setItem: (key, val) => {
          store[key] = val;
        },
        removeItem: (key) => {
          delete store[key];
        },
      },
      writable: true,
    });

    Object.defineProperty(globalThis, 'location', {
      value: { protocol: 'http:', host: 'localhost:3000' },
      writable: true,
    });

    vi.spyOn(console, 'error').mockImplementation(() => {});

    network = await import('../../client/network.js');
    ui = await import('../../client/ui.js');

    // Open the connection
    capturedWs.readyState = 1;
    if (capturedWs._onopen) capturedWs._onopen();

    return { ws: capturedWs, network, ui };
  }

  function sendState(ws, opts = {}) {
    const board = opts.board || Array.from({ length: 8 }, () => Array(8).fill(0));
    ws._onmessage?.({
      data: JSON.stringify({
        type: 'state',
        role: opts.role ?? null,
        board,
        turn: opts.turn || 'white',
        promotingPiece: null,
        gameOver: opts.gameOver || false,
        gameResult: opts.gameResult || null,
        moveHistory: [],
        castlingRights: { wK: true, wQ: true, bK: true, bQ: true },
        enPassantTarget: null,
        disconnectedPlayers: [],
        seats: opts.seats || {
          white: { status: 'free' },
          black: { status: 'free' },
        },
        computerPlayer: opts.computerPlayer ?? null,
        fen: '',
        halfmoveClock: 0,
        threefoldCount: 0,
        playerCount: opts.playerCount ?? 0,
        spectatorCount: opts.spectatorCount ?? 0,
        capturedPieces: opts.capturedPieces || { white: [], black: [] },
      }),
    });
  }

  function sendMessage(ws, msg) {
    ws._onmessage?.({ data: JSON.stringify(msg) });
  }

  // -- Join button computer seat labels ------------------

  describe('join buttons -- computer seat label', () => {
    it('shows "Computer (Master)" and disables join button for computer seat', async () => {
      const { ws } = await setupModules();

      sendState(ws, {
        role: null, // not joined -- join overlay visible
        seats: {
          white: { status: 'connected' },
          black: { status: 'computer', skill: 'master' },
        },
      });

      const btnBlack = document.getElementById('btn-join-black');
      const statusBlack = btnBlack.querySelector('.join-status');

      expect(btnBlack.disabled).toBe(true);
      expect(statusBlack.textContent).toBe('Computer (Master)');
    });

    it('shows "Computer (Beginner)" for beginner skill', async () => {
      const { ws } = await setupModules();

      sendState(ws, {
        role: null,
        seats: {
          white: { status: 'free' },
          black: { status: 'computer', skill: 'beginner' },
        },
      });

      const btnBlack = document.getElementById('btn-join-black');
      const statusBlack = btnBlack.querySelector('.join-status');

      expect(btnBlack.disabled).toBe(true);
      expect(statusBlack.textContent).toBe('Computer (Beginner)');
    });

    it('shows "Computer (Grandmaster)" for grandmaster skill', async () => {
      const { ws } = await setupModules();

      sendState(ws, {
        role: null,
        seats: {
          white: { status: 'free' },
          black: { status: 'computer', skill: 'grandmaster' },
        },
      });

      const statusBlack = document.getElementById('btn-join-black').querySelector('.join-status');

      expect(statusBlack.textContent).toBe('Computer (Grandmaster)');
    });

    it('shows free seat as Available when no computer active', async () => {
      const { ws } = await setupModules();

      sendState(ws, {
        role: null,
        seats: {
          white: { status: 'free' },
          black: { status: 'free' },
        },
      });

      const btnBlack = document.getElementById('btn-join-black');
      const statusBlack = btnBlack.querySelector('.join-status');

      expect(btnBlack.disabled).toBe(false);
      expect(statusBlack.textContent).toBe('Available');
    });
  });

  // -- Menu computer section visibility ------------------

  describe('menu -- computer section visibility', () => {
    it('shows skill-change section when computer opponent is active', async () => {
      const { ws, ui } = await setupModules();

      sendState(ws, {
        role: 'white',
        seats: {
          white: { status: 'connected' },
          black: { status: 'computer', skill: 'master' },
        },
        computerPlayer: { color: 'black', skill: 'master' },
      });

      ui.showMenu();

      const computerSection = document.getElementById('menu-computer-section');
      const skillChangeSection = document.getElementById('menu-skill-change-section');

      expect(computerSection.classList.contains('visible')).toBe(false);
      expect(skillChangeSection.classList.contains('visible')).toBe(true);
    });

    it('sets skill-change dropdown value to current skill', async () => {
      const { ws, ui } = await setupModules();

      sendState(ws, {
        role: 'white',
        seats: {
          white: { status: 'connected' },
          black: { status: 'computer', skill: 'beginner' },
        },
        computerPlayer: { color: 'black', skill: 'beginner' },
      });

      ui.showMenu();

      const dropdown = document.getElementById('menu-skill-change-dropdown');
      expect(dropdown.value).toBe('beginner');
    });

    it('shows activation section when opponent seat is free and no computer', async () => {
      const { ws, ui } = await setupModules();

      sendState(ws, {
        role: 'white',
        seats: {
          white: { status: 'connected' },
          black: { status: 'free' },
        },
        computerPlayer: null,
      });

      ui.showMenu();

      const computerSection = document.getElementById('menu-computer-section');
      const skillChangeSection = document.getElementById('menu-skill-change-section');

      expect(computerSection.classList.contains('visible')).toBe(true);
      expect(skillChangeSection.classList.contains('visible')).toBe(false);
    });

    it('hides both computer sections when opponent seat is occupied', async () => {
      const { ws, ui } = await setupModules();

      sendState(ws, {
        role: 'white',
        seats: {
          white: { status: 'connected' },
          black: { status: 'occupied' },
        },
        computerPlayer: null,
      });

      ui.showMenu();

      const computerSection = document.getElementById('menu-computer-section');
      const skillChangeSection = document.getElementById('menu-skill-change-section');

      expect(computerSection.classList.contains('visible')).toBe(false);
      expect(skillChangeSection.classList.contains('visible')).toBe(false);
    });

    it('hides both computer sections for spectators', async () => {
      const { ws, ui } = await setupModules();

      sendState(ws, {
        role: 'spectator',
        seats: {
          white: { status: 'connected' },
          black: { status: 'computer', skill: 'master' },
        },
        computerPlayer: { color: 'black', skill: 'master' },
      });

      ui.showMenu();

      const computerSection = document.getElementById('menu-computer-section');
      const skillChangeSection = document.getElementById('menu-skill-change-section');

      expect(computerSection.classList.contains('visible')).toBe(false);
      expect(skillChangeSection.classList.contains('visible')).toBe(false);
    });

    it('hides both computer sections when game is over', async () => {
      const { ws, ui } = await setupModules();

      sendState(ws, {
        role: 'white',
        gameOver: true,
        gameResult: 'White wins',
        seats: {
          white: { status: 'connected' },
          black: { status: 'computer', skill: 'master' },
        },
        computerPlayer: { color: 'black', skill: 'master' },
      });

      ui.showMenu();

      const computerSection = document.getElementById('menu-computer-section');
      const skillChangeSection = document.getElementById('menu-skill-change-section');

      expect(computerSection.classList.contains('visible')).toBe(false);
      expect(skillChangeSection.classList.contains('visible')).toBe(false);
    });
  });

  // -- computerUnavailable -> error display ----------------

  describe('computerUnavailable -- error toast', () => {
    it('shows error toast with reason when computerUnavailable received', async () => {
      const { ws } = await setupModules();

      // First join as white and activate computer so the UI is in a known state
      sendState(ws, {
        role: 'white',
        seats: {
          white: { status: 'connected' },
          black: { status: 'computer', skill: 'beginner' },
        },
        computerPlayer: { color: 'black', skill: 'beginner' },
      });

      sendMessage(ws, {
        type: 'computerUnavailable',
        color: 'black',
        reason: 'Engine crashed',
      });

      const errorToast = document.getElementById('error-toast');
      expect(errorToast.classList.contains('visible')).toBe(true);
      expect(errorToast.textContent).toBe('Engine crashed');
    });

    it('shows error toast for "could not find a legal move" reason', async () => {
      const { ws } = await setupModules();

      sendState(ws, {
        role: 'white',
        seats: {
          white: { status: 'connected' },
          black: { status: 'computer', skill: 'beginner' },
        },
        computerPlayer: { color: 'black', skill: 'beginner' },
      });

      sendMessage(ws, {
        type: 'computerUnavailable',
        color: 'black',
        reason: 'Engine could not find a legal move',
      });

      const errorToast = document.getElementById('error-toast');
      expect(errorToast.classList.contains('visible')).toBe(true);
      expect(errorToast.textContent).toContain('could not find');
    });

    it('hides thinking indicator when computerUnavailable received', async () => {
      const { ws } = await setupModules();

      sendState(ws, {
        role: 'white',
        seats: {
          white: { status: 'connected' },
          black: { status: 'computer', skill: 'beginner' },
        },
        computerPlayer: { color: 'black', skill: 'beginner' },
      });

      // Show thinking indicator
      sendMessage(ws, { type: 'computerThinking', color: 'black' });
      const indicator = document.getElementById('computer-thinking');
      expect(indicator.classList.contains('visible')).toBe(true);

      // Now computerUnavailable should hide it
      sendMessage(ws, {
        type: 'computerUnavailable',
        color: 'black',
        reason: 'Engine crashed',
      });
      expect(indicator.classList.contains('visible')).toBe(false);
    });
  });

  // -- computerThinking indicator -------------------------

  describe('computerThinking -- indicator display', () => {
    it('shows thinking indicator with color label', async () => {
      const { ws } = await setupModules();

      sendState(ws, {
        role: 'white',
        seats: {
          white: { status: 'connected' },
          black: { status: 'computer', skill: 'beginner' },
        },
        computerPlayer: { color: 'black', skill: 'beginner' },
      });

      sendMessage(ws, { type: 'computerThinking', color: 'black' });

      const indicator = document.getElementById('computer-thinking');
      expect(indicator.classList.contains('visible')).toBe(true);
      expect(indicator.textContent).toContain('Black');
      expect(indicator.textContent).toContain('thinking');
    });

    it('hides thinking indicator on move', async () => {
      const { ws } = await setupModules();

      sendState(ws, {
        role: 'white',
        seats: {
          white: { status: 'connected' },
          black: { status: 'computer', skill: 'beginner' },
        },
        computerPlayer: { color: 'black', skill: 'beginner' },
      });

      // Show thinking indicator
      sendMessage(ws, { type: 'computerThinking', color: 'black' });
      const indicator = document.getElementById('computer-thinking');
      expect(indicator.classList.contains('visible')).toBe(true);

      // Send a move message -- should hide indicator
      sendMessage(ws, {
        type: 'move',
        fromFile: 4,
        fromRank: 6,
        toFile: 4,
        toRank: 4,
        color: 'black',
        notation: 'e7-e5',
      });
      expect(indicator.classList.contains('visible')).toBe(false);
    });
  });

  // -- computerActivated -> info toast ---------------------

  describe('computerActivated -- info toast', () => {
    it('shows info toast with skill label when computerActivated received', async () => {
      const { ws } = await setupModules();

      sendState(ws, {
        role: 'white',
        seats: {
          white: { status: 'connected' },
          black: { status: 'free' },
        },
        computerPlayer: null,
      });

      sendMessage(ws, {
        type: 'computerActivated',
        color: 'black',
        skill: 'beginner',
      });

      const errorToast = document.getElementById('error-toast');
      expect(errorToast.classList.contains('visible')).toBe(true);
      expect(errorToast.textContent).toContain('Beginner');
      expect(errorToast.textContent).toContain('activated');
    });
  });

  // -- computerSkillChanged -> info toast ------------------

  describe('computerSkillChanged -- info toast', () => {
    it('shows info toast with new skill when computerSkillChanged received', async () => {
      const { ws } = await setupModules();

      sendState(ws, {
        role: 'white',
        seats: {
          white: { status: 'connected' },
          black: { status: 'computer', skill: 'beginner' },
        },
        computerPlayer: { color: 'black', skill: 'beginner' },
      });

      sendMessage(ws, {
        type: 'computerSkillChanged',
        color: 'black',
        skill: 'grandmaster',
      });

      const errorToast = document.getElementById('error-toast');
      expect(errorToast.classList.contains('visible')).toBe(true);
      expect(errorToast.textContent).toContain('Grandmaster');
      expect(errorToast.textContent).toContain('Skill changed');
    });
  });

  // -- Activation button sends correct message ------------

  describe('activation button -- sends activateComputer', () => {
    it('clicking activate button sends activateComputer with opponent color and skill', async () => {
      const { ws, ui } = await setupModules();

      sendState(ws, {
        role: 'white',
        seats: {
          white: { status: 'connected' },
          black: { status: 'free' },
        },
        computerPlayer: null,
      });

      ui.showMenu();

      // Set the dropdown to a specific skill
      const dropdown = document.getElementById('menu-computer-skill-dropdown');
      dropdown.value = 'intermediate';

      // Click the activate button
      const btn = document.getElementById('btn-menu-activate-computer');
      btn.click();

      // Check that a message was sent
      expect(ws.sentData.length).toBeGreaterThan(0);
      const lastMsg = JSON.parse(ws.sentData[ws.sentData.length - 1]);
      expect(lastMsg.type).toBe('activateComputer');
      expect(lastMsg.color).toBe('black'); // opponent of white
      expect(lastMsg.skill).toBe('intermediate');
    });
  });

  // -- Skill change button sends correct message ---------

  describe('skill change button -- sends changeSkill', () => {
    it('clicking change skill button sends changeSkill with selected skill', async () => {
      const { ws, ui } = await setupModules();

      sendState(ws, {
        role: 'white',
        seats: {
          white: { status: 'connected' },
          black: { status: 'computer', skill: 'beginner' },
        },
        computerPlayer: { color: 'black', skill: 'beginner' },
      });

      ui.showMenu();

      const dropdown = document.getElementById('menu-skill-change-dropdown');
      dropdown.value = 'advanced';

      const btn = document.getElementById('btn-menu-change-skill');
      btn.click();

      expect(ws.sentData.length).toBeGreaterThan(0);
      const lastMsg = JSON.parse(ws.sentData[ws.sentData.length - 1]);
      expect(lastMsg.type).toBe('changeSkill');
      expect(lastMsg.skill).toBe('advanced');
    });
  });
});
