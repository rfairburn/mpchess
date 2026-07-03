// ═══════════════════════════════════════════════════════════
//  UCI TRANSPORT — bidirectional stdio driver for Stockfish
//  Used by: scripts/test_stockfish.mjs, future StockfishEngine
// ═══════════════════════════════════════════════════════════

const { spawn } = require('node:child_process');

/**
 * UciTransport manages a Stockfish subprocess over stdin/stdout.
 *
 *   const uci = new UciTransport('/path/to/stockfish');
 *   await uci.spawn();
 *   uci.send('uci');
 *   const line = await uci.next();   // "id name Stockfish 18"
 *   // ...
 *   await uci.quit();
 */
class UciTransport {
  constructor(binaryPath) {
    this.binaryPath = binaryPath;
    this.proc = null;
    this._buffer = [];
    this._pending = [];
    this._partial = '';  // carry-over for lines split across chunks
  }

  /** Spawn the Stockfish process. Resolves once the process is running. */
  spawn() {
    return new Promise((resolve, reject) => {
      this.proc = spawn(this.binaryPath, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.proc.on('error', (err) => {
        if (this._pending.length > 0) {
          this._pending.shift().reject(err);
        } else {
          reject(err);
        }
      });

      // Line reader — filters out informational UCI output.
      // Keeps a carry-over string so lines split across chunks are handled correctly.
      this.proc.stdout.on('data', (chunk) => {
        const text = this._partial + chunk.toString();
        this._partial = '';
        const lines = text.split(/\r?\n/);
        // If the chunk ended with a newline, the last element is empty — all lines are complete.
        // Otherwise the last element is a partial line; carry it over.
        if (lines[lines.length - 1] === '') {
          lines.pop();
        } else {
          this._partial = lines.pop();
        }
        for (const line of lines) {
          this._dispatch(line);
        }
      });

      // Drain stderr (Stockfish writes some info lines there)
      this.proc.stderr.on('data', () => {});

      resolve();
    });
  }

  /** Send a UCI command (newline-terminated). */
  send(cmd) {
    if (!this.proc || this.proc.stdin.destroyed) {
      throw new Error('Stockfish process is not running');
    }
    this.proc.stdin.write(`${cmd}\n`);
  }

  /**
   * Read the next meaningful response line.
   * Skips blank lines, `option ...` listings, and `info ...` lines.
   * @param {number} [timeoutMs=5000]
   * @returns {Promise<string>}
   */
  next(timeoutMs = 5000) {
    if (this._buffer.length > 0) return Promise.resolve(this._buffer.shift());

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this._pending.indexOf(p);
        if (idx !== -1) this._pending.splice(idx, 1);
        reject(new Error(`No response within ${timeoutMs}ms`));
      }, timeoutMs);

      const p = {
        resolve: (line) => { clearTimeout(timer); resolve(line); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      };
      this._pending.push(p);
    });
  }

  /**
   * Read lines until one starts with the given prefix.
   * Non-matching lines (that aren't filtered) are re-buffered.
   * @param {string} prefix
   * @param {number} [timeoutMs=10000]
   * @returns {Promise<string>}
   */
  async readUntil(prefix, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const line = await this.next(Math.min(timeoutMs, deadline - Date.now()));
      if (line.startsWith(prefix)) return line;
      // Re-buffer non-matching lines so they aren't lost
      this._buffer.unshift(line);
    }
    throw new Error(`Did not receive "${prefix}..." within ${timeoutMs}ms`);
  }

  /** Quit the Stockfish process via UCI and wait for exit. */
  async quit() {
    if (!this.proc) return;
    this.send('quit');
    return new Promise((resolve) => {
      if (this.proc.exitCode !== null) return resolve(this.proc.exitCode);
      this.proc.on('close', (code) => resolve(code));
      // Safety: force-kill after 3 s
      setTimeout(() => {
        try { this.proc.kill('SIGKILL'); } catch {}
        resolve(null);
      }, 3000);
    });
  }

  // ── internal ───────────────────────────────────────────────

  _dispatch(line) {
    // Filter informational lines that are not command responses.
    if (line === '' || line.startsWith('option ') || line.startsWith('info ')) {
      return;
    }
    if (this._pending.length > 0) {
      this._pending.shift().resolve(line);
    } else {
      this._buffer.push(line);
    }
  }
}

module.exports = { UciTransport };
