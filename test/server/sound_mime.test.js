// ═══════════════════════════════════════════════════════════
//  SERVER — WAV MIME type serving tests
//  Run:  npm test
// ═══════════════════════════════════════════════════════════

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const { requestHandler, MIME, CLIENT_ROOT } = require('../../server.js');

// ── Test runner (matches repo convention) ─────────────────
let passed = 0;
let failed = 0;
const pendingPromises = [];
const results = [];

function test(name, fn) {
  const idx = results.length;
  results.push({ name, ok: null, err: null });
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

// ── Tests ─────────────────────────────────────────────────

describe('server WAV MIME support', () => {
  test('MIME map includes .wav entry', () => {
    assert.strictEqual(MIME['.wav'], 'audio/wav');
  });

  test('pickup.wav file exists and is non-empty', () => {
    const wavPath = path.join(CLIENT_ROOT, 'files', 'pickup.wav');
    assert.ok(fs.existsSync(wavPath), 'pickup.wav should exist');
    const stat = fs.statSync(wavPath);
    assert.ok(stat.size > 0, 'pickup.wav should be non-empty');
  });

  test('requestHandler serves pickup.wav with 200 and audio/wav', () => {
    return new Promise((resolve, reject) => {
      const srv = http.createServer(requestHandler);
      srv.listen(0, () => {
        const port = srv.address().port;
        http
          .get(`http://localhost:${port}/client/files/pickup.wav`, (res) => {
            let data = '';
            res.on('data', (chunk) => {
              data += chunk;
            });
            res.on('end', () => {
              try {
                assert.strictEqual(res.statusCode, 200);
                assert.strictEqual(res.headers['content-type'], 'audio/wav');
                assert.ok(data.length > 0, 'response body should be non-empty');
                srv.close(resolve);
              } catch (e) {
                srv.close();
                reject(e);
              }
            });
          })
          .on('error', (e) => {
            srv.close();
            reject(e);
          });
      });
    });
  });
});

// ── Wait for async tests then print results ───────────────
async function main() {
  await Promise.all(pendingPromises);
  for (const r of results) {
    if (r.label) {
      console.log(`\n${r.label}`);
    } else if (r.name) {
      const icon = r.ok ? '✓' : '✗';
      console.log(`  ${icon} ${r.name}${r.err ? ` — ${r.err}` : ''}`);
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}
main();
