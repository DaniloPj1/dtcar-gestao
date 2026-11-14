// Consulta do veículo pela placa (v55 + função "placa" do Supabase: API Placas — apiplacas.com.br).
// REGRA DO DANILO (13/11/2026): só vai à API quando o sistema ainda não tem os dados.
//   - Placa que já está no cadastro: as telas usam o cadastro e nem chamam a função.
//   - Placa nova: a função ainda confere o cadastro e a cópia das consultas já pagas antes de pagar outra.
// A busca automática (ao digitar a placa) é sempre a "básica" (marca, modelo, anos, cor, combustível, motor) e pode ser
// desligada em Ajustes (cfg.placaAuto = false). A "completa" (chassi, Renavam, nº do motor) só sai pelo botão, na ficha do veículo,
// e só para o administrador (regra do Danilo, 14/11/2026): para o resto da equipe a função devolve só o básico, mesmo da cópia da completa.
// A busca só preenche campo em branco: nunca troca o que a pessoa digitou.
import { html, useState, useEffect, useRef } from "./lib.js";
import { api } from "./api.js";
import { useApp } from "./ui.js";
import { normPlaca, placaValida, reais } from "./util.js";

/** Preços de tabela do API Placas (13/11/2026), só para os textos da tela; o valor cobrado de verdade vem na resposta */
export const PRECO_PLACA = { basico: 0.03, completa: 0.2 };
/** Abaixo disto (centavos) a tela avisa que o saldo do API Placas está acabando */
const SALDO_BAIXO = 100;

// o que já foi respondido nesta sessão (a mesma placa não chama a função duas vezes enquanto o programa está aberto)
const vistas = new Map();
// função desligada (sem chave / não publicada) ou sem saldo: a busca automática não insiste por 5 minutos;
// servidor sem resposta (conexão, ou função ainda não publicada que o navegador não deixa ler): não insiste por 1 minuto
let pausa = { ate: 0, r: null };

/**
 * Chama a função "placa". Nunca lança erro. Devolve
 * { ok: true, encontrado, dados, origem: "cadastro" | "copia" | "api", valor_centavos, saldo_centavos?, no_cadastro?, veiculo_id? }
 * ou { ok: false, erro, desligada?, sem_saldo?, semRede? }.
 * op.forcar: completa de novo (paga outra vez); op.manual: pedido por botão (não respeita a pausa da busca automática).
 */
export async function consultarPlaca(placa, tipo = "basico", op = {}) {
  const p = normPlaca(placa), chave = tipo + ":" + p;
  if (!placaValida(p)) return { ok: false, erro: "Placa inválida. Use o formato ABC1234 ou ABC1D23." };
  // já respondida com o programa aberto: devolve a mesma resposta, agora sem custo (não foi paga de novo)
  if (!op.forcar && vistas.has(chave)) { const v = vistas.get(chave); return v.origem === "api" ? { ...v, origem: "copia", valor_centavos: 0 } : v; }
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { ok: false, semRede: true, erro: "Sem internet agora." };
  if (!api.placa) return { ok: false, desligada: true, erro: "Consulta de placa indisponível." };
  if (!op.manual && pausa.r && Date.now() < pausa.ate) return pausa.r;
  let r;
  try { r = await api.placa({ acao: tipo, placa: p, ...(op.forcar ? { forcar: true } : {}) }); }
  catch (e) { r = { ok: false, erro: (e && e.message) || "Falha na consulta da placa." }; }
  r = r && typeof r === "object" ? r : { ok: false, erro: "Falha na consulta da placa." };
  if (r.ok !== true) r = { ...r, ok: false, erro: r.erro || "Falha na consulta da placa." };
  if (r.ok) {
    pausa = { ate: 0, r: null };
    vistas.set(tipo + ":" + p, r);
    if (tipo === "completa" && r.encontrado) vistas.set("basico:" + p, r);   // a completa já traz o básico
  } else if (r.desligada || r.sem_saldo) pausa = { ate: Date.now() + 5 * 60000, r };
  else if (r.semRede) pausa = { ate: Date.now() + 60000, r };
  return r;
}

/** Junta o que veio da consulta só nos campos em branco (nunca troca o que a pessoa digitou) */
export const soVazios = (atual, novo) => {
  const o = { ...atual };
  for (const k of Object.keys(novo)) if ((o[k] === "" || o[k] === null || o[k] === undefined) && novo[k] !== "" && novo[k] !== null && novo[k] !== undefined) o[k] = novo[k];
  return o;
};
/** Desfaz o preenchimento: esvazia os campos que ainda estão iguais ao que a consulta trouxe (a placa foi trocada) */
export const tirarPreenchidos = (atual, preenchido) => {
  const o = { ...atual };
  for (const k of Object.keys(preenchido || {})) if (preenchido[k] !== "" && preenchido[k] !== null && preenchido[k] !== undefined && String(o[k] ?? "") === String(preenchido[k])) o[k] = "";
  return o;
};
/** Quais campos de `novo` entrariam em `atual` (para dizer na tela o que foi preenchido) */
export const camposNovos = (atual, novo) => Object.keys(novo).filter(k => (atual[k] === "" || atual[k] === null || atual[k] === undefined) && novo[k] !== "" && novo[k] !== null && novo[k] !== undefined);

/** Dados da consulta nos nomes do cadastro de veículos (ficha completa) */
export const paraFicha = d => ({ marca: d.marca || "", modelo: d.modelo || "", ano_fab: d.ano_fab || "", ano_mod: d.ano_mod || d.ano_fab || "", cor: d.cor || "",
  combustivel: d.combustivel || "", motor: d.motor || "", chassi: d.chassi || "", renavam: d.renavam || "" });
/** Dados da consulta para as telas que guardam marca, modelo e um ano só (Nova O.S., orçamento, agenda) */
export const paraResumo = d => ({ marca: d.marca || "", modelo: d.modelo || "", ano: String(d.ano_mod || d.ano_fab || ""), cor: d.cor || "", motor: d.motor || "", combustivel: d.combustivel || "" });
/** "2007/2008" (fabricação/modelo), como no cadastro */
export const anoFabMod = (f, m) => { f = +f || 0; m = +m || 0; return f && m && f !== m ? f + "/" + m : String(m || f || ""); };

/** Aviso de saldo acabando, para a resposta de uma consulta paga */
export const avisoSaldo = r => r && r.origem === "api" && typeof r.saldo_centavos === "number" && r.saldo_centavos < SALDO_BAIXO
  ? "Saldo da consulta de placa acabando (" + reais(r.saldo_centavos / 100) + "). Coloque saldo em apiplacas.com.br." : "";

/**
 * A busca pela placa numa tela (Nova O.S., ficha do veículo, orçamento, agenda).
 *   falta    — a tela NÃO tem os dados: placa fora do cadastro e marca/modelo em branco;
 *   auto     — a busca automática está ligada (Ajustes: cfg.placaAuto !== false);
 *   onDados(dados, resposta) — a consulta achou o veículo: a tela preenche o que está em branco;
 *   onTrocou(dados)          — a placa mudou depois de um preenchimento: a tela desfaz o que a consulta tinha posto.
 * Devolve { estado: "" | "buscando" | "achou" | "nao" | "erro" | "saldo" | "quieto", msg, aviso, botao, buscar }:
 * `botao` diz se cabe mostrar "Buscar dados pela placa" (busca automática desligada ou que não deu certo) e `buscar()` busca na hora.
 */
export function usePlaca(placa, { falta, auto = true, onDados, onTrocou } = {}) {
  const app = useApp();
  const [c, setC] = useState({ estado: "", msg: "", placa: "" });
  const fn = useRef(null); fn.current = { onDados, onTrocou };
  const feito = useRef(null);   // { placa, dados } do último preenchimento
  const tentada = useRef("");   // placa em que a busca sozinha já rodou: não roda de novo (quem apagou os campos não é atropelado)
  const vivo = useRef(true);
  useEffect(() => () => { vivo.current = false; }, []);
  const p = normPlaca(placa), valida = placaValida(p), ativo = !!(falta && auto && valida);
  const aplicar = (r, manual) => {
    if (r.ok && r.encontrado) {
      feito.current = { placa: p, dados: r.dados || {} }; fn.current.onDados && fn.current.onDados(r.dados || {}, r); setC({ estado: "achou", msg: "", placa: p, aviso: avisoSaldo(r) });
      // o servidor respondeu pelo cadastro: a lista de veículos deste aparelho está atrasada (outro aparelho acabou de cadastrar)
      if (r.origem === "cadastro" && app && app.recarregar) Promise.resolve(app.recarregar(["veiculos", "clientes"])).catch(() => {});
    }
    else if (r.ok) setC({ estado: "nao", msg: "", placa: p });
    else if (r.sem_saldo) setC({ estado: "saldo", msg: r.erro || "", placa: p });
    // sem internet ou consulta ainda não ligada: na busca sozinha a tela segue como sempre foi (sem aviso); pelo botão, diz o motivo
    else if ((r.semRede || r.desligada) && !manual) setC({ estado: "quieto", msg: "", placa: p });
    else setC({ estado: "erro", msg: r.erro || "", placa: p });
  };
  useEffect(() => {   // a placa mudou: o que veio da placa antiga sai dos campos
    if (feito.current && feito.current.placa !== p) { const d = feito.current.dados; feito.current = null; fn.current.onTrocou && fn.current.onTrocou(d); }
    if (tentada.current && tentada.current !== p) tentada.current = "";
  }, [p]);
  useEffect(() => {
    if (!ativo || tentada.current === p) { setC(x => (x.estado === "buscando" ? { estado: "", msg: "", placa: "" } : x)); return; }
    let aqui = true;
    const t = setTimeout(async () => {
      setC({ estado: "buscando", msg: "", placa: p });
      const r = await consultarPlaca(p, "basico");
      if (aqui && vivo.current) { tentada.current = p; aplicar(r, false); }
    }, 500);
    return () => { aqui = false; clearTimeout(t); };
  }, [p, ativo]);
  const buscar = async () => {
    if (!valida) return;
    setC({ estado: "buscando", msg: "", placa: p });
    const r = await consultarPlaca(p, "basico", { manual: true });
    if (vivo.current) { tentada.current = p; aplicar(r, true); }
  };
  let atual = c.placa === p ? c : { estado: "", msg: "", placa: p };
  if (atual.estado === "achou" && falta) atual = { ...atual, estado: "quieto" };   // preencheu e a pessoa apagou: sem aviso, com o botão
  // o botão aparece quando falta dado e a busca sozinha está desligada, não deu certo ou já rodou para esta placa
  const botao = !!(falta && valida) && !["buscando", "nao"].includes(atual.estado) && (auto ? atual.estado !== "" || tentada.current === p : true);
  return { ...atual, buscar, botao };
}

/** Linha de aviso da busca pela placa */
export function PlacaAviso({ c }) {
  if (!c || !c.estado || c.estado === "quieto") return null;
  if (c.estado === "buscando") return html`<span class="dica placa-aviso" role="status">Buscando os dados do veículo pela placa…</span>`;
  if (c.estado === "achou") return html`<span class="dica placa-aviso" role="status">Dados preenchidos pela placa. Confira.${c.aviso ? html` <b>${c.aviso}</b>` : null}</span>`;
  if (c.estado === "nao") return html`<span class="dica placa-aviso" role="status">A consulta não achou esta placa. Preencha os dados à mão.</span>`;
  if (c.estado === "saldo") return html`<span class="dica placa-aviso" role="status">Acabou o saldo da consulta de placa: preencha à mão. Para voltar a buscar, coloque saldo em apiplacas.com.br.</span>`;
  return html`<span class="dica placa-aviso" role="status">Não deu para buscar pela placa: ${String(c.msg || "tente de novo").replace(/\.$/, "")}. Preencha à mão.</span>`;
}
/** Aviso + botão "Buscar dados pela placa" (o botão só aparece com a busca automática desligada ou quando ela não deu certo) */
export function PlacaBusca({ c }) {
  if (!c) return null;
  return html`${c.botao ? html`<button type="button" class="btn-link placa-buscar" onClick=${c.buscar}>Buscar dados pela placa</button>` : null}<${PlacaAviso} c=${c} />`;
}

/* ---------------- Ajustes: situação da consulta pela placa (só administrador) ---------------- */
const inicioDoMes = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString(); };
const inicioDoDia = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString(); };

/** Cartão da tela Ajustes: ligada ou não, saldo no API Placas, consultas e gasto do mês, e a chave da busca automática */
export function CartaoPlaca({ auto, onAuto }) {
  const [s, setS] = useState(null), [uso, setUso] = useState(null), [lendo, setLendo] = useState(false);
  const ler = async () => {
    setLendo(true);
    let r;
    try { r = api.placa ? await api.placa({ acao: "saldo" }) : { ok: false, desligada: true, erro: "Consulta de placa indisponível." }; }
    catch (e) { r = { ok: false, erro: (e && e.message) || "Falha ao ler o saldo." }; }
    setS(r || { ok: false, erro: "Falha ao ler o saldo." });
    if (r && r.ok) pausa = { ate: 0, r: null };   // voltou a funcionar: a busca sozinha das telas não espera os 5 minutos
    try { setUso(api.placaUso ? await api.placaUso(inicioDoMes()) : []); } catch (e) { setUso(null); }
    setLendo(false);
  };
  useEffect(() => { ler(); }, []);
  const hoje = inicioDoDia(), mes = uso || [], doDia = mes.filter(x => x.em >= hoje);
  const soma = l => l.reduce((t, x) => t + (Number(x.valor_centavos) || 0), 0) / 100;
  const completas = mes.filter(x => x.tipo === "completa").length;
  return html`<section class="card" id="cartao-placa"><h2>Consulta do veículo pela placa</h2>
    <span class="sub">Busca marca, modelo, ano, cor e combustível no API Placas quando a placa ainda não está no cadastro. Só é cobrado o que o sistema não tem.</span>
    ${!s ? html`<p class="dica">Conferindo…</p>`
      : s.ok ? html`<div class="placa-situacao"><span class="placa-ok">Ligada</span>
          <span>Saldo no API Placas: <b>${s.saldo_formatado || "—"}</b>${typeof s.saldo_centavos === "number" && s.preco ? html` <span class="sub">(dá para cerca de ${Math.floor(s.saldo_centavos / (s.preco.basico || 3))} consultas básicas)</span>` : null}</span></div>
          ${typeof s.saldo_centavos === "number" && s.saldo_centavos < SALDO_BAIXO ? html`<div class="aviso">Saldo acabando. Quando zerar, as telas voltam a pedir os dados à mão. Coloque saldo em <a href="https://apiplacas.com.br/dashboard" target="_blank" rel="noopener">apiplacas.com.br</a>.</div>` : null}`
      : html`<div class=${s.desligada ? "aviso" : "erros"}><b>${s.desligada ? "Ainda não está ligada." : "Não deu para conferir."}</b> ${s.erro}</div>`}
    ${uso ? html`<p class="placa-uso">Este mês: <b>${mes.length}</b> ${mes.length === 1 ? "consulta paga" : "consultas pagas"}${completas ? ` (${completas} ${completas === 1 ? "completa" : "completas"})` : ""}, <b>${reais(soma(mes))}</b>.
      Hoje: ${doDia.length}${s && s.limite_dia ? " de " + s.limite_dia + " (limite de proteção do saldo)" : ""}.</p>` : null}
    <label class="linha-check"><input type="checkbox" checked=${auto !== false} onChange=${e => onAuto(e.target.checked)} />
      <span>Buscar sozinho ao digitar uma placa que não está no cadastro (${reais(PRECO_PLACA.basico)} por placa nova)</span></label>
    <span class="dica">A consulta completa (chassi, Renavam e nº do motor, ${reais(PRECO_PLACA.completa)}) é só do administrador, sempre pelo botão, na ficha do veículo.</span>
    <div class="acoes"><button type="button" class="btn btn-sm" disabled=${lendo} onClick=${ler}>${lendo ? "Conferindo…" : "Conferir de novo"}</button>
      <a class="btn btn-sm" href="https://apiplacas.com.br/dashboard" target="_blank" rel="noopener">Abrir o painel do API Placas</a></div>
  </section>`;
}
