// Camada de dados. Usa o Supabase; nos testes automáticos, window.__API_MOCK substitui tudo.
import { local, erroDeRede } from "./local.js";
import { replicaDisponivel, leitorLocal as L, tabelaLocal } from "./replica.js";

const LS_CONEXAO = "dtcar-conexao";
export function conexao() {
  const c = window.DTCAR_CONFIG || {};
  let local = null; try { local = JSON.parse(localStorage.getItem(LS_CONEXAO) || "null"); } catch (e) {}
  const url = (c.SUPABASE_URL || (local && local.url) || "").trim();
  const key = (c.SUPABASE_ANON_KEY || (local && local.key) || "").trim();
  return url && key ? { url, key, local: !c.SUPABASE_URL } : null;
}
export function salvarConexaoLocal(url, key) { try { localStorage.setItem(LS_CONEXAO, JSON.stringify({ url, key })); } catch (e) {} }
export function limparConexaoLocal() { try { localStorage.removeItem(LS_CONEXAO); } catch (e) {} }

const MSG = [
  [/Invalid login credentials/i, "E-mail ou senha incorretos."],
  [/Email not confirmed/i, "Confirme seu e-mail pelo link enviado antes de entrar."],
  [/User already registered/i, "Este e-mail já tem cadastro. Use \"Entrar\" ou recupere a senha."],
  [/Password should be at least/i, "A senha precisa ter pelo menos 6 caracteres."],
  [/duplicate key.*placa/i, "Já existe um veículo com esta placa."],
  [/duplicate key.*clientes_doc_unico/i, "Já existe um cliente com este CPF/CNPJ."],
  [/violates foreign key/i, "Este registro está ligado a outros (veículos ou ordens) e não pode ser excluído."],
  [/row-level security|permission denied|not authorized/i, "Seu usuário não tem permissão para esta ação."],
  [/Failed to fetch|NetworkError|network/i, "Sem conexão com o servidor. Verifique a internet e tente de novo."],
  [/rate limit/i, "Muitas tentativas seguidas. Aguarde um minuto e tente de novo."],
];
export function traduzErro(e) {
  const m = (e && (e.message || e.error_description || e.msg)) || String(e || "Erro");
  for (const [re, t] of MSG) if (re.test(m)) return new Error(t);
  return new Error(m);
}

const COLS_ORDENS = "id,numero,status,cliente,veiculo,cliente_id,veiculo_id,km_entrada,total,custo,desconto,criado_em,atualizado_em,entregue_em,consultor_nome,mecanico_id,mecanico_nome,previsao_entrega,previsao_hora,orcamento_enviado_em,validade_orcamento,reclamacao,forma_pagamento,garantia_dias,km_saida,box,situacao,contato,ck_feito:checkin->feito,legado:checkin->legado->numero";
const COLS_V11 = ",recebido,finalizada_em,motivo_cancelamento"; // colunas do supabase/v11.sql
let temV11 = true, temReceber = true;

// ---- sem internet: depois que o sistema percebe que caiu, nada fica esperando o servidor ----
// Toda chamada ao servidor tem tempo-limite; em modo "sem rede" ela falha na hora (e quem chamou usa a cópia do aparelho).
let semRede = false;
const ativos = new Set(); // chamadas em andamento: ao entrar no modo sem rede, são canceladas na hora (a tela usa a cópia do aparelho)
export const definirSemRede = v => { semRede = !!v; if (semRede) { for (const c of ativos) c.abort(semConexao("sem internet")); ativos.clear(); } };
export const estaSemRede = () => semRede;
const LIMITE_MS = 15000, LIMITE_ARQUIVO_MS = 120000;
// erro de rede "final": o nome AbortError faz a biblioteca do Supabase não repetir a tentativa (cada repetição esperava de novo)
const semConexao = motivo => { const e = new Error("Failed to fetch (" + motivo + ")"); e.name = "AbortError"; return e; };
function fetchComLimite(url, opts = {}) {
  if (semRede || !navigator.onLine) return Promise.reject(semConexao("sem internet"));
  const ctl = new AbortController(), lim = /\/storage\/v1\//.test(String(url)) ? LIMITE_ARQUIVO_MS : LIMITE_MS;
  const t = setTimeout(() => { ativos.delete(ctl); ctl.abort(semConexao("tempo esgotado")); }, lim); // o motivo vira o erro, inclusive na leitura do corpo
  ativos.add(ctl);
  if (opts.signal) { if (opts.signal.aborted) ctl.abort(); else opts.signal.addEventListener("abort", () => ctl.abort()); }
  return fetch(url, { ...opts, signal: ctl.signal })
    // o prazo vale também para o corpo da resposta: o cronômetro não é desligado quando chegam os cabeçalhos
    // (cancelar depois de tudo lido não tem efeito)
    .catch(e => { clearTimeout(t); ativos.delete(ctl); if (opts.signal && opts.signal.aborted) throw e; throw semConexao(e && e.name === "AbortError" ? "tempo esgotado" : "sem resposta do servidor"); });
}

function criarApiSupabase() {
  const cx = conexao();
  if (!cx || !window.supabase) return null;
  const sb = window.supabase.createClient(cx.url, cx.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }, global: { fetch: fetchComLimite }, db: { retry: false } });
  // Em modo sem rede, as consultas falham ANTES de a biblioteca tentar renovar o login: com o login vencido e sem internet,
  // cada consulta esperava ~30 s de tentativas de renovação. Devolve uma "consulta" que recusa na hora, aceitando qualquer encadeamento.
  const recusa = () => { const p = new Proxy(function () {}, { get: (_, k) => k === "then" ? (a, b) => Promise.reject(semConexao("sem internet")).then(a, b)
    : k === "catch" ? f => Promise.reject(semConexao("sem internet")).catch(f) : () => p, apply: () => p }); return p; };
  for (const [obj, nome] of [[sb, "from"], [sb, "rpc"], [sb.storage, "from"]]) { const orig = obj[nome].bind(obj); obj[nome] = (...a) => semRede ? recusa() : orig(...a); }
  const ok = r => { if (r.error) throw traduzErro(r.error); return r.data; };
  const urls = new Map();
  // o servidor devolve no máximo 1000 linhas por consulta: busca em páginas
  const todos = async montar => { const out = []; for (let de = 0; ; de += 1000) { const r = ok(await montar().range(de, de + 999)); out.push(...r); if (r.length < 1000) return out; } };
  const tabela = nome => ({
    listar: async (ordem = "criado_em") => todos(() => sb.from(nome).select("*").order(ordem).order("id")),
    salvar: async obj => { const { id, ...resto } = obj;
      return id ? ok(await sb.from(nome).update(resto).eq("id", id).select().single()) : ok(await sb.from(nome).insert(resto).select().single()); },
    excluir: async id => ok(await sb.from(nome).delete().eq("id", id)),
  });
  const metodos = {
    tipo: "supabase",
    /** Confere se o servidor responde (ignora o modo sem rede): usado para sair do modo sem internet */
    testarConexao: async () => {
      if (!navigator.onLine) return false;
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 6000);
      try { const r = await fetch(cx.url + "/auth/v1/health", { headers: { apikey: cx.key }, signal: ctl.signal, cache: "no-store" }); return r.status < 500; }
      catch (e) { return false; } finally { clearTimeout(t); }
    },
    auth: {
      sessao: async () => (await sb.auth.getSession()).data.session,
      /** sessão e se a falha foi do servidor/rede (renovação do login não respondeu ou deu erro 5xx), e não login inválido */
      sessaoDetalhada: async () => { const { data, error } = await sb.auth.getSession();
        return { sessao: data && data.session, falhaDeRede: !!error && (error.name === "AuthRetryableFetchError" || !error.status || error.status >= 500) }; },
      /** login guardado neste aparelho e se já venceu (o token dura 1 hora; sem internet não dá para renovar) */
      guardadaVencida: s => !!(s && s.expires_at && s.expires_at * 1000 < Date.now() + 60000),
      aoMudar: cb => { const { data } = sb.auth.onAuthStateChange((evento, s) => cb(s, evento)); return () => data.subscription.unsubscribe(); },
      entrar: async (email, senha) => ok(await sb.auth.signInWithPassword({ email, password: senha })),
      cadastrar: async (nome, email, senha) => ok(await sb.auth.signUp({ email, password: senha, options: { data: { nome }, emailRedirectTo: location.origin + location.pathname } })),
      recuperar: async email => ok(await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname })),
      novaSenha: async senha => ok(await sb.auth.updateUser({ password: senha })),
      sair: async () => { await sb.auth.signOut(); },
    },
    meuPerfil: async uid => ok(await sb.from("perfis").select("*").eq("id", uid).maybeSingle()),
    perfis: async () => ok(await sb.from("perfis").select("*").order("nome")),
    salvarPerfil: async (id, patch) => ok(await sb.from("perfis").update(patch).eq("id", id)),
    config: async () => { const r = ok(await sb.from("config").select("dados").eq("id", 1).maybeSingle()); return (r && r.dados) || {}; },
    salvarConfig: async dados => ok(await sb.from("config").upsert({ id: 1, dados, atualizado_em: new Date().toISOString() })),
    clientes: tabela("clientes"), veiculos: tabela("veiculos"), servicos: tabela("servicos"), produtos: tabela("produtos"),
    ordens: async desde => {
      const busca = cols => todos(() => { let q = sb.from("ordens").select(cols); if (desde) q = q.gt("atualizado_em", desde); return q.order("numero", { ascending: false }); });
      if (temV11) { try { return await busca(COLS_ORDENS + COLS_V11); } catch (e) { if (!/recebido|finalizada_em|motivo_cancelamento|column/i.test(e.message)) throw e; temV11 = false; } }
      return busca(COLS_ORDENS);
    },
    temV11: () => temV11,
    /** banco com o supabase/v12.sql (receber depois + parcelas) */
    temV12: () => temV11 && temReceber,
    /** linhas alteradas depois de "desde" (sincronização leve a cada minuto) */
    alterados: async (nome, desde) => todos(() => sb.from(nome).select("*").gt("atualizado_em", desde).order("id")),
    idsDe: async nome => todos(() => sb.from(nome).select("id").order("id")).then(r => r.map(x => x.id)),
    recibos: {
      listar: async ({ ordemId, de, ate } = {}) => { let q = sb.from("recibos").select("*"); if (ordemId) q = q.eq("ordem_id", ordemId); if (de) q = q.gte("data", de); if (ate) q = q.lte("data", ate); return ok(await q.order("numero", { ascending: false }).limit(1000)); },
      um: async id => ok(await sb.from("recibos").select("*").eq("id", id).single()),
      salvar: async r => { const { id, ...resto } = r; return id ? ok(await sb.from("recibos").update(resto).eq("id", id).select().single()) : ok(await sb.from("recibos").insert(resto).select().single()); },
    },
    estoque: {
      movimentos: async produtoId => ok(await sb.from("estoque_mov").select("*").eq("produto_id", produtoId).order("criado_em", { ascending: false }).limit(200)),
      movimentar: async (produtoId, tipo, qtd, custo, obs) => ok(await sb.rpc("movimentar_estoque", { p_produto: produtoId, p_tipo: tipo, p_qtd: qtd, p_custo: custo || null, p_obs: obs || "" })),
    },
    fornecedores: tabela("fornecedores"),
    funcionarios: {
      ...tabela("funcionarios"),
      lancamentos: async (competencia, funcionarioId) => { let q = sb.from("funcionario_lanc").select("*").eq("competencia", competencia); if (funcionarioId) q = q.eq("funcionario_id", funcionarioId); return ok(await q.order("data").order("criado_em")); },
      lancar: async l => { const { id, ...resto } = l; return id ? ok(await sb.from("funcionario_lanc").update(resto).eq("id", id).select().single()) : ok(await sb.from("funcionario_lanc").insert(resto).select().single()); },
      excluirLanc: async id => ok(await sb.from("funcionario_lanc").delete().eq("id", id)),
      /** O.S. entregues no período, com o mecânico, para calcular a comissão */
      ordensEntregues: async (ini, fim) => todos(() => sb.from("ordens").select("id,numero,mecanico_id,mecanico_nome,entregue_em,cliente,veiculo").eq("status", "entregue").gte("entregue_em", ini).lt("entregue_em", fim).order("numero")),
    },
    /** contas a receber (parcelas das O.S. entregues para pagar depois) — supabase/v12.sql */
    receber: {
      abertas: async () => { try { const l = await todos(() => sb.from("receber").select("*").eq("status", "aberta").order("vencimento").order("id")); temReceber = true; return l; }
        catch (e) { if (/receber|relation|does not exist|schema cache|404/i.test(e.message)) { temReceber = false; return []; } throw e; } },
      listar: async ({ de, ate, status } = {}) => todos(() => { let q = sb.from("receber").select("*"); if (de) q = q.gte("vencimento", de); if (ate) q = q.lte("vencimento", ate); if (status) q = q.eq("status", status); return q.order("vencimento").order("id"); }),
      daOrdem: async oid => ok(await sb.from("receber").select("*").eq("ordem_id", oid).order("parcela")),
      lancar: async linhas => ok(await sb.from("receber").insert(linhas).select()),
      atualizar: async (id, patch) => ok(await sb.from("receber").update(patch).eq("id", id).select().single()),
    },
    vinculos: { listar: async () => todos(() => sb.from("produto_fornecedor").select("*").order("id")), doProduto: async pid => ok(await sb.from("produto_fornecedor").select("*").eq("produto_id", pid)) },
    notas: {
      existe: async chave => chave ? ok(await sb.from("notas_entrada").select("id,numero,criado_em,usuario_nome").eq("chave", chave).maybeSingle()) : null,
      listar: async () => ok(await sb.from("notas_entrada").select("id,chave,numero,serie,fornecedor_id,emissao,valor_total,usuario_nome,criado_em,itens").order("criado_em", { ascending: false }).limit(200)),
      importar: async p => ok(await sb.rpc("importar_nfe", { p })),
    },
    vendas: {
      listar: async ({ de, ate } = {}) => { let q = sb.from("vendas").select("*"); if (de) q = q.gte("criado_em", de); if (ate) q = q.lt("criado_em", ate); return ok(await q.order("numero", { ascending: false }).limit(1000)); },
      uma: async id => { const v = ok(await sb.from("vendas").select("*").eq("id", id).single()); v.itens = ok(await sb.from("venda_itens").select("*").eq("venda_id", id).order("posicao")); return v; },
      finalizar: async p => ok(await sb.rpc("finalizar_venda", { p })),
      cancelar: async (id, motivo) => ok(await sb.rpc("cancelar_venda", { p_id: id, p_motivo: motivo || "" })),
    },
    contas: {
      listar: async ({ de, ate, campo = "vencimento", status } = {}) => todos(() => { let q = sb.from("contas").select("*"); if (de) q = q.gte(campo, de); if (ate) q = q.lte(campo, ate); if (status) q = q.eq("status", status); return q.order("vencimento").order("id"); }),
      abertas: async () => todos(() => sb.from("contas").select("*").eq("status", "aberta").order("vencimento").order("id")),
      salvar: async c => { const { id, ...resto } = c; return id ? ok(await sb.from("contas").update(resto).eq("id", id).select().single()) : ok(await sb.from("contas").insert(resto).select().single()); },
      excluir: async id => ok(await sb.from("contas").delete().eq("id", id)),
      lancar: async linhas => ok(await sb.rpc("lancar_contas", { p_linhas: linhas })),
      porCodigo: async cod => cod ? ok(await sb.from("contas").select("id,descricao,valor,vencimento,status").eq("codigo_barras", cod).neq("status", "cancelada").maybeSingle()) : null,
    },
    sefaz: {
      config: async () => ok(await sb.from("sefaz_config").select("*").eq("id", 1).maybeSingle()),
      salvarConfig: async patch => ok(await sb.from("sefaz_config").update(patch).eq("id", 1)),
      notas: async () => todos(() => sb.from("nfe_recebidas").select("id,chave,nsu,cnpj_emitente,nome_emitente,ie_emitente,numero,serie,emissao,valor,tipo_nf,situacao,tem_xml,manifestacao,manifestada_em,manifestacao_erro,manifestacao_pedida,sem_ciencia,status,nota_id,contas_lancadas,obs,criado_em").order("emissao", { ascending: false }).order("id")),
      novas: async () => { const r = await sb.from("nfe_recebidas").select("id", { count: "exact", head: true }).eq("status", "nova").neq("situacao", "cancelada"); if (r.error) throw traduzErro(r.error); return r.count || 0; },
      xml: async chave => ok(await sb.from("nfe_recebidas").select("xml").eq("chave", chave).single()).xml,
      marcar: async (chave, patch) => ok(await sb.from("nfe_recebidas").update(patch).eq("chave", chave)),
      vincular: async p => ok(await sb.rpc("vincular_nfe_os", { p })),
      vinculos: async chave => ok(await sb.from("nfe_os_vinculos").select("*").eq("chave", chave).order("criado_em")),
      pedirConsulta: async () => ok(await sb.rpc("pedir_consulta_sefaz")),
      pedirManifestacao: async (chave, tipo, just) => ok(await sb.rpc("pedir_manifestacao", { p_chave: chave, p_tipo: tipo, p_justificativa: just || "" })),
      chamar: async body => {
        const { data, error } = await sb.functions.invoke("sefaz", { body });
        if (error) { let m = error.message; try { const j = await error.context.json(); if (j && j.erro) m = j.erro; } catch (e) {} throw new Error(m); }
        if (data && data.erro) throw new Error(data.erro);
        return data;
      },
    },
    relatorioItens: async (ini, fim, base) => todos(() => sb.rpc("relatorio_itens", { p_ini: ini, p_fim: fim, p_base: base || "entrega" }).order("numero").order("item_id")),
    /** réplica no banco do PC (etapa 2): o que mudou desde uma data e o que foi apagado (supabase/v13.sql) */
    replica: {
      desde: async (tabela, quando) => todos(() => sb.from(tabela).select("*").gte("atualizado_em", quando).order(tabela === "estoque_reserva" ? "item_id" : "id")),
      exclusoes: async seq => todos(() => sb.from("exclusoes").select("seq,tabela,registro").gt("seq", seq || 0).order("seq")),
      temV13: async () => { const r = await sb.from("exclusoes").select("seq").limit(1); if (!r.error) return true; if (/exclusoes|does not exist|schema cache|404/i.test(r.error.message || "")) return false; throw traduzErro(r.error); },
      ids: async tabela => todos(() => sb.from(tabela).select(tabela === "estoque_reserva" ? "item_id" : "id").order(tabela === "estoque_reserva" ? "item_id" : "id")).then(l => l.map(x => x.id ?? x.item_id)),
    },
    backup: {
      tabela: async nome => todos(() => sb.from(nome).select("*").order(nome === "estoque_reserva" ? "item_id" : "id")),
      restaurar: async (nome, linhas) => ok(await sb.rpc("restaurar_tabela", { p_tabela: nome, p_linhas: linhas })),
    },
    relatorioVendidos: async (ini, fim) => ok(await sb.rpc("relatorio_vendidos", { p_ini: ini, p_fim: fim })),
    painel: async (ini, fim, grupo) => ok(await sb.rpc("painel_resumo", { p_ini: ini, p_fim: fim, p_grupo: grupo })),
    /** modo espelho: apaga cadastros, O.S., recibos, vendas e estoque antes de carregar o backup do sistema antigo (supabase/v12.sql) */
    espelhoZerar: async () => ok(await sb.rpc("espelho_legado_zerar")),
    importarLegado: async (tipo, linhas, atualizar) => ok(await sb.rpc("importar_legado", { p_tipo: tipo, p_linhas: linhas, p_atualizar: !!atualizar })),
    ordem: async id => {
      const pend = await local.ler("os:" + id); if (pend && pend._pendente) return pend; // aberta sem internet, ainda não enviada
      if (semRede) { if (pend) return { ...pend, _local: true }; throw new Error("Sem conexão com a internet: esta O.S. não está guardada neste computador. Ela abre quando a conexão voltar."); }
      try { const r = await buscarOrdem(id); local.gravar("os:" + id, r); return r; }
      catch (e) { if (erroDeRede(e)) { const c = await local.ler("os:" + id); if (c) return { ...c, _local: true }; throw new Error("Sem conexão com a internet: esta O.S. não está guardada neste computador. Ela abre quando a conexão voltar."); } throw e; }
    },
    ordemNoAparelho: async id => local.ler("os:" + id),
    /**
     * Envia uma O.S. aberta sem internet. Os ids vêm do aparelho, então reenviar não duplica nada:
     * o que já existe no servidor é reaproveitado. O número é gerado aqui, pela sequência do banco.
     */
    sincronizarAbertura: async op => {
      const inserir = async (t, linha) => {
        const r = await sb.from(t).insert(linha).select().single();
        if (!r.error) return [r.data, true];
        if (/duplicate key/i.test(r.error.message) && /_pkey/i.test(r.error.message)) return [ok(await sb.from(t).select("*").eq("id", linha.id).single()), false];
        throw traduzErro(r.error);
      };
      let veiculoId = op.ordem.veiculo_id;
      if (op.cliente) await inserir("clientes", op.cliente);
      if (op.veiculo) {
        try { await inserir("veiculos", op.veiculo); }
        catch (e) { // a placa foi cadastrada por outro aparelho enquanto este estava sem internet: usa o cadastro existente
          if (!/placa/i.test(e.message)) throw e;
          const v = ok(await sb.from("veiculos").select("id,km_atual").eq("placa", op.veiculo.placa).maybeSingle()); if (!v) throw e;
          veiculoId = v.id;
          ok(await sb.from("veiculos").update({ cliente_id: op.veiculo.cliente_id, km_atual: Math.max(op.veiculo.km_atual || 0, v.km_atual || 0) }).eq("id", v.id));
        }
      } else if (op.veiculoAtualizar) {
        const v = ok(await sb.from("veiculos").select("km_atual").eq("id", op.veiculoAtualizar.id).maybeSingle());
        if (v) ok(await sb.from("veiculos").update({ cliente_id: op.veiculoAtualizar.cliente_id, km_atual: Math.max(op.veiculoAtualizar.km_atual || 0, v.km_atual || 0) }).eq("id", op.veiculoAtualizar.id));
      }
      const [o, nova] = await inserir("ordens", { ...op.ordem, veiculo_id: veiculoId });
      if (nova) for (const ev of op.eventos || []) ok(await sb.from("eventos").insert({ ...ev, ordem_id: o.id }));
      if (nova) ok(await sb.from("eventos").insert({ ordem_id: o.id, tipo: "sincronizada", usuario_nome: op.usuario_nome || "",
        texto: `O.S. aberta sem internet em ${new Date(op.criado_em).toLocaleString("pt-BR")} como ${op.provisorio}; recebeu o número ${o.numero} ao sincronizar.` }));
      return { id: o.id, numero: o.numero, nova };
    },
    guardarOrdem: async id => { const r = await buscarOrdem(id); await local.gravar("os:" + id, r); return r; },
  };
  async function buscarOrdem(id) {
      const o = ok(await sb.from("ordens").select("*").eq("id", id).single());
      const [itens, fotos, eventos] = await Promise.all([
        sb.from("os_itens").select("*").eq("ordem_id", id).order("posicao").then(ok),
        sb.from("fotos").select("*").eq("ordem_id", id).order("criado_em").then(ok),
        sb.from("eventos").select("*").eq("ordem_id", id).order("criado_em", { ascending: false }).then(ok),
      ]);
      return { ...o, itens, fotos, eventos };
  }
  return {
    ...metodos,
    itensDasOrdens: async ids => {
      const out = [];
      for (let i = 0; i < ids.length; i += 60) {
        const parte = ids.slice(i, i + 60);
        out.push(...await todos(() => sb.from("os_itens").select("id,ordem_id,tipo,descricao,codigo,qtd,valor_unit,desconto,custo_unit,aprovado,executado,produto_id,fornecida_cliente").in("ordem_id", parte).order("id")));
      }
      return out;
    },
    criarOrdem: async dados => ok(await sb.from("ordens").insert(dados).select("id,numero").single()),
    atualizarOrdem: async (id, patch) => ok(await sb.from("ordens").update(patch).eq("id", id)),
    excluirOrdem: async id => ok(await sb.from("ordens").delete().eq("id", id)),
    salvarItens: async (ordemId, itens, removidos) => {
      if (removidos && removidos.length) ok(await sb.from("os_itens").delete().in("id", removidos));
      if (itens.length) ok(await sb.from("os_itens").upsert(itens.map((i, n) => ({ ...Object.fromEntries(Object.entries(i).filter(([k]) => !k.startsWith("_"))), ordem_id: ordemId, posicao: i.posicao ?? n }))));
    },
    incluirFotos: async linhas => linhas.length ? ok(await sb.from("fotos").insert(linhas)) : null,
    excluirFoto: async foto => { ok(await sb.from("fotos").delete().eq("id", foto.id)); await sb.storage.from("fotos").remove([foto.caminho]); },
    evento: async (ordem_id, tipo, texto, usuario_nome) => ok(await sb.from("eventos").insert({ ordem_id, tipo, texto, usuario_nome })),
    enviarArquivo: async (caminho, blob, tipo) => { ok(await sb.storage.from("fotos").upload(caminho, blob, { contentType: tipo, upsert: false })); return caminho; },
    removerArquivos: async caminhos => { if (caminhos.length) await sb.storage.from("fotos").remove(caminhos); },
    urlArquivo: async caminho => {
      const c = urls.get(caminho); if (c && c.exp > Date.now()) return c.url;
      const r = ok(await sb.storage.from("fotos").createSignedUrl(caminho, 3600));
      urls.set(caminho, { url: r.signedUrl, exp: Date.now() + 3300 * 1000 }); return r.signedUrl;
    },
  };
}

/**
 * Programa para Windows com banco no PC (etapa 2a): sem internet, as leituras vêm do banco do PC.
 * Com internet, lê do servidor; se a rede falhar no meio, cai para o banco do PC na mesma chamada.
 */
function comBancoDoPC(a) {
  if (!a || !replicaDisponivel()) return a;
  const ler = (servidor, localFn) => async (...args) => {
    if (semRede) return localFn(...args);
    try { return await servidor(...args); } catch (e) { if (erroDeRede(e)) { definirSemRede(true); return localFn(...args); } throw e; }
  };
  const t = nome => ({ ...a[nome], listar: ler(a[nome].listar, L.listar(nome)) });
  const ordemOriginal = a.ordem;
  return {
    ...a,
    meuPerfil: ler(a.meuPerfil, L.meuPerfil), perfis: ler(a.perfis, L.perfis), config: ler(a.config, L.config),
    clientes: t("clientes"), veiculos: t("veiculos"), produtos: t("produtos"), fornecedores: t("fornecedores"),
    ordens: ler(a.ordens, L.ordens), alterados: ler(a.alterados, L.alterados), itensDasOrdens: ler(a.itensDasOrdens, L.itensDasOrdens),
    // O.S.: banco do PC primeiro quando sem rede; a cópia da O.S. aberta (local.js) continua valendo como reserva
    ordem: async id => {
      if (semRede) { const o = await L.ordem(id); if (o) return o; return ordemOriginal(id); }
      try { return await ordemOriginal(id); } catch (e) { if (erroDeRede(e)) { definirSemRede(true); const o = await L.ordem(id); if (o) return o; } throw e; }
    },
    recibos: { ...a.recibos, listar: ler(a.recibos.listar, L.recibosListar), um: ler(a.recibos.um, L.reciboUm) },
    contas: { ...a.contas, listar: ler(a.contas.listar, L.contasListar), abertas: ler(a.contas.abertas, L.contasAbertas) },
    receber: { ...a.receber, abertas: ler(a.receber.abertas, L.receberAbertas), listar: ler(a.receber.listar, L.receberListar), daOrdem: ler(a.receber.daOrdem, L.receberDaOrdem) },
    vendas: { ...a.vendas, listar: ler(a.vendas.listar, L.vendasListar), uma: ler(a.vendas.uma, L.vendaUma) },
    funcionarios: { ...a.funcionarios, listar: ler(a.funcionarios.listar, L.funcionarios), lancamentos: ler(a.funcionarios.lancamentos, L.lancamentos), ordensEntregues: ler(a.funcionarios.ordensEntregues, L.ordensEntregues) },
    estoque: { ...a.estoque, movimentos: ler(a.estoque.movimentos, L.movimentos) },
    sefaz: { ...a.sefaz, notas: ler(a.sefaz.notas, L.sefazNotas), config: ler(a.sefaz.config, async () => null), novas: ler(a.sefaz.novas, async () => (await tabelaLocal("nfe_recebidas")).filter(n => n.status === "nova" && n.situacao !== "cancelada").length) },
    bancoDoPC: true,
  };
}
export const api = window.__API_MOCK || comBancoDoPC(criarApiSupabase());
