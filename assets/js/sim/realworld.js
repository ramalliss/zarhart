// Real World mode: a 60 × 60 km piece of the United States around a chosen airport, built in the browser from free,
// open data that needs no account or key:
//   terrain heights  Terrain Tiles on AWS (Tilezen/Mapzen: USGS 3DEP, SRTM and other public sources)
//   aerial photos    USGS The National Map, orthoimagery (public domain)
//   airports, VORs   OurAirports (public domain), packed per 1° square by tools/build-airports.mjs
// The sim's frame is flat: x metres east and z metres south of the home airport, so north is -z, as in Zarhart Valley.

const R = 6378137, DEG = Math.PI / 180, FT = 0.3048;
export const ATTRIBUTION = "Terrain: Terrain Tiles on AWS (USGS 3DEP, SRTM) · Imagery: USGS The National Map · Airports: OurAirports";
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
    id: a.id, local: a.local, name: a.name, city: a.city, state: a.state, call: callName(a.name), real: true, x, z, towered, size: a.size,
    calmRwy: main.ids[0], pcl: !towered && main.lights,
    freqs: Object.fromEntries(Object.entries({ atis: f.atis, twr: f.twr, gnd: f.gnd, ctaf: towered ? undefined : f.ctaf || f.unicom || 122.9, awos: f.awos, app: f.app }).filter(([, v]) => v)),
    runways, taxiways: [], aprons: [], holdShort: [], rwyHold: [], windsock: { x: wx, z: wz }, hangars: [], parked: [], spawn,
    elevFt: Math.round(a.elev), elev: a.elev * FT,
  };
  ap.flat = runways.map((r) => rect(r.cx, r.cz, r.hdg, r.len, r.wid));
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
  // airspace, approximately: towered fields get a Class D cylinder, big towered ones Class C. Check the sectional for the real shapes.
  const airspace = airports.filter((a) => a.towered).map((a) => a.size === "L"
    ? { id: `${a.id}-C`, name: `${a.call} Class C (approximate)`, cls: "C", x: a.x, z: a.z, r: 9260, floorFt: 0, ceilFt: Math.round((a.elevFt + 4000) / 100) * 100 }
    : { id: `${a.id}-D`, name: `${a.call} Class D (approximate)`, cls: "D", x: a.x, z: a.z, r: 7780, floorFt: 0, ceilFt: Math.round((a.elevFt + 2500) / 100) * 100 });
  const heights = await loadHeights(frame, half, { zoom: demZoom, G: grid, progress: (d, n) => progress(`Downloading real terrain (${d}/${n})`) });
  return { frame, airports, navaids, airspace, heights, variation: near?.var ?? 0, half };
}
