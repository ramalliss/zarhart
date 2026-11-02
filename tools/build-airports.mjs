// Builds the real-world airport data for the simulator's Real World mode from OurAirports (public domain,
// https://ourairports.com/data/). Download airports.csv, runways.csv, airport-frequencies.csv and navaids.csv from
// https://davidmegginson.github.io/ourairports-data/ into one folder, then:
//   node tools/build-airports.mjs <that folder>
// It writes assets/data/airports/<lat>_<lon>.json (one file per 1° square: airports with runways, frequencies and VORs)
// and assets/data/airports/index.json (every airport's ID, name and place, for the airport search box).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = process.argv[2];
if (!SRC) { console.log("usage: node tools/build-airports.mjs <folder with the OurAirports CSV files>"); process.exit(1); }
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "data", "airports");

/** RFC 4180 CSV: quoted fields may hold commas and doubled quotes */
function csv(file) {
  const text = readFileSync(join(SRC, file), "utf8"), rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; continue; }
    if (c === '"') q = true; else if (c === ",") { row.push(f); f = ""; } else if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; } else if (c !== "\r") f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const head = rows.shift();
  return rows.filter((r) => r.length >= head.length - 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}
const num = (v) => (v === "" || v == null ? null : +v);
const r5 = (v) => Math.round(v * 1e5) / 1e5;

/** runway surface → asphalt (any hard surface), grass, dirt (gravel, dirt, sand, coral), or null (water, snow, unknown) */
function surface(s) {
  const t = s.toUpperCase();
  if (/WAT/.test(t)) return null;
  if (/ASP|CON|BIT|PEM|TAR|MAC|PAV|CEM|BRI|HARD|PSP|METAL/.test(t)) return "asphalt";
  if (/TURF|GRS|GRAS|GRE|SOD/.test(t)) return "grass";
  if (/GRV|GRAV|DIRT|SAND|COR|CLAY|SOIL|SILT|GVL|LAT|ROCK/.test(t)) return "dirt";
  return null;
}

const airports = csv("airports.csv").filter((a) => a.iso_country === "US" && /^(small|medium|large)_airport$/.test(a.type));
const byId = new Map(airports.map((a) => [a.id, { a, runways: [], freqs: {} }]));
for (const r of csv("runways.csv")) {
  const e = byId.get(r.airport_ref); if (!e || r.closed === "1") continue;
  const s = surface(r.surface), la1 = num(r.le_latitude_deg), lo1 = num(r.le_longitude_deg), la2 = num(r.he_latitude_deg), lo2 = num(r.he_longitude_deg);
  if (!s || la1 == null || lo1 == null || la2 == null || lo2 == null || !(num(r.length_ft) > 300)) continue;
  if (!/^\d{1,2}[LCR]?$/.test(r.le_ident) || !/^\d{1,2}[LCR]?$/.test(r.he_ident)) continue; // skip helipads and odd names
  e.runways.push([r.le_ident.padStart(2, "0"), r.he_ident.padStart(2, "0"), r5(la1), r5(lo1), r5(la2), r5(lo2), Math.round(num(r.length_ft)), Math.round(num(r.width_ft) || 75), s, r.lighted === "1" ? 1 : 0, Math.round(num(r.le_displaced_threshold_ft) || 0), Math.round(num(r.he_displaced_threshold_ft) || 0)]);
}
// frequencies: tower, ground, ATIS, CTAF (or UNICOM), AWOS/ASOS, approach
const KIND = { TWR: "twr", GND: "gnd", ATIS: "atis", "D-ATIS": "atis", CTAF: "ctaf", UNIC: "unicom", UNICOM: "unicom", AWOS: "awos", ASOS: "awos", "AWOS-3": "awos", AWIS: "awos", APP: "app", "A/D": "app", DEP: "dep", CLD: "clnc", "CLNC DEL": "clnc" };
for (const f of csv("airport-frequencies.csv")) {
  const e = byId.get(f.airport_ref); const k = KIND[f.type.toUpperCase()]; const mhz = num(f.frequency_mhz);
  if (!e || !k || !(mhz >= 108 && mhz < 137)) continue;
  if (!e.freqs[k]) e.freqs[k] = Math.round(mhz * 1000) / 1000;
}
for (const e of byId.values()) if (!e.freqs.ctaf && e.freqs.unicom && !e.freqs.twr) e.freqs.ctaf = e.freqs.unicom;

const navaids = csv("navaids.csv").filter((n) => n.iso_country === "US" && /^(VOR|VOR-DME|VORTAC|VOR\/DME)$/.test(n.type) && num(n.latitude_deg) != null)
  .map((n) => ({ id: n.ident, name: n.name, type: n.type === "VORTAC" ? "VORTAC" : n.type.replace("/", "-"), freq: Math.round(num(n.frequency_khz)) / 1000, lat: r5(num(n.latitude_deg)), lon: r5(num(n.longitude_deg)), elev: num(n.elevation_ft), var: num(n.magnetic_variation_deg) }));

// one file per 1° square
const cells = new Map(), cell = (lat, lon) => `${Math.floor(lat)}_${Math.floor(lon)}`;
const put = (key, kind, v) => { if (!cells.has(key)) cells.set(key, { airports: [], navaids: [] }); cells.get(key)[kind].push(v); };
const index = [];
for (const { a, runways, freqs } of byId.values()) {
  if (!runways.length) continue;
  const lat = r5(+a.latitude_deg), lon = r5(+a.longitude_deg);
  const rec = { id: a.ident, local: a.local_code || undefined, name: a.name, city: a.municipality, state: a.iso_region.replace("US-", ""), lat, lon, elev: num(a.elevation_ft) ?? 0, size: a.type[0].toUpperCase(), freqs, rwys: runways };
  put(cell(lat, lon), "airports", rec);
  index.push([a.ident, a.local_code && a.local_code !== a.ident ? a.local_code : "", a.name, a.municipality, rec.state, lat, lon]);
}
for (const n of navaids) put(cell(n.lat, n.lon), "navaids", n);

mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (f.endsWith(".json")) rmSync(join(OUT, f));
let bytes = 0;
for (const [key, data] of cells) { const s = JSON.stringify(data); bytes += s.length; writeFileSync(join(OUT, `${key}.json`), s); }
index.sort((p, q) => p[0].localeCompare(q[0]));
const idx = JSON.stringify(index); writeFileSync(join(OUT, "index.json"), idx);
console.log(`${index.length} airports with runways, ${navaids.length} VORs, ${cells.size} area files (${(bytes / 1e6).toFixed(1)} MB), index ${(idx.length / 1e6).toFixed(2)} MB`);
