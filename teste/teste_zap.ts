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
  const b: any = { _op: op, _dados: dados, _in: null as string[] | null, _neq: [] as string[],
    select() { return b; }, in(_c: string, v: string[]) { b._in = v; return b; }, neq(_c: string, v: string) { b._neq.push(v); return b; }, eq() { return b; },
    then(res: (x: unknown) => void) {
      if (b._op === "select") res({ data: [...linhas].filter(([k]) => !b._in || b._in.includes(k)).map(([chave, valor]) => ({ chave, valor: JSON.parse(JSON.stringify(valor)) })), error: null });
      else if (b._op === "upsert") { for (const r of b._dados as any[]) linhas.set(r.chave, r.valor); res({ error: null }); }
      else if (b._op === "delete") { for (const k of [...linhas.keys()]) if (b._in ? b._in.includes(k) : !b._neq.includes(k)) linhas.delete(k); res({ error: null }); }
      else if (b._op === "insert") { const r = b._dados as any; if (linhas.has(r.chave)) res({ error: { message: "duplicate key" } }); else { linhas.set(r.chave, r.valor); res({ error: null }); } }
      else res({ error: null });
    } };
  return b;
};
const adm = { from: () => ({ select: () => q("select"), upsert: (d: unknown) => q("upsert", d), insert: (d: unknown) => q("insert", d), delete: () => q("delete"), update: () => q("update") }), rpc: () => q("rpc") };

Deno.env.set("SUPABASE_URL", "https://vbbklawlbxznsemkgtvg.supabase.co");
Deno.env.set("SUPABASE_PUBLISHABLE_KEYS", JSON.stringify({ default: "sb_publishable_teste" }));
Deno.env.set("SUPABASE_JWKS", JSON.stringify({ keys: [] }));
const { sessaoNoBanco, atender, vinculado, vezNoBanco } = await import("../supabase/functions/zap/index.ts");
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

// reserva do pareamento: uma tentativa por vez; a antiga não mexe na nova
const rv1 = await s.reservar(150000);
const rv2 = await s.reservar(150000);
confere("pareamento: primeira reserva vale, segunda é recusada", !!rv1 && rv2 === null);
confere("pareamento: reserva atual é a primeira", (await s.reservaAtual()) === rv1);
await c.salvarCreds(); await s.apagar(false);
confere("limpar sessão para parear mantém a reserva", (await s.reservaAtual()) === rv1 && !linhas.has("creds"));
await s.liberar("outra"); confere("liberar com id errado não tira a reserva", (await s.reservaAtual()) === rv1);
linhas.set("pareamento", { id: rv1, ate: Date.now() - 1 });
const r3 = await s.reservar(150000);
confere("reserva vencida é substituída", !!r3 && r3 !== rv1 && (await s.reservaAtual()) === r3);
await s.liberar(r3!); confere("liberar com o id certo tira a reserva", (await s.reservaAtual()) === null);
await s.reservar(150000); await s.apagar(); confere("desconectar apaga também a reserva", linhas.size === 0);

// vinculado pelo QR Code: a biblioteca preenche só creds.me (registered continua false)
const novas = initAuthCreds();
confere("credenciais novas: não vinculado", !vinculado(novas));
confere("vinculado pelo QR Code (só creds.me)", vinculado({ ...novas, registered: false, me: { id: "5527992470140:12@s.whatsapp.net" } }));
confere("vinculado pelo código (registered)", vinculado({ ...novas, registered: true }));
const vq = sessaoNoBanco(adm as any); const cq = await vq.carregar(); cq.creds.me = { id: "5527992470140:12@s.whatsapp.net", name: "DTCar" }; await cq.salvarCreds();
confere("sessão do QR guardada volta como vinculada", vinculado((await vq.carregar()).creds)); await vq.apagar();

// revezamento com o motor do Android (v24)
const admVez = (linha: unknown, erro: unknown = null, rpcDado: unknown = true) => ({
  from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: linha ? [linha] : [], error: erro }) }) }),
  rpc: () => Promise.resolve({ data: rpcDado, error: erro }),
});
const futuro = new Date(Date.now() + 60000).toISOString(), passado = new Date(Date.now() - 1000).toISOString();
let mv = await vezNoBanco(admVez({ dono: "android", dono_ate: futuro, motor_visto: new Date(Date.now() - 10000).toISOString(), motor_info: { conectado: true, aparelho: "A15" } }) as any).motor();
confere("motor com a vez valendo: ativo e conectado", mv.ativo && mv.conectado && mv.aparelho === "A15" && mv.visto_s! >= 9 && mv.visto_s! <= 11, JSON.stringify(mv));
mv = await vezNoBanco(admVez({ dono: "android", dono_ate: passado, motor_info: { conectado: true } }) as any).motor();
confere("vez do motor vencida: não está ativo", !mv.ativo);
mv = await vezNoBanco(admVez({ dono: "supabase", dono_ate: futuro }) as any).motor();
confere("vez com o supabase: motor não ativo", !mv.ativo);
mv = await vezNoBanco(admVez(null, { message: "column dono_ate does not exist" }) as any).motor();
confere("sem o v24: motor não ativo", !mv.ativo);
confere("sem o v24: função segue sem reservar", await vezNoBanco(admVez(null, { message: "function whatsapp_pegar_vez does not exist" }) as any).pegar(60));
confere("outro com a vez: função não pega", !(await vezNoBanco(admVez(null, null, false) as any).pegar(60)));
confere("vez livre: função pega", await vezNoBanco(admVez(null, null, true) as any).pegar(60));

const r = await atender(new Request("http://localhost/zap", { method: "POST", headers: { "content-type": "application/json" }, body: '{"acao":"testar"}' }));
confere("sem login: 401", r.status === 401, String(r.status));
const r2 = await atender(new Request("http://localhost/zap", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.x" }, body: '{"acao":"testar"}' }));
confere("token falso: 401", r2.status === 401, String(r2.status));

console.log(ok.map((x) => "OK " + x).join("\n")); console.log("FALHAS", JSON.stringify(falhas));
setTimeout(() => Deno.exit(falhas.length ? 1 : 0), 100);
