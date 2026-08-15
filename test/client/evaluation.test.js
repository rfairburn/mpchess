import { describe, it, expect, beforeEach, vi } from 'vitest';

// ===========================================================
//  TEST SUITE -- Evaluation bar (client-side)
//  Covers: score→percent/label conversion, desktop + mobile
//  bar rendering, evaluation message handling, state-message
//  hydration, and restart reset.
//  Drives the real client/network.js + client/ui/evaluation.js
//  with a full DOM fixture and mock WebSocket.
// ===========================================================

// -- DOM fixture -------------------------------------------
// Only the evaluation-bar elements are needed: ui/evaluation.js
// accesses exactly these at module load time.

const DOM_HTML = `
<div id="eval-bar">
  <div id="eval-bar-track">
    <div id="eval-bar-fill"></div>
    <div id="eval-bar-marker"></div>
  </div>
  <div id="eval-score">–</div>
</div>
<div id="eval-bar-mobile">
  <div id="eval-bar-mobile-track">
    <div id="eval-bar-mobile-fill"></div>
    <div id="eval-bar-mobile-marker"></div>
  </div>
  <span id="eval-score-mobile">–</span>
</div>
`;

// -- Mock WebSocket -----------------------------------------

class TrackableWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url) {
    this.url = url;
    this.readyState = TrackableWebSocket.CONNECTING;
    this._onopen = null;
    this._onclose = null;
    this._onerror = null;
    this._onmessage = null;
    this.sentData = [];
  }

  set onopen(fn) {
    this._onopen = fn;
  }
  set onclose(fn) {
    this._onclose = fn;
  }
  set onerror(fn) {
    this._onerror = fn;
  }
  set onmessage(fn) {
    this._onmessage = fn;
  }

  send(data) {
    this.sentData.push(data);
  }
  close() {}
}

function serverMessage(ws, msg) {
  ws._onmessage({ data: JSON.stringify(msg) });
}

describe('evaluation bar -- score conversion', () => {
  let evalModule;

  beforeEach(async () => {
    vi.resetModules();
    document.body.innerHTML = DOM_HTML;
    globalThis.WebSocket = TrackableWebSocket;
    evalModule = await import('../../client/ui/evaluation.js');
  });

  it('scoreToPercent maps neutral/zero to 50%', () => {
    expect(evalModule.scoreToPercent(null)).toBe(50);
    expect(evalModule.scoreToPercent(0)).toBe(50);
  });

  it('scoreToPercent maps positive scores above 50% (white advantage)', () => {
    expect(evalModule.scoreToPercent(100)).toBe(55); // +1 pawn
    expect(evalModule.scoreToPercent(500)).toBe(75); // +5 pawns
    expect(evalModule.scoreToPercent(1000)).toBe(100); // +10 pawns = full bar
  });

  it('scoreToPercent maps negative scores below 50% (black advantage)', () => {
    expect(evalModule.scoreToPercent(-100)).toBe(45);
    expect(evalModule.scoreToPercent(-500)).toBe(25);
    expect(evalModule.scoreToPercent(-1000)).toBe(0);
  });

  it('scoreToPercent clamps beyond ±10 pawns', () => {
    expect(evalModule.scoreToPercent(5000)).toBe(100);
    expect(evalModule.scoreToPercent(-5000)).toBe(0);
  });

  it('scoreToPercent treats mate scores as full bar', () => {
    expect(evalModule.scoreToPercent(10000)).toBe(100);
    expect(evalModule.scoreToPercent(-10000)).toBe(0);
  });

  it('scoreToLabel formats centipawns as signed pawns', () => {
    expect(evalModule.scoreToLabel(null)).toBe('–');
    expect(evalModule.scoreToLabel(0)).toBe('0.00');
    expect(evalModule.scoreToLabel(1250)).toBe('+12.50');
    expect(evalModule.scoreToLabel(-500)).toBe('-5.00');
    expect(evalModule.scoreToLabel(30)).toBe('+0.30');
  });

  it('scoreToLabel formats mate scores', () => {
    expect(evalModule.scoreToLabel(10000)).toBe('M');
    expect(evalModule.scoreToLabel(-10000)).toBe('-M');
  });
});

describe('evaluation bar -- rendering via real network + evaluation modules', () => {
  let mockWs;
  let network;
  let evalModule;

  const $ = (id) => document.getElementById(id);
  // Mobile fill/marker read --eval-pct from the track (orientation-agnostic)
  const mobilePct = () => $('eval-bar-mobile-track').style.getPropertyValue('--eval-pct');

  beforeEach(async () => {
    vi.resetModules();
    document.body.innerHTML = DOM_HTML;
    globalThis.WebSocket = TrackableWebSocket;

    network = await import('../../client/network.js');
    evalModule = await import('../../client/ui/evaluation.js');
    mockWs = window.__mpchess_ws;
    expect(mockWs).toBeTruthy();
  });

  it('renders neutral (50%) with "–" label before any evaluation', () => {
    expect($('eval-bar-fill').style.height).toBe('50%');
    expect($('eval-bar-marker').style.bottom).toBe('50%');
    expect($('eval-score').textContent).toBe('–');
    expect(mobilePct()).toBe('50%');
    expect($('eval-score-mobile').textContent).toBe('–');
  });

  it('evaluation message updates desktop and mobile bars', () => {
    serverMessage(mockWs, { type: 'evaluation', score: 1250, fen: 'x' });

    // +12.50 pawns → clamped to +10 → 100%
    expect($('eval-bar-fill').style.height).toBe('100%');
    expect($('eval-bar-marker').style.bottom).toBe('100%');
    expect($('eval-score').textContent).toBe('+12.50');
    expect(mobilePct()).toBe('100%');
    expect($('eval-score-mobile').textContent).toBe('+12.50');
    expect(network.serverEvaluation).toBe(1250);
  });

  it('evaluation message with small score moves bar proportionally', () => {
    serverMessage(mockWs, { type: 'evaluation', score: 200, fen: 'x' });
    // +2 pawns → 50 + 2/10*50 = 60%
    expect($('eval-bar-fill').style.height).toBe('60%');
    expect($('eval-score').textContent).toBe('+2.00');
  });

  it('negative score favors black (below 50%)', () => {
    serverMessage(mockWs, { type: 'evaluation', score: -300, fen: 'x' });
    // -3 pawns → 50 - 15 = 35%
    expect($('eval-bar-fill').style.height).toBe('35%');
    expect(mobilePct()).toBe('35%');
    expect($('eval-score').textContent).toBe('-3.00');
  });

  it('mate score fills the bar completely', () => {
    serverMessage(mockWs, { type: 'evaluation', score: 10000, fen: 'x' });
    expect($('eval-bar-fill').style.height).toBe('100%');
    expect($('eval-score').textContent).toBe('M');

    serverMessage(mockWs, { type: 'evaluation', score: -10000, fen: 'x' });
    expect($('eval-bar-fill').style.height).toBe('0%');
    expect($('eval-score').textContent).toBe('-M');
  });

  it('null score resets bar to neutral', () => {
    serverMessage(mockWs, { type: 'evaluation', score: 500, fen: 'x' });
    expect($('eval-bar-fill').style.height).toBe('75%');

    serverMessage(mockWs, { type: 'evaluation', score: null, fen: 'x' });
    expect($('eval-bar-fill').style.height).toBe('50%');
    expect($('eval-score').textContent).toBe('–');
    expect(network.serverEvaluation).toBe(null);
  });

  it('state message hydrates the bar for new/reconnecting clients', () => {
    serverMessage(mockWs, {
      type: 'state',
      role: 'spectator',
      board: null,
      turn: 'white',
      castlingRights: { wK: true, wQ: true, bK: true, bQ: true },
      evaluation: -400,
    });
    // -4 pawns → 30%
    expect($('eval-bar-fill').style.height).toBe('30%');
    expect($('eval-score').textContent).toBe('-4.00');
    expect(network.serverEvaluation).toBe(-400);
  });

  it('restart resets the bar to neutral', () => {
    serverMessage(mockWs, { type: 'evaluation', score: 800, fen: 'x' });
    expect($('eval-bar-fill').style.height).toBe('90%');

    serverMessage(mockWs, { type: 'restart' });
    expect($('eval-bar-fill').style.height).toBe('50%');
    expect($('eval-score').textContent).toBe('–');
  });

  it('sets localized aria-labels on both bars', () => {
    expect($('eval-bar').getAttribute('aria-label')).toBe('Evaluation bar');
    expect($('eval-bar-mobile').getAttribute('aria-label')).toBe('Evaluation bar');
  });
});
