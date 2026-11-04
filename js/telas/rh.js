// Financeiro › Funcionários e RH › Documentos do RH: os PDFs da contabilidade (recibos, pró-labore, folha de ponto, DARF,
// FGTS, laudos) num lugar só, por mês, para abrir e imprimir. Chegam sozinhos do e-mail da oficina (função "email",
// ação importar_rh) ou à mão (ex.: DAS recebido no WhatsApp). Guias: valor, vencimento e linha digitável lidos do PDF.
// Só o administrador (salários e dados pessoais).
import { html, useState, useEffect, useRef } from "../lib.js";
import { api } from "../api.js";
import { useApp, Abas, Modal } from "../ui.js";
import { reais, fmtData, hojeISO } from "../util.js";
import { lerPDFBoleto, fmtLinha } from "../boleto.js";
import { entregarArquivo } from "../pdf.js";

export const TIPOS_RH = { recibo: "Recibo de pagamento", adiantamento: "Recibo de adiantamento", pro_labore: "Pró-labore", folha_ponto: "Folha de ponto",
  darf: "DARF (impostos)", fgts: "FGTS", das: "DAS (Simples Nacional)", inss: "INSS / GPS", laudo: "Laudo técnico", epi: "Controle de EPI", outro: "Outro" };
const GUIAS = ["darf", "fgts", "das", "inss"];
export const REMETENTES_PADRAO = ["dploredocontabilidade@gmail.com"];
const nomeMes = ym => { const [a, m] = ym.split("-"); return ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"][Number(m) - 1] + " de " + a; };
const mesAtual = () => hojeISO().slice(0, 7);
/** Guia de imposto (DARF, FGTS, DAS) é de arrecadação: o vencimento não está na linha digitável, só no texto do PDF. */
export function vencimentoNoTexto(texto) {
  const m = String(texto || "").replace(/\s+/g, " ").match(/(pagar (este documento )?at[ée]|data de vencimento|vencimento|validade|pag[áa]vel at[ée])[^\d]{0,40}(\d{2})\/(\d{2})\/(\d{4})/i);
  return m ? `${m[5]}-${m[4]}-${m[3]}` : null;
}

/** Funcionários e Documentos do RH ficam juntos no menu: abas para trocar entre as duas telas */
export const AbasRH = ({ ativa }) => html`<${Abas} abas=${[["funcionarios", "Funcionários e folha"], ["rh", "Documentos do RH"]]} ativa=${ativa} onTroca=${k => { location.hash = "#/" + k; }} />`;

/** Imprime um PDF ou imagem sem sair da tela (no programa para Windows, baixa o arquivo para imprimir pelo leitor de PDF). */
async function imprimirBlob(blob, nome) {
  if (window.dtcarDesktop) return entregarArquivo(blob, nome);
  const url = URL.createObjectURL(blob);
  const f = document.createElement("iframe");
  f.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0";
  f.src = url; document.body.appendChild(f);
  await new Promise(res => { f.onload = res; setTimeout(res, 4000); });
  try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { window.open(url, "_blank"); }
  setTimeout(() => { f.remove(); URL.revokeObjectURL(url); }, 60000);
  return "impresso";
}

export function DocumentosRH() {
  const { cfg, avisar, confirmar, recarregar } = useApp();
  const [docs, setDocs] = useState(null), [erro, setErro] = useState(""), [mes, setMes] = useState("todos"), [tipo, setTipo] = useState("todos");
  const [buscando, setBuscando] = useState(""), [novo, setNovo] = useState(false), [fazendo, setFazendo] = useState(""), [config, setConfig] = useState(false);
  const vivo = useRef(true);
  const remetentes = ((cfg.rh && cfg.rh.remetentes) || REMETENTES_PADRAO).filter(Boolean);
  const ler = async () => { try { const d = await api.rh.listar(); if (vivo.current) setDocs(d); return d; } catch (e) { if (vivo.current) setErro(e.message); } };

  // guias sem valor: lê o PDF no navegador (valor, vencimento e linha digitável)
  const lerGuias = async lista => {
    for (const d of (lista || []).filter(x => GUIAS.includes(x.tipo) && x.valor == null && /pdf/.test(x.tipo_arquivo) && !x.linha_digitavel).slice(0, 10)) {
      try {
        const blob = await api.rh.baixar(d.arquivo);
        const { boleto, texto } = await lerPDFBoleto(blob);
        if (boleto && boleto.ok) await api.rh.atualizar(d.id, { valor: boleto.valor || null, vencimento: boleto.vencimento || vencimentoNoTexto(texto), linha_digitavel: boleto.linha_digitavel || "" });
        else await api.rh.atualizar(d.id, { linha_digitavel: "-" }); // não achou: não tenta de novo
      } catch (e) { /* tenta na próxima vez */ }
    }
  };
  // busca na contabilidade: chama a função até não restar anexo novo
  const buscar = async (silencioso = false) => {
    setBuscando("Buscando no e-mail da contabilidade…"); setErro("");
    let total = 0;
    try {
      for (let i = 0; i < 15; i++) {
        const r = await api.email.chamar({ acao: "importar_rh", remetentes, dias: (docs && docs.length) ? 120 : 400 });
        total += r.importados || 0;
        if (vivo.current) setBuscando(`Buscando no e-mail da contabilidade… ${total} documento(s) novo(s)`);
        if (!r.restam) break;
      }
      const d = await ler(); await lerGuias(d); await ler();
      if (!silencioso || total) avisar(total ? `${total} documento(s) novo(s) da contabilidade.` : "Nenhum documento novo da contabilidade.");
    } catch (e) { if (!silencioso) setErro(e.message); }
    finally { if (vivo.current) setBuscando(""); }
  };
  useEffect(() => {
    ler().then(d => { if (d) buscar(true); });
    return () => { vivo.current = false; };
  }, []);

  const abrir = async (d, imprimir) => {
    setFazendo(d.id); setErro("");
    try {
      const blob = await api.rh.baixar(d.arquivo);
      if (imprimir) await imprimirBlob(blob, d.nome_arquivo || "documento.pdf");
      else if (window.dtcarDesktop) await entregarArquivo(blob, d.nome_arquivo || "documento.pdf");
      else { const u = URL.createObjectURL(blob); window.open(u, "_blank"); setTimeout(() => URL.revokeObjectURL(u), 60000); }
    } catch (e) { setErro(e.message); } finally { setFazendo(""); }
  };
  const excluir = async d => {
    if (!await confirmar({ titulo: "Excluir documento", texto: `"${d.titulo || d.nome_arquivo}" sai do sistema. Se veio do e-mail, continua no Hotmail e não volta sozinho.`, botao: "Excluir", perigo: true })) return;
    try { await api.rh.excluir(d); await ler(); avisar("Documento excluído."); } catch (e) { setErro(e.message); }
  };
  const mudarTipo = async (d, t) => { try { await api.rh.atualizar(d.id, { tipo: t }); await ler(); } catch (e) { setErro(e.message); } };

  if (erro && !docs) return html`<div class="pagina"><${AbasRH} ativa="rh" /><div class="aviso" role="alert">${erro}</div></div>`;
  const meses = docs ? [...new Set(docs.map(d => d.competencia))].sort().reverse() : [];
  const lista = (docs || []).filter(d => (mes === "todos" || d.competencia === mes) && (tipo === "todos" || d.tipo === tipo));
  const porMes = meses.filter(m => lista.some(d => d.competencia === m));
  return html`<div class="pagina larga-media">
    <${AbasRH} ativa="rh" />
    <div class="painel-topo"><div><h1>Documentos do RH</h1><span class="sub">Recibos, pró-labore, folha de ponto, guias e laudos da contabilidade · só o administrador vê</span></div>
      <div class="acoes">
        <button type="button" class="btn" disabled=${!!buscando} onClick=${() => buscar(false)}>${buscando ? "Buscando…" : "Buscar na contabilidade"}</button>
        <button type="button" class="btn btn-pri" onClick=${() => setNovo(true)}>+ Adicionar documento</button></div></div>
    ${buscando ? html`<p class="sub" role="status">${buscando}</p>` : null}
    ${erro ? html`<div class="aviso" role="alert">${erro}</div>` : null}
    <div class="card rh-filtros">
      <label>Mês<select class="inp" value=${mes} onChange=${e => setMes(e.target.value)}><option value="todos">Todos</option>${meses.map(m => html`<option value=${m}>${nomeMes(m)}</option>`)}</select></label>
      <label>Tipo<select class="inp" value=${tipo} onChange=${e => setTipo(e.target.value)}><option value="todos">Todos</option>${Object.entries(TIPOS_RH).map(([k, n]) => html`<option value=${k}>${n}</option>`)}</select></label>
      <button type="button" class="btn-link" onClick=${() => setConfig(true)}>E-mails da contabilidade (${remetentes.length})</button>
    </div>
    ${!docs ? html`<div class="carregando">Carregando documentos…</div>`
    : !lista.length ? html`<div class="card"><p class="sub">Nenhum documento${mes !== "todos" || tipo !== "todos" ? " com esse filtro" : " ainda"}. Use "Buscar na contabilidade" ou "+ Adicionar documento".</p></div>`
    : porMes.map(m => html`<section class="card rh-mes" key=${m}><h3>${nomeMes(m)}</h3><ul class="rh-lista">
        ${lista.filter(d => d.competencia === m).map(d => html`<li key=${d.id}>
          <div class="rh-doc"><span class=${"pill " + (GUIAS.includes(d.tipo) ? "p-info" : "p-muted")}>${TIPOS_RH[d.tipo] || d.tipo}</span>
            <b>${d.titulo || d.nome_arquivo}</b>
            <span class="sub">${d.origem === "email" ? "e-mail de " + fmtData(d.email_data) : "adicionado à mão"}${d.valor != null ? " · " + reais(d.valor) : ""}${d.vencimento ? " · vence " + fmtData(d.vencimento) : ""}</span>
            ${d.linha_digitavel && d.linha_digitavel !== "-" ? html`<span class="sub rh-linha">${fmtLinha(d.linha_digitavel)}</span>` : null}</div>
          <div class="acoes">
            <select class="inp inp-curto" aria-label="Tipo do documento" value=${d.tipo} onChange=${e => mudarTipo(d, e.target.value)}>${Object.entries(TIPOS_RH).map(([k, n]) => html`<option value=${k}>${n}</option>`)}</select>
            <button type="button" class="btn btn-sm" disabled=${fazendo === d.id} onClick=${() => abrir(d, false)}>Abrir</button>
            <button type="button" class="btn btn-sm btn-pri" disabled=${fazendo === d.id} onClick=${() => abrir(d, true)}>${fazendo === d.id ? "Abrindo…" : "Imprimir"}</button>
            <button type="button" class="btn btn-sm" aria-label=${"Excluir " + (d.titulo || d.nome_arquivo)} onClick=${() => excluir(d)}>Excluir</button></div>
        </li>`)}</ul></section>`)}
    ${novo ? html`<${NovoDocumento} onFechar=${() => setNovo(false)} onSalvo=${async () => { setNovo(false); await ler(); avisar("Documento adicionado."); }} />` : null}
    ${config ? html`<${Remetentes} atual=${remetentes} onFechar=${() => setConfig(false)} onSalvo=${async lista2 => { await api.salvarConfig({ ...cfg, rh: { ...(cfg.rh || {}), remetentes: lista2 } }); await recarregar(["config"]); setConfig(false); avisar("E-mails da contabilidade salvos."); }} />` : null}
  </div>`;
}

function NovoDocumento({ onFechar, onSalvo }) {
  const [arq, setArq] = useState(null), [f, setF] = useState({ tipo: "das", competencia: mesAtual(), titulo: "", valor: "", vencimento: "", linha_digitavel: "" });
  const [lendo, setLendo] = useState(false), [erro, setErro] = useState(""), [salvando, setSalvando] = useState(false);
  const escolher = async a => {
    setArq(a); setErro("");
    if (!a) return;
    setF(x => ({ ...x, titulo: x.titulo || a.name.replace(/\.[a-z0-9]+$/i, "") }));
    if (/pdf/.test(a.type) || /\.pdf$/i.test(a.name)) {
      setLendo(true);
      try { const { boleto, texto } = await lerPDFBoleto(a); if (boleto && boleto.ok) setF(x => ({ ...x, valor: boleto.valor ? String(boleto.valor).replace(".", ",") : x.valor, vencimento: boleto.vencimento || vencimentoNoTexto(texto) || x.vencimento, linha_digitavel: boleto.linha_digitavel || "" })); }
      catch (e) { /* PDF sem texto: preenche à mão */ } finally { setLendo(false); }
    }
  };
  const salvar = async ev => {
    ev.preventDefault();
    if (!arq) { setErro("Escolha o arquivo (PDF ou foto)."); return; }
    if (!/^\d{4}-\d{2}$/.test(f.competencia)) { setErro("Informe o mês do documento."); return; }
    setSalvando(true); setErro("");
    try {
      const valor = String(f.valor || "").trim() ? Number(String(f.valor).replace(/\./g, "").replace(",", ".")) : null;
      await api.rh.adicionar(arq, { competencia: f.competencia, tipo: f.tipo, titulo: f.titulo.trim(), valor: Number.isFinite(valor) ? valor : null, vencimento: f.vencimento || null, linha_digitavel: f.linha_digitavel || "" });
      await onSalvo();
    } catch (e) { setErro(e.message); } finally { setSalvando(false); }
  };
  return html`<${Modal} titulo="Adicionar documento do RH" onFechar=${onFechar}>
    <form class="rh-novo" onSubmit=${salvar}>
      <label>Arquivo (PDF ou foto)<input class="inp" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange=${e => escolher(e.target.files[0] || null)} /></label>
      ${lendo ? html`<p class="sub" role="status">Lendo a guia…</p>` : null}
      <div class="email-campos">
        <label>Tipo<select class="inp" value=${f.tipo} onChange=${e => setF({ ...f, tipo: e.target.value })}>${Object.entries(TIPOS_RH).map(([k, n]) => html`<option value=${k}>${n}</option>`)}</select></label>
        <label>Mês de referência<input class="inp" type="month" value=${f.competencia} onChange=${e => setF({ ...f, competencia: e.target.value })} /></label>
        <label>Descrição<input class="inp" value=${f.titulo} onInput=${e => setF({ ...f, titulo: e.target.value })} /></label>
        <label>Valor (guias)<input class="inp" inputmode="decimal" placeholder="0,00" value=${f.valor} onInput=${e => setF({ ...f, valor: e.target.value })} /></label>
        <label>Vencimento (guias)<input class="inp" type="date" value=${f.vencimento} onChange=${e => setF({ ...f, vencimento: e.target.value })} /></label>
      </div>
      ${f.linha_digitavel ? html`<p class="sub">Linha digitável lida: ${fmtLinha(f.linha_digitavel)}</p>` : null}
      ${erro ? html`<div class="aviso" role="alert">${erro}</div>` : null}
      <div class="acoes"><button type="button" class="btn" onClick=${onFechar}>Cancelar</button><button type="submit" class="btn btn-pri" disabled=${salvando}>${salvando ? "Salvando…" : "Salvar"}</button></div>
    </form>
  </${Modal}>`;
}

function Remetentes({ atual, onFechar, onSalvo }) {
  const [txt, setTxt] = useState(atual.join("\n")), [erro, setErro] = useState("");
  const salvar = async ev => {
    ev.preventDefault();
    const l = [...new Set(txt.split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(Boolean))];
    const ruim = l.filter(x => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
    if (ruim.length) { setErro("E-mail inválido: " + ruim.join(", ")); return; }
    if (!l.length) { setErro("Informe pelo menos um e-mail."); return; }
    try { await onSalvo(l.slice(0, 10)); } catch (e) { setErro(e.message); }
  };
  return html`<${Modal} titulo="E-mails da contabilidade" onFechar=${onFechar}>
    <form onSubmit=${salvar}>
      <p class="sub">"Buscar na contabilidade" traz os anexos (PDF e foto) que chegaram destes endereços no e-mail da oficina. Um por linha.</p>
      <textarea class="inp" rows="4" value=${txt} onInput=${e => setTxt(e.target.value)} aria-label="E-mails da contabilidade"></textarea>
      ${erro ? html`<div class="aviso" role="alert">${erro}</div>` : null}
      <div class="acoes"><button type="button" class="btn" onClick=${onFechar}>Cancelar</button><button type="submit" class="btn btn-pri">Salvar</button></div>
    </form>
  </${Modal}>`;
}
