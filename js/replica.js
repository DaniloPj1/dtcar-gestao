// Banco do PC (etapa 2a): réplica de todas as tabelas do online no banco SQLite do programa para Windows.
// Com internet, mantém o banco do PC igual ao online (carga completa na 1ª vez, depois só o que mudou + exclusões);
// sem internet, as leituras do sistema vêm daqui (js/api.js usa "leitorLocal").
// Período de transição: cada carga do sistema antigo (espelho) zera e recarrega o banco do PC.

const B = typeof window !== "undefined" && window.dtcarDesktop && window.dtcarDesktop.banco ? window.dtcarDesktop.banco : null;
export const replicaDisponivel = () => !!B;
// o banco do PC só vale para leitura depois da 1ª carga completa; antes disso (programa recém-instalado ou atualizado
// sem ter aberto com internet) as telas usam a cópia do navegador, como no programa 1.0
let pronta = false;
export const replicaProntaJa = () => pronta;
export async function replicaPronta() {
  if (pronta || !B) return pronta;
  try { pronta = !!(await B.meta("completa:em")); } catch (e) { pronta = false; }
  return pronta;
}

// mesma lista do backup (quem é referenciado vem antes) + equipe e ajustes
export const TABELAS_REPLICA = ["perfis", "fornecedores", "clientes", "veiculos", "servicos", "produtos", "produto_fornecedor", "notas_entrada",
  "ordens", "os_itens", "eventos", "fotos", "recibos", "vendas", "venda_itens", "estoque_mov", "estoque_reserva", "contas", "nfe_recebidas",
  "nfe_os_vinculos", "funcionarios", "funcionario_lanc", "receber"];
const OPCIONAL = t => t === "servicos" || t.startsWith("funcionario") || t === "receber";
// antes do supabase/v13.sql, só estas têm "atualizado_em"; as demais são recarregadas inteiras de 30 em 30 min
const COM_DATA_ANTIGA = ["ordens", "clientes", "veiculos", "produtos", "fornecedores", "contas", "funcionarios", "receber", "nfe_recebidas"];
const MARGEM_MS = 60000; // folga: busca de novo o último minuto (transação demorada grava a data do início; gravar a mesma linha 2 vezes não faz mal)

let estado = { ultima: null, registros: 0, rodando: false, erro: "", tabelas: {} };
const ouvintes = new Set();
const avisa = () => { for (const f of ouvintes) f({ ...estado }); };
export const ouvirReplica = f => { ouvintes.add(f); f({ ...estado }); return () => ouvintes.delete(f); };

// cache em memória das tabelas lidas (zera a cada atualização)
const cache = new Map();
export async function tabelaLocal(t) {
  if (!B) return [];
  if (!cache.has(t)) cache.set(t, B.listar(t).then(txt => JSON.parse(txt || "[]")).catch(() => []));
  return cache.get(t);
}
const limpar = t => (t ? cache.delete(t) : cache.clear());

// ---------- gravações locais (etapa 3: alterações feitas sem internet, que vão para a fila de envio) ----------
export async function gravarLocal(t, linhas) { if (!B || !linhas.length) return; await B.mesclar(t, JSON.stringify(linhas)); limpar(t); }
export async function removerLocal(t, ids) { if (!B || !ids.length) return; await B.remover(t, ids.map(String)); limpar(t); }
export async function umLocal(t, id) { if (!B) return null; const s = await B.um(t, id); return s ? JSON.parse(s) : null; }
/** troca a cópia de uma O.S. no banco do PC pela do servidor (ao descartar alterações feitas sem internet) */
export async function trocarOrdemLocal(o) {
  const { itens = [], fotos = [], eventos = [], _local, ...ordem } = o;
  await gravarLocal("ordens", [ordem]);
  for (const [t, linhas] of [["os_itens", itens], ["fotos", fotos], ["eventos", eventos]]) {
    const manter = new Set(linhas.map(l => String(l.id)));
    await removerLocal(t, (await porOrdemLocal(t, o.id)).map(l => String(l.id)).filter(id => !manter.has(id)));
    await gravarLocal(t, linhas);
  }
}
export async function porOrdemLocal(t, ordemId) { if (!B) return []; return JSON.parse((await B.porOrdem(t, ordemId)) || "[]"); }
const maior = (linhas, campo) => linhas.reduce((m, l) => (l[campo] && (!m || l[campo] > m) ? l[campo] : m), null);

/** Atualiza o banco do PC a partir do online. completo: recarrega tudo. espelho: data da última carga do sistema antigo (zera se mudou). */
export async function replicar(api, { completo = false, espelho = null, config = null } = {}) {
  if (!B || !api.replica || estado.rodando) return estado;
  estado = { ...estado, rodando: true, erro: "" }; avisa();
  try {
    // carga nova do sistema antigo: recarrega TUDO, tabela por tabela (cada uma troca inteira numa transação).
    // Não zera antes: sem internet no meio, o banco do PC continua com o que tinha; a marca só muda no fim.
    const espelhoNovo = espelho && (await B.meta("espelho")) !== espelho;
    if (espelhoNovo) { completo = true; await B.meta("exclusoes:seq", null); }
    const v13 = await api.replica.temV13();
    const agora = Date.now(), ultimaCompleta = Number(await B.meta("completa:em")) || 0;
    const cicloCompleto = completo || agora - ultimaCompleta > (v13 ? 6 * 3600000 : 30 * 60000); // conferência completa de 6 em 6 h (cobre linha gravada com data anterior à marca)
    let total = 0; const preparadas = [], marcas = {};
    const duasFases = !!B.preparar; // programa 1.1+: carga completa troca todas as tabelas juntas no fim
    if (duasFases) await B.descartarPreparo();
    // exclusões: marca o ponto ANTES de ler as tabelas (o que for apagado durante a leitura é removido logo depois)
    const seqInicio = v13 ? (Number(await B.meta("exclusoes:seq")) || (cicloCompleto ? await api.replica.ultimaExclusao() : 0)) : 0;
    for (const t of TABELAS_REPLICA) {
      const marca = await B.meta("marca:" + t);
      const incremental = !cicloCompleto && marca && (v13 || COM_DATA_ANTIGA.includes(t));
      if (!incremental && !cicloCompleto) continue; // sem atualizado_em (antes do v13): espera o ciclo completo
      let linhas;
      try {
        linhas = incremental ? await api.replica.desde(t, new Date(new Date(marca).getTime() - MARGEM_MS).toISOString()) : await api.backup.tabela(t);
      } catch (e) { if (OPCIONAL(t) && !/Sem conexão|Failed to fetch/i.test(e.message)) continue; throw e; }
      const m = maior(linhas, "atualizado_em") || maior(linhas, "criado_em");
      const novaMarca = m && (!marca || m > marca) ? m : marca || new Date(0).toISOString();
      if (incremental) { if (linhas.length) await B.mesclar(t, JSON.stringify(linhas)); await B.meta("marca:" + t, novaMarca); if (linhas.length) limpar(t); }
      else if (duasFases) { await B.preparar(t, JSON.stringify(linhas)); preparadas.push(t); marcas[t] = novaMarca; }
      else { await B.substituir(t, JSON.stringify(linhas)); await B.meta("marca:" + t, novaMarca); limpar(t); }
      total += linhas.length;
    }
    // todas as tabelas da carga completa chegaram: troca de uma vez (falha antes disso não mexe no banco do PC)
    if (preparadas.length) { await B.promover(preparadas); for (const t of preparadas) { await B.meta("marca:" + t, marcas[t]); limpar(t); } }
    // exclusões feitas no online desde a última vez (v13); sem v13, a conferência completa resolve
    if (v13) {
      const l = await api.replica.exclusoes(seqInicio), por = {};
      for (const x of l) (por[x.tabela] = por[x.tabela] || []).push(x.registro);
      for (const [t, ids] of Object.entries(por)) { await B.remover(t, ids); limpar(t); }
      await B.meta("exclusoes:seq", l.length ? l[l.length - 1].seq : seqInicio);
    }
    if (espelhoNovo) await B.meta("espelho", espelho);
    if (config) await B.meta("config", JSON.stringify(config));
    if (cicloCompleto) { await B.meta("completa:em", String(agora)); pronta = true; }
    const info = await B.info();
    estado = { ...estado, rodando: false, ultima: new Date().toISOString(), registros: Object.values(info.tabelas).reduce((s, n) => s + n, 0), tabelas: info.tabelas, tamanho: info.tamanho, v13 };
    await B.meta("ultima", estado.ultima);
    // cópia do dia do banco inteiro em Documentos\DTCar Gestão\banco
    const dia = new Date().toISOString().slice(0, 10);
    if ((await B.meta("copia:dia")) !== dia) { await B.copiaDoDia(); await B.meta("copia:dia", dia); }
  } catch (e) { estado = { ...estado, rodando: false, erro: e.message }; }
  avisa(); return estado;
}
export async function infoReplica() {
  if (!B) return null;
  const info = await B.info(); return { ...estado, ultima: estado.ultima || (await B.meta("ultima")), tabelas: info.tabelas, tamanho: info.tamanho,
    registros: Object.values(info.tabelas).reduce((s, n) => s + n, 0) };
}

// ---------- leituras locais (mesmas respostas da js/api.js) ----------
// datas com hora (timestamptz) são comparadas como instantes, não como texto (fusos diferentes); datas simples, como texto
const valorData = v => (typeof v === "string" && v.length > 10 ? Date.parse(v) : v);
const cmpData = (a, b) => { const x = valorData(a), y = valorData(b); if (typeof x === "number" || typeof y === "number") return Date.parse(a) - Date.parse(b); return a < b ? -1 : a > b ? 1 : 0; };
const porData = (l, campo, de, ate, ateExclusivo) => l.filter(x => { const v = x[campo]; if ((de || ate) && !v) return false;
  return (!de || cmpData(v, de) >= 0) && (!ate || (ateExclusivo ? cmpData(v, ate) < 0 : cmpData(v, ate) <= 0)); });
const ordena = (l, f) => [...l].sort(f);
const resumoOrdem = o => ({ ...o, ck_feito: o.checkin ? o.checkin.feito : undefined, legado: o.checkin && o.checkin.legado ? o.checkin.legado.numero : undefined });
export const leitorLocal = {
  meuPerfil: async uid => (await tabelaLocal("perfis")).find(p => p.id === uid) || null,
  perfis: async () => tabelaLocal("perfis"),
  config: async () => { try { return JSON.parse((await B.meta("config")) || "{}"); } catch (e) { return {}; } },
  // mesma ordem do servidor: pela coluna pedida e depois pelo id
  listar: t => async (ordem = "criado_em") => ordena(await tabelaLocal(t), (a, b) => { const x = a[ordem], y = b[ordem];
    const c = x == null ? (y == null ? 0 : 1) : y == null ? -1 : typeof x === "string" ? x.localeCompare(y, "pt-BR") : x - y; return c || String(a.id).localeCompare(String(b.id)); }),
  ordens: async () => ordena((await tabelaLocal("ordens")).map(resumoOrdem), (a, b) => (b.numero || 0) - (a.numero || 0)),
  alterados: async () => [],
  ordem: async id => {
    const o = (await tabelaLocal("ordens")).find(x => x.id === id); if (!o) return null;
    const [itens, fotos, eventos] = await Promise.all(["os_itens", "fotos", "eventos"].map(t => B.porOrdem(t, id).then(x => JSON.parse(x || "[]"))));
    return { ...o, itens: ordena(itens, (a, b) => (a.posicao || 0) - (b.posicao || 0)), fotos: ordena(fotos, (a, b) => (a.criado_em || "").localeCompare(b.criado_em || "")),
      eventos: ordena(eventos, (a, b) => (b.criado_em || "").localeCompare(a.criado_em || "")), _local: true };
  },
  itensDasOrdens: async ids => { const s = new Set(ids); return (await tabelaLocal("os_itens")).filter(i => s.has(i.ordem_id)); },
  recibosListar: async ({ ordemId, de, ate } = {}) => ordena(porData((await tabelaLocal("recibos")).filter(r => !ordemId || r.ordem_id === ordemId), "data", de, ate), (a, b) => (b.numero || 0) - (a.numero || 0)).slice(0, 1000),
  reciboUm: async id => (await tabelaLocal("recibos")).find(r => r.id === id) || null,
  contasListar: async ({ de, ate, campo = "vencimento", status } = {}) => ordena(porData((await tabelaLocal("contas")).filter(c => !status || c.status === status), campo, de, ate), (a, b) => (a.vencimento || "").localeCompare(b.vencimento || "")),
  contasAbertas: async () => ordena((await tabelaLocal("contas")).filter(c => c.status === "aberta"), (a, b) => (a.vencimento || "").localeCompare(b.vencimento || "")),
  receberAbertas: async () => ordena((await tabelaLocal("receber")).filter(p => p.status === "aberta"), (a, b) => (a.vencimento || "").localeCompare(b.vencimento || "")),
  receberListar: async ({ de, ate, status } = {}) => ordena(porData((await tabelaLocal("receber")).filter(p => !status || p.status === status), "vencimento", de, ate), (a, b) => (a.vencimento || "").localeCompare(b.vencimento || "")),
  receberDaOrdem: async oid => ordena((await tabelaLocal("receber")).filter(p => p.ordem_id === oid), (a, b) => (a.parcela || 0) - (b.parcela || 0)),
  vendasListar: async ({ de, ate } = {}) => ordena(porData(await tabelaLocal("vendas"), "criado_em", de, ate, true), (a, b) => (b.numero || 0) - (a.numero || 0)).slice(0, 1000),
  vendaUma: async id => { const v = (await tabelaLocal("vendas")).find(x => x.id === id); if (!v) return null; return { ...v, itens: ordena((await tabelaLocal("venda_itens")).filter(i => i.venda_id === id), (a, b) => (a.posicao || 0) - (b.posicao || 0)) }; },
  funcionarios: async () => tabelaLocal("funcionarios"),
  lancamentos: async (comp, fid) => (await tabelaLocal("funcionario_lanc")).filter(l => l.competencia === comp && (!fid || l.funcionario_id === fid)),
  movimentos: async pid => ordena((await tabelaLocal("estoque_mov")).filter(m => !pid || m.produto_id === pid), (a, b) => (b.criado_em || "").localeCompare(a.criado_em || "")),
  sefazNotas: async () => tabelaLocal("nfe_recebidas"),
  ordensEntregues: async (ini, fim) => ordena(porData((await tabelaLocal("ordens")).filter(o => o.status === "entregue"), "entregue_em", ini, fim, true), (a, b) => a.numero - b.numero),
};
