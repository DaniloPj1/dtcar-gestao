// Camada de dados. Usa o Supabase; nos testes automáticos, window.__API_MOCK substitui tudo.

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

function criarApiSupabase() {
  const cx = conexao();
  if (!cx || !window.supabase) return null;
  const sb = window.supabase.createClient(cx.url, cx.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
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
  return {
    tipo: "supabase",
    auth: {
      sessao: async () => (await sb.auth.getSession()).data.session,
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
    ordens: async desde => todos(() => { let q = sb.from("ordens").select(COLS_ORDENS); if (desde) q = q.gt("atualizado_em", desde); return q.order("numero", { ascending: false }); }),
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
    painel: async (ini, fim, grupo) => ok(await sb.rpc("painel_resumo", { p_ini: ini, p_fim: fim, p_grupo: grupo })),
    importarLegado: async (tipo, linhas, atualizar) => ok(await sb.rpc("importar_legado", { p_tipo: tipo, p_linhas: linhas, p_atualizar: !!atualizar })),
    ordem: async id => {
      const o = ok(await sb.from("ordens").select("*").eq("id", id).single());
      const [itens, fotos, eventos] = await Promise.all([
        sb.from("os_itens").select("*").eq("ordem_id", id).order("posicao").then(ok),
        sb.from("fotos").select("*").eq("ordem_id", id).order("criado_em").then(ok),
        sb.from("eventos").select("*").eq("ordem_id", id).order("criado_em", { ascending: false }).then(ok),
      ]);
      return { ...o, itens, fotos, eventos };
    },
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
      if (itens.length) ok(await sb.from("os_itens").upsert(itens.map((i, n) => ({ ...i, ordem_id: ordemId, posicao: i.posicao ?? n }))));
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

export const api = window.__API_MOCK || criarApiSupabase();
