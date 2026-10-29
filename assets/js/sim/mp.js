// Multiplayer: join a Zarhart server (see server/README.md), fly in the same sky as everyone else and talk on the radio.
// Voice is sent only while you hold push-to-talk, as 8 kHz μ-law (aviation-radio quality). What you hear goes through
// an AM radio sound: band-limited, a little distorted and compressed, with static that grows as the station gets
// farther away, a squelch tail when it stops, and a squeal when two stations transmit on the same frequency at once.
import * as THREE from "three";
import { buildAirplane, animateAirplane } from "./plane3d.js";

/* G.711 μ-law, the encoding telephone and radio links have used for decades */
function linToMu(x) { let s = Math.max(-1, Math.min(1, x)) * 32635; const sign = s < 0 ? 0x80 : 0; if (sign) s = -s; s += 132; let e = 7; for (let m = 0x4000; (s & m) === 0 && e > 0; m >>= 1) e--; return ~(sign | (e << 4) | ((s >> (e + 3)) & 0x0f)) & 0xff; }
function muToLin(u) { u = ~u & 0xff; const sign = u & 0x80, e = (u >> 4) & 7, m = u & 0x0f; const s = (((m << 3) + 132) << e) - 132; return (sign ? -s : s) / 32635; }
export const MU = { linToMu, muToLin };

function tagSprite(text) {
  const c = document.createElement("canvas"); c.width = 256; c.height = 64; const g = c.getContext("2d");
  g.fillStyle = "rgba(5,6,7,.72)"; g.beginPath(); g.roundRect(2, 2, 252, 44, 8); g.fill();
  g.fillStyle = "#7fe3ff"; g.font = "bold 26px Arial"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, 128, 25);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, sizeAttenuation: false, depthWrite: false, transparent: true, fog: false }));
  sp.center.set(0.5, 0); sp.scale.set(0.11, 0.0275, 1); sp.renderOrder = 9; return sp;
}

export class Multiplayer {
  /** o: { scene, ctx() → AudioContext, state() → own state, radio() → sim.radio, on: { text, notice, world, status, roster } } */
  constructor(o) { this.o = o; this.ws = null; this.id = 0; this.players = new Map(); this.remote = new Map(); this.rx = new Map(); this.connected = false; this.role = "pilot"; this.facilities = {}; this.seq = 0; }

  get url() { return this._url; }
  /** server: an http(s) or ws(s) address; the WebSocket lives at /mp */
  connect(server, hello) {
    this.disconnect();
    let u = String(server).trim(); if (!/^\w+:\/\//.test(u)) u = (location.protocol === "https:" ? "wss://" : "ws://") + u;
    u = u.replace(/^http/, "ws").replace(/\/+$/, ""); if (!/\/mp$/.test(u)) u += "/mp";
    this._url = u; this.status("Connecting…");
    let ws; try { ws = this.ws = new WebSocket(u); } catch (e) { return this.status(`Couldn't connect: ${e.message}`, true); }
    ws.binaryType = "arraybuffer";
    ws.onopen = () => ws.send(JSON.stringify({ t: "hello", v: 1, ...hello }));
    ws.onclose = () => { if (this.ws === ws) { this.cleanup(); this.status(this.denied || "Disconnected.", true); } };
    ws.onerror = () => this.status(location.protocol === "https:" && u.startsWith("ws:") ? "This page is https, so the server needs a wss:// (https) address." : "Couldn't reach that server.", true);
    ws.onmessage = (e) => (typeof e.data === "string" ? this.onJSON(JSON.parse(e.data)) : this.onAudio(new Uint8Array(e.data)));
  }
  disconnect() { if (this.ws) { const w = this.ws; this.ws = null; try { w.close(); } catch { /* closed */ } } this.cleanup(); }
  cleanup() {
    for (const r of this.remote.values()) { this.o.scene.remove(r.g); }
    this.remote.clear(); this.players.clear(); this.rx.clear(); this.connected = false; this.stopMic(); this.o.on.roster?.();
  }
  status(text, bad = false) { this.statusText = text; this.o.on.status?.(text, bad); }
  send(o) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(o)); }

  onJSON(m) {
    if (m.t === "welcome") {
      this.connected = true; this.id = m.id; this.callsign = m.callsign; this.role = m.role; this.facility = m.facility; this.facilities = m.facilities; this.serverName = m.name; this.denied = null;
      for (const p of m.players) this.players.set(p.id, p);
      this.status(`Connected to ${m.name} as ${m.role === "atc" ? m.facilities[m.facility].name : m.callsign}.`); this.o.on.world?.(m.world); this.o.on.roster?.();
    } else if (m.t === "denied") { this.denied = m.why; this.status(m.why, true); }
    else if (m.t === "join") { this.players.set(m.p.id, m.p); this.o.on.notice?.(`${m.p.role === "atc" ? this.facilities[m.p.facility]?.name : m.p.callsign} joined.`); this.o.on.roster?.(); }
    else if (m.t === "leave") { const p = this.players.get(m.id); this.players.delete(m.id); const r = this.remote.get(m.id); if (r) { this.o.scene.remove(r.g); this.remote.delete(m.id); } this.rx.delete(m.id); if (p) this.o.on.notice?.(`${p.callsign} left.`); this.o.on.roster?.(); }
    else if (m.t === "states") { for (const s of m.list) if (s[0] !== this.id) this.onState(s); }
    else if (m.t === "text") this.o.on.text?.(m.from, m.text, m.freq, m.sig);
    else if (m.t === "rx") this.onRx(m);
    else if (m.t === "world") this.o.on.world?.(m.world);
    else if (m.t === "notice") this.o.on.notice?.(m.text);
  }

  /* ---------- other airplanes ---------- */
  onState(s) {
    const [id, x, y, z, qx, qy, qz, qw, gs, flaps, lights, rpm, alt, xpdr, com1, com2, mode = "ALT", ident = 0] = s, p = this.players.get(id); if (!p) return;
    let r = this.remote.get(id);
    if (!r) {
      const g = buildAirplane({ reg: p.callsign.slice(0, 8), stripe: 0x3fd8f2, simple: true, type: p.type }); const tag = tagSprite(p.callsign); tag.position.set(0, 2.6, 0); g.add(tag);
      this.o.scene.add(g); r = { g, buf: [], fake: { ctl: { elevator: 0, aileron: 0, rudder: 0, trim: 0 }, eng: { rpm: 0 }, elec: { lights: {} }, powered: true, flaps: 0 } }; this.remote.set(id, r);
    }
    r.buf.push({ t: performance.now(), p: new THREE.Vector3(x, y, z), q: new THREE.Quaternion(qx, qy, qz, qw) }); if (r.buf.length > 8) r.buf.shift();
    Object.assign(r, { gs, alt, xpdr, com1, com2, mode, ident: !!ident }); r.fake.eng.rpm = rpm; r.fake.flaps = flaps;
    r.fake.elec.lights = { nav: !!(lights & 1), beacon: !!(lights & 2), strobe: !!(lights & 4), landing: !!(lights & 8) };
  }
  /** draw everyone 250 ms in the past, between the two updates around that moment */
  update(dt, t) {
    const now = performance.now() - 250;
    for (const r of this.remote.values()) {
      const b = r.buf; if (!b.length) continue;
      let i = b.findIndex((s) => s.t > now); if (i < 0) i = b.length - 1;
      const A = b[Math.max(0, i - 1)], B = b[i], k = B.t === A.t ? 1 : Math.min(1, Math.max(0, (now - A.t) / (B.t - A.t)));
      r.g.position.lerpVectors(A.p, B.p, k); r.g.quaternion.slerpQuaternions(A.q, B.q, k);
      animateAirplane(r.g, r.fake, t, dt);
    }
    this.stateT = (this.stateT || 0) + dt;
    if (this.connected && this.role === "pilot" && this.stateT > 0.2) { this.stateT = 0; this.send({ t: "state", ...this.o.state() }); }
    if (this.mic?.on && performance.now() - this.mic.t0 > 120000) { this.o.on.notice?.("Stuck mic: transmission cut after two minutes."); this.pttUp(); }
  }

  /* ---------- the radio ---------- */
  /** is anyone controlling this frequency? (then the automated controller stays quiet) */
  hasController(freq) { return [...this.players.values()].some((p) => p.role === "atc" && Math.abs(this.facilities[p.facility]?.freq - freq) < 0.004) || (this.role === "atc" && Math.abs(this.facilities[this.facility]?.freq - freq) < 0.004); }
  transmitting(freq) { return [...this.rx.values()].filter((x) => Math.abs(x.freq - freq) < 0.004); }
  setVolume(v) { this.volume = v; if (this.fx) this.fx.out.gain.value = 0.9 * v / 0.8; }
  sendText(freq, text) { this.send({ t: "text", freq, text }); }

  async pttDown(freq) {
    if (!this.connected) return;
    this.send({ t: "tx", on: true, freq }); this.txFreq = freq;
    const ctx = this.o.ctx(); if (!ctx) return;
    try {
      if (!this.stream) this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch { this.o.on.notice?.("Microphone blocked. Allow it to talk on the radio (typed transmissions still work)."); return; }
    if (!this.txFreq) return; // let go already
    const src = ctx.createMediaStreamSource(this.stream), proc = ctx.createScriptProcessor(2048, 1, 1), ratio = ctx.sampleRate / 8000, mute = ctx.createGain(); mute.gain.value = 0;
    let acc = 0, accN = 0, pos = 0, out = [];
    proc.onaudioprocess = (e) => {
      const x = e.inputBuffer.getChannelData(0);
      for (let i = 0; i < x.length; i++) { acc += x[i]; accN++; pos++; if (pos >= ratio) { pos -= ratio; out.push(linToMu((acc / accN) * 1.6)); acc = 0; accN = 0; } }
      while (out.length >= 320) { const pkt = new Uint8Array(3 + 320); pkt[0] = 1; pkt[1] = (this.seq >> 8) & 255; pkt[2] = this.seq++ & 255; pkt.set(out.splice(0, 320), 3); if (this.ws?.readyState === 1) this.ws.send(pkt); }
    };
    src.connect(proc).connect(mute).connect(ctx.destination);
    this.mic = { src, proc, mute, on: true, t0: performance.now() };
  }
  pttUp() { if (this.txFreq) this.send({ t: "tx", on: false }); this.txFreq = null; this.stopMic(); }
  stopMic() { if (this.mic) { try { this.mic.src.disconnect(); this.mic.proc.disconnect(); this.mic.mute.disconnect(); } catch { /* gone */ } this.mic = null; } }

  /** the receiver: one AM-radio sound chain, static by signal strength, a heterodyne squeal when two stations collide */
  chain() {
    if (this.fx) return this.fx;
    const ctx = this.o.ctx(); if (!ctx) return null;
    const f = (type, freq, q, gain) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = freq; b.Q.value = q; if (gain != null) b.gain.value = gain; return b; };
    const input = ctx.createGain(), hp = f("highpass", 350, 0.7), lp = f("lowpass", 2700, 0.9), pk = f("peaking", 1800, 1, 4);
    const sh = ctx.createWaveShaper(), curve = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(2.2 * x) / Math.tanh(2.2); } sh.curve = curve;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -26; comp.ratio.value = 6;
    const out = ctx.createGain(); out.gain.value = 0.9 * (this.volume ?? 0.8) / 0.8; input.connect(hp).connect(lp).connect(pk).connect(sh).connect(comp).connect(out).connect(ctx.destination);
    const nb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const ns = ctx.createBufferSource(); ns.buffer = nb; ns.loop = true; const noise = ctx.createGain(); noise.gain.value = 0; ns.connect(f("bandpass", 1600, 0.5)).connect(noise).connect(out); ns.start();
    const het = ctx.createOscillator(); het.frequency.value = 1150; const hg = ctx.createGain(); hg.gain.value = 0; het.connect(hg).connect(out); het.start();
    this.fx = { ctx, input, noise, hg, het, out };
    return this.fx;
  }
  /** a station keyed or unkeyed on a frequency we're listening to */
  onRx(m) {
    if (m.on) this.rx.set(m.id, { freq: m.freq, from: m.from, sig: 1, next: 0 });
    else { this.rx.delete(m.id); this.squelchTail(); }
    this.mix();
    this.o.on.rx?.();
  }
  squelchTail() { const fx = this.chain(); if (!fx) return; const t = fx.ctx.currentTime; fx.noise.gain.cancelScheduledValues(t); fx.noise.gain.setValueAtTime(0.28, t); fx.noise.gain.exponentialRampToValueAtTime(0.0001, t + 0.13); }
  mix() {
    const fx = this.chain(); if (!fx) return;
    const act = [...this.rx.values()], t = fx.ctx.currentTime, byFreq = {};
    for (const a of act) (byFreq[a.freq] ||= []).push(a);
    const blocked = Object.values(byFreq).some((l) => l.length > 1);
    fx.hg.gain.setTargetAtTime(blocked ? 0.06 : 0, t, 0.02); fx.het.frequency.setValueAtTime(900 + Math.random() * 600, t);
    const weakest = act.length ? Math.min(...act.map((a) => a.sig)) : 1;
    if (act.length) fx.noise.gain.setTargetAtTime(0.02 + 0.22 * (1 - weakest), t, 0.05);
  }
  onAudio(b) {
    if (b.length < 13) return;
    const dv = new DataView(b.buffer, b.byteOffset), id = dv.getUint32(0), sig = b[8] / 255, data = b.subarray(12);
    const r = this.rx.get(id); if (!r) return;
    const radio = this.o.radio(); // the audio panel decides what you hear
    const hear = (radio.rx1 && Math.abs(radio.com1 - r.freq) < 0.004) || (radio.rx2 && Math.abs(radio.com2 - r.freq) < 0.004) || this.role === "atc";
    if (!hear) return;
    r.sig = sig; this.mix();
    const fx = this.chain(); if (!fx) return;
    const buf = fx.ctx.createBuffer(1, data.length, 8000), ch = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) ch[i] = muToLin(data[i]);
    const src = fx.ctx.createBufferSource(); src.buffer = buf; src.connect(fx.input);
    const t = fx.ctx.currentTime, at = Math.max(t + 0.12, r.next || 0); // a small jitter buffer
    src.start(at); r.next = at + buf.duration;
  }
}
