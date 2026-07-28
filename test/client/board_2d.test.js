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
});
