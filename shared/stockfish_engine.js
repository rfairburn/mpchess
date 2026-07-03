// ═══════════════════════════════════════════════════════════
//  STOCKFISH ENGINE — singleton wrapper around UciTransport
//  Manages spawn, respawn, skill configuration, and move execution.
// ═══════════════════════════════════════════════════════════

const path = require('path');
const fs = require('fs');
const { UciTransport } = require('./uci');

const SKILL_DEFAULTS = {
  beginner: { skillLevel: 0, threads: 1, hash: 16, movetime: 200, depth: 3 },
  novice: { skillLevel: 0, threads: 1, hash: 16, movetime: 500, depth: 5 },
  intermediate: { skillLevel: 8, threads: 1, hash: 32, movetime: 1500, depth: 12 },
  advanced: { skillLevel: 14, threads: 1, hash: 64, movetime: 3000, depth: 18 },
  master: { skillLevel: 18, threads: 2, hash: 128, movetime: 5000, depth: 24 },
  grandmaster: { skillLevel: 20, threads: 2, hash: 256, movetime: 10000 },
};

/**
 * Resolve the Stockfish binary path.
 * Priority: env var > built binary > PATH
 */
function resolveBinary(configPath) {
  // 1. Explicit config path
  if (configPath) {
    if (fs.existsSync(configPath)) return configPath;
  }

  // 2. Built binary (relative to project root)
  const builtPath = path.resolve(__dirname, '..', 'stockfish', 'bin', 'stockfish');
  if (fs.existsSync(builtPath)) return builtPath;

  // 3. On PATH — check common locations
  const pathDirs = process.env.PATH?.split(path.delimiter) || [];
  for (const dir of pathDirs) {
    const candidate = path.join(dir, process.platform === 'win32' ? 'stockfish.exe' : 'stockfish');
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

class StockfishEngine {
  constructor(config = {}) {
    this.binaryPath = resolveBinary(config.stockfishPath);
    this.spawnTimeout = config.spawnTimeout ?? 10000;
    this.moveTimeout = config.moveTimeout ?? 30000;
    this.skills = { ...SKILL_DEFAULTS, ...(config.skills || {}) };
    this.transport = null;
    this.available = false;
    this._currentSkill = null;
  }

  /** Check if the engine is available and ready. */
  get isReady() {
    return this.available && this.transport && this.transport.proc && this.transport.proc.exitCode === null;
  }

  /**
   * Spawn the Stockfish process and complete the UCI handshake.
   * Resolves when the engine responds to `isready` with `readyok`.
   */
  async spawn() {
    if (!this.binaryPath) {
      throw new Error('Stockfish binary not found');
    }

    if (this.transport) {
      // Already running — just reconfigure
      this.available = true;
      return;
    }

    this.transport = new UciTransport(this.binaryPath);
    await this.transport.spawn();

    // UCI handshake
    this.transport.send('uci');
    // Consume id lines and option lines until we get uciok.
    // readUntil re-buffers non-matching lines, but id/name and id/author
    // would cause an infinite loop, so drain them explicitly first.
    let uciOk = null;
    const deadline = Date.now() + this.spawnTimeout;
    while (Date.now() < deadline) {
      const line = await this.transport.next(Math.max(100, deadline - Date.now()));
      if (line.startsWith('uciok')) {
        uciOk = line;
        break;
      }
      // Discard id name, id author, option lines — they're already filtered
      // by _dispatch for option/info, but id lines pass through
    }
    if (!uciOk) {
      throw new Error(`Did not receive uciok within ${this.spawnTimeout}ms`);
    }

    this.transport.send('isready');
    const ready = await this.transport.next(this.spawnTimeout);
    if (!ready.startsWith('readyok')) {
      throw new Error(`Engine not ready: ${ready}`);
    }

    this.available = true;
  }

  /**
   * Configure the engine for a given skill level.
   * Note: setoption commands are fire-and-forget — Stockfish does not
   * send a response line for them, so we don't await next().
   */
  async setSkill(skillName) {
    const skill = this.skills[skillName];
    if (!skill) {
      throw new Error(`Unknown skill level: ${skillName}`);
    }
    this._currentSkill = skillName;

    if (!this.isReady) return;

    this.transport.send(`setoption name Threads value ${skill.threads}`);
    this.transport.send(`setoption name Hash value ${skill.hash}`);
    this.transport.send(`setoption name Skill Level value ${skill.skillLevel}`);
  }

  /**
   * Request the best move for the current position.
   * @param {string} fen - Current FEN string
   * @param {string} skillName - Skill level key
   * @returns {Promise<string>} The bestmove in UCI notation (e.g. "e2e4")
   */
  async getBestMove(fen, skillName) {
    const skill = this.skills[skillName];
    if (!skill) {
      throw new Error(`Unknown skill level: ${skillName}`);
    }

    if (!this.isReady) {
      throw new Error('Stockfish engine is not ready');
    }

    // Set position
    this.transport.send(`position fen ${fen}`);

    // Build go command
    let goCmd = `go movetime ${skill.movetime}`;
    if (skill.depth) {
      goCmd += ` depth ${skill.depth}`;
    }
    this.transport.send(goCmd);

    // Wait for bestmove
    const response = await this.transport.readUntil('bestmove', this.moveTimeout);
    const parts = response.split(' ');
    return parts[1]; // UCI move notation (e.g. "e2e4")
  }

  /**
   * Evaluate the current position and return the score in centipawns.
   * Positive = advantage for side to move, negative = disadvantage.
   * Returns null if the engine is not available.
   * @param {string} fen - Current FEN string
   * @returns {Promise<number|null>} Score in centipawns, or null if unavailable
   */
  async getEvaluation(fen) {
    if (!this.isReady) {
      return null;
    }

    this.transport.send(`position fen ${fen}`);
    this.transport.send('go movetime 500');

    let lastScore = null;
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const line = await this.transport.nextRaw(Math.max(100, deadline - Date.now()));
      if (line.startsWith('bestmove')) {
        break;
      }
      // Parse info line for score
      if (line.startsWith('info ') && line.includes('score ')) {
        const scoreMatch = line.match(/score (cp|mate) (-?\d+)/);
        if (scoreMatch) {
          const type = scoreMatch[1];
          const value = parseInt(scoreMatch[2], 10);
          if (type === 'cp') {
            lastScore = value;
          } else {
            // Mate in N — treat as very large score
            lastScore = value > 0 ? 10000 : -10000;
          }
        }
      }
    }
    return lastScore;
  }

  /**
   * Gracefully shut down the Stockfish process.
   */
  async quit() {
    if (!this.transport) return;
    try {
      await this.transport.quit();
    } catch {
      // Ignore errors during quit
    }
    this.transport = null;
    this.available = false;
    this._currentSkill = null;
  }

  /**
   * Force kill the process (emergency).
   */
  kill() {
    if (this.transport?.proc) {
      try { this.transport.proc.kill('SIGKILL'); } catch {}
    }
    this.transport = null;
    this.available = false;
    this._currentSkill = null;
  }
}

// Singleton instance
let _instance = null;

/**
 * Get or create the singleton StockfishEngine.
 */
function getStockfishEngine(config = {}) {
  if (!_instance) {
    _instance = new StockfishEngine(config);
  }
  return _instance;
}

/**
 * Reset the singleton (for testing).
 */
function resetStockfishEngine() {
  if (_instance) {
    _instance.kill();
    _instance = null;
  }
}

module.exports = {
  StockfishEngine,
  getStockfishEngine,
  resetStockfishEngine,
  resolveBinary,
  SKILL_DEFAULTS,
};
