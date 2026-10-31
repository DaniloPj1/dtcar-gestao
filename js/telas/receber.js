// Contas a receber: prazo e parcelas das O.S. entregues para pagar depois (boleto, promissória…),
// baixa com recibo e alertas de vencimento. Tabela "receber" do supabase/v12.sql.
import { html, useState, useEffect, useMemo } from "../lib.js";
import { api } from "../api.js";
import { useApp, Campo, Modal, Seg, Dinheiro, Vazio, Abas } from "../ui.js";
import { reais, fmtData, hojeISO, somaDias, arred, soDig, norm, numOS, linkWhats, fmtTel } from "../util.js";
import { pode } from "../regras.js";
import { referenteOS } from "./recibos.js";

const DIA = 86400000;
export const diasAte = iso => Math.round((new Date(iso + "T12:00:00") - new Date(hojeISO() + "T12:00:00")) / DIA);
export const PARCELAVEIS = ["Boleto", "Promissória", "Cheque", "Cartão de crédito"];
export const formasReceber = cfg => [...new Set([...(cfg.formasPagamento || []), "Boleto", "Promissória"])];
export const situacaoParcela = p => {
  if (p.status === "paga") return { t: "Recebida em " + fmtData(p.pago_em), cor: "ok", g: "paga" };
  if (p.status === "cancelada") return { t: "Cancelada", cor: "muted", g: "cancelada" };
  const d = diasAte(p.vencimento);
  if (d < 0) return { t: "Vencida há " + -d + (d === -1 ? " dia" : " dias"), cor: "bad", g: "vencida" };
  if (d === 0) return { t: "Vence hoje", cor: "warn", g: "hoje" };
  if (d <= 7) return { t: "Vence em " + d + (d === 1 ? " dia" : " dias"), cor: "info", g: "semana" };
  return { t: "Vence " + fmtData(p.vencimento), cor: "muted", g: "depois" };
};
/** Parcelas abertas por O.S. (para a lista e os alertas) */
export const parcelasDaOrdem = (dados, oid) => (dados.receber || []).filter(p => p.ordem_id === oid && p.status === "aberta").sort((a, b) => a.vencimento.localeCompare(b.vencimento));

/** Divide o saldo em n parcelas (centavos na última) */
export function gerarParcelas(saldo, n, primeiro, intervalo) {
  n = Math.max(1, Math.min(24, parseInt(n, 10) || 1));
  const base = Math.floor(saldo / n * 100) / 100;
  return Array.from({ length: n }, (_, i) => ({ parcela: i + 1, parcelas: n, vencimento: somaDias(primeiro + "T12:00:00", i * (parseInt(intervalo, 10) || 30)), valor: i === n - 1 ? arred(saldo - base * (n - 1)) : base }));
}

/** Prazo e parcelas do "receber depois" (usado na entrega e no Encerrar) */
export function PrazoReceber({ saldo, valor, onMuda }) {
  const { cfg } = useApp();
  const v = valor || {};
  const forma = v.forma || "", n = v.n || 1, primeiro = v.primeiro || somaDias(hojeISO() + "T12:00:00", 30), intervalo = v.intervalo || 30;
  const parcelavel = PARCELAVEIS.includes(forma);
  const parcelas = v.parcelas || gerarParcelas(saldo, parcelavel ? n : 1, primeiro, intervalo);
  const muda = p => { const x = { forma, n, primeiro, intervalo, ...p }; const pv = PARCELAVEIS.includes(x.forma);
    onMuda({ ...x, n: pv ? x.n : 1, parcelas: p.parcelas || gerarParcelas(saldo, pv ? x.n : 1, x.primeiro, x.intervalo) }); };
  useEffect(() => { muda({}); }, [saldo]);
  const soma = arred(parcelas.reduce((s, p) => s + Number(p.valor || 0), 0));
  const mudaParcela = (i, campo, val) => muda({ parcelas: parcelas.map((p, j) => j === i ? { ...p, [campo]: val } : p) });
  return html`<div class="prazo-receber">
    <div class="campo"><label>Como o cliente vai pagar <i>*</i></label><${Seg} rotulo="Forma combinada" opcoes=${formasReceber(cfg).map(x => [x, "info"])} valor=${forma} onEscolha=${f => muda({ forma: f })} /></div>
    <div class="grade">
      ${parcelavel ? html`<${Campo} id="pr-n" rotulo="Quantidade de parcelas"><select id="pr-n" class="inp" value=${n} onChange=${e => muda({ n: +e.target.value })}>${Array.from({ length: 12 }, (_, i) => html`<option value=${i + 1}>${i + 1}x de ${reais(saldo / (i + 1))}</option>`)}</select></${Campo}>` : null}
      <${Campo} id="pr-venc" rotulo=${parcelavel && n > 1 ? "1º vencimento" : "Prazo (vencimento)"}><input id="pr-venc" type="date" class="inp" min=${hojeISO()} value=${primeiro} onInput=${e => e.target.value && muda({ primeiro: e.target.value })} /></${Campo}>
      ${parcelavel && n > 1 ? html`<${Campo} id="pr-int" rotulo="Intervalo entre parcelas"><select id="pr-int" class="inp" value=${intervalo} onChange=${e => muda({ intervalo: +e.target.value })}>${[7, 10, 14, 15, 20, 21, 28, 30, 45, 60].map(d => html`<option value=${d}>${d} dias</option>`)}</select></${Campo}>` : null}
    </div>
    ${parcelas.length > 1 ? html`<table class="tab-parcelas"><thead><tr><th>Parcela</th><th>Vencimento</th><th class="num">Valor</th></tr></thead><tbody>
      ${parcelas.map((p, i) => html`<tr key=${i}><td>${p.parcela}/${p.parcelas}</td><td><input type="date" class="inp" aria-label=${"Vencimento da parcela " + p.parcela} value=${p.vencimento} onInput=${e => e.target.value && mudaParcela(i, "vencimento", e.target.value)} /></td>
        <td class="num"><${Dinheiro} id=${"pr-v" + i} valor=${p.valor} onMuda=${x => mudaParcela(i, "valor", x)} /></td></tr>`)}</tbody>
      <tfoot><tr><td colspan="2">Total</td><td class=${"num" + (Math.abs(soma - saldo) > 0.009 ? " c-bad" : "")}>${reais(soma)}</td></tr></tfoot></table>` : null}
    ${Math.abs(soma - saldo) > 0.009 ? html`<span class="dica erro">A soma das parcelas (${reais(soma)}) é diferente do saldo (${reais(saldo)}).</span>` : null}
  </div>`;
}
/** Confere o prazo antes de gravar: devolve a mensagem de erro ou "" */
export function validarPrazo(v, saldo) {
  if (!v || !v.forma) return "Informe como o cliente vai pagar (forma combinada).";
  if (!v.parcelas || !v.parcelas.length) return "Informe o vencimento.";
  if (v.parcelas.some(p => !p.vencimento)) return "Informe o vencimento de todas as parcelas.";
  if (v.parcelas.some(p => !(Number(p.valor) > 0))) return "Todas as parcelas precisam ter valor.";
  if (Math.abs(v.parcelas.reduce((s, p) => s + Number(p.valor), 0) - saldo) > 0.009) return "A soma das parcelas precisa ser igual ao saldo de " + reais(saldo) + ".";
  return "";
}
/** Grava as parcelas da O.S. e registra no histórico */
export async function lancarParcelas(o, v, perfil) {
  if (!api.receber) return;
  const linhas = v.parcelas.map(p => ({ ordem_id: o.id, cliente_id: o.cliente_id || null, cliente_nome: (o.cliente || {}).nome || "", descricao: numOS(o.numero) + " · " + ((o.veiculo || {}).placa || ""),
    forma: v.forma, parcela: p.parcela, parcelas: p.parcelas, valor: Number(p.valor), vencimento: p.vencimento, criado_por: perfil.nome }));
  await api.receber.lancar(linhas);
  await api.evento(o.id, "prazo", "Pagamento a prazo: " + v.forma + ", " + (linhas.length > 1 ? linhas.length + " parcelas de " + linhas.map(l => reais(l.valor) + " em " + fmtData(l.vencimento)).join("; ") : reais(linhas[0].valor) + " para " + fmtData(linhas[0].vencimento)) + ".", perfil.nome);
}

/** Dá baixa de "v" reais numa parcela. Pagamento parcial: a parcela fica paga com o valor recebido e o restante
 *  vira uma nova parcela em aberto (assim, se o recibo for cancelado, o banco reabre exatamente o que ele pagou). */
export async function baixarParcela(p, v, recibo, perfil) {
  const resto = arred(Number(p.valor) - v);
  if (resto > 0.009) await api.receber.lancar([{ ordem_id: p.ordem_id, cliente_id: p.cliente_id, cliente_nome: p.cliente_nome, descricao: p.descricao, forma: p.forma, parcela: p.parcela, parcelas: p.parcelas,
    valor: resto, vencimento: p.vencimento, obs: "Restante após pagamento parcial de " + reais(v), criado_por: perfil ? perfil.nome : null }]);
  await api.receber.atualizar(p.id, { status: "paga", pago_em: recibo.data || hojeISO(), recibo_id: recibo.id, ...(resto > 0.009 ? { valor: arred(v) } : {}) });
}
/** Recibo emitido pela O.S. (Encerrar, Emitir recibo): abate o valor das parcelas abertas, da mais antiga para a mais nova */
export async function abaterParcelas(ordemId, valor, recibo, perfil) {
  if (!ordemId || !api.receber || (api.temV12 && !api.temV12())) return 0;
  const abertas = (await api.receber.daOrdem(ordemId)).filter(p => p.status === "aberta").sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.parcela - b.parcela);
  let resta = arred(valor);
  for (const p of abertas) { if (resta <= 0.009) break; const v = Math.min(resta, Number(p.valor)); await baixarParcela(p, v, recibo, perfil); resta = arred(resta - v); }
  return arred(valor - resta);
}
/** Quanto do saldo ainda não tem prazo combinado depois de receber "pago" agora (as parcelas abertas são abatidas primeiro) */
export const semPrazo = (saldo, abertas, pago) => { const A = abertas.reduce((s, p) => s + Number(p.valor), 0), V = Number(pago) || 0; return arred(Math.max(0, saldo - V - Math.max(0, A - V))); };

/** Baixa de uma parcela: emite o recibo e marca a parcela como recebida (valor menor deixa o resto em aberto) */
export function ReceberParcelaModal({ parcela, ordem, onFechar, onFeito }) {
  const { cfg, perfil, dados, avisar, recarregar, ir } = useApp();
  const [forma, setForma] = useState(parcela.forma === "Promissória" || parcela.forma === "Boleto" ? "" : parcela.forma || ""), [valor, setValor] = useState(Number(parcela.valor)), [data, setData] = useState(hojeISO());
  const [imprimir, setImprimir] = useState(true), [erro, setErro] = useState(""), [ocupado, setOcupado] = useState(false);
  const juros = arred(Math.max(0, Number(valor) - Number(parcela.valor)));
  const confirmar = async () => {
    if (!forma) return setErro("Informe a forma de pagamento.");
    if (!(Number(valor) > 0)) return setErro("Informe o valor recebido.");
    setOcupado(true);
    try {
      const o = ordem || dados.ordens.find(x => x.id === parcela.ordem_id) || { id: parcela.ordem_id, numero: "", cliente: { nome: parcela.cliente_nome } };
      const cli = dados.clientes.find(c => c.id === (parcela.cliente_id || o.cliente_id));
      const rec = await api.recibos.salvar({ ordem_id: parcela.ordem_id || null, cliente_id: parcela.cliente_id || null, pagador: parcela.cliente_nome || (o.cliente || {}).nome || "", doc: soDig((cli && cli.doc) || ""), valor: Number(valor),
        referente: (o.numero ? referenteOS(o) : "pagamento") + (parcela.parcelas > 1 ? " (parcela " + parcela.parcela + "/" + parcela.parcelas + ")" : ""), forma, data, obs: juros ? "Inclui " + reais(juros) + " de juros/multa." : "", emitido_por: perfil.nome });
      const resto = arred(Number(parcela.valor) - Number(valor));
      await baixarParcela(parcela, Math.min(Number(valor), Number(parcela.valor)), rec, perfil);
      if (parcela.ordem_id) await api.evento(parcela.ordem_id, "recibo", "Parcela " + parcela.parcela + "/" + parcela.parcelas + " recebida: " + reais(valor) + " (" + forma + ")" + (resto > 0.009 ? ". Restam " + reais(resto) + "." : "."), perfil.nome).catch(() => {});
      avisar("Pagamento registrado."); await recarregar(["ordens", "receber"]); onFeito && onFeito();
      if (imprimir) ir("/imprimir/recibo/" + rec.id);
    } catch (e) { setErro(e.message); setOcupado(false); }
  };
  return html`<${Modal} titulo=${"Receber " + (parcela.parcelas > 1 ? "parcela " + parcela.parcela + "/" + parcela.parcelas : "pagamento")} onFechar=${onFechar}>
    <p class="sub">${parcela.cliente_nome} · ${parcela.descricao} · combinado: ${parcela.forma}</p>
    <div class="encerrar-resumo"><div><span>Valor da parcela</span><b>${reais(parcela.valor)}</b></div><div><span>Vencimento</span><b>${fmtData(parcela.vencimento)}</b></div><div class="forte"><span>Situação</span><b>${situacaoParcela(parcela).t}</b></div></div>
    <div class="campo"><label>Forma de pagamento <i>*</i></label><${Seg} rotulo="Forma" opcoes=${formasReceber(cfg).map(x => [x, "info"])} valor=${forma} onEscolha=${v => { setForma(v); setErro(""); }} /></div>
    <div class="grade">
      <${Campo} id="rp-valor" rotulo="Valor recebido" dica=${Number(valor) < Number(parcela.valor) - 0.009 ? "Parcial: ficam " + reais(Number(parcela.valor) - Number(valor)) + " em aberto nesta parcela." : juros ? "Inclui " + reais(juros) + " de juros/multa." : ""}><${Dinheiro} id="rp-valor" valor=${valor} onMuda=${setValor} /></${Campo}>
      <${Campo} id="rp-data" rotulo="Data do recebimento"><input id="rp-data" type="date" class="inp" value=${data} onInput=${e => setData(e.target.value)} /></${Campo}>
    </div>
    <label class="linha-check"><input type="checkbox" checked=${imprimir} onChange=${e => setImprimir(e.target.checked)} /><span>Abrir o recibo para imprimir</span></label>
    ${erro ? html`<div class="erros">${erro}</div>` : null}
    <div class="acoes"><span class="espaco"></span><button type="button" class="btn" onClick=${onFechar}>Voltar</button><button type="button" class="btn btn-pri" disabled=${ocupado} onClick=${confirmar}>${ocupado ? "Registrando…" : "Registrar recebimento"}</button></div>
  </${Modal}>`;
}

const msgCobranca = (p, cfg) => `Olá, ${(p.cliente_nome || "").split(" ")[0]}! Aqui é da ${cfg.nome}.\n\nPassando para lembrar ${diasAte(p.vencimento) < 0 ? "da parcela vencida em" : "da parcela com vencimento em"} *${fmtData(p.vencimento)}* no valor de *${reais(p.valor)}*` +
  ` (${p.descricao}${p.parcelas > 1 ? ", parcela " + p.parcela + "/" + p.parcelas : ""}, ${p.forma}).\n\nSe já pagou, por favor desconsidere. Qualquer dúvida, estamos à disposição.`;

/** Tela Financeiro › Contas a receber */
export function ContasReceber() {
  const { dados, cfg, perfil, ir, recarregar } = useApp();
  const [aba, setAba] = useState("abertas"), [q, setQ] = useState(""), [baixa, setBaixa] = useState(null), [pagas, setPagas] = useState(null), [erro, setErro] = useState("");
  const semTabela = !api.receber || (api.temV12 && !api.temV12()) || erro;
  useEffect(() => { recarregar(["receber"]); }, []);
  useEffect(() => { if (aba === "pagas" && api.receber) api.receber.listar({ status: "paga" }).then(l => setPagas(l.sort((a, b) => (b.pago_em || "").localeCompare(a.pago_em || "")))).catch(e => setErro(e.message)); }, [aba]);
  const abertas = (dados.receber || []).filter(p => p.status === "aberta");
  const filtra = l => l.filter(p => !q || norm(p.cliente_nome).includes(norm(q)) || norm(p.descricao).includes(norm(q)) || norm(p.forma).includes(norm(q)));
  const soma = l => l.reduce((s, p) => s + Number(p.valor), 0);
  const g = k => abertas.filter(p => situacaoParcela(p).g === k);
  const tel = p => { const o = dados.ordens.find(x => x.id === p.ordem_id); const c = dados.clientes.find(x => x.id === p.cliente_id); return (c && c.telefone) || (o && o.cliente && o.cliente.telefone) || ""; };
  const linha = p => { const s = situacaoParcela(p), t = tel(p), d = new Date(p.vencimento + "T12:00:00");
    return html`<div class=${"linha conta-linha s-" + s.g} key=${p.id}>
      <span class="data-bloco"><b>${String(d.getDate()).padStart(2, "0")}</b><small>${d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}</small></span>
      <span class="meio"><strong>${p.cliente_nome || "Cliente"}</strong><span>${[p.descricao, p.parcelas > 1 ? "parcela " + p.parcela + "/" + p.parcelas : "", p.forma, t ? fmtTel(t) : "", p.obs].filter(Boolean).join(" · ")}</span></span>
      <span class="dir"><b>${reais(p.valor)}</b><span class=${"pill p-" + s.cor}>${s.t}</span></span>
      <span class="rec-acoes">${p.status === "aberta" && pode(perfil, "entregar") ? html`<button type="button" class="btn btn-sm btn-encerrar" onClick=${() => setBaixa(p)}>Receber</button>` : null}
        ${t && p.status === "aberta" ? html`<a class="btn btn-sm" href=${linkWhats(t, msgCobranca(p, cfg))} target="_blank" rel="noopener">Cobrar</a>` : null}
        ${p.ordem_id ? html`<button type="button" class="btn btn-sm" onClick=${() => ir("/os/" + p.ordem_id)}>O.S.</button>` : null}</span></div>`; };
  if (semTabela) return html`<div class="pagina"><div class="aviso">O banco ainda não tem as contas a receber. Rode o arquivo <b>supabase/v12.sql</b> no SQL Editor do Supabase e recarregue a página.${erro ? " (" + erro + ")" : ""}</div></div>`;
  return html`<div class="pagina larga-media financeiro">
    <div class="painel-topo"><div><h1>Contas a receber</h1><span class="sub">${reais(soma(abertas))} a receber em ${abertas.length} parcela(s)</span></div></div>
    <div class="kpis fin-kpis">
      <div class=${"kpi" + (g("vencida").length ? " kpi-alerta" : "")}><span>Vencidas</span><b class="kpi-din">${reais(soma(g("vencida")))}</b><small>${g("vencida").length} parcela(s)</small></div>
      <div class=${"kpi" + (g("hoje").length ? " kpi-aviso" : "")}><span>Vencem hoje</span><b class="kpi-din">${reais(soma(g("hoje")))}</b><small>${g("hoje").length} parcela(s)</small></div>
      <div class="kpi"><span>Próximos 7 dias</span><b class="kpi-din">${reais(soma(g("semana")))}</b><small>${g("semana").length} parcela(s)</small></div>
      <div class="kpi kpi-forte"><span>Total a receber</span><b class="kpi-din">${reais(soma(abertas))}</b><small>${abertas.length} parcela(s)</small></div>
    </div>
    <section class="card">
      <${Abas} abas=${[["abertas", "A receber (" + abertas.length + ")"], ["pagas", "Recebidas"]]} ativa=${aba} onTroca=${setAba} />
      <div class="fin-sel" style=${{ margin: "12px 0" }}><label class="filtro fin-busca"><span>Buscar</span><input class="inp" type="search" placeholder="Cliente, O.S., placa ou forma" value=${q} onInput=${e => setQ(e.target.value)} /></label></div>
      ${aba === "abertas" ? (abertas.length ? [["vencida", "Vencidas"], ["hoje", "Vencem hoje"], ["semana", "Próximos 7 dias"], ["depois", "Mais adiante"]].map(([k, t]) => { const l = filtra(g(k)); return l.length ? html`<div class="grupo-contas" key=${k}><h4>${t}<span>${reais(soma(l))}</span></h4><div class="lista">${l.map(linha)}</div></div>` : null; })
          : html`<${Vazio}>Nenhuma conta a receber. Quando um veículo sair com pagamento a prazo, as parcelas aparecem aqui.</${Vazio}>`)
        : !pagas ? html`<div class="esqueleto"></div>` : filtra(pagas).length ? html`<div class="lista">${filtra(pagas).slice(0, 200).map(linha)}</div>` : html`<${Vazio}>Nenhuma parcela recebida ainda.</${Vazio}>`}
    </section>
    ${baixa ? html`<${ReceberParcelaModal} parcela=${baixa} onFechar=${() => setBaixa(null)} onFeito=${() => setBaixa(null)} />` : null}
  </div>`;
}

/** Combinar prazo para o saldo que ainda não tem parcelas (O.S. já entregue) */
export function CombinarPrazoModal({ o, saldo, onFechar, onFeito }) {
  const { perfil, avisar, recarregar } = useApp();
  const [prazo, setPrazo] = useState(null), [erro, setErro] = useState(""), [ocupado, setOcupado] = useState(false);
  const salvar = async () => {
    const e = validarPrazo(prazo, saldo); if (e) return setErro(e);
    setOcupado(true);
    try { await lancarParcelas(o, prazo, perfil); if (prazo.forma && !o.forma_pagamento) await api.atualizarOrdem(o.id, { forma_pagamento: prazo.forma }).catch(() => {});
      avisar("Prazo registrado."); await recarregar(["receber", "ordens"]); onFeito && onFeito(); }
    catch (x) { setErro(x.message); setOcupado(false); }
  };
  return html`<${Modal} titulo=${"Prazo de recebimento · " + numOS(o.numero)} onFechar=${onFechar}>
    <p class="sub">${(o.cliente || {}).nome} · saldo sem prazo: <b>${reais(saldo)}</b></p>
    <${PrazoReceber} saldo=${saldo} valor=${prazo} onMuda=${p => { setPrazo(p); setErro(""); }} />
    ${erro ? html`<div class="erros">${erro}</div>` : null}
    <div class="acoes"><span class="espaco"></span><button type="button" class="btn" onClick=${onFechar}>Voltar</button><button type="button" class="btn btn-pri" disabled=${ocupado} onClick=${salvar}>${ocupado ? "Salvando…" : "Salvar prazo"}</button></div>
  </${Modal}>`;
}

/** Bloco de parcelas dentro da O.S. */
export function ParcelasOS({ parcelas, onReceber }) {
  const { perfil } = useApp();
  if (!parcelas.length) return null;
  return html`<div class="parcelas-os"><h4>Parcelas a receber</h4><div class="lista">${parcelas.map(p => { const s = situacaoParcela(p);
    return html`<div key=${p.id} class=${"linha conta-linha s-" + s.g}><span class="meio"><strong>${p.parcelas > 1 ? "Parcela " + p.parcela + "/" + p.parcelas : "Pagamento"} · ${p.forma}</strong><span>Vencimento ${fmtData(p.vencimento)}${p.obs ? " · " + p.obs : ""}</span></span>
      <span class="dir"><b>${reais(p.valor)}</b><span class=${"pill p-" + s.cor}>${s.t}</span></span>
      ${p.status === "aberta" && pode(perfil, "entregar") ? html`<span class="rec-acoes"><button type="button" class="btn btn-sm btn-encerrar" onClick=${() => onReceber(p)}>Receber</button></span>` : null}</div>`; })}</div></div>`;
}
