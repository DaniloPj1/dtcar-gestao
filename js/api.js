// Camada de dados. Usa o Supabase; nos testes automáticos, window.__API_MOCK substitui tudo.
import { local, erroDeRede } from "./local.js";
import { replicaDisponivel, replicaPronta, replicaProntaJa, leitorLocal as L, tabelaLocal, removerLocal, gravarLocal, trocarOrdemLocal } from "./replica.js";
import { versaoOS, tocarOS } from "./fila.js";
import { alterarOrdemOffline, salvarItensOffline, eventoOffline, iguais, temPendente, comTrava, podeAlterarSemInternet } from "./alteracoes.js";

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

const COLS_ORDENS = "id,numero,status,cliente,veiculo,cliente_id,veiculo_id,km_entrada,total,custo,desconto,criado_em,atualizado_em,entregue_em,consultor_nome,mecanico_id,mecanico_nome,previsao_entrega,previsao_hora,orcamento_enviado_em,validade_orcamento,reclamacao,forma_pagamento,garantia_dias,km_saida,box,situacao,contato,ck_feito:checkin->feito,legado:checkin->legado->numero,legado_receber:checkin->legado->a_receber";
const COLS_V11 = ",recebido,finalizada_em,motivo_cancelamento"; // colunas do supabase/v11.sql
let temV11 = true, temReceber = true, temV18 = null, temBoletos = null;
let temFixas = null, fixasGeradasEm = 0; // despesa fixa (supabase/v43.sql)
/** grava sem a coluna nova da v18 (conta de origem/destino) se o banco ainda não tiver o supabase/v18.sql */
async function semColunaV18(linha, coluna, gravar) {
  if (temV18 === false || !(coluna in linha)) { const { [coluna]: _, ...resto } = linha; return gravar(temV18 === false ? resto : linha); }
  try { return await gravar(linha); }
  catch (e) { if (!new RegExp(coluna).test(e.message)) throw e; temV18 = false; const { [coluna]: _, ...resto } = linha; return gravar(resto); }
}

// ---- sem internet: depois que o sistema percebe que caiu, nada fica esperando o servidor ----
// Toda chamada ao servidor tem tempo-limite; em modo "sem rede" ela falha na hora (e quem chamou usa a cópia do aparelho).
let semRede = false;
const ativos = new Set(); // chamadas em andamento: ao entrar no modo sem rede, são canceladas na hora (a tela usa a cópia do aparelho)
export const definirSemRede = v => { const antes = semRede; semRede = !!v;
  if (semRede) { for (const c of ativos) c.abort(semConexao("sem internet")); ativos.clear(); if (!antes) window.dispatchEvent(new Event("dtcar-sem-rede")); } };
export const estaSemRede = () => semRede;
const LIMITE_MS = 15000, LIMITE_ARQUIVO_MS = 120000;
// WhatsApp (função "zap"): a função espera o WhatsApp responder por até 40 s antes de devolver o resultado
const LIMITE_ZAP_MS = 60000;
// erro de rede "final": o nome AbortError faz a biblioteca do Supabase não repetir a tentativa (cada repetição esperava de novo)
const semConexao = motivo => { const e = new Error("Failed to fetch (" + motivo + ")"); e.name = "AbortError"; return e; };
function fetchComLimite(url, opts = {}) {
  if (semRede || !navigator.onLine) return Promise.reject(semConexao("sem internet"));
  const ctl = new AbortController(), lim = /\/storage\/v1\//.test(String(url)) ? LIMITE_ARQUIVO_MS : /\/functions\/v1\/zap\b/.test(String(url)) ? LIMITE_ZAP_MS : LIMITE_MS;
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
  const COLS_ZAP = "id,situacao,numero,dono,detalhe,ultimo_teste,atualizado_em,qr_svg,dono_ate,motor_chave_em,motor_visto,motor_info,pedido"; // WhatsApp (v24)
  const urls = new Map();
  // por chave (id > último): exclusões entre uma página e outra não fazem pular linhas (o "offset" pulava)
  const todosPorChave = async (montar, chave = "id") => { const out = []; let ultimo = null;
    for (;;) { let q = montar(); if (ultimo !== null) q = q.gt(chave, ultimo); const r = ok(await q.order(chave).limit(1000)); out.push(...r); if (r.length < 1000) return out; ultimo = r[r.length - 1][chave]; } };
  // o servidor devolve no máximo 1000 linhas por consulta: busca em páginas
  const todos = async montar => { const out = []; for (let de = 0; ; de += 1000) { const r = ok(await montar().range(de, de + 999)); out.push(...r); if (r.length < 1000) return out; } };
  // despesas fixas (v43): no máximo uma vez a cada 5 minutos por aparelho; falha (sem v43, sem permissão) não impede a lista
  const gerarFixas = async () => { if (temFixas === false || Date.now() - fixasGeradasEm < 300000) return; fixasGeradasEm = Date.now();
    try { const r = await sb.rpc("gerar_despesas_fixas", { p_dias: 30 }); if (r.error && /gerar_despesas_fixas|function|schema cache|404/i.test(r.error.message || "")) temFixas = false; } catch (e) {} };
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
      // sem internet a biblioteca não apaga o login guardado (precisa avisar o servidor): apaga aqui também
      // sem resposta do servidor (internet caiu sem o Windows avisar), não espera: em 4 s apaga o login daqui mesmo assim
      // scope "local": sai só deste aparelho. O padrão ("global") derruba todos os logins do usuário,
      // inclusive o do conector do Claude, que então pede para conectar de novo
      sair: async () => { try { await Promise.race([sb.auth.signOut({ scope: "local" }), new Promise(r => setTimeout(r, 4000))]); } catch (e) {}
        try { for (const k of Object.keys(localStorage)) if (/^sb-.*-auth-token$/.test(k)) localStorage.removeItem(k); } catch (e) {} },
    },
    meuPerfil: async uid => ok(await sb.from("perfis").select("*").eq("id", uid).maybeSingle()),
    /** v50: lista do técnico responsável da O.S. (funcionários ativos + acessos sem ficha); sem o v50, null (a tela usa a lista antiga) */
    tecnicos: async () => { const r = await sb.rpc("tecnicos_lista"); if (r.error && /tecnicos_lista|schema cache|PGRST202|404/i.test(r.error.message || "")) return null; return ok(r) || []; },
    /** v50: desconto da O.S. numa transação (parcelas a receber acompanham); gravar=false só mostra o que aconteceria */
    descontoOS: async (ordemId, desconto, motivo, gravar = true) => {
      let r; try { r = await sb.rpc("os_aplicar_desconto", { p_ordem: ordemId, p_desconto: desconto, p_motivo: motivo || "", p_gravar: !!gravar }); }
      catch (e) { throw new Error("Sem conexão com a internet: o desconto depois do orçamento precisa de internet."); }
      if (r.error && /os_aplicar_desconto|schema cache|PGRST202|404/i.test(r.error.message || "")) throw new Error("Para dar desconto depois do orçamento, o administrador precisa rodar o supabase/v50.sql no Supabase.");
      return ok(r); },
    perfis: async () => ok(await sb.from("perfis").select("*").order("nome")),
    salvarPerfil: async (id, patch) => ok(await sb.from("perfis").update(patch).eq("id", id)),
    config: async () => { const r = ok(await sb.from("config").select("dados").eq("id", 1).maybeSingle()); return (r && r.dados) || {}; },
    salvarConfig: async dados => ok(await sb.from("config").upsert({ id: 1, dados, atualizado_em: new Date().toISOString() })),
    clientes: tabela("clientes"), veiculos: tabela("veiculos"), servicos: tabela("servicos"),
    produtos: { ...tabela("produtos"),
      // grupos de produtos: troca a categoria de vários produtos de uma vez (renomear/juntar grupos ou marcar itens na lista); uma instrução só
      trocarGrupo: async ({ ids, de, para }) => { const cat = String(para ?? "").trim(); let q = sb.from("produtos").update({ categoria: cat, atualizado_em: new Date().toISOString() });
        if (ids && ids.length) q = q.in("id", ids); else if (de && de.length) q = q.in("categoria", de); else return 0;
        return ok(await q.select("id")).length; } },
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
      /** todos os recibos a partir de uma data, sem limite (saldo por conta) */
      // paginação por id (não se desloca) + corte pelo registro (ate): o que for lançado durante a leitura não entra
      desde: async (de, ate) => todosPorChave(() => { let q = sb.from("recibos").select("*").gte("data", de); if (ate) q = q.lte("criado_em", ate); return q; }),
      salvar: async r => semColunaV18(r, "conta_destino", async x => { const { id, ...resto } = x; return id ? ok(await sb.from("recibos").update(resto).eq("id", id).select().single()) : ok(await sb.from("recibos").insert(resto).select().single()); }),
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
      /** v50: em quantas O.S. ele é o técnico responsável (sem o v50: 0) */
      osComoTecnico: async id => { const r = await sb.from("ordens").select("id", { count: "exact", head: true }).eq("tecnico_id", id);
        if (r.error) { if (/tecnico_id|column/i.test(r.error.message || "")) return 0; throw traduzErro(r.error); } return r.count || 0; },
      excluirLanc: async id => ok(await sb.from("funcionario_lanc").delete().eq("id", id)),
      /** O.S. entregues no período, com o mecânico (v50: e o técnico da lista de Funcionários), para calcular a comissão */
      ordensEntregues: async (ini, fim) => { const q = c => todos(() => sb.from("ordens").select(c).eq("status", "entregue").gte("entregue_em", ini).lt("entregue_em", fim).order("numero"));
        try { return await q("id,numero,mecanico_id,mecanico_nome,tecnico_id,entregue_em,cliente,veiculo"); }
        catch (e) { if (!/tecnico_id|column/i.test(e.message)) throw e; return q("id,numero,mecanico_id,mecanico_nome,entregue_em,cliente,veiculo"); } }, // sem o v50
    },
    /** contas a receber (parcelas das O.S. entregues para pagar depois) — supabase/v12.sql */
    receber: {
      abertas: async () => { try { const l = await todos(() => sb.from("receber").select("*").eq("status", "aberta").order("vencimento").order("id")); temReceber = true; return l; }
        catch (e) { if (/receber|relation|does not exist|schema cache|404/i.test(e.message)) { temReceber = false; return []; } throw e; } },
      listar: async ({ de, ate, status } = {}) => todos(() => { let q = sb.from("receber").select("*"); if (de) q = q.gte("vencimento", de); if (ate) q = q.lte("vencimento", ate); if (status) q = q.eq("status", status); return q.order("vencimento").order("id"); }),
      daOrdem: async oid => ok(await sb.from("receber").select("*").eq("ordem_id", oid).order("parcela")),
      um: async id => ok(await sb.from("receber").select("*").eq("id", id).single()),
      lancar: async linhas => ok(await sb.from("receber").insert(linhas).select()),
      atualizar: async (id, patch) => ok(await sb.from("receber").update(patch).eq("id", id).select().single()),
    },
    /** boletos Sicredi por arquivo (CNAB240 híbrido) — supabase/v28.sql */
    boletos: {
      listar: async () => { try { const l = await todos(() => sb.from("boletos").select("*").order("criado_em", { ascending: false }).order("id")); temBoletos = true; return l; }
        catch (e) { if (/boletos|relation|does not exist|schema cache|404/i.test(e.message)) { temBoletos = false; return []; } throw e; } },
      daOrdem: async oid => ok(await sb.from("boletos").select("*").eq("ordem_id", oid).order("vencimento")),
      porNossoNumero: async lista => lista.length ? ok(await sb.from("boletos").select("*").in("nosso_numero", lista)) : [],
      incluir: async linhas => ok(await sb.from("boletos").insert(linhas).select()),
      atualizar: async (id, patch) => ok(await sb.from("boletos").update(patch).eq("id", id).select().single()),
      /** marca como pago só se ainda não estava pago (o mesmo pagamento nunca vira dois recibos); devolve a linha ou null */
      reservarPagamento: async (id, patch) => { const r = ok(await sb.from("boletos").update({ ...patch, situacao: "pago" }).eq("id", id).neq("situacao", "pago").select()); return r[0] || null; },
      excluir: async id => ok(await sb.from("boletos").delete().eq("id", id)),
      proximo: async chave => ok(await sb.rpc("cobranca_proximo", { p_chave: chave })),
      arquivos: {
        listar: async () => ok(await sb.from("boletos_arquivos").select("id,tipo,nome,sequencia,resumo,criado_por,criado_em").order("criado_em", { ascending: false }).limit(100)),
        um: async id => ok(await sb.from("boletos_arquivos").select("*").eq("id", id).single()),
        porHash: async hash => ok(await sb.from("boletos_arquivos").select("id,nome,criado_em").eq("hash", hash).maybeSingle()),
        salvar: async a => { const { id, ...resto } = a; return id ? ok(await sb.from("boletos_arquivos").update(resto).eq("id", id).select().single()) : ok(await sb.from("boletos_arquivos").insert(resto).select().single()); },
      },
    },
    temBoletos: () => temBoletos,
    /** Dados do veículo pela placa, pela função "placa" (API Placas; a chave fica no servidor; v55).
     *  Devolve { ok, encontrado, dados, origem } ou { ok: false, erro, desligada?, sem_saldo?, semRede? }. Não lança erro. */
    placa: async body => {
      let data, error;
      const SEM_RESPOSTA = { ok: false, semRede: true, erro: "Sem resposta da consulta de placa (sem conexão, ou a consulta ainda não foi ligada no Supabase)." };
      try { ({ data, error } = await sb.functions.invoke("placa", { body })); } catch (e) { return SEM_RESPOSTA; }
      if (error) {
        const st = error.context && error.context.status; let m = error.message || "";
        if (error.name === "FunctionsFetchError" || !error.context || /failed to (send|fetch)|networkerror|load failed/i.test(m)) return SEM_RESPOSTA;
        try { const j = await error.context.json(); if (j && j.erro) m = j.erro; } catch (e) {}
        if (st === 404 || /not found/i.test(m)) return { ok: false, desligada: true, erro: "A consulta de placa ainda não foi ligada: falta publicar a função \"placa\" no Supabase." };
        return { ok: false, erro: m || "Falha na consulta da placa." };
      }
      return data || { ok: false, erro: "Sem resposta da consulta de placa." };
    },
    /** Consultas de placa pagas desde uma data (tela Ajustes: quantidade e gasto do mês). Só administrador e consultor leem. */
    placaUso: async desde => ok(await sb.from("placa_consultas").select("tipo,valor_centavos,saldo_centavos,em").gte("em", desde).order("em", { ascending: false }).limit(2000)),
    /** API de Cobrança do Sicredi pela função "sicredi" (o navegador nunca vê a chave nem o código de acesso) */
    sicredi: async body => {
      const { data, error } = await sb.functions.invoke("sicredi", { body });
      if (error) { let m = error.message; try { const j = await error.context.json(); if (j && j.erro) m = j.erro; } catch (e) {} if (/not found|404/i.test(m)) m = "A função \"sicredi\" ainda não foi publicada no Supabase."; throw new Error(m); }
      if (data && data.erro) throw new Error(data.erro);
      return data;
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
      // antes de listar as abertas, lança a próxima de cada despesa fixa que vence em até 30 dias (v43; sem o v43, segue sem lançar)
      /** lança as despesas fixas que entram nos próximos 30 dias (no máximo a cada 5 min) */
      gerarFixas: async () => { await gerarFixas(); },
      abertas: async () => { await gerarFixas(); return todos(() => sb.from("contas").select("*").eq("status", "aberta").order("vencimento").order("id")); },
      /** despesas fixas (v43): contas dos grupos marcados como fixos, para a previsão de caixa projetar os meses seguintes */
      fixas: async () => { if (temFixas === false) return []; try { const l = await todos(() => sb.from("contas").select("*").eq("fixa", true).order("vencimento").order("id")); temFixas = true; return l; }
        catch (e) { if (/fixa|column/i.test(e.message)) { temFixas = false; return []; } throw e; } },
      tornarFixa: async id => { try { return ok(await sb.rpc("tornar_despesa_fixa", { p_conta: id })); }
        catch (e) { if (/tornar_despesa_fixa|function|schema cache|404/i.test(e.message)) throw new Error("Para usar despesa fixa (todo mês, sem fim), rode o supabase/v43.sql no Supabase."); throw e; } },
      encerrarFixa: async grupo => ok(await sb.rpc("encerrar_despesa_fixa", { p_grupo: grupo })),
      /** contas pagas a partir de uma data, paginadas por id (saldo por conta) */
      pagasDesde: async de => todosPorChave(() => sb.from("contas").select("*").eq("status", "paga").gte("pago_em", de)),
      salvar: async c => semColunaV18(c, "conta_origem", async x => { const { id, ...resto } = x; return id ? ok(await sb.from("contas").update(resto).eq("id", id).select().single()) : ok(await sb.from("contas").insert(resto).select().single()); }),
      excluir: async id => ok(await sb.from("contas").delete().eq("id", id)),
      lancar: async linhas => ok(await sb.rpc("lancar_contas", { p_linhas: linhas })),
      porCodigo: async cod => cod ? ok(await sb.from("contas").select("id,descricao,valor,vencimento,status").eq("codigo_barras", cod).neq("status", "cancelada").maybeSingle()) : null,
    },
    /** pedidos de compra por fornecedor (cupons, pré-vendas): tabela pre_notas do v19 + colunas de conferência do v31 */
    // orçamento separado da O.S. (v52). Gravação sempre pela orcamento_salvar (cabeçalho + itens numa transação)
    orcamentos: {
      listar: async () => todos(() => sb.from("orcamentos").select("*").order("numero", { ascending: false })),
      um: async id => { const o = ok(await sb.from("orcamentos").select("*").eq("id", id).maybeSingle()); if (!o) return null;
        return { ...o, itens: ok(await sb.from("orcamento_itens").select("*").eq("orcamento_id", id).order("posicao")) }; },
      salvar: async orc => ok(await sb.rpc("orcamento_salvar", { p: orc })),
      /** v53: aprova e vira O.S. (itensFora = ids que o cliente NÃO aprovou). gravar = false só confere e devolve o resumo */
      aprovar: async (id, { itensFora = [], por = "", forma = "", gravar = false } = {}) => ok(await sb.rpc("orcamento_aprovar", { p_orcamento: id, p_itens_fora: itensFora, p_por: por, p_forma: forma, p_gravar: gravar })),
      excluir: async id => { ok(await sb.from("orcamentos").delete().eq("id", id)); },
    },
    // agenda da oficina (v54). A tela grava direto na tabela (regras de acesso e gatilho do v54 decidem remarcação e quem criou)
    agenda: {
      listar: async ({ de, ate } = {}) => todos(() => { let q = sb.from("agendamentos").select("*"); if (de) q = q.gte("data", de); if (ate) q = q.lte("data", ate);
        return q.order("data").order("hora", { nullsFirst: false }).order("id"); }),
      um: async id => ok(await sb.from("agendamentos").select("*").eq("id", id).maybeSingle()),
      salvar: async a => { const { id, criado_em, atualizado_em, criado_por, criado_por_nome, remarcacoes, data_anterior, hora_anterior, ...resto } = a;
        return id ? ok(await sb.from("agendamentos").update(resto).eq("id", id).select().single()) : ok(await sb.from("agendamentos").insert(resto).select().single()); },
      excluir: async id => { ok(await sb.from("agendamentos").delete().eq("id", id)); },
      /** chegada registrada na O.S. que veio de um orçamento aprovado: o agendamento desse orçamento fica "Chegou" com a O.S. */
      chegouPeloOrcamento: async (orcamentoId, ordem) => ok(await sb.from("agendamentos").update({ situacao: "chegou", ordem_id: ordem.id, os_numero: ordem.numero })
        .eq("orcamento_id", orcamentoId).in("situacao", ["agendado", "confirmado"]).select("id")),
    },
    preNotas: {
      listar: async ({ de, ate } = {}) => todos(() => { let q = sb.from("pre_notas").select("*").neq("situacao", "cancelada"); if (de) q = q.gte("data", de); if (ate) q = q.lte("data", ate); return q.order("data").order("id"); }),
      /** em aberto de um fornecedor (pelo cadastro ou pelo nome sem cadastro), para conferir no pagamento */
      abertasDo: async (fornecedorId, nome) => { let q = sb.from("pre_notas").select("*").eq("situacao", "aberta");
        q = fornecedorId ? q.eq("fornecedor_id", fornecedorId) : q.is("fornecedor_id", null).ilike("fornecedor_nome", String(nome || "").replace(/[%_]/g, "")); return ok(await q.order("data").limit(200)); },
      incluir: async p => ok(await sb.from("pre_notas").insert(p).select().single()),
      atualizar: async (ids, patch) => { try { return ok(await sb.from("pre_notas").update(patch).in("id", ids).select()); }
        catch (e) { if (/conferida_em|conferida_por|conta_id|column/i.test(e.message)) throw new Error("Para marcar pedidos como conferidos, rode o supabase/v31.sql no Supabase."); throw e; } },
    },
    /** transferências entre as contas da empresa (supabase/v18.sql); sem a v18, lista vazia */
    transferencias: {
      listar: async ({ de, ate } = {}) => { try { const l = (await todosPorChave(() => { let q = sb.from("transferencias").select("*"); if (de) q = q.gte("data", de); if (ate) q = q.lte("data", ate); return q; })).sort((a, b) => a.data.localeCompare(b.data)); temV18 = true; return l; }
        catch (e) { if (/transferencias|relation|does not exist|schema cache|404/i.test(e.message)) { temV18 = false; return []; } throw e; } },
      salvar: async t => { const { id, ...resto } = t; try { return id ? ok(await sb.from("transferencias").update(resto).eq("id", id).select().single()) : ok(await sb.from("transferencias").insert(resto).select().single()); }
        catch (e) { if (/transferencias|relation|does not exist|schema cache|404/i.test(e.message)) throw new Error("Para registrar transferências, rode o supabase/v18.sql no Supabase."); throw e; } },
      excluir: async id => ok(await sb.from("transferencias").delete().eq("id", id)),
    },
    /** estornos registrados pelo banco (recibo cancelado, pagamento desfeito, transferência excluída) a partir de um instante */
    estornos: {
      desde: async (de, ate) => { try { return await todosPorChave(() => { let q = sb.from("estornos_saldo").select("*").gte("registrado_em", de); if (ate) q = q.lte("registrado_em", ate); return q; }); }
        catch (e) { if (/estornos_saldo|relation|does not exist|schema cache|404/i.test(e.message)) return []; throw e; } },
    },
    /** saldo de cada conta calculado no banco numa consulta só (supabase/v18.sql) */
    saldosContas: async () => ok(await sb.rpc("saldos_contas")),
    /** grava a nova referência dos saldos na mesma transação do cálculo; saldo null = manter o calculado */
    guardarSaldosContas: async (contas, pagar, receber, por) => { try { return ok(await sb.rpc("guardar_saldos_contas", { p_contas: contas, p_pagar: pagar || "", p_receber: receber || "", p_por: por || "" })); }
      catch (e) { if (/guardar_saldos_contas|function|schema cache|404/i.test(e.message)) throw new Error("Para guardar os saldos por conta, rode o supabase/v18.sql no Supabase."); throw e; } },
    /** banco com o supabase/v18.sql (saldo por conta e transferências); null = ainda não sabe */
    temV18: () => temV18,
    // WhatsApp da oficina (supabase/v22.sql + função "zap"): situação e ações (testar, parear, conferir, desconectar)
    whatsapp: {
      // com o v24 a tela lê só as colunas liberadas (com o v25, também as regras de envio) (o resumo da chave do motor fica de fora); sem ele, lê tudo
      situacao: async () => {
        let r = await sb.from("whatsapp_conexao").select(COLS_ZAP + ",regras,proximo_envio,alertas,alerta_telefone,vigiado_em").eq("id", 1).maybeSingle();
        if (r.error && /column|alertas|alerta_telefone|vigiado_em/i.test(r.error.message) && !/whatsapp_conexao" does not exist|relation/i.test(r.error.message)) r = await sb.from("whatsapp_conexao").select(COLS_ZAP + ",regras,proximo_envio").eq("id", 1).maybeSingle(); // sem o v32
        if (r.error && /column|regras|proximo_envio/i.test(r.error.message) && !/whatsapp_conexao" does not exist|relation/i.test(r.error.message)) r = await sb.from("whatsapp_conexao").select(COLS_ZAP).eq("id", 1).maybeSingle(); // sem o v25
        if (r.error && /column|dono_ate|motor_|pedido/i.test(r.error.message) && !/whatsapp_conexao" does not exist|relation/i.test(r.error.message)) r = await sb.from("whatsapp_conexao").select("*").eq("id", 1).maybeSingle();
        if (r.error && /whatsapp_conexao|schema cache|does not exist/i.test(r.error.message)) throw new Error("Falta rodar o supabase/v22.sql no Supabase.");
        return ok(r) || { situacao: "desligado" }; },
      /** chave do motor do Android (v24): gera uma nova (a anterior deixa de valer) e devolve UMA vez */
      novaChaveMotor: async () => { const r = await sb.rpc("whatsapp_motor_nova_chave");
        if (r.error && /whatsapp_motor_nova_chave|schema cache|404/i.test(r.error.message)) throw new Error("Falta rodar o supabase/v24.sql no Supabase.");
        return ok(r); },
      revogarMotor: async () => ok(await sb.rpc("whatsapp_motor_revogar")),
      // fila e mensagens (v25)
      fila: async () => {
        const cols = "id,telefone,cliente_nome,texto,status,erro,criado_em,enviada_em,origem,ordem_numero,fora_horario";
        let r = await sb.from("whatsapp_fila").select(cols + ",entrega,entregue_em,lida_em,arquivo,modelo").order("id", { ascending: false }).limit(20);
        if (r.error && /column|arquivo|modelo/i.test(r.error.message)) r = await sb.from("whatsapp_fila").select(cols + ",entrega,entregue_em,lida_em").order("id", { ascending: false }).limit(20); // sem o v34
        if (r.error && /column|entrega|lida_em/i.test(r.error.message)) r = await sb.from("whatsapp_fila").select(cols).order("id", { ascending: false }).limit(20); // sem o v32
        return ok(r); },
      // v32: alertas (faixa do administrador), número que recebe os avisos, resumo (sem resposta) e fotos recebidas
      alertas: async () => { const r = await sb.from("whatsapp_conexao").select("alertas").eq("id", 1).maybeSingle(); if (r.error) return null; return (r.data && r.data.alertas) || {}; },
      alertaTelefone: async tel => { const r = await sb.rpc("whatsapp_alerta_config", { p_telefone: tel || "" });
        if (r.error && /whatsapp_alerta_config|schema cache|404/i.test(r.error.message)) throw new Error("Falta rodar o supabase/v32.sql no Supabase.");
        return ok(r); },
      resumo: async () => ok(await sb.rpc("whatsapp_resumo")),
      fotos: async () => {
        const r = await sb.from("whatsapp_mensagens").select("msg_id,telefone,nome,texto,em,midia_path,midia_expira").not("midia_path", "is", null).order("em", { ascending: false }).limit(12);
        if (r.error) return [];
        const lista = r.data || []; if (!lista.length) return [];
        const u = await sb.storage.from("whatsapp-midia").createSignedUrls(lista.map(x => x.midia_path), 3600);
        const urls = new Map(((u && u.data) || []).map(x => [x.path, x.signedUrl]));
        return lista.map(x => ({ ...x, url: urls.get(x.midia_path) || null })); },
      conversas: async () => ok(await sb.rpc("whatsapp_conversas", { p_limite: 10, p_so_nao_lidas: false })) || [],
      cancelar: async id => ok(await sb.rpc("whatsapp_cancelar", { p_id: id })),
      chamar: async body => {
        const { data, error } = await sb.functions.invoke("zap", { body });
        if (error) { let m = error.message; try { const j = await error.context.json(); if (j && j.erro) m = j.erro; } catch (e) {} if (/not found|404/i.test(m)) m = "A função \"zap\" ainda não foi publicada no Supabase."; throw new Error(m); }
        if (data && data.erro) throw new Error(data.erro);
        return data;
      },
    },
    // Documentos do RH (supabase/v30.sql): PDFs da contabilidade na pasta privada "rh" (só administrador)
    rh: {
      listar: async () => { const r = await sb.from("rh_documentos").select("*").order("competencia", { ascending: false }).order("tipo").order("criado_em");
        if (r.error && /rh_documentos|schema cache|does not exist/i.test(r.error.message)) throw new Error("Falta rodar o supabase/v30.sql no Supabase.");
        return ok(r) || []; },
      baixar: async caminho => { const r = await sb.storage.from("rh").download(caminho); if (r.error) throw traduzErro(r.error); return r.data; },
      adicionar: async (arquivo, dados) => {
        const nome = (arquivo.name || "documento.pdf").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9.]+/g, "-").slice(-80);
        const caminho = dados.competencia + "/" + crypto.randomUUID() + "-" + nome;
        ok(await sb.storage.from("rh").upload(caminho, arquivo, { contentType: arquivo.type || "application/pdf", upsert: false }));
        const r = await sb.from("rh_documentos").insert({ ...dados, arquivo: caminho, nome_arquivo: arquivo.name || "", tipo_arquivo: arquivo.type || "application/pdf", tamanho: arquivo.size || 0, origem: "manual" }).select("*").single();
        if (r.error) { await sb.storage.from("rh").remove([caminho]); throw traduzErro(r.error); }
        return r.data; },
      atualizar: async (id, patch) => ok(await sb.from("rh_documentos").update({ ...patch, atualizado_em: new Date().toISOString() }).eq("id", id).select("*").single()),
      excluir: async doc => { ok(await sb.from("rh_documentos").delete().eq("id", doc.id)); await sb.storage.from("rh").remove([doc.arquivo]); },
    },
    // NF anexada à O.S. (supabase/v33.sql): PDF e XML da nota emitida no ObjetivaWeb, para mandar por e-mail junto com a O.S.
    notasOS: {
      listar: async osNumero => { const r = await sb.from("os_notas").select("*").eq("os_numero", osNumero).order("criado_em");
        if (r.error && /os_notas|schema cache|does not exist/i.test(r.error.message)) throw new Error("Falta rodar o supabase/v33.sql no Supabase.");
        return ok(r) || []; },
      baixar: async caminho => { const r = await sb.storage.from("notas").download(caminho); if (r.error) throw traduzErro(r.error); return r.data; },
      adicionar: async (arquivo, dados) => {
        const xml = /\.xml$/i.test(arquivo.name || "") || /xml/.test(arquivo.type || "");
        const tipo = xml ? "application/xml" : "application/pdf";
        const nome = (arquivo.name || (xml ? "nf.xml" : "nf.pdf")).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9.]+/g, "-").slice(-80);
        const caminho = dados.os_numero + "/" + crypto.randomUUID() + "-" + nome;
        ok(await sb.storage.from("notas").upload(caminho, arquivo, { contentType: tipo, upsert: false }));
        const r = await sb.from("os_notas").insert({ ...dados, arquivo: caminho, nome_arquivo: arquivo.name || nome, tipo_arquivo: tipo, tamanho: arquivo.size || 0 }).select("*").single();
        if (r.error) { await sb.storage.from("notas").remove([caminho]); throw traduzErro(r.error); }
        return r.data; },
      excluir: async n => { ok(await sb.from("os_notas").delete().eq("id", n.id)); await sb.storage.from("notas").remove([n.arquivo]); },
    },
    // E-mail da oficina (supabase/v29.sql + função "email"): situação, conectar, regras do filtro; o Claude lê e envia pelo conector
    email: {
      chamar: async body => {
        const { data, error } = await sb.functions.invoke("email", { body });
        if (error) { let m = error.message; try { const j = await error.context.json(); if (j && j.erro) m = j.erro; } catch (e) {} if (/not found|404/i.test(m)) m = "A função \"email\" ainda não foi publicada no Supabase."; throw new Error(m); }
        if (data && data.erro) throw new Error(data.erro);
        return data;
      },
      envios: async () => { const q = c => sb.from("email_envios").select(c).order("id", { ascending: false }).limit(20);
        let r = await q("id,em,tipo,para,assunto,resumo,resposta_a,por,anexos");
        if (r.error && /anexos/.test(r.error.message)) r = await q("id,em,tipo,para,assunto,resumo,resposta_a,por"); // antes do v33
        return ok(r) || []; },
      ligar: async v => { const r = await sb.rpc("email_ligar", { p_ligado: !!v }); if (r.error && /email_ligar|schema cache|404/i.test(r.error.message)) throw new Error("Falta rodar o supabase/v29.sql no Supabase."); return ok(r); },
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
      desde: async (tabela, quando) => todosPorChave(() => sb.from(tabela).select("*").gte("atualizado_em", quando), tabela === "estoque_reserva" ? "item_id" : "id"),
      ultimaExclusao: async () => { const r = ok(await sb.from("exclusoes").select("seq").order("seq", { ascending: false }).limit(1)); return r.length ? r[0].seq : 0; },
      exclusoes: async seq => todos(() => sb.from("exclusoes").select("seq,tabela,registro").gt("seq", seq || 0).order("seq")),
      // supabase/v15.sql (envio das alterações feitas sem internet): sem ele, o programa só consulta sem internet
      temV15: async () => { const r = await sb.rpc("sincronizar_alteracao_os", { p_op: { tipo: "ping" } }); if (!r.error) return true;
        if (/sincronizar_alteracao_os|Could not find the function|schema cache|PGRST202|404/i.test(r.error.message || "")) return false; throw traduzErro(r.error); },
      temV13: async () => { const r = await sb.from("exclusoes").select("seq").limit(1); if (!r.error) return true; if (/exclusoes|does not exist|schema cache|404/i.test(r.error.message || "")) return false; throw traduzErro(r.error); },
      ids: async tabela => todos(() => sb.from(tabela).select(tabela === "estoque_reserva" ? "item_id" : "id").order(tabela === "estoque_reserva" ? "item_id" : "id")).then(l => l.map(x => x.id ?? x.item_id)),
    },
    backup: {
      tabela: async nome => todosPorChave(() => sb.from(nome).select("*"), nome === "estoque_reserva" ? "item_id" : "id"),
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
    /**
     * Etapa 3: envia uma alteração de O.S. feita sem internet (js/alteracoes.js) pela função do servidor (supabase/v15.sql),
     * que confere e grava numa transação, com a O.S. e os itens travados (regras de conflito descritas no v15.sql).
     * op.forcar (decisão do usuário em "Dados no computador"): grava por cima, sem conferir.
     */
    sincronizarAlteracao: async op => {
      const { seq, tentativas, erro, conflito, forcar, ...dados } = op;
      const r = ok(await sb.rpc("sincronizar_alteracao_os", { p_op: dados, p_forcar: !!forcar }));
      if (r && r.conflito) { const e = new Error("Conflito: " + r.conflito); e.conflito = true; throw e; }
      return { ordem_id: op.ordem_id };
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
        out.push(...await todos(() => sb.from("os_itens").select("id,ordem_id,tipo,descricao,codigo,qtd,valor_unit,desconto,custo_unit,aprovado,executado,produto_id,fornecida_cliente,posicao,horas,qualidade,criado_em").in("ordem_id", parte).order("id")));
      }
      return out;
    },
    criarOrdem: async dados => ok(await sb.from("ordens").insert(dados).select("id,numero").single()),
    // devolvem as linhas gravadas (o programa copia para o banco do PC na hora: base certa para conferir conflitos depois)
    atualizarOrdem: async (id, patch) => ok(await sb.from("ordens").update(patch).eq("id", id).select()),
    /** v44: itens e O.S. numa transação (O.S. com peça do estoque); sem o v44, o caminho antigo */
    excluirOrdem: async id => { const r = await sb.rpc("excluir_ordem", { p_id: id });
      if (r.error && /excluir_ordem|schema cache|PGRST202|404/i.test(r.error.message || "")) return ok(await sb.from("ordens").delete().eq("id", id));
      return ok(r); },
    salvarItens: async (ordemId, itens, removidos) => {
      if (removidos && removidos.length) ok(await sb.from("os_itens").delete().in("id", removidos));
      if (!itens.length) return [];
      // O upsert em lote do Supabase usa a união das colunas de todas as linhas e grava NULL no que falta numa linha. Item novo (sem criado_em)
      // junto de item já salvo (com criado_em) dava "null value in column criado_em". Cada grupo de linhas com as mesmas colunas vai num pedido.
      const linhas = itens.map((i, n) => ({ ...Object.fromEntries(Object.entries(i).filter(([k, v]) => !k.startsWith("_") && v !== undefined)), ordem_id: ordemId, posicao: i.posicao ?? n }));
      const grupos = new Map();
      for (const l of linhas) { const k = Object.keys(l).sort().join(","); if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(l); }
      const saida = [];
      for (const g of grupos.values()) saida.push(...ok(await sb.from("os_itens").upsert(g).select()));
      return saida;
    },
    incluirFotos: async linhas => linhas.length ? ok(await sb.from("fotos").insert(linhas)) : null,
    excluirFoto: async foto => { ok(await sb.from("fotos").delete().eq("id", foto.id)); await sb.storage.from("fotos").remove([foto.caminho]); },
    evento: async (ordem_id, tipo, texto, usuario_nome, criado_em) => ok(await sb.from("eventos").insert({ ordem_id, tipo, texto, usuario_nome, ...(criado_em ? { criado_em } : {}) })),
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
  replicaPronta(); // já deixa marcado se o banco do PC tem a 1ª carga completa
  // banco do PC ainda sem a 1ª carga completa: responde "sem conexão" para a tela usar a cópia do navegador (não devolve lista vazia)
  const doPC = localFn => async (...args) => { if (!(await replicaPronta())) throw semConexao("banco do PC ainda sem carga"); return localFn(...args); };
  const ler = (servidor, localFn) => async (...args) => {
    if (semRede) return doPC(localFn)(...args);
    try { return await servidor(...args); } catch (e) { if (erroDeRede(e)) { definirSemRede(true); return doPC(localFn)(...args); } throw e; }
  };
  // perfil fora do banco do PC nunca vira "acesso aguardando liberação": cai para o perfil guardado no aparelho
  const perfilDoPC = async uid => { const p = await L.meuPerfil(uid); if (!p) throw semConexao("perfil fora do banco do PC"); return p; };
  const ordemDoPC = async id => ((await replicaPronta()) ? L.ordem(id) : null);
  // etapa 3: gravações da O.S. sem internet vão para o banco do PC + fila de envio (js/alteracoes.js).
  // Com internet, grava direto no servidor; se a rede cair no meio, entra na fila (o envio confere o que já foi gravado).
  // args[0] é sempre o id da O.S.
  const pedirEnvio = () => { try { window.dispatchEvent(new Event("dtcar-enviar-fila")); } catch (e) {} };
  const escreve = (servidor, offline, copiar) => async (...args) => {
    // alterar sem internet exige o banco do PC carregado e a função de envio no servidor (supabase/v15.sql)
    const pronta = (await replicaPronta()) && (await podeAlterarSemInternet());
    // O.S. com alteração na fila (mesmo em conflito): esta também vai para a fila, atrás das outras (nunca fora de ordem)
    const naFila = pronta && await temPendente(args[0]);
    if (!semRede && !naFila) {
      let r;
      try { r = await servidor(...args); }
      catch (e) {
        if (!erroDeRede(e) || !pronta) throw e;
        // a rede caiu no meio: pode ter gravado ou não. Vai para a fila do jeito que foi pedido (o envio confere o que já está lá)
        definirSemRede(true); return offline(...args, { sempre: true });
      }
      // gravou no online: copia já para o banco do PC (se a internet cair logo depois, a base das alterações está certa)
      tocarOS(args[0]); // quem estava lendo esta O.S. do online fica sabendo que a resposta dele é anterior a esta gravação
      if (copiar && pronta) try { await comTrava(() => copiar(r, ...args)); } catch (e) { /* a réplica corrige em seguida */ }
      return r;
    }
    if (!pronta) throw new Error((await replicaPronta())
      ? "Sem conexão com a internet: para alterar O.S. sem internet, o administrador precisa rodar o supabase/v15.sql no Supabase (uma vez). Até lá, sem internet é só consulta."
      : "Sem conexão com a internet: o banco do PC ainda não foi carregado. A alteração só pode ser feita com internet.");
    const r = await offline(...args);
    if (!semRede) pedirEnvio(); // com internet: envia a fila agora
    return r;
  };
  const soOnline = (servidor, msg) => async (...args) => { if (semRede) throw new Error(msg); return servidor(...args); };
  const t = nome => ({ ...a[nome], listar: ler(a[nome].listar, L.listar(nome)) });
  const ordemOriginal = a.ordem;
  return {
    ...a,
    meuPerfil: ler(a.meuPerfil, perfilDoPC), perfis: ler(a.perfis, L.perfis), config: ler(a.config, L.config),
    clientes: t("clientes"), veiculos: t("veiculos"), produtos: t("produtos"), fornecedores: t("fornecedores"),
    ordens: ler(a.ordens, L.ordens), alterados: ler(a.alterados, L.alterados), itensDasOrdens: ler(a.itensDasOrdens, L.itensDasOrdens),
    // O.S.: banco do PC primeiro quando sem rede; a cópia da O.S. aberta (local.js) continua valendo como reserva
    // O.S.: no programa, sem rede vem do banco do PC; a cópia da O.S. aberta (local.js) é só reserva
    ordem: async id => {
      // leitura do banco do PC sempre com a trava (nunca no meio de uma réplica ou de uma troca)
      if (semRede) { const o = await comTrava(() => ordemDoPC(id)); if (o) return o; return ordemOriginal(id); }
      for (let vez = 0; vez < 2; vez++) {
        // O.S. com alteração ainda na fila: a versão deste PC (com o trabalho pendente) é a que vale aqui até ser enviada
        if (await replicaPronta() && await temPendente(id)) { const o = await comTrava(() => ordemDoPC(id)); if (o) return o; }
        const v0 = versaoOS(id);
        let r;
        try { r = await ordemOriginal(id); } catch (e) { if (erroDeRede(e)) { definirSemRede(true); const o = await ordemDoPC(id); if (o) return o; } throw e; }
        if (r && r._local) { definirSemRede(true); const o = await ordemDoPC(id); if (o) return o; } // a rede caiu e veio a cópia antiga
        if (!r || r._pendente || r._local || !(await replicaPronta())) return r;
        // abriu do online: o banco do PC passa a ter exatamente o que está na tela (base das alterações se a internet cair).
        // Se a O.S. mudou aqui enquanto o online respondia (alteração na fila, enviada ou gravada), a resposta está velha: busca de novo.
        let velha = false;
        try { await comTrava(async () => { if (versaoOS(id) !== v0 || await temPendente(id)) { velha = true; return; } await trocarOrdemLocal(r); }); }
        catch (e) { return r; /* a réplica corrige */ }
        if (!velha) return r;
      }
      const o = await comTrava(() => ordemDoPC(id)); if (o) return o; // mudou de novo no meio: vale a do PC
      return ordemOriginal(id);
    },
    /** a O.S. como está no online, sem olhar a fila (resolver conflito: descartar o que foi feito aqui) */
    ordemDoServidor: async id => { if (semRede) throw new Error("é preciso internet para trazer a O.S. do online"); const r = await ordemOriginal(id);
      if (!r || r._local || r._pendente) throw new Error("é preciso internet para trazer a O.S. do online"); return r; },
    recibos: { ...a.recibos, listar: ler(a.recibos.listar, L.recibosListar), um: ler(a.recibos.um, L.reciboUm), desde: ler(a.recibos.desde, L.recibosDesde) },
    // orçamentos: sem internet, só consulta (do banco do PC); gravar precisa de internet (o número é dado pelo servidor)
    orcamentos: { ...a.orcamentos, listar: ler(a.orcamentos.listar, L.orcamentos), um: ler(a.orcamentos.um, L.orcamento),
      salvar: soOnline(a.orcamentos.salvar, "Sem conexão com a internet: o orçamento só pode ser gravado com internet."),
      aprovar: soOnline(a.orcamentos.aprovar, "Sem conexão com a internet: aprovar o orçamento cria a O.S. no servidor e precisa de internet."),
      excluir: soOnline(a.orcamentos.excluir, "Sem conexão com a internet: o orçamento só pode ser excluído com internet.") },
    // agenda: sem internet, só consulta (do banco do PC); gravar precisa de internet
    agenda: { ...a.agenda, listar: ler(a.agenda.listar, L.agenda), um: ler(a.agenda.um, L.agendaUm),
      salvar: soOnline(a.agenda.salvar, "Sem conexão com a internet: a agenda só pode ser alterada com internet."),
      excluir: soOnline(a.agenda.excluir, "Sem conexão com a internet: a agenda só pode ser alterada com internet."),
      chegouPeloOrcamento: soOnline(a.agenda.chegouPeloOrcamento, "Sem conexão com a internet: a agenda só pode ser alterada com internet.") },
    transferencias: { ...a.transferencias, listar: ler(a.transferencias.listar, L.transferenciasListar) },
    estornos: { ...a.estornos, desde: ler(a.estornos.desde, L.estornosDesde) },
    contas: { ...a.contas, listar: ler(a.contas.listar, L.contasListar), abertas: ler(a.contas.abertas, L.contasAbertas), pagasDesde: ler(a.contas.pagasDesde, de => L.contasListar({ de, campo: "pago_em", status: "paga" })),
      ...(a.contas.fixas ? { fixas: ler(a.contas.fixas, L.contasFixas) } : {}) },
    receber: { ...a.receber, abertas: ler(a.receber.abertas, L.receberAbertas), listar: ler(a.receber.listar, L.receberListar), daOrdem: ler(a.receber.daOrdem, L.receberDaOrdem) },
    vendas: { ...a.vendas, listar: ler(a.vendas.listar, L.vendasListar), uma: ler(a.vendas.uma, L.vendaUma) },
    funcionarios: { ...a.funcionarios, listar: ler(a.funcionarios.listar, L.funcionarios), lancamentos: ler(a.funcionarios.lancamentos, L.lancamentos), ordensEntregues: ler(a.funcionarios.ordensEntregues, L.ordensEntregues) },
    estoque: { ...a.estoque, movimentos: ler(a.estoque.movimentos, L.movimentos) },
    sefaz: { ...a.sefaz, notas: ler(a.sefaz.notas, L.sefazNotas), config: ler(a.sefaz.config, async () => null), novas: ler(a.sefaz.novas, async () => (await tabelaLocal("nfe_recebidas")).filter(n => n.status === "nova" && n.situacao !== "cancelada").length) },
    atualizarOrdem: escreve(a.atualizarOrdem, alterarOrdemOffline, async r => { if (Array.isArray(r) && r.length) await gravarLocal("ordens", r); }),
    salvarItens: (ordemId, itens, removidos = []) => escreve(a.salvarItens, salvarItensOffline, async (r, ordemId, itens, removidos) => { if (removidos && removidos.length) await removerLocal("os_itens", removidos); if (Array.isArray(r) && r.length) await gravarLocal("os_itens", r); })(ordemId, itens, removidos),
    // histórico: a data de criação é definida aqui e vale para o online e para a fila (se a resposta se perder, o reenvio não duplica)
    evento: (ordem_id, tipo, texto, usuario_nome) => { const criado_em = new Date().toISOString();
      return escreve((o, t, x, u) => a.evento(o, t, x, u, criado_em), (o, t, x, u) => eventoOffline(o, t, x, u, criado_em))(ordem_id, tipo, texto, usuario_nome); },
    enviarArquivo: soOnline(a.enviarArquivo, "Sem internet: fotos e assinaturas só podem ser enviadas com internet."),
    // v50: o desconto depois do orçamento grava direto no online (numa transação, com as parcelas). Com alteração desta O.S. ainda na fila
    // (mesmo em conflito), a conta sairia sem o que foi feito neste PC e a tela continuaria mostrando a versão do PC: espera a fila.
    ...(a.descontoOS ? { descontoOS: async (ordemId, desconto, motivo, gravar = true) => {
      if (semRede) throw new Error("Sem conexão com a internet: o desconto depois do orçamento precisa de internet.");
      if (await replicaPronta() && await temPendente(ordemId))
        throw new Error("Esta O.S. tem alteração feita sem internet ainda não enviada (ou em conflito). Envie a fila ou resolva em Sistema › Dados no computador antes de dar o desconto.");
      const r = await a.descontoOS(ordemId, desconto, motivo, gravar);
      if (gravar !== false) tocarOS(ordemId); // gravou no online: quem estava lendo esta O.S. sabe que a resposta dele é anterior
      return r; } } : {}),
    // envio da fila: depois que o histórico entrou no online, tira a cópia provisória do banco do PC (a réplica traz a definitiva)
    sincronizarAlteracao: async op => { const r = await a.sincronizarAlteracao(op); if (op.tipo === "evento_os" && op.local_id) await removerLocal("eventos", [op.local_id]); return r; },
    // backup sem internet: leitura ESTRITA do banco do PC (erro propaga; nunca vira tabela vazia). backup.tabela continua só do
    // servidor: a réplica (js/replica.js) usa ela e não pode misturar dados do PC numa carga completa.
    backup: { ...a.backup, doPC: async t => { if (!(await replicaPronta())) throw new Error("o banco do PC ainda não tem a primeira carga completa");
      return JSON.parse((await window.dtcarDesktop.banco.listar(t)) || "[]"); },
      configDoPC: async () => { const c = await window.dtcarDesktop.banco.meta("config"); if (!c) throw new Error("ajustes ausentes no banco do PC"); return JSON.parse(c); },
      copiaDoPCEm: () => window.dtcarDesktop.banco.meta("ultima") },
    bancoDoPC: true,
    get bancoPronto() { return replicaProntaJa(); },
  };
}
export const api = window.__API_MOCK || comBancoDoPC(criarApiSupabase());
