// DTCar Gestão — função "placa": dados do veículo pela placa no API Placas (apiplacas.com.br; a API é a WDAPI, wdapi2.com.br/v3).
//
// Ações (POST com { acao, placa, forcar? }):
//   basico    — marca, modelo, anos, cor, combustível e motor (cilindrada). Qualquer pessoa da equipe (e_membro).
//   completa  — o básico + chassi, Renavam e número do motor. SÓ o administrador (e_admin) — regra do Danilo, 14/11/2026.
//   saldo     — saldo e preços da conta no API Placas (não cobra). Só administrador.
//
// REGRA DO DANILO (13/11/2026): só vai à API quando o sistema ainda não tem os dados. Ordem:
//   1º o cadastro de veículos — básica: já tem marca, modelo, ano, cor e combustível; completa: já tem chassi e Renavam →
//      responde dele, sem pagar;
//   2º a cópia das consultas já pagas (tabela placa_consultas, v55): a mesma placa não é paga duas vezes — a básica vale
//      180 dias, a completa 365 (a completa também serve de básica — mas chassi, Renavam e nº do motor da cópia só saem
//      para o administrador: para o resto da equipe o pedido básico devolve só o básico);
//   3º só então a API (paga).
// "forcar: true" (botão "Consultar de novo", só na completa) pula o cadastro e a cópia.
// A resposta diz de onde veio: origem = "cadastro" | "copia" | "api". Veículo que está no cadastro mas com dado faltando:
// a resposta traz também "no_cadastro" (o que o cadastro tem) e "veiculo_id".
//
// Trava de gasto: no máximo PLACA_LIMITE_DIA consultas pagas por dia (padrão 100), para um erro de tela nunca esvaziar o saldo.
// Placa não encontrada e erros não são cobrados pela API e não entram na cópia.
// Depois de cada consulta paga a função pergunta o saldo (rota /saldo, sem custo) e guarda o valor cobrado e o
// saldo que sobrou (a tela Ajustes mostra; a resposta leva "saldo_centavos" para o aviso de saldo acabando).
// COMPLETA (visto na 1ª consulta de verdade, MST2E41 em 14/11/2026): custa R$ 0,20, mas o API Placas desconta em duas vezes
// (R$ 0,03 na hora, R$ 0,17 logo depois) e a rota /saldo informava R$ 0,03 como preço dela. Por isso: (a) o valor da completa
// nunca fica abaixo do da tabela (PRECO_PADRAO); (b) a função lê o saldo ANTES de pagar e grava, no máximo, saldo de antes − valor.
// A cópia guarda a resposta inteira da API ("resposta"): os dados são montados de novo a cada leitura, então melhorar a
// conversão aqui vale também para as consultas antigas.
//
// Os dados saem no jeito do cadastro da oficina: marca por extenso ("VW" → "Volkswagen"), modelo em maiúsculas,
// cor com inicial maiúscula ("PRATA" → "Prata"), combustível da lista do cadastro ("Alcool / Gasolina" → "Flex"),
// motor pela cilindrada (1598 → "1.6").
//
// Segredos (Supabase › Edge Functions › Secrets; nunca no repositório):
//   API_PLACAS_TOKEN   a chave do painel do API Placas (apiplacas.com.br/dashboard)
//   PLACA_LIMITE_DIA   opcional (número)
// Publicar com "Verify JWT" desligado (a função confere o login).
import { withSupabase } from "npm:@supabase/server@1.9.2";

export const BASE = "https://wdapi2.com.br/v3";
// O site espera no máximo 15 s por resposta (fetchComLimite em js/api.js): a consulta e o saldo, somados, ficam abaixo disso.
// Na completa há mais uma leitura de saldo, antes de pagar (LIMITE_SALDO_ANTES_MS): 1,5 + 9 + 2,5 = 13 s.
const LIMITE_MS = 9000, LIMITE_SALDO_MS = 2500, LIMITE_SALDO_ANTES_MS = 1500;
const VALIDADE_DIAS = { basico: 180, completa: 365 } as const;
/** centavos (tabela de valores do API Placas em 13/11/2026, confirmada pelo Danilo em 14/11/2026: a completa é R$ 0,20).
 *  A básica vale o que a rota /saldo informar; a completa, o maior entre o informado e este (ver o cabeçalho). Mudou o preço lá? Mude aqui. */
export const PRECO_PADRAO = { basico: 3, completa: 20 } as const;
const COMBUSTIVEIS = ["Flex", "Gasolina", "Etanol", "Diesel", "GNV", "Híbrido", "Elétrico"];

export type Tipo = "basico" | "completa";
export type Dados = Record<string, string | number | null>;
// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;
export class ErroUso extends Error {}
/** Falta uma parte da instalação (o SQL do v55): as telas tratam como "consulta ainda não ligada" */
export class Desligada extends Error {}

const json = (corpo: unknown, status = 200) => Response.json(corpo, { status });
export const normPlaca = (p: unknown) => String(p ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 7);
export const placaValida = (p: string) => /^[A-Z]{3}\d[A-Z\d]\d{2}$/.test(p);
const txt = (s: unknown) => (typeof s === "string" || typeof s === "number" ? String(s) : "").replace(/\s+/g, " ").trim();
const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** "MERCEDES-BENZ" → "Mercedes-Benz", "PRATA" → "Prata" */
export const titulo = (s: unknown) => txt(s).toLowerCase().replace(/(^|[\s\-/.(])(\p{L})/gu, (_m, a, b) => a + b.toUpperCase());

/** Combustível do Detran ("Alcool / Gasolina", "Gasolina/GNV"…) na lista do cadastro (COMBUSTIVEIS de js/regras.js) */
export function combustivelDe(s: unknown): string {
  const t = sem(txt(s));
  if (!t) return "";
  if (/eletric/.test(t) && /gasol|alcool|etanol|flex|diesel|hibrid/.test(t)) return "Híbrido";
  if (/hibrid/.test(t)) return "Híbrido";
  if (/eletric/.test(t)) return "Elétrico";
  if (/gnv|gas natural|gas metano/.test(t)) return "GNV";
  if (/diesel/.test(t)) return "Diesel";
  if (/flex/.test(t) || (/alcool|etanol/.test(t) && /gasol/.test(t))) return "Flex";
  if (/gasol/.test(t)) return "Gasolina";
  if (/alcool|etanol/.test(t)) return "Etanol";
  return COMBUSTIVEIS.find((c) => sem(c) === t) || "";
}

/** Marcas como a oficina escreve (a chave é a sigla do Detran só com letras e números) */
const MARCAS: Record<string, string> = {
  VW: "Volkswagen", VOLKSWAGEN: "Volkswagen", VOLKS: "Volkswagen", GM: "Chevrolet", CHEV: "Chevrolet", CHEVROLET: "Chevrolet", GMCHEVROLET: "Chevrolet",
  MBENZ: "Mercedes-Benz", MERCEDESBENZ: "Mercedes-Benz", MERCEDES: "Mercedes-Benz", MB: "Mercedes-Benz", LR: "Land Rover", LROVER: "Land Rover", LANDROVER: "Land Rover",
  CITROEN: "Citroën", MMC: "Mitsubishi", KIAMOTORS: "Kia", HDAVIDSON: "Harley-Davidson", HARLEYDAVIDSON: "Harley-Davidson", HARLEY: "Harley-Davidson",
  CAOACHERY: "Caoa Chery", SSANGYONG: "SsangYong", ALFAROMEO: "Alfa Romeo", AROMEO: "Alfa Romeo",
};
/** Marcas que são sigla e ficam em maiúsculas */
const SIGLAS = new Set(["BMW", "JAC", "BYD", "GWM", "RAM", "MG", "KTM", "MAN", "DAF", "JCB", "DS", "GMC", "MV"]);
/** Tira o prefixo do Detran: "I/" e "IMP/" (importado), "R/" (reboque) */
const semPrefixo = (s: string) => s.replace(/^(I|IMP|R)\s*\/\s*/i, "");
export function marcaDe(s: unknown): string {
  let m = semPrefixo(txt(s).toUpperCase()).trim();
  if (m.includes(" - ")) m = m.split(" - ")[0].trim();   // "VW - VolksWagen" (jeito da tabela FIPE)
  const chave = sem(m).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!chave) return "";
  return MARCAS[chave] || (SIGLAS.has(chave) ? chave : titulo(m));
}

/** Cilindrada vira o texto do campo Motor do cadastro: 1598 → "1.6"; "1.6" e "2,0" ficam como estão */
export function motorDe(cil: unknown): string {
  const t = txt(cil).replace(",", ".");
  const dec = t.match(/^(\d{1,2})\.(\d)\d?$/);
  if (dec) return dec[1] + "." + dec[2];
  const cc = Number(t.replace(/\D/g, ""));
  if (!(/^\d{2,5}(\s*(cc|cm3|cm³))?$/i.test(t) && cc >= 50 && cc <= 20000)) return "";
  return cc < 500 ? cc + " cc" : (Math.round(cc / 100) / 10).toFixed(1);   // moto: 149 cc (em litros ficaria "0.1")
}

const CORES: Record<string, string> = { GRENA: "Grená" };
export const corDe = (s: unknown) => { const t = txt(s); return CORES[sem(t).toUpperCase()] || titulo(t); };

const ano = (s: unknown, agora = new Date()) => { const n = Number(txt(s).replace(/\D/g, "").slice(0, 4)); return n >= 1900 && n <= agora.getFullYear() + 1 ? n : null; };
/** Texto de exemplo da documentação ("exemplo") ou vazio não é dado */
const dado = (s: unknown) => { const t = txt(s); return /^exemplo$/i.test(t) ? "" : t; };

/** Chaves em minúsculas (a API já usou "MARCA", "marcaModelo", "anoModelo"…: ler sem depender da caixa) */
const baixo = (o: unknown): Json => (o && typeof o === "object" && !Array.isArray(o) ? Object.fromEntries(Object.entries(o as Json).map(([k, v]) => [k.toLowerCase(), v])) : {});

/** Resposta da API → dados no formato do cadastro de veículos (veiculos: marca, modelo, ano_fab, ano_mod, cor, combustivel, motor, chassi, renavam) */
export function normalizar(r: Json | null | undefined, tipo: Tipo): Dados {
  const b = baixo(r && r.basico && r.basico.dados), e = baixo(b.extra);   // "extra": onde a versão antiga da API punha os dados do Detran
  // "VW/CROSSFOX"; importado vem "I/TOYOTA HILUX CD4X4" (sem barra entre a marca e o modelo)
  const mm = semPrefixo(txt(b.marcamodelo));
  const [mmMarca, mmModelo] = mm.includes("/") ? [mm.split("/")[0], mm.split("/").slice(1).join("/")] : [mm.split(" ")[0] || "", mm.split(" ").slice(1).join(" ")];
  const fab = ano(b.ano) ?? ano(e.ano_fabricacao), mod = ano(b.anomodelo) ?? ano(e.ano_modelo);
  const fim = dado(b.final_chassi), comb = dado(b.combustivel) || dado(e.combustivel);
  const d: Dados = {
    marca: marcaDe(dado(b.marca) || mmMarca),
    modelo: (dado(b.modelo) || txt(mmModelo)).toUpperCase(),
    ano_fab: fab ?? mod, ano_mod: mod ?? fab,
    cor: corDe(dado(b.cor)),
    combustivel: combustivelDe(comb),
    combustivel_detran: comb,
    motor: motorDe(dado(b.cilindradas) || dado(e.cilindradas)),
    municipio: dado(b.municipio) || dado(e.municipio), uf: (dado(b.uf) || dado(e.uf_placa)).toUpperCase(),
    tipo: dado(b.tipoveiculo) || dado(b.tipo) || dado(e.tipo_veiculo), especie: dado(b.especie) || dado(e.especie),
    final_chassi: /^[A-HJ-NPR-Z0-9]{4,8}$/i.test(fim) && !/^0+$/.test(fim) ? fim.toUpperCase() : "",
  };
  if (tipo === "completa") {
    const bloco = (n: string) => txt(baixo(baixo(baixo(r)[n]).dados)[n]);
    const ch = (bloco("chassi") || txt(e.chassi)).replace(/\s/g, "").toUpperCase();
    const rv = (bloco("renavam") || txt(e.renavam)).replace(/\D/g, "");
    const mo = (bloco("motor") || txt(e.motor)).toUpperCase();
    d.chassi = /^[A-HJ-NPR-Z0-9]{17}$/.test(ch) ? ch : "";
    d.renavam = rv.length >= 9 && rv.length <= 11 ? rv : "";
    d.motor_numero = /^exemplo$/i.test(mo) ? "" : mo;
  }
  return d;
}
/** A consulta trouxe pelo menos a marca ou o modelo? (sem isso não há o que preencher) */
export const temVeiculo = (d: Dados) => !!d.marca || !!d.modelo;

/** Mensagem da API em português para a tela. Vale primeiro o código do erro ("codigo") e depois o número da resposta. */
export function erroDaApi(status: number, c: Json | null): { encontrado?: false; erro?: string; desligada?: true; sem_saldo?: true } {
  const cod = String((c && c.codigo) || "");
  if (cod === "placa_nao_encontrada" || (status === 404 && !cod)) return { encontrado: false };
  if (status === 402 || cod === "saldo_insuficiente") return { sem_saldo: true, erro: "Acabou o saldo da consulta de placa (API Placas). Coloque saldo no painel apiplacas.com.br para voltar a buscar." };
  if (status === 401 || cod === "nao_autorizado") return { desligada: true, erro: "A chave do API Placas não foi aceita. Confira o segredo API_PLACAS_TOKEN da função \"placa\" no Supabase." };
  if (cod === "placa_invalida") return { erro: "Placa inválida. Use o formato ABC1234 ou ABC1D23." };
  if (cod === "parametro_invalido") {
    const tem = Array.isArray(c && c.blocos_disponiveis) ? " Liberados: " + (c!.blocos_disponiveis as string[]).join(", ") + "." : "";
    return { erro: "Este tipo de consulta não está liberado na sua conta do API Placas." + tem };
  }
  if (status >= 500 || cod === "servico_indisponivel" || cod === "erro_interno") return { erro: "A consulta de placa está fora do ar agora. Tente daqui a pouco." };
  return { erro: "O API Placas respondeu: " + (txt(c && c.message) || "erro " + status).replace(/\.$/, "") + "." };
}

/** O veículo do cadastro no mesmo formato da consulta */
export function doCadastro(v: Json): Dados {
  const n = (x: unknown) => { const k = Number(x); return k > 0 ? k : null; };
  return { marca: txt(v.marca), modelo: txt(v.modelo), ano_fab: n(v.ano_fab) ?? n(v.ano_mod), ano_mod: n(v.ano_mod) ?? n(v.ano_fab), cor: txt(v.cor), combustivel: txt(v.combustivel),
    motor: txt(v.motor), chassi: txt(v.chassi).replace(/\s/g, "").toUpperCase(), renavam: txt(v.renavam).replace(/\D/g, "") };
}
/** Dados já guardados (cópia sem a resposta inteira) só com o que o tipo pedido pode ver: a básica não leva chassi, Renavam nem nº do motor */
export function soDoTipo(d: Dados, tipo: Tipo): Dados {
  if (tipo === "completa" || !d) return d;
  const { chassi: _c, renavam: _r, motor_numero: _m, ...resto } = d;
  return resto;
}
/** O cadastro já tem tudo o que a básica traria? (motor/cilindrada não conta: é detalhe) */
export const temBasico = (d: Dados) => !!d.marca && !!d.modelo && !!(d.ano_fab || d.ano_mod) && !!d.cor && !!d.combustivel;
/** O cadastro já tem o que a completa traz a mais? (chassi e Renavam) */
export const temCompleta = (d: Dados) => !!d.marca && !!d.modelo && String(d.chassi || "").length === 17 && String(d.renavam || "").length >= 9;

/** Saldo e preços na resposta da rota /saldo */
export function lerSaldo(c: Json | null): { saldo_centavos: number | null; saldo_formatado: string; consultas_disponiveis: number | null; preco: { basico: number; completa: number } } {
  const int = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? Math.round(x) : null);
  const preco = (x: unknown, padrao: number) => { const n = int(x); return n !== null && n >= 1 && n <= 1000 ? n : padrao; };
  const p: Json = (c && c.precos) || {};
  const saldo = int(c && c.saldo_centavos);
  return { saldo_centavos: saldo, saldo_formatado: txt(c && c.saldo_formatado) || (saldo === null ? "" : "R$ " + (saldo / 100).toFixed(2).replace(".", ",")),
    consultas_disponiveis: int(c && c.consultas_disponiveis),
    preco: { basico: preco(p.consulta_centavos ?? (c && c.preco_consulta_centavos), PRECO_PADRAO.basico),
      // a rota já informou R$ 0,03 para a completa, que custa R$ 0,20 (14/11/2026): nunca abaixo da tabela
      completa: Math.max(preco(p.endpoints && p.endpoints["/v3/completa"] && p.endpoints["/v3/completa"].centavos, PRECO_PADRAO.completa), PRECO_PADRAO.completa) } };
}

export type Linha = { placa: string; tipo: Tipo; dados: Dados; resposta?: Json | null; em: string };
export type Deps = {
  papel: { membro: boolean; gestor: boolean; admin: boolean };
  usuario: string | null;
  token: string | undefined;
  limiteDia: number;
  /** o veículo no cadastro (tabela veiculos), lido com o login de quem pediu */
  cadastro: (placa: string) => Promise<Json | null>;
  copia: (placa: string, tipos: Tipo[], desde: string) => Promise<Linha | null>;
  pagasHoje: () => Promise<number>;
  guardar: (l: { placa: string; tipo: Tipo; dados: Dados; resposta: Json; valor_centavos: number; saldo_centavos: number | null; por: string | null }) => Promise<void>;
  fetch: typeof fetch;
  agora?: () => Date;
};

async function chamar(deps: Deps, caminho: string, limite = LIMITE_MS): Promise<{ status: number; corpo: Json | null }> {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), limite);
  try {
    const r = await deps.fetch(BASE + caminho, { headers: { authorization: "Bearer " + deps.token, accept: "application/json" }, signal: ac.signal });
    const corpo = await r.json().catch(() => null);
    return { status: r.status, corpo };
  } catch (_e) {
    throw new Error("O API Placas não respondeu a tempo. Tente daqui a pouco.");
  } finally { clearTimeout(t); }
}

const SEM_CHAVE = { ok: false, desligada: true, erro: "A consulta de placa ainda não foi ligada: falta a chave do API Placas (segredo API_PLACAS_TOKEN da função \"placa\" no Supabase)." };

export async function executar(corpo: Record<string, unknown>, deps: Deps): Promise<Record<string, unknown>> {
  const acao = String(corpo.acao || "");
  if (!deps.papel.membro) throw new ErroUso("Seu acesso ainda não foi liberado.");
  if (acao === "saldo") {
    if (!deps.papel.admin) throw new ErroUso("Só o administrador vê o saldo do API Placas.");
    if (!deps.token) return { ...SEM_CHAVE, limite_dia: deps.limiteDia };
    const r = await chamar(deps, "/saldo");
    if (r.status !== 200) return { ok: false, ...erroDaApi(r.status, r.corpo), limite_dia: deps.limiteDia };
    return { ok: true, ...lerSaldo(r.corpo), limite_dia: deps.limiteDia, pagas_hoje: await deps.pagasHoje() };
  }
  if (acao !== "basico" && acao !== "completa") throw new ErroUso("Ação desconhecida: " + acao);
  const tipo = acao as Tipo;
  if (tipo === "completa" && !deps.papel.admin) throw new ErroUso("A consulta completa é só para o administrador.");
  const placa = normPlaca(corpo.placa);
  if (!placaValida(placa)) throw new ErroUso("Placa inválida. Use o formato ABC1234 ou ABC1D23.");

  const agora = (deps.agora || (() => new Date()))();
  const desde = (dias: number) => new Date(agora.getTime() - dias * 864e5).toISOString();
  const forcar = corpo.forcar === true && tipo === "completa";
  // 1º o cadastro: já temos os dados? então não paga
  const v = await deps.cadastro(placa);
  const doCad = v ? doCadastro(v) : null;
  const cad = doCad ? { veiculo_id: v!.id ?? null, no_cadastro: doCad } : {};
  if (!forcar) {
    if (doCad && (tipo === "basico" ? temBasico(doCad) : temCompleta(doCad))) {
      return { ok: true, encontrado: true, placa, tipo, dados: doCad, origem: "cadastro", veiculo_id: v!.id ?? null, valor_centavos: 0 };
    }
    // 2º a cópia das consultas já pagas
    const c = tipo === "basico"
      ? (await deps.copia(placa, ["completa"], desde(VALIDADE_DIAS.completa))) || (await deps.copia(placa, ["basico"], desde(VALIDADE_DIAS.basico)))
      : await deps.copia(placa, ["completa"], desde(VALIDADE_DIAS.completa));
    if (c) {
      // a cópia da completa serve de básica, mas o que só a completa traz (chassi, Renavam, nº do motor) sai só para o administrador
      const como: Tipo = c.tipo === "completa" && !deps.papel.admin ? "basico" : c.tipo;
      const dados = c.resposta && c.resposta.basico ? normalizar(c.resposta, como) : soDoTipo(c.dados, como);
      // consulta paga que veio sem marca e modelo: não paga de novo; quando a conversão melhorar, a mesma cópia passa a servir
      if (!temVeiculo(dados)) return { ok: true, encontrado: false, placa, origem: "copia", em: c.em, valor_centavos: 0 };
      return { ok: true, encontrado: true, placa, tipo: como, dados, origem: "copia", em: c.em, valor_centavos: 0, ...cad };
    }
  }

  // 3º a API (paga)
  if (!deps.token) return { ...SEM_CHAVE, placa };
  if ((await deps.pagasHoje()) >= deps.limiteDia) {
    return { ok: false, placa, erro: `Limite de ${deps.limiteDia} consultas pagas por dia atingido (proteção do saldo). Amanhã volta a funcionar.` };
  }
  // completa: o saldo de ANTES (rota sem custo), porque o desconto dela não aparece inteiro na leitura de depois (ver o cabeçalho)
  let saldoAntes: number | null = null;
  if (tipo === "completa") {
    try { const s = await chamar(deps, "/saldo", LIMITE_SALDO_ANTES_MS); if (s.status === 200) saldoAntes = lerSaldo(s.corpo).saldo_centavos; } catch (_e) { /* segue sem o saldo de antes */ }
  }
  const r = await chamar(deps, "/" + tipo + "/" + placa);
  if (r.status !== 200 || !r.corpo || r.corpo.error === true) {
    // resposta 200 com "error: true" e sem código conhecido: trata como falha do serviço
    const e = erroDaApi(r.status === 200 && !(r.corpo && r.corpo.codigo) ? (r.corpo && r.corpo.message ? 400 : 502) : r.status, r.corpo);
    return { ok: e.encontrado === false, placa, ...e };
  }
  const blocoBasico = r.corpo.basico;
  if (!blocoBasico || blocoBasico.error === true || !blocoBasico.dados) return { ok: true, placa, encontrado: false };
  const dados = normalizar(r.corpo, tipo);
  // saldo que sobrou e o preço (rota sem custo); se não responder, fica o preço da tabela
  let valor: number = PRECO_PADRAO[tipo], saldo: number | null = null;
  try { const s = await chamar(deps, "/saldo", LIMITE_SALDO_MS); if (s.status === 200) { const l = lerSaldo(s.corpo); valor = l.preco[tipo]; saldo = l.saldo_centavos; } } catch (_e) { /* fica o preço da tabela */ }
  // completa: o saldo gravado nunca passa do saldo de antes menos o valor dela (a leitura de depois ainda não tem o desconto inteiro)
  if (saldoAntes !== null) saldo = Math.max(0, Math.min(saldo ?? saldoAntes, saldoAntes - valor));
  // a API respondeu com o bloco básico: a consulta foi cobrada. Guarda SEMPRE (mesmo sem marca e modelo, para não pagar de novo
  // pela mesma placa e poder corrigir a conversão depois, já que a resposta inteira fica guardada).
  await deps.guardar({ placa, tipo, dados, resposta: r.corpo, valor_centavos: valor, saldo_centavos: saldo, por: deps.usuario });
  if (!temVeiculo(dados)) {
    console.error("placa: resposta sem marca e modelo; campos recebidos:", Object.keys(blocoBasico.dados || {}).join(","));
    return { ok: true, placa, encontrado: false, origem: "api", valor_centavos: valor, saldo_centavos: saldo };
  }
  return { ok: true, encontrado: true, placa, tipo, dados, origem: "api", em: agora.toISOString(), valor_centavos: valor, saldo_centavos: saldo, ...cad };
}

// deno-lint-ignore no-explicit-any
type Db = any;
/** O banco ainda não tem a tabela das consultas (o Danilo ainda não rodou o supabase/v55.sql)? */
const semTabela = (e: { code?: string; message?: string }) => e.code === "PGRST205" || e.code === "42P01"
  || (/placa_consultas/.test(e.message || "") && /does not exist|schema cache|find the table/i.test(e.message || ""));
const FALTA_V55 = "A consulta de placa ainda não foi ligada: falta rodar o supabase/v55.sql no SQL Editor do Supabase.";
export function depsDoBanco(adm: Db, usuario: Db, agora = () => new Date()): Pick<Deps, "cadastro" | "copia" | "pagasHoje" | "guardar"> {
  return {
    cadastro: async (placa) => {
      const { data, error } = await usuario.from("veiculos").select("id,placa,marca,modelo,ano_fab,ano_mod,cor,combustivel,motor,chassi,renavam").eq("placa", placa).maybeSingle();
      if (error) throw new Error("Falha ao ler o cadastro do veículo: " + error.message);
      return data || null;
    },
    copia: async (placa, tipos, desde) => {
      const { data, error } = await adm.from("placa_consultas").select("placa,tipo,dados,resposta,em").eq("placa", placa).in("tipo", tipos)
        .gte("em", desde).order("em", { ascending: false }).limit(1);
      if (error) { if (semTabela(error)) throw new Desligada(FALTA_V55); throw new Error("Falha ao ler a cópia das consultas: " + error.message); }
      return (data && data[0]) || null;
    },
    pagasHoje: async () => {
      const inicio = new Date(agora().getTime() - 3 * 36e5); inicio.setUTCHours(0, 0, 0, 0);   // meia-noite de Brasília (UTC−3)…
      const { count, error } = await adm.from("placa_consultas").select("id", { count: "exact", head: true }).gte("em", new Date(inicio.getTime() + 3 * 36e5).toISOString());   // …em UTC
      if (error) { if (semTabela(error)) throw new Desligada(FALTA_V55); throw new Error("Falha ao conferir o limite do dia: " + error.message); }
      return count || 0;
    },
    guardar: async (l) => {
      const { error } = await adm.from("placa_consultas").insert(l);
      if (error) console.error("placa: não guardou a cópia", error.message);   // a consulta já foi paga: devolve os dados mesmo assim
    },
  };
}

export const atender = withSupabase({ auth: "user" }, async (req, ctx) => {
  if (req.method !== "POST") return json({ erro: "Use POST." }, 405);
  const corpo = await req.json().catch(() => ({})) as Record<string, unknown>;
  try {
    const [m, g, a] = await Promise.all(["e_membro", "e_gestor", "e_admin"].map((f) => ctx.supabase.rpc(f)));
    const limite = Number(Deno.env.get("PLACA_LIMITE_DIA") || 100);
    return json(await executar(corpo, {
      papel: { membro: m.data === true, gestor: g.data === true, admin: a.data === true }, usuario: (ctx.userClaims && ctx.userClaims.id) || null,
      token: (Deno.env.get("API_PLACAS_TOKEN") || "").trim() || undefined, limiteDia: limite > 0 ? limite : 100, fetch, ...depsDoBanco(ctx.supabaseAdmin, ctx.supabase),
    }));
  } catch (e) {
    if (e instanceof ErroUso) return json({ ok: false, erro: e.message }, 400);
    if (e instanceof Desligada) return json({ ok: false, desligada: true, erro: e.message }, 200);
    console.error("placa", e);
    return json({ ok: false, erro: (e as Error).message || "Falha na consulta da placa." }, 200);
  }
});

if (import.meta.main) Deno.serve((req) => atender(req));
