// Sistema › WhatsApp e e-mail › Robô — monitor do e-mail da oficina, para ficar aberto no tablet da recepção.
// Pedido do Danilo (24/11/2026): "um robô no tablete para monitorar o e-mail da contabilidade e alguns outros".
// Ele escolheu: roda SÓ NO TABLET (enquanto esta tela estiver aberta), só mostra e avisa (não lança nada sozinho),
// confere os anexos de duas formas — se o anexo abre de verdade e se o que veio já está no sistema — e manda um
// WhatsApp curto para o número dele quando aparece algo importante. Sem alarde: nada pisca, nada apita.
//
// Tudo o que o robô já conferiu fica guardado NESTE tablet (localStorage): ele não reconfere nem reavisa o mesmo
// e-mail. Trocou de aparelho, o robô começa do zero — é assim porque a decisão foi não rodar no servidor.
import { html, useState, useEffect, useRef } from "../lib.js";
import { api } from "../api.js";
import { useApp, Campo, Texto, Vazio } from "../ui.js";
import { AbasMensagens } from "./email.js";
import { fmtDataHora, soDig } from "../util.js";

const CHAVE = "robo:email";
const MINUTOS = [3, 5, 10, 15, 30];
// o nome da categoria vem sempre escrito, nunca só a cor (a tela é lida de longe, no tablet)
const CATEGORIAS = {
  fraude: ["Golpe", "bad"], importante: ["Importante", "ok"], util: ["Útil", "ok"],
  propaganda: ["Propaganda", "muted"], ignorar: ["Ignorado", "muted"], revisar: ["Revisar", "warn"], lixo: ["Lixo eletrônico", "muted"],
};
const catDe = c => CATEGORIAS[c] || [c || "Revisar", "warn"];

const guardado = () => { try { return JSON.parse(localStorage.getItem(CHAVE) || "{}"); } catch (_) { return {}; } };
const guardar = v => { try { localStorage.setItem(CHAVE, JSON.stringify(v)); } catch (_) { /* tablet sem espaço: segue sem guardar */ } };

/** O que o robô achou de cada anexo, em palavras (nunca só um ícone). */
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
  const { avisar } = useApp();
  const inicial = guardado();
  const [ligado, setLigado] = useState(!!inicial.ligado);
  const [minutos, setMinutos] = useState(Number(inicial.minutos) || 5);
  const [telefone, setTelefone] = useState(inicial.telefone || "");
  const [avisarZap, setAvisarZap] = useState(inicial.avisarZap !== false);
  const [vistos, setVistos] = useState(inicial.vistos || {});   // id do e-mail -> o que o robô achou
  const [lista, setLista] = useState([]);
  const [erro, setErro] = useState(""), [rodando, setRodando] = useState(false), [ultima, setUltima] = useState(inicial.ultima || "");
  const vivo = useRef(true), vistosRef = useRef(vistos), ocupado = useRef(false);
  vistosRef.current = vistos;

  useEffect(() => () => { vivo.current = false; }, []);
  useEffect(() => { guardar({ ligado, minutos, telefone, avisarZap, vistos, ultima }); }, [ligado, minutos, telefone, avisarZap, vistos, ultima]);

  /** A NF que veio no anexo já está no sistema? (nota de entrada lançada ou nota da SEFAZ já baixada) */
  const nfeNoSistema = async chave => {
    try {
      const lancada = await api.notas.existe(chave);
      if (lancada) return { chave, no_sistema: true, onde: "entrada de nota " + (lancada.numero || "") };
      const nota = (await api.sefaz.notas()).find(n => n.chave === chave);
      if (nota) return { chave, no_sistema: true, onde: "notas da SEFAZ" };
      return { chave, no_sistema: false };
    } catch (_) { return { chave, no_sistema: null }; }
  };
  /** O boleto que veio no anexo já está em contas a pagar? */
  const boletoNoSistema = async b => {
    const linha = soDig(b.linha || ""), cb = soDig(b.codigo_barras || "");
    try {
      const abertas = await api.contas.abertas();
      const achou = abertas.find(c => (linha && soDig(c.linha_digitavel || "") === linha) || (cb && soDig(c.codigo_barras || "") === cb));
      return { linha, valor: b.valor, vencimento: b.vencimento, no_sistema: !!achou, onde: achou ? "contas a pagar" : "" };
    } catch (_) { return { linha, valor: b.valor, vencimento: b.vencimento, no_sistema: null }; }
  };

  /** Confere os anexos de um e-mail: se abrem de verdade e se o que veio já está no sistema. */
  const conferirAnexos = async msg => {
    const saida = [];
    for (const a of (msg.anexos || [])) {
      const r = { id: a.id, nome: a.nome, kb: a.tamanho_kb };
      try {
        const d = await api.email.chamar({ acao: "anexo", id: msg.id, anexo_id: a.id });
        // "conteudo" sozinho é a explicação de por que não dá para abrir (link, e-mail anexado, grande demais)
        const abriu = !!(d.texto || d.nfe || d.imagem);
        r.baixa = abriu; if (!abriu) r.aviso = d.conteudo || "não deu para abrir";
        const chave = (d.nfe && d.nfe.chave) || (d.chaves_nfe || [])[0];
        if (chave) r.nfe = await nfeNoSistema(chave);
        const bol = (d.boletos || [])[0];
        if (bol) r.boleto = await boletoNoSistema(bol);
      } catch (e) { r.baixa = false; r.aviso = e.message; }
      saida.push(r);
    }
    return saida;
  };

  const pendencias = achado => {
    const p = [];
    for (const a of achado.anexos || []) {
      if (a.baixa === false) p.push("anexo que não abre");
      if (a.nfe && a.nfe.no_sistema === false) p.push("NF fora do sistema");
      if (a.boleto && a.boleto.no_sistema === false) p.push("boleto fora do sistema");
    }
    return [...new Set(p)];
  };

  /** Aviso curto no WhatsApp, no estilo que o Danilo pediu: e-mail de Fulano "anexos". */
  const avisarNoZap = async (msg, achado) => {
    const tel = soDig(telefone);
    if (!avisarZap || tel.length < 10) return false;
    const quem = msg.de.nome || msg.de.email || "remetente desconhecido";
    const p = pendencias(achado);
    const oque = p.length ? p.join(", ") : (msg.anexos || []).length ? "anexos" : catDe(msg.categoria)[0].toLowerCase();
    try {
      await api.email.chamar({ acao: "whatsapp", telefone: tel, origem: "robo", confirmar: true,
        texto: `e-mail de ${quem} "${oque}"` });
      api.whatsapp.chamar({ acao: "processar" }).catch(() => {});
      return true;
    } catch (_) { return false; }
  };

  const conferir = async () => {
    if (ocupado.current) return;
    ocupado.current = true; setRodando(true); setErro("");
    try {
      const r = await api.email.chamar({ acao: "buscar", dias: 2, incluir: "todos", limite: 25 });
      const msgs = (r && (r.mensagens || r.lista || r.itens)) || (Array.isArray(r) ? r : []);
      if (!vivo.current) return;
      const novos = { ...vistosRef.current };
      for (const m of msgs) {
        if (novos[m.id]) continue;
        const achado = { em: new Date().toISOString(), anexos: await conferirAnexos(m) };
        achado.avisado = await avisarNoZap(m, achado);
        novos[m.id] = achado;
        if (!vivo.current) return;
        setVistos({ ...novos });
      }
      setVistos(novos); setLista(msgs); setUltima(new Date().toISOString());
    } catch (e) { if (vivo.current) setErro(e.message); }
    finally { ocupado.current = false; if (vivo.current) setRodando(false); }
  };

  // o relógio do robô: só enquanto esta tela estiver aberta e ligada
  useEffect(() => {
    if (!ligado) return;
    conferir();
    const t = setInterval(conferir, Math.max(1, minutos) * 60000);
    return () => clearInterval(t);
  }, [ligado, minutos]);

  const comProblema = lista.filter(m => pendencias(vistos[m.id] || {}).length);
  return html`<div class="tela">
    <${AbasMensagens} ativa="robo" />
    <section class="card rb-painel">
      <div class="secao-topo"><h2>Robô do e-mail</h2>
        <button type="button" class=${"btn " + (ligado ? "btn-perigo" : "btn-pri")} onClick=${() => setLigado(v => !v)}>
          ${ligado ? "Desligar o robô" : "Ligar o robô"}</button></div>
      <p class="sub">Confere o e-mail da oficina sozinho enquanto esta tela estiver aberta neste tablet. Ele só olha e avisa:
        não lança, não responde, não apaga nada. De cada anexo ele diz se abre de verdade e se o que veio já está no sistema.</p>
      <div class="rb-ajustes">
        <${Campo} id="rb-min" rotulo="Conferir a cada">
          <select id="rb-min" class="inp" value=${String(minutos)} onChange=${e => setMinutos(Number(e.target.value))}>
            ${MINUTOS.map(n => html`<option value=${String(n)}>${n} minutos</option>`)}
          </select></${Campo}>
        <${Campo} id="rb-tel" rotulo="Avisar no WhatsApp" dica="Seu número. Deixe em branco para não receber aviso nenhum.">
          <${Texto} id="rb-tel" valor=${telefone} onMuda=${setTelefone} placeholder="27999999999" inputmode="numeric" />
        </${Campo}>
        <label class="rb-marca"><input type="checkbox" checked=${avisarZap} onChange=${e => setAvisarZap(e.target.checked)} />
          <span>Mandar o aviso curto no WhatsApp</span></label>
        <button type="button" class="btn" disabled=${rodando} onClick=${conferir}>${rodando ? "Conferindo…" : "Conferir agora"}</button>
      </div>
      <p class="sub">${ligado ? "Ligado" : "Desligado"}${ultima ? " · última conferência " + fmtDataHora(ultima) : ""}
        ${comProblema.length ? " · " + comProblema.length + " com pendência" : ""}</p>
      ${erro ? html`<p class="aviso aviso-bad">${erro}</p>` : null}
    </section>

    ${!lista.length ? html`<${Vazio}>${ligado ? "Nada novo nos últimos dois dias." : "Ligue o robô para ele começar a conferir."}</${Vazio}>` : null}
    ${lista.map(m => {
      const achado = vistos[m.id] || {}, [nome, cor] = catDe(m.categoria), probs = pendencias(achado);
      return html`<section class=${"card rb-email" + (probs.length ? " rb-com-prob" : "")} key=${m.id}>
        <div class="rb-cab">
          <span class=${"rb-tag rb-" + cor}>${nome}</span>
          <b class="rb-de">${m.de.nome || m.de.email}</b>
          <span class="sub">${m.de.email}</span>
          <span class="sub rb-hora">${fmtDataHora(m.data)}</span>
        </div>
        <p class="rb-assunto"><b>${m.assunto}</b></p>
        <p class="sub">${m.previa}</p>
        ${m.alerta ? html`<p class="aviso aviso-bad">${m.alerta}</p>` : null}
        ${(achado.anexos || []).length
          ? html`<ul class="rb-anexos">${achado.anexos.map(a => html`<${Anexo} a=${a} key=${a.id} />`)}</ul>`
          : (m.anexos || []).length
            ? html`<p class="sub">${m.anexos.length} anexo${m.anexos.length === 1 ? "" : "s"} · ainda não conferido${m.anexos.length === 1 ? "" : "s"}</p>`
            : html`<p class="sub">Sem anexo.</p>`}
        ${achado.avisado ? html`<p class="sub">Avisado no WhatsApp.</p>` : null}
      </section>`;
    })}
  </div>`;
}
