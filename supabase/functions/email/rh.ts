// DTCar Gestão — Documentos do RH: traz para a pasta "rh" os PDFs que a contabilidade manda por e-mail
// (recibos, pró-labore, folha de ponto, DARF, FGTS, laudos). Chamada pela tela Financeiro › Documentos do RH.
// Só copia: o e-mail fica como está no Hotmail. Nunca importa o mesmo anexo duas vezes (email_id + anexo_id).
// Valor, vencimento e linha digitável das guias são lidos pela tela (no navegador), não aqui: o Supabase limita
// o processamento de cada chamada e ler vários PDFs de uma vez passaria do limite.
// 09/11/2026 (o e-mail da Loredo de 04/11 não entrou): os mais NOVOS entram primeiro; um anexo que falha não trava os
// outros (vai em "erros" e a tela mostra); sem remetentes na chamada, vale cfg.rh.remetentes (o conector chama assim);
// a resposta diz quantos e-mails da contabilidade foram achados e o mais recente, para conferir.
// rh_listar e rh_abrir: o conector (login do Danilo, administrador) lista e lê os documentos — pedido dele em 09/11/2026.
import { graph } from "./microsoft.ts";
import { normalizar } from "./filtro.ts";
import type { Db } from "./acoes.ts";

export type TipoRH = "recibo" | "adiantamento" | "pro_labore" | "folha_ponto" | "darf" | "fgts" | "das" | "inss" | "laudo" | "epi" | "outro";

/** Tipo do documento pelo nome do arquivo (e, se não der, pelo assunto do e-mail). */
export function tipoRH(nome: string, assunto = ""): TipoRH {
  const teste = (t: string): TipoRH | null => {
    const n = normalizar(t).replace(/[_.-]+/g, " ");
    if (/\badiantamento\b/.test(n)) return "adiantamento";
    if (/\bpro ?labore\b|\bprolabore\b/.test(n)) return "pro_labore";
    if (/\bfolha (de )?ponto\b|\bponto\b/.test(n)) return "folha_ponto";
    if (/\bdarf\b/.test(n)) return "darf";
    if (/\bfgts\b|\bgrf\b|\bgfd\b/.test(n)) return "fgts";
    if (/\bdas\b|\bpgdas\b|simples nacional/.test(n)) return "das";
    if (/\binss\b|\bgps\b/.test(n)) return "inss";
    if (/\blaudo|\bpgr\b|\bpcmso\b|\bltcat\b/.test(n)) return "laudo";
    if (/\bepi\b/.test(n)) return "epi";
    if (/\brecibo|\bholerite|\bcontracheque/.test(n)) return "recibo";
    return null;
  };
  return teste(nome) || teste(assunto) || "outro";
}

/** Competência (AAAA-MM): "10.2026", "10-2026", "10/2026" ou "102026" no nome; senão no assunto; senão o mês do e-mail. */
export function competenciaRH(nome: string, assunto: string, dataEmail: string): string {
  const achar = (t: string) => {
    const m = String(t).match(/(?:^|[^\d])(0[1-9]|1[0-2])[.\/_ -]?(20\d{2})(?!\d)/);
    return m ? `${m[2]}-${m[1]}` : null;
  };
  return achar(nome) || achar(assunto) || String(dataEmail || new Date().toISOString()).slice(0, 7);
}

export const ehArquivoRH = (nome: string, tipo: string) => /\.(pdf|jpe?g|png|webp)$/i.test(nome) || /^application\/pdf$|^image\/(jpeg|png|webp)$/i.test(tipo);
const tipoDoArquivo = (nome: string, tipo: string) =>
  /\.pdf$/i.test(nome) ? "application/pdf" : /\.png$/i.test(nome) ? "image/png" : /\.webp$/i.test(nome) ? "image/webp" : /\.jpe?g$/i.test(nome) ? "image/jpeg" : (tipo || "application/pdf");
const nomeSeguro = (n: string) => normalizar(n).replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "arquivo.pdf";
const decodificar = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const EMAIL_OK = /^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$/;

/** pular: anexos ("email_id|anexo_id") que já deram erro nesta busca — ficam de fora para o lote avançar (tentados de novo na próxima busca) */
export interface ImportarRH { remetentes?: unknown; dias?: number; maximo?: number; pular?: unknown }
export const REMETENTES_PADRAO = ["dploredocontabilidade@gmail.com"];

/** Remetentes da contabilidade gravados na tela (cfg.rh.remetentes); sem nada gravado, o padrão. */
async function remetentesDaConfig(adm: Db): Promise<unknown[]> {
  try {
    const { data } = await adm.from("config").select("dados").eq("id", 1).maybeSingle();
    const r = data && data.dados && data.dados.rh && data.dados.rh.remetentes;
    return Array.isArray(r) && r.length ? r : REMETENTES_PADRAO;
  } catch (_) { return REMETENTES_PADRAO; }
}

/** Importa até `maximo` anexos novos por chamada (a tela chama de novo enquanto houver `restam`). */
export async function importarRH(adm: Db, token: string, p: ImportarRH, agora = new Date()) {
  const lidos = p.remetentes === undefined || p.remetentes === null ? await remetentesDaConfig(adm) : p.remetentes;
  const rem = (Array.isArray(lidos) ? lidos : []).map((x) => String(x).trim().toLowerCase()).filter((x) => EMAIL_OK.test(x)).slice(0, 10);
  if (!rem.length) return { importados: 0, restam: 0, aviso: "Nenhum e-mail da contabilidade informado." };
  const dias = Math.min(400, Math.max(7, Number(p.dias) || 120));
  const maximo = Math.min(12, Math.max(1, Number(p.maximo) || 8));
  const desde = new Date(agora.getTime() - dias * 86400000);
  // anexos já importados
  const { data: ja, error: eJa } = await adm.from("rh_documentos").select("email_id, anexo_id").gte("email_data", desde.toISOString());
  if (eJa) throw new Error(/does not exist|schema cache|relation/i.test(eJa.message) ? "Falta rodar o supabase/v30.sql no Supabase." : eJa.message);
  const feitos = new Set((ja || []).map((r: { email_id: string; anexo_id: string }) => r.email_id + "|" + r.anexo_id));
  const pular = new Set((Array.isArray(p.pular) ? p.pular : []).map(String).slice(0, 500));

  // lista os e-mails da contabilidade com anexo (todas as pastas, menos lixo e excluídos)
  // deno-lint-ignore no-explicit-any
  const pendentes: Array<{ m: any; a: any }> = [];
  let achados = 0, maisRecente = "";
  for (const r of rem) {
    const q = new URLSearchParams({ $search: `"from:${r}"`, $select: "id,subject,from,receivedDateTime,hasAttachments,parentFolderId", $top: "50" });
    let url = "/me/messages?" + q.toString();
    for (let pag = 0; pag < 4 && url; pag++) {
      const j = await graph(token, url);
      for (const m of j.value || []) {
        if (new Date(m.receivedDateTime).getTime() < desde.getTime()) continue;
        if (String(m.from?.emailAddress?.address || "").toLowerCase() !== r) continue; // a busca da Microsoft é aproximada
        achados++; // e-mails da contabilidade no período (com ou sem anexo): para conferir se a busca da Microsoft achou
        if (String(m.receivedDateTime) > maisRecente) maisRecente = String(m.receivedDateTime);
        if (!m.hasAttachments) continue;
        const an = await graph(token, `/me/messages/${encodeURIComponent(m.id)}/attachments?$select=id,name,contentType,size,isInline`);
        for (const a of an.value || []) {
          if (a.isInline || a["@odata.type"] !== "#microsoft.graph.fileAttachment" || !ehArquivoRH(a.name || "", a.contentType || "")) continue;
          if ((a.size || 0) > 15 * 1024 * 1024 || feitos.has(m.id + "|" + a.id) || pular.has(m.id + "|" + a.id)) continue;
          pendentes.push({ m, a });
        }
      }
      url = j["@odata.nextLink"] || "";
    }
  }
  // mais NOVOS primeiro: o documento que acabou de chegar entra na hora, mesmo com anexo antigo dando erro
  pendentes.sort((x, y) => String(y.m.receivedDateTime).localeCompare(String(x.m.receivedDateTime)));

  const lote = pendentes.slice(0, maximo);
  const novos: Array<Record<string, unknown>> = [];
  const erros: Array<{ arquivo: string; email: string; erro: string; chave: string }> = [];
  for (const { m, a } of lote) {
    // cada anexo por si: um que falha vai para "erros" e não impede os outros
    try {
      const arq = await graph(token, `/me/messages/${encodeURIComponent(m.id)}/attachments/${encodeURIComponent(a.id)}`);
      if (!arq.contentBytes) throw new Error("a Microsoft não devolveu o conteúdo do arquivo");
      const comp = competenciaRH(a.name || "", m.subject || "", m.receivedDateTime);
      const tipoArq = tipoDoArquivo(a.name || "", a.contentType || "");
      const caminho = `${comp}/${crypto.randomUUID()}-${nomeSeguro(a.name || "arquivo.pdf")}`;
      const up = await adm.storage.from("rh").upload(caminho, decodificar(arq.contentBytes), { contentType: tipoArq, upsert: false });
      if (up.error) throw new Error("não foi possível guardar o arquivo: " + up.error.message);
      const linha = {
        competencia: comp, tipo: tipoRH(a.name || "", m.subject || ""), titulo: String(a.name || "").replace(/\.[a-z0-9]+$/i, ""),
        arquivo: caminho, nome_arquivo: a.name || "", tipo_arquivo: tipoArq, tamanho: a.size || 0, origem: "email",
        email_id: m.id, anexo_id: a.id, email_de: String(m.from?.emailAddress?.address || "").toLowerCase(), email_assunto: m.subject || "",
        email_data: m.receivedDateTime, criado_por: "Importado do e-mail",
      };
      const { data: ins, error } = await adm.from("rh_documentos").insert(linha).select("id, competencia, tipo, titulo");
      if (error) {
        await adm.storage.from("rh").remove([caminho]); // não deixa arquivo sem registro
        if (/duplicate|unique/i.test(error.message)) continue; // outra chamada importou ao mesmo tempo
        throw new Error(/does not exist|schema cache|relation/i.test(error.message) ? "Falta rodar o supabase/v30.sql no Supabase." : error.message);
      }
      novos.push((ins || [])[0] || linha);
    } catch (e) {
      erros.push({ arquivo: String(a.name || ""), email: String(m.subject || ""), erro: (e as Error).message, chave: m.id + "|" + a.id });
    }
  }
  const restam = Math.max(0, pendentes.length - lote.length);
  return { importados: novos.length, novos, restam, ...(erros.length ? { erros } : {}), remetentes: rem,
    emails_achados: achados, email_mais_recente: maisRecente || null, lidos_desde: desde.toISOString().slice(0, 10) };
}

/** rh_listar (conector): documentos do RH guardados, mais novos primeiro. Filtros: competencia (AAAA-MM), tipo, texto. */
export async function listarRH(adm: Db, p: { competencia?: unknown; tipo?: unknown; texto?: unknown; limite?: unknown }) {
  const limite = Math.min(200, Math.max(1, Number(p.limite) || 50));
  let q = adm.from("rh_documentos").select("id, competencia, tipo, titulo, nome_arquivo, tipo_arquivo, tamanho, valor, vencimento, linha_digitavel, origem, email_assunto, email_data, obs, criado_em");
  const comp = String(p.competencia || "").trim();
  if (comp) { if (!/^\d{4}-\d{2}$/.test(comp)) throw new Error("Mês no formato AAAA-MM (ex.: 2026-10)."); q = q.eq("competencia", comp); }
  const tipo = String(p.tipo || "").trim();
  if (tipo) q = q.eq("tipo", tipo);
  // lê tudo (páginas de 1000) antes de filtrar o texto e contar: busca por nome de documento antigo também acha
  q = q.order("competencia", { ascending: false }).order("criado_em", { ascending: false });
  // deno-lint-ignore no-explicit-any
  const data: any[] = [];
  for (let de = 0; de < 20000; de += 1000) {
    const { data: pag, error } = await q.range(de, de + 999);
    if (error) throw new Error(/does not exist|schema cache|relation/i.test(error.message) ? "Falta rodar o supabase/v30.sql no Supabase." : error.message);
    data.push(...(pag || []));
    if (!pag || pag.length < 1000) break;
  }
  const t = normalizar(String(p.texto || ""));
  // deno-lint-ignore no-explicit-any
  const todos = (data || []).filter((d: any) => !t || normalizar([d.titulo, d.nome_arquivo, d.email_assunto, d.obs].join(" ")).includes(t));
  // deno-lint-ignore no-explicit-any
  const docs = todos.slice(0, limite).map((d: any) => ({ ...d, linha_digitavel: d.linha_digitavel === "-" ? "" : d.linha_digitavel,
    tamanho_kb: Math.round((d.tamanho || 0) / 1024), tamanho: undefined }));
  const meses: Record<string, number> = {};
  // deno-lint-ignore no-explicit-any
  for (const d of todos) meses[(d as any).competencia] = (meses[(d as any).competencia] || 0) + 1;
  return { total: todos.length, mostrando: docs.length, por_mes: meses, documentos: docs };
}
