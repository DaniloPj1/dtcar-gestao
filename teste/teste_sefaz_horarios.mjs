// Teste dos horários da consulta automática da SEFAZ (8h e 16h). Rodar: node teste/teste_sefaz_horarios.mjs worker/sefaz.mjs js/telas/sefaz.js
import fs from "node:fs";
const w = fs.readFileSync(process.argv[2], "utf8");
const src = w.slice(w.indexOf("export const HORARIOS"), w.indexOf("export const EVENTOS")).replace(/export /g, "");
const { ultimoHorario } = new Function(src + "; return { ultimoHorario };")();
const t = fs.readFileSync(process.argv[3], "utf8");
const a = t.indexOf("export function proximaAuto"), b = t.indexOf("\n}\n", a) + 2;
const proximaAuto = new Function(t.slice(a, b).replace("export ", "") + "; return proximaAuto;")();
const br = s => new Date(s + "-03:00").getTime(), f = ms => new Date(ms - 3*3600000).toISOString().slice(0,16).replace("T"," ");
let ok = 0, falha = [];
const c = (n, v, e) => (v === e ? ok++ : falha.push(`${n}: ${v} != ${e}`));
c("07:59 -> ontem 16h", f(ultimoHorario(br("2026-11-05T07:59"))), "2026-11-04 16:00");
c("08:00 -> 8h", f(ultimoHorario(br("2026-11-05T08:00"))), "2026-11-05 08:00");
c("15:30 -> 8h", f(ultimoHorario(br("2026-11-05T15:30"))), "2026-11-05 08:00");
c("16:05 -> 16h", f(ultimoHorario(br("2026-11-05T16:05"))), "2026-11-05 16:00");
c("23:59 -> 16h", f(ultimoHorario(br("2026-11-05T23:59"))), "2026-11-05 16:00");
c("00:10 -> ontem 16h", f(ultimoHorario(br("2026-11-06T00:10"))), "2026-11-05 16:00");
c("virada de mês", f(ultimoHorario(br("2026-12-01T03:00"))), "2026-11-30 16:00");
// worker: decide consultar?
const vez = (ult, agora) => new Date(br(ult)).getTime() < ultimoHorario(br(agora));
c("consultou 8h05, agora 9h: não", vez("2026-11-05T08:05", "2026-11-05T09:00"), false);
c("consultou 8h05, agora 16h01: sim", vez("2026-11-05T08:05", "2026-11-05T16:01"), true);
c("consultou 16h10, agora 23h: não", vez("2026-11-05T16:10", "2026-11-05T23:00"), false);
c("consultou 16h10, agora 7h59 dia seguinte: não", vez("2026-11-05T16:10", "2026-11-06T07:59"), false);
c("consultou 16h10, agora 8h dia seguinte: sim", vez("2026-11-05T16:10", "2026-11-06T08:00"), true);
c("consulta manual 10h não atrasa a das 16h", vez("2026-11-05T10:00", "2026-11-05T16:00"), true);
// tela
const p = (ult, agora, prox) => f(proximaAuto({ ultima_consulta: ult && new Date(br(ult)).toISOString(), proxima_consulta: prox && new Date(br(prox)).toISOString() }, br(agora)).getTime());
c("tela 9h após 8h05 -> 16h", p("2026-11-05T08:05", "2026-11-05T09:00"), "2026-11-05 16:00");
c("tela 17h após 16h05 -> amanhã 8h", p("2026-11-05T16:05", "2026-11-05T17:00"), "2026-11-06 08:00");
c("tela 16h03 sem consultar -> agora", p("2026-11-05T08:05", "2026-11-05T16:03"), "2026-11-05 16:03");
c("tela 6h -> 8h", p("2026-11-04T16:05", "2026-11-05T06:00"), "2026-11-05 08:00");
c("tela respeita espera SEFAZ", p("2026-11-05T07:30", "2026-11-05T08:01", "2026-11-05T08:32"), "2026-11-05 08:32");
console.log("OK", ok, "FALHAS", falha.length ? falha : 0); if (falha.length) process.exit(1);
