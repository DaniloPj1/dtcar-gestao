// Service worker do DTCar Scanner (/scanner/). Só desta pasta: o do site (/sw.js) continua cuidando
// do resto, e o app do celular (/app/) não passa por cache nenhum.
//
// Estratégia "rede primeiro": sempre busca a versão publicada; usa a cópia guardada só quando a rede
// falha. É isso que deixa o tablet abrir no pátio sem wi-fi e, ao mesmo tempo, nunca rodar tela velha.
// As tabelas de código de falha (js/falhas/*) e os mapas de modelo (js/modelos/*) são grandes e
// entram no cache quando usadas, não na instalação.
const CACHE = "dtcar-scanner-v1";
const ARQUIVOS = [
  "./", "index.html", "manifest.webmanifest", "scanner.css", "scanner.js", "comum.js", "icones.js",
  "telas/aovivo.js", "telas/graficos.js", "telas/falhas.js", "telas/rede.js", "telas/prog.js",
  "../vendor/preact-htm.js", "../vendor/supabase.js",
  "../js/config.js", "../js/lib.js", "../js/util.js", "../js/api.js", "../js/placa.js",
  "../js/obd.js", "../js/uds.js", "../js/udsdados.js", "../js/obdsessao.js", "../js/obdparam.js",
  "../js/obdfaixa.js", "../js/obdgrafico.js", "../js/obdconfere.js", "../js/obdfalhas.js",
  "../js/obdmodelo.js", "../js/obdvarredura.js", "../js/obdrede.js", "../js/obdmapa.js",
  "../js/bico.js", "../js/modelosdados.js",
  "../app/fonts/barlow-400.woff2", "../app/fonts/barlow-500.woff2",
  "../app/fonts/barlow-600.woff2", "../app/fonts/barlow-700.woff2",
  "../icons/favicon.png", "../icons/icon-192.png", "../icons/icon-512.png", "../icons/logo-branco.png",
];
self.addEventListener("install", e => e.waitUntil(caches.open(CACHE)
  .then(c => Promise.all(ARQUIVOS.map(a => fetch(new Request(a, { cache: "reload" })).then(r => r.ok && c.put(a, r)).catch(() => {}))))
  .then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(caches.keys()
  .then(ks => Promise.all(ks.filter(k => k.startsWith("dtcar-scanner-") && k !== CACHE).map(k => caches.delete(k))))
  .then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  // dados do Supabase e do app do celular nunca passam pelo cache
  if (e.request.method !== "GET" || u.origin !== location.origin || u.pathname.includes("/app/www/")) return;
  const rede = e.request.mode === "navigate" ? fetch(e.request) : fetch(e.request.url, { cache: "no-cache" });
  e.respondWith(rede
    .then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(k => k.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true })
      .then(r => r || (e.request.mode === "navigate" ? caches.match("./index.html") : Response.error()))));
});
