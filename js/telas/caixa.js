// Previsão de caixa do mês: o que já entrou e saiu, o que vence até o fim do mês (contas a receber e a pagar)
// e o saldo projetado dia a dia a partir do saldo informado.
import { html, useState, useEffect, useMemo } from "../lib.js";
import { api } from "../api.js";
import { useApp, Campo, Dinheiro, Vazio, Modal, Texto } from "../ui.js";
import { reais, fmtData, hojeISO, arred, numOS } from "../util.js";
import { etapaOS, nomesContas } from "../regras.js";

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const limitesMes = ym => { const [a, m] = ym.split("-").map(Number); return { ini: iso(new Date(a, m - 1, 1)), fim: iso(new Date(a, m, 0)) }; };
const soma = l => arred(l.reduce((s, x) => s + Number(x.valor || 0), 0));
const dataDe = ts => ts ? iso(new Date(ts)) : "1900-01-01";

/** Contas da empresa com o saldo informado (Ajustes: contasFinanceiras); sem cadastro, as contas padrão com saldo zero */
const contasDoCfg = cfg => (cfg.contasFinanceiras && cfg.contasFinanceiras.length ? cfg.contasFinanceiras : nomesContas(cfg).map(nome => ({ nome, saldo: 0, em: null, por: "" })));
/** Saldo atual de cada conta = saldo informado + recibos que entraram nela − contas pagas por ela ± transferências, registrados depois do saldo informado */
function saldosPorConta(contas, mov) {
  // conta o que foi registrado depois do saldo informado (sem o horário do registro: só o que tem data posterior)
  const depois = (c, data, registrado) => !c.em || (registrado ? data >= dataDe(c.em) && registrado > c.em : data > dataDe(c.em));
  return contas.map(c => {
    const ent = soma(mov.recibos.filter(r => !r.cancelado && r.conta_destino === c.nome && depois(c, r.data, r.criado_em)));
    // pago_registrado_em (v18) é o instante da baixa e não muda quando a conta paga é editada depois
    const sai = arred(mov.pagas.filter(x => x.conta_origem === c.nome && depois(c, x.pago_em, x.pago_registrado_em)).reduce((s, x) => s + Number(x.valor_pago ?? x.valor), 0));
    const tSai = soma(mov.transf.filter(t => t.de_conta === c.nome && depois(c, t.data, t.criado_em)));
    const tEnt = soma(mov.transf.filter(t => t.para_conta === c.nome && depois(c, t.data, t.criado_em)));
    return { ...c, ent, sai, tEnt, tSai, atual: arred(Number(c.saldo || 0) + ent - sai + tEnt - tSai) };
  });
}

function TransferenciaModal({ contas, onFechar, onFeito }) {
  const { perfil, avisar } = useApp();
  const [t, setT] = useState({ data: hojeISO(), de_conta: contas[0] || "", para_conta: contas[1] || "", valor: 0, obs: "" });
  const [erro, setErro] = useState(""), [salvando, setSalvando] = useState(false);
  const set = p => { setT(x => ({ ...x, ...p })); setErro(""); };
  const salvar = async () => {
    if (!t.de_conta || !t.para_conta) return setErro("Escolha as duas contas.");
    if (t.de_conta === t.para_conta) return setErro("A conta de saída e a de entrada precisam ser diferentes.");
    if (!(Number(t.valor) > 0)) return setErro("Informe o valor transferido.");
    setSalvando(true);
    try { await api.transferencias.salvar({ ...t, valor: arred(t.valor), obs: t.obs.trim(), criado_por: perfil.nome }); avisar("Transferência registrada."); onFeito(); }
    catch (e) { setErro(e.message); } finally { setSalvando(false); }
  };
  const sel = (k, rot) => html`<label class="campo"><span>${rot}</span><select class="inp" value=${t[k]} onChange=${e => set({ [k]: e.target.value })}>${contas.map(n => html`<option value=${n}>${n}</option>`)}</select></label>`;
  return html`<${Modal} titulo="Transferência entre contas" onFechar=${onFechar}>
    <div class="grade">${sel("de_conta", "Saiu de")}${sel("para_conta", "Entrou em")}
      <${Campo} id="tr-valor" rotulo="Valor" obrig><${Dinheiro} id="tr-valor" valor=${t.valor} onMuda=${v => set({ valor: v })} /></${Campo}>
      <${Campo} id="tr-data" rotulo="Data"><input id="tr-data" type="date" class="inp" value=${t.data} onInput=${e => set({ data: e.target.value })} /></${Campo}></div>
    <${Campo} id="tr-obs" rotulo="Observação"><${Texto} id="tr-obs" placeholder="ex.: cobrir boletos da semana" valor=${t.obs} onMuda=${v => set({ obs: v })} /></${Campo}>
    <span class="dica">Não entra como receita nem como despesa: só muda o dinheiro de lugar.</span>
    ${erro ? html`<div class="erros">${erro}</div>` : null}
    <div class="acoes"><span class="espaco"></span><button type="button" class="btn" onClick=${onFechar}>Cancelar</button><button type="button" class="btn btn-pri" disabled=${salvando} onClick=${salvar}>Registrar transferência</button></div>
  </${Modal}>`;
}

/** Edição dos saldos: nome de cada conta e saldo de agora; contas padrão para pagar e receber */
function SaldosModal({ linhas, lidoEm, onFechar, onSalvo }) {
  const { cfg, perfil, avisar, recarregar } = useApp();
  const [l, setL] = useState(linhas.map(c => ({ nome: c.nome, saldo: c.atual, antigo: c.nome })));
  const [pg, setPg] = useState(cfg.contaPagamento || ""), [rc, setRc] = useState(cfg.contaRecebimento || "");
  const [erro, setErro] = useState(""), [salvando, setSalvando] = useState(false);
  const muda = (i, p) => { setL(x => x.map((c, j) => j === i ? { ...c, ...p } : c)); setErro(""); };
  const salvar = async () => {
    const nomes = l.map(c => c.nome.trim());
    if (nomes.some(n => !n)) return setErro("Dê um nome para cada conta.");
    if (new Set(nomes.map(n => n.toLowerCase())).size !== nomes.length) return setErro("Há contas com o mesmo nome.");
    setSalvando(true);
    try {
      const agora = new Date().toISOString();
      // saldo mantido como sugerido: vale para o momento da leitura (o que for lançado depois continua contando);
      // saldo digitado (extrato de agora): vale a partir de agora
      const sug = new Map(linhas.map(c => [c.nome, c.atual]));
      const contas = l.map(c => { const igual = sug.has(c.antigo) && Math.abs(arred(c.saldo) - sug.get(c.antigo)) < 0.005;
        return { nome: c.nome.trim(), saldo: arred(c.saldo), em: igual && lidoEm ? lidoEm : agora, por: perfil.nome }; });
      const em = contas.reduce((m, c) => (c.em > m ? c.em : m), "");
      const total = arred(contas.reduce((s, c) => s + c.saldo, 0));
      await api.salvarConfig({ ...cfg, contasFinanceiras: contas, contaPagamento: nomes.includes(pg) ? pg : "", contaRecebimento: nomes.includes(rc) ? rc : "", caixaSaldo: { valor: total, em, por: perfil.nome } });
      await recarregar(["config"]); avisar("Saldos atualizados."); onSalvo();
    } catch (e) { setErro(e.message); } finally { setSalvando(false); }
  };
  const nomes = l.map(c => c.nome.trim()).filter(Boolean);
  return html`<${Modal} titulo="Saldo de cada conta" onFechar=${onFechar}>
    <p class="sub">Informe quanto há <b>agora</b> em cada conta (extrato do banco e dinheiro no caixa). A partir daqui o sistema soma os recibos, desconta os pagamentos e as transferências de cada conta.</p>
    <div class="lista">${l.map((c, i) => html`<div class="linha" key=${i}>
      <input class="inp" aria-label="Nome da conta" value=${c.nome} onInput=${e => muda(i, { nome: e.target.value })} />
      <${Dinheiro} id=${"sc-" + i} valor=${c.saldo} onMuda=${v => muda(i, { saldo: v })} />
      <button type="button" class="btn-link perigo" aria-label=${"Tirar a conta " + c.nome} onClick=${() => setL(x => x.filter((_, j) => j !== i))}>Tirar</button></div>`)}</div>
    <button type="button" class="btn btn-sm" onClick=${() => setL(x => x.concat([{ nome: "", saldo: 0 }]))}>+ Outra conta</button>
    <div class="grade">
      <label class="campo"><span>Conta padrão para pagar</span><select class="inp" value=${pg} onChange=${e => setPg(e.target.value)}><option value="">Perguntar sempre</option>${nomes.map(n => html`<option value=${n}>${n}</option>`)}</select></label>
      <label class="campo"><span>Conta padrão para receber (fora dinheiro)</span><select class="inp" value=${rc} onChange=${e => setRc(e.target.value)}><option value="">A primeira conta de banco</option>${nomes.map(n => html`<option value=${n}>${n}</option>`)}</select></label>
    </div>
    <span class="dica">Trocar o nome de uma conta não muda os lançamentos antigos feitos com o nome anterior.</span>
    ${erro ? html`<div class="erros">${erro}</div>` : null}
    <div class="acoes"><span class="espaco"></span><button type="button" class="btn" onClick=${onFechar}>Cancelar</button><button type="button" class="btn btn-pri" disabled=${salvando} onClick=${salvar}>Guardar saldos</button></div>
  </${Modal}>`;
}

export function PrevisaoCaixa() {
  const { dados, cfg, avisar, confirmar } = useApp();
  const hoje = hojeISO();
  const [mes, setMes] = useState(hoje.slice(0, 7));
  const [d, setD] = useState(null), [erro, setErro] = useState("");
  const contasCfg = contasDoCfg(cfg);
  const [mov, setMov] = useState(null), [modal, setModal] = useState(null), [recarga, setRecarga] = useState(0);
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
      const abertas = atual || ini > hoje ? await api.contas.abertas() : [];
      const pagarAtrasadas = atual ? abertas.filter(c => c.vencimento < ini) : [];
      // mês futuro: tudo o que vence de hoje até a véspera do mês (e o que já está atrasado) muda o saldo de partida
      const pagarAntes = !atual && ini > hoje ? abertas.filter(c => c.vencimento < ini) : [];
      // histórico de transferências do mês escolhido (independe da data do saldo informado)
      const transfMes = api.transferencias ? await api.transferencias.listar({ de: ini, ate: fim }) : [];
      setD({ pagar, pagas, recibos: recibos.filter(r => !r.cancelado), receber, pagarAtrasadas, pagarAntes, transfMes });
    } catch (e) { setErro(e.message); }
  })(); }, [mes, recarga]);

  // movimentos desde o saldo informado mais antigo (para o saldo atual de cada conta)
  const desde = contasCfg.reduce((m, c) => (c.em && dataDe(c.em) < m ? dataDe(c.em) : m), hoje);
  useEffect(() => { (async () => {
    setMov(null);
    const lidoEm = new Date().toISOString(); // momento da leitura: o saldo sugerido vale para este instante
    try {
      const [recibos, pagas, transf] = await Promise.all([(api.recibos.desde ? api.recibos.desde(desde) : api.recibos.listar({ de: desde })), api.contas.listar({ de: desde, campo: "pago_em", status: "paga" }), api.transferencias ? api.transferencias.listar({ de: desde }) : []]);
      setMov({ recibos, pagas, transf, lidoEm });
    } catch (e) { setMov({ erro: e.message }); } // sem os movimentos não há saldo atual (nem nova referência)
  })(); }, [desde, recarga, cfg.contasFinanceiras]);
  const saldos = useMemo(() => mov && !mov.erro ? saldosPorConta(contasCfg, mov) : null, [mov, cfg.contasFinanceiras]);
  const totalAtual = saldos ? arred(saldos.reduce((s, c) => s + c.atual, 0)) : 0;
  const semConta = mov && !mov.erro ? { rec: mov.recibos.filter(r => !r.cancelado && !r.conta_destino && r.data >= desde), pag: mov.pagas.filter(x => !x.conta_origem && x.pago_em >= desde) } : { rec: [], pag: [] };

  const r = useMemo(() => {
    if (!d) return null;
    const recebido = d.recibos, pago = d.pagas.map(c => ({ ...c, valor: Number(c.valor_pago) || Number(c.valor) }));
    const aPagar = d.pagar.filter(c => c.status === "aberta").concat(d.pagarAtrasadas);
    const recAbertas = d.receber.filter(p => p.status === "aberta");
    const aReceber = recAbertas.filter(p => p.vencimento >= ini && p.vencimento <= fim);
    const futuro = !atual && !passado;
    const recVencidas = recAbertas.filter(p => p.vencimento < (atual || futuro ? hoje : ini));
    const recAntes = futuro ? recAbertas.filter(p => p.vencimento >= hoje && p.vencimento < ini) : [];
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
    // mês futuro: parte do saldo de hoje + o que entra − o que sai até a véspera do mês
    const saldoIni = futuro ? arred(totalAtual + soma(recAntes) - soma(d.pagarAntes)) : totalAtual;
    let saldo = saldoIni, pior = null;
    const linhas = [];
    for (let t = new Date(inicioProj + "T12:00:00"); iso(t) <= fim; t.setDate(t.getDate() + 1)) {
      const k = iso(t), x = dia[k] || { e: 0, s: 0 };
      saldo = arred(saldo + x.e - x.s);
      if (x.e || x.s || k === inicioProj || k === fim) linhas.push({ k, e: arred(x.e), s: arred(x.s), saldo });
      if (!pior || saldo < pior.saldo) pior = { k, saldo };
    }
    const entradasPrev = arred(Object.values(dia).reduce((s, x) => s + x.e, 0)), saidasPrev = arred(Object.values(dia).reduce((s, x) => s + x.s, 0));
    return { recebido, pago, aPagar, aReceber, recVencidas, semPrazo, linhas, pior, saldoIni, saldoFim: saldo, entradasPrev, saidasPrev, futuro, recAntes };
  }, [d, totalAtual, incVencRec, incSemPrazo, dados.ordens]);
  const excluirTransf = async t => { try { await api.transferencias.excluir(t.id); avisar("Transferência excluída."); setRecarga(x => x + 1); } catch (e) { avisar(e.message, true); } };
  const trocaMes = n => { const [a, m] = mes.split("-").map(Number); const x = new Date(a, m - 1 + n, 1); setMes(iso(x).slice(0, 7)); };
  const [a, m] = mes.split("-").map(Number);
  const ultimaAtual = contasCfg.reduce((m, c) => (c.em && (!m || c.em > m) ? c.em : m), null);
  const transfMes = d ? d.transfMes || [] : [];

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
      <div class="caixa-contas-topo"><h3>Saldo por conta</h3><span class="espaco"></span>
        <button type="button" class="btn btn-sm" onClick=${() => setModal("transf")} disabled=${api.temV18 && api.temV18() === false}>Transferir entre contas</button>
        <button type="button" class="btn btn-sm btn-pri" onClick=${() => setModal("saldos")} disabled=${!saldos}>Atualizar saldos</button></div>
      ${api.temV18 && api.temV18() === false ? html`<div class="aviso">Para o saldo de cada conta acompanhar recibos, pagamentos e transferências, rode o <code>supabase/v18.sql</code> no Supabase.</div>` : null}
      ${mov && mov.erro ? html`<div class="erros">Saldo das contas indisponível: não foi possível ler recibos, pagamentos e transferências (${mov.erro}). A previsão abaixo parte de R$ 0,00 até a leitura voltar.</div>`
        : !saldos ? html`<div class="esqueleto"></div>` : html`<div class="grade-dados"><table class="tab-caixa"><thead><tr><th>Conta</th><th class="num">Saldo informado</th><th class="num">Entradas</th><th class="num">Saídas</th><th class="num">Transferências</th><th class="num">Saldo atual</th></tr></thead>
        <tbody>${saldos.map(c => html`<tr key=${c.nome} class=${c.atual < 0 ? "neg" : ""}><td><b>${c.nome}</b><br /><small class="sub">${c.em ? "informado em " + new Date(c.em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "saldo ainda não informado"}</small></td>
          <td class="num">${reais(c.saldo || 0)}</td><td class="num c-ok">${c.ent ? reais(c.ent) : ""}</td><td class="num c-bad">${c.sai ? reais(c.sai) : ""}</td>
          <td class="num">${c.tEnt || c.tSai ? reais(arred(c.tEnt - c.tSai)) : ""}</td><td class="num"><b>${reais(c.atual)}</b></td></tr>`)}
          <tr class="tot"><td><b>Total</b></td><td></td><td></td><td></td><td></td><td class="num"><b>${reais(totalAtual)}</b></td></tr></tbody></table></div>
        ${!ultimaAtual ? html`<span class="dica">Clique em <b>Atualizar saldos</b> e informe quanto há hoje em cada conta.</span>` : (Date.now() - new Date(ultimaAtual)) / 86400000 >= 7 ? html`<span class="dica">Saldos informados há mais de 7 dias: confira com os extratos e atualize.</span>` : null}
        ${semConta.rec.length || semConta.pag.length ? html`<div class="aviso">${semConta.rec.length ? semConta.rec.length + " recibo(s) (" + reais(soma(semConta.rec)) + ")" : ""}${semConta.rec.length && semConta.pag.length ? " e " : ""}${semConta.pag.length ? semConta.pag.length + " pagamento(s) (" + reais(soma(semConta.pag.map(x => ({ valor: x.valor_pago ?? x.valor })))) + ")" : ""} sem a conta informada não entram no saldo por conta.</div>` : null}
`}
      ${transfMes.length ? html`<h4>Transferências de ${MESES[m - 1]}</h4><div class="lista">${transfMes.map(t => html`<div class="linha" key=${t.id}><span class="meio"><strong>${t.de_conta} → ${t.para_conta}</strong><span>${fmtData(t.data)}${t.obs ? " · " + t.obs : ""}${t.criado_por ? " · " + t.criado_por : ""}</span></span><b>${reais(t.valor)}</b>
        <button type="button" class="btn-link perigo" onClick=${async () => { if (await confirmar({ titulo: "Excluir transferência", texto: t.de_conta + " → " + t.para_conta + ": " + reais(t.valor), botao: "Excluir", perigo: true })) excluirTransf(t); }}>Excluir</button></div>`)}</div>` : null}
      <div class="caixa-saldo">
        <span class="dica">${r.futuro ? html`A previsão parte do saldo esperado em ${fmtData(ini)}: <b>${reais(r.saldoIni)}</b> (saldo de hoje ${reais(totalAtual)}, + ${reais(soma(r.recAntes))} a receber e − ${reais(soma(d.pagarAntes))} a pagar até ${fmtData(ini)}).` : html`A previsão parte do saldo atual somado das contas: <b>${reais(totalAtual)}</b>.`}</span>
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
    ${modal === "transf" ? html`<${TransferenciaModal} contas=${contasCfg.map(c => c.nome)} onFechar=${() => setModal(null)} onFeito=${() => { setModal(null); setRecarga(x => x + 1); }} />` : null}
    ${modal === "saldos" && saldos ? html`<${SaldosModal} linhas=${saldos} lidoEm=${mov && mov.lidoEm} onFechar=${() => setModal(null)} onSalvo=${() => { setModal(null); setRecarga(x => x + 1); }} />` : null}
  </div>`;
}
