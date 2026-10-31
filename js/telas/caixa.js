// Previsão de caixa do mês: o que já entrou e saiu, o que vence até o fim do mês (contas a receber e a pagar)
// e o saldo projetado dia a dia a partir do saldo informado.
import { html, useState, useEffect, useMemo } from "../lib.js";
import { api } from "../api.js";
import { useApp, Campo, Dinheiro, Vazio } from "../ui.js";
import { reais, fmtData, hojeISO, arred, numOS } from "../util.js";
import { etapaOS } from "../regras.js";

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const limitesMes = ym => { const [a, m] = ym.split("-").map(Number); return { ini: iso(new Date(a, m - 1, 1)), fim: iso(new Date(a, m, 0)) }; };
const soma = l => arred(l.reduce((s, x) => s + Number(x.valor || 0), 0));

export function PrevisaoCaixa() {
  const { dados, cfg, perfil, avisar, recarregar } = useApp();
  const hoje = hojeISO();
  const [mes, setMes] = useState(hoje.slice(0, 7));
  const [d, setD] = useState(null), [erro, setErro] = useState("");
  const [saldoTxt, setSaldoTxt] = useState(cfg.caixaSaldo ? Number(cfg.caixaSaldo.valor) : 0);
  const [incVencRec, setIncVencRec] = useState(false), [incSemPrazo, setIncSemPrazo] = useState(false);
  const { ini, fim } = limitesMes(mes);
  const atual = mes === hoje.slice(0, 7), passado = mes < hoje.slice(0, 7);

  useEffect(() => { (async () => {
    setD(null); setErro("");
    try {
      const [pagar, pagas, recibos, receber] = await Promise.all([
        api.contas.listar({ de: ini, ate: fim, campo: "vencimento" }),
        api.contas.listar({ de: ini, ate: fim, campo: "pago_em", status: "paga" }),
        api.recibos.listar({ de: ini, ate: fim }),
        api.receber && (!api.temV12 || api.temV12()) ? api.receber.listar({ ate: fim }).catch(() => []) : [],
      ]);
      // contas a pagar vencidas de meses anteriores ainda em aberto também saem do caixa
      const pagarAtrasadas = atual ? (await api.contas.abertas()).filter(c => c.vencimento < ini) : [];
      setD({ pagar, pagas, recibos: recibos.filter(r => !r.cancelado), receber, pagarAtrasadas });
    } catch (e) { setErro(e.message); }
  })(); }, [mes]);

  const r = useMemo(() => {
    if (!d) return null;
    const recebido = d.recibos, pago = d.pagas.map(c => ({ ...c, valor: Number(c.valor_pago) || Number(c.valor) }));
    const aPagar = d.pagar.filter(c => c.status === "aberta").concat(d.pagarAtrasadas);
    const recAbertas = d.receber.filter(p => p.status === "aberta");
    const aReceber = recAbertas.filter(p => p.vencimento >= ini && p.vencimento <= fim);
    const recVencidas = recAbertas.filter(p => p.vencimento < (atual ? hoje : ini));
    // O.S. aguardando pagamento com saldo sem parcela combinada
    const cobertoPorOS = {}; recAbertas.forEach(p => { cobertoPorOS[p.ordem_id] = (cobertoPorOS[p.ordem_id] || 0) + Number(p.valor); });
    const semPrazo = dados.ordens.filter(o => etapaOS(o) === "pagamento").map(o => ({ o, valor: arred(Math.max(0, Number(o.total || 0) - Number(o.recebido || 0) - (cobertoPorOS[o.id] || 0))) })).filter(x => x.valor > 0.009);
    // fluxo dia a dia (do dia de hoje, ou do 1º dia para meses futuros, até o fim do mês)
    const inicioProj = atual ? hoje : ini;
    const dia = {}; const add = (dt, k, v) => { const x = dt < inicioProj ? inicioProj : dt; (dia[x] = dia[x] || { e: 0, s: 0 })[k] += Number(v); };
    aReceber.filter(p => p.vencimento >= inicioProj || !atual).forEach(p => add(p.vencimento, "e", p.valor));
    if (incVencRec) recVencidas.forEach(p => add(inicioProj, "e", p.valor));
    if (incSemPrazo) semPrazo.forEach(x => add(inicioProj, "e", x.valor));
    aPagar.forEach(c => add(c.vencimento, "s", c.valor));
    const saldoIni = Number(saldoTxt) || 0;
    let saldo = saldoIni, pior = null;
    const linhas = [];
    for (let t = new Date(inicioProj + "T12:00:00"); iso(t) <= fim; t.setDate(t.getDate() + 1)) {
      const k = iso(t), x = dia[k] || { e: 0, s: 0 };
      saldo = arred(saldo + x.e - x.s);
      if (x.e || x.s || k === inicioProj || k === fim) linhas.push({ k, e: arred(x.e), s: arred(x.s), saldo });
      if (!pior || saldo < pior.saldo) pior = { k, saldo };
    }
    const entradasPrev = arred(Object.values(dia).reduce((s, x) => s + x.e, 0)), saidasPrev = arred(Object.values(dia).reduce((s, x) => s + x.s, 0));
    return { recebido, pago, aPagar, aReceber, recVencidas, semPrazo, linhas, pior, saldoIni, saldoFim: saldo, entradasPrev, saidasPrev };
  }, [d, saldoTxt, incVencRec, incSemPrazo, dados.ordens]);

  const salvarSaldo = async () => {
    try { await api.salvarConfig({ ...cfg, caixaSaldo: { valor: Number(saldoTxt) || 0, em: new Date().toISOString(), por: perfil.nome } }); await recarregar(["config"]); avisar("Saldo atualizado."); }
    catch (e) { avisar(e.message, true); }
  };
  const trocaMes = n => { const [a, m] = mes.split("-").map(Number); const x = new Date(a, m - 1 + n, 1); setMes(iso(x).slice(0, 7)); };
  const [a, m] = mes.split("-").map(Number);
  const desat = cfg.caixaSaldo && (Date.now() - new Date(cfg.caixaSaldo.em)) / 86400000 >= 1;

  return html`<div class="pagina larga-media financeiro caixa">
    <div class="painel-topo"><div><h1>Previsão de caixa</h1><span class="sub">Entradas e saídas de ${MESES[m - 1]} de ${a}</span></div>
      <div class="caixa-mes"><button type="button" class="btn btn-sm" aria-label="Mês anterior" onClick=${() => trocaMes(-1)}>‹</button><b>${MESES[m - 1]} ${a}</b><button type="button" class="btn btn-sm" aria-label="Próximo mês" onClick=${() => trocaMes(1)}>›</button>
        ${!atual ? html`<button type="button" class="btn-link" onClick=${() => setMes(hoje.slice(0, 7))}>mês atual</button>` : null}</div></div>
    ${erro ? html`<div class="erros">Não foi possível montar a previsão: ${erro}</div>` : null}
    ${!r ? (erro ? null : html`<div class="esqueleto"></div>`) : html`
    <div class="kpis fin-kpis">
      <div class="kpi"><span>Já entrou no mês</span><b class="kpi-din c-ok">${reais(soma(r.recebido))}</b><small>${r.recebido.length} recibo(s)</small></div>
      <div class="kpi"><span>Já saiu no mês</span><b class="kpi-din c-bad">${reais(soma(r.pago))}</b><small>${r.pago.length} conta(s) paga(s)</small></div>
      <div class="kpi"><span>A receber ${passado ? "(não recebido)" : "até o fim do mês"}</span><b class="kpi-din">${reais(r.entradasPrev)}</b><small>${r.aReceber.length} parcela(s)${incVencRec && r.recVencidas.length ? " + vencidas" : ""}${incSemPrazo && r.semPrazo.length ? " + O.S. sem prazo" : ""}</small></div>
      <div class="kpi"><span>A pagar até o fim do mês</span><b class="kpi-din">${reais(r.saidasPrev)}</b><small>${r.aPagar.length} conta(s)${atual && d.pagarAtrasadas.length ? ", " + d.pagarAtrasadas.length + " atrasada(s)" : ""}</small></div>
      <div class=${"kpi kpi-forte" + (r.saldoFim < 0 ? " kpi-alerta" : "")}><span>Saldo previsto em ${fmtData(fim)}</span><b class="kpi-din">${reais(r.saldoFim)}</b><small>${r.pior && r.pior.saldo < 0 ? "fica negativo em " + fmtData(r.pior.k) : "partindo de " + reais(r.saldoIni)}</small></div>
    </div>
    ${passado ? html`<div class="info">Mês encerrado: a projeção abaixo mostra o que ficou em aberto naquele mês.</div>` : null}
    <section class="card">
      <div class="caixa-saldo">
        <${Campo} id="cx-saldo" rotulo=${atual ? "Saldo em caixa e banco hoje" : "Saldo no início do mês"} dica=${cfg.caixaSaldo ? "Informado em " + new Date(cfg.caixaSaldo.em).toLocaleString("pt-BR") + " por " + cfg.caixaSaldo.por + (desat ? ". Atualize para a previsão ficar certa." : ".") : "Some o dinheiro do caixa e o saldo das contas da empresa."}><${Dinheiro} id="cx-saldo" valor=${saldoTxt} onMuda=${setSaldoTxt} /></${Campo}>
        <button type="button" class="btn btn-sm" onClick=${salvarSaldo}>Guardar saldo</button>
        <label class="linha-check"><input type="checkbox" checked=${incVencRec} onChange=${e => setIncVencRec(e.target.checked)} /><span>Contar parcelas vencidas a receber (${reais(soma(r.recVencidas))}) como se entrassem hoje</span></label>
        <label class="linha-check"><input type="checkbox" checked=${incSemPrazo} onChange=${e => setIncSemPrazo(e.target.checked)} /><span>Contar O.S. aguardando pagamento sem prazo (${reais(soma(r.semPrazo))})</span></label>
      </div>
      <h3>Saldo dia a dia</h3>
      ${r.linhas.length ? html`<div class="grade-dados"><table class="tab-caixa"><thead><tr><th>Dia</th><th class="num">Entradas</th><th class="num">Saídas</th><th class="num">Saldo previsto</th></tr></thead>
        <tbody>${r.linhas.map(l => html`<tr key=${l.k} class=${l.saldo < 0 ? "neg" : ""}><td>${fmtData(l.k)}${l.k === hoje ? " (hoje)" : ""}</td><td class="num c-ok">${l.e ? reais(l.e) : ""}</td><td class="num c-bad">${l.s ? reais(l.s) : ""}</td><td class="num"><b>${reais(l.saldo)}</b></td></tr>`)}</tbody></table></div>`
        : html`<${Vazio}>Nada previsto para este mês.</${Vazio}>`}
    </section>
    <div class="caixa-listas">
      <section class="card"><h3>Entradas previstas</h3>
        ${r.aReceber.length ? html`<div class="lista">${r.aReceber.map(p => html`<div class="linha" key=${p.id}><span class="meio"><strong>${p.cliente_nome}</strong><span>${fmtData(p.vencimento)} · ${p.descricao}${p.parcelas > 1 ? " · " + p.parcela + "/" + p.parcelas : ""} · ${p.forma}</span></span><b>${reais(p.valor)}</b></div>`)}</div>` : html`<span class="dica">Nenhuma parcela a receber no mês.</span>`}
        ${r.recVencidas.length ? html`<h4>Vencidas e não recebidas</h4><div class="lista">${r.recVencidas.map(p => html`<div class="linha" key=${p.id}><span class="meio"><strong>${p.cliente_nome}</strong><span class="c-bad">venceu ${fmtData(p.vencimento)} · ${p.descricao}</span></span><b>${reais(p.valor)}</b></div>`)}</div>` : null}
        ${r.semPrazo.length ? html`<h4>O.S. aguardando pagamento sem prazo</h4><div class="lista">${r.semPrazo.map(x => html`<div class="linha" key=${x.o.id}><span class="meio"><strong>${numOS(x.o.numero)} · ${x.o.cliente.nome}</strong><span>${x.o.veiculo.placa || ""} · ${x.o.status === "entregue" ? "veículo entregue" : "veículo no pátio"}</span></span><b>${reais(x.valor)}</b></div>`)}</div>` : null}
      </section>
      <section class="card"><h3>Saídas previstas</h3>
        ${r.aPagar.length ? html`<div class="lista">${r.aPagar.sort((x, y) => x.vencimento.localeCompare(y.vencimento)).map(c => html`<div class="linha" key=${c.id}><span class="meio"><strong>${c.favorecido || ((dados.fornecedores || []).find(f => f.id === c.fornecedor_id) || {}).nome || c.descricao}</strong><span class=${c.vencimento < hoje ? "c-bad" : ""}>${c.vencimento < hoje ? "venceu " : ""}${fmtData(c.vencimento)} · ${c.descricao || ""}${c.categoria ? " · " + c.categoria : ""}</span></span><b>${reais(c.valor)}</b></div>`)}</div>` : html`<span class="dica">Nenhuma conta a pagar em aberto no mês.</span>`}
      </section>
    </div>`}
  </div>`;
}
