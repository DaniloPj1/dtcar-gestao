// Financeiro › Boletos Sicredi — cobrança por arquivo (CNAB240 híbrido: boleto + QR Code Pix).
// Fluxo: escolher parcelas "Boleto" em Contas a receber → gerar o arquivo de remessa → enviar no internet banking
// (Cobrança › Transferir Arquivos) → no dia seguinte baixar o retorno (Cobrança › Arquivos de Retorno) e importar aqui.
// O retorno confirma o registro, traz o QR Code Pix e avisa os pagamentos, que viram recibo e baixa da parcela.
// Com a API do Sicredi (função "sicredi", cfg.cobranca.modo = "api"): o boleto é registrado na hora, já com o QR Code,
// e "Atualizar pagamentos" consulta cada boleto em aberto no banco (pago vira recibo e baixa da parcela).
// Tabelas boletos e boletos_arquivos do supabase/v28.sql.
import { html, useState, useEffect, useMemo } from "../lib.js";
import { api } from "../api.js";
import { useApp, Campo, Texto, Modal, Abas, Vazio } from "../ui.js";
import { reais, fmtData, fmtDataHora, hojeISO, arred, soDig, norm, numOS, linkWhats, fmtDoc } from "../util.js";
import { codigoBarras, linhaDigitavel, linhaFmt, nossoNumero, nossoNumeroFmt, conferirCarteira, conferirBoleto, montarRemessa, nomeRemessa,
  lerRetorno, ehLiquidacao, pixCopiaCola, textoCnab } from "../cnab.js";
import { pdfBoletos, nomePdf, codigoBeneficiario, ESPECIES } from "../boletopdf.js";
import { referenteOS } from "./recibos.js";
import { baixarParcela } from "./receber.js";

/** Carteira de cobrança: o que foi conferido no internet banking (03/11/2026) + o que o Danilo ajustar */
/** Só entram para emissão as parcelas criadas a partir desta data: as anteriores já têm boleto emitido fora (PicPay), decisão do Danilo em 04/11/2026 */
export const DESDE_PADRAO = "2026-11-04";
/** Referência que vai nas instruções do boleto (aparece para o cliente e no DDA): O.S., NF (quando houver) e parcela. Só caracteres aceitos pelo banco. */
export const refBoleto = (osNumero, parcela, parcelas, nf) => { const nfLimpa = String(nf || "").replace(/[^0-9A-Za-z/-]/g, "");
  if (!osNumero && !nfLimpa) return "";
  return "REF. " + [osNumero ? "O.S. " + osNumero : "", nfLimpa ? "NF " + nfLimpa : "", parcelas > 1 ? "PARCELA " + parcela + "/" + parcelas : ""].filter(Boolean).join(" - ").slice(0, 75); };
/** Parcela entra na emissão de boleto Sicredi? (criada a partir de cob.desde) */
export const parcelaNova = (p, cob) => !cob.desde || String(p.criado_em || "").slice(0, 10) >= cob.desde;
export const carteira = cfg => ({ cooperativa: "0523", posto: "16", beneficiario: "85453", conta: "85453", contaDv: "7", byte: 2,
  jurosMes: 0, multa: 0, especie: "03", chavePix: "", contaEntrada: "Sicredi", mensagem: "", modo: "arquivo", ambiente: "sandbox", desde: DESDE_PADRAO, ...(cfg.cobranca || {}), cnpj: cfg.cnpj, nome: cfg.nome });
/** Pela API, a chave Pix é do banco (não vai na remessa) */
export const faltaNaCarteira = cob => conferirCarteira(cob).filter(x => cob.modo !== "api" || !/Chave Pix/.test(x));
/** Pix copia e cola: a API devolve o código pronto; o arquivo de retorno traz só o endereço (URL) do QR Code */
export const emvDoBoleto = (b, cfg) => !b.qr_url ? "" : /^000201/.test(b.qr_url) ? b.qr_url : pixCopiaCola(b.qr_url, cfg.nome, cfg.cidade || "COLATINA");
/** Situação devolvida pela consulta da API → situação no sistema */
export function situacaoDaApi(s) {
  s = String(s || "").toUpperCase();
  if (s.startsWith("LIQUIDADO")) return { pago: true, forma: s === "LIQUIDADO PIX" ? "Pix" : "Boleto" };
  if (s === "BAIXADO POR SOLICITACAO") return { situacao: "baixado" };
  if (s === "REJEITADO") return { situacao: "rejeitado" };
  if (s.startsWith("EM CARTEIRA") || s === "VENCIDO") return { situacao: "registrado" };
  return { situacao: null };
}

const SIT = { gerado: ["Aguardando o banco", "info"], registrado: ["Registrado", "ok"], rejeitado: ["Rejeitado", "bad"], pago: ["Pago", "ok"],
  baixa_pedida: ["Baixa pedida", "warn"], baixado: ["Baixado", "muted"], enviado: ["Aguardando o banco", "info"] };
const ATIVOS = ["gerado", "enviado", "registrado", "baixa_pedida"];
/** Reserva do Claude (v41): a parcela foi separada para emitir pela API e a resposta do Sicredi não chegou. Não é boleto para pagar. */
export const ehReserva = b => b.situacao === "gerado" && !b.linha_digitavel && /^000/.test(String(b.nosso_numero || ""));
const pagadorDe = (c, o) => { c = c || {}; const oc = (o && o.cliente) || {};
  return { nome: c.nome || oc.nome || "", doc: soDig(c.doc || oc.doc), endereco: [c.rua, c.complemento].filter(Boolean).join(" ") || c.endereco || "",
    bairro: c.bairro || "", cep: soDig(c.cep), cidade: c.cidade || "", uf: (c.uf || "").toUpperCase() }; };
const baixar = (nome, conteudo, tipo = "text/plain") => { const u = URL.createObjectURL(new Blob([conteudo], { type: tipo })); const a = document.createElement("a");
  a.href = u; a.download = nome; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); };
async function sha256(texto) { const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto)); return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join(""); }
const empresa = cfg => ({ nome: cfg.nome, cnpj: cfg.cnpj, endereco: cfg.endereco, cidade: cfg.cidade || "COLATINA" });
export const msgBoleto = (b, cfg) => `Olá, ${(b.pagador_nome || "").split(" ")[0]}! Aqui é da ${cfg.nome}.\n\nSegue o boleto ${b.descricao ? "(" + b.descricao + ") " : ""}no valor de *${reais(b.valor)}* com vencimento em *${fmtData(b.vencimento)}*.\n\n` +
  `Linha digitável:\n${linhaFmt(b.linha_digitavel)}` + (b.qr_url ? `\n\nOu pague com Pix (copia e cola):\n${emvDoBoleto(b, cfg)}` : "") + `\n\nQualquer dúvida, estamos à disposição.`;

export function Boletos() {
  const { dados, cfg, perfil, avisar, confirmar, recarregar, ir } = useApp();
  const [aba, setAba] = useState("emitir"), [boletos, setBoletos] = useState(null), [arquivos, setArquivos] = useState([]), [erro, setErro] = useState("");
  const [nfs, setNfs] = useState({});
  const [marcadas, setMarcadas] = useState({}), [ocupado, setOcupado] = useState(""), [resultado, setResultado] = useState(null), [ajustes, setAjustes] = useState(false), [q, setQ] = useState("");
  const cob = carteira(cfg), faltaCarteira = faltaNaCarteira(cob), porApi = cob.modo === "api";
  const ler = async () => { try { const [b, a] = await Promise.all([api.boletos.listar(), api.boletos.arquivos.listar().catch(() => [])]); setBoletos(b); setArquivos(a); } catch (e) { setErro(e.message); } };
  useEffect(() => { recarregar(["receber", "clientes"]); ler(); }, []);

  const porParcela = useMemo(() => { const m = {}; (boletos || []).forEach(b => { if (b.receber_id && ATIVOS.concat("pago").includes(b.situacao)) m[b.receber_id] = b; }); return m; }, [boletos]);
  const emBoleto = (dados.receber || []).filter(p => p.status === "aberta" && p.forma === "Boleto" && !porParcela[p.id]);
  const candidatas = emBoleto.filter(p => parcelaNova(p, cob)).sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  const antigas = emBoleto.filter(p => !parcelaNova(p, cob));
  const montar = p => { const o = dados.ordens.find(x => x.id === p.ordem_id), c = dados.clientes.find(x => x.id === (p.cliente_id || (o && o.cliente_id)));
    const pg = pagadorDe(c, o), b = { valor: p.valor, vencimento: p.vencimento, nosso_numero: "000000000", pagador: pg };
    return { p, o, c, pg, problemas: conferirBoleto(b, hojeISO()).filter(x => x !== "Nosso Número") }; };
  const linhasEmitir = candidatas.map(montar);
  const escolhidas = linhasEmitir.filter(l => marcadas[l.p.id] && !l.problemas.length);

  if (api.temBoletos() === false) return html`<div class="pagina"><div class="aviso">O banco ainda não tem os boletos. Rode o arquivo <b>supabase/v28.sql</b> no SQL Editor do Supabase e recarregue a página.</div></div>`;

  /** Gera os boletos (reais, gravados) ou o arquivo de teste para o Portal de Homologação (nada é gravado) */
  const emitir = async teste => {
    if (faltaCarteira.length) { setAjustes(true); return setErro("Complete os dados da carteira: " + faltaCarteira.join(" ")); }
    if (!escolhidas.length) return setErro("Marque as parcelas que vão virar boleto.");
    if (!teste && !await confirmar({ titulo: "Registrar " + escolhidas.length + " boleto(s) no Sicredi", texto: (porApi ? "Os boletos são registrados no banco AGORA e aparecem no DDA do cliente." : "Os boletos ficam registrados no banco e aparecem no DDA do cliente assim que o arquivo for enviado.") + " Confira valores e vencimentos: " +
      escolhidas.map(l => l.pg.nome + " " + reais(l.p.valor) + " em " + fmtData(l.p.vencimento)).join("; ") + ".", botao: porApi ? "Registrar" : "Gerar arquivo" })) return;
    if (porApi && !teste) return emitirPelaApi();
    setOcupado(teste ? "teste" : "emitir"); setErro("");
    try {
      const ano = new Date().getFullYear(), hoje = hojeISO(), linhas = [];
      for (const [i, l] of escolhidas.entries()) {
        const seq = teste ? 90001 + i : await api.boletos.proximo("nosso_numero:" + ano);
        const nn = nossoNumero(cob, ano, seq), cb = codigoBarras(cob, nn, l.p.valor, l.p.vencimento);
        linhas.push({ receber_id: l.p.id, ordem_id: l.p.ordem_id || null, os_numero: l.o ? String(l.o.numero) : "", cliente_id: l.c ? l.c.id : l.p.cliente_id || null,
          pagador_nome: l.pg.nome, pagador_doc: l.pg.doc, pagador: l.pg, descricao: (l.o ? "O.S. " + l.o.numero : l.p.descricao) + (nfDe(l) ? " · NF " + nfDe(l) : "") + (l.p.parcelas > 1 ? " · parcela " + l.p.parcela + "/" + l.p.parcelas : ""),
          valor: Number(l.p.valor), vencimento: l.p.vencimento, emissao: hoje, nosso_numero: nn, seu_numero: ((l.o ? l.o.numero : "P") + "-" + l.p.parcela).slice(0, 10),
          codigo_barras: cb, linha_digitavel: linhaDigitavel(cb), situacao: "gerado", criado_por: perfil.nome });
      }
      const agora = new Date(), seqArq = teste ? 1 : await api.boletos.proximo("remessa");
      const conteudo = montarRemessa(cob, linhas.map(b => ({ ...b, movimento: "01", uso_empresa: b.seu_numero })), { sequencia: seqArq, data: agora });
      const noDia = arquivos.filter(a => a.tipo === "remessa" && (a.criado_em || "").slice(0, 10) === hoje).length + 1;
      const nome = nomeRemessa(cob, agora, teste ? 900 + noDia : noDia);
      if (teste) {
        baixar(nome, conteudo); pdfBoletos(linhas, cob, empresa(cfg)).save("boletos-teste-homologacao.pdf");
        avisar("Arquivo de teste e PDF baixados. Envie os dois no Portal de Homologação; nada foi registrado.");
      } else {
        // o arquivo fica guardado antes (dá para baixar de novo); os boletos entram ligados a ele numa só gravação
        const arq = await api.boletos.arquivos.salvar({ tipo: "remessa", nome, sequencia: seqArq, conteudo, resumo: { boletos: linhas.length, total: arred(linhas.reduce((s, b) => s + Number(b.valor), 0)) }, criado_por: perfil.nome });
        const gravados = await api.boletos.incluir(linhas.map(b => ({ ...b, remessa_id: arq.id })));
        for (const b of gravados) if (b.ordem_id) await api.evento(b.ordem_id, "boleto", "Boleto Sicredi gerado: " + reais(b.valor) + " para " + fmtData(b.vencimento) + " (nosso número " + nossoNumeroFmt(b.nosso_numero) + ").", perfil.nome).catch(() => {});
        baixar(nome, conteudo); setMarcadas({});
        setResultado({ titulo: "Arquivo de remessa gerado", linhas: ["Arquivo " + nome + " salvo na pasta de downloads (" + gravados.length + " boleto(s), " + reais(gravados.reduce((s, b) => s + Number(b.valor), 0)) + ").",
          "Agora entre no internet banking: Cobrança › Transferir Arquivos › Escolher arquivo › Avançar. Envie até as 19h30 para o banco ler no mesmo dia.",
          "Amanhã, baixe o retorno em Cobrança › Arquivos de Retorno e importe aqui. O QR Code Pix chega no retorno; antes dele o PDF sai só com o código de barras."] });
        await ler();
      }
    } catch (e) { setErro(e.message); } finally { setOcupado(""); }
  };

  const nfDe = l => String(nfs[l.p.id] || "").trim();
  /** Dados do boleto a partir da parcela marcada (os mesmos pela API e pelo arquivo) */
  const dadosDaParcela = l => ({ receber_id: l.p.id, ordem_id: l.p.ordem_id || null, os_numero: l.o ? String(l.o.numero) : "", cliente_id: l.c ? l.c.id : l.p.cliente_id || null,
    pagador_nome: l.pg.nome, pagador_doc: l.pg.doc, pagador: l.pg, descricao: (l.o ? "O.S. " + l.o.numero : l.p.descricao) + (nfDe(l) ? " · NF " + nfDe(l) : "") + (l.p.parcelas > 1 ? " · parcela " + l.p.parcela + "/" + l.p.parcelas : ""),
    valor: Number(l.p.valor), vencimento: l.p.vencimento, emissao: hojeISO(), seu_numero: ((l.o ? l.o.numero : "P") + "-" + l.p.parcela).slice(0, 10), criado_por: perfil.nome });

  /** Pela API: registra um boleto de cada vez e grava logo em seguida (se a gravação falhar, a linha digitável aparece na tela) */
  const emitirPelaApi = async () => {
    if (cob.ambiente !== "producao") return setErro("A API está no ambiente de teste (Sandbox). Use \"Testar ligação\" em Dados da carteira; para emitir boletos de verdade, troque para Produção.");
    setOcupado("emitir"); setErro("");
    const log = [];
    try {
      for (const l of escolhidas) {
        const d = dadosDaParcela(l), ref = refBoleto(d.os_numero, l.p.parcela, l.p.parcelas, nfDe(l));
        const r = await api.sicredi({ acao: "emitir", ambiente: "producao", boleto: { mensagem: [ref, cob.mensagem].filter(Boolean).join(" - ").slice(0, 80), valor: d.valor, vencimento: d.vencimento, seu_numero: d.seu_numero, especie: cob.especie,
          juros_mes: cob.jurosMes, multa: cob.multa, id_titulo: d.receber_id, pagador: { ...l.pg, telefone: (l.c && l.c.telefone) || "" } } });
        try {
          const [g] = await api.boletos.incluir([{ ...d, nosso_numero: r.nossoNumero, codigo_barras: r.codigoBarras, linha_digitavel: r.linhaDigitavel, qr_url: r.qrCode || "", txid: r.txid || "",
            situacao: "registrado", ocorrencia: r.qrCode ? "Registrado pela API com QR Code Pix" : "Registrado pela API SEM QR Code — confira o boleto híbrido no Portal PJ" }]);
          if (g.ordem_id) await api.evento(g.ordem_id, "boleto", "Boleto Sicredi registrado: " + reais(g.valor) + " para " + fmtData(g.vencimento) + " (nosso número " + nossoNumeroFmt(g.nosso_numero) + ").", perfil.nome).catch(() => {});
          log.push(["ok", d.pagador_nome + " " + reais(d.valor) + ": registrado, nosso número " + nossoNumeroFmt(r.nossoNumero) + (r.qrCode ? ", com Pix." : ", SEM QR Code Pix.")]);
        } catch (e) {
          log.push(["bad", d.pagador_nome + " " + reais(d.valor) + ": REGISTRADO NO BANCO, mas não foi gravado aqui (" + e.message + "). Anote: nosso número " + r.nossoNumero + ", linha " + linhaFmt(r.linhaDigitavel) + "."]);
          break;
        }
      }
    } catch (e) { log.push(["bad", "Parou: " + e.message]); }
    setMarcadas({}); setResultado({ titulo: "Boletos pela API do Sicredi", linhas: log }); setOcupado(""); await ler();
  };

  /** Pagamento confirmado pelo banco (retorno ou API): recibo na conta da carteira, baixa da parcela e histórico. Nunca duas vezes. */
  const registrarPagamento = async (b, { valorPago, valorLiquido, data, dataCredito, forma, ocorrencia, patch = {} }) => {
    const quem = b.pagador_nome + " " + reais(b.valor), conta = cob.contaEntrada || "Sicredi";
    const reservado = await api.boletos.reservarPagamento(b.id, { ...patch, valor_pago: valorPago, valor_liquido: valorLiquido || null, data_pagamento: data, data_credito: dataCredito || null, forma_pagamento: forma, ocorrencia });
    if (!reservado) return ["muted", quem + ": pagamento já registrado antes."];
    const parcela = b.receber_id ? await api.receber.um(b.receber_id).catch(() => null) : null;
    if (parcela && parcela.status !== "aberta") { await api.boletos.atualizar(b.id, { ocorrencia: "Pago no banco, mas a parcela já estava recebida no sistema: confira se não há recibo em dobro." });
      return ["warn", quem + ": pago no banco (" + forma + ", " + fmtData(data) + "), mas a parcela já estava baixada no sistema. Nenhum recibo novo foi feito — confira."]; }
    try {
      const o = dados.ordens.find(x => x.id === b.ordem_id);
      const rec = await api.recibos.salvar({ ordem_id: b.ordem_id || null, cliente_id: b.cliente_id || null, pagador: b.pagador_nome, doc: b.pagador_doc, valor: valorPago,
        referente: (o ? referenteOS(o) : "pagamento") + (parcela && parcela.parcelas > 1 ? " (parcela " + parcela.parcela + "/" + parcela.parcelas + ")" : ""), forma, conta_destino: conta, data,
        obs: "Boleto Sicredi " + nossoNumeroFmt(b.nosso_numero) + (valorPago > Number(b.valor) + 0.009 ? "; inclui " + reais(valorPago - b.valor) + " de juros/multa" : "") + ".", emitido_por: perfil.nome });
      if (parcela) await baixarParcela(parcela, Math.min(valorPago, Number(parcela.valor)), rec, perfil);
      await api.boletos.atualizar(b.id, { recibo_id: rec.id });
      if (b.ordem_id) await api.evento(b.ordem_id, "recibo", "Boleto Sicredi pago (" + forma + "): " + reais(valorPago) + " em " + fmtData(data) + ".", perfil.nome).catch(() => {});
      return ["ok", quem + ": pago por " + forma + " em " + fmtData(data) + " (" + reais(valorPago) + "). Recibo emitido e parcela baixada."];
    } catch (e) { await api.boletos.atualizar(b.id, { situacao: b.situacao, ocorrencia: "Falha ao registrar o pagamento: " + e.message }).catch(() => {}); throw e; }
  };

  /** Pela API: consulta no banco cada boleto em aberto registrado pela API */
  const atualizarPelaApi = async () => {
    if (cob.ambiente !== "producao") return setErro("A API está no ambiente de teste (Sandbox): não há boletos de verdade para consultar.");
    const lista = (boletos || []).filter(b => !b.remessa_id && ["registrado", "baixa_pedida"].includes(b.situacao));
    if (!lista.length) return setResultado({ titulo: "Atualizar pagamentos", linhas: [["muted", "Nenhum boleto da API em aberto."]] });
    setOcupado("atualizar"); setErro("");
    const log = [];
    try {
      for (const b of lista) {
        const r = await api.sicredi({ acao: "consultar", ambiente: "producao", nosso_numero: b.nosso_numero });
        const s = situacaoDaApi(r.situacao), quem = b.pagador_nome + " " + reais(b.valor);
        if (s.pago) {
          const liq = r.dadosLiquidacao || {};
          log.push(await registrarPagamento(b, { valorPago: Number(liq.valor) || Number(b.valor), data: (liq.data || hojeISO()).slice(0, 10), dataCredito: r.dataPrevisaoPagamento || null, forma: s.forma, ocorrencia: "Situação no banco: " + r.situacao }));
        } else if (s.situacao && s.situacao !== b.situacao) { await api.boletos.atualizar(b.id, { situacao: s.situacao, ocorrencia: "Situação no banco: " + r.situacao }); log.push([s.situacao === "rejeitado" ? "bad" : "ok", quem + ": " + r.situacao + "."]); }
        else if (!s.situacao) { await api.boletos.atualizar(b.id, { ocorrencia: "Situação no banco: " + r.situacao }); log.push(["warn", quem + ": " + r.situacao + "."]); }
      }
      if (!log.length) log.push(["muted", "Nenhum pagamento novo. " + lista.length + " boleto(s) continuam em aberto no banco."]);
    } catch (e) { log.push(["bad", "Parou: " + e.message]); }
    setResultado({ titulo: "Atualizar pagamentos (API do Sicredi)", linhas: log }); setOcupado("");
    await recarregar(["receber", "ordens"]); await ler();
  };

  /** Lê o arquivo de retorno e aplica cada ocorrência */
  const importar = async arquivo => {
    if (!arquivo) return;
    setOcupado("retorno"); setErro("");
    try {
      const texto = await arquivo.text(), hash = await sha256(texto), ja = await api.boletos.arquivos.porHash(hash);
      if (ja) throw new Error("Este retorno já foi importado em " + fmtDataHora(ja.criado_em) + " (" + ja.nome + ").");
      const ret = lerRetorno(texto);
      if (soDig(ret.cabecalho.cnpj) && soDig(cfg.cnpj) && soDig(ret.cabecalho.cnpj).padStart(14, "0") !== soDig(cfg.cnpj).padStart(14, "0")) throw new Error("O retorno é de outro CNPJ (" + fmtDoc(ret.cabecalho.cnpj) + ").");
      const meus = await api.boletos.porNossoNumero([...new Set(ret.titulos.map(t => t.nosso_numero))]);
      const mapa = Object.fromEntries(meus.map(b => [b.nosso_numero, b])), log = [];
      for (const t of ret.titulos) {
        const b = mapa[t.nosso_numero];
        if (!b) { log.push(["warn", nossoNumeroFmt(t.nosso_numero) + ": " + t.descricao + " — boleto não encontrado no sistema."]); continue; }
        const quem = b.pagador_nome + " " + reais(b.valor);
        const patch = {}; if (t.qr_url) patch.qr_url = t.qr_url; if (t.txid) patch.txid = t.txid; if (t.tarifa) patch.tarifa = arred(Number(b.tarifa || 0) + t.tarifa);
        const msg = t.descricao + (t.motivos.length ? ": " + t.motivos.join(", ") : "") + (t.qr_situacao ? " (" + t.qr_situacao + ")" : "");
        if (ehLiquidacao(t.movimento)) {
          log.push(await registrarPagamento(b, { valorPago: t.valor_pago || b.valor, valorLiquido: t.valor_liquido, data: t.data_ocorrencia || hojeISO(), dataCredito: t.data_credito,
            forma: t.movimento === "61" ? "Pix" : "Boleto", ocorrencia: msg, patch }));
          continue;
        }
        if (t.movimento === "02") { if (["gerado", "enviado"].includes(b.situacao)) patch.situacao = "registrado"; }
        else if (t.movimento === "03") { if (b.situacao !== "pago") patch.situacao = "rejeitado"; }
        else if (t.movimento === "09") { if (b.situacao !== "pago") patch.situacao = "baixado"; }
        else if (["P1", "P2"].includes(t.movimento) && ["gerado", "enviado"].includes(b.situacao)) patch.situacao = "registrado";
        if (t.movimento !== "28") patch.ocorrencia = msg;
        await api.boletos.atualizar(b.id, patch);
        log.push([t.movimento === "03" || t.movimento === "26" || t.movimento === "30" ? "bad" : "ok", quem + ": " + msg + (t.movimento === "28" ? " (" + reais(t.tarifa) + ")" : "") + "."]);
      }
      await api.boletos.arquivos.salvar({ tipo: "retorno", nome: arquivo.name, sequencia: ret.cabecalho.sequencia, hash, conteudo: texto, resumo: { titulos: ret.titulos.length }, criado_por: perfil.nome });
      setResultado({ titulo: "Retorno importado: " + arquivo.name, linhas: log.length ? log : [["muted", "O arquivo não tinha ocorrências."]] });
      await recarregar(["receber", "ordens"]); await ler();
    } catch (e) { setErro(e.message); } finally { setOcupado(""); }
  };

  const pedirBaixa = async b => {
    if (!b.remessa_id && cob.modo === "api") {
      if (!await confirmar({ titulo: "Pedir baixa do boleto", texto: "Pede ao Sicredi, pela API, para cancelar o boleto de " + b.pagador_nome + " (" + reais(b.valor) + "). Depois disso ele não pode mais ser pago. A parcela continua em aberto em Contas a receber.", botao: "Pedir baixa", perigo: true })) return;
      setOcupado("baixa"); setErro("");
      try { await api.sicredi({ acao: "baixar", ambiente: "producao", nosso_numero: b.nosso_numero }); await api.boletos.atualizar(b.id, { situacao: "baixa_pedida", ocorrencia: "Baixa pedida pela API em " + fmtDataHora(new Date().toISOString()) });
        avisar("Baixa pedida ao Sicredi. Em \"Atualizar pagamentos\" o boleto passa para Baixado."); await ler(); }
      catch (e) { setErro(e.message); } finally { setOcupado(""); }
      return;
    }
    if (!await confirmar({ titulo: "Pedir baixa do boleto", texto: "Gera um arquivo pedindo ao Sicredi para cancelar o boleto de " + b.pagador_nome + " (" + reais(b.valor) + "). Depois de enviar o arquivo, o boleto não pode mais ser pago. A parcela continua em aberto em Contas a receber.", botao: "Gerar arquivo de baixa", perigo: true })) return;
    setOcupado("baixa"); setErro("");
    try {
      const agora = new Date(), seq = await api.boletos.proximo("remessa");
      const conteudo = montarRemessa(cob, [{ ...b, movimento: "02" }], { sequencia: seq, data: agora });
      const noDia = arquivos.filter(a => a.tipo === "remessa" && (a.criado_em || "").slice(0, 10) === hojeISO()).length + 1, nome = nomeRemessa(cob, agora, noDia);
      await api.boletos.arquivos.salvar({ tipo: "remessa", nome, sequencia: seq, conteudo, resumo: { baixa: 1 }, criado_por: perfil.nome });
      await api.boletos.atualizar(b.id, { situacao: "baixa_pedida", ocorrencia: "Baixa pedida no arquivo " + nome });
      baixar(nome, conteudo); avisar("Arquivo de baixa baixado. Envie no internet banking (Cobrança › Transferir Arquivos)."); await ler();
    } catch (e) { setErro(e.message); } finally { setOcupado(""); }
  };
  const tel = b => { const c = dados.clientes.find(x => x.id === b.cliente_id); return (c && c.telefone) || ""; };

  const lista = (boletos || []).filter(b => !q || norm(b.pagador_nome).includes(norm(q)) || String(b.os_numero).includes(q) || b.nosso_numero.includes(soDig(q)));
  const grupos = { abertos: lista.filter(b => ATIVOS.includes(b.situacao)), pagos: lista.filter(b => b.situacao === "pago"), outros: lista.filter(b => ["rejeitado", "baixado"].includes(b.situacao)) };
  const soma = l => l.reduce((s, b) => s + Number(b.valor), 0);
  const liberarReserva = async b => {
    if (!await confirmar({ titulo: "Liberar a reserva", texto: "Só libere depois de conferir no Portal PJ do Sicredi que este boleto NÃO foi registrado (" + b.pagador_nome + ", " + reais(b.valor) + ", vencimento " + fmtData(b.vencimento) + "). A parcela volta a poder receber boleto.", botao: "Liberar", perigo: true })) return;
    try { await api.boletos.atualizar(b.id, { situacao: "rejeitado", ocorrencia: "Reserva do Claude liberada por " + perfil.nome + " em " + fmtDataHora(new Date().toISOString()) + ": não estava no banco." }); avisar("Reserva liberada."); await ler(); }
    catch (e) { setErro(e.message); }
  };
  const linhaBoleto = b => { if (ehReserva(b)) return html`<div class="linha conta-linha" key=${b.id}>
      <span class="meio"><strong>${b.pagador_nome}</strong><span>${[b.descricao, "venc. " + fmtData(b.vencimento), b.ocorrencia].filter(Boolean).join(" · ")}</span></span>
      <span class="dir"><b>${reais(b.valor)}</b><span class="pill p-warn">Reservado pelo Claude · sem resposta do banco</span></span>
      <span class="rec-acoes"><button type="button" class="btn btn-sm" onClick=${() => liberarReserva(b)}>Liberar reserva</button>
        ${b.ordem_id ? html`<button type="button" class="btn btn-sm" onClick=${() => ir("/os/" + b.ordem_id)}>O.S.</button>` : null}</span></div>`;
    const [rot, cor] = SIT[b.situacao] || [b.situacao, "muted"], t = tel(b);
    return html`<div class="linha conta-linha" key=${b.id}>
      <span class="meio"><strong>${b.pagador_nome}</strong><span>${[b.descricao, "venc. " + fmtData(b.vencimento), "nº " + nossoNumeroFmt(b.nosso_numero), b.situacao === "pago" ? "pago " + fmtData(b.data_pagamento) + " (" + b.forma_pagamento + ")" : "", b.ocorrencia].filter(Boolean).join(" · ")}</span></span>
      <span class="dir"><b>${reais(b.situacao === "pago" && b.valor_pago ? b.valor_pago : b.valor)}</b><span class=${"pill p-" + cor}>${rot}${b.qr_url && b.situacao !== "pago" ? " · com Pix" : ""}</span></span>
      <span class="rec-acoes">
        ${b.situacao !== "rejeitado" ? html`<button type="button" class="btn btn-sm" onClick=${() => pdfBoletos([b], cob, empresa(cfg)).save(nomePdf(b))}>PDF</button>` : null}
        ${ATIVOS.includes(b.situacao) ? html`<button type="button" class="btn btn-sm" onClick=${() => { navigator.clipboard && navigator.clipboard.writeText(b.linha_digitavel); avisar("Linha digitável copiada."); }}>Copiar linha</button>` : null}
        ${t && ATIVOS.includes(b.situacao) ? html`<a class="btn btn-sm" href=${linkWhats(t, msgBoleto(b, cfg))} target="_blank" rel="noopener">WhatsApp</a>` : null}
        ${["registrado", "gerado", "enviado"].includes(b.situacao) ? html`<button type="button" class="btn btn-sm" disabled=${!!ocupado} onClick=${() => pedirBaixa(b)}>Pedir baixa</button>` : null}
        ${b.ordem_id ? html`<button type="button" class="btn btn-sm" onClick=${() => ir("/os/" + b.ordem_id)}>O.S.</button>` : null}</span></div>`; };

  return html`<div class="pagina larga-media financeiro">
    <div class="painel-topo"><div><h1>Boletos Sicredi</h1><span class="sub">Boleto com QR Code Pix · carteira ${codigoBeneficiario(cob)} · ${porApi ? "API do Sicredi (" + (cob.ambiente === "producao" ? "produção" : "ambiente de teste") + ")" : "arquivo de remessa e retorno"}</span></div>
      <span class="rec-acoes">${porApi ? html`<button type="button" class="btn" disabled=${!!ocupado} onClick=${atualizarPelaApi}>${ocupado === "atualizar" ? "Consultando…" : "Atualizar pagamentos"}</button>` : null}
      <button type="button" class="btn" onClick=${() => setAjustes(true)}>Dados da carteira</button></span></div>
    ${cfg.espelhoLegado !== false ? html`<div class="aviso">Período de transição: só gere boletos reais depois da virada. Até lá, use ${porApi ? html`o <b>Testar ligação</b> (Dados da carteira)` : html`o <b>arquivo de teste</b>`} para os testes.</div>` : null}
    ${porApi && cob.ambiente !== "producao" ? html`<div class="aviso">A API está no <b>ambiente de teste do Sicredi (Sandbox)</b>: dá para testar a ligação, mas nenhum boleto de verdade é registrado. Troque para Produção em Dados da carteira quando o Sicredi liberar.</div>` : null}
    ${faltaCarteira.length ? html`<div class="aviso">Falta completar a carteira: ${faltaCarteira.join(" ")} <button type="button" class="btn-link" onClick=${() => setAjustes(true)}>Completar</button></div>` : null}
    <div class="kpis fin-kpis">
      <div class="kpi"><span>Para emitir</span><b class="kpi-din">${reais(candidatas.reduce((s, p) => s + Number(p.valor), 0))}</b><small>${candidatas.length} parcela(s) "Boleto"</small></div>
      <div class="kpi"><span>Aguardando o banco</span><b class="kpi-din">${reais(soma(grupos.abertos.filter(b => b.situacao !== "registrado")))}</b><small>${grupos.abertos.filter(b => b.situacao !== "registrado").length} boleto(s)</small></div>
      <div class="kpi"><span>Registrados em aberto</span><b class="kpi-din">${reais(soma(grupos.abertos.filter(b => b.situacao === "registrado")))}</b><small>${grupos.abertos.filter(b => b.situacao === "registrado").length} boleto(s)</small></div>
      <div class=${"kpi" + (grupos.outros.filter(b => b.situacao === "rejeitado").length ? " kpi-alerta" : "")}><span>Rejeitados</span><b class="kpi-din">${grupos.outros.filter(b => b.situacao === "rejeitado").length}</b><small>corrija e emita de novo</small></div>
    </div>
    ${erro ? html`<div class="erros">${erro}</div>` : null}
    <section class="card">
      <${Abas} abas=${[["emitir", "Emitir (" + candidatas.length + ")"], ["abertos", "Em aberto (" + grupos.abertos.length + ")"], ["pagos", "Pagos"], ["outros", "Rejeitados e baixados"], ["arquivos", "Retorno e arquivos"]]} ativa=${aba} onTroca=${setAba} />
      ${aba === "emitir" ? html`<div>
        <p class="sub" style=${{ margin: "12px 0" }}>Parcelas em aberto combinadas como <b>Boleto</b> em Contas a receber. O cliente precisa ter CPF/CNPJ e endereço completo com CEP.</p>
        ${antigas.length ? html`<p class="sub" style=${{ margin: "0 0 12px" }}>${antigas.length} parcela(s) de antes de ${fmtData(cob.desde)} (${reais(antigas.reduce((s, p) => s + Number(p.valor || 0), 0))}) não aparecem aqui: o boleto delas já foi emitido fora (PicPay). Elas continuam em Contas a receber.</p>` : null}
        ${linhasEmitir.length ? html`<div class="lista">${linhasEmitir.map(l => html`<label class=${"linha conta-linha" + (l.problemas.length ? " s-vencida" : "")} key=${l.p.id}>
            <input type="checkbox" disabled=${!!l.problemas.length} checked=${!!marcadas[l.p.id]} onChange=${e => setMarcadas({ ...marcadas, [l.p.id]: e.target.checked })} />
            <span class="meio"><strong>${l.pg.nome || l.p.cliente_nome}</strong><span>${[l.p.descricao, l.p.parcelas > 1 ? "parcela " + l.p.parcela + "/" + l.p.parcelas : "", "venc. " + fmtData(l.p.vencimento)].filter(Boolean).join(" · ")}</span>
              ${l.problemas.length ? null : html`<span class="sub" onClick=${e => e.preventDefault()}>Nº da NF (opcional): <input class="nf-boleto" inputmode="numeric" maxlength="12" style=${{ width: "7em" }} value=${nfs[l.p.id] || ""} onInput=${e => setNfs({ ...nfs, [l.p.id]: e.target.value })} /></span>`}
              ${l.problemas.length ? html`<span class="c-bad">Falta no cadastro: ${l.problemas.join(", ")}. ${l.c ? html`<button type="button" class="btn-link" onClick=${e => { e.preventDefault(); ir("/cliente/" + l.c.id); }}>Abrir cliente</button>` : null}</span>` : null}</span>
            <span class="dir"><b>${reais(l.p.valor)}</b></span></label>`)}</div>
          <div class="acoes"><span class="sub">${escolhidas.length} marcada(s) · ${reais(escolhidas.reduce((s, l) => s + Number(l.p.valor), 0))}</span><span class="espaco"></span>
            ${porApi ? null : html`<button type="button" class="btn" disabled=${!!ocupado} onClick=${() => emitir(true)}>${ocupado === "teste" ? "Gerando…" : "Arquivo de teste (homologação)"}</button>`}
            <button type="button" class="btn btn-pri" disabled=${!!ocupado || cfg.espelhoLegado !== false || (porApi && cob.ambiente !== "producao")} onClick=${() => emitir(false)}>${ocupado === "emitir" ? (porApi ? "Registrando…" : "Gerando…") : porApi ? "Registrar no Sicredi" : "Gerar remessa"}</button></div>`
          : html`<${Vazio}>Nenhuma parcela "Boleto" para emitir. Ao entregar uma O.S. com pagamento a prazo, escolha a forma Boleto.</${Vazio}>`}
      </div>` : aba === "arquivos" ? html`<div>
        <div class="card-sub" style=${{ margin: "12px 0" }}><h4>Importar retorno do banco</h4>
          <p class="sub">No internet banking: Cobrança › Arquivos de Retorno › baixe o arquivo .CRT do dia. Depois escolha o arquivo aqui. O mesmo arquivo nunca é lido duas vezes.</p>
          <input type="file" accept=".crt,.CRT,.r01,.R01,.txt,.ret" disabled=${!!ocupado} onChange=${e => { importar(e.target.files[0]); e.target.value = ""; }} />${ocupado === "retorno" ? html` <span class="sub">Lendo…</span>` : null}</div>
        <h4>Arquivos</h4>
        ${arquivos.length ? html`<div class="lista">${arquivos.map(a => html`<div class="linha conta-linha" key=${a.id}><span class="meio"><strong>${a.tipo === "remessa" ? "Remessa" : "Retorno"} ${a.nome}</strong>
            <span>${fmtDataHora(a.criado_em)} · ${a.criado_por}${a.sequencia ? " · nº " + a.sequencia : ""}${a.resumo && a.resumo.boletos ? " · " + a.resumo.boletos + " boleto(s)" : ""}${a.resumo && a.resumo.titulos ? " · " + a.resumo.titulos + " ocorrência(s)" : ""}${a.resumo && a.resumo.baixa ? " · pedido de baixa" : ""}</span></span>
            ${a.tipo === "remessa" ? html`<span class="rec-acoes"><button type="button" class="btn btn-sm" onClick=${async () => { const x = await api.boletos.arquivos.um(a.id); baixar(x.nome, x.conteudo); }}>Baixar de novo</button></span>` : null}</div>`)}</div>`
          : html`<${Vazio}>Nenhum arquivo ainda.</${Vazio}>`}
      </div>` : html`<div>
        <div class="fin-sel" style=${{ margin: "12px 0" }}><label class="filtro fin-busca"><span>Buscar</span><input class="inp" type="search" placeholder="Cliente, O.S. ou nosso número" value=${q} onInput=${e => setQ(e.target.value)} /></label></div>
        ${!boletos ? html`<div class="esqueleto"></div>` : grupos[aba].length ? html`<div class="lista">${grupos[aba].map(linhaBoleto)}</div>` : html`<${Vazio}>Nenhum boleto aqui.</${Vazio}>`}
      </div>`}
    </section>
    ${ajustes ? html`<${CarteiraModal} cob=${cob} onFechar=${() => setAjustes(false)} />` : null}
    ${resultado ? html`<${Modal} titulo=${resultado.titulo} onFechar=${() => setResultado(null)}>
      <div class="lista">${resultado.linhas.map((l, i) => Array.isArray(l) ? html`<div key=${i} class="linha"><span class=${"pill p-" + l[0]}>${{ ok: "ok", warn: "atenção", bad: "problema", muted: "info" }[l[0]]}</span><span class="meio">${l[1]}</span></div>` : html`<p key=${i}>${l}</p>`)}</div>
      <div class="acoes"><span class="espaco"></span><button type="button" class="btn btn-pri" onClick=${() => setResultado(null)}>Fechar</button></div></${Modal}>` : null}
  </div>`;
}

/** Dados da carteira de cobrança (Ajustes do sistema → cfg.cobranca) */
function CarteiraModal({ cob, onFechar }) {
  const { cfg, avisar, recarregar } = useApp();
  const [c, setC] = useState({ ...cob }), [erro, setErro] = useState(""), [ocupado, setOcupado] = useState(false), [teste, setTeste] = useState(null);
  const set = p => { setC({ ...c, ...p }); setErro(""); };
  /** Sandbox: emite um boleto de teste do próprio Sicredi, consulta, baixa o PDF e pede a baixa. Nada é gravado aqui. */
  const testarLigacao = async () => {
    setOcupado(true); setErro(""); setTeste(null);
    try { setTeste(await api.sicredi({ acao: "teste_completo", ambiente: "sandbox" })); }
    catch (x) { setErro(x.message); } finally { setOcupado(false); }
  };
  const testarProducao = async () => {
    setOcupado(true); setErro(""); setTeste(null);
    try { const r = await api.sicredi({ acao: "testar", ambiente: "producao" }); setTeste({ ok: true, passos: [{ passo: "Entrar no Sicredi em produção (chave + código de acesso)", ok: true, detalhe: "Aceito. Nenhum boleto foi emitido." }] }); }
    catch (x) { setTeste({ ok: false, passos: [{ passo: "Entrar no Sicredi em produção", ok: false, detalhe: x.message }] }); } finally { setOcupado(false); }
  };
  const salvar = async () => {
    const e = faltaNaCarteira({ ...c, cnpj: cfg.cnpj, nome: cfg.nome }); if (e.length) return setErro(e.join(" "));
    setOcupado(true);
    try {
      const { cnpj, nome, ...guardar } = c;
      ["jurosMes", "multa", "byte"].forEach(k => { guardar[k] = Number(String(guardar[k]).replace(",", ".")) || 0; });
      await api.salvarConfig({ ...cfg, cobranca: guardar }); avisar("Carteira de cobrança salva."); await recarregar(["config"]); onFechar();
    } catch (x) { setErro(x.message); setOcupado(false); }
  };
  return html`<${Modal} titulo="Carteira de cobrança Sicredi" onFechar=${onFechar}>
    <p class="sub">Conferido no internet banking em 03/11/2026: beneficiário 0523.16.85453, conta 85453-7. CNPJ e nome vêm de Sistema › Ajustes (${fmtDoc(cfg.cnpj)} · ${cfg.nome}).</p>
    <div class="grade">
      <${Campo} id="cb-modo" rotulo="Como registrar os boletos"><select id="cb-modo" class="inp" value=${c.modo} onChange=${e => set({ modo: e.target.value })}>
        <option value="arquivo">Arquivo de remessa e retorno (CNAB)</option><option value="api">API do Sicredi (na hora, com Pix)</option></select></${Campo}>
      ${c.modo === "api" ? html`<${Campo} id="cb-amb" rotulo="Ambiente da API" dica="Teste = Sandbox do Sicredi (boletos de mentira). Produção = boletos de verdade."><select id="cb-amb" class="inp" value=${c.ambiente} onChange=${e => set({ ambiente: e.target.value })}>
        <option value="sandbox">Teste (Sandbox)</option><option value="producao">Produção</option></select></${Campo}>` : null}
    </div>
    ${c.modo === "api" ? html`<div class="card-sub">
      <p class="sub">A chave da API e o código de acesso ficam só no servidor (Supabase › Edge Functions › Secrets: SICREDI_API_KEY_SANDBOX, SICREDI_API_KEY e SICREDI_CODIGO_ACESSO). Esta tela nunca mostra nem guarda esses valores.</p>
      <div class="acoes"><button type="button" class="btn" disabled=${ocupado} onClick=${testarLigacao}>${ocupado ? "Testando…" : "Testar ligação (Sandbox)"}</button>
        <button type="button" class="btn" disabled=${ocupado} onClick=${testarProducao}>Conferir acesso de produção</button></div>
      ${teste ? html`<div class="lista">${teste.passos.map((p, i) => html`<div class="linha" key=${i}><span class=${"pill p-" + (p.ok ? "ok" : "bad")}>${p.ok ? "ok" : "falhou"}</span><span class="meio"><strong>${p.passo}</strong><span>${p.detalhe}</span></span></div>`)}</div>` : null}
    </div>` : null}
    <div class="grade">
      <${Campo} id="cb-coop" rotulo="Cooperativa"><${Texto} id="cb-coop" valor=${c.cooperativa} onMuda=${v => set({ cooperativa: v })} /></${Campo}>
      <${Campo} id="cb-posto" rotulo="Posto"><${Texto} id="cb-posto" valor=${c.posto} onMuda=${v => set({ posto: v })} /></${Campo}>
      <${Campo} id="cb-ben" rotulo="Código do beneficiário"><${Texto} id="cb-ben" valor=${c.beneficiario} onMuda=${v => set({ beneficiario: v })} /></${Campo}>
      <${Campo} id="cb-conta" rotulo="Conta corrente"><${Texto} id="cb-conta" valor=${c.conta} onMuda=${v => set({ conta: v })} /></${Campo}>
      <${Campo} id="cb-dv" rotulo="Dígito da conta"><${Texto} id="cb-dv" valor=${c.contaDv} onMuda=${v => set({ contaDv: v })} /></${Campo}>
      <${Campo} id="cb-byte" rotulo="Byte do Nosso Número" dica="2 a 9. Não mude depois do primeiro boleto."><${Texto} id="cb-byte" valor=${String(c.byte)} onMuda=${v => set({ byte: v })} /></${Campo}>
    </div>
    ${c.modo === "api" ? null : html`<${Campo} id="cb-pix" rotulo="Chave Pix aleatória da conta Sicredi" dica="Copie em Pix › Minhas chaves. A DTCar tem duas chaves aleatórias ativas (cadastradas em 21/05/2026); use uma delas."><${Texto} id="cb-pix" valor=${c.chavePix} placeholder="ex.: 1a2b3c4d-…" onMuda=${v => set({ chavePix: v.trim() })} /></${Campo}>`}
    <div class="grade">
      <${Campo} id="cb-juros" rotulo="Juros ao mês (%)" dica="0 = sem juros. Começa no dia seguinte ao vencimento."><${Texto} id="cb-juros" valor=${String(c.jurosMes)} onMuda=${v => set({ jurosMes: v })} /></${Campo}>
      <${Campo} id="cb-multa" rotulo="Multa (%)" dica="0 = sem multa."><${Texto} id="cb-multa" valor=${String(c.multa)} onMuda=${v => set({ multa: v })} /></${Campo}>
      <${Campo} id="cb-esp" rotulo="Espécie do título"><select id="cb-esp" class="inp" value=${c.especie} onChange=${e => set({ especie: e.target.value })}>${Object.entries(ESPECIES).map(([k, v]) => html`<option value=${k}>${v} (${k})</option>`)}</select></${Campo}>
      <${Campo} id="cb-conta-e" rotulo="Conta que recebe" dica="Saldo por conta: o pagamento entra nesta conta."><${Texto} id="cb-conta-e" valor=${c.contaEntrada} onMuda=${v => set({ contaEntrada: v })} /></${Campo}>
    </div>
    <${Campo} id="cb-msg" rotulo="Mensagem no boleto (opcional)"><${Texto} id="cb-msg" valor=${c.mensagem} maxlength="80" onMuda=${v => set({ mensagem: v })} /></${Campo}>
    <p class="sub">Espécie: DMI = duplicata mercantil (peças), DSI = duplicata de serviço. Na dúvida, confirme com o contador.</p>
    ${erro ? html`<div class="erros">${erro}</div>` : null}
    <div class="acoes"><span class="espaco"></span><button type="button" class="btn" onClick=${onFechar}>Voltar</button><button type="button" class="btn btn-pri" disabled=${ocupado} onClick=${salvar}>${ocupado ? "Salvando…" : "Salvar"}</button></div>
  </${Modal}>`;
}
