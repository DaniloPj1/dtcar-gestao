// DTCar Gestão — backup de leitura (v35): zip COM SENHA (AES-256) com páginas HTML navegáveis + planilha Excel,
// enviado todo dia às 18h (pg_cron) para os e-mails da oficina. Abre em qualquer computador, sem o sistema no ar.
//
// Por que em 3 passos: a função do Supabase tem 2 s de processamento por chamada (o resto é espera de rede). Medido em
// 05/11/2026 com o volume real (dados falsos): tudo junto dá ~1,7 s — perto demais. Cada passo é uma chamada própria:
//   1. planilha — lê os dados e monta o DTCar-dados.xlsx (pasta privada "backup-leitura/<execução>/")
//   2. paginas  — lê os dados, monta as páginas e fecha o zip com senha (com a planilha dentro, sem comprimir de novo)
//   3. enviar   — manda o zip pelo Hotmail da oficina (Microsoft Graph) e apaga a pasta temporária
// Quem chama os passos é o "início" (agendamento ou botão da tela Backup), em segundo plano, uma chamada para cada passo.
// Anexo: até ~2,9 MB por e-mail (acima de 3 MB a Microsoft exige sessão de upload = permissão Mail.ReadWrite, que não temos).
// Se o zip único passar disso, sai em dois zips (páginas e planilha), um por e-mail; se um deles sozinho passar, dá erro claro.
// Sem a senha (segredo BACKUP_SENHA da função) NADA é enviado: o backup nunca sai sem senha.
// Histórico em backup_execucoes (v35); o aviso de falha é do banco (backup_leitura_vigiar, 18h40 → WhatsApp do Danilo).
import { configure, TextReader, Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from "npm:@zip.js/zip.js@2.24.0";
import type { Db } from "./acoes.ts";

configure({ useWebWorkers: false });

export const PASTA = "backup-leitura";
export const PASSOS = ["planilha", "paginas", "enviar"] as const;
export type Passo = typeof PASSOS[number];
/** limite do anexo por e-mail (Graph: 3 MB sem sessão de upload; o base64 do pedido também conta) */
export const LIMITE_ANEXO = 2_900_000;
export const DESTINOS_PADRAO = ["centroautomotivodtcar@hotmail.com", "danilo.pj1@hotmail.com"];
const EMAIL_OK = /^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$/;

export interface Gerador {
  TABELAS_LEITURA: string[];
  montarPaginas: (bk: unknown) => { arquivos: Array<[string, string]>; resumo: Record<string, number> };
  montarPlanilha: (bk: unknown) => Array<[string, string]>;
  pastaRaiz: (gerado: string) => string;
}
export interface DepsBackup {
  adm: Db;
  env: (k: string) => string | undefined;
  gerador: () => Promise<Gerador>;
  /** manda o e-mail com os anexos (na função: Microsoft Graph com a chave guardada) */
  enviarEmail: (m: { para: string[]; assunto: string; texto: string; anexos: Array<{ nome: string; bytes: Uint8Array }> }) => Promise<void>;
  /** chama um passo numa chamada nova da função (no teste: direto) */
  chamarPasso: (exec: number, passo: Passo) => Promise<void>;
  agora?: () => Date;
  /** limite do anexo por e-mail (troca no teste) */
  limiteAnexo?: number;
}

export class ErroBackup extends Error {}

const agoraDe = (d: DepsBackup) => (d.agora || (() => new Date()))();
const fmtMB = (n: number) => (n / 1048576).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + " MB";
const dataBR = (d: Date) => new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" }).format(d);

/** Configuração na tela (config.dados.backupLeitura): ligado e para quem vai */
export async function configBackup(adm: Db): Promise<{ ativo: boolean; emails: string[] }> {
  const { data } = await adm.from("config").select("dados").eq("id", 1).maybeSingle();
  const b = (data && data.dados && data.dados.backupLeitura) || {};
  const emails = (Array.isArray(b.emails) ? b.emails : DESTINOS_PADRAO).map((e: unknown) => String(e || "").trim().toLowerCase()).filter((e: string) => EMAIL_OK.test(e)).slice(0, 3);
  return { ativo: b.ativo !== false, emails: emails.length ? emails : DESTINOS_PADRAO };
}
export function senhaDoBackup(env: (k: string) => string | undefined): string {
  const s = (env("BACKUP_SENHA") || "").trim();
  if (s.length < 10) throw new ErroBackup("Falta cadastrar a senha do backup: segredo BACKUP_SENHA da função \"email\" (Supabase › Edge Functions › Secrets), com 10 letras ou mais. Sem ela nada é enviado.");
  return s;
}

/** Todas as linhas de uma tabela (de 1000 em 1000, ordem fixa para não pular nem repetir) */
async function tabelaInteira(adm: Db, t: string): Promise<unknown[]> {
  const out: unknown[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await adm.from(t).select("*").order("id").range(de, de + 999);
    if (error) throw new Error(t + ": " + error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) return out;
  }
}
export async function lerDados(adm: Db, tabelas: string[], agora: Date) {
  const lidas = await Promise.all(tabelas.map((t) => tabelaInteira(adm, t)));
  const { data } = await adm.from("config").select("dados").eq("id", 1).maybeSingle();
  return { sistema: "dtcar-gestao", gerado_em: agora.toISOString(), config: (data && data.dados) || {}, tabelas: Object.fromEntries(tabelas.map((t, i) => [t, lidas[i]])) };
}

/** Zip com (ou sem) senha AES-256. nivel 0 = só guarda (para o .xlsx, que já vem comprimido) */
export async function zipar(arquivos: Array<[string, string | Uint8Array, number?]>, senha?: string): Promise<Uint8Array> {
  const w = new ZipWriter(new Uint8ArrayWriter(), senha ? { password: senha, encryptionStrength: 3 } : {});
  for (const [nome, c, nivel] of arquivos) {
    await w.add(nome, typeof c === "string" ? new TextReader(c) : new Uint8ArrayReader(c), { level: nivel ?? 6 });
  }
  return await w.close();
}

async function atualizar(adm: Db, exec: number, campos: Record<string, unknown>) {
  const { error } = await adm.from("backup_execucoes").update(campos).eq("id", exec);
  if (error) throw new Error("backup_execucoes: " + error.message);
}
async function lerExec(adm: Db, exec: number) {
  const { data, error } = await adm.from("backup_execucoes").select("*").eq("id", exec).maybeSingle();
  if (error) throw new Error(/does not exist|schema cache|relation/i.test(error.message) ? "Falta rodar o supabase/v35.sql no Supabase." : error.message);
  if (!data) throw new ErroBackup("Execução do backup não encontrada.");
  return data;
}
async function guardar(adm: Db, caminho: string, bytes: Uint8Array, tipo: string) {
  const { error } = await adm.storage.from(PASTA).upload(caminho, new Blob([bytes], { type: tipo }), { upsert: true, contentType: tipo });
  if (error) throw new Error("Pasta do backup: " + error.message);
}
async function baixar(adm: Db, caminho: string): Promise<Uint8Array> {
  const { data, error } = await adm.storage.from(PASTA).download(caminho);
  if (error || !data) throw new Error("Pasta do backup (" + caminho + "): " + (error ? error.message : "vazio"));
  return new Uint8Array(await data.arrayBuffer());
}
async function limparPasta(adm: Db, prefixo: string) {
  const { data } = await adm.storage.from(PASTA).list(prefixo, { limit: 100 });
  const nomes = (data || []).map((f: { name: string }) => prefixo + "/" + f.name);
  if (nomes.length) await adm.storage.from(PASTA).remove(nomes);
}

/**
 * Começa um backup (agendamento ou botão). Devolve o número da execução; os passos rodam em seguida (`rodar`).
 * Não começa outro se já houver um rodando há menos de 10 minutos.
 */
export async function iniciar(d: DepsBackup, origem: "agendamento" | "tela", pedidoPor = ""): Promise<{ exec: number; ja_rodando?: boolean }> {
  const agora = agoraDe(d);
  const cfg = await configBackup(d.adm);
  if (!cfg.ativo && origem === "agendamento") throw new ErroBackup("Backup de leitura desligado na tela Backup.");
  senhaDoBackup(d.env); // sem senha nem começa
  const { data: rodando, error: e1 } = await d.adm.from("backup_execucoes").select("id, iniciado_em").eq("situacao", "rodando").order("id", { ascending: false }).limit(1);
  if (e1) throw new Error(/does not exist|schema cache|relation/i.test(e1.message) ? "Falta rodar o supabase/v35.sql no Supabase." : e1.message);
  if (rodando && rodando[0] && agora.getTime() - new Date(rodando[0].iniciado_em).getTime() < 600000) return { exec: rodando[0].id, ja_rodando: true };
  if (rodando && rodando[0]) await atualizar(d.adm, rodando[0].id, { situacao: "erro", erro: "Parou no meio (passou de 10 minutos).", terminado_em: agora.toISOString() });
  const { data, error } = await d.adm.from("backup_execucoes").insert({ origem, pedido_por: pedidoPor.slice(0, 120), situacao: "rodando", passo: "inicio", para: cfg.emails }).select("id").single();
  if (error) throw new Error("backup_execucoes: " + error.message);
  return { exec: data.id as number };
}

/** Roda os 3 passos em sequência (cada um numa chamada nova). Erro em qualquer um encerra a execução com o motivo. */
export async function rodar(d: DepsBackup, exec: number): Promise<void> {
  for (const p of PASSOS) {
    try {
      await d.chamarPasso(exec, p);
      const e = await lerExec(d.adm, exec);
      if (e.situacao === "erro") return;
      if (p !== "enviar" && e.passo !== p) throw new Error(`O passo "${p}" não terminou.`);
    } catch (e) {
      // o passo já gravou o motivo quando falhou lá dentro; aqui só o que não chegou a ser gravado (rede, função fora do ar)
      const atual = await lerExec(d.adm, exec).catch(() => null);
      if (!atual || atual.situacao === "rodando") await atualizar(d.adm, exec, { situacao: "erro", erro: `${p}: ${String((e as Error).message || e).slice(0, 480)}`, terminado_em: agoraDe(d).toISOString() }).catch(() => {});
      return;
    }
  }
}

/** Um passo, na chamada própria. Grava o andamento (tempo e tamanho) em backup_execucoes. */
export async function passo(d: DepsBackup, exec: number, p: Passo): Promise<Record<string, unknown>> {
  const e = await lerExec(d.adm, exec);
  if (e.situacao !== "rodando") throw new ErroBackup("Esta execução do backup já terminou.");
  const ordem = ["inicio", ...PASSOS];
  if (ordem.indexOf(e.passo) !== ordem.indexOf(p) - 1) throw new ErroBackup(`Fora de ordem: o passo "${p}" vem depois de "${ordem[ordem.indexOf(p) - 1]}".`);
  const t0 = performance.now(), det = { ...(e.detalhe || {}) } as Record<string, unknown>;
  const pasta = String(exec);
  try {
    if (p === "planilha") {
      const g = await d.gerador();
      const bk = await lerDados(d.adm, g.TABELAS_LEITURA, agoraDe(d));
      await atualizar(d.adm, exec, { gerado_em: bk.gerado_em });
      const xlsx = await zipar(g.montarPlanilha(bk));
      await guardar(d.adm, pasta + "/planilha.xlsx", xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      det.planilha_bytes = xlsx.length;
      det.registros = Object.fromEntries(Object.entries(bk.tabelas).map(([t, l]) => [t, (l as unknown[]).length]));
    } else if (p === "paginas") {
      const senha = senhaDoBackup(d.env), g = await d.gerador();
      const bk = await lerDados(d.adm, g.TABELAS_LEITURA, e.gerado_em ? new Date(e.gerado_em) : agoraDe(d));
      const { arquivos, resumo } = g.montarPaginas(bk), raiz = g.pastaRaiz(bk.gerado_em) + "/";
      const xlsx = await baixar(d.adm, pasta + "/planilha.xlsx");
      const lista: Array<[string, string | Uint8Array, number?]> = arquivos.map(([n, c]) => [raiz + n, c]);
      const unico = await zipar([...lista, [raiz + "Planilha/DTCar-dados.xlsx", xlsx, 0]], senha);
      const limite = d.limiteAnexo ?? LIMITE_ANEXO;
      if (unico.length <= limite) {
        await guardar(d.adm, pasta + "/1.zip", unico, "application/zip");
        det.zips = [{ nome: g.pastaRaiz(bk.gerado_em) + ".zip", bytes: unico.length }];
      } else {
        // grande demais para um e-mail: páginas num zip e planilha em outro (os dois com senha)
        const paginas = await zipar(lista, senha), planilha = await zipar([[raiz + "Planilha/DTCar-dados.xlsx", xlsx, 0]], senha);
        const zips = [[g.pastaRaiz(bk.gerado_em) + "-paginas.zip", paginas], [g.pastaRaiz(bk.gerado_em) + "-planilha.zip", planilha]] as const;
        for (const [nome, b] of zips) if (b.length > limite) throw new ErroBackup(`O arquivo ${nome} ficou com ${fmtMB(b.length)}, acima do limite do anexo de e-mail (2,9 MB). Precisa do envio em partes (permissão nova no Hotmail).`);
        for (let i = 0; i < zips.length; i++) await guardar(d.adm, `${pasta}/${i + 1}.zip`, zips[i][1], "application/zip");
        det.zips = zips.map(([nome, b]) => ({ nome, bytes: b.length }));
      }
      det.resumo = resumo;
    } else {
      const cfg = await configBackup(d.adm), zips = (det.zips || []) as Array<{ nome: string; bytes: number }>;
      if (!zips.length) throw new Error("Nada para enviar (o passo das páginas não guardou o zip).");
      const r = (det.resumo || {}) as Record<string, number>, quando = dataBR(e.gerado_em ? new Date(e.gerado_em) : agoraDe(d));
      for (let i = 0; i < zips.length; i++) {
        const bytes = await baixar(d.adm, `${pasta}/${i + 1}.zip`), parte = zips.length > 1 ? ` (${i + 1} de ${zips.length})` : "";
        await d.enviarEmail({ para: cfg.emails, assunto: `Backup de leitura DTCar Gestão — ${quando}${parte}`, anexos: [{ nome: zips[i].nome, bytes }], texto: [
          `Backup de leitura do DTCar Gestão de ${quando}${parte}.`, "",
          `Conteúdo: ${r.os ?? "?"} O.S. (${r.os_abertas ?? "?"} em aberto), ${r.clientes ?? "?"} clientes, ${r.veiculos ?? "?"} veículos, ${r.produtos ?? "?"} produtos e serviços, recibos, contas a receber e a pagar e vendas de balcão.`,
          "", "Como abrir: extraia com o 7-Zip (pede a senha do backup) e abra o arquivo ABRIR-AQUI.html no navegador. Funciona sem internet.",
          "A planilha com todos os dados está em Planilha/DTCar-dados.xlsx.", "",
          "Esta cópia é só para leitura: para restaurar dados no sistema, use o backup .json.gz (Sistema › Backup).",
          "Tem dados de clientes (LGPD): não encaminhe e não compartilhe a senha.", "", "— Mensagem automática do DTCar Gestão (todo dia às 18h)."].join("\n") });
      }
      await limparPasta(d.adm, pasta).catch(() => {});
      det.enviado_para = cfg.emails;
    }
    const ms = Math.round(performance.now() - t0);
    det.ms = { ...((det.ms || {}) as object), [p]: ms };
    await atualizar(d.adm, exec, { passo: p, detalhe: det, ...(p === "enviar" ? { situacao: "ok", terminado_em: agoraDe(d).toISOString() } : {}) });
    return { ok: true, passo: p, ms };
  } catch (err) {
    await atualizar(d.adm, exec, { situacao: "erro", erro: `${p}: ${String((err as Error).message || err).slice(0, 480)}`, terminado_em: agoraDe(d).toISOString(), detalhe: det }).catch(() => {});
    if (p !== "planilha") await limparPasta(d.adm, pasta).catch(() => {});
    throw err;
  }
}

/** Apaga sobras de execuções antigas na pasta temporária (falha no meio). */
export async function limparSobras(d: DepsBackup) {
  const { data } = await d.adm.storage.from(PASTA).list("", { limit: 100 });
  const { data: rodando } = await d.adm.from("backup_execucoes").select("id").eq("situacao", "rodando");
  const vivos = new Set((rodando || []).map((r: { id: number }) => String(r.id)));
  for (const f of (data || []) as Array<{ name: string }>) if (!vivos.has(f.name)) await limparPasta(d.adm, f.name).catch(() => {});
}

/** Situação para a tela Backup (só administrador) */
export async function situacaoBackup(adm: Db, env: (k: string) => string | undefined) {
  const { data, error } = await adm.from("backup_execucoes").select("id, iniciado_em, terminado_em, origem, pedido_por, situacao, passo, erro, para, detalhe").order("id", { ascending: false }).limit(10);
  if (error) throw new Error(/does not exist|schema cache|relation/i.test(error.message) ? "Falta rodar o supabase/v35.sql no Supabase." : error.message);
  let senha = true; try { senhaDoBackup(env); } catch (_) { senha = false; }
  return { execucoes: data || [], senha_cadastrada: senha, config: await configBackup(adm), horario: "todo dia às 18h" };
}
