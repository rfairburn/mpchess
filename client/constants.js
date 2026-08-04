// ═══════════════════════════════════════════════════════════
//  Shared client constants
// ═══════════════════════════════════════════════════════════

import { t } from '../shared/i18n.mjs';

// Skill labels — resolved via i18n
export function getSkillLabel(skill) {
  return t(`ui.skill_${skill}`);
}
