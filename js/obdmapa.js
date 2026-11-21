/**
 * O CADERNO DO CARRO: o que se aprende sobre como um modelo responde, anotado sozinho.
 * (Etapa 4 — o carro que nenhuma base conhece: Onix, Prisma, Strada, Argo, HB20, Kwid.)
 *
 * O PRINCÍPIO, que o Danilo definiu: NÃO EXISTE BOTÃO DE GRAVAR. Nada é pedido ao mecânico. O
 * catálogo do modelo cresce como subproduto de leitura que já ia acontecer.
 *
 *  1. PASSIVO: toda troca com o adaptador que já aconteceu é anotada — que endereço respondeu, que
 *     dado veio e com quantos bytes, que recusa (e com qual código), quanto demorou. Zero pedido novo.
 *  2. DIRIGIDO: com carro sem mapa, parado e com o adaptador ocioso, o app faz UMA pergunta de
 *     leitura por folga (quem responde, que identificação tem). Só serviço de leitura.
 *  3. REGRA: "respondeu no 7B0 e tem o dado F190" vira "ABS" por regra escrita. Regra nasce NÃO
 *     CONFERIDA e só é promovida quando um SEGUNDO carro do mesmo modelo concorda.
 *
 * O QUE NUNCA ENTRA AQUI: pedido que age (2F, 31, 2E, 11, 27, 14). Automático para o que só lê.
 *
 * Não tem window nem document: dá para testar sem navegador.
 */
import { juntarLinhas } from "./obd.js";

export const MAX_TROCAS = 300;      // conversa crua guardada por sessão, para reproduzir o carro no teste
const hx = (n, t) => n.toString(16).toUpperCase().padStart(t, "0");

/** A chave do modelo: marca, modelo e ano juntos. Sem marca e modelo, vale o começo do chassi. */
export function chaveDoModelo(carro) {
  const c = carro || {};
  const lim = t => String(t || "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Z0-9]+/g, " ").trim();
  const ano = (String(c.ano || "").match(/\d{4}/g) || []).pop() || "";
  if (lim(c.marca) && lim(c.modelo)) return [lim(c.marca), lim(c.modelo).split(" ").slice(0, 2).join(" "), ano].join("|");
  const vin = String(c.vin || "").toUpperCase();
  return vin.length >= 11 ? "VIN|" + vin.slice(0, 8) + "|" + vin[9] : "";
}

export const novoCaderno = () => ({ cabecalho: "", enderecos: {}, dados: {}, trocas: [], novidade: 0 });

/**
 * Anota UMA troca que já aconteceu. `cmd` é o que foi mandado, `cru` o texto que voltou.
 * Acompanha o ATSH para saber com qual módulo a conversa é.
 */
export function anotarTroca(cad, cmd, cru, ms) {
  const c = String(cmd || "").toUpperCase().replace(/\s+/g, "");
  if (!c) return;
  if (cad.trocas.length < MAX_TROCAS) cad.trocas.push([c, String(cru || "").replace(/[\r\n]+/g, "|").replace(/[>\s]+$/g, "").slice(0, 400), ms || 0]);
  if (c.startsWith("ATSH")) { cad.cabecalho = c.slice(4); return; }
  if (c.startsWith("ATSP") || c === "ATZ" || c === "ATD" || c === "ATWS") { cad.cabecalho = ""; return; }
  if (c.startsWith("AT") || !cad.cabecalho) return;          // sem módulo apontado é OBD-II genérico: não é mapa de módulo
  const servico = parseInt(c.slice(0, 2), 16);
  if (![0x10, 0x19, 0x21, 0x22, 0x3e].includes(servico)) return;   // só leitura entra no mapa
  const r = juntarLinhas(cru);
  const end = cad.enderecos[cad.cabecalho] || (cad.enderecos[cad.cabecalho] = { respondeu: 0, calado: 0, ms: 0 });
  const hex = r.hex || "";
  if (r.erro || !hex) {
    end.calado++; cad.novidade++;
    // O identificador que ficou SEM RESPOSTA também é anotado: sem isso o mapeamento repetia a mesma
    // pergunta para sempre e nunca passava para o identificador seguinte. Uma resposta de verdade,
    // se vier depois, substitui esta anotação.
    if (servico === 0x22 || servico === 0x21) {
      const d = cad.dados[cad.cabecalho] || (cad.dados[cad.cabecalho] = {});
      const k = hx(servico, 2) + c.slice(2);
      if (!d[k]) d[k] = { calado: true };
    }
    return;
  }
  end.respondeu++; end.ms = Math.max(end.ms, ms || 0); cad.novidade++;
  const negativa = hex.startsWith("7F") && hex.slice(2, 4) === hx(servico, 2) ? parseInt(hex.slice(4, 6), 16) : null;
  if (servico === 0x22 || servico === 0x21) {
    const id = c.slice(2);
    const d = cad.dados[cad.cabecalho] || (cad.dados[cad.cabecalho] = {});
    d[hx(servico, 2) + id] = negativa != null ? { nrc: negativa } : { bytes: Math.max(0, hex.length / 2 - 1 - id.length / 2), ms: ms || 0 };
  } else {
    const s = end.servicos || (end.servicos = {});
    s[hx(servico, 2)] = negativa != null ? negativa : 0;
  }
}

/** O retrato que vai para o banco. null se nada de módulo foi conversado. */
export function retrato(cad, carro) {
  if (!Object.keys(cad.enderecos).length) return null;
  return { modelo: chaveDoModelo(carro), enderecos: cad.enderecos, dados: cad.dados, trocas: cad.trocas };
}

/* ------------------------------------------------------------------ o que vários carros dizem */
/**
 * Junta os retratos de vários carros DO MESMO MODELO. `retratos` = [{ carro: "placa ou chassi", ...retrato }].
 * Um endereço só é dado como "conferido" quando DOIS CARROS DIFERENTES responderam nele; um carro
 * só é "visto uma vez". Se um carro respondeu e outro ficou calado, o conflito fica anotado.
 */
export function consenso(retratos) {
  const porEnd = {};
  for (const r of retratos || []) {
    for (const e of Object.keys((r && r.enderecos) || {})) {
      const o = porEnd[e] || (porEnd[e] = { responderam: new Set(), calados: new Set(), dados: {} });
      (r.enderecos[e].respondeu ? o.responderam : o.calados).add(r.carro || "?");
      for (const d of Object.keys((r.dados && r.dados[e]) || {})) {
        if (r.dados[e][d].nrc == null && !r.dados[e][d].calado) (o.dados[d] || (o.dados[d] = new Set())).add(r.carro || "?");
      }
    }
  }
  return Object.keys(porEnd).sort().map(e => {
    const o = porEnd[e], n = o.responderam.size;
    return { endereco: e, carros: n, calados: o.calados.size,
      situacao: n >= 2 && !o.calados.size ? "conferido" : n >= 1 && o.calados.size ? "conflito" : n >= 1 ? "visto-uma-vez" : "calado",
      dados: Object.keys(o.dados).sort().map(d => ({ id: d, carros: o.dados[d].size, conferido: o.dados[d].size >= 2 })) };
  });
}
export const TEXTO_SITUACAO = { conferido: "CONFERIDO em dois carros", "visto-uma-vez": "NÃO CONFERIDO: visto em um carro só",
  conflito: "CONFLITO: respondeu num carro e ficou calado em outro", calado: "Não respondeu" };

/* ------------------------------------------------------------------ regra de identificação */
/**
 * Avalia uma regra como "comms_ok & did:F190=ok & did:2003=noreply" contra os fatos de um endereço.
 * Termos: comms_ok | did:<ID>=ok | did:<ID>=noreply | did:<ID>=nrc<HH> | svc:<HH>=ok. Só "&".
 * `fatos` = { respondeu, dados: { "22F190": { bytes } | { nrc } }, servicos: { "19": 0 | nrc } }.
 * Termo que a regra pede e o caderno ainda não perguntou devolve null (não sei), nunca false.
 */
export function avaliar(regra, fatos) {
  let sei = true;
  for (const termo of String(regra || "").split("&").map(t => t.trim()).filter(Boolean)) {
    if (termo === "comms_ok") { if (!fatos.respondeu) return false; continue; }
    const m = /^(did|svc):([0-9A-Fa-f]+)=(ok|noreply|nrc([0-9A-Fa-f]{2}))$/.exec(termo);
    if (!m) throw new Error("termo de regra desconhecido: " + termo);
    const id = m[2].toUpperCase();
    if (m[1] === "did") {
      const d = (fatos.dados || {})[(id.length === 2 ? "21" : "22") + id];
      if (d === undefined) { sei = false; continue; }
      const ok = d.nrc == null && !d.calado;
      if (m[3] === "ok" ? !ok : m[3] === "noreply" ? !d.calado : d.nrc !== parseInt(m[4], 16)) return false;
    } else {
      const s = (fatos.servicos || {})[id];
      if (s === undefined) { sei = false; continue; }
      if (m[3] === "ok" ? s !== 0 : m[3] === "noreply" ? true : s !== parseInt(m[4], 16)) return false;
    }
  }
  return sei ? true : null;
}
/** Qual regra casa com o endereço. `regras` = [{ endereco, regra, nome }]. Devolve a primeira que casar, ou null. */
export function identificar(regras, endereco, fatos) {
  for (const r of regras || []) if (r.endereco === endereco && avaliar(r.regra, fatos) === true) return r;
  return null;
}

/* ------------------------------------------------------------------ a varredura dirigida */
// Identificação padrão do UDS (ISO 14229-1, anexo C): o que todo módulo costuma ter, e só leitura.
export const DIDS_IDENTIDADE = ["F190", "F187", "F18C", "F189", "F191", "F195", "F197", "F19E", "F1A0"];
/**
 * O PRÓXIMO pedido de descoberta para um carro sem mapa, dado o que o caderno já sabe.
 * Ordem: primeiro quem responde (endereços de diagnóstico 0x700–0x7EF que ainda não foram
 * perguntados), depois a identificação de cada um que respondeu. Devolve
 * { tipo: "endereco", pedido, resposta } | { tipo: "dado", pedido, resposta, did } | null (acabou).
 * NUNCA devolve pedido que age: é a função que garante o "automático só para o que lê".
 */
export function proximoPasso(cad, { de = 0x700, ate = 0x7ef } = {}) {
  for (let a = de; a <= ate; a++) {
    if (a === 0x7df) continue;                       // endereço de todos os módulos: não é módulo
    if (a >= 0x7e8) break;                           // 7E8–7EF são as RESPOSTAS do grupo motriz
    const p = hx(a, 3);
    if (!cad.enderecos[p]) return { tipo: "endereco", pedido: p, resposta: hx(a + 8, 3) };
  }
  for (const p of Object.keys(cad.enderecos).sort()) {
    if (!cad.enderecos[p].respondeu || p.length !== 3) continue;
    const tem = cad.dados[p] || {};
    for (const did of DIDS_IDENTIDADE) if (!tem["22" + did]) return { tipo: "dado", pedido: p, resposta: hx(parseInt(p, 16) + 8, 3), did };
  }
  return null;
}
/** Quanto falta, para a linha de situação da tela. */
export function andamento(cad, faixa = {}) {
  const de = faixa.de || 0x700, ate = Math.min(faixa.ate || 0x7ef, 0x7e7);
  let total = 0, feitos = 0;
  for (let a = de; a <= ate; a++) { if (a === 0x7df) continue; total++; if (cad.enderecos[hx(a, 3)]) feitos++; }
  return { total, feitos, responderam: Object.keys(cad.enderecos).filter(p => cad.enderecos[p].respondeu).length };
}
