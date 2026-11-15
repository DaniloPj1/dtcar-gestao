// Busca dos dados da empresa pelo CNPJ (pedido do Danilo em 15/11/2026: "não deixe nada de fora"). Gratuita e sem chave:
//   1º BrasilAPI (brasilapi.com.br/api/cnpj/v1); 2º Minha Receita (minhareceita.org), que responde com os mesmos nomes de campo;
//   3º CNPJ.ws pública (publica.cnpj.ws/cnpj), base independente das duas primeiras (a BrasilAPI consulta a Minha Receita por trás),
//      limitada a 3 consultas por minuto — por isso fica por último.
// Escolha conferida ao vivo em 15/11/2026 a partir do endereço do sistema: as três respondem ao navegador sem chave; a ReceitaWS e a
// OpenCNPJ não aceitam chamada direta do navegador (CORS) e ficaram de fora.
// São dados públicos do cadastro de empresas da Receita Federal (razão social, fantasia, endereço, telefone e e-mail).
// Regras (as mesmas do CEP):
//   - Uma consulta por CNPJ digitado (14 números com dígito válido), nunca em lote.
//   - CNPJ já consultado fica guardado no aparelho (não consulta de novo).
//   - Sem internet ou com os dois serviços fora: não trava nada, o cadastro é preenchido à mão.
//   - Só preenche campo em branco (ou que a própria busca tinha preenchido). Nunca troca o que a pessoa digitou.
import { html, useState, useEffect, useRef } from "./lib.js";
import { soDig, validaCNPJ } from "./util.js";
import { fmtCep } from "./cep.js";

const FONTES = [["brasilapi", c => "https://brasilapi.com.br/api/cnpj/v1/" + c, j => lerCnpj(j)], ["minhareceita", c => "https://minhareceita.org/" + c, j => lerCnpj(j)],
  ["cnpjws", c => "https://publica.cnpj.ws/cnpj/" + c, j => lerCnpjWs(j)]];
const ESPERA = 6000, CHAVE = "dtcar-cnpj", MAX = 100;
const vistos = new Map();
const guardados = () => { try { return JSON.parse(localStorage.getItem(CHAVE) || "{}") || {}; } catch (e) { return {}; } };
const guardar = (c, dados) => { try { const g = guardados(); delete g[c]; g[c] = dados; const ks = Object.keys(g); for (const k of ks.slice(0, Math.max(0, ks.length - MAX))) delete g[k]; localStorage.setItem(CHAVE, JSON.stringify(g)); } catch (e) { /* segue sem guardar */ } };
const limpo = s => String(s ?? "").replace(/\s+/g, " ").trim();
/** "COLATINA" → "Colatina"; "SAO GABRIEL DA PALHA" → "Sao Gabriel da Palha" (a cidade no jeito do cadastro) */
export const cidadeDe = s => limpo(s).toLowerCase().replace(/(^|[\s\-'])(\p{L})/gu, (_m, a, b) => a + b.toUpperCase()).replace(/ (D[aeo]s?|E) /g, m => m.toLowerCase());

/** Resposta da BrasilAPI / Minha Receita → dados nos nomes do cadastro */
export function lerCnpj(j) {
  if (!j || typeof j !== "object" || !limpo(j.razao_social)) return null;
  const tel = soDig(j.ddd_telefone_1), rua = [limpo(j.descricao_tipo_de_logradouro), limpo(j.logradouro)].filter(Boolean).join(" "), num = limpo(j.numero);
  return { razao: limpo(j.razao_social).toUpperCase(), fantasia: limpo(j.nome_fantasia).toUpperCase(),
    rua: [rua, num && !/^s\/?n$/i.test(num) ? num : ""].filter(Boolean).join(", "), complemento: limpo(j.complemento), bairro: limpo(j.bairro),
    cidade: cidadeDe(j.municipio), uf: limpo(j.uf).toUpperCase().slice(0, 2), cep: soDig(j.cep).length === 8 ? fmtCep(j.cep) : "",
    telefone: tel.length === 10 || tel.length === 11 ? tel : "", email: /^\S+@\S+\.\S+$/.test(limpo(j.email)) ? limpo(j.email).toLowerCase() : "",
    situacao: limpo(j.descricao_situacao_cadastral).toUpperCase() };
}

/** Resposta da CNPJ.ws pública (outro formato: os dados do endereço ficam em "estabelecimento") → os mesmos nomes do cadastro */
export function lerCnpjWs(j) {
  const e = j && typeof j === "object" && j.estabelecimento;
  if (!e || typeof e !== "object") return null;
  return lerCnpj({ razao_social: j.razao_social, nome_fantasia: e.nome_fantasia, descricao_tipo_de_logradouro: e.tipo_logradouro, logradouro: e.logradouro, numero: e.numero,
    complemento: e.complemento, bairro: e.bairro, municipio: e.cidade && e.cidade.nome, uf: e.estado && e.estado.sigla, cep: e.cep,
    ddd_telefone_1: String(e.ddd1 || "") + String(e.telefone1 || ""), email: e.email, descricao_situacao_cadastral: e.situacao_cadastral });
}

async function pedir(url, ler) {
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null, t = ctl ? setTimeout(() => ctl.abort(), ESPERA) : 0;
  try {
    const r = await fetch(url, { signal: ctl ? ctl.signal : undefined, headers: { Accept: "application/json" } });
    if (r.status === 404 || r.status === 400) return { achou: false };
    if (!r.ok) return { falhou: true };
    const d = ler(await r.json());
    return d ? { achou: true, dados: d } : { achou: false };
  } catch (e) { return { falhou: true }; }
  finally { if (t) clearTimeout(t); }
}

/**
 * Consulta um CNPJ. Nunca lança erro. Devolve
 * { ok: true, encontrado: true, dados: { razao, fantasia, rua, complemento, bairro, cidade, uf, cep, telefone, email, situacao }, origem }
 * { ok: true, encontrado: false }            (nenhuma fonte conhece o CNPJ)
 * { ok: false, erro, invalido? | semRede? }  (CNPJ inválido, sem internet ou serviços fora)
 */
export async function consultarCnpj(cnpj) {
  const c = soDig(cnpj);
  if (c.length !== 14 || !validaCNPJ(c)) return { ok: false, invalido: true, erro: "CNPJ inválido." };
  if (vistos.has(c)) return { ok: true, encontrado: true, dados: vistos.get(c), origem: "guardado" };
  const g = guardados()[c];
  if (g && g.razao) { vistos.set(c, g); return { ok: true, encontrado: true, dados: g, origem: "guardado" }; }
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { ok: false, semRede: true, erro: "Sem internet agora." };
  let respondeu = false;
  for (const [nome, url, ler] of FONTES) {
    const r = await pedir(url(c), ler);
    if (r.achou) { vistos.set(c, r.dados); guardar(c, r.dados); return { ok: true, encontrado: true, dados: r.dados, origem: nome }; }
    if (!r.falhou) respondeu = true;
  }
  return respondeu ? { ok: true, encontrado: false } : { ok: false, semRede: true, erro: "Não deu para buscar o CNPJ agora." };
}

const vazio = v => v === "" || v === null || v === undefined || !String(v).trim();
const igual = (a, b) => limpo(a).toLowerCase() === limpo(b).toLowerCase();
/**
 * O que da consulta entra no formulário: só campo em branco, campo que a busca anterior preencheu ou valor padrão (ex.: Colatina/ES).
 * mapa: { campoDoFormulario: valorDaConsulta }. Devolve só os campos a preencher.
 */
export function soEmBranco(atual, mapa, anterior = {}, padrao = {}) {
  const o = {};
  for (const k of Object.keys(mapa)) {
    const novo = mapa[k]; if (vazio(novo) || igual(atual[k], novo)) continue;
    if (vazio(atual[k]) || (anterior[k] !== undefined && igual(atual[k], anterior[k])) || (padrao[k] !== undefined && igual(atual[k], padrao[k]))) o[k] = novo;
  }
  return o;
}
/** Tira do formulário o que a consulta tinha posto e a pessoa não mexeu (o CNPJ foi trocado); padrao devolve o valor padrão do campo */
export function tirarPostos(atual, postos, padrao = {}) {
  const o = {};
  for (const k of Object.keys(postos || {})) if (igual(atual[k], postos[k])) o[k] = padrao[k] !== undefined ? padrao[k] : "";
  return o;
}

/**
 * A busca pelo CNPJ numa tela (fornecedor, cliente, Nova O.S., orçamento e agenda).
 *   falta — a tela NÃO tem os dados: CNPJ fora do cadastro e nome/razão em branco;
 *   onDados(dados) — achou a empresa: a tela preenche o que está em branco;
 *   onTrocou()     — o CNPJ mudou depois de um preenchimento: a tela tira o que a consulta tinha posto.
 * Devolve { estado: "" | "buscando" | "achou" | "nao" | "erro", texto }.
 */
export function useCNPJ(doc, { falta, onDados, onTrocou } = {}) {
  const [c, setC] = useState({ estado: "", texto: "", cnpj: "" });
  const fn = useRef(null); fn.current = { onDados, onTrocou };
  const feito = useRef(""), tentado = useRef(""), vivo = useRef(true);
  useEffect(() => () => { vivo.current = false; }, []);
  const d = soDig(doc), valido = d.length === 14 && validaCNPJ(d), ativo = !!(falta && valido);
  const noCampo = useRef(d); noCampo.current = d;
  useEffect(() => {   // o CNPJ mudou: o que veio do CNPJ antigo sai dos campos
    if (feito.current && feito.current !== d) { feito.current = ""; fn.current.onTrocou && fn.current.onTrocou(); }
    if (tentado.current && tentado.current !== d) tentado.current = "";
  }, [d]);
  useEffect(() => {
    if (!ativo || tentado.current === d) { setC(x => (x.estado === "buscando" ? { estado: "", texto: "", cnpj: "" } : x)); return; }
    let aqui = true;
    const t = setTimeout(async () => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;   // sem internet: segue à mão, sem aviso
      setC({ estado: "buscando", texto: "Buscando os dados da empresa pelo CNPJ…", cnpj: d });
      const r = await consultarCnpj(d);
      if (!aqui || !vivo.current || noCampo.current !== d) return;                    // o CNPJ foi trocado enquanto buscava
      tentado.current = d;
      if (r.ok && r.encontrado) {
        feito.current = d; fn.current.onDados && fn.current.onDados(r.dados);
        const sit = r.dados.situacao && r.dados.situacao !== "ATIVA" ? " Atenção: na Receita a empresa está " + r.dados.situacao + "." : "";
        setC({ estado: "achou", texto: "Dados da empresa preenchidos pelo CNPJ. Confira." + sit, cnpj: d });
      } else if (r.ok) setC({ estado: "nao", texto: "A consulta não achou este CNPJ. Preencha os dados à mão.", cnpj: d });
      else if (r.semRede && typeof navigator !== "undefined" && navigator.onLine === false) setC({ estado: "", texto: "", cnpj: d });
      else setC({ estado: "erro", texto: "Não deu para buscar o CNPJ agora. Preencha os dados à mão.", cnpj: d });
    }, 500);
    return () => { aqui = false; clearTimeout(t); };
  }, [d, ativo]);
  return c.cnpj === d ? c : { estado: "", texto: "", cnpj: d };
}

/** Linha de aviso da busca pelo CNPJ */
export function CnpjAviso({ c }) {
  if (!c || !c.estado || !c.texto) return null;
  return html`<div class="placa-linha cpf-linha"><span class="dica placa-aviso cnpj-aviso" role="status" data-cnpj=${c.estado}>${c.texto}</span></div>`;
}
