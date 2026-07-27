// ═══════════════════════════════════════════════════════════
//  SOUND MODULE — unit tests for Web Audio API wrapper
// ═══════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';

// ── Mock localStorage ────────────────────────────────────
const storage = {};
const lsMock = {
  getItem: vi.fn((k) => storage[k] ?? null),
  setItem: vi.fn((k, v) => {
    storage[k] = String(v);
  }),
  removeItem: vi.fn((k) => {
    delete storage[k];
  }),
};
Object.defineProperty(globalThis, 'localStorage', {
  value: lsMock,
  writable: true,
  configurable: true,
});

// ── Mock Web Audio API ───────────────────────────────────
let mockCtx = null;
let mockSources = [];
let mockGains = [];

class MockBufferSource {
  constructor() {
    this.buffer = null;
    this.playbackRate = { value: 1 };
    mockSources.push(this);
  }
  connect(dest) {
    return dest;
  }
  start() {}
}

class MockGain {
  constructor() {
    this.gain = { value: 1 };
    mockGains.push(this);
  }
  connect(dest) {
    return dest;
  }
}

class MockAudioContext {
  constructor() {
    this.state = 'running';
    mockCtx = this;
  }
  createBufferSource() {
    return new MockBufferSource();
  }
  createGain() {
    return new MockGain();
  }
  resume() {
    this.state = 'running';
  }
}

Object.defineProperty(globalThis, 'AudioContext', {
  value: MockAudioContext,
  writable: true,
  configurable: true,
});

// Mock fetch for sample loading
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

describe('sound module', () => {
  let sound;

  async function reloadSound() {
    vi.resetModules();
    mockSources = [];
    mockGains = [];
    mockCtx = null;
    // Re-apply localStorage mock after resetModules (jsdom may restore its own)
    Object.defineProperty(globalThis, 'localStorage', {
      value: lsMock,
      writable: true,
      configurable: true,
    });
    sound = await import('../../client/sound.js');
  }

  beforeEach(() => {
    vi.clearAllMocks();
    storage['mpchessSoundMuted'] = undefined;
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('init', () => {
    it('should create AudioContext and decode sample on success', async () => {
      const fakeBuffer = new ArrayBuffer(8);
      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(fakeBuffer),
      });

      // Mock decodeAudioData on the instance
      const origProto = MockAudioContext.prototype;
      origProto.decodeAudioData = vi.fn().mockResolvedValue({ sampleRate: 48000 });

      await reloadSound();
      await sound.init();

      expect(mockCtx).not.toBeNull();
      expect(origProto.decodeAudioData).toHaveBeenCalled();
    });

    it('should handle fetch failure gracefully', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 404 });

      await reloadSound();
      await sound.init(); // should not throw

      expect(mockFetch).toHaveBeenCalledWith('./files/pickup.wav');
    });
  });

  describe('playMove', () => {
    it('should create a BufferSource with random playbackRate in range', async () => {
      const fakeBuffer = new ArrayBuffer(8);
      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(fakeBuffer),
      });
      MockAudioContext.prototype.decodeAudioData = vi.fn().mockResolvedValue({ sampleRate: 48000 });

      await reloadSound();
      await sound.init();

      // Play multiple times and verify pitch range
      for (let i = 0; i < 10; i++) {
        mockSources = [];
        mockGains = [];
        sound.playMove();
        expect(mockSources.length).toBe(1);
        const rate = mockSources[0].playbackRate.value;
        expect(rate).toBeGreaterThanOrEqual(0.85);
        expect(rate).toBeLessThanOrEqual(1.15);
      }
    });

    it('should create a GainNode with random volume in range', async () => {
      const fakeBuffer = new ArrayBuffer(8);
      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(fakeBuffer),
      });
      MockAudioContext.prototype.decodeAudioData = vi.fn().mockResolvedValue({ sampleRate: 48000 });

      await reloadSound();
      await sound.init();

      for (let i = 0; i < 10; i++) {
        mockSources = [];
        mockGains = [];
        sound.playMove();
        expect(mockGains.length).toBe(1);
        const vol = mockGains[0].gain.value;
        expect(vol).toBeGreaterThanOrEqual(0.3);
        expect(vol).toBeLessThanOrEqual(0.6);
      }
    });

    it('should not play when muted', async () => {
      const fakeBuffer = new ArrayBuffer(8);
      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(fakeBuffer),
      });
      MockAudioContext.prototype.decodeAudioData = vi.fn().mockResolvedValue({ sampleRate: 48000 });

      await reloadSound();
      await sound.init();
      sound.setMute(true);

      mockSources = [];
      sound.playMove();
      expect(mockSources.length).toBe(0);
    });

    it('should not play before init', async () => {
      await reloadSound();
      mockSources = [];
      sound.playMove(); // no init called
      expect(mockSources.length).toBe(0);
    });

    it('should resume suspended AudioContext', async () => {
      const fakeBuffer = new ArrayBuffer(8);
      mockFetch.mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(fakeBuffer),
      });
      MockAudioContext.prototype.decodeAudioData = vi.fn().mockResolvedValue({ sampleRate: 48000 });

      await reloadSound();
      await sound.init();

      // Simulate suspended state
      mockCtx.state = 'suspended';
      const resumeSpy = vi.spyOn(mockCtx, 'resume');

      mockSources = [];
      sound.playMove();
      expect(resumeSpy).toHaveBeenCalled();
    });
  });

  describe('mute persistence', () => {
    it('should save mute state to localStorage on setMute', async () => {
      await reloadSound();
      sound.setMute(true);

      expect(lsMock.setItem).toHaveBeenCalledWith('mpchessSoundMuted', 'true');
    });

    it('should save unmute state to localStorage on setMute', async () => {
      await reloadSound();
      sound.setMute(false);

      expect(lsMock.setItem).toHaveBeenCalledWith('mpchessSoundMuted', 'false');
    });

    it('should restore muted=true from localStorage on fresh import', async () => {
      storage['mpchessSoundMuted'] = 'true';
      await reloadSound();

      expect(sound.isMuted()).toBe(true);
      // Playback should be suppressed while muted
      mockSources = [];
      sound.playMove();
      expect(mockSources.length).toBe(0);
    });

    it('should restore muted=false from localStorage on fresh import', async () => {
      storage['mpchessSoundMuted'] = 'false';
      await reloadSound();

      expect(sound.isMuted()).toBe(false);
    });

    it('should default to unmuted when no localStorage value', async () => {
      storage['mpchessSoundMuted'] = undefined;
      await reloadSound();

      expect(sound.isMuted()).toBe(false);
    });
  });
});
