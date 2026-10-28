// DTCar Gestão — robô da SEFAZ (roda no GitHub Actions a cada 10 minutos)
// Os web services da SEFAZ pedem o certificado do cliente por renegociação TLS, que o servidor
// de funções do Supabase não suporta. Aqui o Node (OpenSSL) faz essa parte.
//
// A cada execução:
//   1. envia as manifestações pedidas na tela (confirmar, desconhecer, não realizada);
//   2. consulta a Distribuição DF-e quando liberado (de hora em hora, ou antes se pedido na tela,
//      sempre respeitando a espera de 1 hora exigida pela SEFAZ);
//   3. registra a ciência da operação das notas novas para liberar o XML completo.
// Nada de certificado, senha ou chave é impresso no registro.
import https from "node:https";
import tls from "node:tls";
import http from "node:http";
import zlib from "node:zlib";
import forge from "node-forge";
import { createClient } from "@supabase/supabase-js";

const URL_DIST = "https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx";
const URL_EVENTO = "https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx";
const ACAO_DIST = "http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse";
const ACAO_EVENTO = "http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento";
const RAIZES_ICP = ["v5", "v10", "v11", "v12"].map(v => `http://acraiz.icpbrasil.gov.br/credenciadas/RAIZ/ICP-Brasil${v}.crt`);
const ESPERA_MIN = 62;
export const EVENTOS = {
  ciencia: ["210210", "Ciencia da Operacao"],
  confirmada: ["210200", "Confirmacao da Operacao"],
  desconhecida: ["210220", "Desconhecimento da Operacao"],
  nao_realizada: ["210240", "Operacao nao Realizada"],
};

/* ---------------- utilidades ---------------- */
export const tag = (xml, nome) => { const m = new RegExp(`<(?:\\w+:)?${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${nome}>`).exec(xml); return m ? m[1].trim() : ""; };
const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const desesc = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const agoraBR = () => new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 19) + "-03:00";
const minutos = n => new Date(Date.now() + n * 60000).toISOString();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/* ---------------- certificado ---------------- */
export function abrirPfx(buf, senha) {
  let p12;
  try { p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.createBuffer(buf.toString("binary"))), false, senha); }
  catch { throw new Error("Não foi possível abrir o certificado: confira a senha."); }
  const keys = [...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || []), ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || [])];
  const certs = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
  const chave = keys.map(k => k.key).find(Boolean);
  if (!chave) throw new Error("O arquivo não contém a chave privada do certificado.");
  const cert = certs.map(c => c.cert).find(c => c && c.publicKey.n.equals(chave.n));
  if (!cert) throw new Error("O arquivo não contém o certificado correspondente à chave.");
  const cn = String(cert.subject.getField("CN")?.value || "");
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  return { keyPem: forge.pki.privateKeyToPem(chave), certPem: forge.pki.certificateToPem(cert), certB64: forge.util.encode64(der), chave,
    cnpj: (/:(\d{14})\b/.exec(cn) || /(\d{14})/.exec(cn) || [])[1] || "", titular: cn.replace(/:\d+$/, ""), validade: cert.validity.notAfter };
}

/* ---------------- HTTPS com certificado do cliente (aceita renegociação) ---------------- */
let CA = null;
function baixar(u) { return new Promise(ok => { http.get(u, r => { const b = []; r.on("data", c => b.push(c)); r.on("end", () => ok(r.statusCode === 200 ? Buffer.concat(b) : null)); }).on("error", () => ok(null)); }); }
async function raizes() {
  if (CA) return CA;
  const extra = [];
  for (const u of RAIZES_ICP) { const b = await baixar(u); if (b) extra.push(b[0] === 0x2d ? b.toString() : "-----BEGIN CERTIFICATE-----\n" + b.toString("base64").replace(/.{64}/g, "$&\n") + "\n-----END CERTIFICATE-----\n"); }
  CA = [...tls.rootCertificates, ...extra]; return CA;
}
function postar(url, acao, corpo, c, ca) {
  return new Promise((ok, erro) => {
    const u = new URL(url);
    const req = https.request({ hostname: u.hostname, path: u.pathname, method: "POST", key: c.keyPem, cert: c.certPem, minVersion: "TLSv1.2", maxVersion: "TLSv1.2", ...(ca ? { ca } : {}),
      headers: { "Content-Type": `application/soap+xml; charset=utf-8; action="${acao}"`, "Content-Length": Buffer.byteLength(corpo) }, timeout: 90000 }, res => {
      let d = ""; res.setEncoding("utf8"); res.on("data", x => d += x); res.on("end", () => ok({ status: res.statusCode, corpo: d }));
    });
    req.on("timeout", () => req.destroy(new Error("A SEFAZ não respondeu em 90 segundos.")));
    req.on("error", erro); req.end(corpo);
  });
}
async function soap(url, acao, corpo, c) {
  const env = `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body>${corpo}</soap12:Body></soap12:Envelope>`;
  let r;
  try { r = await postar(url, acao, env, c); }
  catch (e) { if (/certificate|issuer|self.signed|UNABLE_TO/i.test(String(e.code || "") + e.message)) r = await postar(url, acao, env, c, await raizes()); else throw e; }
  if (r.status >= 400 && !/<(\w+:)?cStat>/.test(r.corpo)) throw new Error(`SEFAZ respondeu ${r.status}: ${tag(r.corpo, "Text") || tag(r.corpo, "faultstring") || r.corpo.slice(0, 200)}`);
  return r.corpo;
}

/* ---------------- assinatura do evento ---------------- */
function assinar(infCanonico, id, c) {
  const md = forge.md.sha1.create(); md.update(infCanonico, "utf8");
  const si = `<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></CanonicalizationMethod><SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"></SignatureMethod><Reference URI="#${id}"><Transforms><Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></Transform><Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></Transform></Transforms><DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></DigestMethod><DigestValue>${forge.util.encode64(md.digest().getBytes())}</DigestValue></Reference></SignedInfo>`;
  const md2 = forge.md.sha1.create(); md2.update(si, "utf8");
  return `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">${si}<SignatureValue>${forge.util.encode64(c.chave.sign(md2))}</SignatureValue><KeyInfo><X509Data><X509Certificate>${c.certB64}</X509Certificate></X509Data></KeyInfo></Signature>`;
}
export function montarEvento(c, cnpj, chave, tipo, just = "", dh = agoraBR()) {
  const [tp, desc] = EVENTOS[tipo], id = `ID${tp}${chave}01`;
  const corpo = `<cOrgao>91</cOrgao><tpAmb>1</tpAmb><CNPJ>${cnpj}</CNPJ><chNFe>${chave}</chNFe><dhEvento>${dh}</dhEvento><tpEvento>${tp}</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento><detEvento versao="1.00"><descEvento>${desc}</descEvento>${tipo === "nao_realizada" ? `<xJust>${esc(just)}</xJust>` : ""}</detEvento>`;
  return `<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><infEvento Id="${id}">${corpo}</infEvento>${assinar(`<infEvento xmlns="http://www.portalfiscal.inf.br/nfe" Id="${id}">${corpo}</infEvento>`, id, c)}</evento>`;
}
async function enviarEventos(c, cnpj, chaves, tipo, just = "") {
  const out = {};
  for (let i = 0; i < chaves.length; i += 20) {
    const lote = chaves.slice(i, i + 20);
    const env = `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4"><envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><idLote>${Date.now().toString().slice(-15)}</idLote>${lote.map(k => montarEvento(c, cnpj, k, tipo, just)).join("")}</envEvento></nfeDadosMsg>`;
    const r = await soap(URL_EVENTO, ACAO_EVENTO, env, c);
    const rets = r.match(/<(?:\w+:)?retEvento[\s\S]*?<\/(?:\w+:)?retEvento>/g) || [];
    for (const k of lote) { const ret = rets.find(x => x.includes(k)); const st = ret ? tag(ret, "cStat") : tag(r, "cStat");
      out[k] = { ok: ["135", "136", "573"].includes(st), cStat: st, motivo: ret ? tag(ret, "xMotivo") : tag(r, "xMotivo") }; }
  }
  return out;
}

/* ---------------- principal ---------------- */
async function principal() {
  const url = process.env.SUPABASE_URL, chave = process.env.SUPABASE_SECRET_KEY;
  if (!url || !chave) throw new Error("Falta o segredo SUPABASE_SECRET_KEY nas configurações do GitHub.");
  const db = createClient(url, chave, { auth: { persistSession: false } });
  const ok = r => { if (r.error) throw new Error(r.error.message); return r.data; };
  const cfg = ok(await db.from("sefaz_config").select("*").eq("id", 1).single());
  const pedidas = ok(await db.from("nfe_recebidas").select("chave,manifestacao_pedida,justificativa_pedida").neq("manifestacao_pedida", ""));
  const agora = Date.now();
  const liberado = !cfg.proxima_consulta || new Date(cfg.proxima_consulta).getTime() <= agora;
  const pedido = cfg.pedido_em && (!cfg.ultima_consulta || new Date(cfg.pedido_em) > new Date(cfg.ultima_consulta));
  const vez = !cfg.ultima_consulta || agora - new Date(cfg.ultima_consulta).getTime() >= 60 * 60000;
  const consultar = liberado && ((cfg.ativo && vez) || pedido);
  await db.from("sefaz_config").update({ worker_em: new Date().toISOString() }).eq("id", 1);
  if (!consultar && !pedidas.length) { log("nada a fazer", liberado ? "" : "(aguardando " + cfg.proxima_consulta + ")"); return; }

  const { data: arq, error } = await db.storage.from("privado").download("certificado.pfx");
  if (error || !arq) throw new Error("Nenhum certificado enviado.");
  const senha = (ok(await db.from("segredos").select("valor").eq("chave", "certificado_senha").maybeSingle()) || {}).valor || "";
  const c = abrirPfx(Buffer.from(await arq.arrayBuffer()), senha);
  if (c.validade < new Date()) throw new Error("O certificado venceu em " + c.validade.toLocaleDateString("pt-BR") + ".");
  const cnpj = cfg.cnpj || c.cnpj;

  // 1. manifestações pedidas na tela
  for (const p of pedidas) {
    try {
      const r = (await enviarEventos(c, cnpj, [p.chave], p.manifestacao_pedida, p.justificativa_pedida))[p.chave];
      await db.from("nfe_recebidas").update(r.ok ? { manifestacao: p.manifestacao_pedida, manifestada_em: new Date().toISOString(), manifestacao_erro: "", manifestacao_pedida: "", justificativa_pedida: "" }
        : { manifestacao_erro: r.cStat + " " + r.motivo, manifestacao_pedida: "" }).eq("chave", p.chave);
      log("manifestação", p.manifestacao_pedida, r.ok ? "registrada" : "recusada " + r.cStat);
    } catch (e) { await db.from("nfe_recebidas").update({ manifestacao_erro: e.message, manifestacao_pedida: "" }).eq("chave", p.chave); log("manifestação falhou:", e.message); }
  }
  if (!consultar) return;

  // 2. distribuição DF-e
  let ult = cfg.ult_nsu || "000000000000000", max = cfg.max_nsu, st = "", mot = "", voltas = 0, proxima = null, erro = "", transporte = false;
  const cont = { resumo: 0, xml: 0, evento: 0, outro: 0 };
  const salvarDoc = async (schema, nsu, xml) => {
    if (schema.startsWith("resNFe")) {
      const ch = tag(xml, "chNFe"), sit = { "1": "autorizada", "2": "denegada", "3": "cancelada" }[tag(xml, "cSitNFe")] || "autorizada";
      const ja = ok(await db.from("nfe_recebidas").select("id").eq("chave", ch).maybeSingle());
      if (ja) ok(await db.from("nfe_recebidas").update({ situacao: sit }).eq("id", ja.id));
      else ok(await db.from("nfe_recebidas").insert({ chave: ch, nsu, cnpj_emitente: tag(xml, "CNPJ") || tag(xml, "CPF"), nome_emitente: desesc(tag(xml, "xNome")), ie_emitente: tag(xml, "IE"),
        emissao: tag(xml, "dhEmi") || null, valor: Number(tag(xml, "vNF")) || 0, tipo_nf: Number(tag(xml, "tpNF")), situacao: sit, numero: String(Number(ch.slice(25, 34))), serie: String(Number(ch.slice(22, 25))) }));
      return "resumo";
    }
    if (schema.startsWith("procNFe")) {
      const inf = /<(?:\w+:)?infNFe[^>]*Id="NFe(\d{44})"/.exec(xml), ch = inf ? inf[1] : tag(xml, "chNFe");
      const ide = tag(xml, "ide"), emit = tag(xml, "emit"), tot = tag(xml, "ICMSTot");
      const linha = { chave: ch, nsu, xml, cnpj_emitente: tag(emit, "CNPJ") || tag(emit, "CPF"), nome_emitente: desesc(tag(emit, "xNome")), ie_emitente: tag(emit, "IE"), numero: tag(ide, "nNF"),
        serie: tag(ide, "serie"), emissao: tag(ide, "dhEmi") || null, valor: Number(tag(tot, "vNF")) || 0, tipo_nf: Number(tag(ide, "tpNF")) };
      const ja = ok(await db.from("nfe_recebidas").select("id").eq("chave", ch).maybeSingle());
      ok(ja ? await db.from("nfe_recebidas").update(linha).eq("id", ja.id) : await db.from("nfe_recebidas").insert(linha));
      return "xml";
    }
    if (schema.startsWith("resEvento") || schema.startsWith("procEventoNFe")) {
      if (tag(xml, "tpEvento") === "110111") ok(await db.from("nfe_recebidas").update({ situacao: "cancelada" }).eq("chave", tag(xml, "chNFe")));
      return "evento";
    }
    return "outro";
  };
  try {
    while (voltas++ < 15) {
      const corpo = `<nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDadosMsg><distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><tpAmb>1</tpAmb><cUFAutor>${cfg.uf_autor}</cUFAutor><CNPJ>${cnpj}</CNPJ><distNSU><ultNSU>${ult}</ultNSU></distNSU></distDFeInt></nfeDadosMsg></nfeDistDFeInteresse>`;
      const r = await soap(URL_DIST, ACAO_DIST, corpo, c);
      st = tag(r, "cStat"); mot = tag(r, "xMotivo"); log("distribuição", st, mot, tag(r, "ultNSU"), "/", tag(r, "maxNSU"));
      if (st === "138") {
        for (const m of r.matchAll(/<(?:\w+:)?docZip NSU="(\d+)" schema="([^"]+)">([^<]+)</g)) cont[await salvarDoc(m[2], m[1], zlib.gunzipSync(Buffer.from(m[3], "base64")).toString("utf8"))]++;
        ult = tag(r, "ultNSU") || ult; max = tag(r, "maxNSU") || max;
        await db.from("sefaz_config").update({ ult_nsu: ult, max_nsu: max }).eq("id", 1);
        if (ult >= max) { proxima = minutos(ESPERA_MIN); break; }
        continue;
      }
      if (st === "137") { ult = tag(r, "ultNSU") || ult; max = tag(r, "maxNSU") || max; proxima = minutos(ESPERA_MIN); break; }
      if (st === "656") { erro = "SEFAZ bloqueou por consumo indevido: " + mot; proxima = minutos(ESPERA_MIN); break; }
      erro = `SEFAZ: ${st} ${mot}`; proxima = minutos(ESPERA_MIN); break;
    }
  } catch (e) { erro = e.message; transporte = !st; proxima = minutos(10); log("falha na consulta:", e.message); }

  // 3. ciência automática
  let ciencias = 0;
  if (!erro && cfg.ciencia_automatica) {
    const pend = ok(await db.from("nfe_recebidas").select("chave").is("xml", null).eq("manifestacao", "").eq("situacao", "autorizada").order("emissao", { ascending: false }).limit(60));
    if (pend.length) {
      try {
        const res = await enviarEventos(c, cnpj, pend.map(p => p.chave), "ciencia");
        for (const [k, v] of Object.entries(res)) { await db.from("nfe_recebidas").update(v.ok ? { manifestacao: "ciencia", manifestada_em: new Date().toISOString(), manifestacao_erro: "" } : { manifestacao_erro: v.cStat + " " + v.motivo }).eq("chave", k); if (v.ok) ciencias++; }
      } catch (e) { erro = "Notas consultadas, mas a ciência falhou: " + e.message; }
    }
  }
  // falha de conexão (a SEFAZ nem respondeu) não conta como consulta: tenta de novo em 10 minutos
  ok(await db.from("sefaz_config").update({ ult_nsu: ult, max_nsu: max, ...(transporte ? {} : { ultima_consulta: new Date().toISOString() }), proxima_consulta: proxima, ultimo_status: st ? `${st} ${mot}` : "",
    ultimo_erro: erro, cnpj, titular: c.titular, validade: c.validade.toISOString(), worker_erro: "", atualizado_em: new Date().toISOString() }).eq("id", 1));
  log(`resumos ${cont.resumo}, XML ${cont.xml}, eventos ${cont.evento}, ciências ${ciencias}${erro ? ", erro: " + erro : ""}`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  principal().catch(async e => {
    console.error("Erro:", e.message);
    try { const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
      await db.from("sefaz_config").update({ worker_em: new Date().toISOString(), worker_erro: e.message }).eq("id", 1); } catch { /* sem acesso ao banco */ }
    process.exit(1);
  });
}
