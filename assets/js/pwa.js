// Installable web app: registers the offline service worker and shows "Install" where the browser supports it.
// Not used inside the store app (tools/build-app.mjs sets window.ZARHART_APP there).
const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

if (!window.ZARHART_APP && "serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  addEventListener("load", () => navigator.serviceWorker.register(new URL("../../sw.js", import.meta.url)).catch(() => {}));
}

// Chrome, Edge and Android: a real install button. iPhone and iPad: a hint, since Safari has no install prompt.
let deferred = null;
const show = (sel, on) => document.querySelectorAll(sel).forEach((el) => { el.hidden = !on; });
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; show("[data-install]", true); });
addEventListener("appinstalled", () => { deferred = null; show("[data-install]", false); });
document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-install]"); if (!btn || !deferred) return;
  deferred.prompt(); await deferred.userChoice.catch(() => null); deferred = null; show("[data-install]", false);
});
const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
if (ios && !standalone && !window.ZARHART_APP) show("[data-install-ios]", true);
