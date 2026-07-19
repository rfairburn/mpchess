const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { Game } = require('./shared/chess');
const { setupWebSocketHandlers } = require('./server/ws-handlers');

// ═══════════════════════════════════════════════════════════
//  HTTP SERVER + WEBSOCKET (production entry point)
// ═══════════════════════════════════════════════════════════

const DEFAULT_HOST = '0.0.0.0';

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.stl': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

const CLIENT_ROOT = path.resolve(__dirname, 'client');

let _prefix = '';

function setPrefix(p) {
  if (!p) {
    _prefix = '';
    return;
  }
  const stripped = p.replace(/^\/+/, '').replace(/\/+$/, '');
  _prefix = stripped ? '/' + stripped : '';
}

const requestHandler = (req, res) => {
  let urlPath = req.url.split('?')[0];

  // Strip the configured prefix so the rest of the handler works unchanged.
  // e.g. "/chess/client/style.css" → "/client/style.css"
  if (_prefix && urlPath.startsWith(_prefix)) {
    urlPath = urlPath.slice(_prefix.length) || '/';
  }

  if (urlPath === '/') urlPath = '/client/index.html';

  // Only serve files from the client/ directory
  if (!urlPath.startsWith('/client/')) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const relativePath = urlPath.slice('/client/'.length);
  const safePath = path.normalize(relativePath);
  if (safePath.startsWith('..') || safePath.startsWith('/')) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  const filePath = path.resolve(CLIENT_ROOT, safePath);
  if (!filePath.startsWith(CLIENT_ROOT + path.sep) && filePath !== CLIENT_ROOT) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  if (!MIME[ext]) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    let content = fs.readFileSync(filePath);
    // Inject the correct base href for subpath deployments.
    // The HTML ships with <base href="/client/" /> — replace it when a prefix is set.
    if (ext === '.html' && _prefix) {
      content = content
        .toString('utf8')
        .replace('<base href="/client/" />', `<base href="${_prefix}/client/" />`)
        .replace('</head>', `<script>window.__mpchess_prefix="${_prefix}";</script></head>`);
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
};

// Build WebSocketServer options with security defaults.
// Exported for testing so tests can verify the production configuration.
function buildWssOptions(server, allowedOrigins = []) {
  const opts = { server, maxPayload: 1024 * 64 }; // 64 KB
  if (allowedOrigins.length > 0) {
    opts.verifyClient = (info, cb) => {
      const origin = info.req.headers.origin;
      if (!origin) {
        cb(true);
        return;
      }
      try {
        const url = new URL(origin);
        const ok = allowedOrigins.some((allowed) => {
          if (url.origin === allowed) return true;
          if (url.hostname === allowed) return true;
          return false;
        });
        cb(ok, ok ? 200 : 403);
      } catch {
        cb(false, 403);
      }
    };
  }
  return opts;
}

/**
 * Create a graceful shutdown handler for an HTTP server.
 * Quits the Stockfish engine (catching any errors), closes the server,
 * and exits the process. Force-exits after 5s if the server does not close.
 * The force-exit timer starts immediately so a hung engine cannot block
 * shutdown, but server.close() is deferred until the quit promise settles
 * so the child process is not orphaned.
 * @param {http.Server} server - The HTTP/HTTPS server to close
 * @returns {function(string): void} Signal handler
 */
function createGracefulShutdown(server) {
  return function gracefulShutdown(signal) {
    console.log(`\n${signal} received. Shutting down...`);
    const { getStockfishEngine: getEngine } = require('./shared/stockfish_engine');
    const eng = getEngine();

    // Start force-exit timer immediately so a hung engine cannot block shutdown.
    const forceExitTimer = setTimeout(() => process.exit(1), 5000);

    // Use Promise.resolve().then() so that a synchronous throw from eng.quit()
    // is caught (Promise.resolve(eng.quit()) would not catch a sync throw because
    // the call is evaluated before Promise.resolve runs).
    Promise.resolve()
      .then(() => eng.quit())
      .catch((err) => {
        console.error(`[Shutdown] Engine quit error: ${err.message}`);
      })
      .finally(() => {
        server.close(() => {
          clearTimeout(forceExitTimer);
          console.log('Server closed.');
          process.exit(0);
        });
      });
  };
}

if (require.main === module) {
  // CLI help (check before loading config)
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    require('./loadConfig'); // loaded for side effects
    console.log(`
Usage: node server.js [options]

Options:
  --help, -h              Show this help message
  --config=<path>         Config file path (default: config.jsonc, falls back to config.json)
  --fen=<fen_string>      Load a custom starting position (first game only;
                          restarts reset to standard setup)
  --init-halfmove-clock=<n>  Set initial halfmove clock for testing (e.g. 99 to
                              make the 50-move draw claim available immediately)
  --port=<number>         Port for the HTTP/WebSocket server
  --cert=<path>           TLS certificate file (enables HTTPS)
  --key=<path>            TLS private key file (required with --cert)
  --chain=<path>          TLS certificate chain file (optional, PEM format)
  --allowed-origins=<o1,o2>  Comma-separated list of allowed WebSocket origins
  --debug=<true|false>      Enable debug logging for piece rebuilding
  --prefix=<path>           URL prefix for subpath deployments (e.g. /chess)

  Computer player (Stockfish):
  --computer-enabled=<true|false>      Enable/disable computer player (default: true)
  --computer-stockfish-path=<path>    Path to Stockfish binary (auto-resolved if unset)
  --computer-spawn-timeout=<ms>       Max ms to wait for engine startup (default: 10000)
  --computer-move-timeout=<ms>       Max ms to wait for a move (default: 30000)
  --computer-skills=<json>            JSON string overriding skill-level presets

  Server tuning:
  --seat-timeout=<ms>          Reconnect seat reservation timeout (default: 60000)
  --join-timeout=<ms>          Join handshake completion timeout (default: 5000)
  --rate-limit-max=<n>         Max messages per rate-limit window (default: 60)
  --rate-limit-window=<ms>     Rate-limit sliding window duration (default: 10000)
  --slow-client-threshold=<bytes>  Slow-client buffered-amount threshold (default: 1048576)
  --min-move-delay=<ms>        Minimum delay between moves for animation (default: 500)
  --host=<address>             Listen address (default: 0.0.0.0)

Config sources (highest priority first):
  1. CLI arguments
  2. Environment variables (MPCHESS_PORT, MPCHESS_FEN, MPCHESS_INIT_HALFMOVE_CLOCK, MPCHESS_CERT,
     MPCHESS_KEY, MPCHESS_CHAIN, MPCHESS_ALLOWED_ORIGINS, MPCHESS_DEBUG,
     MPCHESS_PREFIX, MPCHESS_COMPUTER_ENABLED, MPCHESS_COMPUTER_STOCKFISH_PATH,
     MPCHESS_COMPUTER_SPAWN_TIMEOUT, MPCHESS_COMPUTER_MOVE_TIMEOUT,
     MPCHESS_COMPUTER_SKILLS, MPCHESS_SEAT_TIMEOUT, MPCHESS_JOIN_TIMEOUT,
     MPCHESS_RATE_LIMIT_MAX, MPCHESS_RATE_LIMIT_WINDOW, MPCHESS_SLOW_CLIENT_THRESHOLD,
     MPCHESS_MIN_MOVE_DELAY, MPCHESS_HOST)
  3. Config file (config.jsonc, config.json, or --config=<path>)
  4. Built-in defaults

Examples:
  node server.js
  node server.js --config=prod.json --port=8443
  node server.js --cert=server.crt --key=server.key
  node server.js --allowed-origins=games.devop.ninja,localhost
  node server.js --debug=true
  node server.js --computer-enabled=false
  node server.js --computer-stockfish-path=/usr/bin/stockfish --computer-move-timeout=60000
  MPCHESS_PORT=8080 node server.js
  MPCHESS_DEBUG=true node server.js
  MPCHESS_COMPUTER_ENABLED=false node server.js
  MPCHESS_COMPUTER_SKILLS='{"beginner":{"movetime":100}}' node server.js
  node server.js --seat-timeout=120000 --rate-limit-max=100
  MPCHESS_SEAT_TIMEOUT=30000 node server.js
  node server.js --host=127.0.0.1 --min-move-delay=1000
  MPCHESS_SLOW_CLIENT_THRESHOLD=2097152 node server.js
`);
    process.exit(0);
  }

  // Load merged config (CLI > config file > env vars > defaults)
  const { loadConfig } = require('./loadConfig');
  const config = loadConfig();
  const PORT = config.port;
  if (config.prefix) setPrefix(config.prefix);

  // TLS support
  let server;
  let protocol = 'http';

  if (config.cert && config.key) {
    try {
      const tlsOptions = {
        cert: fs.readFileSync(config.cert),
        key: fs.readFileSync(config.key),
      };
      if (config.chain) {
        tlsOptions.ca = fs.readFileSync(config.chain);
      }
      server = https.createServer(tlsOptions, requestHandler);
      protocol = 'https';
    } catch (e) {
      console.error(`TLS error: ${e.message}`);
      console.error('Falling back to HTTP.');
      server = http.createServer(requestHandler);
    }
  } else if (config.cert || config.key) {
    console.error('Warning: both --cert and --key are required for TLS. Running in HTTP mode.');
    server = http.createServer(requestHandler);
  } else {
    server = http.createServer(requestHandler);
  }

  // Origin checking for WebSocket connections
  const allowedOrigins = config.allowedOrigins;
  const wssOptions = buildWssOptions(server, allowedOrigins);

  const wss = new WebSocketServer(wssOptions);
  const game = new Game();

  // Optional: load a custom starting position from FEN
  if (config.fen) {
    try {
      game.loadFromFen(config.fen);
      console.log(`Loaded starting position from FEN: ${game.currentFen()}`);
    } catch (e) {
      console.error(`Invalid FEN: ${e.message}`);
      process.exit(1);
    }
  }

  // Optional: set initial halfmove clock for testing (e.g., 50-move rule)
  if (config.initHalfmoveClock != null && config.initHalfmoveClock > 0) {
    game.halfmoveClock = config.initHalfmoveClock;
    console.log(`Set initial halfmove clock to ${config.initHalfmoveClock}`);
  }

  setupWebSocketHandlers(wss, game, {
    debug: config.debug,
    computerPlayer: config.computerPlayer,
    seatTimeout: config.seatTimeout,
    joinTimeoutMs: config.joinTimeout,
    rateLimitMax: config.rateLimitMax,
    rateLimitWindow: config.rateLimitWindow,
    slowClientThreshold: config.slowClientThreshold,
    minMoveDelay: config.minMoveDelay,
  });

  // Graceful shutdown: quit Stockfish engine
  const shutdownHandler = createGracefulShutdown(server);
  process.on('SIGTERM', () => shutdownHandler('SIGTERM'));
  process.on('SIGINT', () => shutdownHandler('SIGINT'));

  const HOST = config.host || DEFAULT_HOST;

  server.listen(PORT, HOST, () => {
    const os = require('os');
    const ifaces = os.networkInterfaces();
    const ips = [];
    for (const name of Object.keys(ifaces)) {
      for (const iface of ifaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
      }
    }
    console.log(`Chess server running on ${HOST}:${PORT} (${protocol})`);
    console.log(`Local:   ${protocol}://localhost:${PORT}`);
    for (const ip of ips) console.log(`LAN:     ${protocol}://${ip}:${PORT}`);
  });
}

// Exported for testing
module.exports = {
  setupWebSocketHandlers,
  requestHandler,
  MIME,
  CLIENT_ROOT,
  buildWssOptions,
  createGracefulShutdown,
};
