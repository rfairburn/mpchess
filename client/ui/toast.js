// ═══════════════════════════════════════════════════════════
//  UI — Toast notifications (error, info, warning)
// ═══════════════════════════════════════════════════════════

const errorToast = document.getElementById('error-toast');

let errorTimeout = null;

export function showError(msg) {
  errorToast.textContent = msg;
  errorToast.style.color = '#ff6b6b';
  errorToast.style.borderColor = 'rgba(255, 80, 80, 0.4)';
  errorToast.classList.add('visible');
  clearTimeout(errorTimeout);
  errorTimeout = setTimeout(() => errorToast.classList.remove('visible'), 2500);
}

export function showInfo(msg) {
  errorToast.textContent = msg;
  errorToast.style.color = '#6bff6b';
  errorToast.style.borderColor = 'rgba(80, 255, 80, 0.4)';
  errorToast.classList.add('visible');
  clearTimeout(errorTimeout);
  errorTimeout = setTimeout(() => errorToast.classList.remove('visible'), 2500);
}

export function showWarning(msg) {
  errorToast.textContent = msg;
  errorToast.style.color = '#ffd966';
  errorToast.style.borderColor = 'rgba(255, 200, 50, 0.4)';
  errorToast.classList.add('visible');
  clearTimeout(errorTimeout);
  errorTimeout = setTimeout(() => errorToast.classList.remove('visible'), 5000);
}
