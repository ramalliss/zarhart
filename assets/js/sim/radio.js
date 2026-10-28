// Radio phraseology: what a pilot should say in each situation (AIM 4-2-3 and 4-3-2), how well a spoken or typed call
// matches it, and speech recognition for push-to-talk practice.

const NUM = { zero: "0", oh: "0", one: "1", won: "1", two: "2", to: "2", too: "2", three: "3", tree: "3", four: "4", for: "4", fower: "4", five: "5", fife: "5", six: "6", seven: "7", eight: "8", nine: "9", niner: "9" };
const PHON = { alpha: "a", alfa: "a", bravo: "b", charlie: "c", delta: "d", echo: "e", foxtrot: "f", golf: "g", hotel: "h", india: "i", juliet: "j", juliett: "j", kilo: "k", lima: "l", mike: "m", november: "n", oscar: "o", papa: "p", quebec: "q", romeo: "r", sierra: "s", tango: "t", uniform: "u", victor: "v", whiskey: "w", xray: "x", yankee: "y", zulu: "z" };

const STOP = new Set(["at", "to", "on", "in", "is", "it", "of", "or", "up", "by", "and", "the", "for", "via", "out", "off", "we", "are", "am", "an", "as", "be", "go", "my", "no", "so", "ft"]);
/** lower-case words, with spoken digits and phonetic letters written as characters and runs of them joined ("one niner zulu romeo" → "19zr") */
export function normalize(text) {
  const raw = String(text).toLowerCase().replace(/x-ray/g, "xray").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
  const out = [];
  for (const w of raw) {
    const t = NUM[w] ?? PHON[w] ?? w;
    const single = t.length === 1 || /^\d+$/.test(t), prev = out[out.length - 1];
    // "19 ZR": short letter groups right after a number belong to the registration
    const tail = prev?.run && /\d/.test(prev.w) && /^[a-z]{2,3}$/.test(t) && !STOP.has(t);
    if ((single || tail) && prev?.run) prev.w += t; else out.push({ w: t, run: single });
  }
  // "2 thousand 5 hundred" → "2500"
  const w = out.map((x) => x.w), res = [];
  for (let i = 0; i < w.length; i++) {
    if (/^\d+$/.test(w[i]) && (w[i + 1] === "thousand" || w[i + 1] === "hundred")) {
      let v = +w[i] * (w[i + 1] === "thousand" ? 1000 : 100); i++;
      if (w[i] === "thousand" && /^\d+$/.test(w[i + 1] || "") && w[i + 2] === "hundred") { v += +w[i + 1] * 100; i += 2; }
      res.push(String(v));
    } else res.push(w[i]);
  }
  return res;
}
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
/** a word is "heard" if a transcript word matches it closely (speech engines mangle names like Zarhart) */
function heard(words, w) {
  const cand = words.concat(words.slice(1).map((x, i) => words[i] + x)); // "czar heart" can be "zarhart"
  return cand.some((x) => x === w || (w.length >= 5 && lev(x, w) <= Math.floor(w.length / 3)) || (/\d/.test(w) && x.includes(w)));
}

/**
 * The call for a situation. ctx: { facility, callsign, short, rw, atis, miles, dir, alt, apName, pattern, onGround, emergency }.
 * parts: what a controller listens for, each matched if any of its alternatives' words are all heard.
 */
export function buildCall(kind, c) {
  const fac = normalize(c.facility), cs = normalize(c.callsign).filter((w) => /\d/.test(w)); // the registration is what identifies you
  const P = (label, ...alts) => ({ label, alts: alts.map((a) => normalize(a)) });
  const who = P("Your callsign", ...cs);
  const to = { label: `Who you're calling (${c.facility})`, alts: [fac] };
  if (kind === "taxi") return { kind, text: `${c.facility}, ${c.callsign}, at the ramp with information ${c.atis}, ready to taxi.`, parts: [to, who, P("Where you are", "ramp", "parking", "tie down", "hangar", "fbo"), P(`The ATIS letter (${c.atis})`, `information ${c.atis}`, c.atis), P("What you want", "taxi")] };
  if (kind === "depart") return { kind, text: `${c.facility}, ${c.callsign}, holding short runway ${c.rw}, ready for departure.`, parts: [to, who, P("Where you are", "holding short", "hold short", "short"), P(`The runway (${c.rw})`, c.rw), P("What you want", "ready for departure", "ready for takeoff", "ready to go", "ready")] };
  if (kind === "inbound") return { kind, text: `${c.facility}, ${c.callsign}, ${c.miles} miles ${c.dir}, ${c.alt}, inbound for landing with information ${c.atis}.`, parts: [to, who, P("Where you are", `${c.miles} miles`, "miles", c.dir), P("Your altitude", String(c.alt), `${c.alt} feet`), P("What you want", "inbound", "landing", "full stop"), P(`The ATIS letter (${c.atis})`, `information ${c.atis}`, c.atis)] };
  if (kind === "land") return { kind, text: `${c.facility}, ${c.short}, midfield downwind runway ${c.rw}, full stop.`, parts: [to, who, P("Where you are", "downwind", "midfield", "base", "final"), P("What you want", "full stop", "landing", "touch and go", "option")] };
  if (kind === "announce") {
    const first = c.apName.split(" ")[0]; // pilots say "Earhart traffic", not "Earhart Municipal traffic"
    const traffic = { label: `Who you're calling (${first} traffic)`, alts: [normalize(`${first} traffic`), normalize(first)] };
    return c.onGround
      ? { kind, text: `${first} traffic, ${c.callsign}, departing runway ${c.rw}, ${first}.`, parts: [traffic, who, P(`The runway (${c.rw})`, c.rw), P("What you're doing", "departing", "taking off", "takeoff", "departure")] }
      : { kind, text: `${first} traffic, ${c.callsign}, ${c.miles} miles ${c.dir}, ${c.alt} feet, inbound for landing runway ${c.rw}, ${c.pattern} traffic, ${first}.`, parts: [traffic, who, P("Where you are", `${c.miles} miles`, "miles", c.dir), P("Your altitude", String(c.alt)), P(`The runway (${c.rw})`, c.rw), P("What you're doing", "inbound", "landing", "entering")] };
  }
  if (kind === "mayday") return { kind, text: `Mayday, mayday, mayday, ${c.callsign}, ${c.emergency}, ${c.alt} feet, ${c.miles} miles ${c.dir} of ${c.apName}.`, parts: [P("Mayday (say it three times)", "mayday"), who, P("What's wrong", "engine", "failure", "fire", "fuel", "emergency", "smoke", "lost"), P("Your altitude or position", String(c.alt), "miles", "feet")] };
  return null;
}

/** how well a transcript matches a call: { score 0–1, pass, parts: [{ label, ok }] } */
export function scoreCall(transcript, call) {
  const words = normalize(transcript);
  const parts = call.parts.map((p) => ({ label: p.label, ok: p.alts.some((alt) => alt.length && alt.every((w) => heard(words, w))) }));
  const n = parts.filter((p) => p.ok).length, score = n / parts.length;
  return { score, parts, pass: parts[0].ok && parts[1].ok && score >= 0.75 };
}

/** push-to-talk speech recognition (Chrome, Edge, Safari). Chrome and Edge send the audio to their makers' speech service. */
export class Listener {
  constructor() { this.SR = window.SpeechRecognition || window.webkitSpeechRecognition || null; this.ok = !!this.SR; this.rec = null; }
  start(onPartial) {
    if (!this.ok || this.rec) return false;
    const r = this.rec = new this.SR(); this.alts = []; this.final = "";
    r.lang = "en-US"; r.interimResults = true; r.continuous = true; r.maxAlternatives = 3;
    r.onresult = (e) => {
      let text = ""; const alts = [];
      for (let i = 0; i < e.results.length; i++) { text += e.results[i][0].transcript + " "; if (e.results[i].isFinal) for (let k = 0; k < e.results[i].length; k++) alts[k] = (alts[k] || "") + e.results[i][k].transcript + " "; }
      this.final = text.trim(); this.alts = alts.map((a) => a.trim()).filter(Boolean); onPartial?.(this.final);
    };
    r.onerror = (e) => { this.error = e.error; };
    this.done = new Promise((res) => { r.onend = () => { this.rec = null; res([this.final, ...this.alts].filter((v, i, a) => v && a.indexOf(v) === i)); }; });
    try { r.start(); } catch { this.rec = null; return false; }
    return true;
  }
  /** stop listening; resolves with the transcript and its alternatives */
  stop() { if (!this.rec) return Promise.resolve([]); try { this.rec.stop(); } catch { /* already stopping */ } return this.done; }
}
