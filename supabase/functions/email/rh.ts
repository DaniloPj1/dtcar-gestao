// DTCar Gestão — Documentos do RH: traz para a pasta "rh" os PDFs que a contabilidade manda por e-mail
// (recibos, pró-labore, folha de ponto, DARF, FGTS, laudos). Chamada pela tela Financeiro › Documentos do RH.
// Só copia: o e-mail fica como está no Hotmail. Nunca importa o mesmo anexo duas vezes (email_id + anexo_id).
// Valor, vencimento e linha digitável das guias são lidos pela tela (no navegador), não aqui: o Supabase limita
// o processamento de cada chamada e ler vários PDFs de uma vez passaria do limite.
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

export interface ImportarRH { remetentes?: unknown; dias?: number; maximo?: number }

/** Importa até `maximo` anexos novos por chamada (a tela chama de novo enquanto houver `restam`). */
export async function importarRH(adm: Db, token: string, p: ImportarRH, agora = new Date()) {
  const rem = (Array.isArray(p.remetentes) ? p.remetentes : []).map((x) => String(x).trim().toLowerCase()).filter((x) => EMAIL_OK.test(x)).slice(0, 10);
  if (!rem.length) return { importados: 0, restam: 0, aviso: "Nenhum e-mail da contabilidade informado." };
  const dias = Math.min(400, Math.max(7, Number(p.dias) || 120));
  const maximo = Math.min(12, Math.max(1, Number(p.maximo) || 8));
  const desde = new Date(agora.getTime() - dias * 86400000);
  // anexos já importados
  const { data: ja, error: eJa } = await adm.from("rh_documentos").select("email_id, anexo_id").gte("email_data", desde.toISOString());
  if (eJa) throw new Error(/does not exist|schema cache|relation/i.test(eJa.message) ? "Falta rodar o supabase/v30.sql no Supabase." : eJa.message);
  const feitos = new Set((ja || []).map((r: { email_id: string; anexo_id: string }) => r.email_id + "|" + r.anexo_id));

  // lista os e-mails da contabilidade com anexo (todas as pastas, menos lixo e excluídos)
  // deno-lint-ignore no-explicit-any
  const pendentes: Array<{ m: any; a: any }> = [];
  for (const r of rem) {
    const q = new URLSearchParams({ $search: `"from:${r}"`, $select: "id,subject,from,receivedDateTime,hasAttachments,parentFolderId", $top: "50" });
    let url = "/me/messages?" + q.toString();
    for (let pag = 0; pag < 4 && url; pag++) {
      const j = await graph(token, url);
      for (const m of j.value || []) {
        if (!m.hasAttachments || new Date(m.receivedDateTime).getTime() < desde.getTime()) continue;
        if (String(m.from?.emailAddress?.address || "").toLowerCase() !== r) continue; // a busca da Microsoft é aproximada
        const an = await graph(token, `/me/messages/${encodeURIComponent(m.id)}/attachments?$select=id,name,contentType,size,isInline`);
        for (const a of an.value || []) {
          if (a.isInline || a["@odata.type"] !== "#microsoft.graph.fileAttachment" || !ehArquivoRH(a.name || "", a.contentType || "")) continue;
          if ((a.size || 0) > 15 * 1024 * 1024 || feitos.has(m.id + "|" + a.id)) continue;
          pendentes.push({ m, a });
        }
      }
      url = j["@odata.nextLink"] || "";
    }
  }
  pendentes.sort((x, y) => String(x.m.receivedDateTime).localeCompare(String(y.m.receivedDateTime))); // mais antigos primeiro

  const lote = pendentes.slice(0, maximo);
  const novos: Array<Record<string, unknown>> = [];
  for (const { m, a } of lote) {
    const arq = await graph(token, `/me/messages/${encodeURIComponent(m.id)}/attachments/${encodeURIComponent(a.id)}`);
    if (!arq.contentBytes) continue;
    const comp = competenciaRH(a.name || "", m.subject || "", m.receivedDateTime);
    const tipoArq = tipoDoArquivo(a.name || "", a.contentType || "");
    const caminho = `${comp}/${crypto.randomUUID()}-${nomeSeguro(a.name || "arquivo.pdf")}`;
    const up = await adm.storage.from("rh").upload(caminho, decodificar(arq.contentBytes), { contentType: tipoArq, upsert: false });
    if (up.error) throw new Error("Não foi possível guardar o arquivo: " + up.error.message);
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
      throw new Error(error.message);
    }
    novos.push((ins || [])[0] || linha);
  }
  return { importados: novos.length, novos, restam: Math.max(0, pendentes.length - lote.length), lidos_desde: desde.toISOString().slice(0, 10) };
}
