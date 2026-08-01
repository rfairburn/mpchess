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

// Returns true when the primary pointer is coarse, based solely on the CSS
// media query result. Unlike isTouchDevice(), this is false for hybrid-pointer
// devices (e.g., touch-capable laptop with a mouse).
export function isCoarsePointer() {
  return window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
}

// Returns true when the device looks like a mobile phone
// (touch + short edge <= 768px).
export function isMobilePhone() {
  return isTouchDevice() && Math.min(window.innerWidth, window.innerHeight) <= 768;
}

// Returns true when the mobile layout is active.
// Evaluates the exact CSS media query used by style.css:
//   @media (pointer: coarse) and (max-height: 480px),
//          (pointer: coarse) and (orientation: landscape) and (max-width: 900px)
// Plus the portrait-mobile condition (isMobilePhone + portrait).
// This is the single source of truth for mobile vs. desktop rendering.
export function isMobileLayout() {
  const compact =
    window.matchMedia?.(
      '(pointer: coarse) and (max-height: 480px), (pointer: coarse) and (orientation: landscape) and (max-width: 900px)'
    ).matches ?? false;
  if (compact) return true;
  // Portrait mobile phone — based on isMobilePhone (uses isTouchDevice)
  if (isMobilePhone() && window.innerWidth < window.innerHeight) return true;
  return false;
}

// Returns true when the Fullscreen API is available.
export function hasFullscreen() {
  return !!document.documentElement.requestFullscreen;
}

// Returns true when Pointer Lock API is available on the given element.
export function hasPointerLock(element) {
  return !!element?.requestPointerLock;
}
