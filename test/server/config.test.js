// ═══════════════════════════════════════════════════════════
//  TEST SUITE — config loading (loadConfig.js)
//  Run:  node test/server/config.test.js
// ═══════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  loadConfig, defaultConfigPath, DEFAULTS, ENV_MAP, CLI_FLAG_MAP,
  convertType, loadFromEnv, loadFromCli, mergeLayers, stripComments,
} = require('../../loadConfig');

// ── Minimal test runner ──────────────────────────────────
let passed = 0;
let failed = 0;
let total = 0;

function test(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
  }
}

function describe(label, fn) {
  console.log(`\n${label}`);
  fn();
}

// ── Helpers ──────────────────────────────────────────────
function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mpchess-config-test-'));
}

function writeConfig(dir, content) {
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(content));
}

// ── Tests ────────────────────────────────────────────────

describe('convertType', () => {
  test('port: string to number', () => {
    assert.strictEqual(convertType('port', '8080'), 8080);
  });

  test('port: invalid string returns undefined', () => {
    assert.strictEqual(convertType('port', 'abc'), undefined);
  });

  test('port: empty string returns undefined', () => {
    assert.strictEqual(convertType('port', ''), undefined);
  });

  test('allowedOrigins: string to array', () => {
    const result = convertType('allowedOrigins', 'localhost,games.devop.ninja');
    assert.deepStrictEqual(result, ['localhost', 'games.devop.ninja']);
  });

  test('allowedOrigins: array passthrough', () => {
    const result = convertType('allowedOrigins', ['localhost']);
    assert.deepStrictEqual(result, ['localhost']);
  });

  test('allowedOrigins: empty string returns undefined', () => {
    assert.strictEqual(convertType('allowedOrigins', ''), undefined);
  });

  test('allowedOrigins: whitespace trimmed', () => {
    const result = convertType('allowedOrigins', ' localhost , games.devop.ninja ');
    assert.deepStrictEqual(result, ['localhost', 'games.devop.ninja']);
  });

  test('string key: passthrough', () => {
    assert.strictEqual(convertType('cert', '/path/to/cert'), '/path/to/cert');
  });

  test('undefined value returns undefined', () => {
    assert.strictEqual(convertType('port', undefined), undefined);
  });
});

describe('loadFromCli', () => {
  test('parses --port=', () => {
    const result = loadFromCli(['--port=8080']);
    assert.strictEqual(result.port, 8080);
  });

  test('parses --fen=', () => {
    const result = loadFromCli(['--fen=rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1']);
    assert.ok(result.fen.includes('rnbqkbnr'));
  });

  test('parses --cert=', () => {
    const result = loadFromCli(['--cert=/path/to/cert.pem']);
    assert.strictEqual(result.cert, '/path/to/cert.pem');
  });

  test('ignores unknown flags', () => {
    const result = loadFromCli(['--unknown=value', '--help']);
    assert.deepStrictEqual(result, {});
  });

  test('ignores --config=', () => {
    const result = loadFromCli(['--config=custom.json']);
    assert.deepStrictEqual(result, {});
  });

  test('parses --allowed-origins= (kebab-case)', () => {
    const result = loadFromCli(['--allowed-origins=localhost,example.com']);
    assert.deepStrictEqual(result.allowedOrigins, ['localhost', 'example.com']);
  });

  test('parses multiple flags', () => {
    const result = loadFromCli(['--port=9000', '--cert=/tmp/cert.pem']);
    assert.strictEqual(result.port, 9000);
    assert.strictEqual(result.cert, '/tmp/cert.pem');
  });
});

describe('loadFromEnv', () => {
  const origEnv = { ...process.env };

  test('reads MPCHESS_PORT', () => {
    process.env.MPCHESS_PORT = '9999';
    const result = loadFromEnv();
    assert.strictEqual(result.port, 9999);
    process.env.MPCHESS_PORT = origEnv.MPCHESS_PORT;
  });

  test('reads MPCHESS_ALLOWED_ORIGINS', () => {
    process.env.MPCHESS_ALLOWED_ORIGINS = 'localhost,example.com';
    const result = loadFromEnv();
    assert.deepStrictEqual(result.allowedOrigins, ['localhost', 'example.com']);
    delete process.env.MPCHESS_ALLOWED_ORIGINS;
  });

  test('reads MPCHESS_FEN', () => {
    process.env.MPCHESS_FEN = '4k3/8/8/8/8/8/8/4K2R w K - 0 1';
    const result = loadFromEnv();
    assert.strictEqual(result.fen, '4k3/8/8/8/8/8/8/4K2R w K - 0 1');
    delete process.env.MPCHESS_FEN;
  });

  test('ignores non-MPCHESS vars', () => {
    delete process.env.MPCHESS_PORT;
    delete process.env.MPCHESS_FEN;
    delete process.env.MPCHESS_CERT;
    delete process.env.MPCHESS_KEY;
    delete process.env.MPCHESS_CHAIN;
    delete process.env.MPCHESS_ALLOWED_ORIGINS;
    const result = loadFromEnv();
    assert.deepStrictEqual(result, {});
  });
});

describe('mergeLayers', () => {
  test('defaults only', () => {
    const result = mergeLayers([{ port: 3000 }]);
    assert.strictEqual(result.port, 3000);
  });

  test('later layer overrides earlier', () => {
    const result = mergeLayers([
      { port: 3000 },
      { port: 8080 },
    ]);
    assert.strictEqual(result.port, 8080);
  });

  test('undefined values do not override', () => {
    const result = mergeLayers([
      { port: 3000, cert: '/default/cert' },
      { port: undefined, cert: '/cli/cert' },
    ]);
    assert.strictEqual(result.port, 3000);
    assert.strictEqual(result.cert, '/cli/cert');
  });

  test('null layer is skipped', () => {
    const result = mergeLayers([
      { port: 3000 },
      null,
      { port: 8080 },
    ]);
    assert.strictEqual(result.port, 8080);
  });
});

describe('loadConfig — full integration', () => {
  const origArgv = process.argv;
  const origEnv = { ...process.env };
  const origCwd = process.cwd();

  function inTempDir(fn) {
    const tmpDir = makeTempDir();
    const prevCwd = process.cwd();
    try {
      process.chdir(tmpDir);
      fn(tmpDir);
    } finally {
      process.chdir(prevCwd);
      fs.rmSync(tmpDir, { recursive: true });
    }
  }

  function cleanupEnv() {
    process.argv = origArgv;
    for (const key of Object.keys(origEnv)) {
      process.env[key] = origEnv[key];
    }
    for (const key of Object.keys(process.env)) {
      if (!(key in origEnv)) delete process.env[key];
    }
  }

  test('defaults when no config file, no env, no CLI', () => {
    inTempDir((tmpDir) => {
      process.argv = ['node', 'server.js'];
      const config = loadConfig();
      assert.strictEqual(config.port, 3000);
      assert.deepStrictEqual(config.allowedOrigins, []);
      assert.strictEqual(config.fen, undefined);
    });
    cleanupEnv();
  });

  test('config file values used when no CLI or env', () => {
    inTempDir((tmpDir) => {
      writeConfig(tmpDir, { port: 7777, allowedOrigins: ['myserver.com'] });
      process.argv = ['node', 'server.js'];
      const config = loadConfig();
      assert.strictEqual(config.port, 7777);
      assert.deepStrictEqual(config.allowedOrigins, ['myserver.com']);
    });
    cleanupEnv();
  });

  test('CLI overrides config file', () => {
    inTempDir((tmpDir) => {
      writeConfig(tmpDir, { port: 7777 });
      process.argv = ['node', 'server.js', '--port=9999'];
      const config = loadConfig();
      assert.strictEqual(config.port, 9999);
    });
    cleanupEnv();
  });

  test('env var overrides config file', () => {
    inTempDir((tmpDir) => {
      writeConfig(tmpDir, { port: 7777 });
      process.argv = ['node', 'server.js'];
      process.env.MPCHESS_PORT = '8888';
      const config = loadConfig();
      assert.strictEqual(config.port, 8888, 'env var wins over config file');
    });
    cleanupEnv();
    delete process.env.MPCHESS_PORT;
  });

  test('CLI overrides env var', () => {
    inTempDir((tmpDir) => {
      process.argv = ['node', 'server.js', '--port=9999'];
      process.env.MPCHESS_PORT = '8888';
      const config = loadConfig();
      assert.strictEqual(config.port, 9999);
    });
    cleanupEnv();
    delete process.env.MPCHESS_PORT;
  });

  test('full priority: CLI > env > config file > defaults', () => {
    inTempDir((tmpDir) => {
      writeConfig(tmpDir, { port: 1111, fen: 'file-fen', cert: 'file-cert' });
      process.argv = ['node', 'server.js', '--port=9999'];
      process.env.MPCHESS_FEN = 'env-fen';
      const config = loadConfig();
      assert.strictEqual(config.port, 9999, 'CLI wins for port');
      assert.strictEqual(config.fen, 'env-fen', 'env wins for fen (no CLI)');
      assert.strictEqual(config.cert, 'file-cert', 'config file wins for cert (no CLI/env)');
    });
    cleanupEnv();
    delete process.env.MPCHESS_FEN;
  });

  test('--config= overrides default config path', () => {
    const tmpDir = makeTempDir();
    const prevCwd = process.cwd();
    try {
      fs.writeFileSync(path.join(tmpDir, 'custom.json'), JSON.stringify({ port: 5555 }));
      writeConfig(tmpDir, { port: 7777 });
      process.argv = ['node', 'server.js', `--config=${path.join(tmpDir, 'custom.json')}`];
      const config = loadConfig();
      assert.strictEqual(config.port, 5555, 'should use custom config file');
    } finally {
      process.chdir(prevCwd);
      fs.rmSync(tmpDir, { recursive: true });
    }
    cleanupEnv();
  });

  test('missing config file is not an error', () => {
    inTempDir((tmpDir) => {
      process.argv = ['node', 'server.js'];
      const config = loadConfig();
      assert.strictEqual(config.port, 3000, 'should use default port');
    });
    cleanupEnv();
  });

  test('invalid JSON in config file throws', () => {
    inTempDir((tmpDir) => {
      fs.writeFileSync(path.join(tmpDir, 'config.json'), '{ invalid json }');
      process.argv = ['node', 'server.js'];
      assert.throws(() => loadConfig(), /Failed to parse config file/);
    });
    cleanupEnv();
  });

  test('allowedOrigins from config file as array', () => {
    inTempDir((tmpDir) => {
      writeConfig(tmpDir, { allowedOrigins: ['localhost', 'games.devop.ninja'] });
      process.argv = ['node', 'server.js'];
      const config = loadConfig();
      assert.deepStrictEqual(config.allowedOrigins, ['localhost', 'games.devop.ninja']);
    });
    cleanupEnv();
  });

  test('allowedOrigins from config file as string', () => {
    inTempDir((tmpDir) => {
      writeConfig(tmpDir, { allowedOrigins: 'localhost,games.devop.ninja' });
      process.argv = ['node', 'server.js'];
      const config = loadConfig();
      assert.deepStrictEqual(config.allowedOrigins, ['localhost', 'games.devop.ninja']);
    });
    cleanupEnv();
  });

  test('null values in config file are treated as unset', () => {
    inTempDir((tmpDir) => {
      writeConfig(tmpDir, { port: null, fen: null });
      process.argv = ['node', 'server.js'];
      const config = loadConfig();
      assert.strictEqual(config.port, 3000, 'null port falls back to default');
      assert.strictEqual(config.fen, undefined, 'null fen falls back to default');
    });
    cleanupEnv();
  });
});

describe('stripComments', () => {
  test('removes trailing // comments', () => {
    const result = stripComments('{"port": 3000} // this is a comment');
    assert.strictEqual(result, '{"port": 3000} ');
  });

  test('removes // comments on their own line', () => {
    const result = stripComments('{\n// comment\n  "port": 3000\n}');
    assert.ok(!result.includes('//'));
    assert.ok(result.includes('"port"'));
  });

  test('removes /* */ block comments', () => {
    const result = stripComments('{"port": 3000} /* block comment */');
    assert.strictEqual(result, '{"port": 3000} ');
  });

  test('removes multi-line /* */ block comments', () => {
    const result = stripComments('{"port": 3000} /* line1\nline2 */');
    assert.strictEqual(result, '{"port": 3000} ');
  });

  test('preserves // inside strings (URLs)', () => {
    const input = '{"url": "https://example.com"}';
    const result = stripComments(input);
    assert.strictEqual(result, input);
  });

  test('preserves content inside strings', () => {
    const input = '{"msg": "hello // not a comment"}';
    const result = stripComments(input);
    assert.strictEqual(result, input);
  });

  test('handles escaped quotes in strings', () => {
    const input = '{"msg": "say \\"hi\\" // not a comment"}';
    const result = stripComments(input);
    // The // is inside the string value, so it must be preserved
    assert.strictEqual(result, input);
  });

  test('handles multiple comments', () => {
    const input = '// header\n{"port": 3000} // inline\n/* block */';
    const result = stripComments(input);
    assert.ok(!result.includes('//'));
    assert.ok(!result.includes('/*'));
    assert.ok(result.includes('"port"'));
  });
});

describe('config file with comments (integration)', () => {
  test('parses config file with trailing comments', () => {
    const tmpDir = makeTempDir();
    const prevCwd = process.cwd();
    try {
      fs.writeFileSync(path.join(tmpDir, 'config.json'), `
{
  "port": 9999
}
// This is a comment
// Another comment
`);
      process.argv = ['node', 'server.js'];
      process.chdir(tmpDir);
      const config = loadConfig();
      assert.strictEqual(config.port, 9999);
    } finally {
      process.chdir(prevCwd);
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('parses config file with inline comments', () => {
    const tmpDir = makeTempDir();
    const prevCwd = process.cwd();
    try {
      fs.writeFileSync(path.join(tmpDir, 'config.json'), `
{
  "port": 7777,  // port number
  "allowedOrigins": ["localhost"] // origins
}
`);
      process.argv = ['node', 'server.js'];
      process.chdir(tmpDir);
      const config = loadConfig();
      assert.strictEqual(config.port, 7777);
      assert.deepStrictEqual(config.allowedOrigins, ['localhost']);
    } finally {
      process.chdir(prevCwd);
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('parses config file with block comments', () => {
    const tmpDir = makeTempDir();
    const prevCwd = process.cwd();
    try {
      fs.writeFileSync(path.join(tmpDir, 'config.json'), `
/* Server config */
{
  "port": 5555
}
`);
      process.argv = ['node', 'server.js'];
      process.chdir(tmpDir);
      const config = loadConfig();
      assert.strictEqual(config.port, 5555);
    } finally {
      process.chdir(prevCwd);
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('config.example.json can be copied and used as-is', () => {
    const tmpDir = makeTempDir();
    const prevCwd = process.cwd();
    try {
      const exampleContent = fs.readFileSync(path.join(__dirname, '../../config.example.json'), 'utf8');
      fs.writeFileSync(path.join(tmpDir, 'config.json'), exampleContent);
      process.argv = ['node', 'server.js'];
      process.chdir(tmpDir);
      const config = loadConfig();
      assert.strictEqual(config.port, 3000, 'should parse the example config without errors');
    } finally {
      process.chdir(prevCwd);
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});

describe('Constants', () => {
  test('defaultConfigPath ends with config.json', () => {
    assert.ok(defaultConfigPath().endsWith('config.json'));
  });

  test('ENV_MAP has entries for all CLI_FLAG_MAP keys', () => {
    for (const [, key] of CLI_FLAG_MAP) {
      assert.ok(key in ENV_MAP, `ENV_MAP should have entry for ${key}`);
    }
  });

  test('DEFAULTS has all expected keys', () => {
    assert.ok('port' in DEFAULTS);
    assert.ok('fen' in DEFAULTS);
    assert.ok('cert' in DEFAULTS);
    assert.ok('key' in DEFAULTS);
    assert.ok('chain' in DEFAULTS);
    assert.ok('allowedOrigins' in DEFAULTS);
  });
});

// ── Summary ──────────────────────────────────────────────
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed}/${total} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
