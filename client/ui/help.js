import { isTouchDevice } from '../capabilities.js';

let helpOverlay = document.getElementById('help-overlay');
let helpOpen = false;
let previousFocus = null;
let closeCallback = null;

function isActuallyVisible(element) {
  if (!element?.isConnected || element.disabled) return false;
  const style = window.getComputedStyle(element);
  return (
    style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0
  );
}

function trapHandler(event) {
  if (event.key !== 'Tab') return;
  const overlay = document.getElementById('help-overlay');
  if (!overlay) return;
  const allFocusable = overlay.querySelectorAll(
    'button, [href], input, select, summary, [tabindex]:not([tabindex="-1"])'
  );
  const focusable = Array.from(allFocusable).filter(isActuallyVisible);
  if (focusable.length === 0) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  }
}

function closeBtnHandler() {
  hideHelp();
}

function overlayClickHandler(e) {
  if (e.target === helpOverlay) hideHelp();
}

export function getTrapHandler() {
  return trapHandler;
}

export function showHelp(onClose) {
  if (!helpOverlay) return;
  previousFocus = document.activeElement;
  closeCallback = onClose || null;
  helpOpen = true;
  helpOverlay.classList.add('visible');
  helpOverlay.addEventListener('keydown', trapHandler);

  const closeBtn = document.getElementById('btn-help-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', closeBtnHandler);
    closeBtn.focus();
  }

  helpOverlay.addEventListener('click', overlayClickHandler);

  // Set section open/closed state based on device
  const sections = helpOverlay.querySelectorAll('.help-section');
  if (isTouchDevice()) {
    sections.forEach((section, i) => {
      section.open = i === 0;
    });
  } else {
    sections.forEach((section) => {
      section.open = true;
    });
  }
}

export function hideHelp() {
  if (!helpOverlay || !helpOpen) return;

  const focusTarget = previousFocus;
  const restoreUi = closeCallback;
  previousFocus = null;
  closeCallback = null;
  helpOpen = false;
  helpOverlay.classList.remove('visible');
  helpOverlay.removeEventListener('keydown', trapHandler);

  const closeBtn = document.getElementById('btn-help-close');
  if (closeBtn) {
    closeBtn.removeEventListener('click', closeBtnHandler);
  }
  helpOverlay.removeEventListener('click', overlayClickHandler);

  if (focusTarget && !isActuallyVisible(focusTarget)) {
    restoreUi?.();
  }

  if (isActuallyVisible(focusTarget)) {
    focusTarget.focus();
  } else {
    document.body.tabIndex = -1;
    document.body.focus();
  }
}

export { helpOpen };

// Coordination function called by showMenu() to close Help before opening the menu.
// Exported so tests can verify the production menu→help coordination path.
export function closeHelpForMenu() {
  hideHelp();
}
