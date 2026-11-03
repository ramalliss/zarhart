// Checks for VR on standalone headsets: which browsers count as a headset, when Fly in VR suggests Graphics: Low,
// the ?vrstats / ?logdepth flags, and the frame-rate readout. Run: node tools/test-vr.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { isStandaloneHeadset, shouldOfferLowForVR, vrFlags, FrameStats } from "../assets/js/sim/headset.js";

const UA = {
  quest3: "Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/35.2.0.10.84 Chrome/128.0.6613.137 VR Safari/537.36",
  quest3sMobile: "Mozilla/5.0 (Linux; Android 12; Quest 3S) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/35.2.0 SamsungBrowser/4.0 Chrome/128.0.6613.137 Mobile VR Safari/537.36",
  quest2: "Mozilla/5.0 (X11; Linux x86_64; Quest 2) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/34.0 Chrome/126.0.0.0 VR Safari/537.36",
  pico: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) PicoBrowser/3.3.38 Chrome/105.0.5195.68 VR Safari/537.36",
  wolvic: "Mozilla/5.0 (Android 10; Mobile VR; rv:105.0) Gecko/105.0 Firefox/105.0 Wolvic/1.3",
  windowsChrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  linuxFirefox: "Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  pixel: "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  galaxy: "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
};

test("standalone headset browsers are recognised", () => {
  for (const k of ["quest3", "quest3sMobile", "quest2", "pico", "wolvic"]) assert.equal(isStandaloneHeadset(UA[k]), true, k);
});

test("desktop browsers (including ones driving a PC headset) and phones are not headsets", () => {
  for (const k of ["windowsChrome", "macSafari", "linuxFirefox", "iphone", "pixel", "galaxy"]) assert.equal(isStandaloneHeadset(UA[k]), false, k);
  assert.equal(isStandaloneHeadset(""), false);
  assert.equal(isStandaloneHeadset(undefined), false);
});

test("Fly in VR suggests Low only for WebXR on a headset with High or Ultra", () => {
  assert.equal(shouldOfferLowForVR({ webxr: true, ua: UA.quest3, quality: "high" }), true);
  assert.equal(shouldOfferLowForVR({ webxr: true, ua: UA.quest3sMobile, quality: "ultra" }), true);
  assert.equal(shouldOfferLowForVR({ webxr: true, ua: UA.quest3, quality: "low" }), false, "already Low");
  assert.equal(shouldOfferLowForVR({ webxr: false, ua: UA.quest3, quality: "high" }), false, "no WebXR: phone VR, unchanged");
  assert.equal(shouldOfferLowForVR({ webxr: true, ua: UA.windowsChrome, quality: "ultra" }), false, "desktop PC VR, unchanged");
  assert.equal(shouldOfferLowForVR({ webxr: true, ua: UA.pixel, quality: "high" }), false, "a phone with WebXR, unchanged");
  assert.equal(shouldOfferLowForVR({ webxr: false, ua: UA.iphone, quality: "high" }), false, "iPhone phone VR, unchanged");
  assert.equal(shouldOfferLowForVR({ webxr: true, ua: UA.quest3, quality: "medium" }), true, "an unknown saved value runs as High");
});

test("URL flags: ?vrstats=1 and ?logdepth=0, defaults unchanged", () => {
  assert.deepEqual(vrFlags(""), { stats: false, logDepth: true });
  assert.deepEqual(vrFlags("?lesson=pattern"), { stats: false, logDepth: true });
  assert.deepEqual(vrFlags("?vrstats=1"), { stats: true, logDepth: true });
  assert.deepEqual(vrFlags("?logdepth=0"), { stats: false, logDepth: false });
  assert.deepEqual(vrFlags("?vrstats=1&logdepth=0&lesson=vasi"), { stats: true, logDepth: false });
  assert.deepEqual(vrFlags("?vrstats=0&logdepth=1"), { stats: false, logDepth: true });
  assert.deepEqual(vrFlags("?vrstats=yes&logdepth=off"), { stats: false, logDepth: true }, "only 1 and 0 switch anything");
});

test("frame-rate readout: one summary per half second", () => {
  const s = new FrameStats(500);
  let r = null, n = 0;
  while (!r) { r = s.add(1000 / 72, 4); n++; } // a steady 72 Hz
  assert.equal(n, 36);
  assert.ok(Math.abs(r.fps - 72) < 0.01, `fps ${r.fps}`);
  assert.ok(Math.abs(r.ms - 13.89) < 0.01);
  assert.ok(Math.abs(r.worst - 13.89) < 0.01);
  assert.equal(r.cpu, 4);
  assert.equal(s.add(1000 / 72, 4), null, "a new window starts empty");
});

test("frame-rate readout: a hitch shows as the worst frame, pauses and bad intervals are skipped", () => {
  const s = new FrameStats(500);
  assert.equal(s.add(0), null); assert.equal(s.add(-5), null); assert.equal(s.add(NaN), null); assert.equal(s.add(4000), null);
  assert.equal(s.n, 0);
  let r = null;
  for (let i = 0; !r; i++) r = s.add(i === 5 ? 41.7 : 1000 / 90, 2);
  assert.ok(Math.abs(r.worst - 41.7) < 1e-9);
  assert.ok(r.fps < 90 && r.fps > 80, `fps ${r.fps}`);
});
