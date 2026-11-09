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
/**
 * The note of a window too small for the board: the two numbers, and the
 * advice when the window has room for it. The counts are what a player can
 * act on, so they are the tier that is kept to the last: `25 rows needed
 * (this: 12)` becomes `25 → 12 rows` in a window of 12 columns.
 */
function shortNote(want, have, unit, advice, columns) {
  const tiers = [
    `${want} ${unit} needed (this: ${have})${advice ? ` - ${advice}` : ''}`,
    `${want} ${unit} needed (this: ${have}) - enlarge the terminal`,
    `${want} ${unit} needed (this: ${have})`,
    `${want} → ${have} ${unit}`,
  ];
  const fits = tiers.find((text) => Ansi.width(text) <= columns);
  return fits === undefined ? Ansi.fit(tiers[tiers.length - 1], columns) : fits;
}

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
    // A narrow window cannot pay two columns per square: at pitch 1 the board
    // is one character per square, which is what keeps a 19x19 whole in 22
    // columns. The tests of the plain renderer ask for pitch 2, the default.
    const pitch = opts.pitch === 1 ? 1 : 2;
    // One gutter for both frames: the rank label is padded to it, the header pads
    // with the same number of spaces, so every file letter sits on its column.
    const gutter = String(size).length + 1;
    const letters = Array.from({ length: size }, (_, c) => LETTERS[c]);
    const frame = ansi.style([' '.repeat(gutter), ...letters].join(' '), 'gray');
    const lines = [frame];
    for (let r = 0; r < size; r += 1) {
      const label = ansi.style(String(r + 1).padStart(gutter), 'gray');
      const cells = [];
      for (let c = 0; c < size; c += 1) {
        const glyph = this.glyphFor(board, r, c);
        const index = board.idx(r, c);
        const isPath = highlight && (highlight.from === index || highlight.to === index);
        const text = ansi.style(glyph, ...this.colorFor(board, r, c));
        cells.push(isPath ? ansi.style(glyph, 'bold', 'inverse') : text);
      }
      if (pitch === 1) lines.push(`${label} ${cells.join('')}`);
      else lines.push([label, ...cells].join(' '));
    }
    lines.push(frame);
    return lines;
  }

  /**
   * The columns a board of `size` takes at each pitch: the rank gutter, the
   * space after it, and the cells — one column per square at pitch 1, two at
   * pitch 2. This is what decides whether a window can pay for the wide board.
   */
  static boardWidth(size, pitch = 2) {
    const gutter = String(size).length + 1;
    return gutter + 1 + (pitch === 1 ? size : 2 * size - 1);
  }

  /** The rows a whole board of `size` takes, header and footer included. */
  static boardRows(size) {
    return size + 2;
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

  /** One line of state, the only line the board never displaces. */
  statusLine(game, opts = {}) {
    const { ansi } = this;
    const v = game.variant;
    const turn = game.turn === SIDE_DEFENDER
      ? ansi.style('defenders', 'brightBlue')
      : ansi.style('attackers', 'brightRed');
    /* A window too short for the board is the one thing the player has to
     * read, so the note leads the line and the rest of it may be cut. */
    const parts = [];
    if (opts.note) parts.push(ansi.style(opts.note, 'yellow', 'bold'));
    parts.push(
      ansi.style(v.name, 'bold'),
      ansi.style(`${v.size}x${v.size}`, 'gray'),
      game.isGameOver() ? ansi.style(this.outcomeLine(game), 'bold') : ansi.style('turn ', 'gray') + turn,
      ansi.style(`ply ${game.ply}`, 'gray'),
      ansi.style(`${game.legalMoves(game.turn).length} legal moves`, 'gray'),
    );
    return parts.join('   ');
  }

  /**
   * The screen as it fits one window of `rows` x `columns`, for a terminal
   * that is never asked to scroll: the board whole, one status line, the last
   * move, the legend, and as much of the journal as the window leaves room
   * for. What does not fit goes oldest first — the journal, then the legend,
   * then the last move — and a window too short for a whole board says so on
   * the status line instead of cutting the board.
   *
   * `log` is the journal as lines of text, oldest first: each is wrapped to
   * the window and the newest rows are kept. `reserve` is what the caller
   * draws under the frame, which is the prompt of the input line: one row.
   *
   * Three windows, three frames. One with room for the board, its state line
   * and the prompt (`need` rows) gets a frame of exactly the window: no
   * scroll, no jump, no row of the last frame left behind. One with room for
   * the board alone (`minRows`) gets the board and the state line, and
   * nothing else. One shorter than the board whole gets the board whole and a
   * state line that says what the terminal is short of: the board is never
   * cut, and the prompt is the one row that scrolls.
   */
  fit(game, opts = {}) {
    const rows = Math.max(4, opts.rows || 24);
    const columns = Math.max(12, opts.columns || 80);
    const reserve = opts.reserve === undefined ? 1 : Math.max(0, opts.reserve);
    const board = opts.board || game.board;
    const size = board.size;
    const pitch = Display.boardWidth(size) <= columns ? 2 : 1;
    const drawn = this.boardLines(board, { pitch, lastMove: opts.lastMove || game.lastMove });
    const boardCols = Display.boardWidth(size, pitch);
    const need = 1 + drawn.length + 1 + reserve;
    const shortRows = rows < need;
    // One column per square is as narrow as the board is ever drawn: below
    // that a rank cannot be shown, and the window is told so.
    const shortCols = boardCols > columns;

    const lines = [Ansi.fit(this.statusLine(game, {}), columns)];
    /* The blank between the state and the board is a luxury: a window that is
     * no wider than the board and its state keeps the board and the note. */
    const budget = rows - reserve;
    if (!shortRows && budget >= 1 + drawn.length + 2) lines.push('');
    lines.push(...drawn.map((line) => Ansi.fit(line, columns)));
    let noteRows = 0;
    if (shortRows || shortCols) {
      /* The top rows of a window that is too short scroll away, so the note
       * that counts what is missing is written last, where a scrolling window
       * leaves it. A narrow window cuts the tail of a line, so each count
       * leads its own row - a window short and narrow says both - and the
       * advice goes before the numbers do: a cut number is no use to anyone. */
      const advice = `a ${size}x${size} board whole, its state and the prompt. Enlarge the terminal, or play a smaller board`;
      if (shortRows) {
        lines.push(this.ansi.style(shortNote(need, rows, 'rows', advice, columns), 'yellow', 'bold'));
        noteRows += 1;
      }
      if (shortCols) {
        const colsAdvice = shortRows ? '' : advice;
        lines.push(this.ansi.style(shortNote(boardCols, columns, 'columns', colsAdvice, columns), 'yellow', 'bold'));
        noteRows += 1;
      }
    }

    let journalRows = 0;
    let dropped = 0;
    if (!shortRows && budget - lines.length >= 1) {
      /* What the window leaves, in the order it is given up: the last move,
       * then the legend. The journal takes what is left, newest rows first. */
      const pieces = [];
      if (game.isGameOver()) pieces.push(this.outcomeLine(game));
      else if (game.lastMove) pieces.push(`last move: ${formatMove(board.size, game.lastMove)}`);
      pieces.push(this.legend(game));
      for (const piece of pieces) {
        if (rows - reserve - lines.length < 1) break;
        lines.push(Ansi.fit(piece, columns));
      }

      const journal = [];
      for (const entry of opts.log || []) journal.push(...Ansi.wrap(entry, columns));
      const room = Math.max(0, rows - reserve - lines.length);
      journalRows = Math.min(journal.length, room);
      dropped = journal.length - journalRows;
      lines.push(...journal.slice(journal.length - journalRows));
    }

    const used = lines.length;
    /* A window that fits the board is filled to the last row, so the prompt
     * never moves and no row of the last frame survives. A window that is too
     * short is not padded: the board is shown whole, the note counts what is
     * missing, and the prompt is the one row that scrolls. */
    if (!shortRows) {
      while (lines.length < Math.max(0, rows - reserve)) lines.push('');
    }
    return {
      lines,
      rows,
      columns,
      reserve,
      pitch,
      need,
      minRows: 1 + drawn.length,
      boardRows: drawn.length,
      boardCols,
      journalRows,
      dropped,
      noteRows,
      padded: lines.length - used,
      shortRows,
      shortCols,
    };
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
        : [
          variant.castles === 'throne-cornerblocks'
            ? 'Castle squares: the central citadel and the 16 marked squares of the corners'
            : `Castle squares: ${variant.castles === 'throne' ? 'the throne' : 'the throne and the four corners'}`,
          variant.escape === 'corner' || variant.escape === 'cornerblock'
            ? 'the ones the king escapes to are his alone, nobody else may land on any of them'
            : 'nobody may land on them',
          'an empty castle captures for both sides',
          variant.kingBackOnThrone ? 'the king may go back onto his throne' : '',
        ].filter(Boolean).join('; ') + '.',
      variant.edgeShield
        ? 'The board edge acts as a captor.'
        : 'The board edge does not capture: a piece needs enemies on both sides.',
      variant.shieldWall
        ? 'Shield wall: a line of two or more enemy men along the edge, walled in at one end, is taken when the mover brackets the other end and presses every man from the inside.'
        : '',
      variant.castles === 'none'
        ? `The king needs ${kc.elsewhere} attackers to be captured.`
        : `The king needs ${kc.elsewhere} attackers to be captured (${kc.besideCastle} next to the throne, ${kc.onCastle} on the throne).`,
      variant.kingSafeOnEdge ? 'The king cannot be captured on the edge.' : '',
      variant.winBySiege ? 'Attackers also win by sealing the king and all defenders in.' : '',
      `A player with no legal move: ${variant.noMove}.`,
      `Repetition: ${variant.repetition}. Move limit: ${Math.ceil(variant.maxPlies / 2)} moves (${variant.maxPlies} plies)${variant.overrun === 'attackers-win' ? ', then the attackers win.' : ', then a draw.'}`,
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
