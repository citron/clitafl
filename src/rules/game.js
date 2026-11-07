'use strict';

const { Board } = require('./board');
const { KING, SIDE_DEFENDER, SIDE_ATTACKER, sideOf } = require('./pieces');
const V = require('./variants');
const { parseMove, formatMove } = require('./notation');

const STATUS_PLAYING = 'playing';
const STATUS_DEFENDERS_WIN = 'defenders-win';
const STATUS_ATTACKERS_WIN = 'attackers-win';
const STATUS_DRAW = 'draw';

/** Game state machine: turns, victory, draws, undo, serialisation. */
class Game {
  constructor(variant, board = null) {
    this.variant = variant;
    this.board = board || Board.fromVariant(variant);
    this.turn = variant.first;
    this.ply = 0;
    this.status = STATUS_PLAYING;
    this.winner = null;
    this.reason = null;
    this.history = [];
    this.repetitions = new Map();
    this.lastMove = null;
    this.countPosition();
  }

  static create(variantId, size = null) {
    return new Game(V.getVariant(variantId, size));
  }

  isGameOver() { return this.status !== STATUS_PLAYING; }

  legalMoves(side = this.turn) { return this.board.legalMoves(side); }

  hasLegalMoves(side = this.turn) { return this.board.hasLegalMoves(side); }

  /** Play a move given as {from,to} indices, indices, or 'd5-d6' notation. */
  play(input) {
    if (this.isGameOver()) {
      throw new Error(`Game is over (${this.status})`);
    }
    const move = typeof input === 'string' ? parseMove(this.board.size, input) : input;
    if (!this.board.isLegalMove(move.from, move.to, this.turn)) {
      throw new Error(`Illegal move: ${formatMove(this.board.size, move)}`);
    }
    const notation = formatMove(this.board.size, move);
    const applied = this.board.applyMove(move);
    this.ply += 1;
    this.history.push({
      move,
      notation,
      side: this.turn,
      captured: applied.captured,
      kingHasEscapedBefore: applied.kingHasEscapedBefore,
    });
    this.lastMove = move;
    const capturedKing = applied.captured.some((cap) => cap.value === KING);
    const outcome = this.evaluateOutcome(move, capturedKing);
    if (this.status === STATUS_PLAYING) {
      this.turn = this.turn === SIDE_DEFENDER ? SIDE_ATTACKER : SIDE_DEFENDER;
      this.countPosition();
    }
    return {
      notation,
      move,
      ply: this.ply,
      side: this.history[this.history.length - 1].side,
      captured: applied.captured,
      status: this.status,
      winner: this.winner,
      reason: this.reason,
      outcome,
    };
  }

  countPosition() {
    const key = this.board.key(this.turn);
    const n = (this.repetitions.get(key) || 0) + 1;
    this.repetitions.set(key, n);
    return n;
  }

  /** Decide the outcome right after a move, before the turn passes. */
  evaluateOutcome(move, capturedKing) {
    const { board, variant } = this;
    const mover = this.turn;
    const r = board.rowOf(move.to);
    const c = board.colOf(move.to);

    if (capturedKing || !board.kingAlive()) {
      return this.finish(STATUS_ATTACKERS_WIN, SIDE_ATTACKER, 'The king was captured.');
    }
    if (mover === SIDE_DEFENDER && board.get(r, c) === KING && board.isEscapeSquare(r, c)) {
      return this.finish(STATUS_DEFENDERS_WIN, SIDE_DEFENDER, 'The king reached an escape square.');
    }
    if (variant.winBySiege && mover === SIDE_ATTACKER && board.kingSideSealedIn()) {
      return this.finish(STATUS_ATTACKERS_WIN, SIDE_ATTACKER, 'The king and his host are sealed in.');
    }

    const next = mover === SIDE_DEFENDER ? SIDE_ATTACKER : SIDE_DEFENDER;
    if (!board.hasLegalMoves(next)) {
      if (variant.noMove === 'loss') {
        const winner = mover;
        const label = winner === SIDE_ATTACKER ? 'attackers' : 'defenders';
        return this.finish(
          winner === SIDE_ATTACKER ? STATUS_ATTACKERS_WIN : STATUS_DEFENDERS_WIN,
          winner,
          `${label} win: the opponent has no legal move.`,
        );
      }
      return this.finish(STATUS_DRAW, null, 'Draw: one side has no legal move.');
    }

    if (variant.repetition === 'draw' && this.repetitions.get(board.key(next)) >= 2) {
      return this.finish(STATUS_DRAW, null, 'Draw: the position is repeated.');
    }
    if (variant.maxPlies && this.ply >= variant.maxPlies) {
      return this.finish(STATUS_DRAW, null, `Draw: ${variant.maxPlies} plies played.`);
    }
    return null;
  }

  finish(status, winner, reason) {
    this.status = status;
    this.winner = winner;
    this.reason = reason;
    return { status, winner, reason };
  }

  /** The side to move has no legal move: the variant decides loss or draw. */
  declareNoMove(side = this.turn) {
    const label = side === SIDE_ATTACKER ? 'attackers' : 'defenders';
    const other = side === SIDE_ATTACKER ? SIDE_DEFENDER : SIDE_ATTACKER;
    if (this.variant.noMove === 'loss') {
      const status = other === SIDE_ATTACKER ? STATUS_ATTACKERS_WIN : STATUS_DEFENDERS_WIN;
      return this.finish(status, other, `${label} have no legal move.`);
    }
    return this.finish(STATUS_DRAW, null, `${label} have no legal move.`);
  }

  /** One side gives up. */
  resign(side = this.turn) {
    const winner = side === SIDE_ATTACKER ? SIDE_DEFENDER : SIDE_ATTACKER;
    const label = side === SIDE_ATTACKER ? 'attackers' : 'defenders';
    const status = winner === SIDE_ATTACKER ? STATUS_ATTACKERS_WIN : STATUS_DEFENDERS_WIN;
    return this.finish(status, winner, `${label} resigned.`);
  }

  /** Undo the last `n` plies. */
  undo(n = 1) {
    let undone = 0;
    while (undone < n && this.history.length > 0) {
      const entry = this.history.pop();
      this.board.undoMove(entry.move, {
        captured: entry.captured,
        kingHasEscapedBefore: entry.kingHasEscapedBefore,
      });
      const key = this.board.key(entry.side);
      const count = this.repetitions.get(key) || 0;
      if (count <= 1) this.repetitions.delete(key);
      else this.repetitions.set(key, count - 1);
      this.turn = entry.side;
      this.ply -= 1;
      this.status = STATUS_PLAYING;
      this.winner = null;
      this.reason = null;
      undone += 1;
    }
    this.lastMove = this.history.length > 0 ? this.history[this.history.length - 1].move : null;
    return undone;
  }

  movesPlayed() {
    return this.history.map((entry, i) => ({
      ply: i + 1,
      side: entry.side,
      notation: entry.notation,
      captured: entry.captured.map((cap) => cap.value),
    }));
  }

  summary() {
    return {
      variant: this.variant.id,
      name: this.variant.name,
      size: this.board.size,
      turn: this.turn,
      ply: this.ply,
      status: this.status,
      winner: this.winner,
      reason: this.reason,
      defenders: this.board.countOf(SIDE_DEFENDER),
      attackers: this.board.countOf(SIDE_ATTACKER),
    };
  }

  serialize() {
    return {
      format: 'clitafl-save-v1',
      variant: this.variant.id,
      size: this.board.size,
      board: this.board.serialize(),
      turn: this.turn,
      ply: this.ply,
      history: this.movesPlayed(),
    };
  }

  static deserialize(data) {
    if (!data || data.format !== 'clitafl-save-v1') {
      throw new Error('Not a clitafl save file');
    }
    const variant = V.getVariant(data.variant, data.size);
    const board = Board.deserialize(variant, data.board);
    const game = new Game(variant, board);
    game.turn = data.turn;
    game.ply = data.ply || 0;
    for (const entry of data.history || []) {
      const move = parseMove(board.size, entry.notation);
      game.history.push({
        move,
        notation: entry.notation,
        side: entry.side,
        captured: [],
        kingHasEscapedBefore: board.kingHasEscaped,
      });
    }
    game.lastMove = game.history.length ? game.history[game.history.length - 1].move : null;
    return game;
  }
}

module.exports = {
  Game,
  STATUS_PLAYING,
  STATUS_DEFENDERS_WIN,
  STATUS_ATTACKERS_WIN,
  STATUS_DRAW,
};
