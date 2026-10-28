// Notas da SEFAZ: NF-e emitidas para o CNPJ da oficina, buscadas com o certificado A1
import { html, useState, useEffect, useMemo } from "../lib.js";
import { api } from "../api.js";
import { useApp, Campo, Modal, Vazio, Abas, Texto, Area } from "../ui.js";
import { norm, soDig, reais, fmtData, fmtDataHora, fmtDoc, numOS, exPlaca, totalItem, qtdFmt, arred } from "../util.js";
import { pode, STATUS } from "../regras.js";
import { Dinheiro } from "../ui.js";
import { lerNFe } from "../nfe.js";
import { contasDaNota } from "./financeiro.js";

const MANIF = { "": "", ciencia: "Ciência registrada", confirmada: "Operação confirmada", desconhecida: "Operação desconhecida", nao_realizada: "Operação não realizada" };
const lerB64 = arq => new Promise((ok, erro) => { const f = new FileReader(); f.onload = () => ok(String(f.result).split(",")[1] || ""); f.onerror = () => erro(new Error("Não foi possível ler o arquivo.")); f.readAsDataURL(arq); });
const situacaoXml = n => n.sem_ciencia && !n.tem_xml && !n.manifestacao ? ["Sem ciência (escolha sua)", "muted"] : n.manifestacao_pedida ? ["Enviando à SEFAZ: " + MANIF[n.manifestacao_pedida].toLowerCase(), "info"] : ["desconhecida", "nao_realizada"].includes(n.manifestacao) ? [MANIF[n.manifestacao], "bad"] : n.situacao === "cancelada" ? ["Cancelada pelo emitente", "bad"] : n.situacao === "denegada" ? ["Denegada", "bad"] : n.tem_xml ? ["XML disponível", "ok"]
  : n.manifestacao ? ["XML liberado na próxima consulta", "info"] : /^596/.test(n.manifestacao_erro || "") ? ["Só o resumo · prazo da ciência expirou", "warn"] : ["Só o resumo", "warn"];

function Certificado({ onFechar, onEnviado }) {
  const { avisar } = useApp();
  const [arq, setArq] = useState(null), [senha, setSenha] = useState(""), [erro, setErro] = useState(""), [enviando, setEnviando] = useState(false);
  const enviar = async () => {
    if (!arq) return setErro("Escolha o arquivo do certificado (.pfx ou .p12).");
    if (!senha) return setErro("Informe a senha do certificado.");
    setEnviando(true); setErro("");
    try { const r = await api.sefaz.chamar({ acao: "certificado", pfx: await lerB64(arq), senha }); avisar("Certificado de " + r.titular + " ativado."); onEnviado(r); }
    catch (e) { setErro(e.message); } finally { setEnviando(false); }
  };
  return html`<${Modal} titulo="Certificado digital A1" onFechar=${onFechar}>
    <p class="sub">Use o arquivo do certificado e-CNPJ A1 da DTCar (.pfx ou .p12) e a senha dele. O certificado A3 (token ou cartão) não funciona aqui.</p>
    <div class="campo"><label for="cert-arq">Arquivo do certificado</label><input id="cert-arq" class="inp" type="file" accept=".pfx,.p12,application/x-pkcs12" onChange=${e => { setArq(e.target.files[0] || null); setErro(""); }} /></div>
    <${Campo} id="cert-senha" rotulo="Senha do certificado"><input id="cert-senha" class="inp" type="password" autocomplete="off" value=${senha} onInput=${e => { setSenha(e.target.value); setErro(""); }} /></${Campo}>
    <div class="info">O arquivo e a senha vão direto para a área protegida do servidor e não ficam visíveis no site, nem para a equipe. O certificado serve só para consultar notas e registrar as manifestações que você pedir aqui.</div>
    ${erro ? html`<div class="erros">${erro}</div>` : null}
    <div class="acoes"><span class="espaco"></span><button type="button" class="btn" onClick=${onFechar}>Cancelar</button><button type="button" class="btn btn-pri" disabled=${enviando} onClick=${enviar}>${enviando ? "Conferindo…" : "Enviar e ativar"}</button></div>
  </${Modal}>`;
}

/* ---------------- vincular a nota a uma O.S. (custo das peças) ---------------- */
function VincularOS({ n, onFechar, onFeito }) {
  const { dados, avisar } = useApp();
  const [q, setQ] = useState(""), [os, setOs] = useState(null), [itens, setItens] = useState(null), [nf, setNf] = useState(null), [sel, setSel] = useState({}), [salvando, setSalvando] = useState(false), [erro, setErro] = useState("");
  useEffect(() => { if (n.tem_xml) api.sefaz.xml(n.chave).then(x => setNf(lerNFe(x))).catch(() => setNf(null)); }, []);
  const emissao = n.emissao ? new Date(n.emissao).getTime() : Date.now();
  const lista = useMemo(() => { const t = norm(q), p = q.toUpperCase().replace(/[^A-Z0-9]/g, ""), d = soDig(q);
    return dados.ordens.filter(o => o.status !== "cancelado" && (!q.trim() || (d && String(o.numero) === String(+d)) || (p.length >= 3 && (o.veiculo.placa || "").includes(p)) || norm(o.cliente.nome).includes(t) || norm(o.veiculo.modelo).includes(t)))
      .sort((a, b) => Math.abs(new Date(a.criado_em) - emissao) - Math.abs(new Date(b.criado_em) - emissao)).slice(0, 25); }, [q, dados.ordens]);
  const escolher = async o => { setOs(o); setItens(null); setErro("");
    try { const r = await api.ordem(o.id); setItens(r.itens.filter(i => i.tipo !== "servico" && !i.fornecida_cliente)); } catch (e) { setErro(e.message); } };
  // origens possíveis do custo: um item da nota, a nota inteira ou valor digitado
  const origens = [["", "Não vincular"], ["nota", "Nota inteira (" + reais(n.valor) + ")"], ...(nf ? nf.itens.map(i => ["i" + i.n, i.descricao_nf + " · " + qtdFmt(i.qtd) + " " + i.unidade + " × " + reais(i.custo_unit)]) : []), ["manual", "Outro valor (digitar)"]];
  const escolherOrigem = (it, v) => { const ni = v.startsWith("i") && nf ? nf.itens.find(x => "i" + x.n === v) : null;
    const custo = v === "nota" ? Number(n.valor) : ni ? arred(ni.custo_unit * Number(it.qtd)) : v === "manual" ? (sel[it.id] && sel[it.id].custo) || 0 : 0;
    setSel(s => ({ ...s, [it.id]: v ? { origem: v, custo, nf_item: ni ? ni.n : null, descricao_nf: ni ? ni.descricao_nf : v === "nota" ? "Nota inteira" : "Valor informado" } : undefined })); };
  const escolhidos = (itens || []).filter(i => sel[i.id] && sel[i.id].origem);
  const custoTot = escolhidos.reduce((s, i) => s + Number(sel[i.id].custo || 0), 0), vendaTot = escolhidos.reduce((s, i) => s + totalItem(i), 0);
  const salvar = async () => {
    if (!escolhidos.length) return setErro("Escolha de onde vem o custo de pelo menos uma peça.");
    if (escolhidos.some(i => !(Number(sel[i.id].custo) > 0))) return setErro("Informe o custo de cada peça escolhida.");
    setSalvando(true); setErro("");
    try { const r = await api.sefaz.vincular({ chave: n.chave, ordem_id: os.id, itens: escolhidos.map(i => ({ item_id: i.id, nf_item: sel[i.id].nf_item, descricao_nf: sel[i.id].descricao_nf, custo_total: arred(sel[i.id].custo) })) });
      avisar(`Nota vinculada à ${numOS(r.ordem)}: custo ${reais(r.custo)}, vendido ${reais(r.venda)}.`); onFeito(); }
    catch (e) { setErro(e.message); } finally { setSalvando(false); }
  };
  return html`<${Modal} titulo=${"Vincular a NF " + n.numero + " a uma O.S."} largo onFechar=${onFechar}>
    ${!os ? html`<p class="sub">Escolha a O.S. (aberta ou já entregue) em que as peças desta nota foram usadas. As mais próximas da data da nota aparecem primeiro.</p>
      <input id="vin-busca" class="inp" type="search" autofocus placeholder="Nº da O.S., placa, cliente ou modelo" value=${q} onInput=${e => setQ(e.target.value)} />
      <div class="lista">${lista.map(o => html`<button type="button" key=${o.id} class="linha" onClick=${() => escolher(o)}><span class="cod">${String(o.numero).padStart(5, "0")}</span>
        <span class="meio"><strong>${exPlaca(o.veiculo.placa) || "sem placa"} · ${[o.veiculo.marca, o.veiculo.modelo].filter(Boolean).join(" ")}</strong><span>${o.cliente.nome} · ${fmtData(o.criado_em)} · ${(STATUS[o.status] || {}).curto || o.status}</span></span><b>${reais(o.total)}</b></button>`)}
        ${!lista.length ? html`<span class="dica">Nenhuma O.S. encontrada.</span>` : null}</div>`
    : html`<div class="total-item"><span>${numOS(os.numero)} · ${exPlaca(os.veiculo.placa)} · ${os.cliente.nome}</span><button type="button" class="btn btn-sm" onClick=${() => { setOs(null); setSel({}); }}>Trocar O.S.</button></div>
      ${!itens ? html`<div class="esqueleto"></div>` : !itens.length ? html`<${Vazio}>Esta O.S. não tem peças nem serviços de terceiros. Inclua a peça na O.S. primeiro.</${Vazio}>` : html`
        <p class="sub">Para cada peça da O.S., diga de onde vem o custo. O estoque não é alterado.${!nf ? " Esta nota ainda não tem o XML: use a nota inteira ou digite o valor." : ""}</p>
        <div class="vinculos">${itens.map(it => { const s = sel[it.id] || {}; const venda = totalItem(it); const marg = s.origem && Number(s.custo) > 0 ? (venda - s.custo) / (venda || 1) * 100 : null;
          return html`<div class="vinculo-linha" key=${it.id}>
            <div class="meio"><strong>${it.descricao}</strong><span class="sub">${qtdFmt(it.qtd)} × ${reais(it.valor_unit)} = vendido ${reais(venda)}${it.nfe_ref ? " · já ligado à " + it.nfe_ref : Number(it.custo_unit) ? " · custo atual " + reais(it.custo_unit * it.qtd) : ""}</span></div>
            <select class="inp" aria-label=${"Origem do custo de " + it.descricao} value=${s.origem || ""} onChange=${e => escolherOrigem(it, e.target.value)}>${origens.map(([v, t]) => html`<option value=${v}>${t}</option>`)}</select>
            ${s.origem ? html`<div class="vinculo-custo"><${Dinheiro} id=${"vc-" + it.id} valor=${s.custo} onMuda=${v => setSel(x => ({ ...x, [it.id]: { ...x[it.id], custo: v } }))} />
              <span class=${"pill p-" + (marg === null ? "muted" : marg < 15 ? "bad" : "ok")}>${marg === null ? "—" : "margem " + Math.round(marg) + "%"}</span></div>` : null}
          </div>`; })}</div>
        ${escolhidos.length ? html`<div class="total-item tot"><span>Custo ${reais(custoTot)} · vendido ${reais(vendaTot)}</span><b>Lucro ${reais(vendaTot - custoTot)}${vendaTot ? " (" + Math.round((vendaTot - custoTot) / vendaTot * 100) + "%)" : ""}</b></div>` : null}`}`}
    ${erro ? html`<div class="erros">${erro}</div>` : null}
    <div class="acoes"><span class="espaco"></span><button type="button" class="btn" onClick=${onFechar}>Cancelar</button>${os ? html`<button type="button" class="btn btn-pri" disabled=${salvando || !escolhidos.length} onClick=${salvar}>${salvando ? "Vinculando…" : "Vincular à O.S."}</button>` : null}</div>
  </${Modal}>`;
}

function Detalhe({ n, onFechar, onMudou }) {
  const { perfil, ir, avisar, confirmar, dados, recarregar } = useApp();
  const admin = pode(perfil, "ajustes"), fin = pode(perfil, "financeiro");
  const [ocupado, setOcupado] = useState(""), [just, setJust] = useState(""), [pedirJust, setPedirJust] = useState(false);
  const [rot, cor] = situacaoXml(n);
  const [vincular, setVincular] = useState(false), [vincs, setVincs] = useState([]), [semC, setSemC] = useState(!!n.sem_ciencia);
  useEffect(() => { api.sefaz.vinculos(n.chave).then(setVincs).catch(() => {}); }, []);
  const acao = async (nome, fn) => { setOcupado(nome); try { await fn(); onMudou(); } catch (e) { avisar(e.message, true); } finally { setOcupado(""); } };
  const manifestar = async (tipo, texto) => {
    if (!await confirmar({ titulo: MANIF[tipo], texto: texto + " O registro é enviado à SEFAZ em até 10 minutos.", botao: "Registrar na SEFAZ", perigo: tipo !== "confirmada" })) return;
    acao(tipo, async () => { await api.sefaz.pedirManifestacao(n.chave, tipo, just);
      if (tipo !== "confirmada" && n.status === "nova") await api.sefaz.marcar(n.chave, { status: "ignorada" });
      avisar("Pedido registrado: a SEFAZ recebe em até 10 minutos."); });
  };
  const baixarXml = async () => { const x = await api.sefaz.xml(n.chave); const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([x], { type: "application/xml" })); a.download = n.chave + "-nfe.xml"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 20000); };
  const duplicatas = () => acao("dup", async () => {
    const nf = lerNFe(await api.sefaz.xml(n.chave));
    let f = dados.fornecedores.find(x => x.cnpj && x.cnpj === nf.fornecedor.cnpj);
    if (!f) { f = await api.fornecedores.salvar({ ...nf.fornecedor, razao: nf.fornecedor.razao || "Fornecedor" }); await recarregar(["fornecedores"]); }
    if (!nf.duplicatas.length) throw new Error("A nota não traz duplicatas (pagamento à vista ou não informado). Lance a conta em Contas a pagar, se houver.");
    const r = await api.contas.lancar(contasDaNota(nf, f.id, f.categoria_padrao)); await api.sefaz.marcar(n.chave, { contas_lancadas: true });
    avisar(r.lancadas + " duplicata(s) lançada(s) em contas a pagar" + (r.repetidas ? "; " + r.repetidas + " já existia(m)" : "") + ".");
  });
  return html`<${Modal} titulo=${"NF " + n.numero + (n.serie ? " série " + n.serie : "")} onFechar=${onFechar}>
    <div class="conta-cab"><div><strong>${n.nome_emitente}</strong><span class="sub">${fmtDoc(n.cnpj_emitente)}</span></div><b>${reais(n.valor)}</b></div>
    <div class="chips"><span class=${"pill p-" + cor}>${rot}</span>${n.manifestacao ? html`<span class="pill p-info">${MANIF[n.manifestacao]}</span>` : null}${n.status !== "nova" ? html`<span class="pill p-muted">${{ lancada: "Entrada lançada", vinculada: "Vinculada a O.S.", ignorada: "Ignorada" }[n.status]}</span>` : null}${n.contas_lancadas ? html`<span class="pill p-ok">Duplicatas lançadas</span>` : null}</div>
    <div class="kv"><div><span>Emissão</span><b>${n.emissao ? fmtDataHora(n.emissao) : "—"}</b></div><div><span>Chave de acesso</span><b class="mono quebra">${n.chave}</b></div></div>
    ${/^596/.test(n.manifestacao_erro || "") && !n.tem_xml ? html`<div class="aviso">A SEFAZ só aceita a ciência até 10 dias depois da emissão, e esta nota passou desse prazo. Para liberar o XML: se a compra aconteceu, use “Confirmar operação” abaixo (vale até 180 dias); ou peça o XML ao fornecedor e use a Entrada de nota.</div>`
      : n.manifestacao_erro ? html`<div class="aviso">Última manifestação recusada pela SEFAZ: ${n.manifestacao_erro}</div>` : null}
    ${!n.tem_xml && n.situacao === "autorizada" && !n.manifestacao && !n.manifestacao_pedida && !/^596/.test(n.manifestacao_erro || "") ? html`<div class="ciencia-box">
        <div><b>Ciência da operação</b><span class="sub">Avisa à SEFAZ que você viu a nota e libera o XML completo. Não confirma a compra. A SEFAZ aceita até 10 dias após a emissão.</span></div>
        ${admin ? html`<div class="acoes"><button type="button" class="btn btn-sm btn-pri" disabled=${!!ocupado} onClick=${() => acao("cie", async () => { await api.sefaz.pedirManifestacao(n.chave, "ciencia", ""); avisar("Ciência pedida: a SEFAZ recebe em até 10 minutos e o XML chega na consulta seguinte."); })}>Dar ciência</button>
          <label class="linha-check"><input type="checkbox" checked=${semC} onChange=${async e => { const v = e.target.checked; setSemC(v); try { await api.sefaz.marcar(n.chave, { sem_ciencia: v }); avisar(v ? "Esta nota não receberá ciência automática." : "A ciência automática volta a valer para esta nota."); } catch (x) { setSemC(!v); avisar(x.message, true); } }} /><span>Não dar ciência nesta nota (a automática pula esta)</span></label></div>`
          : html`<span class="dica">${semC ? "Marcada para não dar ciência." : "A ciência é registrada automaticamente na próxima consulta."}</span>`}</div>`
      : !n.tem_xml && n.manifestacao === "ciencia" ? html`<span class="dica">A ciência foi registrada: o XML completo chega na próxima consulta (até 1 hora).</span>` : null}
    ${vincs.length ? html`<div class="info"><b>Vinculada a O.S.:</b> ${vincs.map(v => { const o = dados.ordens.find(x => x.id === v.ordem_id); return (o ? numOS(o.numero) : "O.S.") + " (" + v.descricao_nf + ", custo " + reais(v.custo_total) + ")"; }).join("; ")}</div>` : null}
    <div class="acoes">
      ${n.tem_xml && n.status !== "lancada" && pode(perfil, "cadastrar") ? html`<button type="button" class="btn btn-pri" onClick=${() => ir("/nfe?sefaz=" + n.chave)}>Dar entrada no estoque</button>` : null}
      ${n.tem_xml && fin && !n.contas_lancadas ? html`<button type="button" class="btn" disabled=${!!ocupado} onClick=${duplicatas}>Lançar só as duplicatas</button>` : null}
      ${pode(perfil, "cadastrar") ? html`<button type="button" class="btn" onClick=${() => setVincular(true)}>${vincs.length ? "Vincular a outra O.S." : "Vincular a uma O.S."}</button>` : null}
      ${n.tem_xml ? html`<button type="button" class="btn" onClick=${baixarXml}>Baixar XML</button>` : null}
      ${n.status === "nova" ? html`<button type="button" class="btn" disabled=${!!ocupado} onClick=${() => acao("ign", async () => { await api.sefaz.marcar(n.chave, { status: "ignorada" }); avisar("Nota ignorada."); })}>Ignorar</button>`
        : n.status === "ignorada" ? html`<button type="button" class="btn" onClick=${() => acao("vol", () => api.sefaz.marcar(n.chave, { status: "nova" }))}>Voltar para novas</button>` : null}
    </div>
    ${admin && n.situacao === "autorizada" && !n.manifestacao_pedida && !["confirmada", "desconhecida", "nao_realizada"].includes(n.manifestacao) ? html`<details class="manifestar"><summary>Manifestação do destinatário</summary>
      <p class="sub">Registra na SEFAZ a sua posição sobre esta nota. Não dá para desfazer.</p>
      <div class="acoes">
        <button type="button" class="btn btn-sm" disabled=${!!ocupado} onClick=${() => manifestar("confirmada", "Confirma que a compra aconteceu e a mercadoria foi recebida.")}>Confirmar operação</button>
        <button type="button" class="btn btn-sm btn-perigo" disabled=${!!ocupado} onClick=${() => manifestar("desconhecida", "Use quando a nota foi emitida contra o CNPJ da DTCar sem você ter comprado (erro ou fraude).")}>Desconhecer operação</button>
        <button type="button" class="btn btn-sm" onClick=${() => setPedirJust(true)}>Operação não realizada</button></div>
      ${pedirJust ? html`<${Campo} id="sf-just" rotulo="Justificativa (mínimo 15 caracteres)"><${Area} id="sf-just" valor=${just} onMuda=${setJust} /></${Campo}>
        <button type="button" class="btn btn-sm btn-perigo" disabled=${just.trim().length < 15 || !!ocupado} onClick=${() => manifestar("nao_realizada", "Informa à SEFAZ que a compra foi combinada, mas não aconteceu (ex.: mercadoria recusada).")}>Registrar operação não realizada</button>` : null}
    </details>` : null}
    ${vincular ? html`<${VincularOS} n=${n} onFechar=${() => setVincular(false)} onFeito=${() => { setVincular(false); onMudou(); }} />` : null}
  </${Modal}>`;
}

export function NotasSefaz() {
  const { perfil, avisar } = useApp();
  const admin = pode(perfil, "ajustes");
  const [cfg, setCfg] = useState(null), [lista, setLista] = useState(null), [erro, setErro] = useState("");
  const [aba, setAba] = useState("novas"), [q, setQ] = useState(""), [cert, setCert] = useState(false), [det, setDet] = useState(null), [consultando, setConsultando] = useState(false);
  const carregar = () => { api.sefaz.config().then(setCfg).catch(e => setErro(e.message)); api.sefaz.notas().then(setLista).catch(e => { setErro(e.message); setLista([]); }); };
  useEffect(carregar, []);
  const filtradas = useMemo(() => (lista || []).filter(n => (aba === "todas" || (aba === "novas" ? n.status === "nova" && n.situacao !== "cancelada" : (aba === "lancadas" ? ["lancada", "vinculada"].includes(n.status) : n.status === "ignorada")))
    && (!q || norm(n.nome_emitente).includes(norm(q)) || n.numero === q.trim() || (soDig(q).length >= 4 && (n.cnpj_emitente.includes(soDig(q)) || n.chave.includes(soDig(q)))))), [lista, aba, q]);
  const consultar = async () => { setConsultando(true);
    try { const r = await api.sefaz.pedirConsulta();
      const espera = r && r.proxima_consulta && new Date(r.proxima_consulta) > new Date();
      avisar(espera ? "Pedido registrado. A SEFAZ só libera nova consulta às " + new Date(r.proxima_consulta).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) + "; o robô consulta nesse horário." : "Pedido registrado. O robô consulta a SEFAZ em até 10 minutos.");
      carregar(); }
    catch (e) { avisar(e.message, true); } finally { setConsultando(false); } };
  const roboParado = cfg && cfg.validade && (!cfg.worker_em || Date.now() - new Date(cfg.worker_em) > 40 * 60000);
  const venceEm = cfg && cfg.validade ? Math.floor((new Date(cfg.validade) - Date.now()) / 86400000) : null;
  const n = k => (lista || []).filter(x => k === "novas" ? x.status === "nova" && x.situacao !== "cancelada" : x.status === k).length;
  return html`<div class="pagina larga-media sefaz">
    <div class="painel-topo"><div><h1>Notas da SEFAZ</h1><span class="sub">NF-e emitidas para o CNPJ da oficina, buscadas automaticamente de hora em hora</span></div>
      ${admin && cfg && cfg.validade ? html`<div class="acoes"><button type="button" class="btn btn-pri" disabled=${consultando} onClick=${consultar}>${consultando ? "Consultando…" : "Consultar agora"}</button></div>` : null}</div>
    ${erro ? html`<div class="erros">${erro}</div>` : null}
    ${!cfg ? html`<section class="card"><div class="esqueleto"></div></section>` : !cfg.validade ? html`<section class="card card-alerta">
        <h3>Ativar a busca de notas</h3>
        <p>Com o certificado digital A1 da DTCar, o sistema consulta a SEFAZ de hora em hora e traz todas as notas de compra emitidas para o seu CNPJ, com o XML completo. Daqui você dá entrada no estoque, lança as duplicatas em contas a pagar ou desconhece uma nota que você não comprou.</p>
        <ul class="res-lista"><li>A SEFAZ guarda as notas por 90 dias: a primeira consulta traz os últimos 3 meses.</li><li>Quando não há nota nova, a SEFAZ exige 1 hora de intervalo entre consultas.</li><li>Para liberar o XML, o sistema registra automaticamente a "ciência da operação" (não confirma a compra).</li></ul>
        ${admin ? html`<div class="acoes"><button type="button" class="btn btn-pri" onClick=${() => setCert(true)}>Enviar certificado A1</button></div>` : html`<span class="dica">Peça ao administrador para enviar o certificado.</span>`}</section>`
      : html`<section class="card sefaz-status">
        <div class="kv">
          <div><span>Certificado</span><b>${cfg.titular}</b><small>${fmtDoc(cfg.cnpj)}</small></div>
          <div><span>Validade</span><b class=${venceEm !== null && venceEm < 30 ? "c-bad" : ""}>${fmtData(cfg.validade)}</b><small>${venceEm < 0 ? "vencido" : venceEm < 30 ? "vence em " + venceEm + " dia(s)" : ""}</small></div>
          <div><span>Última consulta</span><b>${cfg.ultima_consulta ? fmtDataHora(cfg.ultima_consulta) : "ainda não consultou"}</b><small>${cfg.ultimo_status || ""}</small></div>
          <div><span>Próxima consulta</span><b>${cfg.proxima_consulta && new Date(cfg.proxima_consulta) > new Date() ? fmtDataHora(cfg.proxima_consulta) : "a qualquer momento"}</b><small>${cfg.ativo ? "automática de hora em hora" : "busca automática desligada"}</small></div>
        </div>
        ${cfg.ultimo_erro ? html`<div class="erros">${cfg.ultimo_erro}</div>` : null}
        ${roboParado ? html`<div class="aviso">O robô da SEFAZ ${cfg.worker_em ? "não roda desde " + fmtDataHora(cfg.worker_em) : "ainda não rodou"}. ${cfg.worker_erro ? "Último erro: " + cfg.worker_erro + ". " : ""}Ele roda no GitHub a cada 10 minutos: confira se a chave SUPABASE_SECRET_KEY está cadastrada e se a rotina “SEFAZ – notas de compra” está ativa na aba Actions do repositório.</div>`
          : cfg.worker_erro ? html`<div class="erros">Robô da SEFAZ: ${cfg.worker_erro}</div>` : html`<span class="dica">Robô da SEFAZ ativo: última verificação ${fmtDataHora(cfg.worker_em)}${cfg.pedido_em && (!cfg.ultima_consulta || cfg.pedido_em > cfg.ultima_consulta) ? " · consulta pedida em " + fmtDataHora(cfg.pedido_em) : ""}.</span>`}
        ${admin ? html`<div class="acoes">
          <label class="linha-check"><input type="checkbox" checked=${cfg.ativo} onChange=${async e => { const v = e.target.checked; try { await api.sefaz.salvarConfig({ ativo: v }); setCfg({ ...cfg, ativo: v }); } catch (x) { avisar(x.message, true); } }} /><span>Buscar automaticamente</span></label>
          <label class="linha-check"><input type="checkbox" checked=${cfg.ciencia_automatica} onChange=${async e => { const v = e.target.checked; try { await api.sefaz.salvarConfig({ ciencia_automatica: v }); setCfg({ ...cfg, ciencia_automatica: v }); } catch (x) { avisar(x.message, true); } }} /><span>Registrar ciência automaticamente (libera o XML)</span></label>
          <span class="espaco"></span><button type="button" class="btn btn-sm" onClick=${() => setCert(true)}>Trocar certificado</button></div>` : null}
      </section>`}
    <section class="card">
      <${Abas} abas=${[["novas", "Novas (" + n("novas") + ")"], ["lancadas", "Lançadas / vinculadas"], ["ignoradas", "Ignoradas"], ["todas", "Todas"]]} ativa=${aba} onTroca=${setAba} />
      <input id="busca-sefaz" class="inp" type="search" placeholder="Fornecedor, número, CNPJ ou chave" value=${q} onInput=${e => setQ(e.target.value)} />
      ${!lista ? html`<div class="esqueleto"></div>` : filtradas.length ? html`<div class="lista">${filtradas.map(x => { const [rot, cor] = situacaoXml(x); return html`<button type="button" key=${x.id} class="linha" onClick=${() => setDet(x)}>
          <span class="meio"><strong>${x.nome_emitente || fmtDoc(x.cnpj_emitente)}</strong><span>NF ${x.numero}${x.emissao ? " · " + fmtData(x.emissao) : ""}${x.manifestacao && x.manifestacao !== "ciencia" ? " · " + MANIF[x.manifestacao] : ""}</span></span>
          <span class="dir"><b>${reais(x.valor)}</b><span class=${"pill p-" + cor}>${rot}</span></span></button>`; })}</div>`
        : html`<${Vazio}>${aba === "novas" ? (cfg && cfg.validade ? "Nenhuma nota nova. A busca roda de hora em hora." : "Envie o certificado para começar a receber as notas.") : "Nada aqui."}</${Vazio}>`}
    </section>
    ${cert ? html`<${Certificado} onFechar=${() => setCert(false)} onEnviado=${() => { setCert(false); carregar(); }} />` : null}
    ${det ? html`<${Detalhe} n=${det} onFechar=${() => { setDet(null); carregar(); }} onMudou=${() => { setDet(null); carregar(); }} />` : null}
  </div>`;
}
