// Teste do anexar_os da função "email" (v50): NF ou foto que chegou por e-mail ou WhatsApp vai para a O.S.
// Rodar: deno run -A teste/teste_anexar_os.ts
// Banco, pastas e Microsoft falsos. Confere: prévia sem gravar; foto do WhatsApp na pasta "fotos" + fotos (execução) com a medida;
// aviso quando o número não é do cliente; WEBP, arquivo grande, XML que não é nota e PDF como foto recusados; NF do e-mail
// (XML com o número lido) na pasta "notas" + os_notas; arquivo apagado se a linha não entrar; histórico na O.S. e em agente_acoes.
import { anexarOS, dimensoes, numeroDaNF, tratar, type Db, type Deps } from "../supabase/functions/email/acoes.ts";

const ok: string[] = [], falhas: string[] = [];
const confere = (nome: string, cond: boolean, extra: unknown = "") => (cond ? ok : falhas).push(nome + (!cond && extra !== "" ? " :: " + JSON.stringify(extra) : ""));
const deve = async (nome: string, f: () => Promise<unknown>, rx: RegExp) => { try { await f(); confere(nome, false, "não deu erro"); } catch (e) { confere(nome, rx.test((e as Error).message), (e as Error).message); } };

type L = Record<string, unknown>;
// JPEG mínimo com o marcador SOF0 (640 × 480) e PNG com o IHDR (800 × 600)
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9]);
const png = new Uint8Array(32); png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 3, 0x20, 0, 0, 2, 0x58]);
const webp = new TextEncoder().encode("RIFF\u0000\u0000\u0000\u0000WEBPVP8 ");
const xmlNfe = `<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe322611"><ide><nNF>0012627</nNF></ide></infNFe></NFe></nfeProc>`;

const tabelas: Record<string, L[]> = {
  ordens: [{ id: "o-1904", numero: 1904, status: "execucao", cliente_id: "c1", cliente: { nome: "Ana Souza", telefone: "(27) 99999-0000" }, veiculo: { placa: "ABC1D23" }, criado_em: "2026-11-01" },
           { id: "o-1800", numero: 1800, status: "cancelado", cliente_id: null, cliente: { nome: "Zé" }, veiculo: {}, criado_em: "2026-10-01" }],
  clientes: [{ id: "c1", telefone: "27999990000", telefone2: "27988887777", telefone3: "" }],
  whatsapp_mensagens: [
    { id: 501, msg_id: "WAFOTO1", telefone: "5527999990000", nome: "Ana", de_mim: false, tipo: "imagem", em: "2026-11-09T13:15:00+00:00", midia_path: "2026/11/09/WAFOTO1.jpg", midia_tipo: "image/jpeg" },
    { id: 502, msg_id: "WAFOTO2", telefone: "5527911112222", nome: "Desconhecido", de_mim: false, tipo: "imagem", em: "2026-11-09T14:00:00+00:00", midia_path: "2026/11/09/WAFOTO2.jpg", midia_tipo: "image/jpeg" },
    { id: 503, msg_id: "WAWEBP", telefone: "5527999990000", nome: "Ana", de_mim: false, tipo: "imagem", em: "2026-11-09T14:10:00+00:00", midia_path: "2026/11/09/WAWEBP.webp", midia_tipo: "image/webp" },
    { id: 504, msg_id: "WATEXTO", telefone: "5527999990000", nome: "Ana", de_mim: false, tipo: "texto", em: "2026-11-09T14:20:00+00:00", midia_path: null, midia_tipo: null },
    { id: 505, msg_id: "WAPNG", telefone: "5527988887777", nome: "Ana 2", de_mim: false, tipo: "imagem", em: "2026-11-09T14:30:00+00:00", midia_path: "2026/11/09/WAPNG.png", midia_tipo: "image/png" },
  ],
  fotos: [{ id: "ft0", ordem_id: "o-1904", etapa: "entrada" }, { id: "ft1", ordem_id: "o-1904", etapa: "execucao" }],
  os_notas: [], eventos: [],
};
const pastas: Record<string, Record<string, Uint8Array>> = {
  "whatsapp-midia": { "2026/11/09/WAFOTO1.jpg": jpeg, "2026/11/09/WAFOTO2.jpg": jpeg, "2026/11/09/WAWEBP.webp": webp, "2026/11/09/WAPNG.png": png },
  fotos: {}, notas: {},
};
const registros: L[] = [];
let falharInsert = "";
const db: Db = {
  rpc(f: string, a: L = {}) {
    if (f === "agente_quem") return Promise.resolve({ data: "Danilo", error: null });
    if (f === "agente_registrar") { registros.push(a); return Promise.resolve({ data: null, error: null }); }
    return Promise.resolve({ data: null, error: { message: "função " + f + " não existe" } });
  },
  from(t: string) {
    const filtros: Array<[string, unknown]> = []; let novo: L | null = null;
    const exec = () => {
      const lista = (tabelas[t] = tabelas[t] || []);
      if (novo) {
        if (falharInsert === t) return { data: null, error: { message: "new row violates row-level security policy" } };
        const linha = { id: t + "-" + (lista.length + 1), ...novo }; lista.push(linha); return { data: [{ ...linha }], error: null };
      }
      return { data: lista.filter((l) => filtros.every(([k, v]) => l[k] === v)).map((l) => ({ ...l })), error: null };
    };
    // deno-lint-ignore no-explicit-any
    const q: any = {
      select() { return q; }, order() { return q; }, eq(k: string, v: unknown) { filtros.push([k, v]); return q; },
      insert(l: L) { novo = l; return q; },
      then(a: (v: unknown) => unknown, b?: (e: unknown) => unknown) { return Promise.resolve(exec()).then(a, b); },
    };
    return q;
  },
  storage: {
    from(p: string) {
      return {
        download: (c: string) => Promise.resolve(pastas[p]?.[c] ? { data: new Blob([pastas[p][c]]), error: null } : { data: null, error: { message: "Object not found" } }),
        upload: (c: string, b: Uint8Array, op: { contentType: string }) => { (pastas[p] = pastas[p] || {})[c] = b; envios.push([p, c, op.contentType]); return Promise.resolve({ data: { path: c }, error: null }); },
        remove: (l: string[]) => { for (const c of l) delete pastas[p]?.[c]; apagados.push([p, l]); return Promise.resolve({ data: l, error: null }); },
      };
    },
  },
};
const envios: Array<[string, string, string]> = [], apagados: Array<[string, string[]]> = [];
let n = 0;
const deps: Deps = { usuario: db, adm: db, env: () => undefined, site: "https://gestao.test", uuid: () => "uuid-" + (++n) };

// utilidades
confere("dimensões do JPG e do PNG pelo cabeçalho", JSON.stringify(dimensoes(jpeg)) === '{"h":480,"w":640}' && JSON.stringify(dimensoes(png)) === '{"w":800,"h":600}' && dimensoes(webp) === null);
confere("número da NF: XML (sem zeros à esquerda) e nome do arquivo", numeroDaNF("x.xml", xmlNfe) === "12627" && numeroDaNF("NF 718570.pdf", "") === "718570" && numeroDaNF("boleto.pdf", "") === "");

// WhatsApp: prévia (pela ação, sem Microsoft configurada)
const pv = await tratar("anexar_os", { os: 1904, tipo: "foto", fonte: "whatsapp", msg_id: "501" }, deps) as L;
confere("foto do WhatsApp: prévia sem gravar, com a medida e o destino", pv.previa === true && pv.gravado === false && (pv.arquivo as L).tipo === "image/jpeg" && (pv.arquivo as L).largura === 640
  && /Fotos da O\.S\./.test(String(pv.destino)) && !pv.avisos && envios.length === 0 && tabelas.eventos.length === 0, pv);
confere("foto do WhatsApp: origem com o horário de Brasília", /WhatsApp de Ana \(5527999990000, 09\/11\/2026 10:15\)/.test(String(pv.origem)), pv.origem);
const pv2 = await tratar("anexar_os", { os: 1904, tipo: "foto", fonte: "whatsapp", msg_id: "WAFOTO2" }, deps) as L;
confere("foto de número que não é do cliente: aviso na prévia (msg_id do WhatsApp também vale)", /não está no cadastro do cliente/.test(JSON.stringify(pv2.avisos)), pv2);
const pv3 = await tratar("anexar_os", { os: 1904, tipo: "foto", fonte: "whatsapp", msg_id: 505 }, deps) as L;
confere("foto do 2º telefone do cliente: sem aviso; PNG", !pv3.avisos && (pv3.arquivo as L).tipo === "image/png" && (pv3.arquivo as L).altura === 600, pv3);

// WhatsApp: grava
const gv = await tratar("anexar_os", { os: 1904, tipo: "foto", fonte: "whatsapp", msg_id: 501, confirmar: true, pedido: "põe a foto da Ana na 1904" }, deps) as L;
const ft = tabelas.fotos[tabelas.fotos.length - 1];
confere("foto gravada: pasta fotos em os/<id>/<uuid>.jpg", JSON.stringify(envios[0]) === '["fotos","os/o-1904/uuid-1.jpg","image/jpeg"]', envios);
confere("foto gravada: linha na O.S. (execução, rótulo seguinte, medida)", ft.ordem_id === "o-1904" && ft.etapa === "execucao" && ft.rotulo === "Execução 2" && ft.largura === 640 && ft.altura === 480
  && gv.gravado === true && gv.id === ft.id && gv.abrir_no_sistema === "https://gestao.test/#/os/o-1904", { ft, gv });
confere("foto gravada: histórico da O.S. e do agente", tabelas.eventos[0]?.tipo === "foto" && /Foto anexada pelo agente/.test(String(tabelas.eventos[0]?.texto)) && tabelas.eventos[0]?.usuario_nome === "Danilo"
  && registros[0]?.p_ferramenta === "anexar_na_os" && registros[0]?.p_tabela === "fotos" && (registros[0]?.p as L)?.pedido === "põe a foto da Ana na 1904", { ev: tabelas.eventos, registros });
await tratar("anexar_os", { os: 1904, tipo: "foto", fonte: "whatsapp", msg_id: 505, rotulo: "Peça trocada", confirmar: true }, deps);
confere("rótulo dado pelo Danilo vale; PNG vai como .png", tabelas.fotos[tabelas.fotos.length - 1].rotulo === "Peça trocada" && /\.png$/.test(String(tabelas.fotos[tabelas.fotos.length - 1].caminho)));

// recusas
await deve("WEBP é recusado (a pasta da O.S. só aceita JPG/PNG)", () => tratar("anexar_os", { os: 1904, tipo: "foto", fonte: "whatsapp", msg_id: 503 }, deps), /WEBP/);
await deve("mensagem sem foto é recusada", () => tratar("anexar_os", { os: 1904, tipo: "foto", fonte: "whatsapp", msg_id: 504 }, deps), /não tem foto guardada/);
await deve("mensagem que não existe", () => tratar("anexar_os", { os: 1904, tipo: "foto", fonte: "whatsapp", msg_id: 999 }, deps), /não encontrada/);
await deve("O.S. que não existe", () => tratar("anexar_os", { os: 7777, tipo: "foto", fonte: "whatsapp", msg_id: 501 }, deps), /O\.S\. 7777 não encontrada/);
await deve("foto como NF é recusada", () => tratar("anexar_os", { os: 1904, tipo: "nf", fonte: "whatsapp", msg_id: 501 }, deps), /PDF ou o XML/);
await deve("sem msg_id", () => tratar("anexar_os", { os: 1904, tipo: "foto", fonte: "whatsapp" }, deps), /msg_id/);
await deve("tipo errado", () => tratar("anexar_os", { os: 1904, tipo: "video", fonte: "whatsapp", msg_id: 501 }, deps), /tipo deve ser/);
pastas["whatsapp-midia"]["2026/11/09/WAFOTO1.jpg"] = new Uint8Array(5 * 1024 * 1024 + 10).fill(0xff);
await deve("acima de 5 MB é recusado", () => tratar("anexar_os", { os: 1904, tipo: "foto", fonte: "whatsapp", msg_id: 501 }, deps), /5 MB/);
pastas["whatsapp-midia"]["2026/11/09/WAFOTO1.jpg"] = jpeg;
delete pastas["whatsapp-midia"]["2026/11/09/WAFOTO2.jpg"];
await deve("foto apagada da pasta (30 dias)", () => tratar("anexar_os", { os: 1904, tipo: "foto", fonte: "whatsapp", msg_id: 502 }, deps), /não está mais/);
const pc = await tratar("anexar_os", { os: 1800, tipo: "foto", fonte: "whatsapp", msg_id: 501 }, deps) as L;
confere("O.S. cancelada: avisa na prévia", /cancelada/.test(JSON.stringify(pc.avisos)), pc);
falharInsert = "fotos";
const antes = Object.keys(pastas.fotos).length;
await deve("linha recusada pelo banco: erro", () => tratar("anexar_os", { os: 1904, tipo: "foto", fonte: "whatsapp", msg_id: 501, confirmar: true }, deps), /row-level security/);
confere("linha recusada: a foto enviada é apagada da pasta", Object.keys(pastas.fotos).length === antes && apagados.some(([p]) => p === "fotos"), { apagados, pastas: Object.keys(pastas.fotos) });
falharInsert = "";

// e-mail: sem Microsoft configurada, a ação vai pelo caminho do e-mail (pede a configuração)
await deve("anexo de e-mail precisa do e-mail conectado", () => tratar("anexar_os", { os: 1904, tipo: "nf", fonte: "email", id: "AAMkAD-dpk-0001", anexo_id: "ANX-xml-000001" }, deps), /MS_CLIENT_ID/);

// e-mail com a Microsoft falsa (anexarOS com a chave já obtida)
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const anexos: Record<string, L> = {
  "ANX-xml-000001": { "@odata.type": "#microsoft.graph.fileAttachment", name: "NFe 12627.xml", contentType: "text/xml", size: xmlNfe.length, contentBytes: b64(new TextEncoder().encode(xmlNfe)) },
  "ANX-pdf-000001": { "@odata.type": "#microsoft.graph.fileAttachment", name: "DANFE NF 718570.pdf", contentType: "application/pdf", size: 20, contentBytes: b64(new TextEncoder().encode("%PDF-1.4 falso")) },
  "ANX-xml-falso01": { "@odata.type": "#microsoft.graph.fileAttachment", name: "pedido.xml", contentType: "text/xml", size: 20, contentBytes: b64(new TextEncoder().encode("<pedido><n>1</n></pedido>")) },
  "ANX-item-00001": { "@odata.type": "#microsoft.graph.itemAttachment", name: "Encaminhado", size: 20 },
};
globalThis.fetch = (async (entrada: string | URL | Request) => {
  const url = String(entrada instanceof Request ? entrada.url : entrada);
  const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
  const a = url.match(/attachments\/([^?]+)/);
  if (a) return anexos[decodeURIComponent(a[1])] ? j(anexos[decodeURIComponent(a[1])]) : j({ error: { code: "NotFound", message: "não achei" } }, 404);
  if (/\/messages\/AAMkAD-dpk-0001\?\$select/.test(url)) return j({ subject: "NF 12627 DPK", from: { emailAddress: { name: "DPK Cobrança", address: "cobranca@dpk.com.br" } } });
  return j({ error: { code: "NotFound", message: "não achei " + url } }, 404);
}) as typeof fetch;
const pn = await anexarOS(deps, "AT", { os: 1904, tipo: "nf", fonte: "email", id: "AAMkAD-dpk-0001", anexo_id: "ANX-xml-000001" }) as L;
confere("NF do e-mail: prévia com o número lido do XML e a origem", pn.previa === true && /NF 12627/.test(String(pn.destino)) && /e-mail de DPK Cobrança/.test(String(pn.origem)) && (pn.arquivo as L).tipo === "application/xml", pn);
const gn = await anexarOS(deps, "AT", { os: 1904, tipo: "nf", fonte: "email", id: "AAMkAD-dpk-0001", anexo_id: "ANX-pdf-000001", confirmar: true }) as L;
const nt = tabelas.os_notas[0];
confere("NF do e-mail gravada: pasta notas e os_notas (número pelo nome do PDF, placa, quem)", gn.gravado === true && nt?.os_numero === 1904 && nt?.numero_nf === "718570" && nt?.placa === "ABC1D23"
  && nt?.tipo_arquivo === "application/pdf" && nt?.criado_por === "Danilo" && /^1904\/uuid-\d+-danfe-nf-718570\.pdf$/.test(String(nt?.arquivo)) && !!pastas.notas[String(nt?.arquivo)], { gn, nt });
confere("NF gravada: histórico na O.S.", tabelas.eventos.some((e) => e.tipo === "nf" && /NF 718570 anexada pelo agente/.test(String(e.texto))));
const gn2 = await anexarOS(deps, "AT", { os: 1904, tipo: "nf", fonte: "email", id: "AAMkAD-dpk-0001", anexo_id: "ANX-pdf-000001", numero_nf: "nº 99", confirmar: true }) as L;
confere("numero_nf informado vale (só os números)", tabelas.os_notas[1]?.numero_nf === "99" && gn2.gravado === true);
await deve("XML que não é nota é recusado", () => anexarOS(deps, "AT", { os: 1904, tipo: "nf", fonte: "email", id: "AAMkAD-dpk-0001", anexo_id: "ANX-xml-falso01" }), /não parece ser de nota/);
await deve("PDF como foto é recusado", () => anexarOS(deps, "AT", { os: 1904, tipo: "foto", fonte: "email", id: "AAMkAD-dpk-0001", anexo_id: "ANX-pdf-000001" }), /JPG ou PNG/);
await deve("anexo que não é arquivo é recusado", () => anexarOS(deps, "AT", { os: 1904, tipo: "nf", fonte: "email", id: "AAMkAD-dpk-0001", anexo_id: "ANX-item-00001" }), /não é um arquivo/);
await deve("identificador de e-mail inválido", () => anexarOS(deps, "AT", { os: 1904, tipo: "nf", fonte: "email", id: "../x", anexo_id: "ANX-pdf-000001" }), /inválido/);

console.log(ok.map((x) => "OK " + x).join("\n"));
console.log("FALHAS", JSON.stringify(falhas));
if (falhas.length) Deno.exit(1);
