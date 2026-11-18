// DTCar Gestão — função "pedido": o pedido de orçamento feito pelo app do celular (pedido do Danilo em 16/11/2026).
// No app ninguém lança item nem preço: o mecânico/consultor escreve O QUE É PARA ORÇAR e envia. No sistema, o Danilo pega o
// pedido (aparece como orçamento em elaboração, com aviso de "novo pedido pelo app") e monta o orçamento para o cliente.
//
// Por que uma função: a tabela orcamentos só aceita gravação de administrador e consultor (política e_gestor, v52), e o
// mecânico também precisa pedir orçamento. A função confere que quem chama é da equipe (e_membro) e grava com a chave de
// servidor. Nada de preço, item ou estoque passa por aqui.
//
// Ações (POST com { acao, ... }), para qualquer membro da equipe (admin, consultor, mecanico):
//   novo        — { texto, placa, veiculo: { marca, modelo, ano }, veiculo_id, cliente_id, cliente: { nome, telefone } }:
//                 cria o orçamento em "elaboracao" com reclamacao = texto e a marca "Pedido pelo app" em obs_internas.
//                 Devolve { ok, id, numero }.
//   acrescentar — { id, texto }: acrescenta mais coisas a orçar num orçamento ainda aberto (elaboracao ou enviado),
//                 com o nome de quem escreveu e a hora. Devolve { ok, id }.
// Nas duas ações pode vir itens: [{ descricao, qtd }] — os itens marcados nos sistemas do carro (18/11/2026). Entram em orcamento_itens
// como serviço, SEM PREÇO (valor 0); o Danilo só preenche os valores no sistema. O texto passa a ser opcional quando há itens.
// Publicar com "Verify JWT" desligado (a função confere o login). Usa a chave de servidor do próprio Supabase (ctx.supabaseAdmin).
import { withSupabase } from "npm:@supabase/server@1.9.2";

export class ErroUso extends Error {}
const json = (corpo: unknown, status = 200) => Response.json(corpo, { status });
export const MARCA_APP = "Pedido pelo app";
export const limpaTexto = (t: unknown) => String(t || "").replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").trim();
const uuid = (s: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ""));
export const normPlaca = (p: unknown) => String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 7);
const campo = (v: unknown, max: number) => String(v || "").trim().slice(0, max);
/** "16/11/2026 15:30" no horário de Brasília */
export const quando = (d = new Date()) => {
  const p = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).formatToParts(d);
  const g = (t: string) => (p.find((x) => x.type === t) || { value: "" }).value;
  return `${g("day")}/${g("month")}/${g("year")} ${g("hour")}:${g("minute")}`;
};

/** itens marcados no app: só descrição e quantidade (nunca preço); até 40, descrição até 120 caracteres */
export function limparItens(v: unknown): { descricao: string; qtd: number }[] {
  if (!Array.isArray(v)) return [];
  if (v.length > 40) throw new ErroUso("No máximo 40 itens por pedido.");
  return v.map((x) => { const o = (x || {}) as Record<string, unknown>; const descricao = String(o.descricao || "").replace(/\s+/g, " ").trim().toUpperCase().slice(0, 120);
    const q = Math.round(Number(o.qtd) || 1); return { descricao, qtd: Math.min(99, Math.max(1, q)) }; }).filter((x) => x.descricao.length >= 2);
}
const resumoItens = (itens: { descricao: string; qtd: number }[]) => itens.map((i) => (i.qtd > 1 ? i.qtd + "x " : "") + i.descricao).join("; ");

export type Orcamento = { id: string; numero: number; situacao: string; reclamacao: string; obs_internas: string; consultor_id?: string | null; criado_por?: string | null };
export type Deps = {
  membro: boolean;
  mecanico?: boolean;                                             // o mecânico só acrescenta no orçamento que ele abriu (regra do Danilo, 17/11/2026)
  apagar?: (orcamentoId: string) => Promise<void>;
  quem: string;                                                   // id de quem chama
  nome: string;                                                   // nome de quem chama (perfis)
  inserir: (o: Record<string, unknown>) => Promise<{ id: string; numero: number }>;
  ler: (id: string) => Promise<Orcamento | null>;
  gravar: (id: string, patch: Record<string, unknown>) => Promise<void>;
  inserirItens?: (orcamentoId: string, itens: { descricao: string; qtd: number }[]) => Promise<void>;
  agora?: Date;
};

export async function executar(corpo: Record<string, unknown>, deps: Deps): Promise<Record<string, unknown>> {
  if (!deps.membro) throw new ErroUso("Seu login não faz parte da equipe: peça a liberação ao administrador.");
  const acao = String(corpo.acao || "");
  const texto = limpaTexto(corpo.texto);
  const itens = limparItens(corpo.itens);
  if (texto.length < 3 && !itens.length) throw new ErroUso("Escreva o que é para orçar ou marque os itens.");
  if (texto.length > 2000) throw new ErroUso("O pedido pode ter no máximo 2000 caracteres.");
  const assinatura = (deps.nome || "App").trim() + ", " + quando(deps.agora);

  if (acao === "novo") {
    const placa = normPlaca(corpo.placa);
    if (placa && !/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(placa)) throw new ErroUso("A placa está incompleta (ABC1234 ou ABC1D23).");
    const v = (corpo.veiculo || {}) as Record<string, unknown>, c = (corpo.cliente || {}) as Record<string, unknown>;
    const cliente_id = uuid(corpo.cliente_id) ? String(corpo.cliente_id) : null, veiculo_id = uuid(corpo.veiculo_id) ? String(corpo.veiculo_id) : null;
    const nomeCli = campo(c.nome, 120), telCli = String(c.telefone || "").replace(/\D/g, "").slice(0, 13);
    if (!placa && !nomeCli) throw new ErroUso("Informe a placa ou o nome do cliente.");
    // sem nome (placa sem dono no cadastro): o sistema exige um nome ao salvar o orçamento, então vai "A INFORMAR" para o Danilo trocar
    const r = await deps.inserir({
      situacao: "elaboracao", cliente_id, veiculo_id,
      cliente: { nome: nomeCli || "A INFORMAR", telefone: telCli },
      veiculo: { placa, marca: campo(v.marca, 60), modelo: campo(v.modelo, 80), ano: campo(v.ano, 9) },
      reclamacao: (texto || resumoItens(itens)).slice(0, 2000), obs: "", obs_internas: MARCA_APP + " — " + assinatura,
      tabela_preco: "vista", condicoes_pagamento: "", desconto: 0, total: 0, custo: 0, motivo: "",
      consultor_id: deps.quem || null, consultor_nome: deps.nome || "", criado_por: deps.quem || null,
    });
    // itens falharam: desfaz o orçamento recém-criado, para a nova tentativa não gerar um segundo ORC
    if (itens.length && deps.inserirItens) { try { await deps.inserirItens(r.id, itens); } catch (e) { if (deps.apagar) await deps.apagar(r.id).catch(() => {}); throw e; } }
    return { ok: true, id: r.id, numero: r.numero, itens: itens.length };
  }
  if (acao === "acrescentar") {
    if (!uuid(corpo.id)) throw new ErroUso("Orçamento inválido.");
    const o = await deps.ler(String(corpo.id));
    if (!o) throw new ErroUso("Este orçamento não existe mais.");
    if (deps.mecanico && o.consultor_id !== deps.quem && o.criado_por !== deps.quem) throw new ErroUso("Este orçamento não foi aberto por você: peça ao administrador para acrescentar.");
    if (o.situacao !== "elaboracao" && o.situacao !== "enviado") throw new ErroUso("Este orçamento já foi " + (o.situacao === "aprovado" ? "aprovado e virou O.S.: acrescente pela O.S." : "respondido e não aceita mais itens."));
    const acrescimo = [texto, itens.length ? "itens: " + resumoItens(itens) : ""].filter(Boolean).join(" · ");
    const reclamacao = (o.reclamacao || "").trim() + "\n— " + assinatura + ": " + acrescimo;
    if (reclamacao.length > 6000) throw new ErroUso("O pedido deste orçamento já está muito comprido.");
    // orçamento que nasceu no sistema (sem a marca): ao receber acréscimo pelo app ganha a marca, para aparecer no sino do sistema
    const marca = /^Pedido pelo app/.test(o.obs_internas || "") ? {} : { obs_internas: (MARCA_APP + " (acréscimo) — " + assinatura + "\n" + (o.obs_internas || "")).trim() };
    await deps.gravar(o.id, { reclamacao, ...marca, atualizado_em: new Date(deps.agora || Date.now()).toISOString() });
    if (itens.length && deps.inserirItens) await deps.inserirItens(o.id, itens);
    return { ok: true, id: o.id, numero: o.numero, itens: itens.length };
  }
  throw new ErroUso("Ação desconhecida: " + acao);
}

export const atender = withSupabase({ auth: "user" }, async (req, ctx) => {
  if (req.method !== "POST") return json({ erro: "Use POST." }, 405);
  const corpo = await req.json().catch(() => ({})) as Record<string, unknown>;
  try {
    const quem = String((ctx.userClaims && ctx.userClaims.id) || "");
    const m = await ctx.supabase.rpc("e_membro");
    if (m.error) throw new Error("Não deu para conferir o seu login (" + m.error.message + "). Tente de novo.");
    const p = quem ? await ctx.supabase.from("perfis").select("nome,ativo,papel").eq("id", quem).maybeSingle() : { data: null };
    const admin = ctx.supabaseAdmin;
    return json(await executar(corpo, {
      membro: m.data === true && !!(p.data && p.data.ativo !== false), quem, nome: (p.data && p.data.nome) || "", mecanico: !!(p.data && p.data.papel === "mecanico"),
      apagar: async (id) => { await admin.from("orcamentos").delete().eq("id", id); },
      inserir: async (o) => { const r = await admin.from("orcamentos").insert(o).select("id,numero").single(); if (r.error) throw new Error("Não deu para gravar o pedido: " + r.error.message); return r.data as { id: string; numero: number }; },
      ler: async (id) => { const r = await admin.from("orcamentos").select("id,numero,situacao,reclamacao,obs_internas,consultor_id,criado_por").eq("id", id).maybeSingle(); if (r.error) throw new Error(r.error.message); return r.data as Orcamento | null; },
      gravar: async (id, patch) => { const r = await admin.from("orcamentos").update(patch).eq("id", id); if (r.error) throw new Error("Não deu para gravar o acréscimo: " + r.error.message); },
      // itens sem preço, depois dos que já existem (posição), como serviço; o Danilo põe os valores no sistema
      inserirItens: async (orcamentoId, itens) => {
        const u = await admin.from("orcamento_itens").select("posicao").eq("orcamento_id", orcamentoId).order("posicao", { ascending: false }).limit(1);
        const base = u.data && u.data.length ? Number(u.data[0].posicao) + 1 : 0;
        const ab = await admin.from("orcamentos").select("situacao").eq("id", orcamentoId).maybeSingle();
        if (!ab.data || !["elaboracao", "enviado"].includes(ab.data.situacao)) throw new ErroUso("Este orçamento acabou de ser respondido no sistema: os itens não entraram.");
        const r = await admin.from("orcamento_itens").insert(itens.map((i, n) => ({ orcamento_id: orcamentoId, tipo: "servico", descricao: i.descricao, qtd: i.qtd, valor_unit: 0, custo_unit: 0, desconto: 0, posicao: base + n })));
        if (r.error) throw new Error("Não deu para gravar os itens: " + r.error.message);
      },
    }));
  } catch (e) {
    if (e instanceof ErroUso) return json({ ok: false, erro: e.message }, 400);
    console.error("pedido", String((e as Error).message || e).slice(0, 200));   // o detalhe do banco fica só no log
    const msg = String((e as Error).message || "");
    return json({ ok: false, erro: /^(Não deu para|Acesso)/.test(msg) ? msg.replace(/:\s[\s\S]*$/, ".") : "Falha ao gravar o pedido. Tente de novo; se continuar, avise o administrador." }, 200);
  }
});

if (import.meta.main) Deno.serve((req) => atender(req));
