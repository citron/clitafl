# Quick start

## You need

Node.js 20+. Nothing else — the game has no dependencies, so there is nothing to install.

## Play right now

```bash
node src/index.js                 # tablut, you are the defender, the AI is medium
node src/index.js play --human attacker --level easy
node src/index.js play --variant brandub --human both   # two humans, one keyboard
node src/index.js play --variant alea --level easy      # the 19x19 gospel game
node src/index.js demo --variant copenhagen             # watch the AI play itself
node src/index.js match --variant ard-ri --seed 3       # a whole game, printed as a record
```

`npm start` does the same as the first line. `npm test` runs the 143 tests.

## Play in the browser

```bash
node src/index.js serve            # http://127.0.0.1:8080
node src/index.js serve --port 0   # a free port, printed in the banner
node src/index.js serve --state-dir ./games   # the open games survive a restart
```

The page is a click-to-move board with the variant, size, seat and AI-strength pickers,
the record, hint, undo, resign and save. Nothing to build: it is one HTML file, one CSS
file and one JS file calling the API.

## Play from a script, or as an AI agent

```bash
node src/index.js serve --port 8080 &
curl -s localhost:8080/api                                     # the API describes itself
curl -s localhost:8080/api/games -X POST -H 'content-type: application/json' \
  -d '{"variant":"tablut","seats":{"attacker":"ai","defender":"agent"},"levels":"hard"}'
curl -s localhost:8080/api/games/<id>                          # board, turn, legal moves
curl -s localhost:8080/api/games/<id>/moves -X POST -H 'content-type: application/json' \
  -d '{"from":"d5","to":"d4"}'                                  # the AI answers in the reply
curl -sN localhost:8080/api/games/<id>/events                   # every move, pushed as it happens
curl -s localhost:8080/api/lobby                               # the games with a seat going
curl -s localhost:8080/api/lobby/<id>/join -X POST -H 'content-type: application/json' \
  -d '{"seat":"defender","name":"bot-7"}'                      # take the seat: the reply is its token
curl -s localhost:8080/api/games/<id>/moves -X POST -H 'content-type: application/json' \
  -H 'x-clitafl-token: <token>' -d '{"from":"d5","to":"d4"}'   # a lobby seat plays with its token
```

`agent` is the seat you play from outside. The reply to a move carries the whole exchange
— your ply and the AI's — plus the new state, so one request is one turn. `GET /api` lists
the endpoints, `hint`, `undo`, `resign`, `seats`, the record, the rules and the save file
are all there.

Two agents meet on the lobby: open a game with `"seats":{"defender":"open"}` and
`GET /api/lobby` offers it to whoever asks; the first `POST /api/lobby/<id>/join` takes the
seat and gets the token that plays it. A seat with a token is played by that token and by
nobody else — `401` without the header, `409` while the seat is still open, and the token is
never repeated in a state view. A plain `agent` seat needs no token at all.

`/events` is the same game pushed to you instead of asked for: a `state` frame to start,
then a `ply` and a `state` for every move — whoever played it — and `closed` when the game
goes. `curl -sN` reads it, a browser uses `EventSource`, and the board page watches the
game it shows, so a move typed in a terminal shows up in the browser.

## Pick a game

```bash
node src/index.js variants
```

`tablut` (9×9), `copenhagen` (11×11), `brandub` (7×7), `ard-ri` (7×7), `alea` (19×19, the
gospel game), `tawlbwrdd` (11×11). `node src/index.js rules tablut` explains the one you
chose, castles and capture counts included. `--size 13` builds a symmetric army on any odd
board from 7 to 19.

## Typing a move

```
d5-d6
```

`d5 d6`, `d5d6` and `D5-D6` work too. Files are letters, ranks are numbers, counted from
the top left. The attackers move first.

Type `moves` to see every move you have, `hint` to see what the AI suggests, `board` to
redraw, `undo` to take a move back, `save mygame.json` to write a save file,
`help` for the rest.

## Save, resume, record

```bash
node src/index.js play --load mygame.json
node src/index.js match --record game.json --variant tablut
```

A save file is one JSON object (`clitafl-save-v1`): the board, the turn, the record. The
same object is what `GET /api/games/<id>/export` gives and `POST /api/games {"load": …}`
takes back. With `serve --state-dir <dir>`, you do not ask for it: the server writes one
file per open game as it is played, and finds them again when it starts, seats, clocks and
seed included. `GET /api/health` says which directory is in use.

## Getting a challenge

```bash
node src/index.js play --level hard
node src/index.js play --level-a easy --level-d hard   # weak attackers, strong defenders
node src/index.js play --time 5000                     # more thinking per move
```

`hard` and `grandmaster` open from the prepared book (`src/ai/book.json`, made by
`node tools/make-book.js`) and keep a transposition table between moves, so a long session
gets stronger as it goes. `match` runs on a node budget (`maxNodes`), which is why the same
seed always gives the same game.

## Plain terminal

```bash
node src/index.js play --ascii --no-color --no-animation
```

Works on any terminal, and honours `NO_COLOR`.

## Rules in one paragraph

All pieces slide like a rook and never jump. A soldier is captured when two enemies sit on
opposite sides of it; the board edge and empty castle squares can stand in for a captor
where the variant says so. The defenders win when the king steps on an escape square (an
edge, a corner, or the 16 marked squares of the alea evangelii), the attackers when they
take the king — with 2, 3 or 4 men around him depending on the variant and on whether he
stands beside or on a castle — and the fetlar games also let them win by sealing the king
and every defender in. Read the exact counts for the variant you play with `rules <name>`.
