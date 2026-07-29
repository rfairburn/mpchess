import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupControlsDOM } from './mobile-test-helpers.js';

// Mock dependencies so controls.js can load
vi.mock('../../client/network.js', () => ({
  myRole: null,
  serverBoard: null,
  serverTurn: 'white',
  serverPromotingPiece: null,
  serverGameOver: false,
  castlingRights: {},
  enPassantTarget: null,
  sendMove: vi.fn(),
  onRestart: vi.fn(),
  onStateUpdate: vi.fn(),
}));

vi.mock('../../client/ui.js', () => ({
  menuOpen: false,
  helpOpen: false,
  showMenu: vi.fn(),
  hideMenu: vi.fn(),
  updateMouseModeDisplay: vi.fn(),
  hidePromotionPicker: vi.fn(),
  hideConcedeConfirm: vi.fn(),
  mouseSensitivity: 0.002,
  showError: vi.fn(),
}));

vi.mock('../../client/board.js', () => ({
  squares: Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => ({}))),
  clearHighlights: vi.fn(),
  highlightSelected: vi.fn(),
  highlightValidMoves: vi.fn(),
  highlightCheck: vi.fn(),
}));

vi.mock('../../client/chess.mjs', () => ({
  pieceColor: vi.fn(),
  getValidMoves: vi.fn(() => []),
}));

vi.mock('../../client/pieces.js', () => ({
  pieceMeshes: [],
}));

vi.mock('../../client/controls_config.js', () => {
  const actual = vi.importActual('../../client/controls_config.js');
  return actual;
});

function createTouchEvent(type, touches, changed = []) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  event.touches = touches;
  event.targetTouches = touches;
  event.changedTouches = changed;
  return event;
}

describe('M4.1 — virtual joystick behavior', () => {
  let controls;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    setupControlsDOM();

    // Mock pointer lock so toggleMouseMode works in tests
    globalThis.document.pointerLockElement = null;
    const mockRequestPointerLock = vi.fn().mockImplementation(function () {
      globalThis.document.pointerLockElement = this;
      document.dispatchEvent(new Event('pointerlockchange'));
    });
    Object.defineProperty(globalThis.document.documentElement, 'requestPointerLock', {
      value: mockRequestPointerLock,
      writable: true,
      configurable: true,
    });

    controls = await import('../../client/controls.js');
  });

  it('should report joystick enabled state', () => {
    expect(controls.isJoystickEnabled()).toBe(false);
    controls.setJoystickEnabled(true);
    expect(controls.isJoystickEnabled()).toBe(true);
    controls.setJoystickEnabled(false);
  });

  it('should return zero vector when joystick is not touched', () => {
    expect(controls.getJoystickVector()).toEqual({ x: 0, y: 0 });
  });

  it('should return zero vJoy value when not touched', () => {
    expect(controls.getVJoyValue()).toBe(0);
  });

  it('should update vJoy value when dragging vertical joystick', () => {
    const track = document.getElementById('vjoy-track');
    const trackRect = { top: 200, left: 100, width: 36, height: 160 };
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue(trackRect);

    controls.setJoystickEnabled(true);
    // Enter camera mode via toggle (pointer lock will fail silently in test)
    controls.toggleMouseMode();

    // Touch start on track
    track.dispatchEvent(
      createTouchEvent(
        'touchstart',
        [{ identifier: 2, clientX: 118, clientY: 280 }],
        [{ identifier: 2, clientX: 118, clientY: 280 }]
      )
    );

    // Touch move toward top (negative = up)
    track.dispatchEvent(
      createTouchEvent(
        'touchmove',
        [{ identifier: 2, clientX: 118, clientY: 220 }],
        [{ identifier: 2, clientX: 118, clientY: 220 }]
      )
    );

    const vj = controls.getVJoyValue();
    expect(vj).toBeLessThan(0); // dragging up = negative

    // Touch end resets to zero
    track.dispatchEvent(
      createTouchEvent('touchend', [], [{ identifier: 2, clientX: 118, clientY: 220 }])
    );
    expect(controls.getVJoyValue()).toBe(0);
  });

  it('should update joystick vector when dragging movement joystick', () => {
    const base = document.getElementById('joystick-base');
    vi.spyOn(base, 'getBoundingClientRect').mockReturnValue({
      top: 600,
      left: 20,
      width: 100,
      height: 100,
    });

    controls.setJoystickEnabled(true);
    controls.toggleMouseMode();

    // Touch start at center
    base.dispatchEvent(
      createTouchEvent(
        'touchstart',
        [{ identifier: 0, clientX: 70, clientY: 650 }],
        [{ identifier: 0, clientX: 70, clientY: 650 }]
      )
    );

    // Touch move right
    base.dispatchEvent(
      createTouchEvent(
        'touchmove',
        [{ identifier: 0, clientX: 120, clientY: 650 }],
        [{ identifier: 0, clientX: 120, clientY: 650 }]
      )
    );

    const jv = controls.getJoystickVector();
    expect(jv.x).toBeGreaterThan(0); // right = positive x
    expect(jv.y).toBeCloseTo(0);

    // Touch end resets
    base.dispatchEvent(
      createTouchEvent('touchend', [], [{ identifier: 0, clientX: 120, clientY: 650 }])
    );
    expect(controls.getJoystickVector()).toEqual({ x: 0, y: 0 });
  });

  it('should handle touchcancel by resetting state', () => {
    const base = document.getElementById('joystick-base');
    vi.spyOn(base, 'getBoundingClientRect').mockReturnValue({
      top: 600,
      left: 20,
      width: 100,
      height: 100,
    });

    controls.setJoystickEnabled(true);
    controls.toggleMouseMode();

    base.dispatchEvent(
      createTouchEvent(
        'touchstart',
        [{ identifier: 0, clientX: 70, clientY: 650 }],
        [{ identifier: 0, clientX: 70, clientY: 650 }]
      )
    );

    // Move via document (how the real handler works)
    document.dispatchEvent(
      createTouchEvent(
        'touchmove',
        [{ identifier: 0, clientX: 120, clientY: 650 }],
        [{ identifier: 0, clientX: 120, clientY: 650 }]
      )
    );
    expect(controls.getJoystickVector().x).toBeGreaterThan(0);

    // Cancel resets
    const cancelEvent = new Event('touchcancel', { bubbles: true });
    cancelEvent.changedTouches = [{ identifier: 0, clientX: 120, clientY: 650 }];
    document.dispatchEvent(cancelEvent);
    expect(controls.getJoystickVector()).toEqual({ x: 0, y: 0 });
  });

  it('should support simultaneous joystick + vertical joystick touches', () => {
    const base = document.getElementById('joystick-base');
    const track = document.getElementById('vjoy-track');

    vi.spyOn(base, 'getBoundingClientRect').mockReturnValue({
      top: 600,
      left: 20,
      width: 100,
      height: 100,
    });
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
      top: 200,
      left: 100,
      width: 36,
      height: 160,
    });

    controls.setJoystickEnabled(true);
    controls.toggleMouseMode();

    // Start movement joystick (touch id 0)
    base.dispatchEvent(
      createTouchEvent(
        'touchstart',
        [{ identifier: 0, clientX: 70, clientY: 650 }],
        [{ identifier: 0, clientX: 70, clientY: 650 }]
      )
    );

    // Start vertical joystick (touch id 2)
    track.dispatchEvent(
      createTouchEvent(
        'touchstart',
        [{ identifier: 2, clientX: 118, clientY: 280 }],
        [{ identifier: 2, clientX: 118, clientY: 280 }]
      )
    );

    // Move both
    document.dispatchEvent(
      createTouchEvent(
        'touchmove',
        [
          { identifier: 0, clientX: 120, clientY: 650 },
          { identifier: 2, clientX: 118, clientY: 220 },
        ],
        [
          { identifier: 0, clientX: 120, clientY: 650 },
          { identifier: 2, clientX: 118, clientY: 220 },
        ]
      )
    );

    const jv = controls.getJoystickVector();
    const vj = controls.getVJoyValue();
    expect(jv.x).toBeGreaterThan(0); // movement right
    expect(vj).toBeLessThan(0); // vertical up
  });

  it('should hide joystick elements when camera mode is off', () => {
    controls.setJoystickEnabled(true);
    // Joystick starts hidden (camera mode off by default)
    const vj = document.getElementById('virtual-joystick');
    const la = document.getElementById('virtual-look-area');
    const vjt = document.getElementById('vertical-joystick');

    expect(vj.classList.contains('visible')).toBe(false);
    expect(la.classList.contains('visible')).toBe(false);
    expect(vjt.classList.contains('visible')).toBe(false);
  });

  it('should show joystick elements when camera mode and joystick enabled', () => {
    controls.setJoystickEnabled(true);
    controls.toggleMouseMode();

    const vj = document.getElementById('virtual-joystick');
    const la = document.getElementById('virtual-look-area');
    const vjt = document.getElementById('vertical-joystick');

    expect(vj.classList.contains('visible')).toBe(true);
    expect(la.classList.contains('visible')).toBe(true);
    expect(vjt.classList.contains('visible')).toBe(true);
  });

  it('should handle look area touch for yaw/pitch', () => {
    const lookArea = document.getElementById('virtual-look-area');
    controls.setJoystickEnabled(true);
    controls.toggleMouseMode();

    const initialYaw = controls.yaw;
    const initialPitch = controls.pitch;

    // Touch start on look area
    lookArea.dispatchEvent(
      createTouchEvent(
        'touchstart',
        [{ identifier: 1, clientX: 400, clientY: 300 }],
        [{ identifier: 1, clientX: 400, clientY: 300 }]
      )
    );

    // Touch move
    document.dispatchEvent(
      createTouchEvent(
        'touchmove',
        [{ identifier: 1, clientX: 500, clientY: 350 }],
        [{ identifier: 1, clientX: 500, clientY: 350 }]
      )
    );

    // Yaw and pitch should have changed
    expect(controls.yaw).not.toBe(initialYaw);
    expect(controls.pitch).not.toBe(initialPitch);

    // Touch end
    document.dispatchEvent(
      createTouchEvent('touchend', [], [{ identifier: 1, clientX: 500, clientY: 350 }])
    );
  });

  it('should not steal look area touch when touching vertical joystick', () => {
    const track = document.getElementById('vjoy-track');
    controls.setJoystickEnabled(true);
    controls.toggleMouseMode();

    const initialYaw = controls.yaw;

    // Touch on vJoy track (not look area)
    track.dispatchEvent(
      createTouchEvent(
        'touchstart',
        [{ identifier: 2, clientX: 118, clientY: 280 }],
        [{ identifier: 2, clientX: 118, clientY: 280 }]
      )
    );

    // Move the touch
    document.dispatchEvent(
      createTouchEvent(
        'touchmove',
        [{ identifier: 2, clientX: 118, clientY: 200 }],
        [{ identifier: 2, clientX: 118, clientY: 200 }]
      )
    );

    // Yaw should NOT have changed (look area should not have claimed this touch)
    expect(controls.yaw).toBe(initialYaw);

    // But vJoy value should have changed
    expect(controls.getVJoyValue()).not.toBe(0);
  });

  it('should allow mouse-look after releasing vertical joystick', () => {
    const track = document.getElementById('vjoy-track');
    const lookArea = document.getElementById('virtual-look-area');

    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
      top: 200,
      left: 100,
      width: 36,
      height: 160,
    });

    controls.setJoystickEnabled(true);
    controls.toggleMouseMode();

    // Use vertical joystick
    track.dispatchEvent(
      createTouchEvent(
        'touchstart',
        [{ identifier: 2, clientX: 118, clientY: 280 }],
        [{ identifier: 2, clientX: 118, clientY: 280 }]
      )
    );
    document.dispatchEvent(
      createTouchEvent(
        'touchmove',
        [{ identifier: 2, clientX: 118, clientY: 200 }],
        [{ identifier: 2, clientX: 118, clientY: 200 }]
      )
    );
    expect(controls.getVJoyValue()).not.toBe(0);

    // Release vertical joystick
    document.dispatchEvent(
      createTouchEvent('touchend', [], [{ identifier: 2, clientX: 118, clientY: 200 }])
    );
    expect(controls.getVJoyValue()).toBe(0);

    // Now use mouse look — should work independently
    const initialYaw = controls.yaw;
    const initialPitch = controls.pitch;
    lookArea.dispatchEvent(
      createTouchEvent(
        'touchstart',
        [{ identifier: 3, clientX: 400, clientY: 300 }],
        [{ identifier: 3, clientX: 400, clientY: 300 }]
      )
    );
    document.dispatchEvent(
      createTouchEvent(
        'touchmove',
        [{ identifier: 3, clientX: 500, clientY: 350 }],
        [{ identifier: 3, clientX: 500, clientY: 350 }]
      )
    );
    expect(controls.yaw).not.toBe(initialYaw);
    expect(controls.pitch).not.toBe(initialPitch);

    document.dispatchEvent(
      createTouchEvent('touchend', [], [{ identifier: 3, clientX: 500, clientY: 350 }])
    );
  });

  it('should reset all joystick state when pointer lock is lost', () => {
    const base = document.getElementById('joystick-base');
    const track = document.getElementById('vjoy-track');
    vi.spyOn(base, 'getBoundingClientRect').mockReturnValue({
      top: 600,
      left: 20,
      width: 100,
      height: 100,
    });
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
      top: 200,
      left: 100,
      width: 36,
      height: 160,
    });

    // Set up a mock renderer so the pointerlockchange handler fires
    const canvas = document.createElement('canvas');
    controls.setRenderer({ domElement: canvas }, { quaternion: { toArray: () => [0, 0, 0, 1] } });

    controls.setJoystickEnabled(true);
    controls.toggleMouseMode();

    // Simulate pointer lock being acquired
    globalThis.document.pointerLockElement = canvas;
    document.dispatchEvent(new Event('pointerlockchange'));

    // Start movement joystick
    base.dispatchEvent(
      createTouchEvent(
        'touchstart',
        [{ identifier: 0, clientX: 70, clientY: 650 }],
        [{ identifier: 0, clientX: 70, clientY: 650 }]
      )
    );
    document.dispatchEvent(
      createTouchEvent(
        'touchmove',
        [{ identifier: 0, clientX: 120, clientY: 650 }],
        [{ identifier: 0, clientX: 120, clientY: 650 }]
      )
    );
    expect(controls.getJoystickVector().x).toBeGreaterThan(0);

    // Start vertical joystick
    track.dispatchEvent(
      createTouchEvent(
        'touchstart',
        [{ identifier: 2, clientX: 118, clientY: 280 }],
        [{ identifier: 2, clientX: 118, clientY: 280 }]
      )
    );
    document.dispatchEvent(
      createTouchEvent(
        'touchmove',
        [{ identifier: 2, clientX: 118, clientY: 200 }],
        [{ identifier: 2, clientX: 118, clientY: 200 }]
      )
    );
    expect(controls.getVJoyValue()).not.toBe(0);

    // Simulate pointer lock loss (e.g., fullscreen exit, orientation change)
    globalThis.document.pointerLockElement = null;
    document.dispatchEvent(new Event('pointerlockchange'));

    // All state should be reset
    expect(controls.mouseLookOn).toBe(false);
    expect(controls.getJoystickVector()).toEqual({ x: 0, y: 0 });
    expect(controls.getVJoyValue()).toBe(0);

    const vj = document.getElementById('virtual-joystick');
    const la = document.getElementById('virtual-look-area');
    const vjt = document.getElementById('vertical-joystick');
    expect(vj.classList.contains('visible')).toBe(false);
    expect(la.classList.contains('visible')).toBe(false);
    expect(vjt.classList.contains('visible')).toBe(false);

    // Thumb and stick positions should be reset
    const stick = document.getElementById('joystick-stick');
    const thumb = document.getElementById('vjoy-thumb');
    expect(stick.style.transform).toContain('translate(-50%, -50%)');
    expect(thumb.style.top).toBe('50%');
  });

  it('should reset joystick state when camera mode is toggled off', () => {
    const base = document.getElementById('joystick-base');
    vi.spyOn(base, 'getBoundingClientRect').mockReturnValue({
      top: 600,
      left: 20,
      width: 100,
      height: 100,
    });

    controls.setJoystickEnabled(true);
    controls.toggleMouseMode();

    // Start joystick movement
    base.dispatchEvent(
      createTouchEvent(
        'touchstart',
        [{ identifier: 0, clientX: 70, clientY: 650 }],
        [{ identifier: 0, clientX: 70, clientY: 650 }]
      )
    );
    document.dispatchEvent(
      createTouchEvent(
        'touchmove',
        [{ identifier: 0, clientX: 120, clientY: 650 }],
        [{ identifier: 0, clientX: 120, clientY: 650 }]
      )
    );
    expect(controls.getJoystickVector().x).toBeGreaterThan(0);

    // Toggle camera mode off
    controls.toggleMouseMode();

    expect(controls.getJoystickVector()).toEqual({ x: 0, y: 0 });
    expect(controls.getVJoyValue()).toBe(0);
  });
});
