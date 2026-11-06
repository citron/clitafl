'use strict';

const { Board } = require('../src/rules/board');
const { getVariant } = require('../src/rules/variants');
const { KING, FROM_CODE, EMPTY } = require('../src/rules/pieces');

/**
 * Build a board from ASCII rows: K king, D defender, A attacker, . empty.
 * Keeps the tests readable and lets them probe exact tactical positions.
 */
function makeBoard(variantId, rows, options = {}) {
  const size = rows.length;
  const variant = getVariant(variantId, size);
  const board = new Board(variant);
  rows.forEach((row, r) => {
    const cells = row.split('');
    if (cells.length !== size) {
      throw new Error(`Row ${r} has ${cells.length} cells, expected ${size}`);
    }
    cells.forEach((ch, c) => {
      const code = FROM_CODE[ch];
      if (code === undefined) throw new Error(`Bad cell '${ch}' at ${r},${c}`);
      board.set(r, c, code);
    });
  });
  board.kingPos = board.indexOf(KING);
  board.kingHasEscaped = Boolean(options.kingHasEscaped);
  return board;
}

const idx = (size, r, c) => r * size + c;

function move(size, from, to) {
  return { from: idx(size, from[0], from[1]), to: idx(size, to[0], to[1]) };
}

module.exports = { makeBoard, idx, move, EMPTY };
