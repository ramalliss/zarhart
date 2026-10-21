// VR mode (WebXR) for headsets like Meta Quest: a seated cockpit view, the instrument panel drawn on the
// dashboard, a message strip on the glareshield, and the hand controllers as yoke, throttle and switches.
import * as THREE from "three";
import { Panel } from "./panel.js";

const EYE = new THREE.Vector3(-0.32, 0.62, -0.42); // pilot's eye point, aircraft coordinates (same as the 2D cockpit view)
// VR-only interior (the flat-screen cockpit has no floor and a deep glareshield, because the page panel covers that area)
const DASH = { w: 1.44, h: 0.42, x: 0, y: 0.12, z: -1.0, tilt: -12 * Math.PI / 180 }; // instrument panel, tilted back toward the pilot
const PANEL_TEX_W = 1600, PANEL_LOGICAL_W = 1400;
const HUD = { w: 0.56, h: 0.09, x: -0.32, y: 0.4, z: -1.05, tilt: -25 * Math.PI / 180, texW: 1024 }; // message strip on the glareshield
const DEAD = 0.12;
const dz = (v) => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD));

/** Quest Touch controllers in the WebXR "xr-standard" layout: buttons 0 trigger, 1 grip, 3 stick press, 4 A/X, 5 B/Y; axes 2–3 stick */
export const VR_CONTROLS = [
  ["Right stick", "Pitch and roll"],
  ["Left stick", "Up/down: throttle · Left/right: rudder"],
  ["Right trigger", "Brakes"],
  ["A / B", "Flaps down / up"],
  ["X", "Mic click (radio calls, runway lights)"],
  ["Y", "Recenter your view"],
  ["Right stick press", "Change flight assist"],
  ["Left stick press", "Pause"],
];

export class VR {
  /**
   * @param {object} o renderer, scene, camera, cockpit (Group), input (Input), panelMode () => string,
   *   panelState () => object, hud () => {lesson, stall, lightGun}, keys {flapsDown, flapsUp, mic, assist, pause}, onChange(active)
   */
  constructor(o) {
    Object.assign(this, o);
    this.active = false; this.session = null; this.supported = false; this.messages = [];
    this.renderer.xr.enabled = true;
    // camera rig: rig follows the pilot's eye in the airplane; seat holds the recenter offset; the headset pose is applied below it
    this.rig = new THREE.Group(); this.seat = new THREE.Group(); this.rig.add(this.seat); this.scene.add(this.rig);
    this.needRecenter = 0;
    // instrument panel on the dashboard
    this.pc = document.createElement("canvas");
    this.pc.width = PANEL_TEX_W; this.pc.height = Math.round(PANEL_TEX_W * DASH.h / DASH.w);
    this.panel = new Panel(this.pc);
    this.panel.w = PANEL_LOGICAL_W; this.panel.h = PANEL_LOGICAL_W * DASH.h / DASH.w;
    const s = PANEL_TEX_W / PANEL_LOGICAL_W; this.panel.g.setTransform(s, 0, 0, s, 0, 0);
    this.panelTex = this.texture(this.pc);
    this.panelMesh = new THREE.Mesh(new THREE.PlaneGeometry(DASH.w, DASH.h), new THREE.MeshBasicMaterial({ map: this.panelTex, toneMapped: false }));
    this.panelMesh.position.set(DASH.x, DASH.y, DASH.z); this.panelMesh.rotation.x = DASH.tilt;
    this.interior = buildInterior(); this.interior.add(this.panelMesh); this.interior.visible = false; this.cockpit.add(this.interior);
    this.flatParts = ["glare", "dash"].map((n) => this.cockpit.getObjectByName(n)).filter(Boolean);
    // message strip on the glareshield, tilted back toward the pilot
    this.hc = document.createElement("canvas"); this.hc.width = HUD.texW; this.hc.height = Math.round(HUD.texW * HUD.h / HUD.w);
    this.hudTex = this.texture(this.hc);
    this.hudMesh = new THREE.Mesh(new THREE.PlaneGeometry(HUD.w, HUD.h), new THREE.MeshBasicMaterial({ map: this.hudTex, toneMapped: false, transparent: true }));
    this.hudMesh.position.set(HUD.x, HUD.y, HUD.z); this.hudMesh.rotation.x = HUD.tilt; this.interior.add(this.hudMesh);
    this.panelT = 0; this.hudT = 0; this.prev = {};
  }

  texture(canvas) {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = this.renderer.capabilities.getMaxAnisotropy(); t.generateMipmaps = true;
    return t;
  }

  /** true if this browser can open an immersive VR session (Quest Browser, Vision Pro Safari, PC VR browsers) */
  async check() {
    try { this.supported = !!navigator.xr && await navigator.xr.isSessionSupported("immersive-vr"); } catch { this.supported = false; }
    return this.supported;
  }

  async enter() {
    if (this.active || !navigator.xr) return;
    const session = await navigator.xr.requestSession("immersive-vr", { optionalFeatures: ["local-floor"] });
    const xr = this.renderer.xr;
    xr.setReferenceSpaceType("local");
    xr.setFramebufferScaleFactor(1);
    await xr.setSession(session);
    xr.setFoveation?.(1);
    this.session = session; this.active = true;
    session.addEventListener("end", () => this.exit());
    this.seat.add(this.camera); this.camera.position.set(0, 0, 0); this.camera.quaternion.identity();
    this.interior.visible = true; for (const m of this.flatParts) m.visible = false;
    this.input.xr = { active: true, roll: 0, pitch: 0, yaw: 0, thr: 0, brake: 0 };
    this.needRecenter = 30; // recenter once the headset has reported a few poses
    this.message("VR: right stick flies, left stick is throttle and rudder. Y recenters your view.", "lesson");
    this.onChange?.(true);
  }

  exit() {
    if (!this.active) return;
    this.active = false; this.session = null;
    this.input.xr = null; this.prev = {};
    this.seat.remove(this.camera); this.camera.scale.set(1, 1, 1);
    this.interior.visible = false; for (const m of this.flatParts) m.visible = true;
    this.onChange?.(false);
  }

  end() { this.session?.end(); }

  /** Put the headset where the pilot's eyes are, facing forward. */
  recenter() {
    const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, "YXZ");
    this.seat.rotation.set(0, -e.y, 0);
    this.seat.position.copy(this.camera.position).applyAxisAngle(new THREE.Vector3(0, 1, 0), -e.y).multiplyScalar(-1);
  }

  /** read the controllers into input.xr and fire button actions; call once per frame before the physics step */
  poll() {
    if (!this.active || !this.session) return;
    let left = null, right = null;
    for (const src of this.session.inputSources) {
      if (!src.gamepad) continue;
      if (src.handedness === "left") left = src.gamepad; else if (src.handedness === "right") right = src.gamepad;
    }
    const ax = (g, i) => g?.axes?.[i] ?? 0;
    const x = this.input.xr;
    x.roll = dz(ax(right, 2)); x.pitch = dz(ax(right, 3));
    x.yaw = dz(ax(left, 2)); x.thr = -dz(ax(left, 3));
    x.brake = right?.buttons?.[0]?.value || 0;
    const edge = (g, hand, i, fn) => { const k = hand + i, p = !!g?.buttons?.[i]?.pressed; if (p && !this.prev[k]) fn(); this.prev[k] = p; };
    edge(right, "R", 4, () => (this.hud().crashed ? this.keys.retry() : this.keys.flapsDown()));
    edge(right, "R", 5, () => this.keys.flapsUp());
    edge(right, "R", 3, () => this.keys.assist());
    edge(left, "L", 4, () => this.keys.mic());
    edge(left, "L", 5, () => { this.recenter(); this.message("View recentered.", "info"); });
    edge(left, "L", 3, () => this.keys.pause());
    if (this.needRecenter > 0 && --this.needRecenter === 0) this.recenter();
  }

  /** follow the airplane: rig at the pilot's eye point, aligned with the airframe */
  place(p, q) {
    this.rig.quaternion.copy(q);
    this.rig.position.copy(EYE).applyQuaternion(q).add(p);
    this.rig.updateMatrixWorld(true);
  }

  /** world position of the headset (for clouds, sky and scenery around the viewer) */
  headWorld(out) { return out.copy(this.camera.position).applyMatrix4(this.seat.matrixWorld); }

  /** redraw the dashboard instruments and the message strip */
  update(dt) {
    if (!this.active) return;
    const c = this.controls();
    for (const y of this.interior.userData.yokes) { y.rotation.z = -c.aileron * 0.7; y.position.z = y.userData.z + c.elevator * 0.07; }
    this.panelT += dt; this.hudT += dt;
    if (this.panelT > 1 / 20) {
      this.panelT = 0;
      this.panel.mode = this.panelMode() === "glass" ? "glass" : "steam";
      this.panel.draw(this.panelState()); this.panelTex.needsUpdate = true;
    }
    if (this.hudT > 0.25) { this.hudT = 0; this.drawHud(); this.hudTex.needsUpdate = true; }
  }

  message(text, kind = "info") {
    this.messages.unshift({ text, kind, t: performance.now() });
    this.messages.length = Math.min(this.messages.length, 4);
  }

  drawHud() {
    const g = this.hc.getContext("2d"), W = this.hc.width, H = this.hc.height, s = W / 1024;
    const info = this.hud();
    g.clearRect(0, 0, W, H);
    g.fillStyle = "rgba(5, 6, 7, 0.82)"; roundRect(g, 0, 0, W, H, 14 * s); g.fill();
    g.strokeStyle = "rgba(255, 255, 255, 0.18)"; g.lineWidth = 2 * s; roundRect(g, 1, 1, W - 2, H - 2, 14 * s); g.stroke();
    const pad = 22 * s; let y = 40 * s;
    const fit = (txt, maxW) => { if (g.measureText(txt).width <= maxW) return txt; while (txt.length > 1 && g.measureText(txt + "…").width > maxW) txt = txt.slice(0, -1); return txt + "…"; };
    // line 1: lesson objective
    const L = info.lesson;
    g.font = `600 ${26 * s}px Barlow, sans-serif`;
    let head = "Free flight", color = "#a4abb4";
    if (info.crashed) { head = `Flight ended: ${info.crashed} Press A to try again.`; color = "#ffb020"; }
    else if (info.paused) { head = "Paused. Press the left stick to resume."; color = "#3fd8f2"; }
    else if (L) {
      const now = L.objectives.find((o) => o.state === "now");
      if (L.done) { head = L.failed ? `Lesson ended: ${L.failed}` : "Lesson complete"; color = L.failed ? "#ffb020" : "#5be38a"; }
      else if (now) { head = now.text; color = "#ffffff"; }
    }
    const right = info.stall ? "STALL" : info.lightGun ? info.lightGun.text : "";
    const rightW = right ? (g.font = `700 ${26 * s}px Barlow, sans-serif`, g.measureText(right).width + 40 * s) : 0;
    if (right) {
      g.fillStyle = info.stall ? "#ff4d4d" : "#3fd8f2";
      g.fillText(right, W - pad - rightW + 40 * s, y);
    }
    g.font = `600 ${26 * s}px Barlow, sans-serif`; g.fillStyle = color;
    g.fillText(fit(head, W - 2 * pad - rightW), pad, y);
    // lines 2–3: recent messages
    g.font = `400 ${22 * s}px Barlow, sans-serif`;
    const fresh = this.messages.filter((m) => performance.now() - m.t < 9000).slice(0, 2);
    for (const m of fresh) {
      y += 38 * s;
      g.fillStyle = { warn: "#ffe2a6", good: "#8ff0b3", atc: "#c7f6d7", you: "#bdf3fb", lesson: "#f3b6ea" }[m.kind] || "#d5dae0";
      g.fillText(fit(m.text, W - 2 * pad), pad, y);
    }
  }
}

/** floor, side walls, footwell, glareshield lip and two yokes, in cockpit coordinates */
function buildInterior() {
  const g = new THREE.Group();
  const dark = new THREE.MeshLambertMaterial({ color: 0x14181d }), wall = new THREE.MeshLambertMaterial({ color: 0x2a2f36 }), grip = new THREE.MeshLambertMaterial({ color: 0x0c0e11 });
  const box = (w, h, d, x, y, z, m, rx = 0) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.rotation.x = rx; g.add(b); return b; };
  box(1.5, 0.5, 0.05, 0, 0.12, -1.035, dark, DASH.tilt); // panel backing
  box(1.5, 0.035, 0.18, 0, 0.345, -1.07, dark); // glareshield lip
  box(1.5, 0.5, 0.04, 0, -0.35, -1.03, dark); // footwell
  box(1.4, 0.03, 1.9, 0, -0.6, -0.25, wall); // floor
  for (const sx of [-1, 1]) box(0.03, 0.85, 1.9, sx * 0.69, -0.17, -0.25, wall); // lower side walls (windows above)
  box(1.4, 1.2, 0.03, 0, 0, 0.7, wall); // rear bulkhead
  const yokes = [];
  for (const x of [-0.32, 0.32]) {
    const y = new THREE.Group(); y.position.set(x, 0.02, -0.82); y.userData.z = -0.82;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.22, 10), grip); shaft.rotation.x = Math.PI / 2; shaft.position.z = -0.11; y.add(shaft);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.028, 0.028), grip); y.add(bar);
    for (const s of [-1, 1]) { const h = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.1, 0.034), grip); h.position.set(s * 0.15, 0.035, 0); y.add(h); }
    g.add(y); yokes.push(y);
  }
  g.userData.yokes = yokes;
  return g;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
