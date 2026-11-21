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

/* ---- o gráfico: até 3 gráficos, mesma unidade junta (as 4 rodas) ---- */
const gr = await import("../js/obdgrafico.js");
let m2 = 0; const tt = (c, msg) => { m2++; if (!c) { console.error("FALHOU: " + msg); process.exit(1); } };
const L = [{ chave: 1, rotulo: "Roda DE", unidade: "km/h", valor: 40 }, { chave: 2, rotulo: "Roda DD", unidade: "km/h", valor: 40 }, { chave: 3, rotulo: "Roda TE", unidade: "km/h", valor: 40 },
  { chave: 4, rotulo: "Roda TD", unidade: "km/h", valor: 39 }, { chave: 5, rotulo: "Velocidade", unidade: "km/h", valor: 40 }, { chave: 6, rotulo: "Rotação", unidade: "rpm", valor: 800 },
  { chave: 7, rotulo: "Temperatura", unidade: "°C", valor: 90 }, { chave: 8, rotulo: "Tensão", unidade: "V", valor: 14 }, { chave: 9, rotulo: "Cru A", unidade: "", valor: 1 }, { chave: 10, rotulo: "Cru B", unidade: "", valor: 2 }, { chave: 11, rotulo: "Texto", unidade: "", valor: "x" }];
let esc = [];
for (const k of [1, 2, 3, 4]) esc = gr.trocar(esc, k, L).lista;
tt(esc.length === 4 && gr.graficosDe(esc, L).length === 1 && gr.graficosDe(esc, L)[0].leituras.length === 4, "as 4 rodas entram no MESMO gráfico");
let r5 = gr.trocar(esc, 5, L);
tt(r5.lista.length === 4 && /já tem 4/.test(r5.recusa), "a quinta leitura da mesma unidade é recusada com motivo");
esc = gr.trocar(esc, 6, L).lista; esc = gr.trocar(esc, 7, L).lista;
tt(gr.graficosDe(esc, L).length === 3, "rotação e temperatura abrem o segundo e o terceiro gráfico");
const r8 = gr.trocar(esc, 8, L);
tt(r8.lista.length === 6 && /Já tem 3 gráficos/.test(r8.recusa), "o quarto gráfico é recusado com motivo");
tt(gr.trocar(esc, 2, L).lista.length === 5 && gr.trocar(esc, 2, L).recusa === "", "tocar numa escolhida tira");
tt(gr.graficosDe([9, 10], L).length === 2, "leituras sem unidade não se misturam");
tt(gr.graficosDe([11, 99], L).length === 0, "texto e leitura que sumiu não viram gráfico");
const hist = {}; for (let i = 0; i < 200; i++) gr.anotarPonto(hist, { chave: 1, valor: i }, 1000 + i);
tt(hist[1].length === gr.PONTOS && hist[1][0].v === 80, "a história não cresce sem fim");
gr.anotarPonto(hist, { chave: 2, valor: NaN }); gr.anotarPonto(hist, { chave: 2, valor: "a" });
tt(!hist[2], "valor que não é número não entra");
const h2 = { 1: [{ t: 100000, v: 40 }, { t: 100500, v: 42 }], 4: [{ t: 100200, v: 30 }], 2: [{ t: 10, v: 999 }] };
const ee = gr.escalaDe([L[0], L[3], L[1]], h2, 101000);
tt(ee.min === 30 && ee.max === 42 && ee.de < 30 && ee.ate > 42, "a escala é comum às leituras do gráfico e ignora ponto fora do minuto");
tt(gr.escalaDe([L[0]], {}, 5).min === null, "sem ponto, sem escala inventada");
console.log(m2 + " conferências do gráfico passaram.");

/* ---- falhas separadas por módulo ---- */
const o = await import("../js/obd.js");
let m3 = 0; const t3 = (c, msg) => { m3++; if (!c) { console.error("FALHOU: " + msg); process.exit(1); } };
let q = o.quadrosPorModulo("7E8024300\r7E906430201710300\r\r>");
t3(q["7E8"] === "4300" && q["7E9"] === "430201710300", "quadro único: cada módulo com o seu conteúdo");
q = o.quadrosPorModulo("7E8 10 0A 43 04 01 71 03 00\r7E8 21 01 30 04 20 00 00 00\r7E9 02 43 00\r>");
t3(q["7E8"] === "43040171030001300420" && q["7E9"] === "4300", "resposta longa é juntada na ordem, sem misturar com o outro módulo");
q = o.quadrosPorModulo("18DAF110024300\r18DAF11806430201710300\r>");
t3(q["18DAF110"] === "4300" && q["18DAF118"] === "430201710300", "endereço de 29 bits");
q = o.quadrosPorModulo("7E8 10 0A 43 04 01 71 03 00\r7E8 22 01 30 04 20 00 00 00\r>");
t3(!q["7E8"], "continuação fora de ordem é descartada, não aproveitada");
t3(Object.keys(o.quadrosPorModulo("NO DATA\r>")).length === 0 && Object.keys(o.quadrosPorModulo("4300\r430201710300")).length === 0, "sem cabeçalho não inventa módulo");
t3(o.nomeDeQuemRespondeu("7E8") === "Motor" && o.nomeDeQuemRespondeu("7E9") === "Câmbio" && o.nomeDeQuemRespondeu("7EB") === "Módulo 7EB" && o.nomeDeQuemRespondeu("18DAF128") === "Módulo 28", "nome de quem respondeu, sem inventar");
console.log(m3 + " conferências das falhas por módulo passaram.");

/* ---- o laudo ---- */
const ld = await import("../js/obdlaudo.js");
let m4 = 0; const t4 = (c, msg) => { m4++; if (!c) { console.error("FALHOU: " + msg); process.exit(1); } };
const dl = ld.montar({ carro: { placa: "abc1d23", marca: "Honda", modelo: "City", ano: 2016, vin: "93H" }, quem: { id: "u", nome: "Danilo" }, km: 80000.4, em: "2026-11-21T13:00:00.000Z",
  conferencia: conf.conferir({ versao: "ELM327 v2.1", vinLido: "93H", chassiCadastro: "93H" }),
  modulos: [{ nome: "Motor", pedido: "7E0", falhas: [{ codigo: "P0301", rotulo: "P0301-00", situacaoTexto: "confirmada" }] }, { nome: "ABS", pedido: "7B0", falhas: [] }],
  explicacoes: { P0301: { achou: true, descricao: "Falha de combustão no cilindro 1", origem: "SAE" } }, leituras: [{ rotulo: "Rotação", valor: 800.5, unidade: "rpm" }] });
t4(dl.carro.placa === "ABC1D23" && dl.km === 80000 && dl.modulos[0].falhas[0].descricao.includes("cilindro 1") && ld.totalDeFalhas(dl) === 1, "o conteúdo do laudo");
const sl = await reg.selar(dl);
t4(await reg.integridade({ dados: dl, selo: sl }) === "confere" && await reg.integridade({ dados: { ...dl, km: 1 }, selo: sl }) === "nao-confere", "mexer em qualquer campo quebra o selo");
t4(await reg.integridade({ dados: JSON.parse(JSON.stringify(dl)), selo: sl }) === "confere", "ir ao banco e voltar não quebra o selo");
const tx = ld.linhas(dl, sl).map(l => l.x).join("\n");
t4(/LAUDO/.test(tx) && /placa ABC1D23/.test(tx) && /P0301-00 · confirmada — Falha de combustão/.test(tx) && /ABS — sem falha gravada/.test(tx) && /800,5 rpm/.test(tx) && tx.includes(sl) && /Não é parecer sobre peça/.test(tx), "o texto do laudo");
t4(/Nenhuma falha gravada/.test(ld.linhas(ld.montar({}), "").map(l => l.x).join("\n")), "laudo sem falha diz que não há falha");
console.log(m4 + " conferências do laudo passaram.");

/* ---- "o módulo aceita gravar?" sem gravar ---- */
const ud = await import("../js/uds.js");
let m5 = 0; const t5 = (c, msg) => { m5++; if (!c) { console.error("FALHOU: " + msg); process.exit(1); } };
const antes7 = "622A1041424344454647";
t5(ud.vereditoDaGravacao({ perguntou: true, antes: antes7, resposta: "7F2E13" }).aceita === true && ud.vereditoDaGravacao({ perguntou: true, antes: antes7, resposta: "7F2E13" }).bytes === 7, "tamanho errado recusado por último = aceita gravar");
t5(ud.vereditoDaGravacao({ perguntou: true, antes: antes7, resposta: "7F2E33" }).motivo === "trancado" && ud.vereditoDaGravacao({ perguntou: true, antes: antes7, resposta: "7F2E33" }).aceita === false, "0x33 = exige destravar = não aparece");
t5(ud.vereditoDaGravacao({ perguntou: true, antes: antes7, resposta: "7F2E31" }).motivo === "so-leitura" && ud.vereditoDaGravacao({ perguntou: true, antes: antes7, resposta: "7F2E11" }).motivo === "sem-servico" && ud.vereditoDaGravacao({ perguntou: true, antes: antes7, resposta: "7F2E7F" }).aceita === false, "só leitura e módulo sem o serviço");
t5(ud.vereditoDaGravacao({ perguntou: true, antes: antes7, resposta: "6E2A10" }).aceita === null, "resposta positiva a pedido torto é fora da norma: não libera");
t5(ud.vereditoDaGravacao({ perguntou: true, antes: antes7, resposta: "NO DATA" }).aceita === null, "silêncio não é sim");
t5(ud.vereditoDaGravacao({ perguntou: false, antes: "7F2231" }).motivo === "nao-existe" && ud.vereditoDaGravacao({ perguntou: false, antes: "622A1041" }).motivo === "um-byte" && ud.vereditoDaGravacao({ perguntou: false, antes: "NO DATA" }).aceita === null, "campo que não existe, campo de um byte (não pergunta) e sem leitura");
console.log(m5 + " conferências do 'aceita gravar' passaram.");
const ss = await import("../js/obdsessao.js");
let viu = 0; const largar = ss.observar(() => { viu++; }); ss.definirCarro({ placa: "TST0A00" });
if (!viu) { console.error("FALHOU: quem observa recebe as mudanças"); process.exit(1); }
largar(); console.log("observador da sessão: ok");

/* ---- Honda: atuadores e aprendizados com nome ---- */
const hd = await import("../js/obdhonda.js");
let m6 = 0; const t6 = (c, msg) => { m6++; if (!c) { console.error("FALHOU: " + msg); process.exit(1); } };
t6(hd.eHonda({ marca: "Honda" }) && hd.eHonda({ vin: "93HGM2660GZ123456" }) && !hd.eHonda({ marca: "Chevrolet", vin: "9BG" }) && !hd.eHonda({}), "só Honda");
t6(hd.ATUADORES.length === 4 && hd.ATUADORES.map(a => a.did).join() === [0x013c, 0x014a, 0x0163, 0x0137].join(), "os quatro atuadores da ferramenta, com os identificadores de lá");
t6(hd.ATUADORES.every(a => a.condicoes.length >= 4 && a.valor === "01" && a.segundos <= 30), "cada atuador com as condições escritas e tempo máximo");
t6(hd.APRENDIZADOS.length === 10 && hd.APRENDIZADOS.every(a => a.rid >= 0x0200 && a.rid <= 0xdfff), "as dez funções, todas na faixa de rotina de veículo que o portão do Android aceita");
t6(hd.APRENDIZADOS.find(a => a.chave === "vtc").dados === "02" && hd.APRENDIZADOS.find(a => a.chave === "manut_3").rid === 0x7024 && hd.APRENDIZADOS.find(a => a.chave === "pastilha_sair").rid === 0x40d0, "números conferidos com a origem");
t6(hd.APRENDIZADOS.every(a => a.antes && a.condicoes.length && a.aviso), "toda função lê e guarda o valor antigo antes, e tem aviso");
const b7068 = Array.from({ length: 22 }, (_, i) => (i === 7 ? 0xa0 : i === 12 ? 0x0c : i === 13 ? 0x1e : 0));
const it = n => hd.APRENDIZADOS.find(a => a.chave === "manut_" + n);
t6(hd.habilitado(it(1), b7068) === true && hd.habilitado(it(2), b7068) === false && hd.habilitado(it(3), b7068) === true && hd.habilitado(it(1), [1, 2]) === null && hd.habilitado(hd.APRENDIZADOS[0], []) === true, "item do painel só é oferecido se o carro disser que tem");
t6(hd.valorAntes(it(1).antes, b7068) === "0C1E" && hd.valorAntes(it(5).antes, [1, 2, 3]) === null, "o valor antigo sai do byte certo; resposta curta não vira zero");
console.log(m6 + " conferências da Honda passaram.");
{ const dz = ld.montar({ carro: { placa: "X" }, erros: [{ situacao: "atual", erro: "NO DATA" }] });
  const tz = ld.linhas(dz, "").map(l => l.x).join("\n");
  if (!/NÃO FOI LIDO/.test(tz) || /Nenhuma falha gravada/.test(tz) || !/NÃO afirma/.test(tz) || dz.erros.length !== 1) { console.error("FALHOU: laudo com leitura que falhou não pode dizer que não há falha"); process.exit(1); }
  console.log("laudo com leitura que falhou: ok"); }

/* ---- a faixa de trabalho ao lado da leitura ao vivo ---- */
const fx = await import("../js/obdfaixa.js");
let m7 = 0; const t7 = (c, msg) => { m7++; if (!c) { console.error("FALHOU: " + msg); process.exit(1); } };
const temp = { pid: 0x05, parte: 0, chave: 500, unidade: "°C", valor: 92 };
let f1 = fx.faixaPara(temp, { rpm: 800, regime: "lenta" });
t7(f1 && f1.origem === "referencia" && f1.de === 85 && f1.ate === 105 && f1.situacao === "dentro" && /suposto/.test(f1.fonte) && f1.texto === "85 a 105 °C", "temperatura: referência da tabela, com o nível de confiança escrito");
t7(fx.faixaPara({ ...temp, valor: 112 }, { rpm: 800 }).situacao === "acima" && fx.faixaPara({ ...temp, valor: 60 }, { rpm: 800 }).situacao === "abaixo", "acima e abaixo");
t7(fx.faixaPara(temp, { rpm: 0 }) === null && fx.faixaPara(temp, {}) === null, "motor desligado: faixa de trabalho não se aplica");
const ses = [{ sinais: { 500: { r: { lenta: { n: 20, min: 88, max: 93, media: 90 } } } } }, { sinais: { 500: { r: { lenta: { n: 20, min: 87, max: 95, media: 91 } } } } }];
f1 = fx.faixaPara(temp, { rpm: 800, regime: "lenta", sessoes: ses });
t7(f1.origem === "carro" && f1.de === 87 && f1.ate === 95 && /este carro, em marcha lenta \(2 leituras\)/.test(f1.fonte) && /Referência \(suposto/.test(f1.outra), "com histórico, a faixa é a DESTE carro, e a referência fica ao lado");
t7(fx.faixaPara({ ...temp, valor: 99 }, { rpm: 800, regime: "lenta", sessoes: ses }).situacao === "acima", "acima do que este carro já marcou");
t7(fx.doCarro(temp, "lenta", ses.slice(0, 1)) === null && fx.doCarro(temp, null, ses) === null && fx.doCarro(temp, "cruzeiro", ses) === null, "uma leitura só, sem regime ou regime sem histórico: não é faixa");
const aj = fx.faixaPara({ pid: 0x07, parte: 0, chave: 700, unidade: "%", valor: 14 }, { rpm: 900 });
t7(aj.de === -10 && aj.ate === 10 && aj.situacao === "acima", "ajuste de combustível: de −10 a +10");
t7(fx.faixaPara({ pid: 0x0c, parte: 0, chave: 1200, unidade: "rpm", valor: 800 }, { rpm: 800, regime: "lenta" }) === null, "leitura sem histórico e sem referência fica SEM faixa: nada inventado");
const rail = { pid: 0x23, parte: 0, chave: 3500, unidade: "bar", valor: 350 };
t7(fx.faixaPara(rail, { rpm: 800, regime: "lenta", carro: { modelo: "ONIX 1.0" } }).de === 250, "rail em bar: carro qualquer usa a referência geral (250 a 550)");
t7(fx.faixaPara(rail, { rpm: 800, regime: "lenta", carro: { modelo: "HILUX CD 3.0 SRV" } }).de === 300 && /montadora/.test(fx.faixaPara(rail, { rpm: 800, regime: "lenta", carro: { modelo: "HILUX CD 3.0 SRV" } }).fonte), "Hilux 3.0: vale a da montadora, não a geral");
t7(fx.faixaPara(rail, { rpm: 2500, regime: null }) === null, "rail fora da marcha lenta: a referência de lenta não se aplica");
console.log(m7 + " conferências da faixa de trabalho passaram.");

/* ---- pendentes: registro acrescentado DURANTE a subida não se perde (revisão do Codex) ---- */
{
  const reg8 = await import("../js/obdregistro.js");
  let fila8 = [{ guardado_em: "a", placa: "AAA1A11", tipo: "apagar" }];
  const cofre8 = { ler: () => JSON.parse(JSON.stringify(fila8)), escrever: f => { fila8 = JSON.parse(JSON.stringify(f)); } };
  const r8 = await reg8.subirPendentes(async () => { fila8.push({ guardado_em: "b", placa: "BBB2B22", tipo: "sessao" }); }, cofre8);
  if (!(r8.subiram === 1 && r8.restam === 1 && fila8.length === 1 && fila8[0].placa === "BBB2B22")) { console.error("FALHOU: o registro novo sumiu da fila: " + JSON.stringify(fila8)); process.exit(1); }
  console.log("pendente acrescentado durante a subida fica na fila.");
}

/* ---- varredura: leitura que quebra no meio não vira "sem falha" (revisão do Codex) ---- */
{
  const v = await import("../js/obdvarredura.js");
  const fala = { comum: 1, estendida: 3, abrir: async () => {}, sessao: async () => ({}), lerFalhas: async () => { throw new Error("conexao-caiu"); } };
  const r = await v.varrer([{ nome: "ABS", pedido: "760", resposta: "768" }], fala);
  if (!(r[0].respondeu && r[0].recusou && r[0].erro === "conexao-caiu")) { console.error("FALHOU: leitura interrompida virou diagnóstico limpo: " + JSON.stringify(r[0])); process.exit(1); }
  console.log("varredura: leitura interrompida fica como indisponível.");
}

/* ---- mapa: identificador sem resposta é anotado e o mapeamento anda (revisão do Codex) ---- */
{
  const mp = await import("../js/obdmapa.js");
  const cad = mp.novoCaderno({ marca: "X", modelo: "Y", ano: "2020" });
  for (let a = 0x700; a < 0x7e8; a++) { if (a === 0x7df) continue; const p = a.toString(16).toUpperCase(); mp.anotarTroca(cad, "ATSH" + p, "OK", 1); mp.anotarTroca(cad, "1001", a === 0x7b0 ? "50 01" : "NO DATA", 5); }
  const p1 = mp.proximoPasso(cad);
  mp.anotarTroca(cad, "ATSH7B0", "OK", 1); mp.anotarTroca(cad, "22" + p1.did, "NO DATA", 5);
  const p2 = mp.proximoPasso(cad);
  if (!(p1 && p1.tipo === "dado" && (!p2 || p2.did !== p1.did))) { console.error("FALHOU: o mapeamento repete o mesmo identificador: " + JSON.stringify([p1, p2])); process.exit(1); }
  console.log("mapa: identificador calado é anotado e o mapeamento segue.");
}
