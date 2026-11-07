'use strict';

const { searchBestMove, TranspositionTable } = require('./search');
const { bookMove: bookLookup } = require('./book');
const { formatMove } = require('../rules/notation');

/** Playing strength presets. `timeMs` is a hard budget, `maxDepth` a ceiling. */
const LEVELS = {
  easy: { label: 'Easy', maxDepth: 2, timeMs: 120, noise: 90, topK: 8 },
  medium: { label: 'Medium', maxDepth: 6, timeMs: 700, noise: 12, topK: 2 },
  hard: { label: 'Hard', maxDepth: 12, timeMs: 2500, noise: 0, topK: 1, book: true },
  grandmaster: { label: 'Grandmaster', maxDepth: 30, timeMs: 8000, noise: 0, topK: 1, book: true },
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
    this.maxNodes = options.maxNodes ?? 0;
    this.rng = options.rng || Math.random;
    this.label = options.label || `AI (${this.level.label})`;
    // One transposition table per player: the positions it has already searched
    // stay useful from one move of the same game to the next. Strong levels open
    // with the prepared book, which can be replaced by options.book.
    this.table = options.table || new TranspositionTable();
    this.useBook = options.book === false ? false : Boolean(options.book || this.level.book);
    this.bookData = typeof options.book === 'object' && options.book !== null ? options.book : undefined;
    this.lastInfo = null;
  }

  /** Choose a move for `turn` on `game.board`. Returns { move, info }. */
  chooseMove(game, turn = game.turn) {
    const prepared = this.useBook
      ? bookLookup(game, turn, { rng: this.rng, book: this.bookData })
      : null;
    if (prepared) {
      this.lastInfo = {
        level: this.levelName,
        depth: 0,
        nodes: 0,
        score: 0,
        move: formatMove(game.board.size, prepared),
        time_ms: 0,
        tt_size: this.table.size,
        source: 'book',
      };
      return { move: prepared, info: this.lastInfo };
    }
    const started = Date.now();
    const result = searchBestMove(game.board, turn, {
      maxDepth: this.maxDepth,
      timeMs: this.timeMs,
      maxNodes: this.maxNodes,
      table: this.table,
    });
    const elapsed = Date.now() - started;
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
      time_ms: elapsed,
      tt_size: result.ttSize,
      source: 'search',
    };
    return { move: pick.move, info: this.lastInfo };
  }
}

module.exports = { AIPlayer, LEVELS, LEVEL_IDS, levelOf };
