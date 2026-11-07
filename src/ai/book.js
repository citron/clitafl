'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { CODES } = require('../rules/pieces');
const { geometryId } = require('./zobrist');

const DEFAULT_BOOK = path.join(__dirname, 'book.json');
const BOOK_FORMAT = 'clitafl-book-v1';

const cache = new Map();

/**
 * Opening book: positions reached by prepared self-play (tools/make-book.js),
 * keyed by the rules, the side to move and the board, with the moves strong
 * play chose in them. A book move is only a suggestion: it is checked against
 * the legal moves before it is played.
 */
function loadBook(file = DEFAULT_BOOK) {
  if (cache.has(file)) return cache.get(file);
  let book = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && parsed.format === BOOK_FORMAT) book = parsed;
  } catch {
    book = null;
  }
  cache.set(file, book);
  return book;
}

/** Stable key of a position: rules, side to move, then one row per rank. */
function bookKey(board, turn) {
  const rows = [];
  for (let r = 0; r < board.size; r += 1) {
    let row = '';
    for (let c = 0; c < board.size; c += 1) row += CODES[board.get(r, c)];
    rows.push(row);
  }
  return `${geometryId(board.variant)}|${turn}|${rows.join('/')}`;
}

/** The moves prepared for this position, [] when the book has nothing. */
function bookMoves(game, turn, options = {}) {
  const book = options.book === undefined ? loadBook() : options.book;
  if (!book) return [];
  const entries = book.entries || {};
  if (game.ply > (book.maxPly || 0)) return [];
  const entry = entries[bookKey(game.board, turn)];
  if (!entry || !Array.isArray(entry.moves)) return [];
  return entry.moves.map((m) => ({ from: m.from, to: m.to }));
}

/** One legal book move for this position, or null. */
function bookMove(game, turn, options = {}) {
  const list = bookMoves(game, turn, options);
  if (list.length === 0) return null;
  const rng = options.rng || Math.random;
  const pick = list[Math.floor(rng() * list.length)] || list[0];
  return game.board.isLegalMove(pick.from, pick.to, turn) ? pick : null;
}

module.exports = { loadBook, bookKey, bookMoves, bookMove, BOOK_FORMAT, DEFAULT_BOOK };
