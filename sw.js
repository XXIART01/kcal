// Оболочка: сеть в приоритете, кэш как запасной вариант. API GitHub (чужой origin) не трогаем.
const CACHE = "kcal-v21";
const SHELL = ["./", "index.html", "css/app.css", "js/api.js", "js/app.js", "manifest.json", "icons/icon-180.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  // no-cache: всегда сверяться с сервером, иначе HTTP-кэш GitHub Pages (10 мин) отдаёт старое
  e.respondWith(fetch(e.request, {cache: "no-cache"}).then(r => {
    const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r;
  }).catch(() => caches.match(e.request)));
});
