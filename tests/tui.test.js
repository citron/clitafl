'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { Ansi } = require('../src/ui/ansi');
const { Display } = require('../src/ui/display');
const { Game } = require('../src/rules/game');
const { GameController } = require('../src/cli/controller');
const { SIDE_ATTACKER, SIDE_DEFENDER } = require('../src/rules/pieces');

/** A display that believes it is on a terminal, so the pages drive the screen. */
const screenDisplay = () => new Display({ ansi: new Ansi({ color: false, control: true }) });

const GLYPHS = /[·○●★✦]/g;
const rankLines = (lines) => lines.filter((line) => /^\s*\d+\s+[·○●★✦]/.test(Ansi.strip(line)));
const squaresIn = (lines) => Math.max(0, ...lines.map((line) => (Ansi.strip(line).match(GLYPHS) || []).length));
const NOTE = /(rows|columns) needed|→ \d+ (rows|columns)/;
const noteLines = (lines) => Ansi.strip(lines.join('\n')).split('\n').filter((line) => NOTE.test(line));

/**
 * The paints in a run of writes: a frame is written between taking the top of
 * the window and clearing what a shorter frame leaves below it, so the clear
 * to the bottom is where a paint ends.
 */
function paintsOf(writes) {
  return writes.join('')
    .split('\u001b[J')
    .map((paint) => Ansi.strip(paint).replace(/\n$/, '').split('\n'))
    .filter((lines) => lines.some((line) => line.length > 0));
}

/**
 * Runs `fn` with the window set to `geometry` and the writes of the program
 * caught, and hands back `text` (what was written, styles stripped), `writes`
 * (one entry per write, which for a page is one entry per paint) and `value`
 * (what `fn` returned, awaited).
 */
async function capture(fn, geometry = null) {
  const writes = [];
  const stdout = process.stdout;
  const write = stdout.write;
  const rows = stdout.rows;
  const columns = stdout.columns;
  if (geometry) {
    stdout.rows = geometry.rows;
    stdout.columns = geometry.columns;
  }
  stdout.write = (chunk) => {
    writes.push(typeof chunk === 'string' ? chunk : String(chunk));
    return true;
  };
  const restore = () => {
    stdout.write = write;
    if (geometry) {
      stdout.rows = rows;
      stdout.columns = columns;
    }
  };
  try {
    const value = await fn(() => Ansi.strip(writes.join('')));
    restore();
    const text = Ansi.strip(writes.join(''));
    return { text, writes, value };
  } catch (error) {
    restore();
    throw error;
  }
}

test('the window is read from the terminal, and falls back to the size a terminal has by default', async () => {
  const plain = await capture(() => Ansi.geometry());
  assert.deepEqual(plain.value, { rows: plain.value.rows, columns: plain.value.columns });
  assert.ok(plain.value.rows >= 1 && plain.value.columns >= 1);
  const sized = await capture(() => Ansi.geometry(), { rows: 12, columns: 40 });
  assert.deepEqual(sized.value, { rows: 12, columns: 40 });
});

test('a resized terminal is reported to the game, and a pipe is not', async () => {
  const stdout = process.stdout;
  const wasTty = stdout.isTTY;
  const seen = [];
  stdout.isTTY = true;
  const stop = Ansi.onResize((geo) => seen.push(geo));
  const out = await capture(() => {
    stdout.emit('resize');
    return null;
  }, { rows: 30, columns: 100 });
  stop();
  stdout.isTTY = wasTty;
  stdout.emit('resize');
  assert.equal(out.text, '');
  assert.deepEqual(seen, [{ rows: 30, columns: 100 }]);
  assert.equal(typeof stop, 'function');
});

test('the styles of a line are not on the screen, so they are not counted', () => {
  const styled = '\u001b[35m✦\u001b[0m \u001b[90m·\u001b[0m ·';
  assert.equal(Ansi.strip(styled), '✦ · ·');
  assert.equal(Ansi.width(styled), 5);
  assert.equal(Ansi.strip('plain'), 'plain');
});

test('a line that is too wide is cut, with an ellipsis, and its styles closed', () => {
  const red = '\u001b[31mabcdef\u001b[0m';
  const cut = Ansi.fit(red, 4);
  assert.equal(Ansi.width(cut), 4);
  assert.equal(Ansi.strip(cut), 'abc…');
  // The colour is closed before the ellipsis, so it cannot paint the screen.
  assert.match(cut, /\u001b\[0m…$/);
  assert.equal(Ansi.fit('short', 40), 'short');
  assert.equal(Ansi.fit('abcdef', 0), '');
  assert.equal(Ansi.strip(Ansi.fit('abcdef', 1)), '…', 'a one column window gets the ellipsis, not two columns');
  for (const columns of [1, 2, 3, 5, 40]) {
    assert.ok(Ansi.width(Ansi.fit(red, columns)) <= Math.max(columns, 0), `a cut line of ${columns} columns is wider`);
  }
});

test('a line is broken on the spaces, and a word longer than the window is cut', () => {
  assert.deepEqual(Ansi.wrap('the king wins by reaching any edge square', 12),
    ['the king', 'wins by', 'reaching any', 'edge square']);
  assert.deepEqual(Ansi.wrap('supercalifragilistic word', 10),
    ['supercalif', 'ragilistic', 'word']);
  assert.deepEqual(Ansi.wrap('', 10), ['']);
  assert.deepEqual(Ansi.wrap('one', 0), ['']);
  for (const row of Ansi.wrap('\u001b[31mthe king wins by reaching any edge square\u001b[0m', 12)) {
    assert.ok(Ansi.width(row) <= 12);
  }
});

test('a cut line and what is left of it are the line again', () => {
  const text = 'the king wins by reaching any edge square';
  const head = Ansi.cut(text, 12);
  const tail = Ansi.cutStart(text, 12);
  assert.equal(head + tail, text);
  assert.equal(Ansi.width(head), 12);
  assert.deepEqual(Ansi.fitAll(text, 10).map((row) => Ansi.width(row)), [10, 10, 10, 10, 1]);
});

test('a key press is named as the pages read it', () => {
  const keys = {
    '\u0003': 'ctrl-c',
    '\r': 'enter',
    '\n': 'enter',
    ' ': 'space',
    '\u007f': 'backspace',
    '\b': 'backspace',
    '\u001b': 'escape',
    '\u001b[A': 'up',
    '\u001b[B': 'down',
    '\u001b[C': 'right',
    '\u001b[D': 'left',
    '\u001b[5~': 'pageup',
    '\u001b[6~': 'pagedown',
    '\u001b[1~': 'home',
    '\u001b[4~': 'end',
    '\u001bOA': 'up',
    '\u001bOB': 'down',
    'n': 'n',
    'G': 'G',
    '\u001b[C\u001b[C': '\u001b[C\u001b[C',
  };
  for (const [chunk, name] of Object.entries(keys)) {
    assert.equal(Ansi.keyName(chunk), name, JSON.stringify(chunk));
  }
  assert.equal(Ansi.keyName(Buffer.from('a')), 'a');
});

test('the screen is only driven in a terminal: colour off is not permission to scroll', async () => {
  const plain = await capture(() => {
    const ansi = new Ansi({ color: false });
    assert.equal(ansi.control, false);
    ansi.altScreenOn();
    ansi.hideCursor();
    ansi.clearScreen();
    ansi.clearToEnd();
    ansi.moveTo(3, 4);
    ansi.write('text');
    return null;
  });
  assert.equal(plain.text, 'text');
  const driven = await capture(() => {
    const ansi = new Ansi({ color: false, control: true });
    assert.equal(ansi.control, true);
    ansi.altScreenOn();
    ansi.hideCursor();
    ansi.clearScreen();
    ansi.clearToEnd();
    ansi.showCursor();
    ansi.altScreenOff();
    return null;
  });
  assert.equal(driven.writes.join(''), '\u001b[?1049h\u001b[?25l\u001b[2J\u001b[H\u001b[J\u001b[?25h\u001b[?1049l');
});

test('the board of a frame is the block of ranks, and its width is known before it is drawn', () => {
  const display = new Display({ color: false, animate: false });
  const board = Game.create('alea').board;
  const wide = display.boardLines(board, { pitch: 2 });
  const narrow = display.boardLines(board, { pitch: 1 });
  assert.equal(wide.length, 21);
  assert.equal(Display.boardRows(19), 21);
  assert.equal(Display.boardWidth(19, 2), 41);
  assert.equal(Display.boardWidth(19, 1), 23);
  assert.equal(Ansi.width(wide[1]), 41);
  assert.equal(Ansi.width(narrow[1]), 23);
  assert.equal(squaresIn(wide), 19);
  assert.equal(squaresIn(narrow), 19);
});

test('a window that pays for the board gets the board, the legend, the journal, and no empty row', () => {
  const display = new Display({ color: false, animate: false });
  const log = ['seats: attackers = human, defenders = human', 'attackers: e1-e2', 'defenders: d2-d1'];
  const frame = display.fit(Game.create('tablut'), { rows: 30, columns: 100, log, reserve: 2 });
  assert.equal(frame.pitch, 2);
  assert.equal(frame.shortRows, false);
  assert.equal(frame.shortCols, false);
  assert.equal(frame.noteRows, 0);
  assert.equal(frame.lines.length, 28, 'the frame paints every row the window leaves');
  assert.equal(rankLines(frame.lines).length, 9);
  assert.equal(squaresIn(frame.lines), 9);
  assert.equal(frame.journalRows, 3);
  assert.equal(frame.dropped, 0);
  assert.equal(frame.padded, 11);
  const joined = frame.lines.join('\n');
  for (const line of log) assert.ok(joined.includes(line), joined);
  assert.ok(joined.includes('★ king'), joined);
});

test('the journal keeps the newest rows and gives up the oldest', () => {
  const display = new Display({ color: false, animate: false });
  const log = Array.from({ length: 40 }, (_, i) => `attackers: c3-c5  takes d4   [depth 6] line ${i}`);
  const frame = display.fit(Game.create('tablut'), { rows: 24, columns: 80, log, reserve: 2 });
  const joined = frame.lines.join('\n');
  assert.ok(joined.includes('line 39'), joined);
  assert.ok(!joined.includes('line 0'), joined);
  assert.ok(frame.journalRows > 0 && frame.dropped > 0);
  assert.equal(frame.journalRows + frame.dropped, 40);
  const roomy = display.fit(Game.create('tablut'), { rows: 40, columns: 80, log: log.slice(-10), reserve: 2 });
  assert.equal(roomy.dropped, 0);
  assert.equal(roomy.journalRows, 10);
});

test('a window too short for the board keeps the board whole and counts what is missing under it', () => {
  const display = new Display({ color: false, animate: false });
  const log = ['journal one', 'journal two'];
  for (const [variant, size] of [['tablut', 9], ['alea', 19], ['brandub', 7]]) {
    const game = Game.create(variant);
    const frame = display.fit(game, { rows: 10, columns: 60, log, reserve: 2 });
    assert.equal(frame.shortRows, true);
    assert.equal(frame.noteRows, 1);
    assert.equal(frame.padded, 0, 'a short window is not padded: the prompt is the row that scrolls');
    assert.equal(frame.lines.length, 1 + frame.boardRows + 1);
    assert.equal(rankLines(frame.lines).length, size);
    assert.equal(squaresIn(frame.lines), size);
    assert.match(Ansi.strip(frame.lines[frame.lines.length - 1]), /rows needed/);
    assert.ok(frame.need > 10, `${variant} needs ${frame.need} rows`);
    for (const line of frame.lines) assert.ok(Ansi.width(line) <= 60, line);
  }
});

test('a window too narrow for the board says so, and a window short in both directions says both', () => {
  const display = new Display({ color: false, animate: false });
  const narrow = display.fit(Game.create('alea'), { rows: 32, columns: 19, log: [], reserve: 2 });
  assert.equal(narrow.pitch, 1);
  assert.equal(narrow.shortCols, true);
  assert.equal(narrow.shortRows, false);
  assert.equal(narrow.boardCols, 23);
  assert.equal(narrow.noteRows, 1);
  const stripped = narrow.lines.map((line) => Ansi.strip(line));
  const narrowNotes = noteLines(narrow.lines);
  assert.equal(narrowNotes.length, 1, narrowNotes.join(' / '));
  // Nineteen columns cannot hold the advice, so the two counts are kept.
  assert.equal(narrowNotes[0], '23 → 19 columns', narrowNotes[0]);
  assert.ok(stripped.indexOf(narrowNotes[0]) > stripped.reduce((acc, line, i) => (rankLines([line]).length ? i : acc), -1),
    'the note is read under the board');
  for (const line of narrow.lines) assert.ok(Ansi.width(line) <= 19, JSON.stringify(line));

  const both = display.fit(Game.create('alea'), { rows: 10, columns: 19, log: [], reserve: 2 });
  assert.equal(both.shortRows, true);
  assert.equal(both.shortCols, true);
  assert.equal(both.noteRows, 2);
  const notes = noteLines(both.lines);
  assert.deepEqual(notes, ['25 → 10 rows', '23 → 19 columns'], notes.join(' / '));
  for (const note of notes) assert.ok(Ansi.width(note) <= 19, note);
  assert.equal(both.lines.length, 1 + both.boardRows + 2);
  assert.equal(rankLines(both.lines).length, 21 - 2, 'the ranks of the whole board, the note taking the rest');
});

test('the blank between the state and the board is the first thing a tight window gives up', () => {
  const display = new Display({ color: false, animate: false });
  const roomy = display.fit(Game.create('tablut'), { rows: 16, columns: 60, log: [], reserve: 2 });
  assert.equal(roomy.shortRows, false);
  assert.equal(Ansi.strip(roomy.lines[1]), '', 'the blank is there while the window can pay for it');
  const tight = display.fit(Game.create('tablut'), { rows: 15, columns: 60, log: [], reserve: 2 });
  assert.equal(tight.shortRows, false);
  assert.match(Ansi.strip(tight.lines[1]), /a b c d e/, 'a window at the minimum paints the board under the state');
  assert.equal(tight.lines.length, 13);
  assert.equal(tight.padded, 0);
});

test('a long text is read on pages, one key at a time, in a window that shows no board', async () => {
  const keys = ['space', 'b', 'G', 'pagedown', 'g', 'right', 'left', 'end'];
  const closed = [];
  const controller = new GameController({
    game: Game.create('tablut'),
    display: screenDisplay(),
    seats: { [SIDE_ATTACKER]: 'human', [SIDE_DEFENDER]: 'human' },
    readKey: async () => keys.shift() || 'q',
  });
  controller.tty = true;
  controller.input = { close: () => closed.push('input'), pause: () => {}, resume: () => {} };
  const text = Array.from(
    { length: 20 },
    (_, i) => `rule ${i + 1}: the king moves like the other pieces, and wins on an edge square`,
  ).join('\n');
  const asked = keys.length;
  const out = await capture(() => controller.showPage(text, 'the rules as they are played'),
    { rows: 10, columns: 40 });
  assert.equal(closed.length, 1, 'the input line is put away for the page, so a page key is not typed into a command');
  assert.equal(controller.input, null);
  const paints = paintsOf(out.writes);
  assert.equal(paints.length, asked, `${paints.length} paints for ${asked} keys`);
  for (const paint of paints) {
    assert.equal(paint.length, 10, `${paint.length} lines in a 10 row window`);
    for (const line of paint) assert.ok(Ansi.width(line) <= 40, JSON.stringify(line));
    assert.equal(rankLines(paint).length, 0, 'a page carries no board');
  }
  assert.ok(paints[0][0].includes('the rules as they are played'), paints[0][0]);
  // A window of 40 columns is told the keys it can reach, not an ellipsis.
  assert.equal(paints[0][9], 'page 1/5   → next   ← back   q board', paints[0][9]);
  const pages = paints.map((paint) => Number(/page (\d+)\/\d+/.exec(paint[9])[1]));
  assert.deepEqual(pages, [1, 2, 1, 5, 5, 1, 2, 1], pages.join(' '));
  const counts = new Set(paints.map((paint) => /page \d+\/(\d+)/.exec(paint[9])[1]));
  assert.equal(counts.size, 1, `${counts.size} page counts for one window: ${[...counts].join(' ')}`);
  // Page two begins where page one ended: eight rows of the wrapped text.
  const page2 = paints[1].join('\n');
  assert.ok(page2.includes('rule 5'), page2);
  assert.ok(page2.includes('rule 8'), page2);
  assert.ok(!page2.includes('rule 1:'), page2);
});

test('the footer of a page is told in the words the window has room for', async () => {
  const controller = new GameController({
    game: Game.create('tablut'),
    display: screenDisplay(),
    readKey: async () => 'q',
  });
  controller.tty = true;
  controller.input = null;
  const text = Array.from({ length: 30 }, (_, i) => `rule ${i + 1}`).join('\n');
  const wide = await capture(() => controller.showPage(text, 'the rules'), { rows: 12, columns: 90 });
  assert.match(wide.text, /page 1\/3   space, n, → next   b, ← back   g first, G last   q board/, wide.text);
  const middle = await capture(() => controller.showPage(text, 'the rules'), { rows: 12, columns: 52 });
  assert.match(middle.text, /page 1\/3   space, → next   b, ← back   q board/, middle.text);
  const narrow = await capture(() => controller.showPage(text, 'the rules'), { rows: 12, columns: 30 });
  assert.match(narrow.text, /page 1\/3   → next   q board/, narrow.text);
  const smallest = await capture(() => controller.showPage(text, 'the rules'), { rows: 12, columns: 20 });
  assert.match(smallest.text, /^page 1\/\d+$/m, smallest.text);
  for (const line of smallest.text.split('\n')) assert.ok(Ansi.width(line) <= 20, JSON.stringify(line));
});

test('a page is repaginates for the window it is shown in, and ctrl-c on a page leaves the session', async () => {
  const keys = ['space', 'q'];
  const controller = new GameController({
    game: Game.create('tablut'),
    display: screenDisplay(),
    readKey: async () => keys.shift() || 'q',
  });
  controller.tty = true;
  controller.input = null;
  const text = Array.from({ length: 12 }, (_, i) => `command ${i + 1}`).join('\n');
  const wide = await capture(() => controller.showPage(text, 'the commands'), { rows: 20, columns: 60 });
  assert.match(wide.text, /page 1\/1/, wide.text);
  const small = await capture(() => controller.showPage(text, 'the commands'), { rows: 8, columns: 20 });
  assert.match(small.text, /page 1\/(\d+)/, small.text);
  const total = Number(/page 1\/(\d+)/.exec(small.text)[1]);
  assert.ok(total > 1, `twelve lines in a window of eight rows are ${total} pages`);

  keys.length = 0;
  keys.push('ctrl-c');
  const ctrlc = await capture(() => controller.showPage(text, 'the commands'), { rows: 12, columns: 30 });
  assert.equal(ctrlc.value, undefined);
  assert.equal(controller.exitRequested, true, 'ctrl-c on a page is the way out of a session');
  controller.exitRequested = false;
});

test('a page a window can show in one screen is one page, and a key that turns nothing still repaints it', async () => {
  const keys = ['b', 'G', 'nonsense', 'q'];
  const controller = new GameController({
    game: Game.create('brandub'),
    display: screenDisplay(),
    readKey: async () => keys.shift() || 'q',
  });
  controller.tty = true;
  controller.input = null;
  const asked = keys.length;
  const out = await capture(() => controller.showPage('the king\nthe defenders\nthe attackers', 'the armies'),
    { rows: 20, columns: 40 });
  assert.match(out.text, /page 1\/1/, out.text);
  assert.equal(paintsOf(out.writes).length, asked, 'every key paints the page it shows');
  for (const lines of paintsOf(out.writes)) {
    assert.equal(lines.length, 20, 'the page fills the window, so the prompt never moves');
    assert.equal(lines[0], 'the armies');
    assert.equal(lines[1], 'the king');
    assert.match(lines[19], /page 1\/1   → next   ← back   q board/);
  }
});
