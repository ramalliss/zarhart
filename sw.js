// Offline support for the installed web app. Network first, so online visitors always get the latest site;
// the cache is only a fallback when there's no connection. Pages you've opened, and the core files below, work offline.
const CACHE = "zarhart-v1";
const SCOPE = new URL("./", self.location).pathname;
const CDN = ["cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"];
const CORE = [
  "./", "sim/", "prep/", "learn/", "pricing/",
  "assets/css/site.css", "assets/css/sim.css", "assets/css/prep.css", "assets/css/learn.css",
  "assets/js/pwa.js", "assets/js/prep/prep.js", "assets/data/questions.json", "assets/img/favicon.svg",
  ...["main", "fdm", "world-data", "world3d", "plane3d", "gfx", "panel", "map", "nav", "weather", "input", "audio", "checklists", "lessons", "vr"].map((m) => `assets/js/sim/${m}.js`),
  "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
  "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/objects/Sky.js",
];

self.addEventListener("install", (e) => {
  // one missing file must not stop the install, so add them one by one
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(CORE.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url);
  const ours = url.origin === self.location.origin && url.pathname.startsWith(SCOPE);
  if (!ours && !CDN.includes(url.hostname)) return;
  e.respondWith(fetch(req).then((res) => {
    if (res.ok || res.type === "opaque") { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === "navigate" ? caches.match(SCOPE) : Response.error()))));
});
