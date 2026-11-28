# Janelas do Painel que vieram do jeito do celular (pedido do Danilo em 25/11/2026):
#  - previsão do tempo com a hora de agora e o mini calendário da semana;
#  - notícias por prioridade cidade › estado › país, com o filtro "só o que afeta a oficina";
#  - cotação do dólar e das outras moedas;
#  - e-mails recebidos por prioridade contabilidade › Objetiva › outros, com link para a caixa de e-mail.
# As consultas de fora (Open-Meteo, Google Notícias, g1, AwesomeAPI) são respondidas por um servidor de mentira
# dentro da própria página: o teste não vai à internet.
# Uso: python3 teste/teste_painel_casa.py [pasta das fotos]
import subprocess, time, sys, os, tempfile
from playwright.sync_api import sync_playwright
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8796", "-d", RAIZ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); ok = []; falhas = []; erros = []
def chk(n, c, extra=""): (ok if c else falhas).append(n if c or not extra else n + " :: " + str(extra)[:500])
U = "http://localhost:8796/"; TMP = sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp()

# fetch de mentira para as fontes de fora + e-mails conferidos pelo robô na tabela email_robo
FORA = r"""(() => {
  const dias = n => Array.from({ length: n }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return d.toISOString().slice(0, 10); });
  const TEMPO = { current: { temperature_2m: 27.4, weather_code: 2 },
    daily: { time: dias(7), weather_code: [2,0,3,61,95,1,2], temperature_2m_max: [31,33,29,27,26,30,32],
      temperature_2m_min: [20,21,19,19,18,20,21], precipitation_probability_max: [10,0,40,80,90,20,5] } };
  const rss = itens => '<?xml version="1.0"?><rss><channel>' + itens.map(([t, u, f]) =>
    '<item><title>' + t + '</title><link>' + u + '</link><pubDate>' + new Date().toUTCString() + '</pubDate>' +
    (f ? '<source>' + f + '</source>' : '') + '</item>').join('') + '</channel></rss>';
  const CIDADE = rss([["Colatina terá obra na BR-259 a partir de segunda", "https://g1.globo.com/es/c1", "g1"],
    ["Festival de inverno movimenta Colatina", "https://g1.globo.com/es/c2", "A Gazeta"]]);
  const ESTADO = rss([["Diesel sobe nos postos do Espírito Santo", "https://g1.globo.com/es/e1"],
    ["Exposição de arte abre em Vitória", "https://g1.globo.com/es/e2"]]);
  const PAIS = rss([["Governo anuncia mudança no imposto sobre combustível", "https://g1.globo.com/br/p1", "g1"],
    ["Seleção empata em amistoso", "https://g1.globo.com/br/p2", "ge"]]);
  const MOEDAS = { USDBRL: { bid: "5.4321", pctChange: "0.85", create_date: "2026-11-28 08:15:00" },
    EURBRL: { bid: "5.9100", pctChange: "-0.20", create_date: "2026-11-28 08:15:00" },
    GBPBRL: { bid: "6.8800", pctChange: "0.10", create_date: "2026-11-28 08:15:00" },
    ARSBRL: { bid: "0.0054", pctChange: "0.00", create_date: "2026-11-28 08:15:00" },
    BTCBRL: { bid: "512345.00", pctChange: "-1.75", create_date: "2026-11-28 08:15:00" } };
  const resp = (corpo, tipo) => new Response(corpo, { status: 200, headers: { "content-type": tipo } });
  const original = window.fetch;
  window.__FORA = [];
  window.fetch = function (u, o) {
    const url = String(u && u.url ? u.url : u);
    window.__FORA.push(url);
    if (/api\.open-meteo\.com/.test(url)) return Promise.resolve(resp(JSON.stringify(TEMPO), "application/json"));
    if (/economia\.awesomeapi\.com\.br/.test(url)) return Promise.resolve(resp(JSON.stringify(MOEDAS), "application/json"));
    if (/corsproxy\.io/.test(url)) {
      const alvo = decodeURIComponent(url.split("url=")[1] || "");
      const x = /g1\.globo\.com/.test(alvo) ? ESTADO : /NATION/.test(alvo) ? PAIS : CIDADE;
      return Promise.resolve(resp(x, "text/xml"));
    }
    return original.apply(this, arguments);
  };
})();"""

PREP = """(() => { const db = window.__DB;
  db.email_robo = [
    { id: 1, email_id: 'm1', recebido_em: '2026-11-27T09:00:00-03:00', de_nome: 'Loredo Contabilidade', de_email: 'dploredocontabilidade@gmail.com', assunto: 'DAS de novembro', categoria: 'importante', anexos: [], pendencias: [] },
    { id: 2, email_id: 'm2', recebido_em: '2026-11-27T10:00:00-03:00', de_nome: 'Objetiva Web', de_email: 'suporte@objetivaweb.com.br', assunto: 'Atualização do sistema fiscal', categoria: 'importante', anexos: [], pendencias: ['NF fora do sistema'] },
    { id: 3, email_id: 'm3', recebido_em: '2026-11-27T11:00:00-03:00', de_nome: 'Fornecedor X', de_email: 'vendas@fornecedor.com.br', assunto: 'Promoção de filtros', categoria: 'propaganda', anexos: [], pendencias: [] } ];
})();"""

def rodar(b, nome, w, h):
  T = lambda t: "[" + nome + "] " + t
  pg = b.new_context(viewport={"width": w, "height": h}).new_page()
  pg.on("pageerror", lambda e: erros.append(nome + ": " + str(e)))
  pg.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js"))
  pg.add_init_script(FORA); pg.add_init_script(PREP)
  pg.goto(U + "#/painel"); pg.wait_for_timeout(2500)

  # ---------- previsão do tempo: hora de agora e mini calendário de 7 dias (item 3.6)
  chk(T("tempo: temperatura, hora de agora e o dia por extenso"), pg.locator(".clima").count() == 1
      and "27" in pg.inner_text(".clima-t") and pg.locator(".clima-relogio b").count() == 1
      and ":" in pg.inner_text(".clima-relogio b") and "de" in pg.inner_text(".clima-relogio span"), pg.inner_text(".clima-relogio"))
  chk(T("tempo: mini calendário da semana com 7 dias, o de hoje marcado e o nome do tempo escrito"),
      pg.locator(".clima-cal .clima-dia").count() == 7 and pg.locator(".clima-dia.clima-hoje").count() == 1
      and "Hoje" in pg.inner_text(".clima-dia.clima-hoje") and "Chuva" in pg.inner_text(".clima-cal"), pg.inner_text(".clima-cal")[:200])
  chk(T("tempo: link para a previsão completa"), pg.locator(".clima-link").count() == 1
      and pg.locator(".clima-link").get_attribute("target") == "_blank")

  # ---------- notícias por prioridade (item 3.3)
  chk(T("notícias: três grupos na ordem cidade, estado e país"), [x.get_attribute("data-grupo") for x in pg.locator(".noticias .not-grupo").all()] == ["cidade", "estado", "pais"],
      [x.get_attribute("data-grupo") for x in pg.locator(".noticias .not-grupo").all()])
  chk(T("notícias: o nome do grupo escrito e a manchete com link que abre fora"), "Colatina" in pg.inner_text(".not-grupo[data-grupo=cidade]")
      and "BR-259" in pg.inner_text(".not-grupo[data-grupo=cidade]")
      and pg.locator(".not-grupo[data-grupo=cidade] a").first.get_attribute("target") == "_blank", pg.inner_text(".noticias")[:300])
  chk(T("notícias: o filtro começa desligado e mostra tudo"), pg.locator("#not-filtro").count() == 1
      and not pg.is_checked("#not-filtro") and "amistoso" in pg.inner_text(".noticias").lower())
  pg.check("#not-filtro"); pg.wait_for_timeout(400)
  texto = pg.inner_text(".noticias").lower()
  chk(T("filtro ligado: fica o que afeta a oficina (obra na BR, diesel, imposto) e sai o resto"),
      "br-259" in texto and "diesel" in texto and "imposto" in texto and "amistoso" not in texto and "exposição de arte" not in texto, texto[:400])
  pg.reload(); pg.wait_for_timeout(2500)
  chk(T("o filtro continua ligado depois de recarregar"), pg.is_checked("#not-filtro"))
  pg.uncheck("#not-filtro"); pg.wait_for_timeout(300)

  # ---------- dólar e outras moedas (item 3.2)
  chk(T("dólar: valor grande, variação escrita (não só a cor) e a hora da cotação"), pg.locator(".moedas").count() == 1
      and "5,4321" in pg.inner_text(".moedas-v") and "Subiu" in pg.inner_text(".moedas-var") and "0,85%" in pg.inner_text(".moedas-var")
      and "Atualizado em" in pg.inner_text(".moedas"), pg.inner_text(".moedas")[:300])
  chk(T("dólar: as outras moedas ficam na lista ao lado"), pg.locator(".moedas-item").count() == 5
      and "Euro" in pg.inner_text(".moedas-lista") and "Bitcoin" in pg.inner_text(".moedas-lista"))
  pg.click(".moedas-item:has-text('Euro')"); pg.wait_for_timeout(400)
  chk(T("escolhendo outra moeda, ela passa a ser a grande e a variação acompanha"), "Euro hoje" in pg.inner_text(".moedas-nome")
      and "5,9100" in pg.inner_text(".moedas-v") and "Caiu" in pg.inner_text(".moedas-var"), pg.inner_text(".moedas")[:200])
  pg.reload(); pg.wait_for_timeout(2500)
  chk(T("a moeda escolhida continua escolhida depois de recarregar"), "Euro hoje" in pg.inner_text(".moedas-nome"))
  pg.click(".moedas-item:has-text('Dólar')"); pg.wait_for_timeout(300)
  chk(T("dólar: link para conferir a cotação fora"), pg.locator(".moedas-link").get_attribute("target") == "_blank")

  # ---------- e-mails recebidos, por prioridade (item 3.4)
  chk(T("e-mails: três grupos na ordem contabilidade, Objetiva e outros"),
      [x.get_attribute("data-grupo") for x in pg.locator(".emails .not-grupo").all()] == ["contabilidade", "objetiva", "outros"],
      [x.get_attribute("data-grupo") for x in pg.locator(".emails .not-grupo").all()])
  chk(T("e-mails: assunto, quem mandou e a pendência que o robô achou"), "DAS de novembro" in pg.inner_text(".not-grupo[data-grupo=contabilidade]")
      and "Loredo" in pg.inner_text(".not-grupo[data-grupo=contabilidade]") and "NF fora do sistema" in pg.inner_text(".not-grupo[data-grupo=objetiva]"),
      pg.inner_text(".emails")[:300])
  pg.click(".emails-link"); pg.wait_for_timeout(900)
  chk(T("e-mails: o link abre a caixa de e-mail dentro do sistema"), "/email" in pg.evaluate("location.hash"), pg.evaluate("location.hash"))
  pg.goto(U + "#/painel"); pg.wait_for_timeout(2200)
  pg.locator(".email-item").first.click(); pg.wait_for_timeout(900)
  chk(T("e-mails: clicar num e-mail também leva para a caixa"), "/email" in pg.evaluate("location.hash"))
  pg.goto(U + "#/painel"); pg.wait_for_timeout(2200)

  chk(T("nenhuma das janelas ficou em Carregando e não há rolagem lateral"),
      "Buscando" not in pg.inner_text(".clima") and "Lendo os e-mails" not in pg.inner_text("main")
      and pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))
  pg.screenshot(path=os.path.join(TMP, "painel_casa_" + nome + ".png"), full_page=(w > 900))
  pg.close()

with sync_playwright() as p:
  b = p.chromium.launch()
  rodar(b, "pc", 1366, 768); rodar(b, "celular", 390, 844)
  b.close()
srv.terminate()
for f in falhas: print("FALHOU:", f)
for e in erros: print("ERRO JS:", e)
print(len(ok), "ok,", len(falhas), "falhas,", len(erros), "erros de página. Fotos em", TMP)
sys.exit(1 if falhas or erros else 0)
