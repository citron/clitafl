# Clitafl — the Tafl game of the Vikings

A terminal implementation of the tafl family: five historical Viking/Celtic board games
with one rules engine, a real game-tree AI, animations, saves, records and headless matches.

Plain Node.js, **zero runtime dependencies** — no `npm install` step, nothing to break.

```bash
node src/index.js          # play tablut against the AI
node src/index.js variants # see the five armies
```

## Requirements

Node.js 20 or newer (tested on Node 24). That is all: the CLI uses only `node:util`,
`node:readline/promises` and its own ANSI writer.

## Install

```bash
git clone <your fork> && cd clitafl
npm test        # 82 tests, node's built-in runner, no download needed
```

`npm install` is not required to play. `npm link` gives you `clitafl` and `tafl` commands.

## The five variants

| id | board | army | the king escapes to |
| --- | --- | --- | --- |
| `tablut` | 9×9 | king + 8 vs 16 | any edge square |
| `copenhagen` | 11×11 | king + 12 vs 24 | a corner |
| `brandub` | 7×7 | king + 4 vs 8 | a corner |
| `ard-ri` | 7×7 | king + 8 vs 16 | any edge square |
| `tawlbwrdd` | 11×11 | king + 12 vs 24 | any edge square |

Every variant carries its own rule set in `src/rules/variants.js`: castle geometry
(throne, corners, corners+edges), whether an empty castle captures, how many attackers
are needed around the king in the open field / beside a castle / on a castle, whether the
edge shields the king, the siege win, the no-legal-move rule and the repetition rule.
The attackers always open. `--size` (odd, 7–15) rebuilds a symmetric position for any
variant, so you are not limited to the historical boards.

## Commands

```bash
node src/index.js play --variant copenhagen --human defender --level hard
node src/index.js demo --variant brandub                 # animated AI vs AI
node src/index.js match --variant tablut --seed 3 --time 40 --record game.json
node src/index.js variants
node src/index.js rules ard-ri
node src/index.js help
```

Useful flags: `--size 11`, `--human attacker|defender|both|none`, `--level easy|medium|hard|grandmaster`,
`--level-a` / `--level-d` per side, `--time <ms>` thinking budget, `--moves <file>` for a
scripted game, `--load <file>` to resume, `--record <file>` to write the record,
`--seed <n>` for reproducible matches, `--max-plies <n>`, `--fps <ms>`,
`--ascii`, `--no-color` (also honours `NO_COLOR`), `--no-animation`.

## Playing

Pieces move like a rook, any distance, never jumping. A soldier is captured when two
enemies sit on opposite sides of it. The king is captured under the rules of the variant
(see `rules`). The defenders win when the king reaches an escape square, the attackers
when they take the king — and in the fetlar family, when they seal the king and his whole
host in a region with no escape square.

Type moves as `d5-d6`. Also accepted: `d5 d6`, `d5d6`, `d5>d6`, upper case.
Files are letters `a…`, ranks are numbers counted from the top left.

In-game commands: `help`, `board`, `moves`, `history`, `hint`, `undo [n]`, `rules`,
`save <file>`, `resign`, `quit`.

```
Tablut  9x9  king escapes to the edge
turn defenders   ply 8   no-move rule: draw

     a b c d e f g h i
  1 ✦ · · · ○ · · · ✦
  2 · · · ○ · ○ · · ·
  3 · · · · ○ · ○ · ·
  4 · ○ · ● ● ● · ○ ·
  5 · · ○ ● ★ · ○ · ·
  6 · ○ · ● · ○ · · ·
  7 · · ○ · ● · ○ · ·
  8 · · · ○ · ○ · · ·
  9 ✦ · · · ○ · · · ✦
     a b c d e f g h i

★ king   ● defenders 6   ○ attackers 16   ✦ castle

last move: e6-e7
```

## AI

Negamax with alpha-beta pruning, iterative deepening, move ordering and a wall-clock
budget. Captures are applied and undone in place on the live board, so a search node
allocates nothing. Four strength presets set the depth ceiling, the budget and how much
play is allowed to wander:

| level | depth | budget | play |
| --- | --- | --- | --- |
| `easy` | 2 | 120 ms | picks among the top 8 moves |
| `medium` | 6 | 700 ms | top 2 moves |
| `hard` | 12 | 2.5 s | best move |
| `grandmaster` | 30 | 8 s | best move |

The evaluation is tafl-specific: material, king mobility, the distance of the king to its
escape squares, open lines to the escape, freedom of both armies and the pressure the
attackers build around the king. A seeded AI replays the same game, which is what makes
`match` reproducible.

## Headless

`src/headless.js` plays a whole game with no terminal, and is what `demo`, `match` and the
test suite use:

```js
const { playMatch } = require('./src/headless');
const { Game } = require('./src/rules/game');

const match = playMatch({ game: Game.create('copenhagen'), level: 'hard', seed: 7 });
console.log(match.status, match.reason, match.plies);
console.log(match.history.map((h) => h.san).join(' '));
```

Every variant plays out to a result at the low budgets used by the tests, and the same
seed gives the same game.

## Layout

```
src/rules/pieces.js     piece and side codes, the vocabulary of the engine
src/rules/variants.js   the declarative rule sets + the symmetric setup generator
src/rules/board.js      geometry, movement, castles, custodian capture, siege flood fill
src/rules/game.js       turns, victory/draw detection, undo, repetition, save/load
src/rules/notation.js   d5-d6 parsing and formatting
src/ai/evaluate.js      static evaluation
src/ai/search.js        negamax + alpha-beta + iterative deepening
src/ai/player.js        strength presets
src/ui/ansi.js          ANSI/terminal control, NO_COLOR, alt screen
src/ui/display.js       board, legend, banner, rules text, move animation
src/cli/controller.js   one session: seats, turn loop, in-game commands, cleanup
src/headless.js         AI vs AI without a terminal
src/index.js            command line
tests/                  node:test suites: rules, board, notation, AI, display, headless, CLI
```

## Tests

```bash
npm test
```

82 tests on `node:test` — no framework to install. They cover the historical armies and
castle rules of each variant, movement, capture counts (open field, beside and on a
castle, edge), siege sealing, apply/undo symmetry, save round-trips, repetition and
ply-limit draws, the search (mate in one, escapes, time budget, depth monotonicity,
legality in every variant), the renderer (glyphs, colour off, legend counts, animation
never touching the real board) and the CLI itself (flags, exit codes, records, scripted
games).

## Rules sources

The rule sets follow the documented historical games: Linnaeus' 1732 account of tablut,
the Fetlar/Copenhagen rules (aagenielsen.dk) for the 11×11 corner-escape family, and the
Irish/Welsh reconstructions collected at tafl.cyningstan.com and Wikipedia's tafl article.
Where the sources disagree (the tablut king capture count, the brandub setup) the variant
file says which reading it implements. Brandub's and Ard Rí's starting positions are
reconstructions, not originals.

## Roadmap

- Alea evangelii (19×19) — needs a bigger search budget before it is fun.
- Opening book and transposition table for `grandmaster`.
- Online / two-machine play.

## License

ISC — see `LICENSE`.
