// Sectional-style map renderer (used by the MFD and the full-screen VFR map).
import { WORLD_HALF, AIRPORTS, NAVAIDS, AIRSPACE, TOWNS, RIVER, HIGHWAY, RAILROAD, OBSTACLES, LAUNCH, heightAt, inLake } from "./world-data.js";
import { FT } from "./fdm.js";

const NM = 1852, DEG = Math.PI / 180;
const BLUE = "#2459b5", MAG = "#b12f86", INK = "#1f2329";

export function buildSectionalBase(size = 1024) {
  const c = document.createElement("canvas"); c.width = c.height = size;
  const g = c.getContext("2d"); const img = g.createImageData(size, size); const d = img.data;
  const W = WORLD_HALF * 2, step = W / size;
  const tints = [[0, [207, 227, 183]], [800, [222, 232, 182]], [1500, [238, 232, 176]], [2500, [242, 220, 162]], [4000, [232, 196, 140]], [6000, [214, 170, 118]]];
  const H = new Float32Array(size * size);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) H[j * size + i] = heightAt(-WORLD_HALF + (i + 0.5) * step, -WORLD_HALF + (j + 0.5) * step) / FT;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const x = -WORLD_HALF + (i + 0.5) * step, z = -WORLD_HALF + (j + 0.5) * step;
    const h = H[j * size + i];
    let col = tints[0][1]; for (const [lim, cc] of tints) if (h >= lim) col = cc;
    const hx = H[j * size + Math.min(size - 1, i + 1)] - H[j * size + Math.max(0, i - 1)], hz = H[Math.min(size - 1, j + 1) * size + i] - H[Math.max(0, j - 1) * size + i];
    const shade = Math.max(0.72, Math.min(1.12, 1 - (hx + hz) / (step / FT) * 0.35));
    let [r, gg, b] = col;
    if (inLake(x, z)) { r = 160; gg = 208; b = 236; }
    else { r *= shade; gg *= shade; b *= shade; }
    const o = (j * size + i) * 4; d[o] = r; d[o + 1] = gg; d[o + 2] = b; d[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const s = size / W, P = (x, z) => [(x + WORLD_HALF) * s, (z + WORLD_HALF) * s];
  const poly = (pts, w, col, dash) => { g.beginPath(); pts.forEach(([x, z], k) => { const [a, b] = P(x, z); k ? g.lineTo(a, b) : g.moveTo(a, b); }); g.lineWidth = w; g.strokeStyle = col; g.setLineDash(dash || []); g.stroke(); g.setLineDash([]); };
  for (const t of TOWNS) { const [a, b] = P(t.x, t.z); g.beginPath(); for (let k = 0; k <= 24; k++) { const an = (k / 24) * Math.PI * 2; const rr = t.r * s * (0.8 + 0.2 * Math.sin(an * 3 + t.x)); g.lineTo(a + Math.cos(an) * rr, b + Math.sin(an) * rr); } g.fillStyle = "#f6dc6a"; g.fill(); g.lineWidth = 1; g.strokeStyle = "#8e7a2a"; g.stroke(); }
  poly(RIVER.pts, 2.2, "#3e8fd6");
  poly(HIGHWAY.pts, 2.4, "#6c4d55"); poly(HIGHWAY.pts, 0.8, "#f4e7e7");
  poly(RAILROAD.pts, 1.4, "#222"); poly(RAILROAD.pts, 4, "#222", [1, 7]);
  return c;
}

/**
 * Draw the map into rect (x,y,w,h).
 * opts: { base, cx, cz (world centre), rangeNm (centre to edge), own: {x,z,hdg}, route: [{x,z,id}], style: 'sectional'|'mfd', vfrNight }
 * Returns a function screen->world for click handling.
 */
export function drawMap(g, x, y, w, h, o) {
  const s = (Math.min(w, h) / 2) / (o.rangeNm * NM);
  const mx = x + w / 2, my = y + h / 2;
  const S = (wx, wz) => [mx + (wx - o.cx) * s, my + (wz - o.cz) * s];
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = "#cfe3b7"; g.fillRect(x, y, w, h);
  // base raster
  if (o.base) {
    const bs = o.base.width / (WORLD_HALF * 2);
    const wx0 = o.cx - (w / 2) / s, wz0 = o.cz - (h / 2) / s, wx1 = o.cx + (w / 2) / s, wz1 = o.cz + (h / 2) / s;
    const cx0 = Math.max(-WORLD_HALF, wx0), cz0 = Math.max(-WORLD_HALF, wz0), cx1 = Math.min(WORLD_HALF, wx1), cz1 = Math.min(WORLD_HALF, wz1);
    if (cx1 > cx0 && cz1 > cz0) {
      const [dx0, dy0] = S(cx0, cz0), [dx1, dy1] = S(cx1, cz1);
      g.imageSmoothingEnabled = true;
      g.drawImage(o.base, (cx0 + WORLD_HALF) * bs, (cz0 + WORLD_HALF) * bs, (cx1 - cx0) * bs, (cz1 - cz0) * bs, dx0, dy0, dx1 - dx0, dy1 - dy0);
    }
  }
  if (o.style === "mfd") { g.fillStyle = "rgba(4,10,18,0.38)"; g.fillRect(x, y, w, h); }
  const big = o.rangeNm <= 12;
  const font = (px, wt = 600) => `${wt} ${px}px "Barlow", "Arial Narrow", sans-serif`;
  // airspace
  for (const a of AIRSPACE) {
    const [ax, ay] = S(a.x, a.z), r = a.r * s;
    if (ax + r < x || ax - r > x + w || ay + r < y || ay - r > y + h) continue;
    g.lineWidth = 2;
    if (a.cls === "D") { g.setLineDash([9, 6]); g.strokeStyle = BLUE; g.beginPath(); g.arc(ax, ay, r, 0, Math.PI * 2); g.stroke(); g.setLineDash([]); g.font = font(13, 700); g.fillStyle = BLUE; g.fillText(`[${Math.round(a.ceilFt / 100)}]`, ax + r * 0.72, ay - r * 0.72); }
    else if (a.cls === "E700") { const gr = g.createRadialGradient(ax, ay, r * 0.8, ax, ay, r); gr.addColorStop(0, "rgba(177,47,134,0)"); gr.addColorStop(1, "rgba(177,47,134,0.42)"); g.fillStyle = gr; g.beginPath(); g.arc(ax, ay, r, 0, Math.PI * 2); g.fill(); }
    else {
      const col = a.cls === "MOA" ? MAG : BLUE; g.strokeStyle = col; g.beginPath(); g.arc(ax, ay, r, 0, Math.PI * 2); g.stroke();
      for (let k = 0; k < 90; k++) { const an = (k / 90) * Math.PI * 2; g.beginPath(); g.moveTo(ax + Math.cos(an) * r, ay + Math.sin(an) * r); g.lineTo(ax + Math.cos(an) * (r - 7), ay + Math.sin(an) * (r - 7)); g.lineWidth = 1.2; g.stroke(); }
      g.font = font(13, 700); g.fillStyle = col; g.textAlign = "center"; g.fillText(a.id === "ELECTRA-MOA" ? "ELECTRA MOA" : a.id, ax, ay + r - 16); g.font = font(11, 600);
      g.fillText(a.cls === "MOA" ? `${a.floorFt.toLocaleString()}–${a.ceilFt.toLocaleString()}` : `SFC–${a.ceilFt.toLocaleString()}`, ax, ay + r - 3); g.textAlign = "left";
    }
  }
  // towns labels
  if (o.rangeNm <= 20) { g.font = font(12, 600); g.fillStyle = INK; for (const t of TOWNS) { const [a, b] = S(t.x, t.z); g.fillText(t.name.toUpperCase(), a + t.r * s * 0.7, b - t.r * s * 0.7); } }
  // lesson / route waypoints
  if (o.route?.length) {
    g.strokeStyle = "#e64bd0"; g.lineWidth = 3; g.beginPath();
    o.route.forEach((p, k) => { const [a, b] = S(p.x, p.z); k ? g.lineTo(a, b) : g.moveTo(a, b); }); g.stroke();
    for (const p of o.route) { if (!p.id) continue; const [a, b] = S(p.x, p.z); g.beginPath(); g.arc(a, b, 5, 0, Math.PI * 2); g.fillStyle = "#e64bd0"; g.fill(); g.font = font(12, 700); g.fillText(p.id, a + 8, b - 6); }
  }
  // obstacles
  for (const ob of OBSTACLES) { if (o.rangeNm > 25) break; const [a, b] = S(ob.x, ob.z); g.strokeStyle = INK; g.lineWidth = 1.5; g.beginPath(); g.moveTo(a - 5, b + 6); g.lineTo(a, b - 8); g.lineTo(a + 5, b + 6); g.stroke(); g.beginPath(); g.arc(a, b + 4, 1.6, 0, 7); g.fillStyle = INK; g.fill(); if (big) { const msl = Math.round((heightAt(ob.x, ob.z) / FT + ob.hAgl / FT) / 10) * 10; g.font = font(11, 700); g.fillText(`${msl}`, a + 7, b - 2); g.font = font(10, 500); g.fillText(`(${Math.round(ob.hAgl / FT)})`, a + 7, b + 9); } }
  // launch complex
  { const [a, b] = S(LAUNCH.x, LAUNCH.z); g.fillStyle = INK; g.beginPath(); g.moveTo(a, b - 9); g.lineTo(a + 4, b + 6); g.lineTo(a - 4, b + 6); g.closePath(); g.fill(); if (o.rangeNm <= 20) { g.font = font(11, 600); g.fillText("LAUNCH COMPLEX", a + 8, b + 4); } }
  // VORs
  for (const n of NAVAIDS) {
    const [a, b] = S(n.x, n.z); const rr = Math.max(26, Math.min(70, 4 * NM * s));
    g.strokeStyle = BLUE; g.lineWidth = 1.2; g.beginPath(); g.arc(a, b, rr, 0, Math.PI * 2); g.stroke();
    for (let k = 0; k < 36; k++) { const an = k * 10 * DEG; const l = k % 9 === 0 ? 9 : k % 3 === 0 ? 6 : 3; g.beginPath(); g.moveTo(a + Math.sin(an) * rr, b - Math.cos(an) * rr); g.lineTo(a + Math.sin(an) * (rr - l), b - Math.cos(an) * (rr - l)); g.stroke(); }
    g.beginPath(); g.moveTo(a, b - rr); g.lineTo(a - 4, b - rr + 9); g.lineTo(a + 4, b - rr + 9); g.closePath(); g.fillStyle = BLUE; g.fill();
    g.beginPath(); for (let k = 0; k < 6; k++) { const an = k * 60 * DEG; g.lineTo(a + Math.cos(an) * 6, b + Math.sin(an) * 6); } g.closePath(); g.stroke(); g.beginPath(); g.arc(a, b, 1.6, 0, 7); g.fill();
    const label = [`${n.name.toUpperCase()}`, `${n.freq.toFixed(1)} ${n.id}`]; g.font = font(11, 700); const lw = Math.max(...label.map((t) => g.measureText(t).width)) + 10;
    const lx = a + rr * 0.72, ly = b + rr * 0.72; g.fillStyle = "rgba(255,255,255,0.88)"; g.fillRect(lx, ly, lw, 30); g.strokeStyle = BLUE; g.strokeRect(lx, ly, lw, 30); g.fillStyle = BLUE; g.fillText(label[0], lx + 5, ly + 12); g.fillText(label[1], lx + 5, ly + 25);
  }
  // airports
  for (const ap of AIRPORTS) {
    const [a, b] = S(ap.x, ap.z); const col = ap.towered ? BLUE : MAG; const r = 10;
    const paved = ap.runways.some((q) => q.surface !== "grass");
    if (paved) { g.beginPath(); g.arc(a, b, r, 0, Math.PI * 2); g.fillStyle = col; g.fill(); }
    else { g.beginPath(); g.arc(a, b, r, 0, Math.PI * 2); g.lineWidth = 2.2; g.strokeStyle = col; g.stroke(); }
    for (const q of ap.runways) { const [x0, y0] = S(q.ends[0].x, q.ends[0].z), [x1, y1] = S(q.ends[1].x, q.ends[1].z); const k = big ? 1 : r * 1.4 / Math.max(1, Math.hypot(x1 - x0, y1 - y0)); const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2; g.beginPath(); g.moveTo(cx + (x0 - cx) * Math.max(k, 1), cy + (y0 - cy) * Math.max(k, 1)); g.lineTo(cx + (x1 - cx) * Math.max(k, 1), cy + (y1 - cy) * Math.max(k, 1)); g.lineWidth = paved ? 3 : 2; g.strokeStyle = paved ? "#fff" : col; g.stroke(); }
    if (o.rangeNm <= 30) {
      const longest = Math.max(...ap.runways.map((q) => q.len)) / FT;
      const l1 = `${ap.name.toUpperCase()} (${ap.id})`;
      const l2 = ap.towered ? `CT – ${ap.freqs.twr} ★  ATIS ${ap.freqs.atis}` : `${ap.freqs.ctaf} ⓒ${ap.freqs.awos ? `  AWOS ${ap.freqs.awos}` : ""}`;
      const l3 = `${ap.elevFt}  ${ap.runways.some((q) => q.lights) ? "L" : ""} ${Math.round(longest / 100)}`;
      g.fillStyle = col; g.font = font(12, 700); g.fillText(l1, a + 14, b - 10); g.font = font(11, 600); g.fillText(l2, a + 14, b + 3); g.fillText(l3, a + 14, b + 16);
    }
  }
  // ownship
  if (o.own) {
    const [a, b] = S(o.own.x, o.own.z);
    g.save(); g.translate(a, b); g.rotate(o.own.hdg * DEG);
    if (o.own.trackLine) { g.strokeStyle = "rgba(255,255,255,0.8)"; g.setLineDash([6, 6]); g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -Math.min(w, h)); g.stroke(); g.setLineDash([]); }
    g.fillStyle = o.style === "mfd" ? "#fff" : "#111"; g.strokeStyle = o.style === "mfd" ? "#111" : "#fff"; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, -12); g.lineTo(2.5, -4); g.lineTo(11, 0); g.lineTo(11, 3); g.lineTo(2.5, 1); g.lineTo(1.8, 8); g.lineTo(5, 11); g.lineTo(-5, 11); g.lineTo(-1.8, 8); g.lineTo(-2.5, 1); g.lineTo(-11, 3); g.lineTo(-11, 0); g.lineTo(-2.5, -4); g.closePath(); g.fill(); g.stroke();
    g.restore();
  }
  // scale bar
  g.font = font(11, 700); g.fillStyle = o.style === "mfd" ? "#fff" : INK; g.textAlign = "right"; g.fillText(`${o.rangeNm < 1 ? o.rangeNm.toFixed(1) : Math.round(o.rangeNm)} NM`, x + w - 8, y + h - 8); g.textAlign = "left";
  // north arrow
  g.beginPath(); g.moveTo(x + 18, y + 10); g.lineTo(x + 24, y + 26); g.lineTo(x + 12, y + 26); g.closePath(); g.fill(); g.fillText("N", x + 13.5, y + 39);
  g.restore();
  return (px, py) => ({ x: o.cx + (px - mx) / s, z: o.cz + (py - my) / s });
}
