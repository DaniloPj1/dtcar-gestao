// Sistema › WhatsApp e e-mail › Robô — painel do robô do e-mail (pedido do Danilo em 24/11/2026).
//
// Quem roda o robô é o MOTOR DO TABLET (motor-zap/motor.js 3.6): o mesmo programa e o mesmo aparelho do WhatsApp,
// no Termux, que sobe sozinho quando o tablet liga. A cada 5 minutos ele chama a função "email" (ação "robo"), que
// olha a caixa, confere os anexos e manda o aviso. O robô NÃO depende desta tela aberta nem do tablet desbloqueado.
//
// Esta tela só mostra o que o robô achou (tabela email_robo, v64), liga/desliga e deixa conferir na hora.
// O robô só olha e avisa: não lança, não responde, não apaga e não move e-mail nenhum.
import { html, useState, useEffect, useRef } from "../lib.js";
import { api } from "../api.js";
import { useApp, Campo, Vazio } from "../ui.js";
import { AbasMensagens } from "./email.js";
import { fmtDataHora } from "../util.js";

const DIAS = [1, 2, 3, 5, 7];
// o nome da categoria vem sempre escrito, nunca só a cor
const CATEGORIAS = {
  fraude: ["Golpe", "bad"], importante: ["Importante", "ok"], util: ["Útil", "ok"],
  propaganda: ["Propaganda", "muted"], ignorar: ["Ignorado", "muted"], revisar: ["Revisar", "warn"], lixo: ["Lixo eletrônico", "muted"],
};
const catDe = c => CATEGORIAS[c] || [c || "Revisar", "warn"];

/** O que o robô achou de cada anexo, em palavras. */
function Anexo({ a }) {
  const probs = [];
  if (a.baixa === false) probs.push(a.aviso || "não baixa");
  if (a.nfe && a.nfe.no_sistema === false) probs.push("NF falta entrar no sistema");
  if (a.boleto && a.boleto.no_sistema === false) probs.push("boleto falta lançar");
  const oks = [];
  if (a.baixa) oks.push("baixa");
  if (a.nfe && a.nfe.no_sistema) oks.push("NF já no sistema");
  if (a.boleto && a.boleto.no_sistema) oks.push("boleto já lançado");
  return html`<li class=${"rb-anexo" + (probs.length ? " rb-anexo-ruim" : "")}>
    <b>${a.nome || "anexo"}</b><span class="sub">${a.kb ? a.kb + " KB" : ""}</span>
    <span class=${"rb-sinal " + (probs.length ? "rb-bad" : "rb-ok")}>${probs.length ? probs.join(" · ") : (oks.join(" · ") || "conferido")}</span>
  </li>`;
}

export function Robo() {
  const { cfg, avisar, recarregar } = useApp();
  const rb = (cfg && cfg.roboEmail) || {};
  const [lista, setLista] = useState(null), [erro, setErro] = useState(""), [semV64, setSemV64] = useState(false);
  const [conferindo, setConferindo] = useState(false), [salvando, setSalvando] = useState(false);
  const vivo = useRef(true);

  const carregar = async () => {
    try {
      const l = await api.email.robo();
      if (!vivo.current) return;
      if (l === null) { setSemV64(true); setLista([]); return; }
      setSemV64(false); setLista(l); setErro("");
    } catch (e) { if (vivo.current) setErro(e.message); }
  };
  useEffect(() => { carregar(); const t = setInterval(carregar, 60000); return () => { vivo.current = false; clearInterval(t); }; }, []);

  const gravar = async patch => {
    setSalvando(true);
    try { await api.salvarConfig({ ...cfg, roboEmail: { ...rb, ...patch } }); await recarregar(["config"]); }
    catch (e) { avisar(e.message, true); } finally { setSalvando(false); }
  };
  const conferir = async () => {
    setConferindo(true); setErro("");
    try {
      const r = await api.email.chamar({ acao: "robo", origem: "tela" });
      avisar(r && r.novos ? r.novos + (r.novos === 1 ? " e-mail novo conferido." : " e-mails novos conferidos.") : "Nada novo na caixa.");
      await carregar();
    } catch (e) { setErro(e.message); } finally { setConferindo(false); }
  };

  const ligado = rb.ligado === true;
  const comProblema = (lista || []).filter(l => (l.pendencias || []).length);
  return html`<div class="tela">
    <${AbasMensagens} ativa="robo" />
    <section class="card rb-painel">
      <div class="secao-topo"><h2>Robô do e-mail</h2>
        <button type="button" class=${"btn " + (ligado ? "btn-perigo" : "btn-pri")} disabled=${salvando || semV64}
          onClick=${() => gravar({ ligado: !ligado })}>${ligado ? "Desligar o robô" : "Ligar o robô"}</button></div>
      <p class="sub">Quem confere é o programa do tablet, o mesmo que cuida do WhatsApp: roda sozinho, com a tela
        apagada e sem ninguém por perto. O robô só olha e avisa — não lança, não responde e não apaga nada. De cada
        anexo ele diz se abre de verdade e se o que veio já está no sistema, e manda um aviso curto no seu WhatsApp.</p>
      ${semV64 ? html`<p class="aviso aviso-bad">Falta rodar o <b>supabase/v64.sql</b> no Supabase: sem ele o robô não
        tem onde guardar o que confere.</p>` : null}
      <div class="rb-ajustes">
        <${Campo} id="rb-dias" rotulo="Olhar os últimos">
          <select id="rb-dias" class="inp" disabled=${salvando || semV64} value=${String(Number(rb.dias) || 2)}
            onChange=${e => gravar({ dias: Number(e.target.value) })}>
            ${DIAS.map(n => html`<option value=${String(n)}>${n} ${n === 1 ? "dia" : "dias"}</option>`)}
          </select></${Campo}>
        <label class="rb-marca"><input type="checkbox" disabled=${salvando || semV64} checked=${rb.avisar !== false}
          onChange=${e => gravar({ avisar: e.target.checked })} />
          <span>Avisar no meu WhatsApp</span></label>
        <button type="button" class="btn" id="rb-agora" disabled=${conferindo || semV64} onClick=${conferir}>
          ${conferindo ? "Conferindo…" : "Conferir agora"}</button>
      </div>
      <p class="sub">${ligado ? "Ligado: o tablet confere a cada 5 minutos." : "Desligado: o tablet não está conferindo."}
        ${lista && lista.length ? " · último e-mail conferido " + fmtDataHora(lista[0].conferido_em) : ""}
        ${comProblema.length ? " · " + comProblema.length + " com pendência" : ""}</p>
      <p class="sub">O aviso vai para o número de alerta cadastrado em <b>Sistema › WhatsApp</b>, o mesmo dos outros
        avisos do sistema.</p>
      ${erro ? html`<p class="aviso aviso-bad">${erro}</p>` : null}
    </section>

    ${lista && !lista.length && !semV64 ? html`<${Vazio}>${ligado ? "O robô ainda não achou nada." : "Ligue o robô para ele começar a conferir."}</${Vazio}>` : null}
    ${(lista || []).map(l => {
      const [nome, cor] = catDe(l.categoria), probs = l.pendencias || [];
      return html`<section class=${"card rb-email" + (probs.length ? " rb-com-prob" : "")} key=${l.id}>
        <div class="rb-cab">
          <span class=${"rb-tag rb-" + cor}>${nome}</span>
          <b class="rb-de">${l.de_nome || l.de_email}</b>
          <span class="sub">${l.de_email}</span>
          <span class="sub rb-hora">${fmtDataHora(l.recebido_em || l.conferido_em)}</span>
        </div>
        <p class="rb-assunto"><b>${l.assunto || "(sem assunto)"}</b></p>
        ${(l.anexos || []).length
          ? html`<ul class="rb-anexos">${l.anexos.map((a, i) => html`<${Anexo} a=${a} key=${i} />`)}</ul>`
          : html`<p class="sub">Sem anexo.</p>`}
        ${l.avisado ? html`<p class="sub">Avisado no WhatsApp${l.avisado_em ? " em " + fmtDataHora(l.avisado_em) : ""}.</p>` : null}
      </section>`;
    })}
  </div>`;
}
