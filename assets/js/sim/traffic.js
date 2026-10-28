// Automated traffic: airplanes that taxi, take off, fly the traffic pattern and depart, talking on the right frequency
// as they go: to Ground and Tower at a towered field, self-announcing on the CTAF elsewhere. Each one follows a route
// built from the runway in use and steers toward a point a little ahead on it, so it turns smoothly and rounds corners
// like a pilot. It gives way to you: it won't take off or land while you're on its runway.
import * as THREE from "three";
import { buildAirplane, animateAirplane } from "./plane3d.js";
import { groundAt, rectDist } from "./world-data.js";

const KT = 0.514444, FT = 0.3048, DEG = Math.PI / 180, NM = 1852, GEAR = 1.3;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap = (a) => ((a % 360) + 540) % 360 - 180;
const PHON = { A: "Alpha", B: "Bravo", C: "Charlie", D: "Delta", E: "Echo", K: "Kilo", L: "Lima", R: "Romeo", S: "Sierra", W: "Whiskey", Z: "Zulu" };
/** "Skyhawk 4AB" → spoken "Skyhawk 4 Alpha Bravo" */
const spoken = (name, tail) => `${name} ${tail.replace(/[A-Z]/g, (c) => ` ${PHON[c] || c}`).replace(/\s+/g, " ").trim()}`;

/** points along a runway: s metres along the landing direction from the threshold, c metres to the right */
function rwyPoint(e, s, c) { const h = e.hdg * DEG; return { x: e.x + Math.sin(h) * s + Math.cos(h) * c, z: e.z - Math.cos(h) * s + Math.sin(h) * c }; }

/** one circuit, as waypoints, starting on the runway at the threshold: takeoff, upwind, crosswind, downwind, base, final, touch-and-go roll */
function circuit(ap, e, side, len, rot = 380) {
  const el = ap.elev, P = (s, c, ft, kt, extra = {}) => ({ ...rwyPoint(e, s, c * side), h: ft == null ? null : el + ft * FT, spd: kt, ground: ft == null, ...extra });
  const w = 1450; // downwind about 0.8 NM from the runway
  return [
    P(40, 0, null, 0, { leg: "roll" }), P(rot, 0, null, 55, { leg: "rotate" }), P(len + 300, 0, 400, 72, { leg: "upwind" }),
    P(len + 1100, 0, 700, 75, { leg: "upwind" }), P(len + 1350, w * 0.6, 900, 80, { leg: "crosswind" }), P(len + 900, w, 1000, 90, { leg: "downwind", say: "downwind" }),
    P(len * 0.5, w, 1000, 90, { leg: "downwind", say: "midfield" }), P(-900, w, 900, 80, { leg: "downwind" }), P(-1600, w * 0.7, 700, 72, { leg: "base", say: "base" }),
    P(-1900, 0, 500, 66, { leg: "final", say: "final" }), P(-700, 0, 230, 64, { leg: "final" }), P(260, 0, 6, 58, { leg: "flare" }),
    P(330, 0, null, 52, { leg: "landing" }),
  ];
}

export class Traffic {
  /** o: { onRadio(freq, from, text), player() → { x, z, onGround, gs }, weather, atis() → letter } */
  constructor(scene, o) { this.scene = scene; this.o = o; this.agents = []; this.t = 0; this.queue = []; }

  clear() { for (const a of this.agents) this.scene.remove(a.g); this.agents = []; this.queue = []; }

  /** pattern traffic at `ap`, or a departure from its ramp */
  add(ap, kind, { name = "Skyhawk", tail = "4AB", type = "c172", stripe = 0x2f7fd0, start = 0 } = {}) {
    const g = buildAirplane({ reg: `N${tail}`, stripe, simple: true, type }); g.visible = false; this.scene.add(g);
    const a = { ap, kind, name, tail, short: `${name} ${tail}`, call: spoken(name, tail), g, x: 0, y: 0, z: 0, hdg: 0, pitch: 0, bank: 0, spd: 0, path: null, i: 0, wait: 0, flaps: 0, gone: 0 };
    this.agents.push(a);
    if (kind === "pattern") this.route(a, start); else this.departure(a);
    return a;
  }

  /** the runway in use and which side its pattern is on (right if the segmented circle says so) */
  rwy(ap) { const act = this.o.weather.activeRunway(ap), side = ap.segmentedCircle?.pattern?.[act.end.id] === "right" ? 1 : -1; return { e: act.end, r: act.rwy, side }; }
  freq(ap) { return ap.towered ? ap.freqs.twr : ap.freqs.ctaf; }

  /** a new circuit; keep = carry on from where the airplane is (a touch-and-go rolls on and rotates further down) */
  route(a, start = 0, keep = false) {
    const { e, r, side } = this.rwy(a.ap);
    a.path = circuit(a.ap, e, side, r.len, keep ? Math.min(r.len * 0.6, 720) : 380); a.e = e; a.r = r; a.side = side;
    a.i = Math.min(start, a.path.length - 2);
    if (keep) { a.g.visible = true; return; }
    const p = a.path[a.i], q = a.path[a.i + 1];
    a.x = p.x; a.z = p.z; a.hdg = (Math.atan2(q.x - p.x, -(q.z - p.z)) / DEG + 360) % 360;
    a.y = p.ground ? groundAt(p.x, p.z).h + GEAR : p.h; a.spd = p.spd * KT; a.g.visible = true;
  }

  /** a departure: call Ground, taxi to the runway, call Tower, take off and leave the area */
  departure(a) {
    const ap = a.ap, { e, r, side } = this.rwy(ap); a.e = e; a.r = r; a.side = side;
    const hold = ap.holdShort.slice().sort((p, q) => Math.hypot(p.x - e.x, p.z - e.z) - Math.hypot(q.x - e.x, q.z - e.z))[0];
    const twy = ap.taxiways[0], ramp = ap.spawn.ramp;
    const onTwy = (x, z) => { const h = twy.hdg * DEG, dx = Math.sin(h), dz = -Math.cos(h), t = (x - twy.cx) * dx + (z - twy.cz) * dz; return { x: twy.cx + dx * t, z: twy.cz + dz * t }; };
    const G = (x, z, kt, extra = {}) => ({ x, z, h: null, spd: kt, ground: true, ...extra });
    const t1 = onTwy(ramp.x, ramp.z), t2 = onTwy(hold.x, hold.z), entry = rwyPoint(e, 30, 0), out = rwyPoint(e, r.len + 5000, 0);
    a.path = [G(ramp.x, ramp.z, 0, { leg: "ramp" }), G(t1.x, t1.z, 12), G(t2.x, t2.z, 14), G(hold.x, hold.z, 5, { leg: "hold", say: "ready" }), G(entry.x, entry.z, 6, { leg: "lineup" }),
      G(rwyPoint(e, 380, 0).x, rwyPoint(e, 380, 0).z, 55, { leg: "rotate" }), { ...rwyPoint(e, r.len + 300, 0), h: ap.elev + 400 * FT, spd: 72, leg: "upwind" },
      { ...out, h: ap.elev + 2500 * FT, spd: 95, leg: "departure", say: "freq" }, { ...rwyPoint(e, r.len + 14000, 0), h: ap.elev + 3500 * FT, spd: 105, leg: "gone" }];
    a.i = 0; a.x = ramp.x; a.z = ramp.z; a.y = groundAt(ramp.x, ramp.z).h + GEAR; a.spd = 0; a.hdg = ramp.hdg; a.g.visible = true; a.wait = 7;
    this.speak(a, "taxi");
  }

  /** a radio call from `who` now, and an answer from the facility a moment later */
  say(freq, who, text, reply) { this.o.onRadio(freq, who, text); if (reply) this.queue.push({ t: this.t + 1.8, freq, who: reply[0], text: reply[1] }); }

  /** what a pilot of `a` says reaching a waypoint tagged `tag` (and the controller's reply at a towered field) */
  speak(a, tag) {
    const ap = a.ap, rw = a.e.id, sideW = a.side > 0 ? "right" : "left", short = ap.name.split(" ")[0], f = this.freq(ap), pl = this.o.player();
    const onRwy = pl.onGround && rectDist(pl.x, pl.z, a.r) <= 5;
    if (!ap.towered) {
      const lines = { downwind: `${sideW} downwind runway ${rw}, touch and go`, base: `${sideW} base runway ${rw}`, final: `final runway ${rw}, touch and go` };
      if (lines[tag]) this.say(f, a.short, `${short} traffic, ${a.call}, ${lines[tag]}, ${short}.`);
      return;
    }
    const twr = `${short} Tower`;
    if (tag === "midfield") this.say(f, a.short, `${twr}, ${a.call}, midfield ${sideW} downwind, touch and go.`, [twr, onRwy ? `${a.call}, extend downwind, I'll call your base.` : `${a.call}, runway ${rw}, cleared touch and go.`]);
    if (tag === "taxi") this.say(ap.freqs.gnd, a.short, `${short} Ground, ${a.call}, at the ramp with information ${this.o.atis()}, ready to taxi, VFR departure to the ${this.depDir(a)}.`, [`${short} Ground`, `${a.call}, runway ${rw}, taxi via Alpha.`]);
    if (tag === "ready") this.say(f, a.short, `${twr}, ${a.call}, holding short runway ${rw}, ready for departure.`, [twr, `${a.call}, ${onRwy ? `hold short runway ${rw}, traffic on the runway.` : `runway ${rw}, cleared for takeoff.`}`]);
    if (tag === "freq") this.say(f, twr, `${a.call}, frequency change approved.`, [a.short, `Frequency change approved, ${a.call}.`]);
  }
  depDir(a) { return ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"][Math.round(((a.e.hdg + 360) % 360) / 45) % 8]; }

  /** nearby traffic for a controller's advisory: "Traffic, a Skyhawk on left downwind." */
  advisory(ap) {
    const a = this.agents.find((q) => q.ap === ap && q.g.visible && q.path?.[q.i + 1]?.leg && !["ramp", "hold", "lineup", "gone", "departure"].includes(q.path[q.i + 1].leg));
    if (!a) return "";
    const leg = a.path[a.i + 1].leg, where = ["roll", "rotate", "landing"].includes(leg) ? "on the runway" : leg === "flare" ? "on short final" : `on ${["downwind", "base", "crosswind"].includes(leg) ? (a.side > 0 ? "right " : "left ") : ""}${leg}`;
    return ` Traffic, a ${a.name} ${where}.`;
  }

  update(dt, t, simT) {
    this.t = simT;
    while (this.queue.length && this.queue[0].t <= simT) { const m = this.queue.shift(); this.o.onRadio(m.freq, m.who, m.text); }
    const pl = this.o.player();
    for (const a of this.agents) {
      if (a.gone > 0) { a.gone -= dt; if (a.gone <= 0) this.departure(a); continue; }
      if (a.wait > 0) { a.wait -= dt; this.place(a, t, dt); continue; }
      const path = a.path; let A = path[a.i], B = path[a.i + 1];
      // hold short or go around while the player is on the runway
      const onRwy = pl.onGround && rectDist(pl.x, pl.z, a.r) <= 5;
      if (B.leg === "lineup" && onRwy) { a.spd = 0; this.place(a, t, dt); continue; }
      if ((B.leg === "flare" || (B.leg === "final" && a.i >= path.length - 4)) && onRwy && !a.goingAround) {
        a.goingAround = true;
        if (a.ap.towered) this.say(this.freq(a.ap), `${a.ap.name.split(" ")[0]} Tower`, `${a.call}, go around, traffic on the runway.`, [a.short, `Going around, ${a.call}.`]);
        else this.say(this.freq(a.ap), a.short, `${a.ap.name.split(" ")[0]} traffic, ${a.call}, going around runway ${a.e.id}.`);
        const up = path.findIndex((p) => p.leg === "upwind"); a.i = up - 1; a.path = path.map((p, k) => (k === up - 1 ? { ...p, x: a.x, z: a.z, h: a.y, ground: false } : p)); continue;
      }
      // advance when past the end of this leg
      const sx = B.x - A.x, sz = B.z - A.z, L2 = sx * sx + sz * sz || 1, u = ((a.x - A.x) * sx + (a.z - A.z) * sz) / L2;
      if (u >= 1 || Math.hypot(B.x - a.x, B.z - a.z) < (B.ground ? 6 : 90)) {
        a.i++; if (B.say) this.speak(a, B.say);
        if (B.leg === "hold") a.wait = 9; // the call, the clearance, a look both ways
        if (a.i >= path.length - 1) { // circuit done: go again, or leave
          if (a.kind === "pattern") { a.goingAround = false; this.route(a, 1, true); } else { a.g.visible = false; a.gone = 200 + Math.random() * 120; }
        }
        continue;
      }
      // steer toward a point a little ahead on the route
      const look = B.ground ? 25 : 420, cu = clamp(u, 0, 1);
      let cx = A.x + sx * cu, cz = A.z + sz * cu, left = look;
      for (let k = a.i; k < path.length - 1 && left > 0; k++) {
        const P = k === a.i ? { x: cx, z: cz } : path[k], Q = path[k + 1], d = Math.hypot(Q.x - P.x, Q.z - P.z);
        if (d >= left) { cx = P.x + (Q.x - P.x) * left / d; cz = P.z + (Q.z - P.z) * left / d; left = 0; } else { cx = Q.x; cz = Q.z; left -= d; }
      }
      const want = (Math.atan2(cx - a.x, -(cz - a.z)) / DEG + 360) % 360, turn = clamp(wrap(want - a.hdg), -(B.ground ? 30 : 4.5) * dt, (B.ground ? 30 : 4.5) * dt);
      a.hdg = (a.hdg + turn + 360) % 360;
      const tgt = B.spd * KT; a.spd += clamp(tgt - a.spd, -2.6 * dt, (B.ground ? 2.2 : 1.2) * dt);
      a.x += Math.sin(a.hdg * DEG) * a.spd * dt; a.z -= Math.cos(a.hdg * DEG) * a.spd * dt;
      // height: on the ground, or along the route with sensible climb and descent rates
      const gh = groundAt(a.x, a.z).h + GEAR, hA = A.ground ? groundAt(A.x, A.z).h + GEAR : A.h, hB = B.ground ? groundAt(B.x, B.z).h + GEAR : B.h;
      const want_y = B.ground ? gh : Math.max(gh, hA + (hB - hA) * cu), vs = clamp((want_y - a.y) / Math.max(dt, 0.001), -5.2, 4.6);
      a.y = Math.max(gh, a.y + vs * dt);
      const airborne = a.y > gh + 0.5;
      a.pitch = airborne ? clamp(Math.atan2(vs, Math.max(a.spd, 1)) / DEG + 3, -6, 12) : B.leg === "rotate" && a.spd > 50 * KT ? 7 : 0;
      a.bank += (clamp((turn / Math.max(dt, 1e-3)) * 6, airborne ? -28 : 0, airborne ? 28 : 0) - a.bank) * Math.min(1, dt * 2);
      a.flaps = ["base", "final", "flare", "landing"].includes(B.leg) ? 20 : B.leg === "rotate" || B.leg === "roll" ? 10 : 0;
      this.place(a, t, dt);
    }
  }

  place(a, t, dt) {
    const g = a.g; g.position.set(a.x, a.y, a.z);
    g.rotation.set(a.pitch * DEG, -a.hdg * DEG, -a.bank * DEG, "YXZ");
    a.fake ||= { ctl: { elevator: 0, aileron: 0, rudder: 0, trim: 0 }, eng: { rpm: 0 }, elec: { lights: { nav: true, beacon: true, strobe: true, landing: false } }, powered: true, flaps: 0 };
    a.fake.eng.rpm = a.spd > 1 || a.wait > 0 ? 1000 + a.spd / KT * 14 : 900; a.fake.flaps = a.flaps; a.fake.elec.lights.strobe = a.y > groundAt(a.x, a.z).h + GEAR + 1;
    animateAirplane(g, a.fake, t, dt);
  }
}
