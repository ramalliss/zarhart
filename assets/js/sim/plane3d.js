// Cessna 172-style airplane built from lofted surfaces (three.js local frame: forward = -z, up = +y, right = +x; origin at the CG).
import * as THREE from "three";

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

/* ---------------- helpers ---------------- */
const cr = (p0, p1, p2, p3, t) => { const t2 = t * t, t3 = t2 * t; return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3); };
const se = (v, n) => Math.sign(v) * Math.pow(Math.abs(v), 2 / n); // superellipse shaping

/** NACA-style closed airfoil loop (x: 0 LE → 1 TE). Returns [{x, y}] going TE → upper → LE → lower → TE. */
function airfoil(t = 0.12, camber = 0.02, n = 14) {
  const xs = []; for (let i = 0; i <= n; i++) xs.push(0.5 * (1 - Math.cos((i / n) * Math.PI)));
  const yt = (x) => 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
  const yc = (x) => (x < 0.4 ? (camber / 0.16) * (0.8 * x - x * x) : (camber / 0.36) * (0.2 + 0.8 * x - x * x));
  const up = xs.map((x) => ({ x, y: yc(x) + yt(x) })).reverse(); // TE → LE
  const lo = xs.slice(1, -1).map((x) => ({ x, y: yc(x) - yt(x) })); // LE → TE (skip duplicates)
  return [...up, ...lo];
}

/**
 * Lifting surface lofted through stations. Each station: { s (span position), le (z of leading edge), c (chord), y (height), t (thickness), tw (twist, deg) }.
 * axis 'x': span along +x (wings, stabilizer); axis 'y': span along +y (fin).
 */
function surfaceGeo(stations, { axis = "x", camber = 0.02, n = 14, caps = true } = {}) {
  const pos = [], idx = [];
  const ring = [];
  for (const st of stations) {
    const prof = airfoil(st.t ?? 0.12, camber, n);
    const tw = (st.tw || 0) * DEG, ct = Math.cos(tw), stw = Math.sin(tw);
    ring.push(prof.length);
    for (const p of prof) {
      const px = (p.x - 0.25) * st.c, py = p.y * st.c; // about the quarter chord
      const zz = st.le + 0.25 * st.c + px * ct + py * stw, yy = py * ct - px * stw;
      if (axis === "x") pos.push(st.s, st.y + yy, zz); else pos.push((st.x || 0) + yy, st.s, zz);
    }
  }
  const m = ring[0];
  for (let j = 0; j < stations.length - 1; j++) for (let i = 0; i < m; i++) {
    const a = j * m + i, b = j * m + ((i + 1) % m), c = (j + 1) * m + i, d = (j + 1) * m + ((i + 1) % m);
    idx.push(a, c, b, b, c, d);
  }
  if (caps) {
    for (const j of [0, stations.length - 1]) {
      const base = pos.length / 3; let cx = 0, cy = 0, cz = 0;
      for (let i = 0; i < m; i++) { cx += pos[(j * m + i) * 3]; cy += pos[(j * m + i) * 3 + 1]; cz += pos[(j * m + i) * 3 + 2]; }
      pos.push(cx / m, cy / m, cz / m);
      for (let i = 0; i < m; i++) { const a = j * m + i, b = j * m + ((i + 1) % m); if (j === 0) idx.push(base, b, a); else idx.push(base, a, b); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function mirrorX(g) {
  const m = g.clone(); m.scale(-1, 1, 1);
  const ix = m.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
  m.index.needsUpdate = true; m.computeVertexNormals(); return m;
}
/** Group whose local +x runs along a hinge from a to b (world-local coords). Returns { pivot, inner }; put the surface mesh inside `inner` with geometry already in airplane coords. */
function hinge(a, b, mesh) {
  const dir = new THREE.Vector3().subVectors(b, a).normalize();
  const pivot = new THREE.Group(); pivot.position.copy(a);
  pivot.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
  const inner = new THREE.Group(); pivot.add(inner);
  const inv = new THREE.Matrix4().compose(a, pivot.quaternion, new THREE.Vector3(1, 1, 1)).invert();
  mesh.geometry.applyMatrix4(inv); inner.add(mesh);
  return { pivot, inner };
}
/** A tapered, streamlined rod between two points (thin across x, long along the flow). */
function strut(a, b, r0, r1, mat, flat = 0.42) {
  const dir = new THREE.Vector3().subVectors(b, a); const len = dir.length(); dir.normalize();
  const geo = new THREE.CylinderGeometry(r1, r0, len, 12, 1); geo.scale(flat, 1, 1);
  const y = dir, zf = new THREE.Vector3(0, 0, 1).sub(y.clone().multiplyScalar(y.z)).normalize(), x = new THREE.Vector3().crossVectors(y, zf);
  const m = new THREE.Mesh(geo, mat); m.matrixAutoUpdate = true;
  m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, zf));
  m.position.copy(a).add(b).multiplyScalar(0.5);
  return m;
}

/* ---------------- fuselage ---------------- */
// z, half-width, top, bottom
const FUS = [
  [-2.40, 0.22, 0.08, -0.30], [-2.26, 0.40, 0.22, -0.46], [-1.96, 0.52, 0.32, -0.56], [-1.56, 0.56, 0.40, -0.60],
  [-1.20, 0.57, 0.58, -0.62], [-0.86, 0.58, 0.92, -0.62], [-0.55, 0.585, 1.02, -0.62], [0.20, 0.585, 1.04, -0.61],
  [0.80, 0.57, 1.02, -0.57], [1.40, 0.51, 0.90, -0.46], [2.20, 0.40, 0.66, -0.30], [3.20, 0.28, 0.48, -0.10],
  [4.30, 0.17, 0.36, 0.06], [5.20, 0.09, 0.31, 0.15], [5.58, 0.035, 0.28, 0.20],
];
const Z0 = FUS[0][0], Z1 = FUS[FUS.length - 1][0];
function fuselageGeo(R = 32, sub = 4) {
  const rows = [];
  for (let i = 0; i < FUS.length - 1; i++) {
    const p0 = FUS[Math.max(0, i - 1)], p1 = FUS[i], p2 = FUS[i + 1], p3 = FUS[Math.min(FUS.length - 1, i + 2)];
    for (let s = 0; s < sub; s++) { const t = s / sub; rows.push([0, 1, 2, 3].map((k) => cr(p0[k], p1[k], p2[k], p3[k], t))); }
  }
  rows.push(FUS[FUS.length - 1]);
  const pos = [], uv = [], idx = [];
  rows.forEach(([z, w, top, bot]) => {
    const yc = (top + bot) / 2, h = (top - bot) / 2;
    for (let k = 0; k <= R; k++) {
      const th = (k / R) * TAU, c = Math.cos(th), s = Math.sin(th);
      pos.push(w * se(c, 2.5), yc + h * se(s, s < 0 ? 3.2 : 2.4), z);
      uv.push(k / R, (z - Z0) / (Z1 - Z0));
    }
  });
  const W = R + 1;
  for (let j = 0; j < rows.length - 1; j++) for (let k = 0; k < R; k++) { const a = j * W + k, b = a + 1, c = a + W, d = c + 1; idx.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
// fuselage half-width and top at a given z (for placing parts)
export function fuselageAt(z) {
  for (let i = 0; i < FUS.length - 1; i++) if (z >= FUS[i][0] && z <= FUS[i + 1][0]) { const t = (z - FUS[i][0]) / (FUS[i + 1][0] - FUS[i][0]); return FUS[i].map((v, k) => v + (FUS[i + 1][k] - v) * t); }
  return FUS[FUS.length - 1];
}

/** Paint scheme on the fuselage UV map: u = angle around (0 = right side, 0.25 = top, 0.5 = left), v = nose → tail. */
function liveryTexture(reg, stripe, navy = "#1b2a44", scale = 1) {
  const W = 2048 * scale, H = 1024 * scale; const c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d");
  const U = (th) => (((th / TAU) % 1) + 1) % 1 * W, V = (z) => ((z - Z0) / (Z1 - Z0)) * H;
  g.fillStyle = "#f3f4f6"; g.fillRect(0, 0, W, H);
  // slightly darker belly
  const belly = g.createLinearGradient(U(TAU * 0.62), 0, U(TAU * 0.88), 0); belly.addColorStop(0, "rgba(0,0,0,0)"); belly.addColorStop(0.5, "rgba(40,50,60,0.06)"); belly.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = belly; g.fillRect(U(TAU * 0.62), 0, U(TAU * 0.88) - U(TAU * 0.62), H);
  // cheatline: magenta over navy, sweeping up toward the tail; drawn per row for both sides
  const band = (thA, thB, z0, z1, col) => { g.fillStyle = col; const a = U(thA), b = U(thB), y = V(z0), h = V(z1) - V(z0) + 1; if (b >= a) g.fillRect(a, y, b - a + 1, h); else { g.fillRect(a, y, W - a, h); g.fillRect(0, y, b + 1, h); } };
  for (let z = -2.0; z < 5.5; z += 0.02) {
    const sweep = z > 1.6 ? (z - 1.6) * 0.2 : 0, taper = z > 4.4 ? Math.max(0.35, 1 - (z - 4.4) * 0.6) : 1;
    const m0 = -0.03 + sweep, m1 = m0 + 0.075 * taper, n0 = m0 - 0.115 * taper;
    band(m0, m1, z, z + 0.021, stripe); band(n0, m0, z, z + 0.021, navy);
    band(Math.PI - m1, Math.PI - m0, z, z + 0.021, stripe); band(Math.PI - m0, Math.PI - n0, z, z + 0.021, navy);
  }
  // windows
  const win = (th0, th1, z0, z1) => { const x = Math.min(U(th0), U(th1)), w = Math.abs(U(th1) - U(th0)), y = V(z0), h = V(z1) - V(z0); const gr = g.createLinearGradient(x, 0, x + w, 0); gr.addColorStop(0, "#1a2430"); gr.addColorStop(0.6, "#2b3a4c"); gr.addColorStop(1, "#16202b"); g.fillStyle = gr; g.beginPath(); g.roundRect(x, y, w, h, 14); g.fill(); };
  for (const side of [0, 1]) {
    const t0 = 0.32, t1 = 0.98; const a = side ? Math.PI - t1 : t0, b = side ? Math.PI - t0 : t1;
    win(a, b, -0.60, 0.26); win(a, b, 0.36, 1.02);
    // door outline
    g.strokeStyle = "rgba(120,130,145,0.55)"; g.lineWidth = 3; const dx = Math.min(U(side ? Math.PI - 1.02 : 0.04), U(side ? Math.PI - 0.04 : 1.02)); g.strokeRect(dx, V(-0.66), Math.abs(U(1.02) - U(0.04)), V(0.31) - V(-0.66));
  }
  win(1.0, Math.PI - 1.0, -1.13, -0.70); // windshield
  g.fillStyle = "#e8eaee"; g.fillRect(U(Math.PI / 2) - 3 * scale, V(-1.13), 6 * scale, V(-0.70) - V(-1.13)); // centre post
  // cowling seam and oil door
  g.fillStyle = "rgba(110,120,135,0.45)"; g.fillRect(0, V(-1.52), W, 3 * scale); g.strokeStyle = "rgba(110,120,135,0.5)"; g.strokeRect(U(Math.PI / 2) - 40 * scale, V(-2.0), 80 * scale, V(-1.7) - V(-2.0));
  // registration on both rear sides (drawn so it reads correctly from outside)
  const regText = (side) => {
    const th = side ? Math.PI - 0.5 : 0.5, cx = U(th), cy = V(3.0);
    g.save(); if (side) g.setTransform(0, 1, 1, 0, cx, cy); else g.setTransform(0, -1, -1, 0, cx, cy);
    g.font = "bold 100px Arial"; g.textAlign = "center"; g.textBaseline = "middle"; const tw = g.measureText(reg).width;
    g.scale((150 * scale) / tw, 1.7 * scale); g.fillStyle = navy; g.fillText(reg, 0, 0); g.restore();
  };
  regText(0); regText(1);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; t.anisotropy = 4; return t;
}

/* ---------------- airplane ---------------- */
/** type: c172 (high wing, struts) | c152 (the same, a size smaller) | pa28 (low wing, no struts, wider main gear) */
export function buildAirplane({ reg = "N19ZR", stripe = 0xe64bd0, simple = false, type = "c172" } = {}) {
  const low = type === "pa28", gearX = low ? 1.55 : 1.25;
  const g = new THREE.Group();
  const stripeHex = "#" + new THREE.Color(stripe).getHexString();
  const paint = new THREE.MeshStandardMaterial({ map: liveryTexture(reg, stripeHex, "#1b2a44", simple ? 0.5 : 1), roughness: 0.32, metalness: 0.05 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf1f2f4, roughness: 0.34, metalness: 0.05, side: THREE.DoubleSide });
  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa1a9, roughness: 0.45, metalness: 0.6 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.6, side: THREE.DoubleSide });
  const accent = new THREE.MeshStandardMaterial({ color: stripe, roughness: 0.4 });
  const parts = {};
  const add = (m, parent = g) => { parent.add(m); return m; };

  // fuselage + nose cap
  add(new THREE.Mesh(fuselageGeo(simple ? 22 : 32, simple ? 2 : 4), paint));
  const cap = new THREE.Mesh(new THREE.CircleGeometry(0.26, 20), dark); cap.scale.set(0.85, 0.75, 1); cap.position.set(0, -0.11, Z0 - 0.002); cap.rotation.y = Math.PI; add(cap);

  // spinner + propeller
  const sp = [];
  for (let i = 0; i <= 12; i++) { const t = i / 12; sp.push(new THREE.Vector2(0.18 * Math.sin((1 - t) * Math.PI / 2) ** 0.8, t * 0.42)); }
  const spinGeo = new THREE.LatheGeometry(sp.reverse().map((p) => new THREE.Vector2(Math.max(0.001, p.x), p.y)), 20); spinGeo.rotateX(-Math.PI / 2);
  const spinner = new THREE.Mesh(spinGeo, white); spinner.position.set(0, -0.08, Z0 + 0.02); add(spinner);
  const prop = new THREE.Group(); prop.position.set(0, -0.08, Z0 - 0.06); add(prop);
  const bladeGeo = (() => {
    const pos = [], idx = []; const N = 9, prof = airfoil(0.1, 0.03, 8), m = prof.length;
    for (let j = 0; j <= N; j++) {
      const r = 0.14 + (0.96 - 0.14) * (j / N), ch = 0.16 - 0.07 * (j / N), beta = (32 - 20 * (j / N)) * DEG;
      const d = new THREE.Vector3(Math.cos(beta), 0, Math.sin(beta)), nn = new THREE.Vector3(-Math.sin(beta), 0, Math.cos(beta));
      for (const p of prof) { const a = (p.x - 0.35) * ch, b = p.y * ch; pos.push(d.x * a + nn.x * b, r, d.z * a + nn.z * b); }
    }
    for (let j = 0; j < N; j++) for (let i = 0; i < m; i++) { const a = j * m + i, b = j * m + ((i + 1) % m), c = a + m, dd = b + m; idx.push(a, c, b, b, c, dd); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals(); return geo;
  })();
  for (const k of [0, 1]) { const b = new THREE.Mesh(bladeGeo, dark); b.rotation.z = k * Math.PI; prop.add(b); }
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.98, 40), new THREE.MeshBasicMaterial({ color: 0x9aa3ad, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false }));
  prop.add(disc); parts.prop = prop; parts.disc = disc;

  // wings (right built, left mirrored), with flaps and ailerons
  const dih = Math.tan((low ? 7 : 1.7) * DEG), wy = (s) => (low ? -0.62 : 1.06) + Math.max(0, s - 0.55) * dih;
  const leAt = (s) => (s <= 2.6 ? -0.86 : -0.86 + (s - 2.6) / (5.45 - 2.6) * 0.16);
  const chordAt = (s) => (s <= 2.6 ? 1.63 : 1.63 - (s - 2.6) / (5.45 - 2.6) * 0.51);
  const csAt = (s) => (s <= 2.6 ? 0.38 : 0.38 - (s - 2.6) / (5.45 - 2.6) * 0.1); // control-surface chord
  const wingSt = (s, full) => ({ s, le: leAt(s), c: full ? chordAt(s) : chordAt(s) - csAt(s), y: wy(s), t: 0.15 - s * 0.006, tw: 2 - s * 0.5 });
  const mainWing = surfaceGeo([{ ...wingSt(0), s: 0.0 }, wingSt(0.55), wingSt(2.6), wingSt(5.2), { ...wingSt(5.45, true), c: chordAt(5.45) * 0.92, y: wy(5.45) + 0.01 }], { camber: 0.025 });
  const csGeo = (s0, s1) => surfaceGeo([0, 1].map((k) => { const s = s0 + (s1 - s0) * k; return { s, le: leAt(s) + chordAt(s) - csAt(s) + 0.01, c: csAt(s), y: wy(s) - 0.012, t: 0.07, tw: 2 - s * 0.5 }; }), { camber: 0 });
  const hingeOf = (s0, s1, sign) => { const h = (s) => new THREE.Vector3(sign * s, wy(s) - 0.012, leAt(s) + chordAt(s) - csAt(s) + 0.01); return sign > 0 ? [h(s0), h(s1)] : [h(s1), h(s0)]; };
  for (const sign of [1, -1]) {
    const wm = new THREE.Mesh(sign > 0 ? mainWing : mirrorX(mainWing), white); add(wm);
    const flapGeo = csGeo(0.62, 2.55), ailGeo = csGeo(2.65, 5.15);
    const fl = new THREE.Mesh(sign > 0 ? flapGeo : mirrorX(flapGeo), white), al = new THREE.Mesh(sign > 0 ? ailGeo : mirrorX(ailGeo), white);
    const [fa, fb] = hingeOf(0.62, 2.55, sign), [aa, ab] = hingeOf(2.65, 5.15, sign);
    const fh = hinge(fa, fb, fl), ah = hinge(aa, ab, al); add(fh.pivot); add(ah.pivot);
    parts[sign > 0 ? "flapR" : "flapL"] = fh.inner; parts[sign > 0 ? "ailR" : "ailL"] = ah.inner;
    // wingtip accent
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), accent); tip.scale.set(0.6, 0.55, 5.2); tip.position.set(sign * 5.47, wy(5.45), leAt(5.45) + chordAt(5.45) * 0.42); add(tip);
    // lift strut and jury strut (high wing only)
    if (!low) add(strut(new THREE.Vector3(sign * 0.56, -0.40, -0.02), new THREE.Vector3(sign * 2.55, wy(2.55) - 0.06, -0.12), 0.05, 0.04, metal));
    if (!low) add(strut(new THREE.Vector3(sign * 1.45, 0.30, -0.07), new THREE.Vector3(sign * 1.45, wy(1.45) - 0.07, -0.08), 0.012, 0.012, metal, 1));
  }

  // horizontal stabilizer + elevator (hinge straight along x at z = 5.27)
  const HZ = 5.27, HY = 0.24;
  const stab = surfaceGeo([{ s: 0.05, le: 4.55, c: HZ - 4.55, y: HY, t: 0.1 }, { s: 1.62, le: 4.86, c: HZ - 4.86, y: HY + 0.01, t: 0.09 }, { s: 1.72, le: 4.92, c: HZ - 4.92 - 0.02, y: HY + 0.01, t: 0.08 }], { camber: 0 });
  add(new THREE.Mesh(stab, white)); add(new THREE.Mesh(mirrorX(stab), white));
  const elevPivot = new THREE.Group(); elevPivot.position.set(0, HY, HZ); add(elevPivot);
  const elevGeo = surfaceGeo([{ s: 0.05, le: 0.0, c: 0.46, y: 0, t: 0.06 }, { s: 1.62, le: 0.0, c: 0.34, y: 0.01, t: 0.06 }], { camber: 0 });
  elevPivot.add(new THREE.Mesh(elevGeo, white), new THREE.Mesh(mirrorX(elevGeo), white)); parts.elevator = elevPivot;

  // vertical fin + dorsal fillet + rudder (hinge vertical at z = 5.22)
  const RZ = 5.22;
  const fin = surfaceGeo([{ s: 0.28, le: 4.05, c: RZ - 4.05, t: 0.1 }, { s: 1.0, le: 4.55, c: RZ - 4.55, t: 0.1 }, { s: 1.62, le: 4.86, c: RZ - 4.86, t: 0.09 }], { axis: "y", camber: 0 });
  add(new THREE.Mesh(fin, white));
  const dors = new THREE.Shape([new THREE.Vector2(3.1, 0.0), new THREE.Vector2(4.2, 0.0), new THREE.Vector2(4.3, 0.34)].map((v) => new THREE.Vector2(v.x, v.y)));
  const dg = new THREE.ExtrudeGeometry(dors, { depth: 0.05, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2 }); dg.translate(0, 0, -0.025); dg.rotateY(-Math.PI / 2);
  const dm = new THREE.Mesh(dg, white); dm.position.set(0, fuselageAt(4.0)[2] - 0.04, 0); add(dm);
  const rudPivot = new THREE.Group(); rudPivot.position.set(0, 0, RZ); add(rudPivot);
  const rudGeo = surfaceGeo([{ s: 0.22, le: 0, c: 0.44, t: 0.06 }, { s: 1.68, le: 0, c: 0.3, t: 0.06 }], { axis: "y", camber: 0 });
  rudPivot.add(new THREE.Mesh(rudGeo, white)); parts.rudder = rudPivot;
  const finStripe = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.09, 0.62), accent); finStripe.position.set(0, 1.2, 4.86); add(finStripe);

  // landing gear
  for (const sx of [-1, 1]) {
    if (low) add(strut(new THREE.Vector3(sx * gearX, wy(gearX) - 0.04, 0.32), new THREE.Vector3(sx * gearX, -0.9, 0.45), 0.035, 0.03, metal, 1)); // oleo leg under the wing
    else add(strut(new THREE.Vector3(sx * 0.42, -0.56, 0.38), new THREE.Vector3(sx * 1.2, -0.9, 0.38), 0.03, 0.022, metal, 1.8));
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.15, 20), rubber); w.rotation.z = Math.PI / 2; w.position.set(sx * gearX, -0.93, low ? 0.45 : 0.38); add(w);
    add(pant(sx * gearX, -0.88, low ? 0.47 : 0.40, 0.95, 0.22, white));
  }
  add(strut(new THREE.Vector3(0, -0.45, -1.6), new THREE.Vector3(0, -0.97, -1.55), 0.045, 0.04, metal, 1));
  const nw = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.12, 18), rubber); nw.rotation.z = Math.PI / 2; nw.position.set(0, -0.98, -1.55); add(nw);
  add(pant(0, -0.94, -1.53, 0.72, 0.17, white));

  // lights
  const lightMat = (c) => new THREE.MeshBasicMaterial({ color: c });
  const tipZ = leAt(5.45) + 0.15;
  parts.navL = add(new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), lightMat(0xff2222))); parts.navL.position.set(-5.53, wy(5.45), tipZ);
  parts.navR = add(new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), lightMat(0x22ff44))); parts.navR.position.set(5.53, wy(5.45), tipZ);
  parts.strobeL = add(new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), lightMat(0xffffff))); parts.strobeL.position.set(-5.53, wy(5.45), tipZ + 0.25);
  parts.strobeR = add(new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), lightMat(0xffffff))); parts.strobeR.position.set(5.53, wy(5.45), tipZ + 0.25);
  parts.beacon = add(new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), lightMat(0xff2200))); parts.beacon.position.set(0, 1.92, 5.0);
  if (!simple) {
    const spot = new THREE.SpotLight(0xfff2d8, 0, 900, 0.32, 0.45, 1.2); spot.position.set(-0.9, 0.98, -0.95);
    const tgt = new THREE.Object3D(); tgt.position.set(-0.9, -6, -40); g.add(spot, tgt); spot.target = tgt; parts.landingLight = spot;
  }
  if (type === "c152") g.scale.setScalar(0.92);
  g.userData.parts = parts;
  return g;
}

/** Teardrop wheel fairing centred at (x, y, z). */
function pant(x, y, z, len, r, mat) {
  const pts = [];
  for (let i = 0; i <= 14; i++) { const t = i / 14; const rr = r * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.75)), 0.75); pts.push(new THREE.Vector2(Math.max(0.002, rr), (t - 0.4) * len)); }
  const geo = new THREE.LatheGeometry(pts, 18); geo.rotateX(Math.PI / 2); geo.scale(0.6, 0.85, 1);
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m;
}

/** Soft ground shadow (a radial blob sized to the airplane). */
export function buildShadow() {
  const c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d");
  const gr = g.createRadialGradient(64, 64, 4, 64, 64, 64); gr.addColorStop(0, "rgba(0,0,0,0.55)"); gr.addColorStop(0.55, "rgba(0,0,0,0.3)"); gr.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -10, polygonOffsetUnits: -10 }));
  m.scale.set(11.5, 1, 8.5); m.renderOrder = 1;
  return m;
}

/** Cockpit view: glareshield, window posts, door frames, and the real wings and struts overhead. */
export function buildCockpit(type = "c172") {
  const g = new THREE.Group();
  const dash = new THREE.MeshLambertMaterial({ color: 0x15191e });
  const frame = new THREE.MeshLambertMaterial({ color: 0xd9dbdf });
  const glare = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.5), dash); glare.position.set(0, 0.2, -1.05); glare.name = "glare"; g.add(glare);
  const face = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.75, 0.06), dash); face.position.set(0, -0.18, -1.28); face.name = "dash"; g.add(face);
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.95, 0.07), new THREE.MeshLambertMaterial({ color: 0x8b9097 })); post.position.set(sx * 0.66, 0.62, -1.08); post.rotation.x = -0.62; post.rotation.z = sx * 0.06; g.add(post);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.6), frame); door.position.set(sx * 0.66, 0.98, -0.25); g.add(door);
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 1.8), frame); roof.position.set(0, 1.12, -0.2); g.add(roof);
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.9), frame); top.position.set(0, 1.1, -0.95); g.add(top);
  const compass = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.1), dash); compass.position.set(0, 0.98, -0.95); g.add(compass);
  const ext = cockpitExterior(type); g.add(ext); g.userData.ext = ext;
  return g;
}
/** the exterior wings, struts and control surfaces seen from the cockpit, so the view out the window matches the airplane */
export function cockpitExterior(type = "c172") {
  const ext = buildAirplane({ simple: true, type }); ext.updateMatrixWorld(true);
  const keep = new Set(), floor = type === "pa28" ? -0.95 : -0.6;
  ext.traverse((o) => { if (o.isMesh) { const b = new THREE.Box3().setFromObject(o); if (Math.max(Math.abs(b.min.x), Math.abs(b.max.x)) > 0.9 && b.min.y > floor) keep.add(o); } });
  ext.traverse((o) => { if (o.isMesh && (!keep.has(o) || o.material.isMeshBasicMaterial)) o.visible = false; });
  return ext;
}

export function animateAirplane(group, ac, t, dt = 1 / 60) {
  const p = group.userData.parts; if (!p) return;
  const c = ac.ctl;
  p.prop.rotation.z += (ac.eng.rpm / 60) * TAU * dt * 0.999;
  const fast = ac.eng.rpm > 500;
  p.disc.visible = fast; p.prop.children.forEach((b) => { if (b !== p.disc) b.visible = !fast || ac.eng.rpm < 900; });
  p.elevator.rotation.x = -(c.elevator * 0.4 + c.trim * 0.15);
  p.rudder.rotation.y = c.rudder * 0.35;
  p.ailL.rotation.x = c.aileron * 0.35; p.ailR.rotation.x = -c.aileron * 0.35;
  const f = (ac.flaps || 0) * DEG;
  p.flapL.rotation.x = f; p.flapR.rotation.x = f;
  const L = ac.elec.lights, pw = ac.powered;
  p.navL.visible = p.navR.visible = pw && L.nav;
  p.beacon.visible = pw && L.beacon && (t % 1.2) < 0.15;
  const st = pw && L.strobe && ((t % 1.1) < 0.06 || ((t - 0.15) % 1.1 < 0.06 && t % 1.1 > 0.15));
  p.strobeL.visible = p.strobeR.visible = st;
  if (p.landingLight) p.landingLight.intensity = pw && L.landing ? 120 : 0;
}
