// Comissão por quinzena (v61, pedido do Danilo em 18/11/2026).
// Puxa o que cada mecânico apontou no app (servico_apontamentos, v60) na quinzena, aplica o percentual da matriz e lança:
// a comissão vira CUSTO do item de serviço na O.S. (inclusive nas já entregues e pagas, decisão dele) e lançamento na folha.
// Decisões do Danilo: quinzena fixa (1 a 15 e 16 ao fim do mês); matriz editada nesta tela; percentual sobre a mão de obra;
// serviço apontado por dois mecânicos é dividido em partes iguais, cada um com o percentual dele.
// Ordem do percentual: exceção do mecânico naquele grupo → padrão do mecânico → comissao_pct da ficha → o que for digitado aqui.
// 24/11/2026 (pedido do Danilo): "Puxar O.S." passa a aceitar serviço SEM apontamento no app. Antes, serviço que ninguém
// apontou ficava fora da comissão e não havia como lançar na mão — e é justamente o caso das O.S. antigas e do mecânico
// que esqueceu de apontar. Agora o Danilo escolhe quem fez e o sistema GRAVA O APONTAMENTO (decisão dele: tem de entrar
// nos serviços executados do app, para o histórico do mecânico ficar certo), do mesmo jeito que "Quem executou este serviço?".
import { html, useState, useEffect, useMemo } from "../lib.js";
import { api } from "../api.js";
import { useApp, Modal, Vazio, Placa, Campo, Texto } from "../ui.js";
import { reais, fmtData, numOS, normPlaca, totalItem, parseValor } from "../util.js";
import { pode, chaveGrupo, gruposDeProdutos } from "../regras.js";
import { quinzenas, mesAtual, periodo, nomeMes, quintoDiaUtil } from "../folha.js";
import { AbasRH } from "./rh.js";

const FALTA_V61 = "A comissão por quinzena precisa do arquivo supabase/v61.sql, que o administrador roda uma vez no Supabase.";
const n2 = v => Math.round((Number(v) || 0) * 100) / 100;
const pctFmt = p => (Math.round((Number(p) || 0) * 100) / 100).toString().replace(".", ",") + "%";

/* =================== CABEÇALHO: mês, quinzena e mecânico =================== */
function Topo({ ym, setYm, qz, setQz, qs }) {
  const anda = d => { const { ano, mes } = periodo(ym); const x = new Date(ano, mes - 1 + d, 1); setYm(x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0")); };
  return html`<div class="cm-periodo">
    <div class="acoes centro">
      <button type="button" class="btn btn-sm" aria-label="Mês anterior" onClick=${() => anda(-1)}>‹</button>
      <input type="month" class="inp inp-curto" aria-label="Mês" value=${ym} onChange=${e => e.target.value && setYm(e.target.value)} />
      <button type="button" class="btn btn-sm" aria-label="Próximo mês" onClick=${() => anda(1)}>›</button>
    </div>
    <div class="chips" role="group" aria-label="Quinzena">${qs.map((x, i) => html`<button type="button" key=${x.inicio}
      class=${"chip" + (i === qz ? " chip-f" : "")} aria-pressed=${i === qz ? "true" : "false"} onClick=${() => setQz(i)}>${x.rotulo}</button>`)}</div>
  </div>`;
}

/* =================== MATRIZ DE PERCENTUAIS =================== */
// Fica na FICHA DO FUNCIONÁRIO (comissao_pct e comissao_grupos), não nos Ajustes: a tabela config é lida por toda a
// equipe e percentual de comissão é dado de folha.
function Matriz({ funcs, grupos, onFechar, onSalvou, avisar }) {
  const [vals, setVals] = useState(() => Object.fromEntries(funcs.map(f => [f.id, { pct: f.comissao_pct ?? 0, grupos: { ...(f.comissao_grupos || {}) } }])));
  const [salvando, setSalvando] = useState(false);
  const [quem, setQuem] = useState((funcs[0] || {}).id || "");
  const f = funcs.find(x => x.id === quem);
  const v = vals[quem] || { pct: 0, grupos: {} };
  const ok = n => n === "" || (Number.isFinite(Number(n)) && Number(n) >= 0 && Number(n) <= 100);
  const valido = Object.values(vals).every(x => ok(x.pct) && Object.values(x.grupos).every(ok));
  const mudaGrupo = (chave, valor) => setVals(a => { const g = { ...a[quem].grupos };
    if (valor === "") delete g[chave]; else g[chave] = valor;
    return { ...a, [quem]: { ...a[quem], grupos: g } }; });
  const salvar = async () => {
    if (!valido) { avisar("Os percentuais têm de ficar entre 0 e 100.", true); return; }
    setSalvando(true);
    try {
      for (const x of funcs) {
        const a = vals[x.id];
        const grupos = Object.fromEntries(Object.entries(a.grupos).map(([k, n]) => [k, n2(n)]));
        const pct = n2(a.pct === "" ? 0 : a.pct);
        if (pct === Number(x.comissao_pct ?? 0) && JSON.stringify(grupos) === JSON.stringify(x.comissao_grupos || {})) continue;
        await api.funcionarios.salvar({ id: x.id, comissao_pct: pct, comissao_grupos: grupos });
      }
      await onSalvou(); avisar("Percentuais salvos."); onFechar();
    } catch (e) { avisar(/comissao_grupos|column/i.test(e.message || "") ? FALTA_V61 : e.message, true); } finally { setSalvando(false); }
  };
  return html`<${Modal} titulo="Percentuais de comissão" onFechar=${onFechar} largo>
    <p class="sub">O serviço usa o percentual do grupo quando houver; sem exceção, vale o padrão do mecânico. Na hora de lançar
      o senhor ainda pode digitar outro percentual só naquele serviço. Fica na ficha do funcionário, que só o administrador vê.</p>
    <div class="cm-mx-quem">${funcs.map(x => html`<button type="button" key=${x.id} class=${"chip" + (x.id === quem ? " chip-f" : "")}
      onClick=${() => setQuem(x.id)}>${x.apelido || x.nome}</button>`)}</div>
    ${!f ? html`<${Vazio}>Cadastre os mecânicos em Funcionários, com o acesso do sistema vinculado.</${Vazio}>` : html`
      <div class="cm-mx-padrao">
        <${Campo} id="cm-padrao" rotulo=${"Padrão de " + (f.apelido || f.nome)}>
          <div class="cm-pct-campo"><input id="cm-padrao" class=${"inp inp-curto" + (ok(v.pct) ? "" : " inp-erro")} type="number" min="0" max="100" step="0.5"
            value=${v.pct} onInput=${e => setVals(a => ({ ...a, [quem]: { ...a[quem], pct: e.target.value } }))} /><span>%</span></div>
        </${Campo}>
        <span class="dica">Vale para todo serviço sem exceção de grupo.</span>
      </div>
      <h3 class="cm-mx-tit">Exceções por grupo de serviço</h3>
      <div class="cm-mx-grupos">${grupos.map(g => html`<label class="cm-mx-linha" key=${g.chave}>
        <span>${g.nome}</span>
        <span class="cm-pct-campo"><input class=${"inp inp-curto" + (ok(v.grupos[g.chave] ?? "") ? "" : " inp-erro")} type="number" min="0" max="100" step="0.5"
          aria-label=${"Percentual de " + g.nome} value=${v.grupos[g.chave] ?? ""} placeholder=${String(v.pct || 0)}
          onInput=${e => mudaGrupo(g.chave, e.target.value)} /><span>%</span></span>
      </label>`)}
      ${!grupos.length ? html`<${Vazio}>Nenhum grupo de serviço no cadastro de produtos ainda.</${Vazio}>` : null}</div>`}
    <div class="acoes-modal">
      <button type="button" class="btn" onClick=${onFechar}>Cancelar</button>
      <button type="button" class="btn btn-pri" disabled=${salvando || !valido} onClick=${salvar}>${salvando ? "Salvando…" : "Salvar percentuais"}</button>
    </div>
  </${Modal}>`;
}

/* =================== PUXAR O.S. PARA O MECÂNICO =================== */
// Traz para a quinzena um serviço apontado fora dela (O.S. antiga, apontamento esquecido).
function PuxarOS({ onFechar, onPuxar, avisar, funcs, quinzena, onAtribuido }) {
  const { dados } = useApp();
  const [busca, setBusca] = useState(""), [achados, setAchados] = useState(null), [carregando, setCarregando] = useState(false);
  const [paraQuem, setParaQuem] = useState("");       // o mecânico que vai receber a O.S.
  const [fora, setFora] = useState([]);               // serviços que o Danilo tirou desta puxada
  const [salvando, setSalvando] = useState(false);
  const procurar = async () => {
    const t = busca.trim(); if (!t) return;
    setCarregando(true); setAchados(null); setFora([]);
    try {
      const num = /^\d+$/.test(t) ? Number(t) : null;
      const pl = normPlaca(t);
      const achada = (dados.ordens || []).find(x => num ? x.numero === num : normPlaca((x.veiculo || {}).placa) === pl);
      const o = achada ? await api.ordem(achada.id) : null;
      if (!o) { setAchados([]); return; }
      const aps = await api.apontamentos.listar({ ordem_id: o.id });
      const fins = (aps || []).filter(a => a.situacao === "finalizado");
      const servicos = (o.itens || []).filter(i => i.tipo === "servico" && i.aprovado !== false).map(i => {
        const quem = fins.filter(a => (a.itens_executados || []).includes(i.id));
        return { item: i, quem: quem.map(a => ({ id: a.perfil_id, nome: a.perfil_nome })) };
      });
      setAchados([{ os: o, servicos }]);
    } catch (e) { avisar(e.message, true); setAchados([]); } finally { setCarregando(false); }
  };

  const achado = (achados || [])[0];
  const comApontamento = achado ? achado.servicos.filter(s => s.quem.length) : [];
  const vao = achado ? achado.servicos.filter(s => !fora.includes(s.item.id)) : [];
  const semDono = vao.filter(s => !s.quem.length);     // só estes precisam de apontamento novo
  const destino = (funcs || []).find(f => f.id === paraQuem);

  /** Puxa a O.S. INTEIRA para um mecânico: o que ninguém apontou passa a ser dele (apontamento gravado, para entrar
   *  no histórico do app), e o que já tem dono vem como está. Depois é na lista da quinzena que o Danilo ajusta o
   *  percentual de cada linha e diz, pelo "Quem executou este serviço?", se outro mecânico fez algum deles. */
  const puxarTudo = async () => {
    if (!destino || !vao.length) return;
    setSalvando(true);
    try {
      if (semDono.length) {
        const aps = await api.apontamentos.listar({ ordem_id: achado.os.id });
        const dele = aps.filter(a => a.perfil_id === destino.perfil_id);
        // o que ele deixou ABERTO no app (andamento/pausado) vem primeiro: a puxada fecha esse, em vez de abrir outro
        // — o banco não aceita dois abertos do mesmo mecânico na mesma O.S., e era aí que a puxada travava.
        const alvo = dele.find(a => a.situacao !== "finalizado") || dele.find(a => a.situacao === "finalizado");
        const ids = semDono.map(s => s.item.id);
        if (alvo) {
          const patch = { itens_executados: [...new Set([...(alvo.itens_executados || []), ...ids])] };
          // fecha DENTRO da quinzena aberta, senão os serviços cairiam noutra
          if (alvo.situacao !== "finalizado") { patch.situacao = "finalizado"; patch.fim = dentroDaQuinzena(quinzena); }
          await api.apontamentos.atualizar(alvo.id, patch);
        } else {
          const novo = await api.apontamentos.abrir({ ordem_id: achado.os.id, os_numero: achado.os.numero, perfil_id: destino.perfil_id, perfil_nome: destino.apelido || destino.nome });
          await api.apontamentos.atualizar(novo.id, { situacao: "finalizado", fim: dentroDaQuinzena(quinzena), itens_executados: ids });
        }
      }
      for (const s of vao) onPuxar(s.item.id);
      avisar(numOS(achado.os.numero) + ": " + vao.length + " serviço" + (vao.length === 1 ? "" : "s") + " na quinzena"
        + (semDono.length ? ", " + semDono.length + " apontado" + (semDono.length === 1 ? "" : "s") + " para " + (destino.apelido || destino.nome) : "") + ".");
      if (onAtribuido) await onAtribuido();
      onFechar();
    } catch (e) { avisar(e.message, true); } finally { setSalvando(false); }
  };

  return html`<${Modal} titulo="Puxar O.S. para o mecânico" onFechar=${onFechar} largo>
    <p class="sub">Para trazer uma O.S. de outra quinzena, já fechada, ou para adiantar o serviço dela para esta quinzena.
      Escolha o mecânico: o que ninguém apontou no app passa a ser dele (entra também nos serviços executados dele no app)
      e o que já tem dono vem como está. Depois, na lista da quinzena, você ajusta o percentual de cada linha e troca
      quem fez, como nas O.S. apontadas pelo app.</p>
    <div class="cm-puxar-busca">
      <${Texto} id="cm-busca" valor=${busca} onMuda=${setBusca} placeholder="Número da O.S. ou placa" onKeyDown=${e => e.key === "Enter" && procurar()} />
      <button type="button" class="btn btn-pri" onClick=${procurar} disabled=${carregando}>${carregando ? "Procurando…" : "Procurar"}</button>
    </div>
    ${achados && !achado ? html`<${Vazio}>Nenhuma O.S. com esse número ou placa.</${Vazio}>` : null}
    ${achado ? html`<div class="cm-puxar-res">
      <div class="cm-puxar-cab"><b>${numOS(achado.os.numero)}</b><${Placa} placa=${(achado.os.veiculo || {}).placa} />
        <span class="sub">${(achado.os.cliente || {}).nome || ""} · ${achado.servicos.length} serviço${achado.servicos.length === 1 ? "" : "s"}
          · ${comApontamento.length} apontado${comApontamento.length === 1 ? "" : "s"} no app</span></div>
      ${!achado.servicos.length ? html`<${Vazio}>Esta O.S. não tem mão de obra aprovada.</${Vazio}>` : html`
        <div class="cm-puxar-destino">
          <${Campo} id="cm-para" rotulo="Puxar para o mecânico" obrig>
            <select id="cm-para" class="inp" value=${paraQuem} onChange=${e => setParaQuem(e.target.value)}>
              <option value="">— escolha o mecânico —</option>
              ${(funcs || []).map(f => html`<option value=${f.id}>${f.apelido || f.nome}</option>`)}
            </select></${Campo}>
          <button type="button" class="btn btn-pri" id="cm-puxar-tudo" disabled=${!destino || !vao.length || salvando} onClick=${puxarTudo}>
            ${salvando ? "Puxando…" : "Puxar " + vao.length + " serviço" + (vao.length === 1 ? "" : "s")}</button>
        </div>
        <p class="sub">Desmarque o que não for desta puxada.</p>
        <ul class="cm-puxar-itens">${achado.servicos.map(s => html`<li key=${s.item.id} class=${fora.includes(s.item.id) ? "cm-sem-ap" : ""}>
          <label class="cm-marca">
            <input type="checkbox" class="chk-exec" checked=${!fora.includes(s.item.id)}
              onChange=${e => setFora(l => e.target.checked ? l.filter(x => x !== s.item.id) : [...l, s.item.id])} />
            <span>${s.item.descricao}</span>
          </label>
          <span class="cm-mo">${reais(totalItem(s.item))}</span>
          <span class="sub">${s.quem.length ? s.quem.map(q => q.nome).join(" e ") : (destino ? "vai para " + (destino.apelido || destino.nome) : "sem apontamento")}</span>
        </li>`)}</ul>`}
    </div>` : null}
  </${Modal}>`;
}

/* =================== QUEM EXECUTOU ESTE SERVIÇO =================== */
// Corrige o apontamento: troca o mecânico ou divide o serviço ao meio com outro.
/** Um instante dentro da quinzena: hoje se a quinzena for a de hoje, senão o último dia dela ao meio-dia. */
const dentroDaQuinzena = q => {
  const hoje = new Date().toISOString().slice(0, 10);
  return hoje >= q.inicio && hoje <= q.fim ? new Date().toISOString() : q.fim + "T12:00:00-03:00";
};

function QuemFez({ linha, quinzena, funcs, perfilDe, onFechar, onFeito, avisar }) {
  const [salvando, setSalvando] = useState(false);
  const outros = funcs.filter(f => f.id !== linha.funcionario_id && f.perfil_id);
  const mexer = async (acao, destino) => {
    setSalvando(true);
    try {
      const aps = (await api.apontamentos.listar({ ordem_id: linha.ordem_id })).filter(a => a.situacao === "finalizado");
      // tirar: TODOS os apontamentos do mecânico com este serviço (ele pode ter mais de um nesta O.S.)
      if (acao === "trocar") for (const a of aps.filter(a => a.perfil_id === perfilDe(linha.funcionario_id) && (a.itens_executados || []).includes(linha.item_id)))
        await api.apontamentos.atualizar(a.id, { itens_executados: (a.itens_executados || []).filter(x => x !== linha.item_id) });
      const alvo = aps.find(a => a.perfil_id === destino.perfil_id);
      if (alvo) { if (!(alvo.itens_executados || []).includes(linha.item_id)) await api.apontamentos.atualizar(alvo.id, { itens_executados: [...(alvo.itens_executados || []), linha.item_id] }); }
      else {
        // o apontamento novo nasce DENTRO da quinzena aberta, senão o serviço apareceria noutra
        const novo = await api.apontamentos.abrir({ ordem_id: linha.ordem_id, os_numero: linha.os_numero, perfil_id: destino.perfil_id, perfil_nome: destino.apelido || destino.nome });
        await api.apontamentos.atualizar(novo.id, { situacao: "finalizado", fim: dentroDaQuinzena(quinzena), itens_executados: [linha.item_id] });
      }
      avisar(acao === "trocar" ? "Serviço passado para " + (destino.apelido || destino.nome) + "." : "Serviço dividido com " + (destino.apelido || destino.nome) + ".");
      await onFeito(); onFechar();
    } catch (e) { avisar(e.message, true); } finally { setSalvando(false); }
  };
  return html`<${Modal} titulo="Quem executou este serviço?" onFechar=${onFechar}>
    <p class="sub"><b>${linha.descricao}</b> · ${numOS(linha.os_numero)} · mão de obra ${reais(linha.mao_de_obra)}</p>
    <p class="sub">Hoje está com <b>${linha.nome}</b>${linha.dividido_com ? " (dividido com " + linha.dividido_com + ")" : ""}.
      Isto corrige o apontamento do app, então vale também para o histórico do mecânico.</p>
    ${!outros.length ? html`<${Vazio}>Não há outro mecânico com acesso do sistema vinculado.</${Vazio}>` : html`
      <ul class="cm-quem-lista">${outros.map(o => html`<li key=${o.id}>
        <span>${o.apelido || o.nome}</span>
        <span class="acoes-inline">
          <button type="button" class="btn btn-sm" disabled=${salvando} onClick=${() => mexer("dividir", o)}>Dividir ao meio</button>
          <button type="button" class="btn btn-sm" disabled=${salvando} onClick=${() => mexer("trocar", o)}>Passar para ele</button>
        </span>
      </li>`)}</ul>`}
  </${Modal}>`;
}

/* =================== TELA =================== */
export function Comissao() {
  const { cfg, dados, perfil, avisar, confirmar, ir, recarregar } = useApp();
  const [ym, setYm] = useState(mesAtual());
  const [qz, setQz] = useState(new Date().getDate() <= 15 ? 0 : 1);
  const [funcs, setFuncs] = useState(null), [erro, setErro] = useState("");
  const [lista, setLista] = useState(null), [lancs, setLancs] = useState([]), [doMes, setDoMes] = useState([]);
  const [quem, setQuem] = useState("");               // filtro de mecânico ("" = todos)
  // chaveados por mecânico + serviço: no serviço dividido o mesmo item aparece no bloco dos dois
  const [pcts, setPcts] = useState({});               // percentual digitado
  const [vals, setVals] = useState({});               // valor em reais digitado à mão (vira percentual)
  const [fora, setFora] = useState({});               // serviços desmarcados
  const [puxados, setPuxados] = useState([]);
  const [tirando, setTirando] = useState(false);
  const [verMatriz, setVerMatriz] = useState(false), [verPuxar, setVerPuxar] = useState(false), [verQuem, setVerQuem] = useState(null);
  const [lancando, setLancando] = useState("");
  const qs = useMemo(() => quinzenas(ym), [ym]);
  // marca e modelo do carro, para ler o cartão sem decorar placa (pedido do Danilo, 24/11/2026)
  const modeloDaOS = useMemo(() => {
    const m = {};
    for (const o of (dados.ordens || [])) {
      const v = o.veiculo || {}, nome = [v.marca, v.modelo].filter(Boolean).join(" ").trim();
      if (nome) m[o.numero] = nome;
    }
    return m;
  }, [dados.ordens]);
  const q = qs[qz] || qs[0];

  useEffect(() => { api.funcionarios.listar("nome").then(setFuncs).catch(e => setErro(e.message)); }, []);
  const perfilDeFunc = fid => ((funcs || []).find(f => f.id === fid) || {}).perfil_id;
  /** Tira o serviço do nome do mecânico (pedido do Danilo, 24/11/2026): sai do apontamento dele — e o apontamento que
   *  ficar sem serviço nenhum é apagado — então sai da comissão da quinzena e do histórico dele no app.
   *  A O.S., a mão de obra e o que já foi lançado não mudam (lançamento errado se desfaz em "Cancelar"). */
  const tirar = async (b, linhas) => {
    const alvo = linhas.filter(l => !l.ja_lancado);
    if (!alvo.length) { avisar("Esses serviços já foram lançados: use Cancelar no lançamento.", true); return; }
    const perfil_id = perfilDeFunc(b.funcionario_id);
    if (!perfil_id) { avisar("A ficha de " + b.nome + " não está ligada a um acesso do sistema.", true); return; }
    const um = alvo.length === 1;
    const ok = await confirmar({
      titulo: um ? "Tirar este serviço de " + b.nome + "?" : "Tirar " + alvo.length + " serviços de " + b.nome + "?",
      texto: (um ? "O serviço sai" : "Os serviços saem") + " da comissão desta quinzena e deixa" + (um ? "" : "m")
        + " de ficar no nome dele nos serviços executados do app. A O.S. e a mão de obra não mudam.",
      botao: "Tirar", perigo: true });
    if (!ok) return;
    setTirando(true);
    try {
      const porOrdem = {};
      for (const l of alvo) (porOrdem[l.ordem_id] = porOrdem[l.ordem_id] || []).push(l.item_id);
      for (const ordem_id of Object.keys(porOrdem)) {
        const ids = porOrdem[ordem_id];
        const aps = (await api.apontamentos.listar({ ordem_id })).filter(a => a.perfil_id === perfil_id);
        for (const a of aps) {
          const antes = a.itens_executados || [], restam = antes.filter(x => !ids.includes(x));
          if (restam.length === antes.length) continue;
          if (restam.length) await api.apontamentos.atualizar(a.id, { itens_executados: restam });
          else await api.apontamentos.excluir(a.id);
        }
      }
      setPuxados(p => p.filter(x => !alvo.some(l => l.item_id === x)));
      avisar(um ? "Serviço tirado de " + b.nome + "." : alvo.length + " serviços tirados de " + b.nome + ".");
      await carregar();
    } catch (e) { avisar(e.message, true); } finally { setTirando(false); }
  };
  const carregar = async () => {
    setLista(null);
    try {
      const [l, ls, mes] = await Promise.all([api.comissao.quinzena(q.inicio, q.fim, null, puxados),
        api.comissao.lancamentos({ inicio: q.inicio, fim: q.fim }), api.comissao.lancamentos({ competencia: ym + "-01" })]);
      if (l === null) { setErro("v61"); return; }
      setLista(l); setLancs((ls || []).filter(x => x.situacao === "lancado")); setDoMes((mes || []).filter(x => x.situacao === "lancado"));
    } catch (e) { setErro(e.message); }
  };
  useEffect(() => { if (funcs) carregar(); }, [funcs, ym, q.inicio, q.fim, puxados]);
  useEffect(() => { setPcts({}); setVals({}); setFora({}); }, [q.inicio, q.fim]);

  const grupos = useMemo(() => {
    const comServico = new Set((dados.produtos || []).filter(p => p.tipo === "servico" && p.categoria).map(p => chaveGrupo(p.categoria)));
    const naMatriz = new Set((funcs || []).flatMap(f => Object.keys(f.comissao_grupos || {})));
    return gruposDeProdutos(dados.produtos || [], cfg).filter(g => comServico.has(g.chave) || naMatriz.has(g.chave));
  }, [dados.produtos, cfg, funcs]);
  const mecanicos = useMemo(() => (funcs || []).filter(f => f.ativo !== false && f.perfil_id), [funcs]);
  const perfilDe = id => ((funcs || []).find(f => f.id === id) || {}).perfil_id;

  if (!pode(perfil, "financeiro")) return html`<div class="pagina"><div class="aviso">A comissão é da folha: só o administrador vê esta tela.</div></div>`;
  if (erro === "v61") return html`<div class="pagina"><${AbasRH} ativa="comissao" /><div class="aviso">${FALTA_V61}</div></div>`;
  if (erro) return html`<div class="pagina"><${AbasRH} ativa="comissao" /><div class="erros" role="alert">${erro}</div></div>`;
  if (!funcs || !lista) return html`<div class="pagina"><${AbasRH} ativa="comissao" /><div class="carregando">Carregando a quinzena…</div></div>`;

  const visiveis = quem ? lista.filter(x => x.funcionario_id === quem) : lista;
  const ch = (fid, l) => fid + "|" + l.item_id;
  const pctDe = (fid, l) => { const v = pcts[ch(fid, l)]; return v === undefined || v === "" ? Number(l.pct) || 0 : Number(v) || 0; };
  const pctOk = p => Number.isFinite(p) && p >= 0 && p <= 100;
  const valorDe = (fid, l) => n2(n2(l.base) * pctDe(fid, l) / 100);
  /** valor digitado à mão: guarda o texto e grava o percentual equivalente (pedido do Danilo, 24/11/2026) */
  const digitarValor = (fid, l, txt) => {
    const k = ch(fid, l), base = n2(l.base);
    setVals(o => ({ ...o, [k]: txt }));
    if (!base) return;
    const p = String(txt).trim() === "" ? "" : String(Math.round(parseValor(txt) / base * 1e6) / 1e4);
    setPcts(o => ({ ...o, [k]: p }));
  };
  const entra = (fid, l) => !l.ja_lancado && !l.sem_saldo && !fora[ch(fid, l)];
  const porOS = itens => { const m = new Map(); for (const l of itens) { const k = String(l.os_numero || "—"); if (!m.has(k)) m.set(k, []); m.get(k).push(l); } return [...m.entries()]; };

  const lancar = async bloco => {
    const itens = bloco.itens.filter(l => entra(bloco.funcionario_id, l));
    if (!itens.length) { avisar("Marque pelo menos um serviço.", true); return; }
    const ruim = itens.find(l => !pctOk(pctDe(bloco.funcionario_id, l)));
    if (ruim) { avisar("O percentual de \"" + ruim.descricao + "\" tem de ficar entre 0 e 100.", true); return; }
    const total = itens.reduce((s, l) => s + valorDe(bloco.funcionario_id, l), 0);
    const oss = [...new Set(itens.map(l => l.os_numero))].filter(Boolean);
    const venc = quintoDiaUtil(ym);
    const ok = await confirmar({
      titulo: "Lançar a comissão de " + bloco.nome + "?",
      texto: `${itens.length} serviço${itens.length === 1 ? "" : "s"} · ${reais(total)}\n\n` +
        `O lançamento faz três coisas:\n` +
        `• entra como custo do serviço em ${oss.length} O.S. (${oss.map(numOS).join(", ")}) — inclusive nas já entregues, então a margem delas muda;\n` +
        `• entra na folha de ${nomeMes(ym)} como comissão, para pagar no 5º dia útil (${fmtData(venc)});\n` +
        `• trava esses serviços: não entram de novo noutra quinzena.\n\nDá para desfazer tudo cancelando o lançamento.`,
      botao: "Lançar " + reais(total),
    });
    if (!ok) return;
    setLancando(bloco.funcionario_id);
    try {
      const r = await api.comissao.lancar({ funcionario_id: bloco.funcionario_id, inicio: q.inicio, fim: q.fim,
        competencia: ym + "-01", usuario_nome: (perfil || {}).nome || "",
        itens: itens.map(l => ({ item_id: l.item_id, pct: pctDe(bloco.funcionario_id, l) })) });
      avisar("Comissão de " + bloco.nome + " lançada: " + reais(r.total) + ".");
      await carregar(); await recarregar(["ordens"]);
    } catch (e) { avisar(e.message, true); } finally { setLancando(""); }
  };
  const cancelar = async c => {
    const ok = await confirmar({ titulo: "Cancelar o lançamento?",
      texto: `${c.funcionario_nome} · ${reais(c.total)} · ${c.servicos} serviço${c.servicos === 1 ? "" : "s"}\n\n` +
        "Tira o custo das O.S., apaga o lançamento da folha e libera os serviços para lançar de novo.",
      botao: "Cancelar o lançamento", perigo: true });
    if (!ok) return;
    try { await api.comissao.cancelar(c.id, "cancelado por " + ((perfil || {}).nome || "administrador"));
      avisar("Lançamento cancelado."); await carregar(); await recarregar(["ordens"]); }
    catch (e) { avisar(e.message, true); }
  };

  return html`<div class="pagina larga-media">
    <${AbasRH} ativa="comissao" />
    <div class="painel-topo">
      <div><h1>Comissão</h1><span class="sub">${q.rotulo} · a comissão vira custo do serviço na O.S. e lançamento na folha</span></div>
      <div class="acoes">
        <button type="button" class="btn" onClick=${() => setVerPuxar(true)}>Puxar O.S.</button>
        <button type="button" class="btn" onClick=${() => setVerMatriz(true)}>Percentuais</button>
      </div>
    </div>
    <${Topo} ym=${ym} setYm=${setYm} qz=${qz} setQz=${setQz} qs=${qs} />

    ${lancs.length ? html`<section class="card cm-lancados">
      <h2>Já lançado nesta quinzena</h2>
      <ul>${lancs.map(c => html`<li key=${c.id}>
        <span><b>${c.funcionario_nome}</b> · ${c.servicos} serviço${c.servicos === 1 ? "" : "s"} · ${reais(c.total)}</span>
        <span class="acoes-inline"><span class="sub">${fmtData(c.criado_em)}</span>
          <button type="button" class="btn btn-sm" onClick=${() => ir("/imprimir/comissao/" + c.id)}>Extrato</button>
          <button type="button" class="btn btn-sm btn-perigo" onClick=${() => cancelar(c)}>Cancelar</button></span>
      </li>`)}</ul>
    </section>` : null}

    ${(() => {
      const outra = qs[qz === 0 ? 1 : 0];
      const lancadosNaOutra = new Set(doMes.filter(c => c.inicio === outra.inicio && c.fim === outra.fim).map(c => c.funcionario_id));
      const faltam = doMes.filter(c => c.inicio === q.inicio && c.fim === q.fim && !lancadosNaOutra.has(c.funcionario_id)).map(c => c.funcionario_nome);
      return faltam.length ? html`<div class="aviso">A folha de ${nomeMes(ym)} só fecha com as duas quinzenas lançadas.
        Ainda falta a de <b>${outra.rotulo}</b> para: ${faltam.join(", ")}.</div>` : null;
    })()}

    ${mecanicos.length > 1 ? html`<div class="chips cm-chips">
      <button type="button" class=${"chip" + (quem ? "" : " chip-f")} onClick=${() => setQuem("")}>Todos</button>
      ${lista.map(b => html`<button type="button" key=${b.funcionario_id} class=${"chip" + (quem === b.funcionario_id ? " chip-f" : "")}
        onClick=${() => setQuem(b.funcionario_id)}>${b.nome}</button>`)}
    </div>` : null}

    ${!visiveis.length ? html`<${Vazio}>Nenhum serviço apontado no app nesta quinzena.
      Se faltou um apontamento, use <b>Puxar O.S.</b> ou peça ao mecânico para apontar no app.</${Vazio}>` : null}

    ${visiveis.map(b => {
      const dentro = b.itens.filter(l => entra(b.funcionario_id, l));
      const total = dentro.reduce((s, l) => s + valorDe(b.funcionario_id, l), 0);
      const mo = dentro.reduce((s, l) => s + n2(l.base), 0);
      const temErro = dentro.some(l => !pctOk(pctDe(b.funcionario_id, l)));
      const jaFoi = b.itens.filter(l => l.ja_lancado).length;
      return html`<section class="card cm-bloco" key=${b.funcionario_id}>
        <div class="secao-topo"><h2>${b.nome}</h2>
          <button type="button" class="btn btn-pri" disabled=${!dentro.length || temErro || lancando === b.funcionario_id}
            onClick=${() => lancar(b)}>${lancando === b.funcionario_id ? "Lançando…" : "Lançar " + reais(total)}</button></div>
        <div class="cm-cartoes">
          <div><span>Serviços</span><b>${dentro.length}</b></div>
          <div><span>Mão de obra da parte dele</span><b>${reais(mo)}</b></div>
          <div class="cm-destaque"><span>Comissão</span><b>${reais(total)}</b></div>
          <div><span>Já lançados</span><b>${jaFoi}</b></div>
        </div>
        ${porOS(b.itens).map(([num, itens]) => html`<div class="cm-os" key=${num}>
          <div class="cm-os-cab"><${Placa} placa=${(itens[0] || {}).placa} /><b>${numOS(Number(num))}</b>${modeloDaOS[num] ? html`<span class="cm-os-modelo">${modeloDaOS[num]}</span>` : null}
            ${itens.some(l => !l.ja_lancado) ? html`<button type="button" class="btn btn-sm cm-os-tirar" disabled=${tirando}
              onClick=${() => tirar(b, itens)}>Tirar a O.S.</button>` : null}</div>
          <ul class="cm-linhas">${itens.map(l => html`<li key=${l.item_id} class=${l.ja_lancado || l.sem_saldo ? "cm-ja" : (fora[ch(b.funcionario_id, l)] ? "cm-fora" : "")}>
            <label class="cm-marca">
              <input type="checkbox" disabled=${l.ja_lancado || l.sem_saldo} checked=${entra(b.funcionario_id, l)} aria-label=${"Incluir " + l.descricao}
                onChange=${e => setFora(f => ({ ...f, [ch(b.funcionario_id, l)]: !e.target.checked }))} />
              <span class="cm-desc"><b>${l.descricao}</b>
                <span class="sub">${l.grupo || "sem grupo"}${l.dividido_com ? " · dividido com " + l.dividido_com : ""}${l.ja_lancado ? " · já lançado" : ""}${!l.ja_lancado && l.sem_saldo ? " · a mão de obra já foi toda comissionada em outro lançamento" : ""}</span></span>
            </label>
            <span class="cm-mo" title="Mão de obra do serviço">${reais(l.mao_de_obra)}${Number(l.fracao) < 1 ? html` <span class="sub">(parte dele: ${reais(l.base)})</span>` : null}</span>
            <span class="cm-pct-campo"><input class=${"inp inp-curto" + (pctOk(pctDe(b.funcionario_id, l)) ? "" : " inp-erro")} type="number" min="0" max="100" step="0.5"
              disabled=${l.ja_lancado || l.sem_saldo} aria-label=${"Percentual de " + l.descricao} value=${pcts[ch(b.funcionario_id, l)] ?? l.pct}
              onInput=${e => { const k = ch(b.funcionario_id, l); setPcts(p => ({ ...p, [k]: e.target.value })); setVals(o => { const r = { ...o }; delete r[k]; return r; }); }} /><span>%</span></span>
            <span class="cm-valor-campo"><span>R$</span><input class="inp inp-curto" inputmode="decimal"
              disabled=${l.ja_lancado || l.sem_saldo || !n2(l.base)} aria-label=${"Valor da comissão de " + l.descricao}
              value=${vals[ch(b.funcionario_id, l)] ?? String(valorDe(b.funcionario_id, l).toFixed(2)).replace(".", ",")}
              onInput=${e => digitarValor(b.funcionario_id, l, e.target.value)}
              onBlur=${() => setVals(o => { const r = { ...o }; delete r[ch(b.funcionario_id, l)]; return r; })} /></span>
            <span class="cm-acoes">
              <button type="button" class="btn btn-sm" disabled=${l.ja_lancado || l.sem_saldo}
                onClick=${() => setVerQuem({ ...l, funcionario_id: b.funcionario_id, nome: b.nome })}>Quem fez</button>
              <button type="button" class="btn btn-sm" disabled=${l.ja_lancado || tirando}
                onClick=${() => tirar(b, [l])}>Tirar</button></span>
          </li>`)}</ul>
        </div>`)}
      </section>`;
    })}

    ${verMatriz ? html`<${Matriz} funcs=${mecanicos} grupos=${grupos} avisar=${avisar}
      onFechar=${() => setVerMatriz(false)} onSalvou=${async () => { setPcts({}); setFuncs(await api.funcionarios.listar("nome")); }} />` : null}
    ${verPuxar ? html`<${PuxarOS} avisar=${avisar} onFechar=${() => setVerPuxar(false)} funcs=${mecanicos} quinzena=${q}
      onAtribuido=${carregar} onPuxar=${id => setPuxados(p => p.includes(id) ? p : [...p, id])} />` : null}
    ${verQuem ? html`<${QuemFez} linha=${verQuem} quinzena=${q} funcs=${mecanicos} perfilDe=${perfilDe} avisar=${avisar}
      onFechar=${() => setVerQuem(null)} onFeito=${carregar} />` : null}
  </div>`;
}
