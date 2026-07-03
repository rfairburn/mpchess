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
    // Single shared ordered buffer — all lines go here first.
    // nextRaw() takes any line; next() skips info/option lines.
    this._buffer = [];
    this._pending = null; // single pending reader for next()
    this._pendingRaw = null; // single pending reader for nextRaw()
    this._partial = '';  // carry-over for lines split across chunks
  }

  /** Spawn the Stockfish process. Resolves once the process is running. */
  spawn() {
    return new Promise((resolve, reject) => {
      this.proc = spawn(this.binaryPath, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.proc.on('error', (err) => {
        // Reject any pending reader
        if (this._pending) {
          const p = this._pending; this._pending = null;
          p.reject(err);
        } else if (this._pendingRaw) {
          const p = this._pendingRaw; this._pendingRaw = null;
          p.reject(err);
        } else {
          reject(err);
        }
      });

      // Line reader — all lines go into the shared buffer.
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
    // Try to resolve from the buffer immediately
    const found = this._tryResolveNext();
    if (found) return Promise.resolve(found);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this._pending === p) {
          this._pending = null;
          reject(new Error(`No response within ${timeoutMs}ms`));
        }
      }, timeoutMs);

      const p = {
        resolve: (line) => { clearTimeout(timer); resolve(line); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      };
      this._pending = p;
    });
  }

  /**
   * Try to resolve a next() call from the buffer.
   * Skips info/option/blank lines (leaves them for nextRaw()).
   * Returns the first non-filtered line if found, null otherwise.
   */
  _tryResolveNext() {
    while (this._buffer.length > 0) {
      const line = this._buffer[0];
      if (line === '' || line.startsWith('option ') || line.startsWith('info ')) {
        this._buffer.shift(); // discard filtered lines — next() doesn't want them
        continue;
      }
      this._buffer.shift();
      return line;
    }
    return null;
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

  /**
   * Read the next line from stdout without filtering info/option lines.
   * Useful for capturing evaluation scores from info lines.
   * Consumes from the same shared buffer as next().
   * @param {number} [timeoutMs=5000]
   * @returns {Promise<string>}
   */
  nextRaw(timeoutMs = 5000) {
    // Try to resolve from the buffer immediately
    if (this._buffer.length > 0) {
      return Promise.resolve(this._buffer.shift());
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this._pendingRaw === p) {
          this._pendingRaw = null;
          reject(new Error(`No raw response within ${timeoutMs}ms`));
        }
      }, timeoutMs);

      const p = {
        resolve: (line) => { clearTimeout(timer); resolve(line); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      };
      this._pendingRaw = p;
    });
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
    // If a raw reader is waiting, deliver to it (raw takes priority — it wants everything)
    if (this._pendingRaw) {
      const p = this._pendingRaw; this._pendingRaw = null;
      p.resolve(line);
      return;
    }
    // If a normal reader is waiting, try to satisfy it
    if (this._pending) {
      const filtered = (line === '' || line.startsWith('option ') || line.startsWith('info '));
      if (!filtered) {
        const p = this._pending; this._pending = null;
        p.resolve(line);
        return;
      }
      // Line is info/option — normal reader skips it, but we must keep it
      // in the buffer so nextRaw() can consume it
    }
    // Buffer the line
    this._buffer.push(line);
    // If a normal reader is waiting, try again now that we have a new line
    if (this._pending) {
      const found = this._tryResolveNext();
      if (found) {
        const p = this._pending; this._pending = null;
        p.resolve(found);
      }
    }
  }
}

module.exports = { UciTransport };
