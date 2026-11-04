// Checks for the flight recorder, the mistake finder and the live callouts, on synthetic approaches to Zarhart Field
// runway 27. Run: node tools/test-debrief.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { FlightRecorder, findMistakes, nextTry, LiveCoach, landingRunway, finalRunway, alongRunway, acrossRunway } from "../assets/js/sim/debrief.js";
import { AIRPORTS } from "../assets/js/sim/world-data.js";

const FT = 0.3048, NM = 1852, KT = 0.514444, DEG = Math.PI / 180;
const V = { app: 65, s0: 41, s1: 47, fe: 85 };
const ctx = { V, airports: AIRPORTS };
const KZAR = AIRPORTS[0], R27 = KZAR.runways[0].ends.find((e) => e.id === "27");

/**
 * A synthetic flight down a 3° glide path to runway 27, then 6 s of roll-out, recorded the way the sim records it.
 * o: ias on final, finalIas(aglFt) to vary it, flareFt (where the flare starts), tdFpm, tdKias, tdAlongM, tdAcrossM,
 *    tdHdg, bounce, levelAt (ft to level off at for 3 s), extra(t, d) to change a sample (a steep turn, a stall warning)
 */
function fly(o = {}) {
  const rec = new FlightRecorder(4);
  const ias0 = o.ias ?? 65, flareFt = o.flareFt ?? 15, tdFpm = o.tdFpm ?? 150, tdKias = o.tdKias ?? 55;
  const tdAlong = o.tdAlongM ?? 150, across = o.tdAcrossM ?? 0, hdgTd = o.tdHdg ?? 270, dt = 1 / 60;
  const h = R27.hdg * DEG, ax = Math.sin(h), az = -Math.cos(h), cx = Math.cos(h), cz = Math.sin(h);
  let along = tdAlong - 3 * NM, agl = Math.tan(3 * DEG) * (tdAlong - along) / FT, t = 100, vs = 0, ias = ias0;
  const pos = () => ({ x: R27.x + ax * along + cx * across, z: R27.z + az * along + cz * across });
  const sample = (gnd) => {
    const d = { ias, altInd: agl + 1150, agl, vsTrue: vs, pitch: gnd ? 0 : -2, bank: 0, hdg: gnd ? hdgTd : 270, aoa: 4, stallWarn: false, g: 1, flaps: 30, onGround: gnd, throttle: 0.3 };
    o.extra?.(t, d); rec.tick(t, d, pos(), { throttle: 0.3 });
  };
  while (agl > 0) {
    ias = agl > flareFt ? (o.finalIas ? o.finalIas(agl) : ias0) : tdKias + (ias - tdKias) * 0.97;
    const glideVs = -ias * KT * Math.sin(3 * DEG) / FT * 60;
    vs = agl > flareFt ? glideVs : -tdFpm + (glideVs + tdFpm) * Math.max(0, agl / flareFt);
    if (o.late && agl <= flareFt) vs = -tdFpm; // no flare: the sink rate stays until the wheels touch
    if (o.levelAt && agl <= o.levelAt && (o.levelT = (o.levelT ?? 0) + dt) < 3) vs = 0; // flared high: level for 3 s
    agl += (vs / 60) * dt / 1; along += ias * KT * dt; t += dt;
    if (agl <= 0) break;
    sample(false);
  }
  agl = 0; vs = 0; ias = tdKias; const p = pos();
  rec.event(t, "touchdown", { fpm: tdFpm, kias: Math.round(tdKias), x: p.x, z: p.z, hdg: hdgTd });
  for (let k = 0; k < 6 * 60; k++) { t += dt; along += ias * KT * dt; ias = Math.max(0, ias - 6 * dt); agl = o.bounce && k > 30 && k < 90 ? 6 : 0; sample(agl === 0); }
  return rec;
}
const kinds = (rec) => findMistakes(rec, ctx).map((m) => m.kind);

test("recorder: 4 samples a second, compact, capped", () => {
  const r = new FlightRecorder(4, 5);
  for (let t = 0; t < 10; t += 1 / 60) r.tick(t, { ias: 64.96, altInd: 1500.4, agl: 350.2, vsTrue: -512.7, pitch: 1.234, bank: -3.21, hdg: 270.04, flaps: 20, onGround: false, aoa: 5.55, stallWarn: false, g: 1.016 }, { x: 10.4, z: -3.6 }, { throttle: 0.456 });
  assert.equal(r.samples.length, 20, "capped at 5 s × 4 Hz");
  const s = r.samples.at(-1);
  assert.deepEqual(Object.keys(s).sort(), ["agl", "alt", "aoa", "bank", "flaps", "g", "gnd", "hdg", "ias", "pitch", "sw", "t", "thr", "vs", "x", "z"]);
  assert.equal(s.ias, 65); assert.equal(s.vs, -513); assert.equal(s.thr, 0.46); assert.equal(s.x, 10);
  const gaps = r.samples.slice(1).map((x, i) => x.t - r.samples[i].t);
  assert.ok(gaps.every((g) => g > 0.24 && g < 0.27), `steady 4 Hz: ${gaps.join(",")}`);
  const j = JSON.parse(JSON.stringify(r)); assert.equal(j.hz, 4); assert.equal(j.samples.length, 20);
});

test("runway geometry: landing on 27 and on final for 27", () => {
  assert.equal(alongRunway(R27, R27.x - 100, R27.z), 100, "west of the 27 threshold is past it");
  assert.equal(Math.round(acrossRunway(R27, R27.x, R27.z - 10)), 10, "north is right of 27");
  const land = landingRunway(AIRPORTS, R27.x - 200, R27.z + 3, 268);
  assert.equal(land?.id, "27"); assert.equal(land.airport, "KZAR");
  assert.equal(landingRunway(AIRPORTS, R27.x - 200, R27.z + 3, 92)?.id, "09", "the same pavement the other way");
  assert.equal(landingRunway(AIRPORTS, R27.x - 200, R27.z + 300, 270), null, "in the grass");
  assert.equal(finalRunway(AIRPORTS, R27.x + 2000, R27.z, 272)?.id, "27");
  assert.equal(finalRunway(AIRPORTS, R27.x + 2000, R27.z, 90), null, "flying away from it");
  assert.equal(finalRunway(AIRPORTS, R27.x + 2000, R27.z + 1500, 270), null, "well off to the side");
});

test("a good approach and landing: nothing to point at", () => {
  const m = findMistakes(fly(), ctx);
  assert.deepEqual(m, [], JSON.stringify(m, null, 1));
  assert.equal(nextTry(m), null);
});

test("fast on final: one moment, at the fastest point, before touchdown", () => {
  const m = findMistakes(fly({ finalIas: (agl) => (agl > 200 && agl < 400 ? 80 : 65) }), ctx);
  const f = m.filter((x) => x.kind === "fastFinal");
  assert.equal(f.length, 1, JSON.stringify(m));
  assert.match(f[0].detail, /^80 KIAS at \d+ ft, 15 kt above the 65/);
  assert.match(f[0].when, /before touchdown$/); assert.equal(f[0].level, "tip");
});

test("slow on final is a safety item and comes first in Next try", () => {
  const m = findMistakes(fly({ finalIas: (agl) => (agl < 300 ? 57 : 65), tdAlongM: 700 }), ctx);
  assert.ok(m.some((x) => x.kind === "slowFinal" && x.level === "warn"), JSON.stringify(m));
  assert.match(nextTry(m), /Lower the nose/);
});

test("late flare and firm landing", () => {
  const k = kinds(fly({ late: true, flareFt: 3, tdFpm: 480 }));
  assert.ok(k.includes("lateFlare") && k.includes("hardLanding"), k.join());
  assert.match(findMistakes(fly({ late: true, flareFt: 3, tdFpm: 480 }), ctx).find((x) => x.kind === "lateFlare").detail, /^Still sinking 3\d\d fpm at 10 ft, faster than at 50 ft \(3\d\d fpm\)\.$/);
  const hard = findMistakes(fly({ late: true, flareFt: 3, tdFpm: 700 }), ctx).find((x) => x.kind === "hardLanding");
  assert.equal(hard.level, "warn"); assert.equal(hard.title, "Hard landing");
});

test("flared too high", () => {
  const k = kinds(fly({ levelAt: 30 }));
  assert.ok(k.includes("highFlare"), k.join());
});

test("long landing, short landing, centreline, crab, fast touchdown, bounce", () => {
  assert.ok(kinds(fly({ tdAlongM: 600 })).includes("long"));
  assert.equal(findMistakes(fly({ tdAlongM: 900 }), ctx).find((x) => x.kind === "long").level, "warn", "past half the runway");
  assert.match(findMistakes(fly({ tdAlongM: -150 }), ctx).find((x) => x.kind === "short")?.detail ?? "", /^Touched down 3\d\d ft before the threshold of runway 27/, "the flare floats about 40 m, so this lands about 110 m short");
  const c = findMistakes(fly({ tdAcrossM: -6 }), ctx).find((x) => x.kind === "centreline");
  assert.match(c.detail, /^6\.0 m left/); assert.equal(c.level, "tip");
  assert.equal(findMistakes(fly({ tdAcrossM: 12 }), ctx).find((x) => x.kind === "centreline").level, "warn");
  assert.match(findMistakes(fly({ tdHdg: 262 }), ctx).find((x) => x.kind === "crab").detail, /8° left/);
  assert.ok(kinds(fly({ tdKias: 66 })).includes("fastTouchdown"));
  assert.ok(kinds(fly({ bounce: true })).includes("bounce"));
});

test("steep bank low, stall warning, and off the runway", () => {
  const steep = findMistakes(fly({ extra: (t, d) => { if (d.agl > 380 && d.agl < 420) d.bank = -42; } }), ctx).find((x) => x.kind === "steepLow");
  assert.match(steep?.detail ?? "", /^42° of bank at \d+ ft/);
  assert.ok(kinds(fly({ extra: (t, d) => { if (d.agl > 600 && d.agl < 650) d.stallWarn = true; } })).includes("stallWarn"));
  assert.deepEqual(kinds(fly({ tdAcrossM: 80 })).filter((k) => k === "offRunway"), ["offRunway"]);
});

test("moments come in time order with labels", () => {
  const m = findMistakes(fly({ finalIas: (agl) => (agl > 200 && agl < 400 ? 80 : 65), tdAlongM: 600, tdAcrossM: 5 }), ctx);
  assert.deepEqual(m.map((x) => x.t), [...m.map((x) => x.t)].sort((a, b) => a - b));
  assert.equal(m.at(-1).when, "At touchdown");
});

test("live callouts: on final, rate-limited, never on the ground", () => {
  const c = new LiveCoach(12, 2), s = { t: 0, ias: 80, agl: 300, vs: -500, bank: 0, hdg: 270, x: R27.x + 1600, z: R27.z, flaps: 30, gnd: false };
  assert.deepEqual(c.update(s, ctx), { kind: "fast", text: "Airspeed 80: aim for 65." });
  assert.equal(c.update({ ...s, t: 5 }, ctx), null, "not again within 12 s");
  assert.equal(c.update({ ...s, t: 13 }, ctx)?.kind, "fast");
  assert.equal(c.update({ ...s, t: 26 }, ctx), null, "twice per approach is enough");
  c.reset(); assert.equal(c.update({ ...s, t: 27 }, ctx)?.kind, "fast", "a new approach starts over");
  assert.equal(c.update({ ...s, t: 30, ias: 56 }, ctx)?.kind, "slow");
  assert.equal(c.update({ ...s, t: 40, ias: 65, vs: -1300 }, ctx)?.text, "Sink rate 1300.");
  assert.equal(c.update({ ...s, t: 60, ias: 65 }, ctx), null, "stable: quiet");
  assert.equal(c.update({ ...s, t: 80, gnd: true, agl: 0 }, ctx), null);
  assert.match(c.update({ ...s, t: 90, ias: 65, x: 3000, z: 3000, hdg: 0, bank: 40 }, ctx)?.text ?? "", /^Bank angle: 40°/);
  assert.equal(c.update({ ...s, t: 100, ias: 90, x: 3000, z: 3000, hdg: 0 }, ctx), null, "fast but not on final");
});

test("calibration: one note per kind with its span, gusts, a lesson's own speed, expected items skipped", () => {
  const twoFast = fly({ finalIas: (agl) => (agl > 420 || (agl > 150 && agl < 300) ? 80 : 65) });
  const f = findMistakes(twoFast, ctx).filter((x) => x.kind === "fastFinal");
  assert.equal(f.length, 1, "two fast stretches make one note");
  assert.match(f[0].detail, /, from \d{3} ft down to \d{3} ft\.$/);
  assert.equal(findMistakes(fly({ finalIas: (agl) => (agl < 300 && agl > 290 ? 80 : 65) }), ctx).filter((x) => x.kind === "fastFinal").length, 0, "a gust spike under 1.5 s is not a note");
  assert.equal(kinds(fly({ ias: 77 })).includes("fastFinal"), true);
  assert.equal(findMistakes(fly({ ias: 77 }), { ...ctx, gustAdd: 4 }).some((x) => x.kind === "fastFinal"), false, "65 + 4 for gusts + 10 = 79");
  assert.equal(findMistakes(fly({ ias: 60 }), { ...ctx, appKt: 60 }).some((x) => x.kind === "slowFinal"), false, "short-field 60 KIAS is on speed");
  assert.equal(kinds(fly({ ias: 58 })).includes("slowFinal"), true);
  const horn = { extra: (t, d) => { if (d.agl > 600 && d.agl < 650) d.stallWarn = true; } };
  assert.equal(findMistakes(fly(horn), { ...ctx, skip: ["stallWarn"] }).some((x) => x.kind === "stallWarn"), false, "a stall lesson expects the horn");
  assert.equal(kinds(fly({ extra: (t, d) => { if (d.agl > 0 && d.agl < 40) d.stallWarn = true; } })).includes("stallWarn"), false, "the horn in the flare is normal");
});
