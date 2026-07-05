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
  onComputerActivated,
  onComputerThinking,
  onComputerSkillChanged,
  onComputerUnavailable,
} from '../network.js';
import { showInfo, showError } from './toast.js';

// ── DOM refs ──────────────────────────────────────────────

const computerThinkingIndicator = document.getElementById('computer-thinking');

const menuComputerSection = document.getElementById('menu-computer-section');
const menuSkillChangeSection = document.getElementById('menu-skill-change-section');
const menuComputerSkillDropdown = document.getElementById('menu-computer-skill-dropdown');
const menuSkillChangeDropdown = document.getElementById('menu-skill-change-dropdown');
const btnMenuActivateComputer = document.getElementById('btn-menu-activate-computer');
const btnMenuChangeSkill = document.getElementById('btn-menu-change-skill');

// Skill labels (must stay in sync with server)
const SKILL_LABELS = {
  beginner: 'Beginner',
  novice: 'Novice',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
  master: 'Master',
  grandmaster: 'Grandmaster',
};

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
  showInfo(`Computer player activated (${SKILL_LABELS[msg.skill] || msg.skill})`);
});

onComputerThinking((msg) => {
  if (computerThinkingIndicator) {
    const color = msg.color === 'white' ? 'White' : 'Black';
    computerThinkingIndicator.textContent = `🤖 ${color} is thinking...`;
    computerThinkingIndicator.classList.add('visible');
  }
});

onMove(() => {
  if (computerThinkingIndicator) {
    computerThinkingIndicator.classList.remove('visible');
  }
});

onComputerSkillChanged((msg) => {
  showInfo(`Skill changed to ${SKILL_LABELS[msg.skill] || msg.skill}`);
});

onComputerUnavailable((msg) => {
  showError(msg.reason || 'Computer player unavailable');
  if (computerThinkingIndicator) {
    computerThinkingIndicator.classList.remove('visible');
  }
});
