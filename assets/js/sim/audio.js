// WebAudio aircraft sound: a four-cylinder piston engine and two-blade propeller, wind, tire rumble, the stall-warning
// reed, touchdown and the radio click. Starts after a user gesture.
//
// The engine isn't a tone. It's built from exhaust pulses: each firing is a short burst that rings the exhaust pipe,
// each cylinder a little different, with a little jitter from cycle to cycle. Three loops are made that way at idle,
// mid and high RPM, then crossfaded and pitch-matched to the engine speed, the way recorded engine sounds are played.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const ENGINE_REFS = [800, 1600, 2500]; // RPM each loop is built at
// cylinders in firing order: slightly different strength and exhaust-pipe ring (Hz)
const CYL = [{ a: 1, f: 142 }, { a: 0.86, f: 151 }, { a: 0.95, f: 136 }, { a: 0.82, f: 159 }];

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** a looping buffer of exhaust pulses for a four-cylinder, four-stroke engine turning `rpm` */
function engineLoop(ctx, rpm, seed) {
  const sr = ctx.sampleRate, cycle = 120 / rpm; // four firings every two revolutions
  const cycles = Math.max(8, Math.round(1.6 / cycle)); // about 1.6 s, a whole number of cycles so the loop is seamless
  const n = Math.round(cycles * cycle * sr), buf = ctx.createBuffer(1, n, sr), out = buf.getChannelData(0);
  const rnd = rng(seed), tau = Math.min(0.011, (cycle / 4) * 0.7), len = Math.round(tau * 6 * sr);
  let dark = 0;
  for (let c = 0; c < cycles; c++) for (let k = 0; k < 4; k++) {
    const cyl = CYL[k], amp = cyl.a * (0.88 + 0.24 * rnd()), ph = rnd() * 6.283, fr = cyl.f * (0.97 + 0.06 * rnd());
    const t0 = Math.round(((c * 4 + k) * (cycle / 4) + (rnd() - 0.5) * 0.0005) * sr);
    for (let i = 0; i < len; i++) {
      const t = i / sr, env = (1 - Math.exp(-t / 0.0006)) * Math.exp(-t / tau), w = rnd() * 2 - 1;
      dark += 0.16 * (w - dark); // low-passed noise: the roar in the pulse
      const v = env * (0.7 * Math.sin(6.283 * fr * t + ph) + 0.22 * Math.sin(6.283 * fr * 2.13 * t + ph) + 1.5 * dark) + 0.3 * Math.exp(-t / 0.001) * w; // ring + roar + the crack of the exhaust valve
      out[(((t0 + i) % n) + n) % n] += amp * v;
    }
  }
  let peak = 0; for (let i = 0; i < n; i++) { out[i] = Math.tanh(out[i] * 1.5); peak = Math.max(peak, Math.abs(out[i])); } // a little saturation: growl, not buzz
  for (let i = 0; i < n; i++) out[i] /= peak || 1;
  return buf;
}

export class Audio {
  constructor() { this.ctx = null; this.enabled = true; }
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = 0.5; this.master.connect(ctx.destination);
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = () => { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.start(); return s; };
    const filter = (type, f, q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
    const gain = (v = 0) => { const g = ctx.createGain(); g.gain.value = v; return g; };
    // the cabin muffles engine and propeller: a low-pass that opens up in the outside views
    this.cabin = filter("lowpass", 1700, 0.5); this.cabin.connect(this.master);
    // engine: three pulse loops crossfaded by RPM, through a tone filter that brightens with power
    this.engTone = filter("lowpass", 900, 0.6); this.engGain = gain(); this.engTone.connect(this.engGain).connect(this.cabin);
    this.loops = ENGINE_REFS.map((ref, i) => {
      const src = ctx.createBufferSource(); src.buffer = engineLoop(ctx, ref, 1931 + i * 77); src.loop = true;
      const g = gain(); src.connect(g).connect(this.engTone); src.start(ctx.currentTime + i * 0.137); // offset starts so the loops don't line up
      return { ref, src, g };
    });
    // propeller: wash noise that beats at the blade-passing rate, plus its tone
    this.prop = gain(); this.prop.connect(this.cabin);
    const pw = filter("bandpass", 300, 0.8), am = gain(0.55); this.propLfo = ctx.createOscillator(); this.propLfo.frequency.value = 60; const depth = gain(0.45);
    this.propLfo.connect(depth).connect(am.gain); noise().connect(pw).connect(am).connect(this.prop); this.propLfo.start();
    this.propTone = ctx.createOscillator(); this.propTone.setPeriodicWave(ctx.createPeriodicWave(new Float32Array([0, 0, 0, 0, 0]), new Float32Array([0, 1, 0.55, 0.3, 0.12])));
    const ptg = gain(0.5); this.propTone.connect(filter("lowpass", 500)).connect(ptg).connect(this.prop); this.propTone.start();
    // wind: a low roar and a hiss, both rising with airspeed (not muffled: it's on the windshield)
    this.windLo = gain(); noise().connect(filter("lowpass", 260)).connect(this.windLo).connect(this.master);
    this.windHi = gain(); this.windF = filter("bandpass", 1200, 0.6); noise().connect(this.windF).connect(this.windHi).connect(this.master);
    // tires and gear on the ground
    this.rumble = gain(); noise().connect(filter("lowpass", 120)).connect(this.rumble).connect(this.master);
    this.roll = gain(); this.rollF = filter("bandpass", 420, 1.2); noise().connect(this.rollF).connect(this.roll).connect(this.master);
    // stall warning: a reed horn, a steady raspy tone (two reeds a few Hz apart beat gently)
    this.horn = gain(); const hb = filter("bandpass", 1450, 5);
    for (const [type, f] of [["square", 1440], ["sawtooth", 1446]]) { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.connect(hb); o.start(); }
    hb.connect(this.horn).connect(this.master);
  }

  /** view: cockpit (muffled) or an outside view (chase, orbit, tower) */
  update(ac, d, paused, view = "cockpit") {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, on = this.enabled && !paused ? 1 : 0, e = ac.eng;
    const cranking = !e.running && e.cranking, firing = e.running || cranking;
    const rpm = Number.isFinite(e.rpm) ? e.rpm : 0, r = clamp(rpm, 150, 3000) * (1 + (Math.random() - 0.5) * 0.004);
    // equal-power crossfade between the loops, each pitched to the actual RPM
    const [a, b, c] = ENGINE_REFS, x1 = clamp((r - a) / (b - a), 0, 1), x2 = clamp((r - b) / (c - b), 0, 1);
    const w = [Math.cos(x1 * Math.PI / 2), Math.sin(x1 * Math.PI / 2) * Math.cos(x2 * Math.PI / 2), Math.sin(x2 * Math.PI / 2)];
    this.loops.forEach((l, i) => { l.src.playbackRate.setTargetAtTime(r / l.ref, t, 0.03); l.g.gain.setTargetAtTime(w[i], t, 0.06); });
    const load = clamp(ac.ctl.throttle, 0, 1);
    const miss = e.rough && Math.random() < 0.25 * e.rough ? 0.35 : 1; // a rough engine skips beats
    this.engGain.gain.setTargetAtTime(on * (firing ? (cranking ? 0.18 : 0.2 + 0.28 * load) * miss : 0), t, 0.04);
    this.engTone.frequency.setTargetAtTime(450 + 1500 * load + r * 0.3, t, 0.08);
    // propeller: blade passing is two pulses a revolution
    const bpf = Math.max(1, (rpm / 60) * 2), spin = clamp(rpm / 2400, 0, 1.2);
    this.propLfo.frequency.setTargetAtTime(bpf, t, 0.03); this.propTone.frequency.setTargetAtTime(bpf, t, 0.03);
    this.prop.gain.setTargetAtTime(on * spin * spin * (0.1 + 0.16 * load), t, 0.06);
    const outside = view !== "cockpit";
    this.cabin.frequency.setTargetAtTime(outside ? 6500 : 1700, t, 0.1);
    this.master.gain.setTargetAtTime(view === "tower" ? 0.28 : 0.5, t, 0.2);
    const v = d.tas || 0, q = (v / 110) ** 2;
    this.windLo.gain.setTargetAtTime(on * Math.min(0.3, q * 0.16), t, 0.2);
    this.windHi.gain.setTargetAtTime(on * Math.min(0.2, q * 0.1), t, 0.2); this.windF.frequency.setTargetAtTime(700 + v * 9, t, 0.2);
    const g = d.onGround ? Math.min(1, d.gs / 35) : 0, grass = d.surface === "grass" || d.surface === "dirt" ? 1.7 : 1;
    this.rumble.gain.setTargetAtTime(on * 0.4 * g * grass, t, 0.05);
    this.roll.gain.setTargetAtTime(on * 0.08 * g * (grass > 1 ? 0.5 : 1), t, 0.05); this.rollF.frequency.setTargetAtTime(250 + d.gs * 6, t, 0.1);
    this.horn.gain.setTargetAtTime(on * (d.stallWarn ? 0.09 : 0), t, 0.03);
  }

  /** touchdown: the thud of the gear and, rolling fast on pavement, a short tire chirp */
  thump(fpm, gs = 50) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.25);
    const g = ctx.createGain(); g.gain.setValueAtTime(Math.min(0.8, 0.15 + fpm / 900), t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.32);
    if (gs < 25) return;
    const n = ctx.createBufferSource(), len = Math.round(ctx.sampleRate * 0.2), b = ctx.createBuffer(1, len, ctx.sampleRate), x = b.getChannelData(0);
    for (let i = 0; i < len; i++) x[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.25));
    n.buffer = b; const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1900; f.Q.value = 2.5;
    const cg = ctx.createGain(); cg.gain.value = Math.min(0.35, 0.1 + gs / 300);
    n.connect(f).connect(cg).connect(this.master); n.start(t + 0.01);
  }
  click() { if (!this.ctx || !this.enabled) return; const ctx = this.ctx, t = ctx.currentTime; const o = ctx.createOscillator(); o.type = "square"; o.frequency.value = 2200; const g = ctx.createGain(); g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05); o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.06); }
}
