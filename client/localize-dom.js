// ═══════════════════════════════════════════════════════════
//  localize-dom.js — DOM translation helper
//  Used by both app.js (initial render) and ui.js (live refresh).
// ═══════════════════════════════════════════════════════════

import { t } from '../shared/i18n.mjs';

/**
 * Apply translations to all elements with data-i18n-* attributes.
 * @param {Document|Element} [root=document]
 */
export function applyTranslations(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.getAttribute('data-i18n'));
  }
  for (const el of root.querySelectorAll('[data-i18n-aria-label]')) {
    el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria-label')));
  }
  for (const el of root.querySelectorAll('[data-i18n-title]')) {
    el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
  }
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) {
    el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
  }
}
