// Zarhart graphics: quality presets, procedural detail textures (made in code, nothing downloaded),
// the sun glare overlay, and Ultra's HDR post-processing (bloom and a colour grade).
import * as THREE from "three";

/**
 * What each Graphics setting turns on.
 * low: the original look (Lambert, no shadows), light enough for phones. high: shadows, PBR and detail textures.
 * ultra: bigger shadow map, a finer terrain grid, more trees, sharper runways, HDR bloom and a colour grade.
 */
export const QUALITY = {
  low: { id: "low", pixelRatio: 1, shadows: 0, pbr: false, terrainN: 256, groundPx: 1024, trees: 4000, runwayScale: 1, post: false },
  high: { id: "high", pixelRatio: 1.6, shadows: 2048, pbr: true, terrainN: 400, groundPx: 2048, trees: 14000, treeRange: 11000, runwayScale: 1, post: false },
  ultra: { id: "ultra", pixelRatio: 2, shadows: 4096, pbr: true, terrainN: 512, groundPx: 2048, trees: 32000, treeRange: 16000, runwayScale: 2, post: true },
};
export const preset = (q) => QUALITY[q] || QUALITY.high;

/**
 * High and above: the sky's environment map lights PBR surfaces' diffuse at a fraction of its strength, because the hemisphere
 * light already stands in for skylight; at full strength the sky counts twice and washes out the sun's shadows.
 * Reflections (the specular part) keep full strength. Call before anything renders.
 */
export function tuneShaders(Q) {
  if (!Q.pbr) return;
  const k = "iblIrradiance += getIBLIrradiance( geometryNormal );", c = THREE.ShaderChunk;
  if (c.lights_fragment_maps.includes(k)) c.lights_fragment_maps = c.lights_fragment_maps.replace(k, "iblIrradiance += getIBLIrradiance( geometryNormal ) * 0.15;");
}

/* ===================== tileable value-noise fBm ===================== */
const hash3 = (i, j, s) => { let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(s + 1, 1442695041); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
/** value noise on a lattice of `per` cells across [0, 1), wrapping at the edges so the texture tiles */
function vnoise(u, v, per, seed) {
  const x = u * per, y = v * per, i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const i0 = ((i % per) + per) % per, j0 = ((j % per) + per) % per, i1 = (i0 + 1) % per, j1 = (j0 + 1) % per;
  const a = hash3(i0, j0, seed), b = hash3(i1, j0, seed), c = hash3(i0, j1, seed), d = hash3(i1, j1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
/** fractal sum of `oct` octaves, each twice the frequency (still tileable); 0..1 */
export function fbm(u, v, per, oct, seed = 0, gain = 0.5) {
  let s = 0, a = 1, n = 0;
  for (let k = 0; k < oct; k++) { s += a * vnoise(u, v, per << k, seed + k * 31); n += a; a *= gain; }
  return s / n;
}
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/** an RGBA8 DataTexture filled per pixel by fn(u, v) → [r, g, b, a] in 0..1, repeating, mipmapped */
function dataTexture(size, fn, srgb = false) {
  const d = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const c = fn((x + 0.5) / size, (y + 0.5) / size, x, y), o = (y * size + x) * 4;
    d[o] = clamp01(c[0]) * 255; d[o + 1] = clamp01(c[1]) * 255; d[o + 2] = clamp01(c[2]) * 255; d[o + 3] = clamp01(c[3]) * 255;
  }
  const t = new THREE.DataTexture(d, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = 8; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.needsUpdate = true;
  return t;
}
/** a height function → tangent-space normals (x, z in the plane), by central differences that wrap */
function normalsFrom(size, h, strength) {
  const H = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) H[y * size + x] = h((x + 0.5) / size, (y + 0.5) / size);
  const at = (x, y) => H[((y + size) % size) * size + ((x + size) % size)];
  return { H, n: (x, y) => { const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength; const l = Math.hypot(dx, dy, 1); return [-dx / l, -dy / l, 1 / l]; } };
}

const cache = {};
/**
 * Asphalt detail, sampled in world space at two scales. R: grain (aggregate and fine wear, 0.5 = average).
 * G: stains and tyre wear. B: repairs (above 0.5: a sealed patch, below: a crack). A: puddle depth map (low = first to flood).
 */
export function asphaltTexture() {
  return cache.asphalt ||= dataTexture(512, (u, v, x, y) => {
    const grain = 0.5 + 0.55 * (fbm(u, v, 96, 3, 3) - 0.5) + (hash3(x, y, 9) > 0.93 ? 0.18 : hash3(x, y, 10) < 0.05 ? -0.14 : 0);
    const wu = u + 0.08 * (fbm(u, v, 4, 3, 20) - 0.5), wv = v + 0.08 * (fbm(u, v, 4, 3, 21) - 0.5);
    const stain = smooth(0.52, 0.7, fbm(wu, wv, 4, 5, 22));
    // rectangular sealed patches on an 8 × 8 grid, and thin cracks along a noise contour
    const cu = u * 8, cv = v * 8, ci = Math.floor(cu), cj = Math.floor(cv), hp = hash3(ci, cj, 40);
    let rep = 0.5;
    if (hp < 0.12) { const fu = cu - ci, fv = cv - cj, a = 0.15 + 0.2 * hash3(ci, cj, 41), b = 0.55 + 0.3 * hash3(ci, cj, 42), c = 0.1 + 0.3 * hash3(ci, cj, 43), d = 0.5 + 0.4 * hash3(ci, cj, 44); rep = 0.5 + 0.35 * smooth(0, 0.02, Math.min(fu - a, b - fu, fv - c, d - fv)); }
    const cr = Math.abs(fbm(u, v, 6, 4, 50) - 0.5);
    if (cr < 0.0035) rep = 0.2 + cr * 40;
    const puddle = fbm(wu * 0.97 + 0.3, wv, 4, 4, 60);
    return [grain, stain, rep, puddle];
  });
}
/** Ground relief for the terrain: R, G: detail normal (x, z), B: height, A: blotches (value noise like the old shader's). */
export function reliefTexture() {
  if (cache.relief) return cache.relief;
  const size = 512, { H, n } = normalsFrom(size, (u, v) => fbm(u, v, 8, 5, 70, 0.55), 26);
  return cache.relief = dataTexture(size, (u, v, x, y) => { const nn = n(x, y); return [0.5 + 0.5 * nn[0], 0.5 + 0.5 * nn[1], H[y * size + x], vnoise(u, v, 4, 90)]; });
}
/** Rock: albedo with sedimentary strata (bands along v, which maps to height on cliffs), cracks and lichen; A: cavity. */
export function rockTexture() {
  return cache.rock ||= dataTexture(512, (u, v) => {
    const warp = 0.06 * (fbm(u, v, 4, 3, 100) - 0.5);
    const band = 0.5 + 0.5 * Math.sin((v + warp) * Math.PI * 2 * 9 + 2.5 * fbm(u, v, 2, 2, 101));
    const fine = fbm(u, v, 32, 3, 102), big = fbm(u, v, 4, 4, 103);
    let r = 0.47 + 0.12 * band + 0.16 * (fine - 0.5) + 0.12 * (big - 0.5), g = r * 0.97, b = r * 0.91;
    r += 0.035 * band; // warmer, iron-stained layers
    const crack = Math.abs(fbm(u, v, 8, 3, 104) - 0.5) < 0.012 ? 0.55 : 1;
    const lichen = smooth(0.6, 0.68, fbm(u, v, 8, 4, 105));
    r = r * crack; g = g * crack; b = b * crack;
    r += (0.5 - r) * lichen * 0.55; g += (0.52 - g) * lichen * 0.55; b += (0.3 - b) * lichen * 0.55;
    return [r, g, b, 0.35 + 0.65 * fine * crack];
  }, true);
}
/** Water ripples: tangent-space normal in RGB (z up), height in A. Two of these scroll past each other on the lake. */
export function rippleTexture() {
  if (cache.ripple) return cache.ripple;
  const size = 256, { H, n } = normalsFrom(size, (u, v) => {
    const w = fbm(u, v, 4, 4, 120, 0.6);
    return w * 0.6 + 0.25 * Math.sin((u * 3 + v * 2 + w * 0.8) * Math.PI * 2) * 0.5 + 0.15 * fbm(u, v, 16, 2, 121);
  }, 9);
  return cache.ripple = dataTexture(size, (u, v, x, y) => { const nn = n(x, y); return [0.5 + 0.5 * nn[0], 0.5 + 0.5 * nn[1], 0.5 + 0.5 * nn[2], H[y * size + x]]; });
}
/**
 * Building facades: a 4 × 4 grid of window cells per tile (one tile = 4 bays × 4 floors).
 * R: glass, G: wall texture, B: ledges and frames, A: a random number per window (decides which are lit at night).
 */
export function facadeTexture() {
  return cache.facade ||= dataTexture(256, (u, v, x, y) => {
    const cx = (x % 64) / 64, cy = (y % 64) / 64, ci = Math.floor(x / 64), cj = Math.floor(y / 64);
    const glass = smooth(0.18, 0.2, cx) * (1 - smooth(0.8, 0.82, cx)) * smooth(0.28, 0.3, cy) * (1 - smooth(0.84, 0.86, cy));
    const ledge = cy < 0.07 || (cy > 0.86 && cy < 0.9) ? 1 : 0;
    const frame = glass > 0 && Math.abs(cx - 0.5) < 0.012 ? 1 : 0; // a mullion down the middle
    return [glass * (1 - frame), 0.45 + 0.4 * fbm(u, v, 32, 3, 130), Math.max(ledge * 0.8, frame), hash3(ci, cj, 131)];
  });
}

/* ===================== sun glare ===================== */
function glareCanvas(draw, size = 256) {
  const c = document.createElement("canvas"); c.width = c.height = size; const g = c.getContext("2d"); draw(g, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
/** where the cabin hides the sun: roof and wing overhead, the panel below, the seats and bulkhead behind (airplane-local direction) */
export function cockpitSunMask(d) {
  const el = Math.asin(Math.max(-1, Math.min(1, d.y))) / (Math.PI / 180), az = Math.abs(Math.atan2(d.x, -d.z)) / (Math.PI / 180);
  if (az > 115) return 0;
  const top = az < 35 ? 30 : az < 70 ? 30 - (az - 35) * 0.35 : 18; // windshield top edge, then the wing root over the side windows
  return smooth(top + 3, top - 3, el) * smooth(-34, -28, el) * smooth(115, 100, az);
}
/**
 * A lens-flare overlay drawn in screen space after the scene: a glow round the sun, a starburst, and ghosts along the line
 * through the screen centre. update() takes how much of the sun is visible (terrain, clouds and the cockpit hide it).
 */
export class SunGlare {
  constructor() {
    this.scene = new THREE.Scene(); this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1); this.vis = 0; this.active = false;
    const glow = glareCanvas((g, s) => { const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.08, "rgba(255,250,235,0.75)"); r.addColorStop(0.3, "rgba(255,225,190,0.16)"); r.addColorStop(1, "rgba(255,210,170,0)"); g.fillStyle = r; g.fillRect(0, 0, s, s); });
    const star = glareCanvas((g, s) => {
      g.translate(s / 2, s / 2); g.globalCompositeOperation = "lighter";
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2 + (k % 2) * 0.12, len = s * (k % 3 === 0 ? 0.5 : 0.32);
        const gr = g.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len); gr.addColorStop(0, "rgba(255,248,230,0.9)"); gr.addColorStop(1, "rgba(255,240,220,0)");
        g.strokeStyle = gr; g.lineWidth = k % 3 === 0 ? 2.2 : 1.3; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * len, Math.sin(a) * len); g.stroke();
      }
    }, 512);
    const ring = glareCanvas((g, s) => { // a soft hexagonal aperture ghost
      g.translate(s / 2, s / 2); const r = g.createRadialGradient(0, 0, 0, 0, 0, s * 0.45); r.addColorStop(0, "rgba(255,255,255,0.18)"); r.addColorStop(0.8, "rgba(255,255,255,0.32)"); r.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = r; g.beginPath(); for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; g.lineTo(Math.cos(a) * s * 0.45, Math.sin(a) * s * 0.45); } g.closePath(); g.fill();
    }, 128);
    const mat = (map, color) => new THREE.MeshBasicMaterial({ map, color, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
    const quad = new THREE.PlaneGeometry(1, 1);
    this.glow = new THREE.Mesh(quad, mat(glow, 0xffffff)); this.star = new THREE.Mesh(quad, mat(star, 0xffffff));
    this.ghosts = [[-0.25, 0.07, 0x9fd0ff], [-0.55, 0.12, 0xffd39a], [-0.9, 0.05, 0xb8ffb0], [-1.25, 0.19, 0x9fb8ff], [0.35, 0.04, 0xffc0a0]].map(([k, s, c]) => { const m = new THREE.Mesh(quad, mat(ring, c)); m.userData = { k, s, c: new THREE.Color(c) }; return m; });
    for (const m of [this.glow, this.star, ...this.ghosts]) { m.frustumCulled = false; this.scene.add(m); }
    this._v = new THREE.Vector3(); this._c = new THREE.Color();
  }
  /** camera, sunDir (world, unit), visible (0–1 target), warm (sun colour), gain (brightness; HDR passes use about 1/exposure), dt */
  update(camera, sunDir, visible, warm, gain, dt) {
    const v = this._v.copy(sunDir).multiplyScalar(1000).add(camera.position).project(camera);
    const behind = v.z > 1 || v.z < -1;
    const target = behind ? 0 : visible;
    this.vis += (target - this.vis) * Math.min(1, dt * 10);
    const asp = camera.aspect || 1; this.camera.left = -asp; this.camera.right = asp; this.camera.updateProjectionMatrix();
    const x = v.x * asp, y = v.y, off = Math.hypot(v.x, v.y);
    const edge = smooth(1.5, 1.0, Math.max(Math.abs(v.x), Math.abs(v.y))); // fades as the sun leaves the screen
    const I = this.vis * edge * gain;
    this.active = I > 0.004;
    for (const m of this.scene.children) m.visible = this.active;
    if (!this.active) return;
    const c = this._c.copy(warm);
    this.glow.position.set(x, y, 0); this.glow.scale.setScalar(0.62); this.glow.material.color.copy(c).multiplyScalar(0.3 * I);
    this.star.position.set(x, y, 0); this.star.scale.setScalar(0.6); this.star.rotation.z = (x + y) * 0.25; this.star.material.color.copy(c).multiplyScalar(0.32 * I * (0.6 + 0.4 * smooth(1.2, 0, off)));
    for (const m of this.ghosts) { const { k, s, c: gc } = m.userData; m.position.set(x * k, y * k, 0); m.scale.setScalar(s * (0.8 + 0.4 * off)); m.material.color.copy(gc).multiplyScalar(0.09 * I * smooth(1.4, 0.2, off)); }
  }
  render(renderer) {
    if (!this.active) return;
    const ac = renderer.autoClear; renderer.autoClear = false; renderer.render(this.scene, this.camera); renderer.autoClear = ac;
  }
}

/* ===================== Ultra: HDR post-processing ===================== */
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uSat: { value: 1.1 }, uContrast: { value: 1.1 }, uMid: { value: 0.3 }, uTint: { value: new THREE.Color(1, 1, 1) }, uVignette: { value: 0.32 } },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uSat, uContrast, uMid, uVignette; uniform vec3 uTint; varying vec2 vUv;
void main(){
  vec4 c = texture2D(tDiffuse, vUv);
  vec3 col = max(c.rgb * uTint, 0.0);
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = max(mix(vec3(l), col, uSat), 0.0);
  col = uMid * pow(col / uMid + 1e-6, vec3(uContrast)); // contrast about mid-grey (scene-referred, before exposure)
  vec2 d = vUv - 0.5; col *= 1.0 - uVignette * dot(d, d) * 1.6;
  gl_FragColor = vec4(col, c.a);
}`,
};
/**
 * EffectComposer chain for Ultra: scene → glare overlay → bloom → grade and vignette → tone mapping and sRGB (OutputPass).
 * Rendered into a HalfFloat target with 4× MSAA so bright things keep their brightness until the bloom. Not used in VR.
 */
export class Post {
  static async create(renderer, scene, camera, glare) {
    const P = "three/addons/postprocessing/";
    const [ec, rp, ub, sp, op] = await Promise.all(["EffectComposer", "RenderPass", "UnrealBloomPass", "ShaderPass", "OutputPass"].map((n) => import(`${P}${n}.js`)));
    return new Post({ ...ec, ...rp, ...ub, ...sp, ...op }, renderer, scene, camera, glare);
  }
  constructor(M, renderer, scene, camera, glare) {
    this.renderer = renderer; this.camera = camera; this.overlay = null;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new M.EffectComposer(renderer, rt);
    this.composer.addPass(new M.RenderPass(scene, camera));
    this.glarePass = new M.RenderPass(glare.scene, glare.camera); this.glarePass.clear = false; this.composer.addPass(this.glarePass);
    this.bloom = new M.UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.3, 0.4, 2); this.composer.addPass(this.bloom);
    this.grade = new M.ShaderPass(GradeShader); this.composer.addPass(this.grade);
    this.composer.addPass(new M.OutputPass());
    this.glare = glare;
  }
  setSize(w, h, pixelRatio) { this.composer.setPixelRatio(pixelRatio); this.composer.setSize(w, h); }
  /**
   * grade: { tint: Color, sat, contrast } for the time of day and weather. `overlay` (the airport labels) is drawn after the
   * chain, straight to the screen, so the tags keep their flat look instead of being tone mapped and bloomed.
   */
  render(grade) {
    const r = this.renderer, exp = Math.max(0.05, r.toneMappingExposure);
    this.bloom.threshold = 1.15 / exp; // only what will be brighter than white after exposure blooms
    const u = this.grade.uniforms; u.uMid.value = 0.18 / exp;
    if (grade) { u.uTint.value.copy(grade.tint); u.uSat.value = grade.sat; u.uContrast.value = grade.contrast; }
    this.glarePass.enabled = this.glare.active;
    const o = this.overlay, ov = o?.visible;
    if (o) o.visible = false;
    this.composer.render();
    if (o) { o.visible = ov; if (ov) { const ac = r.autoClear; r.autoClear = false; r.clearDepth(); r.render(o, this.camera); r.autoClear = ac; } } // the last pass left its depth behind
  }
}
