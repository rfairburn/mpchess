// ═══════════════════════════════════════════════════════════
//  UI — Computer player (thinking indicator, activation, skill)
// ═══════════════════════════════════════════════════════════

import {
  myRole,
  seatStatus,
  computerPlayer,
  serverGameOver,
  sendActivateComputer,
  sendChangeSkill,
  onMove,
  onRestart,
  onComputerActivated,
  onComputerThinking,
  onComputerSkillChanged,
  onComputerUnavailable,
} from '../network.js';
import { showInfo, showError } from './toast.js';
import { getSkillLabel } from '../constants.js';
import { t } from '../../shared/i18n.mjs';

// ── DOM refs ──────────────────────────────────────────────

const computerThinkingIndicator = document.getElementById('computer-thinking');

// ── State ─────────────────────────────────────────────────

let lastThinkingColor = null; // stable color ID for locale refresh

const menuComputerSection = document.getElementById('menu-computer-section');
const menuSkillChangeSection = document.getElementById('menu-skill-change-section');
const menuComputerSkillDropdown = document.getElementById('menu-computer-skill-dropdown');
const menuSkillChangeDropdown = document.getElementById('menu-skill-change-dropdown');
const btnMenuActivateComputer = document.getElementById('btn-menu-activate-computer');
const btnMenuChangeSkill = document.getElementById('btn-menu-change-skill');

// ── Menu computer sections ───────────────────────────────

export function updateMenuComputerSections() {
  const isPlayer = myRole === 'white' || myRole === 'black';

  if (isPlayer && !serverGameOver) {
    const opponentColor = myRole === 'white' ? 'black' : 'white';
    const opponentSeat = seatStatus[opponentColor];
    const opponentSeatFree = opponentSeat?.status === 'free';

    if (computerPlayer) {
      menuComputerSection.classList.remove('visible');
      menuSkillChangeSection.classList.add('visible');
      menuSkillChangeDropdown.value = computerPlayer.skill || 'master';
    } else if (opponentSeatFree) {
      menuComputerSection.classList.add('visible');
      menuSkillChangeSection.classList.remove('visible');
    } else {
      menuComputerSection.classList.remove('visible');
      menuSkillChangeSection.classList.remove('visible');
    }
  } else {
    menuComputerSection.classList.remove('visible');
    menuSkillChangeSection.classList.remove('visible');
  }
}

// ── Button handlers (registered via init to receive hideMenu) ─

/**
 * Call once from ui.js after importing, passing the menu-close function.
 * This avoids a circular dependency (ui.js → computer.js → ui.js).
 */
export function initComputerMenu(closeMenu) {
  if (btnMenuActivateComputer) {
    btnMenuActivateComputer.addEventListener('click', () => {
      const skill = menuComputerSkillDropdown?.value || 'master';
      const opponentColor = myRole === 'white' ? 'black' : 'white';
      sendActivateComputer(opponentColor, skill);
      closeMenu();
    });
  }

  if (btnMenuChangeSkill) {
    btnMenuChangeSkill.addEventListener('click', () => {
      const skill = menuSkillChangeDropdown?.value || 'master';
      sendChangeSkill(skill);
      closeMenu();
    });
  }
}

// ── Callbacks ─────────────────────────────────────────────

onComputerActivated((msg) => {
  showInfo(t('ui.computer_activated', { skill: getSkillLabel(msg.skill) }));
});

onComputerThinking((msg) => {
  if (computerThinkingIndicator) {
    lastThinkingColor = msg.color;
    const color = msg.color === 'white' ? t('color.white') : t('color.black');
    computerThinkingIndicator.textContent = t('ui.computer_thinking', { color });
    computerThinkingIndicator.classList.add('visible');
  }
});

onMove(() => {
  if (computerThinkingIndicator) {
    computerThinkingIndicator.classList.remove('visible');
  }
});

onComputerSkillChanged((msg) => {
  showInfo(t('ui.skill_changed', { skill: getSkillLabel(msg.skill) }));
});

onComputerUnavailable((msg) => {
  showError(t(msg.reason) || t('ui.computer_unavailable'));
  if (computerThinkingIndicator) {
    computerThinkingIndicator.classList.remove('visible');
  }
});

onRestart(() => {
  if (computerThinkingIndicator) {
    computerThinkingIndicator.classList.remove('visible');
  }
});

// ── Locale refresh ───────────────────────────────────────

export function refreshComputerThinking() {
  if (lastThinkingColor && computerThinkingIndicator?.classList.contains('visible')) {
    const color = lastThinkingColor === 'white' ? t('color.white') : t('color.black');
    computerThinkingIndicator.textContent = t('ui.computer_thinking', { color });
  }
}
