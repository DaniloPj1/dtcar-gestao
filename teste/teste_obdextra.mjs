// Conferências do registro, da conferência antes de valer, da varredura, do carro comparado com
// ele mesmo e do caderno do carro (Etapas 1, 3 e 4).
import * as reg from "../js/obdregistro.js";
import * as conf from "../js/obdconfere.js";
import * as var_ from "../js/obdvarredura.js";
import * as cmp from "../js/obdcompara.js";
import * as mapa from "../js/obdmapa.js";
let n = 0; const t = (c, m) => { n++; if (!c) { console.error("FALHOU: " + m); process.exit(1); } };

/* ---- registro ---- */
t(reg.canonico({ b: 1, a: [2, { d: 1, c: 2 }] }) === '{"a":[2,{"c":2,"d":1}],"b":1}', "o JSON sai sempre na mesma ordem");
const s1 = await reg.selar({ a: 1, b: 2 }), s2 = await reg.selar({ b: 2, a: 1 }), s3 = await reg.selar({ a: 1, b: 3 });
t(s1 === s2 && s1 !== s3 && /^[0-9a-f]{64}$/.test(s1), "o selo não depende da ordem das chaves e muda com o conteúdo");
t(await reg.integridade({ dados: { a: 1, b: 2 }, selo: s1 }) === "confere" && await reg.integridade({ dados: { a: 1, b: 9 }, selo: s1 }) === "nao-confere" && await reg.integridade({ dados: {} }) === "sem-selo", "integridade diz se o guardado ainda confere");
const l = reg.linha("atuar", { id: "u1", nome: "João" }, { placa: "abc1d23", veiculo_id: "v1", vin: "93H" }, { did: "013C" }, { km: "12345.4" });
t(l.tipo === "atuar" && l.placa === "ABC1D23" && l.km === 12345 && l.dados.did === "013C" && l.perfil_nome === "João", "a linha leva quem, qual carro e o quê");
let lancou = false; try { reg.linha("qualquer", {}, {}, {}); } catch (e) { lancou = true; }
t(lancou, "tipo desconhecido não é gravado");
let guardado = []; const cofre = { ler: () => guardado.slice(), escrever: x => { guardado = x; } };
const r1 = await reg.guardar(async () => { throw new Error("violates check constraint"); }, cofre, l);
t(!r1.gravado && r1.pendente && guardado.length === 1 && guardado[0].guardado_em, "banco recusou: fica guardado no aparelho");
const r2 = await reg.guardar(async () => ({}), cofre, l);
t(r2.gravado && guardado.length === 1, "gravou: não vai para a fila");
let chegou = []; const sub = await reg.subirPendentes(async x => { chegou.push(x); }, cofre);
t(sub.subiram === 1 && sub.restam === 0 && !guardado.length && chegou[0].guardado_em === undefined && chegou[0].tipo === "atuar", "o pendente sobe sem o carimbo de espera");
const r3 = await reg.guardar(async () => { throw new Error("x"); }, { ler: () => { throw new Error("cheio"); }, escrever: () => {} }, l);
t(!r3.gravado && !r3.pendente, "sem espaço no aparelho: diz que não guardou, não finge");

/* ---- conferência antes de valer ---- */
let c = conf.conferir({ versao: "ELM327 v2.1", vinLido: "93HGM2660GZ123456", chassiCadastro: "93hgm2660gz123456" });
t(c.situacao === "ok" && c.itens.find(i => i.chave === "chassi").situacao === "ok", "tudo certo");
c = conf.conferir({ versao: "ELM327 v1.5", avisoAdaptador: "Adaptador que se anuncia como v1.5.", vinLido: "AAA", chassiCadastro: "BBB" });
t(c.situacao === "ruim" && /NÃO VALE/.test(c.frase) && c.itens.find(i => i.chave === "adaptador").situacao === "atencao", "chassi diferente derruba a leitura; clone é ressalva");
c = conf.conferir({ versao: "x", vinLido: "", chassiCadastro: "BBB" });
t(c.itens.find(i => i.chave === "chassi").situacao === "sem-dado" && c.situacao === "ok", "carro que não informa chassi não é dado como certo nem como errado");
const esperados = [{ pedido: "18DA28F1", nome: "ABS/VSA" }, { pedido: "18DA10F1", nome: "Motor" }];
c = conf.conferir({ versao: "x", varredura: [{ pedido: "18DA28F1", respondeu: false }, { pedido: "18DA10F1", respondeu: true }], esperados });
t(c.situacao === "atencao" && /NÃO RESPONDEU: ABS\/VSA/.test(c.itens.find(i => i.chave === "modulos").texto), "módulo calado é NOMEADO");
c = conf.conferir({ versao: "x", varredura: [{ pedido: "7E0", respondeu: true }], esperados: null });
t(/Não há mapa/.test(c.itens.find(i => i.chave === "modulos").texto), "sem mapa do modelo, diz que não tem como saber se falta módulo");

/* ---- varredura ---- */
const fala = { comum: 1, estendida: 3, abertos: [],
  abrir: async m => { fala.abertos.push(m.pedido); fala.atual = m.pedido; },
  sessao: async () => (fala.atual === "7B0" ? { erro: "NO DATA" } : { nrc: null }),
  lerFalhas: async () => (fala.atual === "7E1" ? { nrc: 0x11, texto: "serviço não suportado" } : { nrc: null, codigos: [{ codigo: "P0301", tipoFalha: 0 }] }) };
const v = await var_.varrer([{ pedido: "7E0", nome: "Motor" }, { pedido: "7B0", nome: "ABS" }, { pedido: "7E1", nome: "Câmbio" }], fala);
t(v.length === 3 && v[0].respondeu && v[0].falhas.length === 1 && !v[1].respondeu && v[2].respondeu && v[2].recusou, "o módulo calado continua na lista; o que recusa é anotado");
const rs = var_.resumo(v);
t(rs.responderam === 2 && rs.calados[0] === "ABS" && rs.falhas === 1 && rs.comFalha === 1, "resumo da varredura");
const parou = await var_.varrer([{ pedido: "7E0" }, { pedido: "7E1" }], fala, { continuar: () => false });
t(parou.length === 0, "dá para parar a varredura");

/* ---- o carro comparado com ele mesmo ---- */
t(cmp.regimeDe({ rpm: 780, velocidade: 0, temperatura: 90 }) === "lenta" && cmp.regimeDe({ rpm: 780, velocidade: 0, temperatura: 40 }) === null, "motor frio não entra na comparação");
t(cmp.regimeDe({ rpm: 2200, velocidade: 80, velocidadeAntes: 79, temperatura: 90 }) === "cruzeiro" && cmp.regimeDe({ rpm: 3000, velocidade: 80, velocidadeAntes: 60, temperatura: 90 }) === null, "acelerando não é cruzeiro");
const faz = (map, vezes = 12) => { const s = cmp.novaSessao(); for (let i = 0; i < vezes; i++) { cmp.anotar(s, { pid: 0x05, chave: 500, valor: 90 }); cmp.anotar(s, { pid: 0x0d, chave: 1300, valor: 0 }); cmp.anotar(s, { pid: 0x0c, chave: 1200, rotulo: "Rotação", unidade: "rpm", valor: 800 }); cmp.anotar(s, { pid: 0x0b, chave: 1100, rotulo: "Pressão no coletor", unidade: "kPa", valor: map + (i % 2) }); } return cmp.resumo(s); };
const a1 = faz(32), a2 = faz(33), hojeIgual = faz(33), hojeAlto = faz(48);
t(a1.sinais[1100].r.lenta.n === 12 && a1.sinais[1100].r.lenta.media === 32.5, "resumo por sinal e por regime");
t(cmp.resumo(cmp.novaSessao()) === null && faz(30, 3) === null, "pouca amostra não vira retrato");
t(cmp.comparar(hojeAlto, [a1]).achados.length === 0, "com uma leitura anterior só não acusa nada");
t(cmp.comparar(hojeIgual, [a1, a2]).achados.length === 0, "carro igual a ele mesmo: nenhum achado");
const ach = cmp.comparar(hojeAlto, [a1, a2]).achados;
t(ach.length === 1 && ach[0].chave === "1100" && ach[0].sentido === "acima" && /Hipótese/.test(ach[0].texto) && !/troque|defeito n[ao]/i.test(ach[0].texto), "o que mudou vira hipótese, nunca peça");

/* ---- o caderno do carro ---- */
t(mapa.chaveDoModelo({ marca: "Chevrolet", modelo: "Onix 1.0 LT", ano: "2018/2019" }) === "CHEVROLET|ONIX 1|2019" && mapa.chaveDoModelo({ vin: "9BGKS48T0KG123456" }) === "VIN|9BGKS48T|K" && mapa.chaveDoModelo({}) === "", "a chave do modelo");
const cad = mapa.novoCaderno();
mapa.anotarTroca(cad, "0100", "4100BE3EA813\r\r>", 30);
t(!Object.keys(cad.enderecos).length, "OBD-II genérico não é mapa de módulo");
mapa.anotarTroca(cad, "ATSH7B0", "OK\r>", 5);
mapa.anotarTroca(cad, "1001", "5001003201F4\r>", 40);
mapa.anotarTroca(cad, "22F190", "62F190393342474B533438\r>", 80);
mapa.anotarTroca(cad, "22F187", "7F2231\r>", 20);
mapa.anotarTroca(cad, "2F013C0301", "6F013C03\r>", 20);
mapa.anotarTroca(cad, "ATSH7C0", "OK\r>", 5);
mapa.anotarTroca(cad, "1001", "NO DATA\r>", 900);
t(cad.enderecos["7B0"].respondeu === 3 && cad.enderecos["7B0"].servicos["10"] === 0 && cad.enderecos["7C0"].calado === 1 && !cad.enderecos["7C0"].respondeu, "quem respondeu e quem ficou calado");
t(cad.dados["7B0"]["22F190"].bytes === 8 && cad.dados["7B0"]["22F187"].nrc === 0x31, "o dado com o tamanho, a recusa com o código");
t(!JSON.stringify(cad.dados).includes("013C") && !cad.enderecos["7B0"].servicos["2F"], "comando que age NÃO entra no mapa");
mapa.anotarTroca(cad, "ATSP0", "OK\r>", 5); mapa.anotarTroca(cad, "22F190", "62F190AA\r>", 5);
t(Object.keys(cad.dados["7B0"]).length === 2 && !cad.dados[""], "depois de trocar o protocolo não atribui dado a módulo nenhum");
const ret = mapa.retrato(cad, { marca: "Chevrolet", modelo: "Onix", ano: 2019 });
t(ret.modelo === "CHEVROLET|ONIX|2019" && ret.trocas.length >= 8 && mapa.retrato(mapa.novoCaderno(), {}) === null, "o retrato que vai para o banco");
const cs = mapa.consenso([{ carro: "A", ...ret }, { carro: "B", enderecos: { "7B0": { respondeu: 1 }, "7C0": { respondeu: 1 } }, dados: { "7B0": { "22F190": { bytes: 8 } } } }]);
const e7b0 = cs.find(x => x.endereco === "7B0"), e7c0 = cs.find(x => x.endereco === "7C0");
t(e7b0.situacao === "conferido" && e7b0.dados.find(d => d.id === "22F190").conferido && e7c0.situacao === "conflito", "dois carros concordando conferem; discordando é conflito anotado");
t(mapa.consenso([{ carro: "A", ...ret }]).find(x => x.endereco === "7B0").situacao === "visto-uma-vez", "um carro só não confere nada");
const fatos = { respondeu: true, dados: cad.dados["7B0"], servicos: cad.enderecos["7B0"].servicos };
t(mapa.avaliar("comms_ok & did:F190=ok & did:F187=nrc31", fatos) === true && mapa.avaliar("comms_ok & did:F190=nrc31", fatos) === false, "regra casa e não casa");
t(mapa.avaliar("comms_ok & did:2003=ok", fatos) === null, "o que ainda não foi perguntado é 'não sei', não é 'não'");
t(mapa.identificar([{ endereco: "7B0", regra: "comms_ok & did:F190=ok", nome: "ABS" }], "7B0", fatos).nome === "ABS" && mapa.identificar([{ endereco: "7B0", regra: "comms_ok & did:2003=ok", nome: "X" }], "7B0", fatos) === null, "identificação por regra");
const novo = mapa.novoCaderno();
let p = mapa.proximoPasso(novo);
t(p.tipo === "endereco" && p.pedido === "700" && p.resposta === "708", "a descoberta começa pelos endereços de diagnóstico");
for (let a = 0x700; a <= 0x7e7; a++) novo.enderecos[a.toString(16).toUpperCase()] = { respondeu: a === 0x7b0 ? 1 : 0, calado: 1 };
p = mapa.proximoPasso(novo);
t(p.tipo === "dado" && p.pedido === "7B0" && p.did === "F190", "depois pergunta a identificação de quem respondeu");
novo.dados["7B0"] = Object.fromEntries(mapa.DIDS_IDENTIDADE.map(d => ["22" + d, { nrc: 0x31 }]));
t(mapa.proximoPasso(novo) === null, "e acaba");
t(mapa.andamento(novo).feitos === mapa.andamento(novo).total && mapa.andamento(novo).responderam === 1, "andamento");
const visto = new Set(); const c2 = mapa.novoCaderno();
for (let i = 0; i < 400; i++) { const q = mapa.proximoPasso(c2); if (!q) break; visto.add(q.tipo); if (q.tipo === "endereco") c2.enderecos[q.pedido] = { respondeu: 1 }; else (c2.dados[q.pedido] || (c2.dados[q.pedido] = {}))["22" + q.did] = { bytes: 1 }; t(!q.pedido.includes("7DF"), "nunca o endereço de todos"); }
t([...visto].every(x => x === "endereco" || x === "dado"), "a descoberta só devolve pergunta de leitura");
console.log(n + " conferências do registro, conferência, varredura, comparação e caderno passaram.");
