// Zarhart simulator bootstrap: scene, loop, cameras, HUD, drawers, radio/ATC, lessons.
import * as THREE from "three";
import { Aircraft, C172, KT, FT, weightBalance } from "./fdm.js";
import { AIRPORTS, NAVAIDS, groundAt, airspaceAt, vfrMinimums, nearestAirport, heightAt, rectDist } from "./world-data.js";
import { World } from "./world3d.js";
import { buildAirplane, buildCockpit, animateAirplane, buildShadow } from "./plane3d.js";
import { Weather, PRESETS } from "./weather.js";
import { vor, gps, WAYPOINTS, wrap180 } from "./nav.js";
import { Input } from "./input.js";
import { Audio } from "./audio.js";
import { Panel } from "./panel.js";
import { buildSectionalBase, drawMap } from "./map.js";
import { CHECKLISTS, suggestChecklist } from "./checklists.js";
import { LESSONS, LessonRunner } from "./lessons.js";

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const NM = 1852, DEG = Math.PI / 180;
const CALLSIGN = "Skyhawk 19 Zulu Romeo", SHORT = "Skyhawk 9ZR";
const store = { get(k, d) { try { const v = localStorage.getItem("zarhart:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem("zarhart:" + k, JSON.stringify(v)); } catch { /* ignore */ } } };
const [KZAR, KAME, Z19] = AIRPORTS;
const FREQS = [
  { f: 127.85, name: "Zarhart ATIS", ap: KZAR, kind: "atis" }, { f: 118.3, name: "Zarhart Tower", ap: KZAR, kind: "twr" }, { f: 121.9, name: "Zarhart Ground", ap: KZAR, kind: "gnd" },
  { f: 122.8, name: "Earhart CTAF", ap: KAME, kind: "ctaf" }, { f: 118.525, name: "Earhart AWOS", ap: KAME, kind: "awos" }, { f: 122.9, name: "Electra CTAF", ap: Z19, kind: "ctaf" }, { f: 121.5, name: "Guard (emergency)", kind: "guard" },
];
const freqInfo = (f) => FREQS.find((q) => Math.abs(q.f - f) < 0.004);

/* ---------------- settings ---------------- */
const settings = Object.assign({ quality: "high", invert: false, mouseYoke: false, autoRudder: true, sound: true, voice: false, panel: "steam" }, store.get("settings", {}));
settings.assist ||= settings.autoRudder === false ? "off" : "assisted";
const saveSettings = () => store.set("settings", settings);

/* ---------------- renderer & scene ---------------- */
const view = $("#view");
const renderer = new THREE.WebGLRenderer({ canvas: view, antialias: true, logarithmicDepthBuffer: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, settings.quality === "low" ? 1 : 1.6));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.12, 160000);
const world = new World(renderer, scene, { quality: settings.quality });
const weather = new Weather();
const env = { ground: groundAt, wind: (x, y, z, t) => weather.windAt(x, y, z, t), get weather() { return weather.state; } };
const ac = new Aircraft(env);
const panel = new Panel($("#panel"));
panel.mode = settings.panel;
const input = new Input(view);
input.invert = settings.invert; input.mouseYoke = settings.mouseYoke; input.autoRudder = settings.assist !== "off"; input.assist = settings.assist;
const audio = new Audio(); audio.enabled = settings.sound;

const sim = {
  t: 0, ac, d: ac.derived, weather, world, scene, paused: true, ready: false,
  radio: { com1: 118.3, com1s: 127.85, nav1: 113.9, nav1s: 116.4, failed: false, log: [] },
  flags: {}, pcl: { level: 0, until: 0, clicks: [] }, route: null, gpsWp: null, gpsFrom: null,
  lastTouchdown: null, lightGun: null, showG: false, view: "cockpit", vor1: null,
  say, spawn, setRoute, vasi: (ap, endId) => world.vasiAt(ap, endId, { x: ac.pos.x, y: ac.pos.y + 0.6, z: ac.pos.z }),
  setWeather(p) { weather.set(p); ac.inst.kollsman = weather.qnhInHg; if (world.clouds) world.clouds.build(weather.cloudLayersMsl()); },
  setTime(h) { weather.hour = h; },
};
const lessons = new LessonRunner(sim);

function spawn(spec) {
  sim.lastSpawn = { ...spec };
  ac.reset(spec);
  if (spec.coldDark) ac.inst.kollsman = 29.92; else ac.inst.kollsman = weather.qnhInHg;
  ac.inst.obs = ac.inst.obs || 0; ac.inst.hdgBug = Math.round(spec.hdg);
  ac.failures = { engine: false, vacuum: false, pitot: false, static: false, alternator: false };
  ac.extMoment.x = ac.extMoment.y = ac.extMoment.z = 0;
  if (spec.onGround === false) { ac.elec.lights.landing = true; ac.elec.lights.strobe = true; ac.elec.lights.beacon = true; }
  sim.flags = { everAirborne: !spec.onGround ? true : false, everRan: ac.eng.running };
  sim.lastTouchdown = null; sim.gpsWp = null; sim.gpsFrom = null; sim.pcl = { level: sim.pcl.level, until: sim.pcl.until, clicks: [] };
  camState.reset = true; hideCrash();
}
function setRoute(pts) { sim.route = pts; if (pts?.length) { sim.gpsWp = pts[pts.length - 1]; sim.gpsFrom = pts[0]; } }

/* ---------------- visuals: airplane, cockpit, parked aircraft ---------------- */
const plane = buildAirplane({ reg: "N19ZR" }); scene.add(plane);
const shadow = buildShadow(); scene.add(shadow);
const cockpit = buildCockpit(); scene.add(cockpit);
const cockpitProp = new THREE.Mesh(new THREE.CircleGeometry(0.98, 32), new THREE.MeshBasicMaterial({ color: 0x9aa3ad, transparent: true, opacity: 0.035, side: THREE.DoubleSide, depthWrite: false }));
cockpitProp.position.set(0, -0.08, -2.34); cockpit.add(cockpitProp);
function addParked() {
  const colors = [0x2f7fd0, 0xff9a1f, 0x5be38a, 0xd23a2a, 0x3fd8f2];
  let k = 0;
  for (const ap of AIRPORTS) for (const [x, z, hdg] of ap.parked || []) {
    const p = buildAirplane({ reg: `N${100 + k * 37}ZA`, stripe: colors[k++ % colors.length], simple: true });
    p.position.set(x, ap.elev + 1.22, z); p.rotation.y = -hdg * DEG; scene.add(p);
  }
}

/* ---------------- cameras ---------------- */
const camState = { look: { yaw: 0, pitch: -7 * DEG }, orbit: { yaw: 200 * DEG, pitch: 12 * DEG, dist: 24 }, chasePos: new THREE.Vector3(), reset: true, fovZoom: 0 };
const VIEWS = ["cockpit", "chase", "orbit", "tower"];
const tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), tmpE = new THREE.Euler(0, 0, 0, "YXZ");
let drag = null;
view.addEventListener("pointerdown", (e) => { if (e.button === 0 || e.button === 2) { drag = { x: e.clientX, y: e.clientY }; view.setPointerCapture(e.pointerId); } });
view.addEventListener("pointermove", (e) => {
  if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY };
  if (sim.view === "cockpit") { camState.look.yaw -= dx * 0.004; camState.look.pitch = Math.max(-1.2, Math.min(1.0, camState.look.pitch - dy * 0.004)); }
  else { camState.orbit.yaw -= dx * 0.006; camState.orbit.pitch = Math.max(-0.2, Math.min(1.4, camState.orbit.pitch + dy * 0.005)); }
});
view.addEventListener("pointerup", () => { drag = null; });
view.addEventListener("dblclick", () => { camState.look.yaw = 0; camState.look.pitch = -7 * DEG; camState.fovZoom = 0; });
view.addEventListener("contextmenu", (e) => e.preventDefault());
view.addEventListener("wheel", (e) => { e.preventDefault(); if (sim.view === "cockpit") camState.fovZoom = Math.max(-30, Math.min(25, camState.fovZoom + Math.sign(e.deltaY) * 3)); else camState.orbit.dist = Math.max(9, Math.min(160, camState.orbit.dist * (e.deltaY > 0 ? 1.12 : 0.89))); }, { passive: false });

function updateCamera(dt) {
  const p = ac.pos, q = ac.q; const aq = tmpQ.set(q.x, q.y, q.z, q.w);
  plane.visible = sim.view !== "cockpit"; cockpit.visible = sim.view === "cockpit";
  cockpit.position.set(p.x, p.y, p.z); cockpit.quaternion.copy(aq);
  cockpitProp.visible = ac.eng.rpm > 400;
  if (sim.view === "cockpit") {
    const hfov = 78 + camState.fovZoom; camera.fov = Math.max(30, Math.min(70, 2 * Math.atan(Math.tan(hfov * DEG / 2) / camera.aspect) / DEG));
    const eye = new THREE.Vector3(-0.32, 0.62, -0.42).applyQuaternion(aq);
    camera.position.set(p.x + eye.x, p.y + eye.y, p.z + eye.z);
    tmpE.set(camState.look.pitch, camState.look.yaw, 0);
    camera.quaternion.copy(aq).multiply(new THREE.Quaternion().setFromEuler(tmpE));
    if (ac.derived.onGround && ac.derived.gs > 5) { const s = ac.derived.onGround ? 0.004 * Math.min(1, ac.derived.gs / 40) * (ac.derived.surface === "grass" ? 3 : 1) : 0.006; camera.position.y += (Math.random() - 0.5) * s * 10; }
    if (ac.derived.stalled) { camera.rotateZ((Math.random() - 0.5) * 0.01); camera.rotateX((Math.random() - 0.5) * 0.008); }
  } else if (sim.view === "chase") {
    camera.fov = 58;
    const hdg = ac.derived.hdg * DEG; const behind = new THREE.Vector3(Math.sin(hdg) * -17, 4.2, -Math.cos(hdg) * -17);
    const target = new THREE.Vector3(p.x + behind.x, p.y + behind.y, p.z + behind.z);
    if (camState.reset) camState.chasePos.copy(target); else camState.chasePos.lerp(target, 1 - Math.exp(-dt * 3.5));
    const gnd = heightAt(camState.chasePos.x, camState.chasePos.z) + 1.5; if (camState.chasePos.y < gnd) camState.chasePos.y = gnd;
    camera.position.copy(camState.chasePos); camera.lookAt(p.x, p.y + 1.2, p.z);
  } else if (sim.view === "orbit") {
    camera.fov = 55; const o = camState.orbit;
    camera.position.set(p.x + Math.sin(o.yaw) * Math.cos(o.pitch) * o.dist, p.y + Math.sin(o.pitch) * o.dist, p.z + Math.cos(o.yaw) * Math.cos(o.pitch) * o.dist);
    const gnd = heightAt(camera.position.x, camera.position.z) + 1.5; if (camera.position.y < gnd) camera.position.y = gnd;
    camera.lookAt(p.x, p.y, p.z);
  } else {
    const near = nearestAirport(p.x, p.z).airport; const t = near.tower || near.windsock || { x: near.x, z: near.z };
    camera.position.set(t.x + 4, near.elev + (near.tower ? 27 : 8), t.z + 4);
    const dist = camera.position.distanceTo(tmpV.set(p.x, p.y, p.z));
    camera.fov = Math.max(4, Math.min(60, 2 * Math.atan(30 / dist) / DEG));
    camera.lookAt(p.x, p.y, p.z);
  }
  camState.reset = false;
  camera.updateProjectionMatrix();
}

/* ---------------- HUD helpers ---------------- */
const toasts = $("#toasts");
function say(text, kind = "info", ms = 5200) {
  const el = document.createElement("div"); el.className = `toast ${kind}`; el.textContent = text; toasts.prepend(el);
  while (toasts.children.length > 4) toasts.lastChild.remove();
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 400); }, ms);
}
function speak(text) { if (!settings.voice || !("speechSynthesis" in window)) return; try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text.replace(/(\d)\.(\d)/g, "$1 point $2")); u.rate = 1.05; speechSynthesis.speak(u); } catch { /* ignore */ } }
function radioLog(from, text, speakIt = true) { sim.radio.log.unshift({ from, text, t: sim.t }); sim.radio.log = sim.radio.log.slice(0, 30); say(`${from}: ${text}`, from === "You" ? "you" : "atc", 7000); if (speakIt && from !== "You") speak(text); if (openDrawerName === "radio") renderDrawer(); }

/* ---------------- radio / ATC ---------------- */
function activeRwy(ap) { return weather.activeRunway(ap).end.id; }
function posReport(ap) {
  const dx = ac.pos.x - ap.x, dz = ac.pos.z - ap.z; const dnm = Math.hypot(dx, dz) / NM;
  const brg = (Math.atan2(dx, -dz) / DEG + 360) % 360; const dirs = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
  return { dnm, dir: dirs[Math.round(brg / 45) % 8] };
}
function radioCall(kind) {
  const r = sim.radio; const fi = freqInfo(r.com1);
  if (!ac.powered || !ac.elec.avionics) return say("The radios have no power. Turn on the master and avionics switches.", "warn");
  if (r.failed) return say("Your radio is dead in this lesson. Squawk 7600 and watch the tower for light gun signals.", "warn");
  audio.click();
  const d = ac.derived;
  if (!fi) return radioLog("You", `(${r.com1.toFixed(3)}) No one answers on this frequency.`);
  const ap = fi.ap; const rw = ap ? activeRwy(ap) : "";
  if (fi.kind === "ctaf") {
    const { dnm, dir } = posReport(ap);
    const pattern = ap.segmentedCircle ? ap.segmentedCircle.pattern[rw] : "left";
    const msg = d.onGround ? `${ap.name} traffic, ${CALLSIGN}, departing runway ${rw}, ${ap.name}.` : `${ap.name} traffic, ${CALLSIGN}, ${Math.max(1, Math.round(dnm))} miles ${dir}, ${Math.round(d.altInd / 100) * 100} feet, inbound for landing runway ${rw}, ${pattern || "left"} traffic, ${ap.name}.`;
    radioLog("You", msg, false);
    if (d.onGround) sim.flags.departCall = true; else { sim.flags.inboundCall = true; if (ap === KAME && dnm > 6.5 && dnm < 13.5) sim.flags.inboundCallKAME = true; if (dnm < 6.5) say("Tip: make your first CTAF call about 10 NM out (AIM 4-1-9).", "tip"); if (dnm > 13.5) say("A little early. About 10 NM out is the standard first call.", "tip"); }
    return;
  }
  if (fi.kind === "atis" || fi.kind === "awos") return say("That's a broadcast. Just listen.", "tip");
  if (fi.kind === "guard") { radioLog("You", `Mayday, mayday, mayday, ${CALLSIGN}, ${ac.failures.engine || !ac.eng.running ? "engine failure" : "emergency"}, ${Math.round(d.altInd)} feet.`, false); setTimeout(() => radioLog("Zarhart Approach", `${SHORT}, roger mayday. Squawk 7700. Zarhart altimeter ${weather.qnhInHg.toFixed(2)}. Nearest airport ${nearestAirport(ac.pos.x, ac.pos.z).airport.name}.`), 2200); return; }
  // tower / ground at KZAR
  const { dnm, dir } = posReport(KZAR);
  if (kind === "taxi") { radioLog("You", `Zarhart Ground, ${CALLSIGN}, at the ramp with information ${weatherLetter()}, ready to taxi.`, false); setTimeout(() => radioLog("Zarhart Ground", `${SHORT}, runway ${rw}, taxi via Alpha. Hold short of runway ${rw}.`), 1800); sim.flags.taxiClr = true; return; }
  if (kind === "depart") { radioLog("You", `Zarhart Tower, ${CALLSIGN}, holding short runway ${rw}, ready for departure.`, false); setTimeout(() => { radioLog("Zarhart Tower", `${SHORT}, wind ${String(Math.round(weather.windDir / 10) * 10).padStart(3, "0")} at ${Math.round(weather.windKt)}, runway ${rw}, cleared for takeoff.`); sim.flags.departCall = true; sim.flags.dContact = true; }, 1800); return; }
  if (kind === "inbound") { radioLog("You", `Zarhart Tower, ${CALLSIGN}, ${Math.round(dnm)} miles ${dir}, ${Math.round(d.altInd / 100) * 100}, inbound for landing with ${weatherLetter()}.`, false); setTimeout(() => { const side = rw === "27" || rw === "36" ? "left" : "right"; radioLog("Zarhart Tower", `${SHORT}, Zarhart Tower, enter ${side} downwind runway ${rw}, report midfield.`); sim.flags.inboundCall = true; sim.flags.dContact = true; }, 1800); return; }
  if (kind === "land") { radioLog("You", `Zarhart Tower, ${SHORT}, midfield ${rw === "27" ? "left" : ""} downwind, full stop.`, false); setTimeout(() => radioLog("Zarhart Tower", `${SHORT}, runway ${rw}, cleared to land.`), 1600); sim.flags.dContact = true; return; }
}
function weatherLetter() { return weather.atis(KZAR, weather.hour).letter; }
function pttClick() {
  audio.click();
  if (!ac.powered || !ac.elec.avionics || sim.radio.failed) return;
  const fi = freqInfo(sim.radio.com1);
  if (fi?.kind === "ctaf" && fi.ap?.pcl) {
    sim.pcl.clicks.push(sim.t); sim.pcl.clicks = sim.pcl.clicks.filter((c) => sim.t - c <= 5);
    clearTimeout(sim.pcl.timer);
    sim.pcl.timer = setTimeout(() => {
      const n = sim.pcl.clicks.filter((c) => sim.t - c <= 5.5).length;
      const lvl = n >= 7 ? 3 : n >= 5 ? 2 : n >= 3 ? 1 : 0;
      if (lvl) { sim.pcl.level = lvl; sim.pcl.until = sim.t + 900; say(`Pilot-controlled lighting: ${n} clicks → runway lights ${["", "LOW", "MEDIUM", "HIGH"][lvl]} for 15 minutes.`, "good"); }
      else say(`${n} click${n === 1 ? "" : "s"}: not enough. Key the mic 7 times within 5 seconds for high intensity.`, "tip");
      sim.pcl.clicks = [];
    }, 1300);
  } else if (fi?.kind === "ctaf") say("This CTAF has no pilot-controlled lighting.", "tip");
}

/* ---------------- flags, monitors ---------------- */
let lastAirspace = null, vfrText = "", atisHeardT = 0, lastAtisLetter = null, lastXpdr = "1200";
function monitors(dt) {
  const d = ac.derived, f = sim.flags;
  if (ac.eng.running) f.everRan = true;
  if (!d.onGround) { f.everAirborne = true; f.airborneOnce = true; }
  // ATIS
  const fi = freqInfo(sim.radio.com1);
  if ((fi?.kind === "atis" || fi?.kind === "awos") && ac.powered && ac.elec.avionics && !sim.radio.failed) {
    atisHeardT += dt; const a = weather.atis(fi.ap, weather.hour);
    if (atisHeardT > 0.5 && lastAtisLetter !== a.letter + fi.f) { lastAtisLetter = a.letter + fi.f; radioLog(fi.name, a.text); }
    if (atisHeardT > 3) f.atis = true;
  } else { atisHeardT = 0; lastAtisLetter = null; }
  // run-up checks
  if (d.onGround && d.rpm > 1580) {
    if (ac.eng.mags === "left") f.magLT = (f.magLT || 0) + dt; if (ac.eng.mags === "right") f.magRT = (f.magRT || 0) + dt;
    if (f.magLT > 1.5) f.magL = true; if (f.magRT > 1.5) f.magR = true;
    if (ac.eng.carbHeat) f.carbChk = true;
  }
  if (d.onGround) { const c = ac.ctl; f.eUp ||= c.elevator > 0.9; f.eDn ||= c.elevator < -0.9; f.aL ||= c.aileron < -0.9; f.aR ||= c.aileron > 0.9; f.ctrlFull = f.eUp && f.eDn && f.aL && f.aR; }
  // pilot-controlled lighting timeout
  if (sim.pcl.level && sim.t > sim.pcl.until) { sim.pcl.level = 0; say("Pilot-controlled lighting timed out.", "info"); }
  // transponder responses
  if (ac.xpdr.code !== lastXpdr) {
    lastXpdr = ac.xpdr.code;
    if (ac.xpdr.code === "7700" && !sim.radio.failed && ac.powered) setTimeout(() => radioLog("Zarhart Approach", `${SHORT}, radar contact, squawking 7700. Say intentions. Nearest airport ${nearestAirport(ac.pos.x, ac.pos.z).airport.name}.`), 1500);
    if (ac.xpdr.code === "7500") say("7500 is the hijack code. Use it only for that situation.", "warn", 8000);
    if (ac.xpdr.code === "7600") say("7600 = lost communications. Watch the tower for light gun signals.", "info", 7000);
  }
  // airspace
  const as = airspaceAt(ac.pos.x, d.altTrue, ac.pos.z);
  const key = as.cls + as.special.map((s) => s.id).join();
  if (key !== lastAirspace) {
    if (lastAirspace != null) {
      if (as.cls === "D" && !f.dContact && !f.departCall && !d.onGround) say("You entered the Zarhart Class D without two-way radio contact. Call the tower first (14 CFR 91.129).", "warn", 9000);
      for (const s of as.special) say(s.cls === "P" ? `Prohibited area ${s.id}: flight is not allowed here. Turn away now.` : s.cls === "R" ? `Restricted area ${s.id} is active: you need permission to enter.` : `Entering ${s.name}: military training. Use extreme caution.`, s.cls === "MOA" ? "info" : "warn", 9000);
    }
    lastAirspace = key;
  }
  // VFR minimums vs clouds and visibility
  const mins = vfrMinimums(as.cls, d.altTrue, d.agl, world.night);
  const pr = world.clouds ? world.clouds.probe(ac.pos.x, ac.pos.y, ac.pos.z) : { inside: 0, below: Infinity, above: Infinity, horiz: Infinity };
  let ok = true, why = "";
  if (pr.inside > 0.05) { ok = false; why = "In cloud: VFR flight into IMC"; }
  else if (weather.visSM < mins.visSM) { ok = false; why = `Visibility ${weather.visSM} SM, need ${mins.visSM}`; }
  else if (pr.below / FT < mins.below) { ok = false; why = `${Math.round(pr.below / FT)} ft below clouds, need ${mins.below}`; }
  else if (pr.above / FT < mins.above) { ok = false; why = `${Math.round(pr.above / FT)} ft above clouds, need ${mins.above}`; }
  else if (pr.horiz / FT < mins.horizFt) { ok = false; why = `${Math.round(pr.horiz / FT)} ft from a cloud, need ${mins.horizFt.toLocaleString()}`; }
  sim.vfr = { cls: as.cls, special: as.special, mins, ok: ok && !d.onGround ? true : ok, why, inCloud: pr.inside };
}

/* ---------------- events from the flight model ---------------- */
function handleEvents() {
  for (const e of ac.events) {
    if (e.type === "touchdown") {
      const td = e.msg; sim.lastTouchdown = { ...td, used: false }; audio.thump(td.fpm);
      const g = td.fpm < 200 ? "Smooth" : td.fpm < 400 ? "Good" : td.fpm < 650 ? "Firm" : "Hard";
      say(`Touchdown ${td.fpm} fpm · ${td.kias} KIAS · ${g}`, td.fpm < 650 ? "good" : "warn");
    } else if (e.type === "crash") showCrash(e.msg);
    else if (e.type === "warn") say(e.msg, "warn", 7000);
    else if (e.type === "info") say(e.msg, "info");
  }
  ac.events.length = 0;
}
function showCrash(reason) { sim.paused = true; $("#crashReason").textContent = reason; $("#crash").hidden = false; $("#crashRetry").focus(); }
function hideCrash() { $("#crash").hidden = true; }
function retry() { hideCrash(); if (lessons.lesson) lessons.start(lessons.lesson.id); else if (sim.lastSpawn) spawn(sim.lastSpawn); sim.paused = false; }

/* ---------------- key bindings ---------------- */
const FLAPS = [0, 10, 20, 30];
const keymap = {
  "[": () => { const i = Math.max(0, FLAPS.indexOf(ac.flapsSet) - 1); ac.flapsSet = FLAPS[i]; say(`Flaps ${ac.flapsSet}°`, "info", 1500); },
  "]": () => { const i = Math.min(3, FLAPS.indexOf(ac.flapsSet) + 1); ac.flapsSet = FLAPS[i]; say(`Flaps ${ac.flapsSet}°${ac.derived.ias > C172.V.fe ? ": above Vfe 85 KIAS!" : ""}`, ac.derived.ias > C172.V.fe ? "warn" : "info", 1800); },
  "S+b": () => { ac.parkingBrake = !ac.parkingBrake; say(`Parking brake ${ac.parkingBrake ? "SET" : "released"}`, "info", 1500); },
  "S+r": () => { ac.ctl.throttle = 1; }, "S+f": () => { ac.ctl.throttle = 0; },
  c: () => { sim.view = VIEWS[(VIEWS.indexOf(sim.view) + 1) % VIEWS.length]; camState.reset = true; layout(); say(`View: ${sim.view}`, "info", 1200); },
  p: () => togglePause(), Escape: () => { if (openDrawerName) closeDrawer(); else togglePause(); },
  m: () => toggleDrawer("map"), k: () => toggleDrawer("check"), "?": () => toggleDrawer("help"), F1: () => toggleDrawer("help"),
  i: () => { const modes = ["steam", "glass", "off"]; settings.panel = modes[(modes.indexOf(settings.panel) + 1) % 3]; panel.mode = settings.panel; saveSettings(); layout(); say(`Panel: ${{ steam: "six-pack", glass: "glass cockpit", off: "hidden" }[settings.panel]}`, "info", 1400); },
  h: () => { ac.eng.carbHeat = !ac.eng.carbHeat; say(`Carburetor heat ${ac.eng.carbHeat ? "ON" : "OFF"}`, "info", 1500); },
  o: () => { ac.inst.hiDrift = wrap180(ac.derived.compass - (ac.derived.hi - ac.inst.hiDrift)); say("Heading indicator set to the magnetic compass.", "info", 2000); },
  l: () => { ac.elec.lights.landing = !ac.elec.lights.landing; say(`Landing light ${ac.elec.lights.landing ? "ON" : "OFF"}`, "info", 1400); },
  n: () => { [sim.radio.nav1, sim.radio.nav1s] = [sim.radio.nav1s, sim.radio.nav1]; },
  y: () => { input.mouseYoke = settings.mouseYoke = !settings.mouseYoke; saveSettings(); say(`Mouse yoke ${input.mouseYoke ? "ON: move the mouse away from the centre ring to fly" : "OFF"}`, "info", 2200); },
  u: () => { const m = ["assisted", "rudder", "off"]; setAssist(m[(m.indexOf(settings.assist) + 1) % 3]); },
  " ": () => pttClick(),
  Enter: () => { if (!$("#crash").hidden) retry(); },
};
input.on("keymap", keymap);
const ASSIST_LABEL = { assisted: "Assisted", rudder: "Auto-rudder", off: "Manual" };
function setAssist(mode) { settings.assist = input.assist = mode; input.autoRudder = mode !== "off"; input.tgt = null; saveSettings(); say(`Flight assist: ${ASSIST_LABEL[mode]}${mode === "assisted" ? ". Arrows change pitch and bank; let go and the airplane holds its attitude." : mode === "rudder" ? ". You fly the stick; rudder is automatic." : ". Fully manual, including rudder."}`, "info", 4000); }
const ctlEls = { dot: document.querySelector("#ctl .ctl-dot"), rud: document.querySelector("#ctl .ctl-rud span"), thr: document.querySelector("#ctl .ctl-thr span"), txt: document.querySelector("#ctl .ctl-txt"), yoke: document.querySelector("#yoke"), yokeDot: document.querySelector("#yoke span") };
function updateControlIndicator() {
  const c = ac.ctl; if (!ctlEls.dot) return;
  ctlEls.dot.style.transform = `translate(${c.aileron * 30}px, ${c.elevator * 30}px)`;
  ctlEls.rud.style.transform = `translateX(${c.rudder * 30}px)`;
  ctlEls.thr.style.height = `${Math.round(c.throttle * 100)}%`;
  ctlEls.txt.textContent = `${ASSIST_LABEL[settings.assist].toUpperCase()} · FLAPS ${ac.flapsSet} · TRIM ${c.trim >= 0 ? "+" : ""}${Math.round(c.trim * 100)}`;
  ctlEls.yoke.hidden = !input.mouseYoke || sim.paused;
  if (input.mouseYoke) ctlEls.yokeDot.style.transform = `translate(${input.mouse.x * innerWidth / 2}px, ${input.mouse.y * (innerHeight - (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--panel-h")) || 0)) / 2}px)`;
}
function togglePause() { if (!sim.ready || !$("#start").hidden) return; sim.paused = !sim.paused; $("#paused").hidden = !sim.paused; }

/* ---------------- drawers ---------------- */
let openDrawerName = null;
const drawer = $("#drawer"), drawerBody = $("#drawerBody");
const DRAWER_TITLES = { lessons: "Lessons & flights", aircraft: "Aircraft", radio: "Radios", map: "VFR map", check: "Checklists", weather: "Weather & time", fail: "Failures", settings: "Settings", help: "Controls" };
function toggleDrawer(n) { if (openDrawerName === n) closeDrawer(); else openDrawer(n); }
function openDrawer(n) { openDrawerName = n; drawer.hidden = false; drawer.dataset.kind = n; $("#drawerTitle").textContent = DRAWER_TITLES[n]; document.querySelectorAll("[data-drawer]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.drawer === n)); renderDrawer(); }
function closeDrawer() { openDrawerName = null; drawer.hidden = true; document.querySelectorAll("[data-drawer]").forEach((b) => b.setAttribute("aria-pressed", "false")); view.focus(); }
document.querySelectorAll("[data-drawer]").forEach((b) => b.addEventListener("click", () => toggleDrawer(b.dataset.drawer)));
$("#drawerClose").addEventListener("click", closeDrawer);
const examLink = (id) => `<a class="exam" href="../prep/?card=${id}" target="_blank" rel="noopener" title="Open this written-test question in Zarhart Prep">${id.toUpperCase()}</a>`;
let checkTab = null;

function renderDrawer() {
  const n = openDrawerName; if (!n) return;
  const B = drawerBody;
  if (n === "lessons") {
    B.innerHTML = `<p class="dnote">Every lesson links to the written-test questions it teaches. Click a question code to open it in Prep.</p>
      <div class="lesson-list">${LESSONS.map((l) => `<article class="lesson"><div class="lhead"><span class="ltag">${esc(l.tag)}</span><span class="ltime">${l.time}</span></div><h3>${esc(l.title)}</h3><p>${esc(l.summary)}</p><div class="lfoot"><span class="exams">${l.exam.map(examLink).join("")}</span><button class="sbtn primary" data-lesson="${l.id}">Fly</button></div></article>`).join("")}</div>
      <h3 class="dsub">Free flight</h3>
      <div class="form"><label>Start <select id="ffStart"><option value="kzarRamp">Zarhart ramp: cold & dark (use the checklists)</option><option value="kzar27">Zarhart runway 27, engine running</option><option value="kzar09">Zarhart runway 09</option><option value="kame36">Earhart Municipal runway 36</option><option value="z19">Electra Field grass 04</option><option value="air">Airborne over the valley, 3,500 ft</option></select></label>
      <label>Weather <select id="ffWx">${Object.entries(PRESETS).map(([k, p]) => `<option value="${k}">${esc(p.label)}</option>`).join("")}</select></label>
      <label>Time <select id="ffTime"><option value="9">Morning</option><option value="13" selected>Midday</option><option value="19.1">Golden hour</option><option value="20.0">Dusk</option><option value="22">Night</option></select></label>
      <button class="sbtn primary" id="ffGo">Start free flight</button></div>`;
    B.querySelectorAll("[data-lesson]").forEach((b) => b.addEventListener("click", () => { startFlying(); lessons.start(b.dataset.lesson); closeDrawer(); }));
    $("#ffWx", B).value = "scattered";
    $("#ffGo", B).addEventListener("click", () => { startFlying(); freeFlight($("#ffStart", B).value, $("#ffWx", B).value, +$("#ffTime", B).value); closeDrawer(); });
  } else if (n === "aircraft") {
    const e = ac.eng, el = ac.elec, L = el.lights;
    const sw = (k, label, on) => `<button class="switch ${on ? "on" : ""}" data-sw="${k}" aria-pressed="${on}"><span class="led"></span>${label}</button>`;
    B.innerHTML = `<h3 class="dsub">Switches</h3><div class="switches">${sw("master", "Master", el.master)}${sw("avionics", "Avionics", el.avionics)}${sw("beacon", "Beacon", L.beacon)}${sw("strobe", "Strobes", L.strobe)}${sw("nav", "Nav lights", L.nav)}${sw("landing", "Landing", L.landing)}${sw("taxi", "Taxi", L.taxi)}${sw("pitotHeat", "Pitot heat", el.pitotHeat)}</div>
      <h3 class="dsub">Engine</h3>
      <div class="form"><label>Magnetos <span class="seg" id="mags">${["off", "right", "left", "both", "start"].map((m) => `<button data-mag="${m}" class="${e.mags === m ? "on" : ""}">${m === "start" ? "START (hold)" : m.toUpperCase()}</button>`).join("")}</span></label>
      <label>Mixture <input type="range" id="mix" min="0" max="100" value="${Math.round(e.mixture * 100)}"><output id="mixOut">${Math.round(e.mixture * 100)}%</output></label>
      <label>Fuel selector <span class="seg" id="fsel">${["off", "left", "both", "right"].map((m) => `<button data-fs="${m}" class="${e.selector === m ? "on" : ""}">${m.toUpperCase()}</button>`).join("")}</span></label>
      <div class="row2">${sw("carbHeat", "Carb heat (H)", e.carbHeat)}${sw("parking", "Parking brake", ac.parkingBrake)}</div></div>
      <h3 class="dsub">Weight & balance <span class="exams">${examLink("t27")}${examLink("t48")}${examLink("e34")}</span></h3>
      <div class="form wb"><label>Front seats (lb) <input type="number" id="wbF" min="0" max="400" value="${ac.load.front}"></label><label>Rear seats (lb) <input type="number" id="wbR" min="0" max="400" value="${ac.load.rear}"></label><label>Fuel (gal, 38 usable) <input type="number" id="wbFuel" min="0" max="38" value="${Math.round(e.fuelL + e.fuelR)}" ${ac.derived.onGround ? "" : "disabled"}></label><label>Baggage A (lb, max 120) <input type="number" id="wbA" min="0" max="120" value="${ac.load.bagA}"></label><label>Baggage B (lb, max 50) <input type="number" id="wbB" min="0" max="50" value="${ac.load.bagB}"></label></div>
      <canvas id="wbChart" width="320" height="200" aria-label="CG envelope chart"></canvas><p id="wbOut" class="dnote"></p>
      <p class="dnote">The flight model uses this loading: a forward CG raises stall speed, an aft CG makes the airplane less stable.</p>`;
    B.querySelectorAll("[data-sw]").forEach((b) => b.addEventListener("click", () => { const k = b.dataset.sw; if (k in el.lights) el.lights[k] = !el.lights[k]; else if (k === "carbHeat") e.carbHeat = !e.carbHeat; else if (k === "parking") ac.parkingBrake = !ac.parkingBrake; else el[k] = !el[k]; renderDrawer(); }));
    B.querySelectorAll("[data-mag]").forEach((b) => { const m = b.dataset.mag; if (m === "start") { const down = () => { e.mags = "start"; b.classList.add("on"); }; const up = () => { if (e.mags === "start") e.mags = "both"; renderDrawer(); }; b.addEventListener("pointerdown", down); b.addEventListener("pointerup", up); b.addEventListener("pointerleave", () => { if (e.mags === "start") up(); }); } else b.addEventListener("click", () => { e.mags = m; renderDrawer(); }); });
    B.querySelectorAll("[data-fs]").forEach((b) => b.addEventListener("click", () => { e.selector = b.dataset.fs; renderDrawer(); }));
    $("#mix", B).addEventListener("input", (ev) => { e.mixture = ev.target.value / 100; $("#mixOut", B).textContent = ev.target.value + "%"; });
    const wbUpdate = () => { ac.load.front = +$("#wbF", B).value || 0; ac.load.rear = +$("#wbR", B).value || 0; ac.load.bagA = Math.min(120, +$("#wbA", B).value || 0); ac.load.bagB = Math.min(50, +$("#wbB", B).value || 0); if (ac.derived.onGround) ac.setFuel(Math.min(38, +$("#wbFuel", B).value || 0)); drawWB(); };
    B.querySelectorAll(".wb input").forEach((i) => i.addEventListener("input", wbUpdate)); drawWB();
  } else if (n === "radio") {
    const r = sim.radio; const opt = (sel) => FREQS.map((q) => `<option value="${q.f}" ${Math.abs(q.f - sel) < 0.004 ? "selected" : ""}>${q.f.toFixed(3)} ${esc(q.name)}</option>`).join("");
    const nopt = (sel) => NAVAIDS.map((q) => `<option value="${q.freq}" ${Math.abs(q.freq - sel) < 0.004 ? "selected" : ""}>${q.freq.toFixed(2)} ${q.id} ${esc(q.name)} VOR</option>`).join("");
    const fi = freqInfo(r.com1);
    const calls = fi?.kind === "ctaf" ? [["announce", ac.derived.onGround ? "Announce departure" : "Self-announce position"]] : fi?.kind === "twr" || fi?.kind === "gnd" ? [["taxi", "Request taxi"], ["depart", "Ready for departure"], ["inbound", "Inbound call"], ["land", "Midfield downwind, request landing"]] : fi?.kind === "guard" ? [["mayday", "Declare emergency (Mayday)"]] : [];
    const a = weather.atis(KZAR, weather.hour);
    B.innerHTML = `${r.failed ? `<p class="dwarn">Radio failure (lesson). Squawk 7600 and watch for light gun signals.</p>` : ""}
      <div class="form"><label>COM1 active <select id="c1">${opt(r.com1)}</select></label><label>COM1 standby <select id="c1s">${opt(r.com1s)}</select></label><button class="sbtn" id="c1swap">⇄ Swap COM1</button>
      <label>NAV1 active <select id="n1">${nopt(r.nav1)}</select></label><label>NAV1 standby <select id="n1s">${nopt(r.nav1s)}</select></label><button class="sbtn" id="n1swap">⇄ Swap NAV1 (N)</button>
      <label>OBS <input type="number" id="obs" min="0" max="359" value="${Math.round(ac.inst.obs)}"></label>
      <label>Transponder <input id="xp" inputmode="numeric" maxlength="4" value="${ac.xpdr.code}" pattern="[0-7]{4}"></label>
      <span class="seg">${["1200", "7600", "7700"].map((c) => `<button data-xp="${c}" class="${ac.xpdr.code === c ? "on" : ""}">${c}</button>`).join("")}</span>
      <label>Mode <span class="seg">${["STBY", "ON", "ALT"].map((m) => `<button data-xm="${m}" class="${ac.xpdr.mode === m ? "on" : ""}">${m}</button>`).join("")}</span></label></div>
      <h3 class="dsub">Talk on ${esc(fi?.name || r.com1.toFixed(3))}</h3>
      <div class="calls">${calls.length ? calls.map(([k, t]) => `<button class="sbtn primary" data-call="${k}">${esc(t)}</button>`).join("") : `<p class="dnote">Tune a tower, ground, CTAF or guard frequency to talk. Press Space to click the mic (pilot-controlled lighting).</p>`}</div>
      <h3 class="dsub">Zarhart ATIS ${esc(a.letter)} <span class="exams">${examLink("e53")}</span></h3><p class="atis">${esc(a.text)}</p>${a.skyOmitted ? `<p class="dnote">No sky condition or visibility in the ATIS means the ceiling is at least 5,000 ft and visibility at least 5 SM.</p>` : ""}
      <p class="metar mono">${esc(weather.metar(KZAR, weather.hour))}</p>
      <h3 class="dsub">Radio log</h3><ol class="rlog">${r.log.map((l) => `<li><b>${esc(l.from)}</b> ${esc(l.text)}</li>`).join("") || "<li class='dnote'>Nothing yet.</li>"}</ol>`;
    $("#c1", B).addEventListener("change", (e) => { r.com1 = +e.target.value; renderDrawer(); }); $("#c1s", B).addEventListener("change", (e) => { r.com1s = +e.target.value; });
    $("#c1swap", B).addEventListener("click", () => { [r.com1, r.com1s] = [r.com1s, r.com1]; renderDrawer(); });
    $("#n1", B).addEventListener("change", (e) => { r.nav1 = +e.target.value; }); $("#n1s", B).addEventListener("change", (e) => { r.nav1s = +e.target.value; });
    $("#n1swap", B).addEventListener("click", () => { [r.nav1, r.nav1s] = [r.nav1s, r.nav1]; renderDrawer(); });
    $("#obs", B).addEventListener("input", (e) => { ac.inst.obs = ((+e.target.value % 360) + 360) % 360; });
    $("#xp", B).addEventListener("change", (e) => { const v = e.target.value.replace(/[^0-7]/g, "").padStart(4, "0").slice(-4); ac.xpdr.code = v; renderDrawer(); });
    B.querySelectorAll("[data-xp]").forEach((b) => b.addEventListener("click", () => { ac.xpdr.code = b.dataset.xp; renderDrawer(); }));
    B.querySelectorAll("[data-xm]").forEach((b) => b.addEventListener("click", () => { ac.xpdr.mode = b.dataset.xm; renderDrawer(); }));
    B.querySelectorAll("[data-call]").forEach((b) => b.addEventListener("click", () => radioCall(b.dataset.call === "announce" ? "announce" : b.dataset.call === "mayday" ? "mayday" : b.dataset.call)));
  } else if (n === "map") {
    B.innerHTML = `<canvas id="bigMap" aria-label="VFR sectional-style map. Click to fly direct to a point."></canvas>
      <div class="maptools"><button class="sbtn" id="mzIn">＋</button><button class="sbtn" id="mzOut">−</button><span class="dnote">Click the map to go direct (GPS).</span></div>
      <div class="calls">${WAYPOINTS.map((w) => `<button class="sbtn" data-wp="${w.id}">→ ${w.id}</button>`).join("")}<button class="sbtn" id="wpClear">Clear GPS</button></div>
      <p class="dnote">Sectional symbols: blue airports have a tower, magenta airports don't. The dashed blue ring is Class D (ceiling in brackets, hundreds of feet MSL). The magenta fade means Class E starts at 700 ft AGL. Learn them in Prep ${examLink("t45")}${examLink("e61")}.</p>`;
    const cv = $("#bigMap", B); bigMap.canvas = cv; drawBigMap();
    cv.addEventListener("click", (e) => { const r = cv.getBoundingClientRect(); const w = bigMap.toWorld(e.clientX - r.left, e.clientY - r.top); directTo({ id: "USER", name: "Map point", x: w.x, z: w.z }); });
    $("#mzIn", B).addEventListener("click", () => { bigMap.range = Math.max(2, bigMap.range / 1.5); drawBigMap(); }); $("#mzOut", B).addEventListener("click", () => { bigMap.range = Math.min(25, bigMap.range * 1.5); drawBigMap(); });
    B.querySelectorAll("[data-wp]").forEach((b) => b.addEventListener("click", () => directTo(WAYPOINTS.find((w) => w.id === b.dataset.wp))));
    $("#wpClear", B).addEventListener("click", () => { sim.gpsWp = null; sim.gpsFrom = null; sim.route = null; drawBigMap(); });
  } else if (n === "check") {
    const s = checkState(); const sug = suggestChecklist(s); if (!checkTab) checkTab = sug;
    const cl = CHECKLISTS.find((c) => c.id === checkTab);
    sim.manualChecks ||= {};
    B.innerHTML = `<div class="seg wrap">${CHECKLISTS.map((c) => `<button data-cl="${c.id}" class="${c.id === checkTab ? "on" : ""}">${esc(c.name)}${c.id === sug ? " •" : ""}</button>`).join("")}</div>
      <ul class="checklist">${cl.items.map((it, i) => { const auto = it.check ? !!it.check(s) : null; const man = sim.manualChecks[`${cl.id}:${i}`]; const on = auto || man; return `<li class="${on ? "ok" : ""}"><label><input type="checkbox" data-ci="${i}" ${on ? "checked" : ""} ${auto ? "disabled" : ""}><span>${esc(it.t)}</span></label>${it.check ? `<span class="auto" title="Ticks itself when the airplane is set up this way">auto</span>` : ""}${it.exam ? examLink(it.exam) : ""}</li>`; }).join("")}</ul>
      <p class="dnote">• marks the checklist for your current phase of flight. Items marked auto tick themselves when the airplane is set up correctly.</p>`;
    B.querySelectorAll("[data-cl]").forEach((b) => b.addEventListener("click", () => { checkTab = b.dataset.cl; renderDrawer(); }));
    B.querySelectorAll("[data-ci]").forEach((c) => c.addEventListener("change", () => { sim.manualChecks[`${cl.id}:${c.dataset.ci}`] = c.checked; }));
  } else if (n === "weather") {
    const ap = KZAR; const act = weather.activeRunway(ap); const comp = weather.components(act.end.hdg);
    B.innerHTML = `<p class="metar mono">${esc(weather.metar(ap, weather.hour))}</p>
      <div class="kv"><span>Density altitude at KZAR</span><b>${Math.round(ac.derived.onGround && Math.hypot(ac.pos.x, ac.pos.z) < 2000 ? ac.derived.densAlt : densAltAtField()).toLocaleString()} ft</b><span>Active runway</span><b>${act.end.id}: ${comp.head >= 0 ? comp.head + " kt headwind" : -comp.head + " kt tailwind"}, ${Math.abs(comp.cross)} kt crosswind from the ${comp.cross > 0 ? "right" : "left"}</b></div>
      <div class="form"><label>Preset <select id="wxP"><option value="">Custom</option>${Object.entries(PRESETS).map(([k, p]) => `<option value="${k}">${esc(p.label)}</option>`).join("")}</select></label>
      <label>Wind from (°) <input type="number" id="wxDir" min="0" max="360" step="10" value="${weather.windDir}"></label><label>Wind (kt) <input type="number" id="wxKt" min="0" max="35" value="${weather.windKt}"></label><label>Gusts (kt) <input type="number" id="wxG" min="0" max="45" value="${weather.gustKt}"></label>
      <label>Visibility (SM) <input type="number" id="wxVis" min="0.5" max="10" step="0.5" value="${weather.visSM}"></label>
      <label>Clouds <select id="wxCov">${["CLR", "FEW", "SCT", "BKN", "OVC"].map((c) => `<option ${(weather.clouds[0]?.cover || "CLR") === c ? "selected" : ""}>${c}</option>`).join("")}</select></label><label>Cloud base (ft AGL) <input type="number" id="wxBase" min="500" max="12000" step="100" value="${weather.clouds[0]?.baseFt || 4500}"></label>
      <label>Temperature (°C) <input type="number" id="wxT" min="-20" max="45" value="${weather.tempC}"></label><label>Dew point (°C) <input type="number" id="wxD" min="-25" max="35" value="${weather.dewC}"></label><label>Altimeter (inHg) <input type="number" id="wxQ" min="28.5" max="31" step="0.01" value="${weather.qnhInHg.toFixed(2)}"></label>
      <label>Time of day <input type="range" id="wxH" min="5" max="23.5" step="0.1" value="${weather.hour}"><output id="wxHo">${fmtHour(weather.hour)}</output></label>
      <button class="sbtn primary" id="wxApply">Apply weather</button></div>
      <p class="dnote">After changing the altimeter setting, set your own altimeter too (Kollsman knob on the panel). Hot, high and humid raises density altitude ${examLink("t2")}${examLink("e31")}.</p>`;
    $("#wxP", B).addEventListener("change", (e) => { if (e.target.value) { sim.setWeather(PRESETS[e.target.value]); renderDrawer(); } });
    $("#wxH", B).addEventListener("input", (e) => { weather.hour = +e.target.value; $("#wxHo", B).textContent = fmtHour(weather.hour); });
    $("#wxApply", B).addEventListener("click", () => { const cov = $("#wxCov", B).value; sim.setWeather({ windDir: +$("#wxDir", B).value % 360, windKt: +$("#wxKt", B).value, gustKt: +$("#wxG", B).value, turb: 0.15 + (+$("#wxKt", B).value) / 60, visSM: +$("#wxVis", B).value, clouds: cov === "CLR" ? [] : [{ cover: cov, baseFt: +$("#wxBase", B).value }], tempC: +$("#wxT", B).value, dewC: Math.min(+$("#wxT", B).value, +$("#wxD", B).value), qnhInHg: +$("#wxQ", B).value }); renderDrawer(); say("Weather updated.", "info", 1500); });
  } else if (n === "fail") {
    const F = ac.failures; const items = [["engine", "Engine failure", "Glide at 68 KIAS, squawk 7700, pick a field.", ["t59"]], ["vacuum", "Vacuum pump", "Attitude and heading indicators slowly fail. Watch the suction gauge and use the turn coordinator.", ["t15"]], ["pitot", "Pitot tube blocked (ice)", "With the drain also blocked, the airspeed indicator acts like an altimeter.", ["t15"]], ["static", "Static port blocked", "The altimeter freezes, the VSI reads zero, and airspeed reads low in a climb and high in a descent.", ["t28", "t15"]], ["alternator", "Alternator", "The battery runs down. Shed electrical load.", []]];
    B.innerHTML = `<p class="dnote">Failures teach the systems questions on the written test. Turn one on, then fly.</p><ul class="fails">${items.map(([k, t, dsc, ex]) => `<li><button class="switch ${F[k] ? "on bad" : ""}" data-f="${k}" aria-pressed="${F[k]}"><span class="led"></span>${esc(t)}</button><p>${esc(dsc)} ${ex.map(examLink).join("")}</p></li>`).join("")}<li><button class="switch" id="iceNow"><span class="led"></span>Start carburetor ice</button><p>RPM sags. Apply carb heat (H). ${examLink("e41")}</p></li></ul>`;
    B.querySelectorAll("[data-f]").forEach((b) => b.addEventListener("click", () => { F[b.dataset.f] = !F[b.dataset.f]; if (b.dataset.f === "engine" && !F.engine && !ac.eng.running) say("Engine failure cleared. Restart: mixture rich, magnetos to START.", "info"); renderDrawer(); }));
    $("#iceNow", B).addEventListener("click", () => { ac.eng.carbIce = Math.max(ac.eng.carbIce, 0.45); say("Carburetor ice is forming.", "warn"); });
  } else if (n === "settings") {
    B.innerHTML = `<div class="form"><label>Graphics <select id="sQ"><option value="high">High</option><option value="low">Low (faster)</option></select></label>
      <label class="chk"><input type="checkbox" id="sInv" ${settings.invert ? "checked" : ""}> Invert pitch (↑ = nose up)</label>
      <label class="chk"><input type="checkbox" id="sMouse" ${settings.mouseYoke ? "checked" : ""}> Mouse yoke (Y)</label>
      <label>Flight assist <select id="sAssist"><option value="assisted">Assisted: arrows change pitch and bank, let go to hold (easiest)</option><option value="rudder">Auto-rudder only: real stick, rudder handled for you</option><option value="off">Off: fully manual (practise P-factor and coordination)</option></select></label>
      <label class="chk"><input type="checkbox" id="sSound" ${settings.sound ? "checked" : ""}> Sound</label>
      <label class="chk"><input type="checkbox" id="sVoice" ${settings.voice ? "checked" : ""}> Spoken ATC & ATIS (text-to-speech)</label>
      <label>Instrument panel (I) <select id="sPanel"><option value="steam">Six-pack (steam gauges)</option><option value="glass">Glass cockpit (G1000 style)</option><option value="off">Hidden</option></select></label></div>
      <p class="dnote">Graphics changes take effect after a reload. Gamepads and joysticks are detected automatically: press any button.</p>`;
    $("#sQ", B).value = settings.quality; $("#sPanel", B).value = settings.panel;
    $("#sQ", B).addEventListener("change", (e) => { settings.quality = e.target.value; saveSettings(); say("Reload the page to apply graphics quality.", "info"); });
    $("#sInv", B).addEventListener("change", (e) => { settings.invert = input.invert = e.target.checked; saveSettings(); });
    $("#sMouse", B).addEventListener("change", (e) => { settings.mouseYoke = input.mouseYoke = e.target.checked; saveSettings(); });
    $("#sAssist", B).value = settings.assist;
    $("#sAssist", B).addEventListener("change", (e) => { setAssist(e.target.value); });
    $("#sSound", B).addEventListener("change", (e) => { settings.sound = audio.enabled = e.target.checked; saveSettings(); });
    $("#sVoice", B).addEventListener("change", (e) => { settings.voice = e.target.checked; saveSettings(); });
    $("#sPanel", B).addEventListener("change", (e) => { settings.panel = panel.mode = e.target.value; saveSettings(); layout(); });
  } else if (n === "help") {
    const k = (keys, what) => `<li><span class="keys">${keys.map((x) => `<kbd>${esc(x)}</kbd>`).join(" ")}</span><span>${esc(what)}</span></li>`;
    B.innerHTML = `<ul class="keylist">${k(["↑", "W"], "Nose down")}${k(["↓", "S"], "Nose up")}${k(["←", "→", "A", "D"], "Roll (ailerons)")}${k(["Q", "E"], "Rudder / nosewheel steering")}${k(["R", "F"], "Throttle up / down (Shift = full / idle)")}${k(["[", "]"], "Flaps up / down a notch")}${k(["T", "G"], "Trim nose up / down")}${k(["B"], "Brakes (with rudder for differential)")}${k(["Shift+B"], "Parking brake")}${k(["H"], "Carburetor heat")}${k(["L"], "Landing light")}${k(["O"], "Set the heading indicator to the compass")}${k(["Space"], "Click the mic (pilot-controlled lighting)")}${k(["N"], "Swap NAV1")}${k(["C"], "Change view: cockpit, chase, orbit, tower")}${k(["I"], "Panel: six-pack, glass, hidden")}${k(["M"], "Map")}${k(["K"], "Checklist")}${k(["Y"], "Mouse yoke on/off")}${k(["U"], "Flight assist: Assisted → Auto-rudder → Manual")}${k(["P", "Esc"], "Pause")}</ul>
      <p class="dnote">Mouse: drag to look around (cockpit) or orbit (outside views). Scroll to zoom. Double-click to recentre. Scroll over panel knobs (Kollsman, OBS, heading bug, attitude indicator) to set them. Click the HI knob to align it with the compass.</p>`;
  }
}
function fmtHour(h) { const hh = Math.floor(h), mm = Math.round((h - hh) * 60); return `${String(hh).padStart(2, "0")}:${String(mm % 60).padStart(2, "0")} local`; }
function densAltAtField() { const t = weather.state; const elev = KZAR.elevFt; const pa = elev + (29.92 - weather.qnhInHg) * 1000; const isa = 15 - 1.98 * pa / 1000; return pa + 120 * (weather.tempC - isa); }
function checkState() { return { ac, d: ac.derived, flags: sim.flags, qnh: weather.qnhInHg }; }
function directTo(wp) { sim.gpsWp = wp; sim.gpsFrom = { x: ac.pos.x, z: ac.pos.z }; sim.route = [{ x: ac.pos.x, z: ac.pos.z }, wp]; say(`GPS direct to ${wp.id}`, "info", 1800); drawBigMap(); }
function drawWB() {
  const cv = $("#wbChart"); if (!cv) return; const g = cv.getContext("2d"); const W = cv.width, H = cv.height;
  const wb = weightBalance({ ...ac.load, fuelGal: ac.eng.fuelL + ac.eng.fuelR });
  g.fillStyle = "#0b1118"; g.fillRect(0, 0, W, H);
  const X = (cg) => 36 + (cg - 33) / (49 - 33) * (W - 50), Y = (lb) => H - 26 - (lb - 1400) / (2450 - 1400) * (H - 40);
  g.strokeStyle = "#22303f"; g.lineWidth = 1; for (let cg = 34; cg <= 48; cg += 2) { g.beginPath(); g.moveTo(X(cg), Y(1400)); g.lineTo(X(cg), Y(2450)); g.stroke(); } for (let lb = 1500; lb <= 2400; lb += 100) { g.beginPath(); g.moveTo(X(33), Y(lb)); g.lineTo(X(49), Y(lb)); g.stroke(); }
  g.fillStyle = "rgba(91,227,138,0.18)"; g.strokeStyle = "#5be38a"; g.lineWidth = 2; g.beginPath(); g.moveTo(X(35), Y(1500)); g.lineTo(X(35), Y(1950)); g.lineTo(X(38.5), Y(2300)); g.lineTo(X(47.3), Y(2300)); g.lineTo(X(47.3), Y(1500)); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = "#93a3b6"; g.font = "11px IBM Plex Mono, monospace"; for (let cg = 34; cg <= 48; cg += 4) g.fillText(cg, X(cg) - 6, H - 10); for (let lb = 1600; lb <= 2400; lb += 400) g.fillText(lb, 2, Y(lb) + 4);
  g.fillStyle = wb.inEnvelope ? "#3fd8f2" : "#ff4d4d"; g.beginPath(); g.arc(X(wb.cgIn), Y(wb.lb), 6, 0, 7); g.fill();
  $("#wbOut").innerHTML = `Weight <b>${Math.round(wb.lb)} lb</b> (max 2,300) · CG <b>${wb.cgIn.toFixed(1)} in</b> (limits ${wb.fwdLimit.toFixed(1)}–${wb.aftLimit}) · Moment ${Math.round(wb.moment).toLocaleString()} lb-in · <b class="${wb.inEnvelope ? "okc" : "badc"}">${wb.inEnvelope ? "Within limits" : wb.overGross ? "Over gross weight" : "CG out of limits"}</b>`;
}
const bigMap = { canvas: null, range: 9, toWorld: () => ({ x: 0, z: 0 }) };
function drawBigMap() {
  const cv = bigMap.canvas; if (!cv || !sectionalBase || openDrawerName !== "map") return;
  const dpr = Math.min(2, devicePixelRatio || 1); const r = cv.getBoundingClientRect(); if (cv.width !== Math.round(r.width * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
  const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  bigMap.toWorld = drawMap(g, 0, 0, r.width, r.height, { base: sectionalBase, cx: ac.pos.x, cz: ac.pos.z, rangeNm: bigMap.range, own: { x: ac.pos.x, z: ac.pos.z, hdg: ac.derived.hdg }, route: sim.route, style: "sectional" });
}

/* ---------------- objectives card & HUD ---------------- */
function renderObjectives() {
  const st = lessons.status(); const el = $("#objectives");
  if (!st) { el.hidden = true; return; }
  el.hidden = false;
  if (lessons.lesson !== renderObjectives.last) { renderObjectives.last = lessons.lesson; el.classList.toggle("min", innerWidth < 720); }
  el.innerHTML = `<div class="ohead"><span class="ltag">Lesson</span><button class="xbtn" id="oMin" aria-label="Collapse">–</button></div><h3>${esc(st.title)}</h3>
    <ol class="objs">${st.objectives.map((o) => `<li class="${o.state}">${esc(o.text)}</li>`).join("")}</ol>
    ${st.done ? `<div class="result ${st.failed ? "bad" : "good"}"><b>${st.failed ? "Lesson ended" : "Lesson complete"}</b>${st.failed ? `<p>${esc(st.failed)}</p>` : ""}${st.results.map((r) => `<p>${esc(r)}</p>`).join("")}</div>` : ""}
    <details ${st.done ? "" : "open"}><summary>Tips</summary><ul class="tips">${st.tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></details>
    <div class="ofoot"><span class="exams">Exam: ${st.exam.map(examLink).join("")}</span><span><button class="sbtn" id="oRestart">Restart</button> <button class="sbtn" id="oExit">Exit</button></span></div>`;
  $("#oRestart").onclick = () => { lessons.start(st.id); sim.paused = false; };
  $("#oExit").onclick = () => { lessons.stop(); renderObjectives(); };
  $("#oMin").onclick = () => el.classList.toggle("min");
}
let lastObjKey = "";
function hudUpdate() {
  const d = ac.derived;
  // VFR chip
  const v = sim.vfr; if (v) {
    const cls = v.special.length ? v.special.map((s) => s.id).join(" · ") : `Class ${v.cls}`;
    $("#vfr").className = `vfr ${v.ok ? "ok" : "bad"}`;
    $("#vfr").innerHTML = `<b>${esc(cls)}</b><span>${esc(v.ok ? v.mins.text : v.why)}</span>`;
    $("#vfr").title = `VFR minimums here: ${v.mins.text} (14 CFR 91.155)`;
  }
  // data strip when the panel is hidden or outside views
  const strip = $("#strip"); const showStrip = settings.panel === "off" || sim.view !== "cockpit";
  strip.hidden = !showStrip;
  if (showStrip) strip.innerHTML = `<span><i>IAS</i>${Math.round(d.ias)}</span><span><i>ALT</i>${Math.round(d.altInd / 10) * 10}</span><span><i>HDG</i>${String(Math.round(d.hi) % 360).padStart(3, "0")}</span><span><i>VS</i>${Math.round(d.vsi / 10) * 10}</span><span><i>RPM</i>${Math.round(d.rpm)}</span><span><i>FLAPS</i>${ac.flapsSet}</span><span><i>THR</i>${Math.round(ac.ctl.throttle * 100)}%</span>`;
  // stall / G
  $("#stall").hidden = !d.stallWarn;
  sim.gHigh = Math.abs(d.g - 1) > 0.4 ? (sim.gHigh || 0) + 0.12 : 0;
  const gm = $("#gmeter"); gm.hidden = !(sim.showG || sim.gHigh > 1.2) || d.onGround;
  if (!gm.hidden) gm.innerHTML = `<b>${d.g.toFixed(2)} G</b><span>bank ${Math.round(Math.abs(d.bank))}° · theory ${(1 / Math.cos(Math.min(85, Math.abs(d.bank)) * DEG)).toFixed(2)} G</span>`;
  // light gun
  const lg = $("#lightgun"); lg.hidden = !sim.lightGun; if (sim.lightGun) lg.innerHTML = `<span class="dot ${sim.lightGun.color} ${sim.lightGun.flash ? "flash" : ""}"></span>${esc(sim.lightGun.text)}`;
  // objectives
  const st = lessons.status(); const key = st ? JSON.stringify([st.objectives.map((o) => o.state), st.done, st.results.length]) : "";
  if (key !== lastObjKey) { lastObjKey = key; renderObjectives(); }
  if (openDrawerName === "check") renderDrawer();
  if (openDrawerName === "map") drawBigMap();
}

/* ---------------- layout ---------------- */
function layout() {
  const ph = settings.panel === "off" || sim.view !== "cockpit" ? 0 : Math.round(Math.min(Math.max(innerHeight * 0.33, 170), 330, innerWidth * 0.45));
  document.documentElement.style.setProperty("--panel-h", ph + "px");
  $("#panel").hidden = ph === 0;
  const w = innerWidth, h = Math.max(100, innerHeight - ph);
  renderer.setSize(w, h, false); view.style.width = w + "px"; view.style.height = h + "px";
  camera.aspect = w / h; camera.updateProjectionMatrix();
  if (ph) panel.resize();
}
addEventListener("resize", layout);

/* ---------------- start screen ---------------- */
function startFlying() { $("#start").hidden = true; sim.paused = false; audio.start(); }
function freeFlight(where, wx, hour) {
  lessons.stop(); renderObjectives();
  sim.setWeather(PRESETS[wx]); sim.setTime(hour);
  const sp = { kzarRamp: { ...KZAR.spawn.ramp, onGround: true, engineRunning: false, coldDark: true }, kzar27: { ...KZAR.spawn.rwy27, onGround: true }, kzar09: { ...KZAR.spawn.rwy09, onGround: true }, kame36: { ...KAME.spawn.rwy36, onGround: true }, z19: { ...Z19.spawn.rwy04, onGround: true }, air: { x: -2000, z: 6000, hdg: 60, onGround: false, altFt: 3500, kias: 100 } }[where];
  spawn(sp); if (where === "air") ac.ctl.throttle = 0.66;
  sim.radio.com1 = where.startsWith("kame") ? KAME.freqs.ctaf : where === "z19" ? Z19.freqs.ctaf : where === "kzarRamp" ? KZAR.freqs.atis : KZAR.freqs.twr;
  if (where === "kzarRamp") { checkTab = "start"; say("Cold and dark. Open the checklist (K) and the Aircraft drawer to start the engine.", "lesson", 9000); }
}
let startLessonId = "pattern";
$("#startLesson").addEventListener("click", () => { startFlying(); lessons.start(startLessonId); });
$("#startPick").addEventListener("click", () => { startFlying(); sim.paused = true; openDrawer("lessons"); $("#paused").hidden = false; });
$("#startFree").addEventListener("click", () => { startFlying(); freeFlight("kzar27", "scattered", 13); });
$("#crashRetry").addEventListener("click", retry);
$("#crashLessons").addEventListener("click", () => { hideCrash(); openDrawer("lessons"); });
$("#resume").addEventListener("click", () => { sim.paused = false; $("#paused").hidden = true; });
input.on("onPad", (id) => say(`Controller connected: ${id.slice(0, 40)}`, "good"));
if (matchMedia("(pointer: coarse)").matches) { $("#touch").hidden = false; input.attachTouch($("#stick"), $("#knob"), $("#thr")); }

/* ---------------- panel actions ---------------- */
const act = {
  baro: (dv) => { ac.inst.kollsman = Math.round(Math.max(28.1, Math.min(31, ac.inst.kollsman + dv)) * 100) / 100; },
  hdgBug: (dv) => { ac.inst.hdgBug = (ac.inst.hdgBug + dv + 360) % 360; },
  obs: (dv) => { ac.inst.obs = (ac.inst.obs + dv + 360) % 360; },
  aiAdj: (dv) => { ac.inst.aiOffset = Math.max(-6, Math.min(6, ac.inst.aiOffset + dv * 0.5)); },
  hiAdj: (dv) => { ac.inst.hiDrift = wrap180(ac.inst.hiDrift + dv); },
  hiSet: () => keymap.o(),
  swapCom: () => { [sim.radio.com1, sim.radio.com1s] = [sim.radio.com1s, sim.radio.com1]; if (openDrawerName === "radio") renderDrawer(); },
  swapNav: () => keymap.n(),
  xpdrMode: () => { const m = ["STBY", "ON", "ALT"]; ac.xpdr.mode = m[(m.indexOf(ac.xpdr.mode) + 1) % 3]; },
  openMap: () => openDrawer("map"),
  mfdRange: (dir) => { const rs = [2, 4, 8, 12, 20]; const i = rs.indexOf(sim.mfdRange || 8); sim.mfdRange = rs[Math.max(0, Math.min(rs.length - 1, i - dir))]; },
};

function panelState() {
  const d = ac.derived; const g = sim.gpsWp ? gps(ac.pos, sim.gpsWp, sim.gpsFrom) : null;
  const ete = g && d.gs > 20 ? (() => { const m = g.dist / d.gs * 60; return `${Math.floor(m)}:${String(Math.round((m % 1) * 60)).padStart(2, "0")}`; })() : "";
  return { ac, d, vor1: sim.vor1, gps: g, ete, radio: sim.radio, base: sectionalBase, route: sim.route, mfdRange: sim.mfdRange, wind: { dir: weather.windDir, kt: weather.windKt }, act };
}

/* ---------------- main loop ---------------- */
let sectionalBase = null, last = performance.now(), panelT = 0, hudT = 0, monT = 0;
function frame(now) { tick(now); requestAnimationFrame(frame); }
/** One simulation step: controls, physics, events, monitors, lessons. `pilot` (tests) replaces keyboard input. */
function stepSim(dt, pilot) {
  if (pilot) pilot(ac, ac.derived, sim, dt); else input.apply(ac, dt);
  ac.step(dt);
  if (!Number.isFinite(ac.pos.x + ac.pos.y + ac.pos.z + ac.vel.x + ac.q.w)) { say("Flight model reset after a numerical error.", "warn"); spawn(sim.lastSpawn); }
  sim.d = ac.derived;
  sim.t += dt;
  sim.vor1 = ac.powered && ac.elec.avionics ? vor(ac.pos, sim.radio.nav1, ac.inst.obs) : { ok: false };
  handleEvents();
  monT += dt; if (monT > 0.2) { monitors(monT); monT = 0; }
  lessons.update(dt);
}
function tick(now) {
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = Math.max(last, now);
  if (sim.ready && !sim.paused) stepSim(dt);
  if (sim.ready) {
    const d = sim.d = ac.derived;
    plane.position.set(ac.pos.x, ac.pos.y, ac.pos.z); plane.quaternion.set(ac.q.x, ac.q.y, ac.q.z, ac.q.w);
    animateAirplane(plane, ac, sim.t, sim.paused ? 0 : dt);
    { const pp = plane.userData.parts, cp = cockpit.userData.ext?.userData.parts; if (cp) for (const k of ["ailL", "ailR", "flapL", "flapR"]) cp[k].rotation.x = pp[k].rotation.x; }
    { const gh = groundAt(ac.pos.x, ac.pos.z).h, agl = ac.pos.y - gh; shadow.position.set(ac.pos.x, gh + 0.06, ac.pos.z); shadow.rotation.y = -ac.derived.hdg * DEG; shadow.material.opacity = Math.max(0, 1 - agl / 160) * (world.night ? 0.25 : 0.85); shadow.visible = shadow.material.opacity > 0.02; }
    updateCamera(dt);
    const probe = world.clouds.probe(camera.position.x, camera.position.y, camera.position.z);
    world.setEnvironment({ hour: weather.hour, visSM: weather.visSM, inCloud: probe.inside });
    world.update(sim.t, camera.position, { pclLevel: sim.pcl.level, windDir: weather.windDir, windKt: weather.windKt, lightGun: sim.lightGun, beaconDay: weather.visSM < 3 || weather.clouds.some((c) => (c.cover === "BKN" || c.cover === "OVC") && c.baseFt < 1000) });
    renderer.render(scene, camera);
    panelT += dt; if (settings.panel !== "off" && sim.view === "cockpit" && panelT > 1 / 40) {
      panelT = 0;
      panel.draw(panelState());
    }
    updateControlIndicator();
    hudT += dt; if (hudT > 0.12) { hudT = 0; hudUpdate(); }
    audio.update(ac, d, sim.paused);
  }
}

/* ---------------- boot ---------------- */
async function boot() {
  layout();
  const prog = $("#loadMsg");
  try {
    await world.build((m) => { prog.textContent = m + "…"; });
    prog.textContent = "Drawing the sectional chart…"; await new Promise((r) => setTimeout(r, 16));
    sectionalBase = buildSectionalBase(settings.quality === "low" ? 480 : 640);
    addParked();
    sim.setWeather(PRESETS.scattered); sim.setTime(13);
    spawn({ ...KZAR.spawn.rwy27, onGround: true });
    sim.ready = true; sim.d = ac.derived;
    $("#loading").hidden = true; $("#startChoices").hidden = false;
    const p = new URLSearchParams(location.search).get("lesson");
    if (p && LESSONS.some((l) => l.id === p)) { startLessonId = p; $("#startLesson").textContent = `Start lesson: ${LESSONS.find((l) => l.id === p).title}`; }
  } catch (err) {
    console.error(err); prog.textContent = "Zarhart couldn't start: " + err.message + ". Try another browser with WebGL turned on.";
  }
  requestAnimationFrame(frame);
}
window.__zarhart = {
  sim, ac, weather, world, lessons, camera, panel, settings, keys: input.keys, frame: (ms) => tick(ms), radioCall, pttClick, renderer, scene, plane, cockpit, camState, layout, panelState, updateCamera,
  /** headless stepping for tests: advance `secs` of sim time at 30 Hz without rendering; pilot(ac, d, sim, dt) flies */
  step(secs, pilot) { for (let i = 0, n = Math.round(secs * 30); i < n; i++) { if (ac.crashed || lessons.done) break; stepSim(1 / 30, pilot); } return ac.derived; },
};
boot();
