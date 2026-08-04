// ═══════════════════════════════════════════════════════════
//  TEST SUITE — security hardening (maxPayload, IP rate limit)
//  Run:  node test/server/security.test.js
// ═══════════════════════════════════════════════════════════

const assert = require('assert');
const http = require('http');
const { WebSocketServer } = require('ws');
const WebSocket = require('ws');
const { createRateLimiter } = require('../../server/rate-limiter');

const { Game } = require('../../shared/chess.mjs');
const { setupWebSocketHandlers, buildWssOptions } = require('../../server');

const { createMockWebSocketServer } = require('./test-helpers');

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
    const wss = createMockWebSocketServer({ trackClose: true });
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
    const wss = createMockWebSocketServer({ trackClose: true });
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
    const wss = createMockWebSocketServer({ trackClose: true });
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
    const wss = createMockWebSocketServer({ trackClose: true });
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
    const wss = createMockWebSocketServer({ trackClose: true });
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
    const wss = createMockWebSocketServer({ trackClose: true });
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
    const wss = createMockWebSocketServer({ trackClose: true });
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

  test('shared connection bucket map is used by defense-in-depth check', () => {
    const game = new Game();
    const wss = createMockWebSocketServer({ trackClose: true });

    // Pre-populate the shared bucket map with 5 entries (at the limit)
    const sharedBuckets = new Map();
    const now = Date.now();
    sharedBuckets.set('10.0.0.99', [now, now, now, now, now]);

    const handlers = setupWebSocketHandlers(wss, game, {
      seatTimeout: 100,
      joinTimeoutMs: 0,
      connectionBuckets: sharedBuckets,
      connectionRateLimitMax: 5,
      connectionRateLimitWindow: 10_000,
    });

    // Simulate a connection without req._admitted (defense-in-depth path)
    const ws = wss.simulateConnection('10.0.0.99');
    // The defense-in-depth checkConnectionRateLimit should reject because
    // the shared bucket already has 5 entries
    const result = handlers.checkConnectionRateLimit(ws, {});
    assert.strictEqual(result.allowed, false, 'Should be rejected by shared bucket state');
    assert.ok(result.retryAfter > 0, 'Should include retryAfter');

    // Verify the shared map was updated (new entry pushed before rejection)
    const bucket = sharedBuckets.get('10.0.0.99');
    assert.strictEqual(
      bucket.length,
      5,
      'Bucket should still have 5 entries (not pushed on rejection)'
    );
  });
});

describe('Rate limiter — existing behavior preserved', () => {
  test('messages within limit are accepted', () => {
    const game = new Game();
    const wss = createMockWebSocketServer({ trackClose: true });
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
    const wss = createMockWebSocketServer({ trackClose: true });
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
    const wss = createMockWebSocketServer({ trackClose: true });
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

describe('joinTimeout cleared on close', () => {
  test('joinTimeout is cleared when connection closes', () => {
    const game = new Game();
    const wss = createMockWebSocketServer({ trackClose: true });
    setupWebSocketHandlers(wss, game, {
      seatTimeout: 100,
      joinTimeoutMs: 5000,
    });

    const ws = wss.simulateConnection('127.0.0.1');

    // The join timeout should have been set
    assert.ok(ws._joinTimeout, 'joinTimeout should be set on connection');

    // Track if clearTimeout was called with the joinTimeout
    const originalClearTimeout = global.clearTimeout;
    let clearedTimeout = null;
    global.clearTimeout = (id) => {
      clearedTimeout = id;
      return originalClearTimeout(id);
    };

    // Simulate disconnect
    wss.simulateDisconnect(ws);

    // The joinTimeout should have been cleared
    assert.strictEqual(clearedTimeout, ws._joinTimeout, 'joinTimeout should be cleared on close');

    global.clearTimeout = originalClearTimeout;
  });
});

// ═══════════════════════════════════════════════════════════
//  TESTS — connection rate limiting
// ═══════════════════════════════════════════════════════════

describe('Connection rate limiter', () => {
  test('allows connections under the limit', () => {
    const game = new Game();
    const wss = createMockWebSocketServer({ trackClose: true });
    const connectionBuckets = new Map();
    setupWebSocketHandlers(wss, game, {
      seatTimeout: 100,
      joinTimeoutMs: 0,
      connectionBuckets,
      connectionRateLimitMax: 5,
      connectionRateLimitWindow: 10_000,
    });

    // 3 connections from the same IP should all succeed
    for (let i = 0; i < 3; i++) {
      const ws = wss.simulateConnection('192.168.1.1');
      assert.strictEqual(
        ws.getSent('rateLimited').length,
        0,
        `Connection ${i + 1} should be allowed`
      );
    }
  });

  test('rejects connections after the limit via defense-in-depth check', () => {
    const game = new Game();
    const wss = createMockWebSocketServer({ trackClose: true });
    const connectionBuckets = new Map();
    setupWebSocketHandlers(wss, game, {
      seatTimeout: 100,
      joinTimeoutMs: 0,
      connectionBuckets,
      connectionRateLimitMax: 3,
      connectionRateLimitWindow: 10_000,
    });

    // 3 connections should succeed
    for (let i = 0; i < 3; i++) {
      wss.simulateConnection('10.0.0.1');
    }

    // 4th connection should be rate limited (defense-in-depth)
    const ws4 = wss.simulateConnection('10.0.0.1');
    assert.strictEqual(
      ws4.getSent('rateLimited').length,
      1,
      '4th connection should be rate limited'
    );
    assert.strictEqual(ws4._closeCode, 1008, 'Should be closed with code 1008');
  });

  test('retryAfter is included in rate limit response', () => {
    const game = new Game();
    const wss = createMockWebSocketServer({ trackClose: true });
    const connectionBuckets = new Map();
    setupWebSocketHandlers(wss, game, {
      seatTimeout: 100,
      joinTimeoutMs: 0,
      connectionBuckets,
      connectionRateLimitMax: 2,
      connectionRateLimitWindow: 10_000,
    });

    wss.simulateConnection('10.0.0.2');
    wss.simulateConnection('10.0.0.2');
    const ws3 = wss.simulateConnection('10.0.0.2');

    const rlMsg = ws3.getSent('rateLimited')[0];
    assert.ok(rlMsg, 'Should have received rateLimited message');
    assert.ok(
      typeof rlMsg.retryAfter === 'number' && rlMsg.retryAfter >= 1,
      'retryAfter should be >= 1'
    );
  });

  test('per-IP isolation: different IPs have independent limits', () => {
    const game = new Game();
    const wss = createMockWebSocketServer({ trackClose: true });
    const connectionBuckets = new Map();
    setupWebSocketHandlers(wss, game, {
      seatTimeout: 100,
      joinTimeoutMs: 0,
      connectionBuckets,
      connectionRateLimitMax: 2,
      connectionRateLimitWindow: 10_000,
    });

    // Fill up IP1's limit
    wss.simulateConnection('10.0.0.1');
    wss.simulateConnection('10.0.0.1');

    // IP2 should still be allowed
    const ws2 = wss.simulateConnection('10.0.0.2');
    assert.strictEqual(
      ws2.getSent('rateLimited').length,
      0,
      'Different IP should not be rate limited'
    );
  });

  test('window expiry: connections allowed after window passes', async () => {
    const game = new Game();
    const wss = createMockWebSocketServer({ trackClose: true });
    const connectionBuckets = new Map();
    setupWebSocketHandlers(wss, game, {
      seatTimeout: 100,
      joinTimeoutMs: 0,
      connectionBuckets,
      connectionRateLimitMax: 2,
      connectionRateLimitWindow: 200, // 200ms window for fast test
    });

    wss.simulateConnection('10.0.0.3');
    wss.simulateConnection('10.0.0.3');

    // Should be rate limited
    const ws3 = wss.simulateConnection('10.0.0.3');
    assert.strictEqual(
      ws3.getSent('rateLimited').length,
      1,
      'Should be rate limited before window expiry'
    );

    // Wait for window to expire
    await new Promise((r) => setTimeout(r, 250));

    const ws4 = wss.simulateConnection('10.0.0.3');
    assert.strictEqual(
      ws4.getSent('rateLimited').length,
      0,
      'Should be allowed after window expiry'
    );
  });

  test('configuration wiring: custom max and window are respected', () => {
    const game = new Game();
    const wss = createMockWebSocketServer({ trackClose: true });
    const connectionBuckets = new Map();
    setupWebSocketHandlers(wss, game, {
      seatTimeout: 100,
      joinTimeoutMs: 0,
      connectionBuckets,
      connectionRateLimitMax: 1,
      connectionRateLimitWindow: 10_000,
    });

    wss.simulateConnection('10.0.0.4');
    const ws2 = wss.simulateConnection('10.0.0.4');
    assert.strictEqual(ws2.getSent('rateLimited').length, 1, 'Should be rate limited with max=1');
  });

  test('stale bucket cleanup: production sweep deletes empty buckets', async () => {
    const limiter = createRateLimiter(5, 100); // 100ms window

    // Simulate a connection
    limiter.check('10.0.0.5');
    assert.ok(limiter.buckets.has('10.0.0.5'), 'Bucket should exist after check');

    // Wait for window to expire
    await new Promise((r) => setTimeout(r, 150));

    // Run the production sweep
    limiter.sweep();

    assert.ok(
      !limiter.buckets.has('10.0.0.5'),
      'Bucket should be deleted after production sweep when all entries expired'
    );
  });

  test('integrated: real server admits 5 connections, rejects 6th at upgrade', async () => {
    const { buildWssOptions } = require('../../server');
    const game = new Game();

    // Use the production limiter
    const limiter = createRateLimiter(5, 10_000);

    // Create a real HTTP server and WebSocketServer
    const server = http.createServer();
    const wss = new WebSocketServer({
      server,
      ...buildWssOptions(server, [], limiter.check),
    });

    setupWebSocketHandlers(wss, game, {
      seatTimeout: 100,
      joinTimeoutMs: 0,
      connectionBuckets: limiter.buckets,
      connectionRateLimitMax: 5,
      connectionRateLimitWindow: 10_000,
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    try {
      // Open 5 connections — all should succeed
      const connections = [];
      for (let i = 0; i < 5; i++) {
        const ws = new WebSocket(`ws://127.0.0.1:${port}`);
        await new Promise((resolve, reject) => {
          ws.on('open', resolve);
          ws.on('error', reject);
        });
        connections.push(ws);
      }

      // Bucket should have exactly 5 entries (one per connection)
      const bucket = limiter.buckets.get('127.0.0.1');
      assert.strictEqual(bucket.length, 5, 'Should have exactly 5 entries, not double-counted');

      // 6th connection should be rejected at upgrade (429)
      await assert.rejects(
        new Promise((resolve, reject) => {
          const ws = new WebSocket(`ws://127.0.0.1:${port}`);
          ws.on('open', () => reject(new Error('should not have connected')));
          ws.on('error', reject);
        }),
        /ECONNRESET|429|WebSocket was closed/,
        '6th connection should be rejected at upgrade'
      );

      // Clean up
      for (const ws of connections) ws.close();
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('buildWssOptions with connectionCheckFn rejects at upgrade', () => {
    const { buildWssOptions } = require('../../server');
    const mockServer = { on: () => {} };

    let checkCallCount = 0;
    const checkFn = () => {
      checkCallCount++;
      return { allowed: false };
    };

    const opts = buildWssOptions(mockServer, [], checkFn);
    assert.ok(opts.verifyClient, 'verifyClient should be set when connectionCheckFn is provided');

    // Simulate verifyClient call
    let verifyResult = null;
    const mockInfo = { req: { socket: { remoteAddress: '1.2.3.4' }, headers: {} } };
    opts.verifyClient(mockInfo, (ok, code) => {
      verifyResult = { ok, code };
    });

    assert.strictEqual(checkCallCount, 1, 'checkFn should have been called');
    assert.strictEqual(verifyResult.ok, false, 'Connection should be rejected');
    assert.strictEqual(verifyResult.code, 429, 'Should return 429 status');
  });

  test('buildWssOptions allows connection when under limit', () => {
    const { buildWssOptions } = require('../../server');
    const mockServer = { on: () => {} };

    const checkFn = () => ({ allowed: true });
    const opts = buildWssOptions(mockServer, [], checkFn);

    let verifyResult = null;
    const mockInfo = { req: { socket: { remoteAddress: '1.2.3.4' }, headers: {} } };
    opts.verifyClient(mockInfo, (ok, code) => {
      verifyResult = { ok, code };
    });

    assert.strictEqual(verifyResult.ok, true, 'Connection should be allowed');
  });

  test('empty allowlist with connectionCheckFn accepts browser Origin header', () => {
    const { buildWssOptions } = require('../../server');
    const mockServer = { on: () => {} };

    const checkFn = () => ({ allowed: true });
    const opts = buildWssOptions(mockServer, [], checkFn);
    assert.ok(opts.verifyClient, 'verifyClient should be set when connectionCheckFn is provided');

    let verifyResult = null;
    const mockInfo = {
      req: {
        socket: { remoteAddress: '1.2.3.4' },
        headers: { origin: 'https://chess.example.com' },
      },
    };
    opts.verifyClient(mockInfo, (ok, code) => {
      verifyResult = { ok, code };
    });

    assert.strictEqual(verifyResult.ok, true, 'Empty allowlist should accept browser Origin');
  });

  test('wildcard allowlist accepts any browser Origin header', () => {
    const { buildWssOptions } = require('../../server');
    const mockServer = { on: () => {} };

    const checkFn = () => ({ allowed: true });
    const opts = buildWssOptions(mockServer, ['*'], checkFn);
    assert.ok(opts.verifyClient);

    let verifyResult = null;
    const mockInfo = {
      req: {
        socket: { remoteAddress: '1.2.3.4' },
        headers: { origin: 'https://evil.example.com' },
      },
    };
    opts.verifyClient(mockInfo, (ok, code) => {
      verifyResult = { ok, code };
    });

    assert.strictEqual(verifyResult.ok, true, 'Wildcard should accept any origin');
  });

  test('wildcard allowlist accepts opaque origin "null"', () => {
    const { buildWssOptions } = require('../../server');
    const mockServer = { on: () => {} };

    const checkFn = () => ({ allowed: true });
    const opts = buildWssOptions(mockServer, ['*'], checkFn);

    let verifyResult = null;
    const mockInfo = {
      req: {
        socket: { remoteAddress: '1.2.3.4' },
        headers: { origin: 'null' },
      },
    };
    opts.verifyClient(mockInfo, (ok, code) => {
      verifyResult = { ok, code };
    });

    assert.strictEqual(verifyResult.ok, true, 'Wildcard should accept opaque origin "null"');
  });

  test('restrictive allowlist rejects non-matching Origin', () => {
    const { buildWssOptions } = require('../../server');
    const mockServer = { on: () => {} };

    const checkFn = () => ({ allowed: true });
    const opts = buildWssOptions(mockServer, ['chess.example.com'], checkFn);
    assert.ok(opts.verifyClient);

    let verifyResult = null;
    const mockInfo = {
      req: {
        socket: { remoteAddress: '1.2.3.4' },
        headers: { origin: 'https://evil.example.com' },
      },
    };
    opts.verifyClient(mockInfo, (ok, code) => {
      verifyResult = { ok, code };
    });

    assert.strictEqual(verifyResult.ok, false, 'Non-matching origin should be rejected');
    assert.strictEqual(verifyResult.code, 403, 'Should return 403');
  });

  test('restrictive allowlist accepts matching Origin', () => {
    const { buildWssOptions } = require('../../server');
    const mockServer = { on: () => {} };

    const checkFn = () => ({ allowed: true });
    const opts = buildWssOptions(mockServer, ['chess.example.com'], checkFn);

    let verifyResult = null;
    const mockInfo = {
      req: {
        socket: { remoteAddress: '1.2.3.4' },
        headers: { origin: 'https://chess.example.com' },
      },
    };
    opts.verifyClient(mockInfo, (ok, code) => {
      verifyResult = { ok, code };
    });

    assert.strictEqual(verifyResult.ok, true, 'Matching origin should be accepted');
    assert.strictEqual(verifyResult.code, 200, 'Should return 200');
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
