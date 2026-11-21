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
