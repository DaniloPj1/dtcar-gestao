/**
 * O registro do diagnóstico no banco (tabela obd_leituras), para tudo que não é o apagar do OBD-II:
 * teste de atuador, aprendizado, apagamento por módulo, gravação de bico, sessão de leitura, laudo
 * e o mapa aprendido do carro.
 *
 * DUAS REGRAS:
 *  1. Nada se perde por falta de banco ou de internet. O que não deu para gravar fica guardado no
 *     aparelho e sobe sozinho depois. (Os tipos novos dependem do supabase/v63.sql; antes dele o
 *     banco recusa, e é exatamente este caminho que segura o registro.)
 *  2. Laudo é SELADO: vai junto um SHA-256 do conteúdo. A tabela não tem alteração (não existe
 *     política de update), e o selo deixa conferir depois que o que está guardado é o que foi lido.
 *
 * Não tem window nem document: o cofre (onde ficam os pendentes) é passado por quem chama.
 */
export const TIPOS = ["leitura", "apagar", "atuar", "aprender", "apagar_modulo", "gravar_bico", "sessao", "laudo", "mapa"];
export const MAX_PENDENTES = 80;

/** JSON sempre na mesma ordem de chaves: o mesmo conteúdo dá sempre o mesmo selo. */
export function canonico(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return "[" + v.map(canonico).join(",") + "]";
  return "{" + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ":" + canonico(v[k])).join(",") + "}";
}
export async function selar(dados) {
  const c = globalThis.crypto;
  const b = await c.subtle.digest("SHA-256", new TextEncoder().encode(canonico(dados)));
  return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, "0")).join("");
}
/** "confere" | "nao-confere" | "sem-selo" para uma linha lida do banco. */
export async function integridade(linha) {
  if (!linha || !linha.selo) return "sem-selo";
  return (await selar(linha.dados)) === linha.selo ? "confere" : "nao-confere";
}

/** A linha que vai para o banco. `quem` = perfil; `carro` = o carro da vez (js/obdsessao.js). */
export function linha(tipo, quem, carro, dados, extra = {}) {
  if (!TIPOS.includes(tipo)) throw new Error("tipo de registro desconhecido: " + tipo);
  const c = carro || {}, q = quem || {};
  const km = Number(extra.km);
  return {
    tipo,
    perfil_id: q.id || null, perfil_nome: q.nome || "",
    placa: String(c.placa || "").toUpperCase(), veiculo_id: c.veiculo_id || null,
    ordem_id: extra.ordem_id || null, os_numero: extra.os_numero || null,
    km: Number.isFinite(km) && km > 0 ? Math.round(km) : null,
    vin: c.vin || "",
    codigos: extra.codigos || [], leituras: [],
    obs: extra.obs || "",
    dados: dados || {},
  };
}

/**
 * Grava; se não der, guarda no aparelho. Nunca rejeita.
 * Devolve { gravado: true } ou { gravado: false, pendente: true|false, motivo }.
 */
export async function guardar(registrar, cofre, l) {
  try { await registrar(l); return { gravado: true }; }
  catch (e) {
    const motivo = (e && e.message) || "não deu para registrar";
    try {
      const fila = cofre.ler();
      // Fila CHEIA não apaga o pendente mais antigo em silêncio: apagar registro que o app prometeu
      // guardar é pior que recusar o novo dizendo a verdade (revisão do Codex, 23/11/2026).
      if (fila.length >= MAX_PENDENTES) {
        return { gravado: false, pendente: false, motivo: motivo + " — e a fila do aparelho está cheia (" + MAX_PENDENTES + " registros esperando subir). Conecte com internet para ela esvaziar." };
      }
      fila.push(Object.assign({ guardado_em: new Date().toISOString() }, l));
      cofre.escrever(fila);
      return { gravado: false, pendente: true, motivo };
    } catch (e2) { return { gravado: false, pendente: false, motivo }; }
  }
}
/** Sobe o que ficou guardado. Devolve quantos subiram e quantos ainda esperam. */
export async function subirPendentes(registrar, cofre) {
  let fila = [];
  try { fila = cofre.ler(); } catch (e) { return { subiram: 0, restam: 0 }; }
  const enviados = [];
  let subiram = 0;
  for (const reg of fila) {
    const l = Object.assign({}, reg); delete l.guardado_em;
    try { await registrar(l); subiram++; enviados.push(JSON.stringify(reg)); } catch (e) { /* fica na fila */ }
  }
  // Tira da fila SÓ o que subiu. A fila é lida de novo porque guardar() pode ter acrescentado um
  // registro enquanto o servidor respondia — escrever a cópia antiga apagaria esse registro.
  let restam = fila.length - subiram;
  try {
    const agora = cofre.ler().filter(reg => { const i = enviados.indexOf(JSON.stringify(reg)); if (i < 0) return true; enviados.splice(i, 1); return false; });
    cofre.escrever(agora); restam = agora.length;
  } catch (e) { /* segue */ }
  return { subiram, restam };
}
/** O cofre padrão: o armazenamento do aparelho, na mesma chave que o apagar do OBD-II já usava. */
export function cofreDe(armazenamento, chave = "obd_pendentes") {
  return {
    ler: () => { const l = JSON.parse(armazenamento.getItem(chave) || "[]"); return Array.isArray(l) ? l : []; },
    escrever: l => armazenamento.setItem(chave, JSON.stringify(l)),
  };
}
