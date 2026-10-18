// Exam-linked lessons. Each lesson sets up a scenario and checks objectives in order.
import * as THREE from "three";
import { AIRPORTS, NAVAIDS, rectDist, heightAt } from "./world-data.js";
import { FT, KT } from "./fdm.js";
import { PRESETS } from "./weather.js";
import { wrap180 } from "./nav.js";

const DEG = Math.PI / 180, NM = 1852;
const [KZAR, KAME, Z19] = AIRPORTS;
const ZRH = NAVAIDS[0];
const end = (ap, id) => { for (const r of ap.runways) for (const e of r.ends) if (e.id === id) return { ...e, rwy: r }; return null; };
/** spawn on final: distNm from the threshold of runway `id`, on a 3° path */
function onFinal(ap, id, distNm, kias = 70, flaps = 20) {
  const e = end(ap, id); const h = e.hdg * DEG; const fx = Math.sin(h), fz = -Math.cos(h);
  const d = distNm * NM;
  return { x: e.x - fx * d, z: e.z - fz * d, hdg: e.hdg, onGround: false, altFt: ap.elevFt + Math.tan(3 * DEG) * (d + 225) / FT, kias, flaps, pitch: -1 };
}
const onRunwaySurface = (ap, x, z) => ap.runways.some((r) => rectDist(x, z, r) <= 0);
const distFromThreshold = (e, x, z) => { const h = e.hdg * DEG; return (x - e.x) * Math.sin(h) + (z - e.z) * -Math.cos(h); };
const centerOffset = (e, x, z) => { const h = e.hdg * DEG; return (x - e.x) * Math.cos(h) + (z - e.z) * Math.sin(h); };
const nmTo = (sim, x, z) => Math.hypot(sim.ac.pos.x - x, sim.ac.pos.z - z) / NM;
const landedOn = (sim, ap, id) => { const td = sim.lastTouchdown; if (!td || td.used) return false; if (!onRunwaySurface(ap, td.x, td.z)) return false; if (id) { const e = end(ap, id); if (Math.abs(wrap180(sim.d.hdg - e.hdg)) > 40) return false; } return true; };
const offRunway = (ap) => (sim) => { const td = sim.lastTouchdown; return td && !td.used && !onRunwaySurface(ap, td.x, td.z) ? "Touched down off the runway." : null; };
function grade(fpm) { return fpm < 200 ? "Smooth" : fpm < 400 ? "Good" : fpm < 650 ? "Firm" : "Hard"; }
function touchdownReport(sim, ap, id) {
  const td = sim.lastTouchdown; if (!td) return "No touchdown recorded.";
  const e = end(ap, id); const off = centerOffset(e, td.x, td.z), along = distFromThreshold(e, td.x, td.z);
  return `Touchdown ${td.fpm} fpm (${grade(td.fpm)}), ${td.kias} KIAS, ${Math.abs(off).toFixed(1)} m ${off < 0 ? "left" : "right"} of centreline, ${Math.round(along / FT)} ft past the threshold.`;
}

export const LESSONS = [
  {
    id: "pattern", title: "Traffic pattern at Zarhart Field", tag: "Takeoffs & landings", time: "8 min", level: 1,
    summary: "Take off from runway 27, climb at Vy, fly a left-hand pattern at 1,000 ft above the field and land.",
    exam: ["t16", "t26", "t1"],
    tips: ["Rotate at 55 KIAS, then pitch for 74 KIAS (Vy = most altitude per minute).", "Pattern altitude is field elevation + 1,000 ft. Downwind is parallel to the runway, heading 090.", "Carb heat on and power back abeam the numbers, flaps 10–20 on base, 65 KIAS on final."],
    setup(sim) { sim.setWeather({ ...PRESETS.scattered, windDir: 260, windKt: 8, gustKt: 0 }); sim.setTime(10.5); sim.spawn({ ...KZAR.spawn.rwy27, onGround: true, engineRunning: true }); sim.ac.flapsSet = 0; sim.radio.com1 = KZAR.freqs.twr; },
    objectives: [
      { text: "Release the parking brake (Shift+B), full throttle, rotate at 55 KIAS", check: (sim) => !sim.d.onGround && sim.d.agl > 30 },
      { text: "Climb at Vy 74 KIAS to pattern altitude", check(sim, ls, dt) { const pa = KZAR.elevFt + 1000; ls.vyT = (ls.vyT || 0) + dt; if (Math.abs(sim.d.ias - 74) < 6) ls.vyOk = (ls.vyOk || 0) + dt; return sim.d.altInd > pa - 80; }, result: (ls) => `Vy held ${Math.round(100 * (ls.vyOk || 0) / (ls.vyT || 1))}% of the climb.` },
      { text: "Fly downwind (heading 090) at pattern altitude ±100 ft for 20 s", check(sim, ls, dt) { const pa = KZAR.elevFt + 1000; if (Math.abs(wrap180(sim.d.hdg - 90)) < 25 && Math.abs(sim.d.altInd - pa) < 100) ls.dw = (ls.dw || 0) + dt; return (ls.dw || 0) > 20; } },
      { text: "Turn base and final, land on runway 27", check: (sim) => landedOn(sim, KZAR, "27"), fail: offRunway(KZAR) },
      { text: "Slow to taxi speed on the runway", check: (sim) => sim.d.onGround && sim.d.gs < 8, result: (ls, sim) => touchdownReport(sim, KZAR, "27") },
    ],
  },
  {
    id: "vasi", title: "Short final: fly the VASI", tag: "Airport lighting", time: "3 min", level: 1,
    summary: "At dusk on a 3-mile final to runway 27, keep the 2-bar VASI showing red over white, then land past the bars.",
    exam: ["t23", "t52", "t54"],
    tips: ["Red over white, you're all right. White over white: too high. Red over red: too low.", "The VASI only guarantees obstacle clearance within ±10° of centreline out to 4 NM.", "In Class D, stay at or above the VASI glide slope until a lower altitude is needed to land (91.129)."],
    setup(sim) { sim.setWeather(PRESETS.clear); sim.setTime(20.0); sim.spawn(onFinal(KZAR, "27", 3, 70, 20)); sim.ac.ctl.throttle = 0.3; sim.ac.ctl.trim = 0.35; sim.ac.elec.lights.landing = true; },
    objectives: [
      { text: "Keep red over white until 200 ft AGL", check(sim, ls, dt) { const [nearW, farW] = sim.vasi("KZAR", "27"); ls.tot = (ls.tot || 0) + dt; if (nearW && !farW) ls.on = (ls.on || 0) + dt; else if (!nearW && !farW) ls.low = (ls.low || 0) + dt; return sim.d.agl < 200; }, result: (ls) => `On the glidepath ${Math.round(100 * (ls.on || 0) / (ls.tot || 1))}% of the time${ls.low > 3 ? ` (too low for ${Math.round(ls.low)} s: red over red)` : ""}.` },
      { text: "Land on runway 27 beyond the VASI bars", check: (sim) => landedOn(sim, KZAR, "27"), fail: offRunway(KZAR) },
      { text: "Slow to taxi speed", check: (sim) => sim.d.onGround && sim.d.gs < 8, result: (ls, sim) => touchdownReport(sim, KZAR, "27") },
    ],
  },
  {
    id: "steep", title: "Steep turns (45° bank)", tag: "Performance maneuvers", time: "4 min", level: 2,
    summary: "Two 360° turns at 45° of bank, left then right, holding altitude within ±100 ft. Watch the G-meter: 45° = 1.41 G.",
    exam: ["t34", "t58", "e35", "e36"],
    tips: ["Add a little power and back pressure as you roll in: the wing must make 41% more lift.", "Lead the roll-out by about half the bank angle (20°).", "Stall speed rises with load factor: about 19% at 45°, 41% at 60°."],
    setup(sim) { sim.setWeather(PRESETS.clear); sim.setTime(11); sim.spawn({ x: -6000, z: -2000, hdg: 0, onGround: false, altFt: 3500, kias: 95 }); sim.ac.ctl.throttle = 0.66; sim.ac.ctl.trim = 0.05; sim.showG = true; },
    objectives: [
      { text: "Left steep turn: 45° bank, full 360°", check(sim, ls, dt) { return steep(sim, ls, dt, -1); }, result: (ls) => `Left turn: max altitude error ${Math.round(ls.err1 || 0)} ft, peak ${(ls.g1 || 1).toFixed(2)} G.` },
      { text: "Right steep turn: 45° bank, full 360°", check(sim, ls, dt) { return steep(sim, ls, dt, 1); }, result: (ls) => `Right turn: max altitude error ${Math.round(ls.err2 || 0)} ft, peak ${(ls.g2 || 1).toFixed(2)} G. Standard: ±100 ft.` },
      { text: "Roll out wings level on heading 360 ±10°", check: (sim) => Math.abs(sim.d.bank) < 5 && Math.abs(wrap180(sim.d.hdg)) < 10 },
    ],
  },
  {
    id: "stall", title: "Power-off stall & recovery", tag: "Slow flight & stalls", time: "4 min", level: 2,
    summary: "In landing configuration, slow until the wing stalls, then recover. Then stall again in a 30° bank and compare the airspeed. The angle of attack is the same.",
    exam: ["t42", "t9", "t58", "e34", "t24"],
    tips: ["The stall horn sounds about 5–10 kt before the stall.", "Recover: reduce the angle of attack first (nose down), full power, level the wings with coordinated rudder, flaps to 20.", "A wing always stalls at the same critical angle of attack. Bank and weight change only the speed."],
    setup(sim) { sim.setWeather(PRESETS.clear); sim.setTime(13); sim.spawn({ x: 6000, z: 12000, hdg: 180, onGround: false, altFt: 4800, kias: 72, flaps: 30 }); sim.ac.ctl.throttle = 0.04; sim.ac.ctl.trim = 0.5; sim.ac.eng.carbHeat = true; },
    objectives: [
      { text: "Hold altitude with back pressure until the stall horn sounds", check(sim, ls) { if (sim.d.stallWarn) { ls.warn = sim.d.ias; return true; } } },
      { text: "Keep raising the nose until the stall breaks", check(sim, ls) { if (sim.d.stalled) { ls.s1 = { ias: sim.d.ias, aoa: sim.d.aoa, alt: sim.d.altInd, g: sim.d.g }; ls.minAlt = sim.d.altInd; return true; } } },
      { text: "Recover: nose down, full power, wings level, flaps 20, climb", check(sim, ls) { ls.minAlt = Math.min(ls.minAlt, sim.d.altInd); return !sim.d.stalled && sim.d.ias > 60 && sim.d.vsi > 100; }, result: (ls) => `Stall wings-level at ${Math.round(ls.s1.ias)} KIAS (${ls.s1.g.toFixed(2)} G), ${ls.s1.aoa.toFixed(1)}° angle of attack. Altitude lost in the recovery: ${Math.round(ls.s1.alt - ls.minAlt)} ft.` },
      { text: "Flaps 30, idle, roll into a 30° bank and hold altitude until it stalls again", check(sim, ls) { if (sim.d.stalled && Math.abs(sim.d.bank) > 22) { ls.s2 = { ias: sim.d.ias, aoa: sim.d.aoa, g: sim.d.g }; return true; } }, result: (ls) => { if (!ls.s2) return ""; const dv = Math.round(ls.s2.ias - ls.s1.ias); const base = `Banked stall at ${Math.round(ls.s2.ias)} KIAS (${ls.s2.g.toFixed(2)} G), ${ls.s2.aoa.toFixed(1)}° angle of attack: the same critical angle.`; return ls.s2.g > ls.s1.g + 0.08 ? `${base} ${dv >= 0 ? "+" + dv : dv} kt faster because the load factor was higher (stall speed × √G).` : `${base} Your load factor was only ${ls.s2.g.toFixed(2)} G because the nose dropped. Hold altitude in the bank (about 1.15 G at 30°) and the stall comes about 7% faster.`; } },
    ],
  },
  {
    id: "softfield", title: "Soft-field takeoff on grass", tag: "Takeoffs & landings", time: "3 min", level: 2,
    summary: "Electra Field's grass strip: get the nosewheel up early, lift off slowly, then accelerate in ground effect before climbing.",
    exam: ["t55", "t21", "t35"],
    tips: ["Flaps 10, full back pressure as you add power, then ease off to hold the nosewheel just clear.", "Ground effect lets you fly below normal climb speed. Climbing out of it too slowly brings induced drag back, and you can settle.", "Accelerate to Vx (59) or Vy (74) before climbing out of ground effect."],
    setup(sim) { sim.setWeather({ ...PRESETS.clear, windDir: 40, windKt: 3 }); sim.setTime(9); sim.spawn({ ...Z19.spawn.rwy04, onGround: true, engineRunning: true }); sim.ac.parkingBrake = false; sim.ac.flapsSet = 10; sim.ac.flaps = 10; sim.radio.com1 = Z19.freqs.ctaf; },
    objectives: [
      { text: "Full power and back pressure: get the nosewheel off the grass", check: (sim) => !sim.ac.contact[0] && (sim.ac.contact[1] || sim.ac.contact[2]) && sim.d.gs > 10 },
      { text: "Lift off as slowly as possible", check(sim, ls, dt) { if (!sim.d.onGround) { ls.lo ??= sim.d.ias; ls.air = (ls.air || 0) + dt; return ls.air > 1 || sim.d.agl > 4; } ls.air = 0; }, result: (ls) => `Lifted off at ${Math.round(ls.lo)} KIAS. A good soft-field liftoff is close to the stall speed: about 45–50 KIAS here.` },
      { text: "Stay below 30 ft AGL (in ground effect) until 59 KIAS", check: (sim) => sim.d.ias >= 59 && sim.d.agl < 40, fail: (sim) => sim.d.agl > 45 && sim.d.ias < 55 ? "Climbed out of ground effect too slowly." : null },
      { text: "Climb at Vy to 1,000 ft AGL", check: (sim) => sim.d.agl > 1000 },
    ],
  },
  {
    id: "vor", title: "VOR tracking: ZRH 090 radial", tag: "Navigation", time: "6 min", level: 2,
    summary: "Tune the Zarhart VOR, fly over the station and track the 090 radial outbound with the needle centred.",
    exam: ["e55", "e60", "e59", "e58"],
    tips: ["Click the NAV1 box (or press N) to swap 116.40 for 113.90. Scroll the OBS knob to 090.", "Over the station the flag flips from TO to FROM. Outbound on the 090 radial means FROM with OBS 090.", "Needle left? The course is left: turn toward the needle, about 10–20° at a time."],
    setup(sim) { sim.setWeather({ ...PRESETS.clear, windDir: 200, windKt: 10 }); sim.setTime(15); sim.spawn({ x: ZRH.x - 9000, z: ZRH.z + 1500, hdg: 80, onGround: false, altFt: 3500, kias: 100 }); sim.ac.ctl.throttle = 0.68; sim.radio.nav1 = 116.4; sim.radio.nav1s = 113.9; sim.ac.inst.obs = 0; },
    objectives: [
      { text: "Tune NAV1 to 113.90 (ZRH) and set the OBS to 090", check: (sim) => Math.abs(sim.radio.nav1 - 113.9) < 0.01 && Math.abs(wrap180(sim.ac.inst.obs - 90)) < 1 },
      { text: "Fly to the station: the flag flips to FROM over ZRH", check: (sim) => sim.vor1?.ok && sim.vor1.toFrom === "FROM" && sim.vor1.dme < 2.2 && Math.abs(sim.vor1.cdi) < 1 },
      { text: "Track the 090 radial outbound to 7 NM, needle within 2 dots", check(sim, ls, dt) { const v = sim.vor1; if (!v?.ok) return false; ls.t = (ls.t || 0) + dt; if (Math.abs(v.cdi) < 0.4) ls.ok = (ls.ok || 0) + dt; return v.dme > 7; }, result: (ls) => `Needle within 2 dots ${Math.round(100 * (ls.ok || 0) / (ls.t || 1))}% of the time.` },
    ],
  },
  {
    id: "xc", title: "Cross-country by pilotage: KZAR → KAME", tag: "Navigation", time: "12 min", level: 3,
    summary: "Fly checkpoint to checkpoint by looking outside: the radio masts, Highway 32, then Earhart Municipal. Make your CTAF call about 10 NM out.",
    exam: ["t57", "e62", "e56", "e57", "t1", "e10"],
    tips: ["Hold a heading and check off each landmark against the clock.", "Under scattered clouds at 5,000 ft MSL, stay at or below 4,500 ft (500 ft below the clouds in Class E).", "KAME: CTAF 122.8. Runway 36 is left traffic, runway 18 is right traffic (see the segmented circle)."],
    setup(sim) { sim.setWeather({ ...PRESETS.scattered, windDir: 340, windKt: 8, gustKt: 0 }); sim.setTime(12); sim.spawn({ x: -4000, z: -3000, hdg: 88, onGround: false, altFt: 3500, kias: 100 }); sim.ac.ctl.throttle = 0.66; sim.radio.com1 = 121.9; sim.radio.com1s = KAME.freqs.ctaf; sim.setRoute([{ x: -4000, z: -3000 }, { x: 7150, z: -2380, id: "MASTS" }, { x: 8970, z: 6940, id: "HWY 32" }, { x: KAME.x, z: KAME.z, id: "KAME" }]); },
    tick(sim, ls) { if (nmTo(sim, 7150, -2380) < 1.0) ls.cp1 = true; if (nmTo(sim, 8970, 6940) < 1.2) ls.cp2 = true; },
    objectives: [
      { text: "Tune 122.8 and self-announce about 10 NM from KAME (Radio → Self-announce)", check: (sim) => sim.flags.inboundCallKAME },
      { text: "Checkpoint 1: pass the radio masts (stay clear: 1,150 ft MSL)", check: (sim, ls) => ls.cp1 },
      { text: "Checkpoint 2: Highway 32, south of the masts", check: (sim, ls) => ls.cp2 },
      { text: "Land at Earhart Municipal (KAME)", check: (sim) => landedOn(sim, KAME), fail: offRunway(KAME), result: (ls, sim) => { const id = Math.abs(wrap180(sim.d.hdg - 0)) < 90 ? "36" : "18"; return touchdownReport(sim, KAME, id); } },
    ],
  },
  {
    id: "night", title: "Night: pilot-controlled lighting", tag: "Night operations", time: "6 min", level: 2,
    summary: "Earhart Municipal is dark. Tune the CTAF and click the mic 7 times in 5 seconds to turn the runway lights on. Then land.",
    exam: ["t33", "e49", "e67", "t8"],
    tips: ["Press Space to click the mic. 7 clicks = high, 5 = medium, 3 = low. The lights stay on 15 minutes.", "Find the airport by its rotating beacon: white and green for a civil land airport.", "At night, scan slowly and look slightly to the side of lights (off-center vision)."],
    setup(sim) { sim.setWeather({ ...PRESETS.clear, windDir: 190, windKt: 6 }); sim.setTime(21.6); sim.spawn({ x: KAME.x - 600, z: KAME.z - 11500, hdg: 180, onGround: false, altFt: 2700, kias: 95 }); sim.ac.ctl.throttle = 0.6; sim.radio.com1 = 121.5; sim.radio.com1s = KAME.freqs.ctaf; sim.pcl.level = 0; sim.ac.elec.lights.landing = true; sim.ac.elec.lights.nav = true; },
    objectives: [
      { text: "Make COM1 the KAME CTAF, 122.8 (click the COM1 box)", check: (sim) => Math.abs(sim.radio.com1 - 122.8) < 0.01 },
      { text: "Click the mic 7 times within 5 seconds (Space)", check: (sim) => sim.pcl.level === 3 },
      { text: "Land on runway 18 (right traffic)", check: (sim) => landedOn(sim, KAME), fail: offRunway(KAME), result: (ls, sim) => touchdownReport(sim, KAME, "18") },
    ],
  },
  {
    id: "enginefail", title: "Engine failure: glide and land", tag: "Emergencies", time: "5 min", level: 3,
    summary: "The engine will quit. Pitch for best glide (68 KIAS), squawk 7700, pick a landing spot and get down safely.",
    exam: ["t59", "e54", "e14"],
    tips: ["Airspeed first: best glide is 68 KIAS, about 10:1 here.", "Squawk 7700 and call on 121.5 (or the tower you're talking to).", "A smooth field beats a long glide to a runway you can't reach."],
    setup(sim, ls) { sim.setWeather(PRESETS.clear); sim.setTime(16); sim.spawn({ x: 7500, z: 5200, hdg: 300, onGround: false, altFt: 3600, kias: 100 }); sim.ac.ctl.throttle = 0.66; ls.failAt = 12; },
    tick(sim, ls) { if (!ls.failed && sim.t - ls.t0 > ls.failAt) { ls.failed = true; sim.ac.failures.engine = true; } },
    objectives: [
      { text: "When the engine quits, hold 68 KIAS ±5 for 8 s", check(sim, ls, dt) { if (!ls.failed) return false; if (Math.abs(sim.d.ias - 68) < 5) ls.g = (ls.g || 0) + dt; return ls.g > 8; } },
      { text: "Squawk 7700 (Radio panel)", check: (sim) => sim.ac.xpdr.code === "7700" },
      { text: "Land and stop without damage", check: (sim) => sim.d.onGround && sim.d.gs < 3 && !sim.ac.crashed, result: (ls, sim) => (sim.lastTouchdown ? `Touchdown ${sim.lastTouchdown.fpm} fpm, ${sim.lastTouchdown.kias} KIAS.` : "") },
    ],
  },
  {
    id: "carbice", title: "Carburetor ice", tag: "Aircraft systems", time: "4 min", level: 1,
    summary: "Humid air and part power: carb ice builds and RPM sags. Recognise it and apply carburetor heat before the engine quits.",
    exam: ["e41"],
    tips: ["Carb ice is likely from about 20°F to 70°F (−7 to 21°C) with visible moisture or a narrow temperature/dewpoint spread.", "First sign with a fixed-pitch prop: loss of RPM.", "Carb heat makes RPM drop a little more at first (richer mixture), then rise as the ice melts."],
    setup(sim) { sim.setWeather(PRESETS.humid); sim.setTime(10); sim.spawn({ x: -9000, z: 9000, hdg: 90, onGround: false, altFt: 2800, kias: 95 }); sim.ac.ctl.throttle = 0.6; sim.ac.eng.carbIce = 0.3; },
    objectives: [
      { text: "Cruise and watch the tachometer", check: (sim) => sim.ac.eng.carbIce > 0.5 },
      { text: "RPM is dropping with no throttle change: carb heat ON (H)", check: (sim) => sim.ac.eng.carbHeat, fail: (sim) => !sim.ac.eng.running ? "The engine quit from carb ice." : null },
      { text: "Leave heat on until RPM recovers, then turn it off", check: (sim) => sim.ac.eng.carbIce < 0.04 && !sim.ac.eng.carbHeat },
    ],
  },
  {
    id: "crosswind", title: "Gusty crosswind landing", tag: "Takeoffs & landings", time: "4 min", level: 3,
    summary: "Wind 220° at 14 gusting 21: about 11 kt of crosswind from the left on runway 27. Crab on final, then slip to touch down aligned.",
    exam: ["e19"],
    tips: ["Wing low into the wind (left), opposite rudder to keep the nose on the centreline.", "Add half the gust factor to your approach speed.", "Touch down on the upwind main wheel first, and keep the aileron into the wind as you slow."],
    setup(sim) { sim.setWeather(PRESETS.crosswind); sim.setTime(14); sim.spawn(onFinal(KZAR, "27", 3.5, 72, 20)); sim.ac.ctl.throttle = 0.32; sim.ac.ctl.trim = 0.32; },
    objectives: [
      { text: "Land on runway 27 aligned (nose within 5°) and near the centreline", fail: offRunway(KZAR), check(sim, ls) { if (landedOn(sim, KZAR, "27")) { const td = sim.lastTouchdown; ls.align = Math.abs(wrap180(sim.d.hdg - 270)); ls.off = Math.abs(centerOffset(end(KZAR, "27"), td.x, td.z)); return true; } }, result: (ls, sim) => `${touchdownReport(sim, KZAR, "27")} Nose ${ls.align.toFixed(0)}° off the runway heading at touchdown.` },
      { text: "Slow to taxi speed and keep it on the runway", check: (sim) => sim.d.onGround && sim.d.gs < 8 && onRunwaySurface(KZAR, sim.ac.pos.x, sim.ac.pos.z) },
    ],
  },
  {
    id: "wake", title: "Wake turbulence behind a heavy jet", tag: "Wake turbulence", time: "5 min", level: 3,
    summary: "A heavy jet lands ahead of you on runway 27. Its wingtip vortices sink and drift. Stay above its path and land beyond its touchdown point.",
    exam: ["t25", "t36", "t51", "t53"],
    tips: ["Vortices form only while the wing makes lift, from rotation to touchdown.", "They sink 300–500 fpm and level off 500–1,000 ft below the flight path.", "A light quartering tailwind is the worst case: it can hold vortices over the runway."],
    setup(sim, ls) {
      sim.setWeather({ ...PRESETS.clear, windDir: 300, windKt: 4 }); sim.setTime(13);
      const sp = onFinal(KZAR, "27", 4.5, 80, 10); sp.altFt += 60; sim.spawn(sp); sim.ac.ctl.throttle = 0.38; sim.ac.ctl.trim = 0.25;
      wakeSetup(sim, ls);
    },
    tick(sim, ls, dt) { wakeTick(sim, ls, dt); },
    cleanup(sim, ls) { wakeCleanup(sim, ls); },
    objectives: [
      { text: "Stay at or above the jet's flight path on final", check(sim, ls, dt) { ls.below = ls.below || 0; if (ls.jetPathBelow) ls.below += dt; return sim.d.agl < 150; }, result: (ls) => ls.below > 2 ? `You flew below the jet's path for ${Math.round(ls.below)} s: that's where its vortices sink.` : "You stayed above the jet's path." },
      { text: "Touch down beyond the jet's touchdown point", fail: (sim, ls) => { const off = offRunway(KZAR)(sim); if (off) return off; const td = sim.lastTouchdown; if (td && !td.used && onRunwaySurface(KZAR, td.x, td.z)) { const dd = distFromThreshold(end(KZAR, "27"), td.x, td.z); if (dd < ls.jetTd) return `Touched down ${Math.round(dd / FT)} ft past the threshold, before the jet's touchdown point (${Math.round(ls.jetTd / FT)} ft): that's inside its wake. Aim beyond its touchdown point.`; } return null; }, check(sim, ls) { if (landedOn(sim, KZAR, "27")) { const e = end(KZAR, "27"); ls.myTd = distFromThreshold(e, sim.lastTouchdown.x, sim.lastTouchdown.z); return true; } }, result: (ls) => `Jet touched down ${Math.round(ls.jetTd / FT)} ft past the threshold. You touched down at ${Math.round(ls.myTd / FT)} ft: ${ls.myTd > ls.jetTd ? "beyond it. Correct." : "before it. That's inside its wake."}` },
      { text: "Slow to taxi speed", check: (sim) => sim.d.onGround && sim.d.gs < 8 },
    ],
  },
  {
    id: "nordo", title: "Radio failure: light gun signals", tag: "Airport operations", time: "6 min", level: 2,
    summary: "Your radio is dead. Squawk 7600, join the pattern at Zarhart and follow the tower's light gun signals.",
    exam: ["e47", "e48", "e54"],
    tips: ["In flight: steady green = cleared to land; flashing green = return for landing; steady red = give way and keep circling; flashing red = airport unsafe, don't land.", "On the ground: flashing green = cleared to taxi; steady red = stop; flashing red = taxi clear of the runway; flashing white = return to the starting point.", "Acknowledge by rocking your wings (day) or flashing your landing light (night)."],
    setup(sim, ls) { sim.setWeather(PRESETS.clear); sim.setTime(15.5); sim.spawn({ x: 9500, z: -1800, hdg: 270, onGround: false, altFt: 1600, kias: 95 }); sim.ac.ctl.throttle = 0.6; sim.radio.failed = true; ls.phase = "inbound"; },
    tick(sim, ls) {
      const dnm = nmTo(sim, 0, 0);
      if (ls.phase === "inbound" && dnm < 3.2) { ls.phase = "red"; ls.redT = sim.t; ls.turned = 0; ls.prevHdg = sim.d.hdg; sim.lightGun = { color: "red", flash: false, text: "Steady red: give way to other aircraft and continue circling" }; }
      if (ls.phase === "red") { ls.turned += Math.abs(wrap180(sim.d.hdg - ls.prevHdg)); ls.prevHdg = sim.d.hdg; }
      if (ls.phase === "red" && (ls.turned > 300 || sim.t - ls.redT > 180)) { ls.phase = "flashgreen"; sim.lightGun = { color: "green", flash: true, text: "Flashing green: return for landing" }; }
      const e = end(KZAR, "27"); const onFin = Math.abs(centerOffset(e, sim.ac.pos.x, sim.ac.pos.z)) < 250 && distFromThreshold(e, sim.ac.pos.x, sim.ac.pos.z) < 0 && distFromThreshold(e, sim.ac.pos.x, sim.ac.pos.z) > -3500 && Math.abs(wrap180(sim.d.hdg - 270)) < 30;
      if ((ls.phase === "flashgreen") && onFin) { ls.phase = "green"; sim.lightGun = { color: "green", flash: false, text: "Steady green: cleared to land" }; }
      if (ls.phase === "landed" && sim.d.gs < 20) { ls.phase = "taxi"; sim.lightGun = { color: "green", flash: true, text: "Flashing green (on the ground): cleared to taxi" }; }
    },
    cleanup(sim) { sim.radio.failed = false; sim.lightGun = null; },
    objectives: [
      { text: "Squawk 7600 (lost communications)", check: (sim) => sim.ac.xpdr.code === "7600" },
      { text: "Approach Zarhart and watch the tower for a light signal (steady red: circle)", check: (sim, ls) => ls.phase !== "inbound" && ls.phase !== "red", fail: (sim, ls) => sim.lastTouchdown && !sim.lastTouchdown.used ? "Landed under a steady red: give way and keep circling until you get a green." : null },
      { text: "Don't land until you see a steady green", check(sim, ls) { if (landedOn(sim, KZAR, "27") && ls.phase === "green") { ls.phase = "landed"; return true; } }, fail: (sim, ls) => sim.lastTouchdown && !sim.lastTouchdown.used ? (ls.phase !== "green" ? "Landed without a steady green: no clearance." : offRunway(KZAR)(sim)) : null },
      { text: "Flashing green: cleared to taxi. Slow down and exit the runway", check: (sim) => sim.d.onGround && sim.d.gs < 10 && !onRunwaySurface(KZAR, sim.ac.pos.x, sim.ac.pos.z) },
    ],
  },
];

function steep(sim, ls, dt, dir) {
  const k = dir < 0 ? 1 : 2;
  if (ls[`start${k}`] == null) { if (Math.abs(sim.d.bank) > 38 && Math.sign(sim.d.bank) === dir) { ls[`start${k}`] = sim.d.hdg; ls[`alt${k}`] = sim.d.altInd; ls[`turned${k}`] = 0; ls[`prev${k}`] = sim.d.hdg; ls[`err${k}`] = 0; ls[`g${k}`] = 1; } return false; }
  const dh = wrap180(sim.d.hdg - ls[`prev${k}`]); ls[`prev${k}`] = sim.d.hdg; ls[`turned${k}`] += dh * dir;
  ls[`err${k}`] = Math.max(ls[`err${k}`], Math.abs(sim.d.altInd - ls[`alt${k}`])); ls[`g${k}`] = Math.max(ls[`g${k}`], sim.d.g);
  return ls[`turned${k}`] >= 345;
}

/* ---- wake turbulence lesson: a scripted heavy jet with sinking vortices ---- */
function wakeSetup(sim, ls) {
  const e = end(KZAR, "27"); const h = e.hdg * DEG; const fx = Math.sin(h), fz = -Math.cos(h);
  ls.jetTd = 420; // m past threshold
  ls.jet = { s: -2.2 * NM, speed: 72 }; // position along the extended centreline (negative = before threshold)
  ls.vortices = [];
  const jet = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0xe9ecef });
  const fus = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 52, 14), mat); fus.rotation.x = Math.PI / 2; jet.add(fus);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(48, 0.6, 7), mat); wing.position.set(0, -1, 2); jet.add(wing);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 9, 6), mat); tail.position.set(0, 5, 23); jet.add(tail);
  const hs = new THREE.Mesh(new THREE.BoxGeometry(17, 0.4, 4), mat); hs.position.set(0, 1, 23); jet.add(hs);
  for (const s of [-1, 1]) { const eng = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 5, 10), new THREE.MeshLambertMaterial({ color: 0x9aa3ad })); eng.rotation.x = Math.PI / 2; eng.position.set(s * 9, -2.6, 0); jet.add(eng); }
  jet.rotation.y = -h; sim.scene.add(jet); ls.jetMesh = jet;
  const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3 * 600), 3));
  ls.vPts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 3, sizeAttenuation: false, transparent: true, opacity: 0.55, depthWrite: false }));
  ls.vPts.frustumCulled = false; sim.scene.add(ls.vPts);
  ls.fx = fx; ls.fz = fz; ls.e = e;
  ls.windFn = (x, y, z) => {
    let wy = 0; for (const v of ls.vortices) { const dx = x - v.x, dy = y - v.y, dz = z - v.z; if (Math.abs(dx) > 60 || Math.abs(dz) > 60 || Math.abs(dy) > 40) continue; const r = Math.hypot(dx, dy, dz); if (r < 40) wy += -v.str * (1 - r / 40); }
    return { x: 0, y: wy, z: 0 };
  };
  sim.weather.extraWind.push(ls.windFn);
}
function wakeTick(sim, ls, dt) {
  const e = ls.e; const elev = KZAR.elev;
  const j = ls.jet; j.s += j.speed * dt * (j.s > ls.jetTd ? 0.4 : 1);
  if (j.s > ls.jetTd) j.speed = Math.max(0, j.speed - 3 * dt);
  const gs = Math.tan(3 * DEG);
  const alt = j.s < ls.jetTd ? elev + 4 + Math.max(0, (ls.jetTd - j.s)) * gs : elev + 4;
  const jx = e.x + ls.fx * j.s, jz = e.z + ls.fz * j.s;
  ls.jetMesh.position.set(jx, alt, jz);
  const w = sim.weather; const to = (w.windDir + 180) * DEG; const drift = { x: Math.sin(to) * w.windKt * KT, z: -Math.cos(to) * w.windKt * KT };
  if (j.s < ls.jetTd && (ls.lastDrop == null || sim.t - ls.lastDrop > 0.6)) {
    ls.lastDrop = sim.t; const px = -ls.fz, pz = ls.fx;
    for (const s of [-1, 1]) ls.vortices.push({ x: jx + px * s * 19, y: alt - 2, z: jz + pz * s * 19, str: 9, t: sim.t, side: s });
  }
  // vortices sink ~400 fpm, level off ~800 ft below or near the ground, drift with the wind, decay
  for (const v of ls.vortices) {
    const ground = heightAt(v.x, v.z) + 25;
    if (v.y > ground) v.y -= 2.0 * dt; else { v.x += v.side * 1.2 * dt * (-ls.fz); v.z += v.side * 1.2 * dt * ls.fx; }
    v.x += drift.x * dt * 0.8; v.z += drift.z * dt * 0.8; v.str *= Math.exp(-dt / 70);
  }
  ls.vortices = ls.vortices.filter((v) => v.str > 0.6).slice(-300);
  const pos = ls.vPts.geometry.attributes.position; ls.vortices.forEach((v, i) => pos.setXYZ(i, v.x, v.y, v.z)); for (let i = ls.vortices.length; i < 600; i++) pos.setXYZ(i, 0, -9999, 0); pos.needsUpdate = true;
  // rolling moment when a wing is near a vortex core
  let roll = 0; const p = sim.ac.pos;
  for (const v of ls.vortices) { const dx = p.x - v.x, dy = p.y - v.y, dz = p.z - v.z; const r = Math.hypot(dx, dy, dz); if (r < 35) roll += v.side * v.str * 900 * (1 - r / 35); }
  sim.ac.extMoment.x = roll;
  // are we below the jet's path (within 2 NM behind it)?
  const s = distFromThreshold(e, p.x, p.z);
  const jetPathAlt = elev + 4 + Math.max(0, ls.jetTd - s) * gs;
  ls.jetPathBelow = s < ls.jetTd && s > j.s - 2 * NM && p.y < jetPathAlt - 8 && !sim.d.onGround;
}
function wakeCleanup(sim, ls) {
  if (ls.jetMesh) sim.scene.remove(ls.jetMesh); if (ls.vPts) sim.scene.remove(ls.vPts);
  sim.weather.extraWind = sim.weather.extraWind.filter((f) => f !== ls.windFn); sim.ac.extMoment.x = 0;
}

/* ---------------- runner ---------------- */
export class LessonRunner {
  constructor(sim) { this.sim = sim; this.lesson = null; }
  start(id) {
    this.stop();
    const L = LESSONS.find((l) => l.id === id); if (!L) return;
    this.lesson = L; this.ls = { t0: 0 }; this.idx = 0; this.results = []; this.failed = null; this.done = false;
    this.sim.showG = false; this.sim.lightGun = null; this.sim.setRoute(null);
    L.setup(this.sim, this.ls); this.ls.t0 = this.sim.t;
    this.sim.say(`Lesson: ${L.title}. ${L.objectives[0].text}.`, "lesson");
  }
  stop() { if (this.lesson?.cleanup) this.lesson.cleanup(this.sim, this.ls); this.lesson = null; this.sim.showG = false; this.sim.lightGun = null; }
  update(dt) {
    const L = this.lesson; if (!L || this.done) return;
    const sim = this.sim;
    if (L.tick) L.tick(sim, this.ls, dt);
    const obj = L.objectives[this.idx];
    const why = obj.fail?.(sim, this.ls);
    if (why || sim.ac.crashed) { this.failed = why || sim.ac.crashed.reason; this.done = true; sim.say(`Lesson ended: ${this.failed}`, "warn"); this.consumeTouchdown(); return; }
    if (obj.check(sim, this.ls, dt)) {
      const r = obj.result?.(this.ls, sim); if (r) this.results.push(r);
      this.idx++; this.consumeTouchdown();
      if (this.idx >= L.objectives.length) { this.done = true; sim.say(`Lesson complete: ${L.title}.`, "good"); }
      else sim.say(L.objectives[this.idx].text, "lesson");
    }
  }
  consumeTouchdown() { if (this.sim.lastTouchdown) this.sim.lastTouchdown.used = true; }
  status() {
    const L = this.lesson; if (!L) return null;
    return { id: L.id, title: L.title, exam: L.exam, tips: L.tips, done: this.done, failed: this.failed, results: this.results, objectives: L.objectives.map((o, i) => ({ text: o.text, state: i < this.idx ? "done" : i === this.idx && !this.done ? "now" : this.failed && i === this.idx ? "failed" : "todo" })) };
  }
}
