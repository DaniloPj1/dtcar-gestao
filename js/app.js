import { html, render, useState, useEffect, useCallback, useRef } from "./lib.js";
import { api, definirSemRede, estaSemRede } from "./api.js";
import { local, erroDeRede, pedirPersistencia, sessaoGuardada } from "./local.js";
import { fmtDataHora, lsGet } from "./util.js";
import { fila } from "./fila.js";
import { iniciarPasta, gravarDadosNaPasta, lerDaPasta, ouvirPasta, pastaSuportada, gravarBackupNaPasta, backupDaPasta } from "./pasta.js";
import { AssistentePasta } from "./telas/dadoslocais.js";
import { OSPendente } from "./telas/pendente.js";
import { Ctx, Modal, I } from "./ui.js";
import { cfgCompleta, pode, etapaOS } from "./regras.js";
import { Conexao, Login, Pendente } from "./telas/login.js";
import { Painel, Ordens } from "./telas/painel.js";
import { NovaOS, ChecklistOS } from "./telas/entrada.js";
import { Ordem } from "./telas/ordem.js";
import { Cadastros, ClienteTela, VeiculoTela } from "./telas/cadastros.js";
import { Mais, Equipe, Ajustes } from "./telas/admin.js";
import { Recibos } from "./telas/recibos.js";
import { ContasReceber, diasAte } from "./telas/receber.js";
import { PrevisaoCaixa } from "./telas/caixa.js";
import { Imprimir } from "./telas/imprimir.js";
import { Importar } from "./telas/importar.js";
import { Balcao } from "./telas/balcao.js";
import { EntradaNFe } from "./telas/compras.js";
import { Relatorios } from "./telas/relatorios.js";
import { Financeiro } from "./telas/financeiro.js";
import { Backup, montarBackup } from "./telas/backup.js";
import { NotasSefaz } from "./telas/sefaz.js";
import { Funcionarios, FuncionarioTela } from "./telas/funcionarios.js";
import { BarraTopo } from "./telas/topo.js";
import { DadosLocais } from "./telas/dadoslocais.js";

try { localStorage.removeItem("dtcar-modo"); } catch (e) {} // o visual "modo balcão" foi substituído pela interface única

const lerRota = () => { const h = (location.hash || "").replace(/^#/, "") || "/painel"; return h.startsWith("/") ? h : "/" + h; };
const TITULOS = { painel: "Painel", entrada: "Nova O.S.", ordens: "Ordens de serviço", os: "Ordem de serviço", cadastros: "Cadastros", cliente: "Cliente", veiculo: "Veículo", mais: "Mais", equipe: "Equipe", ajustes: "Ajustes", recibos: "Recibos", importar: "Importar do OS Oficina", balcao: "Venda de balcão", nfe: "Entrada de nota fiscal", relatorios: "Relatórios", financeiro: "Contas a pagar", receber: "Contas a receber", caixa: "Previsão de caixa", backup: "Backup", sefaz: "Notas da SEFAZ", funcionarios: "Funcionários", funcionario: "Funcionário", "dados-locais": "Dados neste computador" };
const SINC = ["ordens", "clientes", "veiculos", "produtos", "fornecedores"];
// menu do celular (barra inferior) e menu lateral do computador
// telas que dependem do servidor (sem cópia no aparelho nesta etapa)
const SO_ONLINE = { financeiro: "As contas a pagar ficam no servidor.", caixa: "A previsão de caixa usa contas, recibos e parcelas do servidor.", recibos: "Os recibos ficam no servidor.",
  sefaz: "As notas da SEFAZ chegam pelo servidor.", nfe: "A entrada de nota grava estoque e custos no servidor.", relatorios: "Os relatórios são calculados no servidor.",
  funcionarios: "Funcionários e lançamentos ficam no servidor.", funcionario: "Funcionários e lançamentos ficam no servidor.", backup: "O backup lê tudo do servidor.",
  importar: "A carga do sistema antigo grava no servidor.", equipe: "A equipe e os acessos ficam no servidor." };
const NAV = [["/painel", "Painel", "painel"], ["/ordens", "O.S.", "lista"], ["+", "Novo", "mais"], ["/cadastros", "Cadastros", "pessoas"], ["/mais", "Mais", "menu"]];
const LATERAL = [
  ["Operação", [["/painel", "Painel", "painel"], ["/ordens", "Ordens de serviço", "lista"], ["/entrada", "Nova O.S.", "mais", "entrada"], ["/balcao", "Venda de balcão", "carrinho", "verValores"]]],
  ["Cadastros", [["/cadastros", "Clientes", "pessoas"], ["/cadastros?aba=veiculos", "Veículos", "carro"], ["/cadastros?aba=produtos", "Produtos e estoque", "caixa"], ["/cadastros?aba=fornecedores", "Fornecedores", "fabrica"]]],
  ["Financeiro", [["/receber", "Contas a receber", "dinheiro", "verValores"], ["/financeiro", "Contas a pagar", "dinheiro", "financeiro"], ["/caixa", "Previsão de caixa", "grafico", "financeiro"], ["/recibos", "Recibos", "recibo", "verValores"], ["/sefaz", "Notas da SEFAZ", "nuvem", "cadastrar"], ["/nfe", "Entrada de nota (XML)", "nota", "cadastrar"], ["/funcionarios", "Funcionários", "pessoas", "financeiro"], ["/relatorios", "Relatórios", "grafico", "verValores"]]],
  ["Sistema", [["/equipe", "Equipe", "pessoas", "ajustes"], ["/ajustes", "Ajustes", "ajuste", "ajustes"], ["/backup", "Backup", "nuvem", "ajustes"], ["/dados-locais", "Dados no computador", "caixa"], ["/importar", "Importar OS Oficina", "painel", "ajustes"]]],
];

function App() {
  const [sessao, setSessao] = useState(undefined);
  const [perfil, setPerfil] = useState(undefined);
  const [rota, setRota] = useState(lerRota());
  const [modoSenha, setModoSenha] = useState(/type=recovery/.test(location.hash));
  const [dados, setDados] = useState({ clientes: [], veiculos: [], produtos: [], fornecedores: [], ordens: [], perfis: [], receber: [], carregado: false });
  const [novoMenu, setNovoMenu] = useState(false);
  const [cfg, setCfg] = useState(cfgCompleta({}));
  const [toast, setToast] = useState(null);
  const [conf, setConf] = useState(null);
  const ultimaCarga = useRef(0);
  const [offline, setOffline] = useState(null); // { desde, copia } quando o servidor não responde
  const doServidor = useRef(false);
  const [pend, setPend] = useState([]); // fila de envio deste aparelho (O.S. abertas sem internet)
  const [pasta, setPasta] = useState(null), [assistente, setAssistente] = useState(false);
  const [novaVersao, setNovaVersao] = useState(!!window.__dtcarNovaVersao);
  useEffect(() => { const f = () => setNovaVersao(true); window.addEventListener("dtcar-nova-versao", f); return () => window.removeEventListener("dtcar-nova-versao", f); }, []);
  useEffect(() => ouvirPasta(setPasta), []);
  useEffect(() => { iniciarPasta().then(async st => {
    if (st.configurada && st.permissao === "granted") { const p = await lerDaPasta().catch(() => null); if (p && await fila.restaurar(p.fila)) atualizarPendentes(); }
    const instalado = matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: window-controls-overlay)").matches;
    if (!st.configurada && pastaSuportada() && instalado && !lsGet("dtcar-pasta-adiada")) setAssistente(true);
  }); }, []);
  const atualizarPendentes = useCallback(async () => { const l = await fila.listar(); setPend(l); return l; }, []);

  useEffect(() => { const f = () => { setRota(lerRota()); setConf(c => { if (c) c.res(false); return null; }); window.scrollTo(0, 0); }; window.addEventListener("hashchange", f); return () => window.removeEventListener("hashchange", f); }, []);
  useEffect(() => {
    if (!api) return;
    api.auth.sessao().then(s => setSessao(s || (!navigator.onLine ? sessaoGuardada() : null))).catch(() => setSessao(sessaoGuardada()));
    pedirPersistencia();
    return api.auth.aoMudar((s, ev) => { if (ev === "PASSWORD_RECOVERY") setModoSenha(true); setSessao(s || null); });
  }, []);
  useEffect(() => {
    if (!api || sessao === undefined) return;
    if (!sessao) { setPerfil(null); return; }
    const uid = sessao.user.id;
    api.meuPerfil(uid).then(p => { setPerfil(p || { id: uid, nome: sessao.user.email, email: sessao.user.email, papel: "pendente" }); if (p) local.gravar("perfil:" + uid, p); })
      .catch(async e => setPerfil(erroDeRede(e) ? (await local.ler("perfil:" + uid)) || null : null));
  }, [sessao && sessao.user && sessao.user.id]);

  const membro = perfil && perfil.ativo !== false && ["admin", "consultor", "mecanico"].includes(perfil.papel);
  const marcas = useRef({}); // maior atualizado_em já recebido por tabela (relógio do servidor)
  const marcar = (k, linhas) => { for (const l of linhas) if (l.atualizado_em && (!marcas.current[k] || l.atualizado_em > marcas.current[k])) marcas.current[k] = l.atualizado_em; };
  /** Carrega tabelas. Para O.S., clientes, veículos e produtos já carregados, busca só o que mudou (rápido);
   *  use { completo: true } depois de excluir registros. */
  const recarregar = useCallback(async (quais, opt = {}) => {
    const todos = ["clientes", "veiculos", "produtos", "fornecedores", "ordens", "perfis", "config", "receber"];
    const lista = quais && quais.length ? quais : todos;
    try {
      const res = await Promise.all(lista.map(k => {
        if (k === "config") return api.config();
        if (k === "perfis") return api.perfis();
        if (k === "receber") return api.receber ? api.receber.abertas().catch(() => []) : [];
        const desde = !opt.completo && SINC.includes(k) && marcas.current[k];
        if (desde) return k === "ordens" ? api.ordens(desde) : api.alterados(k, desde);
        return k === "ordens" ? api.ordens() : api[k].listar(k === "clientes" ? "nome" : k === "produtos" ? "descricao" : k === "fornecedores" ? "razao" : "criado_em");
      }));
      const novo = {}, parcial = {};
      lista.forEach((k, n) => {
        if (k === "config") return setCfg(cfgCompleta(res[n]));
        const parc = !opt.completo && SINC.includes(k) && marcas.current[k];
        if (SINC.includes(k)) marcar(k, res[n]);
        (parc ? parcial : novo)[k] = res[n];
      });
      setDados(d => {
        const r = { ...d, ...novo, carregado: true };
        for (const [k, linhas] of Object.entries(parcial)) {
          if (!linhas.length) continue;
          const m = new Map(d[k].map(x => [x.id, x])); for (const l of linhas) m.set(l.id, { ...m.get(l.id), ...l });
          r[k] = k === "ordens" ? [...m.values()].sort((a, b) => b.numero - a.numero) : [...m.values()];
        }
        return r;
      });
      ultimaCarga.current = Date.now();
      doServidor.current = true; definirSemRede(false); setOffline(null); setTimeout(() => enviarFila(), 500);
    } catch (e) {
      if (!erroDeRede(e)) return setToast({ msg: "Erro ao carregar dados: " + e.message, erro: true });
      definirSemRede(true); // daqui em diante as telas usam a cópia do aparelho sem esperar o servidor
      // sem internet: usa a cópia guardada neste aparelho (só na primeira carga; depois mantém o que já está na tela)
      let copia = await local.ler("dados");
      if (!copia) { const p = await lerDaPasta().catch(() => null); if (p && p.copia && p.copia.dados) { copia = p.copia; local.gravar("dados", { salvoEm: copia.salvoEm, dados: copia.dados, config: copia.config }); } }
      setDados(d => d.carregado ? d : copia ? { ...d, ...copia.dados, carregado: true } : d);
      if (copia && copia.config) setCfg(cfgCompleta(copia.config));
      setOffline(o => o || { desde: new Date().toISOString(), copia: copia ? copia.salvoEm : null });
    }
  }, []);
  useEffect(() => { if (membro) recarregar(); }, [membro]);
  // guarda a cópia local sempre que chegam dados do servidor (3 s depois da última mudança)
  useEffect(() => {
    if (!dados.carregado || !doServidor.current || offline) return;
    const t = setTimeout(() => { const { carregado, ...listas } = dados; const copia = { salvoEm: new Date().toISOString(), dados: listas, config: cfg }; local.gravar("dados", copia); gravarDadosNaPasta(copia); }, 3000);
    return () => clearTimeout(t);
  }, [dados, cfg, offline]);
  // O.S. em aberto (orçamento, execução e aguardando pagamento) ficam guardadas por inteiro neste aparelho,
  // logo depois de entrar, para abrir e imprimir sem internet. O progresso aparece no topo e em "Dados no computador".
  const [guardadas, setGuardadas] = useState(null); // { feitas, total }
  useEffect(() => {
    if (!dados.carregado || !doServidor.current || offline || !api.guardarOrdem) return;
    let vivo = true;
    const t = setTimeout(async () => {
      const lista = dados.ordens.filter(x => !x._pendente && ["orcamento", "execucao", "pagamento"].includes(etapaOS(x)));
      let feitas = 0; setGuardadas({ feitas, total: lista.length });
      const fila = [...lista];
      const trabalhar = async () => {
        while (vivo && fila.length) {
          const o = fila.shift();
          const c = await api.ordemNoAparelho(o.id);
          if (!c || c.atualizado_em !== o.atualizado_em) { try { await api.guardarOrdem(o.id); } catch (e) { if (erroDeRede(e)) { vivo = false; return; } } }
          feitas++; if (vivo) setGuardadas({ feitas, total: lista.length });
        }
      };
      await Promise.all([trabalhar(), trabalhar(), trabalhar()]); // 3 de cada vez
      if (vivo) local.gravar("os:guardadas", { feitas, total: lista.length, em: new Date().toISOString() });
    }, 1500);
    return () => { vivo = false; clearTimeout(t); };
  }, [dados.ordens, offline]);
  // backup COMPLETO do servidor na pasta do computador, uma vez por dia (proteção se o online falhar)
  useEffect(() => {
    if (!dados.carregado || !doServidor.current || offline || !pasta || !pasta.configurada || pasta.permissao !== "granted" || api.tipo !== "supabase") return;
    let vivo = true;
    const t = setTimeout(async () => {
      const ult = await backupDaPasta(), dia = new Date().toISOString().slice(0, 10);
      if (!vivo || (ult && ult.dia === dia)) return;
      try { const b = await montarBackup({ perfil, tolerante: true }); delete b.feito; if (vivo) await gravarBackupNaPasta(JSON.stringify(b)); }
      catch (e) { /* sem internet no meio: tenta de novo na próxima abertura */ }
    }, 20000);
    return () => { vivo = false; clearTimeout(t); };
  }, [dados.carregado, offline, pasta && pasta.configurada, pasta && pasta.permissao]);
  // envia a fila: ao abrir, ao reconectar e a cada minuto enquanto houver pendências
  const enviarFila = useCallback(async () => {
    const l = await atualizarPendentes(); if (!l.length || !api.sincronizarAbertura) return;
    const r = await fila.processar(api); if (!r) return;
    await atualizarPendentes();
    if (r.enviadas.length) {
      setToast({ msg: r.enviadas.map(x => x.op.provisorio + " virou O.S. " + x.res.numero).join(" · "), erro: false });
      await recarregar(["clientes", "veiculos", "ordens"]);
      const aqui = r.enviadas.find(x => location.hash === "#/os/" + x.op.id);
      if (aqui && aqui.res.id !== aqui.op.id) location.hash = "#/os/" + aqui.res.id;
    }
    if (r.comErro.length) setToast({ msg: r.comErro.length + " O.S. sem internet não puderam ser enviadas. Abra a O.S. para ver o motivo.", erro: true });
  }, []);
  useEffect(() => { if (!membro) return; enviarFila(); const t = setInterval(() => { if (navigator.onLine) enviarFila(); }, 60000); return () => clearInterval(t); }, [membro]);
  // internet voltou: confere o servidor e recarrega tudo (enquanto estiver sem rede, confere a cada 30 s)
  const reconectar = useCallback(async (avisarSeFalhar) => {
    const ok = api.testarConexao ? await api.testarConexao() : navigator.onLine;
    if (!ok) { if (avisarSeFalhar) setToast({ msg: "Ainda sem conexão com o servidor.", erro: true }); return false; }
    definirSemRede(false); await recarregar(null, { completo: true }); setTimeout(enviarFila, 1500); return true;
  }, []);
  useEffect(() => { if (!offline) return; const t = setInterval(() => reconectar(false), 30000); return () => clearInterval(t); }, [offline]);
  useEffect(() => {
    if (!membro) return;
    const volta = () => reconectar(false);
    const caiu = () => { definirSemRede(true); setOffline(o => o || { desde: new Date().toISOString(), copia: null }); };
    window.addEventListener("online", volta); window.addEventListener("offline", caiu);
    return () => { window.removeEventListener("online", volta); window.removeEventListener("offline", caiu); };
  }, [membro]);
  useEffect(() => {
    if (!membro) return;
    let ultimaCompleta = Date.now();
    const atualiza = () => {
      if (document.visibilityState !== "visible" || Date.now() - ultimaCarga.current < 30000) return;
      const completo = Date.now() - ultimaCompleta > 15 * 60000; if (completo) ultimaCompleta = Date.now();
      recarregar(SINC, { completo });
    };
    document.addEventListener("visibilitychange", atualiza); const t = setInterval(atualiza, 60000);
    return () => { document.removeEventListener("visibilitychange", atualiza); clearInterval(t); };
  }, [membro]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), toast.erro ? 6000 : 3000); return () => clearTimeout(t); }, [toast]);

  const avisar = useCallback((msg, erro) => setToast({ msg, erro: !!erro }), []);
  const confirmar = useCallback(o => new Promise(res => setConf({ ...o, res })), []);
  const ir = useCallback(r => { if (lerRota() === r) { setRota(r); window.scrollTo(0, 0); } else location.hash = r; }, []);
  const sair = useCallback(async () => { await api.auth.sair(); setPerfil(null); setSessao(null); location.hash = "#/painel"; }, []);

  if (!api) return html`<${Conexao} />`;
  if (sessao === undefined || (sessao && perfil === undefined)) return html`<div class="carregando">Carregando…</div>`;
  if (modoSenha && sessao) return html`<${Login} modo="nova" />`;
  if (!sessao) return html`<${Login} />`;
  if (!membro) return html`<${Pendente} perfil=${perfil} sair=${sair} />`;

  const [caminho, qs] = rota.split("?");
  const [, base, param, sub] = caminho.split("/");
  const params = Object.fromEntries(new URLSearchParams(qs || ""));
  const restrito = { ajustes: "ajustes", equipe: "ajustes", importar: "ajustes", entrada: "entrada", recibos: "verValores", balcao: "verValores", nfe: "cadastrar", relatorios: "verValores", financeiro: "financeiro", receber: "verValores", caixa: "financeiro", backup: "ajustes", sefaz: "cadastrar", funcionarios: "financeiro", funcionario: "financeiro" };
  const pendOS = pend.filter(op => op.tipo === "abrir_os");
  const dadosVis = !pendOS.length ? dados : {
    ...dados,
    ordens: [...pendOS.map(op => ({ ...op.ordem, numero: op.provisorio, total: 0, desconto: 0, atualizado_em: op.criado_em, _pendente: true, _provisorio: op.provisorio }))
      .filter(o => !dados.ordens.some(x => x.id === o.id)), ...dados.ordens],
    clientes: [...dados.clientes, ...pendOS.filter(op => op.cliente && !dados.clientes.some(c => c.id === op.cliente.id)).map(op => ({ ...op.cliente, _pendente: true }))],
    veiculos: [...dados.veiculos, ...pendOS.filter(op => op.veiculo && !dados.veiculos.some(v => v.id === op.veiculo.id || v.placa === op.veiculo.placa)).map(op => ({ ...op.veiculo, _pendente: true }))],
  };
  const ctx = { guardadas, pasta, abrirAssistentePasta: () => setAssistente(true), sessao, perfil, cfg, dados: dadosVis, recarregar, avisar, confirmar, ir, sair, atualizarPendentes, pendentes: pend, enviarFila };
  if (base === "imprimir" && dados.carregado) return html`<${Ctx.Provider} value=${ctx}><${Imprimir} tipo=${param} id=${sub} params=${params} key=${rota} /></${Ctx.Provider}>`;
  let corpo;
  if (restrito[base] && !pode(perfil, restrito[base])) corpo = html`<div class="pagina"><div class="aviso">Seu papel não tem acesso a esta tela.</div></div>`;
  else if (!dados.carregado) corpo = html`<div class="carregando">Carregando dados…</div>`;
  // telas que ainda não têm cópia no aparelho (etapa 2 do programa): sem internet, avisam em vez de ficar carregando
  else if (offline && SO_ONLINE[base]) corpo = html`<div class="pagina"><section class="card so-online"><h2>${TITULOS[base] || "Esta tela"} precisa de internet</h2>
    <p>${SO_ONLINE[base]} Os dados desta tela ainda não ficam guardados neste computador (isso vem na próxima etapa do programa). A cópia de segurança completa continua na pasta Documentos\DTCar Gestão.</p>
    <p class="sub">Sem internet, funcionam: painel, ordens de serviço (consulta e impressão das O.S. guardadas), Nova O.S. com número provisório, clientes, veículos, produtos e contas a receber (consulta).</p>
    <div class="acoes"><button type="button" class="btn btn-pri" onClick=${() => reconectar(true)}>Tentar conectar</button><button type="button" class="btn" onClick=${() => ir("/painel")}>Ir para o painel</button></div></section></div>`;
  else corpo = {
    painel: () => html`<${Painel} />`, ordens: () => html`<${Ordens} params=${params} key=${qs || ""} />`, entrada: () => html`<${NovaOS} />`,
    os: () => pendOS.some(op => op.id === param) ? html`<${OSPendente} o=${dadosVis.ordens.find(o => o.id === param)} op=${pendOS.find(op => op.id === param)} key=${param} />` : sub === "checklist" ? (pode(perfil, "entrada") ? html`<${ChecklistOS} id=${param} key=${param} />` : html`<div class="pagina"><div class="aviso">Seu papel não pode fazer checklist.</div></div>`) : html`<${Ordem} id=${param} params=${params} key=${param} />`,
    cliente: () => html`<${ClienteTela} id=${param} key=${param} />`, veiculo: () => html`<${VeiculoTela} id=${param} key=${param} />`,
    cadastros: () => html`<${Cadastros} params=${params} key=${qs || ""} />`, catalogo: () => html`<${Cadastros} params=${{ aba: "produtos" }} />`,
    "dados-locais": () => html`<${DadosLocais} />`,
    mais: () => html`<${Mais} />`, equipe: () => html`<${Equipe} />`, ajustes: () => html`<${Ajustes} />`,
    recibos: () => html`<${Recibos} />`, importar: () => html`<${Importar} />`,
    balcao: () => html`<${Balcao} params=${params} key=${qs || ""} />`, nfe: () => html`<${EntradaNFe} params=${params} key=${qs || ""} />`, sefaz: () => html`<${NotasSefaz} />`, relatorios: () => html`<${Relatorios} params=${params} key=${qs || ""} />`,
    financeiro: () => html`<${Financeiro} params=${params} key=${qs || ""} />`, receber: () => html`<${ContasReceber} />`, caixa: () => html`<${PrevisaoCaixa} />`, backup: () => html`<${Backup} />`,
    funcionarios: () => html`<${Funcionarios} params=${params} key=${qs || ""} />`, funcionario: () => html`<${FuncionarioTela} id=${param} params=${params} key=${param + (qs || "")} />`,
  }[base]?.() || html`<${Painel} />`;

  const vencidasRec = (dados.receber || []).filter(p => p.status === "aberta" && diasAte(p.vencimento) < 0).length;
  const modais = html`
    ${toast ? html`<div class=${"toast" + (toast.erro ? " erro" : "")} role="status">${toast.msg}</div>` : null}
    ${conf ? html`<${Modal} titulo=${conf.titulo} onFechar=${() => { conf.res(false); setConf(null); }}><p>${conf.texto}</p>
      <div class="acoes"><span class="espaco"></span><button type="button" class="btn" onClick=${() => { conf.res(false); setConf(null); }}>Voltar</button>
      <button type="button" class=${"btn " + (conf.perigo ? "btn-perigo" : "btn-pri")} onClick=${() => { conf.res(true); setConf(null); }}>${conf.botao}</button></div></${Modal}>` : null}`;

  return html`<${Ctx.Provider} value=${ctx}>
    <aside class="lateral" aria-label="Menu">
      <button type="button" class="lateral-marca" onClick=${() => ir("/painel")} aria-label="Painel"><img src="icons/logo-branco-sm.png" alt="DTCar Centro Automotivo" /></button>
      ${LATERAL.map(([grupo, itens]) => { const vis = itens.filter(it => !it[3] || pode(perfil, it[3])); return vis.length ? html`<nav key=${grupo} class="lateral-grupo"><span>${grupo}</span>
        ${vis.map(([r, t, ic]) => { const [rb, rq] = r.split("?"); const ativo = rota === r || (!rq && "/" + base === rb && (!qs || rb !== "/cadastros")) || (rb === "/cadastros" && !rq && (base === "cliente" || (base === "cadastros" && !qs))) || (rb === "/cadastros" && rq && base === "cadastros" && qs === rq) || (r === "/cadastros?aba=veiculos" && base === "veiculo");
          const nb = r === "/receber" ? vencidasRec : 0;
          return html`<button type="button" key=${r} aria-current=${ativo ? "page" : undefined} onClick=${() => ir(r)}>${I[ic]}<span>${t}</span>${nb ? html`<em class="lat-badge" title=${nb + " parcela(s) vencida(s)"}>${nb}</em>` : null}</button>`; })}</nav>` : null; })}
      <div class="lateral-pe"><span class="lateral-user"><b>${perfil.nome}</b><small>${{ admin: "Administrador", consultor: "Consultor", mecanico: "Mecânico" }[perfil.papel]}</small></span><button type="button" class="btn-link" onClick=${sair}>Sair</button></div>
    </aside>
    <header class="topo"><div class="topo-in"><button type="button" class="marca marca-logo" onClick=${() => ir("/painel")} aria-label="DTCar Centro Automotivo · Painel"><img src="icons/logo-branco-sm.png" alt="DTCar Centro Automotivo" /></button>
      <div class="titulo">${TITULOS[base] || ""}</div></div></header>
    <${BarraTopo} titulo=${TITULOS[base] || "Painel"} offline=${offline} pend=${pend} enviarFila=${enviarFila} />
    <main>${cfg.espelhoLegado !== false ? html`<div class="faixa-transicao" role="note"><b>Período de transição: o sistema oficial ainda é o OS Oficina.</b> Lance O.S., recibos e cadastros reais no OS Oficina; aqui é consulta e treino. A próxima carga substitui clientes, veículos, produtos, O.S., recibos, vendas, estoque e contas a receber. Contas a pagar, fornecedores e funcionários <b>não</b> são limpos: não lance testes nessas áreas.${pode(perfil, "ajustes") ? html` <button type="button" class="btn-link" onClick=${() => ir("/importar")}>Carga e virada</button>` : null}</div>` : null}${novaVersao ? html`<div class="faixa-versao" role="status"><b>Nova versão do DTCar Gestão disponível.</b> Salve o que estiver fazendo e clique em atualizar. <button type="button" class="btn btn-sm btn-pri" onClick=${() => location.reload()}>Atualizar agora</button></div>` : null}${!offline && pend.length ? html`<div class="faixa-offline" role="status"><b>${pend.length} O.S. aberta(s) sem internet aguardando envio</b> (${pend.map(x => x.provisorio).join(", ")}). <button type="button" class="btn-link" onClick=${enviarFila}>Enviar agora</button></div>` : null}
    ${offline ? html`<div class="faixa-offline" role="status"><b>Sem internet.</b>${pend.length ? " " + pend.length + " O.S. aguardando envio." : ""} Modo consulta: ${offline.copia ? "dados salvos neste aparelho em " + fmtDataHora(offline.copia) : "dados carregados antes da queda"}. Dá para abrir O.S. nova (número provisório); as demais alterações só com internet. <button type="button" class="btn-link" onClick=${() => reconectar(true)}>Tentar de novo</button></div>` : null}${corpo}</main>
    <nav class="nav" aria-label="Navegação principal"><div class="nav-in">${NAV.map(([r, t, ic]) => html`<button key=${r} type="button" class=${r === "+" ? "nav-novo" : ""} aria-current=${"/" + base === r ? "page" : undefined} onClick=${() => r === "+" ? setNovoMenu(true) : ir(r)}>
      ${r === "+" ? html`<span class="circ">${I[ic]}</span>` : I[ic]}<span>${t}</span></button>`)}</div></nav>
    ${novoMenu ? html`<${Modal} titulo="Novo" onFechar=${() => setNovoMenu(false)}><div class="lista">
      ${[["/entrada", "Nova ordem de serviço", "Abrir O.S. para um veículo", "lista", "entrada"], ["/balcao", "Venda de balcão", "Vender peças ou serviços sem O.S.", "carrinho", "verValores"], ["/nfe", "Entrada de nota fiscal", "Importar o XML de uma compra", "nota", "cadastrar"], ["/financeiro?nova=pdf", "Conta a pagar", "Lançar boleto, duplicata ou despesa", "dinheiro", "financeiro"]]
        .filter(x => pode(perfil, x[4])).map(([r, t, d, ic]) => html`<button type="button" key=${r} class="linha" onClick=${() => { setNovoMenu(false); ir(r); }}><span class="ic">${I[ic]}</span><span class="meio"><strong>${t}</strong><span>${d}</span></span></button>`)}</div></${Modal}>` : null}
    ${modais}
    ${assistente ? html`<${AssistentePasta} onFechar=${() => setAssistente(false)} />` : null}
  </${Ctx.Provider}>`;
}

render(html`<${App} />`, document.getElementById("raiz"));
window.__dtcarMontou = true; // o aviso de "não abriu" do index.html só vale se o sistema nem chegou a montar
