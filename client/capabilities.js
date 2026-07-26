// ═══════════════════════════════════════════════════════════
//  CAPABILITIES — device/browser feature detection
//  Single source of truth for mobile, fullscreen, pointer-lock
// ═══════════════════════════════════════════════════════════

// Returns true when the device has a coarse (touch) pointer.
export function isTouchDevice() {
  return (
    navigator.maxTouchPoints > 0 ||
    (window.matchMedia && window.matchMedia('(pointer: coarse)').matches)
  );
}

// Returns true when the device looks like a mobile phone
// (touch + short edge <= 768px).
export function isMobilePhone() {
  return isTouchDevice() && Math.min(window.innerWidth, window.innerHeight) <= 768;
}

// Returns true when the Fullscreen API is available.
export function hasFullscreen() {
  return !!document.documentElement.requestFullscreen;
}

// Returns true when Pointer Lock API is available on the given element.
export function hasPointerLock(element) {
  return !!element?.requestPointerLock;
}
