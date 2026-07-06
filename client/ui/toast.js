// ═══════════════════════════════════════════════════════════
//  UI — Toast notifications (error, info, warning)
// ═══════════════════════════════════════════════════════════

const errorToast = document.getElementById('error-toast');

let errorTimeout = null;

function showToast(msg, color, borderColor, duration = 2500) {
  errorToast.textContent = msg;
  errorToast.style.color = color;
  errorToast.style.borderColor = borderColor;
  errorToast.classList.add('visible');
  clearTimeout(errorTimeout);
  errorTimeout = setTimeout(() => errorToast.classList.remove('visible'), duration);
}

export function showError(msg) {
  return showToast(msg, '#ff6b6b', 'rgba(255, 80, 80, 0.4)');
}

export function showInfo(msg) {
  return showToast(msg, '#6bff6b', 'rgba(80, 255, 80, 0.4)');
}

export function showWarning(msg) {
  return showToast(msg, '#ffd966', 'rgba(255, 200, 50, 0.4)', 5000);
}
