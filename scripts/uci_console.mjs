// Stockfish UCI console — configurable, shows raw output.
// Usage: node scripts/uci_console.mjs [OPTIONS]
//
// Options:
//   --stockfish=PATH   Path to Stockfish binary
//   --fen=FEN          Starting FEN position
//   --skill=N          Skill level 0–20
//   --threads=N        Threads
//   --hash=N           Hash MB
//   --movetime=MS      Per-move time limit ms
//   --depth=N          Depth limit
//   --moves=N          Moves to play
//   --raw              Show all raw UCI output (including info/option lines)

import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const requireCJS = createRequire(import.meta.url);
const { UciTransport } = requireCJS('../shared/uci.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── Parse args ────────────────────────────────────────────
const cfg = {
  stockfish: null,
  fen: 'startpos',
  skill: 20,
  threads: 1,
  hash: 16,
  movetime: 2000,
  depth: null,
  moves: 1,
  raw: false,
};

for (const arg of process.argv.slice(2)) {
  const eq = arg.indexOf('=');
  if (eq === -1) {
    if (arg === '--raw') cfg.raw = true;
    continue;
  }
  const key = arg.slice(0, eq).replace(/^--/, '');
  const val = arg.slice(eq + 1);
  switch (key) {
    case 'stockfish':
      cfg.stockfish = val;
      break;
    case 'fen':
      cfg.fen = val;
      break;
    case 'skill':
      cfg.skill = parseInt(val, 10);
      break;
    case 'threads':
      cfg.threads = parseInt(val, 10);
      break;
    case 'hash':
      cfg.hash = parseInt(val, 10);
      break;
    case 'movetime':
      cfg.movetime = parseInt(val, 10);
      break;
    case 'depth':
      cfg.depth = parseInt(val, 10);
      break;
    case 'moves':
      cfg.moves = parseInt(val, 10);
      break;
  }
}

// ── Resolve Stockfish binary ──────────────────────────────
// Priority: (1) --stockfish arg  (2) MPCHESS_STOCKFISH env var  (3) built binary  (4) PATH
function findStockfish() {
  if (cfg.stockfish && existsSync(cfg.stockfish)) return cfg.stockfish;

  const env = process.env.MPCHESS_STOCKFISH;
  if (env && existsSync(env)) return env;

  const built = resolve(ROOT, 'stockfish', 'bin', 'stockfish');
  if (existsSync(built)) return built;

  try {
    const { execSync } = requireCJS('node:child_process');
    const which = execSync('which stockfish 2>/dev/null || command -v stockfish 2>/dev/null', {
      encoding: 'utf8',
    }).trim();
    if (which && existsSync(which)) return which;
  } catch {
    // stockfish not on PATH
  }

  return null;
}

// Build a UCI position command from the configured FEN and accumulated moves.
function posCmd(moves) {
  if (cfg.fen === 'startpos') {
    return moves ? `position startpos moves ${moves}` : 'position startpos';
  }
  return moves ? `position fen ${cfg.fen} moves ${moves}` : `position fen ${cfg.fen}`;
}

const SF = findStockfish();
if (!SF) {
  console.error('ERROR: Stockfish binary not found.');
  console.error('  Build: bash scripts/build_stockfish.sh');
  console.error('  Or set --stockfish=PATH or MPCHESS_STOCKFISH=PATH');
  process.exit(1);
}

// ── Raw reader (no filtering, echoes all output) ──────────
function rawReader(stdout) {
  let partial = '';
  const buf = [];
  const waiting = [];

  stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
    const text = partial + chunk.toString();
    partial = '';
    const lines = text.split(/\r?\n/);
    if (lines[lines.length - 1] === '') {
      lines.pop();
    } else {
      partial = lines.pop();
    }
    for (const line of lines) {
      if (waiting.length > 0) waiting.shift()(line);
      else buf.push(line);
    }
  });

  return {
    next(timeoutMs = 10000) {
      if (buf.length > 0) return Promise.resolve(buf.shift());
      return new Promise((done, fail) => {
        const t = setTimeout(() => fail(new Error(`timeout ${timeoutMs}ms`)), timeoutMs);
        waiting.push((line) => {
          clearTimeout(t);
          done(line);
        });
      });
    },
  };
}

// ── Main ──────────────────────────────────────────────────
async function main() {
  console.log('=== Stockfish UCI Console ===');
  console.log(`Binary : ${SF}`);
  console.log(`FEN    : ${cfg.fen}`);
  console.log(`Skill  : ${cfg.skill}`);
  console.log(`Threads: ${cfg.threads}`);
  console.log(`Hash   : ${cfg.hash} MB`);
  console.log(`Go     : movetime ${cfg.movetime}${cfg.depth ? ` depth ${cfg.depth}` : ''}`);
  console.log(`Moves  : ${cfg.moves}`);
  console.log(`Raw    : ${cfg.raw ? 'yes (all output)' : 'no (filtered)'}`);
  console.log();

  if (cfg.raw) {
    await runRaw();
  } else {
    await runFiltered();
  }
}

async function runFiltered() {
  const uci = new UciTransport(SF);
  await uci.spawn();

  try {
    // Handshake
    uci.send('uci');
    await uci.next(); // banner
    await uci.next(); // id name
    await uci.next(); // id author
    await uci.next(); // uciok (option lines filtered)

    uci.send('isready');
    await uci.next(); // readyok

    // Configure
    uci.send(`setoption name Skill Level value ${cfg.skill}`);
    uci.send(`setoption name Threads value ${cfg.threads}`);
    uci.send(`setoption name Hash value ${cfg.hash}`);

    // Build go command
    let goCmd = `go movetime ${cfg.movetime}`;
    if (cfg.depth) goCmd += ` depth ${cfg.depth}`;

    // Play moves
    let moves = '';
    for (let i = 0; i < cfg.moves; i++) {
      console.log(`--- Move ${i + 1}/${cfg.moves} ---`);
      uci.send(posCmd(moves));
      uci.send(goCmd);
      const bestmove = await uci.next(15000);
      const parts = bestmove.split(' ');
      console.log(`→ ${bestmove}`);
      if (parts[0] === 'bestmove' && parts[1]) {
        moves = moves ? `${moves} ${parts[1]}` : parts[1];
      }
    }
  } finally {
    await uci.quit();
  }
}

async function runRaw() {
  const sf = spawn(SF, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  const r = rawReader(sf.stdout);
  sf.stderr.on('data', (c) => process.stderr.write(c));

  function send(cmd) {
    sf.stdin.write(`${cmd}\n`);
  }

  // Handshake
  send('uci');
  let line;
  do {
    line = await r.next();
  } while (line !== 'uciok');

  send('isready');
  await r.next(5000);

  // Configure
  send(`setoption name Skill Level value ${cfg.skill}`);
  send(`setoption name Threads value ${cfg.threads}`);
  send(`setoption name Hash value ${cfg.hash}`);

  // Build go command
  let goCmd = `go movetime ${cfg.movetime}`;
  if (cfg.depth) goCmd += ` depth ${cfg.depth}`;

  // Play moves
  let moves = '';
  for (let i = 0; i < cfg.moves; i++) {
    send(posCmd(moves));
    send(goCmd);
    // Loop until we get a bestmove line (info lines are echoed but skipped).
    let line;
    do {
      line = await r.next(15000);
    } while (!line.startsWith('bestmove'));
    const parts = line.split(' ');
    if (parts[0] === 'bestmove' && parts[1]) {
      moves = moves ? `${moves} ${parts[1]}` : parts[1];
    }
  }

  send('quit');
  await new Promise((d) => {
    sf.on('close', d);
    setTimeout(d, 3000);
  });
}

main().catch((err) => {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});
