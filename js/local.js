// Cópia local dos dados (IndexedDB) para o sistema abrir e consultar sem internet.
// Fase 1 do modo offline: só leitura. Gravações continuam indo direto para o servidor.
const BANCO = "dtcar-local", LOJA = "kv", VERSAO = 1;
let abrindo = null;
function abrir() {
  if (abrindo) return abrindo;
  abrindo = new Promise((ok, falha) => {
    if (!("indexedDB" in window)) return falha(new Error("sem IndexedDB"));
    const r = indexedDB.open(BANCO, VERSAO);
    r.onupgradeneeded = () => r.result.createObjectStore(LOJA);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => falha(r.error);
  }).catch(e => { abrindo = null; throw e; });
  return abrindo;
}
const tx = async (modo, fn) => { const db = await abrir(); return new Promise((ok, falha) => { const t = db.transaction(LOJA, modo); const req = fn(t.objectStore(LOJA)); t.oncomplete = () => ok(req && req.result); t.onerror = () => falha(t.error); t.onabort = () => falha(t.error); }); };

export const local = {
  ler: async k => { try { return await tx("readonly", s => s.get(k)); } catch (e) { return undefined; } },
  gravar: async (k, v) => { try { await tx("readwrite", s => s.put(v, k)); return true; } catch (e) { return false; } },
  apagarTudo: async () => { try { await tx("readwrite", s => s.clear()); } catch (e) {} },
};

/** Erro de rede (sem internet ou servidor fora do ar), e não erro de permissão ou de dados */
export const erroDeRede = e => !navigator.onLine || /Failed to fetch|NetworkError|network|Load failed|Sem conexão|fetch failed|ERR_INTERNET/i.test(String((e && e.message) || e));

/** Pede ao navegador para não apagar a cópia local quando faltar espaço */
export async function pedirPersistencia() {
  try { if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) return await navigator.storage.persist(); return true; } catch (e) { return false; }
}

/** Sessão do Supabase guardada no aparelho (usada quando não há internet para renová-la) */
export function sessaoGuardada() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (/^sb-.*-auth-token$/.test(k)) { const v = JSON.parse(localStorage.getItem(k)); const s = v && (v.currentSession || v); if (s && s.user) return s; }
    }
  } catch (e) {}
  return null;
}
