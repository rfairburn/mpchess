import { describe, it, expect, beforeEach } from 'vitest';
import {
  domRef,
  domRefOptional,
  domRefQuery,
  domRefQueryOptional,
  domRefLazy,
} from '../../client/dom_ref.js';

// ── Helpers ───────────────────────────────────────────────

function clearDOM() {
  document.body.innerHTML = '';
}

function addElement(id, tag = 'div') {
  const el = document.createElement(tag);
  el.id = id;
  document.body.appendChild(el);
  return el;
}

// ── domRef ────────────────────────────────────────────────

describe('domRef', () => {
  beforeEach(clearDOM);

  it('returns the element when it exists', () => {
    const el = addElement('test-el');
    expect(domRef('test-el')).toBe(el);
  });

  it('throws a descriptive error when element is missing', () => {
    expect(() => domRef('nonexistent')).toThrow('Required DOM element missing: #nonexistent');
  });

  it('throws for every missing element independently', () => {
    addElement('exists');
    expect(domRef('exists')).toBeTruthy();
    expect(() => domRef('missing')).toThrow(/#missing/);
  });
});

// ── domRefOptional ────────────────────────────────────────

describe('domRefOptional', () => {
  beforeEach(clearDOM);

  it('returns the element when it exists', () => {
    const el = addElement('opt-el');
    expect(domRefOptional('opt-el')).toBe(el);
  });

  it('returns null when element is missing', () => {
    expect(domRefOptional('nonexistent')).toBeNull();
  });
});

// ── domRefQuery ───────────────────────────────────────────

describe('domRefQuery', () => {
  beforeEach(clearDOM);

  it('returns the element when selector matches', () => {
    const container = addElement('container');
    const child = document.createElement('span');
    child.className = 'target';
    container.appendChild(child);
    expect(domRefQuery('#container .target')).toBe(child);
  });

  it('throws when selector matches nothing', () => {
    expect(() => domRefQuery('.no-such-class')).toThrow(
      'Required DOM element missing: .no-such-class'
    );
  });
});

// ── domRefQueryOptional ───────────────────────────────────

describe('domRefQueryOptional', () => {
  beforeEach(clearDOM);

  it('returns the element when selector matches', () => {
    const container = addElement('container2');
    const child = document.createElement('span');
    child.className = 'target';
    container.appendChild(child);
    expect(domRefQueryOptional('#container2 .target')).toBe(child);
  });

  it('returns null when selector matches nothing', () => {
    expect(domRefQueryOptional('.no-such-class')).toBeNull();
  });
});

// ── domRefLazy ────────────────────────────────────────────

describe('domRefLazy', () => {
  beforeEach(clearDOM);

  it('validates and caches on first access (required)', () => {
    const el = addElement('lazy-el');
    const getter = domRefLazy('lazy-el');
    expect(getter()).toBe(el);
    // Second call returns cached value
    expect(getter()).toBe(el);
  });

  it('throws on first access when element is missing (required)', () => {
    const getter = domRefLazy('missing-lazy');
    expect(() => getter()).toThrow('#missing-lazy');
    // Still throws on second call (never cached)
    expect(() => getter()).toThrow('#missing-lazy');
  });

  it('returns null when optional and element is missing', () => {
    const getter = domRefLazy('missing-optional', false);
    expect(getter()).toBeNull();
    // Cached null returned on second call
    expect(getter()).toBeNull();
  });

  it('caches the element even if added after getter creation', () => {
    const getter = domRefLazy('deferred-el');
    // Element doesn't exist yet
    expect(() => getter()).toThrow('#deferred-el');
    // Add it
    addElement('deferred-el');
    // Now it works and caches
    expect(getter()).toBeTruthy();
    expect(getter()).toBe(getter());
  });
});
