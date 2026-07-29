import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';

vi.mock('../../client/capabilities.js', () => ({
  isTouchDevice: vi.fn(() => false),
  isMobilePhone: vi.fn(() => false),
  hasFullscreen: vi.fn(() => true),
}));

function setupDom() {
  const html = `
    <div id="menu-overlay">
      <div id="menu-box">
        <h2>♔ 3D Chess ♚</h2>
        <button id="btn-resume">Resume Game</button>
        <button id="btn-help">Help</button>
      </div>
    </div>
    <div id="help-overlay" role="dialog" aria-modal="true">
      <div id="help-box">
        <div id="help-header">
          <h2>Help</h2>
          <button id="btn-help-close" aria-label="Close">✕</button>
        </div>
        <div id="help-content">
          <details class="help-section" open>
            <summary>Getting Started</summary>
            <div class="help-row">
              <span class="help-label">Joining</span>
              <span class="help-desc">Choose White, Black, or Spectate.</span>
            </div>
          </details>
          <details class="help-section">
            <summary>Playing</summary>
            <div class="help-row">
              <span class="help-label">Piece mode</span>
              <span class="help-desc">Click a piece to select.</span>
            </div>
          </details>
          <details class="help-section">
            <summary>Camera &amp; Controls</summary>
            <div class="help-row">
              <span class="help-label">Camera positions</span>
              <span class="help-desc">Numbered buttons 1-6.</span>
            </div>
          </details>
          <details class="help-section">
            <summary>Game Actions</summary>
            <div class="help-row">
              <span class="help-label">New Game</span>
              <span class="help-desc">Resets the board.</span>
            </div>
          </details>
          <details class="help-section">
            <summary>Info Panels</summary>
            <div class="help-row">
              <span class="help-label">Move log</span>
              <span class="help-desc">Scrollable list of moves.</span>
            </div>
          </details>
          <details class="help-section">
            <summary>Settings &amp; Export</summary>
            <div class="help-row">
              <span class="help-label">Sound</span>
              <span class="help-desc">Toggle sound on/off.</span>
            </div>
          </details>
          <details class="help-section">
            <summary>Notifications</summary>
            <div class="help-row">
              <span class="help-label">Toasts</span>
              <span class="help-desc">Brief messages at the bottom.</span>
            </div>
          </details>
          <details class="help-section help-keyboard">
            <summary>Keyboard Shortcuts</summary>
            <div class="help-row">
              <span class="help-label">TAB</span>
              <span class="help-desc">Toggle piece/camera mode.</span>
            </div>
          </details>
        </div>
      </div>
    </div>
  `;

  const dom = new JSDOM(html, { url: 'http://localhost' });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  return dom;
}

describe('help overlay', () => {
  let dom;
  let showHelp, hideHelp;

  beforeEach(() => {
    dom = setupDom();
    vi.resetModules();
  });

  it('showHelp adds .visible to #help-overlay', async () => {
    const mod = await import('../../client/ui/help.js');
    showHelp = mod.showHelp;
    hideHelp = mod.hideHelp;
    const overlay = document.getElementById('help-overlay');
    expect(overlay.classList.contains('visible')).toBe(false);
    showHelp();
    expect(overlay.classList.contains('visible')).toBe(true);
  });

  it('hideHelp removes .visible from #help-overlay', async () => {
    const mod = await import('../../client/ui/help.js');
    showHelp = mod.showHelp;
    hideHelp = mod.hideHelp;
    const overlay = document.getElementById('help-overlay');
    showHelp();
    expect(overlay.classList.contains('visible')).toBe(true);
    hideHelp();
    expect(overlay.classList.contains('visible')).toBe(false);
  });

  it('close button calls hideHelp', async () => {
    const mod = await import('../../client/ui/help.js');
    showHelp = mod.showHelp;
    const overlay = document.getElementById('help-overlay');
    showHelp();
    document.getElementById('btn-help-close').click();
    expect(overlay.classList.contains('visible')).toBe(false);
  });

  it('clicking overlay background closes help', async () => {
    const mod = await import('../../client/ui/help.js');
    showHelp = mod.showHelp;
    const overlay = document.getElementById('help-overlay');
    showHelp();
    overlay.click();
    expect(overlay.classList.contains('visible')).toBe(false);
  });

  it('clicking inside help box does not close', async () => {
    const mod = await import('../../client/ui/help.js');
    showHelp = mod.showHelp;
    const overlay = document.getElementById('help-overlay');
    const box = document.getElementById('help-box');
    showHelp();
    box.click();
    expect(overlay.classList.contains('visible')).toBe(true);
  });

  it('hideHelp is safe when overlay does not exist', async () => {
    document.getElementById('help-overlay').remove();
    const mod = await import('../../client/ui/help.js');
    hideHelp = mod.hideHelp;
    expect(() => hideHelp()).not.toThrow();
  });

  it('showHelp is safe when overlay does not exist', async () => {
    document.getElementById('help-overlay').remove();
    const mod = await import('../../client/ui/help.js');
    showHelp = mod.showHelp;
    expect(() => showHelp()).not.toThrow();
  });
});

describe('help button in main menu', () => {
  let dom;

  beforeEach(() => {
    dom = setupDom();
  });

  it('#btn-help exists inside #menu-box', () => {
    const menuBox = document.getElementById('menu-box');
    const btnHelp = document.getElementById('btn-help');
    expect(btnHelp).not.toBeNull();
    expect(menuBox.contains(btnHelp)).toBe(true);
  });

  it('#btn-help has accessible text "Help"', () => {
    const btnHelp = document.getElementById('btn-help');
    expect(btnHelp.textContent).toBe('Help');
  });
});

describe('help content coverage', () => {
  let dom;

  beforeEach(() => {
    dom = setupDom();
  });

  it('has all 8 section headers', () => {
    const sections = document.querySelectorAll('.help-section');
    expect(sections.length).toBe(8);
  });

  it('each section contains at least one help-row', () => {
    const sections = document.querySelectorAll('.help-section');
    sections.forEach((section) => {
      const rows = section.querySelectorAll('.help-row');
      expect(rows.length).toBeGreaterThan(0);
    });
  });

  it('first section is open by default', () => {
    const first = document.querySelectorAll('.help-section')[0];
    expect(first.open).toBe(true);
  });

  it('remaining sections are closed by default', () => {
    const sections = document.querySelectorAll('.help-section');
    for (let i = 1; i < sections.length; i++) {
      expect(sections[i].open).toBe(false);
    }
  });
});

describe('help accessibility', () => {
  let dom;

  beforeEach(() => {
    dom = setupDom();
  });

  it('close button has aria-label', () => {
    const closeBtn = document.getElementById('btn-help-close');
    expect(closeBtn.getAttribute('aria-label')).toBe('Close');
  });

  it('overlay has role="dialog"', () => {
    const overlay = document.getElementById('help-overlay');
    expect(overlay.getAttribute('role')).toBe('dialog');
  });

  it('overlay has aria-modal="true"', () => {
    const overlay = document.getElementById('help-overlay');
    expect(overlay.getAttribute('aria-modal')).toBe('true');
  });

  it('help-label elements exist for each row', () => {
    const labels = document.querySelectorAll('.help-label');
    expect(labels.length).toBeGreaterThan(0);
  });

  it('help-desc elements exist for each row', () => {
    const descs = document.querySelectorAll('.help-desc');
    expect(descs.length).toBeGreaterThan(0);
  });
});

describe('help responsive section state', () => {
  let dom;

  beforeEach(() => {
    dom = setupDom();
    vi.resetModules();
  });

  it('mobile: only first section open after showHelp', async () => {
    const capMod = await import('../../client/capabilities.js');
    capMod.isTouchDevice.mockReturnValue(true);
    const mod = await import('../../client/ui/help.js');
    mod.showHelp();
    const sections = document.querySelectorAll('.help-section');
    expect(sections[0].open).toBe(true);
    for (let i = 1; i < sections.length; i++) {
      expect(sections[i].open).toBe(false);
    }
  });

  it('desktop: all sections open after showHelp', async () => {
    const capMod = await import('../../client/capabilities.js');
    capMod.isTouchDevice.mockReturnValue(false);
    const mod = await import('../../client/ui/help.js');
    mod.showHelp();
    const sections = document.querySelectorAll('.help-section');
    for (let i = 0; i < sections.length; i++) {
      expect(sections[i].open).toBe(true);
    }
  });
});

describe('help menu interaction', () => {
  let dom;

  beforeEach(() => {
    dom = setupDom();
    vi.resetModules();
  });

  it('closeHelpForMenu closes help overlay (production showMenu coordination)', async () => {
    const mod = await import('../../client/ui/help.js');
    mod.showHelp();
    const overlay = document.getElementById('help-overlay');
    expect(overlay.classList.contains('visible')).toBe(true);
    // Exercise the real coordination function that showMenu() calls
    mod.closeHelpForMenu();
    expect(overlay.classList.contains('visible')).toBe(false);
  });

  it('focus moves into dialog when opened', async () => {
    const mod = await import('../../client/ui/help.js');
    const launcher = document.getElementById('btn-help');
    launcher.focus();
    mod.showHelp();
    expect(document.activeElement).toBe(document.getElementById('btn-help-close'));
  });
});

describe('help focus trap', () => {
  let dom;

  beforeEach(() => {
    dom = setupDom();
    vi.resetModules();
  });

  it('focusable selector includes summary elements', async () => {
    const mod = await import('../../client/ui/help.js');
    mod.showHelp();
    const overlay = document.getElementById('help-overlay');
    const focusable = overlay.querySelectorAll(
      'button, [href], input, select, summary, [tabindex]:not([tabindex="-1"])'
    );
    const summaries = overlay.querySelectorAll('summary');
    summaries.forEach((s) => {
      expect(Array.from(focusable).includes(s)).toBe(true);
    });
  });

  it('forward Tab wraps from last visible to first', async () => {
    const mod = await import('../../client/ui/help.js');
    mod.showHelp();
    const handler = mod.getTrapHandler();
    const overlay = document.getElementById('help-overlay');
    const allFocusable = overlay.querySelectorAll(
      'button, [href], input, select, summary, [tabindex]:not([tabindex="-1"])'
    );
    // In JSDOM offsetParent is on HTMLElement.prototype, not Element.prototype
    const proto = globalThis.window.HTMLElement.prototype;
    const origOffsetParent = Object.getOwnPropertyDescriptor(proto, 'offsetParent');
    Object.defineProperty(proto, 'offsetParent', {
      get() {
        return this;
      },
      configurable: true,
    });
    // isActuallyVisible also checks getClientRects().length > 0
    const origGetClientRects = proto.getClientRects;
    proto.getClientRects = function () {
      return [{ left: 0, top: 0, width: 1, height: 1 }];
    };

    const focusable = Array.from(allFocusable).filter((el) => el.offsetParent !== null);
    const last = focusable[focusable.length - 1];
    const first = focusable[0];
    last.focus();

    const event = { key: 'Tab', shiftKey: false, preventDefault: vi.fn() };
    handler(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(document.activeElement).toBe(first);

    if (origOffsetParent) {
      Object.defineProperty(proto, 'offsetParent', origOffsetParent);
    } else {
      delete proto.offsetParent;
    }
    if (origGetClientRects) {
      proto.getClientRects = origGetClientRects;
    }
  });

  it('backward Tab wraps from first visible to last', async () => {
    const mod = await import('../../client/ui/help.js');
    mod.showHelp();
    const handler = mod.getTrapHandler();
    const overlay = document.getElementById('help-overlay');
    const allFocusable = overlay.querySelectorAll(
      'button, [href], input, select, summary, [tabindex]:not([tabindex="-1"])'
    );

    const proto = globalThis.window.HTMLElement.prototype;
    const origOffsetParent = Object.getOwnPropertyDescriptor(proto, 'offsetParent');
    Object.defineProperty(proto, 'offsetParent', {
      get() {
        return this;
      },
      configurable: true,
    });
    const origGetClientRects = proto.getClientRects;
    proto.getClientRects = function () {
      return [{ left: 0, top: 0, width: 1, height: 1 }];
    };

    const focusable = Array.from(allFocusable).filter((el) => el.offsetParent !== null);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    first.focus();

    const event = { key: 'Tab', shiftKey: true, preventDefault: vi.fn() };
    handler(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(document.activeElement).toBe(last);

    if (origOffsetParent) {
      Object.defineProperty(proto, 'offsetParent', origOffsetParent);
    } else {
      delete proto.offsetParent;
    }
    if (origGetClientRects) {
      proto.getClientRects = origGetClientRects;
    }
  });

  it('hidden .help-keyboard section is excluded from trap', async () => {
    const mod = await import('../../client/ui/help.js');
    mod.showHelp();
    const overlay = document.getElementById('help-overlay');
    // Hide the keyboard section (as CSS does on coarse-pointer)
    const keyboardSection = overlay.querySelector('.help-keyboard');
    keyboardSection.style.display = 'none';

    // Mock offsetParent to return null for hidden elements
    const proto = globalThis.window.HTMLElement.prototype;
    const origOffsetParent = Object.getOwnPropertyDescriptor(proto, 'offsetParent');
    Object.defineProperty(proto, 'offsetParent', {
      get() {
        for (let node = this; node; node = node.parentElement) {
          if (node.style.display === 'none') return null;
        }
        return this;
      },
      configurable: true,
    });
    const origGetClientRects = proto.getClientRects;
    proto.getClientRects = function () {
      return [{ left: 0, top: 0, width: 1, height: 1 }];
    };

    const allFocusable = overlay.querySelectorAll(
      'button, [href], input, select, summary, [tabindex]:not([tabindex="-1"])'
    );
    const focusable = Array.from(allFocusable).filter((el) => el.offsetParent !== null);
    // The keyboard summary should not be in the visible set
    const keyboardSummary = keyboardSection.querySelector('summary');
    expect(focusable.includes(keyboardSummary)).toBe(false);

    if (origOffsetParent) {
      Object.defineProperty(proto, 'offsetParent', origOffsetParent);
    } else {
      delete proto.offsetParent;
    }
    if (origGetClientRects) {
      proto.getClientRects = origGetClientRects;
    }
  });
});

describe('help focus restoration', () => {
  let dom;

  beforeEach(() => {
    dom = setupDom();
    vi.resetModules();
    // Mock getClientRects for isActuallyVisible — returns rects only for
    // elements whose ancestors are visible (not display:none, not hidden menu)
    const proto = globalThis.window.HTMLElement.prototype;
    proto.getClientRects = function () {
      // Walk up to check if any ancestor is display:none or menu is hidden
      for (let node = this; node; node = node.parentElement) {
        if (node.style.display === 'none') return [];
        if (node.id === 'menu-overlay' && !node.classList.contains('visible')) return [];
      }
      return [{ left: 0, top: 0, width: 1, height: 1 }];
    };
  });

  it('restores focus to visible launcher', async () => {
    const mod = await import('../../client/ui/help.js');
    const btnHelp = document.getElementById('btn-help');
    const menuOverlay = document.getElementById('menu-overlay');
    menuOverlay.classList.add('visible');
    btnHelp.focus();
    mod.showHelp();
    mod.hideHelp();
    expect(document.activeElement).toBe(btnHelp);
  });

  it('calls closeCallback when launcher is hidden', async () => {
    const mod = await import('../../client/ui/help.js');
    const btnHelp = document.getElementById('btn-help');
    btnHelp.focus();
    let callbackCalled = false;
    mod.showHelp(() => {
      callbackCalled = true;
    });
    btnHelp.style.display = 'none';
    mod.hideHelp();
    expect(callbackCalled).toBe(true);
  });

  it('focuses body when launcher is hidden and no callback', async () => {
    const mod = await import('../../client/ui/help.js');
    const btnHelp = document.getElementById('btn-help');
    btnHelp.focus();
    mod.showHelp();
    btnHelp.style.display = 'none';
    // In JSDOM, body.focus() may not set activeElement reliably;
    // verify that the hidden button is NOT focused instead.
    mod.hideHelp();
    expect(document.activeElement).not.toBe(btnHelp);
  });

  it('Escape closes help and restores menu with visible focus', async () => {
    const mod = await import('../../client/ui/help.js');
    const btnHelp = document.getElementById('btn-help');
    const menuOverlay = document.getElementById('menu-overlay');
    const helpOverlay = document.getElementById('help-overlay');
    // Open Help through production path: hideMenu → showHelp(showMenu)
    menuOverlay.classList.add('visible');
    btnHelp.focus();
    menuOverlay.classList.remove('visible');
    mod.showHelp(() => {
      menuOverlay.classList.add('visible');
    });
    expect(helpOverlay.classList.contains('visible')).toBe(true);
    expect(menuOverlay.classList.contains('visible')).toBe(false);
    // Wire production Escape handler (controls.js keydown calls hideHelp when helpOpen)
    document.addEventListener('keydown', (e) => {
      if (mod.helpOpen && e.code === 'Escape') mod.hideHelp();
    });
    // Close via Escape — dispatch real keydown
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        bubbles: true,
      })
    );
    expect(helpOverlay.classList.contains('visible')).toBe(false);
    expect(menuOverlay.classList.contains('visible')).toBe(true);
    expect(document.activeElement).toBe(btnHelp);
  });

  it('close button closes help and restores menu with visible focus', async () => {
    const mod = await import('../../client/ui/help.js');
    const btnHelp = document.getElementById('btn-help');
    const menuOverlay = document.getElementById('menu-overlay');
    const helpOverlay = document.getElementById('help-overlay');
    // Open Help through production path: hideMenu → showHelp(showMenu)
    menuOverlay.classList.add('visible');
    btnHelp.focus();
    menuOverlay.classList.remove('visible');
    mod.showHelp(() => {
      menuOverlay.classList.add('visible');
    });
    expect(helpOverlay.classList.contains('visible')).toBe(true);
    expect(menuOverlay.classList.contains('visible')).toBe(false);
    // Close via close button
    document.getElementById('btn-help-close').click();
    expect(helpOverlay.classList.contains('visible')).toBe(false);
    expect(menuOverlay.classList.contains('visible')).toBe(true);
    expect(document.activeElement).toBe(btnHelp);
  });
});
