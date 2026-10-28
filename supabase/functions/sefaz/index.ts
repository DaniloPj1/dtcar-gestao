// DTCar Gestão — função "sefaz"
// Busca na SEFAZ (Ambiente Nacional, Distribuição DF-e) as NF-e emitidas para o CNPJ da oficina,
// usando o certificado digital A1. Registra a Ciência da Operação para liberar o XML completo
// e permite as demais manifestações do destinatário.
//
// Ações (POST JSON { acao }):
//   certificado  { pfx: base64, senha }        administrador — guarda e valida o certificado
//   consultar    {}                            administrador ou agendamento — busca notas novas
//   manifestar   { chave, tipo, justificativa } administrador — confirmar / desconhecer / não realizada
//   diagnostico  {}                            administrador — confere certificado e conexão segura
import forge from "npm:node-forge@1.3.1";
import { createClient } from "npm:@supabase/supabase-js@2";

const URL_DIST = "https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx";
const URL_EVENTO = "https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx";
const ACAO_DIST = "http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse";
const ACAO_EVENTO = "http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento";
const RAIZES_ICP = ["v5", "v10", "v11", "v12"].map(v => `http://acraiz.icpbrasil.gov.br/credenciadas/RAIZ/ICP-Brasil${v}.crt`);
const ESPERA_MIN = 62; // a SEFAZ exige 1 hora sem consultar quando não há documento novo
const EVENTOS: Record<string, [string, string]> = {
  ciencia: ["210210", "Ciencia da Operacao"],
  confirmada: ["210200", "Confirmacao da Operacao"],
  desconhecida: ["210220", "Desconhecimento da Operacao"],
  nao_realizada: ["210240", "Operacao nao Realizada"],
};

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const resposta = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });
function chaveServidor(): string {
  const legado = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); if (legado) return legado;
  try { const k = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"); return k.default || Object.values(k)[0] as string || ""; } catch (_e) { return ""; }
}
const db = createClient(Deno.env.get("SUPABASE_URL")!, chaveServidor(), { auth: { persistSession: false } });

/* ---------------- utilidades ---------------- */
export const tag = (xml: string, nome: string) => { const m = new RegExp(`<(?:\\w+:)?${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${nome}>`).exec(xml); return m ? m[1].trim() : ""; };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const desesc = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const agoraBR = () => { const d = new Date(Date.now() - 3 * 3600000); return d.toISOString().slice(0, 19) + "-03:00"; };
const minutos = (n: number) => new Date(Date.now() + n * 60000).toISOString();
const b64ParaBytes = (b: string) => Uint8Array.from(atob(b.replace(/\s/g, "")), c => c.charCodeAt(0));
export async function gunzipB64(b: string): Promise<string> {
  const s = new Blob([b64ParaBytes(b)]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(s).text();
}
const derParaPem = (der: Uint8Array) => { let bin = ""; der.forEach(c => bin += String.fromCharCode(c)); return "-----BEGIN CERTIFICATE-----\n" + btoa(bin).replace(/.{64}/g, "$&\n") + "\n-----END CERTIFICATE-----\n"; };

/* ---------------- certificado ---------------- */
type Cert = { keyPem: string; certPem: string; certB64: string; chave: forge.pki.rsa.PrivateKey; cnpj: string; titular: string; validade: Date; inicio: Date };
export function abrirPfx(pfx: Uint8Array, senha: string): Cert {
  let bin = ""; pfx.forEach(c => bin += String.fromCharCode(c));
  let p12;
  try { p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(bin), false, senha); }
  catch (_e) { throw new Error("Não foi possível abrir o certificado: confira a senha. O arquivo precisa ser o .pfx (ou .p12) do certificado A1."); }
  const keys = [...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || []), ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || [])];
  const certs = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
  const chave = keys.map(k => k.key).find(Boolean) as forge.pki.rsa.PrivateKey | undefined;
  if (!chave) throw new Error("O arquivo não contém a chave privada do certificado.");
  const cert = certs.map(c => c.cert).find(c => c && (c.publicKey as forge.pki.rsa.PublicKey).n.equals(chave.n));
  if (!cert) throw new Error("O arquivo não contém o certificado correspondente à chave.");
  const cn = String(cert.subject.getField("CN")?.value || "");
  const cnpj = (/:(\d{14})\b/.exec(cn) || /(\d{14})/.exec(cn) || [])[1] || "";
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  return { keyPem: forge.pki.privateKeyToPem(chave), certPem: forge.pki.certificateToPem(cert), certB64: forge.util.encode64(der), chave, cnpj,
    titular: cn.replace(/:\d+$/, ""), validade: cert.validity.notAfter, inicio: cert.validity.notBefore };
}
async function carregarCert(): Promise<Cert> {
  const { data: arq, error } = await db.storage.from("privado").download("certificado.pfx");
  if (error || !arq) throw new Error("Nenhum certificado enviado. Envie o arquivo .pfx na tela Notas da SEFAZ.");
  const { data: s } = await db.from("segredos").select("valor").eq("chave", "certificado_senha").maybeSingle();
  return abrirPfx(new Uint8Array(await arq.arrayBuffer()), s ? s.valor : "");
}

/* ---------------- conexão com a SEFAZ (TLS com o certificado do cliente) ---------------- */
let raizes: string[] | null = null;
async function raizesICP(): Promise<string[]> {
  if (raizes) return raizes;
  const out: string[] = [];
  for (const u of RAIZES_ICP) { try { const r = await fetch(u); if (r.ok) { const b = new Uint8Array(await r.arrayBuffer()); out.push(b[0] === 0x2d ? new TextDecoder().decode(b) : derParaPem(b)); } } catch (_e) { /* segue */ } }
  raizes = out; return out;
}
export function cliente(c: Cert, ca?: string[]) {
  // deno-lint-ignore no-explicit-any
  const D = Deno as any;
  if (typeof D.createHttpClient !== "function") throw new Error("O servidor não oferece conexão com certificado de cliente (Deno.createHttpClient).");
  // os web services da SEFAZ só aceitam HTTP/1.1
  const base = { http1: true, http2: false, ...(ca ? { caCerts: ca } : {}) };
  try { return D.createHttpClient({ ...base, cert: c.certPem, key: c.keyPem }); }
  catch (_e) { return D.createHttpClient({ ...base, certChain: c.certPem, privateKey: c.keyPem }); }
}
async function soap(url: string, acao: string, corpo: string, c: Cert): Promise<string> {
  const env = `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body>${corpo}</soap12:Body></soap12:Envelope>`;
  const enviar = async (ca?: string[]) => {
    const client = cliente(c, ca);
    try {
      const r = await fetch(url, { method: "POST", client, body: env, headers: { "Content-Type": `application/soap+xml; charset=utf-8; action="${acao}"` } } as RequestInit);
      const t = await r.text();
      if (!r.ok && !/<(\w+:)?cStat>/.test(t)) throw new Error(`SEFAZ respondeu ${r.status}: ${tag(t, "Text") || tag(t, "faultstring") || t.slice(0, 200)}`);
      return t;
    } finally { try { client.close(); } catch (_e) { /* ok */ } }
  };
  try { return await enviar(); }
  catch (e) {
    const m = String((e as Error).message || e);
    if (/certificate|UnknownIssuer|invalid peer|self.signed|issuer/i.test(m)) return await enviar(await raizesICP());
    throw e;
  }
}

/* ---------------- assinatura XML (evento de manifestação) ---------------- */
function assinar(infCanonico: string, id: string, c: Cert): string {
  const md = forge.md.sha1.create(); md.update(infCanonico, "utf8");
  const digest = forge.util.encode64(md.digest().getBytes());
  const si = `<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></CanonicalizationMethod><SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"></SignatureMethod><Reference URI="#${id}"><Transforms><Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></Transform><Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></Transform></Transforms><DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></DigestMethod><DigestValue>${digest}</DigestValue></Reference></SignedInfo>`;
  const md2 = forge.md.sha1.create(); md2.update(si, "utf8");
  const valor = forge.util.encode64(c.chave.sign(md2));
  return `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">${si}<SignatureValue>${valor}</SignatureValue><KeyInfo><X509Data><X509Certificate>${c.certB64}</X509Certificate></X509Data></KeyInfo></Signature>`;
}
/** Monta e assina um evento. Retorna o XML <evento> pronto para o lote. */
export function montarEvento(c: Cert, cnpj: string, chave: string, tipo: string, just = "", dh = agoraBR()): string {
  const [tp, desc] = EVENTOS[tipo];
  const id = `ID${tp}${chave}01`;
  const det = `<detEvento versao="1.00"><descEvento>${desc}</descEvento>${tipo === "nao_realizada" ? `<xJust>${esc(just)}</xJust>` : ""}</detEvento>`;
  const corpo = `<cOrgao>91</cOrgao><tpAmb>1</tpAmb><CNPJ>${cnpj}</CNPJ><chNFe>${chave}</chNFe><dhEvento>${dh}</dhEvento><tpEvento>${tp}</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento>${det}`;
  // forma canônica (C14N) do infEvento: herda o namespace padrão da NF-e
  const canon = `<infEvento xmlns="http://www.portalfiscal.inf.br/nfe" Id="${id}">${corpo}</infEvento>`;
  return `<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><infEvento Id="${id}">${corpo}</infEvento>${assinar(canon, id, c)}</evento>`;
}
async function enviarEventos(c: Cert, cnpj: string, chaves: string[], tipo: string, just = ""): Promise<Record<string, { ok: boolean; cStat: string; motivo: string }>> {
  const out: Record<string, { ok: boolean; cStat: string; motivo: string }> = {};
  for (let i = 0; i < chaves.length; i += 20) {
    const lote = chaves.slice(i, i + 20);
    const env = `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4"><envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><idLote>${Date.now().toString().slice(-15)}</idLote>${lote.map(k => montarEvento(c, cnpj, k, tipo, just)).join("")}</envEvento></nfeDadosMsg>`;
    const r = await soap(URL_EVENTO, ACAO_EVENTO, env, c);
    const stLote = tag(r, "cStat");
    const rets = r.match(/<(?:\w+:)?retEvento[\s\S]*?<\/(?:\w+:)?retEvento>/g) || [];
    for (const k of lote) {
      const ret = rets.find(x => x.includes(k));
      const st = ret ? tag(ret, "cStat") : stLote, mot = ret ? tag(ret, "xMotivo") : tag(r, "xMotivo");
      out[k] = { ok: st === "135" || st === "136" || st === "573", cStat: st, motivo: mot };
    }
  }
  return out;
}

/* ---------------- distribuição ---------------- */
async function processarDoc(schema: string, nsu: string, xml: string) {
  if (schema.startsWith("resNFe")) {
    const sit = { "1": "autorizada", "2": "denegada", "3": "cancelada" }[tag(xml, "cSitNFe")] || "autorizada";
    const chave = tag(xml, "chNFe");
    const { data: ja } = await db.from("nfe_recebidas").select("id,xml").eq("chave", chave).maybeSingle();
    const linha = { chave, nsu, cnpj_emitente: tag(xml, "CNPJ") || tag(xml, "CPF"), nome_emitente: desesc(tag(xml, "xNome")), ie_emitente: tag(xml, "IE"),
      emissao: tag(xml, "dhEmi") || null, valor: Number(tag(xml, "vNF")) || 0, tipo_nf: Number(tag(xml, "tpNF")), situacao: sit, numero: String(Number(chave.slice(25, 34))), serie: String(Number(chave.slice(22, 25))) };
    if (ja) await db.from("nfe_recebidas").update({ situacao: sit, valor: linha.valor }).eq("id", ja.id);
    else await db.from("nfe_recebidas").insert(linha);
    return "resumo";
  }
  if (schema.startsWith("procNFe")) {
    const inf = /<(?:\w+:)?infNFe[^>]*Id="NFe(\d{44})"/.exec(xml); const chave = inf ? inf[1] : tag(xml, "chNFe");
    const ide = tag(xml, "ide"), emit = tag(xml, "emit"), tot = tag(xml, "ICMSTot");
    const linha = { chave, nsu, xml, cnpj_emitente: tag(emit, "CNPJ") || tag(emit, "CPF"), nome_emitente: desesc(tag(emit, "xNome")), ie_emitente: tag(emit, "IE"), numero: tag(ide, "nNF"),
      serie: tag(ide, "serie"), emissao: tag(ide, "dhEmi") || null, valor: Number(tag(tot, "vNF")) || 0, tipo_nf: Number(tag(ide, "tpNF")) };
    const { data: ja } = await db.from("nfe_recebidas").select("id").eq("chave", chave).maybeSingle();
    if (ja) await db.from("nfe_recebidas").update(linha).eq("id", ja.id); else await db.from("nfe_recebidas").insert(linha);
    return "xml";
  }
  if (schema.startsWith("resEvento") || schema.startsWith("procEventoNFe")) {
    const chave = tag(xml, "chNFe"), tp = tag(xml, "tpEvento");
    if (tp === "110111") await db.from("nfe_recebidas").update({ situacao: "cancelada" }).eq("chave", chave);
    return "evento";
  }
  return "outro";
}
async function consultar(origem: string) {
  const { data: cfg } = await db.from("sefaz_config").select("*").eq("id", 1).single();
  if (!cfg) throw new Error("Configuração da SEFAZ não encontrada. Rode o v6.sql.");
  if (cfg.proxima_consulta && new Date(cfg.proxima_consulta) > new Date()) {
    const min = Math.ceil((new Date(cfg.proxima_consulta).getTime() - Date.now()) / 60000);
    return { aguardar: min, mensagem: `A SEFAZ só permite nova consulta daqui a ${min} minuto(s).` };
  }
  const c = await carregarCert();
  if (c.validade < new Date()) throw new Error("O certificado venceu em " + c.validade.toLocaleDateString("pt-BR") + ". Envie o certificado renovado.");
  const cnpj = cfg.cnpj || c.cnpj;
  let ult = cfg.ult_nsu || "000000000000000", max = cfg.max_nsu, st = "", mot = "", voltas = 0;
  const cont: Record<string, number> = { resumo: 0, xml: 0, evento: 0, outro: 0 };
  let proxima: string | null = null, erro = "";
  try {
    while (voltas++ < 12) {
      const corpo = `<nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDadosMsg><distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><tpAmb>1</tpAmb><cUFAutor>${cfg.uf_autor}</cUFAutor><CNPJ>${cnpj}</CNPJ><distNSU><ultNSU>${ult}</ultNSU></distNSU></distDFeInt></nfeDadosMsg></nfeDistDFeInteresse>`;
      const r = await soap(URL_DIST, ACAO_DIST, corpo, c);
      st = tag(r, "cStat"); mot = tag(r, "xMotivo");
      if (st === "138") {
        for (const m of r.matchAll(/<(?:\w+:)?docZip NSU="(\d+)" schema="([^"]+)">([^<]+)</g)) cont[await processarDoc(m[2], m[1], await gunzipB64(m[3]))]++;
        ult = tag(r, "ultNSU") || ult; max = tag(r, "maxNSU") || max;
        await db.from("sefaz_config").update({ ult_nsu: ult, max_nsu: max }).eq("id", 1);
        if (ult >= max) { proxima = minutos(ESPERA_MIN); break; }
        continue;
      }
      if (st === "137") { ult = tag(r, "ultNSU") || ult; max = tag(r, "maxNSU") || max; proxima = minutos(ESPERA_MIN); break; }
      if (st === "656") { proxima = minutos(ESPERA_MIN); erro = "SEFAZ bloqueou por consumo indevido: " + mot; break; }
      erro = `SEFAZ: ${st} ${mot}`; proxima = minutos(ESPERA_MIN); break;
    }
  } catch (e) { erro = String((e as Error).message || e); proxima = minutos(2); }
  // ciência automática: libera o XML completo na próxima consulta
  let ciencias = 0;
  if (!erro && cfg.ciencia_automatica) {
    const { data: pend } = await db.from("nfe_recebidas").select("chave").is("xml", null).eq("manifestacao", "").eq("situacao", "autorizada").order("emissao", { ascending: false }).limit(60);
    if (pend && pend.length) {
      try {
        const res = await enviarEventos(c, cnpj, pend.map(p => p.chave), "ciencia");
        for (const [k, v] of Object.entries(res)) {
          await db.from("nfe_recebidas").update(v.ok ? { manifestacao: "ciencia", manifestada_em: new Date().toISOString(), manifestacao_erro: "" } : { manifestacao_erro: v.cStat + " " + v.motivo }).eq("chave", k);
          if (v.ok) ciencias++;
        }
      } catch (e) { erro = "Notas consultadas, mas a ciência falhou: " + String((e as Error).message || e); }
    }
  }
  await db.from("sefaz_config").update({ ult_nsu: ult, max_nsu: max, ultima_consulta: new Date().toISOString(), proxima_consulta: proxima, ultimo_status: st ? `${st} ${mot}` : "", ultimo_erro: erro,
    cnpj, titular: c.titular, validade: c.validade.toISOString(), atualizado_em: new Date().toISOString() }).eq("id", 1);
  return { origem, cStat: st, motivo: mot, novos: cont.resumo, xmls: cont.xml, eventos: cont.evento, ciencias, erro, proxima };
}

/* ---------------- acesso ---------------- */
async function eAdmin(req: Request) {
  const t = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!t) return false;
  const { data } = await db.auth.getUser(t);
  if (!data || !data.user) return false;
  const { data: p } = await db.from("perfis").select("papel,ativo").eq("id", data.user.id).maybeSingle();
  return !!p && p.papel === "admin" && p.ativo !== false;
}
async function eAgendamento(req: Request) {
  const h = req.headers.get("x-dtcar-cron"); if (!h) return false;
  const { data } = await db.from("segredos").select("valor").eq("chave", "cron").maybeSingle();
  return !!data && data.valor === h;
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let corpo: Record<string, string> = {};
  try { corpo = await req.json(); } catch (_e) { /* vazio */ }
  const acao = corpo.acao || "";
  try {
    if (acao === "consultar" && await eAgendamento(req)) return resposta(await consultar("agendamento"));
    if (!await eAdmin(req)) return resposta({ erro: "Apenas o administrador pode usar esta função." }, 403);
    if (acao === "certificado") {
      const pfx = b64ParaBytes(corpo.pfx || "");
      const c = abrirPfx(pfx, corpo.senha || "");
      if (c.validade < new Date()) return resposta({ erro: "Este certificado venceu em " + c.validade.toLocaleDateString("pt-BR") + "." }, 400);
      if (!c.cnpj) return resposta({ erro: "Não encontrei o CNPJ no certificado. Ele precisa ser um e-CNPJ A1." }, 400);
      await db.storage.createBucket("privado", { public: false }).catch(() => {});
      const up = await db.storage.from("privado").upload("certificado.pfx", pfx, { upsert: true, contentType: "application/x-pkcs12" });
      if (up.error) throw new Error("Falha ao guardar o certificado: " + up.error.message);
      await db.from("segredos").upsert({ chave: "certificado_senha", valor: corpo.senha || "", atualizado_em: new Date().toISOString() });
      await db.from("sefaz_config").update({ cnpj: c.cnpj, titular: c.titular, validade: c.validade.toISOString(), ativo: true, ultimo_erro: "", atualizado_em: new Date().toISOString() }).eq("id", 1);
      return resposta({ ok: true, cnpj: c.cnpj, titular: c.titular, validade: c.validade.toISOString() });
    }
    if (acao === "consultar") return resposta(await consultar("manual"));
    if (acao === "manifestar") {
      const tipo = corpo.tipo, chave = corpo.chave || "";
      if (!EVENTOS[tipo] || !/^\d{44}$/.test(chave)) return resposta({ erro: "Manifestação inválida." }, 400);
      if (tipo === "nao_realizada" && !((corpo.justificativa || "").trim().length >= 15)) return resposta({ erro: "Escreva uma justificativa com pelo menos 15 caracteres." }, 400);
      const c = await carregarCert(); const { data: cfg } = await db.from("sefaz_config").select("cnpj").eq("id", 1).single();
      const r = (await enviarEventos(c, (cfg && cfg.cnpj) || c.cnpj, [chave], tipo, (corpo.justificativa || "").trim().slice(0, 255)))[chave];
      if (r.ok) await db.from("nfe_recebidas").update({ manifestacao: tipo, manifestada_em: new Date().toISOString(), manifestacao_erro: "" }).eq("chave", chave);
      else await db.from("nfe_recebidas").update({ manifestacao_erro: r.cStat + " " + r.motivo }).eq("chave", chave);
      return resposta(r.ok ? { ok: true, cStat: r.cStat, motivo: r.motivo } : { erro: `SEFAZ: ${r.cStat} ${r.motivo}` }, r.ok ? 200 : 400);
    }
    if (acao === "diagnostico") {
      const out: Record<string, unknown> = { createHttpClient: typeof (Deno as unknown as Record<string, unknown>).createHttpClient === "function" };
      try { const c = await carregarCert(); out.certificado = { cnpj: c.cnpj, titular: c.titular, validade: c.validade }; try { cliente(c).close(); out.cliente_tls = true; } catch (e) { out.cliente_tls = String((e as Error).message); } }
      catch (e) { out.certificado = String((e as Error).message); }
      return resposta(out);
    }
    return resposta({ erro: "Ação desconhecida." }, 400);
  } catch (e) { return resposta({ erro: String((e as Error).message || e) }, 500); }
});
