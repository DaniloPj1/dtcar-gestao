// Financeiro: contas a pagar (boletos, duplicatas da NF-e, despesas fixas e parceladas)
import { html, useState, useEffect, useMemo, useRef } from "../lib.js";
import { api } from "../api.js";
import { useApp, Campo, Texto, Area, Seg, Modal, Vazio, Dinheiro, Abas, Foto } from "../ui.js";
import { norm, soDig, reais, fmtData, fmtDoc, hojeISO, uuid, arred, parseValor } from "../util.js";
import { pode } from "../regras.js";
import { lerBoleto, fmtLinha, lerPDFBoleto, temCamera } from "../boleto.js";
import { lerNFe } from "../nfe.js";
import { FormFornecedor } from "./compras.js";

const DIA = 86400000;
const dias = (a, b) => Math.round((new Date(a + "T12:00:00") - new Date(b + "T12:00:00")) / DIA);
export const somaMes = (iso, n) => { const [a, m, d] = iso.split("-").map(Number); const ult = new Date(a, m - 1 + n + 1, 0).getDate(); const x = new Date(a, m - 1 + n, Math.min(d, ult));
  return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0"); };
export const nomeFavorecido = (c, forns) => { const f = c.fornecedor_id && forns.find(x => x.id === c.fornecedor_id); return f ? (f.fantasia || f.razao) : (c.favorecido || c.descricao || "—"); };
export function situacao(c, hoje = hojeISO()) {
  if (c.status === "paga") return { t: "Paga em " + fmtData(c.pago_em), cor: "ok", g: "paga" };
  if (c.status === "cancelada") return { t: "Cancelada", cor: "muted", g: "cancelada" };
  const d = dias(c.vencimento, hoje);
  if (d < 0) return { t: "Vencida há " + -d + (d === -1 ? " dia" : " dias"), cor: "bad", g: "vencida" };
  if (d === 0) return { t: "Vence hoje", cor: "warn", g: "hoje" };
  if (d <= 7) return { t: "Vence em " + d + (d === 1 ? " dia" : " dias"), cor: "info", g: "semana" };
  return { t: "Vence " + fmtData(c.vencimento), cor: "muted", g: "depois" };
}
/** Contas a lançar a partir das duplicatas de uma NF-e */
export function contasDaNota(nf, fornecedorId, categoria) {
  const nome = nf.fornecedor.fantasia || nf.fornecedor.razao, emissao = (nf.nota.emissao || "").slice(0, 10) || null, grupo = uuid();
  return nf.duplicatas.map((d, n) => ({ descricao: "NF " + nf.nota.numero + " – " + nome, fornecedor_id: fornecedorId || null, favorecido: nome, categoria: categoria || "Fornecedores de peças",
    documento: nf.nota.numero + "/" + d.numero, valor: d.valor, emissao, vencimento: d.vencimento, parcela: n + 1, parcelas: nf.duplicatas.length, grupo,
    origem: "nfe", chave_nfe: nf.nota.chave }));
}

/* ---------------- busca de fornecedor / prestador ---------------- */
export function BuscaFornecedor({ id = "busca-forn", valor, texto, onEscolha, onTexto, somentePrestador, permitirTexto = true }) {
  const { dados, perfil } = useApp();
  const [q, setQ] = useState(""), [novo, setNovo] = useState(null);
  const f = valor && dados.fornecedores.find(x => x.id === valor);
  if (f) return html`<div class="achado"><div class="meio"><strong>${f.fantasia || f.razao}</strong><div class="sub">${[f.fantasia ? f.razao : "", fmtDoc(f.cnpj)].filter(Boolean).join(" · ") || "fornecedor cadastrado"}</div></div>
    <button type="button" class="btn btn-sm" onClick=${() => onEscolha(null)}>Trocar</button></div>`;
  if (texto && !q) return html`<div class="achado"><div class="meio"><strong>${texto}</strong><div class="sub">sem cadastro</div></div><button type="button" class="btn btn-sm" onClick=${() => { setQ(texto); onTexto && onTexto(""); }}>Trocar</button></div>`;
  const n = norm(q), d = soDig(q);
  const res = !n ? (somentePrestador ? dados.fornecedores.filter(x => x.prestador).slice(0, 8) : []) : dados.fornecedores
    .filter(x => norm(x.razao).includes(n) || norm(x.fantasia).includes(n) || (d.length >= 4 && x.cnpj.includes(d))).sort((a, b) => (b.prestador ? 1 : 0) - (a.prestador ? 1 : 0)).slice(0, 8);
  return html`<div class="busca-cli"><input id=${id} class="inp" autocomplete="off" placeholder=${somentePrestador ? "Nome do prestador (retífica, torno, guincho…)" : "Nome ou CNPJ do fornecedor"} value=${q} onInput=${e => setQ(e.target.value)} />
    ${res.length || n ? html`<div class="lista">${res.map(x => html`<button type="button" key=${x.id} class="linha" onClick=${() => { onEscolha(x); setQ(""); }}><span class="meio"><strong>${x.fantasia || x.razao}</strong><span>${[x.prestador ? "prestador de serviço" : "", fmtDoc(x.cnpj), x.cidade].filter(Boolean).join(" · ")}</span></span></button>`)}
      ${n && permitirTexto && onTexto ? html`<button type="button" class="linha" onClick=${() => { onTexto(q.trim()); setQ(""); }}><span class="meio"><strong>Usar “${q.trim()}” sem cadastrar</strong><span>fica só neste lançamento</span></span></button>` : null}
      ${n && pode(perfil, "cadastrar") ? html`<button type="button" class="linha" onClick=${() => setNovo({ razao: q.trim(), prestador: !!somentePrestador })}><span class="meio"><strong>+ Cadastrar “${q.trim()}”</strong><span>novo ${somentePrestador ? "prestador" : "fornecedor"}</span></span></button>` : null}</div>` : null}
    ${novo ? html`<${FormFornecedor} inicial=${novo} onFechar=${() => setNovo(null)} onSalvo=${x => { setNovo(null); setQ(""); onEscolha(x); }} />` : null}</div>`;
}

/* ---------------- câmera (código de barras do boleto) ---------------- */
function CameraBoleto({ onLido, onFechar }) {
  const video = useRef(null), [erro, setErro] = useState("");
  useEffect(() => {
    let stream, vivo = true, t;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 } } });
        if (!vivo) return; video.current.srcObject = stream; await video.current.play();
        const det = new window.BarcodeDetector({ formats: ["itf"] });
        const ler = async () => { if (!vivo) return;
          try { const r = await det.detect(video.current); const c = r.map(x => soDig(x.rawValue)).find(x => x.length === 44 && lerBoleto(x) && lerBoleto(x).ok); if (c) { onLido(c); return; } } catch (e) {}
          t = setTimeout(ler, 250); };
        ler();
      } catch (e) { setErro(/Permission|NotAllowed/i.test(e.name + e.message) ? "Permita o uso da câmera no navegador para ler o boleto." : "Não foi possível abrir a câmera: " + e.message); }
    })();
    return () => { vivo = false; clearTimeout(t); if (stream) stream.getTracks().forEach(x => x.stop()); };
  }, []);
  return html`<${Modal} titulo="Ler código de barras" onFechar=${onFechar}>
    ${erro ? html`<div class="erros">${erro}</div>` : html`<div class="camera"><video ref=${video} playsinline muted></video><span class="mira"></span></div>
      <span class="dica">Deite o celular e aponte para as barras do boleto, com boa luz. A leitura é automática.</span>`}
  </${Modal}>`;
}

/* ---------------- cadastro de conta ---------------- */
const VAZIA = { descricao: "", fornecedor_id: null, favorecido: "", categoria: "", documento: "", valor: 0, emissao: "", vencimento: "", linha_digitavel: "", codigo_barras: "", obs: "", anexo: "", origem: "manual" };
export function ContaForm({ inicial = {}, lerAoAbrir, onFechar, onSalvo }) {
  const { cfg, dados, avisar, confirmar } = useApp();
  const [c, setC] = useState(() => ({ ...VAZIA, ...inicial }));
  const [bol, setBol] = useState(() => inicial.codigo_barras ? lerBoleto(inicial.codigo_barras) : null);
  const [repetir, setRepetir] = useState("nao"), [vezes, setVezes] = useState(2);
  const [arq, setArq] = useState(null), [anexar, setAnexar] = useState(true), [lendo, setLendo] = useState(false), [camera, setCamera] = useState(false);
  const [erro, setErro] = useState(""), [aviso, setAviso] = useState(""), [salvando, setSalvando] = useState(false);
  const pdfRef = useRef(null);
  useEffect(() => { if (lerAoAbrir === "pdf" && pdfRef.current) pdfRef.current.click(); if (lerAoAbrir === "camera") setCamera(true); }, []);
  const set = o => { setC(x => ({ ...x, ...o })); setErro(""); };
  const escolherForn = f => set(f ? { fornecedor_id: f.id, favorecido: f.fantasia || f.razao, ...(!c.categoria && f.categoria_padrao ? { categoria: f.categoria_padrao } : {}) } : { fornecedor_id: null, favorecido: "" });
  const aplicarBoleto = async (r, extra = {}) => {
    setBol(r); setAviso("");
    if (!r) return;
    const o = { linha_digitavel: r.linha_digitavel, codigo_barras: r.codigo_barras, origem: c.id ? c.origem : "boleto" };
    if (r.valor > 0 && !(Number(c.valor) > 0 && c.id)) o.valor = r.valor;
    if (r.vencimento && !(c.id && c.vencimento)) o.vencimento = r.vencimento;
    if (r.categoria && !c.categoria) o.categoria = r.categoria;
    if (!c.descricao && r.tipo === "arrecadacao") o.descricao = r.segmento;
    set({ ...o, ...extra });
    try { const ja = await api.contas.porCodigo(r.codigo_barras); if (ja && ja.id !== c.id) setAviso(`Este boleto já está lançado: ${ja.descricao}, ${reais(ja.valor)}, vencimento ${fmtData(ja.vencimento)} (${ja.status}).`); } catch (e) {}
    // duplicata em aberto com o mesmo valor e vencimento próximo: provavelmente é a mesma conta
    if (!c.id && r.valor > 0) try {
      const ab = await api.contas.abertas(); const par = ab.find(x => !x.codigo_barras && Math.abs(Number(x.valor) - r.valor) < 0.01 && (!r.vencimento || Math.abs(dias(x.vencimento, r.vencimento)) <= 5));
      if (par) setAviso(`Já existe uma conta em aberto com este valor: ${par.descricao}, vencimento ${fmtData(par.vencimento)}. Se for a mesma, abra essa conta e cole o código nela para não lançar em dobro.`);
    } catch (e) {}
  };
  const digitarCodigo = v => { set({ linha_digitavel: v }); const d = soDig(v); if ([44, 47, 48].includes(d.length)) aplicarBoleto(lerBoleto(d)); else setBol(null); };
  const lerPDF = async a => {
    setLendo(true); setErro("");
    try {
      const r = await lerPDFBoleto(a); setArq(a);
      if (!r.boleto) { setErro("Não encontrei a linha digitável neste PDF. Copie e cole o código do boleto no campo abaixo."); return; }
      const proprio = soDig(cfg.cnpj); const f = r.cnpjs.filter(x => x !== proprio).map(x => dados.fornecedores.find(y => y.cnpj === x)).find(Boolean);
      await aplicarBoleto(r.boleto, f && !c.fornecedor_id ? { fornecedor_id: f.id, favorecido: f.fantasia || f.razao, ...(!c.categoria && f.categoria_padrao ? { categoria: f.categoria_padrao } : {}) } : {});
      if (!c.descricao && f) set({ descricao: "Boleto " + (f.fantasia || f.razao) });
    } catch (e) { setErro("Não foi possível ler o PDF: " + e.message); } finally { setLendo(false); }
  };
  const valido = () => {
    if (!c.descricao.trim()) return "Informe a descrição.";
    if (!(Number(c.valor) > 0)) return "Informe o valor.";
    if (!c.vencimento) return "Informe o vencimento.";
    if (repetir !== "nao" && !(vezes >= 2 && vezes <= 60)) return "Informe de 2 a 60 vezes.";
    return "";
  };
  const salvar = async () => {
    const e = valido(); if (e) return setErro(e);
    if (bol && !bol.ok && !await confirmar({ titulo: "Código com dígito inválido", texto: "Os dígitos verificadores não conferem. Confira o código antes de pagar. Salvar mesmo assim?", botao: "Salvar" })) return;
    setSalvando(true);
    try {
      let anexo = c.anexo;
      if (arq && anexar && !anexo) { const ext = (arq.name.split(".").pop() || "pdf").toLowerCase(); anexo = await api.enviarArquivo("contas/" + uuid() + "." + ext, arq, arq.type || "application/pdf"); }
      const base = { descricao: c.descricao.trim(), fornecedor_id: c.fornecedor_id || null, favorecido: c.favorecido || "", categoria: c.categoria || "", documento: c.documento || "", valor: arred(c.valor),
        emissao: c.emissao || null, vencimento: c.vencimento, linha_digitavel: bol ? bol.linha_digitavel : soDig(c.linha_digitavel), codigo_barras: bol ? bol.codigo_barras : "", obs: c.obs || "", anexo, origem: c.origem || "manual" };
      if (c.id || repetir === "nao") { const r = await api.contas.salvar(c.id ? { id: c.id, ...base } : base); avisar(c.id ? "Conta atualizada." : "Conta lançada."); onSalvo(r); return; }
      const grupo = uuid(), n = Math.round(vezes);
      const parc = repetir === "parcelar" ? Array.from({ length: n }, (_, i) => i < n - 1 ? arred(base.valor / n) : arred(base.valor - arred(base.valor / n) * (n - 1))) : Array(n).fill(base.valor);
      const linhas = parc.map((v, i) => ({ ...base, valor: v, vencimento: somaMes(base.vencimento, i), parcela: i + 1, parcelas: n, grupo, origem: repetir === "parcelar" ? "parcelado" : "recorrente",
        documento: base.documento ? base.documento + (n > 1 ? "/" + (i + 1) : "") : "", ...(i > 0 ? { linha_digitavel: "", codigo_barras: "", anexo: "" } : {}) }));
      const r = await api.contas.lancar(linhas); avisar(r.lancadas + " conta(s) lançada(s)."); onSalvo(null);
    } catch (e) { setErro(/codigo_barras_unico|duplicate/i.test(e.message) ? "Este boleto já está lançado em outra conta." : e.message); } finally { setSalvando(false); }
  };
  const cats = cfg.categoriasDespesa || [];
  return html`<${Modal} titulo=${c.id ? "Conta a pagar" : "Nova conta a pagar"} largo onFechar=${onFechar}>
    <section class="boleto-entrada">
      <${Campo} id="ct-cod" rotulo="Código do boleto" dica="Cole a linha digitável ou o código de barras: valor e vencimento são preenchidos sozinhos.">
        <input id="ct-cod" class="inp mono" inputmode="numeric" autocomplete="off" placeholder="00000.00000 00000.000000 00000.000000 0 00000000000000" value=${bol ? fmtLinha(bol.linha_digitavel) : c.linha_digitavel} onInput=${e => digitarCodigo(e.target.value)} /></${Campo}>
      <div class="acoes">
        <label class="btn btn-sm" for="ct-pdf">${lendo ? "Lendo PDF…" : "Ler PDF do boleto"}</label><input ref=${pdfRef} id="ct-pdf" class="vh" type="file" accept="application/pdf,.pdf" onChange=${e => { const a = e.target.files[0]; e.target.value = ""; if (a) lerPDF(a); }} />
        ${temCamera() ? html`<button type="button" class="btn btn-sm" onClick=${() => setCamera(true)}>Ler com a câmera</button>` : null}
        ${bol ? html`<span class=${"pill p-" + (bol.ok ? "ok" : "bad")}>${bol.ok ? (bol.tipo === "bancario" ? bol.banco_nome : bol.segmento) : "Dígito verificador não confere"}</span>` : null}
        ${bol && bol.valor_referencia ? html`<span class="dica">Este código traz valor de referência: confira o valor no boleto.</span>` : null}
      </div>
      ${arq ? html`<label class="linha-check"><input type="checkbox" checked=${anexar} onChange=${e => setAnexar(e.target.checked)} /><span>Guardar o PDF (${arq.name}) junto da conta</span></label>` : null}
    </section>
    ${aviso ? html`<div class="aviso">${aviso}</div>` : null}
    <div class="campo"><label for="ct-forn">Fornecedor / favorecido</label><${BuscaFornecedor} id="ct-forn" valor=${c.fornecedor_id} texto=${c.fornecedor_id ? "" : c.favorecido} onEscolha=${escolherForn} onTexto=${t => set({ favorecido: t, fornecedor_id: null })} /></div>
    <div class="grade">
      <${Campo} id="ct-desc" rotulo="Descrição" obrig><${Texto} id="ct-desc" placeholder="ex.: Aluguel do galpão, Energia, NF 1234" valor=${c.descricao} onMuda=${v => set({ descricao: v })} /></${Campo}>
      <${Campo} id="ct-cat" rotulo="Categoria"><${Texto} id="ct-cat" list="ct-cats" valor=${c.categoria} onMuda=${v => set({ categoria: v })} /><datalist id="ct-cats">${cats.map(x => html`<option value=${x} />`)}</datalist></${Campo}>
      <${Campo} id="ct-val" rotulo="Valor" obrig><${Dinheiro} id="ct-val" valor=${c.valor} onMuda=${v => set({ valor: v })} /></${Campo}>
      <${Campo} id="ct-venc" rotulo="Vencimento" obrig><input id="ct-venc" type="date" class="inp" value=${c.vencimento} onInput=${e => set({ vencimento: e.target.value })} /></${Campo}>
      <${Campo} id="ct-doc" rotulo="Nº do documento"><${Texto} id="ct-doc" placeholder="NF, fatura, contrato" valor=${c.documento} onMuda=${v => set({ documento: v })} /></${Campo}>
      <${Campo} id="ct-emi" rotulo="Emissão"><input id="ct-emi" type="date" class="inp" value=${c.emissao || ""} onInput=${e => set({ emissao: e.target.value })} /></${Campo}>
    </div>
    ${!c.id ? html`<div class="campo"><label>Repetir</label><${Seg} rotulo="Repetir" opcoes=${[["Não", "info"], ["Parcelar o valor", "info"], ["Todo mês", "info"]]} valor=${{ nao: "Não", parcelar: "Parcelar o valor", mensal: "Todo mês" }[repetir]}
        onEscolha=${v => setRepetir({ "Não": "nao", "Parcelar o valor": "parcelar", "Todo mês": "mensal" }[v])} />
      ${repetir !== "nao" ? html`<div class="grade"><${Campo} id="ct-vezes" rotulo=${repetir === "parcelar" ? "Número de parcelas" : "Quantos meses"}><input id="ct-vezes" class="inp inp-curto" inputmode="numeric" value=${vezes} onInput=${e => setVezes(parseInt(e.target.value) || 0)} /></${Campo}>
        <span class="dica">${repetir === "parcelar" ? `${vezes} parcelas de cerca de ${reais((Number(c.valor) || 0) / (vezes || 1))}, uma por mês a partir do vencimento.` : `${vezes} contas de ${reais(c.valor)}, uma por mês a partir do vencimento (aluguel, energia, internet).`}</span></div>` : null}</div>` : null}
    <${Campo} id="ct-obs" rotulo="Observação"><${Area} id="ct-obs" style=${{ minHeight: "56px" }} valor=${c.obs} onMuda=${v => set({ obs: v })} /></${Campo}>
    ${c.anexo ? html`<${LinkAnexo} caminho=${c.anexo} />` : null}
    ${erro ? html`<div class="erros">${erro}</div>` : null}
    <div class="acoes"><span class="espaco"></span><button type="button" class="btn" onClick=${onFechar}>Cancelar</button>
      <button type="button" class="btn btn-pri" disabled=${salvando} onClick=${salvar}>${salvando ? "Salvando…" : c.id ? "Salvar" : "Lançar conta"}</button></div>
    ${camera ? html`<${CameraBoleto} onFechar=${() => setCamera(false)} onLido=${cod => { setCamera(false); aplicarBoleto(lerBoleto(cod)); }} />` : null}
  </${Modal}>`;
}
function LinkAnexo({ caminho }) {
  const [url, setUrl] = useState("");
  useEffect(() => { api.urlArquivo(caminho).then(setUrl).catch(() => {}); }, [caminho]);
  return url ? html`<a class="btn-link" href=${url} target="_blank" rel="noopener">Abrir o arquivo anexado</a>` : null;
}

/* ---------------- pagamento ---------------- */
function PagarModal({ conta, onFechar, onPago }) {
  const { cfg, avisar } = useApp();
  const [p, setP] = useState({ pago_em: hojeISO(), juros: 0, desconto: 0, forma_pagamento: conta.codigo_barras ? "Boleto" : "", obs: conta.obs || "" });
  const [salvando, setSalvando] = useState(false), [erro, setErro] = useState("");
  const total = arred(Number(conta.valor) + Number(p.juros || 0) - Number(p.desconto || 0));
  const formas = [...new Set(["Boleto", "PIX", "Transferência", "Débito em conta", ...(cfg.formasPagamento || [])])];
  const atraso = dias(p.pago_em, conta.vencimento);
  const salvar = async () => { if (!p.pago_em) return setErro("Informe a data do pagamento."); setSalvando(true);
    try { await api.contas.salvar({ id: conta.id, status: "paga", pago_em: p.pago_em, juros: arred(p.juros), desconto: arred(p.desconto), valor_pago: total, forma_pagamento: p.forma_pagamento, obs: p.obs }); avisar("Pagamento registrado."); onPago(); }
    catch (e) { setErro(e.message); } finally { setSalvando(false); } };
  return html`<${Modal} titulo="Registrar pagamento" onFechar=${onFechar}>
    <div class="total-item"><span>${conta.descricao}<small class="sub"> · vencimento ${fmtData(conta.vencimento)}</small></span><b>${reais(conta.valor)}</b></div>
    ${conta.linha_digitavel ? html`<${CopiarCodigo} conta=${conta} />` : null}
    <div class="grade">
      <${Campo} id="pg-data" rotulo="Pago em"><input id="pg-data" type="date" class="inp" value=${p.pago_em} onInput=${e => setP(x => ({ ...x, pago_em: e.target.value }))} /></${Campo}>
      <${Campo} id="pg-juros" rotulo="Juros e multa" dica=${atraso > 0 ? "Pago com " + atraso + " dia(s) de atraso." : ""}><${Dinheiro} id="pg-juros" valor=${p.juros} onMuda=${v => setP(x => ({ ...x, juros: v }))} /></${Campo}>
      <${Campo} id="pg-desc" rotulo="Desconto"><${Dinheiro} id="pg-desc" valor=${p.desconto} onMuda=${v => setP(x => ({ ...x, desconto: v }))} /></${Campo}>
    </div>
    <div class="campo"><label>Pago com</label><${Seg} rotulo="Forma de pagamento" opcoes=${formas.map(x => [x, "info"])} valor=${p.forma_pagamento} onEscolha=${v => setP(x => ({ ...x, forma_pagamento: v }))} /></div>
    <${Campo} id="pg-obs" rotulo="Observação"><${Texto} id="pg-obs" valor=${p.obs} onMuda=${v => setP(x => ({ ...x, obs: v }))} /></${Campo}>
    <div class="total-item tot"><span>Valor pago</span><b>${reais(total)}</b></div>
    ${erro ? html`<div class="erros">${erro}</div>` : null}
    <div class="acoes"><span class="espaco"></span><button type="button" class="btn" onClick=${onFechar}>Voltar</button><button type="button" class="btn btn-pri" disabled=${salvando} onClick=${salvar}>Confirmar pagamento</button></div>
  </${Modal}>`;
}
function CopiarCodigo({ conta }) {
  const { avisar } = useApp();
  const copiar = async () => { try { await navigator.clipboard.writeText(soDig(conta.linha_digitavel)); avisar("Código copiado. Cole no app do banco."); } catch (e) { avisar("Não foi possível copiar: selecione o código e copie.", true); } };
  return html`<div class="codigo-boleto"><code>${fmtLinha(conta.linha_digitavel)}</code><button type="button" class="btn btn-sm" onClick=${copiar}>Copiar código</button></div>`;
}

/* ---------------- detalhe ---------------- */
function ContaDetalhe({ conta, onFechar, onMudou }) {
  const { dados, confirmar, avisar } = useApp();
  const [modo, setModo] = useState(null);
  const s = situacao(conta);
  const acao = async (fn, msg) => { try { await fn(); avisar(msg); onMudou(); } catch (e) { avisar(e.message, true); } };
  if (modo === "editar") return html`<${ContaForm} inicial=${conta} onFechar=${() => setModo(null)} onSalvo=${() => { setModo(null); onMudou(); }} />`;
  if (modo === "pagar") return html`<${PagarModal} conta=${conta} onFechar=${() => setModo(null)} onPago=${onMudou} />`;
  return html`<${Modal} titulo="Conta a pagar" onFechar=${onFechar}>
    <div class="conta-cab"><div><strong>${conta.descricao}</strong><span class="sub">${nomeFavorecido(conta, dados.fornecedores)}</span></div><b>${reais(conta.valor)}</b></div>
    <span class=${"pill p-" + s.cor}>${s.t}</span>
    <div class="kv">
      <div><span>Vencimento</span><b>${fmtData(conta.vencimento)}</b></div>
      ${conta.categoria ? html`<div><span>Categoria</span><b>${conta.categoria}</b></div>` : null}
      ${conta.documento ? html`<div><span>Documento</span><b>${conta.documento}</b></div>` : null}
      ${conta.parcelas > 1 ? html`<div><span>Parcela</span><b>${conta.parcela} de ${conta.parcelas}</b></div>` : null}
      ${conta.emissao ? html`<div><span>Emissão</span><b>${fmtData(conta.emissao)}</b></div>` : null}
      ${conta.status === "paga" ? html`<div><span>Valor pago</span><b>${reais(conta.valor_pago)}${Number(conta.juros) ? " (juros " + reais(conta.juros) + ")" : ""}${Number(conta.desconto) ? " (desc. " + reais(conta.desconto) + ")" : ""}</b></div>
        <div><span>Pago com</span><b>${conta.forma_pagamento || "—"}</b></div>` : null}
      <div><span>Lançada por</span><b>${conta.criado_por || "—"} · ${{ manual: "manual", boleto: "leitura do boleto", nfe: "duplicata da NF-e", os: "serviço de terceiro na O.S.", recorrente: "conta mensal", parcelado: "parcelamento" }[conta.origem] || conta.origem}</b></div>
    </div>
    ${conta.linha_digitavel && conta.status === "aberta" ? html`<${CopiarCodigo} conta=${conta} />` : null}
    ${conta.obs ? html`<p class="sub">${conta.obs}</p>` : null}
    ${conta.anexo ? html`<${LinkAnexo} caminho=${conta.anexo} />` : null}
    <div class="acoes">
      ${conta.status !== "cancelada" ? html`<button type="button" class="btn-link perigo" onClick=${async () => { if (await confirmar({ titulo: "Cancelar conta", texto: "A conta deixa de contar como dívida, mas continua no histórico.", botao: "Cancelar conta", perigo: true })) acao(() => api.contas.salvar({ id: conta.id, status: "cancelada" }), "Conta cancelada."); }}>Cancelar conta</button>`
        : html`<button type="button" class="btn-link perigo" onClick=${async () => { if (await confirmar({ titulo: "Excluir conta", texto: "A conta some de vez, inclusive dos relatórios.", botao: "Excluir", perigo: true })) acao(() => api.contas.excluir(conta.id), "Conta excluída."); }}>Excluir</button>`}
      <span class="espaco"></span>
      ${conta.status === "paga" ? html`<button type="button" class="btn" onClick=${async () => { if (await confirmar({ titulo: "Desfazer pagamento", texto: "A conta volta a ficar em aberto.", botao: "Desfazer" })) acao(() => api.contas.salvar({ id: conta.id, status: "aberta", pago_em: null, valor_pago: null, juros: 0, desconto: 0 }), "Pagamento desfeito."); }}>Desfazer pagamento</button>` : null}
      ${conta.status === "cancelada" ? html`<button type="button" class="btn" onClick=${() => acao(() => api.contas.salvar({ id: conta.id, status: "aberta" }), "Conta reaberta.")}>Reabrir</button>` : null}
      <button type="button" class="btn" onClick=${() => setModo("editar")}>Alterar</button>
      ${conta.status === "aberta" ? html`<button type="button" class="btn btn-pri" onClick=${() => setModo("pagar")}>Registrar pagamento</button>` : null}
    </div>
  </${Modal}>`;
}

/* ---------------- duplicatas a partir do XML (notas já importadas ou só financeiro) ---------------- */
function DuplicatasXML({ onFechar, onLancado }) {
  const { dados, avisar, recarregar } = useApp();
  const [nf, setNf] = useState(null), [erro, setErro] = useState(""), [venc, setVenc] = useState(""), [enviando, setEnviando] = useState(false);
  const abrir = async a => { setErro(""); setNf(null);
    try { if (!/\.xml$/i.test(a.name)) throw new Error("Escolha o XML da nota (arquivo .xml)."); const x = lerNFe(await a.text()); setNf(x); setVenc(somaMes((x.nota.emissao || hojeISO()).slice(0, 10), 1)); } catch (e) { setErro(e.message); } };
  const lancar = async () => { setEnviando(true); setErro("");
    try {
      let f = dados.fornecedores.find(x => x.cnpj && x.cnpj === nf.fornecedor.cnpj);
      if (!f) { f = await api.fornecedores.salvar({ ...nf.fornecedor, razao: nf.fornecedor.razao || "Fornecedor" }); await recarregar(["fornecedores"]); }
      const dups = nf.duplicatas.length ? nf.duplicatas : [{ numero: "001", vencimento: venc, valor: nf.nota.valor_total }];
      const r = await api.contas.lancar(contasDaNota({ ...nf, duplicatas: dups }, f.id, f.categoria_padrao));
      avisar(r.lancadas + " conta(s) lançada(s)" + (r.repetidas ? "; " + r.repetidas + " já existia(m)" : "") + "."); onLancado();
    } catch (e) { setErro(e.message); } finally { setEnviando(false); } };
  return html`<${Modal} titulo="Contas a partir do XML da nota" onFechar=${onFechar}>
    <p class="sub">Lança as duplicatas (parcelas) da NF-e em contas a pagar, sem mexer no estoque. Use para notas que você já lançou no estoque ou que são só despesa. Para compras de peças novas, use Entrada de nota: ela já lança as duplicatas.</p>
    <div class="acoes"><label class="btn btn-pri" for="dup-arq">Escolher XML</label><input id="dup-arq" class="vh" type="file" accept=".xml,text/xml,application/xml" onChange=${e => { const a = e.target.files[0]; e.target.value = ""; if (a) abrir(a); }} /></div>
    ${nf ? html`<div class="total-item"><span>NF ${nf.nota.numero} · ${nf.fornecedor.fantasia || nf.fornecedor.razao}</span><b>${reais(nf.nota.valor_total)}</b></div>
      ${nf.duplicatas.length ? html`<ul class="ranking">${nf.duplicatas.map(d => html`<li key=${d.numero}><span>Parcela ${d.numero}</span><b>${reais(d.valor)}</b><small>${fmtData(d.vencimento)}</small></li>`)}</ul>`
        : html`<div class="aviso">A nota não traz duplicatas${nf.nota.pagamento ? " (pagamento: " + nf.nota.pagamento + ")" : ""}. Será lançada uma conta com o valor total.</div>
          <${Campo} id="dup-venc" rotulo="Vencimento"><input id="dup-venc" type="date" class="inp" value=${venc} onInput=${e => setVenc(e.target.value)} /></${Campo}>`}` : null}
    ${erro ? html`<div class="erros">${erro}</div>` : null}
    <div class="acoes"><span class="espaco"></span><button type="button" class="btn" onClick=${onFechar}>Fechar</button>${nf ? html`<button type="button" class="btn btn-pri" disabled=${enviando} onClick=${lancar}>Lançar ${nf.duplicatas.length || 1} conta(s)</button>` : null}</div>
  </${Modal}>`;
}

/* ---------------- tela ---------------- */
const GRUPOS = [["vencida", "Vencidas"], ["hoje", "Vencem hoje"], ["semana", "Próximos 7 dias"], ["depois", "Mais adiante"]];
const mesAtual = () => hojeISO().slice(0, 7);
const limitesMes = m => { const [a, n] = m.split("-").map(Number); return [m + "-01", m + "-" + String(new Date(a, n, 0).getDate()).padStart(2, "0")]; };
const somaDiasISO = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const mesDe = (n) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 7); };
/** Períodos rápidos: [chave, rótulo, () => [de, ate]] */
const PERIODOS = [
  ["mes", "Este mês", () => limitesMes(mesAtual())], ["mesant", "Mês passado", () => limitesMes(mesDe(-1))], ["mesprox", "Próximo mês", () => limitesMes(mesDe(1))],
  ["7d", "Próximos 7 dias", () => [hojeISO(), somaDiasISO(hojeISO(), 7)]], ["30d", "Próximos 30 dias", () => [hojeISO(), somaDiasISO(hojeISO(), 30)]],
  ["ano", "Este ano", () => [hojeISO().slice(0, 4) + "-01-01", hojeISO().slice(0, 4) + "-12-31"]], ["pers", "Personalizado", null],
];
const SITUACOES = [["", "Todas"], ["aberta", "Em aberto"], ["vencida", "Vencidas"], ["hoje", "Vencem hoje"], ["avencer", "A vencer"], ["paga", "Pagas"], ["cancelada", "Canceladas"]];
const ORIGENS_CONTA = { manual: "Lançamento manual", boleto: "Boleto", nfe: "Duplicata de nota", os: "Terceiro da O.S.", recorrente: "Despesa fixa", parcelado: "Parcelado" };
const LS_FILTROS = "dtcar-fin-filtros";
const FILTROS_VAZIOS = { q: "", cat: "", fav: "", forma: "", origem: "", sit: "", periodo: "mes", campo: "vencimento", de: "", ate: "" };

export function Financeiro({ params = {} }) {
  const { dados } = useApp();
  const [aba, setAba] = useState(params.aba === "pagas" || params.aba === "mes" ? "consulta" : params.aba || "abertas");
  const [abertas, setAbertas] = useState(null), [consulta, setConsulta] = useState(null), [erro, setErro] = useState("");
  const [f, setF] = useState(() => { try { return { ...FILTROS_VAZIOS, ...(JSON.parse(localStorage.getItem(LS_FILTROS) || "null") || {}), ...(params.aba === "pagas" ? { sit: "paga", campo: "pago_em" } : {}) }; } catch (e) { return { ...FILTROS_VAZIOS }; } });
  const [nova, setNova] = useState(params.nova ? { modo: params.nova } : null), [det, setDet] = useState(null), [dup, setDup] = useState(false);
  const muda = o => setF(x => { const n = { ...x, ...o }; try { localStorage.setItem(LS_FILTROS, JSON.stringify(n)); } catch (e) {} return n; });
  const limpar = () => muda({ q: "", cat: "", fav: "", forma: "", origem: "", sit: "" });
  const intervalo = () => { const per = PERIODOS.find(x => x[0] === f.periodo); return per && per[2] ? per[2]() : [f.de || hojeISO().slice(0, 7) + "-01", f.ate || hojeISO()]; };
  const [de, ate] = intervalo();
  const carregar = () => {
    api.contas.abertas().then(setAbertas).catch(e => { setErro(e.message); setAbertas([]); });
    if (aba === "consulta") { setConsulta(null); api.contas.listar({ de, ate, campo: f.campo }).then(setConsulta).catch(e => { setErro(e.message); setConsulta([]); }); }
  };
  useEffect(carregar, [aba, de, ate, f.campo]);
  const hoje = hojeISO();
  const fav = c => nomeFavorecido(c, dados.fornecedores);
  const passa = c => {
    if (f.cat && (c.categoria || "Sem categoria") !== f.cat) return false;
    if (f.fav && fav(c) !== f.fav) return false;
    if (f.forma && (c.forma_pagamento || "") !== f.forma) return false;
    if (f.origem && c.origem !== f.origem) return false;
    if (f.q) { const n = norm(f.q); if (!(norm(c.descricao).includes(n) || norm(fav(c)).includes(n) || norm(c.documento).includes(n) || norm(c.obs).includes(n) || String(c.valor).includes(f.q.replace(/\./g, "").replace(",", ".")))) return false; }
    if (aba === "consulta" && f.sit) {
      const g = situacao(c, hoje).g;
      if (f.sit === "aberta" && c.status !== "aberta") return false;
      if (f.sit === "avencer" && !(c.status === "aberta" && (g === "semana" || g === "depois"))) return false;
      if (["vencida", "hoje", "paga", "cancelada"].includes(f.sit) && g !== f.sit) return false;
    }
    return true;
  };
  const ab = abertas || [];
  const soma = l => l.reduce((s, c) => s + Number(c.valor), 0);
  const venc = ab.filter(c => c.vencimento < hoje), hj = ab.filter(c => c.vencimento === hoje), sem = ab.filter(c => c.vencimento > hoje && dias(c.vencimento, hoje) <= 7), trinta = ab.filter(c => c.vencimento >= hoje && dias(c.vencimento, hoje) <= 30);
  const base = aba === "abertas" ? ab : (consulta || []);
  const lista = base.filter(passa).sort((a, b) => f.campo === "pago_em" && aba === "consulta" ? (b.pago_em || "").localeCompare(a.pago_em || "") : a.vencimento.localeCompare(b.vencimento));
  const opcoes = (fn) => [...new Set([...(abertas || []), ...(consulta || [])].map(fn).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const categorias = opcoes(c => c.categoria || "Sem categoria"), favorecidos = opcoes(fav), formas = opcoes(c => c.forma_pagamento);
  const ativos = ["q", "cat", "fav", "forma", "origem", "sit"].filter(k => f[k]).length;
  const totPago = lista.filter(c => c.status === "paga").reduce((s, c) => s + Number(c.valor_pago ?? c.valor), 0);
  const totAberto = soma(lista.filter(c => c.status === "aberta")), totVencido = soma(lista.filter(c => c.status === "aberta" && c.vencimento < hoje));
  const porCategoria = useMemo(() => { const g = new Map(); for (const c of lista.filter(c => c.status !== "cancelada")) g.set(c.categoria || "Sem categoria", (g.get(c.categoria || "Sem categoria") || 0) + Number(c.status === "paga" ? c.valor_pago ?? c.valor : c.valor)); return [...g.entries()].sort((a, b) => b[1] - a[1]); }, [lista]);
  const exportar = () => {
    const esc = v => '"' + String(v ?? "").replace(/"/g, '""') + '"', n2 = v => String(Number(v || 0).toFixed(2)).replace(".", ",");
    const linhas = [["Vencimento", "Favorecido", "Descrição", "Categoria", "Documento", "Parcela", "Valor", "Situação", "Pago em", "Valor pago", "Forma de pagamento", "Origem"].map(esc).join(";")];
    for (const c of lista) linhas.push([fmtData(c.vencimento), fav(c), c.descricao, c.categoria, c.documento, c.parcelas > 1 ? c.parcela + "/" + c.parcelas : "", n2(c.valor), situacao(c, hoje).t, c.pago_em ? fmtData(c.pago_em) : "", c.status === "paga" ? n2(c.valor_pago ?? c.valor) : "", c.forma_pagamento, ORIGENS_CONTA[c.origem] || c.origem].map(esc).join(";"));
    const blob = new Blob(["﻿" + linhas.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "contas-dtcar-" + de + "-a-" + ate + ".csv"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 20000);
  };
  const linha = c => { const s = situacao(c, hoje); const d = new Date(c.vencimento + "T12:00:00");
    return html`<button type="button" key=${c.id} class=${"linha conta-linha s-" + s.g} onClick=${() => setDet(c)}>
      <span class="data-bloco"><b>${String(d.getDate()).padStart(2, "0")}</b><small>${d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}</small></span>
      <span class="meio"><strong>${fav(c)}</strong><span>${[c.descricao !== fav(c) ? c.descricao : "", c.categoria, c.parcelas > 1 ? "parcela " + c.parcela + "/" + c.parcelas : "", c.codigo_barras ? "boleto" : "", c.forma_pagamento && c.status === "paga" ? c.forma_pagamento : ""].filter(Boolean).join(" · ")}</span></span>
      <span class="dir"><b class=${c.status === "cancelada" ? "riscado" : ""}>${reais(c.status === "paga" ? c.valor_pago ?? c.valor : c.valor)}</b><span class=${"pill p-" + s.cor}>${s.t}</span></span></button>`; };
  const sel = (k, rot, ops, rotulos) => html`<label class="filtro"><span>${rot}</span><select class="inp" value=${f[k]} onChange=${e => muda({ [k]: e.target.value })}><option value="">Todos</option>${ops.map(x => html`<option value=${x}>${rotulos ? rotulos[x] || x : x}</option>`)}</select></label>`;
  const carregando = aba === "abertas" ? !abertas : !consulta;
  return html`<div class="pagina larga financeiro">
    <div class="painel-topo"><div><h1>Contas a pagar</h1><span class="sub">${abertas ? reais(soma(ab)) + " em aberto em " + ab.length + " conta(s)" : "Carregando…"}</span></div>
      <div class="acoes"><button type="button" class="btn" onClick=${() => setDup(true)}>Duplicatas do XML</button><button type="button" class="btn" onClick=${() => setNova({ modo: "pdf" })}>Ler boleto</button><button type="button" class="btn btn-pri" onClick=${() => setNova({ modo: "" })}>+ Nova conta</button></div></div>
    ${erro ? html`<div class="erros">${erro}</div>` : null}
    <div class="kpis fin-kpis">
      <button type="button" class=${"kpi" + (venc.length ? " kpi-alerta" : "")} onClick=${() => { setAba("consulta"); muda({ sit: "vencida", periodo: "ano", campo: "vencimento" }); }}><span>Vencidas</span><b class="kpi-din">${reais(soma(venc))}</b><small>${venc.length} conta(s)</small></button>
      <button type="button" class=${"kpi" + (hj.length ? " kpi-aviso" : "")} onClick=${() => { setAba("consulta"); muda({ sit: "hoje", periodo: "mes", campo: "vencimento" }); }}><span>Vencem hoje</span><b class="kpi-din">${reais(soma(hj))}</b><small>${hj.length} conta(s)</small></button>
      <button type="button" class="kpi" onClick=${() => { setAba("consulta"); muda({ sit: "aberta", periodo: "7d", campo: "vencimento" }); }}><span>Próximos 7 dias</span><b class="kpi-din">${reais(soma(sem))}</b><small>${sem.length} conta(s)</small></button>
      <button type="button" class="kpi" onClick=${() => { setAba("consulta"); muda({ sit: "aberta", periodo: "30d", campo: "vencimento" }); }}><span>Próximos 30 dias</span><b class="kpi-din">${reais(soma(trinta))}</b><small>incluindo hoje</small></button>
      <div class="kpi kpi-forte"><span>Total em aberto</span><b class="kpi-din">${reais(soma(ab))}</b><small>dívidas registradas</small></div>
    </div>
    <div class="fin-corpo">
      <section class="card">
        <${Abas} abas=${[["abertas", "Em aberto (" + ab.length + ")"], ["consulta", "Consultar por período"]]} ativa=${aba} onTroca=${setAba} />
        <div class="fin-filtros">
          ${aba === "consulta" ? html`<div class="fin-periodo">
            <label class="filtro"><span>Período</span><select class="inp" value=${f.periodo} onChange=${e => muda({ periodo: e.target.value })}>${PERIODOS.map(([k, t]) => html`<option value=${k}>${t}</option>`)}</select></label>
            ${f.periodo === "pers" ? html`<label class="filtro"><span>De</span><input type="date" class="inp" value=${f.de || de} onInput=${e => muda({ de: e.target.value })} /></label><label class="filtro"><span>Até</span><input type="date" class="inp" value=${f.ate || ate} onInput=${e => muda({ ate: e.target.value })} /></label>`
              : html`<span class="fin-intervalo">${fmtData(de)} a ${fmtData(ate)}</span>`}
            <label class="filtro"><span>Pela data de</span><select class="inp" value=${f.campo} onChange=${e => muda({ campo: e.target.value })}><option value="vencimento">Vencimento</option><option value="pago_em">Pagamento</option><option value="emissao">Emissão</option></select></label>
          </div>
          <div class="chips rolagem" role="group" aria-label="Situação">${SITUACOES.map(([k, t]) => html`<button type="button" key=${k} class=${"chip-f" + (f.sit === k ? " ativo" : "")} onClick=${() => muda({ sit: k })}>${t}</button>`)}</div>` : null}
          <div class="fin-sel">
            <label class="filtro fin-busca"><span>Buscar</span><input id="busca-conta" class="inp" type="search" placeholder="Descrição, documento, observação ou valor" value=${f.q} onInput=${e => muda({ q: e.target.value })} /></label>
            ${sel("fav", "Fornecedor / favorecido", favorecidos)}${sel("cat", "Categoria", categorias)}
            ${aba === "consulta" ? sel("forma", "Forma de pagamento", formas) : null}${sel("origem", "Origem", Object.keys(ORIGENS_CONTA), ORIGENS_CONTA)}
            ${ativos ? html`<button type="button" class="btn btn-sm fin-limpar" onClick=${limpar}>Limpar filtros (${ativos})</button>` : null}
          </div>
        </div>
        ${carregando ? html`<div class="esqueleto"></div>`
          : !lista.length ? html`<${Vazio}>${base.length ? "Nenhuma conta com esses filtros." : aba === "abertas" ? "Nenhuma conta em aberto. Lance boletos, duplicatas e despesas fixas para acompanhar as dívidas da oficina." : "Nenhuma conta neste período."}</${Vazio}>`
          : html`<div class="fin-resumo"><span><b>${lista.length}</b> conta(s)</span>
              ${totAberto ? html`<span>Em aberto <b>${reais(totAberto)}</b></span>` : null}${totVencido ? html`<span class="c-bad">Vencido <b>${reais(totVencido)}</b></span>` : null}
              ${totPago ? html`<span class="c-ok">Pago <b>${reais(totPago)}</b></span>` : null}
              <span class="espaco"></span><button type="button" class="btn btn-sm" onClick=${exportar}>Exportar planilha</button></div>
            ${aba === "abertas" ? GRUPOS.map(([g, t]) => { const l = lista.filter(c => situacao(c, hoje).g === g); return l.length ? html`<div class="grupo-contas" key=${g}><h4>${t}<span>${reais(soma(l))}</span></h4><div class="lista">${l.map(linha)}</div></div>` : null; })
              : html`<div class="lista">${lista.map(linha)}</div>`}`}
      </section>
      <aside class="card fin-lado"><h3>${ativos || aba === "consulta" ? "Por categoria (filtro atual)" : "Em aberto por categoria"}</h3>
        ${porCategoria.length ? html`<ul class="ranking">${porCategoria.map(([k, v]) => html`<li key=${k}><button type="button" class="botao-limpo" title="Filtrar por esta categoria" onClick=${() => muda({ cat: f.cat === k ? "" : k })}><span>${k}</span><b>${reais(v)}</b></button></li>`)}</ul>` : html`<span class="dica">Sem contas no filtro.</span>`}
        <p class="dica">O sistema não acessa o seu banco. Os boletos entram pelo código, pelo PDF, pela câmera ou pelas duplicatas do XML das notas de compra.</p></aside>
    </div>
    ${nova ? html`<${ContaForm} lerAoAbrir=${nova.modo} onFechar=${() => setNova(null)} onSalvo=${() => { setNova(null); carregar(); }} />` : null}
    ${det ? html`<${ContaDetalhe} conta=${det} onFechar=${() => setDet(null)} onMudou=${() => { setDet(null); carregar(); }} />` : null}
    ${dup ? html`<${DuplicatasXML} onFechar=${() => setDup(false)} onLancado=${() => { setDup(false); carregar(); }} />` : null}
  </div>`;
}
