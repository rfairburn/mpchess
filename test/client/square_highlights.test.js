// ═══════════════════════════════════════════════════════════
//  SQUARE HIGHLIGHTS — tests for highlight annotation state
//  and color selection
// ═══════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('highlights module', () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  describe('addHighlight / clearHighlights / getHighlights', () => {
    it('adds a highlight and returns it from getHighlights', async () => {
      const { addHighlight, getHighlights } = await import('../../client/highlights.js');
      addHighlight(3, 4, '#ff0000');
      const highlights = getHighlights();
      expect(highlights).toHaveLength(1);
      expect(highlights[0]).toEqual({
        file: 3,
        rank: 4,
        color: '#ff0000',
      });
    });

    it('clears all highlights', async () => {
      const { addHighlight, clearHighlights, getHighlights } =
        await import('../../client/highlights.js');
      addHighlight(0, 0, '#ff0000');
      addHighlight(3, 4, '#00ff00');
      expect(getHighlights()).toHaveLength(2);
      clearHighlights();
      expect(getHighlights()).toHaveLength(0);
    });

    it('rejects out-of-bounds highlights', async () => {
      const { addHighlight, getHighlights } = await import('../../client/highlights.js');
      addHighlight(-1, 0, '#ff0000');
      addHighlight(8, 0, '#ff0000');
      addHighlight(0, -1, '#ff0000');
      addHighlight(0, 8, '#ff0000');
      expect(getHighlights()).toHaveLength(0);
    });

    it('replaces existing highlight on same square with different color', async () => {
      const { addHighlight, getHighlights } = await import('../../client/highlights.js');
      addHighlight(3, 4, '#ff0000');
      addHighlight(3, 4, '#00ff00');
      const highlights = getHighlights();
      expect(highlights).toHaveLength(1);
      expect(highlights[0].color).toBe('#00ff00');
    });

    it('removes highlight on same square with same color', async () => {
      const { addHighlight, getHighlights } = await import('../../client/highlights.js');
      addHighlight(3, 4, '#ff0000');
      expect(getHighlights()).toHaveLength(1);
      addHighlight(3, 4, '#ff0000');
      expect(getHighlights()).toHaveLength(0);
    });
  });

  describe('onHighlightChange', () => {
    it('fires callback on add', async () => {
      const { addHighlight, onHighlightChange } = await import('../../client/highlights.js');
      const cb = vi.fn();
      onHighlightChange(cb);
      addHighlight(3, 4, '#ff0000');
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('fires callback on clear', async () => {
      const { addHighlight, clearHighlights, onHighlightChange } =
        await import('../../client/highlights.js');
      const cb = vi.fn();
      onHighlightChange(cb);
      addHighlight(3, 4, '#ff0000');
      clearHighlights();
      expect(cb).toHaveBeenCalledTimes(2);
    });
  });

  describe('cross-interaction with arrows', () => {
    it('highlight replaces different-color arrow starting on square', async () => {
      const { addHighlight, getHighlights } = await import('../../client/highlights.js');
      const { addArrow, getArrows } = await import('../../client/arrows.js');
      addArrow({ file: 3, rank: 4 }, { file: 5, rank: 6 }, '#ff4444');
      expect(getArrows()).toHaveLength(1);
      addHighlight(3, 4, '#ffdd00');
      expect(getArrows()).toHaveLength(0);
      expect(getHighlights()).toHaveLength(1);
    });

    it('highlight replaces different-color arrow ending on square', async () => {
      const { addHighlight, getHighlights } = await import('../../client/highlights.js');
      const { addArrow, getArrows } = await import('../../client/arrows.js');
      addArrow({ file: 1, rank: 1 }, { file: 3, rank: 4 }, '#ff4444');
      expect(getArrows()).toHaveLength(1);
      addHighlight(3, 4, '#ffdd00');
      expect(getArrows()).toHaveLength(0);
      expect(getHighlights()).toHaveLength(1);
    });

    it('same-color highlight removes arrow without adding highlight', async () => {
      const { addHighlight, getHighlights } = await import('../../client/highlights.js');
      const { addArrow, getArrows } = await import('../../client/arrows.js');
      addArrow({ file: 3, rank: 4 }, { file: 5, rank: 6 }, '#ff4444');
      expect(getArrows()).toHaveLength(1);
      addHighlight(3, 4, '#ff4444');
      expect(getArrows()).toHaveLength(0);
      expect(getHighlights()).toHaveLength(0);
    });

    it('arrow replaces different-color highlights at endpoints', async () => {
      const { addHighlight, getHighlights } = await import('../../client/highlights.js');
      const { addArrow, getArrows } = await import('../../client/arrows.js');
      addHighlight(0, 0, '#ffdd00');
      addHighlight(2, 2, '#ff4444');
      expect(getHighlights()).toHaveLength(2);
      addArrow({ file: 0, rank: 0 }, { file: 2, rank: 2 }, '#4488ff');
      expect(getHighlights()).toHaveLength(0);
      expect(getArrows()).toHaveLength(1);
    });

    it('same-color arrow removes only matching highlight, preserves other', async () => {
      const { addHighlight, getHighlights } = await import('../../client/highlights.js');
      const { addArrow, getArrows } = await import('../../client/arrows.js');
      addHighlight(0, 0, '#ff4444');
      addHighlight(2, 2, '#4488ff');
      expect(getHighlights()).toHaveLength(2);
      addArrow({ file: 0, rank: 0 }, { file: 2, rank: 2 }, '#ff4444');
      expect(getHighlights()).toHaveLength(1);
      expect(getHighlights()[0].color).toBe('#4488ff');
      expect(getArrows()).toHaveLength(0);
    });

    it('same-color highlight removes only matching arrow, preserves other', async () => {
      const { addHighlight, getHighlights } = await import('../../client/highlights.js');
      const { addArrow, getArrows } = await import('../../client/arrows.js');
      addArrow({ file: 3, rank: 4 }, { file: 5, rank: 6 }, '#ff4444');
      addArrow({ file: 1, rank: 1 }, { file: 3, rank: 4 }, '#4488ff');
      expect(getArrows()).toHaveLength(2);
      addHighlight(3, 4, '#ff4444');
      expect(getArrows()).toHaveLength(1);
      expect(getArrows()[0].color).toBe('#4488ff');
      expect(getHighlights()).toHaveLength(0);
    });
  });

  describe('getHighlightColor', () => {
    it('returns neutral white with no modifier', async () => {
      const { getHighlightColor } = await import('../../client/highlights.js');
      expect(getHighlightColor({ ctrlKey: false, altKey: false, shiftKey: false })).toBe('#ffdd00');
    });

    it('returns red with Ctrl', async () => {
      const { getHighlightColor } = await import('../../client/highlights.js');
      expect(getHighlightColor({ ctrlKey: true, altKey: false, shiftKey: false })).toBe('#ff4444');
    });

    it('returns blue with Alt', async () => {
      const { getHighlightColor } = await import('../../client/highlights.js');
      expect(getHighlightColor({ ctrlKey: false, altKey: true, shiftKey: false })).toBe('#4488ff');
    });

    it('returns green with Shift', async () => {
      const { getHighlightColor } = await import('../../client/highlights.js');
      expect(getHighlightColor({ ctrlKey: false, altKey: false, shiftKey: true })).toBe('#44cc44');
    });

    it('priority: Ctrl > Alt > Shift', async () => {
      const { getHighlightColor } = await import('../../client/highlights.js');
      expect(getHighlightColor({ ctrlKey: true, altKey: true, shiftKey: true })).toBe('#ff4444');
    });
  });
});
