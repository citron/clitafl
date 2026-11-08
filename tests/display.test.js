'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { Display } = require('../src/ui/display');
const { Ansi } = require('../src/ui/ansi');
const { Game } = require('../src/rules/game');
const { getVariant } = require('../src/rules/variants');
const { KING, DEFENDER, ATTACKER, SIDE_ATTACKER, SIDE_DEFENDER } = require('../src/rules/pieces');
const { LETTERS } = require('../src/rules/notation');
const { makeBoard } = require('./helpers');

const plain = () => new Display({ ansi: new Ansi({ color: false }), animate: false });
const ESC = String.fromCharCode(27);

test('the board is drawn with a coordinate frame and every piece on its square', () => {
  const board = makeBoard('tablut', [
    '.........',
    '.........',
    '...A.....',
    '..ADK....',
    '.........',
    '.........',
    '....D....',
    '.........',
    '.......A.',
  ]);
  const game = new Game(board.variant, board);
  const lines = plain().boardLines(board);
  const frame = lines.filter((line) => /\b[a-i]\b/.test(line));
  assert.ok(frame.length >= 2, 'a file letter row opens and closes the grid');
  const grid = lines.filter((line) => /^\s+\d/.test(line));
  assert.equal(grid.length, 9, 'one line per rank');
  const text = lines.join('\n');
  assert.ok(text.includes('★'), 'the king is drawn');
  assert.ok(/●/.test(text), 'defenders are drawn');
  assert.ok(/○/.test(text), 'attackers are drawn');
});

test('the file letters sit on their column, on every board size', () => {
  const display = plain();
  for (const size of [7, 9, 11, 13, 15, 17, 19]) {
    const lines = display.boardLines(Game.create('tablut', size).board);
    const header = lines[0];
    const footer = lines[lines.length - 1];
    const ranks = lines.slice(1, -1);
    assert.equal(ranks.length, size, `${size}x${size}: one line per rank`);
    assert.equal(header, footer, `${size}x${size}: the footer repeats the header`);

    // the first glyph of a rank line is the left edge of the grid
    const gridStart = ranks[0].search(/[^ \d]/);
    for (const row of ranks) {
      assert.equal(row.search(/[^ \d]/), gridStart, `${size}x${size}: the ranks start on one column`);
    }
    for (let c = 0; c < size; c += 1) {
      const letter = LETTERS[c];
      assert.equal(header.indexOf(letter), gridStart + 2 * c, `${size}x${size}: file ${letter} sits over its squares`);
      assert.equal(footer.indexOf(letter), gridStart + 2 * c, `${size}x${size}: ${letter} in the footer too`);
    }
  }
});

test('--ascii draws with plain letters and no unicode', () => {
  const ascii = new Display({ ansi: new Ansi({ color: false }), ascii: true, animate: false });
  const text = ascii.boardLines(Game.create('tablut').board).join('\n');
  assert.ok(text.includes('K'), 'the king reads K');
  assert.ok(text.includes('A') && text.includes('D'), 'the armies read A and D');
  assert.doesNotMatch(text, /[\u2600-\u27BF]/, 'no symbols in ascii mode');
});

test('colour is off when it must be, and on when asked', () => {
  const off = plain().render(Game.create('tablut'));
  assert.ok(!off.includes(ESC), 'no escape codes with colour off');

  const on = new Display({ ansi: new Ansi({ color: true }), animate: false }).render(Game.create('tablut'));
  assert.ok(on.includes(ESC), 'colour is a real escape code');
});

test('the legend counts the pieces that are on the board', () => {
  const game = Game.create('tablut');
  const legend = plain().legend(game);
  assert.match(legend, /defenders 8/, 'the tablut army: king + 8');
  assert.match(legend, /attackers 16/);

  game.board.set(4, 3, 0);
  assert.match(plain().legend(game), /defenders 7/, 'it follows the board as pieces are taken');
});

test('the status line tells the turn, the ply and how the king escapes', () => {
  const lines = plain().statusLines(Game.create('copenhagen')).join(' ');
  assert.match(lines, /Copenhagen/);
  assert.match(lines, /11x11/);
  assert.match(lines, /turn attackers/, 'the attackers open');
  assert.match(lines, /ply 0/);
  assert.match(lines, /king escapes to a corner/);

  const alea = plain().statusLines(Game.create('alea')).join(' ');
  assert.match(alea, /19x19/);
  assert.match(alea, /king escapes to the 16 marked squares/);
  assert.ok(!/king escapes to the edge/.test(alea), 'the plain edge is not an exit in alea');
});

test('the outcome line names the winner and the reason', () => {
  const board = makeBoard('brandub', [
    '.K.....',
    '.......',
    '.......',
    '.......',
    '.......',
    '.......',
    '.......',
  ]);
  const game = new Game(board.variant, board);
  game.turn = SIDE_DEFENDER;
  game.play({ from: 1, to: 0 });
  assert.match(plain().outcomeLine(game), /defenders win/i);
  assert.match(plain().outcomeLine(game), /escape square/);
});

test('the banner introduces the variant and its army', () => {
  const banner = plain().banner(getVariant('ard-ri', null));
  assert.match(banner, /Ard Rí/);
  assert.match(banner, /7x7/);
});

test('animating a move never touches the real board', async () => {
  const quiet = new Ansi({ color: false });
  quiet.write = () => {};
  const display = new Display({ ansi: quiet, animate: true, frameMs: 0 });
  const game = Game.create('tablut');
  game.play(game.legalMoves()[0]);
  const after = Array.from(game.board.grid);
  await display.animateMove(game, game.lastMove);
  assert.deepEqual(Array.from(game.board.grid), after, 'the animated board is a copy');
  assert.equal(game.ply, 1, 'and the ply count is untouched');
});

test('every command the help lists is answered by the controller', async () => {
  const { GameController } = require('../src/cli/controller');
  const help = plain().helpText();
  const listed = ['help', 'board', 'moves', 'history', 'hint', 'undo', 'rules', 'save', 'resign', 'quit'];
  for (const command of listed) assert.ok(help.includes(command), `help lists ${command}`);

  const quiet = new Ansi({ color: false });
  quiet.write = () => {};
  const game = Game.create('brandub');
  const controller = new GameController({
    game,
    display: new Display({ ansi: quiet, animate: false }),
    seats: { [SIDE_ATTACKER]: 'human', [SIDE_DEFENDER]: 'human' },
    levels: {},
  });
  controller.script = [];
  for (const command of ['help', 'board', 'moves', 'history', 'rules', 'undo']) {
    assert.equal(await controller.handleCommand(command, SIDE_ATTACKER), 'noop', `${command} re-prompts`);
  }
  assert.equal(await controller.handleCommand('d1-e1', SIDE_ATTACKER), 'move', 'a move plays');
  assert.equal(game.ply, 1);
  assert.equal(await controller.handleCommand('quit', SIDE_ATTACKER), 'quit');
});

test('the rules text spells out the army, the escape and the capture rule', () => {
  const text = plain().rulesText(getVariant('tablut', null));
  assert.match(text, /king \+ 8 defenders vs 16 attackers/);
  assert.match(text, /Attackers move first/);
  assert.match(text, /any edge square/);
  assert.match(text, /throne/, 'the throne is explained');
  assert.match(text, /nobody may land on them/, 'the throne is off limits to every man');
});

test('the alea evangelii rules text explains the marked squares and the citadel', () => {
  const text = plain().rulesText(getVariant('alea', null));
  assert.match(text, /king \+ 24 defenders vs 48 attackers/);
  assert.match(text, /16 marked squares/, 'the 16 exits are named');
  assert.match(text, /plain board edge is not an exit/, 'the edge is not an exit');
  assert.match(text, /the ones the king escapes to are his alone, nobody else may land on any of them/, 'the citadel is off limits, the exits are the king\'s');
  assert.match(text, /The king needs 2 attackers to be captured \(3 next to the throne, 4 on the throne\)/);
});

test('the moves list is readable notation', () => {
  const game = Game.create('brandub');
  const list = plain().movesList(game.legalMoves(), game.board.size);
  assert.match(list, /a4->a\d/, 'it shows where each piece can go');
});
