'use strict';

const { Game } = require('./rules/game');
const { AIPlayer } = require('./ai/player');
const { formatMove, formatSan, formatCaptures } = require('./rules/notation');
const { SIDE_ATTACKER, SIDE_DEFENDER } = require('./rules/pieces');

/** Deterministic RNG so scripted games and tests are reproducible. */
function seededRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Play a whole game with two search AIs, no terminal involved.
 * Used by `clitafl match`, the demo and the test suite.
 */
function playMatch(options = {}) {
  const game = options.game || Game.create(options.variant || 'tablut', options.size ?? null);
  const timeMs = options.timeMs ?? 60;
  const seed = options.seed ?? 1;
  const maxNodes = options.maxNodes ?? 0;
  const maxDepth = options.maxDepth || undefined;
  const levels = {
    [SIDE_ATTACKER]: options.attackerLevel || options.level || 'easy',
    [SIDE_DEFENDER]: options.defenderLevel || options.level || 'easy',
  };
  const players = {
    [SIDE_ATTACKER]: new AIPlayer(levels[SIDE_ATTACKER], { timeMs, maxNodes, maxDepth, rng: seededRng(seed) }),
    [SIDE_DEFENDER]: new AIPlayer(levels[SIDE_DEFENDER], { timeMs, maxNodes, maxDepth, rng: seededRng(seed + 7919) }),
  };
  const maxPlies = options.maxPlies ?? 500;
  const history = [];
  let captures = 0;

  while (!game.isGameOver() && game.ply < maxPlies) {
    const side = game.turn;
    const { move } = players[side].chooseMove(game, side);
    if (!move) {
      const other = side === SIDE_ATTACKER ? SIDE_DEFENDER : SIDE_ATTACKER;
      if (game.variant.noMove === 'loss') {
        const status = other === SIDE_ATTACKER ? 'attackers-win' : 'defenders-win';
        game.finish(status, other, `${sideLabel(side)} has no legal move.`);
      } else {
        game.finish('draw', null, `${sideLabel(side)} has no legal move.`);
      }
      break;
    }
    const result = game.play(move);
    captures += result.captured.length;
    history.push({
      ply: game.ply,
      side: result.side,
      notation: result.notation,
      san: formatSan(game.board.size, result.move, result.captured.length),
      captured: result.captured.map((cap) => cap.value),
      status: game.status,
    });
    if (options.onPly) options.onPly(result, game);
  }

  if (!game.isGameOver()) {
    game.finish('draw', null, `Match stopped after ${maxPlies} plies.`);
  }

  return {
    status: game.status,
    winner: game.winner,
    reason: game.reason,
    plies: game.ply,
    captures,
    history,
    summary: game.summary(),
    game,
    board: game.board,
    size: game.board.size,
    isGameOver: game.isGameOver(),
  };
}

function sideLabel(side) { return side === SIDE_DEFENDER ? 'Defender' : 'Attacker'; }

/** Plain text game record, used by the demo and `clitafl match`. */
function formatMatch(match, game) {
  return match.history.map((entry) => {
    const who = entry.side === SIDE_ATTACKER ? 'attackers' : 'defenders';
    const taken = entry.captured.length ? `  takes ${entry.captured.length}` : '';
    return `${String(entry.ply).padStart(3)}. ${who.padEnd(9)} ${entry.notation}${taken}`;
  }).join('\n');
}

module.exports = { playMatch, seededRng, formatMatch, sideLabel };
