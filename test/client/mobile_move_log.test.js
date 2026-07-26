import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import './mobile-mocks.js';
import {
  setupUIDOM,
  setupFullscreenMocks,
  setupMobileViewport,
  setupDesktopViewport,
  cleanupMobileMocks,
} from './mobile-test-helpers.js';

describe('mobile move log', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    setupUIDOM();
    setupFullscreenMocks();
  });

  afterEach(() => {
    cleanupMobileMocks();
  });

  it('should show full move history on desktop', async () => {
    setupDesktopViewport();

    const network = await import('../../client/network.js');
    const ui = await import('../../client/ui.js');

    // 10 moves (5 pairs)
    network.moveHistory = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'O-O', 'Nf6', 'd3', 'Be7'];

    ui.updateMoveLog();

    const rows = document.querySelectorAll('#move-log div');
    expect(rows.length).toBe(5); // all 5 move pairs
  });

  it('should cap move history at 6 pairs on mobile', async () => {
    setupMobileViewport();

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
    setupMobileViewport();

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
    setupMobileViewport();

    const network = await import('../../client/network.js');
    const ui = await import('../../client/ui.js');

    // Only 4 moves (2 pairs)
    network.moveHistory = ['e4', 'e5', 'Nf3', 'Nc6'];

    ui.updateMoveLog();

    const rows = document.querySelectorAll('#move-log div');
    expect(rows.length).toBe(2);
  });

  it('should align to white move when history has odd length on mobile', async () => {
    setupMobileViewport();

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
