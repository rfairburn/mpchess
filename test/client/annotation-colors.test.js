import { describe, it, expect } from 'vitest';
import { getAnnotationColor } from '../../client/annotation-colors.js';
import { getArrowColor } from '../../client/arrows.js';
import { getHighlightColor } from '../../client/highlights.js';

describe('annotation-colors', () => {
  describe('getAnnotationColor modifier priority', () => {
    it('returns yellow with no modifiers', () => {
      expect(getAnnotationColor({ ctrlKey: false, altKey: false, shiftKey: false })).toBe(
        '#ffdd00'
      );
    });

    it('returns red for ctrl', () => {
      expect(getAnnotationColor({ ctrlKey: true, altKey: false, shiftKey: false })).toBe('#ff4444');
    });

    it('returns blue for alt', () => {
      expect(getAnnotationColor({ ctrlKey: false, altKey: true, shiftKey: false })).toBe('#4488ff');
    });

    it('returns green for shift', () => {
      expect(getAnnotationColor({ ctrlKey: false, altKey: false, shiftKey: true })).toBe('#44cc44');
    });

    it('prefers ctrl over alt', () => {
      expect(getAnnotationColor({ ctrlKey: true, altKey: true, shiftKey: false })).toBe('#ff4444');
    });

    it('prefers ctrl over shift', () => {
      expect(getAnnotationColor({ ctrlKey: true, altKey: false, shiftKey: true })).toBe('#ff4444');
    });

    it('prefers alt over shift', () => {
      expect(getAnnotationColor({ ctrlKey: false, altKey: true, shiftKey: true })).toBe('#4488ff');
    });

    it('prefers ctrl over alt and shift', () => {
      expect(getAnnotationColor({ ctrlKey: true, altKey: true, shiftKey: true })).toBe('#ff4444');
    });
  });

  describe('COLORS is frozen', () => {
    it('cannot be mutated via wrapper functions', () => {
      // Calling the wrappers should not expose a mutable COLORS object
      const arrowColor = getArrowColor({ ctrlKey: false, altKey: false, shiftKey: false });
      const highlightColor = getHighlightColor({ ctrlKey: false, altKey: false, shiftKey: false });
      expect(arrowColor).toBe('#ffdd00');
      expect(highlightColor).toBe('#ffdd00');
    });
  });

  describe('arrow and highlight independence', () => {
    it('getArrowColor and getHighlightColor return identical results for same input', () => {
      const events = [
        { ctrlKey: false, altKey: false, shiftKey: false },
        { ctrlKey: true, altKey: false, shiftKey: false },
        { ctrlKey: false, altKey: true, shiftKey: false },
        { ctrlKey: false, altKey: false, shiftKey: true },
        { ctrlKey: true, altKey: true, shiftKey: true },
      ];
      for (const ev of events) {
        expect(getArrowColor(ev)).toBe(getHighlightColor(ev));
      }
    });
  });
});
