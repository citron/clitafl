#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');

const { Game } = require('./rules/game');
const { VARIANTS, VARIANT_IDS, describeVariants, getVariant } = require('./rules/variants');
const { SIDE_ATTACKER, SIDE_DEFENDER } = require('./rules/pieces');
const { GameController } = require('./cli/controller');
const { Display } = require('./ui/display');
const { Ansi } = require('./ui/ansi');
const { LEVEL_IDS, levelOf } = require('./ai/player');
const { playMatch } = require('./headless');

const COMMANDS = ['play', 'demo', 'match', 'serve', 'variants', 'rules', 'help'];

const OPTIONS = {
  variant: { type: 'string', short: 'v' },
  size: { type: 'string' },
  human: { type: 'string' },
  level: { type: 'string' },
  'level-a': { type: 'string' },
  'level-d': { type: 'string' },
  time: { type: 'string' },
  moves: { type: 'string' },
  record: { type: 'string' },
  load: { type: 'string' },
  seed: { type: 'string' },
  'max-plies': { type: 'string' },
  fps: { type: 'string' },
  port: { type: 'string' },
  host: { type: 'string' },
  'max-games': { type: 'string' },
  ttl: { type: 'string' },
  'no-color': { type: 'boolean' },
  color: { type: 'boolean' },
  ascii: { type: 'boolean' },
  'no-animation': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean' },
};

function usage() {
  return `CLITAFL - the Tafl game of the Vikings

Usage: clitafl [command] [options]

Commands
  play         play a game (default)
  demo         watch the AI play itself, move by move
  match        play a whole AI vs AI game headless and print the record
  serve        start the web board and the HTTP API
  variants     list the historical variants
  rules [name] show the rules (of one variant)
  help         this text

Options
  -v, --variant <name>      ${VARIANT_IDS.join(' | ')} (default tablut)
      --size <n>            override the board size (odd, 7-15)
      --human <side>        which side a human plays: attacker | defender | both | none
      --level <name>        AI strength: ${LEVEL_IDS.join(' | ')}
      --level-a / --level-d strength per side (attacker / defender)
      --time <ms>           thinking budget per AI move
      --moves <file>        read moves/commands from a file (scripted game)
      --load <file>         resume a saved game
      --record <file>       write the game record as JSON
      --seed <n>            deterministic AI for matches
      --max-plies <n>       stop a match after n plies
      --fps <ms>            animation frame delay
      --port <n>            serve: TCP port (default 8080)
      --host <addr>         serve: interface to bind (default 127.0.0.1)
      --max-games <n>       serve: games kept open at once (default 50)
      --ttl <minutes>       serve: forget a game untouched for that long (default 180)
      --ascii               plain ASCII glyphs, no unicode
      --no-color            disable ANSI colour (also honours NO_COLOR)
      --no-animation        do not animate moves
      --version             print the version
`;
}

function parseCli(argv) {
  const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  const command = positionals[0] || 'play';
  if (positionals.length && !COMMANDS.includes(command)) {
    throw new Error(`Unknown command '${command}'. Try: ${COMMANDS.join(', ')}`);
  }
  return { command, args: values, positionals };
}

function readVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  return pkg.version;
}

function seatsFrom(values) {
  const human = (values.human || 'defender').toLowerCase();
  const seats = { [SIDE_ATTACKER]: 'ai', [SIDE_DEFENDER]: 'ai' };
  if (human === 'both') {
    seats[SIDE_ATTACKER] = 'human';
    seats[SIDE_DEFENDER] = 'human';
  } else if (human === 'attacker') {
    seats[SIDE_ATTACKER] = 'human';
  } else if (human === 'defender') {
    seats[SIDE_DEFENDER] = 'human';
  } else if (human !== 'none') {
    throw new Error(`--human expects attacker | defender | both | none, got '${values.human}'`);
  }
  const level = values.level || 'medium';
  const levels = {
    [SIDE_ATTACKER]: values['level-a'] || level,
    [SIDE_DEFENDER]: values['level-d'] || level,
  };
  levelOf(levels[SIDE_ATTACKER]);
  levelOf(levels[SIDE_DEFENDER]);
  return { seats, levels };
}

/** Numbers the player typed: a bad one is a message, not a stack trace. */
function num(value, name) {
  const n = Number(value);
  if (value === '' || !Number.isFinite(n)) throw new Error(`--${name} expects a number, got '${value}'`);
  return n;
}

function numbersFrom(values) {
  return {
    size: values.size ? num(values.size, 'size') : null,
    timeMs: values.time ? num(values.time, 'time') : null,
    seed: values.seed ? num(values.seed, 'seed') : null,
    fps: values.fps ? num(values.fps, 'fps') : null,
    maxPlies: values['max-plies'] ? num(values['max-plies'], 'max-plies') : null,
  };
}

function buildController(values) {
  const { seats, levels } = seatsFrom(values);
  const numbers = numbersFrom(values);
  const ansi = new Ansi({ color: values.color ?? (values['no-color'] ? false : undefined) });
  const display = new Display({
    ansi,
    ascii: Boolean(values.ascii),
    animate: !values['no-animation'],
    frameMs: numbers.fps ?? undefined,
  });
  let game;
  if (values.load) {
    const data = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), values.load), 'utf8'));
    game = Game.deserialize(data);
  } else {
    game = Game.create(values.variant || 'tablut', numbers.size);
  }
  if (numbers.maxPlies) game.variant = { ...game.variant, maxPlies: numbers.maxPlies };
  return new GameController({
    game,
    display,
    seats,
    levels,
    timeMs: numbers.timeMs,
    moves: values.moves,
    record: values.record,
  });
}

function portNumber(value) {
  const n = num(value, 'port');
  if (!Number.isInteger(n) || n < 0 || n > 65535) throw new Error(`--port expects a TCP port 0-65535, got '${value}'`);
  return n;
}

/** What a terminal - and an AI agent - needs to know when the server is up. */
function serverBanner(started) {
  const { url, store, root } = started;
  const ttlMinutes = Math.round(store.ttlMs / 60000);
  return [
    'clitafl is serving',
    '',
    `  board      ${url}/            the web client, click to move`,
    `  api        ${url}/api         the endpoints, described as JSON`,
    `  api index  ${url}/api/health  health, open games, what the engine is`,
    '',
    `  open games ${store.maxGames} at a time, forgotten after ${ttlMinutes} minutes without a request`,
    `  client     ${root}`,
    '',
    '  open a game, play the defenders, and the AI answers in the same reply:',
    '',
    `    curl -s ${url}/api/games -X POST -H 'content-type: application/json' \\`,
    `      -d '{"variant":"tablut","seats":{"attacker":"ai","defender":"agent"},"levels":"hard"}'`,
    '',
    `    curl -s ${url}/api/games/<id> -X POST -H 'content-type: application/json' \\`,
    `      -d '{"from":"d5","to":"d4"}'`,
  ].join('\n');
}

async function runServer(args) {
  const { serve } = require('./net/server');
  const started = await serve({
    host: args.host || '127.0.0.1',
    port: args.port === undefined ? 8080 : portNumber(args.port),
    maxGames: args['max-games'] ? num(args['max-games'], 'max-games') : undefined,
    ttlMs: args.ttl ? Math.round(num(args.ttl, 'ttl') * 60000) : undefined,
    timeMs: args.time ? num(args.time, 'time') : undefined,
    version: readVersion(),
  });
  process.stdout.write(`${serverBanner(started)}\n\npress ctrl-c to stop\n`);

  const stopped = new Promise((resolve) => {
    const stop = (signal) => {
      process.stdout.write(`\n${signal}: closing the server\n`);
      resolve();
    };
    process.once('SIGINT', () => stop('SIGINT'));
    process.once('SIGTERM', () => stop('SIGTERM'));
  });
  await stopped;

  if (typeof started.server.closeAllConnections === 'function') started.server.closeAllConnections();
  await new Promise((resolve) => started.server.close(resolve));
  return 0;
}

function listVariants() {
  const rows = describeVariants();
  const width = Math.max(...rows.map((row) => row.name.length));
  const lines = ['Historical variants', ''];
  for (const row of rows) {
    const army = `king+${row.defenders} vs ${row.attackers}`;
    lines.push(`  ${row.name.padEnd(width)}  ${String(row.size).padStart(2)}x${row.size}  `
      + `${army.padStart(15)}  escapes to ${row.escape}`);
  }
  lines.push('');
  lines.push('Play one: clitafl play --variant <id>   (ids: ' + rows.map((r) => r.id).join(', ') + ')');
  return lines.join('\n');
}

async function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseCli(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${usage()}`);
    return 2;
  }
  const { command, args } = parsed;
  try {
    return await runCommand(command, args, parsed.positionals);
  } catch (error) {
    // Anything that throws here is about the input the player gave: variant, size,
    // level, save file, record path. A stack trace is only useful while developing.
    process.stderr.write(`${process.env.CLITAFL_DEBUG ? (error.stack || error) : error.message}\n`);
    return 2;
  }
}

async function runCommand(command, args, positionals) {
  const ansi = new Ansi({ color: args['no-color'] ? false : undefined });
  const numbers = numbersFrom(args);

  if (args.version) {
    process.stdout.write(`clitafl ${readVersion()}\n`);
    return 0;
  }
  if (command === 'help' || args.help) {
    process.stdout.write(`${usage()}\nAI levels: ${LEVEL_IDS.join(', ')}\nVariants: ${VARIANT_IDS.join(', ')}\n`);
    return 0;
  }
  if (command === 'variants') {
    process.stdout.write(`${listVariants()}\n`);
    return 0;
  }
  if (command === 'rules') {
    const display = new Display({ ansi });
    const variant = getVariant(positionals[1] || args.variant || 'tablut', numbers.size);
    process.stdout.write(`${display.banner(variant)}\n\n${display.rulesText(variant)}\n`);
    return 0;
  }
  if (command === 'match') {
    const game = Game.create(args.variant || 'tablut', numbers.size);
    const match = playMatch({
      game,
      level: args.level || 'easy',
      attackerLevel: args['level-a'],
      defenderLevel: args['level-d'],
      timeMs: numbers.timeMs ?? 60,
      seed: numbers.seed ?? 1,
      maxPlies: numbers.maxPlies ?? 500,
    });
    const display = new Display({ ansi, animate: false });
    process.stdout.write(`${display.render(game)}\n\n`);
    process.stdout.write(`${match.history.map((entry) => `${String(entry.ply).padStart(3)}. `
      + `${entry.side === SIDE_ATTACKER ? 'A' : 'D'} ${entry.san}`
      + (entry.captured.length ? `  takes ${entry.captured.length}` : '')).join('\n')}\n\n`);
    process.stdout.write(`${match.status.toUpperCase()} - ${match.reason} (${match.plies} plies, `
      + `${match.captures} captures)\n`);
    if (args.record) {
      const target = path.resolve(process.cwd(), args.record);
      const record = {
        ...game.serialize(),
        result: { status: match.status, winner: match.winner, reason: match.reason },
        history: match.history,
      };
      fs.writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`);
      process.stdout.write(`record written to ${args.record}\n`);
    }
    return 0;
  }

  if (command === 'serve') return runServer(args);

  const controller = buildController(args);
  if (command === 'demo') {
    controller.seats = { [SIDE_ATTACKER]: 'ai', [SIDE_DEFENDER]: 'ai' };
    controller.levels = {
      [SIDE_ATTACKER]: args['level-a'] || args.level || 'easy',
      [SIDE_DEFENDER]: args['level-d'] || args.level || 'easy',
    };
  }
  await controller.start();
  return controller.game.isGameOver() ? 0 : 1;
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`\n${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main, parseCli, usage, seatsFrom, COMMANDS };
