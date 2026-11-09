'use strict';

const ESC = '\u001b';
const seq = (code) => `${ESC}[${code}`;

const CODES = {
  bold: seq('1m'),
  dim: seq('2m'),
  italic: seq('3m'),
  underline: seq('4m'),
  inverse: seq('7m'),
  reset: seq('0m'),
  black: seq('30m'),
  red: seq('31m'),
  green: seq('32m'),
  yellow: seq('33m'),
  blue: seq('34m'),
  magenta: seq('35m'),
  cyan: seq('36m'),
  white: seq('37m'),
  gray: seq('90m'),
  brightRed: seq('91m'),
  brightGreen: seq('92m'),
  brightYellow: seq('93m'),
  brightBlue: seq('94m'),
  brightCyan: seq('96m'),
  bgRed: seq('41m'),
  bgGreen: seq('42m'),
  bgBlue: seq('44m'),
  bgGray: seq('100m'),
};

/**
 * Small ANSI helper, no dependency. Colour is auto-detected and every helper
 * degrades to plain text when colour is off (piped output, NO_COLOR, --no-color).
 *
 * The terminal is a window of a known size, and the interactive screen is
 * drawn to fit it: `geometry` reads the window, `onResize` says when it
 * changes, and `strip`/`width`/`fit`/`wrap` measure the visible text, because
 * a styled line carries escape sequences that are not on the screen and a
 * naive `.length` counts them (a 60 column board line measures 225).
 */
class Ansi {
  constructor(options = {}) {
    this.color = options.color === undefined ? Ansi.detect() : Boolean(options.color);
    /* A test, or a caller that knows the output is a terminal in a way the
     * stream does not show, can say so here. */
    this.controlOverride = options.control;
  }

  static detect() {
    if (process.env.NO_COLOR !== undefined) return false;
    if (process.env.FORCE_COLOR !== undefined) return process.env.FORCE_COLOR !== '0';
    return Boolean(process.stdout && process.stdout.isTTY);
  }

  /** The window the program is being shown in: a terminal reports it, a pipe
   *  has none, and the fallback is the size a terminal has by default. */
  static geometry() {
    const stream = process.stdout;
    const rows = Number.isInteger(stream && stream.rows) && stream.rows > 0 ? stream.rows : 24;
    const columns = Number.isInteger(stream && stream.columns) && stream.columns > 0 ? stream.columns : 80;
    return { rows, columns };
  }

  /** Calls `handler({ rows, columns })` whenever the window is resized. */
  static onResize(handler) {
    const stream = process.stdout;
    const report = () => handler(Ansi.geometry());
    if (stream && stream.isTTY && typeof stream.on === 'function') {
      stream.on('resize', report);
      return () => stream.removeListener('resize', report);
    }
    process.on('SIGWINCH', report);
    return () => process.removeListener('SIGWINCH', report);
  }

  /** The text of a line as it is shown: the escape sequences are not on screen. */
  static strip(text) {
    return String(text).replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
  }

  /**
   * The name of a key press as the terminal sends it, for the pages that are
   * turned with one key: `space`, `enter`, `escape`, `up`, `down`, `right`,
   * `left`, `home`, `end`, `pageup`, `pagedown`, `ctrl-c`, and a plain key by
   * the character it types. A burst of keys, or one the terminal spells its own
   * way, is the text itself, which a caller that knows no such key ignores.
   */
  static keyName(chunk) {
    const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    if (text === '\u0003') return 'ctrl-c';
    if (text === '\r' || text === '\n') return 'enter';
    if (text === ' ') return 'space';
    if (text === '\u007f' || text === '\b') return 'backspace';
    if (text === '\u001b') return 'escape';
    const keys = /^\u001b(?:\[|O)(\d*)([A-Za-z~])$/.exec(text);
    if (keys) {
      const arrows = { A: 'up', B: 'down', C: 'right', D: 'left' };
      const named = { 1: 'home', 2: 'insert', 3: 'delete', 4: 'end', 5: 'pageup', 6: 'pagedown', 7: 'home', 8: 'end' };
      if (keys[2] === '~' && named[keys[1]]) return named[keys[1]];
      if (arrows[keys[2]]) return arrows[keys[2]];
    }
    return text;
  }

  /** How many columns a line takes on the screen. */
  static width(text) {
    return Ansi.strip(text).length;
  }

  /**
   * The line as much of it as the window shows, with an ellipsis when it is
   * cut. The styles a cut line leaves open are closed, so a truncated line
   * cannot paint the rest of the screen in its colour.
   */
  static fit(text, columns) {
    const source = String(text);
    if (!(columns > 0)) return '';
    if (Ansi.width(source) <= columns) return source;
    /* The ellipsis is a column of the window's own: a one column window is
     * shown the ellipsis and nothing of the line. */
    if (columns < 2) return '…';
    return `${Ansi.cut(source, columns - 1)}…`;
  }

  /**
   * The line broken into rows of `columns` visible characters, on the spaces:
   * a move list of 1 599 characters is read as pages, not cut in half.
   */
  static wrap(text, columns) {
    const source = String(text);
    if (!(columns > 0)) return [''];
    const words = source.split(/(\s+)/);
    const rows = [];
    let line = '';
    let width = 0;
    for (const word of words) {
      const length = Ansi.width(word);
      if (!line && /^\s+$/.test(word)) continue;
      if (width + length > columns && width > 0) {
        rows.push(line.replace(/\s+$/, ''));
        line = '';
        width = 0;
        /* The space that ended the row is not carried over to the next one. */
        if (/^\s+$/.test(word)) continue;
      }
      if (length > columns) {
        /* A word longer than the window is cut, escapes and all. */
        const pieces = Ansi.fitAll(word, columns);
        if (line) { rows.push(line.replace(/\s+$/, '')); line = ''; width = 0; }
        for (let i = 0; i < pieces.length - 1; i += 1) rows.push(pieces[i]);
        line = pieces[pieces.length - 1];
        width = Ansi.width(line);
        continue;
      }
      line += word;
      width += length;
    }
    rows.push(line.replace(/\s+$/, ''));
    return rows;
  }

  /** Every row of a line broken at `columns`, without breaking on spaces. */
  static fitAll(text, columns) {
    const rows = [];
    let rest = String(text);
    while (Ansi.width(rest) > columns) {
      rows.push(Ansi.cut(rest, columns));
      rest = Ansi.cutStart(rest, columns);
    }
    rows.push(rest);
    return rows;
  }

  /** The first `columns` visible characters, keeping the styles that cover them. */
  static cut(text, columns) {
    const source = String(text);
    if (Ansi.width(source) <= columns) return source;
    const styles = [];
    let visible = 0;
    let out = '';
    let last = 0;
    const pattern = /\u001b\[[0-9;]*[A-Za-z]/g;
    for (;;) {
      pattern.lastIndex = last;
      const token = pattern.exec(source);
      const chunk = token ? source.slice(last, token.index) : source.slice(last);
      if (visible + chunk.length >= columns) {
        out += chunk.slice(0, columns - visible);
        if (styles.length) out += CODES.reset;
        return out;
      }
      out += chunk;
      visible += chunk.length;
      if (!token) break;
      out += token[0];
      if (token[0] === CODES.reset) styles.length = 0;
      else styles.push(token[0]);
      last = token.index + token[0].length;
    }
    return out;
  }

  /** What is left of a line after its first `columns` visible characters. */
  static cutStart(text, columns) {
    const source = String(text);
    const styles = [];
    let visible = 0;
    let last = 0;
    const pattern = /\u001b\[[0-9;]*[A-Za-z]/g;
    for (;;) {
      pattern.lastIndex = last;
      const token = pattern.exec(source);
      const chunk = token ? source.slice(last, token.index) : source.slice(last);
      if (visible + chunk.length >= columns) {
        const open = styles.join('');
        return open + chunk.slice(columns - visible) + (open ? CODES.reset : '');
      }
      visible += chunk.length;
      if (!token) return '';
      if (token[0] === CODES.reset) styles.length = 0;
      else styles.push(token[0]);
      last = token.index + token[0].length;
    }
  }

  style(text, ...names) {
    if (!this.color || names.length === 0) return String(text);
    const open = names.map((name) => CODES[name] || '').join('');
    if (!open) return String(text);
    return `${open}${text}${CODES.reset}`;
  }

  /**
   * The escapes that drive a screen — clear the window, hide the cursor, take
   * the alt screen — are not colour: a terminal that is asked for plain text
   * is still a terminal, and one window of plain text is what a plain terminal
   * is promised. Anywhere the output is not a terminal, they stay unsaid.
   */
  get control() {
    if (this.controlOverride !== undefined) return this.controlOverride;
    return this.stream ? Boolean(this.stream.isTTY) : Boolean(process.stdout.isTTY);
  }

  altScreenOn() { if (this.control) process.stdout.write(seq('?1049h')); }
  altScreenOff() { if (this.control) process.stdout.write(seq('?1049l')); }
  hideCursor() { if (this.control) process.stdout.write(seq('?25l')); }
  showCursor() { if (this.control) process.stdout.write(seq('?25h')); }
  clearScreen() { if (this.control) process.stdout.write(seq('2J') + seq('H')); }
  /** Everything from the cursor to the bottom of the window: what a shorter
   *  frame leaves behind when the window grows and the board shrinks. */
  clearToEnd() { if (this.control) process.stdout.write(seq('J')); }
  clearLine() { if (this.control) process.stdout.write(seq('2K')); }
  moveTo(row, col) { if (this.control) process.stdout.write(seq(`${row};${col}H`)); }
  write(text) { process.stdout.write(text); }
  newline(n = 1) { process.stdout.write('\n'.repeat(n)); }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = { Ansi, CODES, sleep, seq };
