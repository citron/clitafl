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

/** Runs one session: game + seats + turn loop, and always restores the terminal. */
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
    this.recordPath = options.record || null;
    this.script = null;
    this.scriptIndex = 0;
    this.input = null;
    this.exitRequested = false;
    this.cleanupHandlers = [];
  }

  sideLabel(side) { return side === SIDE_DEFENDER ? 'defenders' : 'attackers'; }

  seatOf(side) { return this.seats[side]; }

  describeSeat(side) {
    return this.seatOf(side) === 'ai' ? `AI (${this.levels[side]})` : 'human';
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
    if (interactive) {
      this.ansi.altScreenOn();
      this.ansi.hideCursor();
      this.cleanupHandlers.push(() => {
        this.ansi.showCursor();
        this.ansi.altScreenOff();
      });
    }
    this.ansi.write(`${this.display.banner(this.game.variant)}\n\n`);
    this.ansi.write(`${this.display.rulesText(this.game.variant)}\n\n`);
    this.ansi.write(`Seats: ${this.sideLabel(SIDE_ATTACKER)} = ${this.describeSeat(SIDE_ATTACKER)}, `
      + `${this.sideLabel(SIDE_DEFENDER)} = ${this.describeSeat(SIDE_DEFENDER)}\n`);
    this.ansi.write(`Type 'help' for commands.\n${'-'.repeat(52)}\n`);
    if (interactive) await sleep(500);
    await this.turnLoop(interactive);
  }

  installSignalHandlers() {
    for (const signal of ['SIGINT', 'SIGTERM']) {
      const handler = () => {
        this.ansi.write(`\n${signal} received, leaving the board.\n`);
        this.exitRequested = true;
        this.closeReadline();
      };
      process.on(signal, handler);
      this.cleanupHandlers.push(() => process.off(signal, handler));
    }
  }

  closeReadline() {
    if (this.input) {
      try { this.input.close(); } catch { /* already closed */ }
    }
  }

  async turnLoop(interactive) {
    if (interactive && !this.input) {
      this.input = readline.createInterface({ input: process.stdin, output: process.stdout });
      this.cleanupHandlers.push(() => this.input.close());
    }
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

  render() {
    if (this.script) {
      this.ansi.write(`${this.display.render(this.game, { lastMove: this.game.lastMove })}\n`);
      return;
    }
    this.ansi.clearScreen();
    this.ansi.moveTo(1, 1);
    this.ansi.write(`${this.display.render(this.game, { lastMove: this.game.lastMove })}\n`);
  }

  makeAi(side) {
    return new AIPlayer(this.levels[side], {
      timeMs: this.timeMs ?? undefined,
      label: `${this.sideLabel(side)} AI`,
    });
  }

  async playAiMove(side) {
    const ai = this.makeAi(side);
    this.ansi.write(`\n${this.sideLabel(side)} AI (${this.levels[side]}) is thinking...\n`);
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
    this.ansi.write(`\n${this.sideLabel(side)}: ${result.notation}`
      + (captured ? `  takes ${captured}` : '')
      + `   [depth ${info.depth}, ${info.nodes} nodes, ${took}s]\n`);
  }

  async playHumanMove(side, interactive) {
    this.render();
    for (;;) {
      if (this.exitRequested) return true;
      const line = await this.readLine(`${this.sideLabel(side)} > `);
      if (line === null) return true;
      const answer = line.trim();
      if (answer === '') continue;
      const handled = await this.handleCommand(answer, side);
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
    if (!this.input) return null;
    try {
      return await this.input.question(prompt);
    } catch {
      return null;
    }
  }
  declareNoMove(side) {
    const label = this.sideLabel(side);
    const other = side === SIDE_ATTACKER ? SIDE_DEFENDER : SIDE_ATTACKER;
    if (this.game.variant.noMove === 'loss') {
      const status = other === SIDE_ATTACKER ? 'attackers-win' : 'defenders-win';
      this.game.finish(status, other, `${label} have no legal move.`);
    } else {
      this.game.finish('draw', null, `${label} have no legal move.`);
    }
  }

  /** @returns 'move' to continue the game, 'quit' to leave, 'noop' to re-prompt. */
  async handleCommand(answer, side) {
    const [command, ...rest] = answer.split(/\s+/);
    const arg = rest.join(' ');
    const lower = command.toLowerCase();

    if (lower === 'help' || lower === '?') {
      this.ansi.write(`\n${this.display.helpText()}\n`);
      return 'noop';
    }
    if (lower === 'rules') {
      this.ansi.write(`\n${this.display.rulesText(this.game.variant)}\n`);
      return 'noop';
    }
    if (lower === 'moves') {
      const moves = this.game.legalMoves(side);
      this.ansi.write(`\n${this.sideLabel(side)} can move from: `
        + `${this.display.movesList(moves, this.game.board.size)}\n`);
      return 'noop';
    }
    if (lower === 'hint') {
      const ai = new AIPlayer('hard', { timeMs: 900 });
      const { move, info } = ai.chooseMove(this.game, side);
      if (!move) {
        this.ansi.write('\nNo legal move.\n');
        return 'noop';
      }
      this.ansi.write(`\nhint: ${formatMove(this.game.board.size, move)}`
        + `  (depth ${info.depth}, score ${info.score})\n`);
      return 'noop';
    }
    if (lower === 'undo') {
      const n = Number.parseInt(arg, 10) || 1;
      const undone = this.game.undo(n);
      this.ansi.write(`\ntook back ${undone} plie(s)\n`);
      this.render();
      return 'noop';
    }
    if (lower === 'save') {
      const file = arg || 'clitafl-save.json';
      const target = path.resolve(process.cwd(), file);
      fs.writeFileSync(target, `${JSON.stringify(this.game.serialize(), null, 2)}\n`);
      this.ansi.write(`\ngame written to ${file}\n`);
      return 'noop';
    }
    if (lower === 'resign') {
      const winner = side === SIDE_ATTACKER ? SIDE_DEFENDER : SIDE_ATTACKER;
      const status = winner === SIDE_ATTACKER ? 'attackers-win' : 'defenders-win';
      this.game.finish(status, winner, `${this.sideLabel(side)} resigned.`);
      this.render();
      return 'quit';
    }
    if (lower === 'board' || lower === 'b' || lower === 'show') {
      this.render();
      return 'noop';
    }
    if (lower === 'history' || lower === 'hist') {
      const moves = this.game.movesPlayed();
      this.ansi.write(moves.length
        ? `\n${moves.map((m) => `${String(m.ply).padStart(3)}. ${m.side === SIDE_ATTACKER ? 'A' : 'D'} ${m.notation}`).join('\n')}\n`
        : '\nno moves played yet\n');
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
      this.ansi.write(`\n${this.sideLabel(result.side)}: ${result.notation}`
        + (captured ? `  takes ${captured}` : '') + '\n');
      return 'move';
    } catch (error) {
      this.ansi.write(`\n${error.message}  (type 'moves' to see what can move)`);
      return 'noop';
    }
  }

  finish() {
    if (this.game.isGameOver()) {
      this.ansi.write(`\n${this.display.outcomeLine(this.game)}\n`);
    }
    const moves = this.game.movesPlayed();
    if (moves.length > 0) {
      const line = moves.map((m) => `${m.side === SIDE_ATTACKER ? 'A' : 'D'} ${m.notation}`).join('  ');
      this.ansi.write(`\n${line}\n`);
    }
    if (this.recordPath) this.writeRecord();
    this.closeReadline();
    for (const handler of this.cleanupHandlers.splice(0).reverse()) {
      try { handler(); } catch { /* terminal already gone */ }
    }
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
    this.ansi.write(`record written to ${this.recordPath}\n`);
  }
}

module.exports = { GameController };
