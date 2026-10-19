// Announcer for the host laptop: speaks game events with the browser's built-in voices.
// It never says a number the "What phones can see" setting is hiding.
"use strict";
const Voice = (() => {
  const synth = window.speechSynthesis;
  let on = lsGet("callbreak.voice") !== "off";
  let voiceName = lsGet("callbreak.voiceName") || "";
  let waitKey = "", waitSince = 0, nags = 0;
  const NAG_AFTER = 40000, NAG_MAX = 3;

  const voices = () => (synth ? synth.getVoices().filter(v => /^en/i.test(v.lang)) : []);
  if (synth) synth.onvoiceschanged = () => { const s = $("#voicePick"); if (s && s.options.length < 2) s.outerHTML = pickHTML(); };

  function say(text) {
    if (!on || !synth || !text) return;
    const u = new SpeechSynthesisUtterance(text);
    const v = voices().find(v => v.name === voiceName);
    if (v) u.voice = v;
    u.rate = 1; u.pitch = 1.05;
    synth.speak(u);
  }

  // Scores are tenths; speak them as words ("minus 4", "3 point 2").
  const spokenScore = t10 => (t10 < 0 ? "minus " : "") + fmt(Math.abs(t10)).replace(".", " point ");
  const list = names => (names.length < 2 ? names.join("") : names.slice(0, -1).join(", ") + " and " + names[names.length - 1]);
  const who = (s, idx) => list(idx.map(i => nameOf(s, i)));
  const notReady = s => [0, 1, 2, 3].filter(i => !s.ready[i]);
  const showCalls = s => s.settings.hide === "none";
  const showScores = s => s.settings.hide !== "game";

  // What changed between two states, as sentences.
  function lines(p, s) {
    const out = [];
    if (s.gameId !== p.gameId && s.phase === "setup") return ["New game. Set the rules on the laptop."];
    if (p.phase === "setup" && s.phase === "lobby") out.push("Game on. Scan the code to join, one at a time, going clockwise.");

    // joins and leaves
    for (let i = 0; i < 4; i++) {
      if (s.joined[i] && !p.joined[i]) out.push(`${nameOf(s, i)} joined as player ${i + 1}.`);
      if (!s.joined[i] && p.joined[i]) out.push(`Player ${i + 1}'s seat is open.`);
    }
    if (s.phase === "lobby" && s.joined.every(Boolean) && !p.joined.every(Boolean)) out.push("Everyone's here. Choose the direction and dealer, then tap start on your phones.");
    if (s.phase === "lobby" && (s.direction !== p.direction || s.firstDealer !== p.firstDealer) && s.joined.every(Boolean)) {
      out.push(`${s.direction === -1 ? "Anticlockwise" : "Clockwise"}. ${nameOf(s, s.firstDealer)} deals first.`);
    }

    // a new round begins
    if (s.phase === "calling" && (p.phase !== "calling" || p.round !== s.round) && s.turn === 0) {
      const r = s.rounds[s.round];
      out.push(`Starting round ${s.round + 1} of ${s.settings.rounds}. ${nameOf(s, r.dealer)} deals. ${nameOf(s, s.caller)}, you lead and call first.`);
      return out;
    }

    // calls coming in
    if (s.phase === "calling" && p.phase === "calling" && s.round === p.round && s.turn !== p.turn) {
      if (s.turn > p.turn && showCalls(s)) out.push(`${nameOf(s, p.caller)} calls ${s.rounds[s.round].calls[p.caller]}.`);
      if (s.turn < p.turn) out.push("Last call undone.");
      out.push(`${nameOf(s, s.caller)}, your call.`);
    }
    if (s.phase === "playing" && p.phase === "calling") {
      const r = s.rounds[s.round], last = r.order[3];
      if (showCalls(s)) out.push(`${nameOf(s, last)} calls ${r.calls[last]}. All calls are in. The table called ${sum(r.calls)}.`);
      else out.push("All calls are in.");
      out.push(`${nameOf(s, r.order[0])}, throw the first card. Good luck!`);
    }
    if (s.phase === "scoring" && p.phase === "playing") out.push(`Round ${s.round + 1} over. Enter the haat you won on your phones.`);
    if (s.phase === "scoring" && s.rounds[s.round].won.every(v => v != null) && !p.rounds[p.round].won.every(v => v != null)) {
      const total = sum(s.rounds[s.round].won);
      if (total !== 13) out.push(`The haat add up to ${total}, not 13. Please check your numbers.`);
    }

    // round finished
    if ((s.phase === "between" || s.phase === "over") && p.phase === "scoring") {
      if (s.phase === "between") {
        out.push(`Round ${s.round + 1} complete.`);
        if (showScores(s)) {
          const t = totals(s), best = Math.max(...t), lead = [0, 1, 2, 3].filter(i => t[i] === best);
          out.push(`${who(s, lead)} ${lead.length > 1 ? "are tied for the lead" : "leads"} with ${spokenScore(best)}.`);
        }
        out.push(`Tap start on your phones for round ${s.round + 2}.`);
      } else {
        const t = totals(s), best = Math.max(...t), w = [0, 1, 2, 3].filter(i => t[i] === best);
        out.push(`Game over! ${w.length > 1 ? `It's a tie between ${who(s, w)}` : `The winner is ${who(s, w)}`}, with ${spokenScore(best)}.`);
        const rest = [0, 1, 2, 3].filter(i => !w.includes(i)).sort((a, b) => t[b] - t[a]);
        if (rest.length) out.push(rest.map(i => `${nameOf(s, i)}, ${spokenScore(t[i])}`).join(". ") + ".");
      }
    }
    return out;
  }

  // Reminder when the table has been stuck on the same step for a while.
  function waitingLine(s) {
    if (s.phase === "lobby" && !s.joined.every(Boolean)) return `Waiting for ${4 - s.joined.filter(Boolean).length} more to join.`;
    if (s.phase === "lobby" || s.phase === "between") return `Waiting for ${who(s, notReady(s))} to tap start.`;
    if (s.phase === "calling") return `Waiting for ${nameOf(s, s.caller)} to call.`;
    if (s.phase === "playing" && s.ready.some(Boolean)) return `Waiting for ${who(s, notReady(s))} to tap round over.`;
    if (s.phase === "scoring") {
      const missing = [0, 1, 2, 3].filter(i => s.rounds[s.round].won[i] == null);
      if (missing.length) return `Waiting for ${who(s, missing)} to enter haat.`;
    }
    return "";
  }
  setInterval(() => {
    if (!st || !on || nags >= NAG_MAX || Date.now() - waitSince < NAG_AFTER) return;
    const line = waitingLine(st);
    if (line) { say(line); nags++; }
    waitSince = Date.now();
  }, 5000);

  function update(prev, s) {
    const key = [s.phase, s.round, s.turn, s.ready.join(), s.joined.join(), s.rounds.length && s.rounds[s.round].won.join()].join("|");
    if (key !== waitKey) { waitKey = key; waitSince = Date.now(); nags = 0; }
    if (prev) lines(prev, s).forEach(say);
  }

  function pickHTML() {
    const vs = voices();
    return `<select id="voicePick" aria-label="Voice">${vs.length ? "" : `<option value="">Default voice</option>`}${vs.map(v =>
      `<option value="${esc(v.name)}" ${v.name === voiceName ? "selected" : ""}>${esc(v.name)} (${esc(v.lang)})</option>`).join("")}</select>`;
  }
  function panelHTML() {
    if (!synth) return `<div class="panel"><div class="eyebrow">Announcer</div><p class="muted">This browser can't speak. Try Chrome or Safari.</p></div>`;
    return `<div class="panel"><div class="eyebrow">Announcer · this laptop talks</div>
      <div class="row"><button class="btn ${on ? "primary" : ""}" data-act="voiceToggle">${on ? "🔊 Voice on" : "🔇 Voice off"}</button>
      <button class="btn ghost small" data-act="voiceTest">Test</button></div>
      ${on ? pickHTML() : ""}</div>`;
  }

  // Browsers only let a page talk after someone has clicked it once.
  document.addEventListener("click", ev => {
    const b = ev.target.closest("[data-act]");
    if (b && b.dataset.act === "voiceToggle") {
      on = !on; lsSet("callbreak.voice", on ? "on" : "off");
      if (!on && synth) synth.cancel();
      render(); if (on) say("Voice on.");
    } else if (b && b.dataset.act === "voiceTest") {
      say(st && st.joined.some(Boolean) ? `Hello ${who(st, [0, 1, 2, 3].filter(i => st.joined[i]))}. Let's play Call Break.` : "Hello! Let's play Call Break.");
    }
  });
  document.addEventListener("change", ev => {
    if (ev.target.id === "voicePick") { voiceName = ev.target.value; lsSet("callbreak.voiceName", voiceName); say("This is my voice."); }
  });

  return { update, panelHTML, say };
})();
