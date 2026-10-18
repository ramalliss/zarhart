// Zarhart world renderer: terrain, ground texture, water, towns, trees, airports, lights, sky, clouds.
import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import {
  WORLD_HALF, WATER, LAKE, RIVER, HIGHWAY, RAILROAD, TOWNS, OBSTACLES, DAM, LAUNCH, POWER_PLANT,
  AIRPORTS, NAVAIDS, heightAt, inLake, fbm, simplex, rectDist, distPolyline,
} from "./world-data.js";

const DEG = Math.PI / 180;
const W = WORLD_HALF * 2;
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export const forestAt = (x, z) => fbm(x / 2600 + 100, z / 2600 - 50, 3) + 0.18 * simplex(x / 520, z / 520);
const hash2 = (a, b) => { let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

function canvas(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
function glowTexture() {
  const c = canvas(64, 64), g = c.getContext("2d");
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.25, "rgba(255,255,255,0.85)"); r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function puffTexture() {
  const c = canvas(128, 128), g = c.getContext("2d"); const R = rng(7);
  for (let i = 0; i < 22; i++) {
    const x = 34 + R() * 60, y = 40 + R() * 50, r = 14 + R() * 26;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, "rgba(255,255,255,0.55)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function textTexture(text, { bg = "#c61f2d", fg = "#ffffff", w = 256, h = 96, font = "bold 64px Arial", border = null } = {}) {
  const c = canvas(w, h), g = c.getContext("2d");
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  if (border) { g.strokeStyle = border; g.lineWidth = 8; g.strokeRect(6, 6, w - 12, h - 12); }
  g.fillStyle = fg; g.font = font; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, w / 2, h / 2 + 3);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

/* ===================== ground texture (also used by the map) ===================== */
export function buildGroundCanvas(size = 2048) {
  const G = 256; // coarse height grid
  const hg = new Float32Array((G + 1) * (G + 1));
  for (let j = 0; j <= G; j++) for (let i = 0; i <= G; i++) hg[j * (G + 1) + i] = heightAt(-WORLD_HALF + (i / G) * W, -WORLD_HALF + (j / G) * W);
  const F = 384; const fg = new Float32Array((F + 1) * (F + 1)); const lk = new Uint8Array((F + 1) * (F + 1));
  for (let j = 0; j <= F; j++) for (let i = 0; i <= F; i++) {
    const x = -WORLD_HALF + (i / F) * W, z = -WORLD_HALF + (j / F) * W;
    fg[j * (F + 1) + i] = forestAt(x, z); lk[j * (F + 1) + i] = inLake(x, z) ? 1 : 0;
  }
  const bil = (arr, n, u, v) => { const x = u * n, y = v * n; const i = Math.min(n - 1, x | 0), j = Math.min(n - 1, y | 0); const fx = x - i, fy = y - j; const a = arr[j * (n + 1) + i], b = arr[j * (n + 1) + i + 1], c = arr[(j + 1) * (n + 1) + i], d = arr[(j + 1) * (n + 1) + i + 1]; return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy; };
  const cv = canvas(size, size), ctx = cv.getContext("2d");
  const img = ctx.createImageData(size, size); const d = img.data;
  const crops = [[96, 128, 58], [118, 140, 64], [140, 150, 74], [170, 158, 90], [150, 120, 72], [112, 112, 62], [182, 170, 104], [88, 118, 54], [128, 138, 70]];
  const mpp = W / size;
  for (let py = 0; py < size; py++) {
    const v = (py + 0.5) / size; const z = -WORLD_HALF + v * W;
    for (let px = 0; px < size; px++) {
      const u = (px + 0.5) / size; const x = -WORLD_HALF + u * W;
      const h = bil(hg, G, u, v);
      const hx = bil(hg, G, Math.min(1, u + 1 / G), v) - h, hz = bil(hg, G, u, Math.min(1, v + 1 / G)) - h;
      const slope = Math.hypot(hx, hz) / (W / G);
      const f = bil(fg, F, u, v);
      const water = bil(lk, F, u, v) > 0.5;
      let r, g, b;
      if (water) { r = 46; g = 88; b = 112; }
      else {
        // farmland patches on a slightly rotated grid
        const ang = 0.22 + 0.25 * Math.sin(x / 9000);
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const fu = (x * ca + z * sa) / 260, fv = (-x * sa + z * ca) / 190;
        const ci = Math.floor(fu), cj = Math.floor(fv);
        const hsh = hash2(ci, cj);
        const crop = crops[(hsh * crops.length) | 0];
        const edge = Math.min(fu - ci, 1 - (fu - ci), fv - cj, 1 - (fv - cj)) < 0.025;
        r = crop[0]; g = crop[1]; b = crop[2];
        if (edge) { r *= 0.8; g *= 0.85; b *= 0.8; }
        const forest = f > 0.18 || (h > 560 && f > -0.05);
        if (forest) { const k = 0.85 + 0.3 * hash2(px >> 1, py >> 1); r = 44 * k; g = 70 * k; b = 40 * k; }
        if (h > 520) { const t = Math.min(1, (h - 520) / 500); if (!forest) { r = r * (1 - t) + 128 * t; g = g * (1 - t) + 124 * t; b = b * (1 - t) + 96 * t; } }
        if (h > 1050 || slope > 0.55) { const t = Math.min(1, Math.max((h - 1050) / 300, (slope - 0.55) * 2)); r = r * (1 - t) + 122 * t; g = g * (1 - t) + 116 * t; b = b * (1 - t) + 108 * t; }
        if (h > 1650) { const t = Math.min(1, (h - 1650) / 250) * (slope < 0.8 ? 1 : 0.4); r = r * (1 - t) + 236 * t; g = g * (1 - t) + 240 * t; b = b * (1 - t) + 244 * t; }
        const n = 0.9 + 0.2 * hash2(px, py * 7);
        r *= n; g *= n; b *= n;
      }
      const o = (py * size + px) * 4; d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const s = size / W;
  const P = (x, z) => [(x + WORLD_HALF) * s, (z + WORLD_HALF) * s];
  const line = (pts, width, color, dash) => { ctx.beginPath(); pts.forEach(([x, z], i) => { const [a, b] = P(x, z); i ? ctx.lineTo(a, b) : ctx.moveTo(a, b); }); ctx.lineWidth = width; ctx.strokeStyle = color; ctx.setLineDash(dash || []); ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.stroke(); ctx.setLineDash([]); };
  // towns
  for (const t of TOWNS) {
    const [a, b] = P(t.x, t.z); const r = t.r * s;
    const gr = ctx.createRadialGradient(a, b, 0, a, b, r * 1.15);
    gr.addColorStop(0, "rgba(128,124,118,0.95)"); gr.addColorStop(0.7, "rgba(118,122,104,0.75)"); gr.addColorStop(1, "rgba(118,122,104,0)");
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(a, b, r * 1.15, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(70,70,70,0.6)"; ctx.lineWidth = Math.max(1, 9 * s);
    for (let k = -r; k <= r; k += 85 * s) { ctx.beginPath(); ctx.moveTo(a - r, b + k); ctx.lineTo(a + r, b + k); ctx.stroke(); ctx.beginPath(); ctx.moveTo(a + k, b - r); ctx.lineTo(a + k, b + r); ctx.stroke(); }
  }
  line(RIVER.pts, Math.max(2, 55 * s), "#2e5870");
  line(HIGHWAY.pts, Math.max(2, 26 * s), "#6b6a66"); line(HIGHWAY.pts, Math.max(1, 6 * s), "#9a988e", [6, 6]);
  line(RAILROAD.pts, Math.max(1.4, 10 * s), "#3f342c");
  // airport grass
  for (const ap of AIRPORTS) for (const r of ap.flat) {
    ctx.save(); const [a, b] = P(r.cx, r.cz); ctx.translate(a, b); ctx.rotate(r.hdg * DEG);
    ctx.fillStyle = "rgba(120,150,84,0.9)"; ctx.fillRect(-(r.wid / 2 + 90) * s, -(r.len / 2 + 120) * s, (r.wid + 180) * s, (r.len + 240) * s); ctx.restore();
  }
  // launch complex
  { const [a, b] = P(LAUNCH.x, LAUNCH.z); ctx.fillStyle = "#9b9890"; ctx.beginPath(); ctx.arc(a, b, 220 * s, 0, Math.PI * 2); ctx.fill(); }
  { const [a, b] = P(POWER_PLANT.x, POWER_PLANT.z); ctx.fillStyle = "#8d8a84"; ctx.fillRect(a - 260 * s, b - 160 * s, 520 * s, 320 * s); }
  return cv;
}

/* ===================== terrain mesh ===================== */
function buildTerrain(groundCanvas, quality) {
  const N = quality === "low" ? 256 : 400;
  const pos = new Float32Array((N + 1) * (N + 1) * 3), uv = new Float32Array((N + 1) * (N + 1) * 2);
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const k = j * (N + 1) + i;
    const x = -WORLD_HALF + (i / N) * W, z = -WORLD_HALF + (j / N) * W;
    pos[k * 3] = x; pos[k * 3 + 1] = heightAt(x, z) - 0.6; pos[k * 3 + 2] = z;
    uv[k * 2] = i / N; uv[k * 2 + 1] = 1 - j / N;
  }
  const idx = new Uint32Array(N * N * 6); let p = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
    idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const tex = new THREE.CanvasTexture(groundCanvas);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
  const mat = new THREE.MeshLambertMaterial({ map: tex });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vWPos;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>
varying vec3 vWPos;
float zh(vec2 p){ p = mod(p, 289.0); return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float zn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(zh(i), zh(i+vec2(1,0)), f.x), mix(zh(i+vec2(0,1)), zh(i+vec2(1,1)), f.x), f.y); }`)
      .replace("#include <map_fragment>", `#include <map_fragment>
float dn = zn(vWPos.xz / 3.5) * 0.35 + zn(vWPos.xz / 17.0) * 0.4 + zn(vWPos.xz / 70.0) * 0.25;
diffuseColor.rgb *= 0.84 + 0.3 * dn;`);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = false;
  // a big skirt beyond the edge so the horizon never shows a hole
  const skirt = new THREE.Mesh(new THREE.RingGeometry(WORLD_HALF * 1.38, WORLD_HALF * 9, 64, 1), new THREE.MeshLambertMaterial({ color: 0x5f7148 }));
  skirt.rotation.x = -Math.PI / 2; skirt.position.y = 110;
  const edge = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.6, W * 1.6), new THREE.MeshLambertMaterial({ color: 0x5f7148 }));
  edge.rotation.x = -Math.PI / 2; edge.position.y = 60;
  const g = new THREE.Group(); g.add(mesh, skirt, edge);
  return { group: g, material: mat, texture: tex };
}

/* ===================== water, roads ===================== */
function buildWater() {
  const g = new THREE.Group();
  const pts = [];
  for (let k = 0; k < 160; k++) {
    const a = (k / 160) * Math.PI * 2; let lo = 0, hi = 2.2;
    for (let it = 0; it < 26; it++) { const m = (lo + hi) / 2; const c = Math.cos(LAKE.rot), s = Math.sin(LAKE.rot); const u = Math.cos(a) * LAKE.rx * m, v = Math.sin(a) * LAKE.rz * m; const x = LAKE.x + u * c - v * s, z = LAKE.z + u * s + v * c; if (inLake(x, z)) lo = m; else hi = m; }
    const m = lo * 1.05; const c = Math.cos(LAKE.rot), s = Math.sin(LAKE.rot); const u = Math.cos(a) * LAKE.rx * m, v = Math.sin(a) * LAKE.rz * m;
    pts.push(new THREE.Vector2(LAKE.x + u * c - v * s, -(LAKE.z + u * s + v * c)));
  }
  const shape = new THREE.Shape(pts);
  const water = new THREE.Mesh(new THREE.ShapeGeometry(shape, 1), new THREE.MeshPhongMaterial({ color: 0x2a5872, specular: 0x9fc4dd, shininess: 90, transparent: true, opacity: 0.93 }));
  water.rotation.x = -Math.PI / 2; water.position.y = WATER;
  g.add(water);
  g.add(ribbon(RIVER.pts, 48, 0x2b5670, 0.9, 60, { phong: true }));
  g.add(ribbon(HIGHWAY.pts, 16, 0x55565a, 0.45, 120));
  g.add(ribbon(RAILROAD.pts, 5, 0x3a2f28, 0.35, 120));
  // dam
  const dam = new THREE.Mesh(new THREE.BoxGeometry(DAM.len, 26, 14), new THREE.MeshLambertMaterial({ color: 0xa8a49a }));
  dam.position.set(DAM.x, WATER - 6, DAM.z); dam.rotation.y = -DAM.rot; g.add(dam);
  return g;
}
function ribbon(pts, width, color, lift, step, opt = {}) {
  const verts = [], idx = [];
  const dense = [];
  for (let i = 0; i < pts.length - 1; i++) { const [ax, az] = pts[i], [bx, bz] = pts[i + 1]; const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step)); for (let k = 0; k < n; k++) dense.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]); }
  dense.push(pts[pts.length - 1]);
  dense.forEach(([x, z], i) => {
    const [px, pz] = dense[Math.max(0, i - 1)], [nx, nz] = dense[Math.min(dense.length - 1, i + 1)];
    let dx = nx - px, dz = nz - pz; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const ox = -dz * width / 2, oz = dx * width / 2;
    const hA = heightAt(x + ox, z + oz), hB = heightAt(x - ox, z - oz);
    const hl = opt.phong ? Math.max(Math.min(hA, hB), WATER - 20) : Math.max(hA, hB);
    verts.push(x + ox, hl + lift, z + oz, x - ox, hl + lift, z - oz);
    if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3)); geo.setIndex(idx); geo.computeVertexNormals();
  const mat = opt.phong ? new THREE.MeshPhongMaterial({ color, specular: 0x88aacc, shininess: 60, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 })
    : new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
  return new THREE.Mesh(geo, mat);
}

/* ===================== towns, trees ===================== */
function nearAirport(x, z, pad = 350) { for (const ap of AIRPORTS) for (const r of ap.flat) if (rectDist(x, z, r, pad) < 0) return true; return false; }
function buildTowns() {
  const R = rng(32);
  const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
  const all = [];
  for (const t of TOWNS) {
    const rot = R() * 0.6;
    for (let gx = -t.r; gx <= t.r; gx += 42) for (let gz = -t.r; gz <= t.r; gz += 42) {
      const dist = Math.hypot(gx, gz) / t.r; if (dist > 1) continue;
      if (R() > (1 - dist * 0.75) * t.pop) continue;
      const ox = gx + (R() - 0.5) * 14, oz = gz + (R() - 0.5) * 14;
      const x = t.x + ox * Math.cos(rot) - oz * Math.sin(rot), z = t.z + ox * Math.sin(rot) + oz * Math.cos(rot);
      if (inLake(x, z) || nearAirport(x, z, 150) || distPolyline(x, z, RIVER.pts) < 60) continue;
      const core = dist < 0.25;
      const w = 10 + R() * 18, l = 10 + R() * 22, h = core ? 10 + R() * (t.pop > 0.8 ? 38 : 16) : 5 + R() * 7;
      all.push({ x, z, w, l, h, rot, c: core ? 0.62 + R() * 0.25 : 0.5 + R() * 0.4, roof: R() });
    }
  }
  const mesh = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial({ color: 0xffffff }), all.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
  all.forEach((b, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -b.rot);
    m4.compose(new THREE.Vector3(b.x, heightAt(b.x, b.z) - 0.5, b.z), q, new THREE.Vector3(b.w, b.h, b.l));
    mesh.setMatrixAt(i, m4);
    if (b.roof < 0.3) col.setRGB(0.55 * b.c + 0.25, 0.32 * b.c + 0.1, 0.26 * b.c + 0.08); else col.setRGB(b.c, b.c * 0.98, b.c * 0.94);
    mesh.setColorAt(i, col);
  });
  return mesh;
}
function buildTrees(quality) {
  const R = rng(1937);
  const target = quality === "low" ? 4000 : 14000;
  const geo = new THREE.ConeGeometry(1, 1, 6, 1); geo.translate(0, 0.5, 0);
  const pts = [];
  let tries = 0;
  while (pts.length < target && tries < target * 30) {
    tries++;
    const x = (R() * 2 - 1) * 26000, z = (R() * 2 - 1) * 26000;
    const f = forestAt(x, z); if (f < 0.24) continue;
    if (inLake(x, z) || nearAirport(x, z) || distPolyline(x, z, RIVER.pts) < 70 || distPolyline(x, z, HIGHWAY.pts) < 30) continue;
    const h = heightAt(x, z); if (h > 1150) continue;
    let inTown = false; for (const t of TOWNS) if (Math.hypot(x - t.x, z - t.z) < t.r * 1.05) inTown = true; if (inTown) continue;
    pts.push([x, h, z]);
  }
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xffffff }), pts.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
  pts.forEach(([x, h, z], i) => {
    const s = 9 + R() * 12; const r = s * (0.28 + R() * 0.12);
    m4.compose(new THREE.Vector3(x, h - 0.5, z), q, new THREE.Vector3(r, s, r)); mesh.setMatrixAt(i, m4);
    col.setRGB(0.12 + R() * 0.08, 0.22 + R() * 0.12, 0.1 + R() * 0.06); mesh.setColorAt(i, col);
  });
  return mesh;
}

/* ===================== airports ===================== */
function runwayCanvas(r, ap) {
  const Wpx = 128, Hpx = Math.min(4096, Math.round(r.len * 2.4));
  const c = canvas(Wpx, Hpx), g = c.getContext("2d");
  const sx = Wpx / r.wid, sy = Hpx / r.len;
  if (r.surface === "grass") {
    for (let y = 0; y < Hpx; y += 24) { g.fillStyle = (y / 24) % 2 ? "#5f7f3e" : "#68884a"; g.fillRect(0, y, Wpx, 24); }
    g.fillStyle = "#fff"; for (const yy of [0, Hpx - 6]) for (const xx of [0, Wpx - 6]) g.fillRect(xx, yy, 6, 6);
    return c;
  }
  g.fillStyle = "#3b3e43"; g.fillRect(0, 0, Wpx, Hpx);
  const R = rng(r.len); for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(${R() > 0.5 ? 255 : 0},${R() > 0.5 ? 255 : 0},${R() > 0.5 ? 255 : 0},0.035)`; g.fillRect(R() * Wpx, R() * Hpx, 2, 2 + R() * 6); }
  for (let i = 0; i < 40; i++) { g.fillStyle = "rgba(10,10,10,0.18)"; g.fillRect(Wpx * 0.35 + R() * Wpx * 0.3, R() * Hpx, 4 + R() * 8, 30 + R() * 90); } // tyre marks
  g.fillStyle = "#e9e9e4";
  g.fillRect(1 * sx, 0, 0.9 * sx, Hpx); g.fillRect(Wpx - 1.9 * sx, 0, 0.9 * sx, Hpx); // side stripes
  // centerline: 36 m stripe, 24 m gap, 0.45 m wide (drawn a bit wider so it reads)
  for (let y = 70; y < r.len - 70; y += 60) g.fillRect(Wpx / 2 - 0.5 * sx, Hpx - (y + 36) * sy, 1.0 * sx, 36 * sy);
  // ends: draw for the bottom end (ends[0]) upright, then rotate for the top end
  const drawEnd = (id) => {
    const stripes = r.wid >= 30 ? 8 : 6; const sw = 1.8, gap = (r.wid - 6 - stripes * sw) / (stripes - 1);
    for (let k = 0; k < stripes; k++) { const xx = 3 + k * (sw + gap) + (k >= stripes / 2 ? 0.0 : 0); g.fillRect(xx * sx, Hpx - (6 + 30) * sy, sw * sx, 30 * sy); }
    g.fillRect(0, Hpx - 2 * sy, Wpx, 1.2 * sy); // threshold bar
    g.save(); g.translate(Wpx / 2, Hpx - 52 * sy); g.scale(1, (18 * sy) / (0.72 * 64)); g.font = "bold 64px Arial"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(id.replace(/^0/, ""), 0, 0); g.restore();
    // aiming point
    g.fillRect(Wpx / 2 - (r.wid * 0.3) * sx - 6 * sx, Hpx - (300 + 45) * sy, 6 * sx, 45 * sy); g.fillRect(Wpx / 2 + (r.wid * 0.3) * sx, Hpx - (300 + 45) * sy, 6 * sx, 45 * sy);
    if (r.tdz) for (const [d, n] of [[150, 3], [450, 2], [600, 2], [750, 1]]) for (let k = 0; k < n; k++) { g.fillRect(Wpx / 2 - 8 * sx - k * 3 * sx, Hpx - (d + 22) * sy, 1.8 * sx, 22 * sy); g.fillRect(Wpx / 2 + 6.2 * sx + k * 3 * sx, Hpx - (d + 22) * sy, 1.8 * sx, 22 * sy); }
  };
  drawEnd(r.ends[0].id);
  g.save(); g.translate(Wpx, Hpx); g.rotate(Math.PI); drawEnd(r.ends[1].id); g.restore();
  return c;
}
function holdShortTexture() {
  const c = canvas(64, 64), g = c.getContext("2d");
  g.clearRect(0, 0, 64, 64); g.fillStyle = "#f2c21f";
  g.fillRect(0, 4, 64, 5); g.fillRect(0, 16, 64, 5); // solid (hold side, top)
  for (let x = 0; x < 64; x += 16) { g.fillRect(x, 32, 9, 5); g.fillRect(x, 44, 9, 5); } // dashed (runway side)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function buildSign(text, kind) {
  const grp = new THREE.Group();
  const tex = kind === "mandatory" ? textTexture(text, { bg: "#c61f2d", fg: "#fff", border: "#111" })
    : kind === "location" ? textTexture(text, { bg: "#111", fg: "#f2c21f", border: "#f2c21f" })
      : textTexture(text, { bg: "#f2c21f", fg: "#111" });
  const face = new THREE.MeshBasicMaterial({ map: tex });
  const side = new THREE.MeshLambertMaterial({ color: 0x222222 });
  const w = Math.max(2.2, text.length * 0.55);
  const box = new THREE.Mesh(new THREE.BoxGeometry(w, 0.9, 0.25), [side, side, side, side, face, face]);
  box.position.y = 0.85; grp.add(box);
  for (const sx of [-w / 2 + 0.2, w / 2 - 0.2]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.08), side); leg.position.set(sx, 0.25, 0); grp.add(leg); }
  return grp;
}
function planeGroup(len, wid, hdg) {
  const geo = new THREE.PlaneGeometry(wid, len); geo.rotateX(-Math.PI / 2); geo.rotateY(-hdg * DEG); return geo;
}

function buildAirports(lightsTex, renderer) {
  const root = new THREE.Group();
  const lights = { kzar: [], kame: [], taxi: [], vasi: [], beacons: [], gun: null, pcl: null };
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const taxiMat = new THREE.MeshLambertMaterial({ color: 0x45484c, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const apronMat = new THREE.MeshLambertMaterial({ color: 0x6d6f70, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const yellowMat = new THREE.MeshBasicMaterial({ color: 0xd8ac1c, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
  const hsTex = holdShortTexture();
  const ptsMat = (size) => new THREE.PointsMaterial({ size, sizeAttenuation: false, map: lightsTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  for (const ap of AIRPORTS) {
    const y = ap.elev;
    const edgePts = [], edgeCol = [];
    const pushL = (x, z, c) => { edgePts.push(x, y + 0.6, z); edgeCol.push(c.r, c.g, c.b); };
    const white = new THREE.Color(1, 0.96, 0.85), green = new THREE.Color(0.2, 1, 0.35), red = new THREE.Color(1, 0.15, 0.1), blue = new THREE.Color(0.25, 0.4, 1);
    for (const r of ap.runways) {
      const tex = new THREE.CanvasTexture(runwayCanvas(r, ap)); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = maxAniso;
      const mesh = new THREE.Mesh(planeGroup(r.len, r.wid, r.hdg), new THREE.MeshLambertMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
      mesh.position.set(r.cx, y + 0.02, r.cz); root.add(mesh);
      if (r.lights) {
        const [dx, dz] = r.dir; const px = -dz, pz = dx;
        for (let s = 0; s <= r.len; s += 60) for (const side of [-1, 1]) pushL(r.ends[0].x + dx * s + px * side * (r.wid / 2 + 1), r.ends[0].z + dz * s + pz * side * (r.wid / 2 + 1), white);
        for (const e of [0, 1]) for (let k = -3; k <= 3; k++) {
          const ex = r.ends[e].x, ez = r.ends[e].z, sgn = e === 0 ? -1 : 1;
          pushL(ex + px * k * (r.wid / 7) + dx * sgn * 1.5, ez + pz * k * (r.wid / 7) + dz * sgn * 1.5, green);
          pushL(ex + px * k * (r.wid / 7) - dx * sgn * 1.0, ez + pz * k * (r.wid / 7) - dz * sgn * 1.0, red);
        }
      }
      // VASI: two bars on the left side of each listed end
      for (const endId of r.vasi || []) {
        const e = r.ends.find((q) => q.id === endId); const hd = e.hdg * DEG; const fx = Math.sin(hd), fz = -Math.cos(hd); const lx = -fz * -1, lz = fx * -1; // left of landing direction
        const lft = [-Math.cos(hd), -Math.sin(hd)];
        for (const [dist, ang] of [[150, 2.75], [300, 3.25]]) { // beams bracket a 3° glidepath aimed between the bars
          const bx = e.x + fx * dist + lft[0] * (r.wid / 2 + 15), bz = e.z + fz * dist + lft[1] * (r.wid / 2 + 15);
          const geo = new THREE.BufferGeometry(); const p = [], c = [];
          for (let k = 0; k < 3; k++) { p.push(bx + lft[0] * k * 6, y + 0.9, bz + lft[1] * k * 6); c.push(1, 1, 1); }
          geo.setAttribute("position", new THREE.Float32BufferAttribute(p, 3)); geo.setAttribute("color", new THREE.Float32BufferAttribute(c, 3));
          const pts = new THREE.Points(geo, ptsMat(7)); root.add(pts);
          for (let k = 0; k < 3; k++) { const box = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 0.8), new THREE.MeshLambertMaterial({ color: 0x333333 })); box.position.set(bx + lft[0] * k * 6, y + 0.4, bz + lft[1] * k * 6); box.rotation.y = -hd; root.add(box); }
          lights.vasi.push({ pts, x: bx, z: bz, y: y + 0.9, ang, ap: ap.id, end: endId });
          void lx; void lz;
        }
      }
    }
    for (const t of ap.taxiways) {
      const m = new THREE.Mesh(planeGroup(t.len, t.wid, t.hdg), t.surface === "grass" ? new THREE.MeshLambertMaterial({ color: 0x6b8a4c }) : taxiMat); m.position.set(t.cx, y + 0.015, t.cz); root.add(m);
      if (t.surface !== "grass") {
        const cl = new THREE.Mesh(planeGroup(t.len, 0.35, t.hdg), yellowMat); cl.position.set(t.cx, y + 0.03, t.cz); root.add(cl);
        const s = Math.sin(t.hdg * DEG), c = -Math.cos(t.hdg * DEG); const px = -c, pz = s;
        for (let d = -t.len / 2; d <= t.len / 2; d += 30) for (const side of [-1, 1]) { edgePts.push(t.cx + s * d + px * side * (t.wid / 2 + 0.8), y + 0.4, t.cz + c * d + pz * side * (t.wid / 2 + 0.8)); edgeCol.push(blue.r, blue.g, blue.b); }
      }
    }
    for (const a of ap.aprons) { const m = new THREE.Mesh(planeGroup(a.len, a.wid, a.hdg), a.surface === "grass" ? new THREE.MeshLambertMaterial({ color: 0x6b8a4c }) : apronMat); m.position.set(a.cx, y + 0.01, a.cz); root.add(m); }
    // hold-short markings and mandatory signs
    for (const h of ap.holdShort) {
      // which way is the runway? the nearest runway centre is on the dashed side
      let best = null, bd = Infinity; for (const r of ap.runways) { const d = Math.abs(rectDist(h.x, h.z, { ...r, wid: 0.01 })); if (d < bd) { bd = d; best = r; } }
      const toR = new THREE.Vector2(best.cx - h.x, best.cz - h.z);
      // project to the runway line instead of the centre
      const dx = best.dir[0], dz = best.dir[1]; const t = (h.x - best.cx) * dx + (h.z - best.cz) * dz; toR.set(best.cx + dx * t - h.x, best.cz + dz * t - h.z).normalize();
      const geo = new THREE.PlaneGeometry(16, 10); geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: hsTex, transparent: true, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 }));
      // texture top (-z local) = solid lines = away from runway
      m.rotation.y = Math.atan2(toR.x, toR.y);
      m.position.set(h.x, y + 0.04, h.z); root.add(m);
      const sign = buildSign(h.sign, "mandatory"); const loc = buildSign(h.twy, "location");
      const sideX = -toR.y, sideZ = toR.x;
      sign.position.set(h.x + sideX * 13 - toR.x * 3, y, h.z + sideZ * 13 - toR.y * 3); sign.rotation.y = Math.atan2(-toR.x, -toR.y) + Math.PI; root.add(sign);
      loc.position.set(h.x + sideX * 13 - toR.x * 3 + toR.x * -0.01 + sideX * 3.4, y, h.z + sideZ * 13 - toR.y * 3 + sideZ * 3.4); loc.rotation.y = sign.rotation.y; root.add(loc);
    }
    for (const h of ap.rwyHold || []) {
      const r = ap.runways[0]; const sign = buildSign(h.sign, "mandatory");
      sign.position.set(h.x, y, h.z + (h.z < 0 ? -0 : 0)); sign.rotation.y = h.z < 0 ? -Math.PI / 2 : Math.PI / 2; root.add(sign); void r;
    }
    // lights object
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(edgePts, 3)); geo.setAttribute("color", new THREE.Float32BufferAttribute(edgeCol, 3));
    const pts = new THREE.Points(geo, ptsMat(4)); pts.visible = false; root.add(pts);
    if (ap.id === "KAME") lights.pcl = pts; else (ap.id === "KZAR" ? lights.kzar : lights.taxi).push(pts);
    // buildings
    for (const [hx, hz, w, l] of ap.hangars || []) {
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, 7, l), new THREE.MeshLambertMaterial({ color: 0xb9bcc0 })); body.position.set(hx, y + 3.5, hz); root.add(body);
      const roof = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, l, 18, 1, false, -Math.PI / 2, Math.PI), new THREE.MeshLambertMaterial({ color: 0x8e9499 }));
      roof.rotation.x = Math.PI / 2; roof.scale.set(1, 1, 0.35); roof.position.set(hx, y + 7, hz); root.add(roof);
    }
    if (ap.tower) {
      const t = ap.tower; const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.2, 24, 12), new THREE.MeshLambertMaterial({ color: 0xd6d3cc })); shaft.position.set(t.x, y + 12, t.z); root.add(shaft);
      const cab = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 4.5, 4.2, 8), new THREE.MeshPhongMaterial({ color: 0x2f5560, emissive: 0x0c2a22, shininess: 100, specular: 0xaaccdd })); cab.position.set(t.x, y + 26.2, t.z); root.add(cab);
      const roof = new THREE.Mesh(new THREE.CylinderGeometry(6.2, 6.2, 0.8, 8), new THREE.MeshLambertMaterial({ color: 0x444444 })); roof.position.set(t.x, y + 28.7, t.z); root.add(roof);
      const gg = new THREE.BufferGeometry(); gg.setAttribute("position", new THREE.Float32BufferAttribute([t.x + 3, y + 26.5, t.z + 4], 3)); gg.setAttribute("color", new THREE.Float32BufferAttribute([0, 1, 0], 3));
      lights.gun = new THREE.Points(gg, ptsMat(16)); lights.gun.visible = false; root.add(lights.gun);
    }
    if (ap.beacon) {
      const b = ap.beacon; const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 22, 6), new THREE.MeshLambertMaterial({ color: 0x9a9a9a })); pole.position.set(b.x, y + 11, b.z); root.add(pole);
      const bg = new THREE.BufferGeometry(); bg.setAttribute("position", new THREE.Float32BufferAttribute([b.x, y + 23, b.z], 3)); bg.setAttribute("color", new THREE.Float32BufferAttribute([1, 1, 1], 3));
      const p = new THREE.Points(bg, ptsMat(12)); p.visible = false; root.add(p); lights.beacons.push(p);
    }
    if (ap.windsock) {
      const w = ap.windsock; const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 6, 6), new THREE.MeshLambertMaterial({ color: 0xdddddd })); pole.position.set(w.x, y + 3, w.z); root.add(pole);
      const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.18, 3.4, 10, 1, true), new THREE.MeshLambertMaterial({ color: 0xff6a1a, side: THREE.DoubleSide }));
      sock.geometry.translate(0, -1.7, 0);
      const pivot = new THREE.Group(); pivot.position.set(w.x, y + 6, w.z); pivot.add(sock); root.add(pivot);
      (lights.socks ||= []).push({ pivot, sock });
    }
    if (ap.segmentedCircle) {
      const sc = ap.segmentedCircle; const mat = new THREE.MeshLambertMaterial({ color: 0xf3f3ef });
      for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; const seg = new THREE.Mesh(new THREE.BoxGeometry(6, 0.5, 1.4), mat); seg.position.set(sc.x + Math.cos(a) * sc.r, y + 0.25, sc.z + Math.sin(a) * sc.r); seg.rotation.y = -a + Math.PI / 2; root.add(seg); }
      // L-shaped traffic pattern indicators: long leg along the runway, short leg toward the pattern side (west)
      for (const sgn of [-1, 1]) {
        const long = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 14), mat); long.position.set(sc.x, y + 0.25, sc.z + sgn * (sc.r + 10)); root.add(long);
        const short = new THREE.Mesh(new THREE.BoxGeometry(7, 0.5, 1.4), mat); short.position.set(sc.x - 3.5, y + 0.25, sc.z + sgn * (sc.r + 16.3)); root.add(short);
      }
    }
    // parked airplanes are added by the caller (they reuse the airplane model)
  }
  return { root, lights };
}

/* ===================== landmarks ===================== */
function bandTexture(colors, n = 7) { const c = canvas(4, 64), g = c.getContext("2d"); for (let i = 0; i < n; i++) { g.fillStyle = colors[i % colors.length]; g.fillRect(0, (i * 64) / n, 4, 64 / n + 1); } const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
function buildLandmarks(lightsTex) {
  const g = new THREE.Group(); const blinkers = [];
  const ptsMat = (size) => new THREE.PointsMaterial({ size, sizeAttenuation: false, map: lightsTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const banded = new THREE.MeshLambertMaterial({ map: bandTexture(["#d23a2a", "#f1efe9"]) });
  for (const o of OBSTACLES) {
    const base = heightAt(o.x, o.z);
    if (o.type === "mast") {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.4, o.hAgl, 6), banded); m.position.set(o.x, base + o.hAgl / 2, o.z); g.add(m);
    } else {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(3, 5, o.hAgl, 14), new THREE.MeshLambertMaterial({ map: bandTexture(["#d23a2a", "#b9b6ae", "#b9b6ae", "#b9b6ae", "#b9b6ae", "#b9b6ae"], 14) })); m.position.set(o.x, base + o.hAgl / 2, o.z); g.add(m);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute([o.x, base + o.hAgl + 1, o.z, o.x, base + o.hAgl / 2, o.z], 3)); geo.setAttribute("color", new THREE.Float32BufferAttribute([1, 0.1, 0.05, 1, 0.1, 0.05], 3));
    const p = new THREE.Points(geo, ptsMat(7)); g.add(p); blinkers.push(p);
  }
  // power plant: cooling towers + buildings
  { const base = heightAt(POWER_PLANT.x, POWER_PLANT.z); const prof = []; for (let i = 0; i <= 12; i++) { const t = i / 12; prof.push(new THREE.Vector2(38 - 22 * Math.sin(t * Math.PI * 0.85) + 10 * t, t * 110)); }
    for (const dx of [-120, 60]) { const ct = new THREE.Mesh(new THREE.LatheGeometry(prof, 24), new THREE.MeshLambertMaterial({ color: 0xbab7af, side: THREE.DoubleSide })); ct.position.set(POWER_PLANT.x + dx, base, POWER_PLANT.z + 90); g.add(ct); }
    const hall = new THREE.Mesh(new THREE.BoxGeometry(160, 40, 70), new THREE.MeshLambertMaterial({ color: 0x9fa3a6 })); hall.position.set(POWER_PLANT.x + 120, base + 20, POWER_PLANT.z - 40); g.add(hall); }
  // launch complex: pad, tower, rocket
  { const base = LAUNCH.h; const pad = new THREE.Mesh(new THREE.CylinderGeometry(60, 64, 3, 32), new THREE.MeshLambertMaterial({ color: 0xa9a7a0 })); pad.position.set(LAUNCH.x, base + 1.5, LAUNCH.z); g.add(pad);
    const lat = canvas(32, 32), lg = lat.getContext("2d"); lg.strokeStyle = "#c8402e"; lg.lineWidth = 3; lg.strokeRect(1, 1, 30, 30); lg.beginPath(); lg.moveTo(0, 0); lg.lineTo(32, 32); lg.moveTo(32, 0); lg.lineTo(0, 32); lg.stroke();
    const lt = new THREE.CanvasTexture(lat); lt.wrapS = lt.wrapT = THREE.RepeatWrapping; lt.repeat.set(1, 9);
    const tower = new THREE.Mesh(new THREE.BoxGeometry(9, 78, 9), new THREE.MeshLambertMaterial({ map: lt, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide })); tower.position.set(LAUNCH.x + 14, base + 3 + 39, LAUNCH.z); g.add(tower);
    const rocketTex = bandTexture(["#f4f4f2", "#f4f4f2", "#111111", "#f4f4f2", "#f4f4f2", "#f4f4f2", "#111111", "#f4f4f2"], 8);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 52, 20), new THREE.MeshLambertMaterial({ map: rocketTex })); body.position.set(LAUNCH.x, base + 3 + 26 + 4, LAUNCH.z); g.add(body);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(2.1, 9, 20), new THREE.MeshLambertMaterial({ color: 0xf4f4f2 })); nose.position.set(LAUNCH.x, base + 3 + 52 + 4 + 4.5, LAUNCH.z); g.add(nose);
    for (let k = 0; k < 4; k++) { const fin = new THREE.Mesh(new THREE.BoxGeometry(0.3, 6, 3.4), new THREE.MeshLambertMaterial({ color: 0x111111 })); const a = k * Math.PI / 2; fin.position.set(LAUNCH.x + Math.cos(a) * 2.9, base + 3 + 7, LAUNCH.z + Math.sin(a) * 2.9); fin.rotation.y = -a; g.add(fin); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute([LAUNCH.x + 14, base + 84, LAUNCH.z], 3)); geo.setAttribute("color", new THREE.Float32BufferAttribute([1, 0.1, 0.05], 3));
    const p = new THREE.Points(geo, ptsMat(7)); g.add(p); blinkers.push(p); }
  // VOR shelters ("white bowling pins")
  for (const n of NAVAIDS) { const base = heightAt(n.x, n.z); const s = new THREE.Mesh(new THREE.CylinderGeometry(4, 6, 4, 16), new THREE.MeshLambertMaterial({ color: 0xf1f1ee })); s.position.set(n.x, base + 2, n.z); g.add(s); const c = new THREE.Mesh(new THREE.ConeGeometry(2.4, 5, 12), new THREE.MeshLambertMaterial({ color: 0xf1f1ee })); c.position.set(n.x, base + 6.5, n.z); g.add(c); }
  return { group: g, blinkers };
}

/* ===================== clouds ===================== */
const cloudVS = `
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv; varying float vShade;
void main(){
  vUv = uv;
  vec3 center = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float scale = length(instanceMatrix[0].xyz);
  vec4 mvPosition = viewMatrix * vec4(center, 1.0);
  mvPosition.xy += position.xy * scale;
  vShade = clamp(position.y + 0.5, 0.0, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}`;
const cloudFS = `
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
uniform sampler2D map; uniform vec3 litColor; uniform vec3 shadeColor; uniform float opacity;
varying vec2 vUv; varying float vShade;
void main(){
  #include <logdepthbuf_fragment>
  vec4 t = texture2D(map, vUv);
  vec3 col = mix(shadeColor, litColor, clamp(vShade * 0.7 + t.a * 0.5, 0.0, 1.0));
  gl_FragColor = vec4(col, t.a * opacity);
  #include <fog_fragment>
}`;
export class Clouds {
  constructor(scene) {
    this.scene = scene; this.mesh = null; this.layer = null; this.clusters = [];
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: puffTexture() }, litColor: { value: new THREE.Color(1, 1, 1) }, shadeColor: { value: new THREE.Color(0.62, 0.66, 0.72) }, opacity: { value: 0.95 } }]),
      vertexShader: cloudVS, fragmentShader: cloudFS, transparent: true, depthWrite: false, fog: true,
    });
    this.material.uniforms.map.value = puffTexture();
  }
  /** layers: [{ cover: 'FEW'|'SCT'|'BKN'|'OVC', baseMsl (m) }] */
  build(layers) {
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh = null; }
    if (this.layer) { this.scene.remove(this.layer); this.layer = null; }
    this.clusters = []; this.ovc = null;
    const R = rng(4500);
    const puffs = [];
    for (const L of layers) {
      const frac = { FEW: 0.12, SCT: 0.35, BKN: 0.7, OVC: 1 }[L.cover] || 0;
      if (!frac) continue;
      const thick = L.cover === "OVC" ? 500 : L.cover === "BKN" ? 700 : 600;
      const n = Math.round(frac * 260);
      for (let i = 0; i < n; i++) {
        const cx = (R() * 2 - 1) * 28000, cz = (R() * 2 - 1) * 28000;
        const rad = 450 + R() * 900 * (0.6 + frac);
        const top = L.baseMsl + thick * (0.5 + R() * 0.6);
        this.clusters.push({ x: cx, z: cz, r: rad, base: L.baseMsl, top });
        const k = 5 + Math.round(R() * 7);
        for (let j = 0; j < k; j++) {
          const a = R() * Math.PI * 2, d = Math.sqrt(R()) * rad * 0.8;
          const yy = L.baseMsl + 60 + R() * (top - L.baseMsl - 60);
          puffs.push([cx + Math.cos(a) * d, yy, cz + Math.sin(a) * d, 380 + R() * 420]);
        }
      }
      if (L.cover === "OVC") {
        const geo = new THREE.PlaneGeometry(WORLD_HALF * 4, WORLD_HALF * 4); geo.rotateX(Math.PI / 2);
        this.layer = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0xb8bec6, side: THREE.DoubleSide, transparent: true, opacity: 0.97, depthWrite: false }));
        this.layer.position.y = L.baseMsl + 60; this.scene.add(this.layer);
        this.ovc = { base: L.baseMsl, top: L.baseMsl + thick };
      }
    }
    if (!puffs.length) return;
    const geo = new THREE.PlaneGeometry(1, 1);
    this.mesh = new THREE.InstancedMesh(geo, this.material, puffs.length);
    const m4 = new THREE.Matrix4();
    puffs.forEach(([x, y, z, s], i) => { m4.makeScale(s, s, s); m4.setPosition(x, y, z); this.mesh.setMatrixAt(i, m4); });
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 2;
    this.scene.add(this.mesh);
  }
  setLight(sunColor, shade) { this.material.uniforms.litColor.value.copy(sunColor); this.material.uniforms.shadeColor.value.copy(shade); }
  /** How deep in cloud the point is (0..1), and the nearest cloud geometry for VFR minimums. */
  probe(x, y, z) {
    let inside = 0, below = Infinity, above = Infinity, horiz = Infinity;
    if (this.ovc) { if (y >= this.ovc.base && y <= this.ovc.top) inside = 1; else if (y < this.ovc.base) below = Math.min(below, this.ovc.base - y); else above = Math.min(above, y - this.ovc.top); }
    for (const c of this.clusters) {
      const d = Math.hypot(x - c.x, z - c.z);
      const edge = d - c.r * 0.85;
      const inBand = y >= c.base && y <= c.top;
      if (inBand) { if (edge < 0) inside = Math.max(inside, Math.min(1, -edge / 200)); else horiz = Math.min(horiz, edge); }
      else if (edge < 0) { if (y < c.base) below = Math.min(below, c.base - y); else above = Math.min(above, y - c.top); }
    }
    return { inside, below, above, horiz };
  }
}

/* ===================== sky, light, fog ===================== */
export function sunFromHour(hour) {
  const e = 60 * Math.sin(((hour - 6.4) / 13.6) * Math.PI) - 2; // elevation, deg (sunrise ~6:30, sunset ~19:50)
  const az = 80 + ((hour - 6.4) / 13.6) * 200;
  return { elev: e, az };
}

export class World {
  constructor(renderer, scene, opts = {}) {
    this.renderer = renderer; this.scene = scene; this.quality = opts.quality || "high";
    this.lightsTex = glowTexture();
  }
  async build(progress = () => {}) {
    const step = async (msg, fn) => { progress(msg); await new Promise((r) => setTimeout(r, 16)); return fn(); };
    this.groundCanvas = await step("Painting the valley", () => buildGroundCanvas(this.quality === "low" ? 1024 : 2048));
    const terrain = await step("Raising the terrain", () => buildTerrain(this.groundCanvas, this.quality));
    this.scene.add(terrain.group); this.terrain = terrain;
    await step("Filling Lake Itasca", () => this.scene.add(buildWater()));
    await step("Building towns", () => this.scene.add(buildTowns()));
    await step("Planting forests", () => this.scene.add(buildTrees(this.quality)));
    const ap = await step("Painting runways", () => buildAirports(this.lightsTex, this.renderer));
    this.scene.add(ap.root); this.ap = ap;
    const lm = await step("Placing landmarks", () => buildLandmarks(this.lightsTex));
    this.scene.add(lm.group); this.blinkers = lm.blinkers;
    progress("Lighting the sky");
    this.sky = new Sky(); this.sky.scale.setScalar(100000); this.scene.add(this.sky);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.4); this.scene.add(this.sun); this.scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfd6ff, 0x4d5a3a, 1.0); this.scene.add(this.hemi);
    this.scene.fog = new THREE.Fog(0xb9c7d6, 2000, 40000);
    this.clouds = new Clouds(this.scene);
  }
  /** env: { hour, visSM, inCloud } */
  setEnvironment(env) {
    const { elev, az } = sunFromHour(env.hour);
    const e = elev * DEG, a = az * DEG;
    const dir = new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(dir);
    const dusk = Math.max(0, 1 - Math.abs(elev) / 12);
    u.turbidity.value = 4 + 6 * dusk; u.rayleigh.value = 1.2 + 1.8 * dusk; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.82;
    const day = Math.max(0, Math.min(1, (elev + 4) / 16));
    this.night = elev < -4; this.dusk = elev < 6;
    this.sun.position.copy(dir).multiplyScalar(5000);
    const warm = new THREE.Color().setRGB(1, 0.62 + 0.38 * Math.min(1, elev / 25), 0.42 + 0.58 * Math.min(1, elev / 25));
    this.sun.color.copy(warm); this.sun.intensity = 2.6 * Math.max(0, Math.sin(e)) + 0.02;
    this.hemi.intensity = 0.12 + 1.0 * day; this.hemi.color.setRGB(0.55 + 0.2 * day, 0.62 + 0.25 * day, 0.85);
    this.renderer.toneMappingExposure = 0.18 + 0.4 * day;
    const fogDay = new THREE.Color(0xb6c6d6), fogDusk = new THREE.Color(0xc09a86), fogNight = new THREE.Color(0x070b14);
    const fc = elev > 8 ? fogDay : elev > -2 ? fogDusk.clone().lerp(fogDay, Math.max(0, (elev + 2) / 10)) : fogNight.clone().lerp(fogDusk, Math.max(0, (elev + 8) / 6));
    const visM = Math.min(60000, env.visSM * 1609);
    if (env.inCloud > 0.05) { const c = new THREE.Color(0xcfd4da).multiplyScalar(0.25 + 0.75 * day); this.scene.fog.color.copy(c); this.scene.fog.near = 2; this.scene.fog.far = 60 + 400 * (1 - env.inCloud); }
    else { this.scene.fog.color.copy(fc); this.scene.fog.near = Math.min(800, visM * 0.05); this.scene.fog.far = visM * 1.25; }
    this.renderer.setClearColor(this.scene.fog.color);
    this.sky.visible = env.inCloud < 0.5;
    this.updateEnvMap(env.hour);
    if (this.clouds) this.clouds.setLight(new THREE.Color().copy(warm).multiplyScalar(0.25 + 0.75 * day).lerp(new THREE.Color(1, 1, 1), 0.4 * day), new THREE.Color(0.55, 0.6, 0.68).multiplyScalar(0.2 + 0.8 * day));
  }
  /** Image-based lighting for the airplane's paint: a PMREM of the current sky, refreshed when the time of day changes. */
  updateEnvMap(hour) {
    if (this.envHour != null && Math.abs(hour - this.envHour) < 0.25) return;
    this.envHour = hour;
    this.pmrem ||= new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene(); const vis = this.sky.visible; this.sky.visible = true;
    envScene.add(this.sky);
    const rt = this.pmrem.fromScene(envScene, 0, 0.1, 200000);
    this.scene.add(this.sky); this.sky.visible = vis;
    if (this.envRT) this.envRT.dispose();
    this.envRT = rt; this.scene.environment = rt.texture;
  }
  /** per-frame animation: lights, beacons, VASI, windsocks */
  update(t, eye, state) {
    const night = this.night, dusk = this.dusk;
    for (const p of this.ap.lights.kzar) p.visible = dusk;
    for (const p of this.ap.lights.taxi) p.visible = dusk;
    if (this.ap.lights.pcl) { this.ap.lights.pcl.visible = state.pclLevel > 0 || (!night && false); this.ap.lights.pcl.material.size = 2 + state.pclLevel * 1.4; }
    const flash = (Math.floor(t / 0.75) % 2) === 0;
    for (const b of this.ap.lights.beacons) { b.visible = dusk || state.beaconDay; b.geometry.attributes.color.setXYZ(0, flash ? 1 : 0.15, 1, flash ? 1 : 0.3); b.geometry.attributes.color.needsUpdate = true; b.material.size = (Math.floor(t / 0.375) % 2) ? 14 : 4; }
    const blink = (t % 1.5) < 0.75;
    for (const b of this.blinkers) b.visible = blink;
    // VASI bars: white if the eye is above the bar's beam angle, red below
    for (const v of this.ap.lights.vasi) {
      const d = Math.hypot(eye.x - v.x, eye.z - v.z); const ang = Math.atan2(eye.y - v.y, d) / DEG;
      const white = ang > v.ang; const c = v.pts.geometry.attributes.color;
      for (let k = 0; k < 3; k++) c.setXYZ(k, 1, white ? 1 : 0.12, white ? 1 : 0.08);
      c.needsUpdate = true; v.lastWhite = white;
      v.pts.material.size = night ? 7 : 5;
    }
    // windsocks point downwind and fill with wind speed
    for (const s of this.ap.lights.socks || []) {
      const kt = state.windKt || 0; const toward = (state.windDir + 180) * DEG;
      s.pivot.rotation.set(0, 0, 0);
      s.pivot.rotation.y = -toward;
      const lift = Math.min(1, kt / 15) * 80 + 8 + Math.sin(t * 3) * 2;
      s.sock.rotation.x = lift * DEG; // tip toward -z (downwind) after yaw
      s.sock.position.set(0, 0, 0);
    }
    // light gun
    if (this.ap.lights.gun) { const g = state.lightGun; this.ap.lights.gun.visible = !!g && (g.flash ? (t % 1) < 0.5 : true); if (g) { const c = this.ap.lights.gun.geometry.attributes.color; c.setXYZ(0, g.color === "red" ? 1 : g.color === "white" ? 1 : 0.1, g.color === "green" || g.color === "white" ? 1 : 0.1, g.color === "white" ? 1 : 0.15); c.needsUpdate = true; } }
  }
  vasiState(apId, endId) { return this.ap.lights.vasi.filter((v) => v.ap === apId && v.end === endId).map((v) => v.lastWhite); }
  /** VASI bar colours as seen from a given eye position: [nearWhite, farWhite] */
  vasiAt(apId, endId, eye) { return this.ap.lights.vasi.filter((v) => v.ap === apId && v.end === endId).map((v) => Math.atan2(eye.y - v.y, Math.hypot(eye.x - v.x, eye.z - v.z)) / DEG > v.ang); }
}
