// Exam-linked lessons. Each lesson sets up a scenario and checks objectives in order.
import * as THREE from "three";
import { AIRPORTS, NAVAIDS, rectDist, heightAt } from "./world-data.js";
import { FT, KT } from "./fdm.js";
import { PRESETS } from "./weather.js";
import { wrap180 } from "./nav.js";
import { buildAirplane } from "./plane3d.js";

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
  /* ---------------- Pro lessons (free preview until Zarhart Pro launches) ---------------- */
  {
    id: "wetrunway", title: "Rain: landing on a wet runway", tag: "Weather", time: "4 min", level: 2,
    summary: "Heavy rain at Zarhart: 3 miles visibility under a 1,500 ft overcast and standing water on runway 27. Land firmly on the centreline, then let it slow before you brake: above about 48 kt the tires can hydroplane.",
    exam: ["f254", "q501", "q502"],
    tips: [
      "Rain hides the runway edges and blurs the windshield: fly the VASI and keep the approach stable.",
      "Touch down firmly on the centreline at the normal speed. A fast, floated landing onto standing water is how hydroplaning starts.",
      "Dynamic hydroplaning starts at about 9 × √(tire pressure): about 48 kt for these 29 psi tires. Hold the nose up for aerodynamic braking, then brake gently once you're slower.",
    ],
    setup(sim) {
      sim.setWeather({ ...PRESETS.heavyrain, windDir: 260, windKt: 3, gustKt: 0, turb: 0.15, visSM: 3 }); sim.setTime(15);
      sim.spawn(onFinal(KZAR, "27", 3, 70, 20)); sim.ac.ctl.throttle = 0.32; sim.ac.ctl.trim = 0.32;
      sim.radio.com1 = KZAR.freqs.twr; sim.flags.dContact = true;
      sim.radioLog("Zarhart Tower", `${sim.callsign}, runway 27, cleared to land. Heavy rain on the field, standing water on the runway, braking action poor.`);
    },
    tick(sim, ls) {
      if (!sim.d.hydroplaning) return;
      ls.hydro = true; const c = sim.ac.ctl;
      if (Math.max(c.brake, c.brakeL, c.brakeR) > 0.4) ls.hydroBrake = true;
    },
    objectives: [
      { text: "Land on runway 27 near the centreline", fail: offRunway(KZAR), check: (sim) => landedOn(sim, KZAR, "27"), result: (ls, sim) => touchdownReport(sim, KZAR, "27") },
      {
        text: "Slow to taxi speed on the runway: hold the nose up, and brake gently only below about 48 kt",
        check: (sim) => sim.d.onGround && sim.d.gs < 8 && onRunwaySurface(KZAR, sim.ac.pos.x, sim.ac.pos.z),
        fail: (sim) => (sim.d.onGround && sim.d.gs > 3 && !onRunwaySurface(KZAR, sim.ac.pos.x, sim.ac.pos.z) ? "You slid off the runway. On standing water, let aerodynamic braking slow you first." : null),
        result: (ls) => (ls.hydroBrake ? "You braked while the tires were hydroplaning, so the brakes did almost nothing. Wait until you're below about 48 kt." : ls.hydro ? "The tires hydroplaned for a moment after touchdown, but you waited to brake. Good." : "No hydroplaning: you were slow before you braked. Good."),
      },
    ],
  },
  {
    id: "winter", title: "Snow and frost: a winter takeoff", tag: "Weather", time: "4 min", level: 2,
    summary: "A frosty morning after a snowfall: frost on the wings and snow on runway 27. Remove the frost first, then make a soft-field-style takeoff on the snow and climb to 1,000 ft. The cold air helps: density altitude is low.",
    exam: ["e30", "f97", "f237", "t55", "q503"],
    tips: [
      "Frost spoils the smooth airflow over the wing, so it stalls at a higher speed and the airplane may not fly at the normal takeoff speed. Remove all of it: Aircraft → Remove the frost.",
      "Snow drags on the wheels and hides the runway markings. Use soft-field technique: flaps 10, keep the weight off the nosewheel, and lift off as soon as it will fly.",
      "Cold, dense air gives shorter takeoffs and better climbs. But any cloud or precipitation below freezing means structural icing: stay out of it.",
    ],
    setup(sim) {
      sim.setWeather(PRESETS.frost); sim.setTime(8.2);
      sim.spawn({ ...KZAR.spawn.rwy27, onGround: true, engineRunning: true }); sim.ac.flapsSet = 10; sim.ac.flaps = 10;
      sim.radio.com1 = KZAR.freqs.twr; sim.flags.dContact = true;
      sim.radioLog("Zarhart Tower", `${sim.callsign}, runway 27, cleared for takeoff when ready. Runway snow covered, braking action poor.`);
    },
    objectives: [
      {
        text: "Remove the frost from the wings first: Aircraft → Remove the frost",
        check: (sim) => sim.ac.frost === 0,
        fail: (sim) => (!sim.d.onGround && sim.ac.frost > 0 ? "You took off with frost on the wings. Frost raises the stall speed and can keep the airplane from flying: always remove it first." : null),
      },
      {
        text: "Take off on the snow: release the parking brake, full power, back pressure, and lift off as soon as it flies",
        check(sim, ls) { if (!sim.d.onGround && sim.d.ias > 30) ls.lo ??= sim.d.ias; return !sim.d.onGround && sim.d.agl > 30; },
        result: (ls) => `Lifted off at ${Math.round(ls.lo)} KIAS.`,
      },
      { text: "Climb at Vy, 74 KIAS, to 1,000 ft above the field", check: (sim) => sim.d.altInd > KZAR.elevFt + 970 },
    ],
  },
  {
    id: "microburst", title: "Microburst on final: go around", tag: "Weather", time: "4 min", level: 3,
    summary: "A thunderstorm has a rain shaft over the final approach to runway 27. Two miles out the airspeed jumps: that's the microburst's headwind. Go around at once, before the downdraft and the tailwind arrive.",
    exam: ["f107", "f108", "q504"],
    tips: [
      "A microburst's outflow first hits you as a headwind: airspeed and climb go up. Don't pull the power back. It's the warning.",
      "Next come the downdraft and a tailwind: airspeed and altitude fall away together. Full power, pitch for Vy, flaps up in stages, and don't let it descend.",
      "Better still, don't fly under a storm's rain shaft or virga. A microburst usually lasts about 15 minutes: hold or divert until it's gone.",
    ],
    setup(sim, ls) {
      sim.setWeather({ ...PRESETS.storm, gustKt: 0, turb: 0.3 }); sim.setTime(15.5);
      sim.spawn(onFinal(KZAR, "27", 4, 72, 10)); sim.ac.ctl.throttle = 0.42; sim.ac.ctl.trim = 0.28;
      sim.radio.com1 = KZAR.freqs.twr; sim.flags.dContact = true; ls.mb = sim.weather.microburst;
      sim.radioLog("Zarhart Tower", `${sim.callsign}, runway 27, cleared to land. Wind shear alert: 20 knot gain on a two-mile final. Thunderstorm west of the field.`);
    },
    tick(sim, ls) {
      const mb = ls.mb; if (!mb) return;
      if (Math.hypot(sim.ac.pos.x - mb.x, sim.ac.pos.z - mb.z) < mb.r * 1.6) ls.inside = true;
      if (ls.inside && !sim.d.onGround) ls.minAgl = Math.min(ls.minAgl ?? Infinity, sim.d.agl);
    },
    objectives: [
      { text: "Fly the approach to runway 27 and watch the airspeed", check: (sim, ls) => ls.inside },
      {
        text: "The airspeed jumped: go around now. Full power and pitch up to climb",
        check(sim, ls, dt) { ls.gaT = sim.ac.ctl.throttle > 0.9 && sim.d.vsTrue > 150 ? (ls.gaT || 0) + dt : 0; return ls.gaT > 3; },
        fail: (sim) => (sim.lastTouchdown && !sim.lastTouchdown.used ? "You kept on landing through the microburst. When the airspeed jumps on final near a storm, go around." : null),
      },
      {
        text: "Climb out through the shear: keep full power and stay above 300 ft",
        check: (sim, ls) => sim.ac.pos.x < ls.mb.x - ls.mb.r * 1.8 && sim.d.agl > 300 && sim.d.vsTrue > 0,
        fail: (sim) => (sim.d.onGround || sim.d.agl < 150 ? "Too low in the downdraft: full power and Vy, and don't trade altitude for airspeed." : null),
        result: (ls) => `Lowest point in the shear: ${Math.round(ls.minAgl ?? 0)} ft above the ground.`,
      },
      { text: "Climb to 1,000 ft above the field, away from the storm", check: (sim) => sim.d.altInd > KZAR.elevFt + 970 },
    ],
  },
  {
    id: "calm", title: "No wind: a calm-wind landing on a short strip", tag: "Weather", time: "4 min", level: 2,
    summary: "Dead calm at Electra Field: the windsock hangs limp, so you use the calm-wind runway, 22. With no headwind your groundspeed is your full true airspeed, and the 2,500 ft grass strip gets short. Fly a short-field approach and stop before the end.",
    exam: ["f93", "q505", "q506", "q538"],
    tips: [
      "With the wind calm, use the airport's calm-wind runway (from the Chart Supplement) and announce it on the CTAF, since other pilots can't tell from the windsock either.",
      "No headwind means a higher groundspeed at touchdown and a longer landing roll. Fly 61 KIAS with full flaps and touch down near the numbers.",
      "Calm, clear mornings also bring radiation fog. And with little or no wind, a jet's wake vortices drift off the runway only slowly, at 2 to 3 knots.",
    ],
    setup(sim, ls) {
      sim.setWeather(PRESETS.calm); sim.setTime(7.5);
      sim.spawn(onFinal(Z19, "22", 2, 66, 30)); sim.ac.ctl.throttle = 0.3; sim.ac.ctl.trim = 0.4;
      sim.radio.com1 = Z19.freqs.ctaf; ls.e = end(Z19, "22");
    },
    objectives: [
      { text: "Land on runway 22, the calm-wind runway, near the threshold", fail: offRunway(Z19), check: (sim) => landedOn(sim, Z19, "22"), result: (ls, sim) => touchdownReport(sim, Z19, "22") },
      {
        text: "Stop before the end of the 2,500 ft strip",
        check: (sim) => sim.d.onGround && sim.d.gs < 3 && onRunwaySurface(Z19, sim.ac.pos.x, sim.ac.pos.z),
        fail: (sim) => (sim.d.onGround && sim.d.gs > 3 && !onRunwaySurface(Z19, sim.ac.pos.x, sim.ac.pos.z) ? "You ran off the strip. With no headwind the landing roll is longer: touch down near the threshold at the short-field speed." : null),
        result: (ls, sim) => `Stopped ${Math.round((ls.e.rwy.len - distFromThreshold(ls.e, sim.ac.pos.x, sim.ac.pos.z)) / FT)} ft before the end of the runway.`,
      },
    ],
  },
  {
    id: "shortfield", pro: true, title: "Short-field approach and landing", tag: "Takeoffs & landings", time: "4 min", level: 3,
    summary: "Runway 27 with 50-ft trees before the threshold. Full flaps, 60 KIAS, clear the trees, touch down on the orange aiming point and stop as short as you can.",
    exam: ["t35", "t39", "e34"],
    tips: ["Flaps 30 and 60 KIAS on final; the ACS allows +10/−5 kt. A steeper, slower approach clears the trees and still lands short.", "Aim at the orange bar 500 ft past the threshold. The ACS standard is on it or within 100 ft beyond it.", "Extra speed means floating in ground effect and using up runway. Once down: flaps up, full back elevator, maximum braking."],
    setup(sim, ls) { sim.setWeather({ ...PRESETS.clear, windDir: 270, windKt: 5, gustKt: 0 }); sim.setTime(9.5); sim.spawn(onFinal(KZAR, "27", 1.7, 66, 20)); sim.ac.ctl.throttle = 0.3; sim.ac.ctl.trim = 0.4; shortSetup(sim, ls); },
    tick(sim, ls) { shortTick(sim, ls); },
    cleanup(sim, ls) { removeProps(sim, ls); },
    objectives: [
      { text: "Flaps 30 and a stable 60 KIAS (55–70) on final", check(sim, ls, dt) { ls.stab = sim.ac.flapsSet >= 30 && sim.d.ias >= 55 && sim.d.ias <= 70 ? (ls.stab || 0) + dt : 0; return ls.stab > 4; }, fail: (sim, ls) => (ls.passed ? "You reached the trees before you were stable at 60 KIAS with full flaps. Configure early on a short-field approach." : null) },
      { text: "Clear the 50-ft trees before the runway", check: (sim, ls) => ls.cleared, fail: (sim, ls) => (ls.hitTrees ? "Too low over the trees: on a real short field you would have hit them. Fly a steeper approach and aim past the threshold." : null), result: (ls) => `Cleared the treetops by ${Math.round(ls.clearance / FT)} ft.` },
      { text: "Touch down on the orange aiming point, 500 ft past the threshold", fail: offRunway(KZAR), check(sim, ls) { if (landedOn(sim, KZAR, "27")) { const td = sim.lastTouchdown; ls.td = { x: td.x, z: td.z }; ls.tdS = distFromThreshold(end(KZAR, "27"), td.x, td.z); return true; } }, result: (ls, sim) => { const off = Math.round((ls.tdS - AIM_M) / FT); const grade = off >= 0 && off <= 100 ? "on the point: that meets the ACS standard (on it or within 100 ft beyond)" : off < 0 ? `${-off} ft short of the point (the ACS standard is on it or within 100 ft beyond)` : `${off} ft beyond the point (the ACS standard is within 100 ft)`; return `${touchdownReport(sim, KZAR, "27")} You touched down ${grade}.`; } },
      { text: "Stop as short as you can: flaps up, full back elevator, brakes", check: (sim) => sim.d.onGround && sim.d.gs < 2, result: (ls, sim) => `Landing roll: ${Math.round(Math.hypot(sim.ac.pos.x - ls.td.x, sim.ac.pos.z - ls.td.z) / FT)} ft from touchdown to stop.` },
    ],
  },
  {
    id: "slowflight", pro: true, title: "Slow flight", tag: "Slow flight & stalls", time: "5 min", level: 2,
    summary: "Fly at the edge of a stall without stalling: full flaps, just above the stall horn, holding altitude. Then turn and climb. Here the nose controls airspeed and power controls altitude.",
    exam: ["t24", "p36", "e39", "t58"],
    tips: ["Power back and hold altitude as you slow; flaps 30 below 85 KIAS. Add power at about 52 KIAS to stop the descent.", "Behind the power curve, power holds altitude and the nose holds airspeed. Expect lots of right rudder at high power and a high angle of attack (P-factor).", "ACS: altitude ±100 ft, heading ±10°, airspeed +10/−0 kt, and no stall warning. Keep turns shallow: the stall speed rises with bank."],
    setup(sim, ls) { sim.setWeather(PRESETS.clear); sim.setTime(14); sim.spawn({ x: 3000, z: 14000, hdg: 0, onGround: false, altFt: 4000, kias: 90 }); sim.ac.ctl.throttle = 0.6; sim.ac.ctl.trim = 0.05; },
    tick(sim, ls, dt) {
      ls.alt0 ??= sim.d.altTrue;
      const slow = sim.d.ias < 62; if (!slow || ls.recovering) return;
      ls.slowT = (ls.slowT || 0) + dt; if (sim.d.stallWarn) ls.horn = (ls.horn || 0) + dt;
      if (!ls.climbing) ls.altDev = Math.max(ls.altDev || 0, Math.abs(sim.d.altTrue - ls.alt0));
    },
    objectives: [
      { text: "Flaps 30 and slow to just above the stall horn (about 50 KIAS), holding altitude", check(sim, ls, dt) { const ok = sim.ac.flapsSet >= 30 && sim.d.ias < 56 && !sim.d.stallWarn && Math.abs(sim.d.altTrue - ls.alt0) < 100; ls.s1 = ok ? (ls.s1 || 0) + dt : 0; return ls.s1 > 10; }, fail: slowStall },
      { text: "Turn left 90° with 10–15° of bank, no stall horn", check(sim, ls) { ls.h0 ??= sim.d.hdg; ls.turn = wrap180(ls.h0 - sim.d.hdg); return ls.turn >= 80 && Math.abs(sim.d.bank) < 8; }, fail: slowStall },
      { text: "Climb 200 ft at slow-flight speed: add power, keep the airspeed", check(sim, ls) { ls.a3 ??= sim.d.altTrue; ls.climbing = true; return sim.d.altTrue >= ls.a3 + 200 && sim.d.ias < 62; }, fail: slowStall, result: (ls) => `In slow flight for ${Math.round(ls.slowT || 0)} s. Stall horn: ${(ls.horn || 0).toFixed(1)} s (the ACS standard is none). Largest altitude change while holding altitude: ${Math.round(ls.altDev || 0)} ft (ACS ±100 ft).` },
      { text: "Recover: full power, lower the nose, flaps up in stages, accelerate to 80 KIAS", check(sim, ls) { ls.recovering = true; return sim.ac.flapsSet === 0 && sim.d.ias > 78; } },
    ],
  },
  {
    id: "turnspoint", pro: true, title: "Turns around a point", tag: "Ground reference maneuvers", time: "6 min", level: 3,
    summary: "Circle the red barn twice at 800 ft above the ground, keeping the same distance from it in a 12-knot wind: steepest bank downwind, shallowest upwind.",
    exam: ["t56", "p34", "t57"],
    tips: ["Enter downwind, about ¼ mile from the barn. Downwind your groundspeed is highest, so you need the steepest bank there (no more than 45°).", "Upwind you're slowest over the ground: shallowest bank. Crosswind legs need a wind correction angle toward the point or away from it.", "ACS: altitude ±100 ft, airspeed ±10 kt. Look outside, not at the instruments, and pick an emergency landing field before you start."],
    setup(sim, ls) {
      sim.setWeather({ ...PRESETS.clear, windDir: 270, windKt: 12, gustKt: 0 }); sim.setTime(11);
      const P = BARN; ls.agl = 800; ls.targetFt = heightAt(P.x, P.z) / FT + ls.agl;
      sim.spawn({ x: P.x, z: P.z + 430, hdg: 90, onGround: false, altFt: ls.targetFt, kias: 90 }); sim.ac.ctl.throttle = 0.6; sim.ac.ctl.trim = 0.05;
      barnSetup(sim, ls);
    },
    tick(sim, ls) {
      const dx = sim.ac.pos.x - BARN.x, dz = sim.ac.pos.z - BARN.z;
      ls.r = Math.hypot(dx, dz); const a = Math.atan2(dx, -dz) / DEG;
      if (ls.prevA != null && ls.counting) ls.turned = (ls.turned || 0) - wrap180(a - ls.prevA);
      ls.prevA = a;
      if (ls.counting && (ls.turned || 0) < 720) {
        ls.rMin = Math.min(ls.rMin ?? Infinity, ls.r); ls.rMax = Math.max(ls.rMax ?? 0, ls.r);
        ls.altDev = Math.max(ls.altDev || 0, Math.abs(sim.d.altTrue - ls.targetFt)); ls.bankMax = Math.max(ls.bankMax || 0, Math.abs(sim.d.bank));
      }
    },
    cleanup(sim, ls) { removeProps(sim, ls); },
    objectives: [
      { text: "Enter downwind, the barn on your left about ¼ mile away, at 800 ft above the ground", check(sim, ls, dt) { const ok = ls.r > 200 && ls.r < 800 && Math.abs(sim.d.altTrue - ls.targetFt) < 150; ls.e = ok ? (ls.e || 0) + dt : 0; if (ls.e > 3) { ls.counting = true; return true; } } },
      { text: "Fly two full turns around the barn at a constant radius", check: (sim, ls) => (ls.turned || 0) >= 720, fail: (sim, ls) => (ls.r > 1800 ? "You flew too far from the barn. Keep it off your left wingtip and adjust the bank for the wind." : null), result: (ls) => `Distance from the barn: ${Math.round(ls.rMin / FT).toLocaleString()} to ${Math.round(ls.rMax / FT).toLocaleString()} ft (keep it as constant as you can). Altitude within ${Math.round(ls.altDev)} ft (ACS ±100). Steepest bank ${Math.round(ls.bankMax)}° (no more than 45°).` },
      { text: "Roll out on the entry heading, 090 (±10°)", check: (sim) => Math.abs(sim.d.bank) < 6 && Math.abs(wrap180(sim.d.hdg - 90)) < 10 },
    ],
  },
  {
    id: "sturns", pro: true, title: "S-turns across a road", tag: "Ground reference maneuvers", time: "5 min", level: 3,
    summary: "A straight country road runs north–south across a 12-knot west wind. Cross it at 90°, fly a half circle on each side and cross again wings level, keeping both halves the same size.",
    exam: ["p34", "t57"],
    tips: ["Enter downwind at 800 ft above the ground, crossing the road at 90°. Your groundspeed is highest downwind, so start with the steepest bank (no more than 45°).", "Shallow the bank as you turn into the wind, then roll wings level exactly as you cross the road, and reverse the turn.", "ACS: altitude ±100 ft, airspeed ±10 kt, cross the road wings level and perpendicular."],
    setup(sim, ls) {
      sim.setWeather({ ...PRESETS.clear, windDir: 270, windKt: 12, gustKt: 0 }); sim.setTime(10.5);
      ls.targetFt = heightAt(ROAD.x, ROAD.z0) / FT + 800;
      sim.spawn({ x: ROAD.x - 1500, z: ROAD.z0, hdg: 90, onGround: false, altFt: ls.targetFt, kias: 90 }); sim.ac.ctl.throttle = 0.6; sim.ac.ctl.trim = 0.05;
      roadSetup(sim, ls);
    },
    tick(sim, ls) {
      const side = Math.sign(sim.ac.pos.x - ROAD.x);
      if (ls.side && side && side !== ls.side) ls.cross = { hdg: sim.d.hdg, bank: Math.abs(sim.d.bank), altErr: Math.abs(sim.d.altTrue - ls.targetFt) };
      if (side) ls.side = side;
      if (ls.counting) {
        const off = Math.abs(sim.ac.pos.x - ROAD.x);
        if (side > 0) ls.east = Math.max(ls.east || 0, off); else ls.west = Math.max(ls.west || 0, off);
        ls.altDev = Math.max(ls.altDev || 0, Math.abs(sim.d.altTrue - ls.targetFt)); ls.bankMax = Math.max(ls.bankMax || 0, Math.abs(sim.d.bank));
      }
    },
    cleanup(sim, ls) { removeProps(sim, ls); },
    objectives: [
      { text: "Cross the road at 90°, heading east (downwind), wings level, 800 ft above the ground", check(sim, ls) { const c = takeCross(ls); if (c && Math.abs(wrap180(c.hdg - 90)) < 20 && c.bank < 15 && c.altErr < 150) { ls.counting = true; return true; } } },
      { text: "Turn left: a half circle on the east side, then cross the road again wings level, heading west", check(sim, ls) { const c = takeCross(ls); if (c) { ls.c2 = c; return true; } }, fail: (sim, ls) => sTurnFail(sim, ls, 270, "c2") },
      { text: "Turn right: a matching half circle on the west side, then cross wings level, heading east", check(sim, ls) { const c = takeCross(ls); if (c) { ls.c3 = c; return true; } }, fail: (sim, ls) => sTurnFail(sim, ls, 90, "c3"), result: (ls) => `Half circles reached ${Math.round(ls.east / FT).toLocaleString()} ft east and ${Math.round(ls.west / FT).toLocaleString()} ft west of the road (make them match). Bank as you crossed: ${Math.round(ls.c2.bank)}° and ${Math.round(ls.c3.bank)}° (aim for wings level). Altitude within ${Math.round(ls.altDev)} ft (ACS ±100). Steepest bank ${Math.round(ls.bankMax)}° (no more than 45°).` },
    ],
  },
  {
    id: "rectangle", pro: true, title: "Rectangular course", tag: "Ground reference maneuvers", time: "6 min", level: 3,
    summary: "Fly a left-hand circuit around a rectangular field at 800 ft above the ground, about ¼ mile outside its edges, in a 12-knot west wind. Crab on the crosswind legs so your track stays parallel to the field.",
    exam: ["t56", "p34"],
    tips: ["It's a traffic pattern without the runway: the same crab angles and the same uneven turns.", "Downwind to base the groundspeed is high, so turn steeper; the turns onto and off the upwind leg are less than 90° and shallower.", "ACS: altitude ±100 ft, airspeed ±10 kt, a uniform distance from the field, and no more than 45° of bank."],
    setup(sim, ls) {
      sim.setWeather({ ...PRESETS.clear, windDir: 270, windKt: 12, gustKt: 0 }); sim.setTime(15);
      ls.targetFt = heightAt(FIELD.x, FIELD.z) / FT + 800;
      sim.spawn({ x: FIELD.x - 500, z: FIELD.z + FIELD.hz + 460, hdg: 90, onGround: false, altFt: ls.targetFt, kias: 90 }); sim.ac.ctl.throttle = 0.6; sim.ac.ctl.trim = 0.05;
      fieldSetup(sim, ls);
    },
    tick(sim, ls) {
      const x = sim.ac.pos.x - FIELD.x, z = sim.ac.pos.z - FIELD.z;
      const dx = Math.max(Math.abs(x) - FIELD.hx, 0), dz = Math.max(Math.abs(z) - FIELD.hz, 0);
      ls.dist = Math.hypot(dx, dz);
      ls.leg = dx > 0 && dz > 0 ? "corner" : z > FIELD.hz ? "south" : z < -FIELD.hz ? "north" : x > FIELD.hx ? "east" : x < -FIELD.hx ? "west" : "over";
      if (ls.prevHdg != null && ls.counting) ls.turned = (ls.turned || 0) - wrap180(sim.d.hdg - ls.prevHdg);
      ls.prevHdg = sim.d.hdg;
      if (ls.counting && (ls.turned || 0) < 360) {
        if (ls.leg !== "corner" && ls.leg !== "over") { ls.dMin = Math.min(ls.dMin ?? Infinity, ls.dist); ls.dMax = Math.max(ls.dMax ?? 0, ls.dist); }
        if (ls.leg === "east" || ls.leg === "west") { const crab = Math.abs(wrap180(sim.d.hdg - sim.d.track)); ls[`crab_${ls.leg}`] = Math.max(ls[`crab_${ls.leg}`] || 0, crab); }
        ls.altDev = Math.max(ls.altDev || 0, Math.abs(sim.d.altTrue - ls.targetFt)); ls.bankMax = Math.max(ls.bankMax || 0, Math.abs(sim.d.bank));
      }
    },
    cleanup(sim, ls) { removeProps(sim, ls); },
    objectives: [
      { text: "Downwind leg: fly east along the south side of the field, about ¼ mile out", check(sim, ls, dt) { const ok = ls.leg === "south" && ls.dist > 250 && ls.dist < 700 && Math.abs(sim.d.altTrue - ls.targetFt) < 150; ls.ok1 = ok ? (ls.ok1 || 0) + dt : 0; if (ls.ok1 > 6) { ls.counting = true; return true; } } },
      { text: "Fly the whole rectangle: turn left at each corner and crab into the wind on the crosswind legs", check: (sim, ls) => (ls.turned || 0) >= 330 && ls.leg === "south" && Math.abs(wrap180(sim.d.hdg - 90)) < 15 && Math.abs(sim.d.bank) < 10, fail: (sim, ls) => (ls.dist > 2000 ? "You flew too far from the field. Keep its edge about ¼ mile off your left side." : null), result: (ls) => `Distance from the field on the straight legs: ${Math.round(ls.dMin / FT).toLocaleString()} to ${Math.round(ls.dMax / FT).toLocaleString()} ft (keep it uniform). Crab angle on the crosswind legs: ${Math.round(ls.crab_east || 0)}° on the east side, ${Math.round(ls.crab_west || 0)}° on the west side. Altitude within ${Math.round(ls.altDev)} ft (ACS ±100). Steepest bank ${Math.round(ls.bankMax)}°.` },
    ],
  },
  {
    id: "nightxc", pro: true, title: "Night cross-country: KAME → KZAR", tag: "Night operations", time: "10 min", level: 3,
    summary: "After dark, fly from Earhart Municipal back to Zarhart Field. Position lights on, navigate with the ZRH VOR, call the tower before its Class D, then find the field by its beacon and land on runway 27.",
    exam: ["e14", "p10", "e49", "e67"],
    tips: ["Position lights are required from sunset to sunrise (14 CFR 91.209), and VFR at night needs 45 minutes of fuel reserve instead of 30 (91.151).", "Find an airport at night by its rotating beacon: white and green for a civil land airport. Runway edge lights are white; the threshold shows green toward you.", "Zarhart's Class D starts about 4 NM out. Establish two-way radio communication before you enter: call about 10 NM out."],
    setup(sim, ls) {
      sim.setWeather({ ...PRESETS.clear, windDir: 260, windKt: 6, gustKt: 0 }); sim.setTime(21.5);
      sim.spawn({ x: 20000, z: 12000, hdg: 315, onGround: false, altFt: 3500, kias: 100 }); sim.ac.ctl.throttle = 0.62;
      sim.ac.elec.lights.nav = false; sim.ac.elec.lights.landing = false; sim.ac.elec.lights.beacon = true;
      sim.radio.com1 = KAME.freqs.ctaf; sim.radio.com1s = KZAR.freqs.twr; sim.radio.nav1 = 116.4; sim.radio.nav1s = 113.9;
      sim.setRoute([{ x: 20000, z: 12000 }, { x: ZRH.x, z: ZRH.z, id: "ZRH" }, { x: KZAR.x, z: KZAR.z, id: "KZAR" }]);
    },
    tick(sim, ls) { if (ls.callNm == null && sim.flags.dContact) ls.callNm = nmTo(sim, KZAR.x, KZAR.z); },
    objectives: [
      { text: "Turn on the position (nav) lights: required from sunset to sunrise (Aircraft → Lights)", check: (sim) => sim.ac.elec.lights.nav },
      { text: "Tune NAV1 to ZRH 113.90 and turn the OBS until the needle centers with a TO flag", check: (sim) => Math.abs(sim.radio.nav1 - 113.9) < 0.01 && sim.vor1?.ok && sim.vor1.toFrom === "TO" && Math.abs(sim.vor1.cdi) < 0.5 },
      { text: "Call Zarhart Tower about 10 NM out, before its Class D (COM1 118.30, Radio → Inbound call)", check: (sim) => sim.flags.dContact, fail: (sim) => (!sim.flags.dContact && nmTo(sim, KZAR.x, KZAR.z) < 4.25 ? "You reached Zarhart's Class D without two-way radio communication. Call the tower before you enter (14 CFR 91.129)." : null), result: (ls) => `Called the tower ${ls.callNm.toFixed(1)} NM out.` },
      { text: "Find the field by its white-and-green beacon and land on runway 27", check: (sim) => landedOn(sim, KZAR, "27"), fail: offRunway(KZAR), result: (ls, sim) => touchdownReport(sim, KZAR, "27") },
    ],
  },
  {
    id: "slip", pro: true, title: "Forward slip to a landing", tag: "Takeoffs & landings", time: "4 min", level: 3,
    summary: "Short final to runway 27 with the flaps up, and you're twice as high as you should be. Power to idle and slip: left wing down, right rudder. Lose the height without gaining speed, straighten out before the flare and land just past the orange bar.",
    exam: ["e40", "t23"],
    tips: ["Lower the upwind wing (the wind is from 230°, so the left) and hold opposite rudder (E): the nose points right of the runway. Use the bank to stay over the centreline and the rudder to set how fast you come down.", "Pitch for 65 KIAS the whole way. To come out of the slip, level the wings and center the rudder together, at least 100 ft above the runway, then keep just enough left wing down for the crosswind.", "Some 172s carry a placard, 'Avoid slips with flaps extended', so this lesson keeps the flaps up. ACS: touch down on the point or within 400 ft beyond it, with no drift and the nose along the centreline."],
    setup(sim, ls) {
      sim.setWeather({ ...PRESETS.clear, windDir: 230, windKt: 8, gustKt: 0 }); sim.setTime(16.5);
      const sp = onFinal(KZAR, "27", 1.4, 65, 0); sp.altFt = KZAR.elevFt + 1000; sim.spawn(sp); // the 3° path is about 480 ft here
      sim.ac.ctl.throttle = 0.2; sim.ac.ctl.trim = 0.2; sim.ac.eng.carbHeat = true;
      ls.e = end(KZAR, "27"); const g = new THREE.Group(); aimBar(g, ls.e, AIM_M); sim.scene.add(g); ls.props = g;
    },
    tick(sim, ls, dt) {
      const d = sim.d, b = d.beta || 0;
      if (d.onGround) return;
      if (b < -8) { ls.slipT = (ls.slipT || 0) + dt; ls.sink = (ls.sink || 0) + d.vsTrue * dt; ls.betaMax = Math.max(ls.betaMax || 0, -b); ls.iasMin = Math.min(ls.iasMin ?? 999, d.ias); ls.iasMax = Math.max(ls.iasMax || 0, d.ias); ls.slipping = true; }
      else if (ls.slipping && Math.abs(b) < 4) { ls.slipping = false; ls.outAgl = d.agl; }
      ls.wrongT = b > 8 ? (ls.wrongT || 0) + dt : 0;
      if (ls.wrongT > 3 && !ls.warned) { ls.warned = true; sim.say("That slip has the right wing down. Slip into the wind: left wing down, right rudder.", "tip"); }
    },
    cleanup(sim, ls) { removeProps(sim, ls); },
    objectives: [
      { text: "Throttle to idle, flaps up, then slip: left wing down, right rudder (E), nose pointed right of the runway", check(sim, ls, dt) { const ok = sim.ac.ctl.throttle < 0.1 && sim.ac.flapsSet === 0 && sim.d.beta < -8; ls.s1 = ok ? (ls.s1 || 0) + dt : 0; return ls.s1 > 4; } },
      { text: "Hold the slip down to a normal glidepath, then straighten out (wings level, rudder centred) by 100 ft above the ground", check(sim, ls, dt) { const ok = sim.d.agl < 400 && Math.abs(sim.d.beta) < 4; ls.s2 = ok ? (ls.s2 || 0) + dt : 0; return ls.s2 > 2; }, fail: (sim) => (sim.d.agl < 40 && Math.abs(sim.d.beta) > 8 ? "Still slipping in the flare: you'd touch down moving sideways and load the landing gear from the side. Straighten the nose with rudder before the flare." : null), result: (ls) => `Slipped for ${Math.round(ls.slipT || 0)} s at up to ${Math.round(ls.betaMax || 0)}° of sideslip, sinking about ${Math.round(-(ls.sink || 0) / (ls.slipT || 1)).toLocaleString()} fpm (about 600 fpm without the slip). Airspeed ${Math.round(ls.iasMin ?? 0)}–${Math.round(ls.iasMax || 0)} KIAS (aim for 65). Straightened out ${Math.round(ls.outAgl ?? 0)} ft above the ground.` },
      { text: "Touch down on the orange bar or within 400 ft beyond it, nose along the centreline", fail: offRunway(KZAR), check(sim, ls) { if (landedOn(sim, KZAR, "27")) { const td = sim.lastTouchdown; ls.tdS = distFromThreshold(ls.e, td.x, td.z); ls.align = Math.abs(wrap180(sim.d.hdg - 270)); return true; } }, result: (ls, sim) => { const off = Math.round((ls.tdS - AIM_M) / FT); const where = off >= 0 && off <= 400 ? `${off} ft beyond the bar: that meets the ACS standard (on it or within 400 ft beyond)` : off < 0 ? `${-off} ft short of the bar (the ACS standard is on it or within 400 ft beyond)` : `${off} ft beyond the bar (the ACS standard is within 400 ft)`; return `${touchdownReport(sim, KZAR, "27")} You touched down ${where}, nose ${Math.round(ls.align)}° off the runway heading.`; } },
      { text: "Slow to taxi speed on the runway", check: (sim) => sim.d.onGround && sim.d.gs < 8 },
    ],
  },
  {
    id: "goaround", pro: true, title: "Go-around", tag: "Takeoffs & landings", time: "4 min", level: 2,
    summary: "A normal final to runway 27 with full flaps, until an airplane taxis onto the runway and the tower tells you to go around. Full power, pitch up, clean up the flaps in stages, sidestep the runway and climb at Vy.",
    exam: ["t16", "t24"],
    tips: ["Power first: full throttle and carb heat off, pitch up to stop the descent, then flaps to 20 right away. The last 10° of flap is mostly drag.", "Once you're climbing and above 60 KIAS, take the flaps up in stages (10, then 0), letting the nose come down a little each time so the airplane doesn't sink.", "Sidestep to the right of the runway so the traffic stays in view out your left window, and tell the tower you're going around. ACS: Vy +10/−5 kt to a safe altitude."],
    setup(sim, ls) {
      sim.setWeather({ ...PRESETS.clear, windDir: 270, windKt: 6, gustKt: 0 }); sim.setTime(10.5);
      sim.spawn(onFinal(KZAR, "27", 2.2, 65, 30)); sim.ac.ctl.throttle = 0.3; sim.ac.ctl.trim = 0.4; sim.ac.eng.carbHeat = true;
      sim.radio.com1 = KZAR.freqs.twr; sim.flags.dContact = true; ls.e = end(KZAR, "27");
      sim.radioLog("Zarhart Tower", `${sim.callsign}, runway 27, cleared to land.`);
      trafficSetup(sim, ls);
    },
    tick(sim, ls, dt) {
      const d = sim.d, s = distFromThreshold(ls.e, sim.ac.pos.x, sim.ac.pos.z);
      if (ls.moveT == null && s > -2100) ls.moveT = sim.t;
      if (ls.moveT != null) trafficTaxi(ls, (sim.t - ls.moveT) / 14);
      if (ls.called == null && (s > -1700 || d.agl < 320)) { ls.called = sim.t; sim.radioLog("Zarhart Tower", `${sim.callsign}, go around, traffic on the runway.`); }
      if (ls.called == null) return;
      ls.minAgl = Math.min(ls.minAgl ?? Infinity, d.agl);
      if (ls.tPower == null && sim.ac.ctl.throttle > 0.9) ls.tPower = sim.t - ls.called;
      if (ls.prevFlaps != null && sim.ac.flapsSet < ls.prevFlaps && sim.ac.flapsSet <= 10 && d.ias < 58) ls.earlyFlaps = true;
      ls.prevFlaps = sim.ac.flapsSet;
      ls.right = Math.max(ls.right || 0, centerOffset(ls.e, sim.ac.pos.x, sim.ac.pos.z));
      if (ls.clean) { ls.climbT = (ls.climbT || 0) + dt; if (d.ias >= 69 && d.ias <= 84) ls.vyT = (ls.vyT || 0) + dt; }
    },
    cleanup(sim, ls) { removeProps(sim, ls); },
    objectives: [
      { text: "Fly a stable final to runway 27, flaps 30 at 65 KIAS, and listen to the tower", check: (sim, ls) => ls.called != null },
      { text: "Go around: full power, carb heat off, pitch up to climb, flaps 20", check: (sim) => sim.ac.ctl.throttle > 0.9 && !sim.ac.eng.carbHeat && sim.ac.flapsSet <= 20 && sim.d.vsTrue > 150, fail: (sim) => (sim.lastTouchdown && !sim.lastTouchdown.used ? "You landed with traffic on the runway. When the tower says go around, go around: full power right away." : null) },
      { text: "Climbing above 60 KIAS: flaps to 10, then up", check(sim, ls) { if (sim.ac.flapsSet === 0 && sim.d.vsTrue > 0) { ls.clean = true; ls.cleanAgl = sim.d.agl; return true; } }, result: (ls) => `Full power ${(ls.tPower ?? 0).toFixed(1)} s after the call; the lowest you got was ${Math.round(ls.minAgl)} ft above the ground. Flaps up at ${Math.round(ls.cleanAgl)} ft${ls.earlyFlaps ? ", but you took them up below 58 KIAS: wait for the speed or the airplane sinks" : ""}.` },
      { text: "Sidestep to the right of the runway and climb at Vy, 74 KIAS (+10/−5), to 1,000 ft above the field", check: (sim) => sim.d.altInd > KZAR.elevFt + 970, result: (ls) => `Vy (69–84 KIAS) ${Math.round(100 * (ls.vyT || 0) / (ls.climbT || 1))}% of the climb. Sidestepped ${Math.round(ls.right / FT)} ft right of the centreline${ls.right < 30 ? ": move further to the side so the traffic below stays in view" : ""}.` },
    ],
  },
  {
    id: "emerdesc", pro: true, title: "Emergency descent", tag: "Emergencies", time: "4 min", level: 3,
    summary: "Smoke from behind the panel at 5,500 ft: an electrical fire. Master switch off, then get down fast: idle, 30–45° of bank and a high airspeed. Level off at 2,500 ft and head for the nearest airport.",
    exam: ["e44", "t34", "e38"],
    tips: ["Electrical fire in flight (POH): master switch off, all other switches except the ignition off, vents closed, extinguisher if you have one, and land as soon as possible.", "Emergency descent: throttle idle, carb heat on, roll into 30–45° of bank and lower the nose. The bank keeps the load factor positive and lets you see what's below. Stay below Vno (127 KIAS, top of the green arc) unless the air is smooth, and never pass Vne (158, the red line).", "Start the level-off about 10% of your descent rate early: at 2,000 fpm, 200 ft above 2,500. ACS: 30–45° of bank, the right airspeed and configuration, and a smooth recovery."],
    setup(sim, ls) {
      sim.setWeather({ ...PRESETS.clear, windDir: 300, windKt: 8, gustKt: 0 }); sim.setTime(13);
      sim.spawn({ x: -14000, z: 14000, hdg: 0, onGround: false, altFt: 5500, kias: 105 }); sim.ac.ctl.throttle = 0.66; sim.ac.ctl.trim = 0.05;
      ls.levelFt = 2500;
    },
    tick(sim, ls, dt) {
      if (!ls.desc || ls.level) return;
      const d = sim.d; ls.descT = (ls.descT || 0) + dt;
      ls.iasMax = Math.max(ls.iasMax || 0, d.ias); ls.altMin = Math.min(ls.altMin ?? Infinity, d.altInd);
      if (d.altInd > ls.levelFt + 400) { ls.bankMin = Math.min(ls.bankMin ?? 90, Math.abs(d.bank)); ls.bankMax = Math.max(ls.bankMax || 0, Math.abs(d.bank)); }
    },
    objectives: [
      { text: "Smoke from behind the panel: an electrical fire. Master switch OFF (Aircraft → Switches)", check: (sim) => !sim.ac.elec.master },
      { text: "Emergency descent: throttle idle, carb heat on, roll into a 30–45° bank and lower the nose", check(sim, ls, dt) { const b = Math.abs(sim.d.bank); const ok = sim.ac.ctl.throttle < 0.1 && sim.ac.eng.carbHeat && b > 28 && b < 48 && sim.d.vsi < -1000; ls.s2 = ok ? (ls.s2 || 0) + dt : 0; if (ls.s2 > 3) { ls.desc = true; ls.alt0 = sim.d.altInd; return true; } }, fail: descentFail },
      { text: "Descend at 100–127 KIAS in the bank, then roll out and level off at 2,500 ft (±100)", check(sim, ls, dt) { const ok = Math.abs(sim.d.altInd - ls.levelFt) < 100 && Math.abs(sim.d.bank) < 10 && Math.abs(sim.d.vsi) < 400; ls.s3 = ok ? (ls.s3 || 0) + dt : 0; if (ls.s3 > 3) { ls.level = true; return true; } }, fail: (sim, ls) => descentFail(sim) || (sim.d.altInd < ls.levelFt - 300 ? "You descended 300 ft below 2,500. Start the level-off about 10% of the descent rate early." : null), result: (ls) => `Descended ${Math.round(ls.alt0 - ls.levelFt).toLocaleString()} ft in ${Math.round(ls.descT)} s: about ${Math.round((ls.alt0 - ls.levelFt) / ls.descT * 60).toLocaleString()} fpm. Fastest ${Math.round(ls.iasMax)} KIAS (Vno 127, Vne 158). Bank ${Math.round(ls.bankMin)}–${Math.round(ls.bankMax)}° (ACS 30–45°). Lowest altitude ${Math.round(ls.altMin).toLocaleString()} ft.` },
      { text: "Head for the nearest airport, Electra Field (Z19): roll out on its bearing (±15°)", check(sim, ls, dt) { const ok = Math.abs(wrap180(sim.d.track - bearing(sim, Z19))) < 15 && Math.abs(sim.d.bank) < 10; ls.s4 = ok ? (ls.s4 || 0) + dt : 0; return ls.s4 > 3; }, result: (ls, sim) => `Electra Field is ${nmTo(sim, Z19.x, Z19.z).toFixed(1)} NM ahead: land as soon as possible. With the master off, the radios and transponder are off too; the POH lets you turn it back on only if the fire is out and you need the power.` },
    ],
  },
  {
    id: "diversion", pro: true, title: "Diversion: alternator failure", tag: "Navigation", time: "6 min", level: 3,
    summary: "Southbound at 4,500 ft over the farmland south of the valley, the alternator quits. Shed electrical load, divert promptly to the nearest airport, estimate your heading, time and fuel, and hold altitude and heading on the way.",
    exam: ["p44", "e56", "e57", "e14"],
    tips: ["Ammeter showing a discharge and the VOLTS light on: the alternator has failed and the battery is carrying everything. Turn off what you don't need (landing light, strobes) and land as soon as practical.", "Divert first, then work it out. Use the map (M) for the course and distance; time = distance ÷ groundspeed × 60 (groundspeed is on the DME box); fuel = time × about 9 gal/hr.", "ACS: divert promptly, make an accurate estimate of heading, groundspeed, time and fuel, and hold altitude ±200 ft and heading ±15°."],
    setup(sim, ls) {
      sim.setWeather({ ...PRESETS.clear, windDir: 300, windKt: 10, gustKt: 0 }); sim.setTime(11);
      sim.spawn({ x: 4000, z: 21000, hdg: 180, onGround: false, altFt: 4500, kias: 100 }); sim.ac.ctl.throttle = 0.66; sim.ac.ctl.trim = 0.05;
      sim.radio.com1 = 121.5; sim.radio.com1s = KAME.freqs.ctaf;
    },
    tick(sim, ls, dt) {
      const d = sim.d;
      if (ls.failed == null && sim.t - ls.t0 > 15) { ls.failed = sim.t; sim.ac.failures.alternator = true; sim.say("The ammeter shows a discharge and the VOLTS light is on.", "warn"); }
      if (ls.failed != null && ls.diverted == null && sim.t - ls.failed > 75 && !ls.hinted) { ls.hinted = true; sim.say(`Hint: the nearest airport is Earhart Municipal (KAME), ${nmTo(sim, KAME.x, KAME.z).toFixed(0)} NM to the northeast.`, "tip"); }
      if (ls.est && !ls.arrived) {
        ls.sx = (ls.sx || 0) + Math.sin(d.hdg * DEG) * dt; ls.cx = (ls.cx || 0) + Math.cos(d.hdg * DEG) * dt;
        ls.altDev = Math.max(ls.altDev || 0, Math.abs(d.altInd - 4500));
        ls.hdgDev = Math.max(ls.hdgDev || 0, Math.abs(wrap180(d.track - bearing(sim, KAME))));
      }
    },
    objectives: [
      { text: "Cruise south at 4,500 ft and scan the engine and electrical gauges", check: (sim, ls) => ls.failed != null },
      { text: "Alternator failure: shed electrical load. Landing light and strobes off (Aircraft → Switches)", check: (sim) => !sim.ac.elec.lights.landing && !sim.ac.elec.lights.strobe },
      { text: "Divert promptly to the nearest airport: find it on the map (M) and turn toward it", check(sim, ls, dt) { const ok = Math.abs(wrap180(sim.d.track - bearing(sim, KAME))) < 15; ls.s3 = ok ? (ls.s3 || 0) + dt : 0; if (ls.s3 > 3) { ls.diverted = sim.t - ls.failed; return true; } } },
      { text: "Estimate your heading, time and fuel to Earhart Municipal (KAME) and enter them below", ask: [{ key: "hdg", label: "Heading", unit: "°" }, { key: "min", label: "Time", unit: "min" }, { key: "gal", label: "Fuel", unit: "gal" }], check(sim, ls) { if (ls.answers) { ls.est = { ...ls.answers, t: sim.t, fuel: sim.d.fuelL + sim.d.fuelR }; return true; } } },
      { text: "Self-announce on the KAME CTAF, 122.8 (Radio → Self-announce)", check: (sim) => sim.flags.inboundCall && Math.abs(sim.radio.com1 - KAME.freqs.ctaf) < 0.01 },
      { text: "Fly to within 4 NM of KAME at 4,500 ft (±200) and on course (±15°)", check(sim, ls) { if (nmTo(sim, KAME.x, KAME.z) < 4) { ls.arrived = true; return true; } }, result: (ls, sim) => diversionReport(sim, ls) },
    ],
  },
];

/* ---- short-field landing: a 50-ft tree line before runway 27 and an orange aiming bar ---- */
const AIM_M = 500 * FT, TREES_S = -250, TREE_H = 50 * FT;
function shortSetup(sim, ls) {
  const e = end(KZAR, "27"); const h = e.hdg * DEG; const fx = Math.sin(h), fz = -Math.cos(h), px = Math.cos(h), pz = Math.sin(h);
  const g = new THREE.Group(); const leaf = new THREE.MeshLambertMaterial({ color: 0x2f5a2a }), trunk = new THREE.MeshLambertMaterial({ color: 0x5a3d22 });
  for (let c = -80; c <= 80; c += 9) {
    const x = e.x + fx * TREES_S + px * c, z = e.z + fz * TREES_S + pz * c, y = heightAt(x, z);
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 4, 6), trunk); t.position.set(x, y + 2, z); g.add(t);
    const k = new THREE.Mesh(new THREE.ConeGeometry(4.2, TREE_H - 3, 8), leaf); k.position.set(x, y + 3 + (TREE_H - 3) / 2, z); g.add(k);
  }
  aimBar(g, e, AIM_M);
  sim.scene.add(g); ls.props = g; ls.e = e;
}
/** an orange bar across the runway `s` metres past the threshold of end `e`, with a cone at each side */
function aimBar(g, e, s) {
  const h = e.hdg * DEG; const fx = Math.sin(h), fz = -Math.cos(h), px = Math.cos(h), pz = Math.sin(h);
  const bar = new THREE.Mesh(new THREE.PlaneGeometry(30, 4), new THREE.MeshBasicMaterial({ color: 0xff7a1a, polygonOffset: true, polygonOffsetFactor: -4 }));
  bar.rotation.x = -Math.PI / 2; bar.rotation.z = -h; bar.position.set(e.x + fx * s, KZAR.elev + 0.08, e.z + fz * s); g.add(bar);
  for (const k of [-1, 1]) { const cone = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.4, 10), new THREE.MeshLambertMaterial({ color: 0xff7a1a })); cone.position.set(e.x + fx * s + px * k * 19, KZAR.elev + 0.7, e.z + fz * s + pz * k * 19); g.add(cone); }
}
function shortTick(sim, ls) {
  if (ls.passed) return;
  const s = distFromThreshold(ls.e, sim.ac.pos.x, sim.ac.pos.z);
  if (s < TREES_S) return;
  ls.passed = true;
  const wheels = sim.ac.pos.y - 1.2, ground = heightAt(sim.ac.pos.x, sim.ac.pos.z);
  ls.clearance = wheels - (ground + TREE_H);
  if (ls.clearance < 0 && Math.abs(centerOffset(ls.e, sim.ac.pos.x, sim.ac.pos.z)) < 90) ls.hitTrees = true; else ls.cleared = true;
}
function removeProps(sim, ls) { if (ls.props) sim.scene.remove(ls.props); ls.props = null; }
function slowStall(sim) { return sim.d.stalled ? "The wing stalled. In slow flight, lower the nose slightly or add power as soon as the stall horn sounds." : null; }

/* ---- turns around a point: a red barn and silo in the fields west of the river ---- */
const BARN = { x: -1500, z: 9300 }; // circles stay outside Zarhart's Class D (7.8 km)
function barnSetup(sim, ls) {
  const g = new THREE.Group(); const y = heightAt(BARN.x, BARN.z);
  const red = new THREE.MeshLambertMaterial({ color: 0xa3261e }), roof = new THREE.MeshLambertMaterial({ color: 0x3b3f45 }), white = new THREE.MeshLambertMaterial({ color: 0xe8e8e2 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(14, 8, 22), red); body.position.set(BARN.x, y + 4, BARN.z); g.add(body);
  for (const s of [-1, 1]) { const slope = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.35, 23), roof); slope.rotation.z = -s * 0.62; slope.position.set(BARN.x + s * 3.5, y + 10.4, BARN.z); g.add(slope); } // gable roof
  const gable = new THREE.Shape([new THREE.Vector2(-7, 0), new THREE.Vector2(7, 0), new THREE.Vector2(0, 4.9)]);
  for (const s of [-1, 1]) { const end = new THREE.Mesh(new THREE.ShapeGeometry(gable), red); end.position.set(BARN.x, y + 8, BARN.z + s * 11.01); if (s < 0) end.rotation.y = Math.PI; g.add(end); }
  const silo = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 18, 16), white); silo.position.set(BARN.x + 11, y + 9, BARN.z - 4); g.add(silo);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(3, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x9aa3ad })); dome.position.set(BARN.x + 11, y + 18, BARN.z - 4); g.add(dome);
  sim.scene.add(g); ls.props = g;
}

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

/* ---- ground reference props: a north–south road for S-turns and a rectangular field ---- */
const ROAD = { x: 6000, z0: 15000, z1: 8500, z2: 19500 }; // z0: where you first cross it
const FIELD = { x: -1000, z: 13500, hx: 700, hz: 450 }; // centre and half-sizes, metres
/** a flat strip along the ground from (x1,z1) to (x2,z2), in short segments that follow the terrain */
function strip(g, x1, z1, x2, z2, w, mat, seg = 50) {
  const len = Math.hypot(x2 - x1, z2 - z1), n = Math.max(1, Math.ceil(len / seg)), ang = Math.atan2(x2 - x1, z2 - z1);
  const geo = new THREE.PlaneGeometry(w, len / n + 0.6);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t;
    const m = new THREE.Mesh(geo, mat); m.rotation.order = "YXZ"; m.rotation.set(-Math.PI / 2, ang, 0); m.position.set(x, heightAt(x, z) + 0.6, z); g.add(m);
  }
}
/** a 1 px line draped along the corners: a narrow strip breaks up into dashes from a mile away, a line doesn't */
function drape(g, corners, color, seg = 40) {
  const pts = [];
  for (let i = 0; i < corners.length - 1; i++) {
    const [x1, z1] = corners[i], [x2, z2] = corners[i + 1], n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, z2 - z1) / seg));
    for (let k = i ? 1 : 0; k <= n; k++) { const x = x1 + (x2 - x1) * k / n, z = z1 + (z2 - z1) * k / n; pts.push(new THREE.Vector3(x, heightAt(x, z) + 1.2, z)); }
  }
  g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color })));
}
function roadSetup(sim, ls) {
  const g = new THREE.Group();
  strip(g, ROAD.x, ROAD.z1, ROAD.x, ROAD.z2, 12, new THREE.MeshLambertMaterial({ color: 0x5c5f63, polygonOffset: true, polygonOffsetFactor: -4 }));
  drape(g, [[ROAD.x, ROAD.z1], [ROAD.x, ROAD.z2]], 0x7c7f83);
  sim.scene.add(g); ls.props = g;
}
function fieldSetup(sim, ls) {
  const g = new THREE.Group(); const mat = new THREE.MeshLambertMaterial({ color: 0xd6cda8, polygonOffset: true, polygonOffsetFactor: -4 });
  const x0 = FIELD.x - FIELD.hx, x1 = FIELD.x + FIELD.hx, z0 = FIELD.z - FIELD.hz, z1 = FIELD.z + FIELD.hz;
  strip(g, x0, z1, x1, z1, 8, mat); strip(g, x1, z1, x1, z0, 8, mat); strip(g, x1, z0, x0, z0, 8, mat); strip(g, x0, z0, x0, z1, 8, mat);
  drape(g, [[x0, z1], [x1, z1], [x1, z0], [x0, z0], [x0, z1]], 0xd6cda8);
  sim.scene.add(g); ls.props = g;
}
/** the last road crossing (heading, bank, altitude error), used once */
function takeCross(ls) { const c = ls.cross; ls.cross = null; return c; }
function sTurnFail(sim, ls, want, key) {
  if (ls.cross && Math.abs(wrap180(ls.cross.hdg - want)) > 30) return `You crossed the road heading ${String(Math.round(ls.cross.hdg)).padStart(3, "0")}°. Cross it at 90°, heading ${String(want).padStart(3, "0")}°, after a full half circle.`;
  if (Math.abs(sim.ac.pos.x - ROAD.x) > 2500) return "You flew too far from the road. Each half circle should be only about ¼ mile across.";
  return null;
}

/* ---- go-around: a Piper taxis from A6 onto the threshold of runway 27 ---- */
function trafficSetup(sim, ls) {
  const p = buildAirplane({ reg: "N4428P", stripe: 0x2f7fd0, simple: true });
  sim.scene.add(p); ls.props = p; trafficTaxi(ls, 0);
}
/** u: 0 holding short on A6, 1 lined up on the runway */
function trafficTaxi(ls, u) {
  const p = ls.props; if (!p) return; u = Math.min(1, Math.max(0, u));
  let x = 745, z = -85, hdg = 180;
  if (u < 0.6) z = -85 + (u / 0.6) * 70;
  else { const v = (u - 0.6) / 0.4; hdg = 180 + 90 * v; x = 745 - 30 * v; z = -15 + 15 * v; }
  p.position.set(x, KZAR.elev + 1.22, z); p.rotation.y = -hdg * DEG;
}

/* ---- emergency descent and diversion ---- */
function descentFail(sim) {
  if (sim.d.ias > 158) return "You passed Vne (158 KIAS, the red line). In an emergency descent, stay below Vno (127) unless the air is smooth.";
  if (Math.abs(sim.d.bank) > 60) return "More than 60° of bank. Keep it between 30° and 45°: any steeper and the nose drops while the load factor climbs.";
  return null;
}
function bearing(sim, ap) { return (Math.atan2(ap.x - sim.ac.pos.x, -(ap.z - sim.ac.pos.z)) / DEG + 360) % 360; }
function pad3(h) { return String(Math.round(h) % 360).padStart(3, "0"); }
function diversionReport(sim, ls) {
  const e = ls.est, gs = Math.max(30, sim.d.gs), restMin = nmTo(sim, KAME.x, KAME.z) / gs * 60;
  const min = (sim.t - e.t) / 60 + restMin, gal = e.fuel - (sim.d.fuelL + sim.d.fuelR) + (sim.d.fuelFlow || 9) * restMin / 60;
  const flown = `heading ${pad3((Math.atan2(ls.sx || 0, ls.cx || 1) / DEG + 360) % 360)}°, ${Math.round(min)} min, ${gal.toFixed(1)} gal`;
  const lead = `Diverted ${Math.round(ls.diverted)} s after the alternator failed. Altitude within ${Math.round(ls.altDev || 0)} ft (ACS ±200), course within ${Math.round(ls.hdgDev || 0)}° (ACS ±15).`;
  return e.skipped ? `${lead} Actual, projected to the field: ${flown}.` : `${lead} Your estimate: heading ${pad3(e.hdg)}°, ${e.min} min, ${e.gal} gal. Actual, projected to the field: ${flown}.`;
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
  /** answers for the current objective's `ask` form, e.g. { hdg: 40, min: 6, gal: 0.9 } (or { skipped: true }) */
  answer(vals) { if (this.lesson && !this.done) this.ls.answers = vals; }
  status() {
    const L = this.lesson; if (!L) return null;
    return { id: L.id, title: L.title, exam: L.exam, tips: L.tips, done: this.done, failed: this.failed, results: this.results, ask: this.done ? null : L.objectives[this.idx].ask || null, objectives: L.objectives.map((o, i) => ({ text: o.text, state: i < this.idx ? "done" : i === this.idx && !this.done ? "now" : this.failed && i === this.idx ? "failed" : "todo" })) };
  }
}
