'use strict';

const { searchBestMove } = require('./search');
const { formatMove } = require('../rules/notation');

/** Playing strength presets. `timeMs` is a hard budget, `maxDepth` a ceiling. */
const LEVELS = {
  easy: { label: 'Easy', maxDepth: 2, timeMs: 120, noise: 90, topK: 8 },
  medium: { label: 'Medium', maxDepth: 6, timeMs: 700, noise: 12, topK: 2 },
  hard: { label: 'Hard', maxDepth: 12, timeMs: 2500, noise: 0, topK: 1 },
  grandmaster: { label: 'Grandmaster', maxDepth: 30, timeMs: 8000, noise: 0, topK: 1 },
};

const LEVEL_IDS = Object.keys(LEVELS);

function levelOf(name) {
  const level = LEVELS[String(name).toLowerCase()];
  if (!level) {
    throw new Error(`Unknown AI level '${name}'. Known: ${LEVEL_IDS.join(', ')}`);
  }
  return level;
}

/** A search-driven player: alpha-beta, iterative deepening, time budget, strength presets. */
class AIPlayer {
  constructor(level = 'medium', options = {}) {
    this.levelName = String(level).toLowerCase();
    this.level = levelOf(this.levelName);
    this.timeMs = options.timeMs ?? this.level.timeMs;
    this.maxDepth = options.maxDepth ?? this.level.maxDepth;
    this.rng = options.rng || Math.random;
    this.label = options.label || `AI (${this.level.label})`;
    this.lastInfo = null;
  }

  /** Choose a move for `turn` on `game.board`. Returns { move, info }. */
  chooseMove(game, turn = game.turn) {
    const result = searchBestMove(game.board, turn, {
      maxDepth: this.maxDepth,
      timeMs: this.timeMs,
    });
    if (!result.move) return { move: null, info: result };

    const ranked = result.ranked || [{ move: result.move, value: result.score }];
    const pool = ranked.slice(0, Math.max(1, this.level.topK));
    const floor = pool[0].value - this.level.noise;
    const eligible = pool.filter((entry) => entry.value >= floor);
    const pick = eligible[Math.floor(this.rng() * eligible.length)] || pool[0];

    this.lastInfo = {
      level: this.levelName,
      depth: result.depth,
      nodes: result.nodes,
      score: pick.value,
      move: formatMove(game.board.size, pick.move),
    };
    return { move: pick.move, info: this.lastInfo };
  }
}

module.exports = { AIPlayer, LEVELS, LEVEL_IDS, levelOf };
