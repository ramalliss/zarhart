// Zarhart Prep: study guide, flashcards, quiz, timed practice exam, Quizlet export.
import { DRILLS, drillSet } from "./drills.js";
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const store = { get(k, d) { try { const v = localStorage.getItem("zarhart:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem("zarhart:" + k, JSON.stringify(v)); } catch { /* storage off */ } } };

const PHAK = "https://www.faa.gov/regulations_policies/handbooks_manuals/aviation/phak";
const META = {
  ops: { acs: "PA.III.A–B", phak: "Ch. 14 Airport Operations", lessons: [["pattern", "Traffic pattern"], ["vasi", "Fly the VASI"], ["night", "Pilot-controlled lighting"], ["nordo", "Light gun signals"]] },
  regs: { acs: "PA.I.A, PA.I.B, PA.I.E", phak: "Ch. 15 Airspace + 14 CFR Parts 61 & 91", lessons: [["xc", "Cross-country (airspace & VFR minimums)"]] },
  aero: { acs: "PA.I.F, PA.VII", phak: "Ch. 4–5 Principles & Aerodynamics of Flight", lessons: [["stall", "Power-off stall"], ["steep", "Steep turns"], ["softfield", "Ground effect"]] },
  wake: { acs: "PA.III.B, PA.IV", phak: "Ch. 14 (wake turbulence) + AIM 7-4", lessons: [["wake", "Wake turbulence"]] },
  perf: { acs: "PA.I.F", phak: "Ch. 10 Weight & Balance, Ch. 11 Performance", lessons: [["softfield", "Soft-field takeoff"], ["pattern", "Vy climb"]] },
  inst: { acs: "PA.I.G", phak: "Ch. 7 Systems, Ch. 8 Instruments", lessons: [["carbice", "Carburetor ice"]] },
  wx: { acs: "PA.I.C", phak: "Ch. 12 Weather Theory, Ch. 13 Weather Services", lessons: [["xc", "Scattered clouds & VFR minimums"]] },
  nav: { acs: "PA.I.D, PA.VI", phak: "Ch. 16 Navigation", lessons: [["vor", "VOR tracking"], ["xc", "Pilotage cross-country"]] },
  adm: { acs: "PA.I.H, PA.V, PA.IX", phak: "Ch. 2 ADM, Ch. 17 Aeromedical", lessons: [["enginefail", "Engine failure"], ["crosswind", "Crosswind landing"]] },
};
const SRC = { test: "Practice test review set", extra: "Commonly tested", phak: "From the FAA handbook", faa: "From FAA handbooks and regulations" };
/** questions per topic on the practice exam (60 in all), roughly in proportion to the real test */
const EXAM_MIX = { regs: 12, wx: 10, nav: 8, ops: 7, aero: 6, perf: 5, inst: 5, adm: 5, wake: 2 };

let DATA, TOPICS, CARDS;
const progress = store.get("progress", {}); // topic -> {right, total}
const known = new Set(store.get("known", []));
/** per-question history: id -> { r: right, w: wrong, b: Leitner box 0–5, t: last answered (ms) } */
const hist = store.get("qh", {});
function record(c, ok) {
  const p = (progress[c.topic] ||= { right: 0, total: 0 }); p.total++; if (ok) p.right++; store.set("progress", progress);
  const h = (hist[c.id] ||= { r: 0, w: 0, b: 0, t: 0 });
  if (ok) { h.r++; h.b = Math.min(5, h.b + 1); } else { h.w++; h.b = 0; }
  h.t = Date.now(); store.set("qh", hist);
}
const mastered = (c) => (hist[c.id]?.b || 0) >= 3;
const missed = (c) => !!hist[c.id]?.w && (hist[c.id].b || 0) < 3;

const DECKS = [
  { key: "all", label: "All questions", pick: () => true },
  { key: "faa", label: "FAA handbooks & regulations", pick: (c) => c.src === "faa" },
  { key: "test", label: "Practice test review set", pick: (c) => c.src === "test" },
  { key: "extra", label: "Commonly tested topics", pick: (c) => c.src === "extra" },
  { key: "phak", label: "FAA handbook questions", pick: (c) => c.src === "phak" },
];
/** scenario quizzes: sets built from what a question is about, across the topic tabs */
const SCENARIOS = [
  { key: "rain", label: "Rain, wet runways & hydroplaning", re: /hydroplan|wet runway|standing water|\brain\b|\+RA\b|aerodynamic braking/i },
  { key: "winter", label: "Snow, frost & icing", re: /frost|snow|\bice\b|icing|\brime\b|freezing|FZRA|pitot heat|cold, dense|cold weather/i },
  { key: "wind", label: "Wind, gusts & crosswinds", re: /gust|crosswind|tailwind|headwind|wind shear|mechanical turbulence|windsock|quartering/i },
  { key: "storms", label: "Thunderstorms & microbursts", re: /thunderstorm|microburst|virga|cumulonimbus|\bhail\b|VCTS|squall|anvil/i },
  { key: "fog", label: "Fog, calm wind & low visibility", re: /\bfog\b|\bmist\b|\bBR\b|\bcalm\b|dew point|special VFR|ceiling/i },
  { key: "metar", label: "Reading METARs, TAFs & reports", re: /METAR|\bTAF\b|PIREP|AIRMET|SIGMET|AC 00-45/i },
  { key: "markings", label: "Airport markings, signs & lighting", re: /marking|\bsign\b|threshold|chevron|segmented circle|VASI|PAPI|beacon|hold.?short|runway light/i },
  { key: "mountain", label: "Density altitude & mountain flying", re: /density altitude|mountain|ridge|lenticular|high.elevation|lean(ed)? .*mixture|mixture.*lean/i },
  { key: "types", label: "Airplanes, V-speeds & aerodynamics in practice", re: /\bV[xyrsa]\b|V-speed|stabilator|low-wing|high-wing|ground effect|maneuvering speed|stall speed/i },
];
const scenarioPool = (sc) => CARDS.filter((c) => sc.re.test(`${c.q} ${c.c[0]} ${c.why || ""} ${c.ref || ""}`));

/** topic accuracy from per-question history, pulled toward 60% until there are enough answers */
function topicAcc(key) {
  let r = 0, n = 0;
  for (const c of CARDS) if (c.topic === key && hist[c.id]) { r += hist[c.id].r; n += hist[c.id].r + hist[c.id].w; }
  return { acc: (r + 0.6 * 6) / (n + 6), n };
}
/** smart review: missed and unseen questions first, weak topics weighted up, mastered ones rarely */
function smartPick(pool, n) {
  const acc = Object.fromEntries(DATA.topics.map((t) => [t.key, topicAcc(t.key).acc]));
  const w = (c) => { const h = hist[c.id]; const base = !h ? 3 : [6, 3, 1.5, 0.7, 0.3, 0.15][h.b]; return base * (1 + 1.5 * (1 - acc[c.topic])); };
  const left = pool.map((c) => ({ c, k: Math.pow(Math.random(), 1 / w(c)) })); // weighted sampling without replacement
  return left.sort((a, b) => b.k - a.k).slice(0, n).map((x) => x.c);
}
const deck = (key, topic) => CARDS.filter(DECKS.find((d) => d.key === key).pick).filter((c) => !topic || topic === "all" || c.topic === topic);
const deckOptions = (sel) => DECKS.map((d) => `<option value="${d.key}" ${d.key === sel ? "selected" : ""}>${esc(d.label)} (${deck(d.key).length})</option>`).join("");
const topicOptions = () => `<option value="all">All topics</option>` + DATA.topics.map((t) => `<option value="${t.key}">${esc(t.name)}</option>`).join("");

/* ---------------- tabs ---------------- */
const TABS = ["guide", "cards", "quiz", "exam", "quizlet", "resources"];
function showTab(name, push = true) {
  TABS.forEach((t) => { $("#tab-" + t).setAttribute("aria-selected", t === name); $("#p-" + t).hidden = t !== name; });
  store.set("tab", name); if (push) history.replaceState(null, "", location.pathname + location.search.replace(/[?&]card=[^&]*/, "") + "#" + name);
}

/* ---------------- study guide ---------------- */
function readiness() {
  const seen = CARDS.filter((c) => hist[c.id]).length, answers = Object.values(hist).reduce((s, h) => s + h.r + h.w, 0);
  if (answers < 30) return `<p class="dnote">Answer at least 30 questions (quiz or practice exam) and your predicted test score shows up here. You've answered ${answers}.</p>`;
  const tot = Object.values(EXAM_MIX).reduce((a, b) => a + b, 0);
  const score = Math.round(100 * Object.entries(EXAM_MIX).reduce((s, [k, n]) => s + n * topicAcc(k).acc, 0) / tot);
  return `<div class="ready"><div><b class="${score >= 80 ? "pass" : score >= 70 ? "close" : "fail"}">${score}%</b><span>predicted test score</span></div><div><b>${CARDS.filter(mastered).length}</b><span>of ${CARDS.length} mastered</span></div><div><b>${seen}</b><span>seen</span></div><div><b>${CARDS.filter(missed).length}</b><span>to review</span></div></div>
    <p class="dnote">${score >= 80 ? "You're in good shape. Keep the missed questions down and take a timed practice exam." : score >= 70 ? "Close to passing. Aim for 80%+ before you book the test: run Smart review until the misses are cleared." : "Keep going: Smart review serves your missed questions and weakest topics first."}</p>`;
}
function renderStatus() {
  const weak = DATA.topics.map((t) => ({ t, p: progress[t.key] })).filter((x) => x.p?.total >= 3).sort((a, b) => a.p.right / a.p.total - b.p.right / b.p.total).slice(0, 3);
  $("#weak").innerHTML = readiness() + (weak.length ? `<p class="eyebrow">Your weakest topics (from quizzes on this device)</p><div class="weakrow">${weak.map((x) => `<a href="#g-${x.t.key}" class="weak"><b>${Math.round(100 * x.p.right / x.p.total)}%</b><span>${esc(x.t.name)}</span></a>`).join("")}</div>` : "");
}
function renderGuide(focusId) {
  renderStatus();
  $("#guide").innerHTML = DATA.topics.map((t) => {
    const cs = CARDS.filter((c) => c.topic === t.key); const m = META[t.key];
    const open = focusId ? cs.some((c) => c.id === focusId) : false;
    return `<details class="topic" id="g-${t.key}" ${open ? "open" : ""}><summary><span class="tname">${esc(t.name)}</span><span class="tmeta">${esc(m.acs)} · ${cs.length} questions</span></summary>
      <div class="tbody">
        <div class="tlinks"><a href="${PHAK}" target="_blank" rel="noopener">PHAK ${esc(m.phak)} ↗</a><a href="https://fly8ma.com/private-pilot-ground-school/" target="_blank" rel="noopener">FLY8MA lesson videos ↗</a>${m.lessons.map(([id, n]) => `<a class="fly" href="../sim/?lesson=${id}">✈ Fly it: ${esc(n)}</a>`).join("")}</div>
        <div class="facts"><h3>Know cold</h3><ul>${t.facts.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></div>
        <ol class="qlist">${cs.map((c) => `<li id="card-${c.id}" class="${c.id === focusId ? "focus" : ""}"><p class="q"><span class="qid">${c.id.toUpperCase()}</span>${esc(c.orig || c.q)}</p>${c.orig ? `<p class="concept">Practice version: ${esc(c.q)}</p>` : ""}<p class="a"><span>Answer</span>${esc(c.c[0])}</p>${c.why ? `<p class="why">${esc(c.why)}</p>` : ""}<p class="meta">${mastered(c) ? `<span class="st ok">Mastered</span>` : missed(c) ? `<span class="st no">Missed ${hist[c.id].w}×</span>` : ""}${c.fig ? `<span class="fig">${esc(c.fig)}</span>` : ""}<span>${esc(c.ref || "")}</span><span>${esc(SRC[c.src])}</span>${c.note ? `<span>${esc(c.note)}</span>` : ""}</p></li>`).join("")}</ol>
      </div></details>`;
  }).join("");
  if (focusId) setTimeout(() => $("#card-" + focusId)?.scrollIntoView({ block: "center" }), 50);
}

/* ---------------- flashcards ---------------- */
const fc = { list: [], i: 0, flipped: false };
function fcBuild(sh) { let l = deck($("#fcDeck").value, $("#fcTopic").value); if ($("#fcSkip").checked) l = l.filter((c) => !known.has(c.id)); fc.list = sh ? shuffle(l) : l; fc.i = 0; fc.flipped = false; fcRender(); }
function fcRender() {
  const st = $("#fcStage");
  if (!fc.list.length) { st.innerHTML = `<div class="empty">No cards here. ${$("#fcSkip").checked ? "You know them all. Uncheck “Hide cards I know”." : "Pick another deck or topic."}</div>`; $("#fcCount").textContent = "0 cards"; return; }
  const c = fc.list[fc.i]; const t = TOPICS[c.topic];
  $("#fcCount").textContent = `Card ${fc.i + 1} of ${fc.list.length} · ${fc.list.filter((x) => known.has(x.id)).length} known`;
  st.innerHTML = `<div class="card ${fc.flipped ? "back" : ""}" role="button" tabindex="0" id="fcCard"><div class="cmeta"><span class="pill">${esc(t.name)}</span><span class="pill">${c.id.toUpperCase()}</span>${c.fig ? `<span class="pill fig">${esc(c.fig)}</span>` : ""}${known.has(c.id) ? `<span class="pill ok">Known</span>` : ""}</div>
    ${fc.flipped ? `<p class="cq small">${esc(c.q)}</p><p class="clabel">Answer</p><p class="ca">${esc(c.c[0])}</p>${c.why ? `<p class="cwhy">${esc(c.why)}</p>` : ""}<p class="cref">${esc(c.ref || "")}</p>` : `<p class="cq">${esc(c.q)}</p><p class="chint">Tap, or press Space, to flip</p>`}</div>`;
  $("#fcCard").onclick = flip; $("#fcCard").onkeydown = (e) => { if (e.key === "Enter") flip(); };
}
const flip = () => { if (!fc.list.length) return; fc.flipped = !fc.flipped; fcRender(); };
const move = (d) => { if (!fc.list.length) return; fc.i = (fc.i + d + fc.list.length) % fc.list.length; fc.flipped = false; fcRender(); };
function mark(k) { if (!fc.list.length) return; const c = fc.list[fc.i]; if (k) known.add(c.id); else known.delete(c.id); store.set("known", [...known]); if (k && $("#fcSkip").checked) { fc.list.splice(fc.i, 1); if (fc.i >= fc.list.length) fc.i = 0; fc.flipped = false; fcRender(); } else move(1); }

/* ---------------- quiz ---------------- */
const qz = { list: [], i: 0, order: [], picked: null, res: [], timer: null, deadline: 0 };
const EMPTY = { missed: "No missed questions here yet. Take a quiz, and anything you get wrong comes back in this mode until you've answered it right three times.", new: "You've seen every question in this deck and topic. Try Smart review." };
/** retry: an explicit list of cards (the "retry the ones I missed" button); otherwise build from the toolbar */
function qzStart(retry, label = "") {
  qz.label = label;
  const n = +$("#qzLen").value, mode = $("#qzMode").value;
  let pool = retry || deck($("#qzDeck").value, $("#qzTopic").value);
  if (!retry && mode === "missed") pool = pool.filter(missed);
  if (!retry && mode === "new") pool = pool.filter((c) => !hist[c.id]);
  const k = Math.min(n, pool.length);
  qz.list = !retry && mode === "smart" ? smartPick(pool, k) : shuffle(pool).slice(0, k); qz.i = 0; qz.res = [];
  if (!qz.list.length) { clearInterval(qz.timer); $("#qzStage").innerHTML = `<div class="empty">${esc(EMPTY[mode] || "No questions match.")}</div>`; return; }
  qzNext();
}
function qzNext() { qz.picked = null; if (qz.i >= qz.list.length) return qzEnd(); const c = qz.list[qz.i]; qz.order = shuffle(c.c.map((t, k) => ({ t, ok: k === 0 }))); qzRender(); }
/** k: the chosen answer, or -1 when the time ran out */
function qzAnswer(k) {
  if (qz.picked !== null) return;
  const c = qz.list[qz.i]; qz.picked = k; const ok = k >= 0 && qz.order[k].ok;
  qz.res.push({ c, ok, picked: k >= 0 ? qz.order[k].t : "(time ran out)" }); if (!c.drill) record(c, ok); // generated drills aren't in the bank qzRender(); $("#qzGo")?.focus();
}
function qzClock() {
  clearInterval(qz.timer); if (!$("#qzTimed").checked || qz.picked !== null) return;
  qz.deadline = Date.now() + 30000;
  const tick = () => { const left = Math.max(0, Math.ceil((qz.deadline - Date.now()) / 1000)); const el = $("#qzClock"); if (el) { el.textContent = `⏱ ${left}s`; el.classList.toggle("low", left <= 10); } if (left <= 0) { clearInterval(qz.timer); qzAnswer(-1); } };
  tick(); qz.timer = setInterval(tick, 250);
}
function qzRender() {
  const c = qz.list[qz.i], done = qz.picked !== null, good = done && qz.picked >= 0 && qz.order[qz.picked].ok, timedOut = done && qz.picked < 0;
  $("#qzStage").innerHTML = `<div class="qtop"><span>Question ${qz.i + 1} of ${qz.list.length}</span>${$("#qzTimed").checked && !done ? `<span class="clock" id="qzClock"></span>` : ""}<span>${qz.res.filter((r) => r.ok).length} correct</span></div><div class="bar"><span style="width:${(qz.i / qz.list.length) * 100}%"></span></div>
    <div class="cmeta"><span class="pill">${esc(TOPICS[c.topic].name)}</span>${c.fig ? `<span class="pill fig">${esc(c.fig)}</span>` : ""}${missed(c) && !done ? `<span class="pill no">Missed before</span>` : ""}</div><p class="qq">${esc(c.q)}</p>${c.code ? `<p class="qcode">${esc(c.code)}</p>` : ""}
    ${qz.order.map((o, k) => `<button class="choice ${done && o.ok ? "right" : done && k === qz.picked ? "wrong" : ""}" data-k="${k}" ${done ? "disabled" : ""}><span class="lt">${"ABC"[k]}</span><span>${esc(o.t)}</span></button>`).join("")}
    ${done ? `<div class="fb ${good ? "" : "no"}"><p><b>${good ? "Correct." : timedOut ? "Time's up." : "Not quite."}</b> ${good ? "" : "Answer: " + esc(c.c[0])}</p>${c.why ? `<p>${esc(c.why)}</p>` : ""}${c.ref ? `<p class="cref">${esc(c.ref)}</p>` : ""}</div><div class="actions"><button class="btn primary" id="qzGo">${qz.i + 1 < qz.list.length ? "Next →" : "See results"}</button></div>` : ""}`;
  document.querySelectorAll("#qzStage .choice").forEach((b) => b.onclick = () => qzAnswer(+b.dataset.k));
  const go = $("#qzGo"); if (go) go.onclick = () => { qz.i++; qzNext(); };
  qzClock();
}
function qzEnd() {
  const r = qz.res.filter((x) => x.ok).length, p = Math.round(100 * r / qz.res.length), wrong = qz.res.filter((x) => !x.ok);
  $("#qzStage").innerHTML = `<div class="result"><p class="eyebrow">Quiz result</p><p class="big ${p >= 70 ? "pass" : "fail"}">${p}%</p><p>${r} of ${qz.res.length} · ${p >= 70 ? "above" : "below"} the 70% passing score</p>
    ${wrong.length ? `<ol class="miss">${wrong.map((w) => `<li><p>${esc(w.c.q)}${w.c.code ? ` <code>${esc(w.c.code)}</code>` : ""}</p><p><s>${esc(w.picked)}</s> → <b>${esc(w.c.c[0])}</b></p></li>`).join("")}</ol>` : "<p>Clean sweep.</p>"}
    <div class="actions">${wrong.length ? `<button class="btn" id="qzRetry">Retry the ${wrong.length} I missed</button>` : ""}<button class="btn primary" id="qzAgain">New quiz</button></div></div>`;
  $("#qzRetry") && ($("#qzRetry").onclick = () => qzStart(wrong.map((w) => w.c)));
  $("#qzAgain").onclick = () => qzStart();
  renderStatus();
}

/* ---------------- practice exam (60 Q, 2.5 h) ---------------- */
const ex = { list: [], answers: [], orders: [], i: 0, end: 0, timer: null, done: false };
/** 60 questions in the EXAM_MIX proportions, topped up from other topics if one runs short */
function examPick() {
  const picked = [];
  for (const [k, n] of Object.entries(EXAM_MIX)) picked.push(...shuffle(CARDS.filter((c) => c.topic === k)).slice(0, n));
  const ids = new Set(picked.map((c) => c.id));
  picked.push(...shuffle(CARDS.filter((c) => !ids.has(c.id))).slice(0, 60 - picked.length));
  return shuffle(picked).slice(0, 60);
}
const FORMS = 10;
function seeded(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function seededShuffle(a, seed) { const r = seeded(seed), b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }
/** practice test `k` (1–10): the same 60 questions every time, in the EXAM_MIX proportions */
function formPick(k) {
  const picked = [];
  Object.entries(EXAM_MIX).forEach(([key, n], ti) => {
    const pool = seededShuffle(CARDS.filter((c) => c.topic === key).sort((a, b) => (a.id < b.id ? -1 : 1)), 1931 + ti);
    for (let i = 0; i < n && pool.length; i++) picked.push(pool[((k - 1) * n + i) % pool.length]);
  });
  return seededShuffle([...new Map(picked.map((c) => [c.id, c])).values()], 7 * k).slice(0, 60);
}
function renderForms() {
  const best = store.get("forms", {}), el = $("#exForms"); if (!el) return;
  el.innerHTML = Array.from({ length: FORMS }, (_, i) => { const k = i + 1, b = best[k]; return `<button class="form ${b ? (b.best >= 70 ? "pass" : "fail") : ""}" data-form="${k}"><b>Test ${k}</b><span>${b ? `best ${b.best}% · ${b.n} ${b.n === 1 ? "try" : "tries"}` : "not taken"}</span></button>`; }).join("");
  el.querySelectorAll("[data-form]").forEach((b) => (b.onclick = () => exStart(+b.dataset.form)));
}
function exStart(form = null) {
  ex.form = form;
  ex.list = form ? formPick(form) : examPick(); ex.orders = ex.list.map((c) => shuffle(c.c.map((t, k) => ({ t, ok: k === 0 }))));
  ex.answers = new Array(ex.list.length).fill(null); ex.i = 0; ex.done = false; ex.end = Date.now() + 150 * 60 * 1000;
  clearInterval(ex.timer); ex.timer = setInterval(exTick, 1000); exRender();
}
function exTick() { if (ex.done) return; const left = ex.end - Date.now(); if (left <= 0) return exFinish(); const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000); const el = $("#exClock"); if (el) el.textContent = `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}`; }
function exRender() {
  const c = ex.list[ex.i], o = ex.orders[ex.i], a = ex.answers[ex.i];
  $("#exStage").innerHTML = `<div class="examhead"><span>Question <b>${ex.i + 1}</b> of 60</span><span>Answered ${ex.answers.filter((x) => x != null).length}/60</span><span class="clock">⏱ <b id="exClock">2:30:00</b></span></div>
    <div class="grid60">${ex.list.map((_, k) => `<button class="${k === ex.i ? "cur" : ""} ${ex.answers[k] != null ? "ans" : ""}" data-j="${k}" aria-label="Question ${k + 1}">${k + 1}</button>`).join("")}</div>
    <p class="qq">${esc(c.q)}</p>${o.map((x, k) => `<button class="choice ${a === k ? "sel" : ""}" data-k="${k}"><span class="lt">${"ABC"[k]}</span><span>${esc(x.t)}</span></button>`).join("")}
    <div class="actions"><button class="btn" id="exPrev" ${ex.i === 0 ? "disabled" : ""}>← Previous</button><button class="btn" id="exNext">${ex.i < 59 ? "Next →" : "Review"}</button><button class="btn primary" id="exSubmit">Submit exam</button></div>`;
  exTick();
  document.querySelectorAll("#exStage .choice").forEach((b) => b.onclick = () => { ex.answers[ex.i] = +b.dataset.k; if (ex.i < 59) { ex.i++; } exRender(); });
  document.querySelectorAll(".grid60 button").forEach((b) => b.onclick = () => { ex.i = +b.dataset.j; exRender(); });
  $("#exPrev").onclick = () => { ex.i--; exRender(); }; $("#exNext").onclick = () => { ex.i = Math.min(59, ex.i + 1); exRender(); };
  $("#exSubmit").onclick = () => { const un = ex.answers.filter((x) => x == null).length; if (un && !$("#exSubmit").dataset.sure) { $("#exSubmit").dataset.sure = 1; $("#exSubmit").textContent = `${un} unanswered. Submit anyway?`; return; } exFinish(); };
}
function exFinish() {
  ex.done = true; clearInterval(ex.timer);
  const rows = ex.list.map((c, k) => ({ c, ok: ex.answers[k] != null && ex.orders[k][ex.answers[k]].ok, picked: ex.answers[k] != null ? ex.orders[k][ex.answers[k]].t : "(no answer)" }));
  rows.forEach((r) => record(r.c, r.ok));
  const right = rows.filter((r) => r.ok).length, p = Math.round(100 * right / 60);
  const by = {}; rows.forEach((r) => { const b = (by[r.c.topic] ||= { r: 0, n: 0 }); b.n++; if (r.ok) b.r++; });
  const missedAcs = [...new Set(rows.filter((r) => !r.ok).map((r) => META[r.c.topic].acs))];
  const hist = store.get("exams", []); hist.unshift({ p, date: new Date().toISOString().slice(0, 10), form: ex.form }); store.set("exams", hist.slice(0, 10));
  if (ex.form) { const f = store.get("forms", {}); const b = f[ex.form] || { best: 0, n: 0 }; f[ex.form] = { best: Math.max(b.best, p), last: p, n: b.n + 1 }; store.set("forms", f); }
  $("#exStage").innerHTML = `<div class="result report"><p class="eyebrow">${ex.form ? `Practice test ${ex.form} report` : "Practice knowledge test report"}</p><p class="big ${p >= 70 ? "pass" : "fail"}">${p}%</p><p>${right} of 60 correct · ${p >= 70 ? "PASS (70% required)" : "Below 70%: not yet"}</p>
    <h3>By topic</h3><table class="bytopic"><tbody>${Object.entries(by).sort((a, b) => a[1].r / a[1].n - b[1].r / b[1].n).map(([k, b]) => `<tr><td>${esc(TOPICS[k].name)}</td><td class="mono">${esc(META[k].acs)}</td><td class="mono">${b.r}/${b.n}</td><td><span class="mini"><span style="width:${100 * b.r / b.n}%"></span></span></td></tr>`).join("")}</tbody></table>
    ${missedAcs.length ? `<p class="dnote">ACS areas to review: ${missedAcs.map(esc).join(" · ")}. On the real test your report lists ACS codes like these, and your instructor must review them with you.</p>` : ""}
    <h3>Missed questions</h3><ol class="miss">${rows.filter((r) => !r.ok).map((r) => `<li><p>${esc(r.c.q)}</p><p><s>${esc(r.picked)}</s> → <b>${esc(r.c.c[0])}</b></p>${r.c.why ? `<p class="why">${esc(r.c.why)}</p>` : ""}</li>`).join("")}</ol>
    <div class="actions">${ex.form && ex.form < FORMS ? `<button class="btn primary" id="exNextForm">Next: practice test ${ex.form + 1}</button>` : ""}${ex.form ? `<button class="btn" id="exRetake">Retake test ${ex.form}</button>` : ""}<button class="btn ${ex.form ? "" : "primary"}" id="exAgain">Random practice exam</button></div>
    <p class="dnote">Recent scores on this device: ${hist.slice(0, 6).map((h) => `${h.p}%`).join(" · ")}</p></div>`;
  $("#exAgain").onclick = () => exStart(); if ($("#exNextForm")) $("#exNextForm").onclick = () => exStart(ex.form + 1); if ($("#exRetake")) $("#exRetake").onclick = () => exStart(ex.form);
  renderStatus();
}

/* ---------------- quizlet ---------------- */
const clean = (s) => String(s).replace(/[\t\r\n]+/g, " ").trim();
function qlRender() { const why = $("#qlWhy").checked; $("#qlText").value = deck($("#qlDeck").value).map((c) => clean(c.q) + "\t" + clean(c.c[0] + (why && c.why ? ". " + c.why : ""))).join("\n"); $("#qlStatus").textContent = ""; }

/* ---------------- boot ---------------- */
async function boot() {
  try { DATA = await (await fetch("../assets/data/questions.json")).json(); }
  catch { $("#guide").innerHTML = `<p class="dwarn">Couldn't load the question bank. If you opened this file directly, run it from a web server (see the README).</p>`; return; }
  TOPICS = Object.fromEntries(DATA.topics.map((t) => [t.key, t]));
  CARDS = DATA.cards.filter((c) => c.card !== false);
  $("#count").textContent = CARDS.length;
  ["#fcDeck", "#qzDeck", "#qlDeck"].forEach((s) => ($(s).innerHTML = deckOptions("all")));
  ["#fcTopic", "#qzTopic"].forEach((s) => ($(s).innerHTML = topicOptions()));
  const focus = new URLSearchParams(location.search).get("card");
  renderGuide(focus);
  fcBuild(false);
  $("#fcDeck").onchange = $("#fcTopic").onchange = $("#fcSkip").onchange = () => fcBuild(false);
  $("#fcShuffle").onclick = () => fcBuild(true); $("#fcPrev").onclick = () => move(-1); $("#fcNext").onclick = () => move(1); $("#fcFlip").onclick = flip;
  $("#fcKnow").onclick = () => mark(true); $("#fcLearn").onclick = () => mark(false);
  addEventListener("keydown", (e) => { if ($("#p-cards").hidden || /input|select|textarea/i.test(e.target.tagName)) return; if (e.key === " ") { e.preventDefault(); flip(); } else if (e.key === "ArrowRight") move(1); else if (e.key === "ArrowLeft") move(-1); else if (e.key.toLowerCase() === "k") mark(true); else if (e.key.toLowerCase() === "l") mark(false); });
  $("#qzStart").onclick = () => qzStart(); qzStart();
  $("#qzScen").innerHTML = SCENARIOS.map((sc) => `<button class="chipbtn" data-sc="${sc.key}">${esc(sc.label)} <span>${scenarioPool(sc).length}</span></button>`).join("");
  $("#qzScen").querySelectorAll("[data-sc]").forEach((b) => (b.onclick = () => { const sc = SCENARIOS.find((x) => x.key === b.dataset.sc); qzStart(shuffle(scenarioPool(sc)), sc.label); }));
  $("#qzDrills").innerHTML = DRILLS.map((d) => `<button class="chipbtn" data-dr="${d.key}">${esc(d.label)} <span>∞</span></button>`).join("");
  $("#qzDrills").querySelectorAll("[data-dr]").forEach((b) => (b.onclick = () => { const d = DRILLS.find((x) => x.key === b.dataset.dr); qzStart(drillSet(d.key, Math.min(20, +$("#qzLen").value || 10)), d.label); }));
  $("#exStart").onclick = () => exStart(); renderForms();
  $("#qlDeck").onchange = $("#qlWhy").onchange = qlRender; qlRender();
  $("#qlCopy").onclick = () => { const ta = $("#qlText"); const n = ta.value.split("\n").length; navigator.clipboard?.writeText(ta.value).then(() => ($("#qlStatus").textContent = `Copied ${n} cards. Paste them into Quizlet's Import box.`), () => { ta.select(); $("#qlStatus").textContent = "Press Ctrl+C (⌘C) to copy the selected text."; }); };
  TABS.forEach((t) => $("#tab-" + t).addEventListener("click", () => showTab(t)));
  const hash = location.hash.slice(1);
  showTab(focus ? "guide" : TABS.includes(hash) ? hash : store.get("tab", "guide"), !focus);
}
boot();
