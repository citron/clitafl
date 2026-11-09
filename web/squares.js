'use strict';

/*
 * The board geometry of the page, in one place so the page and the engine
 * cannot drift apart.
 *
 * Coordinates: files are letters from the left, ranks are numbers from the
 * top — the top left cell is `a1`, the way `src/rules/notation.js` reads a
 * move and the way the terminal prints the board.
 *
 * Sizing: the board is drawn at the size of the window it is in, never at a
 * size of its own, so `fitSquare` answers how big one cell may be for a
 * `size` board to fit inside a `width` x `height` box, `boardBox` is the same
 * arithmetic the other way round, and `boardScale` shrinks a board whole when
 * the window is smaller than the smallest readable board. `style.css` reads
 * `--sq`, `--gap`, `--pad` and `--scale` from what `app.js` computes here.
 *
 * `tests/server.test.js` pins all of this: every square against the engine's
 * own `formatSquare`, and `fitSquare` against `boardBox` on every board size
 * and window it is asked to fill.
 *
 * Everything is inside a function: a plain script tag shares one global
 * scope, so a top level `function` here would collide with a name of the same
 * spelling in `app.js`, and the page would refuse to parse. The page only
 * ever sees the `clitaflSquares` global, and the tests only the module.
 */

(function exposeSquares(global) {
  const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

  /* A cell smaller than this cannot show a piece; a board that needs it is
   * drawn at this floor and the window is simply too small for it. */
  const SQ_MIN = 10;
  /* Past this the board stops gaining anything and a 7x7 turns into a wall. */
  const SQ_MAX = 84;
  /* The grid gap and the frame the CSS draws, as a share of one cell. */
  const GAP_SHARE = 0.045;
  const PAD_SHARE = 0.18;

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

  /** The gap between two cells of a `size` board drawn with cells of `sq` px. */
  function boardGap(size, sq) {
    return Math.max(1, Math.round(sq * GAP_SHARE));
  }

  /** The frame around a board drawn with cells of `sq` px. */
  function boardPad(sq) {
    return Math.max(3, Math.round(sq * PAD_SHARE));
  }

  /** The box a `size` board of `sq` cells takes, gap and frame included. */
  function boardBox(size, sq) {
    const gap = boardGap(size, sq);
    const pad = boardPad(sq);
    const side = size * sq + (size - 1) * gap + 2 * pad;
    return { w: side, h: side, gap, pad };
  }

  /**
   * The largest cell for which a `size` board fits in a `width` x `height`
   * box: the board is square, so the box's shorter side decides. The walk
   * starts at the largest cell worth drawing and comes down to the first one
   * that fits, which is exact — the gap and the frame are rounded from the
   * cell, so an estimate divided out of the window is not.
   */
  function fitSquare(size, width, height) {
    const side = Math.min(width, height);
    if (!(side > 0) || !(size > 0)) return SQ_MIN;
    let sq = SQ_MAX;
    while (sq > SQ_MIN && boardBox(size, sq).w > side) sq -= 1;
    return sq;
  }

  /**
   * How much to shrink the drawing of a board that does not fit even at the
   * smallest readable cell. A window smaller than a 19x19 board of 10px cells
   * gets the whole board at that scale, never a board cut off at the edge:
   * 1 means the board is drawn at the size `fitSquare` asked for.
   */
  function boardScale(size, width, height) {
    const box = boardBox(size, fitSquare(size, width, height));
    const side = Math.min(width, height);
    if (!(side > 0) || !(box.w > 0)) return 1;
    return Math.min(1, side / box.w);
  }

  const squares = {
    squareOfIndex, indexOfSquare, fitSquare, boardScale, boardBox, boardGap, boardPad, SQ_MIN, SQ_MAX,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = squares;
  if (global) global.clitaflSquares = squares;
})(typeof window !== 'undefined' ? window : null);
