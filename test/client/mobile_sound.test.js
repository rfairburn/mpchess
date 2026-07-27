// ═══════════════════════════════════════════════════════════
//  SOUND TOGGLE BUTTONS — UI tests for mute/unmute
// ═══════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import './mobile-mocks.js';
import { resetSoundMockState } from './mobile-mocks.js';

// Stable hoisted mock so every import of navigation.js sees the same vi.fn()
const { reloadPageMock } = vi.hoisted(() => ({
  reloadPageMock: vi.fn(),
}));
vi.mock('../../client/navigation.js', () => ({
  reloadPage: reloadPageMock,
}));
import {
  setupUIFixture,
  setupProductionDOM,
  setupUIDOM,
  setupMobileViewport,
  cleanupMobileMocks,
  assertUIDOMFixture,
  assertProductionDOMFixture,
} from './mobile-test-helpers.js';

describe('sound toggle buttons', () => {
  let ui, sound;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetSoundMockState();

    setupUIFixture(390, 844);

    ui = await import('../../client/ui.js');
    await ui.hideMenu();
    sound = await import('../../client/sound.js');
  });

  afterEach(() => {
    cleanupMobileMocks();
  });

  it('should have sound button in mobile top bar', () => {
    const btn = document.getElementById('btn-sound');
    expect(btn).not.toBeNull();
    expect(btn.textContent).toBe('🔊');
    expect(btn.getAttribute('aria-label')).toBe('Mute sound');
  });

  it('should call setMute(true) when sound button is clicked', () => {
    const btn = document.getElementById('btn-sound');
    btn.click();

    expect(sound.setMute).toHaveBeenCalledWith(true);
  });

  it('should toggle icon to muted speaker when clicked', () => {
    const btn = document.getElementById('btn-sound');
    btn.click();

    expect(btn.textContent).toBe('🔇');
    expect(btn.getAttribute('aria-label')).toBe('Enable sound');
  });

  it('should toggle back to speaker when clicked again', () => {
    const btn = document.getElementById('btn-sound');

    // First click: mute
    btn.click();
    expect(btn.textContent).toBe('🔇');
    expect(sound.setMute).toHaveBeenCalledWith(true);

    // Second click: unmute (stateful mock now returns true)
    btn.click();
    expect(btn.textContent).toBe('🔊');
    expect(btn.getAttribute('aria-label')).toBe('Mute sound');
    expect(sound.setMute).toHaveBeenCalledWith(false);
  });

  it('should update both mobile and desktop buttons simultaneously', () => {
    const mobileBtn = document.getElementById('btn-sound');

    // Simulate production DOM by adding a desktop button
    const desktopBtn = document.createElement('button');
    desktopBtn.id = 'btn-sound-desktop';
    desktopBtn.textContent = '🔊';
    document.body.appendChild(desktopBtn);

    // Click mobile button
    mobileBtn.click();

    // Both should show muted icon
    expect(mobileBtn.textContent).toBe('🔇');
    expect(desktopBtn.textContent).toBe('🔇');
    expect(mobileBtn.getAttribute('aria-label')).toBe('Enable sound');
    expect(desktopBtn.getAttribute('aria-label')).toBe('Enable sound');
  });
});

describe('sound toggle — production DOM', () => {
  let ui, sound;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetSoundMockState();

    setupProductionDOM();
    setupMobileViewport(390, 844);

    ui = await import('../../client/ui.js');
    await ui.hideMenu();
    sound = await import('../../client/sound.js');
  });

  afterEach(() => {
    cleanupMobileMocks();
  });

  it('should have desktop sound button', () => {
    const btn = document.getElementById('btn-sound-desktop');
    expect(btn).not.toBeNull();
    expect(btn.textContent).toBe('🔊');
  });

  it('should call setMute when desktop button is clicked', () => {
    const btn = document.getElementById('btn-sound-desktop');
    btn.click();

    expect(sound.setMute).toHaveBeenCalledWith(true);
  });

  it('should sync desktop button icon on toggle', () => {
    const btn = document.getElementById('btn-sound-desktop');
    btn.click();

    expect(btn.textContent).toBe('🔇');
    expect(btn.getAttribute('aria-label')).toBe('Enable sound');
  });
});

// ── Mute preference survives restart / new-game ─────────

describe('sound preference persistence across game actions', () => {
  let ui, sound;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    resetSoundMockState();
    localStorage.removeItem('mpchessSoundMuted');

    setupProductionDOM();
    setupMobileViewport(390, 844);

    ui = await import('../../client/ui.js');
    sound = await import('../../client/sound.js');
    await ui.hideMenu();
  });

  afterEach(() => {
    cleanupMobileMocks();
  });

  it('should preserve mute preference after clicking restart button', async () => {
    // User has sound muted — persisted in localStorage
    sound.setMute(true);
    expect(localStorage.getItem('mpchessSoundMuted')).toBe('true');

    // Spy on localStorage to prove the restart handler never touches the key
    const setItemSpy = vi.spyOn(localStorage, 'setItem');
    const removeItemSpy = vi.spyOn(localStorage, 'removeItem');

    // Click the real restart button in the menu
    const btnRestart = document.getElementById('btn-restart');
    btnRestart.click();

    // The restart handler must not set or remove the sound preference
    expect(setItemSpy).not.toHaveBeenCalledWith('mpchessSoundMuted', expect.anything());
    expect(removeItemSpy).not.toHaveBeenCalledWith('mpchessSoundMuted');

    // Mute preference must still be in localStorage
    expect(localStorage.getItem('mpchessSoundMuted')).toBe('true');
    expect(sound.isMuted()).toBe(true);

    setItemSpy.mockRestore();
    removeItemSpy.mockRestore();
  });

  it('preserves sound preference when joining a new game', () => {
    sound.setMute(true);

    const setItemSpy = vi.spyOn(window.Storage.prototype, 'setItem');
    const removeItemSpy = vi.spyOn(window.Storage.prototype, 'removeItem');
    reloadPageMock.mockClear();

    try {
      document.getElementById('btn-join-game').click();

      expect(removeItemSpy).toHaveBeenCalledWith('mpchess_session_white');
      expect(removeItemSpy).toHaveBeenCalledWith('mpchess_session_black');
      expect(reloadPageMock).toHaveBeenCalledTimes(1);

      expect(setItemSpy.mock.calls.some(([key]) => key === 'mpchessSoundMuted')).toBe(false);
      expect(removeItemSpy.mock.calls.some(([key]) => key === 'mpchessSoundMuted')).toBe(false);
      expect(localStorage.getItem('mpchessSoundMuted')).toBe('true');
    } finally {
      setItemSpy.mockRestore();
      removeItemSpy.mockRestore();
    }
  });
});

// ── Fixture contracts ────────────────────────────────────

describe('fixture contracts include sound buttons', () => {
  it('setupUIDOM includes btn-sound', () => {
    setupUIDOM();
    assertUIDOMFixture();
  });

  it('setupProductionDOM includes both sound buttons', () => {
    setupProductionDOM();
    assertProductionDOMFixture();
  });
});
