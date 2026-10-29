#!/usr/bin/env node
// Zarhart multiplayer server: one shared sky, with radios that work like the real ones.
//
//   node server/zarhart-server.mjs [--port 8080] [--name "My Zarhart server"] [--password secret] [--max 32]
//
// It serves the whole site (so friends just open http://your-address:8080/sim/) and a WebSocket at /mp for
// positions and the radio. No dependencies: Node 18 or newer. Type `help` in the console for host commands.
//
// The radio is relayed like VHF: you hear a station only if one of your radios is tuned to its frequency and you're
// in line of sight of it (range in NM ≈ 1.23 × (√ height₁ + √ height₂), heights in feet above the ground). Voice is
// 8 kHz μ-law, the same quality as an aviation radio channel.
import http from "node:http";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join, normalize, extname, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const PORT = +arg("port", process.env.PORT || 8080), NAME = arg("name", "Zarhart server"), PASSWORD = arg("password", process.env.ZARHART_PASSWORD || ""), MAX = +arg("max", 32);
const VERSION = 1;
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json", ".xml": "application/xml", ".txt": "text/plain; charset=utf-8", ".woff2": "font/woff2" };

/* ---------------- shared world ---------------- */
const world = { preset: "scattered", hour: 13, started: Date.now() };
/** controller positions: frequency, name, and where the antenna is (world metres) */
const FACILITIES = {
  KZAR_TWR: { name: "Zarhart Tower", freq: 118.3, x: -110, z: -400, rangeNm: 25 },
  KZAR_GND: { name: "Zarhart Ground", freq: 121.9, x: -110, z: -400, rangeNm: 10 },
  ZAR_APP: { name: "Zarhart Approach", freq: 125.5, x: 2600, z: -3400, rangeNm: 60 },
  KAME_UNI: { name: "Earhart UNICOM", freq: 122.8, x: 14000, z: 9000, rangeNm: 25 },
};
const clients = new Map(); // id -> client
let nextId = 1;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/* ---------------- HTTP: the site, plus server info ---------------- */
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/mp/info") {
      res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
      return res.end(JSON.stringify({ name: NAME, players: [...clients.values()].filter((c) => c.ready).length, max: MAX, password: !!PASSWORD, version: VERSION }));
    }
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); return res.end(); }
    let p = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
    let file = join(ROOT, p);
    if (!file.startsWith(ROOT + sep) || /(^|[/\\])\.|node_modules|server[/\\]/.test(p)) { res.writeHead(404); return res.end("Not found"); }
    let st = await stat(file).catch(() => null);
    if (st?.isDirectory()) { file = join(file, "index.html"); st = await stat(file).catch(() => null); }
    if (!st) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "content-type": MIME[extname(file).toLowerCase()] || "application/octet-stream", "cache-control": "no-cache" });
    let body = await readFile(file);
    if (extname(file) === ".html") body = Buffer.from(body.toString("utf8").replace("<head>", '<head><meta name="zarhart-server" content="1">')); // the Online menu fills in this server's address
    res.end(req.method === "HEAD" ? undefined : body);
  } catch { res.writeHead(500); res.end(); }
});

/* ---------------- a minimal WebSocket server (RFC 6455) ---------------- */
server.on("upgrade", (req, socket) => {
  if (new URL(req.url, "http://x").pathname !== "/mp" || req.headers.upgrade?.toLowerCase() !== "websocket") return socket.destroy();
  const key = req.headers["sec-websocket-key"]; if (!key) return socket.destroy();
  const accept = createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);
  const c = { id: nextId++, socket, buf: Buffer.alloc(0), frag: null, ready: false, ip: req.socket.remoteAddress, s: null, tx: null, bytes: 0, bytesT: Date.now() };
  clients.set(c.id, c);
  socket.on("data", (d) => { c.buf = Buffer.concat([c.buf, d]); if (c.buf.length > 1 << 20) return drop(c, "message too big"); parseFrames(c); });
  socket.on("close", () => drop(c)); socket.on("error", () => drop(c));
});
function parseFrames(c) {
  for (;;) {
    const b = c.buf; if (b.length < 2) return;
    const fin = b[0] & 0x80, op = b[0] & 0x0f, masked = b[1] & 0x80; let len = b[1] & 0x7f, off = 2;
    if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; } else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
    if (!masked) return drop(c, "unmasked frame");
    if (len > 256 * 1024) return drop(c, "frame too big");
    if (b.length < off + 4 + len) return;
    const mask = b.subarray(off, off + 4), data = Buffer.from(b.subarray(off + 4, off + 4 + len));
    for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
    c.buf = b.subarray(off + 4 + len);
    if (op === 0x8) return drop(c); // close
    if (op === 0x9) { sendFrame(c, 0xa, data); continue; } // ping -> pong
    if (op === 0xa) continue;
    if (op === 0x0) { if (!c.frag) continue; c.frag.parts.push(data); if (fin) { const m = Buffer.concat(c.frag.parts); const t = c.frag.op; c.frag = null; onMessage(c, t, m); } continue; }
    if (!fin) { c.frag = { op, parts: [data] }; continue; }
    onMessage(c, op, data);
  }
}
function sendFrame(c, op, data) {
  if (c.socket.destroyed) return;
  const n = data.length, head = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 255]) : (() => { const h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(n), 2); return h; })();
  c.socket.write(Buffer.concat([head, data]));
}
const sendJSON = (c, o) => sendFrame(c, 0x1, Buffer.from(JSON.stringify(o)));
const others = (c) => [...clients.values()].filter((x) => x !== c && x.ready);
function drop(c, why) {
  if (!clients.has(c.id)) return;
  clients.delete(c.id);
  if (c.tx) endTx(c);
  try { c.socket.end(); } catch { /* gone */ }
  if (c.ready) { log(`${c.callsign} left${why ? ` (${why})` : ""}`); for (const o of others(c)) sendJSON(o, { t: "leave", id: c.id }); }
}

/* ---------------- radio physics ---------------- */
const FT = 0.3048, NM = 1852;
/** where a client's radio is: an airplane's position, or a controller's antenna */
function antenna(c) {
  if (c.role === "atc") { const f = FACILITIES[c.facility]; return { x: f.x, z: f.z, hFt: 60, rangeNm: f.rangeNm }; }
  const s = c.s; if (!s) return null;
  return { x: s.x, z: s.z, hFt: Math.max(10, s.agl ?? (s.onGround ? 0 : 1000)), rangeNm: 999 };
}
/** 0 (can't hear) to 1 (strong): line of sight for VHF, fading toward the radio horizon */
function signal(a, b) {
  if (!a || !b) return 0;
  const d = Math.hypot(a.x - b.x, a.z - b.z) / NM, los = 1.23 * (Math.sqrt(a.hFt) + Math.sqrt(b.hFt)), max = Math.min(los, a.rangeNm, b.rangeNm);
  return d >= max ? 0 : Math.min(1, (max - d) / (max * 0.25));
}
const tunedTo = (c, f) => (c.role === "atc" ? Math.abs(FACILITIES[c.facility].freq - f) < 0.004 : !!c.s && ((c.s.rx1 && Math.abs(c.s.com1 - f) < 0.004) || (c.s.rx2 && Math.abs(c.s.com2 - f) < 0.004)));
/** who hears a transmission from c on f, and how strongly */
function listeners(c, f) { const a = antenna(c); return others(c).filter((o) => tunedTo(o, f)).map((o) => ({ o, sig: signal(a, antenna(o)) })).filter((x) => x.sig > 0); }
function endTx(c) { const t = c.tx; c.tx = null; for (const id of t.heard) { const o = clients.get(id); if (o) sendJSON(o, { t: "rx", id: c.id, freq: t.freq, on: false }); } }

/* ---------------- messages ---------------- */
const clean = (s, n) => String(s ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, n);
function onMessage(c, op, data) {
  if (op === 0x2) return onAudio(c, data);
  let m; try { m = JSON.parse(data.toString("utf8")); } catch { return; }
  if (!c.ready) {
    if (m.t !== "hello") return;
    if (PASSWORD && m.password !== PASSWORD) { sendJSON(c, { t: "denied", why: "Wrong server password." }); return drop(c, "bad password"); }
    if (others(c).length >= MAX) { sendJSON(c, { t: "denied", why: "The server is full." }); return drop(c, "full"); }
    let cs = clean(m.callsign, 24) || `Guest ${c.id}`; if (others(c).some((o) => o.callsign.toLowerCase() === cs.toLowerCase())) cs = `${cs} ${c.id}`;
    c.callsign = cs; c.type = ["c172", "c152", "pa28"].includes(m.type) ? m.type : "c172";
    c.role = m.role === "atc" && FACILITIES[m.facility] && !others(c).some((o) => o.role === "atc" && o.facility === m.facility) ? "atc" : "pilot";
    c.facility = c.role === "atc" ? m.facility : null; c.ready = true;
    sendJSON(c, { t: "welcome", id: c.id, name: NAME, callsign: c.callsign, role: c.role, facility: c.facility, facilities: FACILITIES, world, players: others(c).map(info) });
    for (const o of others(c)) sendJSON(o, { t: "join", p: info(c) });
    log(`${c.callsign} joined as ${c.role === "atc" ? FACILITIES[c.facility].name : `pilot (${c.type})`} from ${c.ip}`);
    if (m.role === "atc" && c.role !== "atc") sendJSON(c, { t: "notice", text: "That controller position is taken, so you joined as a pilot." });
    return;
  }
  if (m.t === "state" && c.role === "pilot") {
    const n = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
    c.s = { x: n(m.x), y: n(m.y), z: n(m.z), qx: n(m.qx), qy: n(m.qy), qz: n(m.qz), qw: n(m.qw, 1), agl: n(m.agl), alt: n(m.alt), gs: n(m.gs), hdg: n(m.hdg), onGround: !!m.onGround, flaps: n(m.flaps), lights: n(m.lights), rpm: n(m.rpm),
      xpdr: clean(m.xpdr, 4), mode: ["STBY", "ON", "ALT"].includes(m.mode) ? m.mode : "STBY", ident: !!m.ident, com1: n(m.com1), com2: n(m.com2), rx1: !!m.rx1, rx2: !!m.rx2, type: c.type };
    return;
  }
  if (m.t === "tx") { // key or unkey the mic
    const f = +m.freq;
    if (m.on && Number.isFinite(f)) { if (c.tx) endTx(c); c.tx = { freq: f, heard: new Set() }; }
    else if (c.tx) endTx(c);
    return;
  }
  if (m.t === "text") { // a typed transmission: same rules as voice
    const f = +m.freq, text = clean(m.text, 240); if (!text || !Number.isFinite(f)) return;
    for (const { o, sig } of listeners(c, f)) sendJSON(o, { t: "text", id: c.id, from: c.role === "atc" ? FACILITIES[c.facility].name : c.callsign, freq: f, text, sig });
    return;
  }
  if (m.t === "world" && PASSWORD && m.password === PASSWORD) { Object.assign(world, { preset: clean(m.preset, 20) || world.preset, hour: n2(m.hour, world.hour) }); broadcast({ t: "world", world }); log(`${c.callsign} set the weather to ${world.preset}, ${world.hour}h`); }
}
const n2 = (v, d) => (Number.isFinite(+v) ? Math.max(0, Math.min(24, +v)) : d);
const info = (c) => ({ id: c.id, callsign: c.callsign, type: c.type, role: c.role, facility: c.facility });
function broadcast(o, except) { for (const c of clients.values()) if (c.ready && c !== except) sendJSON(c, o); }

/** voice: [1 byte version][2 bytes sequence][μ-law samples]; relayed to whoever can hear it right now */
function onAudio(c, data) {
  if (!c.tx || data.length < 4 || data.length > 4000) return;
  const now = Date.now(); if (now - c.bytesT > 1000) { c.bytes = 0; c.bytesT = now; }
  c.bytes += data.length; if (c.bytes > 16000) return; // 8 kHz μ-law is 8 kB/s; anything far beyond that is dropped
  const head = Buffer.alloc(8); head.writeUInt32BE(c.id, 0); head.writeUInt32BE(Math.round(c.tx.freq * 1000), 4);
  for (const { o, sig } of listeners(c, c.tx.freq)) {
    if (!c.tx.heard.has(o.id)) { c.tx.heard.add(o.id); sendJSON(o, { t: "rx", id: c.id, freq: c.tx.freq, on: true, from: c.role === "atc" ? FACILITIES[c.facility].name : c.callsign }); }
    const out = Buffer.concat([head, Buffer.from([Math.round(sig * 255)]), data]);
    sendFrame(o, 0x2, out);
  }
}

/* positions out at 5 Hz: [id, x, y, z, qx, qy, qz, qw, gs, flaps, lights, rpm, alt, xpdr, com1, com2, mode, ident] */
setInterval(() => {
  const list = [...clients.values()].filter((c) => c.ready && c.role === "pilot" && c.s).map((c) => { const s = c.s; return [c.id, +s.x.toFixed(1), +s.y.toFixed(1), +s.z.toFixed(1), +s.qx.toFixed(4), +s.qy.toFixed(4), +s.qz.toFixed(4), +s.qw.toFixed(4), +s.gs.toFixed(0), s.flaps, s.lights, Math.round(s.rpm), Math.round(s.alt), s.xpdr, s.com1, s.com2, s.mode, s.ident ? 1 : 0]; });
  if (list.length) broadcast({ t: "states", list, at: Date.now() });
}, 200);
setInterval(() => { for (const c of clients.values()) sendFrame(c, 0x9, Buffer.alloc(0)); }, 20000);

/* ---------------- host console ---------------- */
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const [cmd, ...rest] = line.trim().split(/\s+/), argStr = rest.join(" ");
  const find = (name) => [...clients.values()].find((c) => c.ready && c.callsign.toLowerCase() === name.toLowerCase());
  if (cmd === "help") console.log("list · kick <callsign> · weather <clear|scattered|marginal|crosswind|rain|snow|calm|fog|gusty|storm> · time <hour> · say <message> · stop");
  else if (cmd === "list") { const l = [...clients.values()].filter((c) => c.ready); console.log(l.length ? l.map((c) => `${c.callsign} (${c.role === "atc" ? FACILITIES[c.facility].name : c.type}) ${c.ip}`).join("\n") : "Nobody's flying."); }
  else if (cmd === "kick") { const c = find(argStr); if (c) { sendJSON(c, { t: "denied", why: "The host removed you from the server." }); drop(c, "kicked"); } else console.log("No such callsign."); }
  else if (cmd === "weather") { world.preset = argStr || "scattered"; broadcast({ t: "world", world }); log(`Weather set to ${world.preset}`); }
  else if (cmd === "time") { world.hour = n2(argStr, world.hour); broadcast({ t: "world", world }); log(`Time set to ${world.hour}h`); }
  else if (cmd === "say") { broadcast({ t: "notice", text: `Host: ${clean(argStr, 200)}` }); }
  else if (cmd === "stop") { log("Stopping."); process.exit(0); }
  else if (cmd) console.log("Unknown command. Type help.");
});

server.listen(PORT, () => {
  log(`${NAME} is up on port ${PORT}${PASSWORD ? " (password required)" : ""}.`);
  log(`On this computer:  http://localhost:${PORT}/sim/   (then Online → Join)`);
  log("For friends elsewhere you need an https address: see server/README.md (a free Cloudflare quick tunnel works). Type help for commands.");
});
