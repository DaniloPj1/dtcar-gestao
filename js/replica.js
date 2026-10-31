// Banco do PC (etapa 2a): réplica de todas as tabelas do online no banco SQLite do programa para Windows.
// Com internet, mantém o banco do PC igual ao online (carga completa na 1ª vez, depois só o que mudou + exclusões);
// sem internet, as leituras do sistema vêm daqui (js/api.js usa "leitorLocal").
// Período de transição: cada carga do sistema antigo (espelho) zera e recarrega o banco do PC.

const B = typeof window !== "undefined" && window.dtcarDesktop && window.dtcarDesktop.banco ? window.dtcarDesktop.banco : null;
export const replicaDisponivel = () => !!B;

// mesma lista do backup (quem é referenciado vem antes) + equipe e ajustes
export const TABELAS_REPLICA = ["perfis", "fornecedores", "clientes", "veiculos", "servicos", "produtos", "produto_fornecedor", "notas_entrada",
  "ordens", "os_itens", "eventos", "fotos", "recibos", "vendas", "venda_itens", "estoque_mov", "estoque_reserva", "contas", "nfe_recebidas",
  "nfe_os_vinculos", "funcionarios", "funcionario_lanc", "receber"];
const OPCIONAL = t => t === "servicos" || t.startsWith("funcionario") || t === "receber";
// antes do supabase/v13.sql, só estas têm "atualizado_em"; as demais são recarregadas inteiras de 30 em 30 min
const COM_DATA_ANTIGA = ["ordens", "clientes", "veiculos", "produtos", "fornecedores", "contas", "funcionarios", "receber", "nfe_recebidas"];
const MARGEM_MS = 2000; // folga no relógio: busca de novo os últimos 2 s (gravar a mesma linha duas vezes não faz mal)

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
const maior = (linhas, campo) => linhas.reduce((m, l) => (l[campo] && (!m || l[campo] > m) ? l[campo] : m), null);

/** Atualiza o banco do PC a partir do online. completo: recarrega tudo. espelho: data da última carga do sistema antigo (zera se mudou). */
export async function replicar(api, { completo = false, espelho = null, config = null } = {}) {
  if (!B || !api.replica || estado.rodando) return estado;
  estado = { ...estado, rodando: true, erro: "" }; avisa();
  try {
    if (espelho && (await B.meta("espelho")) !== espelho) { await B.zerar(); await B.meta("espelho", espelho); completo = true; limpar(); }
    const v13 = await api.replica.temV13();
    const agora = Date.now(), ultimaCompleta = Number(await B.meta("completa:em")) || 0;
    const cicloCompleto = completo || agora - ultimaCompleta > (v13 ? 24 * 3600000 : 30 * 60000);
    let total = 0;
    for (const t of TABELAS_REPLICA) {
      const marca = await B.meta("marca:" + t);
      const incremental = !cicloCompleto && marca && (v13 || COM_DATA_ANTIGA.includes(t));
      if (!incremental && !cicloCompleto) continue; // sem atualizado_em (antes do v13): espera o ciclo completo
      let linhas;
      try {
        linhas = incremental ? await api.replica.desde(t, new Date(new Date(marca).getTime() - MARGEM_MS).toISOString()) : await api.backup.tabela(t);
      } catch (e) { if (OPCIONAL(t) && !/Sem conexão|Failed to fetch/i.test(e.message)) continue; throw e; }
      if (incremental) { if (linhas.length) await B.mesclar(t, JSON.stringify(linhas)); }
      else await B.substituir(t, JSON.stringify(linhas));
      const m = maior(linhas, "atualizado_em") || maior(linhas, "criado_em");
      if (m && (!marca || m > marca)) await B.meta("marca:" + t, m); else if (!marca) await B.meta("marca:" + t, new Date(0).toISOString());
      if (linhas.length) limpar(t);
      total += linhas.length;
    }
    // exclusões feitas no online desde a última vez (v13); sem v13, a conferência completa resolve
    if (v13) {
      const seq = Number(await B.meta("exclusoes:seq")) || 0;
      if (cicloCompleto && !seq) { const l = await api.replica.exclusoes(0); await B.meta("exclusoes:seq", l.length ? l[l.length - 1].seq : 0); }
      else {
        const l = await api.replica.exclusoes(seq), por = {};
        for (const x of l) (por[x.tabela] = por[x.tabela] || []).push(x.registro);
        for (const [t, ids] of Object.entries(por)) { await B.remover(t, ids); limpar(t); }
        if (l.length) await B.meta("exclusoes:seq", l[l.length - 1].seq);
      }
    }
    if (config) await B.meta("config", JSON.stringify(config));
    if (cicloCompleto) await B.meta("completa:em", String(agora));
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
const porData = (l, campo, de, ate) => l.filter(x => (!de || (x[campo] || "") >= de) && (!ate || (x[campo] || "") <= ate));
const ordena = (l, f) => [...l].sort(f);
const resumoOrdem = o => ({ ...o, ck_feito: o.checkin ? o.checkin.feito : undefined, legado: o.checkin && o.checkin.legado ? o.checkin.legado.numero : undefined });
export const leitorLocal = {
  meuPerfil: async uid => (await tabelaLocal("perfis")).find(p => p.id === uid) || null,
  perfis: async () => tabelaLocal("perfis"),
  config: async () => { try { return JSON.parse((await B.meta("config")) || "{}"); } catch (e) { return {}; } },
  listar: t => async () => tabelaLocal(t),
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
  vendasListar: async ({ de, ate } = {}) => ordena(porData(await tabelaLocal("vendas"), "criado_em", de, ate), (a, b) => (b.numero || 0) - (a.numero || 0)),
  vendaUma: async id => { const v = (await tabelaLocal("vendas")).find(x => x.id === id); if (!v) return null; return { ...v, itens: ordena((await tabelaLocal("venda_itens")).filter(i => i.venda_id === id), (a, b) => (a.posicao || 0) - (b.posicao || 0)) }; },
  funcionarios: async () => tabelaLocal("funcionarios"),
  lancamentos: async (comp, fid) => (await tabelaLocal("funcionario_lanc")).filter(l => l.competencia === comp && (!fid || l.funcionario_id === fid)),
  movimentos: async pid => ordena((await tabelaLocal("estoque_mov")).filter(m => !pid || m.produto_id === pid), (a, b) => (b.criado_em || "").localeCompare(a.criado_em || "")),
  sefazNotas: async () => tabelaLocal("nfe_recebidas"),
  ordensEntregues: async (ini, fim) => ordena((await tabelaLocal("ordens")).filter(o => o.status === "entregue" && o.entregue_em >= ini && o.entregue_em < fim), (a, b) => a.numero - b.numero),
};
