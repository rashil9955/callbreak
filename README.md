# ♠ Call Break Scorepad

A scorekeeper for the card game Call Break. It runs on your laptop on the home Wi-Fi, and each player keeps score on their own phone.

## The story

Every weekend my friends and I sit down to play cards, and most weekends that means Call Break. It's four players and thirteen tricks. Before every round each player calls how many *haat* (tricks) they think they'll win, and at the end of the round you work out who made their call and who didn't.

The cards were never the problem. Keeping score was.

Someone always had to be the scorekeeper, with a pen and a scrap of paper or an iPad on the table. Every round they went around asking "what did you call?", wrote four numbers down, then asked "how many did you get?" and wrote four more. They also kept a running total for every player across every round. That person spent half the game doing paperwork. The paper got smudged, someone misheard a 3 as a 4, and every so often there was an argument about what somebody had *actually* called in round 2.

So I built this. Now nobody has to be the scorekeeper. The laptop puts a QR code on the screen, everyone scans it, and each player enters their own calls and their own haat on their own phone. The laptop keeps the full table of every round and adds up the scores. It even reads out whose turn it is.

## What it does

- **Join from your phone.** Scan the QR code or open the link, type your name, and that's it. There's no app to install and no account to make. Players become Player 1–4 in the order they join.
- **Calls go in turn.** The player after the dealer calls first, and everyone else sees "Waiting for …" until it's their turn.
- **The deal rotates.** The players pick clockwise or anticlockwise and who deals first. After that the dealer moves on every round, and the screen shows who deals and who leads.
- **The phones run the game.** All four tap to start a round, and all four tap "Round over". The laptop is only needed to set the rules and show the QR code.
- **Enter your own haat.** At the end of each round everyone enters how many haat they won. If the four numbers don't add up to 13, the game says so.
- **Secret mode.** Calls can be shown to everyone, hidden until each round ends, or hidden until the very last round. Only the laptop sees everything along the way.
- **House rules.** You set the number of rounds, whether calls go up to 8 or 13, whether the total of the calls may come to less than 13, and whether extra haat count as tenths.
- **The laptop talks.** It says things like "Starting round 1… Dev, you lead and call first", "Waiting for Chet to call", "Round 2 over", and "The winner is Bina!"
- **Nothing gets lost.** The game is saved to disk, so a refresh or a dropped phone doesn't lose any scores.

## Scoring

- If you **make your call**, you score your call, plus 0.1 for each extra haat if that house rule is on. For example, calling 3 and winning 4 scores 3.1.
- If you **miss your call**, you lose your call. For example, calling 4 and winning 2 scores −4.

## Running it

You need [Node.js](https://nodejs.org) 18 or newer. There are no dependencies to install.

```sh
git clone https://github.com/rashil9955/callbreak.git
cd callbreak
node server.js
```

1. On the laptop, open **http://localhost:8080** and set the rules.
2. Make sure everyone's phone is on the **same Wi-Fi** as the laptop, then have each player scan the QR code.
3. Deal the cards and play.

If port 8080 is already in use, the server picks the next free port and prints it. You can also choose a port yourself with `PORT=3000 node server.js`.

## How it's built

It's a single small Node server using only the built-in `http` module. Phones get live updates through server-sent events. The server decides what each phone is allowed to see, so hidden calls never reach other players' phones at all. The frontend is plain HTML, CSS and JavaScript in a hand-drawn "doodle" style. The announcer uses the browser's built-in speech (Web Speech API).

```
server.js         game state, rules, and what each player is allowed to see
public/host.html  laptop: setup, QR code, score table, announcer
public/play.html  phone: join, call, enter haat
public/common.js  shared scoring and helper functions
public/voice.js   the announcer
public/style.css  doodle theme (light and dark)
```

## Security

It's meant for a trusted home Wi-Fi, but it still locks itself down:

- **Only the laptop is the host.** Host controls and the full table (every hidden call) are only available to the laptop itself, never to a phone.
- **Phones only get what they're allowed to see.** In secret mode, other players' numbers never leave the server, so they can't be found by digging through the page.
- **Phone IDs stay private.** Each phone gets a random ID from the browser's secure random generator. It's never shown to other players, and `state.json` (where IDs and scores are saved) can only be read by your user account and is never committed.
- **Other websites can't interfere.** The server only answers to this computer's own addresses, which blocks DNS-rebinding tricks. It also rejects actions sent from other websites.
- **The pages are locked down.** They send a strict Content-Security-Policy, can't be put inside another site's frame, and the QR library from the CDN is pinned with an integrity hash.
- **There are no secrets to leak.** There are no accounts, API keys or `.env` files, and `.gitignore` blocks `.env`, key and certificate files in case any are ever added.

Traffic between the phones and the laptop is plain `http` on your local network, so play on a Wi-Fi network you trust.

## License

MIT
