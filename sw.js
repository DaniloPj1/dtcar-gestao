// Service worker: deixa o site instalável e abre o programa mesmo sem internet.
// Estratégia "rede primeiro": sempre busca a versão nova; usa a cópia guardada só se a rede falhar.
// Os arquivos do programa são guardados na instalação para a primeira abertura offline funcionar.
// Ao criar um arquivo novo em js/, css/, vendor/ ou icons/, inclua-o em ARQUIVOS e troque a versão de CACHE.
const CACHE = "dtcar-v21";
const ARQUIVOS = ["./", "index.html", "manifest.webmanifest", "css/app.css", "icons/favicon.png", "icons/icon-192.png", "icons/icon-512.png", "icons/login-fundo.jpg", "icons/logo-branco-sm.png", "icons/logo-branco.png", "icons/logo-preto.png", "js/api.js", "js/app.js", "js/boleto.js", "js/config.js", "js/dbf.js", "js/fila.js", "js/folha.js", "js/legado.js", "js/lib.js", "js/local.js", "js/nfe.js", "js/pasta.js", "js/pdf.js", "js/regras.js", "js/tema.js", "js/ui.js", "js/util.js", "js/telas/acoesos.js", "js/telas/admin.js", "js/telas/backup.js", "js/telas/balcao.js", "js/telas/cadastros.js", "js/telas/caixa.js", "js/telas/compras.js", "js/telas/dadoslocais.js", "js/telas/entrada.js", "js/telas/financeiro.js", "js/telas/funcionarios.js", "js/telas/importar.js", "js/telas/imprimir.js", "js/telas/login.js", "js/telas/ordem.js", "js/telas/painel.js", "js/telas/pendente.js", "js/telas/produtos.js", "js/telas/receber.js", "js/telas/recibos.js", "js/telas/relatorios.js", "js/telas/sefaz.js", "js/telas/topo.js", "vendor/jspdf.umd.min.js", "vendor/preact-htm.js", "vendor/supabase.js"];
// "reload" ignora a cópia do navegador: a versão guardada para uso offline é sempre a publicada agora
self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => Promise.all(ARQUIVOS.map(a => fetch(new Request(a, { cache: "reload" })).then(r => r.ok && c.put(a, r)).catch(() => {})))).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return; // dados do Supabase nunca passam pelo cache
  // "no-cache": confere com o servidor a cada abertura (o GitHub Pages manda reaproveitar por 10 minutos)
  const rede = e.request.mode === "navigate" ? fetch(e.request) : fetch(e.request.url, { cache: "no-cache" });
  e.respondWith(rede.then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(k => k.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || (e.request.mode === "navigate" ? caches.match("./index.html") : Response.error()))));
});
