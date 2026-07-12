// ═══════════════════════════════════════════════════════════
//  TEST SUITE — config loading (loadConfig.js)
//  Run:  node test/server/config.test.js
// ═══════════════════════════════════════════════════════════

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  loadConfig,
  defaultConfigPath,
  DEFAULTS,
  ENV_MAP,
  CLI_FLAG_MAP,
  convertType,
  loadFromEnv,
  loadFromCli,
  mergeLayers,
  stripComments,
  finalizeComputerPlayer,
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
  fs.writeFileSync(path.join(dir, 'config.jsonc'), JSON.stringify(content));
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
    const result = mergeLayers([{ port: 3000 }, { port: 8080 }]);
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
    const result = mergeLayers([{ port: 3000 }, null, { port: 8080 }]);
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
      fs.writeFileSync(path.join(tmpDir, 'config.jsonc'), '{ invalid json }');
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

  test('removes trailing commas before }', () => {
    const result = stripComments('{"port": 3000,}');
    assert.strictEqual(result, '{"port": 3000}');
  });

  test('removes trailing commas before ]', () => {
    const result = stripComments('{"arr": [1, 2,]}');
    assert.strictEqual(result, '{"arr": [1, 2]}');
  });

  test('removes trailing commas with whitespace', () => {
    const result = stripComments('{"port": 3000, \n}');
    assert.strictEqual(result, '{"port": 3000}');
  });

  test('preserves ",}" inside string literals', () => {
    const input = '{"x": ",}"}';
    const result = stripComments(input);
    assert.strictEqual(result, input, 'string containing ",}" must not be corrupted');
  });

  test('preserves ",]" inside string literals', () => {
    const input = '{"x": ",]"}';
    const result = stripComments(input);
    assert.strictEqual(result, input, 'string containing ",]" must not be corrupted');
  });

  test('preserves comma-bracket patterns in strings while removing real trailing commas', () => {
    const input = '{"x": ",}", "y": 1,}';
    const result = stripComments(input);
    assert.strictEqual(
      result,
      '{"x": ",}", "y": 1}',
      'trailing comma removed but string preserved'
    );
  });
});

describe('config file with comments (integration)', () => {
  test('parses config file with trailing comments', () => {
    const tmpDir = makeTempDir();
    const prevCwd = process.cwd();
    try {
      fs.writeFileSync(
        path.join(tmpDir, 'config.jsonc'),
        `
{
  "port": 9999
}
// This is a comment
// Another comment
`
      );
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
      fs.writeFileSync(
        path.join(tmpDir, 'config.jsonc'),
        `
{
  "port": 7777,  // port number
  "allowedOrigins": ["localhost"] // origins
}
`
      );
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
      fs.writeFileSync(
        path.join(tmpDir, 'config.jsonc'),
        `
/* Server config */
{
  "port": 5555
}
`
      );
      process.argv = ['node', 'server.js'];
      process.chdir(tmpDir);
      const config = loadConfig();
      assert.strictEqual(config.port, 5555);
    } finally {
      process.chdir(prevCwd);
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('backwards compatible: config.json is loaded when config.jsonc absent', () => {
    const tmpDir = makeTempDir();
    const prevCwd = process.cwd();
    try {
      fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify({ port: 4444 }));
      process.argv = ['node', 'server.js'];
      process.chdir(tmpDir);
      const config = loadConfig();
      assert.strictEqual(config.port, 4444, 'should load config.json when no .jsonc exists');
    } finally {
      process.chdir(prevCwd);
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('config.example.jsonc can be copied and used as-is', () => {
    const tmpDir = makeTempDir();
    const prevCwd = process.cwd();
    try {
      const exampleContent = fs.readFileSync(
        path.join(__dirname, '../../config.example.jsonc'),
        'utf8'
      );
      fs.writeFileSync(path.join(tmpDir, 'config.jsonc'), exampleContent);
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
  test('defaultConfigPath prefers config.jsonc over config.json', () => {
    // When no file exists, defaultConfigPath returns config.jsonc
    const tmpDir = makeTempDir();
    const prevCwd = process.cwd();
    try {
      process.chdir(tmpDir);
      // Neither file exists — should return .jsonc
      assert.ok(defaultConfigPath().endsWith('config.jsonc'));

      // Create config.json only — should still return .jsonc (doesn't exist yet)
      // Actually, defaultConfigPath checks existence, so with only .json present it returns .json
      fs.writeFileSync(path.join(tmpDir, 'config.json'), '{}');
      assert.ok(
        defaultConfigPath().endsWith('config.json'),
        'falls back to .json when only .json exists'
      );

      // Create config.jsonc — should prefer .jsonc
      fs.writeFileSync(path.join(tmpDir, 'config.jsonc'), '{}');
      assert.ok(defaultConfigPath().endsWith('config.jsonc'), 'prefers .jsonc when both exist');
    } finally {
      process.chdir(prevCwd);
      fs.rmSync(tmpDir, { recursive: true });
    }
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

  test('DEFAULTS has computer player flat keys', () => {
    assert.ok('computerEnabled' in DEFAULTS);
    assert.ok('computerStockfishPath' in DEFAULTS);
    assert.ok('computerSpawnTimeout' in DEFAULTS);
    assert.ok('computerMoveTimeout' in DEFAULTS);
    assert.ok('computerSkills' in DEFAULTS);
  });

  test('ENV_MAP has entries for all computer player keys', () => {
    assert.strictEqual(ENV_MAP.computerEnabled, 'MPCHESS_COMPUTER_ENABLED');
    assert.strictEqual(ENV_MAP.computerStockfishPath, 'MPCHESS_COMPUTER_STOCKFISH_PATH');
    assert.strictEqual(ENV_MAP.computerSpawnTimeout, 'MPCHESS_COMPUTER_SPAWN_TIMEOUT');
    assert.strictEqual(ENV_MAP.computerMoveTimeout, 'MPCHESS_COMPUTER_MOVE_TIMEOUT');
    assert.strictEqual(ENV_MAP.computerSkills, 'MPCHESS_COMPUTER_SKILLS');
  });

  test('CLI_FLAG_MAP has entries for all computer player keys', () => {
    const cliKeys = CLI_FLAG_MAP.map(([, key]) => key);
    assert.ok(cliKeys.includes('computerEnabled'));
    assert.ok(cliKeys.includes('computerStockfishPath'));
    assert.ok(cliKeys.includes('computerSpawnTimeout'));
    assert.ok(cliKeys.includes('computerMoveTimeout'));
    assert.ok(cliKeys.includes('computerSkills'));
  });
});

describe('convertType — computer player keys', () => {
  test('computerEnabled: string "true" to boolean true', () => {
    assert.strictEqual(convertType('computerEnabled', 'true'), true);
  });

  test('computerEnabled: string "false" to boolean false', () => {
    assert.strictEqual(convertType('computerEnabled', 'false'), false);
  });

  test('computerEnabled: string "1" to boolean true', () => {
    assert.strictEqual(convertType('computerEnabled', '1'), true);
  });

  test('computerEnabled: boolean passthrough', () => {
    assert.strictEqual(convertType('computerEnabled', true), true);
    assert.strictEqual(convertType('computerEnabled', false), false);
  });

  test('computerEnabled: empty string returns undefined', () => {
    assert.strictEqual(convertType('computerEnabled', ''), undefined);
  });

  test('computerSpawnTimeout: string to number', () => {
    assert.strictEqual(convertType('computerSpawnTimeout', '15000'), 15000);
  });

  test('computerSpawnTimeout: invalid string returns undefined', () => {
    assert.strictEqual(convertType('computerSpawnTimeout', 'abc'), undefined);
  });

  test('computerMoveTimeout: string to number', () => {
    assert.strictEqual(convertType('computerMoveTimeout', '60000'), 60000);
  });

  test('computerMoveTimeout: empty string returns undefined', () => {
    assert.strictEqual(convertType('computerMoveTimeout', ''), undefined);
  });

  test('computerStockfishPath: string passthrough', () => {
    assert.strictEqual(
      convertType('computerStockfishPath', '/usr/bin/stockfish'),
      '/usr/bin/stockfish'
    );
  });

  test('computerSkills: JSON string to object', () => {
    const result = convertType('computerSkills', '{"beginner":{"movetime":100}}');
    assert.deepStrictEqual(result, { beginner: { movetime: 100 } });
  });

  test('computerSkills: object passthrough', () => {
    const obj = { beginner: { movetime: 100 } };
    assert.deepStrictEqual(convertType('computerSkills', obj), obj);
  });

  test('computerSkills: invalid JSON returns undefined', () => {
    assert.strictEqual(convertType('computerSkills', '{invalid json}'), undefined);
  });

  test('computerSkills: JSON string that is not an object returns undefined', () => {
    assert.strictEqual(convertType('computerSkills', '"just a string"'), undefined);
    assert.strictEqual(convertType('computerSkills', '42'), undefined);
  });

  test('computerSkills: empty string returns undefined', () => {
    assert.strictEqual(convertType('computerSkills', ''), undefined);
  });
});

describe('finalizeComputerPlayer', () => {
  test('assembles from flat keys only', () => {
    const config = {
      computerEnabled: true,
      computerStockfishPath: '/usr/bin/stockfish',
      computerSpawnTimeout: 15000,
      computerMoveTimeout: 60000,
    };
    const result = finalizeComputerPlayer(config);
    assert.deepStrictEqual(result.computerPlayer, {
      enabled: true,
      stockfishPath: '/usr/bin/stockfish',
      spawnTimeout: 15000,
      moveTimeout: 60000,
    });
    assert.ok(!('computerEnabled' in result), 'flat key should be removed');
    assert.ok(!('computerStockfishPath' in result), 'flat key should be removed');
    assert.ok(!('computerSpawnTimeout' in result), 'flat key should be removed');
    assert.ok(!('computerMoveTimeout' in result), 'flat key should be removed');
  });

  test('preserves nested computerPlayer from config', () => {
    const config = {
      computerPlayer: { enabled: false, spawnTimeout: 5000 },
    };
    const result = finalizeComputerPlayer(config);
    assert.deepStrictEqual(result.computerPlayer, { enabled: false, spawnTimeout: 5000 });
  });

  test('flat keys override nested computerPlayer fields', () => {
    const config = {
      computerPlayer: { enabled: true, spawnTimeout: 5000, moveTimeout: 30000 },
      computerEnabled: false,
      computerMoveTimeout: 60000,
    };
    const result = finalizeComputerPlayer(config);
    assert.strictEqual(result.computerPlayer.enabled, false, 'flat key overrides nested');
    assert.strictEqual(result.computerPlayer.spawnTimeout, 5000, 'nested value preserved');
    assert.strictEqual(result.computerPlayer.moveTimeout, 60000, 'flat key overrides nested');
  });

  test('computerSkills flat key merges into computerPlayer', () => {
    const config = {
      computerPlayer: { enabled: true },
      computerSkills: { beginner: { movetime: 100 } },
    };
    const result = finalizeComputerPlayer(config);
    assert.strictEqual(result.computerPlayer.enabled, true);
    assert.deepStrictEqual(result.computerPlayer.skills, { beginner: { movetime: 100 } });
  });

  test('no computer player config at all leaves no computerPlayer key', () => {
    const config = { port: 3000 };
    const result = finalizeComputerPlayer(config);
    assert.ok(!('computerPlayer' in result), 'should not create empty computerPlayer');
  });

  test('undefined flat keys do not override nested values', () => {
    const config = {
      computerPlayer: { enabled: true, moveTimeout: 30000 },
      computerEnabled: undefined,
      computerMoveTimeout: undefined,
    };
    const result = finalizeComputerPlayer(config);
    assert.strictEqual(result.computerPlayer.enabled, true);
    assert.strictEqual(result.computerPlayer.moveTimeout, 30000);
  });

  test('removes all flat keys even when no computerPlayer is set', () => {
    const config = {
      computerEnabled: true,
      port: 3000,
    };
    const result = finalizeComputerPlayer(config);
    assert.ok(!('computerEnabled' in result));
    assert.strictEqual(result.port, 3000);
  });
});

describe('loadFromCli — computer player flags', () => {
  test('parses --computer-enabled=true', () => {
    const result = loadFromCli(['--computer-enabled=true']);
    assert.strictEqual(result.computerEnabled, true);
  });

  test('parses --computer-enabled=false', () => {
    const result = loadFromCli(['--computer-enabled=false']);
    assert.strictEqual(result.computerEnabled, false);
  });

  test('parses --computer-stockfish-path=', () => {
    const result = loadFromCli(['--computer-stockfish-path=/usr/bin/stockfish']);
    assert.strictEqual(result.computerStockfishPath, '/usr/bin/stockfish');
  });

  test('parses --computer-spawn-timeout=', () => {
    const result = loadFromCli(['--computer-spawn-timeout=15000']);
    assert.strictEqual(result.computerSpawnTimeout, 15000);
  });

  test('parses --computer-move-timeout=', () => {
    const result = loadFromCli(['--computer-move-timeout=60000']);
    assert.strictEqual(result.computerMoveTimeout, 60000);
  });

  test('parses --computer-skills= with JSON', () => {
    const result = loadFromCli(['--computer-skills={"beginner":{"movetime":100}}']);
    assert.deepStrictEqual(result.computerSkills, { beginner: { movetime: 100 } });
  });

  test('parses multiple computer flags together', () => {
    const result = loadFromCli([
      '--computer-enabled=false',
      '--computer-move-timeout=5000',
      '--computer-stockfish-path=/opt/stockfish',
    ]);
    assert.strictEqual(result.computerEnabled, false);
    assert.strictEqual(result.computerMoveTimeout, 5000);
    assert.strictEqual(result.computerStockfishPath, '/opt/stockfish');
  });
});

describe('loadFromEnv — computer player env vars', () => {
  const origEnv = { ...process.env };

  test('reads MPCHESS_COMPUTER_ENABLED', () => {
    process.env.MPCHESS_COMPUTER_ENABLED = 'false';
    const result = loadFromEnv();
    assert.strictEqual(result.computerEnabled, false);
    delete process.env.MPCHESS_COMPUTER_ENABLED;
  });

  test('reads MPCHESS_COMPUTER_STOCKFISH_PATH', () => {
    process.env.MPCHESS_COMPUTER_STOCKFISH_PATH = '/usr/bin/stockfish';
    const result = loadFromEnv();
    assert.strictEqual(result.computerStockfishPath, '/usr/bin/stockfish');
    delete process.env.MPCHESS_COMPUTER_STOCKFISH_PATH;
  });

  test('reads MPCHESS_COMPUTER_SPAWN_TIMEOUT', () => {
    process.env.MPCHESS_COMPUTER_SPAWN_TIMEOUT = '15000';
    const result = loadFromEnv();
    assert.strictEqual(result.computerSpawnTimeout, 15000);
    delete process.env.MPCHESS_COMPUTER_SPAWN_TIMEOUT;
  });

  test('reads MPCHESS_COMPUTER_MOVE_TIMEOUT', () => {
    process.env.MPCHESS_COMPUTER_MOVE_TIMEOUT = '60000';
    const result = loadFromEnv();
    assert.strictEqual(result.computerMoveTimeout, 60000);
    delete process.env.MPCHESS_COMPUTER_MOVE_TIMEOUT;
  });

  test('reads MPCHESS_COMPUTER_SKILLS as JSON', () => {
    process.env.MPCHESS_COMPUTER_SKILLS = '{"beginner":{"movetime":100}}';
    const result = loadFromEnv();
    assert.deepStrictEqual(result.computerSkills, { beginner: { movetime: 100 } });
    delete process.env.MPCHESS_COMPUTER_SKILLS;
  });

  test('invalid MPCHESS_COMPUTER_SKILLS JSON is ignored', () => {
    process.env.MPCHESS_COMPUTER_SKILLS = '{invalid}';
    const result = loadFromEnv();
    assert.strictEqual(result.computerSkills, undefined);
    delete process.env.MPCHESS_COMPUTER_SKILLS;
  });
});

describe('loadConfig — computer player integration', () => {
  const origArgv = process.argv;
  const origEnv = { ...process.env };
  const origCwd = process.cwd();

  function inTempDir(fn) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpchess-config-test-'));
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

  test('config file computerPlayer nested object works', () => {
    inTempDir((tmpDir) => {
      writeConfig(tmpDir, {
        computerPlayer: { enabled: false, spawnTimeout: 5000, moveTimeout: 10000 },
      });
      process.argv = ['node', 'server.js'];
      const config = loadConfig();
      assert.strictEqual(config.computerPlayer.enabled, false);
      assert.strictEqual(config.computerPlayer.spawnTimeout, 5000);
      assert.strictEqual(config.computerPlayer.moveTimeout, 10000);
    });
    cleanupEnv();
  });

  test('env var overrides config file computerPlayer field', () => {
    inTempDir((tmpDir) => {
      writeConfig(tmpDir, {
        computerPlayer: { enabled: true, moveTimeout: 30000 },
      });
      process.argv = ['node', 'server.js'];
      process.env.MPCHESS_COMPUTER_ENABLED = 'false';
      const config = loadConfig();
      assert.strictEqual(config.computerPlayer.enabled, false, 'env overrides config file');
      assert.strictEqual(config.computerPlayer.moveTimeout, 30000, 'config file value preserved');
    });
    cleanupEnv();
  });

  test('CLI flag overrides env var for computer player', () => {
    inTempDir((tmpDir) => {
      process.argv = ['node', 'server.js', '--computer-move-timeout=9999'];
      process.env.MPCHESS_COMPUTER_MOVE_TIMEOUT = '8888';
      const config = loadConfig();
      assert.strictEqual(config.computerPlayer.moveTimeout, 9999, 'CLI wins over env');
    });
    cleanupEnv();
  });

  test('CLI skills JSON is assembled into computerPlayer', () => {
    inTempDir((tmpDir) => {
      process.argv = ['node', 'server.js', '--computer-skills={"beginner":{"movetime":50}}'];
      const config = loadConfig();
      assert.deepStrictEqual(config.computerPlayer.skills, { beginner: { movetime: 50 } });
    });
    cleanupEnv();
  });

  test('env skills JSON is assembled into computerPlayer', () => {
    inTempDir((tmpDir) => {
      process.argv = ['node', 'server.js'];
      process.env.MPCHESS_COMPUTER_SKILLS = '{"master":{"depth":30}}';
      const config = loadConfig();
      assert.deepStrictEqual(config.computerPlayer.skills, { master: { depth: 30 } });
    });
    cleanupEnv();
  });

  test('flat keys from env merge with nested object from config file', () => {
    inTempDir((tmpDir) => {
      writeConfig(tmpDir, {
        computerPlayer: { enabled: true, stockfishPath: '/from/file', spawnTimeout: 5000 },
      });
      process.argv = ['node', 'server.js'];
      process.env.MPCHESS_COMPUTER_STOCKFISH_PATH = '/from/env';
      process.env.MPCHESS_COMPUTER_MOVE_TIMEOUT = '60000';
      const config = loadConfig();
      assert.strictEqual(config.computerPlayer.enabled, true, 'from config file');
      assert.strictEqual(config.computerPlayer.stockfishPath, '/from/env', 'env overrides file');
      assert.strictEqual(config.computerPlayer.spawnTimeout, 5000, 'from config file');
      assert.strictEqual(config.computerPlayer.moveTimeout, 60000, 'from env');
    });
    cleanupEnv();
  });

  test('no computer player config yields no computerPlayer key', () => {
    inTempDir((tmpDir) => {
      process.argv = ['node', 'server.js'];
      const config = loadConfig();
      assert.ok(!('computerPlayer' in config), 'should not create empty computerPlayer');
    });
    cleanupEnv();
  });

  test('config.example.jsonc parses with computerPlayer', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpchess-config-test-'));
    const prevCwd = process.cwd();
    try {
      const exampleContent = fs.readFileSync(
        path.join(__dirname, '../../config.example.jsonc'),
        'utf8'
      );
      fs.writeFileSync(path.join(tmpDir, 'config.jsonc'), exampleContent);
      process.argv = ['node', 'server.js'];
      process.chdir(tmpDir);
      const config = loadConfig();
      assert.strictEqual(config.computerPlayer.enabled, true);
      assert.strictEqual(config.computerPlayer.spawnTimeout, 10000);
      assert.strictEqual(config.computerPlayer.moveTimeout, 30000);
    } finally {
      process.chdir(prevCwd);
      fs.rmSync(tmpDir, { recursive: true });
    }
    cleanupEnv();
  });
});

describe('convertType — server tuning keys', () => {
  test('seatTimeout: string to number', () => {
    assert.strictEqual(convertType('seatTimeout', '120000'), 120000);
  });

  test('seatTimeout: invalid string returns undefined', () => {
    assert.strictEqual(convertType('seatTimeout', 'abc'), undefined);
  });

  test('seatTimeout: empty string returns undefined', () => {
    assert.strictEqual(convertType('seatTimeout', ''), undefined);
  });

  test('joinTimeout: string to number', () => {
    assert.strictEqual(convertType('joinTimeout', '10000'), 10000);
  });

  test('joinTimeout: invalid string returns undefined', () => {
    assert.strictEqual(convertType('joinTimeout', 'xyz'), undefined);
  });

  test('rateLimitMax: string to number', () => {
    assert.strictEqual(convertType('rateLimitMax', '100'), 100);
  });

  test('rateLimitMax: invalid string returns undefined', () => {
    assert.strictEqual(convertType('rateLimitMax', 'nope'), undefined);
  });

  test('rateLimitWindow: string to number', () => {
    assert.strictEqual(convertType('rateLimitWindow', '5000'), 5000);
  });

  test('rateLimitWindow: empty string returns undefined', () => {
    assert.strictEqual(convertType('rateLimitWindow', ''), undefined);
  });
});

describe('loadFromCli — server tuning flags', () => {
  test('parses --seat-timeout=', () => {
    const result = loadFromCli(['--seat-timeout=120000']);
    assert.strictEqual(result.seatTimeout, 120000);
  });

  test('parses --join-timeout=', () => {
    const result = loadFromCli(['--join-timeout=10000']);
    assert.strictEqual(result.joinTimeout, 10000);
  });

  test('parses --rate-limit-max=', () => {
    const result = loadFromCli(['--rate-limit-max=100']);
    assert.strictEqual(result.rateLimitMax, 100);
  });

  test('parses --rate-limit-window=', () => {
    const result = loadFromCli(['--rate-limit-window=5000']);
    assert.strictEqual(result.rateLimitWindow, 5000);
  });

  test('parses multiple server tuning flags together', () => {
    const result = loadFromCli([
      '--seat-timeout=30000',
      '--rate-limit-max=200',
      '--rate-limit-window=20000',
    ]);
    assert.strictEqual(result.seatTimeout, 30000);
    assert.strictEqual(result.rateLimitMax, 200);
    assert.strictEqual(result.rateLimitWindow, 20000);
  });
});

describe('loadFromEnv — server tuning env vars', () => {
  const origEnv = { ...process.env };

  test('reads MPCHESS_SEAT_TIMEOUT', () => {
    process.env.MPCHESS_SEAT_TIMEOUT = '120000';
    const result = loadFromEnv();
    assert.strictEqual(result.seatTimeout, 120000);
    delete process.env.MPCHESS_SEAT_TIMEOUT;
  });

  test('reads MPCHESS_JOIN_TIMEOUT', () => {
    process.env.MPCHESS_JOIN_TIMEOUT = '10000';
    const result = loadFromEnv();
    assert.strictEqual(result.joinTimeout, 10000);
    delete process.env.MPCHESS_JOIN_TIMEOUT;
  });

  test('reads MPCHESS_RATE_LIMIT_MAX', () => {
    process.env.MPCHESS_RATE_LIMIT_MAX = '100';
    const result = loadFromEnv();
    assert.strictEqual(result.rateLimitMax, 100);
    delete process.env.MPCHESS_RATE_LIMIT_MAX;
  });

  test('reads MPCHESS_RATE_LIMIT_WINDOW', () => {
    process.env.MPCHESS_RATE_LIMIT_WINDOW = '5000';
    const result = loadFromEnv();
    assert.strictEqual(result.rateLimitWindow, 5000);
    delete process.env.MPCHESS_RATE_LIMIT_WINDOW;
  });
});

describe('loadConfig — server tuning integration', () => {
  const origArgv = process.argv;
  const origEnv = { ...process.env };
  const origCwd = process.cwd();

  function inTempDir(fn) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpchess-config-test-'));
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

  test('config file server tuning values used', () => {
    inTempDir((tmpDir) => {
      writeConfig(tmpDir, { seatTimeout: 120000, rateLimitMax: 100 });
      process.argv = ['node', 'server.js'];
      const config = loadConfig();
      assert.strictEqual(config.seatTimeout, 120000);
      assert.strictEqual(config.rateLimitMax, 100);
    });
    cleanupEnv();
  });

  test('env var overrides config file for server tuning', () => {
    inTempDir((tmpDir) => {
      writeConfig(tmpDir, { seatTimeout: 120000 });
      process.argv = ['node', 'server.js'];
      process.env.MPCHESS_SEAT_TIMEOUT = '30000';
      const config = loadConfig();
      assert.strictEqual(config.seatTimeout, 30000, 'env overrides config file');
    });
    cleanupEnv();
  });

  test('CLI overrides env var for server tuning', () => {
    inTempDir((tmpDir) => {
      process.argv = ['node', 'server.js', '--rate-limit-max=200'];
      process.env.MPCHESS_RATE_LIMIT_MAX = '150';
      const config = loadConfig();
      assert.strictEqual(config.rateLimitMax, 200, 'CLI wins over env');
    });
    cleanupEnv();
  });

  test('null values in config file fall back to undefined', () => {
    inTempDir((tmpDir) => {
      writeConfig(tmpDir, { seatTimeout: null, rateLimitWindow: null });
      process.argv = ['node', 'server.js'];
      const config = loadConfig();
      assert.strictEqual(config.seatTimeout, undefined, 'null falls back to default');
      assert.strictEqual(config.rateLimitWindow, undefined, 'null falls back to default');
    });
    cleanupEnv();
  });

  test('no server tuning config yields undefined (server uses built-in defaults)', () => {
    inTempDir((tmpDir) => {
      process.argv = ['node', 'server.js'];
      const config = loadConfig();
      assert.strictEqual(config.seatTimeout, undefined);
      assert.strictEqual(config.joinTimeout, undefined);
      assert.strictEqual(config.rateLimitMax, undefined);
      assert.strictEqual(config.rateLimitWindow, undefined);
    });
    cleanupEnv();
  });
});

describe('Constants — server tuning keys', () => {
  test('DEFAULTS has server tuning keys', () => {
    assert.ok('seatTimeout' in DEFAULTS);
    assert.ok('joinTimeout' in DEFAULTS);
    assert.ok('rateLimitMax' in DEFAULTS);
    assert.ok('rateLimitWindow' in DEFAULTS);
    assert.ok('slowClientThreshold' in DEFAULTS);
    assert.ok('minMoveDelay' in DEFAULTS);
    assert.ok('host' in DEFAULTS);
  });

  test('ENV_MAP has entries for server tuning keys', () => {
    assert.strictEqual(ENV_MAP.seatTimeout, 'MPCHESS_SEAT_TIMEOUT');
    assert.strictEqual(ENV_MAP.joinTimeout, 'MPCHESS_JOIN_TIMEOUT');
    assert.strictEqual(ENV_MAP.rateLimitMax, 'MPCHESS_RATE_LIMIT_MAX');
    assert.strictEqual(ENV_MAP.rateLimitWindow, 'MPCHESS_RATE_LIMIT_WINDOW');
    assert.strictEqual(ENV_MAP.slowClientThreshold, 'MPCHESS_SLOW_CLIENT_THRESHOLD');
    assert.strictEqual(ENV_MAP.minMoveDelay, 'MPCHESS_MIN_MOVE_DELAY');
    assert.strictEqual(ENV_MAP.host, 'MPCHESS_HOST');
  });

  test('CLI_FLAG_MAP has entries for server tuning keys', () => {
    const cliKeys = CLI_FLAG_MAP.map(([, key]) => key);
    assert.ok(cliKeys.includes('seatTimeout'));
    assert.ok(cliKeys.includes('joinTimeout'));
    assert.ok(cliKeys.includes('rateLimitMax'));
    assert.ok(cliKeys.includes('rateLimitWindow'));
    assert.ok(cliKeys.includes('slowClientThreshold'));
    assert.ok(cliKeys.includes('minMoveDelay'));
    assert.ok(cliKeys.includes('host'));
  });
});

describe('convertType — additional server tuning keys', () => {
  test('slowClientThreshold: string to number', () => {
    assert.strictEqual(convertType('slowClientThreshold', '2097152'), 2097152);
  });

  test('slowClientThreshold: invalid string returns undefined', () => {
    assert.strictEqual(convertType('slowClientThreshold', 'abc'), undefined);
  });

  test('slowClientThreshold: empty string returns undefined', () => {
    assert.strictEqual(convertType('slowClientThreshold', ''), undefined);
  });

  test('minMoveDelay: string to number', () => {
    assert.strictEqual(convertType('minMoveDelay', '1000'), 1000);
  });

  test('minMoveDelay: invalid string returns undefined', () => {
    assert.strictEqual(convertType('minMoveDelay', 'nope'), undefined);
  });

  test('minMoveDelay: empty string returns undefined', () => {
    assert.strictEqual(convertType('minMoveDelay', ''), undefined);
  });

  test('host: string passthrough', () => {
    assert.strictEqual(convertType('host', '127.0.0.1'), '127.0.0.1');
  });

  test('host: empty string returns undefined', () => {
    assert.strictEqual(convertType('host', ''), undefined);
  });
});

describe('loadFromCli — additional server tuning flags', () => {
  test('parses --slow-client-threshold=', () => {
    const result = loadFromCli(['--slow-client-threshold=2097152']);
    assert.strictEqual(result.slowClientThreshold, 2097152);
  });

  test('parses --min-move-delay=', () => {
    const result = loadFromCli(['--min-move-delay=1000']);
    assert.strictEqual(result.minMoveDelay, 1000);
  });

  test('parses --host=', () => {
    const result = loadFromCli(['--host=127.0.0.1']);
    assert.strictEqual(result.host, '127.0.0.1');
  });

  test('parses multiple additional tuning flags together', () => {
    const result = loadFromCli([
      '--slow-client-threshold=524288',
      '--min-move-delay=250',
      '--host=0.0.0.0',
    ]);
    assert.strictEqual(result.slowClientThreshold, 524288);
    assert.strictEqual(result.minMoveDelay, 250);
    assert.strictEqual(result.host, '0.0.0.0');
  });
});

describe('loadFromEnv — additional server tuning env vars', () => {
  const origEnv = { ...process.env };

  test('reads MPCHESS_SLOW_CLIENT_THRESHOLD', () => {
    process.env.MPCHESS_SLOW_CLIENT_THRESHOLD = '2097152';
    const result = loadFromEnv();
    assert.strictEqual(result.slowClientThreshold, 2097152);
    delete process.env.MPCHESS_SLOW_CLIENT_THRESHOLD;
  });

  test('reads MPCHESS_MIN_MOVE_DELAY', () => {
    process.env.MPCHESS_MIN_MOVE_DELAY = '1000';
    const result = loadFromEnv();
    assert.strictEqual(result.minMoveDelay, 1000);
    delete process.env.MPCHESS_MIN_MOVE_DELAY;
  });

  test('reads MPCHESS_HOST', () => {
    process.env.MPCHESS_HOST = '127.0.0.1';
    const result = loadFromEnv();
    assert.strictEqual(result.host, '127.0.0.1');
    delete process.env.MPCHESS_HOST;
  });
});

describe('loadConfig — additional server tuning integration', () => {
  const origArgv = process.argv;
  const origEnv = { ...process.env };
  const origCwd = process.cwd();

  function inTempDir(fn) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpchess-config-test-'));
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

  test('config file additional tuning values used', () => {
    inTempDir((tmpDir) => {
      writeConfig(tmpDir, { slowClientThreshold: 524288, host: '127.0.0.1' });
      process.argv = ['node', 'server.js'];
      const config = loadConfig();
      assert.strictEqual(config.slowClientThreshold, 524288);
      assert.strictEqual(config.host, '127.0.0.1');
    });
    cleanupEnv();
  });

  test('env var overrides config file for additional tuning', () => {
    inTempDir((tmpDir) => {
      writeConfig(tmpDir, { minMoveDelay: 250 });
      process.argv = ['node', 'server.js'];
      process.env.MPCHESS_MIN_MOVE_DELAY = '1000';
      const config = loadConfig();
      assert.strictEqual(config.minMoveDelay, 1000, 'env overrides config file');
    });
    cleanupEnv();
  });

  test('CLI overrides env var for additional tuning', () => {
    inTempDir((tmpDir) => {
      process.argv = ['node', 'server.js', '--host=0.0.0.0'];
      process.env.MPCHESS_HOST = '127.0.0.1';
      const config = loadConfig();
      assert.strictEqual(config.host, '0.0.0.0', 'CLI wins over env');
    });
    cleanupEnv();
  });

  test('null values in config file fall back to undefined', () => {
    inTempDir((tmpDir) => {
      writeConfig(tmpDir, { slowClientThreshold: null, host: null, minMoveDelay: null });
      process.argv = ['node', 'server.js'];
      const config = loadConfig();
      assert.strictEqual(config.slowClientThreshold, undefined);
      assert.strictEqual(config.host, undefined);
      assert.strictEqual(config.minMoveDelay, undefined);
    });
    cleanupEnv();
  });

  test('no additional tuning config yields undefined', () => {
    inTempDir((tmpDir) => {
      process.argv = ['node', 'server.js'];
      const config = loadConfig();
      assert.strictEqual(config.slowClientThreshold, undefined);
      assert.strictEqual(config.minMoveDelay, undefined);
      assert.strictEqual(config.host, undefined);
    });
    cleanupEnv();
  });
});

// ── finalizeComputerPlayer does not mutate input ──
describe('finalizeComputerPlayer immutability', () => {
  test('input config object is not mutated', () => {
    const input = {
      port: 3000,
      computerEnabled: true,
      computerStockfishPath: '/usr/bin/stockfish',
      computerSpawnTimeout: 5000,
      computerMoveTimeout: 30000,
      computerSkills: { beginner: 0 },
    };
    const inputKeysBefore = Object.keys(input);
    const result = finalizeComputerPlayer(input);
    // Original object must still have all its keys
    assert.deepStrictEqual(Object.keys(input), inputKeysBefore);
    assert.strictEqual(input.computerEnabled, true);
    assert.strictEqual(input.computerStockfishPath, '/usr/bin/stockfish');
    assert.strictEqual(input.computerSpawnTimeout, 5000);
    assert.strictEqual(input.computerMoveTimeout, 30000);
    assert.deepStrictEqual(input.computerSkills, { beginner: 0 });
  });

  test('returned object is different from input', () => {
    const input = {
      port: 3000,
      computerEnabled: true,
    };
    const result = finalizeComputerPlayer(input);
    assert.notStrictEqual(result, input);
  });

  test('flat keys are removed from returned object only', () => {
    const input = {
      port: 3000,
      computerEnabled: true,
      computerStockfishPath: '/usr/bin/stockfish',
    };
    const result = finalizeComputerPlayer(input);
    assert.strictEqual(result.computerEnabled, undefined);
    assert.strictEqual(result.computerStockfishPath, undefined);
    assert.ok(result.computerPlayer);
    assert.strictEqual(result.computerPlayer.enabled, true);
    assert.strictEqual(result.computerPlayer.stockfishPath, '/usr/bin/stockfish');
    // Input still has the flat keys
    assert.strictEqual(input.computerEnabled, true);
    assert.strictEqual(input.computerStockfishPath, '/usr/bin/stockfish');
  });

  test('non-computer keys preserved in result', () => {
    const input = {
      port: 8080,
      debug: true,
      computerEnabled: true,
    };
    const result = finalizeComputerPlayer(input);
    assert.strictEqual(result.port, 8080);
    assert.strictEqual(result.debug, true);
  });

  test('existing computerPlayer nested object is merged, not replaced', () => {
    const input = {
      computerPlayer: { enabled: false, customKey: 'value' },
      computerEnabled: true,
    };
    const result = finalizeComputerPlayer(input);
    // Flat key takes priority for enabled
    assert.strictEqual(result.computerPlayer.enabled, true);
    // Custom key from nested object preserved
    assert.strictEqual(result.computerPlayer.customKey, 'value');
    // Input nested object not mutated
    assert.strictEqual(input.computerPlayer.enabled, false);
    assert.strictEqual(input.computerPlayer.customKey, 'value');
  });
});

// ── initHalfmoveClock config option ──────────────────────
describe('convertType — initHalfmoveClock', () => {
  test('initHalfmoveClock: string to number', () => {
    assert.strictEqual(convertType('initHalfmoveClock', '99'), 99);
  });

  test('initHalfmoveClock: zero string to number', () => {
    assert.strictEqual(convertType('initHalfmoveClock', '0'), 0);
  });

  test('initHalfmoveClock: invalid string returns undefined', () => {
    assert.strictEqual(convertType('initHalfmoveClock', 'abc'), undefined);
  });

  test('initHalfmoveClock: empty string returns undefined', () => {
    assert.strictEqual(convertType('initHalfmoveClock', ''), undefined);
  });

  test('initHalfmoveClock: number passthrough', () => {
    assert.strictEqual(convertType('initHalfmoveClock', 100), 100);
  });
});

describe('loadFromCli — init-halfmove-clock flag', () => {
  test('parses --init-halfmove-clock=99', () => {
    const result = loadFromCli(['--init-halfmove-clock=99']);
    assert.strictEqual(result.initHalfmoveClock, 99);
  });

  test('parses --init-halfmove-clock=100', () => {
    const result = loadFromCli(['--init-halfmove-clock=100']);
    assert.strictEqual(result.initHalfmoveClock, 100);
  });

  test('parses --init-halfmove-clock=0', () => {
    const result = loadFromCli(['--init-halfmove-clock=0']);
    assert.strictEqual(result.initHalfmoveClock, 0);
  });

  test('ignores --init-halfmove-clock with invalid value', () => {
    const result = loadFromCli(['--init-halfmove-clock=abc']);
    assert.strictEqual(result.initHalfmoveClock, undefined);
  });
});

describe('loadFromEnv — initHalfmoveClock env var', () => {
  const origEnv = { ...process.env };

  test('reads MPCHESS_INIT_HALFMOVE_CLOCK', () => {
    process.env.MPCHESS_INIT_HALFMOVE_CLOCK = '99';
    const result = loadFromEnv();
    assert.strictEqual(result.initHalfmoveClock, 99);
    delete process.env.MPCHESS_INIT_HALFMOVE_CLOCK;
  });

  test('ignores invalid MPCHESS_INIT_HALFMOVE_CLOCK', () => {
    process.env.MPCHESS_INIT_HALFMOVE_CLOCK = 'not-a-number';
    const result = loadFromEnv();
    assert.strictEqual(result.initHalfmoveClock, undefined);
    delete process.env.MPCHESS_INIT_HALFMOVE_CLOCK;
  });
});

describe('Constants — initHalfmoveClock keys', () => {
  test('DEFAULTS has initHalfmoveClock', () => {
    assert.ok('initHalfmoveClock' in DEFAULTS);
    assert.strictEqual(DEFAULTS.initHalfmoveClock, undefined);
  });

  test('ENV_MAP has initHalfmoveClock entry', () => {
    assert.strictEqual(ENV_MAP.initHalfmoveClock, 'MPCHESS_INIT_HALFMOVE_CLOCK');
  });

  test('CLI_FLAG_MAP has init-halfmove-clock entry', () => {
    const cliKeys = CLI_FLAG_MAP.map(([, key]) => key);
    assert.ok(cliKeys.includes('initHalfmoveClock'));
  });
});

describe('loadConfig — initHalfmoveClock integration', () => {
  const origArgv = process.argv;
  const origEnv = { ...process.env };
  const origCwd = process.cwd();

  function inTempDir(fn) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpchess-config-test-'));
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

  test('config file initHalfmoveClock value used', () => {
    inTempDir((tmpDir) => {
      writeConfig(tmpDir, { initHalfmoveClock: 99 });
      process.argv = ['node', 'server.js'];
      const config = loadConfig();
      assert.strictEqual(config.initHalfmoveClock, 99);
    });
    cleanupEnv();
  });

  test('env var overrides config file for initHalfmoveClock', () => {
    inTempDir((tmpDir) => {
      writeConfig(tmpDir, { initHalfmoveClock: 50 });
      process.argv = ['node', 'server.js'];
      process.env.MPCHESS_INIT_HALFMOVE_CLOCK = '99';
      const config = loadConfig();
      assert.strictEqual(config.initHalfmoveClock, 99, 'env overrides config file');
    });
    cleanupEnv();
  });

  test('CLI overrides env var for initHalfmoveClock', () => {
    inTempDir((tmpDir) => {
      process.argv = ['node', 'server.js', '--init-halfmove-clock=100'];
      process.env.MPCHESS_INIT_HALFMOVE_CLOCK = '50';
      const config = loadConfig();
      assert.strictEqual(config.initHalfmoveClock, 100, 'CLI wins over env');
    });
    cleanupEnv();
  });

  test('null initHalfmoveClock in config file falls back to undefined', () => {
    inTempDir((tmpDir) => {
      writeConfig(tmpDir, { initHalfmoveClock: null });
      process.argv = ['node', 'server.js'];
      const config = loadConfig();
      assert.strictEqual(config.initHalfmoveClock, undefined, 'null falls back to default');
    });
    cleanupEnv();
  });

  test('no initHalfmoveClock config yields undefined', () => {
    inTempDir((tmpDir) => {
      process.argv = ['node', 'server.js'];
      const config = loadConfig();
      assert.strictEqual(config.initHalfmoveClock, undefined);
    });
    cleanupEnv();
  });

  test('initHalfmoveClock works alongside fen config', () => {
    inTempDir((tmpDir) => {
      writeConfig(tmpDir, {
        fen: '4k3/8/8/8/8/8/8/4K2R w K - 0 1',
        initHalfmoveClock: 99,
      });
      process.argv = ['node', 'server.js'];
      const config = loadConfig();
      assert.strictEqual(config.initHalfmoveClock, 99);
      assert.ok(config.fen.includes('4k3'));
    });
    cleanupEnv();
  });
});

// ── Summary ──────────────────────────────────────────────
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed}/${total} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
