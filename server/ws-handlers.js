const crypto = require('crypto');
const { validateFenForEngine, fromFen } = require('../shared/chess');
const { getStockfishEngine } = require('../shared/stockfish_engine');

// ═══════════════════════════════════════════════════════════
//  WEBSOCKET HANDLER SETUP (extracted for testability)
// ═══════════════════════════════════════════════════════════

function setupWebSocketHandlers(wss, game, options = {}) {
  const seatTimeout = options.seatTimeout != null ? options.seatTimeout : 60_000;
  const joinTimeoutMs = options.joinTimeoutMs != null ? options.joinTimeoutMs : 5000;

  // Rate limiter config: max messages per window (ms)
  const rateLimitMax = options.rateLimitMax != null ? options.rateLimitMax : 60;
  const rateLimitWindow = options.rateLimitWindow != null ? options.rateLimitWindow : 10_000;

  const sessions = new Map();
  const disconnectedPlayers = new Map();
  // Per-IP sliding window: ip -> number[] of timestamps
  const rateLimitBuckets = new Map();
  let bothDisconnectedTimer = null;

  const SLOW_CLIENT_THRESHOLD =
    options.slowClientThreshold != null ? options.slowClientThreshold : 1 * 1024 * 1024; // 1 MB

  // Debug mode
  const DEBUG = options.debug || false;

  // ── Computer player state ──
  const computerPlayerEnabled = options.computerPlayer?.enabled !== false;
  let computerColor = null; // 'white' | 'black' | null
  let computerSkill = null; // skill level key
  const engine = getStockfishEngine(options.computerPlayer || {});

  // Monotonic game revision — increments on every board/state change.
  // Used to detect stale engine results: if the revision changed while
  // Stockfish was thinking, the result is discarded even if the FEN matches.
  let gameRevision = 0;

  function bumpRevision() {
    gameRevision++;
  }

  // ── Draw offer state ──
  let drawOffer = null; // { from: ws, to: ws } or null

  function debugLog(...args) {
    if (DEBUG) {
      console.log('[DEBUG]', ...args);
    }
  }

  function isClientSlow(ws) {
    return ws.bufferedAmount > SLOW_CLIENT_THRESHOLD;
  }

  function broadcast(data, excludeWs) {
    const msg = JSON.stringify(data);
    for (const c of wss.clients) {
      if (c !== excludeWs && c.readyState === 1 && !isClientSlow(c)) {
        c.send(msg);
      }
    }
  }

  function broadcastDebug(data, excludeWs) {
    if (!DEBUG) return;
    const msg = JSON.stringify({ type: 'debug', ...data });
    for (const c of wss.clients) {
      if (c !== excludeWs && c.readyState === 1 && !isClientSlow(c)) {
        c.send(msg);
      }
    }
  }

  function send(ws, data) {
    if (ws.readyState === 1 && !isClientSlow(ws)) {
      ws.send(JSON.stringify(data));
    }
  }

  function getRole(ws) {
    if (game.players.has(ws)) return game.players.get(ws);
    if (game.spectators.has(ws)) return 'spectator';
    return null;
  }

  // ── Minimum delay between moves ──
  // Ensures at least 500ms between moves so client animations finish.
  // Human moves broadcast immediately and update the timestamp.
  // Computer moves delay the entire server-side handling (tryMove + broadcast)
  // if < 500ms since the last move was broadcast.
  const MIN_MOVE_DELAY = options.minMoveDelay != null ? options.minMoveDelay : 500;
  let lastMoveTime = -MIN_MOVE_DELAY;

  function remainingMoveDelay() {
    const elapsed = Date.now() - lastMoveTime;
    return Math.max(0, MIN_MOVE_DELAY - elapsed);
  }

  function noteMoveBroadcast() {
    lastMoveTime = Date.now();
  }

  // ── Rate limiter (sliding window per IP) ──
  // Buckets are never deleted on rejection or disconnect — timestamps
  // naturally expire as they slide out of the window. A periodic sweep
  // removes buckets whose oldest entry has expired, preventing unbounded growth.

  function pruneBucket(bucket) {
    const now = Date.now();
    while (bucket.length > 0 && bucket[0] <= now - rateLimitWindow) {
      bucket.shift();
    }
  }

  function sweepStaleBuckets() {
    for (const [ip, bucket] of rateLimitBuckets) {
      pruneBucket(bucket);
      if (bucket.length === 0) {
        rateLimitBuckets.delete(ip);
      }
    }
  }

  // Run sweep every rateLimitWindow to clean up expired buckets
  const sweepInterval = setInterval(sweepStaleBuckets, rateLimitWindow);
  // Don't let the interval keep the process alive
  if (sweepInterval.unref) sweepInterval.unref();

  function checkRateLimit(ws) {
    const now = Date.now();
    const clientIp = ws._socket?.remoteAddress || 'unknown';
    let bucket = rateLimitBuckets.get(clientIp);
    if (!bucket) {
      bucket = [];
      rateLimitBuckets.set(clientIp, bucket);
    }
    pruneBucket(bucket);
    if (bucket.length >= rateLimitMax) {
      const retryAfter = Math.ceil((bucket[0] - (now - rateLimitWindow)) / 1000);
      return { allowed: false, retryAfter: Math.max(1, retryAfter) };
    }
    bucket.push(now);
    return { allowed: true };
  }

  function buildDisconnectedPlayersArray() {
    const arr = [];
    for (const [token, entry] of disconnectedPlayers) {
      arr.push({ color: entry.color, token, disconnectedAt: entry.disconnectedAt });
    }
    return arr;
  }

  function seatStatusForColor(color, clientWs) {
    // Check if occupied by computer player
    if (computerColor === color) {
      return { status: 'computer', skill: computerSkill };
    }
    // Check if actively occupied
    let occupiedWs = null;
    for (const [ws, c] of game.players) {
      if (c === color) {
        occupiedWs = ws;
        break;
      }
    }
    if (occupiedWs) {
      const clientSession = sessions.get(clientWs);
      const occupiedSession = sessions.get(occupiedWs);
      const clientToken = clientSession?.token;
      const canReconnect = !!(clientToken && occupiedSession?.token === clientToken);
      return { status: 'occupied', canReconnect };
    }
    // Check if held by disconnected player
    let heldEntry = null;
    let heldToken = null;
    for (const [token, entry] of disconnectedPlayers) {
      if (entry.color === color) {
        heldEntry = entry;
        heldToken = token;
        break;
      }
    }
    if (heldEntry) {
      const freesAt = heldEntry.disconnectedAt + seatTimeout;
      const clientSession = sessions.get(clientWs);
      const clientToken = clientSession?.token;
      const canReconnect = clientToken === heldToken;
      return {
        status: 'held',
        freesAt,
        remaining: Math.max(0, freesAt - Date.now()),
        canReconnect,
      };
    }
    return { status: 'free', canReconnect: false };
  }

  function buildSeatStatus(clientWs) {
    const seats = {};
    for (const color of ['white', 'black']) {
      seats[color] = seatStatusForColor(color, clientWs);
    }
    return seats;
  }

  function sendState(ws) {
    const role = getRole(ws);
    const state = game.getState();
    send(ws, {
      type: 'state',
      role,
      seats: buildSeatStatus(ws),
      disconnectedPlayers: buildDisconnectedPlayersArray(),
      computerPlayer: computerColor ? { color: computerColor, skill: computerSkill } : null,
      debug: DEBUG,
      ...state,
    });
  }

  function broadcastState(excludeWs) {
    // Slow-client guard is explicit here (matching broadcast/broadcastDebug)
    // and also present in send() as a belt-and-suspenders check.
    for (const c of wss.clients) {
      if (c !== excludeWs && c.readyState === 1 && !isClientSlow(c)) sendState(c);
    }
  }

  function bothDisconnected() {
    return disconnectedPlayers.size > 0 && game.players.size === 0;
  }

  function maybeStartBothDisconnectedTimer() {
    if (bothDisconnectedTimer) return;
    if (!bothDisconnected()) return;
    bothDisconnectedTimer = setTimeout(() => {
      bothDisconnectedTimer = null;
      // Guard: if someone joined while timer was running, don't wipe them out
      if (game.players.size > 0) return;
      // Evict computer player on full reset
      evictComputerPlayer();
      // Clear any session entries whose token matches a held disconnected-player token
      const heldTokens = new Set(disconnectedPlayers.keys());
      for (const [ws, session] of sessions) {
        if (heldTokens.has(session.token)) {
          sessions.delete(ws);
        }
      }
      // Clear all disconnected player entries
      disconnectedPlayers.clear();
      game.reset();
      broadcastState();
      for (const c of wss.clients) {
        if (c.readyState === 1 && game.spectators.has(c)) {
          send(c, { type: 'gameAvailable' });
        }
      }
    }, seatTimeout);
  }

  function stopBothDisconnectedTimer() {
    if (bothDisconnectedTimer) {
      clearTimeout(bothDisconnectedTimer);
      bothDisconnectedTimer = null;
    }
  }

  function freeDisconnectedSeat(token) {
    const entry = disconnectedPlayers.get(token);
    if (!entry) return;
    disconnectedPlayers.delete(token);
    stopBothDisconnectedTimer();
    broadcastState();
  }

  function finishReconnect(ws, color, token) {
    game.players.set(ws, color);
    sessions.set(ws, { token, color });
    send(ws, { type: 'reconnected', color });
    broadcastState();
  }

  function handleReconnect(ws, data) {
    const wasSpectator = game.spectators.has(ws);
    game.spectators.delete(ws);

    // 1) Reconnect to a held seat (player was disconnected)
    const held = disconnectedPlayers.get(data.token);
    if (held) {
      stopBothDisconnectedTimer();
      disconnectedPlayers.delete(data.token);
      finishReconnect(ws, held.color, data.token);
      return true;
    }

    // 2) Transfer active session (browser refresh while still connected)
    for (const [oldWs, session] of sessions) {
      if (session.token === data.token) {
        game.players.delete(oldWs);
        game.spectators.delete(oldWs);
        sessions.delete(oldWs);
        if (oldWs.readyState === 1) oldWs.close();
        finishReconnect(ws, session.color, data.token);
        return true;
      }
    }

    send(ws, { type: 'reconnectFailed', reason: 'Seat no longer available' });
    if (wasSpectator) game.spectators.add(ws);
    return false;
  }

  function handleDropPlayer(ws, data) {
    const callerColor = game.players.get(ws);
    if (!callerColor) return;

    const entry = disconnectedPlayers.get(data.token);
    if (!entry) return;

    // Only allow dropping the opponent's seat
    const opponentColor = callerColor === 'white' ? 'black' : 'white';
    if (entry.color !== opponentColor) return;

    // Enforce the seat timeout server-side
    if (Date.now() < entry.disconnectedAt + seatTimeout) {
      send(ws, { type: 'error', reason: 'Seat is still reserved for reconnect' });
      return;
    }

    freeDisconnectedSeat(data.token);
    send(ws, { type: 'playerDropped', color: entry.color });
  }

  function isColorFree(color) {
    return seatStatusForColor(color).status === 'free';
  }

  // ── Computer player helpers ──

  function evictComputerPlayer() {
    if (!computerColor) return;
    computerColor = null;
    computerSkill = null;
    bumpRevision();
  }

  async function executeComputerMove() {
    if (!computerColor || game.gameOver) return;
    if (game.turn !== computerColor) return;

    const thinkingColor = computerColor;

    try {
      // Ensure engine is running
      if (!engine.isReady) {
        try {
          await engine.spawn();
        } catch (err) {
          console.error(`[Stockfish] Failed to spawn: ${err.message}`);
          broadcast({
            type: 'computerUnavailable',
            color: thinkingColor,
            reason: 'Engine failed to start',
          });
          return;
        }
      }

      // Configure skill
      if (computerSkill) {
        await engine.setSkill(computerSkill);
      }

      // Notify clients that computer is thinking
      broadcast({ type: 'computerThinking', color: thinkingColor });

      // Get the best move from Stockfish
      const requestFen = game.currentFen();
      const requestRevision = gameRevision;
      const uciMove = await engine.getBestMove(requestFen, computerSkill);

      // Guard: game may have changed while Stockfish was thinking
      if (!computerColor || game.gameOver || game.turn !== thinkingColor) return;
      if (gameRevision !== requestRevision) return; // state changed (restart, FEN import, etc.)

      // Delay so client animations from the previous move have time to finish.
      // Stockfish usually takes well over 500ms, so this rarely adds extra wait.
      const delay = remainingMoveDelay();
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      // Guard again after the delay
      if (!computerColor || game.gameOver || game.turn !== thinkingColor) return;
      if (gameRevision !== requestRevision) return;

      // Validate UCI move before parsing — Stockfish returns "0000" for no legal moves
      if (!uciMove || uciMove.length < 4 || uciMove === '0000') {
        console.error(
          `[Stockfish] Invalid bestmove response: "${uciMove}"; marking ${thinkingColor} unavailable`
        );
        broadcast({
          type: 'computerUnavailable',
          color: thinkingColor,
          reason: 'Engine returned an invalid move',
        });
        return;
      }

      // Parse UCI move (e.g. "e2e4" → fromFile=4, fromRank=1, toFile=4, toRank=3)
      const fromFile = uciMove.charCodeAt(0) - 97;
      const fromRank = parseInt(uciMove[1]) - 1;
      const toFile = uciMove.charCodeAt(2) - 97;
      const toRank = parseInt(uciMove[3]) - 1;

      // Create a virtual ws for the computer player so tryMove works.
      // Must remain registered through completePromotion() because it validates
      // this.players.get(ws) against the promoting piece's color.
      const virtualWs = { _computer: true, color: thinkingColor };

      /**
       * Apply a parsed UCI move for the computer player.
       * Registers virtualWs, attempts the move (with optional queen promotion),
       * broadcasts the result, and cleans up virtualWs.
       * @returns {boolean} true if the move was applied successfully
       */
      function applyMove(fromFile, fromRank, toFile, toRank) {
        game.players.set(virtualWs, thinkingColor);
        try {
          const result = game.tryMove(virtualWs, fromFile, fromRank, toFile, toRank);
          if (!result.ok) {
            return false;
          }

          // Handle promotion if needed — virtualWs must still be in game.players
          let promotedPieceType = null;
          if (result.promotion) {
            // For computer, always promote to queen
            const promoOk = game.completePromotion(virtualWs, 'queen');
            if (promoOk) {
              promotedPieceType = 'queen';
            }
          }

          bumpRevision();
          noteMoveBroadcast();
          broadcast({ type: 'move', ...result, color: thinkingColor });
          if (promotedPieceType) {
            broadcast({
              type: 'promotion',
              pieceType: promotedPieceType,
              color: thinkingColor,
              file: result.toFile,
              rank: result.toRank,
            });
          }
          broadcastState();
          return true;
        } finally {
          game.players.delete(virtualWs);
        }
      }

      let moveApplied = applyMove(fromFile, fromRank, toFile, toRank);
      if (!moveApplied) {
        debugLog('Computer move failed, will retry', { uciMove });
      }

      if (!moveApplied) {
        // Retry up to 2 more times — engine calls outside inner catch so
        // ENOENT / crash errors propagate to the outer engine-error handler.
        for (let retry = 0; retry < 2; retry++) {
          const retryFen = game.currentFen();
          const retryRevision = gameRevision;
          const retryMove = await engine.getBestMove(retryFen, computerSkill);
          // Guard: state may have changed during the retry await
          if (!computerColor || game.gameOver || game.turn !== thinkingColor) return;
          if (gameRevision !== retryRevision) return;
          // Validate retry move
          if (!retryMove || retryMove.length < 4 || retryMove === '0000') {
            console.warn(`[Stockfish] Invalid retry bestmove: "${retryMove}"; continuing retries`);
            continue;
          }
          const rf = retryMove.charCodeAt(0) - 97;
          const rr = parseInt(retryMove[1]) - 1;
          const tf = retryMove.charCodeAt(2) - 97;
          const tr = parseInt(retryMove[3]) - 1;
          if (applyMove(rf, rr, tf, tr)) {
            moveApplied = true;
            break;
          }
        }
      }

      // All attempts (primary + 2 retries) failed — engine cannot make a legal move.
      // This can happen with impossible FEN positions or engine bugs.
      if (!moveApplied) {
        console.error(
          `[Stockfish] All move attempts failed for ${thinkingColor}; marking unavailable`
        );
        broadcast({
          type: 'computerUnavailable',
          color: thinkingColor,
          reason: 'Engine could not find a legal move',
        });
      }
    } catch (err) {
      console.error(`[Stockfish] Move error: ${err.message}`);
      if (err.code === 'ENOENT' || err.message.includes('not found')) {
        // Binary missing — engine unavailable
        broadcast({
          type: 'computerUnavailable',
          color: thinkingColor,
          reason: 'Engine not found',
        });
      } else {
        // Try to respawn
        try {
          engine.kill();
          await engine.spawn();
          // Don't retry the move — the turn stays with the computer
        } catch (respawnErr) {
          console.error(`[Stockfish] Respawn failed: ${respawnErr.message}`);
          broadcast({
            type: 'computerUnavailable',
            color: thinkingColor,
            reason: 'Engine crashed',
          });
        }
      }
    }
  }

  function handleActivateComputer(ws, data) {
    if (!computerPlayerEnabled) {
      send(ws, { type: 'error', reason: 'Computer player is disabled' });
      return;
    }

    // Only a seated human player can activate the computer
    const callerColor = game.players.get(ws);
    if (!callerColor) {
      send(ws, { type: 'error', reason: 'You must be seated to activate the computer player' });
      return;
    }

    const { color, skill } = data;
    // The computer plays the opposite color
    const targetColor = callerColor === 'white' ? 'black' : 'white';
    if (color !== targetColor) {
      send(ws, { type: 'error', reason: `Computer must play ${targetColor}` });
      return;
    }

    // Validate skill level
    const validSkills = Object.keys(engine.skills);
    if (!validSkills.includes(skill)) {
      send(ws, { type: 'error', reason: `Invalid skill level. Choose: ${validSkills.join(', ')}` });
      return;
    }

    // Check activation rules
    const seatStatus = seatStatusForColor(targetColor);
    if (seatStatus.status !== 'free') {
      send(ws, { type: 'error', reason: `${targetColor} seat is not available` });
      return;
    }

    if (game.gameOver) {
      send(ws, { type: 'error', reason: 'Game is over. Restart first.' });
      return;
    }

    // Activate the computer player
    computerColor = targetColor;
    computerSkill = skill;

    // Spawn and configure the engine
    (async () => {
      try {
        if (!engine.isReady) {
          await engine.spawn();
        }
        // Explicit isReady check after spawn — if the engine crashed
        // between spawn() and setSkill(), setSkill will throw (Finding 5 fix)
        // but we verify here for clarity.
        if (!engine.isReady) {
          throw new Error('Engine not ready after spawn');
        }
        await engine.setSkill(skill);
      } catch (err) {
        console.error(`[Stockfish] Activation failed: ${err.message}`);
        computerColor = null;
        computerSkill = null;
        send(ws, { type: 'error', reason: 'Failed to start computer player' });
        broadcastState();
        return;
      }

      broadcastState();
      broadcast({ type: 'computerActivated', color: targetColor, skill });

      // If it's the computer's turn, make the first move
      if (game.turn === targetColor && !game.gameOver) {
        executeComputerMove();
      }
    })();
  }

  function clearDrawOffer() {
    if (!drawOffer) return;
    // Notify the intended responder that the offer has been cancelled
    if (drawOffer.to && drawOffer.to.readyState === 1) {
      send(drawOffer.to, { type: 'drawOfferCancelled' });
    }
    drawOffer = null;
  }

  async function handleComputerDrawOffer(offererWs) {
    // Use Stockfish to evaluate the position and decide on the draw
    let accepted = false;
    let reason = 'Computer declined the draw offer';

    // Capture revision before async evaluation so we can detect
    // board-state changes (restart, concede, FEN import) while Stockfish
    // is thinking — analogous to the guard in executeComputerMove.
    const requestRevision = gameRevision;

    try {
      if (!engine.isReady) {
        try {
          await engine.spawn();
        } catch {
          /* engine unavailable — decline */
        }
      }
      if (engine.isReady) {
        const fen = game.currentFen();
        const evalScore = await engine.getEvaluation(fen);
        // Accept draw if evaluation is within ±50 centipawns (roughly half a pawn)
        if (evalScore !== null && Math.abs(evalScore) <= 50) {
          accepted = true;
          reason = 'Computer accepted the draw offer';
        }
      }
    } catch (err) {
      console.error(`[Stockfish] Draw evaluation error: ${err.message}`);
    }

    if (accepted) {
      // Guard: game may have ended during async evaluation (concede, restart,
      // FEN import, etc.). Discard the stale draw result to avoid overwriting
      // the real terminal state.
      if (game.gameOver || gameRevision !== requestRevision) return;
      game.gameOver = true;
      game.gameResult = 'Draw by agreement';
      bumpRevision();
      broadcast({ type: 'drawResult', accepted: true });
      broadcastState();
    } else {
      send(offererWs, { type: 'drawResult', accepted: false, reason });
    }
  }

  function handleOfferDraw(ws, _data) {
    const callerColor = game.players.get(ws);
    if (!callerColor) {
      send(ws, { type: 'error', reason: 'Only seated players can offer a draw' });
      return;
    }
    if (game.gameOver) {
      send(ws, { type: 'error', reason: 'Game is already over' });
      return;
    }

    // Check if there's an opponent
    let opponentWs = null;
    for (const [c] of game.players) {
      if (c !== ws) {
        opponentWs = c;
        break;
      }
    }
    if (!opponentWs && computerColor) {
      // Opponent is computer — evaluate position via Stockfish
      clearDrawOffer();
      handleComputerDrawOffer(ws);
      return;
    }
    if (!opponentWs) {
      send(ws, { type: 'error', reason: 'No opponent to offer a draw to' });
      return;
    }

    // Send draw offer to opponent — track both offerer and intended responder
    drawOffer = { from: ws, to: opponentWs };
    send(opponentWs, { type: 'drawOffer', fromColor: callerColor });
  }

  function handleDrawResponse(ws, data) {
    if (!drawOffer) {
      send(ws, { type: 'error', reason: 'No draw offer pending' });
      return;
    }
    if (game.gameOver) {
      send(ws, { type: 'error', reason: 'Game is already over' });
      clearDrawOffer();
      return;
    }

    // Only the intended responder may answer — reject the offerer and any third party
    if (ws !== drawOffer.to) {
      send(ws, { type: 'error', reason: 'You did not receive this draw offer' });
      return;
    }

    const responderColor = game.players.get(ws);
    if (!responderColor) {
      send(ws, { type: 'error', reason: 'Only seated players can respond to draw offers' });
      return;
    }

    const { accepted } = data;
    const offererWs = drawOffer.from;
    clearDrawOffer();

    if (accepted) {
      // Both players agree — end the game as a draw
      game.gameOver = true;
      game.gameResult = 'Draw by agreement';
      bumpRevision();
      broadcast({ type: 'drawResult', accepted: true });
      broadcastState();
    } else {
      // Declined — notify the offerer
      send(offererWs, {
        type: 'drawResult',
        accepted: false,
        reason: 'Opponent declined the draw offer',
      });
      send(ws, { type: 'drawResult', accepted: false, reason: 'You declined the draw offer' });
    }
  }

  function handleJoin(ws, data) {
    const { color } = data;
    if (color !== 'white' && color !== 'black' && color !== 'spectator') return;

    // Remove from any previous assignment
    game.players.delete(ws);
    game.spectators.delete(ws);
    sessions.delete(ws);

    if (color === 'spectator') {
      game.spectators.add(ws);
      send(ws, { type: 'joined', color: 'spectator' });
    } else if (isColorFree(color)) {
      // Claim the free seat
      stopBothDisconnectedTimer();
      game.players.set(ws, color);
      const token = crypto.randomUUID();
      sessions.set(ws, { token, color });
      send(ws, { type: 'joined', color, token });
    } else {
      // Seat not available — reject, do NOT fall back to spectator
      send(ws, { type: 'error', reason: `${color} seat is not available` });
      return;
    }

    sendState(ws);
    broadcastState(ws);
    maybeStartBothDisconnectedTimer();
  }

  wss.on('connection', (ws) => {
    // Don't auto-assign players — just send state with seat info
    // Client will explicitly choose via 'join' message
    sendState(ws);

    // Fallback timeout: if for some reason the client has no role, re-assign
    const joinTimeout = setTimeout(() => {
      if (!getRole(ws)) {
        sendState(ws);
      }
    }, joinTimeoutMs);

    ws._joinTimeout = joinTimeout; // expose for tests to clear

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        console.warn(`Malformed JSON from client: ${raw.slice(0, 120)}`);
        try {
          ws.send(JSON.stringify({ type: 'error', reason: 'Malformed message' }));
        } catch {
          /* client already disconnected — nothing to send */
        }
        return;
      }

      // Rate limit check (per connection, sliding window)
      const rl = checkRateLimit(ws);
      if (!rl.allowed) {
        send(ws, { type: 'rateLimited', retryAfter: rl.retryAfter });
        return;
      }

      // Handle reconnect for any client (even pre-assigned ones)
      if (msg.type === 'reconnect') {
        clearTimeout(joinTimeout);
        if (handleReconnect(ws, msg)) return; // successfully reconnected
        // Reconnect failed — client keeps its current role
        return;
      }

      // Validate whether a client-stored token is still valid for reconnect
      if (msg.type === 'validateToken') {
        const { token: vToken, color: vColor } = msg;
        let isValid = false;
        // Check disconnected players (held seat)
        const heldEntry = disconnectedPlayers.get(vToken);
        if (heldEntry && heldEntry.color === vColor) {
          isValid = true;
        }
        // Check active sessions (browser refresh — same token still active)
        if (!isValid) {
          for (const [, session] of sessions) {
            if (session.token === vToken && session.color === vColor) {
              isValid = true;
              break;
            }
          }
        }
        send(ws, { type: 'tokenValid', color: vColor, valid: isValid });
        return;
      }

      // Handle explicit join request (works for any client)
      if (msg.type === 'join') {
        clearTimeout(joinTimeout);
        handleJoin(ws, msg);
        return;
      }

      switch (msg.type) {
        case 'move': {
          const { fromFile, fromRank, toFile, toRank } = msg;
          if (
            ![fromFile, fromRank, toFile, toRank].every(
              (v) => Number.isInteger(v) && v >= 0 && v <= 7
            )
          )
            return;
          const result = game.tryMove(ws, fromFile, fromRank, toFile, toRank);
          if (result.ok) {
            debugLog('Move:', {
              from: { file: fromFile, rank: fromRank },
              to: { file: toFile, rank: toRank },
              result,
            });
            debugLog('Board after move:', game.board);
            bumpRevision();
            noteMoveBroadcast();
            broadcast({ type: 'move', ...result });
            broadcastState();
            broadcastDebug({
              category: 'move',
              from: { file: fromFile, rank: fromRank },
              to: { file: toFile, rank: toRank },
              message: `Move: ${result.notation}`,
            });
            // If it's now the computer's turn, trigger its move
            if (computerColor && game.turn === computerColor && !game.gameOver) {
              executeComputerMove();
            }
          } else {
            send(ws, { type: 'error', reason: result.reason });
          }
          break;
        }
        case 'promotion': {
          if (!game.promotingPiece || game.players.get(ws) !== game.promotingPiece.color) return;
          if (!['queen', 'rook', 'bishop', 'knight'].includes(msg.pieceType)) return;
          // Capture promotion position and color before completePromotion clears them
          const promoFile = game.promotingPiece.file;
          const promoRank = game.promotingPiece.rank;
          const promoColor = game.promotingPiece.color;
          const ok = game.completePromotion(ws, msg.pieceType);
          if (ok) {
            bumpRevision();
            broadcast({
              type: 'promotion',
              pieceType: msg.pieceType,
              color: promoColor,
              file: promoFile,
              rank: promoRank,
            });
            broadcastState();
            // If it's now the computer's turn, trigger its move
            if (computerColor && game.turn === computerColor && !game.gameOver) {
              executeComputerMove();
            }
          }
          break;
        }
        case 'restart': {
          if (game.players.has(ws)) {
            const oldFen = game.currentFen();
            debugLog('Game restart: OLD FEN:', oldFen);
            // Evict computer player on restart
            evictComputerPlayer();
            clearDrawOffer();
            game.reset();
            bumpRevision();
            const newFen = game.currentFen();
            debugLog('Game restart: NEW FEN:', newFen);
            debugLog('Game restart: NEW board state:', game.board);
            broadcastState();
            broadcast({ type: 'restart' });
            broadcastDebug({
              category: 'gameRestart',
              oldFen,
              newFen,
              message: 'Game restarted',
            });
          }
          break;
        }
        case 'concede': {
          const color = game.players.get(ws);
          if (!color) return;
          const ok = game.concede(ws);
          if (ok) {
            bumpRevision();
            clearDrawOffer();
            broadcastState();
          }
          break;
        }
        case 'dropPlayer': {
          handleDropPlayer(ws, msg);
          break;
        }
        case 'exportFen': {
          send(ws, { type: 'fenExport', fen: game.currentFen() });
          break;
        }
        case 'exportPgn': {
          send(ws, { type: 'pgnExport', pgn: game.exportPgn() });
          break;
        }
        case 'importFen': {
          if (!game.players.has(ws)) {
            send(ws, { type: 'error', reason: 'Only players can import FEN' });
            break;
          }
          const fen = msg.fen;
          if (typeof fen !== 'string' || !fen.trim()) {
            send(ws, { type: 'error', reason: 'Invalid FEN string' });
            break;
          }
          try {
            // Parse the FEN to get the board state for validation
            const fenState = fromFen(fen.trim());

            // Validate for engine compatibility (warnings, not errors)
            const warnings = validateFenForEngine(
              fenState.board,
              fenState.turn,
              fenState.castlingRights,
              fenState.enPassantTarget
            );

            clearDrawOffer();
            // Evict computer player — FEN import is treated as a new game
            evictComputerPlayer();

            const oldFen = game.currentFen();
            debugLog('FEN import: OLD FEN:', oldFen);
            debugLog('FEN import: NEW FEN:', fen.trim());
            game.loadFromFen(fen.trim());
            bumpRevision();
            const newFen = game.currentFen();
            debugLog('FEN import: NEW board state:', game.board);

            // Send warnings to all clients if the FEN has engine-incompatible issues
            if (warnings.length > 0) {
              broadcast({
                type: 'fenImportWarning',
                warnings,
                fen: fen.trim(),
              });
            }

            broadcastState();
            broadcast({ type: 'restart' });
            broadcastDebug({
              category: 'fenImport',
              oldFen,
              newFen,
              message: `FEN imported: ${fen.trim()}`,
            });
          } catch (e) {
            send(ws, { type: 'error', reason: `Invalid FEN: ${e.message}` });
          }
          break;
        }
        case 'activateComputer': {
          handleActivateComputer(ws, msg);
          break;
        }
        case 'changeSkill': {
          if (!computerColor) {
            send(ws, { type: 'error', reason: 'No computer player active' });
            break;
          }
          // Only the human player can change the skill
          const callerColor = game.players.get(ws);
          if (!callerColor || callerColor === computerColor) {
            send(ws, { type: 'error', reason: 'Only the human player can change skill level' });
            break;
          }
          const { skill } = msg;
          const validSkills = Object.keys(engine.skills);
          if (!validSkills.includes(skill)) {
            send(ws, {
              type: 'error',
              reason: `Invalid skill level. Choose: ${validSkills.join(', ')}`,
            });
            break;
          }
          const previousSkill = computerSkill;
          // Reconfigure engine — assign computerSkill only after setSkill succeeds
          (async () => {
            try {
              await engine.setSkill(skill);
              computerSkill = skill;
              broadcastState();
              broadcast({ type: 'computerSkillChanged', color: computerColor, skill });
            } catch (err) {
              console.error(`[Stockfish] Skill change failed: ${err.message}`);
              // Roll back to previous skill so server state stays consistent
              computerSkill = previousSkill;
              send(ws, { type: 'error', reason: `Skill change failed: ${err.message}` });
              broadcastState();
            }
          })();
          break;
        }
        case 'offerDraw': {
          handleOfferDraw(ws, msg);
          break;
        }
        case 'drawResponse': {
          handleDrawResponse(ws, msg);
          break;
        }
        case 'claimDraw': {
          const result = game.claimDraw(ws);
          if (result.ok) {
            bumpRevision();
            clearDrawOffer();
            broadcastState();
          } else {
            send(ws, { type: 'error', reason: result.reason });
          }
          break;
        }
        case 'leave': {
          // Clear any pending draw offer involving this player
          if (drawOffer && (drawOffer.from === ws || drawOffer.to === ws)) {
            // If the responder is leaving, notify the offerer instead
            if (drawOffer.to === ws && drawOffer.from && drawOffer.from.readyState === 1) {
              send(drawOffer.from, { type: 'drawOfferCancelled' });
            } else {
              clearDrawOffer();
            }
            // Ensure drawOffer is cleared if we didn't call clearDrawOffer
            if (drawOffer) drawOffer = null;
          }
          // Player voluntarily gives up their seat — no 60s hold
          const playerColor = game.players.get(ws);
          if (playerColor) {
            game.players.delete(ws);
            const session = sessions.get(ws);
            if (session) {
              sessions.delete(ws);
              // Notify opponent and spectators that the seat is now free
              const opponentColor = playerColor === 'white' ? 'black' : 'white';
              for (const c of wss.clients) {
                if (c.readyState === 1) {
                  const cRole = game.players.get(c);
                  if (cRole === opponentColor || game.spectators.has(c)) {
                    send(c, { type: 'playerLeft', color: playerColor });
                  }
                }
              }
            }
          } else {
            // Spectator leaving
            game.spectators.delete(ws);
          }
          send(ws, { type: 'left', color: playerColor });
          broadcastState();
          maybeStartBothDisconnectedTimer();
          break;
        }
      }
    });

    ws.on('close', () => {
      // Clear the join timeout to prevent it from firing after disconnect
      clearTimeout(ws._joinTimeout);

      // Rate limit buckets are keyed by IP and persist across connections —
      // do NOT delete here, otherwise a close/reopen resets the IP limit.
      // Buckets are cleaned up by the periodic sweep when timestamps expire.
      // Clear any pending draw offer involving this player
      if (drawOffer && (drawOffer.from === ws || drawOffer.to === ws)) {
        clearDrawOffer();
      }
      const session = sessions.get(ws);
      if (session) {
        const { token, color } = session;
        sessions.delete(ws);
        game.players.delete(ws);

        const now = Date.now();
        disconnectedPlayers.set(token, { color, disconnectedAt: now });

        // Notify opponent player AND all spectators
        const opponentColor = color === 'white' ? 'black' : 'white';
        for (const c of wss.clients) {
          if (c.readyState === 1) {
            const cRole = game.players.get(c);
            if (cRole === opponentColor || game.spectators.has(c)) {
              send(c, { type: 'playerDisconnected', color, token, disconnectedAt: now });
            }
          }
        }

        stopBothDisconnectedTimer();
        maybeStartBothDisconnectedTimer();
      } else {
        // No session — could be a spectator or unassigned client
        game.removePlayer(ws);
        game.spectators.delete(ws);
      }

      broadcastState();
    });
  });

  return {
    sessions,
    disconnectedPlayers,
    rateLimitBuckets,
    stopBothDisconnectedTimer,
    getRole,
    sendState,
    engine,
    getGameRevision: () => gameRevision,
  };
}

module.exports = { setupWebSocketHandlers };
