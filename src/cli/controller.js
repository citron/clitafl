'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline/promises');

const { Game } = require('../rules/game');
const { AIPlayer, LEVEL_IDS } = require('../ai/player');
const { Display } = require('../ui/display');
const { Ansi, sleep } = require('../ui/ansi');
const { formatMove, formatCaptures, formatSquare } = require('../rules/notation');
const { SIDE_DEFENDER, SIDE_ATTACKER } = require('../rules/pieces');

/**
 * Runs one session: game + seats + turn loop, and always restores the terminal.
 *
 * In a terminal the session is one window, like a game screen: the frame is
 * built to the size of the window (`Display.fit`), the board is always whole,
 * and everything the program tells the player goes into the journal of that
 * frame, which the window cuts to the rows it has. Nothing is printed above the
 * board, so nothing scrolls the board away, and a resized terminal is a resized
 * game. Anywhere else — a pipe, a script, `--moves`, the tests — the session
 * prints the plain report it has always printed, byte for byte.
 */
/**
 * The footer of a page: which page, and the keys that turn it. A wide window
 * is told every key; a narrow one is told the keys it can reach, because a
 * hint that ends in an ellipsis is no hint at all.
 */
function pageFooter(page, count, columns) {
  const counter = `page ${page}/${count}`;
  const hints = [
    `${counter}   space, n, → next   b, ← back   g first, G last   q board`,
    `${counter}   space, → next   b, ← back   q board`,
    `${counter}   → next   ← back   q board`,
    `${counter}   → next   q board`,
    counter,
  ];
  return hints.find((line) => Ansi.width(line) <= columns) || counter;
}

class GameController {
  constructor(options = {}) {
    this.options = options;
    this.game = options.game || Game.create(options.variant || 'tablut', options.size ?? null);
    this.display = options.display || new Display({
      color: options.color,
      ascii: options.ascii,
      animate: options.animate,
      frameMs: options.frameMs,
    });
    this.ansi = this.display.ansi;
    this.seats = options.seats || { [SIDE_ATTACKER]: 'ai', [SIDE_DEFENDER]: 'human' };
    this.levels = options.levels || { [SIDE_ATTACKER]: 'medium', [SIDE_DEFENDER]: 'medium' };
    this.timeMs = options.timeMs ?? null;
    this.maxNodes = options.maxNodes ?? null;
    this.maxDepth = options.maxDepth ?? null;
    this.recordPath = options.record || null;
    this.script = null;
    this.scriptIndex = 0;
    this.input = null;
    this.exitRequested = false;
    this.cleanupHandlers = [];
    this.tty = false;
    /* The journal of the frame: what the program tells the player, newest row
     * last, kept to the last 500 lines. Only a terminal reads it; a pipe gets
     * the text as it comes. */
    this.log = [];
    this.finalNotes = [];
    this.readKey = options.readKey || null;
    /* Prompts waiting for a line, woken when the session is leaving. */
    this.exitWaiters = [];
  }

  sideLabel(side) { return side === SIDE_DEFENDER ? 'defenders' : 'attackers'; }

  seatOf(side) { return this.seats[side]; }

  describeSeat(side) {
    return this.seatOf(side) === 'ai' ? `AI (${this.levels[side]})` : 'human';
  }

  /**
   * One line for the player. In a terminal it goes into the journal of the
   * frame, which the window cuts to the rows it has: nothing a player is told
   * can push the board off the screen. Anywhere else — a pipe, a script, the
   * tests — it is written out as it always was.
   */
  say(text) {
    if (!this.tty) {
      this.ansi.write(text);
      return;
    }
    for (const line of String(text).split('\n')) {
      const trimmed = line.trim();
      if (trimmed) this.log.push(trimmed);
    }
    if (this.log.length > 500) this.log.splice(0, this.log.length - 500);
  }

  /**
   * A line that is meant to be read once the screen is handed back — the
   * result of the game, the record, the parting words. In a terminal it cannot
   * go in the frame: the frame goes away with the alt screen. Anywhere else it
   * is written out where it always was.
   */
  note(text) {
    if (!this.tty) {
      this.ansi.write(text);
      return;
    }
    this.finalNotes.push(text);
  }

  async start() {
    if (this.options.moves) {
      this.script = fs.readFileSync(path.resolve(process.cwd(), this.options.moves), 'utf8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'));
    }
    this.installSignalHandlers();
    const interactive = Boolean(process.stdin.isTTY && !this.script);
    this.interactive = interactive;
    this.tty = interactive;
    if (interactive) {
      this.ansi.altScreenOn();
      this.ansi.hideCursor();
      /* The animation paints a board of its own, at the width the window was
       * not asked for: on a fitted screen that is a board that scrolls. The
       * frame marks the last move instead, and the piece arrives in one paint. */
      this.display.animate = false;
      this.cleanupHandlers.push(() => {
        this.ansi.showCursor();
        this.ansi.altScreenOff();
      });
      /* A terminal is one window: the first frame is the whole screen, so the
       * banner and the rules do not run 23 rows of text above it. They are
       * one command away — `rules`, `help` — and they fill a page. */
      const v = this.game.variant;
      this.say(`clitafl - ${v.name} ${v.size}x${v.size}`);
      this.say(`Seats: ${this.sideLabel(SIDE_ATTACKER)} = ${this.describeSeat(SIDE_ATTACKER)}, `
        + `${this.sideLabel(SIDE_DEFENDER)} = ${this.describeSeat(SIDE_DEFENDER)}`);
      this.say("Type 'help' for commands, 'moves' for the squares that can move, 'rules' for the rules.");
      /* The window is the screen: resizing it repaints the board at the new
       * size, so a terminal dragged wider widens the game. */
      this.cleanupHandlers.push(Ansi.onResize(() => {
        try { this.render(); } catch { /* the terminal is going away */ }
      }));
      await sleep(120);
      this.render();
      await sleep(380);
      await this.turnLoop(interactive);
      return;
    }
    this.ansi.write(`${this.display.banner(this.game.variant)}\n\n`);
    this.ansi.write(`${this.display.rulesText(this.game.variant)}\n\n`);
    this.ansi.write(`Seats: ${this.sideLabel(SIDE_ATTACKER)} = ${this.describeSeat(SIDE_ATTACKER)}, `
      + `${this.sideLabel(SIDE_DEFENDER)} = ${this.describeSeat(SIDE_DEFENDER)}\n`);
    this.ansi.write(`Type 'help' for commands.\n${'-'.repeat(52)}\n`);
    await this.turnLoop(interactive);
  }

  installSignalHandlers() {
    for (const signal of ['SIGINT', 'SIGTERM']) {
      const handler = () => this.leave(signal);
      process.on(signal, handler);
      this.cleanupHandlers.push(() => process.off(signal, handler));
    }
  }

  /**
   * The player is leaving: the words go in the journal of the frame, and the
   * prompts are woken, because a player who pressed ctrl-c is not going to
   * type and `readline/promises` leaves a question waiting when the input
   * closes under it.
   */
  leave(signal) {
    this.note(`\n${signal} received, leaving the board.\n`);
    this.exitRequested = true;
    this.releasePrompts();
  }

  closeReadline() {
    if (this.input) {
      const input = this.input;
      this.input = null;
      try { input.close(); } catch { /* already closed */ }
    }
  }

  /** The input line, made when it is first needed and made again if a pager closed it. */
  ensureInput() {
    if (this.input) return;
    this.input = readline.createInterface({ input: process.stdin, output: process.stdout });
    /* The promises interface handles a ctrl-c by closing itself and leaving
     * the question waiting, and does not tell the process: the listener takes
     * it over, so the session ends the way a session should - the frame goes
     * away, the parting words are left on the screen. */
    this.input.on('SIGINT', () => this.leave('SIGINT'));
    this.input.on('close', () => this.releasePrompts());
    this.cleanupHandlers.push(() => this.closeReadline());
  }

  async turnLoop(interactive) {
    if (interactive && !this.script) this.ensureInput();
    while (!this.game.isGameOver() && !this.exitRequested) {
      const side = this.game.turn;
      if (this.seatOf(side) === 'ai') {
        await this.playAiMove(side);
      } else {
        const stop = await this.playHumanMove(side, interactive);
        if (stop) break;
      }
    }
    this.finish();
  }

  /**
   * The screen as it stands. A terminal gets the frame built to its window,
   * painted from the top row and cleared to the bottom, so the board, its
   * state, the legend and the journal are all that is on the screen and the
   * prompt is the one row under them. A script gets the plain render, which
   * the tests read line by line.
   */
  render() {
    if (this.script || !this.tty) {
      this.ansi.write(`${this.display.render(this.game, { lastMove: this.game.lastMove })}\n`);
      return;
    }
    const geo = Ansi.geometry();
    const frame = this.display.fit(this.game, {
      rows: geo.rows,
      columns: geo.columns,
      log: this.log,
      // Two rows under the frame: the blank that separates it from the prompt,
      // and the prompt itself, which is the one row that may scroll.
      reserve: 2,
      lastMove: this.game.lastMove,
    });
    this.frame = frame;
    this.ansi.clearScreen();
    this.ansi.moveTo(1, 1);
    this.ansi.write(`${frame.lines.join('\n')}\n`);
    /* The window has grown since the last paint: what is left below the frame
     * is the text of the last, taller frame. */
    this.ansi.clearToEnd();
  }

  makeAi(side) {
    return new AIPlayer(this.levels[side], {
      timeMs: this.timeMs ?? undefined,
      maxNodes: this.maxNodes ?? 0,
      maxDepth: this.maxDepth ?? undefined,
      label: `${this.sideLabel(side)} AI`,
    });
  }

  /** What one AI move is allowed to spend, in the words of the thinking line. */
  budgetNote() {
    const parts = [];
    if (this.timeMs) parts.push(`${this.timeMs} ms`);
    if (this.maxNodes) parts.push(`${this.maxNodes} nodes`);
    if (this.maxDepth) parts.push(`depth ${this.maxDepth}`);
    return parts.length ? ` (budget ${parts.join(', ')})` : '';
  }

  async playAiMove(side) {
    const ai = this.makeAi(side);
    this.say(`\n${this.sideLabel(side)} AI (${this.levels[side]}) is thinking...${this.budgetNote()}\n`);
    if (this.tty) this.render();
    const started = Date.now();
    const { move, info } = ai.chooseMove(this.game, side);
    if (!move) {
      this.declareNoMove(side);
      this.render();
      return;
    }
    const result = this.game.play(move);
    if (this.display.animate && this.game.lastMove) {
      await this.display.animateMove(this.game, this.game.lastMove);
    }
    this.render();
    const took = ((Date.now() - started) / 1000).toFixed(1);
    const captured = formatCaptures(this.game.board.size, result.captured);
    this.say(`\n${this.sideLabel(side)}: ${result.notation}`
      + (captured ? `  takes ${captured}` : '')
      + `   [depth ${info.depth}, ${info.nodes} nodes, ${took}s]\n`);
  }

  async playHumanMove(side, interactive) {
    this.render();
    for (;;) {
      if (this.exitRequested) return true;
      if (this.tty) this.ansi.showCursor();
      const line = await this.readLine(`${this.sideLabel(side)} > `);
      if (this.tty) this.ansi.hideCursor();
      if (line === null) return true;
      const answer = line.trim();
      if (answer === '') continue;
      const handled = await this.handleCommand(answer, side);
      /* Every command repaints: what it said went into the journal of the
       * frame, and a page has just given the screen back. */
      if (this.tty) this.render();
      if (handled === 'quit') return true;
      if (handled === 'move') return false;
    }
  }

  async readLine(prompt) {
    if (this.script) {
      if (this.scriptIndex >= this.script.length) return null;
      const line = this.script[this.scriptIndex];
      this.scriptIndex += 1;
      this.ansi.write(`${prompt}${line}\n`);
      return line;
    }
    if (!this.input) this.ensureInput();
    /* The question, and a wake-up for the case where the session is leaving:
     * `readline/promises` leaves a question that is closed mid-flight waiting
     * forever, and a session that is on its way out should not hang on a
     * player who is no longer typing. */
    const question = this.input.question(prompt);
    const woken = new Promise((resolve) => this.exitWaiters.push(() => resolve(null)));
    return Promise.race([question, woken]);
  }

  /** Wakes every prompt that is waiting for a line, with no line. */
  releasePrompts() {
    for (const wake of this.exitWaiters.splice(0)) wake();
  }
  declareNoMove(side) {
    this.game.declareNoMove(side);
  }

  /**
   * A text the player asked for that is longer than the window — the rules,
   * the commands, the list of squares that can move, the history — is read on
   * its own page: the board is the one screen that never scrolls, so a long
   * text is turned rather than run off the top of the terminal. `space`, `n`
   * and `→` turn the page, `b` and `←` turn it back, `g` and `G` go to the
   * first and the last page, `q`, Esc, End and ctrl-c give the board back.
   *
   * `content` is the text, or `{ plain, pages }` when the terminal wants it in
   * lines the pipe does not get. A pipe, a script, a test: the text whole.
   */
  async showPage(content, title) {
    const plain = typeof content === 'string' ? content : content.plain;
    if (!this.tty) {
      this.ansi.write(`\n${plain}\n`);
      return;
    }
    /* The page owns the keyboard. A page is read one key at a time, raw, and
     * a raw read hands the terminal's buffered keys to the page - so the
     * input line is put away for the duration and made again after: a key
     * pressed to turn a page must not also be appended to the command the
     * player is about to type, which would turn `rules` into `rulesq`. */
    this.closeReadline();
    await this.pagedPages(content, title);
  }

  async pagedPages(content, title) {
    const pages = typeof content === 'string' ? content.split('\n') : content.pages;
        /* The row the page begins at. A window resized mid-rule repaginates, and
     * the same part of the text is kept: the player does not lose their place. */
    let top = 0;
    for (;;) {
      /* Read the window again on every page: a terminal resized mid-rule
       * repaginates the rules. */
      const geo = Ansi.geometry();
      const columns = Math.max(12, geo.columns);
      const rows = Math.max(4, geo.rows);
      const per = Math.max(1, rows - 2);
      const wrapped = [];
      for (const line of pages) wrapped.push(...Ansi.wrap(line, columns));
      const count = Math.max(1, Math.ceil(wrapped.length / per));
      const page = Math.min(count, Math.floor(top / per) + 1);
      top = (page - 1) * per;
      const lines = [
        Ansi.fit(this.ansi.style(title, 'bold', 'brightCyan'), columns),
        ...wrapped.slice(top, top + per),
      ];
      while (lines.length < rows - 1) lines.push('');
      lines.push(this.ansi.style(pageFooter(page, count, columns), 'gray'));
      this.ansi.clearScreen();
      this.ansi.moveTo(1, 1);
      this.ansi.write(`${lines.join('\n')}\n`);
      this.ansi.clearToEnd();

      const key = await this.readKeySafe();
      if (key === 'ctrl-c') {
        this.leave('SIGINT');
        return;
      }
      if (key === 'q' || key === 'escape' || key === 'end') return;
      if (key === 'space' || key === 'n' || key === 'right' || key === 'down' || key === 'enter') {
        top = Math.min(top + per, (count - 1) * per);
      } else if (key === 'b' || key === 'left' || key === 'up' || key === 'pageup') {
        top = Math.max(0, top - per);
      } else if (key === 'pagedown') {
        top = Math.min(top + per * (rows - 2), (count - 1) * per);
      } else if (key === 'g' || key === 'home') {
        top = 0;
      } else if (key === 'G') {
        top = (count - 1) * per;
      }
    }
  }

  /**
   * One key press, without the player pressing Enter. The keys are read from
   * the terminal in raw mode and named by `Ansi.keyName`; a terminal that
   * closes under us is an `end`, which gives the board back.
   */
  async readKeySafe() {
    if (this.readKey) return this.readKey();
    const stdin = process.stdin;
    const raw = typeof stdin.setRawMode === 'function';
    return new Promise((resolve) => {
      const done = (key) => {
        stdin.removeListener('data', onData);
        stdin.removeListener('end', onEnd);
        if (raw) stdin.setRawMode(false);
        resolve(key);
      };
      const onData = (chunk) => done(Ansi.keyName(chunk));
      const onEnd = () => done('end');
      /* The listener is in place before raw mode is turned on: leaving raw
       * mode hands back the bytes the terminal was holding, and they are the
       * page's to read, not the input line's to append to a command. */
      stdin.on('data', onData);
      stdin.once('end', onEnd);
      if (raw) stdin.setRawMode(true);
      stdin.resume();
    });
  }

  /** @returns 'move' to continue the game, 'quit' to leave, 'noop' to re-prompt. */
  async handleCommand(answer, side) {
    const [command, ...rest] = answer.split(/\s+/);
    const arg = rest.join(' ');
    const lower = command.toLowerCase();

    if (lower === 'help' || lower === '?') {
      await this.showPage(this.display.helpText(), 'clitafl - the commands');
      return 'noop';
    }
    if (lower === 'rules') {
      await this.showPage(this.display.rulesText(this.game.variant),
        `${this.game.variant.name} - the rules as they are played`);
      return 'noop';
    }
    if (lower === 'moves') {
      const moves = this.game.legalMoves(side);
      const list = this.display.movesList(moves, this.game.board.size);
      const head = `${this.sideLabel(side)} can move from:`;
      /* A 19x19 has a list of squares some 1 600 characters long: on a page,
       * one piece per line, it is read. A pipe gets the one line it always got. */
      await this.showPage({
        plain: `${head} ${list}`,
        pages: list === 'no legal move' ? [`${head} ${list}`] : [head, ...list.split('   ')],
      }, `${this.sideLabel(side)} - where each piece can go`);
      return 'noop';
    }
    if (lower === 'hint') {
      this.say('\nthe AI is looking for a move (0.9 s)\n');
      if (this.tty) this.render();
      const ai = new AIPlayer('hard', { timeMs: 900 });
      const { move, info } = ai.chooseMove(this.game, side);
      if (!move) {
        this.say('\nNo legal move.\n');
        return 'noop';
      }
      this.say(`\nhint: ${formatMove(this.game.board.size, move)}`
        + `  (depth ${info.depth}, score ${info.score})\n`);
      return 'noop';
    }
    if (lower === 'undo') {
      const n = Number.parseInt(arg, 10) || 1;
      const undone = this.game.undo(n);
      this.say(`\ntook back ${undone} plie(s)\n`);
      this.render();
      return 'noop';
    }
    if (lower === 'save') {
      const file = arg || 'clitafl-save.json';
      const target = path.resolve(process.cwd(), file);
      fs.writeFileSync(target, `${JSON.stringify(this.game.serialize(), null, 2)}\n`);
      this.say(`\ngame written to ${file}\n`);
      return 'noop';
    }
    if (lower === 'resign') {
      this.game.resign(side);
      this.render();
      return 'quit';
    }
    if (lower === 'board' || lower === 'b' || lower === 'show') {
      this.render();
      return 'noop';
    }
    if (lower === 'history' || lower === 'hist') {
      const moves = this.game.movesPlayed();
      await this.showPage(moves.length
        ? moves.map((m) => `${String(m.ply).padStart(3)}. ${m.side === SIDE_ATTACKER ? 'A' : 'D'} ${m.notation}`).join('\n')
        : 'no moves played yet', `the game ply by ply - ${moves.length} plies`);
      return 'noop';
    }
    if (lower === 'quit' || lower === 'exit') return 'quit';

    try {
      const result = this.game.play(answer);
      if (this.display.animate && this.game.lastMove) {
        await this.display.animateMove(this.game, this.game.lastMove);
      }
      this.render();
      const captured = formatCaptures(this.game.board.size, result.captured);
      this.say(`\n${this.sideLabel(result.side)}: ${result.notation}`
        + (captured ? `  takes ${captured}` : '') + '\n');
      return 'move';
    } catch (error) {
      this.say(`\n${error.message}  (type 'moves' to see what can move)`);
      return 'noop';
    }
  }

  finish() {
    if (this.game.isGameOver()) {
      this.note(`\n${this.display.outcomeLine(this.game)}\n`);
    }
    const moves = this.game.movesPlayed();
    if (moves.length > 0) {
      const line = moves.map((m) => `${m.side === SIDE_ATTACKER ? 'A' : 'D'} ${m.notation}`).join('  ');
      this.note(`\n${line}\n`);
    }
    if (this.recordPath) this.writeRecord();
    this.closeReadline();
    for (const handler of this.cleanupHandlers.splice(0).reverse()) {
      try { handler(); } catch { /* terminal already gone */ }
    }
    /* The screen is handed back: this is where the end of the game is left for
     * good, under the frame the player was looking at, which is gone with it. */
    for (const text of this.finalNotes.splice(0)) this.ansi.write(text);
  }

  writeRecord() {
    const record = {
      ...this.game.serialize(),
      result: { status: this.game.status, winner: this.game.winner, reason: this.game.reason },
      seats: this.seats,
      levels: this.levels,
    };
    const target = path.resolve(process.cwd(), this.recordPath);
    fs.writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`);
    this.note(`record written to ${this.recordPath}\n`);
  }
}

module.exports = { GameController };
