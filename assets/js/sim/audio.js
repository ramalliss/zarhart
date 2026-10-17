// WebAudio: engine, wind, stall horn, rumble, touchdown, radio click. Starts after a user gesture.
export class Audio {
  constructor() { this.ctx = null; this.enabled = true; }
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = 0.55; this.master.connect(ctx.destination);
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = () => { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.start(); return s; };
    // engine: two detuned saws + filtered noise
    this.eng = ctx.createGain(); this.eng.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 420; lp.Q.value = 0.8;
    this.o1 = ctx.createOscillator(); this.o1.type = "sawtooth"; this.o2 = ctx.createOscillator(); this.o2.type = "square";
    const g2 = ctx.createGain(); g2.gain.value = 0.35;
    this.o1.connect(lp); this.o2.connect(g2).connect(lp);
    const en = noise(); const enf = ctx.createBiquadFilter(); enf.type = "bandpass"; enf.frequency.value = 180; enf.Q.value = 0.7; const eng2 = ctx.createGain(); eng2.gain.value = 0.5; en.connect(enf).connect(eng2).connect(lp);
    lp.connect(this.eng).connect(this.master); this.engLp = lp;
    this.o1.start(); this.o2.start();
    // wind
    this.wind = ctx.createGain(); this.wind.gain.value = 0; const wn = noise(); const wf = ctx.createBiquadFilter(); wf.type = "bandpass"; wf.frequency.value = 900; wf.Q.value = 0.4; wn.connect(wf).connect(this.wind).connect(this.master); this.windF = wf;
    // rumble
    this.rumble = ctx.createGain(); this.rumble.gain.value = 0; const rn = noise(); const rf = ctx.createBiquadFilter(); rf.type = "lowpass"; rf.frequency.value = 110; rn.connect(rf).connect(this.rumble).connect(this.master);
    // stall horn (reed ~1.3 kHz with a little warble)
    this.horn = ctx.createGain(); this.horn.gain.value = 0; const ho = ctx.createOscillator(); ho.type = "triangle"; ho.frequency.value = 1320; const lfo = ctx.createOscillator(); lfo.frequency.value = 9; const lg = ctx.createGain(); lg.gain.value = 22; lfo.connect(lg).connect(ho.frequency); ho.connect(this.horn).connect(this.master); ho.start(); lfo.start();
  }
  update(ac, d, paused) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, on = this.enabled && !paused ? 1 : 0;
    const rpm = Number.isFinite(ac.eng.rpm) ? ac.eng.rpm : 0, f = Math.max(20, rpm / 60 * 2);
    this.o1.frequency.setTargetAtTime(f, t, 0.05); this.o2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    this.engLp.frequency.setTargetAtTime(250 + rpm * 0.25, t, 0.1);
    const rough = ac.eng.rough ? 1 - 0.4 * ac.eng.rough * Math.random() : 1;
    this.eng.gain.setTargetAtTime(on * (ac.eng.running ? 0.05 + 0.13 * (rpm / 2700) : ac.eng.cranking ? 0.06 : 0) * rough, t, 0.05);
    const v = d.tas || 0;
    this.wind.gain.setTargetAtTime(on * Math.min(0.22, (v / 120) ** 2 * 0.16), t, 0.2); this.windF.frequency.setTargetAtTime(500 + v * 8, t, 0.2);
    this.rumble.gain.setTargetAtTime(on * (d.onGround ? Math.min(0.5, d.gs / 40) * (d.surface === "grass" ? 1.6 : 1) : 0), t, 0.05);
    this.horn.gain.setTargetAtTime(on * (d.stallWarn ? 0.07 : 0), t, 0.02);
  }
  thump(fpm) { if (!this.ctx || !this.enabled) return; const ctx = this.ctx, t = ctx.currentTime; const o = ctx.createOscillator(); o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.25); const g = ctx.createGain(); g.gain.setValueAtTime(Math.min(0.8, 0.15 + fpm / 900), t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3); o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.32); }
  click() { if (!this.ctx || !this.enabled) return; const ctx = this.ctx, t = ctx.currentTime; const o = ctx.createOscillator(); o.type = "square"; o.frequency.value = 2200; const g = ctx.createGain(); g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05); o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.06); }
}
