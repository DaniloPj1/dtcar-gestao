// Conferências do mapa por modelo (js/obdmodelo.js) contra o catálogo gerado de verdade.
import * as m from "../js/obdmodelo.js";
let n = 0; const t = (c, msg) => { n++; if (!c) { console.error("FALHOU: " + msg); process.exit(1); } };

t(m.modelosComMapa().length >= 70, "o catálogo tem os modelos importados");
t(m.acharModelo("Honda", "CITY EX 1.5 FLEX").arquivo === "honda_city", "acha o City pelo cadastro");
t(m.acharModelo("TOYOTA", "Corolla Cross XRE").arquivo === "toyota_corolla_cross", "o nome mais longo ganha: Corolla Cross não cai em Corolla");
t(m.acharModelo("VW - VolksWagen", "T-CROSS 200 TSI").arquivo === "volkswagen_t_cross" && m.acharModelo("GM - Chevrolet", "SPIN 1.8 LTZ").arquivo === "chevrolet_spin", "marca escrita do jeito do cadastro");
t(m.acharModelo("Chevrolet", "ONIX 1.0") === null && m.acharModelo("", "CITY") === null && m.acharModelo("Honda", "") === null, "modelo sem mapa devolve nada, sem chutar");

const city = await m.carregar(m.acharModelo("Honda", "City"));
t(city.fonte === "OBDb/Honda-City" && city.comandos.length >= 10, "o arquivo do City diz de onde veio");
const mods = m.modulosDoModelo(city, "Honda", 2016);
t(mods.some(x => x.pedido === "18DA10F1" && x.resposta === "18DAF110" && x.nome === "Motor"), "City: motor no endereço de 29 bits, com nome");
t(mods.some(x => x.nome === "ABS/VSA") && mods.some(x => x.nome === "Painel"), "City: ABS/VSA e painel nomeados pelas duas fontes da Honda");
t(m.nomeDoModulo({ p: "7B0", t: "" }, "Chevrolet") === "Módulo 7B0", "endereço sem tipo conhecido fica escrito, sem nome inventado");

// para que ano vale
t(m.situacaoDoComando({}, 2016) === "conferido" && m.situacaoDoComando({ nc: 1 }, 2016) === "nao-conferido", "sem filtro vale; marcado como não confirmado não vale como conferido");
t(m.situacaoDoComando({ df: { de: 2024, ate: 2022 } }, 2023) === "conferido" && m.situacaoDoComando({ df: { de: 2024, ate: 2022 } }, 2016) === "nao-conferido", "df: só o ano que alguém conferiu sai como conferido");
t(m.situacaoDoComando({ f: { de: 2018 } }, 2016) === "fora" && m.situacaoDoComando({ f: { de: 2018 } }, 2019) === "conferido", "f: fora dos anos o comando não é mandado");
t(m.situacaoDoComando({ f: { anos: [2015] }, df: { ate: 2014 } }, 2012) === "nao-conferido", "f e df juntos");
t(m.situacaoDoComando({ f: { de: 2018 } }, "") === "nao-conferido" && m.situacaoDoComando({}, "") === "conferido", "sem ano no cadastro nada restrito é dado como conferido");
t(m.situacaoDoComando({ f: { de: 2018 } }, "2015/2016") === "fora", "ano no formato fabricação/modelo usa o do modelo");

// decodificação
t(m.decodificar({ b: 0, l: 8, u: "celsius", a: -40 }, [0x5a]).valor === 50, "um byte com soma");
t(m.decodificar({ b: 8, l: 16, d: 4, u: "rpm" }, [0, 0x0c, 0x80]).texto === "800", "dois bytes com divisor");
t(m.decodificar({ b: 0, l: 16, le: 1 }, [0x34, 0x12]).valor === 0x1234, "byte menos significativo primeiro");
t(m.decodificar({ b: 0, l: 8, s: 1 }, [0xff]).valor === -1, "com sinal");
t(m.decodificar({ b: 6, l: 1, u: "offon" }, [0b00000010]).texto === "Ligado" && m.decodificar({ b: 7, l: 1, u: "noyes" }, [0b00000010]).texto === "Não", "bit solto vira palavra");
t(m.decodificar({ b: 0, l: 8, mp: { "2": "Drive" } }, [2]).texto === "Drive", "mapa de valores");
t(m.decodificar({ b: 16, l: 8 }, [1, 2]) === null, "resposta curta NÃO vira zero");
t(m.decodificar({ b: 0, l: 8, nmx: 250 }, [0xff]) === null, "valor marcado como ausente pelo módulo não aparece");
t(m.decodificar({ b: 0, l: 8, m: 100, d: 255, u: "percent" }, [255]).texto === "100" && m.decodificar({ b: 0, l: 8, m: 100, d: 255, u: "percent" }, [128]).texto === "50,2", "vírgula decimal");
t(m.nomeDoSinal({ k: "engineSpeed", n: "Engine RPM" }) === "Rotação do motor" && m.nomeDoSinal({ n: "VTEC solenoid valve" }) === "VTEC solenoid valve", "nome nosso quando sabemos; original quando não");

// leitura de um módulo com um carro de mentira
const falso = async (cmd) => cmd === "222610" ? { dados: [0x26, 0x10].concat(Array.from({ length: 40 }, (_, i) => (i === 23 ? 128 : 0))), nrc: null }
  : cmd === "222611" ? { dados: null, nrc: 0x31, texto: "fora da faixa" } : { dados: null, nrc: null, erro: "NO DATA", texto: "sem resposta" };
const cmds = m.comandosDoAno(city, 2016).filter(c => c.p === "18DA10F1").slice(0, 3);
const lido = await m.lerModulo(cmds, falso);
t(lido[0].sinais.some(s => s.id === "CITY_GENERATOR" && s.texto === "50,2" && s.unidade === "%"), "lê o sinal no bit certo, depois do eco do identificador");
t(lido[1].nrc === 0x31 && !lido[1].sinais.length && !lido[2].sinais.length, "recusa e silêncio são ausência do dado, não zero");
t(lido[0].situacao === "nao-conferido", "City 2016: o comando vem marcado como não conferido para o ano");
console.log(n + " conferências do mapa por modelo passaram.");
// rodas do ABS
const polo = await m.carregar(m.acharModelo("Volkswagen", "Polo"));
const rodas = m.comandosDoAno(polo, 2020).flatMap(c => c.z).filter(m.eRoda).map(m.nomeDoSinal);
if (!(rodas.some(r => r.startsWith("Roda dianteira esquerda")) && rodas.some(r => r.startsWith("Roda traseira direita")))) { console.error("FALHOU: rodas do Polo: " + rodas.join("; ")); process.exit(1); }
if (m.nomeDaRoda({ n: "Steering wheel speed", u: "kilometersPerHour" }) || m.nomeDaRoda({ n: "Average front wheel speed", u: "kilometersPerHour" }) || m.nomeDaRoda({ n: "Front left wheel speed", u: "scalar" })) { console.error("FALHOU: volante, média e número cru não são roda"); process.exit(1); }
console.log("rodas do ABS: " + [...new Set(rodas)].join("; "));

/* ---- medidas do Brasil: o que vem em medida americana é convertido (pedido do Danilo) ---- */
{
  const m = await import("../js/obdmodelo.js");
  const um = (u, cru) => m.decodificar({ b: 0, l: 8, u }, [cru]);
  const ok = (c, msg) => { if (!c) { console.error("FALHOU: " + msg); process.exit(1); } };
  ok(um("fahrenheit", 212).valor === 100 && um("fahrenheit", 212).unidade === "°C", "212 °F = 100 °C");
  ok(um("psi", 100).valor === 6.89 && um("psi", 100).unidade === "bar", "100 psi = 6,89 bar");
  ok(um("miles", 100).valor === 160.93 && um("miles", 100).unidade === "km", "100 mi = 160,93 km");
  ok(um("milesPerHour", 60).valor === 96.56 && um("milesPerHour", 60).unidade === "km/h", "60 mph = 96,56 km/h");
  ok(um("gallons", 10).valor === 37.85 && um("gallons", 10).unidade === "L", "10 gal = 37,85 L");
  ok(um("celsius", 90).valor === 90 && um("bars", 3).unidade === "bar", "o que já é medida nossa não muda");
  console.log("medidas do Brasil: 6 conferências passaram.");
}

/* ---- acervo do opendbc: as marcas que entram na oficina (24/11/2026) ---- */
{
  const u = await import("../js/uds.js");
  const c = (n, v) => { if (!v) { console.error("FALHOU: " + n); process.exit(1); } };
  const fams = u.familias(null);
  for (const f of ["TOYOTA", "HONDA", "HYUNDAI", "FORD", "NISSAN", "SUBARU", "MAZDA", "STELLANTIS"])
    c("o acervo tem a família " + f, fams.includes(f));
  c("o acervo passou de 300 módulos", u.quantosModulos() >= 300);
  // a família do carro sai da marca do cadastro
  c("Honda City cai na família HONDA", u.familiaDoCarro({ marca: "HONDA" }) === "HONDA");
  c("Amarok continua caindo na VAG", u.familiaDoCarro({ marca: "VOLKSWAGEN" }) === "VAG");
  c("Corolla cai na TOYOTA", u.familiaDoCarro({ marca: "TOYOTA" }) === "TOYOTA");
  c("Renegade cai na STELLANTIS", u.familiaDoCarro({ marca: "JEEP" }) === "STELLANTIS");
  // o motor do Honda é de 29 bits, que é o que faltava para atuador e aprendizado
  const honda = u.modulosDa("HONDA");
  const motor = honda.find(m => /Motor/.test(m.nome));
  c("o motor do Honda está em 29 bits", !!motor && motor.pedido === "18DA10F1" && motor.resposta === "18DAF110");
  c("a família Honda tem freio, direção e airbag", ["Controle de estabilidade", "Direção elétrica", "Airbag"].every(n => honda.some(m => m.nome === n)));
  // toda entrada das famílias NOVAS tem endereço de diagnóstico de verdade e nome escrito.
  // (As coleções do OVMS têm entradas sem nome desde antes; isso é pendência separada.)
  const NOVAS = ["TOYOTA", "HONDA", "HYUNDAI", "FORD", "NISSAN", "SUBARU", "MAZDA", "STELLANTIS", "TESLA", "RIVIAN", "MG", "PSA", "BYD"];
  const ruim = [];
  for (const f of fams.filter(x => NOVAS.includes(x))) for (const m of u.modulosDa(f)) {
    const p = m.pedido, r = m.resposta;
    const okEnd = e => /^[0-9A-F]{3}$/.test(e) ? parseInt(e, 16) >= 0x600 && parseInt(e, 16) <= 0x7ff : /^[0-9A-F]{8}$/.test(e);
    if (!okEnd(p) || !/^[0-9A-F]{3}$|^[0-9A-F]{8}$/.test(r) || !m.nome) ruim.push(f + " " + p + "/" + r + " " + m.nome);
  }
  c("nenhuma entrada inválida ou sem nome nas famílias novas: " + ruim.slice(0, 3).join("; "), !ruim.length);
  console.log("acervo do opendbc: 14 conferências passaram.");
}
