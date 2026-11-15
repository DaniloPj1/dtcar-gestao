// Consulta do cliente pelo CPF (função "cpf" do Supabase: API CPF — apicpf.com). Pedido do Danilo em 15/11/2026.
// REGRA DO DANILO (a mesma da placa): só vai à API quando o sistema ainda não tem os dados.
//   - CPF que já está no cadastro: as telas avisam que o cliente existe e nem chamam a função.
//   - CPF novo e nome em branco: busca o nome e a data de nascimento e preenche SÓ o que está em branco.
// SÓ O ADMINISTRADOR consulta (decisão do Danilo): para os outros papéis a tela continua como sempre foi.
// Nada da consulta fica guardado: vai para o cadastro só o que a pessoa salvar.
import { html, useState, useEffect, useRef } from "./lib.js";
import { api } from "./api.js";
import { soDig, validaCPF } from "./util.js";

// o que já foi respondido com o programa aberto (o mesmo CPF não chama a função duas vezes)
const vistos = new Map();
// função desligada (sem chave, licença vencida, não publicada): a busca sozinha não insiste por 5 minutos; sem resposta ou limite: 1 minuto
let pausa = { ate: 0, r: null };

export const ehAdmin = perfil => !!perfil && perfil.ativo !== false && perfil.papel === "admin";

/**
 * Chama a função "cpf". Nunca lança erro. Devolve
 * { ok: true, encontrado, dados: { nome, nascimento }, origem: "cadastro" | "api", cliente_id?, creditos? }
 * ou { ok: false, erro, desligada?, limite?, semRede? } (CPF fora da base e sem crédito: ok com encontrado=false e sem_creditos).
 * op.manual: pedido por botão (não respeita a pausa da busca sozinha).
 */
export async function consultarCPF(cpf, op = {}) {
  const c = soDig(cpf);
  if (!validaCPF(c)) return { ok: false, erro: "CPF inválido. Confira os 11 números." };
  if (vistos.has(c)) return vistos.get(c);
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { ok: false, semRede: true, erro: "Sem internet agora." };
  if (!api.cpf) return { ok: false, desligada: true, erro: "Consulta de CPF indisponível." };
  if (!op.manual && pausa.r && Date.now() < pausa.ate) return pausa.r;
  let r;
  try { r = await api.cpf({ acao: "consultar", cpf: c }); }
  catch (e) { r = { ok: false, erro: (e && e.message) || "Falha na consulta do CPF." }; }
  r = r && typeof r === "object" ? r : { ok: false, erro: "Falha na consulta do CPF." };
  if (r.ok !== true) r = { ...r, ok: false, erro: r.erro || "Falha na consulta do CPF." };
  if (r.ok) { pausa = { ate: 0, r: null }; if (!r.sem_creditos) vistos.set(c, r); }
  else if (r.desligada) pausa = { ate: Date.now() + 5 * 60000, r };
  else if (r.semRede || r.limite) pausa = { ate: Date.now() + 60000, r };
  return r;
}

/** Dados da consulta nos nomes do cadastro de clientes */
export const paraCliente = d => ({ nome: (d && d.nome) || "", nascimento: (d && d.nascimento) || "" });

/**
 * A busca pelo CPF numa tela (cadastro de cliente e Nova O.S.).
 *   falta — a tela NÃO tem os dados: CPF fora do cadastro e nome em branco;
 *   pode  — quem está usando é o administrador;
 *   auto  — a busca sozinha está ligada (Ajustes: cfg.cpfAuto !== false);
 *   onDados(dados, resposta) — achou a pessoa: a tela preenche o que está em branco;
 *   onTrocou(dados)          — o CPF mudou depois de um preenchimento: a tela tira o que a consulta tinha posto.
 * Devolve { estado: "" | "buscando" | "achou" | "nao" | "creditos" | "erro" | "quieto", msg, botao, buscar }.
 */
export function useCPF(doc, { falta, pode, auto = true, onDados, onTrocou } = {}) {
  const [c, setC] = useState({ estado: "", msg: "", cpf: "" });
  const fn = useRef(null); fn.current = { onDados, onTrocou };
  const feito = useRef(null), tentado = useRef(""), vivo = useRef(true);
  useEffect(() => () => { vivo.current = false; }, []);
  const d = soDig(doc), valido = d.length === 11 && validaCPF(d), ativo = !!(pode && falta && auto && valido);
  const aplicar = (r, manual) => {
    if (r.ok && r.encontrado) { feito.current = { cpf: d, dados: paraCliente(r.dados) }; fn.current.onDados && fn.current.onDados(paraCliente(r.dados), r); setC({ estado: "achou", msg: "", cpf: d }); }
    else if (r.ok && r.sem_creditos) setC({ estado: "creditos", msg: "", cpf: d });
    else if (r.ok) setC({ estado: "nao", msg: "", cpf: d });
    // sem internet ou consulta ainda não ligada: na busca sozinha a tela segue como sempre foi (sem aviso); pelo botão, diz o motivo
    // (chave vencida é diferente: só o administrador consulta e é ele quem troca a chave, então a tela avisa na hora)
    else if ((r.semRede || (r.desligada && !r.vencida)) && !manual) setC({ estado: "quieto", msg: "", cpf: d });
    else setC({ estado: "erro", msg: r.erro || "", cpf: d });
  };
  useEffect(() => {   // o CPF mudou: o que veio do CPF antigo sai dos campos
    if (feito.current && feito.current.cpf !== d) { const x = feito.current.dados; feito.current = null; fn.current.onTrocou && fn.current.onTrocou(x); }
    if (tentado.current && tentado.current !== d) tentado.current = "";
  }, [d]);
  useEffect(() => {
    if (!ativo || tentado.current === d) { setC(x => (x.estado === "buscando" ? { estado: "", msg: "", cpf: "" } : x)); return; }
    let aqui = true;
    const t = setTimeout(async () => {
      setC({ estado: "buscando", msg: "", cpf: d });
      const r = await consultarCPF(d);
      if (aqui && vivo.current) { tentado.current = d; aplicar(r, false); }
    }, 500);
    return () => { aqui = false; clearTimeout(t); };
  }, [d, ativo]);
  const buscar = async () => {
    if (!valido || !pode) return;
    setC({ estado: "buscando", msg: "", cpf: d });
    const r = await consultarCPF(d, { manual: true });
    if (vivo.current) { tentado.current = d; aplicar(r, true); }
  };
  let atual = c.cpf === d ? c : { estado: "", msg: "", cpf: d };
  if (atual.estado === "achou" && falta) atual = { ...atual, estado: "quieto" };   // preencheu e a pessoa apagou: sem aviso, com o botão
  const botao = !!(pode && falta && valido) && !["buscando", "nao", "creditos"].includes(atual.estado) && (auto ? atual.estado !== "" || tentado.current === d : true);
  return { ...atual, buscar, botao };
}

/** Aviso + botão "Buscar nome pelo CPF" (o botão só aparece com a busca sozinha desligada ou quando ela não deu certo) */
export function CpfBusca({ c }) {
  if (!c) return null;
  const e = c.estado;
  const aviso = !e || e === "quieto" ? null
    : e === "buscando" ? "Buscando o nome pelo CPF…"
    : e === "achou" ? "Nome preenchido pelo CPF. Confira."
    : e === "nao" ? "A consulta não achou este CPF. Preencha o nome à mão."
    : e === "creditos" ? "A consulta não tem este CPF e os créditos da busca externa acabaram. Preencha o nome à mão."
    : "Não deu para buscar pelo CPF: " + String(c.msg || "tente de novo").replace(/\.$/, "") + ". Preencha à mão.";
  if (!aviso && !c.botao) return null;
  return html`<div class="placa-linha cpf-linha">${c.botao ? html`<button type="button" class="btn-link placa-buscar cpf-buscar" onClick=${c.buscar}>Buscar nome pelo CPF</button>` : null}
    ${aviso ? html`<span class="dica placa-aviso cpf-aviso" role="status">${aviso}</span>` : null}</div>`;
}

/* ---------------- Ajustes: situação da consulta pelo CPF e cadastro da chave (só administrador) ---------------- */
const dataBR = iso => { const d = iso ? new Date(iso) : null; return d && !isNaN(d) ? d.toLocaleDateString("pt-BR") : ""; };

/** Cartão da tela Ajustes: ligada ou não, desde quando a chave está cadastrada, o campo para cadastrar a chave nova
 *  (a do plano grátis vence todo mês) e a chave da busca sozinha. A chave digitada vai direto para a função "cpf",
 *  que confere e guarda no servidor; ela nunca volta para a tela. */
export function CartaoCPF({ auto, onAuto }) {
  const [s, setS] = useState(null), [lendo, setLendo] = useState(false);
  const [chave, setChave] = useState(""), [gravando, setGravando] = useState(false), [msg, setMsg] = useState(null);
  const chamar = async body => {
    try { return (api.cpf ? await api.cpf(body) : null) || { ok: false, desligada: true, erro: "Consulta de CPF indisponível." }; }
    catch (e) { return { ok: false, erro: (e && e.message) || "Falha ao falar com a consulta de CPF." }; }
  };
  const ler = async () => { setLendo(true); const r = await chamar({ acao: "situacao" }); setS(r); if (r.ok) pausa = { ate: 0, r: null }; setLendo(false); };
  useEffect(() => { ler(); }, []);
  const gravar = async () => {
    const c = chave.trim();
    if (c.length < 16 || /\s/.test(c)) { setMsg({ erro: true, t: "Cole a chave inteira, como aparece no painel da API CPF (sem espaços)." }); return; }
    setGravando(true); setMsg(null);
    const r = await chamar({ acao: "gravar_chave", chave: c });
    setGravando(false);
    if (r.ok) {
      setChave(""); pausa = { ate: 0, r: null }; setS(r);
      setMsg({ t: r.conferida === false ? "Chave gravada. A API CPF não respondeu agora para conferir: faça uma consulta para testar." : "Chave gravada e aceita pela API CPF." });
    } else setMsg({ erro: true, t: r.semRede ? "Sem resposta do servidor. Confira a internet e se a função \"cpf\" já foi publicada no Supabase." : r.erro || "Não deu para gravar a chave." });
  };
  const naoPublicada = s && !s.ok && s.semRede;
  return html`<section class="card" id="cartao-cpf"><h2>Consulta do cliente pelo CPF</h2>
    <span class="sub">Busca o nome e a data de nascimento na API CPF quando o CPF ainda não está no cadastro. Só o administrador consulta. Nada da consulta fica guardado: só o que for salvo no cadastro do cliente.</span>
    ${!s ? html`<p class="dica">Conferindo…</p>`
      : s.ok ? html`<div class="placa-situacao"><span class="placa-ok">Ligada</span>
          <span id="cpf-chave-em">${s.origem === "ajustes" ? "Chave cadastrada" + (dataBR(s.chave_em) ? " em " + dataBR(s.chave_em) : "") + "." : "Usando a chave gravada no Supabase."} Plano grátis: 100 consultas por dia.</span></div>`
      : html`<div class=${s.desligada ? "aviso" : "erros"}><b>${s.desligada ? "Ainda não está ligada." : "Não deu para conferir."}</b> ${s.erro}</div>`}
    <div class="campo cpf-chave">
      <label for="cpf-chave">${s && s.ok ? "Trocar a chave da API CPF" : "Chave da API CPF"}</label>
      <span class="dica">A chave do plano grátis vence todo mês. Quando vencer, renove no painel da API CPF, copie a chave em “Minhas Chaves API” e cole aqui. Ela fica guardada no servidor e não aparece de novo na tela.</span>
      <div class="linha-add"><input id="cpf-chave" class="inp" type="password" autocomplete="off" spellcheck="false" placeholder="Cole a chave aqui" value=${chave} disabled=${gravando}
          onInput=${e => { setChave(e.target.value); setMsg(null); }} onKeyDown=${e => { if (e.key === "Enter") { e.preventDefault(); gravar(); } }} />
        <button type="button" class="btn" id="cpf-gravar-chave" disabled=${gravando || !chave.trim()} onClick=${gravar}>${gravando ? "Conferindo…" : "Gravar chave"}</button></div>
      ${msg ? html`<span class=${msg.erro ? "dica cpf-msg cpf-msg-erro" : "dica cpf-msg cpf-msg-ok"} role="status">${msg.t}</span>` : null}
      ${naoPublicada ? html`<span class="dica">Se a função “cpf” ainda não foi publicada no Supabase, a chave só pode ser gravada depois disso.</span>` : null}
    </div>
    <label class="linha-check"><input type="checkbox" checked=${auto !== false} onChange=${e => onAuto(e.target.checked)} />
      <span>Buscar sozinho ao digitar um CPF que não está no cadastro, quando o nome está em branco</span></label>
    <div class="acoes"><button type="button" class="btn btn-sm" disabled=${lendo} onClick=${ler}>${lendo ? "Conferindo…" : "Conferir de novo"}</button>
      <a class="btn btn-sm" href="https://www.apicpf.com/dashboard" target="_blank" rel="noopener">Abrir o painel da API CPF</a></div>
  </section>`;
}
