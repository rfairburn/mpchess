// ═══════════════════════════════════════════════════════════
//  i18n — shared lookup module (Node.js reference implementation)
//  Provides t(key, params?) for translating localized keys.
//  Falls back to the key itself if not found.
//
//  NOTE: This module is NOT imported by the server (locale-agnostic, sends keys).
//  The browser uses client/i18n.js with an embedded catalog.
//  This file serves as a reference/template for future server-side localization
//  or SSR support.
// ═══════════════════════════════════════════════════════════

let locale = 'en-US';
let catalog = null;

// Lazy-load the default locale
function loadCatalog(name) {
  if (catalog && name === locale) return;
  // Node.js: use require; browser: use window.__mpchess_locales
  if (typeof require !== 'undefined') {
    try {
      catalog = require(`./locales/${name}`);
    } catch {
      catalog = {};
    }
    /* eslint-disable no-undef */
  } else if (typeof window !== 'undefined' && window.__mpchess_locales) {
    catalog = window.__mpchess_locales[name] || {};
    /* eslint-enable no-undef */
  } else {
    catalog = {};
  }
}

/**
 * Translate a key with optional parameter interpolation.
 * @param {string} key — dotted key (e.g. 'game.checkmate_white')
 * @param {object} [params] — key-value map for {placeholder} replacement
 * @returns {string}
 */
function t(key, params) {
  if (!key) return '';
  loadCatalog(locale);
  const str = catalog[key];
  if (str === undefined) return key; // fallback to key
  if (!params) return str;
  // Replace {placeholder} with param values
  return str.replace(/\{(\w+)\}/g, (_, p) => (params[p] !== undefined ? params[p] : `{${p}}`));
}

/**
 * Switch locale at runtime.
 * @param {string} loc — locale code (e.g. 'en-US', 'es')
 */
function setLocale(loc) {
  locale = loc;
  catalog = null; // force reload on next t()
}

/**
 * @returns {string} current locale code
 */
function getLocale() {
  return locale;
}

module.exports = { t, setLocale, getLocale };
