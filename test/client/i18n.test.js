// ═══════════════════════════════════════════════════════════
//  i18n — real shared module tests (no mocks)
// ═══════════════════════════════════════════════════════════

import { describe, test, expect, beforeEach, beforeAll, vi } from 'vitest';
import { JSDOM } from 'jsdom';

// Import the real shared modules
import { t, setLocale, getLocale, LOCALES, CATALOG } from '../../shared/i18n.mjs';
import enUS from '../../shared/locales/en-US.mjs';
import es from '../../shared/locales/es.mjs';
import fr from '../../shared/locales/fr.mjs';
import de from '../../shared/locales/de.mjs';
import zhCN from '../../shared/locales/zh-CN.mjs';

// Mock only the unrelated rendering dependency. The real network, UI,
// disconnected/computer components, and shared i18n modules remain in use.
vi.mock('../../client/pieces.js', () => ({
  pieceMeshes: [],
  getSvgPieceSet: vi.fn(() => 'mpchess'),
  setSvgPieceSet: vi.fn(),
  getPieceAssetUrl: vi.fn((fileName) => `files/pieces/2d/mpchess/${fileName}.svg`),
  getPieceSvgUrl: vi.fn((pieceId) => `files/pieces/2d/mpchess/${pieceId}.svg`),
  getModelSet: vi.fn(() => 'simple-classic'),
  setModelSet: vi.fn(),
  SVG_PIECE_SETS: ['mpchess'],
  MODEL_SETS: ['simple-classic'],
  reloadPieceModels: vi.fn(),
}));

describe('i18n — real shared module', () => {
  beforeEach(() => {
    setLocale('en-US');
  });

  test('LOCALES has all 5 entries', () => {
    expect(Object.keys(LOCALES)).toHaveLength(5);
    expect(LOCALES).toHaveProperty('en-US', 'English');
    expect(LOCALES).toHaveProperty('es', 'Español');
    expect(LOCALES).toHaveProperty('fr', 'Français');
    expect(LOCALES).toHaveProperty('de', 'Deutsch');
    expect(LOCALES).toHaveProperty('zh-CN', '简体中文');
  });

  test('t() returns English by default', () => {
    expect(t('ui.title')).toBe('♔ 3D Chess ♚');
    expect(t('ui.restart')).toBe('New Game');
  });

  test('setLocale() switches to Spanish', () => {
    setLocale('es');
    expect(t('ui.title')).toBe('♔ Ajedrez 3D ♚');
    expect(t('ui.restart')).toBe('Nueva partida');
  });

  test('setLocale() switches to French', () => {
    setLocale('fr');
    expect(t('ui.title')).toBe('♔ Échecs 3D ♚');
  });

  test('setLocale() switches to German', () => {
    setLocale('de');
    expect(t('ui.title')).toBe('♔ 3D-Schach ♚');
  });

  test('setLocale() switches to Chinese', () => {
    setLocale('zh-CN');
    expect(t('ui.title')).toBe('♔ 3D国际象棋 ♚');
  });

  test('getLocale() returns current locale', () => {
    expect(getLocale()).toBe('en-US');
    setLocale('es');
    expect(getLocale()).toBe('es');
    setLocale('en-US');
  });

  test('t() with params interpolates values', () => {
    setLocale('en-US');
    expect(t('ui.seat_returning', { colorName: 'White', remaining: 30 })).toBe(
      'White returns in 30s'
    );
  });

  test('t() with params in Spanish', () => {
    setLocale('es');
    expect(t('ui.seat_returning', { colorName: 'Blancas', remaining: 15 })).toBe(
      'Blancas vuelve en 15s'
    );
  });

  test('t() falls back to key for missing translation', () => {
    expect(t('nonexistent.key')).toBe('nonexistent.key');
  });

  test('t() with undefined params returns raw string', () => {
    expect(t('ui.seat_returning')).toContain('{colorName}');
  });

  test('t() with empty key returns empty string', () => {
    expect(t('')).toBe('');
  });

  test('t() with null key returns empty string', () => {
    expect(t(null)).toBe('');
  });

  test('setLocale() with invalid locale keeps current', () => {
    setLocale('en-US');
    setLocale('xx-INVALID');
    expect(getLocale()).toBe('en-US');
  });
});

describe('i18n — catalog key parity', () => {
  const allLocales = { 'en-US': enUS, es, fr, de, 'zh-CN': zhCN };
  const enKeys = new Set(Object.keys(enUS));

  for (const [code, dict] of Object.entries(allLocales)) {
    test(`${code} has same keys as en-US`, () => {
      const keys = new Set(Object.keys(dict));
      const missing = [...enKeys].filter((k) => !keys.has(k));
      const extra = [...keys].filter((k) => !enKeys.has(k));
      expect(missing).toHaveLength(0);
      expect(extra).toHaveLength(0);
    });
  }
});

describe('i18n — placeholder parity', () => {
  const allLocales = { 'en-US': enUS, es, fr, de, 'zh-CN': zhCN };

  // Find all keys with placeholders in en-US
  const enPlaceholderKeys = Object.entries(enUS)
    .filter(([, v]) => typeof v === 'string' && v.includes('{'))
    .map(([k]) => k);

  for (const key of enPlaceholderKeys) {
    test(`placeholder parity for ${key}`, () => {
      const enPattern = enUS[key].match(/\{(\w+)\}/g);
      if (!enPattern) return;
      const enPlaceholders = new Set(enPattern.map((p) => p.slice(1, -1)));

      for (const [code, dict] of Object.entries(allLocales)) {
        const val = dict[key];
        if (typeof val !== 'string') continue;
        const placeholders = val.match(/\{(\w+)\}/g);
        if (!placeholders) {
          expect(code).toBe('en-US'); // should have placeholders
          continue;
        }
        const phSet = new Set(placeholders.map((p) => p.slice(1, -1)));
        expect(phSet).toEqual(enPlaceholders);
      }
    });
  }
});

describe('i18n — DOM attribute refresh', () => {
  let dom, document;

  beforeEach(() => {
    dom = new JSDOM(`<!DOCTYPE html><html>
      <div data-i18n="ui.title">Title</div>
      <button data-i18n-aria-label="ui.close" aria-label="Close">X</button>
      <input data-i18n-placeholder="ui.fen_placeholder" placeholder="FEN" />
      <span data-i18n-title="ui.menu">Menu</span>
    </html>`);
    document = dom.window.document;
  });

  test('applyTranslations updates data-i18n textContent', async () => {
    const { applyTranslations } = await import('../../client/localize-dom.js');
    setLocale('en-US');
    applyTranslations(document);
    expect(document.querySelector('[data-i18n]').textContent).toBe('♔ 3D Chess ♚');
  });

  test('applyTranslations updates data-i18n-aria-label', async () => {
    const { applyTranslations } = await import('../../client/localize-dom.js');
    setLocale('en-US');
    applyTranslations(document);
    expect(document.querySelector('[data-i18n-aria-label]').getAttribute('aria-label')).toBe(
      'Close'
    );
  });

  test('applyTranslations updates data-i18n-placeholder', async () => {
    const { applyTranslations } = await import('../../client/localize-dom.js');
    setLocale('en-US');
    applyTranslations(document);
    const ph = document.querySelector('[data-i18n-placeholder]').getAttribute('placeholder');
    expect(ph).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  });

  test('applyTranslations updates data-i18n-title', async () => {
    const { applyTranslations } = await import('../../client/localize-dom.js');
    setLocale('en-US');
    applyTranslations(document);
    expect(document.querySelector('[data-i18n-title]').getAttribute('title')).toBe('Menu');
  });

  test('applyTranslations switches language', async () => {
    const { applyTranslations } = await import('../../client/localize-dom.js');
    setLocale('es');
    applyTranslations(document);
    expect(document.querySelector('[data-i18n]').textContent).toBe('♔ Ajedrez 3D ♚');
    expect(document.querySelector('[data-i18n-aria-label]').getAttribute('aria-label')).toBe(
      'Cerrar'
    );
  });
});

describe('i18n — dynamic UI refresh across locale changes', () => {
  // Load the real index.html into JSDOM so all UI elements exist
  // Use a single JSDOM instance for all tests that need DOM
  beforeAll(() => {
    const fs = require('fs');
    const path = require('path');
    const html = fs.readFileSync(path.join(__dirname, '../../client/index.html'), 'utf8');
    const dom = new JSDOM(html, { url: 'http://localhost' });
    globalThis.document = dom.window.document;
    globalThis.window = dom.window;
  });

  test('refreshI18n updates draw offer DOM text', async () => {
    const { showDrawOffer, refreshI18n, hideDrawOffer } = await import('../../client/ui.js');
    const overlay = document.getElementById('draw-offer-overlay');
    const text = document.getElementById('draw-offer-text');

    setLocale('en-US');
    showDrawOffer('white');
    const enText = text.textContent;
    expect(enText).toContain('White');

    setLocale('es');
    refreshI18n();
    const esText = text.textContent;
    expect(esText).not.toBe(enText);
    expect(esText).toContain('Blancas');

    hideDrawOffer();
  });

  test('refreshI18n updates state-driven production DOM text', async () => {
    const { refreshI18n } = await import('../../client/ui.js');
    const { handleServerMessage } = await import('../../client/network.js');
    const state = {
      type: 'state',
      role: 'white',
      board: [],
      turn: 'white',
      promotingPiece: null,
      gameOver: true,
      gameResult: 'game.checkmate_white',
      moveHistory: [],
      castlingRights: { wK: true, wQ: true, bK: true, bQ: true },
      enPassantTarget: null,
      disconnectedPlayers: [{ color: 'black', token: 'black-token', disconnectedAt: Date.now() }],
      seats: {
        white: { status: 'occupied' },
        black: { status: 'occupied' },
      },
      computerPlayer: null,
      halfmoveClock: 0,
      threefoldCount: 0,
      canClaimDraw: false,
      capturedPieces: null,
      playerCount: 2,
      spectatorCount: 1,
      fen: '',
      lastMove: null,
    };

    setLocale('en-US');
    try {
      handleServerMessage({ data: JSON.stringify(state) });
      handleServerMessage({
        data: JSON.stringify({ type: 'computerThinking', color: 'black' }),
      });

      const gameOver = document.getElementById('game-over-text');
      const playerCount = document.getElementById('player-count');
      const disconnected = document.getElementById('opponent-disconnected-text');
      const thinking = document.getElementById('computer-thinking');

      expect(document.getElementById('game-over-overlay').classList).toContain('visible');
      expect(document.getElementById('opponent-disconnected-banner').classList).toContain(
        'visible'
      );
      expect(thinking.classList).toContain('visible');
      expect(gameOver.textContent).toBe('Checkmate! White wins!');
      expect(playerCount.textContent).toBe('Players: 2 · Spectators: 1');
      expect(disconnected.textContent).toContain('Black disconnected');
      expect(thinking.textContent).toBe('🤖 Black is thinking...');

      setLocale('es');
      refreshI18n();

      expect(gameOver.textContent).toBe('¡Jaque mate! ¡Ganan las Blancas!');
      expect(playerCount.textContent).toBe('Jugadores: 2 · Espectadores: 1');
      expect(disconnected.textContent).toContain('Negras desconectado');
      expect(thinking.textContent).toBe('🤖 Negras está pensando...');
    } finally {
      handleServerMessage({ data: JSON.stringify({ type: 'move' }) });
      handleServerMessage({
        data: JSON.stringify({
          ...state,
          gameOver: false,
          gameResult: null,
          disconnectedPlayers: [],
        }),
      });
      setLocale('en-US');
    }
  });

  test('non-English translations differ from English', () => {
    const keys = [
      'game.checkmate_white',
      'game.stalemate',
      'ui.disconnected',
      'ui.computer_thinking',
      'msg.draw_offer',
    ];
    for (const key of keys) {
      setLocale('en-US');
      const enVal = t(key, { color: 'White', players: 2, spectators: 1 });
      setLocale('es');
      const esVal = t(key, { color: 'Blancas', players: 2, spectators: 1 });
      expect(esVal).not.toBe(enVal);
    }
  });
});

describe('i18n — server key format', () => {
  test('game result keys use machine-readable format', () => {
    setLocale('en-US');
    expect(t('game.checkmate_white')).toContain('White');
    expect(t('game.checkmate_black')).toContain('Black');
    expect(t('game.stalemate')).toBeTruthy();
  });

  test('error keys use machine-readable format', () => {
    setLocale('en-US');
    expect(t('error.not_your_turn')).toBeTruthy();
    expect(t('error.invalid_move')).toBeTruthy();
  });

  test('Game.tryMove produces real checkmate with namespaced result', () => {
    const { randomBytes } = require('node:crypto');
    const { initZobrist, Game } = require('../../shared/chess.mjs');
    initZobrist(() => randomBytes(8));
    const game = new Game();
    const wsWhite = { id: 'white' };
    const wsBlack = { id: 'black' };
    // Add players to the game
    game.addPlayer(wsWhite);
    game.addPlayer(wsBlack);

    // Scholar's mate: e4 e5 Qh5 Nc6 Bc4 Nf6 Qxf7#
    // Coordinates: file a=0..h=7, rank 0=rank1..7=rank8
    let r = game.tryMove(wsWhite, 4, 1, 4, 3); // e2-e4
    expect(r.ok).toBe(true);
    r = game.tryMove(wsBlack, 4, 6, 4, 4); // e7-e5
    expect(r.ok).toBe(true);
    r = game.tryMove(wsWhite, 3, 0, 7, 4); // Qd1-h5
    expect(r.ok).toBe(true);
    r = game.tryMove(wsBlack, 1, 7, 2, 5); // Nb8-c6
    expect(r.ok).toBe(true);
    r = game.tryMove(wsWhite, 5, 0, 2, 3); // Bf1-c4
    expect(r.ok).toBe(true);
    r = game.tryMove(wsBlack, 6, 7, 5, 5); // Ng8-f6
    expect(r.ok).toBe(true);
    r = game.tryMove(wsWhite, 7, 4, 5, 6); // Qh5xf7#
    expect(r.ok).toBe(true);

    const state = game.getState();
    // The server sends machine-readable namespaced keys
    expect(state.gameResult).toBe('game.checkmate_white');
    expect(state.gameOver).toBe(true);
  });
});

describe('i18n — non-English reconnect', () => {
  // Uses the same JSDOM from the dynamic UI refresh describe block
  test('Spanish reconnect button enabled via updateJoinButtons', async () => {
    const { updateJoinButtons } = await import('../../client/ui/join.js');
    const network = await import('../../client/network.js');

    // Set up Spanish locale with held seat and validated token
    setLocale('es');
    network.seatStatus.white = { status: 'held' };
    network.validatedTokens.white = true;

    updateJoinButtons();

    const btnWhite = document.getElementById('btn-join-white');
    const statusWhite = btnWhite.querySelector('.join-status');
    // Button should be enabled with Spanish reconnect text
    expect(btnWhite.disabled).toBe(false);
    expect(statusWhite.textContent).toBe('Reconectar');
  });
});

describe('i18n — no embedded CATALOG in client/', () => {
  test('client/ contains no embedded CATALOG object', () => {
    const fs = require('fs');
    const path = require('path');
    const clientDir = path.join(__dirname, '../../client');
    function scan(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== 'vendor') {
          scan(full);
        } else if (entry.name.endsWith('.js')) {
          const content = fs.readFileSync(full, 'utf8');
          expect(content).not.toMatch(/const\s+CATALOG\s*=/);
        }
      }
    }
    scan(clientDir);
  });
});

describe('i18n — production markup audit', () => {
  test('client/index.html has data-i18n on help section summaries', () => {
    const fs = require('fs');
    const path = require('path');
    const html = fs.readFileSync(path.join(__dirname, '../../client/index.html'), 'utf8');
    // All help section summaries should have data-i18n attributes
    const summaries = html.match(/<summary[^>]*>[^<]+<\/summary>/g) || [];
    for (const s of summaries) {
      expect(s).toMatch(/data-i18n=/);
    }
  });

  test('client/index.html has data-i18n on capture labels', () => {
    const fs = require('fs');
    const path = require('path');
    const html = fs.readFileSync(path.join(__dirname, '../../client/index.html'), 'utf8');
    const capLabels = html.match(/class="cap-label"[^>]*>[^<]+<\/span>/g) || [];
    for (const l of capLabels) {
      expect(l).toMatch(/data-i18n=/);
    }
  });
});

describe('i18n — development warning', () => {
  test('missing key in non-English locale triggers console warning', () => {
    const testKey = 'game.checkmate_white';
    const esCatalog = CATALOG.es;
    const savedValue = esCatalog[testKey];
    delete esCatalog[testKey];

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setLocale('es');
    const result = t(testKey);

    // Should warn about missing translation
    expect(warnSpy).toHaveBeenCalledWith(
      `[i18n] Missing translation for "${testKey}" in locale "es"`
    );
    // Should return the key as fallback
    expect(result).toBe(testKey);

    // Restore the key
    esCatalog[testKey] = savedValue;
    warnSpy.mockRestore();
  });

  test('production mode suppresses missing-key warning', () => {
    const testKey = 'game.checkmate_white';
    const esCatalog = CATALOG.es;
    const savedValue = esCatalog[testKey];
    delete esCatalog[testKey];

    // Set NODE_ENV to production
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setLocale('es');
    const result = t(testKey);

    // Should NOT warn in production
    expect(warnSpy).not.toHaveBeenCalled();
    expect(result).toBe(testKey);

    // Restore
    esCatalog[testKey] = savedValue;
    process.env.NODE_ENV = origEnv;
    warnSpy.mockRestore();
  });

  test('t() returns key itself for missing translation', () => {
    setLocale('en-US');
    const result = t('this.key.does.not.exist');
    expect(result).toBe('this.key.does.not.exist');
  });
});
