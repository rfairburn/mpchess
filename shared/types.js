// ═══════════════════════════════════════════════════════════
//  TYPES — JSDoc typedefs for key interfaces across the project
// ═══════════════════════════════════════════════════════════

/**
 * A single square on the board, represented as a piece integer.
 * @typedef {number} Piece
 * @see Piece constants EMPTY (0) through B_KING (12) in chess.js
 */

/**
 * An 8×8 board grid. Index [rank][file], where rank 0 = rank 1 (white back rank),
 * file 0 = file a.
 * @typedef {Piece[][]} Board
 */

/**
 * Castling rights for both sides.
 * @typedef {Object} CastlingRights
 * @property {boolean} wK — White king-side
 * @property {boolean} wQ — White queen-side
 * @property {boolean} bK — Black king-side
 * @property {boolean} bQ — Black queen-side
 */

/**
 * A single move on the board.
 * @typedef {Object} Move
 * @property {number} file — Destination file (0–7)
 * @property {number} rank — Destination rank (0–7)
 * @property {boolean} [enPassant] — En passant capture
 * @property {'K'|'Q'} [castle] — Castling direction
 */

/**
 * A failed move result (ok === false).
 * @typedef {Object} MoveResultFailure
 * @property {false} ok
 * @property {string} reason — Why the move failed
 */

/**
 * A successful move result (ok === true).
 * @typedef {Object} MoveResultSuccess
 * @property {true} ok
 * @property {boolean} [promotion] — Whether this move requires promotion
 * @property {number} fromFile — Origin file
 * @property {number} fromRank — Origin rank
 * @property {number} toFile — Destination file
 * @property {number} toRank — Destination rank
 * @property {boolean} [captured] — Whether a piece was captured
 * @property {boolean} [enPassant] — Whether this was en passant
 * @property {{from: number, to: number, rank: number}} [castled] — Castled rook info
 */

/**
 * Result of attempting a move via Game.tryMove().
 * @typedef {MoveResultFailure|MoveResultSuccess} MoveResult
 */

/**
 * Full game state snapshot, sent to clients on every state change.
 * @typedef {Object} GameState
 * @property {Board} board — 8×8 piece grid
 * @property {'white'|'black'} turn — Side to move
 * @property {CastlingRights} castlingRights
 * @property {{file: number, rank: number}|null} enPassantTarget
 * @property {{color: string, file: number, rank: number}|null} promotingPiece — Non-null during promotion
 * @property {boolean} gameOver
 * @property {'checkmate'|'stalemate'|'draw'|null} gameResult
 * @property {string[]} moveHistory — Algebraic notation moves
 * @property {{white: string[], black: string[]}} capturedPieces — Pieces each side has captured (type strings)
 * @property {number} playerCount — Number of seated players
 * @property {number} spectatorCount
 * @property {number} halfmoveClock — 50-move rule counter
 * @property {number} threefoldCount — Position repetition count
 * @property {boolean} canClaimDraw — Whether draw can be claimed
 * @property {string} fen — Current FEN string
 */

/**
 * Seat status for a color.
 * @typedef {Object} SeatStatus
 * @property {'empty'|'occupied'|'reserved'} white
 * @property {'empty'|'occupied'|'reserved'} black
 */

/**
 * Computer player configuration.
 * @typedef {Object} ComputerPlayer
 * @property {string} color — 'white' or 'black'
 * @property {number} skill — Skill level (0–20)
 */

// ── WebSocket Messages ────────────────────────────────────

/**
 * Base shape for all WebSocket messages.
 * @typedef {Object} WSMessage
 * @property {string} type — Message type identifier
 */

/**
 * Server-to-client message: full state sync.
 * GameState fields are spread into the message via `...state`, so WSState
 * is the intersection of the envelope fields and GameState.
 * @typedef {WSStateEnvelope & GameState} WSState
 */

/**
 * The envelope fields of a state message (before GameState spread).
 * @typedef {Object} WSStateEnvelope
 * @property {'state'} type
 * @property {'white'|'black'|'spectator'} role
 * @property {SeatStatus} seats
 * @property {Array<{color: string}>} disconnectedPlayers
 * @property {ComputerPlayer|null} computerPlayer
 * @property {boolean} debug
 */

/**
 * Server-to-client message: a move was made.
 * @typedef {WSMessage} WSMove
 * @property {'move'} type
 * @property {number} fromFile
 * @property {number} fromRank
 * @property {number} toFile
 * @property {number} toRank
 * @property {boolean} captured
 * @property {boolean} enPassant
 * @property {{from: number, to: number, rank: number}|null} castled
 * @property {string} notation
 * @property {string} [color]
 */

/**
 * Server-to-client message: promotion required.
 * @typedef {WSMessage} WSPromotion
 * @property {'promotion'} type
 * @property {string} pieceType
 * @property {string} color
 * @property {number} file
 * @property {number} rank
 */

/**
 * Server-to-client message: error.
 * @typedef {WSMessage} WSError
 * @property {'error'} type
 * @property {string} reason
 */

/**
 * Client-to-server message: join a game.
 * @typedef {WSMessage} WSJoin
 * @property {'join'} type
 * @property {string} [color] — 'white', 'black', or 'spectator'
 */

/**
 * Client-to-server message: make a move.
 * @typedef {WSMessage} WSMoveRequest
 * @property {'move'} type
 * @property {number} fromFile
 * @property {number} fromRank
 * @property {number} toFile
 * @property {number} toRank
 */

/**
 * Client-to-server message: select promotion piece.
 * @typedef {WSMessage} WSPromotionResponse
 * @property {'promotion'} type
 * @property {string} pieceType — 'queen', 'rook', 'bishop', 'knight'
 */

// ── Client-side piece mesh ────────────────────────────────

/**
 * A piece mesh entry tracked by pieces.js.
 * @typedef {Object} PieceMesh
 * @property {import('three').Group} mesh — Three.js group
 * @property {number} file — Board file (0–7)
 * @property {number} rank — Board rank (0–7)
 * @property {string} type — 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'
 * @property {string} color — 'white' or 'black'
 */

// ── Animation ─────────────────────────────────────────────

/**
 * A single animation frame update function.
 * @typedef {Object} Animation
 * @property {(time: number) => boolean} update — Returns true when animation is complete
 */
