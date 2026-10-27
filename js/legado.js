// Conversão do backup do OS Oficina 3.0 (tabelas DBF) para o formato do DTCar Gestão.
// Os ids são determinísticos (UUID v5): rodar de novo atualiza em vez de duplicar.
const NS = "6f1c2a0e-3d4b-4c55-9a77-1d2c3b4a5e6f";
const hex = b => [...b].map(x => x.toString(16).padStart(2, "0")).join("");
const nsBytes = Uint8Array.from(NS.replace(/-/g, "").match(/../g).map(h => parseInt(h, 16)));
// SHA-1 em JavaScript puro (funciona também fora de HTTPS, onde crypto.subtle não existe)
function sha1(bytes) {
  const ml = bytes.length, nb = ((ml + 8) >> 6) + 1, w = new Uint32Array(nb * 16);
  for (let i = 0; i < ml; i++) w[i >> 2] |= bytes[i] << (24 - (i % 4) * 8);
  w[ml >> 2] |= 0x80 << (24 - (ml % 4) * 8); w[nb * 16 - 1] = ml * 8;
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const W = new Uint32Array(80), rol = (x, n) => (x << n) | (x >>> (32 - n));
  for (let b = 0; b < nb * 16; b += 16) {
    for (let t = 0; t < 80; t++) W[t] = t < 16 ? w[b + t] : rol(W[t - 3] ^ W[t - 8] ^ W[t - 14] ^ W[t - 16], 1);
    let a = h0, bb = h1, c = h2, d = h3, e = h4;
    for (let t = 0; t < 80; t++) {
      const f = t < 20 ? (bb & c) | (~bb & d) : t < 40 ? bb ^ c ^ d : t < 60 ? (bb & c) | (bb & d) | (c & d) : bb ^ c ^ d;
      const k = t < 20 ? 0x5a827999 : t < 40 ? 0x6ed9eba1 : t < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const tmp = (rol(a, 5) + f + e + k + W[t]) >>> 0; e = d; d = c; c = rol(bb, 30) >>> 0; bb = a; a = tmp;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + bb) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  const out = new Uint8Array(20); [h0, h1, h2, h3, h4].forEach((h, i) => { out[i * 4] = h >>> 24; out[i * 4 + 1] = (h >>> 16) & 255; out[i * 4 + 2] = (h >>> 8) & 255; out[i * 4 + 3] = h & 255; });
  return out;
}
const cacheUid = new Map();
async function uuid5(nome) {
  if (cacheUid.has(nome)) return cacheUid.get(nome);
  const n = new TextEncoder().encode(nome), buf = new Uint8Array(nsBytes.length + n.length);
  buf.set(nsBytes); buf.set(n, nsBytes.length);
  const h = sha1(buf).slice(0, 16);
  h[6] = (h[6] & 0x0f) | 0x50; h[8] = (h[8] & 0x3f) | 0x80;
  const x = hex(h), id = `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
  cacheUid.set(nome, id); return id;
}
const uid = (tipo, chave) => uuid5(`${tipo}-${chave}`);

const s = v => typeof v === "string" ? v.replace(/\t/g, " ").replace(/\s+/g, " ").trim() : (v ?? "");
const dig = v => String(v || "").replace(/\D/g, "");
const MINUS = new Set(["da", "de", "do", "das", "dos", "e"]);
function titulo(t) {
  t = s(t); if (!t) return "";
  return t.toLowerCase().split(/\s+/).map((p, i) => (i && MINUS.has(p)) ? p : (/\p{L}/u.test(p) ? p.charAt(0).toUpperCase() + p.slice(1) : p)).join(" ");
}
const semZero = v => { const t = s(v); return /^[0.\-\/\s]*$/.test(t) ? "" : t; };
const caixa = t => { t = s(t); return t && t === t.toUpperCase() && /\p{L}/u.test(t) ? titulo(t) : t; };
function ts(d, h = "") {
  if (!d) return null;
  let hh = 12, mm = 0; const m = /(\d{1,2}):(\d{2})/.exec(h || "");
  if (m) { hh = Math.min(23, +m[1]); mm = Math.min(59, +m[2]); }
  return `${d}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00-03:00`;
}
const ano = d => d ? +d.slice(0, 4) : 0;
function validaCPF(c) {
  if (c.length !== 11 || new Set(c).size === 1) return false;
  for (const n of [9, 10]) { let t = 0; for (let i = 0; i < n; i++) t += +c[i] * (n + 1 - i); if ((t * 10) % 11 % 10 !== +c[n]) return false; }
  return true;
}
function validaCNPJ(c) {
  if (c.length !== 14 || new Set(c).size === 1) return false;
  const dv = n => { const p = n === 12 ? [5,4,3,2,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2]; let t = 0; for (let i = 0; i < n; i++) t += +c[i] * p[i]; const r = t % 11; return r < 2 ? 0 : 11 - r; };
  return dv(12) === +c[12] && dv(13) === +c[13];
}
function tel(...vs) {
  for (const v of vs) {
    let d = dig(v);
    if (d.startsWith("0") && (d.length === 11 || d.length === 12)) d = d.slice(1);
    if (d.length === 10 || d.length === 11) return d;
    if (d.length === 8 || d.length === 9) return "27" + d; // sem DDD: Colatina
  }
  return "";
}
const normPlaca = p => String(p || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 7);
const r2 = n => Math.round((Number(n) || 0) * 100 + Number.EPSILON * 100) / 100;
const anoTxt = (f, m) => { f = Math.trunc(+f || 0); m = Math.trunc(+m || 0); if (f && m && f !== m) return `${f}/${m}`; return String(m || f || ""); };
const COMB = { gasolina: "Gasolina", diesel: "Diesel", deesel: "Diesel", flex: "Flex", alcool: "Etanol", "álcool": "Etanol", etanol: "Etanol", gas: "GNV", gnv: "GNV" };
const comb = c => { const k = s(c).toLowerCase(); return COMB[k] || titulo(c); };
const FORMAS = { avista: "À vista", dinheiro: "Dinheiro", cheque: "Cheque", "promissória": "Promissória", "depósito": "Depósito" };
const forma = f => { f = s(f); const k = f.toLowerCase(); if (FORMAS[k]) return FORMAS[k]; if (k.startsWith("cartão") || k.startsWith("cartao")) return "Cartão de crédito"; return f; };

/** t: { CLIENTES, CLIENTE2, CLIENTE3, TIPOCLI, PLACA, PLACA2, PRODUTOS, ORDEM, ORDEM2, ORDEM3 } (listas de registros) */
export async function converterLegado(t) {
  const rel = {}; const nota = (k, v) => (rel[k] = rel[k] || []).push(v);
  const porCod = (lista, k = "CODCLI") => new Map((lista || []).map(r => [r[k], r]));
  const cli2 = porCod(t.CLIENTE2), cli3 = porCod(t.CLIENTE3), tipos = new Map((t.TIPOCLI || []).map(r => [r.CODIGO, s(r.TIPO)]));

  // ---------------- clientes
  const clientes = [], cliMap = new Map(), docs = new Set();
  for (const r of t.CLIENTES || []) {
    const nome = s(r.NOM);
    if (!nome) { nota("clientes_sem_nome", r.COD); continue; }
    const cpf = dig(r.CPF), cgc = dig(r.CGC);
    let doc = ""; const notas = [];
    for (const d of [cpf, cgc]) {
      if (d && ((d.length === 11 && validaCPF(d)) || (d.length === 14 && validaCNPJ(d)))) {
        if (docs.has(d)) { notas.push(`CPF/CNPJ ${d} repetido no sistema anterior`); nota("doc_repetido", nome); }
        else { doc = d; docs.add(d); }
        break;
      } else if (d) { notas.push(`CPF/CNPJ informado no sistema anterior (inválido): ${d}`); nota("doc_invalido", nome); }
    }
    const rua = s(r.RUA), cpl = s(r.CPL), bai = s(r.BAI), cid = s(r.CID), uf = s(r.UF), cep = s(r.CEP);
    const endereco = [rua + (cpl ? " " + cpl : ""), bai, cid ? titulo(cid) + (uf ? "/" + uf : "") : "", dig(cep) ? "CEP " + cep : ""].filter(Boolean).join(", ");
    const outros = [s(r.TEL1), s(r.TEL2), s(r.TEL3), s(r.CEL)].filter(x => dig(x));
    const telefone = tel(r.CEL, r.TEL1, r.TEL2, r.TEL3);
    const linhasObs = [1, 2, 3, 4, 5, 6, 7].map(i => s(r["OBS" + i])).filter(Boolean);
    // observação como foi gravada na primeira importação (para substituir só se ninguém mexeu)
    const obsAntiga = [...notas, ...(outros.length > 1 ? ["Outros telefones: " + outros.join(" / ")] : []), ...linhasObs, ...(s(r.CTO) ? ["Contato: " + s(r.CTO)] : []), `Importado do OS Oficina 3.0 (código ${r.COD}).`].join(" | ");
    const obs = [...linhasObs, ...notas, `Importado do OS Oficina 3.0 (código ${r.COD}).`].join("\n");
    if (!telefone) nota("cliente_sem_telefone", nome);
    const outrosTel = []; for (const x of [r.CEL, r.TEL1, r.TEL2, r.TEL3]) { const d = dig(x); if (!d || d.length < 8) continue; const v = d.length === 10 || d.length === 11 ? d : s(x); if (!telefone.endsWith(d.slice(-8)) && !outrosTel.some(o => dig(o).endsWith(d.slice(-8)))) outrosTel.push(v); }
    const c2 = cli2.get(r.COD) || {}, c3 = cli3.get(r.COD) || {};
    const ficha = Object.fromEntries(Object.entries({
      sexo: caixa(c2.SEXO), pai: caixa(c2.PAI), mae: caixa(c2.MAE), naturalidade: caixa(c2.NATURAL), nacionalidade: caixa(c2.NACIONAL), estado_civil: caixa(c2.CIVIL),
      conjuge: caixa(c2.CONJUGE), escolaridade: caixa(c2.ESCOLA), profissao: caixa(c2.PROFISSAO), trabalho: caixa(c2.TRABALHO), tel_trabalho: tel(c2.TELTRAB) || s(c2.TELTRAB),
      melhor_horario: s(c2.MELHORHORA), renda: +r.RECEITA || 0, limite: +r.LIMITE || 0, avaliador: caixa(r.AVALIADOR), ocorrencia: s(r.OCORRENCIA),
    }).filter(([, v]) => v !== "" && v !== 0));
    const id = await uid("cli", r.COD); cliMap.set(r.COD, id);
    clientes.push({ id, codigo: r.COD, nome: nome === nome.toUpperCase() ? titulo(nome) : nome, telefone, doc, email: s(r.EMAIL).toLowerCase(), endereco, obs, obs_antiga: obsAntiga,
      nascimento: r.DATANASC || null, origem: "Cliente antigo", criado_em: ts(r.DATA) || "2022-05-01T00:00:00-03:00",
      fantasia: caixa(r.EST), rua: caixa(rua), complemento: caixa(cpl), bairro: caixa(bai), cidade: caixa(cid), uf: uf.toUpperCase(), cep,
      telefone2: outrosTel[0] || "", telefone3: outrosTel[1] || "", contato: caixa(r.CTO), rg: semZero(r.RG), orgao_emissor: s(r.ORGAO).toUpperCase(), ie: semZero(r.IE), im: semZero(r.IM),
      tipo_cliente: titulo(tipos.get(r.CODTIP) || ""), situacao: r.BLOQUEAR ? "bloqueado" : r.RESTRITO ? "restrito" : "liberado", restricao: s(r.RESTRICAO),
      ficha, historico: String(c3.HISTORICO || "").replace(/\r\n/g, "\n").trim() });
  }
  const cliById = new Map(clientes.map(c => [c.id, c]));

  // ---------------- produtos e serviços
  // o sistema anterior repete códigos (até 5 produtos com o mesmo número): identifica por código + descrição
  const produtos = [], prodPorCod = new Map(), vistos = new Set();
  const chaveDesc = d => s(d).toUpperCase().replace(/[^A-Z0-9]/g, "");
  for (const r of t.PRODUTOS || []) {
    const descricao = s(r.DESCRICAO); if (!descricao) continue;
    const k = r.CODIGO + "-" + chaveDesc(descricao); if (vistos.has(k)) continue; vistos.add(k);
    const servico = !!r.SERVICO && !r.PRODUTO, venda = r2(r.P_VENDA);
    const id = await uid("prod", k);
    if (!prodPorCod.has(r.CODIGO)) prodPorCod.set(r.CODIGO, []); prodPorCod.get(r.CODIGO).push({ id, k: chaveDesc(descricao) });
    produtos.push({ id, codigo: r.CODIGO, tipo: servico ? "servico" : "produto", descricao, referencia: s(r.REFERENCIA), codigo_barras: s(r.BARRA), unidade: s(r.UNIDADE).toUpperCase() || "UN",
      categoria: s(r.CATEGORIA), marca: s(r.MARCA), localizacao: s(r.LOCALIZA), estoque_min: +r.QUANT_MINI || 0, estoque_atual: servico ? 0 : (+r.QUANT_ATUA || 0),
      custo: r2(r.P_CUSTO), margem_vista: r2(r.MARGEM), preco_vista: venda, margem_prazo: r2(r.MARGEM2), preco_prazo: r2(r.PRAZO) || venda, margem_atacado: r2(r.MARGEM3), preco_atacado: r2(r.ATACADO) || venda,
      cobranca: "fixo", horas: 0, controla_estoque: !servico, vender_sem_estoque: !r.BLOQUEARD, avisar_estoque_baixo: servico ? false : !!r.AVISOMIN, obs: s(r.MENSAGEM), ativo: true,
      criado_em: ts(r.DATA) || "2022-05-01T00:00:00-03:00" });
  }

  // ---------------- veículos (cadastro PLACA + placas que só aparecem nas O.S.)
  const ordens = t.ORDEM || [];
  const kmOS = new Map();
  for (const o of ordens) { const p = normPlaca(o.PLACA); if (p && o.KM) kmOS.set(p, Math.max(kmOS.get(p) || 0, Math.trunc(o.KM))); }
  const obsPlaca = new Map(); for (const r of t.PLACA2 || []) { const k = s(r.PLACA).toUpperCase() + "|" + r.CODCLI; const v = String(r.OBSERVA || "").replace(/\r\n/g, "\n").trim(); if (v) obsPlaca.set(k, v); }
  const veics = new Map();
  const placas = [...(t.PLACA || [])].map((r, i) => [r, i]).sort((a, b) => (a[0].DATA || "1900-01-01").localeCompare(b[0].DATA || "1900-01-01") || a[1] - b[1]).map(x => x[0]);
  for (const r of placas) {
    const p = normPlaca(r.PLACA);
    if (!p || /^0+$/.test(p)) { nota("placa_vazia", s(r.CLIENTE)); continue; }
    if (!/^[A-Z]{3}\d[A-Z\d]\d{2}$/.test(p)) nota("placa_formato_invalido", p);
    const obsAntiga = [s(r.OBS1), s(r.OBS2), s(r.CHASSI) ? "Chassi: " + s(r.CHASSI) : "", s(r.RENAVAN) ? "Renavam: " + s(r.RENAVAN) : ""].filter(Boolean).join(" | ");
    if (veics.has(p)) nota("placa_repetida", p);
    let memo = obsPlaca.get(p.slice(0, 6) + "|" + r.CODCLI) || "", chassiMemo = "";
    if (normPlaca(memo) === p) memo = ""; // a observação só repetia a placa
    else if (/^[A-HJ-NPR-Z0-9]{17}$/i.test(memo.replace(/\s/g, ""))) { chassiMemo = memo.replace(/\s/g, "").toUpperCase(); memo = ""; }
    veics.set(p, { id: await uid("vei", p), placa: p, marca: titulo(r.MARCA), modelo: s(r.MODELO).toUpperCase(), ano: anoTxt(r.ANOFAB, r.ANOMOD), cor: titulo(r.COR), motor: "",
      cliente_id: cliMap.get(r.CODCLI) || null, km_atual: Math.max(Math.trunc(r.KM || 0), kmOS.get(p) || 0) || null,
      obs: [memo, s(r.OBS1), s(r.OBS2)].filter(Boolean).join("\n"), obs_antiga: obsAntiga, criado_em: ts(r.DATA) || "2022-05-01T00:00:00-03:00",
      ano_fab: Math.trunc(r.ANOFAB || 0) || null, ano_mod: Math.trunc(r.ANOMOD || 0) || Math.trunc(r.ANOFAB || 0) || null, chassi: s(r.CHASSI).toUpperCase() || chassiMemo, renavam: s(r.RENAVAN),
      combustivel: comb(r.COMB), motorista: caixa(r.MOTORISTA),
      revisao_data: r.DATAREV || null, revisao_km: Math.trunc(r.KMREV || 0) || null, oleo_data: r.DATAOLEO || null, oleo_km: Math.trunc(r.KMOLEO || 0) || null,
      filtro_data: r.DATAFILTRO || null, filtro_km: Math.trunc(r.KMFILTRO || 0) || null });
  }
  for (const o of ordens) {
    const p = normPlaca(o.PLACA);
    if (p && !/^0+$/.test(p) && !veics.has(p)) {
      veics.set(p, { id: await uid("vei", p), placa: p, marca: titulo(o.MARCA), modelo: s(o.MODELO).toUpperCase(), ano: anoTxt(o.ANO, o.ANOMOD), cor: titulo(o.COR), motor: "",
        cliente_id: cliMap.get(o.CODCLI) || null, km_atual: kmOS.get(p) || null, obs: "Cadastrado a partir das O.S. do sistema anterior.", obs_antiga: "Cadastrado a partir das O.S. do sistema anterior.",
        criado_em: ts(o.DATAENT), ano_fab: Math.trunc(o.ANO || 0) || null, ano_mod: Math.trunc(o.ANOMOD || 0) || Math.trunc(o.ANO || 0) || null, chassi: "", renavam: "",
        combustivel: comb(o.COMB), motorista: "", revisao_data: null, revisao_km: null, oleo_data: null, oleo_km: null, filtro_data: null, filtro_km: null });
      nota("veiculo_criado_pela_os", p);
    }
  }
  const veiculos = [...veics.values()];

  // ---------------- O.S. e itens
  const memos = new Map((t.ORDEM3 || []).map(r => [r.NUMERO, r]));
  const itensSrc = new Map(); (t.ORDEM2 || []).forEach((r, n) => { if (!itensSrc.has(r.NUMERO)) itensSrc.set(r.NUMERO, []); itensSrc.get(r.NUMERO).push([n, r]); });
  const ords = [], itens = [], eventos = [];
  const produtoDoItem = r => { const c = prodPorCod.get(r.CODPRO) || []; if (c.length === 1) return c[0].id; const k = chaveDesc(r.DESCRICAO); const a = c.find(x => x.k === k); return a ? a.id : null; };
  const limpaObs = x => (x || "").trim().replace(/^[.\s]+/, "");
  for (const o of ordens) {
    const num = o.NUMERO, oid = await uid("os", num), ctrl = (o.CONTROLE || "").toUpperCase(), situ = s(o.SITUACAO);
    let status;
    if (ctrl === "C") status = "cancelado";
    else if (ctrl === "A") status = situ.toLowerCase().includes("aprova") ? "aguardando" : "diagnostico";
    else if (!o.ORDEM) status = "recusado";
    else status = "entregue";
    const criado = ts(o.DATAENT, o.HORAENT);
    let saida = o.DATASAI ? ts(o.DATASAI, o.HORASAI) : null;
    if (saida && (ano(o.DATASAI) < 2015 || o.DATASAI < (o.DATAENT || "") || ano(o.DATASAI) > 2030)) { nota("data_saida_invalida", num); saida = criado; }
    const m = memos.get(num) || {};
    const reclam = s(m.DEFEITO || "") || [s(o.DEFEITO1), s(o.DEFEITO2)].filter(Boolean).join(" ");
    const diag = [s(m.CONSTA || ""), s(m.SERVICO || "")].filter(Boolean).join("\n");
    let obsEx = [1, 2, 3, 4, 5, 6, 7, 8].map(i => limpaObs(o["OBS" + i])).filter(Boolean).join("\n");
    if (s(o.OBSERVA)) obsEx = (obsEx + "\n" + s(o.OBSERVA)).trim();
    const placa = normPlaca(o.PLACA), vei = veics.get(placa), cli = cliById.get(cliMap.get(o.CODCLI));
    const aprov = status === "entregue" ? true : (["aguardando", "diagnostico"].includes(status) ? null : false);
    const lst = [];
    let pos = 0;
    for (const [n, r] of itensSrc.get(num) || []) {
      const q = (+r.QUANTIA || 0) || 1, tot = +r.TOTAL || 0, tipo = r.SERVICO ? "servico" : "peca";
      lst.push({ id: await uid("item", `${num}-${n}`), ordem_id: oid, tipo, descricao: s(r.DESCRICAO) || (tipo === "servico" ? "Serviço" : "Peça"), codigo: s(r.REFERENCIA), fornecedor: "",
        qtd: Math.round(q * 1000) / 1000, valor_unit: r2(tot / q), custo_unit: r2(r.CUSTO), horas: null, servico_id: null, produto_id: produtoDoItem(r), desconto: 0,
        fornecida_cliente: false, qualidade: "", adicional: false, aprovado: aprov, executado: status === "entregue", posicao: pos, criado_em: criado });
      pos++;
    }
    const soma = tp => r2(lst.filter(i => i.tipo === tp).reduce((a, i) => a + i.qtd * i.valor_unit, 0));
    const extra = async (tipo, descricao, valor) => { const p = lst.length;
      lst.push({ id: await uid("item", `${num}-x${p}`), ordem_id: oid, tipo, descricao, codigo: "", fornecedor: "", qtd: 1, valor_unit: r2(valor), custo_unit: 0, horas: null, servico_id: null, produto_id: null, desconto: 0,
        fornecida_cliente: false, qualidade: "", adicional: false, aprovado: aprov, executado: status === "entregue", posicao: p, criado_em: criado }); };
    const dserv = r2((+o.VLRSERV || 0) - soma("servico"));
    if (dserv > 0.05) await extra("servico", "Mão de obra (lançada no sistema anterior)", dserv);
    const dprod = r2((+o.VLRPROD || 0) - soma("peca"));
    if (dprod > 0.05 && Math.abs(dprod - (+o.DESCONTO || 0)) > 0.05) await extra("peca", "Peças (lançadas no sistema anterior)", dprod);
    if ((+o.DESLOCA || 0) > 0) { const rot = s(o.CAMPO3).toUpperCase();
      if (rot.includes("RETIFICA")) await extra("terceiro", "Retífica", +o.DESLOCA); else await extra("servico", rot ? titulo(rot) : "Deslocamento", +o.DESLOCA); }
    const total = r2(o.TOTAL);
    const bruto = r2(lst.reduce((a, i) => a + i.qtd * i.valor_unit, 0));
    let desconto = 0;
    if (bruto - total > 0.05) desconto = r2(bruto - total);
    else if (total - bruto > 0.05) await extra("servico", "Valor complementar (sistema anterior)", total - bruto);
    const custo = r2(lst.filter(i => i.aprovado !== false || status === "entregue").reduce((a, i) => a + i.qtd * i.custo_unit, 0));
    itens.push(...lst);
    const nomeCli = cli ? cli.nome : titulo(o.CLIENTE);
    ords.push({ id: oid, numero: num, status, cliente_id: cli ? cli.id : null, veiculo_id: vei ? vei.id : null,
      cliente: { nome: nomeCli, telefone: (cli && cli.telefone) || tel(o.TELEFONE, o.WHATSAPP), doc: cli ? cli.doc : "", endereco: cli ? cli.endereco : "" },
      veiculo: { placa, marca: titulo(o.MARCA) || (vei ? vei.marca : ""), modelo: s(o.MODELO).toUpperCase() || (vei ? vei.modelo : ""), ano: anoTxt(o.ANO, o.ANOMOD) || (vei ? vei.ano : ""), cor: titulo(o.COR) || (vei ? vei.cor : ""), motor: titulo(o.COMB) },
      km_entrada: o.KM ? Math.trunc(o.KM) : null, combustivel: "", funcionando: "", reclamacao: reclam,
      checkin: { feito: false, legado: { sistema: "OS Oficina 3.0", numero: num, situacao: situ, orcamento: !!(o.ORCAMENTO && !o.ORDEM) } },
      consultor_id: null, consultor_nome: "", mecanico_id: null, mecanico_nome: titulo(o.TECNICO), assinatura_entrada: "", assinante_entrada: "", diagnostico: diag,
      previsao_entrega: null, condicoes_pagamento: s(o.CONDICOES), orcamento_enviado_em: ["aguardando", "recusado"].includes(status) ? criado : null, validade_orcamento: null,
      aprovacao: status === "entregue" ? { em: criado, por: nomeCli, forma: "Sistema anterior", obs: "Importado do OS Oficina 3.0", assinatura: "" } : null,
      desconto, total, custo, forma_pagamento: status === "entregue" ? forma(o.FORMA) : "", garantia_dias: 90, km_saida: null,
      entregue_em: ["entregue", "recusado", "cancelado"].includes(status) ? (saida || criado) : null, assinatura_entrega: "", obs_execucao: obsEx,
      obs_internas: situ ? "Situação no sistema anterior: " + situ : "", criado_por: null, criado_em: criado, atualizado_em: saida || criado,
      box: s(o.PRISMA), contato: caixa(o.CONTATO), previsao_hora: "", tabela_preco: o.TABELA3 ? "atacado" : o.TABELA2 ? "prazo" : "vista", situacao: "", estoque_baixado: status === "entregue" });
    eventos.push({ ordem_id: oid, tipo: "importacao", texto: `Importada do OS Oficina 3.0 (O.S. ${num}, situação: ${situ || "—"}).`, usuario_nome: "Importação", criado_em: criado });
  }
  return { clientes, veiculos, produtos, ordens: ords, itens, eventos, relatorio: Object.fromEntries(Object.entries(rel).map(([k, v]) => [k, v.length])) };
}

/** Lê os arquivos escolhidos pelo usuário (FileList) e devolve as tabelas */
export const TABELAS_LEGADO = ["CLIENTES", "CLIENTE2", "CLIENTE3", "TIPOCLI", "PLACA", "PLACA2", "PRODUTOS", "ORDEM", "ORDEM2", "ORDEM3"];
export async function lerArquivosLegado(arquivos, lerDBF) {
  const por = new Map([...arquivos].map(f => [f.name.toUpperCase(), f]));
  const buf = async nome => { const f = por.get(nome); return f ? new Uint8Array(await f.arrayBuffer()) : null; };
  const t = {}, faltando = [];
  for (const nome of TABELAS_LEGADO) {
    const dbf = await buf(nome + ".DBF");
    if (!dbf) { faltando.push(nome + ".DBF"); continue; }
    let memo = await buf(nome + ".DBT");
    if (!memo) { memo = await buf(nome + ".FPT"); if (memo) memo.fpt = true; }
    t[nome] = lerDBF(dbf, memo);
  }
  return { t, faltando };
}
