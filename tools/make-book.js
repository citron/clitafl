#!/usr/bin/env node
'use strict';

/**
 * Builds src/ai/book.json: the opening book the `hard` and `grandmaster` levels
 * open from. It plays a fixed set of seeded self-play games with the normal
 * search, records the move the search chose in every position it reached, and
 * writes the result as `clitafl-book-v1`.
 *
 * The seeds, the node budget and the games are fixed, so the same run always
 * produces the same book.
 *
 *   node tools/make-book.js                 write src/ai/book.json
 *   node tools/make-book.js --games 40      more games per variant
 *   node tools/make-book.js --out book.json write elsewhere
 */

const fs = require('node:fs');
const path = require('node:path');

const { Game } = require('../src/rules/game');
const { AIPlayer } = require('../src/ai/player');
const { bookKey, BOOK_FORMAT } = require('../src/ai/book');
const { seededRng } = require('../src/headless');

/** How much preparation each variant gets. */
const PREP = {
  brandub: { games: 24, plies: 10, nodes: 6000 },
  copenhagen: { games: 24, plies: 10, nodes: 6000 },
  tablut: { games: 24, plies: 10, nodes: 6000 },
  alea: { games: 10, plies: 8, nodes: 20000 },
};

const MAX_MOVES_PER_POSITION = 3;

function args(argv) {
  const out = { games: 0, plies: 0, nodes: 0, out: path.join(__dirname, '..', 'src', 'ai', 'book.json') };
  for (let i = 0; i < argv.length; i += 1) {
    const key = String(argv[i]).replace(/^--/, '');
    if (key === 'out') out.out = argv[i + 1];
    else if (key === 'games') out.games = Number(argv[i + 1]);
    else if (key === 'plies') out.plies = Number(argv[i + 1]);
    else if (key === 'nodes') out.nodes = Number(argv[i + 1]);
  }
  return out;
}

/** One seeded self-play game, recording the chosen move of every ply. */
function recordGame(variantId, seed, prep, record) {
  const game = Game.create(variantId);
  const players = {
    attacker: new AIPlayer('medium', { maxNodes: prep.nodes, book: false, rng: seededRng(seed) }),
    defender: new AIPlayer('medium', { maxNodes: prep.nodes, book: false, rng: seededRng(seed + 104729) }),
  };
  let plies = 0;
  while (!game.isGameOver() && plies < prep.plies) {
    const side = game.turn;
    const { move } = players[side].chooseMove(game, side);
    if (!move) break;
    const key = bookKey(game.board, side);
    let entry = record.get(key);
    if (!entry) {
      entry = { moves: [] };
      record.set(key, entry);
    }
    const isNew = entry.moves.every((m) => m.from !== move.from || m.to !== move.to);
    if (isNew && entry.moves.length < MAX_MOVES_PER_POSITION) {
      entry.moves.push({ from: move.from, to: move.to });
    }
    game.play(move);
    plies += 1;
  }
  return plies;
}

function main() {
  const opts = args(process.argv.slice(2));
  const record = new Map();
  let maxPly = 0;
  const started = Date.now();

  for (const [id, base] of Object.entries(PREP)) {
    const prep = {
      games: opts.games || base.games,
      plies: opts.plies || base.plies,
      nodes: opts.nodes || base.nodes,
    };
    let count = 0;
    for (let g = 0; g < prep.games; g += 1) {
      count += recordGame(id, 1000 + g * 17, prep, record);
    }
    maxPly = Math.max(maxPly, prep.plies);
    process.stderr.write(`${id}: ${count} plies recorded, ${record.size} positions so far\n`);
  }

  const positions = {};
  for (const [key, entry] of record) positions[key] = entry;
  const book = {
    format: BOOK_FORMAT,
    generator: 'tools/make-book.js',
    maxPly,
    positions: Object.keys(positions).length,
    entries: positions,
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(opts.out, `${JSON.stringify(book)}\n`);
  const bytes = fs.statSync(opts.out).size;
  process.stderr.write(`${opts.out}: ${book.positions} positions, maxPly ${maxPly}, `
    + `${(bytes / 1024).toFixed(0)} KiB in ${((Date.now() - started) / 1000).toFixed(1)} s\n`);
}

main();
