// Zarhart flight dynamics model — a Cessna 172N-class airplane.
// Pure JavaScript (no three.js) so it can be unit-tested in Node.
// World frame: x = east, y = up, z = south (north is -z). Units are SI internally.
// Airplane local frame (three.js convention): forward = -z, up = +y, right = +x.
// Aero body frame (textbook): x forward, y right, z down. p/q/r are body rates in that frame.

export const KT = 0.514444;
export const FT = 0.3048;
export const LB = 0.453592;
export const G0 = 9.80665;
export const INHG = 3386.389;
const DEG = Math.PI / 180;

/* ---------------- vector / quaternion helpers ---------------- */
export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const vadd = (a, b) => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const vsub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const vscale = (a, s) => v3(a.x * s, a.y * s, a.z * s);
export const vdot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const vcross = (a, b) => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const vlen = (a) => Math.hypot(a.x, a.y, a.z);
export const q4 = (x = 0, y = 0, z = 0, w = 1) => ({ x, y, z, w });
export function qmul(a, b) {
  return q4(
    a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z
  );
}
export const qconj = (q) => q4(-q.x, -q.y, -q.z, q.w);
export function qnorm(q) { const l = Math.hypot(q.x, q.y, q.z, q.w) || 1; return q4(q.x / l, q.y / l, q.z / l, q.w / l); }
export function qaxis(ax, ang) { const s = Math.sin(ang / 2); return q4(ax.x * s, ax.y * s, ax.z * s, Math.cos(ang / 2)); }
export function qrot(q, v) {
  // v' = q v q*
  const ix = q.w * v.x + q.y * v.z - q.z * v.y;
  const iy = q.w * v.y + q.z * v.x - q.x * v.z;
  const iz = q.w * v.z + q.x * v.y - q.y * v.x;
  const iw = -q.x * v.x - q.y * v.y - q.z * v.z;
  return v3(
    ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x
  );
}
/** Orientation from heading (deg true, clockwise from north), pitch (deg, nose up +), bank (deg, right wing down +). */
export function qFromHPB(hdg, pitch = 0, bank = 0) {
  const qy = qaxis(v3(0, 1, 0), -hdg * DEG);
  const qx = qaxis(v3(1, 0, 0), pitch * DEG);
  const qz = qaxis(v3(0, 0, 1), -bank * DEG);
  return qnorm(qmul(qmul(qy, qx), qz));
}
export function hpbFromQ(q) {
  const f = qrot(q, v3(0, 0, -1)), u = qrot(q, v3(0, 1, 0)), r = qrot(q, v3(1, 0, 0));
  let hdg = Math.atan2(f.x, -f.z) / DEG; if (hdg < 0) hdg += 360;
  const pitch = Math.asin(Math.max(-1, Math.min(1, f.y))) / DEG;
  const bank = Math.atan2(-r.y, u.y) / DEG;
  return { hdg, pitch, bank, f, u, r };
}
const toAero = (l) => v3(-l.z, l.x, -l.y);
const toLocal = (a) => v3(a.y, -a.z, -a.x);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

/* ---------------- atmosphere ---------------- */
/** Actual atmosphere at geometric altitude h (m) for sea-level pressure qnh (Pa) and ISA deviation dT (°C). */
export function atmosphere(h, qnh = 101325, dT = 0) {
  const T0 = 288.15 + dT;
  const T = T0 - 0.0065 * h;
  const P = qnh * Math.pow(Math.max(0.05, 1 - 0.0065 * h / T0), 5.25588);
  const rho = P / (287.053 * T);
  return { T, P, rho, sigma: rho / 1.225 };
}
/** Altitude an altimeter shows (m) for static pressure P and Kollsman setting Pset (Pa). */
export const altimeterAlt = (P, Pset) => (288.15 / 0.0065) * (1 - Math.pow(P / Pset, 1 / 5.25588));
export const densityAlt = (rho) => (1 - Math.pow(rho / 1.225, 1 / 4.25588)) / 2.25577e-5;

/* ---------------- runway surface condition ---------------- */
/** friction the brakes add, extra rolling drag, and side grip, as fractions of the wheel load */
export const RWY_COND = {
  dry: { label: "Dry", brake: 0.55, roll: 0, side: 0.75 },
  wet: { label: "Wet", brake: 0.3, roll: 0.004, side: 0.55 },
  water: { label: "Standing water", brake: 0.22, roll: 0.02, side: 0.45, hydroplane: true },
  snow: { label: "Snow", brake: 0.15, roll: 0.03, side: 0.3 },
  ice: { label: "Ice", brake: 0.06, roll: -0.005, side: 0.12 },
};
/** dynamic hydroplaning starts at about 9 × √(tire pressure, psi) knots (PHAK ch. 11) */
export const hydroplaneKt = (psi) => 9 * Math.sqrt(psi);

/* ---------------- airplane data ---------------- */
export const C172 = {
  name: "Cessna 172N-class",
  S: 16.17, b: 10.92, c: 1.49,
  emptyLb: 1454, emptyArm: 39.5, maxGrossLb: 2300,
  stations: { front: 37, rear: 73, fuel: 48, bagA: 95, bagB: 123 },
  fuelCapGal: 20, fuelUsable: 19, // per tank
  load: { front: 340, rear: 0, fuelGal: 38, bagA: 20, bagB: 0 },
  cgRef: 41, wingY: 1.0, // reference CG (in, mid-envelope) for pitch stability and the forward-CG stall penalty; wing height above the CG (m)
  // C172N normal category envelope: fwd 35.0 in up to 1,950 lb, then linear to 38.5 in at 2,300 lb; aft 47.3 in.
  envelope: (lb) => ({ fwd: lb <= 1950 ? 35.0 : 35.0 + (lb - 1950) * (3.5 / 350), aft: 47.3 }),
  CL0: 0.31, CLa: 5.14, CD0: 0.031, k: 0.0576,
  Cm0: 0.035, Cma: -1.8, Cmq: -12.4, Cmde: -1.28, CmFlap: 0.05,
  Clb: -0.089, Clp: -0.47, Clr: 0.096, Clda: 0.12,
  Cnb: 0.08, Cnr: -0.099, Cnp: -0.03, Cndr: -0.0657, Cnda: -0.0053, Cn0: 0.00028,
  CYb: -0.31, CYdr: 0.187,
  deMax: 0.40, daMax: 0.30, drMax: 0.29, trimMax: 0.22,
  Pmax: 119300, Tstatic: 2500, etaMax: 0.74,
  alphaStall: 15.5, // deg, clean
  // V-speeds (KIAS) for markings and lessons
  V: { s0: 41, s1: 47, r: 55, x: 59, y: 74, fe: 85, a: 97, no: 127, ne: 158, glide: 68, app: 65 },
  rpmRed: 2700,
  tirePsi: 29, // main tires
  // contact points in local (three) frame, metres from CG
  gear: [
    { name: "nose", p: v3(0, -1.22, -1.55), k: 30000, c: 3200, steer: true },
    { name: "left", p: v3(-1.25, -1.22, 0.38), k: 45000, c: 4600, brake: "L" },
    { name: "right", p: v3(1.25, -1.22, 0.38), k: 45000, c: 4600, brake: "R" },
  ],
  hardPoints: [
    { name: "left wingtip", p: v3(-5.45, 0.95, 0.1) },
    { name: "right wingtip", p: v3(5.45, 0.95, 0.1) },
    { name: "tail", p: v3(0, -0.25, 4.9) },
    { name: "propeller", p: v3(0, -0.95, -2.25) },
    { name: "fuselage", p: v3(0, -0.75, 0.9) },
    { name: "cabin roof", p: v3(0, 1.15, -0.2) },
  ],
};

/** Cessna 152-class: the two-seat trainer. 110 hp, lighter and slower, stalls lower. */
export const C152 = {
  ...C172, name: "Cessna 152-class", short: "C152",
  S: 14.86, b: 10.17, c: 1.47,
  emptyLb: 1110, emptyArm: 30.0, maxGrossLb: 1670,
  stations: { front: 39, rear: 64, fuel: 42, bagA: 64, bagB: 84 }, // no rear seats: "rear" is the baggage area
  fuelCapGal: 13, fuelUsable: 12.25,
  load: { front: 340, rear: 0, fuelGal: 24, bagA: 10, bagB: 0 },
  cgRef: 33.75,
  envelope: (lb) => ({ fwd: lb <= 1350 ? 31.0 : 31.0 + (lb - 1350) * (1.65 / 320), aft: 36.5 }),
  CD0: 0.033, Pmax: 82000, Tstatic: 1750, etaMax: 0.72,
  V: { s0: 35, s1: 40, r: 50, x: 55, y: 67, fe: 85, a: 104, no: 111, ne: 149, glide: 60, app: 60 },
  rpmRed: 2550, tirePsi: 21,
  gear: [
    { name: "nose", p: v3(0, -1.16, -1.42), k: 26000, c: 2800, steer: true },
    { name: "left", p: v3(-1.15, -1.16, 0.34), k: 38000, c: 4000, brake: "L" },
    { name: "right", p: v3(1.15, -1.16, 0.34), k: 38000, c: 4000, brake: "R" },
  ],
  hardPoints: C172.hardPoints.map((h) => ({ ...h, p: v3(h.p.x * 0.92, h.p.y * 0.95, h.p.z * 0.92) })),
};
/** Piper PA-28-161-class (Warrior): low wing, 160 hp, Vy 79. The low wing floats longer in ground effect. */
export const PA28 = {
  ...C172, name: "Piper PA-28-161-class", short: "PA-28", lowWing: true,
  S: 15.79, b: 10.67, c: 1.6,
  emptyLb: 1500, emptyArm: 86.0, maxGrossLb: 2325,
  stations: { front: 80.5, rear: 118.1, fuel: 95.0, bagA: 142.8, bagB: 142.8 },
  fuelCapGal: 25, fuelUsable: 24,
  load: { front: 340, rear: 0, fuelGal: 48, bagA: 20, bagB: 0 },
  cgRef: 88, wingY: -0.55,
  envelope: (lb) => ({ fwd: lb <= 1950 ? 83.0 : 83.0 + (lb - 1950) * (4.0 / 375), aft: 93.0 }),
  CL0: 0.28, CLa: 5.0, CD0: 0.03, k: 0.058, Clb: -0.075, alphaStall: 15,
  Tstatic: 2450,
  V: { s0: 44, s1: 50, r: 55, x: 63, y: 79, fe: 103, a: 111, no: 126, ne: 160, glide: 73, app: 66 },
  tirePsi: 24,
  gear: [
    { name: "nose", p: v3(0, -1.22, -1.7), k: 30000, c: 3200, steer: true },
    { name: "left", p: v3(-1.55, -1.22, 0.45), k: 45000, c: 4600, brake: "L" },
    { name: "right", p: v3(1.55, -1.22, 0.45), k: 45000, c: 4600, brake: "R" },
  ],
  hardPoints: [
    { name: "left wingtip", p: v3(-5.3, -0.42, 0.15) },
    { name: "right wingtip", p: v3(5.3, -0.42, 0.15) },
    { name: "tail", p: v3(0, -0.12, 4.9) },
    { name: "propeller", p: v3(0, -0.95, -2.35) },
    { name: "fuselage", p: v3(0, -0.8, 0.9) },
    { name: "cabin roof", p: v3(0, 1.0, -0.2) },
  ],
};
export const TYPES = { c172: C172, c152: C152, pa28: PA28 };

/** Weight & balance. Returns { lb, cgIn, moment, inEnvelope, fwdLimit, aftLimit }. */
export function weightBalance(load, ac = C172) {
  const st = ac.stations;
  const items = [
    [ac.emptyLb, ac.emptyArm],
    [load.front || 0, st.front],
    [load.rear || 0, st.rear],
    [(load.fuelGal || 0) * 6, st.fuel],
    [load.bagA || 0, st.bagA],
    [load.bagB || 0, st.bagB],
  ];
  const lb = items.reduce((s, [w]) => s + w, 0);
  const moment = items.reduce((s, [w, a]) => s + w * a, 0);
  const cgIn = moment / lb;
  const { fwd: fwdLimit, aft: aftLimit } = ac.envelope(lb);
  const inEnvelope = lb <= ac.maxGrossLb && cgIn >= fwdLimit && cgIn <= aftLimit;
  return { lb, cgIn, moment, fwdLimit, aftLimit, inEnvelope, overGross: lb > ac.maxGrossLb };
}

/* ---------------- the airplane ---------------- */
export class Aircraft {
  /**
   * env: {
   *   ground(x, z) -> { h, type }   type: 'asphalt' | 'grass' | 'dirt' | 'water'
   *   wind(x, y, z, t) -> {x,y,z}   air velocity in world frame (m/s, direction air moves toward)
   *   weather: { qnhInHg, tempC, dewC }
   * }
   */
  constructor(env, ac = C172) {
    this.ac = ac;
    this.env = env;
    this.load = { ...ac.load };
    this.failures = { engine: false, vacuum: false, pitot: false, static: false, alternator: false };
    this.extMoment = v3(0, 0, 0); // body-axis moment from outside effects (wake vortices), N·m
    this.reset({ x: 0, z: 0, hdg: 0, onGround: true });
  }

  reset(spawn) {
    const ac = this.ac;
    this.t = 0;
    this.crashed = null;
    this.pos = v3(spawn.x, 0, spawn.z);
    const g = this.env.ground(spawn.x, spawn.z);
    const airborne = !spawn.onGround;
    const kias = spawn.kias ?? (airborne ? 100 : 0);
    this.q = qFromHPB(spawn.hdg, airborne ? (spawn.pitch ?? 0) : 0, 0);
    const fwd = qrot(this.q, v3(0, 0, -1));
    this.pos.y = airborne ? (spawn.altFt ?? 3000) * FT : g.h + 1.22 + 0.075;
    const atm = atmosphere(this.pos.y, this.qnh(), this.isaDev());
    const tas = kias * KT / Math.sqrt(atm.sigma);
    const w = this.env.wind(this.pos.x, this.pos.y, this.pos.z, 0);
    this.vel = airborne ? vadd(vscale(fwd, tas), v3(w.x, 0, w.z)) : v3(0, 0, 0);
    this.w = v3(0, 0, 0); // p, q, r
    // controls
    this.ctl = { elevator: 0, aileron: 0, rudder: 0, throttle: airborne ? 0.75 : 0, trim: airborne ? 0.12 : 0, brake: 0, brakeL: 0, brakeR: 0 };
    this.parkingBrake = !airborne && !spawn.rolling;
    this.flapsSet = spawn.flaps ?? 0; this.flaps = this.flapsSet;
    // engine & systems
    const running = airborne || spawn.engineRunning !== false;
    this.eng = {
      running, rpm: running ? (airborne ? 2350 : 800) : 0, mixture: 1, mags: running ? "both" : "off",
      carbHeat: false, carbIce: 0, primer: 0, cranking: false, catchT: 0, fuelFlow: 0, oilT: running ? 0.6 : 0.15, egt: 0,
      fuelL: ac.fuelUsable, fuelR: ac.fuelUsable, selector: "both", starvedT: 0, magFactor: 1, rough: 0,
    };
    this.setFuel(this.load.fuelGal);
    this.elec = { master: running, alt: running, avionics: running, volts: running ? 28 : 24, battery: 1, amps: 0,
      lights: { beacon: running, strobe: airborne, nav: false, landing: airborne, taxi: !airborne }, pitotHeat: false };
    this.xpdr = { code: "1200", mode: running ? "ALT" : "STBY" };
    // instruments state
    this.inst = {
      kollsman: this.env.weather.qnhInHg, hiDrift: 0, aiOffset: 0, vsiFpm: 0, altPrev: null,
      compass: spawn.hdg, compassVel: 0, gyroSpin: running ? 1 : 0, aiErr: { p: 0, b: 0 },
      pitotTrapped: null, staticTrapped: null, tc: 0, ball: 0, obs: 90, obs2: 0, hdgBug: spawn.hdg,
    };
    this.onGround = !airborne;
    this.frost = spawn.frost ? 1 : 0; // frost on the wings: rough skin, the wing stalls sooner
    this.ice = 0; // structural ice picked up in visible moisture below freezing
    this.hydroplaning = false;
    this.airTime = 0;
    this.touchdown = null;
    this.contact = [false, false, false];
    this.events = [];
    this.derived = {};
    this.updateDerived(0);
  }

  qnh() { return this.env.weather.qnhInHg * INHG; }
  isaDev() { const w = this.env.weather; return w.isaDev ?? (w.tempC - 15); }
  setFuel(gal) { const per = clamp(gal / 2, 0, this.ac.fuelUsable); this.eng.fuelL = per; this.eng.fuelR = per; this.load.fuelGal = per * 2; }
  massKg() { return weightBalance({ ...this.load, fuelGal: this.eng.fuelL + this.eng.fuelR }, this.ac).lb * LB + 45 * (this.ice || 0); }

  /* ---- systems helpers ---- */
  emit(type, msg) { this.events.push({ type, msg, t: this.t }); }

  enginePower(atm, ias) {
    const e = this.eng, ac = this.ac;
    if (!e.running) return 0;
    const da = densityAlt(atm.rho);
    const best = clamp(1 - 0.035 * (da / FT / 1000), 0.35, 1); // best-power mixture setting drops with altitude
    const mixDev = e.mixture - best;
    let mixF = mixDev >= 0 ? 1 - 0.55 * mixDev * mixDev : 1 - 2.2 * mixDev * mixDev;
    if (e.mixture < 0.08 || mixDev < -0.42) mixF = 0;
    const lapse = clamp((atm.sigma - 0.117) / 0.883, 0, 1.2);
    const thr = 0.035 + 0.965 * this.ctl.throttle;
    let p = ac.Pmax * thr * lapse * Math.max(0, mixF) * e.magFactor;
    p *= 1 - 0.65 * e.carbIce;
    if (e.carbHeat) p *= 0.9;
    return p;
  }

  step(dt) {
    if (!(dt > 0)) { this.updateDerived(0); return; }
    // fixed substeps for stiff gear springs
    const n = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / n;
    for (let i = 0; i < n; i++) this.substep(h);
    this.updateDerived(dt);
  }

  substep(dt) {
    if (this.crashed) return;
    const ac = this.ac, e = this.eng, ctl = this.ctl;
    this.t += dt;
    const m = this.massKg();
    const wb = weightBalance({ ...this.load, fuelGal: e.fuelL + e.fuelR }, ac);
    const scaleI = m / 1043;
    const Ixx = 1285 * scaleI, Iyy = 1825 * scaleI, Izz = 2667 * scaleI;
    const weather = this.env.weather;
    const atm = atmosphere(this.pos.y, this.qnh(), this.isaDev());

    // flaps move at ~3.3 deg/s
    const fd = this.flapsSet - this.flaps;
    if (Math.abs(fd) > 0.01) this.flaps += clamp(fd, -3.3 * dt, 3.3 * dt);
    const f = this.flaps / 30;

    // relative wind
    const wind = this.env.wind(this.pos.x, this.pos.y, this.pos.z, this.t);
    const vRel = vsub(this.vel, wind);
    const qc = qconj(this.q);
    const vb = toAero(qrot(qc, vRel));
    const V = Math.max(0.01, vlen(vb));
    const alpha = Math.atan2(vb.z, Math.max(0.05, Math.abs(vb.x))) * (vb.x < 0 ? -1 : 1);
    const beta = Math.asin(clamp(vb.y / V, -1, 1));
    const qbar = 0.5 * atm.rho * V * V;
    const { p, q, r } = { p: this.w.x, q: this.w.y, r: this.w.z };
    const Vd = Math.max(V, 8);
    const ph = p * ac.b / (2 * Vd), qh = q * ac.c / (2 * Vd), rh = r * ac.b / (2 * Vd);

    // ground effect (height of the wing above the surface)
    const gHere = this.env.ground(this.pos.x, this.pos.z);
    const hWing = Math.max(0.3, this.pos.y - gHere.h + ac.wingY);
    const ge = Math.pow(16 * hWing * 0.75 / ac.b, 2);
    const phi = ge / (1 + ge); // induced drag factor (McCormick)

    // lift
    // frost and ice spoil the airflow over the wing: it stalls at a lower angle of attack (higher speed) and drags more
    const aStall = (ac.alphaStall - 1.5 * f - 6 * this.frost - 6.5 * this.ice) * DEG;
    const cgPenalty = 0.6 * Math.max(0, ac.cgRef - wb.cgIn) / (ac.c / 0.0254);
    const dCLf = 0.55 * f;
    const CLlin = ac.CL0 + dCLf + ac.CLa * alpha;
    const CLmax = ac.CL0 + dCLf + ac.CLa * aStall - cgPenalty;
    const aNeg = -14 * DEG;
    let CL, stallFrac = 0;
    if (alpha <= aStall - 3 * DEG && alpha >= aNeg) {
      CL = CLlin;
    } else if (alpha > aStall - 3 * DEG && alpha <= aStall) {
      // round the top of the lift curve
      const t = (alpha - (aStall - 3 * DEG)) / (3 * DEG);
      const CLa3 = ac.CL0 + dCLf + ac.CLa * (aStall - 3 * DEG);
      CL = lerp(CLa3, CLmax, 1 - (1 - t) * (1 - t));
    } else if (alpha > aStall) {
      stallFrac = smooth((alpha - aStall) / (4 * DEG));
      const fp = 0.62 * CLmax * Math.sin(2 * alpha) / Math.sin(2 * (aStall + 4 * DEG));
      CL = alpha < aStall + 4 * DEG ? lerp(CLmax, 0.62 * CLmax, stallFrac) : fp;
      stallFrac = Math.max(stallFrac, alpha > aStall + 4 * DEG ? 1 : 0);
    } else {
      // negative stall
      stallFrac = smooth((aNeg - alpha) / (4 * DEG));
      const CLmin = ac.CL0 + dCLf + ac.CLa * aNeg;
      CL = alpha > aNeg - 4 * DEG ? lerp(CLmin, 0.6 * CLmin, stallFrac) : 0.6 * CLmin * Math.sin(2 * alpha) / Math.sin(2 * (aNeg - 4 * DEG));
    }
    CL *= 1 + 0.08 * (1 - phi); // a little more lift in ground effect
    const CLi = clamp(CLlin, -1.2, CLmax + 0.1);
    let CD = ac.CD0 + ac.k * phi * CLi * CLi + 0.05 * Math.pow(f, 1.8) + 0.3 * beta * beta;
    CD += 1.1 * Math.pow(Math.sin(Math.abs(alpha)), 2) * stallFrac + 0.02 * this.frost + 0.045 * this.ice;
    const CY = ac.CYb * beta + ac.CYdr * (-ctl.rudder * ac.drMax);

    const L = qbar * ac.S * CL, D = qbar * ac.S * CD, Y = qbar * ac.S * CY;
    const ca = Math.cos(alpha), sa = Math.sin(alpha);
    // aero forces in body axes (x fwd, y right, z down)
    let Fb = v3(-D * ca + L * sa, Y, -D * sa - L * ca);

    // engine / propeller
    const ias = Math.sqrt(Math.max(0, 2 * qbar / 1.225));
    const P = this.enginePower(atm, ias);
    const eta = ac.etaMax * (1 - Math.exp(-V / 18));
    const pf = P / ac.Pmax;
    let T = Math.min(ac.Tstatic * pf * Math.min(1, atm.sigma * 1.05), eta * P / Math.max(V, 4));
    // windmilling / idle prop drag
    if (P < 0.06 * ac.Pmax) T -= 0.012 * qbar * ac.S * (1 - P / (0.06 * ac.Pmax));
    this._thrust = T; this._power = P;
    Fb.x += T;

    // moments (body axes)
    const de = -ctl.elevator * ac.deMax - ctl.trim * ac.trimMax;
    const da = ctl.aileron * ac.daMax;
    const dr = -ctl.rudder * ac.drMax;
    const cgShift = (wb.cgIn - ac.cgRef) / (ac.c / 0.0254); // + is aft, in mean chords
    const Cma = ac.Cma + ac.CLa * cgShift * 0.55;
    const elevEff = 1 - 0.35 * stallFrac;
    const Cm = ac.Cm0 + Cma * alpha + ac.Cmq * qh + ac.Cmde * de * elevEff + ac.CmFlap * f + (stallFrac * -0.12);
    const ClpEff = ac.Clp * (1 - 1.6 * stallFrac); // autorotation when stalled
    const Cl = ac.Clb * beta + ClpEff * ph + ac.Clr * rh * (1 + 2 * stallFrac) + ac.Clda * da * (1 - 0.4 * stallFrac);
    const Cn = ac.Cn0 + ac.Cnb * beta + ac.Cnr * rh + ac.Cnp * ph + ac.Cndr * dr + ac.Cnda * da;
    let Mb = v3(qbar * ac.S * ac.b * Cl, qbar * ac.S * ac.c * Cm, qbar * ac.S * ac.b * Cn);
    // left-turning tendencies: P-factor + spiraling slipstream (yaw left), torque (roll left)
    Mb.z += -T * (0.07 + 1.1 * Math.max(0, alpha));
    Mb.x += -0.035 * T;
    // slipstream over the tail keeps some elevator/rudder authority at low speed
    const slip = Math.max(0, T) / ac.Tstatic;
    Mb.y += 1600 * slip * (-de) * 1.0;
    Mb.z += 900 * slip * ctl.rudder;
    // pitch-up from power (thrust line below CG is small on a 172; a touch of nose-up)
    Mb.y += 0.03 * T;
    Mb.x += this.extMoment.x; Mb.y += this.extMoment.y; Mb.z += this.extMoment.z;

    // ---- ground contact ----
    const Fw = v3(0, -m * G0, 0); // world forces start with gravity
    let Mw = v3(0, 0, 0); // world torques
    const posq = this.pos;
    let anyContact = false;
    let maxNormal = 0;
    const surface = gHere.type;
    const cond = RWY_COND[weather.rwy] || RWY_COND.dry;
    const gsNow = Math.hypot(this.vel.x, this.vel.z);
    const hydro = !!cond.hydroplane && gsNow > hydroplaneKt(ac.tirePsi || 29) * KT && (surface === "asphalt" || surface === "grass");
    if (hydro && !this.hydroplaning && this.onGround) this.emit("warn", `Hydroplaning: the tires are riding on water above about ${Math.round(hydroplaneKt(ac.tirePsi || 29))} kt. Brakes and steering barely work until you slow down.`);
    this.hydroplaning = hydro && this.onGround;
    const brakeMu = hydro ? 0.03 : cond.brake, sideMu = hydro ? 0.12 : cond.side;
    const rollMu = (surface === "asphalt" ? 0.02 : surface === "grass" ? 0.055 : surface === "dirt" ? 0.08 : 0.3) + (surface === "water" ? 0 : cond.roll);
    const brakeL = clamp(Math.max(ctl.brake, ctl.brakeL, this.parkingBrake ? 1 : 0), 0, 1);
    const brakeR = clamp(Math.max(ctl.brake, ctl.brakeR, this.parkingBrake ? 1 : 0), 0, 1);
    const fwdW = qrot(this.q, v3(0, 0, -1));
    const omegaW = qrot(this.q, toLocal(this.w));
    for (let i = 0; i < ac.gear.length; i++) {
      const gr = ac.gear[i];
      const rW = qrot(this.q, gr.p);
      const pw = vadd(posq, rW);
      const gg = this.env.ground(pw.x, pw.z);
      const pen = gg.h - pw.y;
      if (pen <= 0) { this.contact[i] = false; continue; }
      anyContact = true;
      this.contact[i] = true;
      const vp = vadd(this.vel, vcross(omegaW, rW));
      let N = gr.k * pen - gr.c * vp.y;
      N = clamp(N, 0, 60000);
      maxNormal = Math.max(maxNormal, N);
      // wheel axes on the ground plane
      let wf = v3(fwdW.x, 0, fwdW.z);
      const wl = Math.hypot(wf.x, wf.z) || 1; wf = v3(wf.x / wl, 0, wf.z / wl);
      if (gr.steer) {
        const gs = Math.hypot(this.vel.x, this.vel.z);
        const steer = -ctl.rudder * 10 * DEG * clamp(1.4 - gs / 25, 0.15, 1);
        const c = Math.cos(steer), s = Math.sin(steer);
        // rotate about up (+y): positive rudder (right) turns the wheel right
        wf = v3(wf.x * c + wf.z * s, 0, -wf.x * s + wf.z * c);
      }
      const wr = v3(-wf.z, 0, wf.x); // right of wheel
      const vLong = vdot(vp, wf), vLat = vdot(vp, wr);
      let mu = rollMu;
      if (gr.brake) mu += brakeMu * (gr.brake === "L" ? brakeL : brakeR);
      if (gg.type === "water") mu = 0.6;
      const FLong = -clamp(vLong / 0.4, -1, 1) * mu * N;
      const FLat = -clamp(vLat / 0.15, -1, 1) * (gg.type === "water" ? 0.75 : sideMu) * N;
      const F = v3(wf.x * FLong + wr.x * FLat, N, wf.z * FLong + wr.z * FLat);
      Fw.x += F.x; Fw.y += F.y; Fw.z += F.z;
      Mw = vadd(Mw, vcross(rW, F));
      if (gg.type === "water" && pen > 0.05) this.crash("You put it in the water.");
    }
    // hard points (wingtips, tail, prop, belly) — touching the ground means a crash
    for (const hp of ac.hardPoints) {
      const pw = vadd(posq, qrot(this.q, hp.p));
      const gg = this.env.ground(pw.x, pw.z);
      if (pw.y < gg.h - 0.02) {
        const gs = Math.hypot(this.vel.x, this.vel.z);
        if (hp.name === "tail" && gs < 30 && this.vel.y > -1.5) continue; // tail strike: scrape, not crash
        this.crash(hp.name === "propeller" ? "Prop strike: the nose was too low on the ground." : `The ${hp.name} hit the ground.`);
        return;
      }
    }
    if (maxNormal > m * G0 * 3.6) { this.crash(`Gear overloaded: hit the ground at ${Math.round(-this.vel.y / FT * 60)} fpm.`); return; }

    // body -> world aero/thrust force
    const Fworld = qrot(this.q, toLocal(Fb));
    Fw.x += Fworld.x; Fw.y += Fworld.y; Fw.z += Fworld.z;

    // specific force (what the pilot feels), body axes
    const groundBody = toAero(qrot(qc, v3(Fw.x - Fworld.x, Fw.y - Fworld.y + m * G0, Fw.z - Fworld.z)));
    this._fs = vscale(vadd(Fb, groundBody), 1 / m);

    // translational integration
    const acc = vscale(Fw, 1 / m);
    this.vel = vadd(this.vel, vscale(acc, dt));
    this.pos = vadd(this.pos, vscale(this.vel, dt));

    // rotational integration (body axes)
    const Mg = toAero(qrot(qc, Mw));
    const Mx = Mb.x + Mg.x, My = Mb.y + Mg.y, Mz = Mb.z + Mg.z;
    const pd = (Mx - (Izz - Iyy) * q * r) / Ixx;
    const qd = (My - (Ixx - Izz) * r * p) / Iyy;
    const rd = (Mz - (Iyy - Ixx) * p * q) / Izz;
    this.w = v3(p + pd * dt, q + qd * dt, r + rd * dt);
    if (anyContact) { // tyre scrub damping keeps the airplane from jittering when parked
      const gs = Math.hypot(this.vel.x, this.vel.z);
      if (gs < 0.4) this.w = vscale(this.w, 0.995);
    }
    const wl = toLocal(this.w);
    const ang = vlen(wl) * dt;
    if (ang > 1e-9) this.q = qnorm(qmul(this.q, qaxis(vscale(wl, 1 / vlen(wl)), ang)));

    // touchdown / liftoff detection
    if (anyContact && !this.onGround) {
      if (this.airTime > 2.5) {
        const hpb = hpbFromQ(this.q);
        this.touchdown = { fpm: Math.round(-this.vel.y / FT * 60), kias: Math.round(ias / KT), bank: hpb.bank, pitch: hpb.pitch, x: this.pos.x, z: this.pos.z, t: this.t };
        this.emit("touchdown", this.touchdown);
        if (this.touchdown.fpm > 1100) { this.crash(`Hard landing: the gear collapsed at ${this.touchdown.fpm} fpm.`); return; }
      }
      this.onGround = true; this.airTime = 0;
    } else if (!anyContact) {
      if (this.onGround) { this.onGround = false; this.emit("liftoff", { kias: Math.round(ias / KT) }); }
      this.airTime += dt;
    } else this.airTime = 0;

    // terrain collision with the airframe centre (deep terrain strike)
    if (this.pos.y < gHere.h + 0.2) { this.crash("Controlled flight into terrain."); return; }

    this._aero = { alpha, beta, V, qbar, CL, stallFrac, aStall, ias, atm, phi, de };
    this.systems(dt, atm, ias, P);
  }

  systems(dt, atm, ias, P) {
    const e = this.eng, ac = this.ac, el = this.elec, ctl = this.ctl, w = this.env.weather;
    // magnetos
    e.magFactor = e.mags === "both" ? 1 : e.mags === "left" || e.mags === "right" ? 0.965 : e.mags === "start" ? 1 : 0;
    const fuelAvail = (e.selector === "both" ? e.fuelL + e.fuelR : e.selector === "left" ? e.fuelL : e.selector === "right" ? e.fuelR : 0) > 0.05;
    // starting
    e.cranking = e.mags === "start" && el.master && el.battery > 0.05;
    if (!e.running && e.cranking) {
      e.rpm = lerp(e.rpm, 260, dt * 2);
      el.battery = Math.max(0, el.battery - dt * 0.004);
      if (fuelAvail && e.mixture > 0.25 && ctl.throttle < 0.6 && !this.failures.engine) {
        e.catchT += dt;
        if (e.catchT > 1.4) { e.running = true; e.rpm = 900; this.emit("info", "Engine started. Release the key to BOTH."); }
      }
    } else e.catchT = 0;
    if (e.mags === "off" && e.running) { e.running = false; this.emit("info", "Magnetos OFF: engine stopped."); }
    if (e.running && e.mixture < 0.08) { e.running = false; this.emit("info", "Mixture at idle cutoff: engine stopped."); }
    if (e.running && !fuelAvail) { e.starvedT += dt; if (e.starvedT > 4) { e.running = false; this.emit("warn", "Fuel starvation: the engine quit."); } } else e.starvedT = 0;
    if (e.running && this.failures.engine) { e.running = false; this.emit("warn", "ENGINE FAILURE. Pitch for best glide: 68 KIAS."); }
    if (e.running && e.carbIce > 0.97) { e.running = false; this.emit("warn", "Carburetor ice: the engine quit."); }

    // structural ice: visible moisture (cloud or rain) at or below freezing; it sheds slowly in warmer air
    const oatC = atm.T - 273.15;
    const wet = this.env.moisture?.(this.pos.x, this.pos.y, this.pos.z) || 0;
    if (!this.onGround && oatC <= 0.5 && oatC > -20 && wet > 0) {
      const before = this.ice;
      this.ice = clamp(this.ice + dt * wet / (w.precip === "fzra" ? 150 : 320), 0, 1); // freezing rain builds clear ice fastest
      if (before < 0.12 && this.ice >= 0.12) this.emit("warn", "Ice is building on the windshield and the wing leading edges. Get out of the moisture: turn around or change altitude.");
      if (before < 0.45 && this.ice >= 0.45) this.emit("warn", "Heavy ice: the stall speed is up, the airplane is heavier and it needs more power. Land soon, with extra speed.");
    } else if (oatC > 2 && this.ice > 0) this.ice = Math.max(0, this.ice - dt / 150);
    // carb ice: likely between -7°C and 21°C (20–70°F) with high humidity, worse at low power
    const spread = w.tempC - w.dewC;
    const carbT = atm.T - 273.15;
    if (e.running && !e.carbHeat && carbT > -7 && carbT < 21 && spread < 6) {
      const rate = 0.0025 * (1 - spread / 6) * (1.4 - ctl.throttle);
      e.carbIce = clamp(e.carbIce + rate * dt, 0, 1);
    }
    if (e.carbHeat) e.carbIce = Math.max(0, e.carbIce - 0.03 * dt);
    e.rough = e.carbHeat && e.carbIce > 0.05 ? 0.5 : e.carbIce * 0.6;

    // rpm: fixed-pitch prop
    let rpmT = 0;
    if (e.running) rpmT = 550 + 1800 * Math.pow(P / ac.Pmax, 0.6) + 3.0 * (ias / KT) * (0.35 + 0.65 * Math.sqrt(Math.max(0, P / ac.Pmax)));
    else if (e.cranking) rpmT = 260;
    else rpmT = Math.min(1100, 9 * (ias / KT)); // windmilling
    e.rpm = lerp(e.rpm, rpmT, clamp(dt * 1.8, 0, 1));
    // fuel
    e.fuelFlow = e.running ? 0.8 + 10.8 * (P / ac.Pmax) * (0.75 + 0.35 * e.mixture) : 0; // gph
    const burn = e.fuelFlow / 3600 * dt;
    if (burn > 0) {
      if (e.selector === "both") { const tot = e.fuelL + e.fuelR || 1; e.fuelL = Math.max(0, e.fuelL - burn * e.fuelL / tot); e.fuelR = Math.max(0, e.fuelR - burn * e.fuelR / tot); }
      else if (e.selector === "left") e.fuelL = Math.max(0, e.fuelL - burn);
      else if (e.selector === "right") e.fuelR = Math.max(0, e.fuelR - burn);
    }
    e.oilT = lerp(e.oilT, e.running ? 0.45 + 0.4 * (P / ac.Pmax) - 0.1 * clamp(ias / KT / 120, 0, 1) : 0.15, dt * 0.01);
    // electrical
    el.alt = e.running && e.rpm > 650 && el.master && !this.failures.alternator;
    if (el.master) {
      const load = 3 + (el.avionics ? 9 : 0) + (el.lights.landing ? 8 : 0) + (el.lights.taxi ? 6 : 0) + (el.lights.strobe ? 3 : 0) + (el.lights.nav ? 2 : 0) + (el.lights.beacon ? 2 : 0) + (el.pitotHeat ? 10 : 0);
      if (el.alt) { el.volts = 28.2; el.amps = 2; el.battery = Math.min(1, el.battery + dt * 0.002); }
      else { el.battery = Math.max(0, el.battery - load * dt / (35 * 3600) * 3); el.volts = 22 + 2.5 * el.battery; el.amps = -load; }
    } else { el.volts = 0; el.amps = 0; }
    this.powered = el.master && el.volts > 20;
    // vacuum gyros
    const suction = e.rpm > 450 && !this.failures.vacuum ? clamp(3.0 + 2.6 * (e.rpm - 500) / 1500, 0, 5.3) : 0;
    this.suction = suction;
    const spinT = suction > 3.5 ? 1 : suction / 3.5;
    this.inst.gyroSpin = lerp(this.inst.gyroSpin, spinT, dt * (spinT > this.inst.gyroSpin ? 0.15 : 0.03));
  }

  crash(reason) {
    if (this.crashed) return;
    this.crashed = { reason, t: this.t, fpm: Math.round(-this.vel.y / FT * 60) };
    this.vel = v3(0, 0, 0); this.w = v3(0, 0, 0);
    this.eng.running = false;
    this.emit("crash", reason);
  }

  /** Instrument readings and derived values (updated once per frame). */
  updateDerived(dt) {
    const a = this._aero || { alpha: 0, beta: 0, V: 0, ias: 0, stallFrac: 0, aStall: 15.5 * DEG, atm: atmosphere(this.pos.y, this.qnh(), this.isaDev()) };
    const inst = this.inst, f = this.failures;
    const hpb = hpbFromQ(this.q);
    const atm = a.atm;
    const g = this.env.ground(this.pos.x, this.pos.z);
    // static & pitot pressures (with blockages)
    const Pst = atm.P;
    const Ptot = Pst + Math.max(0, a.qbar || 0);
    if (f.static) { if (inst.staticTrapped == null) inst.staticTrapped = Pst; } else inst.staticTrapped = null;
    if (f.pitot) { if (inst.pitotTrapped == null) inst.pitotTrapped = Ptot; } else inst.pitotTrapped = null;
    const PstI = inst.staticTrapped ?? Pst;
    const PtotI = inst.pitotTrapped ?? Ptot;
    const qInd = Math.max(0, PtotI - PstI);
    const iasKt = Math.sqrt(2 * qInd / 1.225) / KT;
    const altFt = altimeterAlt(PstI, inst.kollsman * INHG) / FT;
    if (inst.altPrev == null || dt <= 0) inst.altPrev = altFt;
    const rawVs = dt > 0 ? (altFt - inst.altPrev) / dt * 60 : 0;
    inst.altPrev = altFt;
    inst.vsiFpm = lerp(inst.vsiFpm, clamp(rawVs, -4000, 4000), clamp(dt * 1.3, 0, 1));
    // gyros
    const spin = inst.gyroSpin;
    if (dt > 0) {
      inst.hiDrift += dt * (0.008 + (1 - spin) * 0.6) * (1 + 0.5 * Math.sin(this.t * 0.01));
      inst.aiErr.p = lerp(inst.aiErr.p, (1 - spin) * 18 * Math.sin(this.t * 0.05), dt * 0.2);
      inst.aiErr.b = lerp(inst.aiErr.b, (1 - spin) * 35 * Math.sin(this.t * 0.031 + 1), dt * 0.2);
    }
    const aiPitch = hpb.pitch * (0.2 + 0.8 * spin) + inst.aiErr.p;
    const aiBank = hpb.bank * (0.2 + 0.8 * spin) + inst.aiErr.b;
    let hi = (hpb.hdg + inst.hiDrift) % 360; if (hi < 0) hi += 360;
    // magnetic compass (variation 0° here): northerly turning + acceleration errors, plus swing
    const fs = this._fs || v3(0, 0, -G0);
    const target = hpb.hdg - 28 * Math.sin(hpb.bank * DEG) * Math.cos(hpb.hdg * DEG) - 6 * (fs.x / G0) * Math.sin(hpb.hdg * DEG);
    if (dt > 0) {
      let d = ((target - inst.compass + 540) % 360) - 180;
      inst.compassVel += (d * 3.2 - inst.compassVel * 2.2) * dt;
      inst.compass = (inst.compass + inst.compassVel * dt + 360) % 360;
    }
    // turn coordinator & ball
    const yawRateW = qrot(this.q, toLocal(this.w)).y; // rad/s about world up (+ = left turn)
    const tcRaw = (-yawRateW / DEG) / 3 + 0.18 * (this.w.x / DEG) / 3; // in standard-rate units
    inst.tc = lerp(inst.tc, this.powered ? tcRaw : inst.tc * 0.98, clamp(dt * 4, 0, 1));
    const ballRaw = clamp(Math.atan2(-fs.y, Math.max(1, -fs.z)) / (12 * DEG), -1.2, 1.2);
    inst.ball = lerp(inst.ball, ballRaw, clamp(dt * 3, 0, 1));
    const gLoad = -fs.z / G0;
    const gs = Math.hypot(this.vel.x, this.vel.z);
    let trk = Math.atan2(this.vel.x, -this.vel.z) / DEG; if (trk < 0) trk += 360;

    this.derived = {
      hdg: hpb.hdg, pitch: hpb.pitch, bank: hpb.bank,
      aiPitch: aiPitch + inst.aiOffset, aiBank, hi, compass: inst.compass,
      ias: iasKt, tas: a.V / KT, gs: gs / KT, track: gs > 2 ? trk : hpb.hdg,
      altInd: altFt, altTrue: this.pos.y / FT, agl: (this.pos.y - 1.22 - g.h) / FT, groundElevFt: g.h / FT,
      pressAlt: altimeterAlt(Pst, 101325) / FT, densAlt: densityAlt(atm.rho) / FT,
      vsi: inst.vsiFpm, vsTrue: this.vel.y / FT * 60,
      tc: inst.tc, ball: inst.ball, g: gLoad,
      aoa: a.alpha / DEG, beta: a.beta / DEG, aStall: a.aStall / DEG, stallWarn: !this.onGround && a.alpha > a.aStall - 6 * DEG && a.ias > 8 && this.powered,
      stalled: (a.stallFrac || 0) > 0.3 && !this.onGround,
      rpm: this.eng.rpm, fuelL: this.eng.fuelL, fuelR: this.eng.fuelR, fuelFlow: this.eng.fuelFlow,
      oilT: this.eng.oilT, oilP: this.eng.running ? 0.55 + 0.25 * this.eng.rpm / 2700 : 0.02, suction: this.suction || 0,
      volts: this.elec.volts, amps: this.elec.amps, oatC: atm.T - 273.15,
      flaps: this.flaps, flapsSet: this.flapsSet, trim: this.ctl.trim, throttle: this.ctl.throttle,
      onGround: this.onGround, surface: g.type, wb: weightBalance({ ...this.load, fuelGal: this.eng.fuelL + this.eng.fuelR }, this.ac),
      frost: this.frost, ice: this.ice, hydroplaning: this.hydroplaning,
    };
  }
}
