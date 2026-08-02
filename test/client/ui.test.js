import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Module mocks ──────────────────────────────────────────

vi.mock('../../client/network.js', () => ({
  myRole: null,
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
  sendPromotion: vi.fn(),
  sendRestart: vi.fn(),
  sendConcede: vi.fn(),
  sendLeave: vi.fn(),
  sendExportFen: vi.fn(),
  sendExportPgn: vi.fn(),
  sendImportFen: vi.fn(),
  sendOfferDraw: vi.fn(),
  sendDrawResponse: vi.fn(),
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

describe('ui.js — updateMoveLog', () => {
  let network;
  let updateMoveLog;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    createMinimalDOM();

    network = await import('../../client/network.js');
    const ui = await import('../../client/ui.js');
    updateMoveLog = ui.updateMoveLog;
  });

  it('renders an empty move log when moveHistory is empty', () => {
    network.moveHistory = [];
    updateMoveLog();
    const el = document.getElementById('move-log');
    expect(el.children.length).toBe(0);
    expect(el.innerHTML).toBe('');
  });

  it('renders paired moves correctly', () => {
    network.moveHistory = ['e4', 'e5', 'Nf3', 'Nc6'];
    updateMoveLog();
    const el = document.getElementById('move-log');
    expect(el.children.length).toBe(2);
    expect(el.children[0].querySelector('b').textContent).toBe('1.');
    expect(el.children[0].textContent).toBe('1. e4 e5');
    expect(el.children[1].querySelector('b').textContent).toBe('2.');
    expect(el.children[1].textContent).toBe('2. Nf3 Nc6');
  });

  it('renders odd number of moves (last move unpaired)', () => {
    network.moveHistory = ['e4', 'e5', 'Nf3'];
    updateMoveLog();
    const el = document.getElementById('move-log');
    expect(el.children.length).toBe(2);
    expect(el.children[1].textContent).toBe('2. Nf3 ');
  });

  it('escapes HTML in move notation (XSS prevention)', () => {
    network.moveHistory = ['<script>alert("xss")</script>', '<img onerror=alert(1)>'];
    updateMoveLog();
    const el = document.getElementById('move-log');
    // The script tag should appear as text, not as a DOM element
    expect(el.querySelector('script')).toBeNull();
    expect(el.querySelector('img')).toBeNull();
    // The raw text should contain the literal tag text
    expect(el.textContent).toContain('<script>alert("xss")</script>');
    expect(el.textContent).toContain('<img onerror=alert(1)>');
  });

  it('escapes HTML entities in move notation', () => {
    network.moveHistory = ['&lt;evil&gt;', '&amp;'];
    updateMoveLog();
    const el = document.getElementById('move-log');
    expect(el.textContent).toContain('&lt;evil&gt;');
    expect(el.textContent).toContain('&amp;');
  });

  it('clears previous content before rendering', () => {
    network.moveHistory = ['e4', 'e5'];
    updateMoveLog();
    expect(document.getElementById('move-log').children.length).toBe(1);

    network.moveHistory = [];
    updateMoveLog();
    expect(document.getElementById('move-log').children.length).toBe(0);
  });
});

describe('ui.js — mobile tap targets', () => {
  let controls;
  let ui;

  beforeEach(async () => {
    vi.resetModules();

    createMinimalDOM();

    controls = await import('../../client/controls.js');
    ui = await import('../../client/ui.js');
    controls.toggleMouseMode.mockReset();
  });

  it('clicking #mouse-mode calls toggleMouseMode', () => {
    document.getElementById('mouse-mode').click();
    expect(controls.toggleMouseMode).toHaveBeenCalledTimes(1);
  });

  it('clicking #mouse-mode does nothing when menu is open', () => {
    ui.showMenu();
    document.getElementById('mouse-mode').click();
    expect(controls.toggleMouseMode).not.toHaveBeenCalled();
  });

  it('clicking hamburger opens menu when closed', () => {
    expect(ui.menuOpen).toBe(false);
    document.getElementById('btn-menu-toggle').click();
    expect(document.getElementById('menu-overlay').classList.contains('visible')).toBe(true);
  });

  it('clicking hamburger closes menu when open', () => {
    ui.showMenu();
    expect(ui.menuOpen).toBe(true);
    document.getElementById('btn-menu-toggle').click();
    expect(ui.menuOpen).toBe(false);
    expect(document.getElementById('menu-overlay').classList.contains('visible')).toBe(false);
  });

  it('clicking #role-badge opens menu', () => {
    document.getElementById('role-badge').click();
    expect(document.getElementById('menu-overlay').classList.contains('visible')).toBe(true);
  });

  it('clicking #role-badge does nothing when menu is open', () => {
    ui.showMenu();
    vi.clearAllMocks();
    document.getElementById('role-badge').click();
    expect(ui.menuOpen).toBe(true);
  });

  it('clicking overlay background closes menu', () => {
    ui.showMenu();
    document.getElementById('menu-overlay').click();
    expect(ui.menuOpen).toBe(false);
    expect(document.getElementById('menu-overlay').classList.contains('visible')).toBe(false);
  });

  it('clicking inside menu box does not close menu', () => {
    ui.showMenu();
    document.getElementById('menu-box')?.click();
    expect(ui.menuOpen).toBe(true);
  });
});

describe('ui.js — captured pieces SVG rendering', () => {
  let ui;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    createMinimalDOM();
    ui = await import('../../client/ui.js');
  });

  it('renders captured pieces as SVG images with correct filenames and ordering', () => {
    const capWhite = document.querySelector('#captured-white .cap-pieces');
    const capBlack = document.querySelector('#captured-black .cap-pieces');

    ui.updateCapturedPieces({
      white: ['knight', 'pawn', 'queen'],
      black: ['rook', 'bishop'],
    });

    // White captured black pieces (3 images, ordered queen, knight, pawn)
    const whiteImgs = capWhite.querySelectorAll('img.cap-piece');
    expect(whiteImgs.length).toBe(3);
    expect(whiteImgs[0].src).toContain('bQ.svg');
    expect(whiteImgs[1].src).toContain('bN.svg');
    expect(whiteImgs[2].src).toContain('bP.svg');

    // Black captured white pieces (2 images, ordered rook, bishop)
    const blackImgs = capBlack.querySelectorAll('img.cap-piece');
    expect(blackImgs.length).toBe(2);
    expect(blackImgs[0].src).toContain('wR.svg');
    expect(blackImgs[1].src).toContain('wB.svg');
  });

  it('clears captured pieces when passed null', () => {
    const capWhite = document.querySelector('#captured-white .cap-pieces');
    const capBlack = document.querySelector('#captured-black .cap-pieces');

    ui.updateCapturedPieces({ white: ['pawn'], black: ['rook'] });
    expect(capWhite.querySelectorAll('img').length).toBe(1);
    expect(capBlack.querySelectorAll('img').length).toBe(1);

    ui.updateCapturedPieces(null);
    expect(capWhite.innerHTML).toBe('');
    expect(capBlack.innerHTML).toBe('');
  });

  it('does not mutate the input arrays', () => {
    const captured = {
      white: ['pawn', 'queen', 'knight'],
      black: ['bishop', 'rook'],
    };
    const whiteCopy = [...captured.white];
    const blackCopy = [...captured.black];

    ui.updateCapturedPieces(captured);

    expect(captured.white).toEqual(whiteCopy);
    expect(captured.black).toEqual(blackCopy);
  });
});
