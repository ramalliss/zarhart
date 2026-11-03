// VR on standalone headsets: which browsers run on one, when to suggest Graphics: Low before VR, the URL flags for testing
// VR on a headset, and the frame-rate readout. No three.js here, so Node can test it (tools/test-vr.mjs).

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
