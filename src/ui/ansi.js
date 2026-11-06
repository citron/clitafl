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
 */
class Ansi {
  constructor(options = {}) {
    this.color = options.color === undefined ? Ansi.detect() : Boolean(options.color);
  }

  static detect() {
    if (process.env.NO_COLOR !== undefined) return false;
    if (process.env.FORCE_COLOR !== undefined) return process.env.FORCE_COLOR !== '0';
    return Boolean(process.stdout && process.stdout.isTTY);
  }

  style(text, ...names) {
    if (!this.color || names.length === 0) return String(text);
    const open = names.map((name) => CODES[name] || '').join('');
    if (!open) return String(text);
    return `${open}${text}${CODES.reset}`;
  }

  altScreenOn() { if (this.color) process.stdout.write(seq('?1049h')); }
  altScreenOff() { if (this.color) process.stdout.write(seq('?1049l')); }
  hideCursor() { if (this.color) process.stdout.write(seq('?25l')); }
  showCursor() { if (this.color) process.stdout.write(seq('?25h')); }
  clearScreen() { if (this.color) process.stdout.write(seq('2J') + seq('H')); }
  clearLine() { if (this.color) process.stdout.write(seq('2K')); }
  moveTo(row, col) { if (this.color) process.stdout.write(seq(`${row};${col}H`)); }
  write(text) { process.stdout.write(text); }
  newline(n = 1) { process.stdout.write('\n'.repeat(n)); }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = { Ansi, CODES, sleep, seq };
