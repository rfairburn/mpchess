// ═══════════════════════════════════════════════════════════
//  UI — Premove feedback (owner-only toasts + sound)
//  Subscribes to premove events from network.js. The server only
//  sends the `premove` confirmation echo to the owner, and the
//  `premovePlayed` event is only emitted when msg.color === myRole,
//  so opponents and spectators never receive premove-specific UI.
// ═══════════════════════════════════════════════════════════

import { onPremoveSet, onPremovePlayed, onPremoveDiscarded } from '../network.js';
import { shouldNotifyPremoveDiscarded } from '../premove.js';
import { showInfo } from './toast.js';
import { playMove } from '../sound.js';
import { t } from '../../shared/i18n.mjs';

// Premove set (private confirmation echo): short localized toast plus
// one soft pickup sound (the existing move sound, reused).
onPremoveSet(() => {
  showInfo(t('premove.set'));
  playMove();
});

// Premove played (public move with premove:true, owner only): localized
// toast. The ordinary move animation/sound plays exactly once for every
// client (including the owner) through the normal move path, so no
// additional sound is played here — that would double the move sound.
onPremovePlayed(() => {
  showInfo(t('premove.played'));
});

onPremoveDiscarded(() => {
  if (shouldNotifyPremoveDiscarded()) showInfo(t('premove.discarded'));
});

// `premoveCleared` and user-initiated cancels remain silent: the board is
// changing or the visuals dropping immediately already confirms the action.
