// ═══════════════════════════════════════════════════════════
//  DOM Ref Helper — validated element lookups
//  Throws a clear error if a required element is missing,
//  preventing silent null-reference crashes later.
// ═══════════════════════════════════════════════════════════

/**
 * Get a required DOM element by ID. Throws if not found.
 * @param {string} id - The element ID.
 * @returns {HTMLElement} The element.
 * @throws {Error} If the element is not found.
 */
export function domRef(id) {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Required DOM element missing: #${id}`);
  }
  return el;
}

/**
 * Get an optional DOM element by ID. Returns null if not found.
 * @param {string} id - The element ID.
 * @returns {HTMLElement | null} The element or null.
 */
export function domRefOptional(id) {
  return document.getElementById(id);
}

/**
 * Get a required DOM element by CSS selector. Throws if not found.
 * @param {string} selector - The CSS selector.
 * @returns {HTMLElement} The element.
 * @throws {Error} If the element is not found.
 */
export function domRefQuery(selector) {
  const el = document.querySelector(selector);
  if (!el) {
    throw new Error(`Required DOM element missing: ${selector}`);
  }
  return el;
}

/**
 * Get an optional DOM element by CSS selector. Returns null if not found.
 * @param {string} selector - The CSS selector.
 * @returns {HTMLElement | null} The element or null.
 */
export function domRefQueryOptional(selector) {
  return document.querySelector(selector);
}

/**
 * Create a lazy DOM ref that validates on first access and caches the result.
 * Useful for elements accessed inside functions rather than at module top level.
 * @param {string} id - The element ID.
 * @param {boolean} [required=true] - Whether the element must exist.
 * @returns {() => HTMLElement | null} A getter function.
 */
export function domRefLazy(id, required = true) {
  /** @type {HTMLElement | null | undefined} */
  let cached = undefined;
  return () => {
    if (cached === undefined) {
      cached = required ? domRef(id) : domRefOptional(id);
    }
    return cached;
  };
}
