// Notas fiscais anexadas à O.S. (supabase/v33.sql): o PDF e o XML da nota emitida no ObjetivaWeb ficam ligados ao número
// da O.S. para irem junto no e-mail ("manda a O.S. 1887 com a NF e o boleto"). Só o administrador.
// A NF continua sendo emitida fora do sistema: aqui só se guarda o arquivo.
import { html, useState, useEffect, useRef } from "../lib.js";
import { api } from "../api.js";
import { useApp, Modal } from "../ui.js";
import { numOS, fmtDataHora } from "../util.js";
import { entregarArquivo } from "../pdf.js";

/** Número da nota: do XML (NF-e: nNF; NFS-e: Numero) ou do nome do arquivo ("NF 131.pdf"). */
export function numeroDaNF(nome, xml) {
  const m = String(xml || "").match(/<(?:\w+:)?(?:nNF|Numero|NumeroNfse|numero)>\s*(\d{1,12})\s*</);
  if (m) return String(Number(m[1]));
  const n = String(nome || "").replace(/\.(pdf|xml)$/i, "").match(/(?:nf[se-]*|nota)[^\d]{0,4}(\d{1,9})/i);
  return n ? String(Number(n[1])) : "";
}

export function NotasOSModal({ o, onFechar, onMudou }) {
  const { avisar, confirmar } = useApp();
  const [notas, setNotas] = useState(null), [erro, setErro] = useState(""), [numero, setNumero] = useState(""), [arqs, setArqs] = useState([]), [salvando, setSalvando] = useState(false);
  const vivo = useRef(true);
  const ler = async () => { try { const l = await api.notasOS.listar(o.numero); if (vivo.current) { setNotas(l); onMudou && onMudou(l.length); } } catch (e) { if (vivo.current) setErro(e.message); } };
  useEffect(() => { ler(); return () => { vivo.current = false; }; }, []);

  const escolher = async lista => {
    const l = Array.from(lista || []).filter(a => /\.(pdf|xml)$/i.test(a.name) || /pdf|xml/.test(a.type));
    setErro(l.length < (lista || []).length ? "Só PDF ou XML da nota." : "");
    setArqs(l.slice(0, 2));
    if (!numero) for (const a of l) {
      const n = numeroDaNF(a.name, /xml/i.test(a.type) || /\.xml$/i.test(a.name) ? await a.text().catch(() => "") : "");
      if (n) { setNumero(n); break; }
    }
  };
  const salvar = async ev => {
    ev.preventDefault();
    if (!arqs.length) { setErro("Escolha o PDF e/ou o XML da nota."); return; }
    if (arqs.some(a => a.size > 5 * 1024 * 1024)) { setErro("Arquivo acima de 5 MB."); return; }
    setSalvando(true); setErro("");
    try {
      for (const a of arqs) await api.notasOS.adicionar(a, { os_numero: o.numero, placa: (o.veiculo && o.veiculo.placa) || "", numero_nf: numero.trim() });
      setArqs([]); setNumero(""); avisar("NF anexada à " + numOS(o.numero) + "."); await ler();
    } catch (e) { setErro(e.message); } finally { setSalvando(false); }
  };
  const abrir = async n => { try { await entregarArquivo(await api.notasOS.baixar(n.arquivo), n.nome_arquivo || "nf"); } catch (e) { setErro(e.message); } };
  const excluir = async n => {
    if (!await confirmar({ titulo: "Tirar a NF da O.S.", texto: `Remove o arquivo ${n.nome_arquivo} da ${numOS(o.numero)}. A nota continua valendo no ObjetivaWeb.`, botao: "Remover", perigo: true })) return;
    try { await api.notasOS.excluir(n); await ler(); } catch (e) { setErro(e.message); }
  };

  return html`<${Modal} titulo=${"Nota fiscal da " + numOS(o.numero)} onFechar=${onFechar}>
    <p class="sub">Anexe o PDF (DANFE) e o XML da nota emitida no ObjetivaWeb. Eles vão junto quando o Claude mandar a O.S. por e-mail.</p>
    ${notas === null && !erro ? html`<p class="sub">Carregando…</p>` : null}
    ${notas && notas.length ? html`<ul class="res-lista">${notas.map(n => html`<li key=${n.id}><div><b>${n.numero_nf ? "NF " + n.numero_nf : "NF"}</b> · ${n.nome_arquivo}
        <span class="sub"> · ${/xml/.test(n.tipo_arquivo) ? "XML" : "PDF"} · ${Math.max(1, Math.round((n.tamanho || 0) / 1024))} KB · ${fmtDataHora(n.criado_em)}</span></div>
        <div class="acoes"><button type="button" class="btn btn-sm" onClick=${() => abrir(n)}>Abrir</button><button type="button" class="btn btn-sm" onClick=${() => excluir(n)}>Remover</button></div></li>`)}</ul>`
      : notas ? html`<p class="sub">Nenhuma NF anexada ainda.</p>` : null}
    ${notas !== null || !erro ? html`<form class="rh-novo" onSubmit=${salvar}>
      <label>PDF e/ou XML da nota<input class="inp" type="file" multiple accept="application/pdf,.pdf,.xml,text/xml,application/xml" onChange=${e => escolher(e.target.files)} /></label>
      <label>Número da NF<input class="inp" inputmode="numeric" value=${numero} placeholder="lido do XML" onInput=${e => setNumero(e.target.value.replace(/\D/g, ""))} /></label>
      <div class="acoes"><button type="button" class="btn" onClick=${onFechar}>Fechar</button><button type="submit" class="btn btn-pri" disabled=${salvando || !arqs.length}>${salvando ? "Anexando…" : "Anexar NF"}</button></div>
    </form>` : null}
    ${erro ? html`<div class="aviso" role="alert">${erro}</div>` : null}
  </${Modal}>`;
}
