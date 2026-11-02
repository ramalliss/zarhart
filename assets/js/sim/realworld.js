// Real World mode: a 60 × 60 km piece of the United States around a chosen airport, built in the browser from free,
// open data that needs no account or key:
//   terrain heights  Terrain Tiles on AWS (Tilezen/Mapzen: USGS 3DEP, SRTM and other public sources)
//   aerial photos    USGS The National Map, orthoimagery (public domain)
//   airports, VORs   OurAirports (public domain), packed per 1° square by tools/build-airports.mjs
//   taxiways, ramps  OpenStreetMap (© OpenStreetMap contributors, ODbL), asked for live and kept in the browser for 30 days
//   live weather     National Weather Service observations (api.weather.gov, public domain)
//   airspace         FAA Aeronautical Information Services open data (Class B–E and special use, public domain)
// The sim's frame is flat: x metres east and z metres south of the home airport, so north is -z, as in Zarhart Valley.

const R = 6378137, DEG = Math.PI / 180, FT = 0.3048;
export const ATTRIBUTION = "Terrain: Terrain Tiles on AWS (USGS 3DEP, SRTM) · Imagery: USGS The National Map · Airports: OurAirports · Taxiways: © OpenStreetMap contributors";
const DATA = new URL("../../data/airports/", import.meta.url).href;
const DEM = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const PHOTO = (z, x, y) => `https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/${z}/${y}/${x}`;

/** a flat local frame around (lat0, lon0): good to a few metres across 60 km */
export class GeoFrame {
  constructor(lat0, lon0) { this.lat0 = lat0; this.lon0 = lon0; this.kx = R * DEG * Math.cos(lat0 * DEG); this.kz = R * DEG; }
  toLocal(lat, lon) { return [(lon - this.lon0) * this.kx, -(lat - this.lat0) * this.kz]; }
  toGeo(x, z) { return [this.lat0 - z / this.kz, this.lon0 + x / this.kx]; }
}
/* Web Mercator pixel coordinates (256 px tiles) at a zoom level */
const mx = (lon, zoom) => ((lon + 180) / 360) * 256 * 2 ** zoom;
const my = (lat, zoom) => { const s = Math.sin(lat * DEG); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 256 * 2 ** zoom; };

/** run fn over items, n at a time, reporting progress */
async function pool(items, n, fn, progress) {
  let next = 0, done = 0;
  const worker = async () => { while (next < items.length) { const i = next++; await fn(items[i], i); done++; progress?.(done, items.length); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}
async function image(url, tries = 3) {
  for (let k = 0; k < tries; k++) {
    try {
      const r = await fetch(url, { mode: "cors" });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(r.status);
      return await createImageBitmap(await r.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
    } catch (err) { if (k === tries - 1) { console.warn("tile failed", url, err); return null; } await new Promise((res) => setTimeout(res, 400 * (k + 1))); }
  }
}
const canvas = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
/** the tile range that covers a local square [cx ± half, cz ± half] */
function tileRange(frame, cx, cz, half, zoom) {
  const [latN, lonW] = frame.toGeo(cx - half, cz - half), [latS, lonE] = frame.toGeo(cx + half, cz + half);
  return { x0: Math.floor(mx(lonW, zoom) / 256), x1: Math.floor(mx(lonE, zoom) / 256), y0: Math.floor(my(latN, zoom) / 256), y1: Math.floor(my(latS, zoom) / 256) };
}
const tilesOf = (t) => { const out = []; for (let y = t.y0; y <= t.y1; y++) for (let x = t.x0; x <= t.x1; x++) out.push([x, y]); return out; };

/**
 * Terrain heights over the square as a G × G grid (row 0 = the north edge), metres above sea level. The sea and bays,
 * which the source gives as depths, become flat water at 0 m.
 */
export async function loadHeights(frame, half, { zoom = 12, G = 1024, progress } = {}) {
  const t = tileRange(frame, 0, 0, half, zoom), W = (t.x1 - t.x0 + 1) * 256, H = (t.y1 - t.y0 + 1) * 256;
  const hm = new Float32Array(W * H).fill(NaN), c = canvas(256, 256), g = c.getContext("2d", { willReadFrequently: true });
  let got = 0;
  await pool(tilesOf(t), 8, async ([tx, ty]) => {
    const bmp = await image(DEM(zoom, tx, ty)); if (!bmp) return;
    g.clearRect(0, 0, 256, 256); g.drawImage(bmp, 0, 0); bmp.close?.(); const d = g.getImageData(0, 0, 256, 256).data; got++;
    const ox = (tx - t.x0) * 256, oy = (ty - t.y0) * 256;
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      const i = (y * 256 + x) * 4, h = d[i] * 256 + d[i + 1] + d[i + 2] / 256 - 32768;
      hm[(oy + y) * W + ox + x] = h > 9000 || h < -11000 ? NaN : h; // the source marks "no data" with impossible heights
    }
  }, progress);
  if (!got) throw new Error("couldn't download terrain heights (are you online?)");
  fillGaps(hm, W, H);
  const grid = new Float32Array(G * G), water = new Uint8Array(G * G), step = (2 * half) / (G - 1);
  const px0 = t.x0 * 256, py0 = t.y0 * 256;
  for (let j = 0; j < G; j++) {
    const [lat] = frame.toGeo(0, -half + j * step), fy = Math.min(H - 1.001, Math.max(0, my(lat, zoom) - py0 - 0.5)), y = fy | 0, ty = fy - y;
    for (let i = 0; i < G; i++) {
      const [, lon] = frame.toGeo(-half + i * step, 0), fx = Math.min(W - 1.001, Math.max(0, mx(lon, zoom) - px0 - 0.5)), x = fx | 0, tx = fx - x;
      const a = hm[y * W + x], b = hm[y * W + x + 1], cc = hm[(y + 1) * W + x], dd = hm[(y + 1) * W + x + 1];
      const h = (a * (1 - tx) + b * tx) * (1 - ty) + (cc * (1 - tx) + dd * tx) * ty;
      grid[j * G + i] = Math.max(0, h); water[j * G + i] = h < 0.5 ? 1 : 0;
    }
  }
  return { grid, water, G, half, step };
}

/** fill "no data" posts (and missing tiles) from their neighbours, growing inward; anything left takes the median height */
function fillGaps(hm, W, H) {
  let gaps = 0; for (let k = 0; k < hm.length; k++) if (Number.isNaN(hm[k])) gaps++;
  for (let pass = 0; gaps && pass < 24; pass++) {
    const fill = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = y * W + x; if (!Number.isNaN(hm[k])) continue;
      let sum = 0, n = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; const v = hm[yy * W + xx]; if (!Number.isNaN(v)) { sum += v; n++; } }
      if (n) fill.push(k, sum / n);
    }
    for (let i = 0; i < fill.length; i += 2) hm[fill[i]] = fill[i + 1];
    gaps -= fill.length / 2;
  }
  if (gaps) { const ok = Array.from(hm).filter((v) => !Number.isNaN(v)).sort((a, b) => a - b), med = ok[ok.length >> 1] || 0; for (let k = 0; k < hm.length; k++) if (Number.isNaN(hm[k])) hm[k] = med; }
}

/**
 * Aerial photos of the square [cx ± half, cz ± half] on a size × size canvas, north up. The tiles come in Web Mercator;
 * rows of constant latitude are straight in both projections, so each output row is copied from the matching mosaic row.
 */
export async function loadPhotos(frame, cx, cz, half, size, zoom, progress) {
  const t = tileRange(frame, cx, cz, half, zoom), W = (t.x1 - t.x0 + 1) * 256, H = (t.y1 - t.y0 + 1) * 256;
  const mosaic = canvas(W, H), mg = mosaic.getContext("2d"); mg.fillStyle = "#56603f"; mg.fillRect(0, 0, W, H);
  let got = 0;
  await pool(tilesOf(t), 8, async ([tx, ty]) => { const bmp = await image(PHOTO(zoom, tx, ty)); if (!bmp) return; mg.drawImage(bmp, (tx - t.x0) * 256, (ty - t.y0) * 256); bmp.close?.(); got++; }, progress);
  if (!got) return null;
  const out = canvas(size, size), og = out.getContext("2d"); og.imageSmoothingQuality = "high";
  const [, lonW] = frame.toGeo(cx - half, 0), [, lonE] = frame.toGeo(cx + half, 0), sx = mx(lonW, zoom) - t.x0 * 256, sw = mx(lonE, zoom) - mx(lonW, zoom);
  const band = 4;
  for (let r = 0; r < size; r += band) {
    const z0 = cz - half + (r / size) * 2 * half, z1 = cz - half + ((r + band) / size) * 2 * half;
    const y0 = my(frame.toGeo(0, z0)[0], zoom) - t.y0 * 256, y1 = my(frame.toGeo(0, z1)[0], zoom) - t.y0 * 256;
    og.drawImage(mosaic, sx, y0, sw, Math.max(0.5, y1 - y0), 0, r, size, band);
  }
  mosaic.width = mosaic.height = 0; // free it now
  return out;
}

/* ---------- airports ---------- */
function rwy(ids, cx, cz, hdg, len, wid, surface, extra = {}) {
  const d = [Math.sin(hdg * DEG), -Math.cos(hdg * DEG)];
  return { ids, cx, cz, hdg, len, wid, surface, ...extra, dir: d,
    ends: [{ id: ids[0], x: cx - d[0] * len / 2, z: cz - d[1] * len / 2, hdg }, { id: ids[1], x: cx + d[0] * len / 2, z: cz + d[1] * len / 2, hdg: (hdg + 180) % 360 }] };
}
const rect = (cx, cz, hdg, len, wid, surface = "asphalt") => ({ cx, cz, hdg, len, wid, surface });
/** what a controller calls the field: "Palo Alto Airport of Santa Clara County" → "Palo Alto" */
export function callName(name) {
  const short = name.replace(/\b(Airport|Airfield|Air ?park|Field|International|Intl|Regional|Municipal|Muni|County|Memorial|Executive|Jetport|Air Terminal|Airstrip|Landing Strip|Strip|Heliport)\b.*$/i, "").replace(/[\s,/-]+$/, "").trim();
  return short || name;
}
/** the sim's airport record (the same shape as Zarhart Valley's) from an OurAirports one */
function toSim(a, frame) {
  const [x, z] = frame.toLocal(a.lat, a.lon), f = a.freqs || {};
  const runways = a.rwys.map(([le, he, la1, lo1, la2, lo2, lenFt, widFt, surface, lit, d1, d2]) => {
    const [x1, z1] = frame.toLocal(la1, lo1), [x2, z2] = frame.toLocal(la2, lo2);
    const hdg = ((Math.atan2(x2 - x1, -(z2 - z1)) / DEG) + 360) % 360, len = Math.max(lenFt * FT, Math.hypot(x2 - x1, z2 - z1) * 0.9);
    const displaced = d1 || d2 ? { [le]: d1 * FT, [he]: d2 * FT } : undefined;
    return rwy([le, he], (x1 + x2) / 2, (z1 + z2) / 2, hdg, len, Math.max(8, widFt * FT), surface, { lights: !!lit, displaced });
  }).sort((p, q) => q.len - p.len);
  const towered = !!f.twr, main = runways[0];
  const spawn = {};
  for (const r of runways) for (const e of r.ends) {
    const k = e === r.ends[0] ? 1 : -1, back = 25 + (r.displaced?.[e.id] || 0);
    spawn[`rwy${e.id}`] = { x: e.x + r.dir[0] * k * back, z: e.z + r.dir[1] * k * back, hdg: e.hdg };
  }
  spawn.start = spawn[`rwy${main.ids[0]}`]; spawn.ramp = spawn.start;
  const side = main.wid / 2 + 70, wx = main.cx - main.dir[1] * side, wz = main.cz + main.dir[0] * side; // a windsock beside the main runway
  const ap = {
    id: a.id, local: a.local, name: a.name, city: a.city, state: a.state, real: true, lat: a.lat, lon: a.lon,
    call: a.city && a.name.toLowerCase().startsWith(a.city.toLowerCase()) ? a.city : callName(a.name), // "Aspen-Pitkin County Airport" in Aspen: "Aspen Tower"
    x, z, towered, size: a.size,
    calmRwy: main.ids[0], pcl: !towered && main.lights,
    freqs: Object.fromEntries(Object.entries({ atis: f.atis, twr: f.twr, gnd: f.gnd, ctaf: towered ? undefined : f.ctaf || f.unicom || 122.9, awos: f.awos, app: f.app, appName: f.appName }).filter(([, v]) => v)),
    runways, taxiways: [], aprons: [], holdShort: [], rwyHold: [], windsock: { x: wx, z: wz }, hangars: [], parked: [], spawn,
    elevFt: Math.round(a.elev), elev: a.elev * FT,
  };
  ap.flat = runways.map((r) => rect(r.cx, r.cz, r.hdg, r.len, r.wid));
  ap.reach = reachOf(ap);
  return ap;
}

let indexCache = null;
/** the search list: [ident, local code, name, city, state, lat, lon] for every airport */
export async function airportIndex() {
  if (!indexCache) indexCache = fetch(DATA + "index.json").then((r) => r.json());
  return indexCache;
}
export async function findAirport(q) {
  const k = q.trim().toUpperCase(); if (!k) return null;
  const idx = await airportIndex();
  return idx.find((e) => e[0] === k) || idx.find((e) => e[1] === k) || idx.find((e) => e[0] === "K" + k) || null;
}

/**
 * Everything the sim needs for a real airport: { frame, airports (home first), navaids, airspace, heights, variation }.
 * progress(text) reports what it's downloading.
 */
export async function loadRealWorld(ident, { half = 30000, demZoom = 12, grid = 1024, progress = () => {} } = {}) {
  progress("Finding " + ident);
  const e = await findAirport(ident); if (!e) throw new Error(`no US airport with runways called ${ident}`);
  const frame = new GeoFrame(e[5], e[6]);
  // the 1° squares around the home field (VORs are useful from farther away than the square we draw)
  const reach = (half + 60000) / (R * DEG), cells = [];
  for (let la = Math.floor(e[5] - reach); la <= Math.floor(e[5] + reach); la++) for (let lo = Math.floor(e[6] - reach / Math.cos(e[5] * DEG)); lo <= Math.floor(e[6] + reach / Math.cos(e[5] * DEG)); lo++) cells.push(`${la}_${lo}`);
  progress("Loading airports");
  const parts = await Promise.all(cells.map((c) => fetch(DATA + c + ".json").then((r) => (r.ok ? r.json() : { airports: [], navaids: [] })).catch(() => ({ airports: [], navaids: [] }))));
  const all = parts.flatMap((p) => p.airports), home = all.find((a) => a.id === e[0]);
  if (!home) throw new Error(`no runway data for ${ident}`);
  const inside = (a) => { const [x, z] = frame.toLocal(a.lat, a.lon); return Math.abs(x) < half - 1500 && Math.abs(z) < half - 1500; };
  const airports = [home, ...all.filter((a) => a !== home && inside(a))].map((a) => toSim(a, frame));
  const navaids = parts.flatMap((p) => p.navaids).map((n) => { const [x, z] = frame.toLocal(n.lat, n.lon); return { id: n.id, name: n.name, type: n.type, freq: n.freq, x, z, var: n.var }; })
    .filter((n) => Math.hypot(n.x, n.z) < half + 60000);
  // magnetic variation from the nearest VOR (east is positive)
  const near = [...navaids].sort((p, q) => Math.hypot(p.x, p.z) - Math.hypot(q.x, q.z))[0];
  // airspace: the FAA's real shapes; if they can't be had, towered fields get an approximate Class D cylinder (big ones Class C)
  const realAirspace = loadAirspace(frame, half);
  const approx = () => airports.filter((a) => a.towered).map((a) => a.size === "L"
    ? { id: `${a.id}-C`, name: `${a.call} Class C (approximate)`, cls: "C", x: a.x, z: a.z, r: 9260, floorFt: 0, ceilFt: Math.round((a.elevFt + 4000) / 100) * 100 }
    : { id: `${a.id}-D`, name: `${a.call} Class D (approximate)`, cls: "D", x: a.x, z: a.z, r: 7780, floorFt: 0, ceilFt: Math.round((a.elevFt + 2500) / 100) * 100 }).map((x) => ({ ...x, approx: true }));
  const detail = loadAirportDetail(frame, airports); // taxiways and ramps arrive whenever OpenStreetMap answers (often while the terrain loads)
  const heights = await loadHeights(frame, half, { zoom: demZoom, G: grid, progress: (d, n) => progress(`Downloading real terrain (${d}/${n})`) });
  const airspace = (await realAirspace) || approx();
  return { frame, airports, navaids, airspace, heights, variation: near?.var ?? 0, half, detail };
}

/* ---------- taxiways, ramps and buildings (OpenStreetMap) ---------- */
// public Overpass servers, run by volunteers: asked one after another, not all at once
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
/**
 * The first answer from a list of servers: the first is asked at once, and the next joins when the one before fails or
 * hasn't answered within `stagger` ms. Each gets up to `cap` ms; the others are cancelled when one answers. null if none do.
 */
function firstAnswer(asks, stagger = 12000, cap = 60000) {
  return new Promise((resolve) => {
    const ctl = asks.map(() => new AbortController()); let next = 0, failed = 0, done = false, timer = null;
    const finish = (v) => { if (done) return; done = true; clearTimeout(timer); ctl.forEach((c) => c.abort()); resolve(v); };
    const start = () => {
      if (done || next >= asks.length) return;
      const i = next++, kill = setTimeout(() => ctl[i].abort(), cap);
      clearTimeout(timer); timer = setTimeout(start, stagger);
      asks[i](ctl[i].signal).then(finish, () => { clearTimeout(kill); if (++failed === asks.length) finish(null); else if (i === next - 1) start(); });
    };
    start();
  });
}
/** how far an airport's paved surfaces reach from its reference point (m): the area physics checks for runways and ramps */
function reachOf(ap) {
  let r = 0;
  for (const f of [...ap.flat, ...ap.taxiways]) r = Math.max(r, Math.hypot(f.cx - ap.x, f.cz - ap.z) + f.len / 2 + f.wid);
  for (const poly of ap.apronPolys || []) for (const [x, z] of poly) r = Math.max(r, Math.hypot(x - ap.x, z - ap.z));
  return Math.max(1400, r + 100);
}
const area = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length]; a += x1 * z2 - x2 * z1; } return Math.abs(a) / 2; };
export function inPoly(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, zi] = pts[i], [xj, zj] = pts[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside; }
  return inside;
}

/** a tiny key-value store in IndexedDB (the browser's database), for answers worth keeping between visits */
function kv(op, key, value) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("zarhart", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("kv");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction("kv", op === "get" ? "readonly" : "readwrite"), store = tx.objectStore("kv");
      const req = op === "get" ? store.get(key) : store.put(value, key);
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); tx.oncomplete = () => db.close();
    };
  });
}
/**
 * Asks OpenStreetMap (Overpass API) for the taxiways, taxilanes, ramps, hangars, terminals, windsocks and parking spots
 * around every airport in the square, in one request. Resolves to { [airport id]: detail } or null if it can't be had.
 */
async function loadAirportDetail(frame, airports) {
  const box = (ap) => {
    const R = Math.max(...ap.runways.map((r) => r.len / 2)) + 800, [n, w] = frame.toGeo(ap.x - R, ap.z - R), [s, e] = frame.toGeo(ap.x + R, ap.z + R);
    return `(${s.toFixed(5)},${w.toFixed(5)},${n.toFixed(5)},${e.toFixed(5)})`;
  };
  const q = `[out:json][timeout:90];(${airports.map((ap) => { const b = box(ap); return `way["aeroway"~"^(taxiway|taxilane|apron|hangar|terminal)$"]${b};way["building"="hangar"]${b};node["aeroway"~"^(windsock|parking_position)$"]${b};`; }).join("")});out geom qt;`;
  const key = `osm1:${airports.map((a) => a.id).join("-")}`;
  let data = null;
  try { const hit = await kv("get", key); if (hit && Date.now() - hit.saved < 30 * 864e5) data = hit.data; } catch { /* no IndexedDB here */ }
  if (!data) {
    const body = "data=" + encodeURIComponent(q), headers = { "Content-Type": "application/x-www-form-urlencoded" };
    data = await firstAnswer(OVERPASS.map((url) => (signal) => fetch(url, { method: "POST", body, headers, signal }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))));
    if (!data) return null;
    try { await kv("put", key, { saved: Date.now(), data }); } catch { /* fine without */ }
  }
  const out = Object.fromEntries(airports.map((a) => [a.id, { taxiways: [], aprons: [], buildings: [], windsocks: [], parking: [] }]));
  const owner = (x, z) => { let best = null, bd = Infinity; for (const a of airports) { const d = Math.hypot(a.x - x, a.z - z); if (d < bd && d < Math.max(...a.runways.map((r) => r.len / 2)) + 1200) { bd = d; best = a; } } return best; };
  for (const el of data.elements || []) {
    const t = el.tags || {};
    if (el.type === "node") { const [x, z] = frame.toLocal(el.lat, el.lon), a = owner(x, z); if (!a) continue; (t.aeroway === "windsock" ? out[a.id].windsocks : out[a.id].parking).push({ x, z, ref: t.ref }); continue; }
    if (!el.geometry || el.geometry.length < 2) continue;
    const pts = el.geometry.map((g) => frame.toLocal(g.lat, g.lon)), cx = pts.reduce((v, p) => v + p[0], 0) / pts.length, cz = pts.reduce((v, p) => v + p[1], 0) / pts.length, a = owner(cx, cz);
    if (!a) continue;
    const d = out[a.id], closed = pts.length > 3 && Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]) < 0.5;
    if (t.aeroway === "taxiway" || t.aeroway === "taxilane") {
      const w = parseFloat(t.width), lane = t.aeroway === "taxilane";
      d.taxiways.push({ pts, ref: t.ref || "", lane, wid: w > 3 && w < 60 ? w : lane ? 7.5 : { L: 23, M: 15 }[a.size] || 10.5, grass: /grass|dirt|ground|gravel/.test(t.surface || "") });
    } else if (closed && t.aeroway === "apron") d.aprons.push(pts.slice(0, -1));
    else if (closed) { const h = parseFloat(t.height) || (parseFloat(t["building:levels"]) * 3.5) || (t.aeroway === "terminal" ? 9 : 8); d.buildings.push({ pts: pts.slice(0, -1), h: Math.min(40, h), kind: t.aeroway === "terminal" ? "terminal" : "hangar" }); }
  }
  return out;
}

/** a point on the nearest runway's centreline, and how far along and across it a point lies */
function across(r, x, z) { const t = (x - r.cx) * r.dir[0] + (z - r.cz) * r.dir[1], s = (x - r.cx) * -r.dir[1] + (z - r.cz) * r.dir[0]; return { t, s }; }
const strip = (id) => id.replace(/^0/, "");
/** "13-31" written so the runway whose threshold is on your left comes first, for someone at h facing (fx, fz) (AIM 2-3-8) */
function signFor(h, r, fx, fz) { const [e0, e1] = r.ends, e0Right = (e0.x - h.x) * -fz + (e0.z - h.z) * fx > 0; return e0Right ? `${strip(e1.id)}-${strip(e0.id)}` : `${strip(e0.id)}-${strip(e1.id)}`; }

/**
 * Puts an airport's OpenStreetMap detail into its sim record: taxiway segments (as the oriented rectangles the sim uses),
 * ramp outlines, buildings, the windsock, a ramp start at a parking spot, and hold-short lines where each taxiway
 * reaches the holding distance from a runway (125 ft from the centreline at small fields, 200 ft at medium, 250 ft at
 * large ones). flatten: also level the ground under them (only before the terrain is built).
 */
export function applyAirportDetail(ap, d, flatten) {
  if (!d || ap.detail) return false;
  const segs = [];
  for (const tw of d.taxiways) for (let i = 0; i < tw.pts.length - 1; i++) {
    const [x1, z1] = tw.pts[i], [x2, z2] = tw.pts[i + 1], len = Math.hypot(x2 - x1, z2 - z1); if (len < 0.5) continue;
    const hdg = ((Math.atan2(x2 - x1, -(z2 - z1)) / DEG) + 360) % 360;
    segs.push({ ...rect((x1 + x2) / 2, (z1 + z2) / 2, hdg, len + tw.wid, tw.wid, tw.grass ? "grass" : "asphalt"), name: tw.ref, lane: tw.lane, line: len });
  }
  ap.taxiways = segs; ap.apronPolys = d.aprons; ap.buildings = d.buildings; ap.taxiLines = d.taxiways; ap._graph = null;
  if (d.windsocks.length) { const r = ap.runways[0]; ap.windsock = d.windsocks.sort((p, q) => Math.hypot(p.x - r.cx, p.z - r.cz) - Math.hypot(q.x - r.cx, q.z - r.cz))[0]; }
  // hold-short lines
  const dist = { L: 76, M: 61 }[ap.size] || 38, holds = [];
  for (const tw of d.taxiways) {
    if (tw.lane) continue;
    for (let i = 0; i < tw.pts.length - 1; i++) for (const r of ap.runways) {
      const a = across(r, ...tw.pts[i]), b = across(r, ...tw.pts[i + 1]), P = tw.pts[i], Qp = tw.pts[i + 1];
      for (const side of [1, -1]) { // the holding line on each side of the runway, wherever this segment crosses it
        const up = side * a.s - dist, uq = side * b.s - dist; if ((up > 0) === (uq > 0)) continue;
        const k = up / (up - uq), x = P[0] + (Qp[0] - P[0]) * k, z = P[1] + (Qp[1] - P[1]) * k, t = a.t + (b.t - a.t) * k;
        if (Math.abs(t) > r.len / 2 + 80 || holds.some((h) => Math.hypot(h.x - x, h.z - z) < 25)) continue;
        const fx = side * r.dir[1], fz = -side * r.dir[0]; // facing the runway
        holds.push({ x, z, hdg: ((Math.atan2(fx, -fz) / DEG) + 360) % 360, sign: signFor({ x, z }, r, fx, fz), twy: tw.ref || "" });
      }
    }
  }
  ap.holdShort = holds;
  // a ramp start: the parking spot nearest the field's reference point that isn't on a runway, facing the nearest taxiway
  const onRunway = (x, z) => ap.runways.some((r) => Math.abs(across(r, x, z).s) < r.wid / 2 + 40 && Math.abs(across(r, x, z).t) < r.len / 2 + 60);
  const offRunway = d.parking.filter((p) => !onRunway(p.x, p.z)), onRamp = offRunway.filter((p) => d.aprons.some((poly) => inPoly(p.x, p.z, poly)));
  const spots = onRamp.length ? onRamp : offRunway; // a spot on a mapped ramp, if there is one
  ap.parking = spots.map((p) => ({ x: p.x, z: p.z }));
  let ramp = spots.sort((p, q) => Math.hypot(p.x - ap.x, p.z - ap.z) - Math.hypot(q.x - ap.x, q.z - ap.z))[0];
  if (!ramp && d.aprons.length) { const big = [...d.aprons].sort((p, q) => area(q) - area(p))[0]; ramp = { x: big.reduce((v, p) => v + p[0], 0) / big.length, z: big.reduce((v, p) => v + p[1], 0) / big.length }; if (onRunway(ramp.x, ramp.z)) ramp = null; }
  if (ramp) {
    const tw = segs.filter((t) => !t.lane).sort((p, q) => Math.hypot(p.cx - ramp.x, p.cz - ramp.z) - Math.hypot(q.cx - ramp.x, q.cz - ramp.z))[0];
    const hdg = tw ? ((Math.atan2(tw.cx - ramp.x, -(tw.cz - ramp.z)) / DEG) + 360) % 360 : ap.runways[0].hdg;
    ap.spawn.ramp = { x: ramp.x, z: ramp.z, hdg }; ap.hasRamp = true;
  }
  if (flatten) {
    ap.flat.push(...segs.map((t) => rect(t.cx, t.cz, t.hdg, t.len, t.wid)));
    for (const poly of [...d.aprons, ...d.buildings.map((b) => b.pts)]) {
      const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
      ap.flat.push(rect((x0 + x1) / 2, (z0 + z1) / 2, 0, z1 - z0, x1 - x0));
    }
  }
  ap.flattened = !!flatten; ap.detail = true; ap.reach = reachOf(ap);
  return true;
}

/* ---------- live weather (National Weather Service) ---------- */
/**
 * A METAR as the sim's weather settings: "KPAO 020147Z 28007KT 10SM SKC 15/09 A3003" →
 * { windDir, windKt, gustKt, turb, visSM, clouds, tempC, dewC, qnhInHg, precip, precipRate }. Winds are true, as in a METAR.
 */
export function parseMetar(raw) {
  const p = { windDir: 0, windKt: 0, gustKt: 0, visSM: 10, clouds: [], tempC: 15, dewC: 5, qnhInHg: 29.92 };
  let thunder = false, whole = null;
  const tokens = raw.trim().split(/\s+/), end = tokens.indexOf("RMK");
  for (const w of end < 0 ? tokens : tokens.slice(0, end)) {
    let m;
    if ((m = /^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS)$/.exec(w))) { const k = m[4] === "MPS" ? 1.944 : 1; p.windDir = m[1] === "VRB" ? 0 : +m[1]; p.windKt = Math.round(+m[2] * k); p.gustKt = m[3] ? Math.round(+m[3] * k) : 0; }
    else if (/^\d$/.test(w)) whole = +w; // "1" of "1 1/2SM"
    else if ((m = /^[MP]?(\d+)(?:\/(\d+))?SM$/.exec(w))) { p.visSM = (m[2] ? +m[1] / +m[2] : +m[1]) + (m[2] && whole ? whole : 0); whole = null; }
    else if ((m = /^(FEW|SCT|BKN|OVC|VV)(\d{3})/.exec(w))) { if (p.clouds.length < 3) p.clouds.push({ cover: m[1] === "VV" ? "OVC" : m[1], baseFt: Math.max(100, +m[2] * 100) }); }
    else if ((m = /^(M?\d{2})\/(M?\d{2})?$/.exec(w))) { const c = (v) => (v.startsWith("M") ? -1 : 1) * +v.replace("M", ""); p.tempC = c(m[1]); p.dewC = m[2] ? c(m[2]) : p.tempC - 5; }
    else if ((m = /^A(\d{4})$/.exec(w))) p.qnhInHg = +m[1] / 100;
    else if ((m = /^Q(\d{4})$/.exec(w))) p.qnhInHg = Math.round((+m[1] / 33.8639) * 100) / 100;
    else if ((m = /^([-+]?)(MI|PR|BC|DR|BL|SH|TS|FZ)*((DZ|RA|SN|SG|IC|PL|GR|GS|UP)+)$/.exec(w))) { // weather in progress at the field (not "VC", in the vicinity)
      const rate = m[1] === "-" ? 0.35 : m[1] === "+" ? 0.95 : 0.65, kind = /FZ/.test(w) ? "fzra" : /SN|SG|PL|IC/.test(m[3]) ? "snow" : "rain";
      if (!p.precip || rate > p.precipRate) { p.precip = kind; p.precipRate = rate; }
      if (/TS/.test(w)) thunder = true;
    } else if (/^[-+]?TS$/.test(w)) thunder = true;
  }
  p.turb = Math.min(0.7, 0.05 + 0.012 * p.windKt + 0.02 * Math.max(0, p.gustKt - p.windKt) + (thunder ? 0.2 : 0));
  if (p.precip === "snow") p.snowCover = true;
  return p;
}
const NWS = "https://api.weather.gov";
async function latestObs(station) {
  const r = await fetch(`${NWS}/stations/${station}/observations/latest`, { headers: { Accept: "application/geo+json" } });
  if (!r.ok) return null;
  const o = (await r.json()).properties, age = (Date.now() - Date.parse(o.timestamp)) / 60000;
  return o.rawMessage && age < 180 ? { raw: o.rawMessage, station, ageMin: Math.round(age) } : null;
}
/**
 * The real weather at an airport now: its own latest observation, or the nearest station's that has one in the last three
 * hours. { params (the sim's weather settings), raw (the METAR), station, ageMin } or null.
 */
export async function loadLiveWeather(ap) {
  try {
    let obs = /^[A-Z]{4}$/.test(ap.id) ? await latestObs(ap.id).catch(() => null) : null;
    if (!obs) {
      const r = await fetch(`${NWS}/points/${ap.lat.toFixed(4)},${ap.lon.toFixed(4)}/stations`, { headers: { Accept: "application/geo+json" } });
      if (r.ok) for (const f of ((await r.json()).features || []).slice(0, 4)) { obs = await latestObs(f.properties.stationIdentifier).catch(() => null); if (obs) break; }
    }
    if (!obs) return null;
    const params = parseMetar(obs.raw);
    return { ...obs, params: { ...params, live: true, label: `Live weather: ${obs.station} METAR, ${obs.ageMin} min old` } };
  } catch { return null; }
}

/* ---------- airspace (FAA) ---------- */
const FAA = "https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services";
const title = (t) => t.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bClass ([a-e])\b/gi, (m, c) => `Class ${c.toUpperCase()}`).replace(/\bMoa\b/, "MOA");
/** feet and whether they're above the ground: (3000, FT, MSL) → [3000, false]; (700, FT, SFC) → [700, true]; FL180 → [18000, false] */
const level = (v, uom, code) => (v == null || v === -9998 || code === "UNLTD" ? [null, false] : [uom === "FL" ? v * 100 : v, code === "SFC"]);
/**
 * The FAA's airspace over the square: Class B, C, D and E shapes and special use airspace (prohibited, restricted,
 * warning, alert areas and MOAs), as polygons in the sim's frame, simplified to about 30 m. null if it can't be had.
 */
async function loadAirspace(frame, half) {
  const [latN, lonW] = frame.toGeo(-half - 5000, -half - 5000), [latS, lonE] = frame.toGeo(half + 5000, half + 5000);
  const q = (layer, fields, where) => fetch(`${FAA}/${layer}/FeatureServer/0/query?where=${encodeURIComponent(where)}&geometry=${lonW.toFixed(4)},${latS.toFixed(4)},${lonE.toFixed(4)},${latN.toFixed(4)}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=${fields}&returnGeometry=true&outSR=4326&maxAllowableOffset=0.0003&geometryPrecision=5&f=geojson`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))));
  try {
    const cut = new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 9000));
    const [cls, sua] = await Promise.race([Promise.all([
      q("Class_Airspace", "NAME,CLASS,LOCAL_TYPE,LOWER_VAL,LOWER_UOM,LOWER_CODE,UPPER_VAL,UPPER_UOM,UPPER_CODE", "CLASS<>'A'"),
      q("Special_Use_Airspace", "NAME,TYPE_CODE,LOWER_VAL,LOWER_UOM,LOWER_CODE,UPPER_VAL,UPPER_UOM,UPPER_CODE", "1=1"),
    ]), cut]);
    const out = [], SUA = { P: "P", R: "R", MOA: "MOA", W: "W", A: "ALERT" };
    const add = (f, kind) => {
      const p = f.properties, cl = kind === "class" ? p.CLASS : SUA[p.TYPE_CODE]; if (!cl || !f.geometry) return;
      const polys = f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [f.geometry.coordinates];
      const [floorFt, floorAgl] = level(p.LOWER_VAL, p.LOWER_UOM, p.LOWER_CODE), [ceilFt, ceilAgl] = level(p.UPPER_VAL, p.UPPER_UOM, p.UPPER_CODE);
      polys.forEach((rings, k) => {
        const [outer, ...holes] = rings.map((ring) => ring.map(([lon, lat]) => frame.toLocal(lat, lon)));
        if (!outer || outer.length < 4) return;
        const xs = outer.map((v) => v[0]), zs = outer.map((v) => v[1]);
        out.push({ id: `${p.NAME}#${out.length}`, name: title(p.NAME), cls: cl, type: p.LOCAL_TYPE || p.TYPE_CODE, poly: outer, holes, bbox: [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)], floorFt: floorFt ?? 0, floorAgl, ceilFt, ceilAgl, part: k });
      });
    };
    for (const f of cls.features || []) add(f, "class");
    for (const f of sua.features || []) add(f, "sua");
    return out.length ? out : null;
  } catch (err) { console.warn("FAA airspace:", err.message); return null; }
}

/* ---------- taxi routes ---------- */
/** the taxiway network: OpenStreetMap's taxiway lines share their points where they meet */
function taxiGraph(ap) {
  if (ap._graph) return ap._graph;
  const nodes = new Map(), node = (x, z) => { const k = `${Math.round(x * 2)},${Math.round(z * 2)}`; let n = nodes.get(k); if (!n) nodes.set(k, (n = { x, z, edges: [] })); return n; };
  for (const tw of ap.taxiLines || []) for (let i = 0; i < tw.pts.length - 1; i++) {
    const a = node(...tw.pts[i]), b = node(...tw.pts[i + 1]), len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 0.1) continue;
    const cost = len * (tw.lane ? 1.3 : 1); // keep to the taxiways rather than wander between hangars
    a.edges.push({ to: b, cost, ref: tw.ref, lane: tw.lane }); b.edges.push({ to: a, cost, ref: tw.ref, lane: tw.lane });
  }
  return (ap._graph = [...nodes.values()]);
}
/** a binary heap of [cost, node] for the route search */
class Heap {
  constructor() { this.a = []; }
  push(v) { const a = this.a; a.push(v); let i = a.length - 1; while (i) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
    return top;
  }
  get size() { return this.a.length; }
}
/**
 * The shortest way along the taxiways from one point to another: { pts: [{ x, z }], via: ["B", "A"] } (the taxiways'
 * names in order, as Ground would read them), or null when the network doesn't connect them.
 */
export function taxiRoute(ap, from, to) {
  const g = taxiGraph(ap); if (g.length < 2) return null;
  const near = (p) => { let best = null, bd = Infinity; for (const n of g) { const d = Math.hypot(n.x - p.x, n.z - p.z); if (d < bd) { bd = d; best = n; } } return best; };
  const s = near(from), t = near(to), cost = new Map([[s, 0]]), prev = new Map(), heap = new Heap();
  heap.push([0, s]);
  while (heap.size) {
    const [c, n] = heap.pop(); if (n === t) break; if (c > cost.get(n)) continue;
    for (const e of n.edges) { const nc = c + e.cost; if (nc < (cost.get(e.to) ?? Infinity)) { cost.set(e.to, nc); prev.set(e.to, { n, ref: e.ref, lane: e.lane }); heap.push([nc, e.to]); } }
  }
  if (!prev.has(t) && s !== t) return null;
  const pts = [], refs = [];
  for (let n = t; n; n = prev.get(n)?.n) { pts.push({ x: n.x, z: n.z }); const p = prev.get(n); if (p?.ref) refs.push({ ref: p.ref, lane: p.lane }); }
  pts.reverse(); refs.reverse();
  // fewer points: drop the ones where the route runs straight on
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1], b = pts[i], c = pts[i + 1], h1 = Math.atan2(b.x - a.x, b.z - a.z), h2 = Math.atan2(c.x - b.x, c.z - b.z);
    if (Math.abs(((h2 - h1 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) > 0.12 || Math.hypot(b.x - a.x, b.z - a.z) > 150) out.push(b);
  }
  if (pts.length > 1) out.push(pts[pts.length - 1]);
  // controllers name the taxiways, not the taxilanes between hangars
  const named = (refs.some((r) => !r.lane) ? refs.filter((r) => !r.lane) : refs).map((r) => r.ref);
  return { pts: out, via: named.filter((r, i) => r !== named[i - 1]) };
}
