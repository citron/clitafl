'use strict';

const { KING, SIDE_DEFENDER, SIDE_ATTACKER, isPiece, sideOf } = require('../rules/pieces');
const { MATE, scoreFor } = require('./evaluate');

const other = (side) => (side === SIDE_DEFENDER ? SIDE_ATTACKER : SIDE_DEFENDER);

/**
 * Negamax with alpha-beta pruning, iterative deepening and a wall-clock budget.
 * The board is mutated and un-applied in place, so no node allocates a board.
 */
function searchBestMove(board, turn, options = {}) {
  const maxDepth = options.maxDepth ?? 12;
  const timeMs = options.timeMs ?? 1000;
  const ctx = {
    nodes: 0,
    deadline: Date.now() + timeMs,
    aborted: false,
    noMove: board.variant.noMove,
  };

  let rootMoves = orderMoves(board, turn);
  if (rootMoves.length === 0) return { move: null, score: 0, depth: 0, nodes: 0 };

  let best = rootMoves[0];
  let bestScore = -Infinity;
  let reachedDepth = 0;
  let ranked = null;

  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const scored = [];
    let alpha = -Infinity;
    for (const move of rootMoves) {
      const applied = board.applyMove(move);
      const value = winsImmediately(board, move, applied, turn)
        ? MATE
        : -negamax(board, other(turn), depth - 1, -Infinity, -alpha, 1, ctx);
      board.undoMove(move, applied);
      scored.push({ move, value });
      if (value > alpha) {
        alpha = value;
        best = move;
        bestScore = value;
      }
      if (ctx.aborted) break;
    }
    if (scored.length > 0) {
      scored.sort((a, b) => b.value - a.value);
      ranked = scored;
      rootMoves = scored.map((s) => s.move);
      best = scored[0].move;
      bestScore = scored[0].value;
      if (!ctx.aborted) reachedDepth = depth;
    }
    if (ctx.aborted) break;
    if (bestScore >= MATE - 1000) break;
    if (Date.now() > ctx.deadline) break;
  }

  return {
    move: best,
    score: bestScore,
    depth: reachedDepth,
    nodes: ctx.nodes,
    aborted: ctx.aborted,
    ranked,
  };
}

function negamax(board, turn, depth, alpha, beta, ply, ctx) {
  ctx.nodes += 1;
  if ((ctx.nodes & 2047) === 0 && Date.now() > ctx.deadline) ctx.aborted = true;
  if (ctx.aborted) return scoreFor(board, turn);

  const moves = orderMoves(board, turn);
  if (moves.length === 0) return ctx.noMove === 'loss' ? -MATE + ply : 0;
  if (depth <= 0) return scoreFor(board, turn);

  let best = -Infinity;
  for (const move of moves) {
    const applied = board.applyMove(move);
    const value = winsImmediately(board, move, applied, turn)
      ? MATE - ply
      : -negamax(board, other(turn), depth - 1, -beta, -alpha, ply + 1, ctx);
    board.undoMove(move, applied);
    if (ctx.aborted) return best === -Infinity ? scoreFor(board, turn) : best;
    if (value > best) best = value;
    if (value > alpha) alpha = value;
    if (alpha >= beta) break;
  }
  return best;
}

/** A move that ends the game at once: capture of the king, or the king's escape. */
function winsImmediately(board, move, applied, turn) {
  if (turn === SIDE_ATTACKER && applied.captured.some((cap) => cap.value === KING)) return true;
  if (turn === SIDE_DEFENDER && board.get(board.rowOf(move.to), board.colOf(move.to)) === KING) {
    return board.isEscapeSquare(board.rowOf(move.to), board.colOf(move.to));
  }
  return false;
}

/** Cheap ordering: escapes first, then captures, checks and piece progress. */
function orderMoves(board, turn) {
  const moves = board.legalMoves(turn);
  for (const move of moves) move.order = moveHeuristic(board, move, turn);
  moves.sort((a, b) => b.order - a.order);
  return moves;
}

function moveHeuristic(board, move, turn) {
  const piece = board.grid[move.from];
  const tr = board.rowOf(move.to);
  const tc = board.colOf(move.to);
  let score = 0;

  if (piece === KING && board.isEscapeSquare(tr, tc)) return 100000;

  const victimNeighbours = countAdjacentEnemies(board, tr, tc, turn);
  score += victimNeighbours * 30;
  if (victimNeighbours > 0 && createsCapture(board, tr, tc, turn)) score += 120;

  if (piece === KING) {
    score += 40 - manhattanToEscape(board, tr, tc) * 4;
  } else if (turn === SIDE_ATTACKER) {
    score += 20 - Math.min(20, manhattan(board, tr, tc, board.kingPos)) * 2;
  } else {
    score += 12 - Math.min(12, manhattan(board, tr, tc, board.kingPos));
  }
  score += move.dist;
  return score;
}

function manhattan(board, r, c, pos) {
  return Math.abs(r - board.rowOf(pos)) + Math.abs(c - board.colOf(pos));
}

function manhattanToEscape(board, r, c) {
  const last = board.size - 1;
  if (board.variant.escape === 'corner') {
    return Math.min(r + c, r + last - c, last - r + c, last - r + last - c);
  }
  return Math.min(r, c, last - r, last - c);
}

function countAdjacentEnemies(board, r, c, turn) {
  let n = 0;
  for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const nr = r + dr;
    const nc = c + dc;
    if (!board.inBounds(nr, nc)) continue;
    const v = board.get(nr, nc);
    if (isPiece(v) && sideOf(v) !== turn) n += 1;
  }
  return n;
}

function createsCapture(board, r, c, turn) {
  for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const nr = r + dr;
    const nc = c + dc;
    if (!board.inBounds(nr, nc)) continue;
    const victim = board.get(nr, nc);
    if (!isPiece(victim) || sideOf(victim) === turn) continue;
    if (board.isSurrounded(nr, nc, victim, turn)) return true;
  }
  return false;
}

module.exports = { searchBestMove, negamax, orderMoves, winsImmediately };
