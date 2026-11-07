'use strict';

const { Ansi, sleep } = require('./ansi');
const { Board } = require('../rules/board');
const {
  EMPTY, KING, DEFENDER, ATTACKER, SIDE_DEFENDER, SIDE_ATTACKER, isPiece,
} = require('../rules/pieces');
const { formatSquare, formatMove, LETTERS } = require('../rules/notation');
const V = require('../rules/variants');

const UNICODE_GLYPHS = {
  [KING]: '★',
  [DEFENDER]: '●',
  [ATTACKER]: '○',
  castle: '✦',
  empty: '·',
};
const ASCII_GLYPHS = {
  [KING]: 'K',
  [DEFENDER]: 'D',
  [ATTACKER]: 'A',
  castle: '*',
  empty: '.',
};

const COLORS = {
  [KING]: ['yellow', 'bold'],
  [DEFENDER]: ['brightBlue'],
  [ATTACKER]: ['brightRed'],
  castle: ['magenta'],
  empty: ['gray'],
};

/** Terminal renderer. It only reads the game: rendering never mutates state. */
class Display {
  constructor(options = {}) {
    this.ansi = options.ansi || new Ansi({ color: options.color });
    this.ascii = Boolean(options.ascii);
    this.animate = options.animate !== false;
    this.frameMs = options.frameMs ?? 140;
    this.glyphs = this.ascii ? ASCII_GLYPHS : UNICODE_GLYPHS;
  }

  glyphFor(board, r, c) {
    const value = board.get(r, c);
    if (isPiece(value)) return this.glyphs[value];
    if (board.isCastle(r, c)) return this.glyphs.castle;
    return this.glyphs.empty;
  }

  colorFor(board, r, c) {
    const value = board.get(r, c);
    if (isPiece(value)) return COLORS[value];
    if (board.isCastle(r, c)) return COLORS.castle;
    return COLORS.empty;
  }

  boardLines(board, opts = {}) {
    const { ansi } = this;
    const size = board.size;
    const highlight = opts.lastMove || null;
    // One gutter for both frames: the rank label is padded to it, the header pads
    // with the same number of spaces, so every file letter sits on its column.
    const gutter = String(size).length + 1;
    const letters = Array.from({ length: size }, (_, c) => LETTERS[c]);
    const frame = ansi.style([' '.repeat(gutter), ...letters].join(' '), 'gray');
    const lines = [frame];
    for (let r = 0; r < size; r += 1) {
      const cells = [ansi.style(String(r + 1).padStart(gutter), 'gray')];
      for (let c = 0; c < size; c += 1) {
        const glyph = this.glyphFor(board, r, c);
        const index = board.idx(r, c);
        const isPath = highlight && (highlight.from === index || highlight.to === index);
        const text = ansi.style(glyph, ...this.colorFor(board, r, c));
        cells.push(isPath ? ansi.style(glyph, 'bold', 'inverse') : text);
      }
      lines.push(cells.join(' '));
    }
    lines.push(frame);
    return lines;
  }

  boardString(board, opts = {}) {
    return this.boardLines(board, opts).join('\n');
  }

  legend(game) {
    const { ansi } = this;
    const g = this.glyphs;
    const board = game.board;
    const soldiers = board.countOf(SIDE_DEFENDER) - (board.kingAlive() ? 1 : 0);
    return [
      `${ansi.style(g[KING], ...COLORS[KING])} ${ansi.style('king', 'yellow')}`,
      `${ansi.style(g[DEFENDER], ...COLORS[DEFENDER])} ${ansi.style(`defenders ${soldiers}`, 'brightBlue')}`,
      `${ansi.style(g[ATTACKER], ...COLORS[ATTACKER])} ${ansi.style(`attackers ${board.countOf(SIDE_ATTACKER)}`, 'brightRed')}`,
      `${ansi.style(g.castle, ...COLORS.castle)} castle`,
    ].join('   ');
  }

  statusLines(game) {
    const { ansi } = this;
    const v = game.variant;
    const turn = game.turn === SIDE_DEFENDER
      ? ansi.style("defenders", 'brightBlue')
      : ansi.style("attackers", 'brightRed');
    const escape = v.escape === 'corner'
      ? 'a corner'
      : v.escape === 'cornerblock'
        ? 'the 16 marked squares'
        : 'the edge';
    return [
      ansi.style(`${v.name}`, 'bold')
        + ansi.style(`  ${v.size}x${v.size}  king escapes to ${escape}`, 'gray'),
      ansi.style('turn ', 'gray') + turn
        + ansi.style(`   ply ${game.ply}`, 'gray')
        + ansi.style(`   no-move rule: ${v.noMove}`, 'gray'),
    ];
  }

  render(game, opts = {}) {
    const board = opts.board || game.board;
    const lines = [];
    lines.push(...this.statusLines(game));
    lines.push('');
    lines.push(...this.boardLines(board, opts));
    lines.push('');
    lines.push(this.legend(game));
    if (game.lastMove) {
      lines.push('');
      lines.push(`last move: ${formatMove(game.board.size, game.lastMove)}`);
    }
    if (game.isGameOver()) {
      lines.push('');
      lines.push(this.outcomeLine(game));
    }
    return lines.join('\n');
  }

  outcomeLine(game) {
    const { ansi } = this;
    if (game.status === 'defenders-win') return ansi.style(`DEFENDERS WIN - ${game.reason}`, 'brightBlue', 'bold');
    if (game.status === 'attackers-win') return ansi.style(`ATTACKERS WIN - ${game.reason}`, 'brightRed', 'bold');
    if (game.status === 'draw') return ansi.style(`DRAW - ${game.reason}`, 'yellow', 'bold');
    return '';
  }

  paint(game, opts = {}) {
    this.ansi.clearScreen();
    this.ansi.moveTo(1, 1);
    this.ansi.write(`${this.render(game, opts)}\n`);
  }

  /** Step the piece across the board on a throw-away copy, then redraw the real game. */
  async animateMove(game, move) {
    if (!this.animate || this.ascii) return;
    const board = new Board(game.variant, Array.from(game.board.grid));
    const piece = board.grid[move.from];
    const r0 = board.rowOf(move.from);
    const c0 = board.colOf(move.from);
    const r1 = board.rowOf(move.to);
    const c1 = board.colOf(move.to);
    const dr = Math.sign(r1 - r0);
    const dc = Math.sign(c1 - c0);
    const steps = Math.abs(r1 - r0) + Math.abs(c1 - c0);
    for (let step = 1; step <= steps; step += 1) {
      board.grid[move.from] = EMPTY;
      const r = r0 + dr * step;
      const c = c0 + dc * step;
      board.grid[board.idx(r, c)] = piece;
      if (piece === KING) board.kingPos = board.idx(r, c);
      this.ansi.clearScreen();
      this.ansi.moveTo(1, 1);
      this.ansi.write(`${this.render(game, { board, lastMove: move })}\n`);
      await sleep(Math.max(24, this.frameMs / 2));
    }
    await sleep(Math.max(24, this.frameMs / 2));
  }

  movesList(moves, size) {
    if (moves.length === 0) return 'no legal move';
    const byPiece = new Map();
    for (const m of moves) {
      const from = formatSquare(size, m.from);
      if (!byPiece.has(from)) byPiece.set(from, []);
      byPiece.get(from).push(formatSquare(size, m.to));
    }
    return [...byPiece.entries()]
      .map(([from, tos]) => `${from}->${tos.join(', ')}`)
      .join('   ');
  }

  banner(variant) {
    const { ansi } = this;
    const title = 'CLITAFL';
    const art = [
      '   ★  ╔═══╗  ○',
      '  ●●● ║ ✦ ║ ○○○',
      '   ★  ╚═══╝  ○',
    ];
    return [
      ansi.style(title, 'brightCyan', 'bold'),
      ansi.style(art.join('\n'), 'cyan'),
      ansi.style(variant.name, 'bold') + ansi.style(`  ·  ${variant.subtitle}`, 'gray'),
      ansi.style(variant.blurb, 'gray'),
    ].join('\n');
  }

  rulesText(variant) {
    const army = V.armyOf(variant, variant.size);
    const kc = variant.kingCapture;
    return [
      `${variant.name} (${variant.size}x${variant.size}) - ${variant.subtitle}`,
      `Source: ${variant.source}`,
      '',
      `Army: king + ${army.defenders} defenders vs ${army.attackers} attackers.`,
      `${variant.first === SIDE_ATTACKER ? 'Attackers' : 'Defenders'} move first.`,
      'Pieces move any distance orthogonally, never jumping over a piece.',
      variant.escape === 'corner'
        ? 'The king wins by reaching a corner square.'
        : variant.escape === 'cornerblock'
          ? 'The king wins by reaching one of the 16 marked squares in the corners; the plain board edge is not an exit.'
          : 'The king wins by reaching any edge square.',
      'The attackers win by capturing the king.',
      variant.castles === 'none'
        ? 'No special squares.'
        : variant.castles === 'throne-cornerblocks'
          ? 'Castle squares: the central citadel and the 16 marked corner squares. Nobody may land on the citadel, only the king may enter the marked squares, and an empty castle captures.'
          : `Castle squares (${variant.castles}) block movement and act as a captor when empty; only the king may step onto a castle that is one of his escape squares.`,
      variant.edgeShield
        ? 'The board edge acts as a captor.'
        : 'The board edge does not capture: a piece needs enemies on both sides.',
      variant.castles === 'none'
        ? `The king needs ${kc.elsewhere} attackers to be captured.`
        : `The king needs ${kc.elsewhere} attackers to be captured (${kc.besideCastle} beside a castle, ${kc.onCastle} on a castle).`,
      variant.kingSafeOnEdge ? 'The king cannot be captured on the edge.' : '',
      variant.winBySiege ? 'Attackers also win by sealing the king and all defenders in.' : '',
      `A player with no legal move: ${variant.noMove}.`,
      `Repetition: ${variant.repetition}. Move limit: ${variant.maxPlies} plies.`,
    ].filter(Boolean).join('\n');
  }

  helpText() {
    const { ansi } = this;
    return [
      ansi.style('Commands', 'bold'),
      '  d5-d6        move a piece (file letter + rank number, from-to)',
      '  help         this help',
      '  board        redraw the board',
      '  moves        list the squares that can move',
      '  history      the moves played so far',
      '  hint         ask the AI for a suggestion',
      '  undo [n]     take back n moves',
      '  rules        the rules of this variant',
      '  save <file>  write the position to a file',
      '  resign       give up the game',
      '  quit         leave the game',
    ].join('\n');
  }
}

module.exports = { Display, UNICODE_GLYPHS, ASCII_GLYPHS };
