'use strict';

const {
  EMPTY, KING, DEFENDER, ATTACKER,
  SIDE_DEFENDER, SIDE_ATTACKER,
  isPiece, sideOf, CODES, FROM_CODE,
} = require('./pieces');

const V = require('./variants');

const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIR_PAIRS = [[[ -1, 0], [1, 0]], [[0, -1], [0, 1]]];

/**
 * Board: geometry, movement and capture rules for any variant and size.
 * The grid is a flat Uint8Array, so clone() and search make copies cheaply.
 */
class Board {
  constructor(variant, grid = null) {
    this.variant = variant;
    this.size = variant.size;
    this.grid = grid ? Uint8Array.from(grid) : new Uint8Array(this.size * this.size);
    this.kingPos = -1;
    this.kingHome = V.centerOf(this.size) * this.size + V.centerOf(this.size);
    this.kingHasEscaped = false;
  }

  static fromVariant(variant) {
    const board = new Board(variant);
    for (const [r, c, code] of V.buildSetup(variant, variant.size)) {
      if (r < 0 || r >= board.size || c < 0 || c >= board.size) continue;
      board.set(r, c, code);
    }
    board.kingPos = board.indexOf(KING);
    return board;
  }

  idx(r, c) { return r * this.size + c; }
  rowOf(i) { return Math.floor(i / this.size); }
  colOf(i) { return i % this.size; }
  inBounds(r, c) { return r >= 0 && r < this.size && c >= 0 && c < this.size; }
  get(r, c) { return this.grid[this.idx(r, c)]; }
  isCastle(r, c) { return V.isCastle(this.variant, this.size, r, c); }
  isThrone(r, c) { return V.isThrone(this.variant, this.size, r, c); }
  isEscapeSquare(r, c) { return V.isEscapeSquare(this.variant, this.size, r, c); }
  isOnEdge(r, c) { return r === 0 || r === this.size - 1 || c === 0 || c === this.size - 1; }
  set(r, c, value) {
    this.grid[this.idx(r, c)] = value;
    if (value === KING) this.kingPos = this.idx(r, c);
  }
  at(i) { return this.grid[i]; }
  clone() { return new Board(this.variant, this.grid); }
  copyFrom(other) {
    this.grid.set(other.grid);
    this.kingPos = other.kingPos;
    this.kingHasEscaped = other.kingHasEscaped;
  }
  indexOf(code) { return this.grid.indexOf(code); }

  countOf(side) {
    let n = 0;
    for (const v of this.grid) if (isPiece(v) && sideOf(v) === side) n += 1;
    return n;
  }

  kingAlive() { return this.kingPos >= 0 && this.grid[this.kingPos] === KING; }

  /** Compact key used for repetition detection and the transposition table. */
  key(turn) {
    let s = '';
    for (const v of this.grid) s += CODES[v];
    return `${turn}:${this.kingHasEscaped ? 1 : 0}:${s}`;
  }

  /** Legal rook moves for the piece at r,c. No jumping, castle rules applied. */
  movesFrom(r, c) {
    const piece = this.get(r, c);
    if (!isPiece(piece)) return [];
    const moves = [];
    for (const [dr, dc] of DIRS) {
      let nr = r + dr;
      let nc = c + dc;
      while (this.inBounds(nr, nc) && this.get(nr, nc) === EMPTY) {
        if (this.canLandOn(nr, nc, piece)) moves.push({ from: this.idx(r, c), to: this.idx(nr, nc), dist: Math.abs(nr - r) + Math.abs(nc - c) });
        nr += dr;
        nc += dc;
      }
    }
    return moves;
  }

  canLandOn(r, c, piece) {
    const allow = V.castleEnterableBy(this.variant, this.size, r, c);
    if (piece === KING) return allow.king;
    if (piece === DEFENDER) return allow.defender;
    if (piece === ATTACKER) return allow.attacker;
    return true;
  }

  legalMoves(side) {
    const moves = [];
    for (let i = 0; i < this.grid.length; i += 1) {
      const v = this.grid[i];
      if (!isPiece(v) || sideOf(v) !== side) continue;
      moves.push(...this.movesFrom(this.rowOf(i), this.colOf(i)));
    }
    return moves;
  }

  hasLegalMoves(side) {
    for (let i = 0; i < this.grid.length; i += 1) {
      const v = this.grid[i];
      if (!isPiece(v) || sideOf(v) !== side) continue;
      if (this.movesFrom(this.rowOf(i), this.colOf(i)).length > 0) return true;
    }
    return false;
  }

  isLegalMove(from, to, side) {
    const piece = this.grid[from];
    if (!isPiece(piece) || sideOf(piece) !== side) return false;
    const r = this.rowOf(from);
    const c = this.colOf(from);
    const tr = this.rowOf(to);
    const tc = this.colOf(to);
    if (from === to) return false;
    if (r !== tr && c !== tc) return false;
    if (this.get(tr, tc) !== EMPTY) return false;
    const dr = Math.sign(tr - r);
    const dc = Math.sign(tc - c);
    for (let step = 1; step < Math.abs(tr - r) + Math.abs(tc - c); step += 1) {
      if (this.get(r + dr * step, c + dc * step) !== EMPTY) return false;
    }
    return this.canLandOn(tr, tc, piece);
  }

  /**
   * Apply a move and resolve every capture it triggers.
   * Returns the list of removed pieces so undoMove can restore them.
   */
  applyMove(move) {
    const piece = this.grid[move.from];
    const kingHasEscapedBefore = this.kingHasEscaped;
    this.grid[move.from] = EMPTY;
    this.grid[move.to] = piece;
    this.kingPos = piece === KING ? move.to : this.kingPos;
    if (piece === KING && this.isEscapeSquare(this.rowOf(move.to), this.colOf(move.to))) {
      this.kingHasEscaped = true;
    }
    return { captured: this.resolveCaptures(move.to, sideOf(piece)), kingHasEscapedBefore };
  }

  undoMove(move, { captured = [], kingHasEscapedBefore = false } = {}) {
    const piece = this.grid[move.to];
    this.grid[move.to] = EMPTY;
    this.grid[move.from] = piece;
    this.kingHasEscaped = kingHasEscapedBefore;
    if (piece === KING) this.kingPos = move.from;
    for (const cap of captured) {
      this.grid[cap.i] = cap.value;
      if (cap.value === KING) this.kingPos = cap.i;
    }
  }

  /**
   * Captures are checked around the piece that just moved (the active side
   * captures). A soldier needs enemies on two opposite sides; the king needs
   * variant.kingCapture enemies, with castle squares and (optionally) the edge
   * counting as captors.
   */
  resolveCaptures(at, moverSide) {
    const captured = [];
    const r0 = this.rowOf(at);
    const c0 = this.colOf(at);
    for (const [dr, dc] of DIRS) {
      const r = r0 + dr;
      const c = c0 + dc;
      if (!this.inBounds(r, c)) continue;
      const victim = this.get(r, c);
      if (!isPiece(victim) || sideOf(victim) === moverSide) continue;
      if (this.isSurrounded(r, c, victim, moverSide)) {
        captured.push({ i: this.idx(r, c), value: victim });
        this.grid[this.idx(r, c)] = EMPTY;
        if (victim === KING) this.kingPos = -1;
      }
    }
    return captured;
  }

  /** A square counts as a captor of `victim` when hostile, shielded by castle/edge. */
  captorAt(r, c, victim) {
    if (!this.inBounds(r, c)) return this.variant.edgeShield;
    const v = this.get(r, c);
    if (isPiece(v)) return sideOf(v) !== sideOf(victim);
    if (this.isCastle(r, c) && this.castleShieldFor(victim)) return true;
    return false;
  }

  castleShieldFor(victim) {
    const shield = this.variant.castleShield;
    if (shield === 'none') return false;
    if (shield === 'both') return true;
    return shield === sideOf(victim);
  }

  isSurrounded(r, c, victim, moverSide) {
    if (victim === KING && this.variant.kingSafeOnEdge && this.isOnEdge(r, c)) return false;
    const needed = victim === KING ? this.kingCaptureNeed(r, c) : 2;
    const hostile = DIRS.map(([dr, dc]) => this.captorAt(r + dr, c + dc, victim));
    if (needed >= 4) return hostile.every(Boolean);
    if (needed === 3) return hostile.filter(Boolean).length >= 3;
    return DIR_PAIRS.some(([[ar, ac], [br, bc]]) =>
      this.captorAt(r + ar, c + ac, victim) && this.captorAt(r + br, c + bc, victim));
  }

  kingCaptureNeed(r, c) {
    const kc = this.variant.kingCapture;
    if (this.isCastle(r, c)) return kc.onCastle;
    for (const [dr, dc] of DIRS) {
      if (this.inBounds(r + dr, c + dc) && this.isCastle(r + dr, c + dc)) return kc.besideCastle;
    }
    return kc.elsewhere;
  }

  /**
   * Siege rule (fetlar): the attackers win when the king and every defender are
   * sealed inside a region that contains no escape square and is walled off by
   * attackers, the board edge or empty castle squares.
   */
  kingSideSealedIn() {
    if (!this.kingAlive()) return false;
    const region = new Set([this.kingPos]);
    const queue = [this.kingPos];
    let defendersInRegion = 1;
    while (queue.length > 0) {
      const i = queue.shift();
      for (const [dr, dc] of DIRS) {
        const nr = this.rowOf(i) + dr;
        const nc = this.colOf(i) + dc;
        if (!this.inBounds(nr, nc)) continue;
        const j = this.idx(nr, nc);
        if (region.has(j)) continue;
        const v = this.grid[j];
        if (v === EMPTY) {
          if (this.isEscapeSquare(nr, nc)) return false;
          region.add(j);
          queue.push(j);
        } else if (sideOf(v) === SIDE_DEFENDER) {
          region.add(j);
          defendersInRegion += 1;
          queue.push(j);
        }
      }
    }
    if (defendersInRegion !== this.countOf(SIDE_DEFENDER)) return false;
    for (const i of region) {
      const r = this.rowOf(i);
      const c = this.colOf(i);
      for (const [dr, dc] of DIRS) {
        const nr = r + dr;
        const nc = c + dc;
        if (!this.inBounds(nr, nc)) continue;
        const j = this.idx(nr, nc);
        if (region.has(j)) continue;
        // Only attackers (and empty castle squares) may border the host.
        const v = this.grid[j];
        const sealedByWall = v === EMPTY && this.isCastle(nr, nc);
        if (!sealedByWall && sideOf(v) !== SIDE_ATTACKER) return false;
      }
    }
    return true;
  }

  serialize() {
    const rows = [];
    for (let r = 0; r < this.size; r += 1) {
      let row = '';
      for (let c = 0; c < this.size; c += 1) row += CODES[this.get(r, c)];
      rows.push(row);
    }
    return { size: this.size, rows, kingHasEscaped: this.kingHasEscaped };
  }

  static deserialize(variant, data) {
    if (!data || !Array.isArray(data.rows) || data.rows.length !== variant.size) {
      throw new Error('Save file board size does not match the variant');
    }
    const board = new Board(variant);
    data.rows.forEach((row, r) => {
      if (row.length !== variant.size) throw new Error(`Bad row length at ${r}`);
      for (let c = 0; c < row.length; c += 1) {
        const code = FROM_CODE[row[c]];
        if (code === undefined) throw new Error(`Unknown piece '${row[c]}' at ${r},${c}`);
        board.set(r, c, code);
      }
    });
    board.kingHasEscaped = Boolean(data.kingHasEscaped);
    board.kingPos = board.indexOf(KING);
    return board;
  }
}

module.exports = { Board, DIRS, DIR_PAIRS, SIDE_DEFENDER, SIDE_ATTACKER };
