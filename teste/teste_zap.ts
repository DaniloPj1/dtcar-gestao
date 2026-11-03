// Teste da função "zap" (WhatsApp, etapa 1) sem rede e sem banco real.
// Rodar: deno run -A teste/teste_zap.ts
// 1) sessão guardada no "banco" volta igual (bytes da criptografia, chaves de sincronização);
// 2) sem login: 401; 3) apagar sessão limpa tudo.
import { initAuthCreds } from "npm:baileys@7.0.0-rc14";
const ok: string[] = [], falhas: string[] = [];
const confere = (n: string, c: boolean, x = "") => (c ? ok : falhas).push(n + (x ? " (" + x + ")" : ""));

// "banco" em memória com o mesmo jeito de consulta usado pela função
const linhas = new Map<string, unknown>();
const q = (op: string, dados?: unknown) => {
  const b: any = { _op: op, _dados: dados, _in: null as string[] | null, _neq: false,
    select() { return b; }, in(_c: string, v: string[]) { b._in = v; return b; }, neq() { b._neq = true; return b; }, eq() { return b; },
    then(res: (x: unknown) => void) {
      if (b._op === "select") res({ data: [...linhas].filter(([k]) => !b._in || b._in.includes(k)).map(([chave, valor]) => ({ chave, valor: JSON.parse(JSON.stringify(valor)) })), error: null });
      else if (b._op === "upsert") { for (const r of b._dados as any[]) linhas.set(r.chave, r.valor); res({ error: null }); }
      else if (b._op === "delete") { for (const k of [...linhas.keys()]) if (b._neq || b._in?.includes(k)) linhas.delete(k); res({ error: null }); }
      else res({ error: null });
    } };
  return b;
};
const adm = { from: () => ({ select: () => q("select"), upsert: (d: unknown) => q("upsert", d), delete: () => q("delete"), update: () => q("update") }), rpc: () => q("rpc") };

Deno.env.set("SUPABASE_URL", "https://vbbklawlbxznsemkgtvg.supabase.co");
Deno.env.set("SUPABASE_PUBLISHABLE_KEYS", JSON.stringify({ default: "sb_publishable_teste" }));
Deno.env.set("SUPABASE_JWKS", JSON.stringify({ keys: [] }));
const { sessaoNoBanco, atender } = await import("../supabase/functions/zap/index.ts");
const s = sessaoNoBanco(adm as any);

let c = await s.carregar();
confere("sessão vazia: credenciais novas, não vinculado", !c.creds.registered && !!c.creds.noiseKey);
const chavePublica = Buffer.from(c.creds.noiseKey.public).toString("hex");
c.creds.registered = true; await c.salvarCreds();
await c.keys.set({ "pre-key": { "1": { public: new Uint8Array([1, 2, 3]), private: new Uint8Array([4, 5]) }, "2": null as any },
  "app-state-sync-key": { "AAA": { keyData: new Uint8Array([9, 9]), fingerprint: { rawId: 1, currentIndex: 2 }, timestamp: 123 } } });
c = await s.carregar();
confere("credenciais voltam iguais (bytes)", c.creds.registered === true && Buffer.from(c.creds.noiseKey.public).toString("hex") === chavePublica);
const pk = await c.keys.get("pre-key", ["1", "2"]);
confere("chave guardada volta como bytes", pk["1"] && (pk["1"] as any).public instanceof Uint8Array && Array.from((pk["1"] as any).public).join() === "1,2,3");
confere("chave apagada (null) não volta", pk["2"] == null);
const ak = await c.keys.get("app-state-sync-key", ["AAA"]);
confere("chave de sincronização volta no formato da biblioteca", !!ak["AAA"] && typeof (ak["AAA"] as any).toJSON === "function");
await s.apagar();
confere("apagar sessão limpa tudo", linhas.size === 0);
c = await s.carregar();
confere("depois de apagar: credenciais novas", !c.creds.registered);

const r = await atender(new Request("http://localhost/zap", { method: "POST", headers: { "content-type": "application/json" }, body: '{"acao":"testar"}' }));
confere("sem login: 401", r.status === 401, String(r.status));
const r2 = await atender(new Request("http://localhost/zap", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.x" }, body: '{"acao":"testar"}' }));
confere("token falso: 401", r2.status === 401, String(r2.status));

console.log(ok.map((x) => "OK " + x).join("\n")); console.log("FALHAS", JSON.stringify(falhas));
setTimeout(() => Deno.exit(falhas.length ? 1 : 0), 100);
