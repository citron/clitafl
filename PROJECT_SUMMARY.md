# Project summary

## What it is

`clitafl` is a Tafl game: six historical Viking/Celtic board games — from 7×7 brandub to
the 19×19 alea evangelii — driven by one rules engine, a search AI, an animated terminal
renderer, a web board and an HTTP API an agent can drive. JavaScript on Node.js 20+,
CommonJS, **no runtime dependencies**, no build step.

```
128 tests · 20 source files + 3 web files · ~3 900 lines of engine, AI, UI, CLI and server
(~7 400 with the tests)
```

## Why version 2 exists

The first version was reviewed and found to be unplayable outside its own test bench:
it needed three npm packages that were never installed on the target machine, its test
runner was a hand-written script, the AI was a one-ply greedy stub, the rules were
hardcoded to one 11×11 position, and the docs described features that did not exist
(emoji pieces, a menu, "minimax-like" search, 15 tests).

Everything on that list is fixed:

| problem | now |
| --- | --- |
| `chalk`, `commander`, `readline-sync` required, `npm install` fails offline | zero dependencies: own ANSI writer, `node:util.parseArgs`, `node:readline/promises` |
| tests needed jest (`npm test` broken) | one runner: `node --test`, no download |
| the AI scored moves 1 ply deep and called it minimax | negamax + alpha-beta + iterative deepening + time budget, real mate lines, four documented levels |
| one fixed 11×11 position, defenders moving first | sourced variants in a declarative rule table, symmetric setup generator, `--size` for odd boards 7–19, attackers open every game |
| rules hardcoded (corner escape, 4-attacker king, edge as captor) | castle layouts, empty-castle captors, per-variant king-capture counts, edge shield, siege win, no-move and repetition rules, ply limit |
| captures were applied on cloned boards | apply/undo in place, exact inverses, covered by tests |
| docs and README claimed features that were not there | README, QUICKSTART, FILES and this file describe the shipped code, and the CLI is covered by tests that run it |
| the renderer wrote to a shared board while animating | animation draws on a copy; a test asserts the game board is untouched |
| legend showed piece counts that were always 0 | legend counts the pieces on the board |
| `moves` listed squares without destinations | `moves` lists `d5->d6, d5->d7` per piece |
| `board` was not a command, so it was parsed as a move | `board`, `history` are commands, listed in `help` |
| the file letters of the header/footer were a column off the grid | rank labels and the letter frame share one gutter, and a test checks the alignment on 7, 9, 11, 13, 15 and 19 |
| nothing was under version control, no licence | `git` history started, ISC `LICENSE`, `.gitignore` no longer hides `package-lock.json` |

## Why version 2.1 exists

The game was complete in a terminal, and nowhere else. The goal was to make it the
ultimate tafl: play it in a browser, and let anything — a script, a bot, an AI agent — play
it over a socket, without adding a dependency.

| need | now |
| --- | --- |
| no way to play outside a terminal | `clitafl serve` opens a board page on one port: click-to-move, six variants, sizes 7–19, seat and strength pickers, hint, undo, resign, save |
| no way for a program to play | a JSON API: `GET /api` describes every endpoint, 17 routes cover open/read/move/hint/undo/resign/seats/record/rules/save/close |
| an agent must guess the protocol | seats are `human`, `ai`, `agent`; `legal_moves` is the list for the side to move; a move reply carries the whole exchange, AI answer included; `400`/`404`/`405`/`409` are one readable sentence |
| a web stack usually means a framework | the client is `web/index.html` + `style.css` + `app.js`, the server is `node:http` reading its own directory: nothing to install, nothing to build |
| the server must not be a way to fill the disk | games live in memory with a slot cap (`--max-games`) and a TTL (`--ttl` minutes), the body is capped at 1 MiB, the thinking clock at 30 s, and the file server cannot leave `web/` |

## Why version 2.2 exists

Two things were still missing to call it the ultimate tafl: the biggest historical game,
and a search that could see through a capture.

| need | now |
| --- | --- |
| the 19×19 alea evangelii was not in the game | the sixth variant, from the twelve rules copied next to the diagram in Cambridge, CCC MS 122: king + 24 dukes vs 48 counts, a central citadel nobody may land on, 16 marked corner squares as the only exits, the king captured by 4 men on the citadel, 3 beside a castle, 2 in the open field, marked squares and the edge capturing for both sides, 600-ply limit |
| the king standing on an exit could be taken on the square he escaped to | `applyMove` reports the escape before captures are resolved, and a king on an escape square is not capturable; a test plays that exact position |
| the search stopped at the depth edge, so a snapshot evaluation counted a piece that was about to be taken | a capture-only quiescence search (depth 4, 12 moves wide) follows every move that takes a piece |
| the same position was re-searched from scratch | a Zobrist key updated in place across a move with its captures, and a per-player transposition table with ply-relative mate scores |
| the strong levels opened randomly | a seeded opening book (`src/ai/book.json`, 411 positions, 10 plies, `node tools/make-book.js`), each suggestion checked against the legal moves |
| "reproducible" depended on how fast the machine was | a node budget (`maxNodes`): the search stops on a count and never reads the clock, so a seeded `match` replays ply for ply |
| search nodes allocated move lists | killer moves per ply, capture counts predicted from the same `DIR_PAIRS` the board uses, and a test that compares the prediction with the board for every legal move of every variant |

## Design decisions

- **Data, not code, for the rules.** A variant is a row in `src/rules/variants.js`:
  escape target (`edge`, `corner`, `cornerblock`), castle layout, who may land on a castle,
  capture counts, first mover, edge shield, edge capture, siege, no-move, repetition, ply
  limit. Adding a game means adding a row, and the engine, renderer, rules text, API and
  tests pick it up.
- **The engine knows no terminal.** `src/rules/*` has no colours, no prompts, no `console`.
  That is what makes headless play, tests and the CLI thin.
- **One semantics for every front end.** The CLI, the web page and the API all call the
  same `Game`, `AIPlayer` and `formatSan`. `Game.declareNoMove(side)` and `Game.resign(side)`
  exist so neither the controller nor the store invents a rule; the API has no private
  notion of a move.
- **No per-node allocation in the search.** Moves are applied and un-applied on the live
  board, the Zobrist key is updated in place, and the transposition table is reused between
  moves, so the budget buys depth instead of garbage.
- **Deterministic where it matters.** A seed drives the AI and a node budget bounds the
  search, so `match --seed 3` reproduces a game — used by the tests, by records, and by the
  book generator.
- **A seat is a seat.** `human` and `agent` (and `client`) both mean "the caller plays
  this"; `ai` means "the server search plays it". So a browser can hand a seat to a script
  mid-game (`POST /seats`) without a second kind of game state.
- **The API is self-documenting.** `GET /api` returns the endpoint list, the seat kinds and
  the notes a client needs. A manual that ships as data cannot go out of date.
- **A suggestion is not a rule.** A book move is checked against the legal moves, a missing
  book is not an error, and the client renders exactly what the API sends.
- **Claims are checked by tests.** The historical armies, the king-capture counts, the
  siege rule, the escape-before-capture order, the CLI surface, every endpoint and every
  error path each have a test, so the README cannot drift.

## Historical accuracy

Rule sets follow the documented sources: Linnaeus' 1732 tablut (throne off limits to all
pieces, an empty castle acts as a captor, the king needs four attackers on the throne and
three beside it, edge escape, repetition and no-move are draws), the Fetlar/Copenhagen
rules (corner escape, throne and corners are castles, four attackers in the open field,
the king is safe on the edge, sealing the host wins, no-move loses), and the Irish/Welsh
reconstructions for brandub, ard-ri and tawlbwrdd. The alea evangelii follows the twelve
rules next to the diagram in Cambridge, CCC MS 122 (c. 1140) as edited by D. Walker, with
the army divided as H. J. R. Murray (1955) read the diagram. Sources: tafl.cyningstan.com,
aagenielsen.dk, Wikipedia's tafl article. Brandub's, Ard Rí's and alea evangelii's starting
positions are documented reconstructions — the manuscript draws every piece but four in one
colour — and the variant file says so.

The alea evangelii is played as the sources describe it, and it is imbalanced: self-play at
120 ms a move sees the attackers take the king in most games (3 of the 4 seeds tested). The
manuscript's own marginal note complains about the same thing.

## Layout

```
src/rules/     pieces · variants · board · game · notation
src/ai/        evaluate · zobrist · search · book (+ book.json) · player
src/ui/        ansi · display
src/cli/       controller
src/net/       errors · state · store · api · server
src/           headless.js · index.js
tools/         make-book.js
web/           index.html · style.css · app.js
tests/         board · game · notation · ai · display · headless · cli · net · server (+ helpers)
```

## Status

- Rules: complete for the six variants, 7×7 to 19×19, including the special ones (siege,
  castle captors, king-only exits, the citadel nobody may land on, edge shield, edge
  capture, per-square king capture counts).
- AI: negamax with a transposition table, killer moves, quiescence on captures, an opening
  book for the strong levels, four levels, seeded, and a node budget for reproducible
  matches; plays out every variant headlessly.
- CLI: `play`, `demo`, `match`, `serve`, `variants`, `rules`, `help`; flags for seats,
  strength, budget, size, seeds, scripts, saves, records, host, port, game slots, TTL,
  plain-ASCII and colour-off.
- Web: a board page served by the same process — click-to-move, seat pickers, record,
  hint, AI moves, undo, resign, save, an agent panel with the `curl` of the current game.
- API: 17 JSON endpoints, self-describing, CORS open, a session store with slots and TTL,
  save-file round-trips, one message per error.
- Tests: 128, all green, `npm test`, no dependencies.
- Docs: README, QUICKSTART, FILES, this summary, ISC licence.

## Roadmap

- Push for the web client (Server-Sent Events) so a game does not need a request per ply.
- Sessions kept on disk (`--state-dir`) so a server can restart without losing a game.
- Pairing and lobby endpoints (two agents meeting on one server), with a token per seat.
- Per-move limits for the search, so a `grandmaster` reply has a predictable ceiling.
- `ard-ri` has 7×7 armies, and 7×7 boards only carry 8 attackers in the symmetric
  generator: its setup stays a documented reconstruction.
