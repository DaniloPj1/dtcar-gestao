// DTCar Gestão — ligação do backup de leitura (backup.ts) com o mundo real: gerador do site, Hotmail da oficina e as
// chamadas de cada passo (uma chamada nova da própria função "email", com o segredo do agendamento).
import { chaveDeAcesso, type Db } from "./acoes.ts";
import { config, graph } from "./microsoft.ts";
import { paraBase64 } from "./anexos.ts";
import type { DepsBackup, Gerador, Passo } from "./backup.ts";

/** Roda em segundo plano depois da resposta (Supabase: EdgeRuntime.waitUntil, até o limite de duração da função). */
export function segundoPlano(p: Promise<unknown>) {
  const er = (globalThis as unknown as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime;
  const seguro = p.catch((e) => console.error("backup", e));
  if (er && typeof er.waitUntil === "function") er.waitUntil(seguro);
}

export async function segredoCron(adm: Db): Promise<string> {
  const { data } = await adm.from("segredos").select("valor").eq("chave", "cron").maybeSingle();
  return (data && data.valor) || "";
}

export function depsBackup(adm: Db, env: (k: string) => string | undefined, cron: string): DepsBackup {
  const base = (env("SUPABASE_URL") || "").replace(/\/$/, "");
  return {
    adm, env,
    gerador: async () => (await import("./backupsite.ts")) as unknown as Gerador,
    enviarEmail: async (m) => {
      const c = config(env);
      if (!c) throw new Error("Falta cadastrar o segredo MS_CLIENT_ID da função \"email\".");
      const { data: cx } = await adm.from("email_conexao").select("ligado").eq("id", 1).maybeSingle();
      if (cx && cx.ligado === false) throw new Error("O e-mail da oficina está desligado (Sistema › E-mail): o backup não foi enviado.");
      const token = await chaveDeAcesso({ usuario: adm, adm, env }, c);
      const destino = (e: string) => ({ emailAddress: { address: e } });
      await graph(token, "/me/sendMail", { metodo: "POST", corpo: { saveToSentItems: false, message: { subject: m.assunto, body: { contentType: "Text", content: m.texto },
        toRecipients: m.para.map(destino), attachments: m.anexos.map((a) => ({ "@odata.type": "#microsoft.graph.fileAttachment", name: a.nome, contentType: "application/zip", contentBytes: paraBase64(a.bytes) })) } } });
    },
    // o passo responde na hora (202) e trabalha em segundo plano: aqui só se espera o "recebido"
    chamarPasso: async (exec: number, passo: Passo) => {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 30000);
      try {
        const r = await fetch(base + "/functions/v1/email", { method: "POST", signal: ctl.signal,
          headers: { "content-type": "application/json", "x-dtcar-cron": cron }, body: JSON.stringify({ acao: "backup_passo", exec, passo }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((j && j.erro) || `a função respondeu ${r.status}${r.status === 546 ? " (limite de processamento do Supabase)" : ""}`);
      } catch (e) {
        throw new Error((e as Error).name === "AbortError" ? `a função não respondeu em 30 s ao chamar o passo "${passo}"` : (e as Error).message);
      } finally { clearTimeout(t); }
    },
  };
}
