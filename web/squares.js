'use strict';

/*
 * The board coordinates of the page, in one place so the page and the engine
 * cannot drift apart. Files are letters from the left, ranks are numbers from
 * the top: the top left cell is `a1`, the way `src/rules/notation.js` reads a
 * move and the way the terminal prints the board. `tests/server.test.js` pins
 * these two functions to the engine's own, square by square, on every size.
 */

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

/** The name of the cell at row `r`, column `c` of a `size` board. */
function squareOfIndex(size, r, c) {
  return `${LETTERS[c]}${r + 1}`;
}

/** The cell of a square name as `{ r, c }`, or `null` when the name is off the board. */
function indexOfSquare(size, square, files) {
  const text = String(square).trim().toLowerCase();
  const file = text[0];
  const rank = Number(text.slice(1));
  const c = files.indexOf(file);
  if (c < 0 || !Number.isInteger(rank) || rank < 1 || rank > size) return null;
  return { r: rank - 1, c };
}

// A plain script tag gives the page a global; require() gives the tests the module.
const squares = { squareOfIndex, indexOfSquare };
if (typeof module !== 'undefined' && module.exports) module.exports = squares;
if (typeof window !== 'undefined') window.clitaflSquares = squares;
