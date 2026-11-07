'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');

const { parseCli, seatsFrom, usage, COMMANDS } = require('../src/index');
const { Game } = require('../src/rules/game');
const { VARIANT_IDS } = require('../src/rules/variants');
const { SIDE_ATTACKER, SIDE_DEFENDER } = require('../src/rules/pieces');

const ROOT = path.join(__dirname, '..');
const ENTRY = path.join(ROOT, 'src', 'index.js');

/** Run the CLI in a child process, the way a player does. */
function run(args, input = null) {
  const result = spawnSync(process.execPath, [ENTRY, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    input: input || undefined,
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', TERM: 'dumb' },
    timeout: 60000,
  });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

test('the command line reads the flags it documents', () => {
  const parsed = parseCli(['play', '--variant', 'copenhagen', '--level', 'hard', '--time', '900', '--no-color']);
  assert.equal(parsed.command, 'play');
  assert.equal(parsed.args.variant, 'copenhagen');
  assert.equal(parsed.args.level, 'hard');
  assert.equal(parsed.args.time, '900');
  assert.equal(parsed.args['no-color'], true);
});

test('a bare call, and a call with only options, plays the default game', () => {
  assert.equal(parseCli([]).command, 'play');
  const onlyFlags = parseCli(['--variant', 'brandub', '-v', 'brandub']);
  assert.equal(onlyFlags.command, 'play');
  assert.equal(onlyFlags.args.variant, 'brandub');
});

test('a bad command or flag is refused', () => {
  assert.throws(() => parseCli(['plau']), /Unknown command/);
  assert.throws(() => parseCli(['play', '--wat']), /wat/);
  assert.throws(() => parseCli(['play', '--variant']), /argument missing/);
});

test('the human seat picks the side a person controls', () => {
  assert.equal(seatsFrom({ human: 'attacker' }).seats[SIDE_ATTACKER], 'human');
  assert.equal(seatsFrom({ human: 'attacker' }).seats[SIDE_DEFENDER], 'ai');
  assert.equal(seatsFrom({ human: 'defender' }).seats[SIDE_DEFENDER], 'human');
  const both = seatsFrom({ human: 'both' }).seats;
  assert.equal(both[SIDE_ATTACKER], 'human');
  assert.equal(both[SIDE_DEFENDER], 'human');
  const none = seatsFrom({ human: 'none' }).seats;
  assert.equal(none[SIDE_ATTACKER], 'ai');
  assert.equal(none[SIDE_DEFENDER], 'ai');
  assert.equal(seatsFrom({}).seats[SIDE_DEFENDER], 'human', 'the default is the defender');
  assert.throws(() => seatsFrom({ human: 'knight' }), /--human/);
});

test('the two sides can think at different strengths', () => {
  const { levels } = seatsFrom({ level: 'easy', 'level-d': 'grandmaster' });
  assert.equal(levels[SIDE_ATTACKER], 'easy');
  assert.equal(levels[SIDE_DEFENDER], 'grandmaster');
  assert.equal(seatsFrom({ level: 'hard' }).levels[SIDE_DEFENDER], 'hard');
});

test('the help text lists every command and flag players need', () => {
  const text = usage();
  for (const command of COMMANDS) assert.ok(text.includes(command), `help mentions ${command}`);
  for (const flag of ['--variant', '--size', '--human', '--level', '--time', '--moves', '--load', '--record', '--seed', '--ascii', '--no-color', '--port', '--host', '--max-games', '--ttl']) {
    assert.ok(text.includes(flag), `help mentions ${flag}`);
  }
  for (const id of VARIANT_IDS) assert.ok(text.includes(id), `help mentions the ${id} variant`);
});

test('`variants` lists every historical variant with its army', () => {
  const { code, out } = run(['variants']);
  assert.equal(code, 0);
  for (const id of VARIANT_IDS) assert.ok(out.includes(id), `the list has ${id}`);
  assert.match(out, /9x9/);
  assert.match(out, /19x19/, 'the biggest tafl is in the list');
  assert.match(out, /Alea evangelii/);
  assert.match(out, /king\+\s*\d+ vs\s+\d+/);
  assert.match(out, /escapes to (edge|corner)/);
});

test('`rules alea` explains the marked squares of the gospel game', () => {
  const { code, out } = run(['rules', 'alea']);
  assert.equal(code, 0);
  assert.match(out, /Alea evangelii/);
  assert.match(out, /19x19/);
  assert.match(out, /16 marked squares/);
  assert.match(out, /4 on a castle/, 'the king needs four counts on the citadel');
});

test('`rules copenhagen` explains the special rules of that variant', () => {  const { code, out } = run(['rules', 'copenhagen']);
  assert.equal(code, 0);
  assert.match(out, /Copenhagen/);
  assert.match(out, /4 attackers/, 'the fetlar king needs a full net');
  assert.match(out, /seal/i);
  assert.match(out, /corner/i);
  assert.match(out, /cannot be captured on the edge/i);
});

test('`rules brandub` keeps only the rules that variant has', () => {
  const { code, out } = run(['rules', 'brandub']);
  assert.equal(code, 0);
  assert.match(out, /No special squares/, 'brandub has no castles');
  assert.doesNotMatch(out, /beside a castle/, 'so the castle capture rule is not printed');
  assert.match(out, /king \+ 4 defenders vs 8 attackers/);
});

test('`--version` and `help` answer and exit cleanly', () => {
  const version = run(['--version']);
  assert.equal(version.code, 0);
  assert.match(version.out, /^clitafl \d+\.\d+\.\d+/);

  const help = run(['help']);
  assert.equal(help.code, 0);
  assert.match(help.out, /Usage: clitafl/);

  const bad = run(['plau']);
  assert.equal(bad.code, 2, 'a typo costs an exit code 2');
  assert.match(bad.err, /Unknown command/);
});

test('a bad flag value is a one-line error, not a stack trace', () => {
  const cases = [
    ['rules', 'tablut', '--size', '12'],
    ['match', '--time', 'abc'],
    ['match', '--variant', 'tablu'],
    ['play', '--level', 'genius', '--moves', '/dev/null', '--no-color'],
    ['play', '--human', 'knight', '--moves', '/dev/null', '--no-color'],
  ];
  for (const args of cases) {
    const { code, err } = run(args);
    assert.equal(code, 2, `${args.join(' ')} exits 2`);
    assert.ok(err.length < 200, `${args.join(' ')}: short message, got ${err.length} bytes`);
    assert.doesNotMatch(err, /\n\s+at /, `${args.join(' ')}: no stack trace`);
  }
});

test('`match` plays a whole game and prints the record', () => {
  const { code, out } = run([
    'match', '--variant', 'brandub', '--level', 'easy',
    '--time', '15', '--seed', '3', '--max-plies', '40', '--no-color',
  ]);
  assert.equal(code, 0);
  assert.match(out, /^\s*1\. A [a-g][1-7]-[a-g][1-7]$/m, 'the record starts at ply 1');
  assert.match(out, /plies, \d+ captures\)/, 'and closes with a summary line');
  assert.match(out, /(DEFENDERS-WIN|ATTACKERS-WIN|DRAW)/);
});

test('`match --record` writes a save file that loads back', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clitafl-cli-'));
  const file = path.join(dir, 'game.json');
  try {
    const { code, out } = run([
      'match', '--variant', 'tablut', '--level', 'easy', '--time', '15',
      '--seed', '5', '--max-plies', '40', '--no-color', '--record', file,
    ]);
    assert.equal(code, 0);
    assert.match(out, /record written to/);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(data.variant, 'tablut');
    assert.ok(Array.isArray(data.history) && data.history.length > 0);
    assert.ok(['defenders-win', 'attackers-win', 'draw'].includes(data.result.status));
    assert.ok(data.board && data.board.rows.length === 9, 'the board travels with the record');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a scripted game plays out from a move file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clitafl-cli-'));
  const file = path.join(dir, 'moves.txt');
  try {
    fs.writeFileSync(file, [
      'a4-a3',
      'd3-d2',
      'a3-a4',
      'd2-d3',
      'a4-a3',
      'd3-d2',
      'board',
      'history',
      'quit',
    ].join('\n'));
    const { code, out } = run([
      'play', '--variant', 'brandub', '--human', 'both',
      '--max-plies', '6', '--no-color', '--no-animation', '--moves', file,
    ]);
    assert.equal(code, 0, `the scripted game finished cleanly: ${out}`);
    assert.match(out, /a4-a3/, 'the moves are reported');
    assert.match(out, /defenders 4/, 'the legend counts the army on the board');
    assert.match(out, /attackers 8/);
    assert.ok(out.includes('7x7') || out.includes('Brandub'), 'the board is drawn with its variant');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a session started from a save file resumes where it stopped', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clitafl-cli-'));
  const file = path.join(dir, 'saved.json');
  const moves = path.join(dir, 'moves.txt');
  try {
    const game = Game.create('brandub');
    game.play('a4-a3');
    game.play('d3-d2');
    const save = game.serialize();
    fs.writeFileSync(file, `${JSON.stringify(save)}\n`);
    fs.writeFileSync(moves, 'a3-a4\nd2-d3\nquit\n');
    const { code, out } = run([
      'play', '--load', file, '--human', 'both', '--max-plies', '4',
      '--no-color', '--no-animation', '--moves', moves,
    ]);
    assert.equal(code, 0, `the loaded game ran: ${out}`);
    assert.match(out, /Brandub/i, 'it knows the variant it loaded');
    assert.match(out, /a3-a4/, 'and it plays on from the saved position');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Bind a port in a child process, hand it to `fn` along with the way to free
 * it again, so the CLI can be told to take a port that is in use.
 */
function withReservedPort(fn) {
  const probe = [
    'const s = require(\'node:http\').createServer();',
    's.listen(0, \'127.0.0.1\', () => process.stdout.write(s.address().port + String.fromCharCode(10)));',
  ].join(' ');
  const child = spawn(process.execPath, ['-e', probe], { cwd: ROOT, encoding: 'utf8' });

  const started = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('the port probe never answered'));
    }, 8000);
    child.stdout.once('data', (chunk) => {
      clearTimeout(timer);
      resolve(Number(String(chunk).trim()));
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  return started
    .then((port) => fn(port))
    .finally(() => child.kill('SIGKILL'));
}

test('the server command checks its flags before it binds a port', () => {
  const port = run(['serve', '--port', 'castle']);
  assert.equal(port.code, 2);
  assert.match(port.err, /--port expects a number/);

  const outOfRange = run(['serve', '--port', '99999']);
  assert.equal(outOfRange.code, 2);
  assert.match(outOfRange.err, /TCP port 0-65535/);

  const ttl = run(['serve', '--ttl', 'never']);
  assert.equal(ttl.code, 2);
  assert.match(ttl.err, /--ttl expects a number/);

  const watchers = run(['serve', '--max-watchers', 'zero']);
  assert.equal(watchers.code, 2);
  assert.match(watchers.err, /--max-watchers expects a number/);

  // A port somebody else holds: the answer is one line, with no stack trace.
  return withReservedPort((taken) => {
    const out = run(['serve', '--port', String(taken)]);
    assert.equal(out.code, 2);
    assert.match(out.err, /EADDRINUSE/, 'a port in use is a message, not a stack trace');
    assert.ok(!out.err.includes('    at '), out.err);
  });
});

