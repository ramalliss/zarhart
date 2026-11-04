// VR on standalone headsets: which browsers run on one, when to suggest Graphics: Low before VR, pinch controls for headsets
// without controllers, the URL flags for testing VR on a headset, and the frame-rate readout. No three.js here, so Node can
// test it (tools/test-vr.mjs).

/**
 * Browsers that run on a standalone headset with a phone-class graphics chip: Meta Quest Browser, Pico Browser and Wolvic.
 * Not a desktop browser driving a PC headset, and not a phone (phones without WebXR get phone VR instead).
 */
const HEADSET_UA = /OculusBrowser|\bQuest\b|PicoBrowser|\bPico\b|Wolvic|Mobile VR|\bVR Safari\b/i;
export const isStandaloneHeadset = (ua = "") => HEADSET_UA.test(ua);

/**
 * Ask before a WebXR session whether to switch to Low: only on a standalone headset, and only with High or Ultra.
 * Any setting other than "low" counts, because an unknown saved value falls back to High.
 */
export const shouldOfferLowForVR = ({ webxr, ua, quality }) => !!webxr && isStandaloneHeadset(ua) && quality !== "low";

/**
 * Flags for testing VR on a headset: ?vrstats=1 shows a frame-rate readout in VR; ?logdepth=0 turns off the logarithmic
 * depth buffer for the whole page load (three.js fixes it when the renderer is created), to compare it on and off.
 */
export function vrFlags(search = "") {
  const p = new URLSearchParams(search);
  return { stats: p.get("vrstats") === "1", logDepth: p.get("logdepth") !== "0" };
}

/**
 * Pinch controls, for headsets without controllers (Apple Vision Pro, or hands on a Quest): pinch and move a hand. The right
 * hand works like a yoke, the left like a throttle lever with rudder. Distances are in metres; full deflection takes 10 cm.
 */
export const PINCH = { travel: 0.1, dead: 0.012, throttleTravel: 0.15, tapMs: 800, tapMove: 0.03 };
const axisOf = (v) => { const a = Math.abs(v); return a <= PINCH.dead ? 0 : Math.sign(v) * Math.min(1, (a - PINCH.dead) / (PINCH.travel - PINCH.dead)); };
/**
 * How far the hand moved since the pinch began, turned to the way the head faced then (`yaw`, radians about the vertical,
 * as three.js and WebXR measure it): `right`, `up`, and `fwd` (away from you). Positions are WebXR's: x right, y up, z back.
 */
export function pinchDelta(start, now, yaw) {
  const dx = now.x - start.x, dy = now.y - start.y, dz = now.z - start.z, c = Math.cos(yaw), s = Math.sin(yaw);
  return { right: dx * c - dz * s, up: dy, fwd: -dx * s - dz * c };
}
/** right hand: pull toward you for nose up, push away for nose down, sideways to roll (-1..1, + = pull / roll right) */
export const pinchYoke = (d) => ({ roll: axisOf(d.right), pitch: axisOf(-d.fwd) });
/** left hand: up and down move the throttle like a lever from where it was (15 cm = full travel), sideways is rudder */
export const pinchLever = (throttle0, d) => ({ throttle: Math.min(1, Math.max(0, throttle0 + d.up / PINCH.throttleTravel)), yaw: axisOf(d.right) });
/** which control a pinch takes: the hand the headset reports, else the side of the head the hand is on (metres right of it) */
export const pinchRole = (handedness, handRight = 0) => (handedness === "right" ? "yoke" : handedness === "left" ? "lever" : handRight >= 0 ? "yoke" : "lever");
/** a pinch on a console button counts as a press when it is brief and the hand stays put */
export const isPinchTap = (ms, moved) => ms <= PINCH.tapMs && moved <= PINCH.tapMove;

/**
 * Frame-rate readout. Feed it each frame's interval (ms since the previous frame) and the CPU time the frame's own work took;
 * once per window it returns { fps, ms (average interval), worst (longest interval), cpu (average) }, otherwise null.
 * An interval over a second is a pause (the headset was taken off, the tab hidden) and is skipped.
 */
export class FrameStats {
  constructor(windowMs = 500) { this.windowMs = windowMs; this.reset(); }
  reset() { this.n = 0; this.sum = 0; this.worst = 0; this.cpu = 0; }
  add(interval, cpu = 0) {
    if (!(interval > 0) || interval > 1000) return null;
    this.n++; this.sum += interval; this.cpu += cpu; if (interval > this.worst) this.worst = interval;
    if (this.sum < this.windowMs) return null;
    const r = { fps: (1000 * this.n) / this.sum, ms: this.sum / this.n, worst: this.worst, cpu: this.cpu / this.n };
    this.reset();
    return r;
  }
}
