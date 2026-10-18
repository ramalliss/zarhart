// Keyboard, gamepad/joystick, mouse yoke and touch controls.
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

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
    this.touch = { active: false, x: 0, y: 0, throttle: null };
    this.handlers = {}; // one-shot actions: name -> fn
    this.pad = null; this.padThrottle = null;
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
    if (this.invert) pitchT = -pitchT;
    let usingAnalog = false;
    // gamepad / joystick
    const gp = this.pad != null && navigator.getGamepads ? navigator.getGamepads()[this.pad] : null;
    if (gp) {
      const dz = (v) => (Math.abs(v) < 0.08 ? 0 : (v - Math.sign(v) * 0.08) / 0.92);
      if (gp.mapping === "standard") {
        const r = dz(gp.axes[0]), p = dz(gp.axes[1]), y = dz(gp.axes[2]);
        if (r || p || y) { usingAnalog = true; rollT = r; pitchT = this.invert ? -p : p; yawT = y; }
        const rt = gp.buttons[7]?.value || 0, lt = gp.buttons[6]?.value || 0;
        c.throttle = clamp(c.throttle + (rt - lt) * 0.6 * dt, 0, 1);
        this._edge(gp, 0, () => this.handlers.keymap?.["]"]?.());
        this._edge(gp, 1, () => this.handlers.keymap?.["["]?.());
        this._edge(gp, 3, () => this.handlers.keymap?.["c"]?.());
        c.brake = gp.buttons[2]?.pressed ? 1 : c.brake;
      } else {
        const r = dz(gp.axes[0] || 0), p = dz(gp.axes[1] || 0);
        usingAnalog = true; rollT = r; pitchT = this.invert ? -p : p;
        if (gp.axes.length > 2) { const th = (1 - (gp.axes[2] || 0)) / 2; if (this.padThrottle == null || Math.abs(th - this.padThrottle) > 0.01) { c.throttle = clamp(th, 0, 1); this.padThrottle = th; } }
        if (gp.axes.length > 5) yawT = dz(gp.axes[5]); else if (gp.axes.length > 3) yawT = dz(gp.axes[3]);
      }
    }
    // mouse yoke (dead zone around the reticle at screen centre)
    if (this.mouseYoke && !usingAnalog && pitchT === 0 && rollT === 0) {
      const dzm = (v) => (Math.abs(v) < 0.06 ? 0 : (v - Math.sign(v) * 0.06) / 0.94);
      usingAnalog = true; rollT = clamp(dzm(this.mouse.x) * 1.3, -1, 1); pitchT = clamp(dzm(this.mouse.y) * 1.5, -1, 1) * (this.invert ? -1 : 1);
    }
    // touch stick
    if (this.touch.active) { usingAnalog = true; rollT = this.touch.x; pitchT = this.touch.y * (this.invert ? -1 : 1); }
    this.manRudder = this.manRudder || 0;
    const expo = (v) => Math.sign(v) * (0.35 * Math.abs(v) + 0.65 * v * v);
    const d = ac.derived || {};
    const assisted = this.assist === "assisted" && !d.onGround;
    if (assisted) {
      // rate command, attitude hold: inputs change pitch/bank; let go and the attitude is held
      const pIn = usingAnalog ? expo(pitchT) : pitchT, rIn = usingAnalog ? expo(rollT) : rollT;
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
    if (this.touch.throttle != null) c.throttle = this.touch.throttle;
    if (this.held("t", "Home")) c.trim = clamp(c.trim + 0.22 * dt, -1, 1);
    if (this.held("g", "End")) c.trim = clamp(c.trim - 0.22 * dt, -1, 1);
    const b = this.held("b") ? 1 : 0;
    c.brake = b; c.brakeL = this.held(",") ? 1 : 0; c.brakeR = this.held(".") ? 1 : 0;
    if (b && Math.abs(c.rudder) > 0.2) { c.brakeL = c.rudder < 0 ? 1 : 0.3; c.brakeR = c.rudder > 0 ? 1 : 0.3; c.brake = 0; }
  }
  _edge(gp, i, fn) { this._prev ||= {}; const p = !!gp.buttons[i]?.pressed; if (p && !this._prev[i]) fn(); this._prev[i] = p; }

  /** on-screen stick (left) and throttle (right) for touch devices */
  attachTouch(stickEl, knobEl, thrEl) {
    const stick = (e) => { const r = stickEl.getBoundingClientRect(); const t = [...e.touches].find((tt) => tt.clientX < innerWidth / 2) || e.touches[0]; if (!t) return; const x = clamp(((t.clientX - r.left) / r.width) * 2 - 1, -1, 1), y = clamp(((t.clientY - r.top) / r.height) * 2 - 1, -1, 1); this.touch.active = true; this.touch.x = x; this.touch.y = y; knobEl.style.transform = `translate(${x * 34}px, ${y * 34}px)`; e.preventDefault(); };
    stickEl.addEventListener("touchstart", stick, { passive: false }); stickEl.addEventListener("touchmove", stick, { passive: false });
    stickEl.addEventListener("touchend", () => { this.touch.active = false; knobEl.style.transform = ""; });
    thrEl.addEventListener("input", () => { this.touch.throttle = thrEl.value / 100; });
  }
}
