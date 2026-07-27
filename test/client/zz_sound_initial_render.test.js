// ═══════════════════════════════════════════════════════════
//  SOUND — Initial render with persisted mute state
//  This file must run in isolation so the sound module is
//  imported fresh with localStorage already set.
// ═══════════════════════════════════════════════════════════

import { describe, it, expect, afterEach, vi } from 'vitest';
import './mobile-mocks.js';

vi.mock('../../client/navigation.js', () => ({ reloadPage: vi.fn() }));
import {
  setupProductionDOM,
  setupMobileViewport,
  cleanupMobileMocks,
} from './mobile-test-helpers.js';

describe('sound toggle — initial render with persisted state', () => {
  it('should render muted icons on both buttons when mpchessSoundMuted=true', async () => {
    // Set persisted mute state BEFORE any module import
    localStorage.setItem('mpchessSoundMuted', 'true');

    setupProductionDOM();
    setupMobileViewport(390, 844);

    // First import — mock reads localStorage, UI calls updateSoundButtons()
    const sound = await import('../../client/sound.js');
    const ui = await import('../../client/ui.js');
    await ui.hideMenu();

    expect(sound.isMuted()).toBe(true);

    const mobileBtn = document.getElementById('btn-sound');
    const desktopBtn = document.getElementById('btn-sound-desktop');
    expect(mobileBtn.textContent).toBe('🔇');
    expect(mobileBtn.getAttribute('aria-label')).toBe('Enable sound');
    expect(desktopBtn.textContent).toBe('🔇');
    expect(desktopBtn.getAttribute('aria-label')).toBe('Enable sound');
  });

  afterEach(() => {
    cleanupMobileMocks();
    localStorage.removeItem('mpchessSoundMuted');
  });
});
