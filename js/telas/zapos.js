// Enviar pela fila do WhatsApp da oficina, direto da tela da O.S. (v34; só administrador): o mesmo texto do botão
// "Abrir WhatsApp" (js/mensagens.js) e, se marcado, o PDF (orçamento, O.S. ou checklist), que sai logo depois do texto.
// Quem monta o texto e o PDF é a função "email" do Supabase (a mesma que o Claude usa): primeiro a prévia, depois a fila.
import { html, useState, useEffect } from "../lib.js";
import { api } from "../api.js";
import { Modal, Area } from "../ui.js";
import { fmtTel } from "../util.js";
import { MODELOS } from "../mensagens.js";

const linhas = l => l.map((a, i) => html`${i ? html`<br />` : null}${a}`);
const PDF = { orcamento: "PDF do orçamento", os: "PDF da ordem de serviço", entrada: "PDF do checklist de entrada" };

export function EnvioZapModal({ o, qual, onFechar }) {
  const padrao = (MODELOS[qual] || {}).pdf;
  const [comPdf, setComPdf] = useState(padrao === "orcamento" || padrao === "os" || padrao === "entrada");
  const [texto, setTexto] = useState(null), [editado, setEditado] = useState(false);
  const [previa, setPrevia] = useState(null), [erro, setErro] = useState(""), [fazendo, setFazendo] = useState(""), [feito, setFeito] = useState(null);
  const pedido = confirmar => ({ acao: "whatsapp", modelo: qual, numero_os: o.numero, origem: "tela", confirmar,
    ...(editado && texto ? { texto } : {}), ...(comPdf && PDF[padrao] ? { anexo: { fonte: "os", documento: padrao } } : {}) });
  const ver = async () => {
    setFazendo("previa"); setErro("");
    try { const r = await api.email.chamar(pedido(false)); setPrevia(r); if (!editado) setTexto(r.texto || ""); }
    catch (e) { setErro(e.message); } finally { setFazendo(""); }
  };
  useEffect(() => { ver(); }, [comPdf]);
  // texto editado: confere de novo (limite de tamanho, link encurtado, repetição) pouco depois de parar de digitar
  useEffect(() => { if (!editado) return; const t = setTimeout(ver, 700); return () => clearTimeout(t); }, [texto]);
  const enviar = async () => {
    setFazendo("enviar"); setErro("");
    try { const r = await api.email.chamar(pedido(true)); if (r.gravado) { setFeito(r); api.whatsapp.chamar({ acao: "processar" }).catch(() => {}); } else setPrevia(r); }
    catch (e) { setErro(e.message); } finally { setFazendo(""); }
  };
  const erros = (previa && previa.erros) || [];
  return html`<${Modal} titulo="Enviar pelo WhatsApp da oficina" onFechar=${onFechar}>
    ${feito ? html`<p class="aviso ok">Mensagem na fila (posição ${feito.posicao_na_fila || 1}) para ${fmtTel(String(feito.telefone || "").slice(2))}${feito.arquivo ? ", com " + feito.arquivo : ""}. Sai pelas regras do WhatsApp (horário comercial e intervalo entre mensagens).</p>
      ${(feito.avisos || []).length ? html`<div class="aviso">${linhas(feito.avisos)}</div>` : null}
      <div class="acoes"><span class="espaco"></span><button type="button" class="btn btn-pri" onClick=${onFechar}>Fechar</button></div>` : html`
    <p class="sub">${(MODELOS[qual] || {}).rotulo || "Mensagem"} · O.S. ${o.numero}${previa && previa.telefone ? " · para " + fmtTel(String(previa.telefone).slice(2)) + (previa.cliente && previa.cliente.nome ? " (" + previa.cliente.nome + ")" : "") : ""}</p>
    ${PDF[padrao] ? html`<label class="linha-check"><input type="checkbox" checked=${comPdf} onChange=${e => setComPdf(e.target.checked)} /><span>Enviar o ${PDF[padrao]} junto${previa && previa.arquivo ? " (" + previa.arquivo.kb + " KB)" : ""}</span></label>` : null}
    ${texto === null ? html`<p class="sub">${fazendo ? "Montando a mensagem…" : ""}</p>` : html`<div class="campo"><label for="zap-texto">Mensagem</label>
      <${Area} id="zap-texto" valor=${texto} rows="10" onMuda=${v => { setTexto(v); setEditado(true); setPrevia(null); }} /></div>`}
    ${erros.length ? html`<div class="erros">${linhas(erros)}</div>` : null}
    ${previa && (previa.avisos || []).length ? html`<div class="aviso">${linhas(previa.avisos)}</div>` : null}
    ${erro ? html`<div class="erros">${erro}</div>` : null}
    <div class="acoes"><button type="button" class="btn-link" onClick=${onFechar}>Cancelar</button><span class="espaco"></span>
      <button type="button" class="btn btn-pri" disabled=${!!fazendo || !previa || erros.length > 0 || !String(texto || "").trim()} onClick=${enviar}>${fazendo === "enviar" ? "Enviando…" : "Pôr na fila do WhatsApp"}</button></div>`}
  </${Modal}>`;
}
