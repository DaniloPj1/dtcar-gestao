// Funcionários: jornada, folha de ponto e cálculo do mês (valores de referência para a gestão;
// a folha oficial, INSS e IRRF do funcionário são calculados pelo contador).
import { arred } from "./util.js";

export const DIAS = [["seg", "Segunda"], ["ter", "Terça"], ["qua", "Quarta"], ["qui", "Quinta"], ["sex", "Sexta"], ["sab", "Sábado"], ["dom", "Domingo"]];
const DOW = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];
export const VINCULOS = { clt: "CLT", experiencia: "CLT (experiência)", mei: "MEI / prestador", diarista: "Diarista", estagio: "Estágio", socio: "Sócio (pró-labore)" };
export const com_encargos = v => v === "clt" || v === "experiencia";

export const TIPOS_LANC = {
  hora_extra: { t: "Horas extras", qtd: "horas", sinal: 1 },
  comissao: { t: "Comissão avulsa", sinal: 1 },
  bonus: { t: "Bônus / prêmio", sinal: 1 },
  falta: { t: "Faltas", qtd: "dias", sinal: -1 },
  vale: { t: "Vale", sinal: -1 },
  adiantamento: { t: "Adiantamento", sinal: -1 },
  desconto: { t: "Outro desconto", sinal: -1 },
  inss: { t: "INSS / IRRF (do contador)", sinal: -1 },
  pagamento: { t: "Pagamento feito", sinal: -1 },
};

export const ENCARGOS_PADRAO = { fgts: 8, inssPatronal: 0, ferias: 11.11, decimo: 8.33 };
export const JORNADA_PADRAO = {
  seg: { e: "07:30", sa: "11:30", r: "13:00", s: "17:00" }, ter: { e: "07:30", sa: "11:30", r: "13:00", s: "17:00" },
  qua: { e: "07:30", sa: "11:30", r: "13:00", s: "17:00" }, qui: { e: "07:30", sa: "11:30", r: "13:00", s: "17:00" },
  sex: { e: "07:30", sa: "11:30", r: "13:00", s: "17:00" }, sab: { e: "07:30", sa: "", r: "", s: "11:30" }, dom: null,
};

const min = h => { const m = /^(\d{1,2}):(\d{2})$/.exec(h || ""); return m ? +m[1] * 60 + +m[2] : null; };
/** minutos trabalhados num dia da jornada */
export function minutosDia(d) {
  if (!d) return 0;
  const e = min(d.e), s = min(d.s), sa = min(d.sa), r = min(d.r);
  if (e === null || s === null || s <= e) return 0;
  return (s - e) - (sa !== null && r !== null && r > sa ? r - sa : 0);
}
export const horasSemana = j => DIAS.reduce((t, [k]) => t + minutosDia(j && j[k]), 0) / 60;
export const fmtHoras = h => { const t = Math.round(h * 60); return Math.floor(t / 60) + "h" + (t % 60 ? String(t % 60).padStart(2, "0") : ""); };

/** "2026-10" -> { ini: "2026-10-01", fim: "2026-11-01", comp: "2026-10-01", ano, mes, dias } */
export function periodo(ym) {
  const [a, m] = ym.split("-").map(Number);
  const prox = m === 12 ? [a + 1, 1] : [a, m + 1];
  const p2 = n => String(n).padStart(2, "0");
  return { ini: `${a}-${p2(m)}-01`, fim: `${prox[0]}-${p2(prox[1])}-01`, comp: `${a}-${p2(m)}-01`, ano: a, mes: m, dias: new Date(a, m, 0).getDate() };
}
export const mesAtual = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); };
export const NOMES_MES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export const nomeMes = ym => { const { ano, mes } = periodo(ym); return NOMES_MES[mes - 1] + " de " + ano; };

/** Feriados nacionais fixos (Lei 662/1949, Lei 6.802/1980, Lei 14.759/2023) */
const FERIADOS = { "01-01": "Confraternização Universal", "04-21": "Tiradentes", "05-01": "Dia do Trabalho", "09-07": "Independência",
  "10-12": "N. Sra. Aparecida", "11-02": "Finados", "11-15": "Proclamação da República", "11-20": "Consciência Negra", "12-25": "Natal" };

/** Dias do mês para a folha de ponto */
export function diasDoMes(ym, jornada, extras = []) {
  const { ano, mes, dias } = periodo(ym);
  return Array.from({ length: dias }, (_, i) => {
    const d = new Date(ano, mes - 1, i + 1), k = DOW[d.getDay()], md = String(mes).padStart(2, "0") + "-" + String(i + 1).padStart(2, "0");
    const feriado = FERIADOS[md] || (extras.includes(i + 1) ? "Feriado" : "");
    return { dia: i + 1, k, nomeDia: DIAS.find(x => x[0] === k)[1], jornada: (jornada || {})[k] || null, feriado };
  });
}

/** 5º dia útil do mês seguinte (segunda a sábado, sem feriados nacionais) — prazo do art. 459 da CLT */
export function quintoDiaUtil(ym) {
  const { fim } = periodo(ym); const [a, m] = fim.split("-").map(Number);
  let n = 0;
  for (let d = 1; d <= 31; d++) {
    const dt = new Date(a, m - 1, d), md = String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
    if (dt.getDay() === 0 || FERIADOS[md]) continue;
    if (++n === 5) return `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
}

/** Salário proporcional quando admitido ou demitido dentro do mês (base 30 dias) */
function salarioDoMes(f, ym) {
  const { ini, fim, dias } = periodo(ym), sal = Number(f.salario) || 0;
  const de = f.admissao && f.admissao > ini ? f.admissao : ini;
  const ultimo = periodo(ym).ano + "-" + String(periodo(ym).mes).padStart(2, "0") + "-" + String(dias).padStart(2, "0");
  const ate = f.demissao && f.demissao < ultimo ? f.demissao : null;
  if (f.admissao && f.admissao >= fim) return { valor: 0, dias: 0 };
  if (f.demissao && f.demissao < ini) return { valor: 0, dias: 0 };
  if (de === ini && !ate) return { valor: sal, dias: 30 };
  const d0 = +de.slice(8, 10), d1 = ate ? +ate.slice(8, 10) : dias;
  const nd = Math.min(30, d1 - d0 + 1);
  return { valor: arred(sal / 30 * nd), dias: nd };
}

/**
 * Resumo do mês de um funcionário.
 * lancs: lançamentos da competência; baseComissao: mão de obra das O.S. entregues em que ele foi o mecânico.
 */
export function calcularMes(f, ym, lancs, baseComissao, encargos) {
  const enc = { ...ENCARGOS_PADRAO, ...(encargos || {}) };
  const sal = salarioDoMes(f, ym);
  const vh = Number(f.horas_mes) > 0 ? (Number(f.salario) || 0) / Number(f.horas_mes) : 0;
  const soma = t => lancs.filter(l => l.tipo === t);
  const valorDe = l => {
    if (Number(l.valor) > 0) return Number(l.valor);
    if (l.tipo === "hora_extra") return arred((Number(l.qtd) || 0) * vh * (1 + (Number(f.he_pct) || 0) / 100));
    if (l.tipo === "falta") return arred((Number(f.salario) || 0) / 30 * (Number(l.qtd) || 0));
    return 0;
  };
  const tot = t => arred(soma(t).reduce((s, l) => s + valorDe(l), 0));
  const comissaoAuto = arred((Number(baseComissao) || 0) * (Number(f.comissao_pct) || 0) / 100);
  const r = {
    salario: sal.valor, diasSalario: sal.dias, valorHora: arred(vh),
    horasExtras: tot("hora_extra"), qtdHorasExtras: soma("hora_extra").reduce((s, l) => s + (Number(l.qtd) || 0), 0),
    comissao: arred(comissaoAuto + tot("comissao")), comissaoAuto, baseComissao: arred(baseComissao || 0), bonus: tot("bonus"),
    faltas: tot("falta"), qtdFaltas: soma("falta").reduce((s, l) => s + (Number(l.qtd) || 0), 0),
    vales: arred(tot("vale") + tot("adiantamento")), descontos: tot("desconto"), inss: tot("inss"), pagos: tot("pagamento"),
  };
  r.proventos = arred(r.salario + r.horasExtras + r.comissao + r.bonus);
  r.remuneracao = arred(r.proventos - r.faltas); // base dos encargos
  r.totalDescontos = arred(r.faltas + r.vales + r.descontos + r.inss);
  r.liquido = arred(r.proventos - r.totalDescontos);
  r.saldo = arred(r.liquido - r.pagos);
  const ce = com_encargos(f.vinculo);
  r.encargos = {
    fgts: ce ? arred(r.remuneracao * enc.fgts / 100) : 0,
    inssPatronal: ce ? arred(r.remuneracao * enc.inssPatronal / 100) : 0,
    ferias: ce ? arred(r.remuneracao * enc.ferias / 100) : 0,
    decimo: ce ? arred(r.remuneracao * enc.decimo / 100) : 0,
  };
  r.encargos.fgtsProvisoes = ce ? arred((r.encargos.ferias + r.encargos.decimo) * enc.fgts / 100) : 0;
  r.totalEncargos = arred(Object.values(r.encargos).reduce((s, v) => s + v, 0));
  r.custoTotal = arred(r.remuneracao + r.totalEncargos);
  r.valorDe = valorDe;
  return r;
}

/** O funcionário é o mecânico desta O.S.? (pelo acesso vinculado ou pelo nome) */
const n = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
export const eMecanicoDa = (f, o) => (f.perfil_id && o.mecanico_id === f.perfil_id) || (!!o.mecanico_nome && [f.nome, f.apelido].filter(Boolean).some(x => n(x) === n(o.mecanico_nome)));
