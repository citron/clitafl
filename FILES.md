# Files

## `src/rules/` — the engine (no I/O, no colours)

- **pieces.js** — piece codes (`KING`, `DEFENDER`, `ATTACKER`, `EMPTY`) and side codes; the
  vocabulary every other module uses. ASCII codes only, never emoji.
- **variants.js** — the six rule sets as data, one entry per rule the sources state: escape
  target (`edge`, `corner`, the marked `cornerblock` of alea evangelii), castle layout,
  king-capture counts (open field / next to the throne / on the throne), who may land on a
  castle and the king's way back onto his own throne (`kingBackOnThrone`, copenhagen rules 1
  and 8), first mover, edge shield (`edgeShield` — copenhagen rule 5 says the edge is not
  hostile), the shield wall (`shieldWall`, rule 7), siege win, no-move and repetition rules,
  the move limit (`maxPlies`, and `moveLimitFor` where the rules state it per size) with
  what reaching it means (`overrun`), plus `buildSetup`/`armyOf`, the symmetric position
  generator that makes `--size` work.
- **board.js** — the grid, geometry (`rowOf`, `idx`), rook movement, castle and throne
  rules, king-only escape squares, custodian capture (soldiers, king counts, castle and
  edge shields) and the Copenhagen shield wall (`shieldWallCaptures`), the siege flood
  fill, `applyMove`/`undoMove` as exact inverses — the king's escape settles before a
  capture can — serialisation.
- **game.js** — the state machine: turns, `play`, victory and draw detection in a fixed
  order (king capture → escape → siege → no legal move → repetition → move limit, which is
  a win for the attackers where the rules say so), `undo`, `serialize`/`deserialize`.
- **notation.js** — `d5-d6` in and out, tolerant of the ways players type it.

## `src/ai/`

- **evaluate.js** — static evaluation from the defender's point of view: material, king
  mobility, escape distance (edges, corners, the marked 2×2 blocks), open lines to the
  escape, freedom of each army, space per man, pressure on the king.
- **zobrist.js** — the deterministic piece-square hash table (a seeded generator, so every
  run builds the same table), `hashBoard`, `applyKey` to update a key in place across a
  move with its captures, and `geometryId` for the opening book keys.
- **search.js** — negamax with alpha-beta, iterative deepening, a transposition table
  (ply-relative mate scores, replace-if-deeper), killer moves, a capture-only quiescence
  search, and a budget in milliseconds *or in nodes*: with `maxNodes` the clock is never
  read, so a search is reproducible. Only a complete deepening pass re-orders the root and
  becomes the answer. `winsImmediately` for king captures and escapes. The board is mutated
  and restored in place.
- **book.js** — the opening book (`clitafl-book-v1`, `book.json`): prepared positions keyed
  by rules, side to move and board, max three moves each, checked against the legal moves
  before one is played. A missing book is not an error — the level just searches.
- **player.js** — `AIPlayer` and the four strength presets (`easy`, `medium`, `hard`,
  `grandmaster`), each with a depth ceiling, a time budget, how far from the best move its
  play is allowed to wander, its own transposition table, `maxNodes`, and the book hook
  (`book: false` / `bookData` to say otherwise).

## `src/ui/`

- **ansi.js** — terminal control built from escape sequences: colour (off for `NO_COLOR`,
  `--no-color`, `TERM=dumb`, non-TTY), cursor, alt screen, clear, `sleep`.
- **display.js** — board rendering with a coordinate frame, unicode or `--ascii` glyphs,
  legend, status lines, banner, rules text, help text, the per-square move animation
  (drawn on a copy of the board).

## `src/cli/`

- **controller.js** — one session: seats (human or AI per side), the turn loop, the
  `--nodes` / `--depth` / `--time` ceilings a move is played under (named in the thinking
  line), in-game
  commands (`help`, `board`, `moves`, `history`, `hint`, `undo`, `rules`, `save`,
  `resign`, `quit`), scripted games from `--moves`, records from `--record`, signal
  handlers that always restore the terminal.

## `src/net/` — the web server and the API (no framework)

- **errors.js** — `ApiError` plus the status helpers (`400`, `401`, `404`, `405`
  with an `allow` list, `409`, `413`): a failure is one readable sentence, never a stack
  trace.
- **state.js** — the public JSON view of a session: `gameView` (turn, seats, levels,
  clocks, budget, counts, last move, record), `budgetView` (what the next AI move of each
  side may cost: clock, node ceiling, depth ceiling), `playersView` (who holds a seat: its
  kind, the name
  the lobby gave it, whether a token guards it, whether it is still open), `openSeatsView`,
  `boardView` (rows, castles, throne, escapes), `variantView`, `plyView`, `levelsView`, and
  `rulesText` — the CLI renderer with the colours off. A view never carries a token.
- **store.js** — the open games: ids, seats (`human | ai | agent | client | open`, the
  aliases folding onto the caller's seat), levels and the budget of an AI move — clock, node
  ceiling, depth ceiling, each per seat (`budgetsFrom` is the one place those keys are
  read, `hasBudgets` says whether a body said anything about them; the clock is capped at
  30 s, the nodes at 5 000 000, the depth at 40),
  `playAiPly`/`playAiSeats` — which take the per-call ceilings of a request —, touch/TTL sweep, `maxGames` cap, seed and ply-limit overrides,
  resume from a save file. Seats and tokens: `applySeats` hands a seat to the AI, the lobby
  or the caller (a seat the AI takes, or one handed back anonymously, gives its token up),
  `joinSeat` takes an open seat and mints the one token of this server, `requireSeat` says
  whether a request holds the seat (`409` open, `401` unguarded), `listOpen` is the lobby's
  list. It also carries the watchers: `subscribe(session, sink)` / `publish(session, event,
  payload)` with a `maxWatchers` cap, a sink that throws being dropped, and `announceClosed`
  before a game leaves the map. The sink is
  `(event, payload)`: the store knows nothing about HTTP, the framing is the server's.
  With `stateDir`, every game it changes is written out (`markDirty` marks, `touch`
  writes), and the directory is read back at startup: newest first, up to the slots, a
  game older than the TTL pruned where it lies, a file that is not a game left alone.
- **disk.js** — one directory of games: `save` writes a game atomically (a temp file in
  the directory, then a rename), `remove` takes the file with the game, `loadAll` reads
  every file back, most recent first, skipping what is not a game. The file is the
  `clitafl-save-v1` save plus a `session` key — seats, names, tokens, open seats, levels,
  clocks, ceilings, seed, dates — so the same file loads through `POST /api/games {"load": …}` and
  `--load` unchanged, and a restart guards the seats, and obeys the ceilings, as the first
  server did.
- **api.js** — the route table (21 endpoints) and the handlers. `GET /api` describes every
  endpoint as data, so a client can discover the game without reading a manual, with the
  seat kinds, the token header and the budget keys — which ceiling is the predictable one,
  and the caps. The lobby is
  here: `GET /api/lobby`, `GET /api/lobby/:id`, `POST /api/lobby/:id/join` — the join is the
  only reply that shows a token. The seat guards read the `x-clitafl-token` header: a move
  and a resignation for the seat it holds, `undo` and `seats` for the game it plays in, a
  `hint` for nobody in particular. `budgetOverrides` is what a `/ai` or a `/hint` call pays
  with — one deeper look, for one request — and `POST /seats` replaces the set it is handed.
  One `announce` helper is where a change is pushed — a
  `ply` event per move, then the `state` — and where a game is marked as worth writing to
  the state directory.
- **server.js** — `node:http`: `/api/*` to the API (with `req.headers`, which is how a seat
  token arrives), everything else as files from `web/` (resolve-then-check traversal guard),
  CORS (including the token header), `OPTIONS`, a 1 MiB body cap, HEAD, JSON
  errors, `serve` that reports the address it bound. It owns the one route that is not a
  JSON answer — `GET /api/games/<id>/events` — so `sseFrame` and `openEventStream` live
  here: the state at once, every announced change, a `:ping` comment every 15 s, and the
  watcher unsubscribed when the client goes.

## Top level

- **headless.js** — `playMatch` (AI vs AI, no terminal, seeded RNG, `maxNodes` / `maxDepth`
  budgets that make a match replay move for move), `formatMatch`, used by
  `demo`, `match` and the tests.
- **index.js** — the command line: `play`, `demo`, `match`, `serve`, `variants`, `rules`,
  `help`, the flag table (`--time`, `--nodes`, `--depth` for the budget of an AI move),
  exit codes 0/1/2.

## `tools/`

- **make-book.js** — `node tools/make-book.js [--games n] [--plies n] [--nodes n] [--out f]`
  regenerates `src/ai/book.json` from seeded self-play of the strong levels: fixed seeds and
  a node budget, so the same run records the same positions.

## `web/` — the browser client (no build step)

- **index.html** — board panel, setup card (variant, size, seat, level, thinking time,
  search ceiling),
  this-game card (id, who holds each seat, ply, legal moves, what the next AI move may
  cost, what the AI last did), the
  agent card with the `curl` commands of the current game — open, read, move, the lobby,
  the one that watches it — the rules, the list of open games.
- **style.css** — the theme: a wooden board, round pieces, castle/throne/escape marks,
  hint and last-move highlights, a responsive two-column layout.
- **squares.js** — the coordinates of the page, in one file: `squareOfIndex(size, r, c)` names
  the cell the browser clicked and `indexOfSquare(size, square, files)` finds the cell of a name
  the API sent, rank 1 being the top row — the way `src/rules/notation.js` reads a move and the
  terminal prints the board. It loads before `app.js`, and `tests/server.test.js` pins it to
  `formatSquare` square by square on every size, so the piece you click is the piece the server
  moves. A plain script tag makes it a global, `require` gives it to the tests.
- **app.js** — one `fetch` per action: it renders exactly what the API sends, clicks
  squares into moves from `legal_moves`, and never invents a rule of its own. It also
  opens an `EventSource` on the game it shows, so a move played from a terminal, a script
  or another tab lands on the board by itself, and says so when the game is closed. The
  move `curl` it prints carries `x-clitafl-token` when the game has a seat a token guards,
  the meta panel answers the budget of the next AI move (clock, node ceiling, depth
  ceiling), and the opening `curl` carries the search ceiling picked in the setup card.

## `tests/` — `node:test`, run with `npm test`

- **helpers.js** — builds a board from ASCII rows (`makeBoard`), plus `idx` and `move`.
- **board.test.js** — 29 tests: the historical armies, castle and escape geometry,
  movement, capture counts, edge rules, apply/undo, serialisation, the siege sealing, the
  alea evangelii geometry (its army and symmetry, the 16 exits with king-only entry, the
  citadel off limits to everyone and passable when empty, the 4/3/2 king capture, marked
  squares and the edge capturing soldiers, the escape settling before a capture), and the
  rule details the sources spell out: the copenhagen edge that does not capture (rule 5)
  against the tawlbwrdd edge that does, the king who returns to his copenhagen throne and
  never to the tablut one (copenhagen rules 1 and 8, tablut rule 5), the shield wall
  (copenhagen rule 7) taking a line of men at the edge and needing the line, the bracket and
  every man pressed from the inside, and the garrison count raised for the throne alone.
- **game.test.js** — 16 tests: first mover, escapes, king capture, illegal moves, the
  siege, no-legal-move rules, repetition, the move limit as a draw and as a copenhagen
  attackers win (rule 13), the limit following the size, undo, save round-trips.
- **notation.test.js** — 6 tests: squares, every spelling of a move, large boards, errors.
- **ai.test.js** — 16 tests: level presets, mate in one, taking the escape, legality in
  every variant, time budget, depth monotonicity, seeded reproducibility, the capture
  prediction matching the board for every legal move, quiescence following only the moves
  that take a piece, the Zobrist key tracking a 40-ply game, a node budget giving the same
  move and score with the table keeping what it learned, a depth ceiling answering its
  ceiling and costing what it asks for, and the opening book offering legal prepared
  openings.
- **display.test.js** — 13 tests: the board frame, file letters aligned on their column at
  every size, glyphs, `--ascii`, colour on/off, legend counts, status, outcome, banner,
  animation safety, the command list, and the rules text of tablut and of alea evangelii.
- **headless.test.js** — 9 tests: seeded RNG, full games per variant, record shape,
  determinism on a node budget, mixed strengths, a depth ceiling keeping a grandmaster ply
  inside the node ceiling, custom sizes, progress.
- **cli.test.js** — 19 tests: flag parsing, seats, per-side levels, the ceiling flags
  (`--nodes`, `--depth`) and the record they make reproducible across runs, help text, and
  the real commands run in a child process (`variants`, `rules` for copenhagen, brandub and
  alea, `--version`, bad command, `match`, `--record`, scripted games, `--load`, `serve`
  flag checks — port, TTL, `--max-watchers`, a `--state-dir` that cannot be made — and its
  banner).
- **net.test.js** — 35 tests: the API as a function — the endpoint index, the catalogues
  (the copenhagen variant answering its rule flags — the shield wall, the king back on his
  throne, the edge that does not capture, the move limit and the attackers win at it — and
  a 19×19 alea evangelii game with its 16 exits and citadel), opening a game,
  the move view (`from,to,piece,san`, the king named as such), `moves=turn|none|all`, an
  exchange with the AI answering, every way to send a move, every bad input, refusals
  (`409`), the AI seat playing n plies or all, hints, undo, resign, seats, the record, the
  rules text, the save round-trip, the game list, `max_games`, the TTL, unknown routes and
  verbs, the budgets of an AI move (the state answering them per seat, the caps, a seat
  change replacing the set, a `/ai` and a `/hint` call obeying the ceiling it was given
  past the opening book, and the ceilings coming back off the state directory), the push
  watchers (a `ply` per move and the state after it, a seat change pushing
  and a hint not, the close on delete and on the TTL sweep, the watcher cap, and a sink
  whose socket is gone being dropped), the state directory: a game written as a save
  file at once and after every move, read back by a second store with its seats, levels,
  clocks and seed and played on, the file going with a DELETE and a sweep, the newest
  games loaded first up to the slots, a broken file left alone, an old game pruned, and the
  lobby: an open seat listed and joined once and then played by its token alone (`401`
  without one, `409` while the seat is open, the token never in a state view), two agents
  with one token each and neither playing the other's seat, a seat handed to the AI or back
  to the caller giving its token up and a new owner getting a new one, and the seat, its
  name and its token coming back off the state directory.
- **server.test.js** — 15 tests: over a real socket — the page, CSS and JS and the square
  names of the page answering `formatSquare` on sizes 7 to 19 (the cell you click is the piece
  the API moves, and the script that names them loads before the code that uses it),
  HEAD, traversal
  probes, JSON over HTTP, CORS preflight (including the token header), broken JSON, missing
  files, `405`, the body cap, the game cap, `serve` on a free port, a state directory behind
  a live server (the file of a game played over HTTP, `state_dir` in health, the file going
  with the game), the lobby and a seat token arriving as a header, the
  `serve` command of the CLI as a child process, played over HTTP and stopped with SIGTERM,
  and the event stream read frame by frame: the content type, the state it opens with, the
  `ply` and `state` a move produces, the `closed` frame that ends the response, the
  `:ping` comment on a quiet game, the cap answered as a `409`, and a client that hangs up
  stopping being a watcher.

## Docs

`README.md` (the game, the variants, the flags, the web board, the API, the AI),
`QUICKSTART.md`, `FILES.md` (this file), `PROJECT_SUMMARY.md`, `LICENSE`.
