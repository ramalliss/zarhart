// Scripted test pilot for end-to-end lesson tests. Load in the browser on /sim/:
//   const T = await import('/tools/test-pilot.js'); await T.runLesson('pattern')
// It flies through window.__zarhart.step(), which runs the real flight model, monitors and lesson checks without rendering.
import { AIRPORTS, NAVAIDS } from "../assets/js/sim/world-data.js";

const DEG = Math.PI / 180, NM = 1852, FT = 0.3048;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap180 = (a) => ((a % 360) + 540) % 360 - 180;
const brg = (fx, fz, tx, tz) => (Math.atan2(tx - fx, -(tz - fz)) / DEG + 360) % 360;
const [KZAR, KAME, Z19] = AIRPORTS;
const endOf = (ap, id) => { for (const r of ap.runways) for (const e of r.ends) if (e.id === id) return e; };

/* ---------------- low-level autopilot ---------------- */
export class AP {
  constructor() { this.pI = 0; this.thrI = 0; this.prevPe = null; this.prevBe = null; this.hdgRef = null; }
  /** attitude hold with coordinated rudder */
  attitude(ac, d, pitchCmd, bankCmd, dt, rudderOverride) {
    const pe = clamp(pitchCmd, -15, 20) - d.pitch; this.pI = clamp(this.pI + pe * dt, -15, 15);
    const pd = this.prevPe == null ? 0 : (pe - this.prevPe) / dt; this.prevPe = pe;
    ac.ctl.elevator = clamp(0.07 * pe + 0.03 * this.pI + 0.02 * pd, -1, 1);
    const be = clamp(bankCmd, -60, 60) - d.bank; const bd = this.prevBe == null ? 0 : (be - this.prevBe) / dt; this.prevBe = be;
    ac.ctl.aileron = clamp(0.04 * be + 0.012 * bd, -1, 1);
    ac.ctl.rudder = rudderOverride ?? clamp(0.9 * d.ball - 0.4 * ac.w.z, -1, 1);
  }
  /** pitch for a vertical speed (fpm) around a base pitch */
  vs(ac, d, vsCmd, basePitch, bankCmd, dt) {
    const err = (vsCmd - d.vsTrue) / 100; this.vsI = clamp((this.vsI || 0) + err * dt, -30, 30);
    this.attitude(ac, d, basePitch + 0.9 * err + 0.25 * this.vsI, bankCmd, dt);
  }
  /** throttle for an airspeed */
  speed(ac, d, kias, base, dt) { const e = kias - d.ias; this.thrI = clamp(this.thrI + e * dt * 0.004, -0.4, 0.4); ac.ctl.throttle = clamp(base + 0.035 * e + this.thrI, 0, 1); }
  /** heading via bank */
  bankFor(d, hdg, maxBank = 25) { return clamp(wrap180(hdg - d.hdg) * 1.4, -maxBank, maxBank); }
  /** cruise: hold altitude (ft MSL, true), airspeed with throttle, heading */
  cruise(ac, d, altFt, kias, hdg, dt, maxBank = 25) {
    const vsCmd = clamp((altFt - d.altTrue) * 3, -800, 800);
    this.vs(ac, d, vsCmd, 2, this.bankFor(d, hdg, maxBank), dt);
    this.speed(ac, d, kias, 0.6, dt);
  }
  /** ground roll steering: hold a heading with rudder/nosewheel, optionally pull to a line */
  steer(ac, d, hdg, dt, lateralM = 0) {
    const he = wrap180(hdg - d.hdg) - clamp(lateralM * 0.6, -12, 12);
    ac.ctl.rudder = clamp(he * 0.35 - ac.w.z * 8, -1, 1);
  }
}

/** Along-track (s, + past threshold) and cross-track (c, + right of centreline) for a runway end. */
function rwyFrame(e, x, z) { const h = e.hdg * DEG; return { s: (x - e.x) * Math.sin(h) - (z - e.z) * Math.cos(h), c: (x - e.x) * Math.cos(h) + (z - e.z) * Math.sin(h) }; }

/**
 * Approach + flare + rollout to runway end `e` at airport `ap`.
 * opts: { vref, flaps, aim (m past threshold), power: false for engine-out, brake }
 */
export function landing(ap, e, opts = {}) {
  const o = { vref: 65, flaps: 30, aim: 300, power: true, brake: true, ...opts };
  const elevM = ap.elev; const tan3 = Math.tan(3 * DEG);
  return (ac, d, sim, dt, apx) => {
    const { s, c } = rwyFrame(e, ac.pos.x, ac.pos.z);
    const h = ac.pos.y - 1.22 - elevM; // wheel height above the field
    if (d.onGround && apx.touched) { // rollout
      ac.ctl.throttle = 0; ac.ctl.elevator = 0.3; ac.ctl.aileron = 0; ac.flapsSet = 0;
      apx.steer(ac, d, e.hdg, dt, c);
      ac.ctl.brake = o.brake && d.gs < 55 ? clamp((d.gs - 3) / 20, 0.2, 0.8) : 0;
      return;
    }
    if (d.onGround) apx.touched = true;
    if (ac.flapsSet < o.flaps && d.ias < 84 && s > -4500) ac.flapsSet = Math.min(o.flaps, ac.flapsSet + 10);
    // lateral: track the extended centreline
    const near = h < 25;
    const xtkGain = near ? 0.06 : 0.1;
    const crab = d.gs > 20 ? wrap180(d.hdg - d.track) : 0; // fly the track, not the heading
    const hdgCmd = e.hdg + clamp(-c * xtkGain, -30, 30) + crab;
    let bank = apx.bankFor(d, hdgCmd, near ? 8 : 25);
    if (h < 8) { // de-crab: rudder aligns the nose, ailerons hold the centreline
      const lat = ac.vel.x * Math.cos(e.hdg * DEG) + ac.vel.z * Math.sin(e.hdg * DEG);
      bank = clamp(-c * 0.6 - lat * 4, -10, 10);
      const rud = clamp(wrap180(e.hdg - d.hdg) * 0.09 - ac.w.z * 3, -1, 1);
      apx.flareMode(ac, d, h, dt, bank, rud);
      return;
    }
    if (!o.power) { // engine out: pitch for speed
      ac.ctl.throttle = 0;
      apx.attitude(ac, d, clamp(-3 + (d.ias - (o.vref + 3)) * 0.5, -12, 6), bank, dt);
      if (h < 12) apx.flareMode(ac, d, h, dt, bank, null);
      return;
    }
    // vertical: follow the 3° path to the aim point
    const hTarget = Math.max(0, (o.aim - s) * tan3);
    const gsMps = d.gs * 0.5144;
    const vsCmd = clamp((-gsMps * tan3 + (hTarget - h) * 0.12) / FT * 60, -1100, 300);
    if (h < 14) { apx.flareMode(ac, d, h, dt, bank, null); return; }
    apx.vs(ac, d, vsCmd, -1, bank, dt);
    apx.speed(ac, d, o.vref, 0.28, dt);
  };
}
AP.prototype.flareMode = function (ac, d, h, dt, bank, rud) {
  ac.ctl.throttle = Math.max(0, ac.ctl.throttle - dt * 0.5);
  const vsCmd = clamp(-(0.25 + h * 0.22) / FT * 60, -900, -40); // sink rate shrinking with height
  const err = (vsCmd - d.vsTrue) / 100; this.fI = clamp((this.fI || 0) + err * dt, -20, 20);
  const pitch = clamp(1 + 1.4 * err + 0.6 * this.fI, -2, 9);
  this.attitude(ac, d, pitch, bank, dt, rud ?? undefined);
};

/* ---------------- per-lesson pilots ---------------- */
function takeoffClimb(apx, ac, d, dt, rwyHdg, vy = 74) {
  ac.parkingBrake = false; ac.ctl.throttle = 1; ac.ctl.brake = 0;
  if (d.onGround) { apx.steer(ac, d, rwyHdg, dt); ac.ctl.aileron = 0; ac.ctl.elevator = d.ias > 52 ? 0.5 : 0; return; }
  const pitch = d.agl < 50 ? 8 : clamp(7 + (d.ias - vy) * 0.6, 3, 12);
  apx.attitude(ac, d, pitch, apx.bankFor(d, rwyHdg, 10), dt);
}

export const PILOTS = {
  pattern(z) {
    const apx = new AP(); const pa = KZAR.elevFt + 1000; const e27 = endOf(KZAR, "27"); let phase = "takeoff"; let land = null;
    return (ac, d, sim, dt) => {
      if (phase === "takeoff") { takeoffClimb(apx, ac, d, dt, 270); if (!d.onGround && ac.pos.x < -900 && d.altTrue > KZAR.elevFt + 500) phase = "crosswind"; return; }
      if (phase === "crosswind") { const vs = clamp((pa - d.altTrue) * 3, -500, 700); apx.vs(ac, d, vs, 4, apx.bankFor(d, brg(ac.pos.x, ac.pos.z, -1400, 1300)), dt); ac.ctl.throttle = d.altTrue < pa - 80 ? 1 : 0.6; if (ac.pos.z > 1000) phase = "downwind"; return; }
      if (phase === "downwind") { apx.cruise(ac, d, pa, 85, 90, dt); if (ac.pos.x > 2400) phase = "base"; return; }
      if (phase === "base") { ac.flapsSet = Math.max(ac.flapsSet, 10); apx.vs(ac, d, -500, 0, apx.bankFor(d, 0, 25), dt); apx.speed(ac, d, 72, 0.3, dt); if (ac.pos.z < 450) { phase = "final"; land = landing(KZAR, e27, { vref: 65 }); } return; }
      land(ac, d, sim, dt, apx);
    };
  },
  vasi(z) { const apx = new AP(); const land = landing(KZAR, endOf(KZAR, "27"), { vref: 66, flaps: 20 }); return (ac, d, sim, dt) => land(ac, d, sim, dt, apx); },
  steep(z) {
    const apx = new AP(); let alt0 = null;
    return (ac, d, sim, dt) => {
      alt0 ??= d.altTrue; const idx = z.lessons.idx;
      const bankCmd = idx === 0 ? -45 : idx === 1 ? 45 : apx.bankFor(d, 0, 30);
      const vsCmd = clamp((alt0 - d.altTrue) * 4, -400, 400);
      apx.vs(ac, d, vsCmd, idx < 2 ? 5 : 2, bankCmd, dt); apx.speed(ac, d, 95, idx < 2 ? 0.8 : 0.66, dt);
    };
  },
  stall(z) {
    const apx = new AP(); let pitchCmd = 2, phase = 0, alt0 = null, bankStall = false;
    return (ac, d, sim, dt) => {
      alt0 ??= d.altTrue; const idx = z.lessons.idx;
      if (idx <= 1) { ac.ctl.throttle = 0; pitchCmd = Math.min(18, pitchCmd + dt * (idx === 0 ? 0.6 : 1.2)); apx.attitude(ac, d, pitchCmd, 0, dt); ac.ctl.elevator = Math.max(ac.ctl.elevator, idx === 1 ? 0.8 : -1); return; }
      if (idx === 2) { ac.flapsSet = 20; ac.ctl.throttle = 1; ac.eng.carbHeat = false; const p = d.ias < 58 ? -4 : 8; apx.attitude(ac, d, p, 0, dt); pitchCmd = 2; return; }
      // banked stall: flaps 30, idle, 30° bank, hold altitude until it stalls
      if (!bankStall) { ac.flapsSet = 30; ac.ctl.throttle = 0; const vsCmd = clamp((alt0 - 400 - d.altTrue) * 2, -300, 300); const err = (vsCmd - d.vsTrue) / 100; apx.vsI2 = clamp((apx.vsI2 || 0) + err * dt, -40, 40); apx.attitude(ac, d, clamp(4 + 1.2 * err + 0.4 * apx.vsI2, -5, 22), 30, dt); if (d.ias < 52) ac.ctl.elevator = Math.max(ac.ctl.elevator, 0.6 + (52 - d.ias) * 0.05); }
    };
  },
  softfield(z) {
    const apx = new AP();
    return (ac, d, sim, dt) => {
      ac.parkingBrake = false; ac.ctl.throttle = 1; ac.flapsSet = 10;
      const rwy = 40;
      if (d.onGround) { apx.steer(ac, d, rwy, dt); ac.ctl.aileron = 0; if (ac.contact[0]) ac.ctl.elevator = 1; else { const pe = 10.5 - d.pitch; ac.ctl.elevator = clamp(0.5 + 0.12 * pe - 0.3 * ac.w.y, -0.2, 1); } return; }
      if (d.ias < 59 && d.agl < 60) { const p = clamp(6 + (10 - d.agl) * 0.4 - d.vsTrue / 250, 1, 10); apx.attitude(ac, d, p, apx.bankFor(d, rwy, 8), dt); return; }
      ac.flapsSet = 0; apx.attitude(ac, d, clamp(7 + (d.ias - 74) * 0.6, 3, 12), apx.bankFor(d, rwy, 10), dt);
    };
  },
  vor(z) {
    const apx = new AP(); const n = NAVAIDS[0];
    return (ac, d, sim, dt) => {
      if (Math.abs(sim.radio.nav1 - 113.9) > 0.01) { [sim.radio.nav1, sim.radio.nav1s] = [sim.radio.nav1s, sim.radio.nav1]; ac.inst.obs = 90; }
      const v = sim.vor1; let hdg;
      if (z.lessons.idx <= 1) hdg = brg(ac.pos.x, ac.pos.z, n.x, n.z);
      else hdg = 90 + clamp((v?.ok ? v.cdi : 0) * 40, -35, 35);
      apx.cruise(ac, d, 3500, 100, hdg, dt);
    };
  },
  xc(z) {
    const apx = new AP(); const wps = [[7150, -2380], [8970, 6940], [12200, 12400], [14000, 12900]]; let w = 0, land = null; const e36 = endOf(KAME, "36");
    return (ac, d, sim, dt) => {
      const dK = Math.hypot(ac.pos.x - KAME.x, ac.pos.z - KAME.z) / NM;
      if (!sim.flags.inboundCallKAME && dK < 12 && dK > 7) { sim.radio.com1 = 122.8; z.radioCall("announce"); }
      if (land) return land(ac, d, sim, dt, apx);
      const [tx, tz] = wps[w]; if (Math.hypot(ac.pos.x - tx, ac.pos.z - tz) < 500) { w++; if (w >= wps.length) { land = landing(KAME, e36, { vref: 66 }); return; } }
      apx.cruise(ac, d, w >= 2 ? KAME.elevFt + 1000 : 3500, 95, brg(ac.pos.x, ac.pos.z, ...wps[w]), dt);
    };
  },
  night(z) {
    const apx = new AP(); const land = landing(KAME, endOf(KAME, "18"), { vref: 66 }); let clicked = false;
    return (ac, d, sim, dt) => {
      if (Math.abs(sim.radio.com1 - 122.8) > 0.01) [sim.radio.com1, sim.radio.com1s] = [sim.radio.com1s, sim.radio.com1];
      if (!clicked && z.lessons.idx === 1) { clicked = true; for (let i = 0; i < 7; i++) z.pttClick(); z.waitReal = 1600; }
      land(ac, d, sim, dt, apx);
    };
  },
  enginefail(z) {
    const apx = new AP(); const e27 = endOf(KZAR, "27"); const glide = landing(KZAR, e27, { vref: 65, power: false, flaps: 0 });
    return (ac, d, sim, dt) => {
      if (ac.eng.running) { apx.cruise(ac, d, 3600, 100, brg(ac.pos.x, ac.pos.z, e27.x + 1500, e27.z), dt); return; }
      ac.xpdr.code = "7700";
      const { s } = rwyFrame(e27, ac.pos.x, ac.pos.z);
      if (s < -1500 && d.agl > 400) { ac.ctl.throttle = 0; apx.attitude(ac, d, clamp(-2 + (d.ias - 68) * 0.5, -10, 6), apx.bankFor(d, brg(ac.pos.x, ac.pos.z, e27.x + 1200, e27.z), 25), dt); return; }
      glide(ac, d, sim, dt, apx);
    };
  },
  carbice(z) {
    const apx = new AP(); let alt0 = null;
    return (ac, d, sim, dt) => {
      alt0 ??= d.altTrue; const idx = z.lessons.idx;
      if (idx === 1) ac.eng.carbHeat = true;
      if (idx === 2 && ac.eng.carbIce < 0.04) ac.eng.carbHeat = false;
      apx.cruise(ac, d, alt0, 92, 90, dt); ac.ctl.throttle = 0.6;
    };
  },
  crosswind(z) { const apx = new AP(); const land = landing(KZAR, endOf(KZAR, "27"), { vref: 70, flaps: 20 }); return (ac, d, sim, dt) => land(ac, d, sim, dt, apx); },
  wake(z) { const apx = new AP(); const land = landing(KZAR, endOf(KZAR, "27"), { vref: 68, flaps: 20, aim: 700 }); return (ac, d, sim, dt) => land(ac, d, sim, dt, apx); },
  nordo(z) {
    const apx = new AP(); const e27 = endOf(KZAR, "27"); let land = null, exit = false;
    return (ac, d, sim, dt) => {
      ac.xpdr.code = "7600";
      const phase = z.lessons.ls?.phase;
      if (exit || phase === "taxi") { exit = true; ac.ctl.throttle = 0.12; ac.ctl.brake = d.gs > 9 ? 0.6 : 0; apx.steer(ac, d, 0, dt); ac.ctl.elevator = 0.2; return; }
      if (land) return land(ac, d, sim, dt, apx);
      if (phase === "red") { apx.cruise(ac, d, KZAR.elevFt + 1000, 80, (d.hdg + 30) % 360, dt, 25); return; } // circle while steady red
      const tx = e27.x + 3200, tz = 0;
      if (phase === "flashgreen" || phase === "green") {
        if (Math.hypot(ac.pos.x - tx, ac.pos.z - tz) < 600 || phase === "green") land = landing(KZAR, e27, { vref: 65, brake: true });
        else apx.cruise(ac, d, KZAR.elevFt + 1000, 85, brg(ac.pos.x, ac.pos.z, tx, tz), dt);
        return;
      }
      apx.cruise(ac, d, KZAR.elevFt + 1000, 90, brg(ac.pos.x, ac.pos.z, 0, 0), dt);
    };
  },
};

/* ---------------- Pro lessons ---------------- */
PILOTS.shortfield = (z) => { const apx = new AP(); const land = landing(KZAR, endOf(KZAR, "27"), { vref: 60, flaps: 30, aim: 165 }); return (ac, d, sim, dt) => land(ac, d, sim, dt, apx); };

PILOTS.slowflight = (z) => {
  const apx = new AP(); let alt0 = null, h0 = null;
  // slow flight: pitch for airspeed, power for altitude
  const slow = (ac, d, dt, kias, bank, climb) => {
    const pitchCmd = clamp(4 + (d.ias - kias) * 0.9, -2, 15);
    apx.attitude(ac, d, pitchCmd, bank, dt);
    if (climb) { ac.ctl.throttle = 1; return; }
    const vsCmd = clamp((alt0 - d.altTrue) * 3, -300, 300); const e = (vsCmd - d.vsTrue) / 100;
    apx.thrS = clamp((apx.thrS || 0) + e * dt * 0.05, -0.5, 0.5);
    ac.ctl.throttle = d.ias > kias + 12 ? 0.05 : clamp(0.5 + 0.06 * e + apx.thrS, 0, 1);
  };
  return (ac, d, sim, dt) => {
    alt0 ??= d.altTrue; const idx = z.lessons.idx;
    if (idx <= 0) { if (d.ias < 84) ac.flapsSet = Math.min(30, (ac.flapsSet || 0) + 10); slow(ac, d, dt, 53, apx.bankFor(d, 0, 10), false); return; }
    if (idx === 1) { h0 ??= d.hdg; const turned = wrap180(h0 - d.hdg); slow(ac, d, dt, 53, turned < 82 ? -12 : 0, false); return; }
    if (idx === 2) { slow(ac, d, dt, 55, 0, true); return; }
    ac.ctl.throttle = 1; apx.attitude(ac, d, d.ias < 60 ? 4 : 1, 0, dt);
    if (d.ias > 60 && ac.flapsSet > 20) ac.flapsSet = 20; else if (d.ias > 66 && ac.flapsSet > 10) ac.flapsSet = 10; else if (d.ias > 72) ac.flapsSet = 0;
  };
};

PILOTS.turnspoint = (z) => {
  const apx = new AP(); const B = { x: -1500, z: 8000 }; const R = 430;
  return (ac, d, sim, dt) => {
    const ls = z.lessons.ls; const tgt = ls.targetFt; const idx = z.lessons.idx;
    if (idx >= 2) { apx.cruise(ac, d, tgt, 90, 90, dt, 30); return; }
    const dx = ac.pos.x - B.x, dz = ac.pos.z - B.z; const r = Math.hypot(dx, dz); const a = Math.atan2(dx, -dz) / DEG;
    const trackCmd = a - 90 - clamp((r - R) * 0.12, -35, 35); // counter-clockwise around the barn, pulled back onto the circle
    const gs = d.gs * 0.5144; const ff = -Math.atan((gs * gs) / (9.81 * R)) / DEG;
    const bank = clamp(ff + 1.3 * wrap180(trackCmd - d.track), -45, 45);
    apx.vs(ac, d, clamp((tgt - d.altTrue) * 4, -400, 400), 3, bank, dt); apx.speed(ac, d, 90, 0.62, dt);
  };
};

/** Run one lesson end to end. Returns a summary. */
export async function runLesson(id, { maxSecs = 900, log = false } = {}) {
  const z = window.__zarhart; z.waitReal = 0;
  z.lessons.start(id); z.sim.paused = true; document.querySelector("#start").hidden = true;
  const pilot = PILOTS[id](z);
  const trace = [];
  let t = 0;
  while (t < maxSecs && !z.lessons.done && !z.ac.crashed) {
    z.step(1, pilot); t += 1;
    if (z.waitReal) { const w = z.waitReal; z.waitReal = 0; await new Promise((r) => setTimeout(r, w)); }
    if (log && t % 10 === 0) { const d = z.ac.derived; trace.push(`${t}s idx${z.lessons.idx} ias${d.ias.toFixed(0)} alt${Math.round(d.altTrue)} agl${Math.round(d.agl)} hdg${Math.round(d.hdg)} bank${Math.round(d.bank)} vs${Math.round(d.vsTrue)} gnd${d.onGround}`); }
    if (t % 20 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  const st = z.lessons.status(); const d = z.ac.derived;
  return { id, secs: t, done: st.done, failed: st.failed, crashed: z.ac.crashed?.reason || null, objectives: st.objectives.map((o) => `${o.state}: ${o.text}`), results: st.results, end: { ias: +d.ias.toFixed(0), agl: Math.round(d.agl), gs: +d.gs.toFixed(0), hdg: Math.round(d.hdg) }, trace };
}
