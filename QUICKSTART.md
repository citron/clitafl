# Quick start

## You need

Node.js 20+. Nothing else — the game has no dependencies, so there is nothing to install.

## Play right now

```bash
node src/index.js                 # tablut, you are the defender, the AI is medium
node src/index.js play --human attacker --level easy
node src/index.js play --variant brandub --human both   # two humans, one keyboard
node src/index.js demo --variant copenhagen             # watch the AI play itself
node src/index.js match --variant ard-ri --seed 3       # a whole game, printed as a record
```

`npm start` does the same as the first line. `npm test` runs the suite.

## Pick a game

```bash
node src/index.js variants
```

`tablut` (9×9), `copenhagen` (11×11), `brandub` (7×7), `ard-ri` (7×7), `tawlbwrdd` (11×11).
`node src/index.js rules tablut` explains the one you chose, castles and capture counts included.
`--size 13` builds a symmetric army on any odd board from 7 to 15.

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

## Getting a challenge

```bash
node src/index.js play --level hard
node src/index.js play --level-a easy --level-d hard   # weak attackers, strong defenders
node src/index.js play --time 5000                     # more thinking per move
```

## Plain terminal

```bash
node src/index.js play --ascii --no-color --no-animation
```

Works on any terminal, and honours `NO_COLOR`.

## Rules in one paragraph

All pieces slide like a rook and never jump. A soldier is captured when two enemies sit on
opposite sides of it; the board edge and empty castle squares can stand in for a captor
where the variant says so. The defenders win when the king steps on an escape square
(an edge, or a corner, depending on the game), the attackers when they take the king —
the fetlar games also let them win by sealing the king and every defender in. Read the
exact counts for the variant you play with `rules <name>`.
