// Sistema › WhatsApp — conexão própria da oficina (etapa 1: teste, pareamento por QR Code e conferência)
import { html, useState, useEffect, useRef } from "../lib.js";
import { api } from "../api.js";
import { useApp } from "../ui.js";
import { fmtDataHora } from "../util.js";

const SIT = { desligado: ["Desligado", "muted"], pareando: ["Pareando…", "info"], conectado: ["Vinculado", "ok"], erro: ["Com problema", "bad"] };

export function WhatsApp() {
  const { avisar, confirmar } = useApp();
  const [st, setSt] = useState(null), [erro, setErro] = useState(""), [fazendo, setFazendo] = useState("");
  const [pediu, setPediu] = useState(false), [teste, setTeste] = useState(null);
  const vivo = useRef(true);
  const ler = async (limparErro = false) => { try { const s = await api.whatsapp.situacao(); if (vivo.current) { setSt(s); if (limparErro) setErro(""); } return s; } catch (e) { if (vivo.current) setErro(e.message); } };
  useEffect(() => { ler(true); return () => { vivo.current = false; }; }, []);
  // enquanto pareia, confere a situação a cada 3 s: o QR muda a cada 20–60 s e o pareamento termina no celular
  // (também quando a tela é reaberta no meio de um pareamento)
  const pareando = pediu || !!(st && st.situacao === "pareando");
  useEffect(() => { if (!pareando) return; const t = setInterval(async () => { const s = await ler(); if (s && s.situacao !== "pareando") { setPediu(false); clearInterval(t); } }, 3000); return () => clearInterval(t); }, [pareando]);
  const fazer = async (acao, extra = {}) => {
    setFazendo(acao); setErro("");
    try { const r = await api.whatsapp.chamar({ acao, ...extra }); await ler(true); return r; }
    catch (e) { setErro(e.message); await ler(); return null; } finally { setFazendo(""); }
  };
  const testar = async () => { const r = await fazer("testar"); if (r) setTeste(r); };
  const conferir = async () => { const r = await fazer("conferir"); if (r) setTeste(r); };
  const parear = async () => { const r = await fazer("parear_qr"); if (r && r.qr) setPediu(true); };
  const desconectar = async () => {
    if (!await confirmar({ titulo: "Desconectar WhatsApp", texto: "O celular da oficina deixa de estar vinculado ao sistema e a sessão guardada é apagada. Para voltar, será preciso parear de novo.", botao: "Desconectar", perigo: true })) return;
    if (await fazer("desconectar")) avisar("WhatsApp desconectado.");
  };
  // "pareando" parado há mais de 3 min: a tentativa acabou sem avisar (a função tem 150 s de vida) — trata como problema
  if (st && st.situacao === "pareando" && Date.now() - new Date(st.atualizado_em).getTime() > 180000) setSt({ ...st, situacao: "erro", qr_svg: null, detalhe: "O pareamento anterior não terminou. Mostre o QR Code de novo." });
  const [rot, cor] = SIT[(st && st.situacao) || "desligado"] || SIT.desligado;
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
      ${teste ? html`<p><span class=${"pill p-" + (teste.ok ? "ok" : "bad")}>${teste.ok ? "Funcionou" : "Não funcionou"}</span> em ${(teste.ms / 1000).toFixed(1)} s${teste.detalhe ? " · " + teste.detalhe : ""}</p>
        ${teste.cifras ? html`<p class="sub">Criptografia do servidor: mensagens ${teste.cifras.gcm && teste.cifras.cbc ? "OK" : "NÃO suportada"} · pareamento por código ${teste.cifras.ctr ? "OK" : "não suportado (use o QR Code)"}</p>` : null}` : null}
    </div>

    <div class="card">
      <h3>2. Vincular o celular da oficina</h3>
      ${st && (st.situacao === "conectado" || st.situacao === "erro") ? html`<p class="sub">${st.situacao === "conectado"
          ? "Celular vinculado. Use \"Conferir\" para testar se a sessão guardada conecta de novo."
          : "Houve um problema. Confira a conexão de novo; se não voltar, desconecte (apaga a sessão) e vincule outra vez."}</p>
        <div class="acoes"><button type="button" class="btn btn-pri" disabled=${!!fazendo} onClick=${conferir}>${fazendo === "conferir" ? "Conferindo…" : "Conferir conexão"}</button>
          <button type="button" class="btn btn-perigo" disabled=${!!fazendo} onClick=${desconectar}>${fazendo === "desconectar" ? "Desconectando…" : "Desconectar"}</button></div>` : null}
      ${st && st.situacao === "conectado" ? null
      : st && st.situacao === "pareando" ? html`<p>No celular da oficina, abra <b>WhatsApp › Aparelhos conectados › Conectar aparelho</b> e aponte a câmera para o QR Code abaixo.</p>
        ${!("qr_svg" in st) ? html`<div class="aviso">Falta rodar o supabase/v23.sql no Supabase para o QR Code aparecer aqui.</div>`
        : st.qr_svg ? html`<img class="qr-pareamento" alt="QR Code para vincular o celular" src=${"data:image/svg+xml;charset=utf-8," + encodeURIComponent(st.qr_svg)} />` : html`<p class="sub">Gerando o QR Code…</p>`}
        <p class="sub">O QR Code muda sozinho a cada 20–60 segundos; a tela acompanha. Tem cerca de 2 minutos para ler. Esta tela avisa quando o celular terminar.</p>`
      : html`<p class="sub">O sistema mostra um QR Code para você ler com o celular da oficina (o mesmo jeito de conectar o WhatsApp Web). Nada é enviado aos clientes.</p>
        <button type="button" class="btn btn-pri" disabled=${!!fazendo} onClick=${parear}>${fazendo === "parear_qr" ? "Gerando QR Code…" : "Mostrar QR Code para vincular"}</button>`}
    </div>
  </div>`;
}
