'use strict';

const { KING, SIDE_DEFENDER, SIDE_ATTACKER, isPiece, sideOf } = require('../rules/pieces');
const { MATE, scoreFor, minEscapeDistance } = require('./evaluate');
const { hashBoard, applyKey, geometryId } = require('./zobrist');

const other = (side) => (side === SIDE_DEFENDER ? SIDE_ATTACKER : SIDE_DEFENDER);

const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIR_PAIRS = [[[-1, 0], [1, 0]], [[0, -1], [0, 1]]];

const EXACT = 0;
const LOWER = 1;
const UPPER = 2;
const MATE_WINDOW = 1000;
const QUIESCE_DEPTH = 4;
const QUIESCE_WIDTH = 12;
const KILLERS_PER_PLY = 2;

/**
 * Transposition table, keyed by a Zobrist pair. Entries record the depth they
 * were searched to, so a deeper result always replaces a shallower one, and the
 * best move found there, which is the strongest move-ordering hint there is.
 * Mate scores are stored relative to the node, so an entry can be read at any
 * distance from the mate.
 */
class TranspositionTable {
  constructor(maxEntries = 1 << 18) {
    this.entries = new Map();
    this.maxEntries = maxEntries;
  }

  get(keyA, keyB, geo) {
    const entry = this.entries.get(keyA);
    if (entry === undefined || entry.keyB !== keyB || entry.geo !== geo) return null;
    return entry;
  }

  store(keyA, keyB, geo, depth, score, flag, move) {
    if (this.entries.size >= this.maxEntries) this.entries.clear();
    const existing = this.entries.get(keyA);
    if (existing !== undefined
      && existing.keyB === keyB
      && existing.geo === geo
      && existing.depth > depth) return;
    this.entries.set(keyA, {
      keyB,
      geo,
      depth,
      score,
      flag,
      from: move ? move.from : -1,
      to: move ? move.to : -1,
    });
  }

  get size() { return this.entries.size; }
  clear() { this.entries.clear(); }
}

/**
 * Negamax with alpha-beta pruning, a transposition table, killer moves, a
 * capture-only quiescence search, iterative deepening and a wall-clock budget.
 * The board is mutated and un-applied in place, so no node allocates a board.
 */
function searchBestMove(board, turn, options = {}) {
  const maxDepth = options.maxDepth ?? 12;
  const timeMs = options.timeMs ?? 1000;
  const table = options.table || new TranspositionTable();
  const geo = geometryId(board.variant);
  const ctx = {
    nodes: 0,
    deadline: Date.now() + timeMs,
    // A node budget makes a search reproducible: it stops on a count and the
    // wall clock is not consulted at all, which is what the test suite and
    // replayed matches need. Without one, the clock decides.
    nodeLimit: options.maxNodes && options.maxNodes > 0 ? options.maxNodes : 0,
    timed: !(options.maxNodes && options.maxNodes > 0),
    aborted: false,
    noMove: board.variant.noMove,
    table,
    geo,
    key: hashBoard(board, turn),
    killers: [],
  };

  let rootMoves = orderMoves(board, turn, null, null);
  if (rootMoves.length === 0) return { move: null, score: 0, depth: 0, nodes: 0, ranked: null };

  let best = rootMoves[0];
  let bestScore = -Infinity;
  let reachedDepth = 0;
  let ranked = null;
  let partial = null;

  for (let depth = 1; depth <= maxDepth; depth += 1) {
    const scored = [];
    let alpha = -Infinity;
    for (const move of rootMoves) {
      const piece = board.grid[move.from];
      const applied = board.applyMove(move);
      applyKey(ctx.key, piece, move, applied.captured);
      const value = winsImmediately(board, move, applied, turn)
        ? MATE
        : -negamax(board, other(turn), depth - 1, -Infinity, -alpha, 1, ctx);
      board.undoMove(move, applied);
      applyKey(ctx.key, piece, move, applied.captured);
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
      partial = scored;
      if (!ctx.aborted) {
        // Only a complete iteration re-orders the root and becomes the answer: a
        // half-searched list would make the move depend on when the clock ran out.
        ranked = scored;
        rootMoves = scored.map((s) => s.move);
        best = scored[0].move;
        bestScore = scored[0].value;
        reachedDepth = depth;
      }
    }
    if (ctx.aborted) break;
    if (bestScore >= MATE - MATE_WINDOW) break;
    if (ctx.timed && Date.now() > ctx.deadline) break;
    if (ctx.nodeLimit > 0 && ctx.nodes >= ctx.nodeLimit) break;
  }

  return {
    move: best,
    score: bestScore,
    depth: reachedDepth,
    nodes: ctx.nodes,
    aborted: ctx.aborted,
    ranked: ranked || partial,
    ttSize: table.size,
  };
}

/** Counts a node and reports whether the budget (clock, or node cap) is spent. */
function tick(ctx) {
  ctx.nodes += 1;
  if ((ctx.nodes & 1023) === 0) {
    // A node budget is a complete answer on its own: the clock is never read, so
    // the same budget always gives the same move.
    if (ctx.nodeLimit > 0) {
      if (ctx.nodes >= ctx.nodeLimit) ctx.aborted = true;
    } else if (Date.now() > ctx.deadline) {
      ctx.aborted = true;
    }
  }
  return ctx.aborted;
}

function negamax(board, turn, depth, alpha, beta, ply, ctx) {
  if (tick(ctx)) return scoreFor(board, turn);

  const alphaOrig = alpha;
  const { key, geo, table } = ctx;
  const hit = table.get(key.a, key.b, geo);
  let ttMove = null;
  if (hit !== null) {
    const score = loadScore(hit.score, ply);
    if (hit.depth >= depth
      && (hit.flag === EXACT
        || (hit.flag === LOWER && score >= beta)
        || (hit.flag === UPPER && score <= alphaOrig))) {
      return score;
    }
    if (hit.from >= 0) ttMove = { from: hit.from, to: hit.to };
  }

  const killers = ctx.killers[ply] || null;
  if (depth <= 0) return quiescence(board, turn, alpha, beta, ply, ctx, QUIESCE_DEPTH);
  const moves = orderMoves(board, turn, ttMove, killers);
  if (moves.length === 0) return ctx.noMove === 'loss' ? -MATE + ply : 0;

  let best = -Infinity;
  let bestMove = null;
  for (const move of moves) {
    const piece = board.grid[move.from];
    const applied = board.applyMove(move);
    applyKey(ctx.key, piece, move, applied.captured);
    const value = winsImmediately(board, move, applied, turn)
      ? MATE - ply
      : -negamax(board, other(turn), depth - 1, -beta, -alpha, ply + 1, ctx);
    board.undoMove(move, applied);
    applyKey(ctx.key, piece, move, applied.captured);
    if (ctx.aborted) return best === -Infinity ? scoreFor(board, turn) : best;
    if (value > best) {
      best = value;
      bestMove = move;
    }
    if (value > alpha) alpha = value;
    if (alpha >= beta) {
      // A quiet move that raises alpha is a good candidate for the next node
      // with the same shape of position.
      if (!createsCapture(board, move.to, turn)) recordKiller(ctx, ply, move);
      break;
    }
  }

  if (!ctx.aborted) {
    const flag = best >= beta ? LOWER : (best > alphaOrig ? EXACT : UPPER);
    table.store(key.a, key.b, geo, depth, storeScore(best, ply), flag, bestMove);
  }
  return best;
}

/**
 * Quiescence search: at the end of a line, keep only the moves that capture, so
 * a evaluation is never taken in the middle of a trade. Captures are the
 * forcing moves of tafl, and this is what stops the search from trading a duke
 * for a count and calling the result even.
 */
function quiescence(board, turn, alpha, beta, ply, ctx, qdepth) {
  if (tick(ctx)) return scoreFor(board, turn);

  const standPat = scoreFor(board, turn);
  if (standPat >= beta) return standPat;
  let best = standPat;
  if (standPat > alpha) alpha = standPat;
  if (qdepth <= 0) return best;

  const moves = captureMoves(board, turn);
  if (moves.length > QUIESCE_WIDTH) moves.length = QUIESCE_WIDTH;
  for (const move of moves) {
    const piece = board.grid[move.from];
    const applied = board.applyMove(move);
    applyKey(ctx.key, piece, move, applied.captured);
    const value = winsImmediately(board, move, applied, turn)
      ? MATE - ply
      : -quiescence(board, other(turn), -beta, -alpha, ply + 1, ctx, qdepth - 1);
    board.undoMove(move, applied);
    applyKey(ctx.key, piece, move, applied.captured);
    if (ctx.aborted) return best;
    if (value > best) best = value;
    if (value > alpha) alpha = value;
    if (alpha >= beta) break;
  }
  return alpha;
}

/** A move that ends the game at once: capture of the king, or the king's escape. */
function winsImmediately(board, move, applied, turn) {
  if (turn === SIDE_ATTACKER && applied.captured.some((cap) => cap.value === KING)) return true;
  if (turn === SIDE_DEFENDER && board.get(board.rowOf(move.to), board.colOf(move.to)) === KING) {
    return board.isEscapeSquare(board.rowOf(move.to), board.colOf(move.to));
  }
  return false;
}

/** Cheap ordering: transposition move, killers, escapes, captures, piece progress. */
function orderMoves(board, turn, ttMove, killers) {
  const moves = board.legalMoves(turn);
  for (const move of moves) {
    move.order = moveHeuristic(board, move, turn);
    if (ttMove && move.from === ttMove.from && move.to === ttMove.to) move.order = 2e9;
    else if (killers) {
      for (let k = 0; k < killers.length; k += 1) {
        if (killers[k] && killers[k].from === move.from && killers[k].to === move.to) {
          move.order = 1e6 - k * 1000;
          break;
        }
      }
    }
  }
  moves.sort((a, b) => b.order - a.order);
  return moves;
}

/** Only the moves that take a piece, used by the quiescence search. */
function captureMoves(board, turn) {
  const moves = [];
  for (const move of board.legalMoves(turn)) {
    const count = captureCount(board, board.rowOf(move.to), board.colOf(move.to), turn);
    if (count > 0) {
      move.order = 1e5 + count * 100;
      moves.push(move);
    }
  }
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
  if (victimNeighbours > 0) score += captureCount(board, tr, tc, turn) * 120;

  if (piece === KING) {
    score += 40 - minEscapeDistance(board, tr, tc) * 4;
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

/** How many pieces the mover takes by landing on r,c. */
function captureCount(board, r, c, turn) {
  let n = 0;
  for (const [dr, dc] of DIRS) {
    const nr = r + dr;
    const nc = c + dc;
    if (!board.inBounds(nr, nc)) continue;
    const victim = board.get(nr, nc);
    if (!isPiece(victim) || sideOf(victim) === turn) continue;
    if (isTakenAfter(board, nr, nc, victim, r, c)) n += 1;
  }
  return n;
}

/**
 * Is the piece at (r,c) taken once the mover has landed on (landR,landC)? The
 * landing square counts as a captor on the mover's side, the variant's
 * king-capture count decides for the king, and the check is the same
 * custodian/surrounding test the board applies.
 */
function isTakenAfter(board, r, c, victim, landR, landC) {
  if (victim === KING && board.isEscapeSquare(r, c)) return false;
  const needed = victim === KING ? board.kingCaptureNeed(r, c) : 2;
  const hostileAt = (nr, nc) => {
    if (nr === landR && nc === landC) return true;
    return board.captorAt(nr, nc, victim);
  };
  const hostile = DIRS.map(([dr, dc]) => hostileAt(r + dr, c + dc));
  if (needed >= 4) return hostile.every(Boolean);
  if (needed === 3) return hostile.filter(Boolean).length >= 3;
  return DIR_PAIRS.some(([[ar, ac], [br, bc]]) => hostileAt(r + ar, c + ac) && hostileAt(r + br, c + bc));
}

function createsCapture(board, r, c, turn) {
  return captureCount(board, r, c, turn) > 0;
}

function recordKiller(ctx, ply, move) {
  let list = ctx.killers[ply];
  if (!list) {
    list = [];
    ctx.killers[ply] = list;
  }
  if (list.length > 0 && list[0].from === move.from && list[0].to === move.to) return;
  list.unshift({ from: move.from, to: move.to });
  if (list.length > KILLERS_PER_PLY) list.length = KILLERS_PER_PLY;
}

/** Mate scores are stored as "mate in n from this node" and read back at any ply. */
function storeScore(score, ply) {
  if (score >= MATE - MATE_WINDOW) return score - ply;
  if (score <= -MATE + MATE_WINDOW) return score + ply;
  return score;
}

function loadScore(score, ply) {
  if (score >= MATE - MATE_WINDOW) return score + ply;
  if (score <= -MATE + MATE_WINDOW) return score - ply;
  return score;
}

module.exports = {
  searchBestMove,
  negamax,
  quiescence,
  orderMoves,
  captureMoves,
  winsImmediately,
  createsCapture,
  TranspositionTable,
};
