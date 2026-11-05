// DTCar Gestão — backup de leitura (v35): zip COM SENHA (AES-256) com páginas HTML navegáveis + planilha Excel,
// enviado todo dia às 18h (pg_cron) para os e-mails da oficina. Abre em qualquer computador, sem o sistema no ar.
//
// Por que em 3 passos: a função do Supabase tem 2 s de processamento por chamada (o resto é espera de rede). Medido em
// 05/11/2026 com o volume real (dados falsos): tudo junto dá ~1,7 s — perto demais. Cada passo é uma chamada própria:
//   1. planilha — lê os dados e monta o DTCar-dados.xlsx (pasta privada "backup-leitura/<execução>/")
//   2. paginas  — lê os dados, monta as páginas e fecha o zip com senha (com a planilha dentro, sem comprimir de novo)
//   3. enviar   — manda o zip pelo Hotmail da oficina (Microsoft Graph) e apaga a pasta temporária
// Encadeados: o início (agendamento ou botão da tela Backup) chama o 1º passo; cada passo responde na hora (202), trabalha em
// segundo plano e, no fim, chama o seguinte. Assim nenhuma chamada espera as outras (limite de 150 s de duração por chamada).
// Anexo: até 2,7 MB por e-mail (acima de 3 MB a Microsoft exige sessão de upload = permissão Mail.ReadWrite, que não temos;
// o pedido vai em base64, +33%, e tem limite de ~4 MB). Se o zip único passar, o passo das páginas roda de novo noutra chamada
// e faz dois zips (páginas e planilha), um por e-mail — cada chamada fecha um zip grande só; se um deles sozinho passar, erro claro.
// Nomes dos arquivos dentro do zip não levam cliente nem placa: o zip com senha cifra o conteúdo, mas a lista de nomes fica aberta.
// Sem a senha (segredo BACKUP_SENHA da função) NADA é enviado: o backup nunca sai sem senha.
// Histórico em backup_execucoes (v35); o aviso de falha é do banco (backup_leitura_vigiar, 18h40 → WhatsApp do Danilo).
import { configure, TextReader, Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from "npm:@zip.js/zip.js@2.24.0";
import type { Db } from "./acoes.ts";

configure({ useWebWorkers: false });

export const PASTA = "backup-leitura";
export const PASSOS = ["planilha", "paginas", "enviar"] as const;
export type Passo = typeof PASSOS[number];
/** limite do anexo por e-mail (Graph: 3 MB sem sessão de upload; o base64 do pedido também conta) */
export const LIMITE_ANEXO = 2_700_000;
/** sem nada configurado: só o e-mail da oficina (o v35 já grava também o e-mail de login do administrador) */
export const DESTINOS_PADRAO = ["centroautomotivodtcar@hotmail.com"];
/** senha mínima: o zip AES deriva a chave com só 1000 voltas (PBKDF2-SHA1), então senha curta cai em força bruta */
export const SENHA_MINIMA = 16;
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
  /** chama um passo numa chamada nova da função, que responde na hora e trabalha em segundo plano (no teste: direto, até o fim) */
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
  if (s.length < SENHA_MINIMA) throw new ErroBackup(`Falta cadastrar a senha do backup: segredo BACKUP_SENHA da função "email" (Supabase › Edge Functions › Secrets), com ${SENHA_MINIMA} letras ou mais (use uma senha aleatória). Sem ela nada é enviado.`);
  return s;
}

/** Todas as linhas de uma tabela, em páginas pelo id (continua de onde parou: não pula nem repete se alguém gravar no meio,
 *  e não corta a tabela se o servidor devolver menos de 1000 por página). Para só com a página vazia. */
async function tabelaInteira(adm: Db, t: string): Promise<unknown[]> {
  const out: Array<{ id: string }> = [];
  for (let volta = 0; volta < 1000; volta++) {
    let q = adm.from(t).select("*").order("id");
    if (out.length) q = q.gt("id", out[out.length - 1].id);
    const { data, error } = await q.limit(1000);
    if (error) throw new Error(t + ": " + error.message);
    if (!data || !data.length) return out;
    out.push(...data);
  }
  throw new Error(t + ": tabela grande demais para o backup de leitura.");
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
  const { error } = await adm.storage.from(PASTA).upload(caminho, new Blob([bytes as BlobPart], { type: tipo }), { upsert: true, contentType: tipo });
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
  if (error) {
    // o agendamento e o botão ao mesmo tempo: o índice único do v35 deixa só um "rodando"; o outro vira "já rodando"
    if (error.code === "23505" || /backup_execucoes_uma_rodando|duplicate key/i.test(error.message)) {
      const { data: r2 } = await d.adm.from("backup_execucoes").select("id").eq("situacao", "rodando").limit(1);
      if (r2 && r2[0]) return { exec: r2[0].id as number, ja_rodando: true };
    }
    throw new Error("backup_execucoes: " + error.message);
  }
  return { exec: data.id as number };
}

/** Começa a corrente de passos (chama o 1º; cada passo chama o seguinte). Falha ao chamar fica registrada. */
export async function rodar(d: DepsBackup, exec: number): Promise<void> {
  try { await d.chamarPasso(exec, PASSOS[0]); }
  catch (e) { await falhou(d, exec, PASSOS[0], "não foi possível começar: " + String((e as Error).message || e)); }
}
async function falhou(d: DepsBackup, exec: number, p: string, msg: string) {
  const atual = await lerExec(d.adm, exec).catch(() => null);
  // o passo já grava o próprio motivo; aqui só o que não chegou a ser gravado (rede, função fora do ar)
  if (!atual || atual.situacao === "rodando") await atualizar(d.adm, exec, { situacao: "erro", erro: `${p}: ${msg.slice(0, 480)}`, terminado_em: agoraDe(d).toISOString() }).catch(() => {});
}

/** Roda um passo e chama o próximo (ou o mesmo de novo, quando o zip precisa ser dividido). Usado na chamada de cada passo. */
export async function executarEEncadear(d: DepsBackup, exec: number, p: Passo): Promise<void> {
  let r: Record<string, unknown>;
  try { r = await passo(d, exec, p); } catch (_) { return; } // passo() já gravou o motivo
  const prox = r.repetir ? p : PASSOS[PASSOS.indexOf(p) + 1];
  if (!prox) return;
  try { await d.chamarPasso(exec, prox); }
  catch (e) { await falhou(d, exec, prox, "não foi possível chamar este passo: " + String((e as Error).message || e)); }
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
      const limite = d.limiteAnexo ?? LIMITE_ANEXO, base = g.pastaRaiz(bk.gerado_em);
      if (!det.dividir) {
        const unico = await zipar([...lista, [raiz + "Planilha/DTCar-dados.xlsx", xlsx, 0]], senha);
        if (unico.length > limite) {
          // grande demais para um e-mail: divide noutra chamada (cada chamada fecha um zip grande só, pelo limite de processamento)
          det.dividir = true; det.unico_bytes = unico.length;
          await atualizar(d.adm, exec, { detalhe: det });
          return { ok: true, passo: p, repetir: true };
        }
        await guardar(d.adm, pasta + "/1.zip", unico, "application/zip");
        det.zips = [{ nome: base + ".zip", bytes: unico.length }];
      } else {
        // páginas num zip e planilha em outro (os dois com senha); a planilha só é guardada, sem comprimir de novo
        const paginas = await zipar(lista, senha), planilha = await zipar([[raiz + "Planilha/DTCar-dados.xlsx", xlsx, 0]], senha);
        const zips = [[base + "-paginas.zip", paginas], [base + "-planilha.zip", planilha]] as const;
        for (const [nome, b] of zips) if (b.length > limite) throw new ErroBackup(`O arquivo ${nome} ficou com ${fmtMB(b.length)}, acima do limite do anexo de e-mail (${fmtMB(limite)}). Precisa do envio em partes (permissão nova no Hotmail).`);
        for (let i = 0; i < zips.length; i++) await guardar(d.adm, `${pasta}/${i + 1}.zip`, zips[i][1], "application/zip");
        det.zips = zips.map(([nome, b]) => ({ nome, bytes: b.length }));
      }
      det.resumo = resumo;
    } else {
      const cfg = await configBackup(d.adm), zips = (det.zips || []) as Array<{ nome: string; bytes: number }>;
      if (!zips.length) throw new Error("Nada para enviar (o passo das páginas não guardou o zip).");
      const r = (det.resumo || {}) as Record<string, number>, quando = dataBR(e.gerado_em ? new Date(e.gerado_em) : agoraDe(d));
      for (let i = Number(det.enviados || 0); i < zips.length; i++) {
        const bytes = await baixar(d.adm, `${pasta}/${i + 1}.zip`), parte = zips.length > 1 ? ` (${i + 1} de ${zips.length})` : "";
        await d.enviarEmail({ para: cfg.emails, assunto: `Backup de leitura DTCar Gestão — ${quando}${parte}`, anexos: [{ nome: zips[i].nome, bytes }], texto: [
          `Backup de leitura do DTCar Gestão de ${quando}${parte}.`, "",
          `Conteúdo: ${r.os ?? "?"} O.S. (${r.os_abertas ?? "?"} em aberto), ${r.clientes ?? "?"} clientes, ${r.veiculos ?? "?"} veículos, ${r.produtos ?? "?"} produtos e serviços, recibos, contas a receber e a pagar e vendas de balcão.`,
          "", "Como abrir: extraia com o 7-Zip (pede a senha do backup) e abra o arquivo ABRIR-AQUI.html no navegador. Funciona sem internet.",
          "A planilha com todos os dados está em Planilha/DTCar-dados.xlsx.", "",
          "Esta cópia é só para leitura: para restaurar dados no sistema, use o backup .json.gz (Sistema › Backup).",
          "Tem dados de clientes (LGPD): não encaminhe e não compartilhe a senha.", "", "— Mensagem automática do DTCar Gestão (todo dia às 18h)."].join("\n") })
          .catch((err) => { throw new Error((i > 0 ? `enviou ${i} de ${zips.length} e-mails; o ${i + 1}º falhou: ` : "") + ((err as Error).message || err)); });
        det.enviados = i + 1;
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
export async function situacaoBackup(adm: Db, env: (k: string) => string | undefined, agora = new Date()) {
  // execução que ficou "rodando" mais de 10 minutos (chamada encerrada sem gravar o erro) vira falha: libera o "Gerar e enviar agora"
  const { error: e0 } = await adm.from("backup_execucoes").update({ situacao: "erro", erro: "Parou no meio (passou de 10 minutos).", terminado_em: agora.toISOString() })
    .eq("situacao", "rodando").lt("iniciado_em", new Date(agora.getTime() - 600000).toISOString());
  if (e0 && !/does not exist|schema cache|relation/i.test(e0.message)) throw new Error(e0.message);
  const { data, error } = await adm.from("backup_execucoes").select("id, iniciado_em, terminado_em, origem, pedido_por, situacao, passo, erro, para, detalhe").order("id", { ascending: false }).limit(10);
  if (error) throw new Error(/does not exist|schema cache|relation/i.test(error.message) ? "Falta rodar o supabase/v35.sql no Supabase." : error.message);
  let senha = true; try { senhaDoBackup(env); } catch (_) { senha = false; }
  return { execucoes: data || [], senha_cadastrada: senha, config: await configBackup(adm), horario: "todo dia às 18h" };
}
