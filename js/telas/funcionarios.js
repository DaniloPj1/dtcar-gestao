// Funcionários: cadastro, jornada (folha de ponto impressa) e contabilidade do mês. Só o administrador acessa.
import { html, useState, useEffect, useMemo } from "../lib.js";
import { api } from "../api.js";
import { useApp, Campo, Texto, Area, Abas, Modal, Vazio, Dinheiro } from "../ui.js";
import { norm, reais, fmtData, fmtTel, fmtDoc, soDig, validaCPF, hojeISO, parseValor, totalItem, numOS } from "../util.js";
import { DIAS, VINCULOS, TIPOS_LANC, ENCARGOS_PADRAO, JORNADA_PADRAO, minutosDia, horasSemana, fmtHoras, periodo, mesAtual, nomeMes,
  calcularMes, eMecanicoDa, quintoDiaUtil, com_encargos } from "../folha.js";

const VAZIO = { nome: "", apelido: "", cpf: "", rg: "", pis: "", ctps: "", nascimento: "", telefone: "", endereco: "", funcao: "", vinculo: "clt",
  admissao: "", demissao: "", ativo: true, perfil_id: "", salario: 0, horas_mes: 220, he_pct: 50, comissao_pct: 0, jornada: JORNADA_PADRAO, banco: "", pix: "", obs: "" };
const semTabela = e => /funcionari.*(does not exist|não existe)|relation .*funcionari/i.test(e.message || "");
const AVISO_V10 = html`<div class="aviso">O banco ainda não tem as tabelas de funcionários. Rode o arquivo <b>supabase/v10.sql</b> no SQL Editor do Supabase e recarregue a página.</div>`;

/** Carrega lançamentos e base de comissão do mês para uma lista de funcionários */
export async function dadosDoMes(ym, funcs) {
  const p = periodo(ym);
  const [lancs, ordens] = await Promise.all([api.funcionarios.lancamentos(p.comp), api.funcionarios.ordensEntregues(p.ini + "T00:00:00-03:00", p.fim + "T00:00:00-03:00")]);
  const comComissao = funcs.filter(f => Number(f.comissao_pct) > 0);
  const relevantes = ordens.filter(o => comComissao.some(f => eMecanicoDa(f, o)));
  const itens = relevantes.length ? await api.itensDasOrdens(relevantes.map(o => o.id)) : [];
  const mo = new Map();
  for (const i of itens) if (i.tipo === "servico" && i.aprovado !== false) mo.set(i.ordem_id, (mo.get(i.ordem_id) || 0) + totalItem(i));
  const porFunc = {};
  for (const f of funcs) {
    const os = relevantes.filter(o => eMecanicoDa(f, o)).map(o => ({ ...o, maoDeObra: mo.get(o.id) || 0 }));
    porFunc[f.id] = { lancs: lancs.filter(l => l.funcionario_id === f.id), os, base: os.reduce((s, o) => s + o.maoDeObra, 0) };
  }
  return porFunc;
}

function SeletorMes({ ym, onMuda }) {
  const anda = n => { const { ano, mes } = periodo(ym); const d = new Date(ano, mes - 1 + n, 1); onMuda(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0")); };
  return html`<div class="acoes centro"><button type="button" class="btn btn-sm" aria-label="Mês anterior" onClick=${() => anda(-1)}>‹</button>
    <input type="month" class="inp inp-curto" aria-label="Mês" value=${ym} onChange=${e => e.target.value && onMuda(e.target.value)} />
    <button type="button" class="btn btn-sm" aria-label="Próximo mês" onClick=${() => anda(1)}>›</button></div>`;
}

/* =================== LISTA E RESUMO DO MÊS =================== */
export function Funcionarios({ params }) {
  const { ir, cfg, avisar, recarregar } = useApp();
  const [funcs, setFuncs] = useState(null), [erro, setErro] = useState(""), [ym, setYm] = useState(params.mes || mesAtual());
  const [mes, setMes] = useState(null), [inativos, setInativos] = useState(false), [encAberto, setEncAberto] = useState(false);
  useEffect(() => { api.funcionarios.listar("nome").then(setFuncs).catch(e => setErro(semTabela(e) ? "v10" : e.message)); }, []);
  useEffect(() => { if (!funcs) return; setMes(null); dadosDoMes(ym, funcs).then(setMes).catch(e => setErro(e.message)); }, [funcs, ym]);
  if (erro === "v10") return html`<div class="pagina">${AVISO_V10}</div>`;
  if (erro) return html`<div class="pagina"><div class="erros">${erro}</div></div>`;
  if (!funcs) return html`<div class="carregando">Carregando funcionários…</div>`;
  const lista = funcs.filter(f => inativos || f.ativo);
  const res = mes ? lista.map(f => ({ f, r: calcularMes(f, ym, mes[f.id].lancs, mes[f.id].base, cfg.encargos) })) : [];
  const soma = k => res.reduce((s, x) => s + (typeof k === "function" ? k(x.r) : x.r[k]), 0);
  return html`<div class="pagina larga-media">
    <div class="painel-topo"><div><h1>Funcionários</h1><span class="sub">Folha de ${nomeMes(ym)} · valores de referência para a gestão</span></div>
      <div class="acoes"><${SeletorMes} ym=${ym} onMuda=${setYm} />
        <button type="button" class="btn" onClick=${() => setEncAberto(true)}>Encargos</button>
        <button type="button" class="btn btn-pri" onClick=${() => ir("/funcionario/novo")}>+ Novo funcionário</button></div></div>
    ${mes && res.length ? html`<div class="kpis">
      <div class="kpi"><span>Salários + variáveis</span><b class="kpi-num">${reais(soma("remuneracao"))}</b></div>
      <div class="kpi"><span>Encargos e provisões</span><b class="kpi-num">${reais(soma("totalEncargos"))}</b></div>
      <div class="kpi"><span>Custo total da equipe</span><b class="kpi-num">${reais(soma("custoTotal"))}</b></div>
      <div class="kpi"><span>Saldo a pagar</span><b class="kpi-num">${reais(soma("saldo"))}</b></div></div>` : null}
    <section class="card">
      <label class="linha-check"><input type="checkbox" checked=${inativos} onChange=${e => setInativos(e.target.checked)} /><span>Mostrar desligados</span></label>
      ${!lista.length ? html`<${Vazio}>Nenhum funcionário cadastrado. Toque em “Novo funcionário”.</${Vazio}>`
      : !mes ? html`<div class="carregando">Calculando o mês…</div>`
      : html`<div class="tabela-rolagem"><table class="tab-rel"><thead><tr><th>Funcionário</th><th>Vínculo</th><th class="num">Salário</th><th class="num">H. extras</th><th class="num">Comissão</th>
          <th class="num">Faltas</th><th class="num">Vales</th><th class="num">Saldo a pagar</th><th class="num">Custo total</th></tr></thead>
        <tbody>${res.map(({ f, r }) => html`<tr key=${f.id} class="clicavel" onClick=${() => ir("/funcionario/" + f.id + "?aba=mes&mes=" + ym)}>
          <td><b>${f.nome}</b><div class="sub">${f.funcao || "—"}${f.ativo ? "" : " · desligado"}</div></td><td>${VINCULOS[f.vinculo]}</td>
          <td class="num">${reais(r.salario)}</td><td class="num">${r.horasExtras ? reais(r.horasExtras) : "—"}</td><td class="num">${r.comissao ? reais(r.comissao) : "—"}</td>
          <td class="num">${r.faltas ? "− " + reais(r.faltas) : "—"}</td><td class="num">${r.vales ? "− " + reais(r.vales) : "—"}</td>
          <td class="num"><b>${reais(r.saldo)}</b></td><td class="num">${reais(r.custoTotal)}</td></tr>`)}</tbody>
        <tfoot><tr><td colspan="2">Total</td><td class="num">${reais(soma("salario"))}</td><td class="num">${reais(soma("horasExtras"))}</td><td class="num">${reais(soma("comissao"))}</td>
          <td class="num">${reais(soma("faltas"))}</td><td class="num">${reais(soma("vales"))}</td><td class="num">${reais(soma("saldo"))}</td><td class="num">${reais(soma("custoTotal"))}</td></tr></tfoot></table></div>`}
    </section>
    <div class="info">O cálculo é para controle da oficina (quanto pagar e quanto a equipe custa). A folha oficial, o INSS e o IRRF descontados do funcionário, o DSR sobre horas extras e comissões e as guias são do contador: lance o valor do holerite dele como “INSS / IRRF”.</div>
    ${encAberto ? html`<${Encargos} onFechar=${() => setEncAberto(false)} />` : null}
  </div>`;
}

function Encargos({ onFechar }) {
  const { cfg, avisar, recarregar } = useApp();
  const [e, setE] = useState({ ...ENCARGOS_PADRAO, ...(cfg.encargos || {}) }), [salvando, setSalvando] = useState(false);
  const campo = (k, r, d) => html`<${Campo} id=${"enc-" + k} rotulo=${r} dica=${d}><div class="inp-suf"><input id=${"enc-" + k} class="inp" inputmode="decimal" value=${String(e[k]).replace(".", ",")} onInput=${x => setE(o => ({ ...o, [k]: parseValor(x.target.value) }))} /><span>%</span></div></${Campo}>`;
  const salvar = async () => { setSalvando(true); try { await api.salvarConfig({ ...cfg, encargos: e }); await recarregar(["config"]); avisar("Encargos salvos."); onFechar(); } catch (x) { avisar(x.message, true); setSalvando(false); } };
  return html`<${Modal} titulo="Encargos sobre a folha (CLT)" onFechar=${onFechar}>
    <p class="sub">Percentuais aplicados sobre a remuneração do mês para mostrar o custo real de cada funcionário CLT. Confirme com o contador.</p>
    <div class="grade">
      ${campo("fgts", "FGTS", "Depósito mensal do empregador.")}
      ${campo("inssPatronal", "INSS patronal (CPP)", "No Simples Nacional, nos anexos I a III e V a CPP já vai no DAS: use 0. No anexo IV, informe a alíquota que o contador indicar.")}
      ${campo("ferias", "Provisão de férias + 1/3", "1/12 do salário + 1/3 = 11,11%.")}
      ${campo("decimo", "Provisão de 13º salário", "1/12 do salário = 8,33%.")}
    </div>
    <div class="acoes"><span class="espaco"></span><button type="button" class="btn" onClick=${onFechar}>Cancelar</button><button type="button" class="btn btn-pri" disabled=${salvando} onClick=${salvar}>${salvando ? "Salvando…" : "Salvar"}</button></div>
  </${Modal}>`;
}

/* =================== FICHA DO FUNCIONÁRIO =================== */
export function FuncionarioTela({ id, params }) {
  const { ir, avisar, confirmar, dados } = useApp();
  const novo = id === "novo";
  const [f, setF] = useState(novo ? { ...VAZIO, admissao: hojeISO() } : null), [erro, setErro] = useState(""), [aba, setAba] = useState(params.aba || "dados");
  const [sujo, setSujo] = useState(false), [salvando, setSalvando] = useState(false);
  useEffect(() => { if (!novo) api.funcionarios.listar("nome").then(l => { const x = l.find(y => y.id === id); x ? setF({ ...VAZIO, ...x, jornada: { ...JORNADA_PADRAO, ...(x.jornada || {}) } }) : setErro("Funcionário não encontrado."); })
    .catch(e => setErro(semTabela(e) ? "v10" : e.message)); }, [id]);
  if (erro === "v10") return html`<div class="pagina">${AVISO_V10}</div>`;
  if (erro) return html`<div class="pagina"><div class="erros">${erro}</div></div>`;
  if (!f) return html`<div class="carregando">Carregando…</div>`;
  const set = p => { setF(o => ({ ...o, ...p })); setSujo(true); };
  const salvar = async () => {
    const erros = [];
    if (!f.nome.trim()) erros.push("Informe o nome.");
    if (soDig(f.cpf) && !validaCPF(f.cpf)) erros.push("CPF inválido.");
    if (f.demissao && f.admissao && f.demissao < f.admissao) erros.push("A data de desligamento é anterior à admissão.");
    if (erros.length) return avisar(erros.join(" "), true);
    setSalvando(true);
    try {
      const { id: _i, criado_em, atualizado_em, ...resto } = f;
      const obj = { ...resto, nome: f.nome.trim(), cpf: soDig(f.cpf), telefone: soDig(f.telefone), perfil_id: f.perfil_id || null, admissao: f.admissao || null, demissao: f.demissao || null,
        nascimento: f.nascimento || null, ativo: f.demissao && f.demissao <= hojeISO() ? false : f.ativo };
      const r = await api.funcionarios.salvar(novo ? obj : { id, ...obj });
      setSujo(false); avisar("Funcionário salvo.");
      if (novo) ir("/funcionario/" + r.id); else setF({ ...VAZIO, ...r, jornada: { ...JORNADA_PADRAO, ...(r.jornada || {}) } });
    } catch (e) { avisar(semTabela(e) ? "Rode o supabase/v10.sql antes de cadastrar funcionários." : e.message, true); } finally { setSalvando(false); }
  };
  const excluir = async () => {
    if (!await confirmar({ titulo: "Excluir " + f.nome, texto: "O cadastro e todos os lançamentos deste funcionário serão apagados. Para quem saiu da empresa, prefira informar a data de desligamento.", botao: "Excluir", perigo: true })) return;
    try { await api.funcionarios.excluir(id); avisar("Funcionário excluído."); ir("/funcionarios"); } catch (e) { avisar(e.message, true); }
  };
  const membros = dados.perfis.filter(p => p.papel !== "pendente");
  return html`<div class="pagina larga-media">
    <div class="painel-topo"><div><h1>${novo ? "Novo funcionário" : f.nome}</h1><span class="sub">${novo ? "Cadastro" : [f.funcao, VINCULOS[f.vinculo], f.ativo ? "" : "desligado"].filter(Boolean).join(" · ")}</span></div>
      <div class="acoes"><button type="button" class="btn" onClick=${() => ir("/funcionarios")}>← Funcionários</button></div></div>
    ${!novo ? html`<${Abas} abas=${[["dados", "Dados"], ["jornada", "Jornada e ponto"], ["mes", "Contabilidade do mês"]]} ativa=${aba} onTroca=${setAba} />` : null}
    ${aba === "dados" || novo ? html`<section class="card">
      <div class="grade">
        <${Campo} id="f-nome" rotulo="Nome completo" obrig><${Texto} id="f-nome" valor=${f.nome} onMuda=${v => set({ nome: v })} /></${Campo}>
        <${Campo} id="f-ap" rotulo="Apelido" dica="Como aparece na O.S., se for diferente do nome."><${Texto} id="f-ap" valor=${f.apelido} onMuda=${v => set({ apelido: v })} /></${Campo}>
        <${Campo} id="f-fun" rotulo="Função"><${Texto} id="f-fun" valor=${f.funcao} placeholder="Mecânico, alinhador, consultor…" onMuda=${v => set({ funcao: v })} /></${Campo}>
        <${Campo} id="f-vin" rotulo="Vínculo"><select id="f-vin" class="inp" value=${f.vinculo} onChange=${e => set({ vinculo: e.target.value })}>${Object.entries(VINCULOS).map(([k, t]) => html`<option value=${k}>${t}</option>`)}</select></${Campo}>
        <${Campo} id="f-adm" rotulo="Admissão"><input id="f-adm" type="date" class="inp" value=${f.admissao || ""} onInput=${e => set({ admissao: e.target.value })} /></${Campo}>
        <${Campo} id="f-dem" rotulo="Desligamento" dica="Deixe vazio enquanto trabalhar na oficina."><input id="f-dem" type="date" class="inp" value=${f.demissao || ""} onInput=${e => set({ demissao: e.target.value })} /></${Campo}>
      </div>
      <h3>Remuneração</h3>
      <div class="grade">
        <${Campo} id="f-sal" rotulo=${f.vinculo === "diarista" ? "Valor mensal de referência" : "Salário mensal"}><${Dinheiro} id="f-sal" valor=${f.salario} onMuda=${v => set({ salario: v })} /></${Campo}>
        <${Campo} id="f-com" rotulo="Comissão sobre mão de obra" dica="Calculada sobre os serviços das O.S. entregues em que ele é o mecânico."><div class="inp-suf"><input id="f-com" class="inp" inputmode="decimal" value=${String(f.comissao_pct).replace(".", ",")} onInput=${e => set({ comissao_pct: parseValor(e.target.value) })} /><span>%</span></div></${Campo}>
        <${Campo} id="f-hm" rotulo="Horas por mês (divisor)" dica="220 para 44 h semanais."><input id="f-hm" class="inp" inputmode="decimal" value=${String(f.horas_mes).replace(".", ",")} onInput=${e => set({ horas_mes: parseValor(e.target.value) })} /></${Campo}>
        <${Campo} id="f-he" rotulo="Adicional de hora extra" dica="Mínimo de 50% (CF, art. 7º, XVI)."><div class="inp-suf"><input id="f-he" class="inp" inputmode="decimal" value=${String(f.he_pct).replace(".", ",")} onInput=${e => set({ he_pct: parseValor(e.target.value) })} /><span>%</span></div></${Campo}>
        <${Campo} id="f-per" rotulo="Acesso ao sistema" dica="Liga as O.S. em que ele aparece como mecânico."><select id="f-per" class="inp" value=${f.perfil_id || ""} onChange=${e => set({ perfil_id: e.target.value })}><option value="">Sem acesso</option>${membros.map(p => html`<option value=${p.id}>${p.nome}</option>`)}</select></${Campo}>
      </div>
      <h3>Documentos e contato</h3>
      <div class="grade">
        <${Campo} id="f-cpf" rotulo="CPF"><${Texto} id="f-cpf" valor=${f.cpf.length === 11 ? fmtDoc(f.cpf) : f.cpf} inputmode="numeric" onMuda=${v => set({ cpf: v })} /></${Campo}>
        <${Campo} id="f-rg" rotulo="RG"><${Texto} id="f-rg" valor=${f.rg} onMuda=${v => set({ rg: v })} /></${Campo}>
        <${Campo} id="f-pis" rotulo="PIS/NIS"><${Texto} id="f-pis" valor=${f.pis} onMuda=${v => set({ pis: v })} /></${Campo}>
        <${Campo} id="f-ctps" rotulo="CTPS"><${Texto} id="f-ctps" valor=${f.ctps} onMuda=${v => set({ ctps: v })} /></${Campo}>
        <${Campo} id="f-nasc" rotulo="Nascimento"><input id="f-nasc" type="date" class="inp" value=${f.nascimento || ""} onInput=${e => set({ nascimento: e.target.value })} /></${Campo}>
        <${Campo} id="f-tel" rotulo="Telefone"><${Texto} id="f-tel" valor=${fmtTel(f.telefone)} inputmode="tel" onMuda=${v => set({ telefone: v })} /></${Campo}>
        <${Campo} id="f-pix" rotulo="Chave Pix"><${Texto} id="f-pix" valor=${f.pix} onMuda=${v => set({ pix: v })} /></${Campo}>
        <${Campo} id="f-banco" rotulo="Banco / conta"><${Texto} id="f-banco" valor=${f.banco} onMuda=${v => set({ banco: v })} /></${Campo}>
      </div>
      <${Campo} id="f-end" rotulo="Endereço"><${Texto} id="f-end" valor=${f.endereco} onMuda=${v => set({ endereco: v })} /></${Campo}>
      <${Campo} id="f-obs" rotulo="Observações"><${Area} id="f-obs" valor=${f.obs} onMuda=${v => set({ obs: v })} /></${Campo}>
      ${!novo ? html`<div class="acoes"><button type="button" class="btn btn-perigo btn-sm" onClick=${excluir}>Excluir cadastro</button></div>` : null}
    </section>`
    : aba === "jornada" ? html`<${Jornada} f=${f} set=${set} />`
    : html`<${MesFuncionario} f=${f} ymInicial=${params.mes || mesAtual()} />`}
    ${sujo || novo ? html`<div class="rodape-acoes"><div class="in">${!novo ? html`<button type="button" class="btn" onClick=${() => location.reload()}>Desfazer</button>` : null}
      <button type="button" class="btn btn-pri" disabled=${salvando} onClick=${salvar}>${salvando ? "Salvando…" : novo ? "Cadastrar funcionário" : "Salvar alterações"}</button></div></div>` : null}
  </div>`;
}

/* ---------- jornada semanal + impressão da folha de ponto ---------- */
function Jornada({ f, set }) {
  const { ir } = useApp();
  const [ym, setYm] = useState(mesAtual()), [extras, setExtras] = useState("");
  const j = f.jornada || {};
  const muda = (k, campo, v) => set({ jornada: { ...j, [k]: { ...(j[k] || { e: "", sa: "", r: "", s: "" }), [campo]: v } } });
  const total = horasSemana(j);
  const diaMax = Math.max(...DIAS.map(([k]) => minutosDia(j[k]))) / 60;
  return html`<section class="card"><h2>Horário de trabalho</h2><span class="sub">Jornada contratual. É impressa como referência na folha de ponto.</span>
    <div class="tabela-rolagem"><table class="tab-rel"><thead><tr><th>Dia</th><th>Trabalha</th><th>Entrada</th><th>Saída almoço</th><th>Retorno</th><th>Saída</th><th class="num">Horas</th></tr></thead>
      <tbody>${DIAS.map(([k, nome]) => { const d = j[k]; return html`<tr key=${k}><td>${nome}</td>
        <td><input type="checkbox" aria-label=${"Trabalha " + nome} checked=${!!d} onChange=${e => set({ jornada: { ...j, [k]: e.target.checked ? { e: "07:30", sa: "11:30", r: "13:00", s: "17:00" } : null } })} /></td>
        ${["e", "sa", "r", "s"].map(c => html`<td key=${c}>${d ? html`<input type="time" class="inp inp-hora" aria-label=${nome + " " + c} value=${d[c] || ""} onInput=${e => muda(k, c, e.target.value)} />` : "—"}</td>`)}
        <td class="num">${d ? fmtHoras(minutosDia(d) / 60) : "—"}</td></tr>`; })}</tbody>
      <tfoot><tr><td colspan="6">Total semanal</td><td class="num">${fmtHoras(total)}</td></tr></tfoot></table></div>
    ${total > 44 || diaMax > 10 ? html`<div class="aviso">${total > 44 ? "A jornada passa de 44 horas semanais (CF, art. 7º, XIII). " : ""}${diaMax > 10 ? "Algum dia passa de 10 horas (8 h normais + 2 h extras, CLT art. 59)." : ""}</div>` : null}
  </section>
  <section class="card"><h2>Folha de ponto</h2><span class="sub">Folha mensal para o funcionário anotar os horários e assinar.</span>
    <div class="grade">
      <${Campo} id="p-mes" rotulo="Mês"><input id="p-mes" type="month" class="inp" value=${ym} onChange=${e => e.target.value && setYm(e.target.value)} /></${Campo}>
      <${Campo} id="p-fer" rotulo="Feriados municipais ou pontos facultativos" dica="Dias do mês separados por vírgula (ex.: 22, 23). Os feriados nacionais já são marcados."><${Texto} id="p-fer" valor=${extras} onMuda=${setExtras} /></${Campo}>
    </div>
    <div class="acoes"><button type="button" class="btn btn-pri" onClick=${() => ir("/imprimir/ponto/" + f.id + "?mes=" + ym + (extras ? "&feriados=" + encodeURIComponent(extras) : ""))}>Imprimir folha de ponto</button></div>
  </section>`;
}

/* ---------- contabilidade do mês ---------- */
function MesFuncionario({ f, ymInicial }) {
  const { cfg, avisar, confirmar, perfil, ir } = useApp();
  const [ym, setYm] = useState(ymInicial), [m, setM] = useState(null), [novo, setNovo] = useState(null), [gerando, setGerando] = useState(false);
  const carregar = () => dadosDoMes(ym, [f]).then(x => setM(x[f.id])).catch(e => avisar(e.message, true));
  useEffect(() => { setM(null); carregar(); }, [ym, f.id]);
  const r = m ? calcularMes(f, ym, m.lancs, m.base, cfg.encargos) : null;
  const salvarLanc = async () => {
    const t = TIPOS_LANC[novo.tipo];
    if (!t.qtd && !(novo.valor > 0)) return avisar("Informe o valor.", true);
    if (t.qtd && !(novo.qtd > 0) && !(novo.valor > 0)) return avisar("Informe a quantidade de " + t.qtd + " ou o valor.", true);
    try { await api.funcionarios.lancar({ funcionario_id: f.id, competencia: periodo(ym).comp, data: novo.data || hojeISO(), tipo: novo.tipo, qtd: novo.qtd || 0, valor: novo.valor || 0, descricao: (novo.descricao || "").trim(), usuario_nome: perfil.nome });
      setNovo(null); avisar("Lançamento incluído."); carregar(); } catch (e) { avisar(e.message, true); }
  };
  const excluirLanc = async l => { if (!await confirmar({ titulo: "Excluir lançamento", texto: TIPOS_LANC[l.tipo].t + " de " + fmtData(l.data) + ".", botao: "Excluir", perigo: true })) return;
    try { await api.funcionarios.excluirLanc(l.id); carregar(); } catch (e) { avisar(e.message, true); } };
  const gerarConta = async () => {
    const doc = "FOLHA-" + ym + "-" + f.id.slice(0, 8);
    try {
      const venc = quintoDiaUtil(ym);
      const ja = (await api.contas.listar({ de: periodo(ym).ini, ate: venc, campo: "vencimento" })).find(c => c.documento === doc && c.status !== "cancelada");
      if (ja) return avisar("Já existe a conta desta folha (" + reais(ja.valor) + ", vencimento " + fmtData(ja.vencimento) + ").", true);
      if (!await confirmar({ titulo: "Lançar em Contas a pagar", texto: `Conta de ${reais(r.saldo)} para ${f.nome}, vencimento ${fmtData(venc)} (5º dia útil, CLT art. 459).`, botao: "Lançar" })) return;
      setGerando(true);
      await api.contas.salvar({ descricao: "Salário " + nomeMes(ym) + " – " + f.nome, favorecido: f.nome, categoria: f.vinculo === "socio" ? "Pró-labore" : "Salários e encargos", documento: doc,
        valor: r.saldo, emissao: hojeISO(), vencimento: venc, origem: "manual", obs: "Gerada pela tela Funcionários.", criado_por: perfil.nome });
      avisar("Conta lançada em Contas a pagar.");
    } catch (e) { avisar(e.message, true); } finally { setGerando(false); }
  };
  const linha = (t, v, neg, dica) => v ? html`<div class="func-lin" key=${t}><span>${t}${dica ? html` <small class="sub">${dica}</small>` : null}</span><b>${neg ? "− " : ""}${reais(v)}</b></div>` : null;
  return html`<section class="card"><div class="secao-topo"><h2>${nomeMes(ym)}</h2><${SeletorMes} ym=${ym} onMuda=${setYm} /></div>
    ${!r ? html`<div class="carregando">Calculando…</div>` : html`<div class="duas-col">
      <div><h3>A pagar ao funcionário</h3>
        ${linha("Salário", r.salario, false, r.diasSalario < 30 ? r.diasSalario + " dias" : "")}
        ${linha("Horas extras", r.horasExtras, false, r.qtdHorasExtras ? fmtHoras(r.qtdHorasExtras) : "")}
        ${linha("Comissão", r.comissao, false, r.comissaoAuto ? f.comissao_pct + "% de " + reais(r.baseComissao) : "")}
        ${linha("Bônus / prêmios", r.bonus)}
        ${linha("Faltas", r.faltas, true, r.qtdFaltas ? r.qtdFaltas + " dia(s)" : "")}
        ${linha("Vales e adiantamentos", r.vales, true)}
        ${linha("INSS / IRRF", r.inss, true)}
        ${linha("Outros descontos", r.descontos, true)}
        <div class="func-lin tot"><span>Líquido do mês</span><b>${reais(r.liquido)}</b></div>
        ${linha("Já pago", r.pagos, true)}
        <div class="func-lin tot"><span>Saldo a pagar</span><b>${reais(r.saldo)}</b></div>
      </div>
      <div><h3>Custo para a oficina</h3>
        ${linha("Remuneração", r.remuneracao)}
        ${com_encargos(f.vinculo) ? html`${linha("FGTS", r.encargos.fgts)}${linha("INSS patronal", r.encargos.inssPatronal)}${linha("Provisão férias + 1/3", r.encargos.ferias)}${linha("Provisão 13º", r.encargos.decimo)}${linha("FGTS sobre provisões", r.encargos.fgtsProvisoes)}`
          : html`<p class="sub">${VINCULOS[f.vinculo]}: sem encargos trabalhistas calculados.</p>`}
        <div class="func-lin tot"><span>Custo total no mês</span><b>${reais(r.custoTotal)}</b></div>
        <p class="sub">Valor da hora normal: ${reais(r.valorHora)}</p>
      </div></div>
      <div class="acoes"><button type="button" class="btn" onClick=${() => ir("/imprimir/funcionario/" + f.id + "?mes=" + ym)}>Imprimir resumo</button>
        <button type="button" class="btn btn-pri" disabled=${gerando || r.saldo <= 0} onClick=${gerarConta}>Lançar saldo em Contas a pagar</button></div>`}
  </section>
  <section class="card"><div class="secao-topo"><h3>Lançamentos do mês</h3><button type="button" class="btn btn-sm btn-pri" onClick=${() => setNovo({ tipo: "vale", data: hojeISO(), qtd: 0, valor: 0, descricao: "" })}>+ Lançar</button></div>
    ${!m ? null : !m.lancs.length ? html`<${Vazio}>Nenhum vale, hora extra, falta ou desconto neste mês.</${Vazio}>`
    : html`<div class="tabela-rolagem"><table class="tab-rel"><thead><tr><th>Data</th><th>Tipo</th><th>Descrição</th><th class="num">Qtd.</th><th class="num">Valor</th><th></th></tr></thead>
      <tbody>${m.lancs.map(l => html`<tr key=${l.id}><td>${fmtData(l.data)}</td><td>${TIPOS_LANC[l.tipo].t}</td><td>${l.descricao}</td>
        <td class="num">${Number(l.qtd) ? l.qtd + " " + (TIPOS_LANC[l.tipo].qtd || "") : ""}</td><td class="num">${TIPOS_LANC[l.tipo].sinal < 0 ? "− " : ""}${reais(r.valorDe(l))}</td>
        <td><button type="button" class="btn-link" onClick=${() => excluirLanc(l)}>Excluir</button></td></tr>`)}</tbody></table></div>`}
  </section>
  ${m && Number(f.comissao_pct) > 0 ? html`<section class="card"><h3>O.S. entregues como mecânico (${m.os.length})</h3>
    ${!m.os.length ? html`<${Vazio}>Nenhuma O.S. entregue neste mês com ${f.apelido || f.nome} como mecânico.</${Vazio}>`
    : html`<div class="tabela-rolagem"><table class="tab-rel"><thead><tr><th>O.S.</th><th>Entrega</th><th>Cliente</th><th class="num">Mão de obra</th><th class="num">Comissão</th></tr></thead>
      <tbody>${m.os.map(o => html`<tr key=${o.id} class="clicavel" onClick=${() => ir("/os/" + o.id)}><td>${numOS(o.numero)}</td><td>${fmtData(o.entregue_em)}</td><td>${(o.cliente && o.cliente.nome) || ""}</td>
        <td class="num">${reais(o.maoDeObra)}</td><td class="num">${reais(o.maoDeObra * f.comissao_pct / 100)}</td></tr>`)}</tbody></table></div>`}
  </section>` : null}
  ${novo ? html`<${Modal} titulo="Novo lançamento" onFechar=${() => setNovo(null)}>
    <div class="grade">
      <${Campo} id="l-tipo" rotulo="Tipo"><select id="l-tipo" class="inp" value=${novo.tipo} onChange=${e => setNovo(o => ({ ...o, tipo: e.target.value }))}>${Object.entries(TIPOS_LANC).map(([k, t]) => html`<option value=${k}>${t.t}</option>`)}</select></${Campo}>
      <${Campo} id="l-data" rotulo="Data"><input id="l-data" type="date" class="inp" value=${novo.data} onInput=${e => setNovo(o => ({ ...o, data: e.target.value }))} /></${Campo}>
      ${TIPOS_LANC[novo.tipo].qtd ? html`<${Campo} id="l-qtd" rotulo=${"Quantidade de " + TIPOS_LANC[novo.tipo].qtd} dica=${novo.tipo === "hora_extra" ? "Valor calculado: horas × valor-hora × (1 + adicional)." : "Valor calculado: salário ÷ 30 × dias."}>
        <input id="l-qtd" class="inp" inputmode="decimal" value=${novo.qtd ? String(novo.qtd).replace(".", ",") : ""} onInput=${e => setNovo(o => ({ ...o, qtd: parseValor(e.target.value) }))} /></${Campo}>` : null}
      <${Campo} id="l-val" rotulo=${TIPOS_LANC[novo.tipo].qtd ? "Valor (opcional, substitui o cálculo)" : "Valor"}><${Dinheiro} id="l-val" valor=${novo.valor} onMuda=${v => setNovo(o => ({ ...o, valor: v }))} /></${Campo}>
    </div>
    <${Campo} id="l-desc" rotulo="Descrição"><${Texto} id="l-desc" valor=${novo.descricao} onMuda=${v => setNovo(o => ({ ...o, descricao: v }))} /></${Campo}>
    <div class="acoes"><span class="espaco"></span><button type="button" class="btn" onClick=${() => setNovo(null)}>Cancelar</button><button type="button" class="btn btn-pri" onClick=${salvarLanc}>Lançar</button></div>
  </${Modal}>` : null}`;
}
