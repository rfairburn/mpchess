// ═══════════════════════════════════════════════════════════
//  SETTINGS — behavioral tests for overlay, dropdowns,
//  in-place model reload, keyboard suppression
// ═══════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  setupProductionDOM,
  setupMobileViewport,
  cleanupMobileMocks,
} from './mobile-test-helpers.js';
import './mobile-mocks.js';

vi.mock('../../client/navigation.js', () => ({ reloadPage: vi.fn() }));
vi.mock('../../client/board_2d.js', () => ({
  toggle2DBoard: vi.fn(),
  renderBoard2D: vi.fn(),
}));

describe('settings overlay behavior', () => {
  beforeEach(() => {
    vi.resetModules();
    setupProductionDOM();
    setupMobileViewport(390, 844);
    localStorage.clear();
    // Add settings overlay elements to the DOM before importing ui.js
    addSettingsElements();
  });

  afterEach(() => {
    cleanupMobileMocks();
  });

  it('should show settings overlay when Settings button is clicked', async () => {
    const ui = await import('../../client/ui.js');
    ui.hideMenu();

    const btnSettings = document.getElementById('btn-settings');
    btnSettings.click();

    const overlay = document.getElementById('settings-overlay');
    expect(overlay.classList.contains('visible')).toBe(true);
    expect(ui.settingsOpen).toBe(true);
  });

  it('should hide settings overlay when close button is clicked', async () => {
    const ui = await import('../../client/ui.js');
    ui.hideMenu();

    document.getElementById('btn-settings').click();
    document.getElementById('btn-settings-close').click();

    const overlay = document.getElementById('settings-overlay');
    expect(overlay.classList.contains('visible')).toBe(false);
    expect(ui.settingsOpen).toBe(false);
  });

  it('should close settings when menu is opened', async () => {
    const ui = await import('../../client/ui.js');
    ui.hideMenu();

    document.getElementById('btn-settings').click();
    expect(ui.settingsOpen).toBe(true);

    ui.showMenu();
    expect(ui.settingsOpen).toBe(false);
  });

  it('should close settings when clicking outside the box', async () => {
    const ui = await import('../../client/ui.js');
    ui.hideMenu();

    document.getElementById('btn-settings').click();
    expect(ui.settingsOpen).toBe(true);

    document.getElementById('settings-overlay').click();
    expect(ui.settingsOpen).toBe(false);
  });

  it('should populate 2D piece set dropdown from SVG_PIECE_SETS', async () => {
    await import('../../client/ui.js');

    const select = document.getElementById('select-2d-set');
    const options = select.querySelectorAll('option');
    expect(options.length).toBeGreaterThan(0);
    expect(options[0].value).toBe('mpchess');
  });

  it('should populate 3D model set dropdown from MODEL_SETS', async () => {
    await import('../../client/ui.js');

    const select = document.getElementById('select-3d-set');
    const options = select.querySelectorAll('option');
    expect(options.length).toBe(3);
    expect(options[0].value).toBe('simple-classic');
  });
});

describe('settings — 2D piece set change', () => {
  beforeEach(() => {
    vi.resetModules();
    setupProductionDOM();
    setupMobileViewport(390, 844);
    localStorage.clear();
    addSettingsElements();
  });

  afterEach(() => {
    cleanupMobileMocks();
  });

  it('should call setSvgPieceSet and persist to localStorage on change', async () => {
    const ui = await import('../../client/ui.js');
    const pieces = await import('../../client/pieces.js');
    ui.hideMenu();

    const select = document.getElementById('select-2d-set');
    select.value = 'maestro';
    select.dispatchEvent(new Event('change'));

    expect(pieces.setSvgPieceSet).toHaveBeenCalledWith('maestro');
    expect(localStorage.getItem('svgPieceSet')).toBe('maestro');
  });

  it('should call renderBoard2D on 2D set change', async () => {
    const board2d = await import('../../client/board_2d.js');
    const ui = await import('../../client/ui.js');
    ui.hideMenu();

    const select = document.getElementById('select-2d-set');
    select.value = 'maestro';
    select.dispatchEvent(new Event('change'));

    expect(board2d.renderBoard2D).toHaveBeenCalled();
  });
});

describe('settings — 3D model set change', () => {
  beforeEach(() => {
    vi.resetModules();
    setupProductionDOM();
    setupMobileViewport(390, 844);
    localStorage.clear();
    addSettingsElements();
  });

  afterEach(() => {
    cleanupMobileMocks();
  });

  it('should call setModelSet and persist to localStorage on change', async () => {
    const ui = await import('../../client/ui.js');
    const pieces = await import('../../client/pieces.js');
    ui.hideMenu();

    const select = document.getElementById('select-3d-set');
    select.value = 'low-poly';
    select.dispatchEvent(new Event('change'));

    expect(pieces.setModelSet).toHaveBeenCalledWith('low-poly');
    expect(localStorage.getItem('modelSet')).toBe('low-poly');
  });

  it('should call reloadPieceModels on 3D set change', async () => {
    const pieces = await import('../../client/pieces.js');
    const ui = await import('../../client/ui.js');
    ui.hideMenu();
    // Set a mock scene so reloadPieceModels is called
    ui.setThreeScene({});

    const select = document.getElementById('select-3d-set');
    select.value = 'low-poly';
    select.dispatchEvent(new Event('change'));

    expect(pieces.reloadPieceModels).toHaveBeenCalled();
  });
});

describe('settings — keyboard behavior', () => {
  beforeEach(() => {
    vi.resetModules();
    setupProductionDOM();
    setupMobileViewport(390, 844);
    localStorage.clear();
    addSettingsElements();
  });

  afterEach(() => {
    cleanupMobileMocks();
  });

  it('should export hideSettings for Escape key handling', async () => {
    const ui = await import('../../client/ui.js');
    ui.hideMenu();

    document.getElementById('btn-settings').click();
    expect(ui.settingsOpen).toBe(true);

    // Simulate what controls.js does on Escape when settingsOpen
    ui.hideSettings();
    expect(ui.settingsOpen).toBe(false);
  });

  it('should have settingsOpen guard available for controls.js', async () => {
    const ui = await import('../../client/ui.js');
    expect(typeof ui.settingsOpen).toBe('boolean');
  });
});

describe('reloadPieceModels — atomic, generation-aware', () => {
  it('should export reloadPieceModels as a function', async () => {
    const pieces = await import('../../client/pieces.js');
    expect(typeof pieces.reloadPieceModels).toBe('function');
  });

  it('should export MODEL_SETS and SVG_PIECE_SETS', async () => {
    const pieces = await import('../../client/pieces.js');
    expect(Array.isArray(pieces.MODEL_SETS)).toBe(true);
    expect(Array.isArray(pieces.SVG_PIECE_SETS)).toBe(true);
  });

  it('should export getPieceAssetUrl and getPieceSetExtension', async () => {
    const pieces = await import('../../client/pieces.js');
    expect(typeof pieces.getPieceAssetUrl).toBe('function');
    expect(typeof pieces.getPieceSetExtension).toBe('function');
  });

  it('should return svg extension for default set (mock)', async () => {
    const pieces = await import('../../client/pieces.js');
    expect(pieces.getPieceSetExtension()).toBe('svg');
    expect(pieces.getPieceAssetUrl('wP')).toBe('files/pieces/2d/mpchess/wP.svg');
  });
});

function addSettingsElements() {
  const settingsOverlay = document.createElement('div');
  settingsOverlay.id = 'settings-overlay';
  const settingsBox = document.createElement('div');
  settingsBox.id = 'settings-box';
  const settingsHeader = document.createElement('div');
  settingsHeader.id = 'settings-header';
  const h2 = document.createElement('h2');
  h2.textContent = 'Settings';
  settingsHeader.appendChild(h2);
  const btnClose = document.createElement('button');
  btnClose.id = 'btn-settings-close';
  btnClose.textContent = '✕';
  settingsHeader.appendChild(btnClose);
  settingsBox.appendChild(settingsHeader);

  const sensRow = document.createElement('div');
  sensRow.id = 'sensitivity-row';
  const sensSlider = document.createElement('input');
  sensSlider.id = 'sensitivity-slider';
  sensSlider.type = 'range';
  sensSlider.value = '20';
  const sensValue = document.createElement('span');
  sensValue.id = 'sensitivity-value';
  sensValue.textContent = '20';
  sensRow.append(sensSlider, sensValue);
  settingsBox.appendChild(sensRow);

  const joyToggle = document.createElement('input');
  joyToggle.id = 'joystick-toggle';
  joyToggle.type = 'checkbox';
  settingsBox.appendChild(joyToggle);

  const select2d = document.createElement('select');
  select2d.id = 'select-2d-set';
  settingsBox.appendChild(select2d);

  const select3d = document.createElement('select');
  select3d.id = 'select-3d-set';
  settingsBox.appendChild(select3d);

  settingsOverlay.appendChild(settingsBox);
  document.body.appendChild(settingsOverlay);

  const menuBox = document.getElementById('menu-box');
  const btnSettings = document.createElement('button');
  btnSettings.id = 'btn-settings';
  btnSettings.textContent = 'Settings';
  menuBox.appendChild(btnSettings);
}
