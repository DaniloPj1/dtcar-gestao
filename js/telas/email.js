// Sistema › E-mail — e-mail da oficina (Hotmail/Outlook) para o Claude ler e responder, sempre a pedido do Danilo.
// A conexão usa o login da Microsoft (a senha nunca passa pelo sistema); a chave de acesso fica no servidor, numa tabela
// que ninguém do sistema lê. O filtro decide o que o Claude lê por padrão; nada é apagado, movido ou marcado como lido.
import { html, useState, useEffect, useRef } from "../lib.js";
import { api } from "../api.js";
import { useApp, Abas } from "../ui.js";
import { fmtDataHora } from "../util.js";

const SIT = { desligado: ["Não conectado", "muted"], conectado: ["Conectado", "ok"], erro: ["Precisa conectar de novo", "bad"] };
const TIPOS = { importante: ["Sempre ler", "ok"], ignorar: ["Ignorar", "muted"], fraude: ["Golpe", "bad"] };
const ALVOS = { remetente: "E-mail de quem manda", dominio: "Domínio (empresa)", nome: "Nome da empresa", assunto: "Trecho do assunto" };
const EXEMPLO = { remetente: "cobranca@fornecedor.com.br", dominio: "fornecedor.com.br", nome: "nome da empresa", assunto: "segunda via" };

/** WhatsApp e e-mail ficam juntos no menu lateral: abas para trocar entre as duas telas */
export const AbasMensagens = ({ ativa }) => html`<${Abas} abas=${[["whatsapp", "WhatsApp"], ["email", "E-mail"]]} ativa=${ativa} onTroca=${k => { location.hash = "#/" + k; }} />`;

export function Email() {
  const { avisar, confirmar } = useApp();
  const [st, setSt] = useState(null), [erro, setErro] = useState(""), [fazendo, setFazendo] = useState("");
  const [envios, setEnvios] = useState(null), [aguardando, setAguardando] = useState(null); // aguardando = conectado_em de antes do login
  const [nova, setNova] = useState({ tipo: "importante", alvo: "remetente", valor: "", obs: "" });
  const vivo = useRef(true);
  const ler = async (limparErro = false) => {
    try {
      const s = await api.email.chamar({ acao: "situacao" });
      if (vivo.current) { setSt(s); if (limparErro) setErro(""); }
      api.email.envios().then(e => vivo.current && setEnvios(e)).catch(() => vivo.current && setEnvios([]));
      return s;
    } catch (e) { if (vivo.current) setErro(e.message); }
  };
  useEffect(() => { ler(true); return () => { vivo.current = false; }; }, []);
  // depois de abrir o login da Microsoft, confere a cada 4 s até conectar (o login vale 10 minutos)
  useEffect(() => {
    if (!aguardando) return;
    const ini = Date.now();
    const t = setInterval(async () => {
      const s = await ler();
      // só termina quando a conexão mudou depois do clique (reconectar não pode parar na conexão antiga)
      const novo = s && s.situacao === "conectado" && s.conectado_em && s.conectado_em !== aguardando.antes;
      if (novo || Date.now() - ini > 600000) { setAguardando(null); clearInterval(t); if (novo) avisar("E-mail conectado."); }
    }, 4000);
    return () => clearInterval(t);
  }, [aguardando]);

  const conectar = async () => {
    setFazendo("conectar"); setErro("");
    try {
      const r = await api.email.chamar({ acao: "conectar" });
      // navegador: nova aba; programa do Windows: abre no navegador do Windows (window.open devolve null de propósito)
      const w = window.open(r.url, "_blank");
      if (w) { try { w.opener = null; } catch (e) {} }
      else if (!window.dtcarDesktop) location.href = r.url; // bloqueador de janelas: abre aqui mesmo (a página de retorno tem o botão para voltar)
      setAguardando({ antes: (st && st.conectado_em) || "" });
    } catch (e) { setErro(e.message); } finally { setFazendo(""); }
  };
  const desconectar = async () => {
    if (!await confirmar({ titulo: "Desconectar e-mail", texto: "O sistema apaga a chave de acesso guardada e o Claude deixa de ler e enviar e-mails da oficina. Para voltar, basta conectar de novo.", botao: "Desconectar", perigo: true })) return;
    setFazendo("desconectar"); setErro("");
    try { await api.email.chamar({ acao: "desconectar" }); await ler(true); avisar("E-mail desconectado."); } catch (e) { setErro(e.message); } finally { setFazendo(""); }
  };
  const ligar = async v => {
    setFazendo("ligar"); setErro("");
    try { await api.email.ligar(v); await ler(true); avisar(v ? "E-mail ligado para o Claude." : "E-mail desligado: o Claude não lê nem envia até ligar de novo."); } catch (e) { setErro(e.message); } finally { setFazendo(""); }
  };
  const salvarRegra = async ev => {
    ev.preventDefault();
    if (!nova.valor.trim()) { setErro("Preencha o valor da regra."); return; }
    setFazendo("regra"); setErro("");
    try { await api.email.chamar({ acao: "regra", ...nova, origem: "danilo" }); setNova({ ...nova, valor: "", obs: "" }); await ler(true); avisar("Regra salva."); }
    catch (e) { setErro(e.message); } finally { setFazendo(""); }
  };
  const removerRegra = async r => {
    if (!await confirmar({ titulo: "Tirar regra", texto: `A regra "${r.valor}" deixa de valer no filtro.`, botao: "Tirar regra", perigo: true })) return;
    setFazendo("regra"); setErro("");
    try { await api.email.chamar({ acao: "remover_regra", id: r.id }); await ler(true); avisar("Regra retirada."); } catch (e) { setErro(e.message); } finally { setFazendo(""); }
  };
  const copiar = async (txt, msg) => { try { await navigator.clipboard.writeText(txt); avisar(msg); } catch (e) { avisar("Não foi possível copiar: selecione o texto e copie.", true); } };

  const [rot, cor] = SIT[(st && st.situacao) || "desligado"] || SIT.desligado;
  const regras = (st && st.lista_regras) || [];
  const porTipo = t => regras.filter(r => r.tipo === t);
  return html`<div class="pagina">
    <${AbasMensagens} ativa="email" />
    <div class="card">
      <h3>E-mail da oficina</h3>
      <p class="sub">O Claude lê e responde o Hotmail da oficina pelo conector, <b>só quando você pede</b>. Toda resposta mostra a prévia antes de sair. Nada é apagado, movido nem marcado como lido na caixa.</p>
      ${!st && !erro ? html`<p class="sub">Carregando…</p>` : null}
      ${st ? html`<ul class="res-lista email-situacao">
        <li>Situação: <span class=${"pill p-" + cor}>${rot}</span>${st.ligado === false ? html` <span class="pill p-bad">Desligado pela chave</span>` : null}</li>
        <li>Conta: <b>${st.conta || "—"}</b>${st.nome ? " (" + st.nome + ")" : ""}</li>
        ${st.conectado_em ? html`<li>Conectado em ${fmtDataHora(st.conectado_em)}${st.ultimo_uso ? " · último uso " + fmtDataHora(st.ultimo_uso) : ""}</li>` : null}
        <li>Enviados hoje: <b>${st.enviados_hoje || 0}</b> · regras do filtro: <b>${st.regras || 0}</b></li>
        ${st.detalhe ? html`<li>Último aviso: ${st.detalhe}</li>` : null}
      </ul>` : null}
      ${erro ? html`<div class="aviso" role="alert">${erro}</div>` : null}
      ${st && st.configurado ? html`<div class="acoes">
        <button type="button" class="btn btn-pri" disabled=${!!fazendo} onClick=${conectar}>${fazendo === "conectar" ? "Abrindo…" : st.situacao === "conectado" ? "Conectar outra vez" : "Conectar Hotmail"}</button>
        ${st.situacao !== "desligado" ? html`<button type="button" class="btn btn-perigo" disabled=${!!fazendo} onClick=${desconectar}>Desconectar</button>` : null}
      </div>
      ${aguardando ? html`<p class="sub" role="status">Entre com a conta da oficina na janela da Microsoft e autorize. Esta tela atualiza sozinha quando terminar.</p>` : null}
      <label class="linha-check"><input type="checkbox" checked=${st.ligado !== false} disabled=${!!fazendo} onChange=${e => ligar(e.target.checked)} /><span>Ligado para o Claude (desligado, ele não lê nem envia nada)</span></label>` : null}
    </div>

    ${st && !st.configurado ? html`<div class="card">
      <h3>Antes de conectar: registro na Microsoft (uma vez só, uns 15 minutos)</h3>
      <p class="sub">A Microsoft exige um "registro de aplicativo" gratuito para o sistema pedir acesso ao Hotmail. Ele fica no portal Entra, numa conta Azure gratuita.</p>
      <ol class="passos-email">
        <li>Entre em <b>entra.microsoft.com</b> › Identidade › Aplicativos › <b>Registros de aplicativo</b> › Novo registro.</li>
        <li>Nome: <b>DTCar Gestão</b>. Tipos de conta: <b>Somente contas pessoais da Microsoft</b> (ou "qualquer diretório e contas pessoais").</li>
        <li>URI de redirecionamento: plataforma <b>Web</b> com o endereço abaixo. Clique em Registrar.</li>
        <li>Em <b>Certificados e segredos</b> › Novo segredo do cliente, validade de 24 meses. Copie o <b>Valor</b> na hora (ele só aparece uma vez) e anote a data de vencimento: antes dela, é preciso gerar outro.</li>
        <li>Em <b>Permissões de API</b>, confira que estão Microsoft Graph › Delegadas: <b>Mail.Read</b>, <b>Mail.Send</b>, <b>User.Read</b> e <b>offline_access</b>.</li>
        <li>Cadastre no Supabase › Edge Functions › Secrets: <b>MS_CLIENT_ID</b> = "ID do aplicativo (cliente)" e <b>MS_CLIENT_SECRET</b> = o valor do segredo.</li>
        <li>Volte aqui e toque em Conectar Hotmail.</li>
      </ol>
      <p class="sub">Endereço de retorno (copie exatamente):</p>
      <input class="inp" readonly value=${st.endereco_retorno || ""} onFocus=${e => e.target.select()} aria-label="Endereço de retorno do login" />
      <div class="acoes"><button type="button" class="btn" onClick=${() => copiar(st.endereco_retorno || "", "Endereço copiado.")}>Copiar endereço</button></div>
    </div>` : null}

    <div class="card">
      <h3>Filtro</h3>
      <p class="sub">Por padrão o Claude lê só: e-mails de quem está cadastrado no sistema (fornecedores, prestadores, clientes e equipe), os da lista "Sempre ler" e os que trazem nota fiscal (XML), boleto, cobrança, orçamento ou pedido. Propaganda, caixa "Outros" e lixo eletrônico ficam de fora. Golpes conhecidos viram alerta.</p>
      <p class="sub">Para corrigir, também dá para falar com o Claude: "esse é importante", "ignora esse remetente".</p>
      ${st ? Object.keys(TIPOS).map(t => { const [nome, c] = TIPOS[t]; const l = porTipo(t); return html`<div key=${t} class="email-regras">
        <h4><span class=${"pill p-" + c}>${nome}</span> <span class="sub">${l.length}</span></h4>
        ${!l.length ? html`<p class="sub">Nenhuma.</p>` : html`<ul class="res-lista">${l.map(r => html`<li key=${r.id}>
          <b>${r.valor}</b> <span class="sub">· ${ALVOS[r.alvo] || r.alvo}${r.obs ? " · " + r.obs : ""}${r.origem === "padrao" ? " · de fábrica" : ""}</span>
          <button type="button" class="btn btn-sm" disabled=${!!fazendo} onClick=${() => removerRegra(r)} aria-label=${"Tirar regra " + r.valor}>Tirar</button>
        </li>`)}</ul>`}
      </div>`; }) : null}
      ${st ? html`<form class="email-nova-regra" onSubmit=${salvarRegra}>
        <h4>Nova regra</h4>
        <div class="email-campos">
          <label>Tipo<select class="inp" value=${nova.tipo} onChange=${e => setNova({ ...nova, tipo: e.target.value })}>
            ${Object.entries(TIPOS).map(([v, [n]]) => html`<option value=${v}>${n}</option>`)}</select></label>
          <label>Pelo quê<select class="inp" value=${nova.alvo} onChange=${e => setNova({ ...nova, alvo: e.target.value })}>
            ${Object.entries(ALVOS).map(([v, n]) => html`<option value=${v}>${n}</option>`)}</select></label>
          <label>Valor<input class="inp" value=${nova.valor} placeholder=${EXEMPLO[nova.alvo]} onInput=${e => setNova({ ...nova, valor: e.target.value })} /></label>
          <label>Observação<input class="inp" value=${nova.obs} placeholder="ex.: fornecedor de pneus" onInput=${e => setNova({ ...nova, obs: e.target.value })} /></label>
        </div>
        <div class="acoes"><button type="submit" class="btn btn-pri" disabled=${!!fazendo}>${fazendo === "regra" ? "Salvando…" : "Salvar regra"}</button></div>
      </form>` : null}
    </div>

    <div class="card">
      <h3>Enviados pelo Claude</h3>
      ${envios === null ? html`<p class="sub">Carregando…</p>` : !envios.length ? html`<p class="sub">Nenhum e-mail enviado ainda.</p>` : html`<ul class="res-lista email-envios">
        ${envios.map(e => html`<li key=${e.id}><div><span class="pill p-info">${e.tipo === "responder" ? "Resposta" : "Novo"}</span> <b>${e.assunto || "(sem assunto)"}</b> <span class="sub">· ${fmtDataHora(e.em)} · para ${e.para}${e.por ? " · confirmado por " + e.por : ""}</span></div>
          <div class="zap-texto">${e.resumo}</div></li>`)}</ul>`}
    </div>
  </div>`;
}
