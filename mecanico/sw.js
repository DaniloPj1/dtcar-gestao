// Service worker do app do mecânico. Vale só para a pasta mecanico/ e não mexe no sw.js do sistema.
// "Rede primeiro": sempre busca a versão nova; usa a cópia guardada só se a rede falhar.
// Mudou um arquivo desta pasta? Troque a versão de CACHE.
const CACHE = "dtcar-mecanico-t2";
const ARQUIVOS = ["./", "index.html", "app.js", "manifest.webmanifest", "login.mp4", "login-poster.jpg",
  "../js/config.js", "../vendor/supabase.js", "../js/catalogo.js", "../js/util.js", "../js/catalogodados.js",
  "../icons/logo-branco-sm.png", "../icons/favicon.png", "../icons/icon-192.png", "../icons/icon-512.png"];
self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => Promise.all(ARQUIVOS.map(a => fetch(new Request(a, { cache: "reload" })).then(r => r.status === 200 && c.put(a, r)).catch(() => {})))).then(() => self.skipWaiting())));
// apaga só as cópias antigas deste app; as do sistema (dtcar-vNNN) não são tocadas
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("dtcar-mecanico-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  const rede = e.request.mode === "navigate" ? fetch(e.request) : fetch(e.request.url, { cache: "no-cache" });
  e.respondWith(rede.then(r => { if (r.status === 200) { const c = r.clone(); caches.open(CACHE).then(k => k.put(e.request, c)); } return r; })
    .catch(() => caches.open(CACHE).then(k => k.match(e.request, { ignoreSearch: true })).then(r => r || (e.request.mode === "navigate" ? caches.open(CACHE).then(k => k.match("index.html")) : Response.error()))));
});
