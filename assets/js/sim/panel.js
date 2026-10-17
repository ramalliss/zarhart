// Instrument panel: classic six-pack (steam) or G1000-style PFD/MFD (glass). Canvas 2D.
import { drawMap } from "./map.js";
import { C172 } from "./fdm.js";

const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const V = C172.V;
const MONO = '"IBM Plex Mono", ui-monospace, Consolas, monospace';
const SANS = '"Barlow", "Arial Narrow", system-ui, sans-serif';
const COND = '"Saira Condensed", "Arial Narrow", sans-serif';
const P = (cx, cy, r, a) => [cx + Math.sin(a * DEG) * r, cy - Math.cos(a * DEG) * r];
const wrap = (a) => ((a % 360) + 360) % 360;

function text(g, s, x, y, size, color = "#fff", align = "center", weight = 600, family = SANS) {
  g.font = `${weight} ${size}px ${family}`; g.fillStyle = color; g.textAlign = align; g.textBaseline = "middle"; g.fillText(s, x, y);
}
function arcBand(g, cx, cy, r, a0, a1, w, color) { g.beginPath(); g.arc(cx, cy, r, (a0 - 90) * DEG, (a1 - 90) * DEG); g.lineWidth = w; g.strokeStyle = color; g.lineCap = "butt"; g.stroke(); }
function tick(g, cx, cy, r0, r1, a, w = 1.5, color = "#e8e8e8") { const [x0, y0] = P(cx, cy, r0, a), [x1, y1] = P(cx, cy, r1, a); g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.lineWidth = w; g.strokeStyle = color; g.stroke(); }
function needle(g, cx, cy, a, len, w, color = "#f4f4f4", tail = 0.18) {
  g.save(); g.translate(cx, cy); g.rotate(a * DEG);
  g.beginPath(); g.moveTo(-w / 2, len * tail); g.lineTo(-w * 0.35, -len * 0.85); g.lineTo(0, -len); g.lineTo(w * 0.35, -len * 0.85); g.lineTo(w / 2, len * tail); g.closePath(); g.fillStyle = color; g.fill();
  g.restore(); g.beginPath(); g.arc(cx, cy, Math.max(3, w * 0.9), 0, Math.PI * 2); g.fillStyle = "#2a2d31"; g.fill();
}
function bezel(g, cx, cy, R) {
  const gr = g.createRadialGradient(cx - R * 0.3, cy - R * 0.4, R * 0.2, cx, cy, R * 1.12);
  gr.addColorStop(0, "#3a4049"); gr.addColorStop(1, "#0b0d10");
  g.beginPath(); g.arc(cx, cy, R * 1.1, 0, Math.PI * 2); g.fillStyle = gr; g.fill();
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fillStyle = "#101215"; g.fill();
  for (const a of [45, 135, 225, 315]) { const [x, y] = P(cx, cy, R * 1.04, a); g.beginPath(); g.arc(x, y, R * 0.045, 0, 7); g.fillStyle = "#1c1f23"; g.fill(); }
}
function glassOver(g, cx, cy, R) { const gr = g.createLinearGradient(cx - R, cy - R, cx + R * 0.3, cy + R * 0.2); gr.addColorStop(0, "rgba(255,255,255,0.10)"); gr.addColorStop(0.45, "rgba(255,255,255,0.02)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fillStyle = gr; g.fill(); }
function knob(g, x, y, r) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fillStyle = "#24282d"; g.fill(); g.strokeStyle = "#3b4047"; g.lineWidth = 1; g.stroke(); for (let k = 0; k < 12; k++) tick(g, x, y, r * 0.65, r, k * 30, 1, "#454b53"); }

export class Panel {
  constructor(canvas) {
    this.c = canvas; this.g = canvas.getContext("2d"); this.mode = "steam"; this.hits = []; this.act = {};
    canvas.addEventListener("wheel", (e) => { const h = this.hit(e); if (h?.wheel) { e.preventDefault(); h.wheel(e.deltaY < 0 ? 1 : -1, e.shiftKey); } }, { passive: false });
    canvas.addEventListener("click", (e) => { const h = this.hit(e); if (h?.click) { const r = canvas.getBoundingClientRect(); h.click(e.clientX - r.left < h.x ? -1 : 1, e.shiftKey); } });
    canvas.addEventListener("mousemove", (e) => { const h = this.hit(e); canvas.style.cursor = h ? "pointer" : "default"; canvas.title = h?.tip || ""; });
  }
  hit(e) {
    const r = this.c.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top;
    return this.hits.find((h) => (h.r ? (x - h.x) ** 2 + (y - h.y) ** 2 <= h.r * h.r : x >= h.x - h.w / 2 && x <= h.x + h.w / 2 && y >= h.y - h.h / 2 && y <= h.y + h.h / 2));
  }
  resize() {
    const dpr = Math.min(2, devicePixelRatio || 1); const r = this.c.getBoundingClientRect();
    this.w = r.width; this.h = r.height; this.c.width = Math.max(1, Math.round(r.width * dpr)); this.c.height = Math.max(1, Math.round(r.height * dpr));
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  draw(S) {
    if (!this.w || !this.h) return;
    const g = this.g; this.hits = []; this.act = S.act;
    g.clearRect(0, 0, this.w, this.h);
    if (this.mode === "glass") this.drawGlass(S); else this.drawSteam(S);
  }

  /* ======================= STEAM ======================= */
  drawSteam(S) {
    const g = this.g, W = this.w, H = this.h, d = S.d, ac = S.ac;
    // panel background
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, "#232830"); bg.addColorStop(1, "#171b21");
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const lip = Math.min(30, H * 0.11);
    g.fillStyle = "#0d1014"; g.fillRect(0, 0, W, lip);
    const Ha = H - lip;
    const y1 = lip + Ha * 0.265, y2 = lip + Ha * 0.745;
    if (W < 640) { // phones: six-pack only
      const D = Math.min(Ha * 0.47, (W - 16) / 3.35), R = D / 2 * 0.92; const x0 = (W - D * 3.3) / 2;
      const xB = x0 + D * 0.55, xC = xB + D * 1.1, xD = xC + D * 1.1;
      this.asi(xB, y1, R, d.ias); this.ai(xC, y1, R, d.aiPitch, d.aiBank, ac.inst.gyroSpin); this.alt(xD, y1, R, d.altInd, ac.inst.kollsman);
      this.tc(xB, y2, R, d.tc, d.ball, ac.powered); this.hi(xC, y2, R, d.hi, ac.inst.hdgBug); this.vsi(xD, y2, R, d.vsi);
      this.compass(xC, lip / 2 + 1, Math.min(D * 1.3, 170), lip - 6, d.compass);
      return;
    }
    const D = Math.min(Ha * 0.47, W / 9.1); const R = D / 2 * 0.92;
    const total = D * 8.15; const x0 = Math.max(6, (W - total) / 2);
    const xA = x0 + D * 0.5, xB = xA + D * 1.13, xC = xB + D * 1.08, xD = xC + D * 1.08, xE = xD + D * 1.13;
    const xR = xE + D * 0.62;
    this.asi(xB, y1, R, d.ias);
    this.ai(xC, y1, R, d.aiPitch, d.aiBank, ac.inst.gyroSpin);
    this.alt(xD, y1, R, d.altInd, ac.inst.kollsman);
    this.tc(xB, y2, R, d.tc, d.ball, ac.powered);
    this.hi(xC, y2, R, d.hi, ac.inst.hdgBug);
    this.vsi(xD, y2, R, d.vsi);
    this.tach(xA, y1, R, d.rpm);
    this.engine(xA, y2, D * 0.98, D * 0.92, d, ac);
    this.cdi(xE, y1, R, S.vor1, ac.inst.obs, "NAV 1");
    this.flapsTrim(xE, y2, D, d, S);
    this.radios(xR, lip + 6, Math.min(W - xR - 8, D * 2.35), Ha - 12, S);
    this.compass(xC, lip / 2 + 1, Math.min(D * 1.3, 170), lip - 6, d.compass);
  }
  asi(cx, cy, R, ias) {
    const g = this.g; bezel(g, cx, cy, R);
    const a = (v) => (v < 40 ? (v / 40) * 28 : 28 + ((Math.min(v, 200) - 40) / 160) * 304);
    arcBand(g, cx, cy, R * 0.86, a(V.s0), a(V.fe), R * 0.07, "#f2f2f2");
    arcBand(g, cx, cy, R * 0.93, a(V.s1), a(V.no), R * 0.08, "#1fa84a");
    arcBand(g, cx, cy, R * 0.93, a(V.no), a(V.ne), R * 0.08, "#f2c21f");
    tick(g, cx, cy, R * 0.8, R * 0.98, a(V.ne), 3.2, "#e0221b");
    for (let v = 40; v <= 200; v += 5) tick(g, cx, cy, R * (v % 20 === 0 ? 0.76 : 0.83), R * 0.97, a(v), v % 20 === 0 ? 2 : 1);
    for (let v = 40; v <= 200; v += 20) { const [x, y] = P(cx, cy, R * 0.6, a(v)); text(g, String(v), x, y, R * 0.17, "#f2f2f2", "center", 600); }
    text(g, "AIRSPEED", cx, cy - R * 0.25, R * 0.1, "#c9ccd1", "center", 600); text(g, "KNOTS", cx, cy + R * 0.28, R * 0.1, "#c9ccd1");
    needle(g, cx, cy, a(clamp(ias, 0, 210)), R * 0.9, R * 0.08); glassOver(g, cx, cy, R);
  }
  ai(cx, cy, R, pitch, bank, spin) {
    const g = this.g; bezel(g, cx, cy, R);
    g.save(); g.beginPath(); g.arc(cx, cy, R * 0.95, 0, Math.PI * 2); g.clip();
    g.translate(cx, cy); g.rotate(-bank * DEG);
    const ppd = R / 24; g.translate(0, clamp(pitch, -35, 35) * ppd);
    g.fillStyle = "#3d86d6"; g.fillRect(-R * 2, -R * 3, R * 4, R * 3);
    g.fillStyle = "#8a5326"; g.fillRect(-R * 2, 0, R * 4, R * 3);
    g.fillStyle = "#fff"; g.fillRect(-R * 2, -1, R * 4, 2);
    g.strokeStyle = "#fff"; g.lineWidth = 1.4;
    for (const p of [-20, -15, -10, -5, 5, 10, 15, 20]) { const w = p % 10 === 0 ? R * 0.34 : R * 0.18; g.beginPath(); g.moveTo(-w / 2, -p * ppd); g.lineTo(w / 2, -p * ppd); g.stroke(); if (p % 10 === 0) { text(g, String(Math.abs(p)), -w / 2 - R * 0.09, -p * ppd, R * 0.09, "#fff"); text(g, String(Math.abs(p)), w / 2 + R * 0.09, -p * ppd, R * 0.09, "#fff"); } }
    g.restore();
    // bank pointer rotates with the horizon, scale fixed
    g.save(); g.translate(cx, cy);
    for (const b of [-60, -45, -30, -20, -10, 10, 20, 30, 45, 60]) tick(g, 0, 0, R * 0.8, R * (Math.abs(b) % 30 === 0 ? 0.97 : 0.9), b, Math.abs(b) % 30 === 0 ? 2.2 : 1.4);
    g.beginPath(); g.moveTo(0, -R * 0.8); g.lineTo(-R * 0.06, -R * 0.95); g.lineTo(R * 0.06, -R * 0.95); g.closePath(); g.fillStyle = "#fff"; g.fill();
    g.rotate(-bank * DEG); g.beginPath(); g.moveTo(0, -R * 0.78); g.lineTo(-R * 0.06, -R * 0.66); g.lineTo(R * 0.06, -R * 0.66); g.closePath(); g.fillStyle = "#f28c1b"; g.fill();
    g.restore();
    // miniature airplane
    g.fillStyle = "#f28c1b"; g.fillRect(cx - R * 0.5, cy - 2, R * 0.32, 4); g.fillRect(cx + R * 0.18, cy - 2, R * 0.32, 4);
    g.beginPath(); g.arc(cx, cy, R * 0.05, 0, 7); g.fill(); g.fillRect(cx - 1.5, cy - R * 0.12, 3, R * 0.1);
    if (spin < 0.6) text(g, "GYRO", cx, cy + R * 0.55, R * 0.12, "#ff5a4d", "center", 700);
    glassOver(g, cx, cy, R);
    const [kx, ky] = [cx, cy + R * 1.0]; knob(g, kx, ky, R * 0.1);
    this.hits.push({ x: kx, y: ky, r: R * 0.16, tip: "Adjust miniature airplane (scroll)", wheel: (dir) => this.act.aiAdj?.(dir), click: (s) => this.act.aiAdj?.(s) });
  }
  alt(cx, cy, R, alt, kollsman) {
    const g = this.g; bezel(g, cx, cy, R);
    for (let k = 0; k < 50; k++) tick(g, cx, cy, R * (k % 5 === 0 ? 0.78 : 0.86), R * 0.97, k * 7.2, k % 5 === 0 ? 2 : 1);
    for (let k = 0; k < 10; k++) { const [x, y] = P(cx, cy, R * 0.62, k * 36); text(g, String(k), x, y, R * 0.2, "#f2f2f2", "center", 600); }
    // Kollsman window
    g.fillStyle = "#000"; g.fillRect(cx + R * 0.25, cy - R * 0.11, R * 0.5, R * 0.22);
    text(g, kollsman.toFixed(2), cx + R * 0.5, cy, R * 0.13, "#fff", "center", 600, MONO);
    text(g, "ALT", cx, cy - R * 0.3, R * 0.1, "#c9ccd1"); text(g, "100 FEET", cx, cy + R * 0.3, R * 0.08, "#c9ccd1");
    const a = Math.max(-1000, alt);
    // 10,000 pointer (thin long with triangle), 1,000 (short wide), 100 (long)
    const a10k = (a / 100000) * 360, a1k = (a / 10000) * 360, a100 = (a / 1000) * 360;
    g.save(); g.translate(cx, cy); g.rotate(a10k * DEG); g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -R * 0.88); g.lineWidth = 1.2; g.strokeStyle = "#ddd"; g.stroke(); g.beginPath(); g.moveTo(0, -R * 0.98); g.lineTo(-R * 0.05, -R * 0.84); g.lineTo(R * 0.05, -R * 0.84); g.fillStyle = "#eee"; g.fill(); g.restore();
    needle(g, cx, cy, a1k, R * 0.55, R * 0.13, "#f4f4f4", 0.1);
    needle(g, cx, cy, a100, R * 0.88, R * 0.07, "#f4f4f4", 0.2);
    glassOver(g, cx, cy, R);
    const [kx, ky] = [cx - R * 0.78, cy + R * 0.86]; knob(g, kx, ky, R * 0.13);
    this.hits.push({ x: kx, y: ky, r: R * 0.2, tip: "Kollsman knob: scroll to set the altimeter", wheel: (dir, sh) => this.act.baro?.(dir * (sh ? 0.1 : 0.01)), click: (s) => this.act.baro?.(s * 0.01) });
  }
  tc(cx, cy, R, tc, ball, powered) {
    const g = this.g; bezel(g, cx, cy, R);
    text(g, "TURN COORDINATOR", cx, cy - R * 0.62, R * 0.085, "#c9ccd1"); text(g, "L", cx - R * 0.72, cy + R * 0.32, R * 0.14, "#fff"); text(g, "R", cx + R * 0.72, cy + R * 0.32, R * 0.14, "#fff");
    text(g, "2 MIN", cx, cy + R * 0.7, R * 0.08, "#c9ccd1"); text(g, "NO PITCH INFORMATION", cx, cy + R * 0.82, R * 0.065, "#9da2a8");
    for (const a of [-90, -70, 70, 90]) tick(g, cx, cy, R * 0.72, R * 0.92, a + 0, 3, "#f2f2f2");
    // airplane symbol, standard rate = 20°
    g.save(); g.translate(cx, cy); g.rotate(clamp(tc, -2, 2) * 20 * DEG);
    g.fillStyle = "#f2f2f2"; g.fillRect(-R * 0.7, -2.5, R * 1.4, 5); g.beginPath(); g.arc(0, 0, R * 0.1, 0, 7); g.fill(); g.fillRect(-2, -R * 0.22, 4, R * 0.2); g.fillRect(-R * 0.14, -R * 0.22, R * 0.28, 3);
    g.restore();
    // inclinometer
    const ty = cy + R * 0.42; g.beginPath(); g.moveTo(cx - R * 0.42, ty - 4); g.quadraticCurveTo(cx, ty + R * 0.12, cx + R * 0.42, ty - 4); g.lineWidth = R * 0.16; g.strokeStyle = "#e9e1cb"; g.lineCap = "round"; g.stroke(); g.lineCap = "butt";
    for (const s of [-1, 1]) { g.fillStyle = "#222"; g.fillRect(cx + s * R * 0.09 - 1, ty - R * 0.05, 2, R * 0.16); }
    const bx = cx + clamp(ball, -1.1, 1.1) * R * 0.33; const by = ty + R * 0.03 - Math.abs(ball) * R * 0.04;
    g.beginPath(); g.arc(bx, by, R * 0.065, 0, 7); g.fillStyle = "#111"; g.fill();
    if (!powered) { g.fillStyle = "#c61f2d"; g.fillRect(cx + R * 0.25, cy - R * 0.4, R * 0.28, R * 0.14); text(g, "OFF", cx + R * 0.39, cy - R * 0.33, R * 0.09, "#fff", "center", 700); }
    glassOver(g, cx, cy, R);
  }
  hi(cx, cy, R, hdg, bug) {
    const g = this.g; bezel(g, cx, cy, R);
    g.save(); g.translate(cx, cy); g.rotate(-hdg * DEG);
    for (let k = 0; k < 72; k++) tick(g, 0, 0, R * (k % 2 === 0 ? 0.76 : 0.84), R * 0.94, k * 5, k % 6 === 0 ? 2 : 1);
    const lab = { 0: "N", 3: "3", 6: "6", 9: "E", 12: "12", 15: "15", 18: "S", 21: "21", 24: "24", 27: "W", 30: "30", 33: "33" };
    for (const k of Object.keys(lab)) { g.save(); g.rotate(k * 10 * DEG); text(g, lab[k], 0, -R * 0.62, R * (isNaN(+lab[k]) ? 0.19 : 0.15), "#fff", "center", 700); g.restore(); }
    g.save(); g.rotate(bug * DEG); g.fillStyle = "#f28c1b"; g.fillRect(-R * 0.06, -R * 0.98, R * 0.12, R * 0.1); g.restore();
    g.restore();
    // lubber line and airplane
    g.fillStyle = "#f28c1b"; g.beginPath(); g.moveTo(cx, cy - R * 0.98); g.lineTo(cx - R * 0.05, cy - R * 0.86); g.lineTo(cx + R * 0.05, cy - R * 0.86); g.fill();
    g.strokeStyle = "#f28c1b"; g.lineWidth = 3; g.beginPath(); g.moveTo(cx, cy - R * 0.4); g.lineTo(cx, cy + R * 0.32); g.moveTo(cx - R * 0.3, cy - R * 0.05); g.lineTo(cx + R * 0.3, cy - R * 0.05); g.moveTo(cx - R * 0.12, cy + R * 0.28); g.lineTo(cx + R * 0.12, cy + R * 0.28); g.stroke();
    glassOver(g, cx, cy, R);
    const [k1x, k1y] = [cx - R * 0.8, cy + R * 0.86], [k2x, k2y] = [cx + R * 0.8, cy + R * 0.86]; knob(g, k1x, k1y, R * 0.12); knob(g, k2x, k2y, R * 0.12);
    text(g, "PUSH", k1x, k1y + R * 0.2, R * 0.07, "#9da2a8");
    this.hits.push({ x: k1x, y: k1y, r: R * 0.18, tip: "Heading indicator: click to set to the compass, scroll to adjust", wheel: (dir) => this.act.hiAdj?.(dir), click: () => this.act.hiSet?.() });
    this.hits.push({ x: k2x, y: k2y, r: R * 0.18, tip: "Heading bug (scroll)", wheel: (dir, sh) => this.act.hdgBug?.(dir * (sh ? 10 : 1)), click: (s) => this.act.hdgBug?.(s) });
  }
  vsi(cx, cy, R, vs) {
    const g = this.g; bezel(g, cx, cy, R);
    const a = (v) => -90 + (clamp(v, -2000, 2000) / 2000) * 170;
    for (let v = -2000; v <= 2000; v += 100) tick(g, cx, cy, R * (v % 500 === 0 ? 0.76 : 0.85), R * 0.96, a(v), v % 500 === 0 ? 2 : 1);
    for (const v of [-2000, -1500, -1000, -500, 0, 500, 1000, 1500, 2000]) { const [x, y] = P(cx, cy, R * 0.6, a(v)); text(g, String(Math.abs(v / 100)), x, y, R * 0.15, "#f2f2f2"); }
    text(g, "UP", cx - R * 0.25, cy - R * 0.32, R * 0.1, "#c9ccd1"); text(g, "DOWN", cx - R * 0.25, cy + R * 0.32, R * 0.1, "#c9ccd1"); text(g, "VERTICAL SPEED", cx + R * 0.15, cy - R * 0.08, R * 0.065, "#c9ccd1"); text(g, "100 FEET PER MIN", cx + R * 0.15, cy + R * 0.06, R * 0.065, "#c9ccd1");
    needle(g, cx, cy, a(vs), R * 0.88, R * 0.08); glassOver(g, cx, cy, R);
  }
  tach(cx, cy, R, rpm) {
    const g = this.g; bezel(g, cx, cy, R);
    const a = (r) => -130 + (clamp(r, 0, 3500) / 3500) * 260;
    arcBand(g, cx, cy, R * 0.92, a(2100), a(2700), R * 0.09, "#1fa84a"); tick(g, cx, cy, R * 0.8, R * 0.98, a(2700), 3.2, "#e0221b");
    for (let r = 0; r <= 3500; r += 100) tick(g, cx, cy, R * (r % 500 === 0 ? 0.76 : 0.85), R * 0.96, a(r), r % 500 === 0 ? 2 : 1);
    for (let r = 0; r <= 35; r += 5) { const [x, y] = P(cx, cy, R * 0.6, a(r * 100)); text(g, String(r), x, y, R * 0.15, "#f2f2f2"); }
    text(g, "RPM", cx, cy + R * 0.3, R * 0.11, "#c9ccd1"); text(g, "x100", cx, cy + R * 0.45, R * 0.08, "#9da2a8");
    g.fillStyle = "#000"; g.fillRect(cx - R * 0.26, cy + R * 0.55, R * 0.52, R * 0.18); text(g, String(Math.round(rpm / 10) * 10).padStart(4, "0"), cx, cy + R * 0.64, R * 0.12, "#5be38a", "center", 600, MONO);
    needle(g, cx, cy, a(rpm), R * 0.88, R * 0.08); glassOver(g, cx, cy, R);
  }
  engine(cx, cy, w, h, d, ac) {
    const g = this.g; const x = cx - w / 2, y = cy - h / 2;
    g.fillStyle = "#0f1114"; g.beginPath(); g.roundRect(x, y, w, h, 8); g.fill(); g.strokeStyle = "#2b3037"; g.stroke();
    const items = [
      ["FUEL L", d.fuelL / 20, [0.1, 1], `${d.fuelL.toFixed(1)}`],
      ["FUEL R", d.fuelR / 20, [0.1, 1], `${d.fuelR.toFixed(1)}`],
      ["OIL T", d.oilT, [0.35, 0.85], ""],
      ["OIL P", d.oilP, [0.4, 0.9], ""],
      ["SUCTION", d.suction / 7, [4.5 / 7, 5.4 / 7], d.suction.toFixed(1)],
      ["AMPS", 0.5 + d.amps / 60, [0.45, 0.75], `${d.amps >= 0 ? "+" : ""}${Math.round(d.amps)}`],
    ];
    const cw = w / 2, rh = h / 3;
    items.forEach(([lab, v, gr, val], i) => {
      const ix = x + (i % 2) * cw + 8, iy = y + Math.floor(i / 2) * rh + 6, bw = cw - 16;
      text(g, lab, ix, iy + 6, Math.max(8, rh * 0.18), "#c9ccd1", "left", 700);
      if (val) text(g, val, ix + bw, iy + 6, Math.max(8, rh * 0.18), "#5be38a", "right", 600, MONO);
      const by = iy + rh * 0.48; g.fillStyle = "#26292e"; g.fillRect(ix, by, bw, 5); g.fillStyle = "#1fa84a"; g.fillRect(ix + bw * gr[0], by, bw * (gr[1] - gr[0]), 5);
      const px = ix + bw * clamp(v, 0, 1); g.beginPath(); g.moveTo(px, by - 2); g.lineTo(px - 4, by - 9); g.lineTo(px + 4, by - 9); g.closePath(); g.fillStyle = "#fff"; g.fill();
    });
  }
  cdi(cx, cy, R, vor, obs, label) {
    const g = this.g; bezel(g, cx, cy, R);
    g.save(); g.translate(cx, cy); g.rotate(-obs * DEG);
    for (let k = 0; k < 72; k++) tick(g, 0, 0, R * (k % 2 === 0 ? 0.8 : 0.86), R * 0.95, k * 5, k % 6 === 0 ? 2 : 1);
    for (let k = 0; k < 12; k++) { g.save(); g.rotate(k * 30 * DEG); text(g, String(k * 3 || "N").replace("9", "E").replace(/^18$/, "S").replace(/^27$/, "W"), 0, -R * 0.68, R * 0.13, "#fff"); g.restore(); }
    g.restore();
    g.fillStyle = "#f2f2f2"; g.beginPath(); g.moveTo(cx, cy - R * 0.8); g.lineTo(cx - R * 0.06, cy - R * 0.94); g.lineTo(cx + R * 0.06, cy - R * 0.94); g.fill();
    for (let k = -5; k <= 5; k++) if (k) { g.beginPath(); g.arc(cx + k * R * 0.1, cy, R * 0.022, 0, 7); g.fillStyle = "#fff"; g.fill(); }
    g.beginPath(); g.arc(cx, cy, R * 0.07, 0, 7); g.strokeStyle = "#fff"; g.lineWidth = 1.2; g.stroke();
    const dev = vor?.ok ? vor.cdi : 0;
    g.fillStyle = "#f2f2f2"; g.fillRect(cx + dev * R * 0.5 - 1.6, cy - R * 0.55, 3.2, R * 1.1);
    if (vor?.ok && vor.toFrom !== "OFF") { const up = vor.toFrom === "TO"; g.beginPath(); g.moveTo(cx + R * 0.32, cy + (up ? -R * 0.2 : R * 0.2)); g.lineTo(cx + R * 0.24, cy + (up ? -R * 0.08 : R * 0.08)); g.lineTo(cx + R * 0.4, cy + (up ? -R * 0.08 : R * 0.08)); g.closePath(); g.fillStyle = "#fff"; g.fill(); text(g, vor.toFrom, cx + R * 0.32, cy + (up ? -R * 0.32 : R * 0.32), R * 0.09, "#fff", "center", 700); }
    else { g.fillStyle = "#c61f2d"; g.fillRect(cx - R * 0.48, cy - R * 0.36, R * 0.3, R * 0.14); text(g, "NAV", cx - R * 0.33, cy - R * 0.29, R * 0.09, "#fff", "center", 700); }
    text(g, label, cx, cy + R * 0.5, R * 0.08, "#9da2a8");
    glassOver(g, cx, cy, R);
    const [kx, ky] = [cx - R * 0.8, cy + R * 0.86]; knob(g, kx, ky, R * 0.13); text(g, "OBS", kx, ky + R * 0.22, R * 0.07, "#9da2a8");
    this.hits.push({ x: kx, y: ky, r: R * 0.2, tip: "OBS: scroll to select a radial", wheel: (dir, sh) => this.act.obs?.(dir * (sh ? 10 : 1)), click: (s) => this.act.obs?.(s) });
  }
  flapsTrim(cx, cy, D, d, S) {
    const g = this.g; const w = D * 0.98, h = D * 0.92, x = cx - w / 2, y = cy - h / 2;
    g.fillStyle = "#0f1114"; g.beginPath(); g.roundRect(x, y, w, h, 8); g.fill(); g.strokeStyle = "#2b3037"; g.stroke();
    const fs = Math.max(8, D * 0.075);
    // flaps
    const fx = x + w * 0.2, fy0 = y + h * 0.2, fy1 = y + h * 0.82;
    text(g, "FLAPS", fx, y + h * 0.1, fs, "#c9ccd1", "center", 700);
    g.strokeStyle = "#555"; g.lineWidth = 2; g.beginPath(); g.moveTo(fx, fy0); g.lineTo(fx, fy1); g.stroke();
    for (const f of [0, 10, 20, 30]) { const yy = fy0 + (f / 30) * (fy1 - fy0); g.fillStyle = "#ddd"; g.fillRect(fx - 6, yy - 1, 12, 2); text(g, String(f), fx + 16, yy, fs, "#ddd", "left", 500); }
    const fyy = fy0 + (d.flaps / 30) * (fy1 - fy0); g.beginPath(); g.moveTo(fx - 7, fyy); g.lineTo(fx - 16, fyy - 5); g.lineTo(fx - 16, fyy + 5); g.closePath(); g.fillStyle = "#f2c21f"; g.fill();
    // trim
    const tx = x + w * 0.62; text(g, "TRIM", tx, y + h * 0.1, fs, "#c9ccd1", "center", 700);
    g.strokeStyle = "#555"; g.beginPath(); g.moveTo(tx, fy0); g.lineTo(tx, fy1); g.stroke();
    text(g, "DN", tx + 16, fy0, fs * 0.9, "#999", "left"); text(g, "UP", tx + 16, fy1, fs * 0.9, "#999", "left");
    g.fillStyle = "#5be38a"; g.fillRect(tx - 7, (fy0 + fy1) / 2 + 0.06 * (fy1 - fy0) - 1, 14, 2); text(g, "T/O", tx - 20, (fy0 + fy1) / 2 + 0.06 * (fy1 - fy0), fs * 0.8, "#5be38a", "center");
    const tyy = (fy0 + fy1) / 2 + clamp(d.trim, -1, 1) * (fy1 - fy0) / 2; g.fillStyle = "#fff"; g.fillRect(tx - 8, tyy - 2, 16, 4);
    // throttle / mixture positions
    const lx = x + w * 0.88; const ly0 = fy0, ly1 = fy1;
    g.fillStyle = "#22262b"; g.fillRect(lx - 3, ly0, 6, ly1 - ly0);
    g.fillStyle = "#111"; g.fillRect(lx - 9, ly1 - d.throttle * (ly1 - ly0) - 4, 18, 8); text(g, "THR", lx, y + h * 0.1, fs * 0.85, "#c9ccd1", "center", 700);
    text(g, `${Math.round(d.throttle * 100)}%`, lx, y + h * 0.92, fs * 0.85, "#ddd");
  }
  compass(cx, cy, w, h, hdg) {
    const g = this.g; const x = cx - w / 2, y = cy - h / 2;
    g.save(); g.fillStyle = "#06080a"; g.beginPath(); g.roundRect(x, y, w, h, 5); g.fill(); g.clip();
    const ppd = w / 60;
    for (let a = Math.floor(hdg - 35); a <= hdg + 35; a++) {
      if (a % 5) continue; const px = cx + (a - hdg) * ppd; const aa = wrap(a);
      g.fillStyle = "#e6e2d6"; g.fillRect(px - 0.6, y + h * 0.62, 1.2, a % 10 ? h * 0.18 : h * 0.3);
      if (aa % 30 === 0) { const lbl = { 0: "N", 90: "E", 180: "S", 270: "W" }[aa] ?? String(aa / 10); text(g, lbl, px, y + h * 0.36, h * 0.48, "#f3efe2", "center", 700); }
    }
    g.restore(); g.fillStyle = "#e0221b"; g.fillRect(cx - 1, y + 1, 2, h - 2);
  }
  radios(x, y, w, h, S) {
    const g = this.g; if (w < 90) return;
    const rows = 6, rh = Math.min(38, (h - 8) / rows);
    const box = (i, label, main, sub, col = "#5be38a", onClick, tip) => {
      const yy = y + i * (rh + 4);
      g.fillStyle = "#0a0c0e"; g.beginPath(); g.roundRect(x, yy, w, rh, 5); g.fill(); g.strokeStyle = "#2b3037"; g.stroke();
      text(g, label, x + 8, yy + rh / 2, Math.max(8, rh * 0.28), "#8d949c", "left", 700);
      text(g, main, x + 8 + w * 0.2, yy + rh / 2, Math.max(9, rh * 0.42), col, "left", 600, MONO);
      if (sub) text(g, sub, x + w - 8, yy + rh / 2, Math.max(8, rh * 0.32), "#c9ccd1", "right", 500, MONO);
      if (onClick) this.hits.push({ x: x + w / 2, y: yy + rh / 2, w, h: rh, tip, click: onClick });
    };
    const r = S.radio, ac = S.ac, pw = ac.powered && ac.elec.avionics;
    if (!pw) { box(0, "AVIONICS", "OFF", "master + avionics", "#7a2d2d"); return; }
    box(0, "COM1", r.com1.toFixed(3), `⇄ ${r.com1s.toFixed(3)}`, "#5be38a", () => this.act.swapCom?.(), "Swap COM1 active/standby");
    box(1, "NAV1", r.nav1.toFixed(2), `⇄ ${r.nav1s.toFixed(2)}  ${S.vor1?.ok ? S.vor1.ident : "---"}`, "#5be38a", () => this.act.swapNav?.(), "Swap NAV1 active/standby");
    box(2, "XPDR", ac.xpdr.code, ac.xpdr.mode, ac.xpdr.code === "7700" ? "#ff4d4d" : "#5be38a", () => this.act.xpdrMode?.(), "Cycle transponder mode");
    const gps = S.gps; box(3, "GPS", gps ? `${gps.id} ${gps.dist.toFixed(1)}NM` : "NO WPT", gps ? `${String(Math.round(gps.brg)).padStart(3, "0")}°  ${S.ete || ""}` : "", "#e64bd0", () => this.act.openMap?.(), "Open the map to pick a waypoint");
    box(4, "DME", S.vor1?.ok ? `${S.vor1.dme.toFixed(1)}NM` : "---.-", `GS ${Math.round(S.d.gs)}KT  OAT ${Math.round(S.d.oatC)}°C`, "#5be38a");
    // annunciators
    const yy = y + 5 * (rh + 4); const ann = [["VOLTS", ac.elec.master && !ac.elec.alt, "#ff4d4d"], ["VAC", S.d.suction < 3, "#ffb020"], ["OIL P", ac.elec.master && S.d.oilP < 0.25, "#ff4d4d"], ["FUEL", S.d.fuelL + S.d.fuelR < 6, "#ffb020"]];
    const aw = (w - 12) / ann.length;
    ann.forEach(([t, on, c], i) => { g.fillStyle = on ? c : "#14171b"; g.fillRect(x + i * (aw + 4), yy, aw, rh * 0.8); text(g, t, x + i * (aw + 4) + aw / 2, yy + rh * 0.4, Math.max(8, rh * 0.28), on ? "#111" : "#3a3f45", "center", 800); });
  }

  /* ======================= GLASS (G1000-style) ======================= */
  drawGlass(S) {
    const g = this.g, W = this.w, H = this.h;
    g.fillStyle = "#15181c"; g.fillRect(0, 0, W, H);
    const gap = 10; const narrow = W < 640; const pw = narrow ? W - 20 : Math.min(W * 0.58, H * 1.75); const mw = narrow ? 0 : Math.min(W - pw - gap * 3, H * 1.6);
    const x0 = Math.max(gap, (W - pw - mw - gap) / 2);
    const on = S.ac.powered && S.ac.elec.avionics;
    this.screen(x0, 6, pw, H - 12, on, () => this.pfd(x0 + 6, 12, pw - 12, H - 24, S));
    if (mw > 120) this.screen(x0 + pw + gap, 6, mw, H - 12, on, () => this.mfd(x0 + pw + gap + 6, 12, mw - 12, H - 24, S));
  }
  screen(x, y, w, h, on, fn) {
    const g = this.g; g.fillStyle = "#2a2e33"; g.beginPath(); g.roundRect(x, y, w, h, 10); g.fill();
    g.fillStyle = "#000"; g.fillRect(x + 6, y + 6, w - 12, h - 12);
    if (on) { g.save(); g.beginPath(); g.rect(x + 6, y + 6, w - 12, h - 12); g.clip(); fn(); g.restore(); }
  }
  pfd(x, y, w, h, S) {
    const g = this.g, d = S.d, ac = S.ac;
    const cx = x + w * 0.5, cy = y + h * 0.42, ppd = h / 38;
    // attitude
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.translate(cx, cy); g.rotate(-d.aiBank * DEG); g.translate(0, clamp(d.aiPitch, -40, 40) * ppd);
    const sky = g.createLinearGradient(0, -h * 1.2, 0, 0); sky.addColorStop(0, "#0a3d92"); sky.addColorStop(1, "#3f8ee8"); g.fillStyle = sky; g.fillRect(-w * 2, -h * 3, w * 4, h * 3);
    const gnd = g.createLinearGradient(0, 0, 0, h * 1.2); gnd.addColorStop(0, "#7b4b1e"); gnd.addColorStop(1, "#3b240e"); g.fillStyle = gnd; g.fillRect(-w * 2, 0, w * 4, h * 3);
    g.fillStyle = "#fff"; g.fillRect(-w * 2, -1, w * 4, 2);
    g.strokeStyle = "#fff"; g.lineWidth = 1.5;
    for (let p = -30; p <= 30; p += 2.5) { if (!p) continue; const len = p % 10 === 0 ? w * 0.14 : p % 5 === 0 ? w * 0.07 : w * 0.035; g.beginPath(); g.moveTo(-len / 2, -p * ppd); g.lineTo(len / 2, -p * ppd); g.stroke(); if (p % 10 === 0) { text(g, String(Math.abs(p)), -len / 2 - 14, -p * ppd, h * 0.03, "#fff", "center", 600, MONO); text(g, String(Math.abs(p)), len / 2 + 14, -p * ppd, h * 0.03, "#fff", "center", 600, MONO); } }
    g.restore();
    // bank arc
    g.save(); g.translate(cx, cy); const br = h * 0.3;
    g.strokeStyle = "#fff"; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, br, -150 * DEG, -30 * DEG); g.stroke();
    for (const b of [-60, -45, -30, -20, -10, 10, 20, 30, 45, 60]) tick(g, 0, 0, br, br + (Math.abs(b) % 30 === 0 ? 14 : 8), b, 2, "#fff");
    g.beginPath(); g.moveTo(0, -br); g.lineTo(-7, -br - 12); g.lineTo(7, -br - 12); g.closePath(); g.fillStyle = "#fff"; g.fill();
    g.rotate(-d.aiBank * DEG); g.beginPath(); g.moveTo(0, -br + 2); g.lineTo(-8, -br + 15); g.lineTo(8, -br + 15); g.closePath(); g.fill();
    const sk = clamp(d.ball, -1.2, 1.2) * 10; g.fillRect(-8 + sk, -br + 17, 16, 4);
    g.restore();
    // airplane symbol
    g.fillStyle = "#ffd21f"; g.strokeStyle = "#000"; g.lineWidth = 1;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx - w * 0.11, cy + h * 0.06); g.lineTo(cx - w * 0.06, cy + h * 0.06); g.lineTo(cx, cy + h * 0.025); g.lineTo(cx + w * 0.06, cy + h * 0.06); g.lineTo(cx + w * 0.11, cy + h * 0.06); g.closePath(); g.fill(); g.stroke();
    g.fillRect(cx - w * 0.24, cy - 2, w * 0.07, 4); g.fillRect(cx + w * 0.17, cy - 2, w * 0.07, 4);
    // speed tape
    this.tape(x + w * 0.04, cy, w * 0.13, h * 0.58, d.ias, 10, h * 0.058, "spd", S);
    this.tape(x + w * 0.78, cy, w * 0.14, h * 0.58, d.altInd, 100, h * 0.058, "alt", S);
    // vsi strip
    const vx = x + w * 0.935, vh = h * 0.5; g.fillStyle = "rgba(0,0,0,0.45)"; g.fillRect(vx, cy - vh / 2, w * 0.05, vh);
    for (const v of [-2000, -1000, 0, 1000, 2000]) { const yy = cy - (v / 2000) * vh / 2; g.fillStyle = "#fff"; g.fillRect(vx, yy - 1, 8, 2); if (v) text(g, String(Math.abs(v / 1000)), vx + 16, yy, h * 0.026, "#fff", "center", 600, MONO); }
    const vy = cy - (clamp(d.vsi, -2000, 2000) / 2000) * vh / 2; g.fillStyle = "#000"; g.fillRect(vx - 2, vy - 9, w * 0.06, 18); g.strokeStyle = "#fff"; g.strokeRect(vx - 2, vy - 9, w * 0.06, 18); text(g, String(Math.round(d.vsi / 10) * 10), vx + w * 0.028, vy, h * 0.026, "#fff", "center", 600, MONO);
    // top data bar
    g.fillStyle = "rgba(0,0,0,0.75)"; g.fillRect(x, y, w, h * 0.075);
    const r = S.radio; const ty = y + h * 0.037; const fs = h * 0.03;
    text(g, `NAV1 ${r.nav1.toFixed(2)} ${S.vor1?.ok ? S.vor1.ident : ""}`, x + 8, ty, fs, "#5be38a", "left", 600, MONO);
    text(g, `COM1 ${r.com1.toFixed(3)} ↔ ${r.com1s.toFixed(3)}`, x + w - 8, ty, fs, "#5be38a", "right", 600, MONO);
    if (S.gps) text(g, `DTO ${S.gps.id}  DIS ${S.gps.dist.toFixed(1)}NM  DTK ${String(Math.round(S.gps.brg)).padStart(3, "0")}°`, cx, ty, fs, "#e64bd0", "center", 600, MONO);
    // HSI
    this.hsi(cx, y + h * 0.83, h * 0.2, S);
    // bottom left: OAT, wind
    text(g, `OAT ${Math.round(d.oatC)}°C`, x + 10, y + h - 14, fs, "#fff", "left", 600, MONO);
    text(g, `XPDR ${ac.xpdr.code} ${ac.xpdr.mode}`, x + w - 10, y + h - 14, fs, ac.xpdr.code === "7700" ? "#ff4d4d" : "#5be38a", "right", 600, MONO);
    if (S.wind) { const bx = x + w * 0.1, by = y + h * 0.86; g.fillStyle = "rgba(0,0,0,0.6)"; g.fillRect(bx - 34, by - 26, 68, 52); g.save(); g.translate(bx - 12, by); g.rotate((S.wind.dir + 180 - d.hdg) * DEG); g.strokeStyle = "#fff"; g.lineWidth = 2; g.beginPath(); g.moveTo(0, 12); g.lineTo(0, -12); g.moveTo(-5, -6); g.lineTo(0, -12); g.lineTo(5, -6); g.stroke(); g.restore(); text(g, `${Math.round(S.wind.kt)}KT`, bx + 14, by, fs, "#fff", "center", 600, MONO); }
    g.fillStyle = "rgba(0,0,0,0.6)"; g.fillRect(x + w * 0.04, cy + h * 0.305, w * 0.13, h * 0.05); text(g, `TAS ${Math.round(d.tas)}KT`, x + w * 0.105, cy + h * 0.33, fs, "#fff", "center", 600, MONO);
    g.fillStyle = "#000"; g.fillRect(x + w * 0.78, cy + h * 0.31, w * 0.14, h * 0.05); text(g, `${ac.inst.kollsman.toFixed(2)}IN`, x + w * 0.85, cy + h * 0.335, fs, "#3fd8f2", "center", 600, MONO);
    this.hits.push({ x: x + w * 0.85, y: cy + h * 0.335, w: w * 0.14, h: h * 0.06, tip: "Baro: scroll to set", wheel: (dir, sh) => this.act.baro?.(dir * (sh ? 0.1 : 0.01)), click: (s) => this.act.baro?.(s * 0.01) });
    if (d.stallWarn) { g.fillStyle = "#ff4d4d"; g.fillRect(cx - 50, y + h * 0.1, 100, 26); text(g, "STALL", cx, y + h * 0.1 + 13, 18, "#000", "center", 800, COND); }
  }
  tape(x, cy, w, h, val, step, pxStep, kind, S) {
    const g = this.g; g.save(); g.beginPath(); g.rect(x, cy - h / 2, w, h); g.clip();
    g.fillStyle = "rgba(10,14,20,0.55)"; g.fillRect(x, cy - h / 2, w, h);
    const fs = Math.max(9, pxStep * 0.42);
    const base = Math.floor(val / step) * step;
    for (let k = -8; k <= 8; k++) {
      const v = base + k * step; const yy = cy - ((v - val) / step) * pxStep;
      if (kind === "spd" && v < 20) continue;
      g.fillStyle = "#fff"; g.fillRect(kind === "spd" ? x + w - 10 : x, yy - 1, 10, 2);
      if (kind === "spd" ? v % 10 === 0 : v % 100 === 0) text(g, String(v), kind === "spd" ? x + w - 16 : x + 14, yy, fs, "#fff", kind === "spd" ? "right" : "left", 600, MONO);
    }
    if (kind === "spd") {
      const band = (a, b, col, off) => { const y0 = cy - ((b - val) / step) * pxStep, y1 = cy - ((a - val) / step) * pxStep; g.fillStyle = col; g.fillRect(x + w - 6 + (off || 0), y0, 6, y1 - y0); };
      band(V.s0, V.fe, "#fff", -6); band(V.s1, V.no, "#1fa84a"); band(V.no, V.ne, "#f2c21f"); band(V.ne, 260, "#e0221b"); band(0, V.s0, "#e0221b");
      for (const [lab, v] of [["R", V.r], ["Y", V.y], ["G", V.glide]]) { const yy = cy - ((v - val) / step) * pxStep; text(g, lab, x + w + 0, yy, fs * 0.9, "#3fd8f2", "left", 700, MONO); }
    }
    g.restore();
    // readout box
    const bw = w * 0.92, bh = pxStep * 0.95; const bx = kind === "spd" ? x + 2 : x + w - bw - 2;
    g.fillStyle = "#000"; g.strokeStyle = "#fff"; g.lineWidth = 1.5; g.beginPath(); g.roundRect(bx, cy - bh / 2, bw, bh, 4); g.fill(); g.stroke();
    text(g, kind === "spd" ? String(Math.round(Math.max(0, val))) : String(Math.round(val / 10) * 10), bx + bw / 2, cy, bh * 0.6, "#fff", "center", 700, MONO);
  }
  hsi(cx, cy, R, S) {
    const g = this.g, d = S.d, ac = S.ac;
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fillStyle = "rgba(10,14,20,0.82)"; g.fill();
    g.save(); g.translate(cx, cy); g.rotate(-d.hi * DEG);
    for (let k = 0; k < 72; k++) tick(g, 0, 0, R * (k % 2 === 0 ? 0.84 : 0.9), R * 0.98, k * 5, k % 6 === 0 ? 2 : 1, "#fff");
    for (let k = 0; k < 12; k++) { g.save(); g.rotate(k * 30 * DEG); text(g, { 0: "N", 3: "E", 6: "S", 9: "W" }[k] ?? String(k * 3), 0, -R * 0.7, R * 0.14, "#fff", "center", 700, MONO); g.restore(); }
    g.save(); g.rotate(ac.inst.hdgBug * DEG); g.fillStyle = "#3fd8f2"; g.fillRect(-R * 0.06, -R * 1.0, R * 0.12, R * 0.08); g.restore();
    // course pointer: GPS (magenta) when a waypoint is active, else VOR (green)
    const useGps = !!S.gps; const crs = useGps ? S.gps.dtk : ac.inst.obs; const dev = useGps ? clamp(-S.gps.xtk / 1.0, -1, 1) : (S.vor1?.ok ? S.vor1.cdi : 0);
    const col = useGps ? "#e64bd0" : "#5be38a";
    g.rotate(crs * DEG); g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, -R * 0.8); g.lineTo(0, -R * 0.38); g.moveTo(0, R * 0.38); g.lineTo(0, R * 0.8); g.stroke();
    g.beginPath(); g.moveTo(0, -R * 0.86); g.lineTo(-7, -R * 0.72); g.lineTo(7, -R * 0.72); g.closePath(); g.fill();
    for (const k of [-2, -1, 1, 2]) { g.beginPath(); g.arc(k * R * 0.17, 0, 2.5, 0, 7); g.strokeStyle = "#fff"; g.lineWidth = 1; g.stroke(); }
    g.fillRect(dev * R * 0.34 - 2, -R * 0.36, 4, R * 0.72);
    g.restore();
    g.fillStyle = "#fff"; g.beginPath(); g.moveTo(cx, cy - R * 0.2); g.lineTo(cx - 6, cy + 8); g.lineTo(cx + 6, cy + 8); g.closePath(); g.fill();
    g.fillStyle = "#000"; g.fillRect(cx - 26, cy - R - 22, 52, 20); g.strokeStyle = "#fff"; g.strokeRect(cx - 26, cy - R - 22, 52, 20);
    text(g, `${String(Math.round(d.hi) % 360).padStart(3, "0")}°`, cx, cy - R - 12, 14, "#fff", "center", 700, MONO);
    this.hits.push({ x: cx + R * 0.95, y: cy + R * 0.9, r: 18, tip: "Heading bug (scroll)", wheel: (dir, sh) => this.act.hdgBug?.(dir * (sh ? 10 : 1)) });
    this.hits.push({ x: cx - R * 0.95, y: cy + R * 0.9, r: 18, tip: "Course / OBS (scroll)", wheel: (dir, sh) => this.act.obs?.(dir * (sh ? 10 : 1)) });
    text(g, "HDG", cx + R * 0.95, cy + R * 0.9, 11, "#3fd8f2", "center", 700, MONO); text(g, "CRS", cx - R * 0.95, cy + R * 0.9, 11, useGps ? "#e64bd0" : "#5be38a", "center", 700, MONO);
  }
  mfd(x, y, w, h, S) {
    const g = this.g, d = S.d;
    const ew = Math.min(130, w * 0.27);
    g.fillStyle = "#05070a"; g.fillRect(x, y, ew, h);
    const fs = Math.max(9, h * 0.034); let yy = y + 14;
    const row = (lab, val, frac, lo = 0.3, hi = 0.85, col = "#5be38a") => {
      text(g, lab, x + 6, yy, fs * 0.85, "#c9ccd1", "left", 700); text(g, val, x + ew - 6, yy, fs, col, "right", 600, MONO); yy += fs * 1.1;
      g.fillStyle = "#222"; g.fillRect(x + 6, yy, ew - 12, 4); g.fillStyle = "#1fa84a"; g.fillRect(x + 6 + (ew - 12) * lo, yy, (ew - 12) * (hi - lo), 4);
      g.fillStyle = "#fff"; g.fillRect(x + 6 + (ew - 12) * clamp(frac, 0, 1) - 1.5, yy - 4, 3, 12); yy += fs * 1.25;
    };
    row("RPM", String(Math.round(d.rpm)), d.rpm / 2900, 2100 / 2900, 2700 / 2900, d.rpm > 2700 ? "#ff4d4d" : "#5be38a");
    row("FFLOW GPH", d.fuelFlow.toFixed(1), d.fuelFlow / 14, 0.05, 0.9);
    row("OIL PRES", "", d.oilP, 0.4, 0.9); row("OIL TEMP", "", d.oilT, 0.35, 0.85);
    row("FUEL L GAL", d.fuelL.toFixed(1), d.fuelL / 20, 0.1, 1); row("FUEL R GAL", d.fuelR.toFixed(1), d.fuelR / 20, 0.1, 1);
    text(g, `VOLTS ${d.volts.toFixed(1)}`, x + 6, yy, fs * 0.9, d.volts < 25 ? "#ffb020" : "#5be38a", "left", 600, MONO); yy += fs * 1.3;
    text(g, `AMPS ${d.amps >= 0 ? "+" : ""}${Math.round(d.amps)}`, x + 6, yy, fs * 0.9, d.amps < 0 ? "#ffb020" : "#5be38a", "left", 600, MONO);
    const mx = x + ew + 4, mw = w - ew - 4;
    const ownTrk = { x: S.ac.pos.x, z: S.ac.pos.z, hdg: d.hdg, trackLine: true };
    drawMap(g, mx, y, mw, h, { base: S.base, cx: S.ac.pos.x, cz: S.ac.pos.z, rangeNm: S.mfdRange || 8, own: ownTrk, route: S.route, style: "mfd" });
    text(g, "MAP", mx + 8, y + h - 12, fs * 0.9, "#fff", "left", 700, MONO);
    this.hits.push({ x: mx + mw - 30, y: y + 24, w: 60, h: 40, tip: "Map range: scroll", wheel: (dir) => this.act.mfdRange?.(dir) });
    g.fillStyle = "rgba(0,0,0,0.6)"; g.fillRect(mx + mw - 58, y + 6, 52, 34); text(g, "RNG", mx + mw - 32, y + 15, 10, "#c9ccd1", "center", 700, MONO); text(g, "− / +", mx + mw - 32, y + 30, 11, "#3fd8f2", "center", 700, MONO);
  }
}
