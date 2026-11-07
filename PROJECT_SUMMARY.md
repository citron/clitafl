# Project summary

## What it is

`clitafl` is a Tafl game: six historical Viking/Celtic board games — from 7×7 brandub to
the 19×19 alea evangelii — driven by one rules engine, a search AI, an animated terminal
renderer, a web board and an HTTP API an agent can drive. JavaScript on Node.js 20+,
CommonJS, **no runtime dependencies**, no build step.

```
143 tests · 21 source files + 3 web files · ~5 200 lines of engine, AI, UI, CLI and server
(~8 000 with the tests)
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
| no way for a program to play | a JSON API: `GET /api` describes every endpoint, 21 routes cover open/read/move/hint/undo/resign/seats/record/rules/save/watch/close |
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

## Why version 2.3 exists

The board in a browser was a page that had to ask for everything, and an agent driving the
same game had no way to notice a move it did not make.

| need | now |
| --- | --- |
| a web board that needed a request per ply | `GET /api/games/:id/events` is a Server-Sent Events stream: a `state` frame to start, a `ply` per move, a `state` after it, `closed` when the game goes |
| a client polling the state to see what happened | the store keeps watchers per game and announces every change once — the CLI, the page and the API still share one semantics; a hint, a refused move and a bad request push nothing |
| an open connection being free forever | one `EventSource` on the game the page shows, `maxWatchers` per game (a fourth connection is a plain `409`, asked before the headers go out), a `:ping` comment every 15 s, and the watcher unsubscribed when the client hangs up |
| a stream the API cannot describe | the route is in the endpoint index, in the API notes, in the `serve` banner, in `GET /api/health` (`max_watchers`), and in `--max-watchers` |
| framing leaking into the store | the sink is `(event, payload)`; the SSE framing (`sseFrame`, `openEventStream`) belongs to the HTTP layer, which owns the response |

## Why version 2.4 exists

A server that restarted forgot every game it had. A long tafl game is exactly the thing you
do not want to lose to an upgrade, and an agent that keeps a game open over days should not
have to keep the process alive.

| need | now |
| --- | --- |
| a restart losing every open game | `serve --state-dir <dir>` keeps one save file per game in that directory, and a server starting on a directory it used before plays those games on — seats, levels, clocks, seed and record included |
| a game written only when someone asks for it | a change marks a game (`markDirty`) and the next touch writes it, so the file is as far on as the state; `DELETE` and the TTL sweep take the file with the game |
| a file that is a server format, not a game format | the file **is** the `clitafl-save-v1` save, with the session in one extra key: it loads through `--load` and `POST /api/games {"load": …}` unchanged |
| a crash leaving half a file | write to a temp file in the directory, then rename, so the old file is intact until the new one is complete |
| a directory with a broken file, or more games than slots | a file that cannot be read is left where it is, the newest games are loaded first up to the slots, a game older than the TTL is pruned where it lies, a file that is not a game (`notes.txt`) is not touched |
| a directory nobody can find | `GET /api/health` answers `state_dir`, the `serve` banner prints it, and it is in the API notes |

## Why version 2.5 exists

Two agents could each be given a seat, but the server had nothing to advertise a game with,
and a seat the caller held was held by anybody who asked for it. Pairing needs a board to
post the game on, and a way to prove a seat.

| need | now |
| --- | --- |
| a game nobody can find | a seat kind `open`: a game opened with `{"seats":{"defender":"open"}}` is on `GET /api/lobby` with its variant, size, turn and the seat that is going, and `GET /api/lobby/:id` is one card of it |
| two agents meeting with no referee between them | `POST /api/lobby/:id/join {"seat","name"}` takes the seat, labels it, and hands out the token that plays it; one seat one owner, and a second join is a `409` that names the holder |
| a seat anybody could play | a seat with a token is played by that token alone: `x-clitafl-token` on the request, `401` without it, `409` while the seat is still open |
| one player undoing the other's game | `undo` and `seats` ask for the token of any seat in the game, because they act on a game somebody owns; a `hint` stays open — the board is public information and advice is not a move |
| a token leaking out of the API | it is shown once, in the join reply, never in a state view, and a seat handed to the AI, or back to an anonymous caller, gives it up |
| a restart forgetting who was in the game | the save file keeps the token, the name and the open flags, so the second server guards the seats exactly as the first one did |

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
- **Push is one call in one place.** The store announces a change, the HTTP layer frames it.
  `announce()` is the only place a `ply` and a `state` are emitted, so a move played by the
  CLI, the page or an agent looks the same from every side, and a stream that is not wanted
  costs a `Set` lookup.
- **The save file is the storage format.** The state directory holds `clitafl-save-v1` files
  with a `session` key around them, not a server-only record: the same file goes out through
  `/export`, back in through `{"load": …}`, and to `--load`. Nothing is written in a format
  only the server can read.
- **The lobby is the only place a token is minted.** `{"seats":{"defender":"agent"}}` stays
  the plain caller seat it always was — the documented one-`curl`-per-move flow needs no
  credential — and only a join makes a seat private. One way in, one way to prove you are in,
  and the seat that is open to the lobby is open to everybody who can reach the port.
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
src/net/       errors · state · store · disk · api · server
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
  strength, budget, size, seeds, scripts, saves, records, host, port, game slots, watchers
  per game, state directory, TTL, plain-ASCII and colour-off.
- Web: a board page served by the same process — click-to-move, seat pickers, record,
  hint, AI moves, undo, resign, save, an agent panel with the `curl` of the current game,
  and a stream it watches so a move played elsewhere lands on the board by itself.
- API: 21 JSON endpoints, self-describing, CORS open, a session store with slots, TTL,
  watchers and an optional state directory, a lobby where an open seat goes to the first
  client that takes it — with the token that plays it —, a Server-Sent Events stream per
  game, save-file round-trips, one message per error.
- Tests: 143, all green, `npm test`, no dependencies.
- Docs: README, QUICKSTART, FILES, this summary, ISC licence.

## Roadmap

- Per-move limits for the search, so a `grandmaster` reply has a predictable ceiling.
- `ard-ri` has 7×7 armies, and 7×7 boards only carry 8 attackers in the symmetric
  generator: its setup stays a documented reconstruction.
