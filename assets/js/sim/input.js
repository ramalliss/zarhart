// Keyboard, gamepad/joystick (with assignable axes and buttons), mouse yoke, touch sticks and tilt controls.
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const D2R = Math.PI / 180;
const CURVES = { gentle: { e: 0.75, g: 0.9 }, normal: { e: 0.5, g: 1 }, sharp: { e: 0.2, g: 1 } };
/** controller buttons that can be assigned: name -> [label, keymap key or "hold"] */
export const BUTTONS = { flapsDown: ["Flaps down", "]"], flapsUp: ["Flaps up", "["], brake: ["Brakes (hold)", "hold"], park: ["Parking brake", "S+b"], trimUp: ["Trim nose up (hold)", "hold"], trimDown: ["Trim nose down (hold)", "hold"], view: ["Change view", "c"], mic: ["Click the mic", " "], pause: ["Pause", "p"], assist: ["Flight assist", "u"] };
export const AXES = { roll: "Roll (ailerons)", pitch: "Pitch (elevator)", yaw: "Rudder", throttle: "Throttle" };

export class Input {
  constructor(el) {
    this.el = el;
    this.keys = new Set();
    this.axes = { pitch: 0, roll: 0, yaw: 0 };
    this.invert = false;
    this.mouseYoke = false;
    this.autoRudder = true;
    this.assist = "assisted"; // assisted | rudder | off
    this.tgt = null; // attitude targets for assisted mode
    this.mouse = { x: 0, y: 0, inside: false };
    this.touch = { active: false, x: 0, y: 0, throttle: null, brake: false, thrBusy: false };
    this.handlers = {}; // one-shot actions: name -> fn
    this.pad = null; this.padThrottle = null;
    this.xr = null; // VR controller state, written by vr.js each frame
    this.map = null; // assigned controls { pitch: {id, axis, inv}, ..., flapsDown: {id, btn} }, or null for automatic
    this.sens = "normal"; // stick response curve: gentle | normal | sharp
    this.learn = null; // { kind: "axis"|"button", base, cb, t0 } while waiting for a control to move
    this.tilt = { on: false, ok: false, roll: 0, pitch: 0, zero: null };
    this.floating = true; // touch stick appears under the left thumb
    addEventListener("keydown", (e) => {
      if (e.target.closest && e.target.closest("input, select, textarea")) return;
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " ", "PageUp", "PageDown", "Home", "End"].includes(e.key)) e.preventDefault();
      if (!this.keys.has(k)) this.fire(k, e);
      this.keys.add(k);
    });
    addEventListener("keyup", (e) => { const k = e.key.length === 1 ? e.key.toLowerCase() : e.key; this.keys.delete(k); if (k === "shift") { this.keys.delete("Shift"); } });
    addEventListener("blur", () => this.keys.clear());
    el.addEventListener("mousemove", (e) => { const r = el.getBoundingClientRect(); this.mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1; this.mouse.y = ((e.clientY - r.top) / r.height) * 2 - 1; });
    addEventListener("gamepadconnected", (e) => { this.pad = e.gamepad.index; this.handlers.onPad?.(e.gamepad.id); });
    addEventListener("gamepaddisconnected", () => { this.pad = null; });
  }
  on(name, fn) { this.handlers[name] = fn; }
  fire(k, e) { const map = this.handlers.keymap || {}; const fn = map[(e.shiftKey ? "S+" : "") + k] || map[k]; if (fn) fn(e); }
  held(...ks) { return ks.some((k) => this.keys.has(k)); }
  pads() { return navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : []; }
  /** stick response: more expo = finer control near the centre */
  curve(v) { const k = CURVES[this.sens] || CURVES.normal; return clamp(Math.sign(v) * ((1 - k.e) * Math.abs(v) + k.e * v * v) * k.g, -1, 1); }

  /** wait up to 10 s for the user to move an axis (kind "axis") or press a button; cb gets {id, axis} / {id, btn} or null */
  startLearn(kind, cb) {
    const base = this.pads().map((g) => ({ id: g.id, axes: [...g.axes], buttons: g.buttons.map((b) => b.pressed) }));
    this.learn = { kind, cb, base, t0: performance.now() };
  }
  /** called every frame, paused or not */
  poll() {
    const L = this.learn; if (!L) return;
    if (performance.now() - L.t0 > 10000) { this.learn = null; return L.cb(null); }
    for (const g of this.pads()) {
      const b = L.base.find((x) => x.id === g.id); if (!b) { L.base.push({ id: g.id, axes: [...g.axes], buttons: g.buttons.map((x) => x.pressed) }); continue; }
      if (L.kind === "axis") { for (let i = 0; i < g.axes.length; i++) if (Math.abs(g.axes[i] - (b.axes[i] ?? 0)) > 0.5) { this.learn = null; return L.cb({ id: g.id, axis: i, inv: false }); } }
      else for (let i = 0; i < g.buttons.length; i++) if (g.buttons[i].pressed && !b.buttons[i]) { this.learn = null; return L.cb({ id: g.id, btn: i }); }
    }
  }
  /** the usual layout of one controller: a standard gamepad (Xbox/PlayStation) or a flight joystick */
  autoMap(g) {
    const a = (axis) => (g.axes.length > axis ? { id: g.id, axis, inv: false } : null), b = (btn) => ({ id: g.id, btn });
    if (g.mapping === "standard") return { roll: a(0), pitch: a(1), yaw: a(2), throttle: null, flapsDown: b(0), flapsUp: b(1), brake: b(2), view: b(3) };
    return { roll: a(0), pitch: a(1), throttle: a(2), yaw: a(5) || a(3) };
  }
  /** the assigned layout on top of the first controller's automatic one, so assigning one control keeps the rest working */
  layout(pads = this.pads()) {
    const g = pads.find((x) => x.index === this.pad) || pads[0];
    if (!g && !this.map) return null;
    return { ...(g ? this.autoMap(g) : {}), ...(this.map || {}) };
  }
  /** current value of an assigned axis (−1..1, inverted if asked), or null if its device isn't connected */
  axis(a, pads = this.pads()) { if (!a || a.axis == null) return null; const g = pads.find((x) => x.id === a.id); if (!g) return null; const v = g.axes[a.axis] || 0; return a.inv ? -v : v; }

  /** tilt to fly: roll like a steering wheel, tilt the top edge away to push the nose down */
  async setTilt(on) {
    const T = this.tilt; T.on = on; T.zero = null; T.ok = false;
    if (!on) { removeEventListener("deviceorientation", this._ori); return true; }
    if (typeof DeviceOrientationEvent !== "undefined" && DeviceOrientationEvent.requestPermission) {
      try { if ((await DeviceOrientationEvent.requestPermission()) !== "granted") { T.on = false; return false; } } catch { T.on = false; return false; }
    }
    this._ori ||= (e) => {
      if (e.beta == null || e.gamma == null) return;
      const b = e.beta * D2R, g = e.gamma * D2R;
      const dx = Math.sin(g) * Math.cos(b), dy = -Math.sin(b), dz = -Math.cos(g) * Math.cos(b); // "down" in device axes
      const a = ((screen.orientation?.angle ?? window.orientation ?? 0) + 360) % 360;
      const [sx, sy] = a === 90 ? [-dy, dx] : a === 270 ? [dy, -dx] : a === 180 ? [-dx, -dy] : [dx, dy]; // in screen axes
      const roll = Math.atan2(sx, -sy) / D2R, back = Math.asin(clamp(-dz, -1, 1)) / D2R;
      T.zero ??= { roll: 0, back }; T.roll = roll - T.zero.roll; T.pitch = back - T.zero.back; T.ok = true;
    };
    addEventListener("deviceorientation", this._ori); return true;
  }
  recenterTilt() { if (this.tilt.on) { this.tilt.zero = null; } }

  /** update aircraft controls; dt seconds */
  apply(ac, dt) {
    const c = ac.ctl;
    const ramp = (cur, target, up, down) => { const r = Math.abs(target) > Math.abs(cur) || Math.sign(target) !== Math.sign(cur) ? up : down; return cur + clamp(target - cur, -r * dt, r * dt); };
    // keyboard targets
    let pitchT = 0, rollT = 0, yawT = 0;
    if (this.held("ArrowUp", "w")) pitchT -= 1;
    if (this.held("ArrowDown", "s")) pitchT += 1;
    if (this.held("ArrowLeft", "a")) rollT -= 1;
    if (this.held("ArrowRight", "d")) rollT += 1;
    if (this.held("q")) yawT -= 1;
    if (this.held("e")) yawT += 1;
    yawT += this.touch.yaw || 0; // touch rudder buttons
    if (this.invert) pitchT = -pitchT;
    let usingAnalog = false;
    // assigned joystick / throttle / pedal axes and buttons (any number of devices)
    const dz = (v) => (Math.abs(v) < 0.08 ? 0 : (v - Math.sign(v) * 0.08) / 0.92);
    const pads = this.pads(), m = this.layout(pads);
    this._holds = {};
    if (m) {
      const r = dz(this.axis(m.roll, pads) ?? 0), p = dz(this.axis(m.pitch, pads) ?? 0), y = this.axis(m.yaw, pads), th = this.axis(m.throttle, pads);
      if (r || p) { usingAnalog = true; rollT = r; pitchT = this.invert ? -p : p; }
      if (y != null && dz(y)) yawT = dz(y);
      if (th != null) { const t = clamp((1 - th) / 2, 0, 1); if (this.padThrottle == null || Math.abs(t - this.padThrottle) > 0.01) { c.throttle = t; this.padThrottle = t; } }
      else for (const g of pads) if (g.mapping === "standard") c.throttle = clamp(c.throttle + ((g.buttons[7]?.value || 0) - (g.buttons[6]?.value || 0)) * 0.6 * dt, 0, 1); // gamepad triggers
      this._btnPrev ||= {};
      for (const [fn, [, key]] of Object.entries(BUTTONS)) {
        const b = m[fn]; if (!b || b.btn == null) continue;
        const on = !!pads.find((g) => g.id === b.id)?.buttons[b.btn]?.pressed;
        if (key === "hold") this._holds[fn] = on; else if (on && !this._btnPrev[fn]) (this.handlers.keymap?.[key])?.();
        this._btnPrev[fn] = on;
      }
    }
    // VR controllers: right stick flies, left stick is rudder (and throttle, below)
    const xr = this.xr?.active ? this.xr : null;
    if (xr && (xr.roll || xr.pitch || xr.yaw)) { usingAnalog = true; rollT = xr.roll; pitchT = this.invert ? -xr.pitch : xr.pitch; yawT = xr.yaw; }
    // mouse yoke (dead zone around the reticle at screen centre)
    if (this.mouseYoke && !usingAnalog && pitchT === 0 && rollT === 0) {
      const dzm = (v) => (Math.abs(v) < 0.06 ? 0 : (v - Math.sign(v) * 0.06) / 0.94);
      usingAnalog = true; rollT = clamp(dzm(this.mouse.x) * 1.3, -1, 1); pitchT = clamp(dzm(this.mouse.y) * 1.5, -1, 1) * (this.invert ? -1 : 1);
    }
    // tilt to fly (full deflection at 30° of roll or 20° of pitch), unless a thumb is on the touch stick
    const T = this.tilt;
    if (T.on && T.ok && !this.touch.active) { usingAnalog = true; rollT = clamp(T.roll / 30, -1, 1); pitchT = clamp(-T.pitch / 20, -1, 1) * (this.invert ? -1 : 1); }
    // touch stick
    if (this.touch.active) { usingAnalog = true; rollT = this.touch.x; pitchT = this.touch.y * (this.invert ? -1 : 1); }
    this.manRudder = this.manRudder || 0;
    if (usingAnalog) { rollT = this.curve(rollT); pitchT = this.curve(pitchT); } // sensitivity setting
    const d = ac.derived || {};
    const assisted = this.assist === "assisted" && !d.onGround;
    if (assisted) {
      // rate command, attitude hold: inputs change pitch/bank; let go and the attitude is held
      const pIn = pitchT, rIn = rollT;
      if (!this.tgt) this.tgt = { pitch: d.pitch || 0, bank: Math.abs(d.bank || 0) < 7 ? 0 : d.bank };
      const t = this.tgt;
      if (Math.abs(pIn) > 0.04) t.pitch += pIn * 5 * dt;
      if (Math.abs(rIn) > 0.04) t.bank += rIn * 32 * dt;
      else if (Math.abs(t.bank) < 7) t.bank -= Math.sign(t.bank) * Math.min(Math.abs(t.bank), 10 * dt); // wing leveller
      t.pitch = clamp(clamp(t.pitch, -20, 25), (d.pitch || 0) - 8, (d.pitch || 0) + 8);
      t.bank = clamp(clamp(t.bank, -60, 60), (d.bank || 0) - 15, (d.bank || 0) + 15);
      const q = ac.w ? ac.w.y * 57.3 : 0, p = ac.w ? ac.w.x * 57.3 : 0; // body rates, deg/s
      const bankFF = 0.18 * (1 / Math.cos(Math.min(70, Math.abs(d.bank || 0)) * Math.PI / 180) - 1);
      c.elevator = clamp(0.085 * (t.pitch - (d.pitch || 0)) - 0.03 * q + bankFF, -1, 1);
      const be = t.bank - (d.bank || 0); this.bI = clamp((this.bI || 0) + be * dt, -20, 20); if (Math.abs(rIn) > 0.04) this.bI *= 0.98;
      c.aileron = clamp(0.075 * be + 0.012 * this.bI - 0.016 * p, -1, 1);
      c.trim = clamp(c.trim + c.elevator * 0.25 * dt, -1, 1); // auto-trim
      this.manRudder = usingAnalog ? yawT : ramp(this.manRudder, yawT, 4, 5);
    } else if (usingAnalog) { this.tgt = null; c.elevator = pitchT; c.aileron = rollT; this.manRudder = Math.abs(yawT) > 0 ? yawT : ramp(this.manRudder, 0, 2.5, 3); }
    else {
      this.tgt = null;
      c.elevator = ramp(c.elevator, pitchT * 0.85, 4, 5);
      c.aileron = ramp(c.aileron, rollT * 0.9, 5, 6);
      this.manRudder = ramp(this.manRudder, yawT, 4, 5);
    }
    c.rudder = this.manRudder;
    // auto-rudder (like MSFS for keyboard pilots): keeps the ball centred in the air, damps yaw on the ground
    if ((this.autoRudder || this.assist !== "off") && yawT === 0) {
      const yawRate = ac.w ? ac.w.z : 0;
      if (this.hdgRef == null || !d.onGround || (d.gs || 0) < 2) this.hdgRef = d.hdg;
      const herr = ((this.hdgRef - (d.hdg || 0) + 540) % 360) - 180;
      const target = d.onGround ? clamp(herr * 0.4 - yawRate * 9, -1, 1) : clamp((d.ball || 0) * 1.6 - yawRate * 0.6, -1, 1);
      this._auto = clamp((this._auto || 0) + clamp(target - (this._auto || 0), -6 * dt, 6 * dt), -0.9, 0.9);
      c.rudder = clamp(this.manRudder + this._auto, -1, 1);
    } else { this._auto = 0; this.hdgRef = null; }
    // throttle, trim, brakes (keyboard)
    if (this.held("r", "PageUp", "+", "=")) c.throttle = clamp(c.throttle + 0.45 * dt, 0, 1);
    if (this.held("f", "PageDown", "-")) c.throttle = clamp(c.throttle - 0.45 * dt, 0, 1);
    if (this.touch.throttle != null) { c.throttle = this.touch.throttle; this.touch.throttle = null; } // slider moves set it once; lessons and keys can still change it
    if (xr?.thr) c.throttle = clamp(c.throttle + xr.thr * 0.5 * dt, 0, 1);
    if (this.held("t", "Home") || this._holds.trimUp) c.trim = clamp(c.trim + 0.22 * dt, -1, 1);
    if (this.held("g", "End") || this._holds.trimDown) c.trim = clamp(c.trim - 0.22 * dt, -1, 1);
    const b = Math.max(this.held("b") ? 1 : 0, xr ? xr.brake : 0, this.touch.brake || this._holds.brake ? 1 : 0);
    c.brake = b; c.brakeL = this.held(",") ? 1 : 0; c.brakeR = this.held(".") ? 1 : 0;
    if (b && Math.abs(c.rudder) > 0.2) { c.brakeL = c.rudder < 0 ? 1 : 0.3; c.brakeR = c.rudder > 0 ? 1 : 0.3; c.brake = 0; }
  }

  /** true when a touch at screen x belongs to the floating stick (the camera drag ignores it) */
  claimsTouch(x) { return this.floating && x < innerWidth * 0.45; }

  /** touch controls: the left stick (fixed, or floating under the thumb), and on the right either the throttle
   *  slider or a throttle/rudder stick (up/down holds the throttle, left/right is rudder and springs back) */
  attachTouch({ stick, knob, thr, stick2, knob2 }) {
    const T = this.touch, ours = (e, id) => [...e.changedTouches].find((t) => t.identifier === id);
    // left stick
    let id = null, ox = 0, oy = 0, R = 50;
    const move = (t) => { const x = clamp((t.clientX - ox) / R, -1, 1), y = clamp((t.clientY - oy) / R, -1, 1); T.active = true; T.x = x; T.y = y; knob.style.transform = `translate(${x * 34}px, ${y * 34}px)`; };
    const start = (t, floating) => {
      id = t.identifier; stick.style.transform = "";
      const r = stick.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if (floating) { stick.style.transform = `translate(${t.clientX - cx}px, ${t.clientY - cy}px)`; ox = t.clientX; oy = t.clientY; R = 50; } else { ox = cx; oy = cy; R = r.width * 0.4; }
      stick.classList.add("live"); move(t);
    };
    const end = () => { id = null; T.active = false; knob.style.transform = ""; stick.style.transform = ""; stick.classList.remove("live"); };
    stick.addEventListener("touchstart", (e) => { e.preventDefault(); if (id == null) start(e.changedTouches[0], false); }, { passive: false });
    this.el.addEventListener("touchstart", (e) => { if (id != null) return; const t = [...e.changedTouches].find((x) => this.claimsTouch(x.clientX)); if (t) { e.preventDefault(); start(t, true); } }, { passive: false });
    // right throttle/rudder stick
    let id2 = null, cx2 = 0, cy2 = 0, R2 = 50;
    const move2 = (t) => { const x = clamp((t.clientX - cx2) / R2, -1, 1), y = clamp((t.clientY - cy2) / R2, -1, 1); T.yaw = Math.abs(x) < 0.12 ? 0 : x; T.throttle = (1 - y) / 2; knob2.style.transform = `translate(${x * 34}px, ${y * 34}px)`; };
    stick2?.addEventListener("touchstart", (e) => { e.preventDefault(); if (id2 != null) return; const t = e.changedTouches[0], r = stick2.getBoundingClientRect(); id2 = t.identifier; cx2 = r.left + r.width / 2; cy2 = r.top + r.height / 2; R2 = r.width * 0.4; T.thrBusy = true; stick2.classList.add("live"); move2(t); }, { passive: false });
    addEventListener("touchmove", (e) => {
      const a = id != null && ours(e, id), b = id2 != null && ours(e, id2);
      if (a) move(a); if (b) move2(b); if (a || b) e.preventDefault();
    }, { passive: false });
    const lift = (e) => { if (id != null && ours(e, id)) end(); if (id2 != null && ours(e, id2)) { id2 = null; T.yaw = 0; T.thrBusy = false; stick2.classList.remove("live"); } };
    addEventListener("touchend", lift); addEventListener("touchcancel", lift);
    // throttle slider
    thr.addEventListener("input", () => { T.throttle = thr.value / 100; });
    const busy = (on) => () => { T.thrBusy = on; };
    thr.addEventListener("pointerdown", busy(true)); thr.addEventListener("pointerup", busy(false)); thr.addEventListener("pointercancel", busy(false));
  }
}
