// ═══════════════════════════════════════════════════════════
//  ANNOTATION COLORS — shared color scheme for arrows &
//  highlights (client-side only)
// ═══════════════════════════════════════════════════════════

const COLORS = Object.freeze({
  none: '#ffdd00',
  ctrl: '#ff4444',
  alt: '#4488ff',
  shift: '#44cc44',
});

/**
 * Determine annotation color from keyboard modifiers.
 * Priority: Ctrl > Alt > Shift.
 * Used by both arrows and highlights — each module wraps this
 * with its own named export to keep APIs independent.
 */
export function getAnnotationColor(event) {
  if (event.ctrlKey) return COLORS.ctrl;
  if (event.altKey) return COLORS.alt;
  if (event.shiftKey) return COLORS.shift;
  return COLORS.none;
}
