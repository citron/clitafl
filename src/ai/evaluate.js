'use strict';

const {
  KING, DEFENDER, ATTACKER, EMPTY,
  SIDE_DEFENDER, isPiece, sideOf,
} = require('../rules/pieces');

const MATE = 1000000;
const MATERIAL = { [KING]: 0, [DEFENDER]: 100, [ATTACKER]: 100 };

/**
 * Static evaluation, always from the DEFENDER's point of view (positive is good
 * for the king's side). It keeps the two strategic themes of tafl: the king's
 * run for the escape squares, and the attackers' squeeze around him.
 *
 * It is deliberately cheap: no move generation, no flood fill, so the search
 * can visit many nodes per second.
 */
function evaluate(board) {
  const size = board.size;
  const grid = board.grid;
  const kingPos = board.kingPos;
  if (kingPos < 0) return -MATE;

  const kr = board.rowOf(kingPos);
  const kc = board.colOf(kingPos);
  let score = 0;
  let defenderSpace = 0;
  let attackerSpace = 0;
  let defenders = 0;
  let attackers = 0;

  for (let i = 0; i < grid.length; i += 1) {
    const v = grid[i];
    if (!isPiece(v)) continue;
    const defender = sideOf(v) === SIDE_DEFENDER;
    score += defender ? MATERIAL[v] : -MATERIAL[v];
    if (defender) defenders += 1;
    else attackers += 1;

    const r = board.rowOf(i);
    const c = board.colOf(i);
    const distToKing = Math.abs(r - kr) + Math.abs(c - kc);

    if (v === ATTACKER) {
      score -= (12 - Math.min(12, distToKing)) * 3;
      attackerSpace += countOpenNeighbours(board, r, c);
    } else if (v === DEFENDER) {
      score += (6 - Math.min(6, distToKing)) * 2;
      defenderSpace += countOpenNeighbours(board, r, c);
    }
  }

  score += (defenderSpace / Math.max(1, defenders) - attackerSpace / Math.max(1, attackers)) * 50;

  const escapeDist = minEscapeDistance(board, kr, kc);
  score += (size - escapeDist) * 14;

  for (const m of board.movesFrom(kr, kc)) {
    const r = board.rowOf(m.to);
    const c = board.colOf(m.to);
    score += 5;
    if (board.isEscapeSquare(r, c)) score += 260;
  }

  score += openLinesToEscape(board, kr, kc) * 55;
  score += Math.max(0, defenders - 3) * 5;
  return score;
}

function countOpenNeighbours(board, r, c) {
  let n = 0;
  for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const nr = r + dr;
    const nc = c + dc;
    if (board.inBounds(nr, nc) && board.get(nr, nc) === EMPTY) n += 1;
  }
  return n;
}

function minEscapeDistance(board, r, c) {
  const last = board.size - 1;
  if (board.variant.escape === 'corner') {
    return Math.min(
      r + c,
      r + (last - c),
      (last - r) + c,
      (last - r) + (last - c),
    );
  }
  if (board.variant.escape === 'cornerblock') {
    // The exits are the four marked 2x2 blocks: a square is in one when both
    // coordinates are within 1 of the nearest edge.
    const nearTop = Math.max(0, r - 1);
    const nearBottom = Math.max(0, last - 1 - r);
    const nearLeft = Math.max(0, c - 1);
    const nearRight = Math.max(0, last - 1 - c);
    return Math.min(nearTop + nearLeft, nearTop + nearRight, nearBottom + nearLeft, nearBottom + nearRight);
  }
  return Math.min(r, c, last - r, last - c);
}

/** Straight lines from the king that reach an escape square with nothing on them. */
function openLinesToEscape(board, r, c) {
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  let open = 0;
  for (const [dr, dc] of dirs) {
    let nr = r + dr;
    let nc = c + dc;
    let clear = true;
    let reachesEscape = false;
    while (board.inBounds(nr, nc)) {
      if (board.get(nr, nc) !== EMPTY) { clear = false; break; }
      if (board.isEscapeSquare(nr, nc)) { reachesEscape = true; break; }
      nr += dr;
      nc += dc;
    }
    if (clear && reachesEscape) open += 1;
  }
  return open;
}

/** Signed score for the side to move. */
function scoreFor(board, turn) {
  const value = evaluate(board);
  return turn === SIDE_DEFENDER ? value : -value;
}

module.exports = { evaluate, scoreFor, minEscapeDistance, openLinesToEscape, MATE, MATERIAL };
