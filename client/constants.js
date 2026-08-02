// ═══════════════════════════════════════════════════════════
//  Shared client constants
// ═══════════════════════════════════════════════════════════

import { t } from './i18n.js';

// Skill labels — resolved via i18n
export function getSkillLabel(skill) {
  return t(`ui.skill_${skill}`);
}
