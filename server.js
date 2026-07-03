const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { Game } = require('./shared/chess');
const { getStockfishEngine } = require('./shared/stockfish_engine');

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
  // Per-connection sliding window: ws -> number[] of timestamps
  const rateLimitBuckets = new Map();
  let bothDisconnectedTimer = null;

  const SLOW_CLIENT_THRESHOLD = 1 * 1024 * 1024; // 1 MB

  // Debug mode
  const DEBUG = options.debug || false;

  // ── Computer player state ──
  const computerPlayerEnabled = options.computerPlayer?.enabled !== false;
  let computerColor = null; // 'white' | 'black' | null
  let computerSkill = null; // skill level key
  const engine = getStockfishEngine(options.computerPlayer || {});

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

  // ── Rate limiter (sliding window per connection) ──

  function checkRateLimit(ws) {
    const now = Date.now();
    let bucket = rateLimitBuckets.get(ws);
    if (!bucket) {
      bucket = [];
      rateLimitBuckets.set(ws, bucket);
    }
    // Prune timestamps outside the window
    while (bucket.length > 0 && bucket[0] <= now - rateLimitWindow) {
      bucket.shift();
    }
    if (bucket.length >= rateLimitMax) {
      const retryAfter = Math.ceil((bucket[0] - (now - rateLimitWindow)) / 1000);
      rateLimitBuckets.delete(ws);
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
    for (const c of wss.clients) {
      if (c !== excludeWs && c.readyState === 1) sendState(c);
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
  }

  async function executeComputerMove() {
    if (!computerColor || game.gameOver) return;
    if (game.turn !== computerColor) return;

    // Mark that the computer is thinking so we don't double-trigger
    const thinkingColor = computerColor;

    try {
      // Ensure engine is running
      if (!engine.isReady) {
        try {
          await engine.spawn();
        } catch (err) {
          console.error(`[Stockfish] Failed to spawn: ${err.message}`);
          broadcast({ type: 'computerUnavailable', color: thinkingColor, reason: 'Engine failed to start' });
          return;
        }
      }

      // Configure skill
      if (computerSkill) {
        await engine.setSkill(computerSkill);
      }

      // Notify clients that computer is thinking
      broadcast({ type: 'computerThinking', color: thinkingColor });

      // Get the best move
      const fen = game.currentFen();
      const uciMove = await engine.getBestMove(fen, computerSkill);

      // Parse UCI move (e.g. "e2e4" → fromFile=4, fromRank=1, toFile=4, toRank=3)
      const fromFile = uciMove.charCodeAt(0) - 97;
      const fromRank = parseInt(uciMove[1]) - 1;
      const toFile = uciMove.charCodeAt(2) - 97;
      const toRank = parseInt(uciMove[3]) - 1;

      // Create a virtual ws for the computer player so tryMove works.
      // Must remain registered through completePromotion() because it validates
      // this.players.get(ws) against the promoting piece's color.
      const virtualWs = { _computer: true, color: thinkingColor };
      game.players.set(virtualWs, thinkingColor);

      const result = game.tryMove(virtualWs, fromFile, fromRank, toFile, toRank);

      if (result.ok) {
        debugLog('Computer move:', { color: thinkingColor, uciMove, result });

        // Handle promotion if needed — virtualWs must still be in game.players
        if (result.promotion) {
          // For computer, always promote to queen
          const promoOk = game.completePromotion(virtualWs, 'queen');
          if (promoOk) {
            broadcast({ type: 'promotion', pieceType: 'queen' });
          }
        }

        // Remove virtual player only after promotion is complete
        game.players.delete(virtualWs);

        broadcast({ type: 'move', ...result, color: thinkingColor });
        broadcastState();
      } else {
        game.players.delete(virtualWs);
        console.warn(`[Stockfish] Illegal move ${uciMove}: ${result.reason}`);
        // Retry up to 2 more times
        for (let retry = 0; retry < 2; retry++) {
          const retryMove = await engine.getBestMove(game.currentFen(), computerSkill);
          const rf = retryMove.charCodeAt(0) - 97;
          const rr = parseInt(retryMove[1]) - 1;
          const tf = retryMove.charCodeAt(2) - 97;
          const tr = parseInt(retryMove[3]) - 1;
          game.players.set(virtualWs, thinkingColor);
          const retryResult = game.tryMove(virtualWs, rf, rr, tf, tr);
          if (retryResult.ok) {
            // Handle promotion if needed — same as primary path
            if (retryResult.promotion) {
              const promoOk = game.completePromotion(virtualWs, 'queen');
              if (promoOk) {
                broadcast({ type: 'promotion', pieceType: 'queen' });
              }
            }
            game.players.delete(virtualWs);
            broadcast({ type: 'move', ...retryResult, color: thinkingColor });
            broadcastState();
            break;
          }
          game.players.delete(virtualWs);
        }
      }
    } catch (err) {
      console.error(`[Stockfish] Move error: ${err.message}`);
      if (err.code === 'ENOENT' || err.message.includes('not found')) {
        // Binary missing — engine unavailable
        broadcast({ type: 'computerUnavailable', color: thinkingColor, reason: 'Engine not found' });
      } else {
        // Try to respawn
        try {
          engine.kill();
          await engine.spawn();
          // Don't retry the move — the turn stays with the computer
        } catch (respawnErr) {
          console.error(`[Stockfish] Respawn failed: ${respawnErr.message}`);
          broadcast({ type: 'computerUnavailable', color: thinkingColor, reason: 'Engine crashed' });
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

    try {
      if (!engine.isReady) {
        try { await engine.spawn(); } catch { /* engine unavailable — decline */ }
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
      game.gameOver = true;
      game.gameResult = 'Draw by agreement';
      broadcast({ type: 'drawResult', accepted: true });
      broadcastState();
    } else {
      send(offererWs, { type: 'drawResult', accepted: false, reason });
    }
  }

  function handleOfferDraw(ws, data) {
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
      if (c !== ws) { opponentWs = c; break; }
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
      broadcast({ type: 'drawResult', accepted: true });
      broadcastState();
    } else {
      // Declined — notify the offerer
      send(offererWs, { type: 'drawResult', accepted: false, reason: 'Opponent declined the draw offer' });
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
          const ok = game.completePromotion(ws, msg.pieceType);
          if (ok) {
            broadcast({ type: 'promotion', pieceType: msg.pieceType });
            broadcastState();
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
            clearDrawOffer();
            const oldFen = game.currentFen();
            debugLog('FEN import: OLD FEN:', oldFen);
            debugLog('FEN import: NEW FEN:', fen.trim());
            game.loadFromFen(fen.trim());
            const newFen = game.currentFen();
            debugLog('FEN import: NEW board state:', game.board);
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
            send(ws, { type: 'error', reason: `Invalid skill level. Choose: ${validSkills.join(', ')}` });
            break;
          }
          computerSkill = skill;
          // Reconfigure engine
          (async () => {
            try {
              await engine.setSkill(skill);
              broadcastState();
              broadcast({ type: 'computerSkillChanged', color: computerColor, skill });
            } catch (err) {
              console.error(`[Stockfish] Skill change failed: ${err.message}`);
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
      }
    });

    ws.on('close', () => {
      rateLimitBuckets.delete(ws);
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
  };
}

// ═══════════════════════════════════════════════════════════
//  HTTP SERVER + WEBSOCKET (production entry point)
// ═══════════════════════════════════════════════════════════

const HOST = '0.0.0.0';

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

if (require.main === module) {
  // CLI help (check before loading config)
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    require('./loadConfig'); // loaded for side effects
    console.log(`
Usage: node server.js [options]

Options:
  --help, -h              Show this help message
  --config=<path>         Config file path (default: config.json in cwd)
  --fen=<fen_string>      Load a custom starting position (first game only;
                          restarts reset to standard setup)
  --port=<number>         Port for the HTTP/WebSocket server
  --cert=<path>           TLS certificate file (enables HTTPS)
  --key=<path>            TLS private key file (required with --cert)
  --chain=<path>          TLS certificate chain file (optional, PEM format)
  --allowed-origins=<o1,o2>  Comma-separated list of allowed WebSocket origins
  --debug=<true|false>      Enable debug logging for piece rebuilding
  --prefix=<path>           URL prefix for subpath deployments (e.g. /chess)

Config sources (highest priority first):
  1. CLI arguments
  2. Environment variables (MPCHESS_PORT, MPCHESS_FEN, MPCHESS_CERT,
     MPCHESS_KEY, MPCHESS_CHAIN, MPCHESS_ALLOWED_ORIGINS, MPCHESS_DEBUG,
     MPCHESS_PREFIX)
  3. Config file (config.json or --config=<path>)
  4. Built-in defaults

Examples:
  node server.js
  node server.js --config=prod.json --port=8443
  node server.js --cert=server.crt --key=server.key
  node server.js --allowed-origins=games.devop.ninja,localhost
  node server.js --debug=true
  MPCHESS_PORT=8080 node server.js
  MPCHESS_DEBUG=true node server.js
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
  const wssOptions = { server };
  if (allowedOrigins.length > 0) {
    wssOptions.verifyClient = (info, cb) => {
      const origin = info.req.headers.origin;
      if (!origin) {
        cb(true);
        return;
      }
      try {
        const url = new URL(origin);
        const ok = allowedOrigins.some((allowed) => {
          // Exact origin match (e.g. "https://chess.example.com")
          if (url.origin === allowed) return true;
          // Exact hostname match (e.g. "chess.example.com")
          if (url.hostname === allowed) return true;
          return false;
        });
        cb(ok, ok ? 200 : 403);
      } catch {
        // Malformed origin header — reject
        cb(false, 403);
      }
    };
  }

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

  setupWebSocketHandlers(wss, game, { debug: config.debug, computerPlayer: config.computerPlayer });

  // Graceful shutdown: quit Stockfish engine
  const { getStockfishEngine: getEngine } = require('./shared/stockfish_engine');
  function gracefulShutdown(signal) {
    console.log(`\n${signal} received. Shutting down...`);
    const eng = getEngine();
    eng.quit().finally(() => {
      server.close(() => {
        console.log('Server closed.');
        process.exit(0);
      });
      // Force exit after 5s
      setTimeout(() => process.exit(1), 5000);
    });
  }
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

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
module.exports = { setupWebSocketHandlers, requestHandler, MIME, CLIENT_ROOT };
