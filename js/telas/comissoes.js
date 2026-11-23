// RH › Comissões por serviço (v64, pedido do Danilo em 23/11/2026).
// A O.S. entregue cai aqui e o Danilo puxa CADA SERVIÇO para o nome de um funcionário, com o percentual à mão.
// O que o mecânico apontou no app (itens executados e indicações, servico_apontamentos do v60) já vem sugerido:
// a linha chega com o nome preenchido e a marca "app"; falta só conferir e pôr o percentual.
// Uma linha de serviço pode ser dividida entre dois mecânicos (percentuais diferentes).
// Só o administrador: é valor de salário, mesma regra da folha e dos documentos do RH.
import { html, useState, useEffect, useMemo } from "../lib.js";
import { api } from "../api.js";
import { useApp, Campo, Vazio } from "../ui.js";
import { AbasRH } from "./rh.js";
import { reais, fmtData, numOS, parseValor, arred } from "../util.js";
import { periodo, mesAtual, nomeMes } from "../folha.js";
import { servicosDaOS, baseDaLinha, valorComissao, competenciaDaOS, sugestoesDaOS, pctSugerido, pendenciaDaOS } from "../comissoes.js";

const AVISO_V64 = html`<div class="aviso">A comissão por serviço ainda não foi ligada no banco. Rode o arquivo <b>supabase/v64.sql</b>
  no SQL Editor do Supabase e recarregue a página. Até lá, a comissão continua sendo o percentual cheio sobre a O.S., como antes.</div>`;

function SeletorMes({ ym, onMuda }) {
  const anda = n => { const { ano, mes } = periodo(ym); const d = new Date(ano, mes - 1 + n, 1); onMuda(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0")); };
  return html`<div class="acoes centro"><button type="button" class="btn btn-sm" aria-label="Mês anterior" onClick=${() => anda(-1)}>‹</button>
    <input type="month" class="inp inp-curto" aria-label="Mês" value=${ym} onChange=${e => e.target.value && onMuda(e.target.value)} />
    <button type="button" class="btn btn-sm" aria-label="Próximo mês" onClick=${() => anda(1)}>›</button></div>`;
}

/* =================== UMA LINHA DE SERVIÇO =================== */
function LinhaServico({ item, ordem, funcs, comissoes, sugestao, onGravar, gravando }) {
  const base = baseDaLinha(item);
  // o que já está gravado manda; sem nada gravado, começa pela sugestão do app (sem percentual: quem põe é o Danilo)
  const inicial = () => comissoes.length
    ? comissoes.map(c => ({ funcionario_id: c.funcionario_id || "", pct: Number(c.percentual) || 0, origem: c.origem }))
    : (sugestao || []).map(s => ({ funcionario_id: s.funcionario_id, pct: pctSugerido(funcs.find(f => f.id === s.funcionario_id)), origem: s.origem }));
  const [linhas, setLinhas] = useState(inicial);
  const [sujo, setSujo] = useState(false);
  useEffect(() => { setLinhas(inicial()); setSujo(false); }, [item.id, comissoes.length]);

  const troca = (i, campo, v) => { setLinhas(l => l.map((x, n) => n === i ? { ...x, [campo]: v } : x)); setSujo(true); };
  const tira = i => { setLinhas(l => l.filter((_, n) => n !== i)); setSujo(true); };
  const poe = () => { setLinhas(l => [...l, { funcionario_id: "", pct: 0, origem: "manual" }]); setSujo(true); };

  const validas = linhas.filter(l => l.funcionario_id);
  const somaPct = validas.reduce((s, l) => s + (Number(l.pct) || 0), 0);
  const total = arred(validas.reduce((s, l) => s + valorComissao(base, l.pct), 0));
  const gravado = comissoes.length > 0;

  const gravar = () => onGravar(item, validas.map(l => {
    const f = funcs.find(x => x.id === l.funcionario_id);
    return { ordem_id: ordem.id, os_numero: ordem.numero || null, item_id: item.id, descricao: item.descricao || "",
      funcionario_id: l.funcionario_id, funcionario_nome: (f && (f.apelido || f.nome)) || "",
      percentual: Number(l.pct) || 0, base, valor: valorComissao(base, l.pct),
      competencia: competenciaDaOS(ordem), origem: l.origem === "app" ? "app" : "manual" };
  }));

  return html`<div class=${"com-linha" + (gravado ? " com-ok" : "")}>
    <div class="com-serv">
      <b>${item.descricao}</b>
      <span class="sub">${Number(item.qtd) > 1 ? item.qtd + " × " + reais(item.valor_unit) + " · " : ""}mão de obra ${reais(base)}</span>
    </div>
    <div class="com-rateio">
      ${linhas.map((l, i) => html`<div class="com-rat" key=${i}>
        <select class="inp" aria-label="Funcionário" value=${l.funcionario_id} onChange=${e => troca(i, "funcionario_id", e.target.value)}>
          <option value="">— escolher funcionário —</option>
          ${funcs.map(f => html`<option value=${f.id}>${f.apelido || f.nome}</option>`)}
        </select>
        <div class="com-pct">
          <input class="inp inp-curto" inputmode="decimal" aria-label="Percentual" value=${l.pct ? String(l.pct).replace(".", ",") : ""}
            onInput=${e => troca(i, "pct", parseValor(e.target.value))} /><span>%</span>
        </div>
        <b class="com-val">${reais(valorComissao(base, l.pct))}</b>
        ${l.origem === "app" ? html`<span class="com-marca" title="O mecânico marcou este serviço como executado no app">app</span>` : null}
        <button type="button" class="btn-link" onClick=${() => tira(i)}>Tirar</button>
      </div>`)}
      <div class="acoes">
        <button type="button" class="btn btn-sm" onClick=${poe}>+ Dividir com outro</button>
        <span class="espaco"></span>
        ${validas.length ? html`<span class="sub">${somaPct.toLocaleString("pt-BR")}% · ${reais(total)}</span>` : null}
        <button type="button" class=${"btn btn-sm " + (sujo ? "btn-pri" : "")} disabled=${gravando || (!sujo && !gravado)} onClick=${gravar}>
          ${gravado && !sujo ? "Lançado" : "Lançar"}</button>
      </div>
    </div>
  </div>`;
}

/* =================== UMA O.S. =================== */
function CardOS({ ordem, funcs, itens, apontamentos, comissoes, onGravar, gravando }) {
  const [aberta, setAberta] = useState(false);
  const servs = useMemo(() => servicosDaOS(itens), [itens]);
  const sug = useMemo(() => sugestoesDaOS(ordem, itens, apontamentos, funcs), [ordem.id, itens, apontamentos, funcs]);
  const pend = pendenciaDaOS(itens, comissoes);
  const porItem = id => comissoes.filter(c => c.item_id === id);
  const totalCom = arred(comissoes.reduce((s, c) => s + (Number(c.valor) || 0), 0));
  const completa = pend.faltam === 0 && pend.total > 0;

  return html`<section class="card">
    <div class="secao-topo clicavel" onClick=${() => setAberta(a => !a)}>
      <div>
        <h3>${numOS(ordem.numero)} · ${(ordem.cliente && ordem.cliente.nome) || "—"}</h3>
        <span class="sub">${(ordem.veiculo && [ordem.veiculo.marca, ordem.veiculo.modelo].filter(Boolean).join(" ")) || ""}
          ${ordem.veiculo && ordem.veiculo.placa ? " · " + ordem.veiculo.placa : ""} · entregue em ${fmtData(ordem.entregue_em)}</span>
      </div>
      <div class="acoes">
        ${completa ? html`<span class="selo selo-ok">Rateada · ${reais(totalCom)}</span>`
          : pend.faltam === pend.total ? html`<span class="selo">${pend.total} serviço${pend.total === 1 ? "" : "s"} a ratear</span>`
          : html`<span class="selo selo-aviso">Faltam ${pend.faltam} de ${pend.total}</span>`}
        <button type="button" class="btn btn-sm">${aberta ? "Ocultar" : "Abrir"}</button>
      </div>
    </div>
    ${!aberta ? null : !servs.length ? html`<${Vazio}>Esta O.S. não tem mão de obra lançada.</${Vazio}>` : html`
      ${sug.semCadastro.length ? html`<div class="aviso">Apontaram esta O.S. no app, mas o acesso não está ligado a nenhum funcionário:
        <b>${sug.semCadastro.join(", ")}</b>. Ligue em Funcionários › a pessoa › Acesso ao sistema para a comissão cair no nome certo.</div>` : null}
      ${servs.map(i => html`<${LinhaServico} key=${i.id} item=${i} ordem=${ordem} funcs=${funcs}
        comissoes=${porItem(i.id)} sugestao=${sug.por[i.id]} onGravar=${onGravar} gravando=${gravando} />`)}`}
  </section>`;
}

/* =================== TELA =================== */
export function Comissoes({ params }) {
  const { avisar } = useApp();
  const [ym, setYm] = useState(params.mes || mesAtual());
  const [dados, setDados] = useState(null), [erro, setErro] = useState(""), [gravando, setGravando] = useState(false);
  const [semV64, setSemV64] = useState(false), [soFaltando, setSoFaltando] = useState(false);

  // `limpar = false` recarrega sem apagar a tela: depois de lançar, a O.S. aberta continua aberta no mesmo lugar
  const carregar = async (limpar = true) => {
    if (limpar) setDados(null);
    setErro("");
    try {
      const p = periodo(ym);
      const [funcs, ordens] = await Promise.all([
        api.funcionarios.listar("nome"),
        api.funcionarios.ordensEntregues(p.ini + "T00:00:00-03:00", p.fim + "T00:00:00-03:00"),
      ]);
      const ids = ordens.map(o => o.id);
      const [itens, comissoes, apont] = await Promise.all([
        ids.length ? api.itensDasOrdens(ids) : [],
        ids.length ? api.comissoes.listar({ ordens: ids }) : [],
        api.apontamentos.listar({ desde: p.ini + "T00:00:00-03:00" }),
      ]);
      setSemV64(api.comissoes.semV64());
      setDados({ funcs: funcs.filter(f => f.ativo), ordens, itens, comissoes, apont });
    } catch (e) { setErro(e.message); }
  };
  useEffect(() => { carregar(); }, [ym]);

  const gravar = async (item, linhas) => {
    setGravando(true);
    try {
      await api.comissoes.salvarItem(item.id, linhas);
      avisar(linhas.length ? "Comissão lançada." : "Comissão tirada deste serviço.");
      await carregar(false);
    } catch (e) { if (/v64\.sql/.test(e.message)) setSemV64(true); avisar(e.message, "erro"); }
    setGravando(false);
  };

  if (erro) return html`<div class="pagina"><${AbasRH} ativa="comissoes" /><div class="erros">${erro}</div></div>`;
  if (!dados) return html`<div class="pagina"><${AbasRH} ativa="comissoes" /><div class="carregando">Carregando comissões…</div></div>`;

  const porOrdem = id => dados.itens.filter(i => i.ordem_id === id);
  const lista = dados.ordens.filter(o => !soFaltando || pendenciaDaOS(porOrdem(o.id), dados.comissoes.filter(c => c.ordem_id === o.id)).faltam > 0);
  // resumo por funcionário do mês
  const resumo = dados.funcs.map(f => {
    const cs = dados.comissoes.filter(c => c.funcionario_id === f.id);
    return { f, valor: arred(cs.reduce((s, c) => s + (Number(c.valor) || 0), 0)), linhas: cs.length };
  }).filter(x => x.linhas > 0);

  return html`<div class="pagina larga-media">
    <${AbasRH} ativa="comissoes" />
    <div class="painel-topo">
      <div><h1>Comissões por serviço</h1><span class="sub">O.S. entregues em ${nomeMes(ym)} · o percentual é lançado por você</span></div>
      <div class="acoes"><${SeletorMes} ym=${ym} onMuda=${setYm} /></div>
    </div>
    ${semV64 ? AVISO_V64 : null}
    ${resumo.length ? html`<div class="kpis">
      ${resumo.map(x => html`<div class="kpi" key=${x.f.id}><span>${x.f.apelido || x.f.nome}</span>
        <b class="kpi-num">${reais(x.valor)}</b><span class="sub">${x.linhas} serviço${x.linhas === 1 ? "" : "s"}</span></div>`)}
    </div>` : null}
    <div class="acoes">
      <label class="com-chk"><input type="checkbox" checked=${soFaltando} onChange=${e => setSoFaltando(e.target.checked)} /> Só as que faltam ratear</label>
    </div>
    ${!lista.length ? html`<${Vazio}>${dados.ordens.length ? "Todas as O.S. entregues neste mês já foram rateadas." : "Nenhuma O.S. entregue em " + nomeMes(ym) + "."}</${Vazio}>`
      : lista.map(o => html`<${CardOS} key=${o.id} ordem=${o} funcs=${dados.funcs} itens=${porOrdem(o.id)}
          apontamentos=${dados.apont.filter(a => a.ordem_id === o.id)} comissoes=${dados.comissoes.filter(c => c.ordem_id === o.id)}
          onGravar=${gravar} gravando=${gravando} />`)}
    <p class="sub">O que for lançado aqui entra na folha do mês da entrega, no lugar do percentual cheio da O.S.
      O.S. sem rateio continuam contando pelo percentual do cadastro do funcionário, como antes.</p>
  </div>`;
}
