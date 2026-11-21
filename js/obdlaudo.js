/**
 * O LAUDO DO CARRO: o estado do carro num momento, congelado e selado. (Etapa 3, frente 5.)
 *
 * Serve para o que acontece toda semana na oficina: registrar em que estado o carro ENTROU (ou
 * saiu), de um jeito que ninguém altera depois — nem nós. O conteúdo vai para a tabela
 * obd_leituras (tipo 'laudo'), que não tem alteração, junto com um SHA-256 dele (js/obdregistro.js).
 *
 * Aqui só se MONTA o conteúdo e o texto. Nada é interpretado: o laudo diz o que o carro respondeu
 * e em que condição a leitura foi feita. Não dá veredito de peça.
 */
const dataBR = iso => { const d = new Date(iso); const p = n => String(n).padStart(2, "0"); return p(d.getDate()) + "/" + p(d.getMonth() + 1) + "/" + d.getFullYear() + " " + p(d.getHours()) + ":" + p(d.getMinutes()); };

/** O conteúdo que é selado. Tudo o que entra aqui entra no selo. */
export function montar({ carro = {}, quem = {}, oficina = "", km = null, conferencia = null, modulos = [], falhasJuntas = [], monitores = null, odometro = null, leituras = [], explicacoes = {}, erros = [], obs = "", em = new Date().toISOString() } = {}) {
  const falha = f => { const e = explicacoes[String(f.codigo || "").split("-")[0]] || {}; return { codigo: f.rotulo || f.codigo, situacao: f.situacaoTexto || f.situacao || "", descricao: e.descricao || "", origem: e.achou ? e.origem : "" }; };
  return {
    versao: 1, em, oficina,
    quem: { id: quem.id || null, nome: quem.nome || "" },
    carro: { placa: String(carro.placa || "").toUpperCase(), marca: carro.marca || "", modelo: carro.modelo || "", ano: String(carro.ano || ""), vin: carro.vin || "" },
    km: Number(km) > 0 ? Math.round(Number(km)) : null,
    conferencia: conferencia ? { situacao: conferencia.situacao, frase: conferencia.frase, itens: conferencia.itens.map(i => ({ titulo: i.titulo, situacao: i.situacao, texto: i.texto })) } : null,
    modulos: modulos.map(m => ({ nome: m.nome || m.endereco || m.pedido || "", endereco: m.pedido || m.endereco || "", falhas: (m.falhas || []).map(falha) })),
    falhas: falhasJuntas.map(falha),
    // o que NÃO deu para ler entra no conteúdo selado: laudo que esconde leitura que falhou afirma o que não sabe
    erros: (erros || []).map(e => ({ situacao: String(e.situacao || ""), erro: String(e.erro || "") })),
    monitores: monitores || null, odometro: odometro || null,
    leituras: leituras.map(l => ({ rotulo: l.rotulo, valor: l.valor, unidade: l.unidade || "" })),
    obs: String(obs || ""),
  };
}

/** Quantas falhas o laudo tem ao todo. */
export const totalDeFalhas = d => (d.modulos || []).reduce((n, m) => n + m.falhas.length, 0) + (d.falhas || []).length;

/** O laudo em linhas de texto: [{ t: "titulo"|"sub"|"linha"|"nota", x }]. A tela e o PDF usam as mesmas. */
export function linhas(d, selo) {
  const L = [], add = (t, x) => L.push({ t, x });
  add("titulo", "LAUDO DE DIAGNÓSTICO ELETRÔNICO");
  add("linha", [d.carro.marca, d.carro.modelo, d.carro.ano].filter(Boolean).join(" ") + (d.carro.placa ? " · placa " + d.carro.placa : ""));
  if (d.carro.vin) add("linha", "Chassi lido no módulo: " + d.carro.vin);
  add("linha", "Leitura feita em " + dataBR(d.em) + (d.quem.nome ? " por " + d.quem.nome : "") + (d.km ? " · " + d.km + " km" : ""));
  if (d.conferencia) {
    add("sub", "EM QUE CONDIÇÃO A LEITURA FOI FEITA");
    add("linha", d.conferencia.frase);
    for (const i of d.conferencia.itens) add("linha", i.titulo + ": " + i.texto);
  }
  const n = totalDeFalhas(d);
  add("sub", n ? "FALHAS GRAVADAS (" + n + ")" : "FALHAS GRAVADAS");
  const er = d.erros || [];
  for (const e of er) add("linha", "NÃO FOI LIDO: falhas na situação \"" + e.situacao + "\" (" + e.erro + ").");
  if (!n) add("linha", er.length ? "A leitura de falhas não foi concluída: este laudo NÃO afirma que o carro está sem falha." : "Nenhuma falha gravada nos módulos que responderam.");
  for (const m of d.modulos) {
    add("linha", (m.nome || "Módulo").toUpperCase() + (m.falhas.length ? "" : " — sem falha gravada"));
    for (const f of m.falhas) add("linha", "   " + f.codigo + (f.situacao ? " · " + f.situacao : "") + (f.descricao ? " — " + f.descricao : ""));
  }
  for (const f of d.falhas) add("linha", f.codigo + (f.situacao ? " · " + String(f.situacao).toUpperCase() : "") + (f.descricao ? " — " + f.descricao : ""));
  if (d.leituras.length) {
    add("sub", "LEITURAS NO MOMENTO");
    for (const l of d.leituras) add("linha", l.rotulo + ": " + String(l.valor).replace(".", ",") + (l.unidade ? " " + l.unidade : ""));
  }
  if (d.obs) { add("sub", "OBSERVAÇÕES"); add("linha", d.obs); }
  add("nota", "Este laudo registra o que os módulos do carro responderam no momento da leitura. Não é parecer sobre peça: a causa de cada código é investigada na oficina.");
  if (selo) add("nota", "Selo de integridade (SHA-256): " + selo);
  return L;
}
