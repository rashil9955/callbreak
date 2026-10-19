// Shared helpers for the host and player screens.
"use strict";
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

// Scores are kept in tenths so 0.1 per extra haat never drifts.
function score10(call, won, extra) {
  if (call == null || won == null) return null;
  if (won >= call) return call * 10 + (extra === "none" ? 0 : won - call);
  return -call * 10;
}
function fmt(t10, sign) {
  if (t10 == null) return "";
  const a = Math.abs(t10), s = a % 10 === 0 ? String(a / 10) : (a / 10).toFixed(1);
  return (t10 < 0 ? "−" : sign && t10 > 0 ? "+" : "") + s;
}
const nameOf = (st, i) => st.names[i];
// "Hide until the game ends": a phone only knows its own numbers until the last round is done.
const secret = st => !st.host && st.settings.hide === "game" && st.phase !== "over";
// A round counts once its haat are in: earlier rounds, the one just finished between rounds, and all at the end.
const roundDone = (st, r) => r < st.round || st.phase === "over" || (st.phase === "between" && r === st.round);
function totals(st) {
  // Hidden numbers arrive as "✓", which score as 0.
  return [0, 1, 2, 3].map(i => st.rounds.reduce((t, r, k) => t + (roundDone(st, k) && typeof r.won[i] === "number" ? score10(r.calls[i], r.won[i], st.settings.extra) : 0), 0));
}
const mod4 = n => ((n % 4) + 4) % 4;
const dirName = d => (d === -1 ? "Anticlockwise" : "Clockwise");
// Dealer of round k; the next player in the table's direction leads and calls first.
const dealerOf = (st, k) => (st.rounds[k] ? st.rounds[k].dealer : mod4(st.firstDealer + st.direction * k));
const leadOf = (st, k) => mod4(dealerOf(st, k) + st.direction);
const dealLine = (st, k) => `<b>${esc(nameOf(st, dealerOf(st, k)))}</b> deals · <b>${esc(nameOf(st, leadOf(st, k)))}</b> leads and calls first · ${dirName(st.direction).toLowerCase()}`;
const sum = a => a.reduce((x, v) => x + (typeof v === "number" ? v : 0), 0);

let toastT;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3200);
}

async function act(type, payload) {
  try {
    const r = await fetch("/api/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type, ...payload }) });
    if (!r.ok) { toast((await r.json().catch(() => ({}))).error || "Couldn't save."); return false; }
    return true;
  } catch { toast("Lost connection to the laptop."); return false; }
}

function connect(query, onState) {
  const es = new EventSource("/events?" + query);
  const pill = $("#pill");
  es.onmessage = e => { pill.className = "pill live"; pill.lastChild.textContent = "Connected"; onState(JSON.parse(e.data)); };
  es.onerror = () => { pill.className = "pill"; pill.lastChild.textContent = "Reconnecting"; };
}

function picker(kind, from, to, cur) {
  let b = "";
  for (let n = from; n <= to; n++) b += `<button data-act="pick" data-k="${kind}" data-v="${n}" aria-pressed="${cur === n}">${n}</button>`;
  return `<div class="grid-pick" role="group">${b}</div>`;
}

function totalsHTML(st, me) {
  const t = totals(st), best = Math.max(...t), any = t.some(v => v !== 0);
  if (secret(st)) {
    return me == null ? "" : `<div class="panel"><div class="eyebrow">Your total so far</div><div class="big-call"><span class="n ${t[me] < 0 ? "neg" : ""}">${fmt(t[me])}</span>
      <span class="muted">Everyone's scores are revealed after round ${st.settings.rounds}.</span></div></div>`;
  }
  return `<div class="totals">${[0, 1, 2, 3].map(i => `<div class="tot ${i === me ? "me" : ""} ${any && t[i] === best ? "lead" : ""}"><span class="who">${esc(nameOf(st, i))}</span><span class="v num ${t[i] < 0 ? "neg" : ""}">${fmt(t[i])}</span></div>`).join("")}</div>`;
}

function winnerHTML(st) {
  const t = totals(st), best = Math.max(...t), w = [0, 1, 2, 3].filter(i => t[i] === best).map(i => nameOf(st, i));
  return `<div class="eyebrow">Game over · ${st.settings.rounds} rounds</div>
    <div class="winner">${esc(w.join(" & "))}</div><p class="muted">${w.length > 1 ? "tie" : "wins"} with <span class="num">${fmt(best)}</span></p>`;
}
