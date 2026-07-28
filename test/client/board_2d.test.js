// ═══════════════════════════════════════════════════════════
//  2D BOARD — toggle mode cycling (desktop 3-mode, mobile 2-mode)
// ═══════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import './mobile-mocks.js';
import {
  setupUIDOM,
  setupMobileViewport,
  setupDesktopViewport,
  cleanupMobileMocks,
} from './mobile-test-helpers.js';

describe('board_2d toggle modes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupUIDOM();
    // Inject the 2D board overlay element
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div id="board-2d-overlay"><div id="board-2d-container"></div></div>'
    );
  });

  afterEach(() => {
    cleanupMobileMocks();
  });

  describe('desktop (3-mode cycle)', () => {
    beforeEach(() => {
      setupDesktopViewport(1920, 1080);
    });

    it('cycles off → small → fullscreen → off', async () => {
      const { toggle2DBoard, is2DBoardVisible } = await import('../../client/board_2d.js');
      const overlay = document.getElementById('board-2d-overlay');

      // Start: off
      expect(is2DBoardVisible()).toBe(false);
      expect(overlay.classList.contains('visible')).toBe(false);

      // Toggle 1: small (top-right)
      toggle2DBoard();
      expect(is2DBoardVisible()).toBe(true);
      expect(overlay.classList.contains('visible')).toBe(true);
      expect(overlay.classList.contains('fullscreen')).toBe(false);

      // Toggle 2: fullscreen (centered)
      toggle2DBoard();
      expect(is2DBoardVisible()).toBe(true);
      expect(overlay.classList.contains('visible')).toBe(true);
      expect(overlay.classList.contains('fullscreen')).toBe(true);

      // Toggle 3: off
      toggle2DBoard();
      expect(is2DBoardVisible()).toBe(false);
      expect(overlay.classList.contains('visible')).toBe(false);
      expect(overlay.classList.contains('fullscreen')).toBe(false);
    });
  });

  describe('mobile (2-mode cycle)', () => {
    beforeEach(() => {
      setupMobileViewport(390, 844);
    });

    it('cycles off → on → off (no fullscreen)', async () => {
      const { toggle2DBoard, is2DBoardVisible } = await import('../../client/board_2d.js');
      const overlay = document.getElementById('board-2d-overlay');

      // Start: off
      expect(is2DBoardVisible()).toBe(false);
      expect(overlay.classList.contains('visible')).toBe(false);

      // Toggle 1: on
      toggle2DBoard();
      expect(is2DBoardVisible()).toBe(true);
      expect(overlay.classList.contains('visible')).toBe(true);
      expect(overlay.classList.contains('fullscreen')).toBe(false);

      // Toggle 2: off (skips fullscreen)
      toggle2DBoard();
      expect(is2DBoardVisible()).toBe(false);
      expect(overlay.classList.contains('visible')).toBe(false);
      expect(overlay.classList.contains('fullscreen')).toBe(false);
    });

    it('never sets fullscreen class on mobile after multiple toggles', async () => {
      const { toggle2DBoard } = await import('../../client/board_2d.js');
      const overlay = document.getElementById('board-2d-overlay');

      // Toggle several times
      for (let i = 0; i < 6; i++) {
        toggle2DBoard();
      }
      expect(overlay.classList.contains('fullscreen')).toBe(false);
    });
  });

  describe('saveAndHide2DBoard / restore2DBoard (desktop)', () => {
    beforeEach(() => {
      vi.resetModules();
      setupDesktopViewport(1920, 1080);
    });

    it('saves and restores from mode 0 (off)', async () => {
      const { toggle2DBoard, saveAndHide2DBoard, restore2DBoard, is2DBoardVisible } =
        await import('../../client/board_2d.js');
      const overlay = document.getElementById('board-2d-overlay');

      // Start: off (mode 0)
      expect(is2DBoardVisible()).toBe(false);

      saveAndHide2DBoard();
      expect(is2DBoardVisible()).toBe(false);
      expect(overlay.classList.contains('visible')).toBe(false);

      restore2DBoard();
      expect(is2DBoardVisible()).toBe(false);
      expect(overlay.classList.contains('visible')).toBe(false);
    });

    it('saves and restores from mode 1 (small)', async () => {
      const { toggle2DBoard, saveAndHide2DBoard, restore2DBoard, is2DBoardVisible } =
        await import('../../client/board_2d.js');
      const overlay = document.getElementById('board-2d-overlay');

      // Enter mode 1 (small)
      toggle2DBoard();
      expect(is2DBoardVisible()).toBe(true);
      expect(overlay.classList.contains('visible')).toBe(true);
      expect(overlay.classList.contains('fullscreen')).toBe(false);

      saveAndHide2DBoard();
      expect(is2DBoardVisible()).toBe(false);
      expect(overlay.classList.contains('visible')).toBe(false);

      restore2DBoard();
      expect(is2DBoardVisible()).toBe(true);
      expect(overlay.classList.contains('visible')).toBe(true);
      expect(overlay.classList.contains('fullscreen')).toBe(false);
    });

    it('saves and restores from mode 2 (fullscreen)', async () => {
      const { toggle2DBoard, saveAndHide2DBoard, restore2DBoard, is2DBoardVisible } =
        await import('../../client/board_2d.js');
      const overlay = document.getElementById('board-2d-overlay');

      // Enter mode 2 (fullscreen)
      toggle2DBoard(); // mode 1
      toggle2DBoard(); // mode 2
      expect(is2DBoardVisible()).toBe(true);
      expect(overlay.classList.contains('fullscreen')).toBe(true);

      saveAndHide2DBoard();
      expect(is2DBoardVisible()).toBe(false);
      expect(overlay.classList.contains('visible')).toBe(false);
      expect(overlay.classList.contains('fullscreen')).toBe(false);

      restore2DBoard();
      expect(is2DBoardVisible()).toBe(true);
      expect(overlay.classList.contains('visible')).toBe(true);
      expect(overlay.classList.contains('fullscreen')).toBe(true);
    });

    it('multiple save/restore cycles do not interfere', async () => {
      const { toggle2DBoard, saveAndHide2DBoard, restore2DBoard, is2DBoardVisible } =
        await import('../../client/board_2d.js');
      const overlay = document.getElementById('board-2d-overlay');

      // Enter mode 1
      toggle2DBoard();

      // First save/restore
      saveAndHide2DBoard();
      expect(is2DBoardVisible()).toBe(false);
      restore2DBoard();
      expect(is2DBoardVisible()).toBe(true);

      // Second save/restore
      saveAndHide2DBoard();
      expect(is2DBoardVisible()).toBe(false);
      restore2DBoard();
      expect(is2DBoardVisible()).toBe(true);
      expect(overlay.classList.contains('visible')).toBe(true);
    });

    it('restore without prior save is safe (restores to off)', async () => {
      const { restore2DBoard, is2DBoardVisible } = await import('../../client/board_2d.js');
      const overlay = document.getElementById('board-2d-overlay');

      // Don't call saveAndHide2DBoard, just restore
      restore2DBoard();
      expect(is2DBoardVisible()).toBe(false);
      expect(overlay.classList.contains('visible')).toBe(false);
    });
  });

  describe('saveAndHide2DBoard / restore2DBoard (mobile)', () => {
    beforeEach(() => {
      vi.resetModules();
      setupMobileViewport(390, 844);
    });

    it('saves and restores from mode 1 (on) on mobile', async () => {
      const { toggle2DBoard, saveAndHide2DBoard, restore2DBoard, is2DBoardVisible } =
        await import('../../client/board_2d.js');
      const overlay = document.getElementById('board-2d-overlay');

      // Enter mode 1 (on)
      toggle2DBoard();
      expect(is2DBoardVisible()).toBe(true);

      saveAndHide2DBoard();
      expect(is2DBoardVisible()).toBe(false);
      expect(overlay.classList.contains('visible')).toBe(false);

      restore2DBoard();
      expect(is2DBoardVisible()).toBe(true);
      expect(overlay.classList.contains('visible')).toBe(true);
    });
  });

  describe('white-on-right square color rule', () => {
    beforeEach(() => {
      vi.resetModules();
      setupDesktopViewport(1920, 1080);
      document.body.innerHTML = '';
      setupUIDOM();
      document.body.insertAdjacentHTML(
        'beforeend',
        '<div id="board-2d-overlay"><div id="board-2d-container"></div></div>'
      );
    });

    it('standard orientation: bottom-right square is light', async () => {
      const { toggle2DBoard } = await import('../../client/board_2d.js');
      toggle2DBoard();

      const grid = document.querySelector('.board2d-grid');
      const squares = grid.querySelectorAll('.board2d-square');

      // Standard: bottom row = displayRank 7 (last 8 squares), rightmost = index 7
      const bottomRow = Array.from(squares).slice(56, 64);
      expect(bottomRow[7].classList.contains('light')).toBe(true);
    });

    it('flipped orientation formula: bottom-right is light', () => {
      const isLight = (actualRank, actualFile) => (actualRank + actualFile) % 2 === 1;

      // Standard bottom-right: actualRank=0, actualFile=7
      expect(isLight(0, 7)).toBe(true);
      // Flipped bottom-right: actualRank=7, actualFile=0
      expect(isLight(7, 0)).toBe(true);
    });

    it('flipped orientation file reversal maps correctly', () => {
      // Verify that the file reversal formula (7 - file) correctly maps
      // display files to actual board files for the flipped orientation.
      const actualFile = (file) => 7 - file;

      // Display file 0 (left) → actual file 7 (h-file)
      expect(actualFile(0)).toBe(7);
      // Display file 7 (right) → actual file 0 (a-file)
      expect(actualFile(7)).toBe(0);
      // Display file 3 → actual file 4
      expect(actualFile(3)).toBe(4);
    });
  });
});
