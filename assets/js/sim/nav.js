// VOR / DME / GPS calculations. Variation is 0° in the Zarhart Valley, so true = magnetic.
import { NAVAIDS, AIRPORTS, heightAt } from "./world-data.js";
import { FT } from "./fdm.js";

const NM = 1852;
const DEG = Math.PI / 180;
export const wrap180 = (a) => ((a % 360) + 540) % 360 - 180;
export const wrap360 = (a) => ((a % 360) + 360) % 360;
export const bearing = (fx, fz, tx, tz) => wrap360(Math.atan2(tx - fx, -(tz - fz)) / DEG);

export function findNavaid(freq) { return NAVAIDS.find((n) => Math.abs(n.freq - freq) < 0.005) || null; }

/** VOR receiver. Returns { ok, ident, radial, toFrom, cdi (-1..1, full scale ±10°), dme (NM slant) } */
export function vor(pos, freq, obs) {
  const n = findNavaid(freq);
  if (!n) return { ok: false };
  const dx = pos.x - n.x, dz = pos.z - n.z;
  const groundNm = Math.hypot(dx, dz) / NM;
  const agl = Math.max(0, pos.y - heightAt(n.x, n.z)) / FT;
  const range = Math.min(40, 1.23 * Math.sqrt(Math.max(agl, 1)) + 3);
  if (groundNm > range) return { ok: false, ident: n.id };
  const radial = bearing(n.x, n.z, pos.x, pos.z);
  const diff = wrap180(radial - obs);
  let toFrom, cdi;
  if (groundNm < 0.15) { toFrom = "OFF"; cdi = 0; }
  else if (Math.abs(diff) < 90) { toFrom = "FROM"; cdi = -diff / 10; }
  else { toFrom = "TO"; cdi = wrap180(radial - (obs + 180)) / 10; }
  const slant = Math.hypot(dx, dz, pos.y - heightAt(n.x, n.z)) / NM;
  return { ok: true, ident: n.id, name: n.name, radial, toFrom, cdi: Math.max(-1, Math.min(1, cdi)), dme: slant, station: n };
}

/** GPS direct-to: { id, dist (NM), brg, xtkNm, dtk } */
export function gps(pos, wp, from) {
  if (!wp) return null;
  const dist = Math.hypot(wp.x - pos.x, wp.z - pos.z) / NM;
  const brg = bearing(pos.x, pos.z, wp.x, wp.z);
  let dtk = brg, xtk = 0;
  if (from) {
    dtk = bearing(from.x, from.z, wp.x, wp.z);
    const lx = wp.x - from.x, lz = wp.z - from.z, l = Math.hypot(lx, lz) || 1;
    xtk = -(((pos.x - from.x) * lz - (pos.z - from.z) * lx) / l) / NM; // + = right of course
  }
  return { id: wp.id, name: wp.name, dist, brg, dtk, xtk };
}

export const WAYPOINTS = [
  ...AIRPORTS.map((a) => ({ id: a.id, name: a.name, x: a.x, z: a.z, kind: "airport" })),
  ...NAVAIDS.map((n) => ({ id: n.id, name: `${n.name} VOR`, x: n.x, z: n.z, kind: "vor" })),
];
