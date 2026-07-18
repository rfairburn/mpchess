// ═══════════════════════════════════════════════════════════
//  CONTROLS_CONFIG — shared configuration for controls.js and ui.js
//  This module has NO dependencies on other client modules,
//  breaking the circular dependency between controls.js and ui.js.
// ═══════════════════════════════════════════════════════════

export const CONTROLS_CONFIG = {
  // Drag-to-move: pixels of movement before a click becomes a drag
  dragThreshold: 5,
  // Piece elevation (Y offset) while being dragged
  dragHeight: 0.6,
  // Pitch clamp limits for camera fly mode (radians)
  pitchMin: -Math.PI / 2.1,
  pitchMax: Math.PI / 2.1,
  // Camera positions map — keys 1-6
  // 1-3: role views (white, black, spectator)
  // 4-6: overhead views from (0, 11, 0) looking down, oriented per role
  cameraPositions: {
    1: { x: 0, y: 7, z: 10, lookAt: [0, 0, 0] }, // white
    2: { x: 0, y: 7, z: -10, lookAt: [0, 0, 0] }, // black
    3: { x: -10, y: 7, z: 0, lookAt: [0, 0, 0] }, // spectator
    // Overhead views: directly above center, y=11 so the full 8×8 board fits in view
    // pitch=-π/2 points camera along -Y (down at the board); yaw sets horizontal orientation
    4: { x: 0, y: 11, z: 0, euler: [-Math.PI / 2, 0, 0] }, // white overhead (white's side at bottom)
    5: { x: 0, y: 11, z: 0, euler: [-Math.PI / 2, Math.PI, 0] }, // black overhead (black's side at bottom)
    6: { x: 0, y: 11, z: 0, euler: [-Math.PI / 2, -Math.PI / 2, 0] }, // spectator overhead
  },
  // Role-to-key mapping for setCameraForRole
  roleKey: { white: 1, black: 2, spectator: 3 },
  // Mouse sensitivity defaults (fly mode)
  // The runtime mouseSensitivity is user-configurable via ui.js slider + localStorage.
  // These constants define the default and the slider conversion curve.
  defaultMouseSensitivity: 0.002,
  // Slider range: 1–100 maps exponentially to sensitivityMin–sensitivityMax
  sensitivityMin: 0.0002,
  sensitivityMax: 0.004,
  sensitivitySliderMin: 1,
  sensitivitySliderMax: 100,
  sensitivitySliderBase: 20, // exponential base: min * base^((v-1)/99)
};
