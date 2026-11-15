// Busca do endereço pelo CEP (pedido do Danilo em 15/11/2026). Gratuita e sem chave:
//   1º ViaCEP (viacep.com.br); 2º OpenCEP (opencep.com), que responde no mesmo formato, quando o ViaCEP cai ou não conhece o CEP.
// Regras:
//   - Uma consulta por CEP digitado (8 números), nunca em lote: o ViaCEP bloqueia quem usa em massa.
//   - CEP já consultado fica guardado no aparelho (não consulta de novo).
//   - Sem internet ou com os dois serviços fora: não trava nada, o endereço é preenchido à mão.
//   - Só preenche campo em branco (ou que a própria busca tinha preenchido). Nunca troca o que a pessoa digitou.
//   - O bairro dos Correios nem sempre é o nome usado na cidade: tudo continua editável.
import { html, useState, useRef } from "./lib.js";
import { Campo } from "./ui.js";
import { soDig } from "./util.js";

/** "29705390" → "29705-390"; o que não tem 8 números fica como foi digitado */
export const fmtCep = v => { const c = soDig(v); return c.length === 8 ? c.slice(0, 5) + "-" + c.slice(5) : String(v ?? "").trim(); };

const FONTES = [["viacep", c => "https://viacep.com.br/ws/" + c + "/json/"], ["opencep", c => "https://opencep.com/v1/" + c]];
const ESPERA = 5000, CHAVE = "dtcar-cep", MAX = 200;
const vistos = new Map();
const guardados = () => { try { return JSON.parse(localStorage.getItem(CHAVE) || "{}") || {}; } catch (e) { return {}; } };
const guardar = (cep, dados) => { try { const g = guardados(); delete g[cep]; g[cep] = dados; const ks = Object.keys(g); for (const k of ks.slice(0, Math.max(0, ks.length - MAX))) delete g[k]; localStorage.setItem(CHAVE, JSON.stringify(g)); } catch (e) { /* sem espaço ou sem permissão: segue sem guardar */ } };
const limpo = s => String(s ?? "").trim();

/** Uma fonte: { achou: true, dados } | { achou: false } (a fonte respondeu que não conhece) | { falhou: true } (sem resposta) */
async function pedir(url) {
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null, t = ctl ? setTimeout(() => ctl.abort(), ESPERA) : 0;
  try {
    const r = await fetch(url, { signal: ctl ? ctl.signal : undefined, headers: { Accept: "application/json" } });
    if (r.status === 404 || r.status === 400) return { achou: false };
    if (!r.ok) return { falhou: true };
    const j = await r.json();
    if (!j || j.erro || !limpo(j.localidade) || !limpo(j.uf)) return { achou: false };
    return { achou: true, dados: { rua: limpo(j.logradouro), bairro: limpo(j.bairro), cidade: limpo(j.localidade), uf: limpo(j.uf).toUpperCase().slice(0, 2), ibge: limpo(j.ibge) } };
  } catch (e) { return { falhou: true }; }
  finally { if (t) clearTimeout(t); }
}

/**
 * Consulta um CEP. Nunca lança erro. Devolve
 * { ok: true, encontrado: true, dados: { rua, bairro, cidade, uf, ibge }, origem: "viacep" | "opencep" | "guardado" }
 * { ok: true, encontrado: false }                      (nenhuma fonte conhece o CEP)
 * { ok: false, erro, invalido? | semRede? }            (CEP incompleto, sem internet ou serviços fora)
 */
export async function consultarCep(cep) {
  const c = soDig(cep);
  if (c.length !== 8) return { ok: false, invalido: true, erro: "O CEP tem 8 números." };
  if (vistos.has(c)) return { ok: true, encontrado: true, dados: vistos.get(c), origem: "guardado" };
  const g = guardados()[c];
  if (g && g.cidade) { vistos.set(c, g); return { ok: true, encontrado: true, dados: g, origem: "guardado" }; }
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { ok: false, semRede: true, erro: "Sem internet agora." };
  let respondeu = false;
  for (const [nome, url] of FONTES) {
    const r = await pedir(url(c));
    if (r.achou) { vistos.set(c, r.dados); guardar(c, r.dados); return { ok: true, encontrado: true, dados: r.dados, origem: nome }; }
    if (!r.falhou) respondeu = true;
  }
  return respondeu ? { ok: true, encontrado: false } : { ok: false, semRede: true, erro: "Não deu para buscar o CEP agora." };
}

/**
 * Junta o endereço do CEP ao formulário sem trocar o que a pessoa digitou.
 * atual: os valores do formulário; dados: o que veio do CEP; anterior: o que a busca anterior preencheu (pode ser trocado);
 * chaves: nome de cada campo no formulário ({ rua, bairro, cidade, uf }); padrao: valores que já vêm prontos no formulário novo (ex.: Colatina/ES).
 * Devolve { mudou: { campo: valor }, mantidos: ["cidade", ...] } — mantidos = campos em que o formulário tem outra coisa digitada.
 */
export function juntarEndereco(atual, dados, anterior = {}, chaves = {}, padrao = {}) {
  const mudou = {}, mantidos = [], igual = (a, b) => limpo(a).toLowerCase() === limpo(b).toLowerCase();
  for (const k of ["rua", "bairro", "cidade", "uf"]) {
    const campo = chaves[k] || k, tem = limpo(atual[campo]), novo = limpo(dados[k]);
    const livre = !tem || (anterior[campo] !== undefined && igual(tem, anterior[campo])) || (padrao[campo] !== undefined && igual(tem, padrao[campo]));
    if (!novo) continue;                              // CEP geral da cidade não traz rua nem bairro: fica o que está
    if (igual(tem, novo)) continue;
    if (livre) mudou[campo] = novo; else mantidos.push(k);
  }
  return { mudou, mantidos };
}

/**
 * Campo de CEP que busca o endereço sozinho quando o CEP fica completo (8 números) e é diferente do que estava ao abrir.
 * atual: valores do formulário; onAplica(mudou): recebe só os campos a preencher; chaves/padrao: ver juntarEndereco.
 */
export function CampoCep({ id, valor, onMuda, atual, onAplica, chaves, padrao, rotulo = "CEP" }) {
  const [st, setSt] = useState(null);                 // { tipo: "buscando" | "ok" | "aviso", texto }
  const ultimo = useRef(soDig(valor)), preenchido = useRef({}), vez = useRef(0), ref = useRef(atual);
  ref.current = atual;
  const buscar = async c => {
    ultimo.current = c; const minha = ++vez.current;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return setSt(null);   // sem internet: segue à mão, sem aviso
    setSt({ tipo: "buscando", texto: "Buscando o endereço…" });
    const r = await consultarCep(c);
    if (minha !== vez.current) return;                // o CEP foi trocado enquanto buscava
    if (!r.ok) return setSt({ tipo: "aviso", texto: "Não deu para buscar o CEP agora. Preencha o endereço à mão." });
    if (!r.encontrado) return setSt({ tipo: "aviso", texto: "CEP não encontrado. Confira os números ou preencha o endereço à mão." });
    const { mudou, mantidos } = juntarEndereco(ref.current || {}, r.dados, preenchido.current, chaves, padrao);
    preenchido.current = mudou;
    if (Object.keys(mudou).length) onAplica(mudou);
    const lugar = r.dados.cidade + "/" + r.dados.uf;
    setSt(mantidos.includes("cidade") || mantidos.includes("uf") ? { tipo: "aviso", texto: "Este CEP é de " + lugar + ". Confira a cidade." }
      : Object.keys(mudou).length ? { tipo: "ok", texto: "Endereço preenchido pelo CEP (" + lugar + "). Confira o número e o bairro." }
      : { tipo: "ok", texto: "CEP de " + lugar + "." });
  };
  const digitou = v => {
    onMuda(v);
    const c = soDig(v);
    if (c.length === 8 && c !== ultimo.current) buscar(c);
    else if (c.length !== 8) { vez.current++; setSt(null); if (c !== ultimo.current) ultimo.current = ""; }
  };
  return html`<${Campo} id=${id} rotulo=${rotulo} dica=${st ? st.texto : ""}>
    <input id=${id} class="inp" inputmode="numeric" maxlength="10" autocomplete="postal-code" value=${valor ?? ""} data-cep=${st ? st.tipo : ""}
      onInput=${e => digitou(e.target.value)} onBlur=${e => { const f = fmtCep(e.target.value); if (f !== e.target.value) onMuda(f); }} /></${Campo}>`;
}
