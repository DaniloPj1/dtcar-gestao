// Teste do e-mail da oficina (supabase/functions/email + ferramentas email_* do conector) sem Microsoft e sem banco reais.
// Rodar: deno run -A teste/teste_email.ts
// 1) filtro: cada camada decide como combinado (lixo, golpe, ignorar, importante/cadastro, útil, propaganda, revisar);
// 2) boletos e NF-e: linha digitável conferida (dígitos, banco, valor, vencimento), chave de NF-e, resumo do XML;
// 3) ações com Microsoft falsa: login (estado de 10 min, uma vez só, PKCE), renovação da chave, busca filtrada,
//    leitura, anexo XML/PDF, envio e resposta só com confirmar=true (com histórico), chave liga/desliga;
// 4) conector: ferramentas chamam a função "email" com os argumentos certos e devolvem o erro dela.
import { classificar, montarCtx, valorDaRegra, type Msg } from "../supabase/functions/email/filtro.ts";
import { acharBoletos, acharChavesNFe, lerLinhaBancaria, mod10, mod11Boleto, resumirNFe, vencimentoDoFator } from "../supabase/functions/email/documentos.ts";
import { retornoLogin, tratar, type Db, type Deps } from "../supabase/functions/email/acoes.ts";
import { tipoRH, competenciaRH } from "../supabase/functions/email/rh.ts";
import { createMcpHandler } from "npm:@modelcontextprotocol/server@2.4.0";
import { criarServidor, type Banco } from "../supabase/functions/agente/ferramentas.ts";

const ok: string[] = [], falhas: string[] = [];
const confere = (nome: string, cond: boolean, extra: unknown = "") => (cond ? ok : falhas).push(nome + (!cond && extra !== "" ? " :: " + JSON.stringify(extra) : ""));
const deve = async (nome: string, f: () => Promise<unknown>, rx: RegExp) => { try { await f(); confere(nome, false, "não deu erro"); } catch (e) { confere(nome, rx.test((e as Error).message), (e as Error).message); } };

// ---------------- 1. filtro ----------------
const ctx = montarCtx(
  [{ tipo: "fraude", alvo: "nome", valor: "Sisbra" }, { tipo: "fraude", alvo: "nome", valor: "itev" }, { tipo: "importante", alvo: "dominio", valor: "gov.br" },
   { tipo: "importante", alvo: "dominio", valor: "sicredi.com.br" }, { tipo: "ignorar", alvo: "remetente", valor: "ofertas@dpk.com.br" },
   { tipo: "importante", alvo: "assunto", valor: "orcamento aprovado" }],
  [{ email: "Cobranca@DPK.com.br", tipo: "fornecedor", nome: "DPK" }, { email: "financeiro@marbrasa.com.br", tipo: "cliente", nome: "Marbrasa" }]);
const m = (x: Partial<Msg>): Msg => ({ de_email: "alguem@exemplo.com", de_nome: "Alguém", assunto: "Olá", previa: "", anexos: [], ...x });
const dec = (x: Partial<Msg>) => classificar(m(x), ctx);
confere("filtro: lixo eletrônico sempre fora, mesmo de cadastro", dec({ de_email: "cobranca@dpk.com.br", lixo: true }).decisao === "ignorado");
const golpe = dec({ de_nome: "SISBRA EMPRESARIAL LTDA", assunto: "Boleto vencido", anexos: [{ nome: "boleto.pdf", tipo: "application/pdf" }] });
confere("filtro: golpe conhecido com cobrança vira alerta de não pagar", golpe.decisao === "fraude" && /Não pague/.test(golpe.alerta || ""), golpe);
confere("filtro: golpe por nome não pega palavra parecida (itevaldo)", dec({ de_nome: "Itevaldo Souza" }).decisao !== "fraude");
confere("filtro: golpe por NOME não derruba fornecedor cadastrado (ex.: Pneus Costa Ltda)", dec({ de_email: "cobranca@dpk.com.br", de_nome: "ITEV Informações" }).decisao === "importante");
confere("filtro: aviso do banco citando o golpe no corpo continua importante", dec({ de_email: "avisos@sicredi.com.br", assunto: "Cuidado com boletos falsos", previa: "golpe do ITEV" }).decisao === "importante");
confere("filtro: golpe por nome vale para remetente desconhecido", dec({ de_email: "x@desconhecido.com", de_nome: "ITEV Informações Tributárias" }).decisao === "fraude");
const falsoBanco = dec({ de_email: "avisos@sicredi.com.br", assunto: "Boleto", sem_autenticacao: true });
confere("filtro: remetente conhecido que falhou na conferência cai para revisar, com alerta", falsoBanco.decisao === "revisar" && /pode ser falso/.test(falsoBanco.alerta || ""), falsoBanco);
confere("filtro: regra ignorar vence o domínio do fornecedor", dec({ de_email: "ofertas@dpk.com.br", assunto: "Promoção de pastilhas" }).decisao === "ignorado");
const forn = dec({ de_email: "COBRANCA@dpk.com.br", assunto: "Seu extrato" });
confere("filtro: e-mail cadastrado (fornecedor) é importante, sem diferença de maiúscula", forn.decisao === "importante" && forn.cadastro?.nome === "DPK", forn);
confere("filtro: cliente cadastrado é importante", dec({ de_email: "financeiro@marbrasa.com.br" }).decisao === "importante");
confere("filtro: subdomínio de gov.br é importante", dec({ de_email: "nao-responda@sefaz.es.gov.br", lista: true }).decisao === "importante");
confere("filtro: domínio parecido NÃO bate (sicredi.com.br.golpe.com)", dec({ de_email: "x@sicredi.com.br.golpe.com", lista: true }).decisao === "ignorado");
confere("filtro: regra por trecho do assunto (sem acento)", dec({ assunto: "Orçamento aprovado — Hilux" }).decisao === "importante");
const xml = dec({ anexos: [{ nome: "35261145987005026588550010007185701000000001.xml", tipo: "text/xml" }], lista: true });
confere("filtro: XML de nota é útil mesmo vindo de lista", xml.decisao === "util" && xml.categoria === "nota fiscal", xml);
confere("filtro: PDF com assunto de boleto é útil", dec({ assunto: "Segunda via do boleto", anexos: [{ nome: "doc.pdf", tipo: "application/pdf" }], lista: true }).decisao === "util");
confere("filtro: assunto de cobrança sem lista é útil", dec({ assunto: "Fatura de novembro" }).decisao === "util");
confere("filtro: 'pedido' em propaganda de lista não passa", dec({ assunto: "Seu pedido com 20% OFF", lista: true }).decisao === "ignorado");
confere("filtro: caixa Outros do Outlook fica fora", dec({ foco: "other" }).decisao === "ignorado");
confere("filtro: remetente newsletter@ fica fora", dec({ de_email: "newsletter@loja.com.br" }).decisao === "ignorado");
confere("filtro: ordem de compra de cliente é útil", dec({ de_email: "compras@granicap.com.br", assunto: "Ordem de Compra nº 12622 - GRANICAP" }).decisao === "util");
confere("filtro: o resto vai para revisar", dec({ assunto: "Oi, tudo bem?" }).decisao === "revisar");
confere("filtro: regra de remetente com nome vira só o e-mail", valorDaRegra("remetente", "Financeiro <Boleto@Fornecedor.com.br>") === "boleto@fornecedor.com.br");
confere("filtro: regra de domínio a partir de e-mail", valorDaRegra("dominio", "vendas@WWW.Loja.com.br") === "loja.com.br");

// ---------------- 2. boletos e NF-e ----------------
// monta um boleto do Sicredi a partir do código de barras (dígitos conferidos pelas regras da FEBRABAN)
function montarLinha(barrasSemDv: string) { // 43 números: banco(3) moeda(1) fator(4) valor(10) livre(25)
  const dv = mod11Boleto(barrasSemDv);
  const b = barrasSemDv.slice(0, 4) + dv + barrasSemDv.slice(4);
  const c1 = b.slice(0, 4) + b.slice(19, 24), c2 = b.slice(24, 34), c3 = b.slice(34, 44);
  return `${c1.slice(0, 5)}.${c1.slice(5)}${mod10(c1)} ${c2.slice(0, 5)}.${c2.slice(5)}${mod10(c2)} ${c3.slice(0, 5)}.${c3.slice(5)}${mod10(c3)} ${dv} ${b.slice(5, 19)}`;
}
const fator = 1000 + Math.round((Date.UTC(2026, 10, 25) - Date.UTC(2025, 1, 22)) / 86400000); // 25/11/2026
const linha = montarLinha("7489" + fator + "0000022666" + "1523160854530000000012345");
const hoje = new Date("2026-11-04T12:00:00Z");
const bol = lerLinhaBancaria(linha, hoje);
confere("boleto: dígitos conferem", bol.digitos_ok, bol);
confere("boleto: banco Sicredi, valor e vencimento", bol.banco_nome === "Sicredi" && bol.valor === 226.66 && bol.vencimento === "2026-11-25", bol);
const errada = linha.slice(0, 13) + (linha[13] === "9" ? "0" : String(Number(linha[13]) + 1)) + linha.slice(14);
confere("boleto: um número trocado reprova", !lerLinhaBancaria(errada, hoje).digitos_ok);
confere("boleto: vencimento depois da virada do fator (fev/2025)", vencimentoDoFator(1000, hoje) === "2025-02-22" && vencimentoDoFator(9999, new Date("2025-01-01")) === "2025-02-21");
const achados = acharBoletos("Prezado cliente, segue a linha digitável:\n" + linha + "\nVencimento 25/11/2026. Conta de luz: 836200000005 667800481000 180975657313 001589636081", hoje);
const grudada = acharBoletos("Final: OBJETIVA \" 75691.30078 01020.688105 07469.890110 9 16220000016300756-0 Local de Pagamento", hoje);
confere("boleto: linha grudada no texto seguinte (PDF real do Sicoob/Objetiva)", grudada.length === 1 && grudada[0].digitos_ok && grudada[0].valor === 163 && grudada[0].vencimento === "2026-11-06" && grudada[0].banco_nome === "Sicoob", grudada);
confere("arrecadação: dígito geral trocado reprova", !acharBoletos("836200000005 667800481000 180975657313 001589636081".replace(/^8362/, "8363"), hoje).some((b) => b.digitos_ok));
confere("boleto: acha bancário e de arrecadação no texto", achados.length === 2 && achados[0].digitos_ok && achados[1].tipo === "arrecadacao" && achados[1].digitos_ok, achados);
const chave = "32261145987005026588550010007185701000000017";
confere("NF-e: acha a chave de 44 números (com espaços)", acharChavesNFe("Chave: " + chave.replace(/(\d{4})/g, "$1 ").trim())[0] === chave);
const xmlNfe = `<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe${chave}" versao="4.00"><ide><nNF>718570</nNF><serie>1</serie><dhEmi>2026-11-01T10:00:00-03:00</dhEmi></ide>
<emit><CNPJ>45987005026588</CNPJ><xNome>DPK COMERCIAL AUTOMOTIVA SA</xNome><xFant>DPK</xFant></emit><dest><CNPJ>49016409000195</CNPJ><xNome>DTCAR CENTRO AUTOMOTIVO LTDA</xNome></dest>
<det nItem="1"><prod><xProd>PASTILHA</xProd></prod></det><det nItem="2"><prod><xProd>DISCO</xProd></prod></det>
<total><ICMSTot><vNF>453.32</vNF></ICMSTot></total><cobr><dup><nDup>001</nDup><dVenc>2026-12-01</dVenc><vDup>226.66</vDup></dup><dup><nDup>002</nDup><dVenc>2027-01-01</dVenc><vDup>226.66</vDup></dup></cobr></infNFe></NFe></nfeProc>`;
const nf = resumirNFe(xmlNfe);
confere("NF-e: resumo do XML (chave, número, emitente, valor, itens, duplicatas)", !!nf && nf.chave === chave && nf.numero === "718570" && nf.emitente?.nome === "DPK" && nf.valor === 453.32
  && nf.itens === 2 && nf.duplicatas.length === 2 && nf.duplicatas[1].vencimento === "2027-01-01", nf);
confere("NF-e: XML que não é nota devolve nada", resumirNFe("<html></html>") === null);

// ---------------- 2b. Documentos do RH: tipo e mês pelo nome do arquivo ----------------
confere("rh: tipos pelo nome dos PDFs da Loredo", tipoRH("PRO LABORE 10.2026 - DTCAR.pdf") === "pro_labore" && tipoRH("RECIBO ADIANTAMENTO 10.2026 - DTCAR.pdf") === "adiantamento"
  && tipoRH("RECIBO 10.2026 - DTCAR.pdf") === "recibo" && tipoRH("FOLHA DE PONTO 11.2026 - DTCAR.pdf") === "folha_ponto" && tipoRH("DARF 09.2026 - DTCAR.pdf") === "darf"
  && tipoRH("FGTS 09.2026 - DTCAR.pdf") === "fgts" && tipoRH("RESUMO LAUDOS - DTCAR.pdf") === "laudo" && tipoRH("CONTROLE DE ENTREGA DE EPI.pdf") === "epi"
  && tipoRH("PGDAS 10-2026.pdf") === "das" && tipoRH("doc.pdf", "IMPOSTOS E PRO LABORE 09.2026") === "pro_labore" && tipoRH("x.pdf", "Oi") === "outro");
confere("rh: mês pelo nome, pelo assunto ou pela data do e-mail", competenciaRH("PRO LABORE 10.2026 - DTCAR.pdf", "", "2026-11-04T10:00:00Z") === "2026-10"
  && competenciaRH("FOLHA DE PONTO 11.2026.pdf", "", "2026-11-04") === "2026-11" && competenciaRH("doc.pdf", "IMPOSTOS 09/2026", "2026-10-14") === "2026-09"
  && competenciaRH("das_102026.pdf", "", "2026-11-04") === "2026-10" && competenciaRH("RESUMO LAUDOS.pdf", "RESUMO LAUDOS", "2026-09-16T10:00:00Z") === "2026-09"
  && competenciaRH("NF 12.20261.pdf", "", "2026-05-01") === "2026-05");

// ---------------- 3. ações com Microsoft e banco falsos ----------------
type Linha = Record<string, unknown>;
function bancoFalso(tabelas: Record<string, Linha[]>, rpcs: Record<string, (a: Record<string, unknown>) => unknown>) {
  const chamadas: Array<[string, unknown]> = [];
  const db: Db = {
    rpc(f: string, a: Record<string, unknown> = {}) { chamadas.push([f, a]); const r = rpcs[f]; return Promise.resolve(r ? { data: r(a), error: null } : { data: null, error: { message: "função " + f + " não existe" } }); },
    from(t: string) {
      const filtros: Array<[string, unknown, string?]> = []; let op: "select" | "update" | "delete" | "upsert" = "select"; let dados: Linha = {};
      const exec = () => {
        const lista = (tabelas[t] = tabelas[t] || []);
        const bate = (l: Linha) => filtros.every(([k, v, como]) => como === "gt" ? String(l[k] ?? "") > String(v) : l[k] === v);
        if (op === "update") { const alvo = lista.filter(bate); alvo.forEach((l) => Object.assign(l, dados)); return { data: alvo.map((l) => ({ ...l })), error: null }; }
        if (op === "delete") tabelas[t] = lista.filter((l) => !bate(l));
        if (op === "upsert") { const e = lista.find((l) => l.id === dados.id); if (e) Object.assign(e, dados); else lista.push({ ...dados }); }
        return { data: op === "select" ? lista.filter(bate).map((l) => ({ ...l })) : null, error: null };
      };
      // deno-lint-ignore no-explicit-any
      const q: any = {
        select() { return q; }, order() { return q; }, eq(k: string, v: unknown) { filtros.push([k, v]); return q; }, gt(k: string, v: unknown) { filtros.push([k, v, "gt"]); return q; },
        update(d: Linha) { op = "update"; dados = d; chamadas.push(["update:" + t, d]); return q; }, delete() { op = "delete"; chamadas.push(["delete:" + t, null]); return q; },
        upsert(d: Linha) { op = "upsert"; dados = d; chamadas.push(["upsert:" + t, d]); return Promise.resolve(exec()); },
        then(a: (v: unknown) => unknown, b?: (e: unknown) => unknown) { return Promise.resolve(exec()).then(a, b); },
      };
      return q;
    },
  };
  return { db, chamadas };
}

const tabelas: Record<string, Linha[]> = {
  email_conexao: [{ id: 1, ligado: true, situacao: "desligado", conta: "", nome: "" }],
  email_token: [],
  email_regras: [{ id: 1, tipo: "fraude", alvo: "nome", valor: "sisbra", ativo: true }, { id: 2, tipo: "importante", alvo: "dominio", valor: "sicredi.com.br", ativo: true }],
};
const envios: unknown[] = [];
const { db, chamadas } = bancoFalso(tabelas, {
  email_resumo: () => ({ ...tabelas.email_conexao[0], regras: 2 }),
  email_contatos: () => [{ email: "cobranca@dpk.com.br", tipo: "fornecedor", nome: "DPK" }],
  email_registrar_envio: (a) => { envios.push(a.p); return envios.length; },
  email_regra_salvar: (a) => ({ id: 9, tipo: a.p_tipo, alvo: a.p_alvo, valor: a.p_valor }),
});
let relogio = new Date("2026-11-04T13:00:00Z");
const envFalso: Record<string, string> = { SUPABASE_URL: "https://proj.supabase.co" };
const deps: Deps = { usuario: db, adm: db, env: (k) => envFalso[k], agora: () => relogio, textoPdf: () => Promise.resolve("Boleto DPK\n" + linha) };

// Microsoft falsa
const pedidos: Array<{ url: string; metodo: string; corpo: string; auth: string }> = [];
const caixa = [
  { id: "AAMkAD-dpk-0001", receivedDateTime: "2026-11-04T11:00:00Z", subject: "Boleto NF 718570", from: { emailAddress: { name: "DPK Cobrança", address: "cobranca@dpk.com.br" } },
    bodyPreview: "Segue boleto", hasAttachments: true, isRead: false, inferenceClassification: "focused", parentFolderId: "inbox",
    attachments: [{ id: "ANX-xml-000001", name: "nfe.xml", contentType: "text/xml", size: 4000 }, { id: "ANX-pdf-000001", name: "boleto.pdf", contentType: "application/pdf", size: 50000 }] },
  { id: "AAMkAD-sisb-0002", receivedDateTime: "2026-11-04T10:00:00Z", subject: "Boleto em aberto", from: { emailAddress: { name: "Sisbra Empresarial", address: "cobranca@sisbra.net" } },
    bodyPreview: "Evite protesto", hasAttachments: false, inferenceClassification: "focused", parentFolderId: "inbox", attachments: [] },
  { id: "AAMkAD-promo-003", receivedDateTime: "2026-11-03T10:00:00Z", subject: "Ofertas da semana", from: { emailAddress: { name: "Loja", address: "contato@loja.com.br" } },
    bodyPreview: "20% off", internetMessageHeaders: [{ name: "List-Unsubscribe", value: "<mailto:x>" }], inferenceClassification: "other", parentFolderId: "inbox", attachments: [] },
  { id: "AAMkAD-falso-05", receivedDateTime: "2026-11-04T09:00:00Z", subject: "Boleto atualizado", from: { emailAddress: { name: "Sicredi", address: "boletos@sicredi.com.br" } },
    bodyPreview: "Pague hoje", internetMessageHeaders: [{ name: "Authentication-Results", value: "spf=fail smtp.mailfrom=sicredi.com.br; dkim=none; dmarc=fail action=none" }],
    inferenceClassification: "focused", parentFolderId: "inbox", attachments: [] },
  { id: "AAMkAD-velho-004", receivedDateTime: "2026-10-20T10:00:00Z", subject: "Fatura antiga", from: { emailAddress: { name: "X", address: "x@y.com.br" } },
    bodyPreview: "", inferenceClassification: "focused", parentFolderId: "inbox", attachments: [] },
];
const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)));
globalThis.fetch = (async (entrada: string | URL | Request, init?: RequestInit) => {
  const url = String(entrada instanceof Request ? entrada.url : entrada), metodo = init?.method || "GET";
  const corpo = typeof init?.body === "string" ? init.body : "";
  pedidos.push({ url, metodo, corpo, auth: String((init?.headers as Record<string, string>)?.authorization || "") });
  const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
  if (url.includes("/oauth2/v2.0/token")) {
    const p = new URLSearchParams(corpo);
    if (p.get("grant_type") === "authorization_code") return p.get("code") === "codigo-bom" && p.get("code_verifier") ? j({ access_token: "AT1", refresh_token: "RT1", expires_in: 3600 }) : j({ error: "invalid_grant" }, 400);
    if (p.get("refresh_token") === "RT-revogado") return j({ error: "invalid_grant", error_description: "AADSTS70000: revogado" }, 400);
    return j({ access_token: "AT2", refresh_token: "RT2", expires_in: 3600 });
  }
  if (url.includes("/me?$select")) return j({ displayName: "DTCar", mail: "CentroAutomotivoDTCar@hotmail.com" });
  if (/\/mailFolders\/(junkemail|deleteditems|drafts)\?/.test(url)) return j({ id: url.match(/mailFolders\/(\w+)/)![1] });
  if (url.includes("/mailFolders/inbox/messages?")) return j({ value: caixa });
  // pasta cheia: sempre há mais páginas, todas dentro do período
  if (url.includes("/mailFolders/archive/messages?") || url.includes("pagina-seguinte")) return j({ value: Array.from({ length: 50 }, (_, i) => ({ ...caixa[2], id: "AAMkAD-arq-" + i + "-" + pedidos.length, receivedDateTime: "2026-11-04T08:00:00Z" })), "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/pagina-seguinte" });
  // conta que recusa a lista com anexos (400), mas aceita com cabeçalhos
  if (url.includes("/mailFolders/sentitems/messages?")) return new URL(url).searchParams.has("$expand") ? j({ error: { code: "BadRequest", message: "não" } }, 400) : j({ value: [caixa[2]] });
  if (url.includes("/attachments/ANX-xml-000001")) return j({ "@odata.type": "#microsoft.graph.fileAttachment", name: "nfe.xml", contentType: "text/xml", size: 4000, contentBytes: b64(xmlNfe) });
  if (url.includes("/attachments/ANX-pdf-000001")) return j({ "@odata.type": "#microsoft.graph.fileAttachment", name: "boleto.pdf", contentType: "application/pdf", size: 50000, contentBytes: b64("%PDF-1.4 falso") });
  if (/\/messages\/AAMkAD-dpk-0001\?/.test(url)) return j({ ...caixa[0], body: { content: "Bom dia,\nSegue boleto da NF 718570.\nLinha: " + linha + "\nChave " + chave }, toRecipients: [{ emailAddress: { address: "centroautomotivodtcar@hotmail.com" } }], ccRecipients: [{ emailAddress: { address: "vendas@dpk.com.br" } }], replyTo: [] });
  if (url.endsWith("/me/sendMail") || /\/reply(All)?$/.test(url)) return new Response(null, { status: 202 });
  return j({ error: { code: "NotFound", message: "não achei " + url } }, 404);
}) as typeof fetch;

await deve("sem MS_CLIENT_ID: conectar explica o segredo que falta", () => tratar("conectar", {}, deps), /MS_CLIENT_ID/);
const sit0 = await tratar("situacao", {}, deps) as Record<string, unknown>;
confere("situação: mostra o endereço de retorno e que falta configurar", sit0.configurado === false && sit0.endereco_retorno === "https://proj.supabase.co/functions/v1/email" && Array.isArray(sit0.lista_regras), sit0);
envFalso.MS_CLIENT_ID = "11111111-2222-3333-4444-555555555555";
const con = await tratar("conectar", {}, deps) as { url: string };
const u = new URL(con.url);
confere("conectar: login da Microsoft de contas pessoais com PKCE, sem pedir apagar/mover", u.pathname === "/consumers/oauth2/v2.0/authorize" && u.searchParams.get("code_challenge_method") === "S256"
  && u.searchParams.get("redirect_uri") === "https://proj.supabase.co/functions/v1/email" && /Mail\.Read/.test(u.searchParams.get("scope")!) && /Mail\.Send/.test(u.searchParams.get("scope")!)
  && !/ReadWrite/.test(u.searchParams.get("scope")!) && /offline_access/.test(u.searchParams.get("scope")!), con.url);
const estado = u.searchParams.get("state")!;
const r1 = await retornoLogin(new URL("https://proj.supabase.co/functions/v1/email?code=codigo-bom&state=OUTRO"), deps);
confere("retorno: estado diferente é recusado", !r1.ok && /não confere/.test(r1.msg));
relogio = new Date(relogio.getTime() + 11 * 60000);
const r2 = await retornoLogin(new URL("https://x/?code=codigo-bom&state=" + estado), deps);
confere("retorno: login com mais de 10 minutos é recusado", !r2.ok && /venceu/.test(r2.msg));
relogio = new Date("2026-11-04T13:00:00Z");
const con2 = new URL((await tratar("conectar", {}, deps) as { url: string }).url);
const r3 = await retornoLogin(new URL("https://x/?code=codigo-bom&state=" + con2.searchParams.get("state")), deps);
confere("retorno: guarda a chave e a conta (em minúsculo)", r3.ok && tabelas.email_token[0].refresh_token === "RT1" && tabelas.email_conexao[0].conta === "centroautomotivodtcar@hotmail.com"
  && tabelas.email_conexao[0].situacao === "conectado", { r3, t: tabelas.email_token[0] });
confere("retorno: verificador PKCE foi junto e o estado foi apagado", new URLSearchParams(pedidos.find((p) => p.corpo.includes("authorization_code"))!.corpo).get("code_verifier")!.length > 40 && !tabelas.email_token[0].estado);
const r4 = await retornoLogin(new URL("https://x/?code=codigo-bom&state=" + con2.searchParams.get("state")), deps);
confere("retorno: o mesmo retorno não vale duas vezes e não estraga a conexão", !r4.ok && tabelas.email_conexao[0].situacao === "conectado" && tabelas.email_token[0].refresh_token === "RT1");
confere("retorno: verificador apagado depois da troca", !tabelas.email_token[0].verificador);

// busca filtrada
const busca = await tratar("buscar", { dias: 3 }, deps) as Record<string, any>;
confere("buscar: só o importante por padrão (DPK), sem propaganda nem e-mail fora do período", busca.emails.length === 1 && busca.emails[0].id === "AAMkAD-dpk-0001" && busca.emails[0].cadastro === "fornecedor: DPK", busca.emails);
confere("buscar: golpe vira alerta e contagem confere", busca.alertas?.length === 2 && busca.alertas.some((a: any) => /Não pague/.test(a.alerta)) && busca.contagem.golpes === 1 && busca.contagem.ignorados === 1, busca);
confere("buscar: e-mail falso do banco (DMARC reprovado) não entra como importante", !busca.emails.some((e: any) => e.id === "AAMkAD-falso-05") && busca.alertas.some((a: any) => /pode ser falso/.test(a.alerta)));
confere("buscar: período lido inteiro não marca incompleto", !busca.incompleto);
confere("buscar: usa a chave de acesso guardada (sem renovar à toa)", pedidos.filter((p) => p.url.includes("graph.microsoft.com")).every((p) => p.auth === "Bearer AT1"));
const fora = await tratar("buscar", { dias: 3, incluir: "fora" }, deps) as Record<string, any>;
confere("buscar: incluir=fora mostra o que ficou de fora", fora.emails.length === 3 && fora.emails.some((e: any) => e.filtro === "fraude") && fora.emails.some((e: any) => e.filtro === "ignorado"));
const cheia = await tratar("buscar", { dias: 30, pasta: "arquivo", incluir: "todos" }, deps) as Record<string, any>;
confere("buscar: período com e-mail demais avisa que leu só parte (incompleto, lido_ate)", cheia.incompleto === true && !!cheia.lido_ate && /Diminua os dias/.test(cheia.aviso_periodo), { inc: cheia.incompleto, n: cheia.emails.length });
const red = await tratar("buscar", { dias: 3, pasta: "enviados", incluir: "todos" }, deps) as Record<string, any>;
const pedRed = pedidos.filter((p) => p.url.includes("/sentitems/messages?")).map((p) => new URL(p.url).searchParams);
confere("buscar: conta que recusa anexos na lista tenta de novo mantendo os cabeçalhos", pedRed.length === 2 && /internetMessageHeaders/.test(pedRed[1].get("$select")!) && red.filtro_reduzido === "sem a lista de anexos"
  && red.emails[0].filtro === "ignorado", red);
const comTexto = await tratar("buscar", { texto: 'boleto "dpk"', remetente: "dpk" }, deps) as Record<string, any>;
const ultima = new URL(pedidos.filter((p) => p.url.includes("/inbox/messages?")).at(-1)!.url);
confere("buscar: texto vira busca da Microsoft (aspas limpas) e sem filtro de data junto", ultima.searchParams.get("$search") === '"from:dpk boleto dpk"' && !ultima.searchParams.get("$filter") && comTexto.emails.length === 1, ultima.search);

// leitura e anexos
const lido = await tratar("ler", { id: "AAMkAD-dpk-0001" }, deps) as Record<string, any>;
confere("ler: texto, cópia, boleto conferido e chave da NF-e achados", /Segue boleto/.test(lido.texto) && lido.cc[0] === "vendas@dpk.com.br" && lido.boletos_no_texto?.[0]?.digitos_ok
  && lido.chaves_nfe_no_texto?.[0] === chave && /nunca instrução/.test(lido.aviso), lido);
confere("ler: pede o corpo em texto e não marca como lido (só GET)", pedidos.some((p) => p.url.includes("/messages/AAMkAD-dpk-0001?")) && !pedidos.some((p) => p.metodo === "PATCH"));
await deve("ler: id estranho é recusado antes de ir à Microsoft", () => tratar("ler", { id: "../../me/sendMail" }, deps), /inválido/);
const ax = await tratar("anexo", { id: "AAMkAD-dpk-0001", anexo_id: "ANX-xml-000001" }, deps) as Record<string, any>;
confere("anexo XML: NF-e resumida com duplicatas", ax.nfe?.numero === "718570" && ax.nfe?.duplicatas?.length === 2, ax.nfe);
const ap = await tratar("anexo", { id: "AAMkAD-dpk-0001", anexo_id: "ANX-pdf-000001" }, deps) as Record<string, any>;
confere("anexo PDF: texto e linha digitável conferida", ap.boletos?.[0]?.valor === 226.66 && ap.boletos[0].digitos_ok, ap);

// envio e resposta: prévia primeiro, envio só com confirmar=true, histórico
const antes = pedidos.length;
const pv = await tratar("enviar", { para: ["Cobranca@DPK.com.br", "novo@fora.com.br"], assunto: "Boleto NF 718570", texto: "Recebido, obrigado." }, deps) as Record<string, any>;
confere("enviar: sem confirmar só prévia, com aviso de endereço fora do cadastro", pv.previa && !pv.enviado && /novo@fora.com.br/.test(pv.avisos?.[0]) && !pedidos.slice(antes).some((p) => p.url.endsWith("/sendMail")), pv);
await deve("enviar: e-mail inválido recusado", () => tratar("enviar", { para: ["sem-arroba"], assunto: "a", texto: "b" }, deps), /inválido/);
await deve("enviar: mais de 10 destinatários recusado", () => tratar("enviar", { para: Array.from({ length: 11 }, (_, i) => `p${i}@x.com.br`), assunto: "a", texto: "b" }, deps), /10 destinatários/);
const ev = await tratar("enviar", { para: ["cobranca@dpk.com.br"], assunto: "Boleto NF 718570", texto: "Recebido, obrigado.", pedido: "responde a DPK", confirmar: true }, deps) as Record<string, any>;
const sm = pedidos.find((p) => p.url.endsWith("/sendMail"))!;
confere("enviar: confirmado envia pela Microsoft como texto e registra no histórico", ev.enviado && JSON.parse(sm.corpo).message.body.contentType === "Text" && JSON.parse(sm.corpo).saveToSentItems === true
  && envios.length === 1 && (envios[0] as Linha).pedido === "responde a DPK", ev);
const pr = await tratar("responder", { id: "AAMkAD-dpk-0001", texto: "Recebido." }, deps) as Record<string, any>;
confere("responder: prévia para o remetente", pr.previa && pr.para[0] === "cobranca@dpk.com.br" && !pr.cc.length && !pedidos.some((p) => /\/reply$/.test(p.url)), pr);
const prT = await tratar("responder", { id: "AAMkAD-dpk-0001", texto: "Recebido.", todos: true }, deps) as Record<string, any>;
confere("responder a todos: inclui a cópia e tira o próprio endereço", prT.cc.includes("vendas@dpk.com.br") && !prT.cc.includes("centroautomotivodtcar@hotmail.com"), prT);
await tratar("responder", { id: "AAMkAD-dpk-0001", texto: "Recebido.", confirmar: true }, deps);
confere("responder: confirmado usa reply e registra", pedidos.some((p) => /\/messages\/AAMkAD-dpk-0001\/reply$/.test(p.url) && JSON.parse(p.corpo).comment === "Recebido.") && envios.length === 2);

// renovação da chave e chave revogada
relogio = new Date("2026-11-04T14:30:00Z");
await tratar("buscar", {}, deps);
confere("chave vencida é renovada e a nova é guardada", tabelas.email_token[0].access_token === "AT2" && tabelas.email_token[0].refresh_token === "RT2");
tabelas.email_token[0].refresh_token = "RT-revogado"; tabelas.email_token[0].expira_em = "2026-11-04T00:00:00Z";
await deve("chave revogada pede para conectar de novo", () => tratar("buscar", {}, deps), /conectar o e-mail de novo/);
confere("chave revogada marca a situação como problema", tabelas.email_conexao[0].situacao === "erro");
tabelas.email_conexao[0].ligado = false;
await deve("desligado na chave: não lê nada", () => tratar("buscar", {}, deps), /desligado/);
tabelas.email_conexao[0].ligado = true;
await tratar("desconectar", {}, deps);
confere("desconectar apaga a chave guardada", !tabelas.email_token.length && tabelas.email_conexao[0].situacao === "desligado");
const rg = await tratar("regra", { tipo: "ignorar", alvo: "remetente", valor: "Ofertas <OFERTAS@Loja.com.br>" }, deps) as Linha;
confere("regra: normaliza antes de gravar", rg.valor === "ofertas@loja.com.br" && chamadas.some(([f]) => f === "email_regra_salvar"));

// rh_abrir: documento do RH da pasta privada "rh" (sem Microsoft)
tabelas.rh_documentos = [{ id: "4f6c1f5e-8a2b-4c1d-9e3f-0a1b2c3d4e5f", competencia: "2026-10", tipo: "darf", titulo: "DARF 10.2026", nome_arquivo: "DARF 10.2026.pdf",
  tipo_arquivo: "application/pdf", arquivo: "2026-10/x-darf.pdf", valor: null, vencimento: null, linha_digitavel: "-" }];
const baixados: string[] = [];
// deno-lint-ignore no-explicit-any
(db as any).storage = { from: (b: string) => ({ download: (c: string) => { baixados.push(b + "/" + c); return Promise.resolve({ data: new Blob(["%PDF"]), error: null }); } }) };
const rhA = await tratar("rh_abrir", { id: "4f6c1f5e-8a2b-4c1d-9e3f-0a1b2c3d4e5f" }, deps) as Linha;
confere("rh_abrir: lê o PDF da pasta rh, devolve o texto e as guias, sem o caminho do arquivo",
  baixados[0] === "rh/2026-10/x-darf.pdf" && String(rhA.texto).includes("Boleto DPK") && Array.isArray(rhA.boletos) && !("arquivo" in rhA) && rhA.linha_digitavel === "", rhA);
let rhErro = "";
try { await tratar("rh_abrir", { id: "00000000-0000-0000-0000-000000000000" }, deps); } catch (e) { rhErro = (e as Error).message; }
confere("rh_abrir: id que não existe avisa", /não encontrado/.test(rhErro), rhErro);
try { await tratar("rh_abrir", { id: "../../segredo" }, deps); rhErro = ""; } catch (e) { rhErro = (e as Error).message; }
confere("rh_abrir: id fora do formato é recusado", /id do documento/.test(rhErro), rhErro);

// ---------------- 4. conector ----------------
const invocadas: Array<[string, Record<string, unknown>]> = [];
let rhChamadas = 0;
const banco: Banco = {
  rpc: () => Promise.resolve({ data: {}, error: null }),
  functions: { invoke(nome: string, op: { body: Record<string, unknown> }) {
    invocadas.push([nome, op.body]);
    if (op.body.acao === "importar_rh") { rhChamadas++; return Promise.resolve({ data: rhChamadas === 1
      ? { importados: 2, novos: [{ id: "a" }, { id: "b" }], restam: 3, erros: [{ arquivo: "x.pdf", erro: "falhou" }], remetentes: ["dploredocontabilidade@gmail.com"], emails_achados: 3, email_mais_recente: "2026-11-04T16:38:26Z" }
      : { importados: 0, novos: [], restam: 3, erros: [{ arquivo: "x.pdf", erro: "falhou" }], remetentes: ["dploredocontabilidade@gmail.com"], emails_achados: 3, email_mais_recente: "2026-11-04T16:38:26Z" }, error: null }); }
    if (op.body.acao === "anexo") return Promise.resolve({ data: { nome: "foto.jpg", imagem: { base64: "AAAA", tipo: "image/jpeg" } }, error: null });
    if (op.body.acao === "ler" && op.body.id === "erro-erro-erro") return Promise.resolve({ data: null, error: { message: "Edge Function returned a non-2xx status code", context: { json: () => Promise.resolve({ erro: "A Microsoft pediu para conectar o e-mail de novo." }) } } });
    return Promise.resolve({ data: { ok: op.body.acao }, error: null });
  } },
};
const handler = createMcpHandler(() => criarServidor(banco), { onerror: (e) => console.error(e) });
async function mcp(method: string, params: unknown) {
  const r = await handler.fetch(new Request("http://x/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }));
  const t = await r.text(); const l = t.split("\n").find((x) => x.startsWith("data: "));
  return JSON.parse(l ? l.slice(6) : t);
}
await mcp("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "teste", version: "1" } });
const lista = await mcp("tools/list", {});
const nomes = (lista.result.tools as Array<{ name: string }>).map((t) => t.name);
confere("conector: ferramentas de e-mail listadas", ["email_situacao", "email_buscar", "email_ler", "email_anexo", "email_enviar", "email_responder", "email_regra"].every((n) => nomes.includes(n)), nomes);
const chamarTool = (name: string, args: unknown) => mcp("tools/call", { name, arguments: args });
await chamarTool("email_buscar", { remetente: "dpk" });
confere("conector: email_buscar chama a função com padrão de 3 dias e só importantes", JSON.stringify(invocadas.at(-1)) === JSON.stringify(["email", { acao: "buscar", remetente: "dpk", dias: 3, pasta: "entrada", incluir: "importantes", limite: 20 }]), invocadas.at(-1));
await chamarTool("email_enviar", { para: ["a@b.com.br"], assunto: "x", texto: "y" });
confere("conector: email_enviar sem confirmar manda confirmar=false (prévia)", (invocadas.at(-1)![1] as Linha).confirmar === false);
await chamarTool("email_enviar", { para: ["a@b.com.br"], assunto: "x", texto: "y", anexos: [{ fonte: "os", numero: 1887 }, { fonte: "nf", os: 1887 }] });
confere("conector: email_enviar repassa os anexos pedidos", JSON.stringify((invocadas.at(-1)![1] as Linha).anexos) === JSON.stringify([{ fonte: "os", numero: 1887 }, { fonte: "nf", os: 1887 }]), invocadas.at(-1));
const semFonte = await chamarTool("email_enviar", { para: ["a@b.com.br"], assunto: "x", texto: "y", anexos: [{ fonte: "caminho" }] }) as Record<string, any>;
confere("conector: anexo com fonte desconhecida é recusado", !!semFonte?.isError || JSON.stringify(semFonte).includes("fonte"), semFonte);
const errado = await chamarTool("email_ler", { id: "erro-erro-erro" });
confere("conector: erro da função vira erro da ferramenta com a mensagem dela", errado.result.isError && /conectar o e-mail de novo/.test(errado.result.content[0].text), errado.result);
const img = await chamarTool("email_anexo", { id: "AAMkAD-dpk-0001", anexo_id: "ANX-img-000001" });
confere("conector: anexo de imagem volta como imagem", img.result.content.some((c: { type: string }) => c.type === "image"), img.result);
const semDados = await chamarTool("email_regra", { tipo: "importante" });
confere("conector: regra incompleta não chama a função", semDados.result.isError && invocadas.at(-1)![1].acao === "anexo");
await chamarTool("email_regra", { remover_id: 7 });
confere("conector: remover regra", invocadas.at(-1)![1].acao === "remover_regra" && invocadas.at(-1)![1].id === 7);

// Documentos do RH pelo conector (09/11/2026)
const rhl = await chamarTool("rh_documentos", { competencia: "2026-10" });
confere("conector: rh_documentos chama rh_listar com o mês", invocadas.at(-1)![1].acao === "rh_listar" && invocadas.at(-1)![1].competencia === "2026-10" && !rhl.result.isError, invocadas.at(-1));
const rhMesRuim = await chamarTool("rh_documentos", { competencia: "10/2026" });
confere("conector: rh_documentos recusa mês fora do formato", !!(rhMesRuim.error || rhMesRuim.result?.isError), rhMesRuim);
await chamarTool("rh_abrir", { id: "4f6c1f5e-8a2b-4c1d-9e3f-0a1b2c3d4e5f" });
confere("conector: rh_abrir chama a função com o id", invocadas.at(-1)![1].acao === "rh_abrir" && invocadas.at(-1)![1].id === "4f6c1f5e-8a2b-4c1d-9e3f-0a1b2c3d4e5f");
const antesRH = invocadas.length;
const rhb = await chamarTool("rh_buscar_contabilidade", {});
const rhbR = JSON.parse(rhb.result.content[0].text);
confere("conector: rh_buscar_contabilidade repete enquanto entra algo e para quando o lote não traz nada",
  invocadas.length - antesRH === 2 && invocadas.at(-1)![1].acao === "importar_rh" && invocadas.at(-1)![1].dias === 120 && !("remetentes" in invocadas.at(-1)![1])
  && rhbR.importados === 2 && rhbR.erros.length === 1 && rhbR.email_mais_recente === "2026-11-04T16:38:26Z", rhbR);

for (const o of ok) console.log("OK", o);
console.log("FALHAS", falhas);
if (falhas.length) Deno.exit(1);
