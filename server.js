// Call Break table server. The laptop runs this; phones on the same Wi-Fi join with the QR code.
// No dependencies: `node server.js`, then open http://localhost:8080 on the laptop.
// The laptop sets the rules and shows the QR code; the phones run the game from there.
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const START_PORT = +process.env.PORT || 8080;
let PORT = START_PORT;
const STATE_FILE = path.join(__dirname, "state.json");
const PUBLIC = path.join(__dirname, "public");
const VERSION = 3;

// ---------- game state ----------
const four = v => [v, v, v, v];
const mod4 = n => ((n % 4) + 4) % 4;
// Each round remembers who dealt and the calling order: the player after the dealer
// (in the table's direction) leads the first card and calls first.
function blankRound(k) {
  const dealer = mod4(S.firstDealer + S.direction * k), lead = mod4(dealer + S.direction);
  return { calls: four(null), won: four(null), dealer, order: [0, 1, 2, 3].map(j => mod4(lead + S.direction * j)) };
}
const DEFAULTS = { rounds: 5, maxCall: 8, allowUnder13: true, extra: "tenth", hide: "none" };
function freshState(settings, seats) {
  return {
    version: VERSION,
    gameId: crypto.randomBytes(4).toString("hex"),
    // setup → lobby → calling → playing → scoring → between → calling … → over
    phase: "setup",
    settings: settings || { ...DEFAULTS },
    seats: seats || four(null), // { token, name } in join order
    ready: four(false), // "start round" / "round over" votes from the phones
    round: 0, // index into rounds[]
    turn: 0, // how many players have called this round; the caller is rounds[round].order[turn]
    direction: 1, // 1 = clockwise (join order), -1 = anticlockwise; chosen on the phones
    firstDealer: 0,
    rounds: [],
  };
}
let S;
try { S = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch {}
if (!S || S.version !== VERSION) S = freshState();
function persist() { fs.writeFile(STATE_FILE, JSON.stringify(S, null, 2), () => {}); }

const cur = () => S.rounds[S.round];
const sum = a => a.reduce((x, v) => x + (v || 0), 0);
const seatOf = token => (token ? S.seats.findIndex(s => s && s.token === token) : -1);
const full = () => S.seats.every(Boolean);

// Lowest call the 4th player may make when the table's total may not stay under 13.
function minCall() {
  if (S.settings.allowUnder13 || S.turn !== 3) return 1;
  return Math.min(S.settings.maxCall, Math.max(1, 13 - sum(cur().calls)));
}
const caller = () => cur().order[S.turn];

// What one screen is allowed to see. The laptop sees everything; phones may see only their own numbers.
function publicState(token, host) {
  const you = seatOf(token);
  const hide = S.settings.hide;
  const mask = (v, i) => (v == null || i === you ? v : "✓");
  let rounds = S.rounds;
  if (!host && hide === "game" && S.phase !== "over") {
    rounds = S.rounds.map(r => ({ ...r, calls: r.calls.map(mask), won: r.won.map(mask) }));
  } else if (!host && hide === "round" && (S.phase === "calling" || S.phase === "playing")) {
    rounds = S.rounds.map((r, k) => (k !== S.round ? r : { ...r, calls: r.calls.map(mask) }));
  }
  const r = cur();
  return {
    gameId: S.gameId, phase: S.phase, settings: S.settings, round: S.round, turn: S.turn, rounds,
    direction: S.direction, firstDealer: S.firstDealer, caller: S.phase === "calling" ? caller() : null,
    names: S.seats.map((s, i) => (s && s.name) || "Player " + (i + 1)),
    joined: S.seats.map(Boolean), ready: S.ready, you: you < 0 ? null : you, host: !!host,
    minCall: S.phase === "calling" ? minCall() : 1,
    // Phones can't add up hidden numbers, so the server says whether the haat make 13.
    mismatch: S.phase === "scoring" && r.won.every(v => v != null) && sum(r.won) !== 13 ? sum(r.won) : null,
    urls: lanUrls(),
  };
}

// ---------- actions ----------
class Bad extends Error {}
const need = (cond, msg) => { if (!cond) throw new Bad(msg); };
const intIn = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

function startRound() {
  if (S.phase === "lobby") { S.round = 0; S.rounds = [blankRound(0)]; }
  else { S.round++; S.rounds.push(blankRound(S.round)); }
  S.turn = 0; S.phase = "calling"; S.ready = four(false);
}
// Called after every change: moves the game on once all four phones agree.
function advance() {
  const allReady = S.ready.every(Boolean);
  if ((S.phase === "lobby" || S.phase === "between") && allReady && full()) startRound();
  else if (S.phase === "playing" && allReady) { S.phase = "scoring"; S.ready = four(false); }
  else if (S.phase === "scoring") {
    const w = cur().won;
    if (w.every(v => v != null) && sum(w) === 13) {
      S.phase = S.round + 1 >= S.settings.rounds ? "over" : "between";
      S.ready = four(false);
    }
  }
}

function placeCall(seat, value) {
  need(S.phase === "calling", "It isn't time to call.");
  need(seat === caller(), "Wait for your turn.");
  need(intIn(value, minCall(), S.settings.maxCall), "That call isn't allowed.");
  cur().calls[seat] = value;
  S.turn++;
  if (S.turn > 3) { S.phase = "playing"; S.ready = four(false); }
}
function placeWon(seat, value) {
  need(S.phase === "scoring", "The round isn't over yet.");
  need(intIn(value, 0, 13), "Haat won must be 0 to 13.");
  cur().won[seat] = value;
}

const hostActions = {
  startGame({ settings: s }) {
    need(S.phase === "setup", "Game already started.");
    s = s || {};
    S.settings = {
      rounds: intIn(s.rounds, 1, 20) ? s.rounds : 5,
      maxCall: s.maxCall === 13 ? 13 : 8,
      allowUnder13: s.allowUnder13 !== false,
      extra: s.extra === "none" ? "none" : "tenth",
      hide: ["none", "round", "game"].includes(s.hide) ? s.hide : "none",
    };
    S.phase = "lobby"; S.ready = four(false);
  },
  // Backups for when a phone dies or someone wanders off.
  hostCall({ value }) { placeCall(caller(), value); },
  hostWon({ seat, value }) { need(intIn(seat, 0, 3), "Bad seat."); placeWon(seat, value); },
  undoCall() {
    need(S.phase === "calling" || S.phase === "playing", "Nothing to undo.");
    need(S.turn > 0, "Nobody has called yet.");
    S.turn--; cur().calls[caller()] = null; S.phase = "calling";
  },
  skipWait() {
    need(["lobby", "between", "playing"].includes(S.phase), "Nothing to skip.");
    need(S.phase === "playing" || full(), "All four players need to join first.");
    S.ready = four(true);
  },
  releaseSeat({ seat }) {
    need(intIn(seat, 0, 3), "Bad seat.");
    S.seats[seat] = null; S.ready[seat] = false;
  },
  newGame() {
    const keep = S.settings, seats = S.seats, dir = S.direction;
    S = freshState(keep, seats); S.direction = dir;
  },
};

const playerActions = {
  // Players take the first open seat, so the join order decides Player 1-4.
  join({ token, name }) {
    need(S.phase !== "setup", "The host hasn't started the game yet.");
    name = String(name || "").trim().slice(0, 18);
    need(name, "Type your name.");
    need(token, "Missing phone id.");
    const mine = seatOf(token);
    if (mine >= 0) { S.seats[mine].name = name; return; }
    const free = S.seats.findIndex(s => !s);
    need(free >= 0, "The table is full.");
    S.seats[free] = { token, name };
  },
  leave({ token }) {
    const i = seatOf(token);
    need(i >= 0, "You're not at the table.");
    need(S.phase === "lobby" || S.phase === "setup" || S.phase === "over", "You can't leave mid-game. Ask the host to free your seat.");
    S.seats[i] = null; S.ready[i] = false;
  },
  // Any phone in the lobby can pick the direction of play and who deals first.
  table({ token, direction, firstDealer }) {
    mine(token);
    need(S.phase === "lobby", "The table is set once round 1 starts.");
    if (direction === 1 || direction === -1) S.direction = direction;
    if (intIn(firstDealer, 0, 3)) S.firstDealer = firstDealer;
    S.ready = four(false); // everyone re-confirms after a change
  },
  ready({ token, value }) {
    const i = mine(token);
    need(["lobby", "between", "playing"].includes(S.phase), "Nothing to confirm right now.");
    S.ready[i] = value !== false;
  },
  call({ token, value }) { placeCall(mine(token), value); },
  won({ token, value }) { placeWon(mine(token), value); },
};
function mine(token) { const i = seatOf(token); need(i >= 0, "Join the table first."); return i; }

// ---------- live updates (server-sent events) ----------
const clients = new Set();
const send = c => c.res.write("data: " + JSON.stringify(publicState(c.token, c.host)) + "\n\n");
function broadcast() { for (const c of clients) send(c); }
setInterval(() => { for (const c of clients) c.res.write(": ping\n\n"); }, 20000);

// ---------- http ----------
function lanUrls() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === "IPv4" && !a.internal) out.push({ name, url: `http://${a.address}:${PORT}/play` });
  }
  out.sort((a, b) => (a.name === "en0" ? -1 : b.name === "en0" ? 1 : 0));
  return out.map(o => o.url);
}
const isLocal = req => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript" };

function sendFile(res, file) {
  fs.readFile(path.join(PUBLIC, file), (err, buf) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;

  if (p === "/") {
    if (!isLocal(req)) { res.writeHead(302, { location: "/play" }); return res.end(); }
    return sendFile(res, "host.html");
  }
  if (p === "/play") return sendFile(res, "play.html");
  if (["/style.css", "/common.js", "/voice.js"].includes(p)) return sendFile(res, p.slice(1));

  if (p === "/events") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    // Only the laptop's own host page sees every number; a phone always gets the filtered view.
    const c = { res, token: url.searchParams.get("token") || "", host: isLocal(req) && url.searchParams.get("host") === "1" };
    clients.add(c);
    send(c);
    req.on("close", () => clients.delete(c));
    return;
  }

  if (p === "/api/action" && req.method === "POST") {
    let body = "";
    req.on("data", d => { body += d; if (body.length > 1e5) req.destroy(); });
    req.on("end", () => {
      let a;
      try { a = JSON.parse(body); } catch { a = {}; }
      const fn = playerActions[a.type] || (isLocal(req) && hostActions[a.type]);
      res.setHeader("content-type", "application/json");
      if (!fn) { res.writeHead(403); return res.end(JSON.stringify({ error: "Only the host laptop can do that." })); }
      try { fn(a); advance(); } catch (e) {
        if (!(e instanceof Bad)) console.error(e);
        res.writeHead(400); return res.end(JSON.stringify({ error: e instanceof Bad ? e.message : "Something went wrong." }));
      }
      persist(); broadcast();
      res.end("{}");
    });
    return;
  }

  res.writeHead(404); res.end("Not found");
});
// If the port is taken by another program, try the next one.
server.on("error", e => {
  if (e.code === "EADDRINUSE" && PORT < START_PORT + 20) { console.log(`  Port ${PORT} is busy, trying ${PORT + 1}…`); server.listen(++PORT); }
  else throw e;
});
server.listen(PORT, () => {
  console.log(`\n  ♠ Call Break server running\n\n  Host (this laptop):  http://localhost:${PORT}`);
  for (const u of lanUrls()) console.log(`  Players (same Wi-Fi): ${u}`);
  console.log("");
});
