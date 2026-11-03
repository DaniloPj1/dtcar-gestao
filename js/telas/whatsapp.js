// Sistema › WhatsApp — conexão própria da oficina (etapa 1: teste, pareamento por código e conferência)
import { html, useState, useEffect, useRef } from "../lib.js";
import { api } from "../api.js";
import { useApp, Campo } from "../ui.js";
import { soDig, fmtDataHora } from "../util.js";

const SIT = { desligado: ["Desligado", "muted"], pareando: ["Pareando…", "info"], conectado: ["Vinculado", "ok"], erro: ["Com problema", "bad"] };

export function WhatsApp() {
  const { avisar, confirmar } = useApp();
  const [st, setSt] = useState(null), [erro, setErro] = useState(""), [fazendo, setFazendo] = useState("");
  const [numero, setNumero] = useState("55"), [codigo, setCodigo] = useState(null), [teste, setTeste] = useState(null);
  const vivo = useRef(true);
  const ler = async () => { try { const s = await api.whatsapp.situacao(); if (vivo.current) { setSt(s); setErro(""); } return s; } catch (e) { if (vivo.current) setErro(e.message); } };
  useEffect(() => { ler(); return () => { vivo.current = false; }; }, []);
  // enquanto pareia, confere a situação a cada 4 s (o pareamento termina no celular)
  useEffect(() => { if (!codigo) return; const t = setInterval(async () => { const s = await ler(); if (s && s.situacao !== "pareando") { setCodigo(null); clearInterval(t); } }, 4000); return () => clearInterval(t); }, [codigo]);
  const fazer = async (acao, extra = {}) => {
    setFazendo(acao); setErro("");
    try { const r = await api.whatsapp.chamar({ acao, ...extra }); await ler(); return r; }
    catch (e) { setErro(e.message); return null; } finally { setFazendo(""); }
  };
  const testar = async () => { const r = await fazer("testar"); if (r) setTeste(r); };
  const conferir = async () => { const r = await fazer("conferir"); if (r) setTeste(r); };
  const parear = async () => {
    const n = soDig(numero);
    if (n.length < 12 || n.length > 13 || !n.startsWith("55")) return setErro("Informe o número com 55 + DDD + número, só dígitos (ex.: 5527999990000).");
    const r = await fazer("parear", { numero: n }); if (r && r.codigo) setCodigo({ codigo: r.codigo, ate: Date.now() + (r.validade_s || 120) * 1000 });
  };
  const desconectar = async () => {
    if (!await confirmar({ titulo: "Desconectar WhatsApp", texto: "O celular da oficina deixa de estar vinculado ao sistema e a sessão guardada é apagada. Para voltar, será preciso parear de novo.", botao: "Desconectar", perigo: true })) return;
    if (await fazer("desconectar")) avisar("WhatsApp desconectado.");
  };
  const [rot, cor] = SIT[(st && st.situacao) || "desligado"] || SIT.desligado;
  const fmtCod = c => String(c || "").replace(/^(.{4})(.{4})$/, "$1-$2");
  return html`<div class="pagina">
    <div class="card">
      <h3>WhatsApp da oficina</h3>
      <p class="sub">Conexão própria com o WhatsApp do celular da oficina, sem serviço pago. Nesta etapa o sistema só testa a conexão e vincula o celular; enviar e receber mensagens vem nas próximas etapas.</p>
      <div class="aviso">Conexão <b>não oficial</b>: o WhatsApp pode bloquear o número se perceber uso automático. Use um número da oficina, só com clientes, sem envio em massa.</div>
      ${!st && !erro ? html`<p class="sub">Carregando…</p>` : null}
      ${st ? html`<ul class="res-lista zap-situacao">
        <li>Situação: <span class=${"pill p-" + cor}>${rot}</span></li>
        <li>Número vinculado: <b>${st.numero || "—"}</b></li>
        <li>Último aviso: ${st.detalhe || "—"}</li>
        <li>Atualizado em ${fmtDataHora(st.atualizado_em)}</li>
      </ul>` : null}
      ${erro ? html`<div class="aviso" role="alert">${erro}</div>` : null}
    </div>

    <div class="card">
      <h3>1. Testar a conexão</h3>
      <p class="sub">Conecta ao WhatsApp sem vincular nada e confere se ele responde. Nenhum celular é contatado.</p>
      <button type="button" class="btn" disabled=${!!fazendo} onClick=${testar}>${fazendo === "testar" ? "Testando… (até 40 s)" : "Testar conexão"}</button>
      ${teste ? html`<p><span class=${"pill p-" + (teste.ok ? "ok" : "bad")}>${teste.ok ? "Funcionou" : "Não funcionou"}</span> em ${(teste.ms / 1000).toFixed(1)} s${teste.detalhe ? " · " + teste.detalhe : ""}</p>` : null}
    </div>

    <div class="card">
      <h3>2. Vincular o celular da oficina</h3>
      ${st && st.situacao === "conectado" ? html`<p class="sub">Celular vinculado. Use "Conferir" para testar se a sessão guardada conecta de novo.</p>
        <div class="acoes"><button type="button" class="btn btn-pri" disabled=${!!fazendo} onClick=${conferir}>${fazendo === "conferir" ? "Conferindo…" : "Conferir conexão"}</button>
          <button type="button" class="btn btn-perigo" disabled=${!!fazendo} onClick=${desconectar}>${fazendo === "desconectar" ? "Desconectando…" : "Desconectar"}</button></div>`
      : codigo ? html`<p>No celular da oficina: <b>WhatsApp › Aparelhos conectados › Conectar aparelho › Conectar com número de telefone</b> e digite:</p>
        <p class="codigo-pareamento" aria-live="polite">${fmtCod(codigo.codigo)}</p>
        <p class="sub">O código vale por cerca de 2 minutos. Esta tela atualiza sozinha quando o celular terminar.</p>`
      : html`<p class="sub">Peça um código e digite-o no celular da oficina. Nada é enviado aos clientes.</p>
        <${Campo} id="zap-numero" rotulo="Número do WhatsApp da oficina (55 + DDD + número)"><input id="zap-numero" class="inp" inputmode="numeric" value=${numero} onInput=${e => setNumero(soDig(e.target.value))} /></${Campo}>
        <button type="button" class="btn btn-pri" disabled=${!!fazendo} onClick=${parear}>${fazendo === "parear" ? "Pedindo código…" : "Pedir código de pareamento"}</button>`}
    </div>
  </div>`;
}
