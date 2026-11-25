// Robô do e-mail (v64, 24/11/2026, pedido do Danilo). Um ciclo: olha a caixa, confere os anexos dos e-mails novos,
// guarda o que achou em email_robo e manda o aviso curto no WhatsApp dele.
//
// Quem chama é o MOTOR DO TABLET (motor-zap/motor.js, cabeçalho x-dtcar-motor com a mesma chave do motor do WhatsApp)
// ou o botão "Conferir agora" da tela, com o login do administrador. O trabalho fica aqui porque a chave da Microsoft
// nunca sai do servidor — o motor só dá o pulso, como faz com a fila do WhatsApp.
//
// O robô SÓ OLHA E AVISA (decisão do Danilo): não lança, não responde, não apaga e não move nada.
import { buscar, anexo } from "./acoes.ts";
import type { Deps } from "./acoes.ts";

export interface Config { ligado: boolean; dias: number; avisar: boolean; limite: number }

const LIMITE_PADRAO = 20;

/** A chave liga/desliga e o intervalo ficam em cfg.roboEmail (tabela config): a tela grava, o motor obedece. */
export async function configDoBanco(adm: any): Promise<Config> {
  try {
    const { data } = await adm.from("config").select("dados").eq("id", 1).maybeSingle();
    const cfg = (data && data.dados && (data.dados as Record<string, unknown>).roboEmail) || null;
    return lerConfig(cfg as Record<string, unknown> | null);
  } catch (_) { return lerConfig(null); }
}

export function lerConfig(cfg: Record<string, unknown> | null): Config {
  const c = (cfg && typeof cfg === "object" ? cfg : {}) as Record<string, unknown>;
  return {
    ligado: c.ligado === true,
    dias: Math.min(Math.max(Number(c.dias) || 2, 1), 7),
    avisar: c.avisar !== false,
    limite: Math.min(Math.max(Number(c.limite) || LIMITE_PADRAO, 1), 50),
  };
}

/** O que o robô achou de um anexo, em palavras que a tela mostra como estão. */
export interface AchadoAnexo {
  nome: string; kb: number; baixa: boolean; aviso?: string;
  nfe?: { chave: string; no_sistema: boolean | null; onde?: string };
  boleto?: { linha: string; valor?: number; vencimento?: string | null; no_sistema: boolean | null; onde?: string };
}

/** A NF do anexo já entrou no sistema? (nota de entrada lançada ou nota baixada da SEFAZ) */
async function nfeNoSistema(adm: any, chave: string) {
  try {
    const { data: ne } = await adm.from("notas_entrada").select("id,numero").eq("chave", chave).maybeSingle();
    if (ne) return { chave, no_sistema: true, onde: "entrada de nota " + (ne.numero || "") };
    const { data: sf } = await adm.from("nfe_recebidas").select("id").eq("chave", chave).maybeSingle();
    if (sf) return { chave, no_sistema: true, onde: "notas da SEFAZ" };
    return { chave, no_sistema: false };
  } catch (_) { return { chave, no_sistema: null }; }
}

/** O boleto do anexo já está em contas a pagar? Compara pela linha digitável e pelo código de barras, só os dígitos. */
async function boletoNoSistema(adm: any, b: { linha?: string; codigo_barras?: string; valor?: number; vencimento?: string | null }) {
  const linha = String(b.linha || "").replace(/\D/g, ""), cb = String(b.codigo_barras || "").replace(/\D/g, "");
  const base = { linha, valor: b.valor, vencimento: b.vencimento ?? null };
  try {
    const { data } = await adm.from("contas").select("id,linha_digitavel,codigo_barras").eq("status", "aberta").limit(2000);
    const achou = (data || []).find((c: any) =>
      (linha && String(c.linha_digitavel || "").replace(/\D/g, "") === linha) ||
      (cb && String(c.codigo_barras || "").replace(/\D/g, "") === cb));
    return { ...base, no_sistema: !!achou, onde: achou ? "contas a pagar" : "" };
  } catch (_) { return { ...base, no_sistema: null }; }
}

/** Confere os anexos de um e-mail: se abrem de verdade e se o que veio já está no sistema. */
async function conferirAnexos(d: Deps, token: string, msg: any): Promise<AchadoAnexo[]> {
  const saida: AchadoAnexo[] = [];
  for (const a of (msg.anexos || [])) {
    const r: AchadoAnexo = { nome: a.nome || "anexo", kb: Number(a.tamanho_kb) || 0, baixa: false };
    try {
      const v = await anexo(d, token, msg.id, a.id) as Record<string, unknown>;
      // "conteudo" sozinho é a explicação de por que não dá para abrir (link, e-mail anexado, grande demais)
      r.baixa = !!(v.texto || v.nfe || v.imagem);
      if (!r.baixa) r.aviso = String(v.conteudo || "não deu para abrir");
      const nfe = v.nfe as { chave?: string } | undefined;
      const chave = (nfe && nfe.chave) || ((v.chaves_nfe as string[]) || [])[0];
      if (chave) r.nfe = await nfeNoSistema(d.adm, chave);
      const bol = ((v.boletos as any[]) || [])[0];
      if (bol) r.boleto = await boletoNoSistema(d.adm, bol);
    } catch (e) { r.baixa = false; r.aviso = (e as Error).message; }
    saida.push(r);
  }
  return saida;
}

export function pendenciasDe(anexos: AchadoAnexo[]): string[] {
  const p: string[] = [];
  for (const a of anexos) {
    if (!a.baixa) p.push("anexo que não abre");
    if (a.nfe && a.nfe.no_sistema === false) p.push("NF fora do sistema");
    if (a.boleto && a.boleto.no_sistema === false) p.push("boleto fora do sistema");
  }
  return [...new Set(p)];
}

/** O aviso curto, no estilo que o Danilo pediu: e-mail de Fulano "anexos". */
export function textoAviso(msg: any, pend: string[]): string {
  const quem = (msg.de && (msg.de.nome || msg.de.email)) || "remetente desconhecido";
  const oque = pend.length ? pend.join(", ") : (msg.anexos || []).length ? "anexos" : String(msg.categoria || "e-mail");
  return `e-mail de ${quem} "${oque}"`;
}

/** Um ciclo do robô. Devolve o resumo para quem chamou (motor ou tela). */
export async function rodar(d: Deps, token: string, cfg: Config, origem: string) {
  // o motor obedece à chave liga/desliga da tela; o "Conferir agora" (origem "tela") roda assim mesmo
  if (origem === "motor" && !cfg.ligado) return { origem, desligado: true, olhados: 0, novos: 0, avisados: 0, pendencias: 0 };
  const msgs = await buscar(d, token, { dias: cfg.dias, incluir: "todos", limite: cfg.limite }) as any;
  const lista: any[] = Array.isArray(msgs) ? msgs : (msgs && (msgs.mensagens || msgs.lista || msgs.itens)) || [];
  if (!lista.length) return { origem, olhados: 0, novos: 0, avisados: 0, pendencias: 0 };

  const ids = lista.map((m) => String(m.id));
  const { data: jaVistos } = await d.adm.from("email_robo").select("email_id").in("email_id", ids);
  const vistos = new Set((jaVistos || []).map((x: any) => x.email_id));

  let novos = 0, avisados = 0, comPendencia = 0;
  for (const m of lista) {
    if (vistos.has(String(m.id))) continue;
    const anexos = await conferirAnexos(d, token, m);
    const pend = pendenciasDe(anexos);
    if (pend.length) comPendencia++;
    let avisado = false;
    // aviso interno, pelo MESMO caminho dos outros alertas do sistema (SEFAZ, backup, contas a pagar):
    // whatsapp_alerta_na_fila (v32) manda para o número de alerta do Danilo, cadastrado em Sistema > WhatsApp.
    // Não é mensagem para cliente: não passa pelos limites por hora nem espera o horário comercial.
    if (cfg.avisar) {
      try {
        const { data, error } = await d.adm.rpc("whatsapp_alerta_na_fila", { p_texto: textoAviso(m, pend) });
        avisado = !error && data !== null;
      } catch (_) { avisado = false; }
    }
    // a linha é gravada DEPOIS do aviso: se a gravação falhar, o e-mail é conferido de novo na próxima volta,
    // o que é melhor do que marcar como visto um e-mail que nunca chegou a avisar
    const { error } = await d.adm.from("email_robo").insert({
      email_id: String(m.id), recebido_em: m.data || null,
      de_nome: (m.de && m.de.nome) || "", de_email: (m.de && m.de.email) || "",
      assunto: String(m.assunto || "").slice(0, 300), categoria: String(m.categoria || ""),
      anexos, pendencias: pend, avisado, avisado_em: avisado ? new Date().toISOString() : null,
    });
    if (error && !/duplicate|unique/i.test(error.message || "")) throw new Error(error.message);
    novos++; if (avisado) avisados++;
  }
  return { origem, olhados: lista.length, novos, avisados, pendencias: comPendencia };
}
