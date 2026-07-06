const fs = require('fs');
const path = require('path');

function defaultConfigPath() {
  // Prefer .jsonc (JSON with comments); fall back to .json for backwards compatibility.
  const jsoncPath = path.join(process.cwd(), 'config.jsonc');
  const jsonPath = path.join(process.cwd(), 'config.json');
  if (fs.existsSync(jsoncPath)) return jsoncPath;
  if (fs.existsSync(jsonPath)) return jsonPath;
  return jsoncPath; // preferred default when neither exists
}

const DEFAULTS = {
  port: 3000,
  fen: undefined,
  cert: undefined,
  key: undefined,
  chain: undefined,
  allowedOrigins: [],
  debug: false,
  prefix: undefined,
  // Computer-player flat keys (env/CLI surface).
  // These are assembled into the nested `computerPlayer` object by
  // finalizeComputerPlayer() after all config layers are merged.
  // They default to undefined so they never override config-file values.
  computerEnabled: undefined,
  computerStockfishPath: undefined,
  computerSpawnTimeout: undefined,
  computerMoveTimeout: undefined,
  computerSkills: undefined,
  // Server runtime tuning knobs.
  seatTimeout: undefined,
  joinTimeout: undefined,
  rateLimitMax: undefined,
  rateLimitWindow: undefined,
  slowClientThreshold: undefined,
  minMoveDelay: undefined,
  host: undefined,
};

const ENV_MAP = {
  port: 'MPCHESS_PORT',
  fen: 'MPCHESS_FEN',
  cert: 'MPCHESS_CERT',
  key: 'MPCHESS_KEY',
  chain: 'MPCHESS_CHAIN',
  allowedOrigins: 'MPCHESS_ALLOWED_ORIGINS',
  debug: 'MPCHESS_DEBUG',
  prefix: 'MPCHESS_PREFIX',
  computerEnabled: 'MPCHESS_COMPUTER_ENABLED',
  computerStockfishPath: 'MPCHESS_COMPUTER_STOCKFISH_PATH',
  computerSpawnTimeout: 'MPCHESS_COMPUTER_SPAWN_TIMEOUT',
  computerMoveTimeout: 'MPCHESS_COMPUTER_MOVE_TIMEOUT',
  computerSkills: 'MPCHESS_COMPUTER_SKILLS',
  seatTimeout: 'MPCHESS_SEAT_TIMEOUT',
  joinTimeout: 'MPCHESS_JOIN_TIMEOUT',
  rateLimitMax: 'MPCHESS_RATE_LIMIT_MAX',
  rateLimitWindow: 'MPCHESS_RATE_LIMIT_WINDOW',
  slowClientThreshold: 'MPCHESS_SLOW_CLIENT_THRESHOLD',
  minMoveDelay: 'MPCHESS_MIN_MOVE_DELAY',
  host: 'MPCHESS_HOST',
};

// CLI flag (kebab-case) → config key (camelCase)
const CLI_FLAG_MAP = [
  ['--port=', 'port'],
  ['--fen=', 'fen'],
  ['--cert=', 'cert'],
  ['--key=', 'key'],
  ['--chain=', 'chain'],
  ['--allowed-origins=', 'allowedOrigins'],
  ['--debug=', 'debug'],
  ['--prefix=', 'prefix'],
  ['--computer-enabled=', 'computerEnabled'],
  ['--computer-stockfish-path=', 'computerStockfishPath'],
  ['--computer-spawn-timeout=', 'computerSpawnTimeout'],
  ['--computer-move-timeout=', 'computerMoveTimeout'],
  ['--computer-skills=', 'computerSkills'],
  ['--seat-timeout=', 'seatTimeout'],
  ['--join-timeout=', 'joinTimeout'],
  ['--rate-limit-max=', 'rateLimitMax'],
  ['--rate-limit-window=', 'rateLimitWindow'],
  ['--slow-client-threshold=', 'slowClientThreshold'],
  ['--min-move-delay=', 'minMoveDelay'],
  ['--host=', 'host'],
];

function convertType(key, value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (
    key === 'port' ||
    key === 'computerSpawnTimeout' ||
    key === 'computerMoveTimeout' ||
    key === 'seatTimeout' ||
    key === 'joinTimeout' ||
    key === 'rateLimitMax' ||
    key === 'rateLimitWindow' ||
    key === 'slowClientThreshold' ||
    key === 'minMoveDelay'
  ) {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  if (key === 'allowedOrigins') {
    if (Array.isArray(value)) return value.filter(Boolean);
    if (typeof value === 'string')
      return value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    return [];
  }
  if (key === 'debug' || key === 'computerEnabled') {
    // Accept 'true', '1', 'yes' as truthy
    if (typeof value === 'string') {
      return ['true', '1', 'yes'].includes(value.toLowerCase());
    }
    return Boolean(value);
  }
  if (key === 'computerSkills') {
    // Accept a JSON string (from env/CLI) or an object (from config file)
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
      } catch {
        return undefined;
      }
    }
    if (typeof value === 'object') return value;
    return undefined;
  }
  return value;
}

function loadFromEnv() {
  const config = {};
  for (const [key, envName] of Object.entries(ENV_MAP)) {
    const val = process.env[envName];
    if (val !== undefined) {
      const converted = convertType(key, val);
      if (converted !== undefined) config[key] = converted;
    }
  }
  return config;
}

function loadFromCli(argv) {
  const config = {};
  for (const arg of argv) {
    for (const [flag, key] of CLI_FLAG_MAP) {
      if (arg.startsWith(flag)) {
        config[key] = convertType(key, arg.slice(flag.length));
        break;
      }
    }
  }
  return config;
}

function mergeLayers(layers) {
  return layers.reduce(
    (acc, layer) => {
      if (!layer) return acc;
      for (const [key, value] of Object.entries(layer)) {
        if (value !== undefined && value !== null) acc[key] = value;
      }
      return acc;
    },
    { ...DEFAULTS }
  );
}

function stripComments(content) {
  // Remove // and /* */ comments while preserving strings.
  // The regex matches strings, line comments, or block comments in order.
  // Strings are kept as-is; comments are removed.
  let result = content.replace(
    /("(?:[^"\\]|\\.)*")|(\/\/[^\n]*)|(\/\*[\s\S]*?\*\/)/g,
    (match, captured) => {
      return captured !== undefined ? captured : '';
    }
  );
  // Remove trailing commas before } or ] (JSONC support).
  // Walk character-by-character tracking string state so we never
  // touch commas inside string literals.
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < result.length; i++) {
    const ch = result[i];
    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    // Outside a string: check for trailing comma pattern ",<ws>}" or ",<ws>]"
    if (ch === ',') {
      // Look ahead past whitespace for } or ]
      let j = i + 1;
      while (j < result.length && ' \t\r\n'.includes(result[j])) j++;
      if (j < result.length && (result[j] === '}' || result[j] === ']')) {
        // Skip the comma and whitespace; let the loop handle the bracket
        i = j - 1; // loop increment will set i to j (the bracket)
        continue;
      }
    }
    out += ch;
  }
  return out;
}

function loadFromFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const cleaned = stripComments(content).trim();
    if (!cleaned) return {};
    const raw = JSON.parse(cleaned);
    const config = {};
    for (const [key, value] of Object.entries(raw)) {
      if (value === null || value === undefined) continue;
      if (key in DEFAULTS) {
        config[key] = convertType(key, value);
      } else {
        config[key] = value;
      }
    }
    return config;
  } catch (e) {
    throw new Error(`Failed to parse config file ${filePath}: ${e.message}`);
  }
}

/**
 * Assemble the nested `computerPlayer` object from flat config keys.
 *
 * The config file may provide `computerPlayer` as a nested object directly.
 * Env vars and CLI flags provide flat keys (computerEnabled, etc.) that
 * are layered on top of the nested object. This function merges them,
 * with flat keys taking priority, then removes the flat keys from the
 * final config so consumers only see `config.computerPlayer`.
 *
 * @param {object} config - merged config from all layers
 * @returns {object} config with computerPlayer assembled and flat keys removed
 */
function finalizeComputerPlayer(config) {
  const result = { ...config };
  const cp = { ...(result.computerPlayer || {}) };

  if (result.computerEnabled !== undefined) cp.enabled = result.computerEnabled;
  if (result.computerStockfishPath !== undefined) cp.stockfishPath = result.computerStockfishPath;
  if (result.computerSpawnTimeout !== undefined) cp.spawnTimeout = result.computerSpawnTimeout;
  if (result.computerMoveTimeout !== undefined) cp.moveTimeout = result.computerMoveTimeout;
  if (result.computerSkills !== undefined) cp.skills = result.computerSkills;

  if (Object.keys(cp).length > 0) {
    result.computerPlayer = cp;
  }

  delete result.computerEnabled;
  delete result.computerStockfishPath;
  delete result.computerSpawnTimeout;
  delete result.computerMoveTimeout;
  delete result.computerSkills;

  return result;
}

function loadConfig(argv = process.argv) {
  const configArg = argv.find((a) => a.startsWith('--config='));
  const configPath = configArg ? path.resolve(configArg.slice(9)) : defaultConfigPath();

  const fileConfig = loadFromFile(configPath);
  const envConfig = loadFromEnv();
  const cliConfig = loadFromCli(argv);

  return finalizeComputerPlayer(mergeLayers([DEFAULTS, fileConfig, envConfig, cliConfig]));
}

module.exports = {
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
};
