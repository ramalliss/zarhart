// Zarhart Valley: a fictional, deterministic VFR practice area (about 60 × 60 km). In Real World mode
// (sim/?world=real&apt=KPAO) the same exports hold a real place instead: see the end of this file and realworld.js.
// World frame: x = east, z = south (north is -z), metres. Heights are metres MSL.
// Pure JS (no three.js) so the flight model and the tests can share it.

import { FT } from "./fdm.js";

/* ---------- seeded 2D simplex noise ---------- */
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rand = mulberry32(19321932);
const perm = new Uint8Array(512);
{ const p = Array.from({ length: 256 }, (_, i) => i); for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) perm[i] = p[i & 255]; }
const GR = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
export function simplex(xin, yin) {
  const s = (xin + yin) * F2; const i = Math.floor(xin + s), j = Math.floor(yin + s);
  const t = (i + j) * G2; const x0 = xin - (i - t), y0 = yin - (j - t);
  const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
  const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
  const ii = i & 255, jj = j & 255;
  let n = 0;
  let t0 = 0.5 - x0 * x0 - y0 * y0; if (t0 > 0) { const g = GR[perm[ii + perm[jj]] & 7]; t0 *= t0; n += t0 * t0 * (g[0] * x0 + g[1] * y0); }
  let t1 = 0.5 - x1 * x1 - y1 * y1; if (t1 > 0) { const g = GR[perm[ii + i1 + perm[jj + j1]] & 7]; t1 *= t1; n += t1 * t1 * (g[0] * x1 + g[1] * y1); }
  let t2 = 0.5 - x2 * x2 - y2 * y2; if (t2 > 0) { const g = GR[perm[ii + 1 + perm[jj + 1]] & 7]; t2 *= t2; n += t2 * t2 * (g[0] * x2 + g[1] * y2); }
  return 70 * n; // ~[-1, 1]
}
export function fbm(x, y, oct = 5) { let a = 0.5, f = 1, s = 0; for (let i = 0; i < oct; i++) { s += a * simplex(x * f, y * f); f *= 2.03; a *= 0.5; } return s; }
function ridged(x, y, oct = 5) { let a = 0.5, f = 1, s = 0; for (let i = 0; i < oct; i++) { const n = 1 - Math.abs(simplex(x * f + 31, y * f - 17)); s += a * n * n; f *= 2.1; a *= 0.5; } return s; }
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const DEG = Math.PI / 180;

export const WORLD_HALF = 30000;
export const WATER = 128;
export const VARIATION = 0; // the agonic line runs through the valley: true = magnetic here
/** magnetic variation in use (degrees, east positive): 0 in Zarhart Valley, the nearest VOR's in Real World mode */
export let MAGVAR = 0;
/** Real World mode's data (realworld.js) when the page was opened with ?world=real, else null; REAL_ERROR if it failed to load */
export let REAL = null, REAL_ERROR = null;

/* ---------- landmarks ---------- */
export const LAKE = { name: "Lake Itasca", x: -4200, z: -6900, rx: 3100, rz: 1650, rot: 18 * DEG };
export const RIVER = { name: "Electra River", pts: [[-3500, -5150], [-3000, -3600], [-3300, -1200], [-3900, 900], [-5300, 3100], [-6600, 6200], [-6400, 10500], [-7900, 16000], [-8600, 22000], [-9800, 30000]] };
export const HIGHWAY = { name: "Highway 32", pts: [[-30000, 4600], [-14000, 4300], [-5800, 3800], [2000, 2600], [8000, 4300], [12400, 16300], [21000, 21000], [30000, 23500]] };
export const RAILROAD = { name: "Railroad", pts: [[-30000, -14200], [-9000, -6600], [0, -1950], [14000, 3300], [30000, 8800]] };
export const TOWNS = [
  { name: "Rutherford", x: -5800, z: 3900, r: 1350, pop: 1 },
  { name: "Atchison", x: 12400, z: 16500, r: 1150, pop: 0.9 },
  { name: "Itasca Village", x: -1200, z: -9300, r: 550, pop: 0.4 },
  { name: "Harbour Grace", x: -17500, z: 9500, r: 600, pop: 0.45 },
];
export const OBSTACLES = [
  { name: "Radio towers", type: "mast", x: 7000, z: -2500, hAgl: 330 },
  { name: "Radio towers", type: "mast", x: 7300, z: -2250, hAgl: 300 },
  { name: "Itasca power plant", type: "stack", x: -2200, z: -3700, hAgl: 175 },
];
export const POWER_PLANT = { name: "Itasca power plant", x: -2200, z: -3700 };
export const DAM = { name: "Itasca Dam", x: -3520, z: -5120, len: 520, rot: 70 * DEG };
export const LAUNCH = { name: "Rutherford Launch Complex", x: 16000, z: -12500, r: 900 };

/* ---------- airports ---------- */
function rwy(ids, cx, cz, hdg, len, wid, surface, extra = {}) {
  const d = [Math.sin(hdg * DEG), -Math.cos(hdg * DEG)];
  return {
    ids, cx, cz, hdg, len, wid, surface, ...extra,
    dir: d,
    ends: [
      { id: ids[0], x: cx - d[0] * len / 2, z: cz - d[1] * len / 2, hdg },
      { id: ids[1], x: cx + d[0] * len / 2, z: cz + d[1] * len / 2, hdg: (hdg + 180) % 360 },
    ],
  };
}
// rect: centre, length (along hdg), width
const rect = (cx, cz, hdg, len, wid, surface = "asphalt", name = "") => ({ cx, cz, hdg, len, wid, surface, name });
/** the point `s` m along heading `hdg` and `c` m to its right, from (cx, cz) */
const at = (cx, cz, hdg, s, c) => [cx + Math.sin(hdg * DEG) * s + Math.cos(hdg * DEG) * c, cz - Math.cos(hdg * DEG) * s + Math.sin(hdg * DEG) * c];
const pt = ([x, z]) => ({ x, z });

export const AIRPORTS = [
  {
    id: "KZAR", name: "Zarhart Field", city: "Rutherford", x: 0, z: 0, towered: true, calmRwy: "27",
    freqs: { atis: 127.85, twr: 118.3, gnd: 121.9 },
    runways: [
      rwy(["09", "27"], 0, 0, 90, 1500, 30, "asphalt", { lights: true, vasi: ["27", "09"], tdz: true }),
      rwy(["18", "36"], 350, 0, 180, 1100, 23, "asphalt", { lights: true }),
    ],
    taxiways: [
      rect(0, -165, 90, 1520, 15, "asphalt", "A"),
      rect(-745, -90, 0, 150, 15, "asphalt", "A1"),
      rect(-200, -90, 0, 150, 15, "asphalt", "A3"),
      rect(745, -90, 0, 150, 15, "asphalt", "A6"),
      rect(470, 175, 0, 690, 15, "asphalt", "B"), // east of 18/36, crossing runway 9/27
      rect(410, 515, 90, 120, 15, "asphalt", "B1"),
    ],
    aprons: [rect(-300, -265, 90, 420, 170, "asphalt", "Main ramp")],
    holdShort: [
      { x: -745, z: -62, hdg: 0, sign: "9-27", twy: "A1" },
      { x: -200, z: -62, hdg: 0, sign: "9-27", twy: "A3" },
      { x: 745, z: -62, hdg: 0, sign: "27-9", twy: "A6" },
      { x: 350 - 55, z: -165, hdg: 90, sign: "18-36", twy: "A" },
      { x: 350 + 55, z: -165, hdg: 270, sign: "18-36", twy: "A" },
      { x: 470, z: -42, hdg: 180, sign: "9-27", twy: "B" }, { x: 470, z: 42, hdg: 0, sign: "27-9", twy: "B" },
      { x: 350 + 34, z: 515, hdg: 270, sign: "18-36", twy: "B1" },
    ],
    rwyHold: [ // runway/runway hold position signs on 09/27 before the 18/36 intersection
      { x: 350 - 70, z: -22, sign: "18-36" }, { x: 350 + 70, z: 22, sign: "18-36" },
    ],
    tower: { x: -110, z: -400 }, beacon: { x: -560, z: -330 }, windsock: { x: 540, z: -55 },
    hangars: [[-470, -385, 60, 40], [-380, -390, 50, 34], [-50, -380, 70, 44]],
    parked: [[-420, -260, 90], [-370, -255, 80], [-320, -262, 100], [-180, -270, 95]],
    spawn: { ramp: { x: -300, z: -230, hdg: 180 }, hold27: { x: 745, z: -80, hdg: 180 }, rwy27: { x: 715, z: 0, hdg: 270 }, rwy09: { x: -715, z: 0, hdg: 90 } },
  },
  {
    id: "KAME", name: "Earhart Municipal", city: "Atchison", x: 14000, z: 9000, towered: false, pcl: true, calmRwy: "36",
    freqs: { ctaf: 122.8, awos: 118.525 },
    runways: [rwy(["18", "36"], 14000, 9000, 180, 1100, 23, "asphalt", { lights: true, vasi: ["36"], pcl: true }), rwy(["09", "27"], 13640, 9350, 90, 600, 20, "grass", { lights: false })],
    taxiways: [rect(14110, 9000, 180, 1100, 12, "asphalt", "A"), rect(14055, 8460, 90, 110, 12, "asphalt", "A1"), rect(14055, 9540, 90, 110, 12, "asphalt", "A2")],
    aprons: [rect(14230, 9080, 180, 260, 110, "asphalt", "Ramp")],
    holdShort: [{ x: 14062, z: 8460, hdg: 270, sign: "18-36", twy: "A1" }, { x: 14062, z: 9540, hdg: 270, sign: "36-18", twy: "A2" }],
    rwyHold: [],
    beacon: { x: 14330, z: 8850 }, windsock: { x: 13850, z: 9000 },
    segmentedCircle: { x: 13850, z: 9000, r: 30, pattern: { "18": "right", "36": "left" } },
    hangars: [[14320, 9180, 50, 36], [14320, 9240, 50, 36]],
    parked: [[14210, 9030, 270], [14210, 9080, 260]],
    spawn: { ramp: { x: 14200, z: 9120, hdg: 270 }, rwy36: { x: 14000, z: 9520, hdg: 0 }, rwy18: { x: 14000, z: 8480, hdg: 180 } },
  },
  {
    id: "Z19", name: "Electra Field", city: "Harbour Grace", x: -11000, z: 6000, towered: false, calmRwy: "22",
    freqs: { ctaf: 122.9 },
    runways: [rwy(["04", "22"], -11000, 6000, 40, 760, 30, "grass", { lights: false })],
    taxiways: [], aprons: [rect(-10900, 6150, 40, 80, 50, "grass", "Tie-downs")], holdShort: [], rwyHold: [],
    windsock: { x: -10930, z: 5990 }, hangars: [[-10860, 6190, 30, 24]], parked: [[-10910, 6150, 220]],
    spawn: { rwy04: { x: -11000 - Math.sin(40 * DEG) * 350, z: 6000 + Math.cos(40 * DEG) * 350, hdg: 40 }, ramp: { x: -10900, z: 6150, hdg: 220 } },
  },
  {
    // a mountain strip in the Electra Range, under the Electra MOA (floor 8,000 ft): density altitude and mountain flying
    id: "Z40", name: "Electra Pass", city: "Electra Range", x: -6000, z: -23000, towered: false, calmRwy: "18", mountain: true,
    freqs: { ctaf: 122.7 },
    runways: [rwy(["18", "36"], -6000, -23000, 180, 1100, 23, "asphalt", { lights: true })],
    taxiways: [rect(...at(-6000, -23000, 180, -380, -45), 270, 70, 12, "asphalt", "A")],
    aprons: [rect(...at(-6000, -23000, 180, -380, -110), 180, 140, 70, "asphalt", "Ramp")],
    holdShort: [{ ...pt(at(-6000, -23000, 180, -380, -30)), hdg: 270, sign: "18-36", twy: "A" }],
    rwyHold: [],
    beacon: pt(at(-6000, -23000, 180, -300, -150)), windsock: pt(at(-6000, -23000, 180, 120, -40)),
    segmentedCircle: { ...pt(at(-6000, -23000, 180, 120, -40)), r: 26, pattern: { "18": "left", "36": "right" } },
    hangars: [[...at(-6000, -23000, 180, -330, -165), 40, 30]],
    parked: [[...at(-6000, -23000, 180, -400, -110), 270]],
    spawn: { ramp: { ...pt(at(-6000, -23000, 180, -360, -110)), hdg: 270 }, rwy18: { ...pt(at(-6000, -23000, 180, -520, 0)), hdg: 180 }, rwy36: { ...pt(at(-6000, -23000, 180, 520, 0)), hdg: 0 } },
  },
  {
    // the regional airport: a long runway with a displaced threshold and a blast pad, a closed crosswind runway, a parallel taxiway
    id: "KSRH", name: "Southridge Regional", city: "Southridge", x: 22000, z: 19500, towered: false, calmRwy: "31",
    freqs: { ctaf: 123.0, awos: 119.275 },
    runways: [
      rwy(["13", "31"], 22000, 19500, 130, 1830, 30, "asphalt", { lights: true, vasi: ["13"], blastPad: { "13": 90 }, displaced: { "31": 200 } }),
      rwy(["04", "22"], ...at(22000, 19500, 130, 600, 480), 40, 900, 23, "asphalt", { closed: true }),
    ],
    taxiways: [
      rect(...at(22000, 19500, 130, 0, -120), 130, 1700, 15, "asphalt", "A"),
      ...[-800, 0, 800].map((s, k) => rect(...at(22000, 19500, 130, s, -60), 220, 120, 15, "asphalt", `A${k + 1}`)),
    ],
    aprons: [rect(...at(22000, 19500, 130, 0, -187), 130, 320, 120, "asphalt", "Main ramp")],
    holdShort: [-800, 0, 800].map((s, k) => ({ ...pt(at(22000, 19500, 130, s, -45)), hdg: 220, sign: "13-31", twy: `A${k + 1}` })),
    rwyHold: [],
    beacon: pt(at(22000, 19500, 130, 260, -330)), windsock: pt(at(22000, 19500, 130, -150, 55)),
    segmentedCircle: { ...pt(at(22000, 19500, 130, -150, 55)), r: 30, pattern: { "13": "left", "31": "right" } },
    hangars: [[...at(22000, 19500, 130, -120, -320), 60, 40], [...at(22000, 19500, 130, -40, -320), 60, 40], [...at(22000, 19500, 130, 60, -322), 70, 44]],
    parked: [[...at(22000, 19500, 130, -60, -230), 40], [...at(22000, 19500, 130, -10, -230), 40], [...at(22000, 19500, 130, 40, -232), 220]],
    spawn: { ramp: { ...pt(at(22000, 19500, 130, 0, -215)), hdg: 220 }, rwy13: { ...pt(at(22000, 19500, 130, -790, 0)), hdg: 130 }, rwy31: { ...pt(at(22000, 19500, 130, 880, 0)), hdg: 310 } },
  },
  {
    // a small strip west of Lake Itasca
    id: "Z23", name: "Itasca West", city: "Itasca", x: -11000, z: -4800, towered: false, calmRwy: "34",
    freqs: { ctaf: 122.725 },
    runways: [rwy(["16", "34"], -11000, -4800, 160, 900, 18, "asphalt", { lights: false })],
    taxiways: [rect(...at(-11000, -4800, 160, 300, 36), 250, 56, 10, "asphalt", "A")],
    aprons: [rect(...at(-11000, -4800, 160, 300, 90), 160, 90, 55, "asphalt", "Ramp")],
    holdShort: [{ ...pt(at(-11000, -4800, 160, 300, 25)), hdg: 70, sign: "16-34", twy: "A" }],
    rwyHold: [],
    windsock: pt(at(-11000, -4800, 160, -100, 30)),
    hangars: [[...at(-11000, -4800, 160, 330, 125), 34, 26]],
    parked: [[...at(-11000, -4800, 160, 290, 95), 250]],
    spawn: { ramp: { ...pt(at(-11000, -4800, 160, 300, 90)), hdg: 250 }, rwy34: { ...pt(at(-11000, -4800, 160, 420, 0)), hdg: 340 }, rwy16: { ...pt(at(-11000, -4800, 160, -420, 0)), hdg: 160 } },
  },
];

export const NAVAIDS = [
  { id: "ZRH", name: "Zarhart", type: "VOR-DME", freq: 113.9, x: 2600, z: -3400 },
  { id: "AME", name: "Earhart", type: "VOR-DME", freq: 116.4, x: 17600, z: 12600 },
];

/* ---------- airspace ---------- */
export const AIRSPACE = [
  { id: "KZAR-D", name: "Zarhart Class D", cls: "D", x: 0, z: 0, r: 7780, floorFt: 0, ceilFt: null /* set below */ },
  { id: "KAME-E700", name: "Earhart Class E (700 AGL)", cls: "E700", x: 14000, z: 9000, r: 7400 },
  { id: "Z19-E700", name: "Electra Class E (700 AGL)", cls: "E700", x: -11000, z: 6000, r: 5200 },
  { id: "KSRH-E700", name: "Southridge Class E (700 AGL)", cls: "E700", x: 22000, z: 19500, r: 6400 },
  { id: "P-19", name: "Prohibited P-19 (Launch Complex)", cls: "P", x: 16000, z: -12500, r: 3700, floorFt: 0, ceilFt: 5000 },
  { id: "R-1932", name: "Restricted R-1932", cls: "R", x: -19500, z: -19000, r: 5200, floorFt: 0, ceilFt: 12000 },
  { id: "ELECTRA-MOA", name: "Electra MOA", cls: "MOA", x: 5000, z: -25000, r: 12000, floorFt: 8000, ceilFt: 17999 },
];

/* ---------- terrain ---------- */
function distSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az; const l2 = dx * dx + dz * dz || 1;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1);
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}
export function distPolyline(px, pz, pts) { let d = Infinity; for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, distSeg(px, pz, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])); return d; }
function lakeD(x, z) {
  const c = Math.cos(LAKE.rot), s = Math.sin(LAKE.rot);
  const dx = x - LAKE.x, dz = z - LAKE.z; const u = dx * c + dz * s, v = -dx * s + dz * c;
  const wob = 1 + 0.12 * simplex(x / 900, z / 900);
  return Math.hypot(u / LAKE.rx, v / LAKE.rz) / wob;
}
export function inLake(x, z) { return !REAL && lakeD(x, z) < 1; }

/** the rectangles in a list that can matter within `reach` m of a point, from a 400 m grid (big real airports have thousands) */
const grids = new WeakMap(), NONE = [];
function near(list, x, z, reach) {
  if (list.length < 48) return list;
  let G = grids.get(list);
  if (!G || G.n !== list.length) {
    const C = 400, cells = new Map();
    for (const r of list) {
      const R = Math.hypot(r.len, r.wid) / 2 + reach;
      for (let i = Math.floor((r.cx - R) / C); i <= Math.floor((r.cx + R) / C); i++) for (let j = Math.floor((r.cz - R) / C); j <= Math.floor((r.cz + R) / C); j++) { const k = i * 65536 + j; let c = cells.get(k); if (!c) cells.set(k, (c = [])); c.push(r); }
    }
    G = { n: list.length, cells, C }; grids.set(list, G);
  }
  return G.cells.get(Math.floor(x / G.C) * 65536 + Math.floor(z / G.C)) || NONE;
}
function inPoly(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, zi] = pts[i], [xj, zj] = pts[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside; }
  return inside;
}
/** Signed distance (m) from a point to an oriented rectangle (negative inside). */
export function rectDist(px, pz, r, grow = 0) {
  const c = Math.cos(r.hdg * DEG), s = Math.sin(r.hdg * DEG);
  const dx = px - r.cx, dz = pz - r.cz;
  const along = dx * s - dz * c, across = dx * c + dz * s;
  const qa = Math.abs(along) - (r.len / 2 + grow), qc = Math.abs(across) - (r.wid / 2 + grow);
  const ox = Math.max(qa, 0), oz = Math.max(qc, 0);
  return Math.hypot(ox, oz) + Math.min(Math.max(qa, qc), 0);
}

function rawHeight(x, z) {
  let h = 136 + 34 * fbm(x / 5600, z / 5600, 5) + 9 * fbm(x / 1300 + 40, z / 1300 - 9, 3);
  h += 0.0016 * (x * 0.7 + z * 0.3); // gentle regional tilt
  // Electra Range to the north
  const m = smooth((-z - 9500) / 13000);
  if (m > 0) h += m * (420 + 1350 * ridged(x / 7000, z / 7000, 5) * (0.55 + 0.45 * m));
  // hills in the south-west corner
  const sw = smooth((-x - 15000) / 9000) * smooth((z - 10000) / 9000);
  if (sw > 0) h += sw * 260 * (0.6 + fbm(x / 3000, z / 3000, 4));
  // launch complex plateau
  const ld = Math.hypot(x - LAUNCH.x, z - LAUNCH.z);
  if (ld < LAUNCH.r + 1600) h = lerp(LAUNCH.h ?? h, h, smooth((ld - LAUNCH.r) / 1600));
  return h;
}
LAUNCH.h = Math.round(rawHeight(LAUNCH.x, LAUNCH.z) + 25);

// Runway holding position signs read like the runway in front of you: the runway whose threshold is on your left is
// written first ("15-33": runway 15's threshold to the left, AIM 2-3-8). Worked out here from where each sign stands and
// which way a pilot holding there faces (toward the runway, as the hold-short marking is drawn), so none reads backwards.
{
  const strip = (id) => id.replace(/^0/, "");
  const same = (rw, sign) => rw.ids.map(strip).sort().join() === sign.split("-").map(strip).sort().join();
  const orient = (h, r, fx, fz) => { // facing (fx, fz); its right-hand side is (-fz, fx)
    const [e0, e1] = r.ends, e0Right = (e0.x - h.x) * -fz + (e0.z - h.z) * fx > 0;
    h.sign = e0Right ? `${strip(e1.id)}-${strip(e0.id)}` : `${strip(e0.id)}-${strip(e1.id)}`;
  };
  for (const ap of AIRPORTS) {
    for (const h of ap.holdShort) { // facing the nearest point on that runway's centreline
      const r = ap.runways.find((rw) => same(rw, h.sign)); if (!r) continue;
      const t = (h.x - r.cx) * r.dir[0] + (h.z - r.cz) * r.dir[1];
      orient(h, r, r.cx + r.dir[0] * t - h.x, r.cz + r.dir[1] * t - h.z);
    }
    for (const h of ap.rwyHold) { // standing on one runway, facing along it toward the runway it crosses
      const other = ap.runways.find((rw) => same(rw, h.sign)), on = ap.runways.filter((rw) => rw !== other).sort((p, q) => rectDist(h.x, h.z, p) - rectDist(h.x, h.z, q))[0]; // the sign stands beside the runway it's on
      if (!other || !on) continue;
      const k = Math.sign((other.cx - h.x) * on.dir[0] + (other.cz - h.z) * on.dir[1]) || 1;
      orient(h, other, on.dir[0] * k, on.dir[1] * k);
    }
  }
}

// field elevations follow the natural terrain, rounded to the nearest 10 ft
for (const ap of AIRPORTS) {
  ap.elevFt = Math.round(rawHeight(ap.x, ap.z) / FT / 10) * 10;
  ap.elev = ap.elevFt * FT;
  ap.flat = [...ap.runways.map((r) => rect(r.cx, r.cz, r.hdg, r.len, r.wid)), ...ap.taxiways, ...ap.aprons];
}
{ const kzar = AIRPORTS[0]; AIRSPACE[0].ceilFt = Math.round((kzar.elevFt + 2500) / 100) * 100; }

/** a real place's terrain: bilinear between the height grid's posts */
function realHeight(x, z) {
  const H = REAL.heights, G = H.G, fx = (x + H.half) / H.step, fz = (z + H.half) / H.step;
  const i = clamp(Math.floor(fx), 0, G - 2), j = clamp(Math.floor(fz), 0, G - 2), tx = clamp(fx - i, 0, 1), tz = clamp(fz - j, 0, 1), g = H.grid;
  return (g[j * G + i] * (1 - tx) + g[j * G + i + 1] * tx) * (1 - tz) + (g[(j + 1) * G + i] * (1 - tx) + g[(j + 1) * G + i + 1] * tx) * tz;
}
function realWater(x, z) {
  const H = REAL.heights, i = Math.round((x + H.half) / H.step), j = Math.round((z + H.half) / H.step);
  return i >= 0 && j >= 0 && i < H.G && j < H.G && H.water[j * H.G + i] === 1;
}
export function heightAt(x, z) {
  let h;
  if (REAL) h = realHeight(x, z);
  else {
    h = rawHeight(x, z);
    // river valley
    const rd = distPolyline(x, z, RIVER.pts);
    if (rd < 260) h -= 9 * smooth(1 - rd / 260);
    // lake basin
    const ld = lakeD(x, z);
    if (ld < 1.3) h = lerp(WATER - 7, Math.max(h, WATER + 2), smooth((ld - 0.92) / 0.38));
  }
  // airports: flat pads with a smooth blend
  for (const ap of AIRPORTS) {
    const R = (ap.reach ?? 1400) + 1200; // Zarhart's fields are compact; real ones reach as far as their longest runway
    if (Math.abs(x - ap.x) > R || Math.abs(z - ap.z) > R) continue;
    let d = Infinity;
    for (const r of near(ap.flat, x, z, 810)) d = Math.min(d, rectDist(x, z, r, 160));
    if (d < 650) h = lerp(ap.elev, h, smooth(d / 650));
  }
  return h;
}

/** Surface under a point: { h, type } where type is asphalt | grass | dirt | water. */
export function groundAt(x, z) {
  for (const ap of AIRPORTS) {
    const R = ap.reach ?? 1400;
    if (Math.abs(x - ap.x) > R || Math.abs(z - ap.z) > R) continue;
    for (const r of ap.runways) if (rectDist(x, z, r) <= 0) return { h: ap.elev, type: r.surface === "grass" || r.surface === "dirt" ? r.surface : "asphalt" };
    // a real field's taxiways and ramps that arrived after the ground was shaped lie on the terrain instead of the levelled pad
    const pave = (type) => ({ h: ap.flattened === false ? heightAt(x, z) : ap.elev, type });
    for (const r of near(ap.taxiways, x, z, 1)) if (rectDist(x, z, r) <= 0) return pave(r.surface);
    for (const r of ap.aprons) if (rectDist(x, z, r) <= 0) return pave(r.surface);
    for (const poly of ap.apronPolys || []) if (inPoly(x, z, poly)) return pave("asphalt");
    if (Math.abs(heightAt(x, z) - ap.elev) < 0.01) return { h: ap.elev, type: "grass" };
  }
  if (REAL) { const h = heightAt(x, z); return { h, type: realWater(x, z) ? "water" : "grass" }; }
  if (lakeD(x, z) < 0.97) return { h: WATER, type: "water" };
  const h = heightAt(x, z);
  return { h, type: h > 700 ? "dirt" : "grass" };
}

/* ---------- airspace & VFR minimums ---------- */
export function airspaceAt(x, altFt, z) {
  const agl = altFt - heightAt(x, z) / FT;
  const hits = [];
  for (const a of AIRSPACE) {
    if (a.poly) { // Real World mode: the FAA's shapes, some with holes cut out
      const b = a.bbox; if (x < b[0] || x > b[1] || z < b[2] || z > b[3] || !inPoly(x, z, a.poly) || a.holes?.some((h) => inPoly(x, z, h))) continue;
    } else if (Math.hypot(x - a.x, z - a.z) > a.r) continue;
    if (a.cls === "E700") { if (agl >= 700) hits.push(a); continue; }
    const above = a.floorAgl ? agl >= a.floorFt : altFt >= (a.floorFt ?? 0), below = a.ceilFt == null || (a.ceilAgl ? agl <= a.ceilFt : altFt <= a.ceilFt);
    if (above && below) hits.push(a);
  }
  const special = hits.filter((a) => ["P", "R", "MOA", "W", "ALERT"].includes(a.cls));
  let base = "G";
  if (altFt >= 18000) base = "A";
  else if (hits.some((a) => a.cls === "B")) base = "B";
  else if (hits.some((a) => a.cls === "C")) base = "C";
  else if (hits.some((a) => a.cls === "D")) base = "D";
  else if (hits.some((a) => a.cls === "E" || a.cls === "E700") || agl >= 1200 || altFt >= 14500) base = "E";
  return { cls: base, agl, special, hits };
}

/** VFR weather minimums from 14 CFR 91.155 for a class/altitude. Distances: visSM, below/above/horiz in feet (horiz may be SM). */
export function vfrMinimums(cls, altFt, agl, night) {
  if (cls === "A") return { text: "Class A: IFR only", visSM: Infinity, below: 0, above: 0, horizFt: 0, ifrOnly: true };
  if (cls === "B") return { text: "3 SM, clear of clouds", visSM: 3, below: 0, above: 0, horizFt: 0 };
  if (cls === "C" || cls === "D" || (cls === "E" && altFt < 10000))
    return { text: "3 SM · 500 below · 1,000 above · 2,000 horizontal", visSM: 3, below: 500, above: 1000, horizFt: 2000 };
  if (cls === "E") return { text: "5 SM · 1,000 below · 1,000 above · 1 SM horizontal", visSM: 5, below: 1000, above: 1000, horizFt: 6076 };
  // Class G
  if (agl <= 1200) return night
    ? { text: "Night: 3 SM · 500 below · 1,000 above · 2,000 horizontal", visSM: 3, below: 500, above: 1000, horizFt: 2000 }
    : { text: "Day: 1 SM, clear of clouds", visSM: 1, below: 0, above: 0, horizFt: 0 };
  if (altFt < 10000) return night
    ? { text: "Night: 3 SM · 500 below · 1,000 above · 2,000 horizontal", visSM: 3, below: 500, above: 1000, horizFt: 2000 }
    : { text: "Day: 1 SM · 500 below · 1,000 above · 2,000 horizontal", visSM: 1, below: 500, above: 1000, horizFt: 2000 };
  return { text: "5 SM · 1,000 below · 1,000 above · 1 SM horizontal", visSM: 5, below: 1000, above: 1000, horizFt: 6076 };
}

export function nearestAirport(x, z) {
  let best = null, bd = Infinity;
  for (const a of AIRPORTS) { const d = Math.hypot(a.x - x, a.z - z); if (d < bd) { bd = d; best = a; } }
  return { airport: best, dist: bd };
}

/* ---------- Real World mode ----------
 * sim/?world=real&apt=KPAO swaps Zarhart Valley for 60 × 60 km of the real United States around that airport (realworld.js).
 * Every module that imports this one waits here until the real airports, VORs and terrain heights have loaded, then sees
 * the same exports filled with the real place. If loading fails, Zarhart Valley stays and REAL_ERROR says why.
 */
const params = typeof location !== "undefined" ? new URLSearchParams(location.search) : null;
if (params?.get("world") === "real") {
  const say = (t) => { const el = document.getElementById("loadMsg"); if (el) el.textContent = t + "…"; };
  let low = false; try { low = JSON.parse(localStorage.getItem("zarhart:settings") || "{}").quality === "low"; } catch { /* private mode */ }
  try {
    const { loadRealWorld } = await import("./realworld.js");
    const real = await loadRealWorld(params.get("apt") || "KPAO", { progress: say, demZoom: low ? 11 : 12, grid: low ? 512 : 1024 });
    AIRPORTS.splice(0, AIRPORTS.length, ...real.airports);
    NAVAIDS.splice(0, NAVAIDS.length, ...real.navaids);
    AIRSPACE.splice(0, AIRSPACE.length, ...real.airspace);
    TOWNS.length = 0; OBSTACLES.length = 0; RIVER.pts = []; HIGHWAY.pts = []; RAILROAD.pts = [];
    REAL = real; MAGVAR = real.variation || 0;
  } catch (err) { console.error(err); REAL_ERROR = err.message || String(err); }
}
