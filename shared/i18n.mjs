// ═══════════════════════════════════════════════════════════
//  i18n — shared translation module (ES module)
//  Used by both Node.js (require) and browser (import).
//  Provides t(key, params?) for translating localized keys.
//  Falls back to the key itself if not found.
// ═══════════════════════════════════════════════════════════

import enUS from './locales/en-US.mjs';
import es from './locales/es.mjs';
import fr from './locales/fr.mjs';
import de from './locales/de.mjs';
import zhCN from './locales/zh-CN.mjs';

const CATALOG = { 'en-US': enUS, es, fr, de, 'zh-CN': zhCN };
export { CATALOG }; // exported for test access

export const LOCALES = {
  'en-US': 'English',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  'zh-CN': '简体中文',
};

let locale = 'en-US';

/**
 * Development-mode predicate: true in Node when NODE_ENV is not 'production',
 * true in browser when server.js injects window.__DEV__=true.
 */
function isDev() {
  if (typeof process !== 'undefined' && process.env) {
    return process.env.NODE_ENV !== 'production';
  }
  if (typeof window !== 'undefined') {
    return !!window.__DEV__;
  }
  return false;
}

/**
 * Translate a key with optional parameter interpolation.
 * @param {string} key — dotted key (e.g. 'game.checkmate_white')
 * @param {object} [params] — key-value map for {placeholder} replacement
 * @returns {string}
 */
export function t(key, params) {
  if (!key) return '';
  const dict = CATALOG[locale] || CATALOG['en-US'];
  const str = dict?.[key];
  if (str === undefined) {
    // Warn in development when a non-English locale lacks a key that exists in en-US
    if (isDev() && locale !== 'en-US' && CATALOG['en-US']?.[key] !== undefined) {
      console.warn(`[i18n] Missing translation for "${key}" in locale "${locale}"`);
    }
    return key; // fallback to key
  }
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (_, p) => (params[p] !== undefined ? params[p] : `{${p}}`));
}

/**
 * Switch locale at runtime.
 * @param {string} loc — locale code (e.g. 'en-US', 'es')
 */
export function setLocale(loc) {
  if (CATALOG[loc]) {
    locale = loc;
  }
}

/**
 * @returns {string} current locale code
 */
export function getLocale() {
  return locale;
}
