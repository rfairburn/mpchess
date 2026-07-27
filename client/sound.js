// ═══════════════════════════════════════════════════════════
//  SOUND — Web Audio API wrapper for piece move effects
// ═══════════════════════════════════════════════════════════

let audioCtx = null;
let sampleBuffer = null;

const STORAGE_KEY = 'mpchessSoundMuted';

function loadMuteState() {
  try {
    const val = localStorage.getItem(STORAGE_KEY);
    if (val !== null) return val === 'true';
  } catch {
    // localStorage unavailable
  }
  return false;
}

function saveMuteState(value) {
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    // localStorage unavailable
  }
}

let muted = loadMuteState();

const SAMPLE_URL = './files/pickup.wav';

// Pitch range for randomization (playbackRate multiplier)
const PITCH_MIN = 0.85;
const PITCH_MAX = 1.15;

// Volume range for randomization
const VOLUME_MIN = 0.3;
const VOLUME_MAX = 0.6;

/**
 * Load the sound sample and create the AudioContext.
 * Call once at app startup. Safe to call multiple times.
 */
export async function init() {
  if (sampleBuffer) return; // already loaded

  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const resp = await fetch(SAMPLE_URL);
    if (!resp.ok) throw new Error(`Failed to load ${SAMPLE_URL}: ${resp.status}`);
    const arrayBuf = await resp.arrayBuffer();
    sampleBuffer = await audioCtx.decodeAudioData(arrayBuf);
  } catch (err) {
    console.warn('Sound init failed:', err.message);
  }
}

/**
 * Play a single piece move sound with random pitch/volume variance.
 */
export function playMove() {
  if (muted || !audioCtx || !sampleBuffer) return;

  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  const source = audioCtx.createBufferSource();
  source.buffer = sampleBuffer;
  source.playbackRate.value = PITCH_MIN + Math.random() * (PITCH_MAX - PITCH_MIN);

  const gain = audioCtx.createGain();
  gain.gain.value = VOLUME_MIN + Math.random() * (VOLUME_MAX - VOLUME_MIN);

  source.connect(gain);
  gain.connect(audioCtx.destination);
  source.start();
}

export function setMute(value) {
  muted = value;
  saveMuteState(value);
}

export function isMuted() {
  return muted;
}
