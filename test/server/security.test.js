// ═══════════════════════════════════════════════════════════
//  TEST SUITE — security hardening (maxPayload, IP rate limit)
//  Run:  node test/server/security.test.js
// ═══════════════════════════════════════════════════════════

const assert = require('assert');
const http = require('http');
const { WebSocketServer } = require('ws');
const WebSocket = require('ws');

const { Game } = require('../../shared/chess');
const { setupWebSocketHandlers, buildWssOptions } = require('../../server');

// ── Mock WebSocket ────────────────────────────────────────

class MockWebSocket {
  constructor(ip) {
    this.readyState = 1; // OPEN
    this.sentMessages = [];
    this._listeners = {};
    this._closed = false;
    this.bufferedAmount = 0;
    this._socket = ip ? { remoteAddress: ip } : undefined;
  }

  send(data) {
    this.sentMessages.push(data);
  }

  getSent(type) {
    return this.sentMessages
      .filter((m) => {
        try {
          return JSON.parse(m).type === type;
        } catch {
          return false;
        }
      })
      .map((m) => JSON.parse(m));
  }

  on(event, fn) {
    this._listeners[event] = fn;
  }

  emit(event, data) {
    if (this._listeners[event]) this._listeners[event](data);
  }

  close() {
    this.readyState = 3; // CLOSED
    this._closed = true;
    if (this._listeners.close) this._listeners.close();
  }
}

// ── Mock WebSocketServer ──────────────────────────────────

class MockWebSocketServer {
  constructor() {
    this.clients = new Set();
    this._listeners = {};
  }

  on(event, fn) {
    this._listeners[event] = fn;
  }

  simulateConnection(ip) {
    const ws = new MockWebSocket(ip);
    this.clients.add(ws);
    if (this._listeners.connection) this._listeners.connection(ws);
    return ws;
  }

  simulateDisconnect(ws) {
    this.clients.delete(ws);
    ws.close();
  }
}

// ── Test runner ───────────────────────────────────────────

let passed = 0;
let failed = 0;
let total = 0;
const results = [];
const pendingPromises = [];

function test(name, fn) {
  total++;
  const idx = results.length;
  results.push({ label: null, name, ok: null, err: null });
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      pendingPromises.push(
        result.then(
          () => {
            passed++;
            results[idx].ok = true;
          },
          (e) => {
            failed++;
            results[idx].ok = false;
            results[idx].err = e.message;
          }
        )
      );
    } else {
      passed++;
      results[idx].ok = true;
    }
  } catch (e) {
    failed++;
    results[idx].ok = false;
    results[idx].err = e.message;
  }
}

function describe(label, fn) {
  results.push({ label, name: null, ok: null, err: null });
  fn();
}

// ═══════════════════════════════════════════════════════════
//  TESTS — maxPayload via buildWssOptions
// ═══════════════════════════════════════════════════════════

describe('WebSocket maxPayload — production buildWssOptions', () => {
  test('buildWssOptions sets maxPayload to 64 KB', () => {
    const server = http.createServer();
    const opts = buildWssOptions(server);
    assert.strictEqual(opts.maxPayload, 1024 * 64);
    server.close();
  });

  test('buildWssOptions includes the server reference', () => {
    const server = http.createServer();
    const opts = buildWssOptions(server);
    assert.strictEqual(opts.server, server);
    server.close();
  });

  test('buildWssOptions with allowedOrigins sets verifyClient', () => {
    const server = http.createServer();
    const opts = buildWssOptions(server, ['example.com']);
    assert.strictEqual(opts.maxPayload, 1024 * 64);
    assert.ok(typeof opts.verifyClient === 'function');
    server.close();
  });

  test('buildWssOptions without allowedOrigins omits verifyClient', () => {
    const server = http.createServer();
    const opts = buildWssOptions(server, []);
    assert.strictEqual(opts.maxPayload, 1024 * 64);
    assert.strictEqual(opts.verifyClient, undefined);
    server.close();
  });

  test('WebSocketServer built from buildWssOptions rejects oversized messages', () => {
    return new Promise((resolve, reject) => {
      const server = http.createServer();
      const opts = buildWssOptions(server);
      const wss = new WebSocketServer(opts);

      let serverSideClosed = false;
      wss.on('connection', (serverWs) => {
        serverWs.on('close', () => {
          serverSideClosed = true;
        });
        serverWs.on('error', () => {
          serverSideClosed = true;
        });
      });

      const cleanup = () => {
        try {
          server.close();
        } catch {
          /* */
        }
        try {
          wss.close();
        } catch {
          /* */
        }
      };

      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        const client = new WebSocket(`ws://127.0.0.1:${port}`);

        client.on('open', () => {
          // Send a 70 KB message — exceeds the 64 KB maxPayload
          client.send(Buffer.alloc(70 * 1024, 'x'));
        });

        const check = setInterval(() => {
          if (serverSideClosed) {
            clearInterval(check);
            cleanup();
            resolve();
          }
        }, 20);

        setTimeout(() => {
          clearInterval(check);
          try {
            client.terminate();
          } catch {
            /* */
          }
          cleanup();
          if (serverSideClosed) {
            resolve();
          } else {
            reject(new Error('Server did not close connection for oversized message'));
          }
        }, 3000);
      });
    });
  });
});

// ═══════════════════════════════════════════════════════════
//  TESTS — IP-based rate limiting (persistent buckets)
// ═══════════════════════════════════════════════════════════

describe('Rate limiter — per-IP tracking', () => {
  test('multiple connections from same IP share rate limit', () => {
    const game = new Game();
    const wss = new MockWebSocketServer();
    const handlers = setupWebSocketHandlers(wss, game, {
      seatTimeout: 100,
      joinTimeoutMs: 0,
      rateLimitMax: 5,
      rateLimitWindow: 10_000,
    });

    const ws1 = wss.simulateConnection('192.168.1.100');
    const ws2 = wss.simulateConnection('192.168.1.100');

    // ws1 sends 3 messages
    for (let i = 0; i < 3; i++) {
      ws1.emit(
        'message',
        JSON.stringify({
          type: 'move',
          fromFile: 0,
          fromRank: 0,
          toFile: 0,
          toRank: 0,
        })
      );
    }
    assert.strictEqual(ws1.getSent('rateLimited').length, 0);

    // ws2 sends 2 more — total from this IP is now 5
    for (let i = 0; i < 2; i++) {
      ws2.emit(
        'message',
        JSON.stringify({
          type: 'move',
          fromFile: 0,
          fromRank: 0,
          toFile: 0,
          toRank: 0,
        })
      );
    }
    assert.strictEqual(ws2.getSent('rateLimited').length, 0);

    // Next message from either connection should be rate limited
    ws1.emit(
      'message',
      JSON.stringify({
        type: 'move',
        fromFile: 0,
        fromRank: 0,
        toFile: 0,
        toRank: 0,
      })
    );
    assert.strictEqual(ws1.getSent('rateLimited').length, 1);
  });

  test('connections from different IPs have independent limits', () => {
    const game = new Game();
    const wss = new MockWebSocketServer();
    const handlers = setupWebSocketHandlers(wss, game, {
      seatTimeout: 100,
      joinTimeoutMs: 0,
      rateLimitMax: 3,
      rateLimitWindow: 10_000,
    });

    const ws1 = wss.simulateConnection('10.0.0.1');
    const ws2 = wss.simulateConnection('10.0.0.2');

    // Fill ws1's IP bucket
    for (let i = 0; i < 3; i++) {
      ws1.emit(
        'message',
        JSON.stringify({
          type: 'move',
          fromFile: 0,
          fromRank: 0,
          toFile: 0,
          toRank: 0,
        })
      );
    }
    assert.strictEqual(ws1.getSent('rateLimited').length, 0);

    // ws1 should now be rate limited
    ws1.emit(
      'message',
      JSON.stringify({
        type: 'move',
        fromFile: 0,
        fromRank: 0,
        toFile: 0,
        toRank: 0,
      })
    );
    assert.strictEqual(ws1.getSent('rateLimited').length, 1);

    // ws2 (different IP) should still be fine
    ws2.emit(
      'message',
      JSON.stringify({
        type: 'move',
        fromFile: 0,
        fromRank: 0,
        toFile: 0,
        toRank: 0,
      })
    );
    assert.strictEqual(ws2.getSent('rateLimited').length, 0);
  });

  test('connections without _socket fall back to unknown key', () => {
    const game = new Game();
    const wss = new MockWebSocketServer();
    const handlers = setupWebSocketHandlers(wss, game, {
      seatTimeout: 100,
      joinTimeoutMs: 0,
      rateLimitMax: 3,
      rateLimitWindow: 10_000,
    });

    const ws1 = wss.simulateConnection(); // no _socket
    const ws2 = wss.simulateConnection(); // no _socket

    // Both should share the 'unknown' bucket
    for (let i = 0; i < 3; i++) {
      ws1.emit(
        'message',
        JSON.stringify({
          type: 'move',
          fromFile: 0,
          fromRank: 0,
          toFile: 0,
          toRank: 0,
        })
      );
    }
    assert.strictEqual(ws1.getSent('rateLimited').length, 0);

    // ws2 should be rate limited (same 'unknown' bucket)
    ws2.emit(
      'message',
      JSON.stringify({
        type: 'move',
        fromFile: 0,
        fromRank: 0,
        toFile: 0,
        toRank: 0,
      })
    );
    assert.strictEqual(ws2.getSent('rateLimited').length, 1);
  });
});

describe('Rate limiter — bucket persists across rejection and disconnect', () => {
  test('bucket is NOT deleted on rate limit rejection', () => {
    const game = new Game();
    const wss = new MockWebSocketServer();
    const handlers = setupWebSocketHandlers(wss, game, {
      seatTimeout: 100,
      joinTimeoutMs: 0,
      rateLimitMax: 3,
      rateLimitWindow: 10_000,
    });

    const ws = wss.simulateConnection('10.0.0.1');
    // Fill the bucket
    for (let i = 0; i < 3; i++) {
      ws.emit(
        'message',
        JSON.stringify({
          type: 'move',
          fromFile: 0,
          fromRank: 0,
          toFile: 0,
          toRank: 0,
        })
      );
    }
    assert.strictEqual(ws.getSent('rateLimited').length, 0);

    // 4th message triggers rate limit
    ws.emit(
      'message',
      JSON.stringify({
        type: 'move',
        fromFile: 0,
        fromRank: 0,
        toFile: 0,
        toRank: 0,
      })
    );
    assert.strictEqual(ws.getSent('rateLimited').length, 1);

    // Bucket should STILL exist — not deleted on rejection
    const bucket = handlers.rateLimitBuckets.get('10.0.0.1');
    assert.ok(bucket, 'Bucket should persist after rate limit rejection');
    assert.strictEqual(bucket.length, 3);

    // Next message should ALSO be rate limited
    ws.emit(
      'message',
      JSON.stringify({
        type: 'move',
        fromFile: 0,
        fromRank: 0,
        toFile: 0,
        toRank: 0,
      })
    );
    assert.strictEqual(ws.getSent('rateLimited').length, 2);
  });

  test('bucket persists after disconnect — reconnect from same IP stays limited', () => {
    const game = new Game();
    const wss = new MockWebSocketServer();
    const handlers = setupWebSocketHandlers(wss, game, {
      seatTimeout: 100,
      joinTimeoutMs: 0,
      rateLimitMax: 3,
      rateLimitWindow: 10_000,
    });

    const ws1 = wss.simulateConnection('10.0.0.1');
    // Fill the bucket
    for (let i = 0; i < 3; i++) {
      ws1.emit(
        'message',
        JSON.stringify({
          type: 'move',
          fromFile: 0,
          fromRank: 0,
          toFile: 0,
          toRank: 0,
        })
      );
    }
    assert.strictEqual(ws1.getSent('rateLimited').length, 0);

    // Disconnect — bucket should NOT be deleted
    wss.simulateDisconnect(ws1);
    const bucket = handlers.rateLimitBuckets.get('10.0.0.1');
    assert.ok(bucket, 'Bucket should persist after disconnect');
    assert.strictEqual(bucket.length, 3);

    // New connection from same IP — should still be rate limited
    const ws2 = wss.simulateConnection('10.0.0.1');
    ws2.emit(
      'message',
      JSON.stringify({
        type: 'move',
        fromFile: 0,
        fromRank: 0,
        toFile: 0,
        toRank: 0,
      })
    );
    assert.strictEqual(ws2.getSent('rateLimited').length, 1);
  });

  test('repeated close/reopen from same IP remains rate limited', () => {
    const game = new Game();
    const wss = new MockWebSocketServer();
    const handlers = setupWebSocketHandlers(wss, game, {
      seatTimeout: 100,
      joinTimeoutMs: 0,
      rateLimitMax: 3,
      rateLimitWindow: 10_000,
    });

    // First connection: fill bucket
    const ws1 = wss.simulateConnection('10.0.0.5');
    for (let i = 0; i < 3; i++) {
      ws1.emit(
        'message',
        JSON.stringify({
          type: 'move',
          fromFile: 0,
          fromRank: 0,
          toFile: 0,
          toRank: 0,
        })
      );
    }
    wss.simulateDisconnect(ws1);

    // Second connection: should be rate limited
    const ws2 = wss.simulateConnection('10.0.0.5');
    ws2.emit(
      'message',
      JSON.stringify({
        type: 'move',
        fromFile: 0,
        fromRank: 0,
        toFile: 0,
        toRank: 0,
      })
    );
    assert.strictEqual(ws2.getSent('rateLimited').length, 1);
    wss.simulateDisconnect(ws2);

    // Third connection: still rate limited
    const ws3 = wss.simulateConnection('10.0.0.5');
    ws3.emit(
      'message',
      JSON.stringify({
        type: 'move',
        fromFile: 0,
        fromRank: 0,
        toFile: 0,
        toRank: 0,
      })
    );
    assert.strictEqual(ws3.getSent('rateLimited').length, 1);
  });

  test('rate limit lifts after window expires', async () => {
    const game = new Game();
    const wss = new MockWebSocketServer();
    const handlers = setupWebSocketHandlers(wss, game, {
      seatTimeout: 100,
      joinTimeoutMs: 0,
      rateLimitMax: 3,
      rateLimitWindow: 50, // 50ms window
    });

    const ws = wss.simulateConnection('10.0.0.1');
    // Fill the bucket
    for (let i = 0; i < 3; i++) {
      ws.emit(
        'message',
        JSON.stringify({
          type: 'move',
          fromFile: 0,
          fromRank: 0,
          toFile: 0,
          toRank: 0,
        })
      );
    }
    assert.strictEqual(ws.getSent('rateLimited').length, 0);

    // Should be rate limited
    ws.emit(
      'message',
      JSON.stringify({
        type: 'move',
        fromFile: 0,
        fromRank: 0,
        toFile: 0,
        toRank: 0,
      })
    );
    assert.strictEqual(ws.getSent('rateLimited').length, 1);

    // Wait for window to expire
    await new Promise((r) => setTimeout(r, 60));

    // Should be allowed again
    ws.emit(
      'message',
      JSON.stringify({
        type: 'move',
        fromFile: 0,
        fromRank: 0,
        toFile: 0,
        toRank: 0,
      })
    );
    assert.strictEqual(ws.getSent('rateLimited').length, 1); // still just the original
  });
});

describe('Rate limiter — existing behavior preserved', () => {
  test('messages within limit are accepted', () => {
    const game = new Game();
    const wss = new MockWebSocketServer();
    const handlers = setupWebSocketHandlers(wss, game, {
      seatTimeout: 100,
      joinTimeoutMs: 0,
    });

    const ws = wss.simulateConnection('10.0.0.1');
    ws.emit('message', JSON.stringify({ type: 'join', color: 'white' }));
    for (let i = 0; i < 3; i++) {
      ws.emit(
        'message',
        JSON.stringify({
          type: 'move',
          fromFile: 0,
          fromRank: 0,
          toFile: 0,
          toRank: 0,
        })
      );
    }
    assert.strictEqual(ws.getSent('rateLimited').length, 0);
  });

  test('messages exceeding limit are rejected with rateLimited', () => {
    const game = new Game();
    const wss = new MockWebSocketServer();
    const handlers = setupWebSocketHandlers(wss, game, {
      seatTimeout: 100,
      joinTimeoutMs: 0,
      rateLimitMax: 3,
      rateLimitWindow: 10_000,
    });

    const ws = wss.simulateConnection('10.0.0.1');
    for (let i = 0; i < 3; i++) {
      ws.emit(
        'message',
        JSON.stringify({
          type: 'move',
          fromFile: 0,
          fromRank: 0,
          toFile: 0,
          toRank: 0,
        })
      );
    }
    assert.strictEqual(ws.getSent('rateLimited').length, 0);
    // 4th should be rate limited
    ws.emit(
      'message',
      JSON.stringify({
        type: 'move',
        fromFile: 0,
        fromRank: 0,
        toFile: 0,
        toRank: 0,
      })
    );
    assert.strictEqual(ws.getSent('rateLimited').length, 1);
  });

  test('rate limited messages include retryAfter field', () => {
    const game = new Game();
    const wss = new MockWebSocketServer();
    const handlers = setupWebSocketHandlers(wss, game, {
      seatTimeout: 100,
      joinTimeoutMs: 0,
      rateLimitMax: 3,
      rateLimitWindow: 10_000,
    });

    const ws = wss.simulateConnection('10.0.0.1');
    for (let i = 0; i < 4; i++) {
      ws.emit(
        'message',
        JSON.stringify({
          type: 'move',
          fromFile: 0,
          fromRank: 0,
          toFile: 0,
          toRank: 0,
        })
      );
    }
    const rlMsg = ws.getSent('rateLimited')[0];
    assert.ok(typeof rlMsg.retryAfter === 'number');
    assert.ok(rlMsg.retryAfter >= 1);
  });
});

// ── Print results ─────────────────────────────────────────

async function printResults() {
  // Wait for any pending async tests
  await new Promise((r) => setTimeout(r, 3500));

  let lastLabel = null;
  for (const r of results) {
    if (r.label) {
      lastLabel = r.label;
      console.log(`\n${lastLabel}`);
    } else {
      const icon = r.ok ? '  ✓' : `  ✗ ${r.name}`;
      console.log(`${icon} ${r.name}`);
    }
  }

  console.log(`\n==================================================`);
  console.log(`Results: ${passed}/${total} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

printResults();
