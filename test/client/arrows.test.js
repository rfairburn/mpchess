// ═══════════════════════════════════════════════════════════
//  ARROWS — unit tests for arrow state, path, rendering, interaction
// ═══════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('arrows module', () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  describe('addArrow / clearArrows / getArrows', () => {
    it('adds an arrow and returns it from getArrows', async () => {
      const { addArrow, getArrows } = await import('../../client/arrows.js');
      addArrow({ file: 0, rank: 0 }, { file: 2, rank: 2 }, '#cccccc');
      const arrows = getArrows();
      expect(arrows).toHaveLength(1);
      expect(arrows[0]).toEqual({
        from: { file: 0, rank: 0 },
        to: { file: 2, rank: 2 },
        color: '#cccccc',
      });
    });

    it('clears all arrows', async () => {
      const { addArrow, clearArrows, getArrows } = await import('../../client/arrows.js');
      addArrow({ file: 0, rank: 0 }, { file: 1, rank: 1 }, '#cccccc');
      addArrow({ file: 2, rank: 2 }, { file: 3, rank: 3 }, '#ff4444');
      expect(getArrows()).toHaveLength(2);
      clearArrows();
      expect(getArrows()).toHaveLength(0);
    });

    it('rejects same-square arrows', async () => {
      const { addArrow, getArrows } = await import('../../client/arrows.js');
      addArrow({ file: 3, rank: 3 }, { file: 3, rank: 3 }, '#cccccc');
      expect(getArrows()).toHaveLength(0);
    });
  });

  describe('onArrowChange (cross-board visibility)', () => {
    it('fires all registered callbacks on add', async () => {
      const { addArrow, onArrowChange } = await import('../../client/arrows.js');
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      onArrowChange(cb1);
      onArrowChange(cb2);
      addArrow({ file: 0, rank: 0 }, { file: 1, rank: 1 }, '#cccccc');
      expect(cb1).toHaveBeenCalledTimes(1);
      expect(cb2).toHaveBeenCalledTimes(1);
    });

    it('fires all registered callbacks on clear', async () => {
      const { addArrow, clearArrows, onArrowChange } = await import('../../client/arrows.js');
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      onArrowChange(cb1);
      onArrowChange(cb2);
      addArrow({ file: 0, rank: 0 }, { file: 1, rank: 1 }, '#cccccc');
      clearArrows();
      expect(cb1).toHaveBeenCalledTimes(2);
      expect(cb2).toHaveBeenCalledTimes(2);
    });
  });

  describe('getArrowPath', () => {
    it('returns straight path for non-knight offsets', async () => {
      const { getArrowPath } = await import('../../client/arrows.js');
      const from = { file: 0, rank: 0 };
      const to = { file: 3, rank: 3 };
      expect(getArrowPath(from, to)).toEqual([from, to]);
    });

    it('returns straight path for adjacent squares', async () => {
      const { getArrowPath } = await import('../../client/arrows.js');
      expect(getArrowPath({ file: 0, rank: 0 }, { file: 1, rank: 0 })).toEqual([
        { file: 0, rank: 0 },
        { file: 1, rank: 0 },
      ]);
    });

    // All 8 knight offsets
    const knightOffsets = [
      { df: 2, dr: 1, expectedBend: { file: 2, rank: 0 } },
      { df: 2, dr: -1, expectedBend: { file: 2, rank: 0 } },
      { df: -2, dr: 1, expectedBend: { file: -2, rank: 0 } },
      { df: -2, dr: -1, expectedBend: { file: -2, rank: 0 } },
      { df: 1, dr: 2, expectedBend: { file: 0, rank: 2 } },
      { df: 1, dr: -2, expectedBend: { file: 0, rank: -2 } },
      { df: -1, dr: 2, expectedBend: { file: 0, rank: 2 } },
      { df: -1, dr: -2, expectedBend: { file: 0, rank: -2 } },
    ];

    for (const { df, dr, expectedBend } of knightOffsets) {
      it(`returns knight path for offset (${df}, ${dr})`, async () => {
        const { getArrowPath } = await import('../../client/arrows.js');
        const from = { file: 3, rank: 4 };
        const to = { file: 3 + df, rank: 4 + dr };
        const path = getArrowPath(from, to);
        expect(path).toHaveLength(3);
        expect(path[0]).toEqual(from);
        expect(path[1]).toEqual({
          file: 3 + expectedBend.file,
          rank: 4 + expectedBend.rank,
        });
        expect(path[2]).toEqual(to);
      });
    }
  });

  describe('getArrowColor', () => {
    it('returns neutral white with no modifier', async () => {
      const { getArrowColor } = await import('../../client/arrows.js');
      expect(getArrowColor({ ctrlKey: false, altKey: false, shiftKey: false })).toBe('#ffffff');
    });

    it('returns red with Ctrl', async () => {
      const { getArrowColor } = await import('../../client/arrows.js');
      expect(getArrowColor({ ctrlKey: true, altKey: false, shiftKey: false })).toBe('#ff4444');
    });

    it('returns blue with Alt', async () => {
      const { getArrowColor } = await import('../../client/arrows.js');
      expect(getArrowColor({ ctrlKey: false, altKey: true, shiftKey: false })).toBe('#4488ff');
    });

    it('returns green with Shift', async () => {
      const { getArrowColor } = await import('../../client/arrows.js');
      expect(getArrowColor({ ctrlKey: false, altKey: false, shiftKey: true })).toBe('#44cc44');
    });

    it('priority: Ctrl > Alt', async () => {
      const { getArrowColor } = await import('../../client/arrows.js');
      expect(getArrowColor({ ctrlKey: true, altKey: true, shiftKey: false })).toBe('#ff4444');
    });

    it('priority: Ctrl > Shift', async () => {
      const { getArrowColor } = await import('../../client/arrows.js');
      expect(getArrowColor({ ctrlKey: true, altKey: false, shiftKey: true })).toBe('#ff4444');
    });

    it('priority: Alt > Shift', async () => {
      const { getArrowColor } = await import('../../client/arrows.js');
      expect(getArrowColor({ ctrlKey: false, altKey: true, shiftKey: true })).toBe('#4488ff');
    });

    it('priority: Ctrl > Alt > Shift', async () => {
      const { getArrowColor } = await import('../../client/arrows.js');
      expect(getArrowColor({ ctrlKey: true, altKey: true, shiftKey: true })).toBe('#ff4444');
    });
  });
});
