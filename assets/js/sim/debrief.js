// The instructor's notes, without the AI: a flight recorder, a mistake finder that marks moments in the recording
// (too fast on final, steep bank low down, a late flare, a long or hard landing, drifting off the centreline), and free
// callouts while you fly. The AI debrief (later, on a server) reads the same recording and moments.
// No three.js here, so Node can test it (tools/test-debrief.mjs).

import { rectDist } from "./world-data.js";

const DEG = Math.PI / 180, FT = 0.3048, NM = 1852;
const wrap180 = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
const r1 = (v) => Math.round(v * 10) / 10;

/* ---------------- recorder ---------------- */

/**
 * A few samples a second of what an instructor watches, plus events (touchdown, liftoff, crash). One sample:
 * { t (s), ias (kt), alt (indicated ft), agl (ft), vs (fpm), pitch, bank, hdg (deg), x, z (m), thr (0..1), flaps (deg),
 *   gnd (on the ground), aoa (deg), sw (stall warning), g }
 */
export class FlightRecorder {
  constructor(hz = 4, maxSec = 3600) { this.dt = 1 / hz; this.max = Math.round(maxSec * hz); this.reset(); }
  reset(meta = {}) { this.samples = []; this.events = []; this.meta = meta; this.next = -Infinity; this.t0 = null; }
  /** call every physics step with the sim time and the flight model's derived values; keeps one sample per 1/hz s */
  tick(t, d, pos, ctl) {
    if (t < this.next) return false;
    this.next = Math.max(this.next + this.dt, t + this.dt * 0.5); // steady rate, no burst after a pause
    if (this.t0 == null) this.t0 = t;
    this.samples.push({
      t: Math.round(t * 100) / 100, ias: r1(d.ias), alt: Math.round(d.altInd), agl: Math.round(d.agl), vs: Math.round(d.vsTrue),
      pitch: r1(d.pitch), bank: r1(d.bank), hdg: r1(d.hdg), x: Math.round(pos.x), z: Math.round(pos.z),
      thr: Math.round((ctl?.throttle ?? d.throttle ?? 0) * 100) / 100, flaps: d.flaps ?? 0, gnd: !!d.onGround,
      aoa: r1(d.aoa ?? 0), sw: !!d.stallWarn, g: Math.round((d.g ?? 1) * 100) / 100,
    });
    if (this.samples.length > this.max) this.samples.splice(0, this.samples.length - this.max);
    return true;
  }
  event(t, type, data = {}) { this.events.push({ t: Math.round(t * 100) / 100, type, ...data }); }
  /** what a debrief request sends */
  toJSON() { return { hz: Math.round(1 / this.dt), meta: this.meta, t0: this.t0, samples: this.samples, events: this.events }; }
}

/* ---------------- runway geometry ---------------- */

/** metres past the threshold along the landing direction (negative = short of it) */
export const alongRunway = (e, x, z) => { const h = e.hdg * DEG; return (x - e.x) * Math.sin(h) - (z - e.z) * Math.cos(h); };
/** metres right of the centreline (negative = left), looking along the landing direction */
export const acrossRunway = (e, x, z) => { const h = e.hdg * DEG; return (x - e.x) * Math.cos(h) + (z - e.z) * Math.sin(h); };

/** the runway end a touchdown at (x, z) heading `hdg` landed on, or null when it is off every runway */
export function landingRunway(airports, x, z, hdg) {
  let best = null;
  for (const ap of airports) for (const r of ap.runways) {
    if (rectDist(x, z, r) > 2) continue;
    for (const e of r.ends) {
      const off = Math.abs(wrap180(hdg - e.hdg));
      if (!best || off < best.off) best = { off, end: { airport: ap.id, id: e.id, x: e.x, z: e.z, hdg: e.hdg, len: r.len, wid: r.wid } };
    }
  }
  return best?.end ?? null;
}

/** the runway end you're on final for (ahead, lined up, within 3 NM), or null */
export function finalRunway(airports, x, z, hdg) {
  let best = null;
  for (const ap of airports) for (const r of ap.runways) for (const e of r.ends) {
    const along = alongRunway(e, x, z), across = acrossRunway(e, x, z);
    if (along > 100 || along < -3 * NM || Math.abs(across) > 600 + 0.15 * -along || Math.abs(wrap180(hdg - e.hdg)) > 30) continue;
    if (!best || -along < best.dist) best = { dist: -along, end: { airport: ap.id, id: e.id, x: e.x, z: e.z, hdg: e.hdg, len: r.len, wid: r.wid } };
  }
  return best?.end ?? null;
}

/* ---------------- mistake finder ---------------- */

/**
 * target approach speed: the lesson's own (a short-field approach is slower), else the type's final-approach speed and 5 kt
 * more with the flaps up; plus half the gust factor
 */
const appSpeed = (V, flaps, ctx = {}) => Math.round((ctx.appKt ?? (V.app ?? 65) + (flaps < 10 ? 5 : 0)) + (ctx.gustAdd ?? 0));

/** the worst sample of each run of consecutive samples that match `test` (runs split by gaps over 1.5 s) */
function runs(samples, test, worse) {
  const out = []; let cur = null, prevT = -Infinity;
  for (const s of samples) {
    if (test(s)) {
      if (cur && s.t - prevT <= 1.5) { cur.n++; cur.end = s.t; cur.last = s; if (worse(s, cur.worst)) cur.worst = s; }
      else { cur = { start: s.t, end: s.t, n: 1, worst: s, first: s, last: s }; out.push(cur); }
      prevT = s.t;
    }
  }
  return out;
}
/** runs that last at least `secs`, merged into one: the worst sample, and the heights it started and ended at */
function sustained(rs, worse, secs = 1.5) {
  const ok = rs.filter((r) => r.end - r.start >= secs); if (!ok.length) return null;
  let w = ok[0].worst; for (const r of ok) if (worse(r.worst, w)) w = r.worst;
  return { worst: w, top: ok[0].first.agl, bottom: ok.at(-1).last.agl };
}
const span = (m) => (m.top - m.bottom >= 100 ? `, from ${m.top} ft down to ${m.bottom} ft` : "");

/**
 * Moments an instructor would point at, in time order. Each: { t, kind, level ("warn" for safety, "tip" for technique),
 * title, detail, fix, td (the touchdown it belongs to, if any) }.
 * @param rec a FlightRecorder (or its toJSON())
 * @param ctx { V: the airplane's V-speeds (app, s0, s1, fe), airports: AIRPORTS, appKt: the lesson's approach speed,
 *   gustAdd: kt added for gusts (half the gust factor), skip: kinds this lesson expects (the stall horn in a stall lesson) }
 */
export function findMistakes(rec, ctx) {
  const S = rec.samples, V = ctx.V || {}, out = [], skip = new Set(ctx.skip || []);
  const add = (m) => { if (!skip.has(m.kind)) out.push(m); };
  const tds = rec.events.filter((e) => e.type === "touchdown");
  const air = (s) => !s.gnd;

  // anywhere in the flight: the stall warning, and steep bank close to the ground
  const inFlare = (s) => s.agl < 60 && tds.some((e) => s.t <= e.t && s.t > e.t - 10); // the horn often sounds as you hold off
  for (const r of runs(S, (s) => air(s) && s.sw && s.agl > 20 && !inFlare(s), (a, b) => a.aoa > b.aoa)) {
    const s = r.worst;
    add({ t: r.start, kind: "stallWarn", level: "warn", title: "Stall warning", detail: `The stall warning sounded at ${s.agl.toLocaleString()} ft above the ground, ${Math.round(s.ias)} KIAS${r.end - r.start >= 1 ? `, for ${Math.round(r.end - r.start + 0.25)} s` : ""}.`, fix: "Lower the nose first to get the wing flying again, then add power." });
  }
  for (const r of runs(S, (s) => air(s) && s.agl > 15 && s.agl < 600 && Math.abs(s.bank) > 30, (a, b) => Math.abs(a.bank) > Math.abs(b.bank))) {
    const s = r.worst;
    add({ t: s.t, kind: "steepLow", level: "warn", title: "Steep bank close to the ground", detail: `${Math.round(Math.abs(s.bank))}° of bank at ${s.agl} ft above the ground.`, fix: "Below 600 ft keep the bank at 30° or less. If you overshoot the turn to final, go around rather than tighten it." });
  }

  // each landing: the approach before it, the flare and the touchdown
  for (const td of tds) {
    const rwy = td.rwy || landingRunway(ctx.airports || [], td.x, td.z, td.hdg ?? 0);
    const before = (s) => s.t <= td.t && s.t >= td.t - 180;
    const label = (t) => { const d = Math.round(td.t - t); return d <= 0 ? "At touchdown" : d < 60 ? `${d} s before touchdown` : `${Math.floor(d / 60)}:${String(d % 60).padStart(2, "0")} before touchdown`; };
    const tag = (m) => add({ ...m, td: td.t, when: label(m.t) });
    if (!rwy) {
      const ahead = finalRunway(ctx.airports || [], td.x, td.z, td.hdg ?? 0), short = ahead && alongRunway(ahead, td.x, td.z) < 0 && Math.abs(acrossRunway(ahead, td.x, td.z)) < ahead.wid ? -alongRunway(ahead, td.x, td.z) : null;
      if (short != null) tag({ t: td.t, kind: "short", level: "warn", title: "Short of the runway", detail: `Touched down ${Math.round(short / FT).toLocaleString()} ft before the threshold of runway ${ahead.id}.`, fix: "Keep your aiming point fixed in the windshield; if it moves up, you're getting low: add power." });
      else tag({ t: td.t, kind: "offRunway", level: "warn", title: "Off the runway", detail: "The wheels touched down outside the runway.", fix: "Line up with the runway on a long final and keep the centreline under the nose all the way down." });
      continue;
    }

    // on final: lined up with this runway, within 2.5 NM, below 800 ft
    const fin = S.filter((s) => before(s) && air(s) && s.agl < 800 && Math.abs(wrap180(s.hdg - rwy.hdg)) < 30
      && alongRunway(rwy, s.x, s.z) > -2.5 * NM && alongRunway(rwy, s.x, s.z) < 300 && Math.abs(acrossRunway(rwy, s.x, s.z)) < 500);
    // stable-approach checks from 500 ft down to 100 ft: speed within +10/−5 kt of the target, sink under 1,000 fpm
    const band = fin.filter((s) => s.agl >= 100 && s.agl <= 500), tgtOf = (s) => appSpeed(V, s.flaps, ctx);
    const fast = sustained(runs(band, (s) => s.ias > tgtOf(s) + 10, (a, b) => a.ias - tgtOf(a) > b.ias - tgtOf(b)), (a, b) => a.ias - tgtOf(a) > b.ias - tgtOf(b));
    if (fast) { const s = fast.worst, tgt = tgtOf(s); tag({ t: s.t, kind: "fastFinal", level: "tip", title: "Fast on final", detail: `${Math.round(s.ias)} KIAS at ${s.agl} ft, ${Math.round(s.ias - tgt)} kt above the ${tgt} to aim for${span(fast)}.`, fix: `Pitch for ${tgt} KIAS on final and hold it; use power for the glide path. Extra speed makes you float down the runway.` }); }
    const slow = sustained(runs(band, (s) => s.ias < tgtOf(s) - 5, (a, b) => a.ias - tgtOf(a) < b.ias - tgtOf(b)), (a, b) => a.ias - tgtOf(a) < b.ias - tgtOf(b));
    if (slow) { const s = slow.worst, tgt = tgtOf(s); tag({ t: s.t, kind: "slowFinal", level: "warn", title: "Slow on final", detail: `${Math.round(s.ias)} KIAS at ${s.agl} ft, ${Math.round(tgt - s.ias)} kt below the ${tgt} to aim for${span(slow)}.`, fix: "Lower the nose to get the speed back, and add power to hold the glide path. Slow and low is how stalls near the ground happen." }); }
    const sink = sustained(runs(band, (s) => s.vs < -1000, (a, b) => a.vs < b.vs), (a, b) => a.vs < b.vs);
    if (sink) { const s = sink.worst; tag({ t: s.t, kind: "sinkRate", level: "warn", title: "Sinking fast on final", detail: `${Math.abs(s.vs).toLocaleString()} fpm down at ${s.agl} ft${span(sink)}.`, fix: "On a stable approach you sink about 500–700 fpm. Add power and raise the nose slightly; if it doesn't settle by 300 ft, go around." }); }

    // the flare: sink rate around 50 ft against the sink rate just before touchdown
    const flare = S.filter((s) => before(s) && air(s) && s.t >= td.t - 30);
    const at = (lo, hi) => { const v = flare.filter((s) => s.agl >= lo && s.agl <= hi); return v.length ? v.reduce((a, s) => a + s.vs, 0) / v.length : null; };
    const vs50 = at(30, 70), vs10 = at(3, 12);
    if (td.fpm >= 400 && vs50 != null && vs10 != null && vs10 <= vs50 * 0.8) {
      tag({ t: flare.filter((s) => s.agl <= 12).at(0)?.t ?? td.t, kind: "lateFlare", level: "tip", title: "Late flare", detail: `Still sinking ${Math.round(-vs10)} fpm at 10 ft, ${vs10 <= vs50 ? "faster than" : "nearly as fast as"} at 50 ft (${Math.round(-vs50)} fpm).`, fix: "Start the flare at 10–15 ft: ease back so the sink rate slows, and keep easing back as the airplane settles." });
    }
    const high = runs(flare, (s) => s.agl > 15 && s.agl < 60 && s.vs > -100, (a, b) => a.agl > b.agl).find((r) => r.end - r.start >= 2);
    if (high) tag({ t: high.start, kind: "highFlare", level: "tip", title: high.worst.vs > 200 ? "Ballooned" : "Flared too high", detail: `Levelled off ${high.worst.vs > 200 ? "and climbed " : ""}at about ${high.worst.agl} ft, then had to come down from there.`, fix: "Hold the approach attitude until 10–15 ft, then flare smoothly. If you balloon, hold the attitude and add a little power." });

    // touchdown
    if (td.fpm >= 400) tag({ t: td.t, kind: "hardLanding", level: td.fpm >= 650 ? "warn" : "tip", title: td.fpm >= 650 ? "Hard landing" : "Firm landing", detail: `Touched down at ${td.fpm} fpm${td.fpm >= 650 ? "; above about 1,100 fpm the gear can collapse" : ""}.`, fix: "A slower sink at touchdown comes from a stable approach and a flare that keeps easing back until the wheels touch." });
    const along = alongRunway(rwy, td.x, td.z), across = acrossRunway(rwy, td.x, td.z), longM = Math.max(1000 * FT, rwy.len / 3);
    if (along > longM) tag({ t: td.t, kind: "long", level: along > rwy.len / 2 ? "warn" : "tip", title: "Long landing", detail: `Touched down ${Math.round(along / FT).toLocaleString()} ft past the threshold, with ${Math.round((rwy.len - along) / FT).toLocaleString()} ft of runway left.`, fix: "Aim for the first third of the runway. Arrive at the threshold at your approach speed, not faster, and don't hold the airplane off with power." });
    if (Math.abs(across) > Math.max(3, rwy.wid * 0.15)) tag({ t: td.t, kind: "centreline", level: Math.abs(across) > rwy.wid * 0.35 ? "warn" : "tip", title: "Off the centreline", detail: `${Math.abs(across).toFixed(1)} m ${across < 0 ? "left" : "right"} of the centreline at touchdown.`, fix: "Line up early on final, then keep the nose on the centreline with rudder and correct drift with aileron into the wind." });
    if (td.hdg != null && Math.abs(wrap180(td.hdg - rwy.hdg)) > 5) { const c = wrap180(td.hdg - rwy.hdg); tag({ t: td.t, kind: "crab", level: "tip", title: "Touched down crabbed", detail: `The nose pointed ${Math.abs(c).toFixed(0)}° ${c < 0 ? "left" : "right"} of the runway at touchdown.`, fix: "In a crosswind, just before touchdown use rudder to line the nose up with the runway and aileron into the wind to stop the drift." }); }
    if (td.kias > (ctx.appKt ?? V.app ?? 65) - 3) tag({ t: td.t, kind: "fastTouchdown", level: "tip", title: "Fast touchdown", detail: `${td.kias} KIAS at touchdown; it should be close to stall speed${V.s0 ? ` (${V.s0} KIAS with full flaps)` : ""}.`, fix: "Keep easing back in the flare so the airplane slows and settles on the main wheels." });
    const bounce = S.find((s) => s.t > td.t + 0.2 && s.t < td.t + 4 && !s.gnd && s.agl > 2);
    if (bounce) tag({ t: bounce.t, kind: "bounce", level: "warn", title: "Bounced", detail: `Back in the air after touching down, up to ${Math.max(...S.filter((s) => s.t > td.t && s.t < td.t + 4).map((s) => s.agl))} ft.`, fix: "Hold the landing attitude and let it settle; after a big bounce, add full power and go around." });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** the single most useful thing to try next time: the first safety item, else the first technique item */
export const nextTry = (moments) => (moments.find((m) => m.level === "warn") || moments[0])?.fix ?? null;

/* ---------------- free callouts while flying ---------------- */

/** short callouts at the moments that matter: each at most once every `gap` seconds, and at most `max` times per approach */
export class LiveCoach {
  constructor(gap = 12, max = 2) { this.gap = gap; this.max = max; this.last = {}; this.n = {}; }
  /** call at each touchdown and new flight */
  reset() { this.last = {}; this.n = {}; }
  /** one sample (as recorded) → a callout { kind, text } or null */
  update(s, ctx) {
    if (s.gnd || s.agl < 20) return null;
    const say = (kind, text) => {
      if (s.t - (this.last[kind] ?? -Infinity) < this.gap || (this.n[kind] ?? 0) >= this.max) return null;
      this.last[kind] = s.t; this.n[kind] = (this.n[kind] ?? 0) + 1; return { kind, text };
    };
    if (s.agl < 600 && Math.abs(s.bank) > 35) return say("bank", `Bank angle: ${Math.round(Math.abs(s.bank))}° this low.`);
    if (s.agl > 800) return null;
    const rwy = finalRunway(ctx.airports || [], s.x, s.z, s.hdg); if (!rwy || s.agl < 50) return null;
    const tgt = appSpeed(ctx.V || {}, s.flaps, ctx);
    if (s.ias < tgt - 7) return say("slow", `Airspeed ${Math.round(s.ias)}: lower the nose, aim for ${tgt}.`);
    if (s.vs < -1100 && s.agl < 500) return say("sink", `Sink rate ${Math.abs(Math.round(s.vs / 100) * 100)}.`);
    if (s.ias > tgt + 12 && s.agl < 500) return say("fast", `Airspeed ${Math.round(s.ias)}: aim for ${tgt}.`);
    return null;
  }
}
