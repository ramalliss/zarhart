// Free plan limits. Zarhart Pro removes all of them.
//   Free: 3 practice questions and 3 flashcards a day (reset at local midnight), and the first
//   5 minutes of each lesson. Free flight, the study notes and the drills' explanations stay open.
//   await Limits.init(); Limits.on(); Limits.useQuestion(); Limits.seeFlashcard(id); Limits.lessonSecondsLeft(t)
//
// In the iPhone/Android app, Pro comes from the store (RevenueCat, assets/js/store.js).
// On the website the limits switch on only when WEB_PRO.verifyUrl is set, so nobody is limited
// before Pro can be bought there. Set it to the license-check service (tools/license-worker.js),
// and put the Pro checkout links in pricing/index.html.
//
// Testing on a local dev server: open any page with ?freelimits=1 to switch the limits on
// (?freelimits=0 turns them off), ?freelesson=20 to make lessons stop after 20 seconds,
// and ?freereset=1 to clear today's counts.

export const FREE = {
  questionsPerDay: 3,
  flashcardsPerDay: 3,
  lessonSeconds: 5 * 60,
  guideAnswers: false, // show every question with its answer in the study guide to free users?
  quizletExport: false, // let free users export the question bank to Quizlet?
};

export const WEB_PRO = {
  verifyUrl: "", // e.g. "https://zarhart-license.<you>.workers.dev"
  pricing: "../pricing/#t-pro",
};

const K = "zarhart:free";
const get = (k, d) => { try { const v = localStorage.getItem(`${K}:${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } };
const set = (k, v) => { try { localStorage.setItem(`${K}:${k}`, JSON.stringify(v)); } catch { /* storage off */ } };
const del = (k) => { try { localStorage.removeItem(`${K}:${k}`); } catch { /* storage off */ } };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

const st = { ready: false, active: false, pro: false, app: false, lessonSeconds: FREE.lessonSeconds, store: null };
const listeners = new Set();
const emit = () => { for (const fn of listeners) { try { fn(snapshot()); } catch (e) { console.error(e); } } };
export const snapshot = () => ({ ready: st.ready, on: on(), pro: st.pro, app: st.app, questionsLeft: questionsLeft(), flashcardsLeft: flashcardsLeft() });
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

let starting = null;
export function init() { return (starting ||= start()); }
async function start() {
  const params = new URLSearchParams(location.search);
  const dev = ["localhost", "127.0.0.1"].includes(location.hostname);
  if (dev) {
    if (params.get("freelimits") === "1") set("dev", true);
    if (params.get("freelimits") === "0") del("dev");
    if (params.has("freelesson")) set("devLesson", Math.max(5, +params.get("freelesson") || FREE.lessonSeconds));
    if (params.get("freereset") === "1") del("day");
  }
  const devOn = dev && get("dev", false);
  if (devOn) st.lessonSeconds = get("devLesson", FREE.lessonSeconds);

  if (window.ZARHART_APP) {
    st.app = true; st.active = true;
    try {
      const Store = await import("./store.js");
      await Store.init();
      st.store = Store; st.pro = Store.has("pro");
      Store.onChange((s) => { if (s.pro !== st.pro) { st.pro = s.pro; emit(); } });
    } catch (e) { console.error("Limits: store unavailable", e); }
  } else {
    st.active = !!WEB_PRO.verifyUrl || devOn;
    st.pro = webLicenseOk();
    if (st.active && WEB_PRO.verifyUrl && get("license", null)) recheckLicense();
  }
  st.ready = true; emit();
  return snapshot();
}

/** true when this person is on the free plan and the limits apply */
export const on = () => st.active && !st.pro;
export const isPro = () => st.pro;

function day() {
  const d = get("day", null);
  if (d && d.date === today()) return d;
  return { date: today(), q: 0, cards: [] };
}
export const questionsLeft = () => on() ? Math.max(0, FREE.questionsPerDay - day().q) : Infinity;
export const flashcardsLeft = () => on() ? Math.max(0, FREE.flashcardsPerDay - day().cards.length) : Infinity;

/** count one practice question shown; false when today's free questions are used up */
export function useQuestion() {
  if (!on()) return true;
  const d = day(); if (d.q >= FREE.questionsPerDay) return false;
  d.q++; set("day", d); emit(); return true;
}
/** a flashcard may be shown if it was already seen today or there are free cards left */
export function seeFlashcard(id) {
  if (!on()) return true;
  const d = day(); if (d.cards.includes(id)) return true;
  if (d.cards.length >= FREE.flashcardsPerDay) return false;
  d.cards.push(id); set("day", d); emit(); return true;
}
/** seconds left in a lesson that has run for `elapsed` seconds (Infinity with Pro) */
export const lessonSecondsLeft = (elapsed) => on() ? Math.max(0, st.lessonSeconds - elapsed) : Infinity;
export const lessonLimitSeconds = () => st.lessonSeconds;

/** where "Get Pro" goes: the app's store page, or the website's pricing page */
export const upgradeHref = (base = "..") => st.app ? `${base}/pack/#proTitle` : WEB_PRO.pricing.replace(/^\.\./, base);

/* ---------- website: Pro license keys ---------- */
const LICENSE_DAYS = 7; // recheck a key with the service at most once a week
function webLicenseOk() { const l = get("license", null); return !!(l && l.valid && l.key); }
async function check(key) {
  const r = await fetch(WEB_PRO.verifyUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ license_key: key }) });
  if (!r.ok && r.status !== 400) throw new Error(`HTTP ${r.status}`);
  const j = await r.json(); return !!j.valid;
}
async function recheckLicense() {
  const l = get("license", null); if (!l || Date.now() - (l.checked || 0) < LICENSE_DAYS * 864e5) return;
  try { const valid = await check(l.key); set("license", { ...l, valid, checked: Date.now() }); if (st.pro !== valid) { st.pro = valid; emit(); } }
  catch { /* offline or service down: keep the last answer */ }
}
/** website only: unlock Pro on this browser with the license key from the Pro receipt */
export async function redeem(key) {
  key = String(key || "").trim();
  if (!key) return { ok: false, error: "Paste the license key from your Pro receipt." };
  if (!WEB_PRO.verifyUrl) return { ok: false, error: "Pro isn't on sale on the website yet." };
  try {
    const valid = await check(key);
    if (!valid) return { ok: false, error: "That key isn't an active Zarhart Pro license. Check it against your receipt." };
    set("license", { key, valid: true, checked: Date.now() }); st.pro = true; emit();
    return { ok: true };
  } catch { return { ok: false, error: "Couldn't check the key. Check your connection and try again." }; }
}

/* ---------- the paywall panel used by the study pages ---------- */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
/** HTML for a "you've hit the free limit" panel; wire it up afterwards with bindPaywall(root) */
export function paywallHTML(title, body, base = "..") {
  return `<div class="paywall" role="region" aria-label="Zarhart Pro"><p class="eyebrow">Zarhart Pro</p><h3>${esc(title)}</h3><p>${esc(body)}</p>
    <div class="actions"><a class="btn primary" href="${esc(upgradeHref(base))}">Get Zarhart Pro</a></div>
    ${!st.app && WEB_PRO.verifyUrl ? `<form class="redeem"><label>Already have Pro? Paste your license key<input name="key" autocomplete="off" spellcheck="false" placeholder="License key"></label><button class="btn" type="submit">Unlock</button><p class="msg" aria-live="polite"></p></form>` : ""}</div>`;
}
export function bindPaywall(root, onUnlock) {
  const f = root?.querySelector(".paywall form.redeem"); if (!f) return;
  f.onsubmit = async (e) => {
    e.preventDefault(); const msg = f.querySelector(".msg"), btn = f.querySelector("button");
    btn.disabled = true; msg.textContent = "Checking…";
    const r = await redeem(f.key.value); btn.disabled = false;
    msg.textContent = r.ok ? "Pro unlocked on this browser. Thank you!" : r.error;
    if (r.ok && onUnlock) onUnlock();
  };
}
