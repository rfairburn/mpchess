const fs = require('fs');
const path = require('path');

function defaultConfigPath() {
  return path.join(process.cwd(), 'config.json');
}

const DEFAULTS = {
  port: 3000,
  fen: undefined,
  cert: undefined,
  key: undefined,
  chain: undefined,
  allowedOrigins: [],
  debug: false,
};

const ENV_MAP = {
  port: 'MPCHESS_PORT',
  fen: 'MPCHESS_FEN',
  cert: 'MPCHESS_CERT',
  key: 'MPCHESS_KEY',
  chain: 'MPCHESS_CHAIN',
  allowedOrigins: 'MPCHESS_ALLOWED_ORIGINS',
  debug: 'MPCHESS_DEBUG',
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
];

function convertType(key, value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (key === 'port') {
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
  if (key === 'debug') {
    // Accept 'true', '1', 'yes' as truthy
    if (typeof value === 'string') {
      return ['true', '1', 'yes'].includes(value.toLowerCase());
    }
    return Boolean(value);
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
  return content.replace(
    /("(?:[^"\\]|\\.)*")|(\/\/[^\n]*)|(\/\*[\s\S]*?\*\/)/g,
    (match, captured) => {
      return captured !== undefined ? captured : '';
    }
  );
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

function loadConfig(argv = process.argv) {
  const configArg = argv.find((a) => a.startsWith('--config='));
  const configPath = configArg ? path.resolve(configArg.slice(9)) : defaultConfigPath();

  const fileConfig = loadFromFile(configPath);
  const envConfig = loadFromEnv();
  const cliConfig = loadFromCli(argv);

  return mergeLayers([DEFAULTS, fileConfig, envConfig, cliConfig]);
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
};
