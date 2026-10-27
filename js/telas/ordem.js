import { html, useState, useEffect, useRef, useMemo } from "../lib.js";
import { api } from "../api.js";
import { useApp, Placa, Status, Campo, Texto, Area, Dinheiro, Seg, Abas, Modal, Foto, PadAssinatura, I, Vazio } from "../ui.js";
import { soDig, norm, uuid, fmtTel, fmtDoc, fmtKm, fmtDataHora, fmtData, reais, qtdFmt, arred, totais, numOS, somaDias, hojeISO, exPlaca, linkWhats, reduzirImagem, tempoDesde } from "../util.js";
import { STATUS, FLUXO, pode, QUALIDADE, secoesCheckin, achados, TERMO_GARANTIA } from "../regras.js";
import { pdfEntrada, pdfOrcamento, pdfOS, entregarArquivo } from "../pdf.js";

/* ---------------- Mensagens de WhatsApp ---------------- */
const nomeVeic = o => [o.veiculo.marca, o.veiculo.modelo].filter(Boolean).join(" ") + " (" + exPlaca(o.veiculo.placa) + ")";
const primeiroNome = o => ((o.cliente || {}).nome || "").split(" ")[0];
function linhasItensMsg(itens) {
  const L = [];
  const grupo = (tipo, titulo) => { const g = itens.filter(i => i.tipo === tipo); if (!g.length) return;
    L.push("*" + titulo + ":*"); g.forEach(i => L.push("• " + i.descricao + (i.fornecida_cliente ? " (peça do cliente)" : " — " + reais(i.qtd * i.valor_unit)))); L.push(""); };
  grupo("servico", "Mão de obra"); grupo("peca", "Peças"); grupo("terceiro", "Serviços de terceiros");
  return L;
}
export const MSG = {
  entrada: (o, cfg) => `Olá, ${primeiroNome(o)}! Aqui é da ${cfg.nome}.\n\nRecebemos seu ${nomeVeic(o)} em ${fmtDataHora(o.criado_em)}, com ${fmtKm(o.km_entrada)}. Número do atendimento: *${numOS(o.numero)}*.\n\nVamos fazer o diagnóstico e enviar o orçamento para sua aprovação antes de executar qualquer serviço.`,
  orcamento: (o, cfg, itens) => { const t = totais(itens, o.desconto);
    return [`Olá, ${primeiroNome(o)}! O orçamento do seu ${nomeVeic(o)} está pronto (${numOS(o.numero)}).`, "",
      ...(o.diagnostico ? ["*Diagnóstico:* " + o.diagnostico, ""] : []), ...linhasItensMsg(itens),
      ...(t.desconto ? ["Desconto: " + reais(t.desconto)] : []), `*Total: ${reais(t.total)}*`,
      `Previsão de entrega: ${o.previsao_entrega ? fmtData(o.previsao_entrega) : "a combinar"}`, `Válido até ${fmtData(o.validade_orcamento)}.`, "",
      "Para aprovar, responda *APROVADO*. Se preferir aprovar só parte dos itens, é só dizer quais. Envio o orçamento completo em PDF a seguir."].join("\n"); },
  adicionais: (o, cfg, itens) => { const t = totais(itens, 0);
    return [`Olá, ${primeiroNome(o)}! Durante o serviço no seu ${nomeVeic(o)}, na ${numOS(o.numero)}, identificamos itens adicionais:`, "",
      ...linhasItensMsg(itens), `*Valor adicional: ${reais(t.total)}*`, "", "Só executamos com a sua aprovação. Responda *APROVADO* para incluir, ou diga quais itens deseja."].join("\n"); },
  pronto: (o, cfg) => `Olá, ${primeiroNome(o)}! Seu ${nomeVeic(o)} está pronto para retirada (${numOS(o.numero)}).\n\nValor total: *${reais(o.total)}*.\n${cfg.endereco ? "Endereço: " + cfg.endereco + "\n" : ""}\nQualquer dúvida, estamos à disposição.`,
  entrega: (o, cfg) => `Obrigado pela confiança, ${primeiroNome(o)}!\n\nOs serviços da ${numOS(o.numero)} no seu ${nomeVeic(o)} têm garantia de ${o.garantia_dias} dias, até ${fmtData(somaDias(o.entregue_em, o.garantia_dias))}. Guarde a ordem de serviço que enviamos.\n\n${cfg.nome}${cfg.telefone ? " · " + cfg.telefone : ""}`,
};

/* ---------------- Edição de item ---------------- */
function ItemModal({ item, onSalvar, onExcluir, onFechar }) {
  const { cfg, dados } = useApp();
  const [i, setI] = useState(item);
  const [busca, setBusca] = useState("");
  const set = p => setI(o => ({ ...o, ...p }));
  const sugestaoVenda = c => arred(c * (1 + (Number(cfg.markupPecas) || 0) / 100));
  const cat = useMemo(() => { const q = norm(busca); return dados.servicos.filter(s => s.ativo !== false && (!q || norm(s.nome).includes(q) || norm(s.categoria).includes(q))).slice(0, 12); }, [busca, dados.servicos]);
  const usarServico = s => {
    if (s.cobranca === "hora") set({ descricao: s.nome, servico_id: s.id, horas: Number(s.horas) || 1, qtd: Number(s.horas) || 1, valor_unit: Number(cfg.valorHora) || 0 });
    else set({ descricao: s.nome, servico_id: s.id, horas: null, qtd: 1, valor_unit: Number(s.preco) || 0 });
    setBusca("");
  };
  const porHora = i.tipo === "servico" && i.horas !== null && i.horas !== undefined;
  const erro = !i.descricao.trim() ? "Informe a descrição." : !(Number(i.qtd) > 0) ? "Quantidade deve ser maior que zero." : "";
  const titulo = (item._novo ? "Adicionar " : "Editar ") + { servico: "serviço", peca: "peça", terceiro: "serviço de terceiro" }[i.tipo];
  return html`<${Modal} titulo=${titulo} onFechar=${onFechar}>
    ${i.tipo === "servico" && item._novo ? html`<${Campo} id="cat-busca" rotulo="Buscar no catálogo"><${Texto} id="cat-busca" placeholder="ex.: pastilha, alinhamento" valor=${busca} onMuda=${setBusca} /></${Campo}>
      ${busca || !i.descricao ? html`<div class="lista lista-cat">${cat.map(s => html`<button type="button" key=${s.id} class="linha" onClick=${() => usarServico(s)}><span class="meio"><strong>${s.nome}</strong><span>${s.categoria}</span></span>
        <span class="sub">${s.cobranca === "hora" ? (Number(s.horas) || "?") + " h × " + reais(cfg.valorHora) : (Number(s.preco) ? reais(s.preco) : "sem preço")}</span></button>`)}
        ${!cat.length ? html`<span class="dica">Nada encontrado. Preencha abaixo como serviço avulso.</span>` : null}</div>` : null}` : null}
    <${Campo} id="it-desc" rotulo="Descrição" obrig><${Texto} id="it-desc" valor=${i.descricao} onMuda=${v => set({ descricao: v })} /></${Campo}>
    ${i.tipo === "servico" ? html`
      <${Seg} rotulo="Forma de cobrança" opcoes=${[["Preço fechado", "info"], ["Por hora", "info"]]} valor=${porHora ? "Por hora" : "Preço fechado"}
        onEscolha=${v => v === "Por hora" ? set({ horas: i.horas || 1, qtd: i.horas || 1, valor_unit: Number(cfg.valorHora) || i.valor_unit }) : set({ horas: null, qtd: 1 })} />
      ${porHora ? html`<div class="grade">
          <${Campo} id="it-horas" rotulo="Tempo (horas)"><input id="it-horas" class="inp" inputmode="decimal" value=${String(i.horas ?? "").replace(".", ",")} onInput=${e => { const h = Number(e.target.value.replace(",", ".")) || 0; set({ horas: h, qtd: h }); }} /></${Campo}>
          <${Campo} id="it-vh" rotulo="Valor da hora"><${Dinheiro} id="it-vh" valor=${i.valor_unit} onMuda=${v => set({ valor_unit: v })} /></${Campo}></div>`
        : html`<div class="grade">
          <${Campo} id="it-qtd" rotulo="Quantidade"><input id="it-qtd" class="inp" inputmode="decimal" value=${String(i.qtd).replace(".", ",")} onInput=${e => set({ qtd: Number(e.target.value.replace(",", ".")) || 0 })} /></${Campo}>
          <${Campo} id="it-val" rotulo="Valor unitário"><${Dinheiro} id="it-val" valor=${i.valor_unit} onMuda=${v => set({ valor_unit: v })} /></${Campo}></div>`}` : null}
    ${i.tipo === "peca" ? html`
      <div class="grade">
        <${Campo} id="it-cod" rotulo="Código / referência"><${Texto} id="it-cod" valor=${i.codigo} onMuda=${v => set({ codigo: v })} /></${Campo}>
        <${Campo} id="it-qtd" rotulo="Quantidade"><input id="it-qtd" class="inp" inputmode="decimal" value=${String(i.qtd).replace(".", ",")} onInput=${e => set({ qtd: Number(e.target.value.replace(",", ".")) || 0 })} /></${Campo}>
      </div>
      <label class="linha-check"><input type="checkbox" id="it-cli" checked=${i.fornecida_cliente} onChange=${e => set({ fornecida_cliente: e.target.checked, valor_unit: e.target.checked ? 0 : i.valor_unit, custo_unit: e.target.checked ? 0 : i.custo_unit })} />
        <span>Peça fornecida pelo cliente (a oficina garante só a mão de obra de instalação)</span></label>
      ${!i.fornecida_cliente ? html`
        <div class="campo"><label>Procedência</label><${Seg} rotulo="Procedência" opcoes=${Object.entries(QUALIDADE).map(([k, t]) => [t, k === "usada" ? "warn" : "info"])} valor=${QUALIDADE[i.qualidade]}
          onEscolha=${t => set({ qualidade: Object.keys(QUALIDADE).find(k => QUALIDADE[k] === t) })} />
          ${i.qualidade === "usada" ? html`<span class="dica erro">Peça usada exige autorização expressa do cliente (CDC, art. 21). Ela aparece identificada no orçamento.</span>` : null}</div>
        <div class="grade">
          <${Campo} id="it-custo" rotulo="Custo unitário (interno)"><${Dinheiro} id="it-custo" valor=${i.custo_unit} onMuda=${v => set({ custo_unit: v, valor_unit: !i.valor_unit || i.valor_unit === sugestaoVenda(i.custo_unit) ? sugestaoVenda(v) : i.valor_unit })} /></${Campo}>
          <${Campo} id="it-venda" rotulo="Preço de venda unitário" dica=${"Sugestão com margem de " + (cfg.markupPecas || 0) + "%: " + reais(sugestaoVenda(i.custo_unit))}><${Dinheiro} id="it-venda" valor=${i.valor_unit} onMuda=${v => set({ valor_unit: v })} /></${Campo}>
        </div>` : null}` : null}
    ${i.tipo === "terceiro" ? html`
      <div class="grade">
        <${Campo} id="it-forn" rotulo="Fornecedor"><${Texto} id="it-forn" placeholder="ex.: retífica, torno" valor=${i.fornecedor} onMuda=${v => set({ fornecedor: v })} /></${Campo}>
        <${Campo} id="it-qtd" rotulo="Quantidade"><input id="it-qtd" class="inp" inputmode="decimal" value=${String(i.qtd).replace(".", ",")} onInput=${e => set({ qtd: Number(e.target.value.replace(",", ".")) || 0 })} /></${Campo}>
        <${Campo} id="it-custo" rotulo="Custo (interno)"><${Dinheiro} id="it-custo" valor=${i.custo_unit} onMuda=${v => set({ custo_unit: v })} /></${Campo}>
        <${Campo} id="it-venda" rotulo="Valor cobrado"><${Dinheiro} id="it-venda" valor=${i.valor_unit} onMuda=${v => set({ valor_unit: v })} /></${Campo}>
      </div>` : null}
    <div class="total-item"><span>Total do item</span><b>${reais((Number(i.qtd) || 0) * (Number(i.valor_unit) || 0))}</b></div>
    ${erro ? html`<span class="dica erro">${erro}</span>` : null}
    <div class="acoes">${!item._novo ? html`<button type="button" class="btn btn-perigo" onClick=${onExcluir}>Remover</button>` : null}<span class="espaco"></span>
      <button type="button" class="btn" onClick=${onFechar}>Cancelar</button><button type="button" class="btn btn-pri" disabled=${!!erro} onClick=${() => onSalvar(i)}>Salvar item</button></div>
  </${Modal}>`;
}

function ItemLinha({ i, verValores, onClick, mostrarAprov }) {
  const sub = [];
  if (i.tipo === "servico") sub.push(i.horas ? qtdFmt(i.horas) + " h" + (verValores ? " × " + reais(i.valor_unit) : "") : qtdFmt(i.qtd) + (verValores ? " × " + reais(i.valor_unit) : " un"));
  if (i.tipo === "peca") { if (i.codigo) sub.push(i.codigo); sub.push(i.fornecida_cliente ? "peça do cliente" : (QUALIDADE[i.qualidade] || "procedência não informada")); sub.push(qtdFmt(i.qtd) + " un"); }
  if (i.tipo === "terceiro") { if (i.fornecedor) sub.push(i.fornecedor); }
  if (verValores && (i.tipo !== "servico") && Number(i.custo_unit) > 0) sub.push("custo " + reais(i.custo_unit * i.qtd));
  const ap = i.aprovado === true ? html`<span class="pill p-ok">Aprovado</span>` : i.aprovado === false ? html`<span class="pill p-bad">Não aprovado</span>` : mostrarAprov ? html`<span class="pill p-warn">Aguardando</span>` : null;
  return html`<button type="button" class=${"linha item-os" + (i.aprovado === false ? " recusado" : "")} onClick=${onClick} disabled=${!onClick}>
    <span class="meio"><strong>${i.descricao}${i.adicional ? html` <em class="tag">adicional</em>` : null}</strong><span>${sub.join(" · ")}</span></span>
    <span class="dir">${verValores ? html`<b>${i.fornecida_cliente ? "—" : reais((Number(i.qtd) || 0) * (Number(i.valor_unit) || 0))}</b>` : null}${ap}</span></button>`;
}

/* ---------------- Aprovação ---------------- */
function AprovacaoModal({ o, pendentes, onFechar, onConfirmar }) {
  const [sel, setSel] = useState(() => Object.fromEntries(pendentes.map(i => [i.id, true])));
  const [por, setPor] = useState((o.cliente || {}).nome || "");
  const [forma, setForma] = useState("Presencial (assinatura)");
  const [obs, setObs] = useState("");
  const assin = useRef(null);
  const escolhidos = pendentes.filter(i => sel[i.id]);
  const t = totais(escolhidos, 0);
  return html`<${Modal} titulo="Registrar aprovação do cliente" onFechar=${onFechar}>
    <span class="dica">Desmarque os itens que o cliente não aprovou.</span>
    <div class="lista">${pendentes.map(i => html`<label class="linha linha-check" key=${i.id}><input type="checkbox" checked=${!!sel[i.id]} onChange=${e => setSel(s => ({ ...s, [i.id]: e.target.checked }))} />
      <span class="meio"><strong>${i.descricao}</strong><span>${{ servico: "Mão de obra", peca: "Peça", terceiro: "Terceiro" }[i.tipo]}</span></span><b>${i.fornecida_cliente ? "—" : reais(i.qtd * i.valor_unit)}</b></label>`)}</div>
    <div class="total-item"><span>Aprovado agora</span><b>${reais(t.total)}</b></div>
    <${Campo} id="ap-por" rotulo="Aprovado por" obrig><${Texto} id="ap-por" valor=${por} onMuda=${setPor} /></${Campo}>
    <div class="campo"><label>Forma de aprovação</label><${Seg} rotulo="Forma" opcoes=${["Presencial (assinatura)", "WhatsApp", "Telefone", "E-mail"].map(x => [x, "info"])} valor=${forma} onEscolha=${setForma} /></div>
    ${forma === "WhatsApp" ? html`<span class="dica">Guarde a conversa: a mensagem do cliente é o registro da aprovação.</span>` : null}
    ${forma === "Presencial (assinatura)" ? html`<${PadAssinatura} apiRef=${assin} altura=${150} />` : null}
    <${Campo} id="ap-obs" rotulo="Observação"><${Texto} id="ap-obs" valor=${obs} onMuda=${setObs} /></${Campo}>
    <div class="acoes"><span class="espaco"></span><button type="button" class="btn" onClick=${onFechar}>Cancelar</button>
      <button type="button" class="btn btn-pri" disabled=${!por.trim()} onClick=${() => onConfirmar({ sel, por: por.trim(), forma, obs, assin: assin.current })}>Confirmar</button></div>
  </${Modal}>`;
}

/* ---------------- Entrega ---------------- */
function EntregaModal({ o, cfg, onFechar, onConfirmar }) {
  const [km, setKm] = useState(String(o.km_entrada || ""));
  const [forma, setForma] = useState(o.forma_pagamento || "");
  const [garantia, setGarantia] = useState(String(o.garantia_dias || cfg.garantiaDias || 90));
  const [erro, setErro] = useState("");
  const assin = useRef(null);
  const recusado = o.status === "recusado";
  const confirmar = () => {
    const k = parseInt(soDig(km), 10);
    if (!(k >= (o.km_entrada || 0))) return setErro("O KM de saída não pode ser menor que o de entrada (" + fmtKm(o.km_entrada) + ").");
    if (o.total > 0 && !forma) return setErro("Informe a forma de pagamento.");
    onConfirmar({ km: k, forma, garantia: parseInt(garantia, 10) || 0, assin: assin.current });
  };
  return html`<${Modal} titulo=${recusado ? "Registrar retirada" : "Registrar entrega"} onFechar=${onFechar}>
    <div class="total-item"><span>Valor a receber</span><b>${reais(o.total)}</b></div>
    <${Campo} id="ent-km" rotulo="KM de saída" obrig><input id="ent-km" class="inp" inputmode="numeric" value=${km ? Number(soDig(km)).toLocaleString("pt-BR") : ""} onInput=${e => { setKm(soDig(e.target.value).slice(0, 7)); setErro(""); }} /></${Campo}>
    ${o.total > 0 ? html`<div class="campo"><label>Forma de pagamento <i>*</i></label><${Seg} rotulo="Pagamento" opcoes=${(cfg.formasPagamento || []).map(x => [x, "info"])} valor=${forma} onEscolha=${v => { setForma(v); setErro(""); }} /></div>` : null}
    ${!recusado ? html`<${Campo} id="ent-gar" rotulo="Garantia (dias)" dica="Mínimo legal para serviços: 90 dias (CDC, art. 26, II)."><input id="ent-gar" class="inp" inputmode="numeric" value=${garantia} onInput=${e => setGarantia(soDig(e.target.value))} /></${Campo}>` : null}
    <div class="campo"><label>Assinatura do cliente na retirada</label><${PadAssinatura} apiRef=${assin} altura=${150} /></div>
    ${erro ? html`<div class="erros">${erro}</div>` : null}
    <div class="acoes"><span class="espaco"></span><button type="button" class="btn" onClick=${onFechar}>Cancelar</button><button type="button" class="btn btn-pri" onClick=${confirmar}>Confirmar ${recusado ? "retirada" : "entrega"}</button></div>
  </${Modal}>`;
}

/* ---------------- Tela da O.S. ---------------- */
export function Ordem({ id }) {
  const { cfg, perfil, dados, avisar, confirmar, ir, recarregar } = useApp();
  const [o, setO] = useState(null);
  const [erroCarga, setErroCarga] = useState("");
  const [aba, setAba] = useState("");
  const [itens, setItens] = useState([]);
  const [removidos, setRemovidos] = useState([]);
  const [campos, setCampos] = useState({});
  const [sujo, setSujo] = useState(false);
  const [modal, setModal] = useState(null);
  const [ocupado, setOcupado] = useState("");
  const verValores = pode(perfil, "verValores");

  const carregar = async () => {
    try { const r = await api.ordem(id); setO(r); setItens(r.itens); setRemovidos([]); setSujo(false);
      setCampos({ diagnostico: r.diagnostico, previsao_entrega: r.previsao_entrega || "", condicoes_pagamento: r.condicoes_pagamento, desconto: Number(r.desconto) || 0, obs_execucao: r.obs_execucao, mecanico_id: r.mecanico_id || "" });
      setAba(a => a || (["execucao", "pronto"].includes(r.status) && !verValores ? "execucao" : ["execucao", "pronto"].includes(r.status) ? "execucao" : "orcamento"));
    } catch (e) { setErroCarga(e.message); }
  };
  useEffect(() => { setO(null); setAba(""); carregar(); }, [id]);
  if (erroCarga) return html`<div class="pagina"><div class="erros">Não foi possível abrir a O.S.: ${erroCarga}</div><button class="btn" onClick=${() => ir("/ordens")}>Voltar</button></div>`;
  if (!o) return html`<div class="pagina"><div class="carregando">Abrindo O.S.…</div></div>`;

  const st = o.status;
  const editavelOrc = pode(perfil, "orcar") && st === "diagnostico";
  const podeAdicional = pode(perfil, "orcar") && (st === "execucao" || st === "aguardando");
  const pendentes = itens.filter(i => i.aprovado === null || i.aprovado === undefined);
  const aprovadoAlgum = itens.some(i => i.aprovado === true);
  const tOrc = totais(itens, campos.desconto, false), tAprov = totais(itens, campos.desconto, true);
  const tAtual = ["execucao", "pronto", "entregue", "recusado"].includes(st) ? tAprov : tOrc;
  const setCampo = p => { setCampos(c => ({ ...c, ...p })); setSujo(true); };
  const evento = (tipo, texto) => api.evento(o.id, tipo, texto, perfil.nome).catch(() => {});

  const salvar = async (extra = {}, silencioso) => {
    const aprov = ["execucao", "pronto", "entregue", "recusado"].includes(extra.status || st);
    const t = totais(itens, campos.desconto, aprov);
    await api.salvarItens(o.id, itens.map(({ _novo, ...i }, n) => ({ ...i, posicao: n })), removidos);
    await api.atualizarOrdem(o.id, { diagnostico: campos.diagnostico, previsao_entrega: campos.previsao_entrega || null, condicoes_pagamento: campos.condicoes_pagamento,
      desconto: campos.desconto, obs_execucao: campos.obs_execucao, total: t.total, custo: t.custo, ...extra });
    if (!silencioso) avisar("O.S. salva.");
    await carregar(); recarregar(["ordens"]);
  };
  const acao = async (rotulo, fn) => { setOcupado(rotulo); try { await fn(); } catch (e) { avisar(e.message, true); } finally { setOcupado(""); } };

  const novoItem = tipo => setModal({ tipo: "item", item: { id: uuid(), _novo: true, tipo, descricao: "", codigo: "", fornecedor: "", qtd: 1, valor_unit: tipo === "servico" ? 0 : 0, custo_unit: 0, horas: null, servico_id: null, fornecida_cliente: false, qualidade: tipo === "peca" ? "original" : "", adicional: st !== "diagnostico", aprovado: null, executado: false } });
  const salvarItem = it => { setItens(l => l.some(x => x.id === it.id) ? l.map(x => x.id === it.id ? { ...it, _novo: false } : x) : l.concat([{ ...it, _novo: false }])); setSujo(true); setModal(null); };
  const excluirItem = it => { setItens(l => l.filter(x => x.id !== it.id)); if (!it._novo) setRemovidos(r => r.concat([it.id])); setSujo(true); setModal(null); };

  const enviarOrcamento = () => acao("enviar", async () => {
    const erros = [];
    if (!itens.length) erros.push("inclua pelo menos um item");
    if (!(campos.diagnostico || "").trim()) erros.push("preencha o diagnóstico técnico");
    const semValor = itens.filter(i => !i.fornecida_cliente && !(Number(i.valor_unit) > 0));
    if (semValor.length) erros.push("informe o valor de: " + semValor.map(i => i.descricao).join(", "));
    if (erros.length) throw new Error("Para enviar o orçamento, " + erros.join("; ") + ".");
    const agora = new Date().toISOString();
    await salvar({ status: "aguardando", orcamento_enviado_em: agora, validade_orcamento: somaDias(agora, Number(cfg.validadeDias) || 10) }, true);
    await evento("orcamento", "Orçamento enviado ao cliente.");
    setModal({ tipo: "enviar", qual: "orcamento" });
  });
  const revisarOrcamento = async () => {
    if (!await confirmar({ titulo: "Revisar orçamento", texto: "O orçamento volta para edição. Depois de alterar, envie de novo ao cliente.", botao: "Revisar" })) return;
    acao("revisar", async () => { await salvar({ status: "diagnostico", orcamento_enviado_em: null }, true); await evento("revisao", "Orçamento reaberto para revisão."); });
  };
  const confirmarAprovacao = ({ sel, por, forma, obs, assin }) => acao("aprovar", async () => {
    let assinatura = "";
    if (assin && !assin.vazio()) { const b = await assin.blob(); assinatura = await api.enviarArquivo("assinaturas/" + o.id + "-aprov-" + Date.now() + ".png", b, "image/png"); }
    const novos = itens.map(i => (i.aprovado === null || i.aprovado === undefined) ? { ...i, aprovado: !!sel[i.id] } : i);
    const algum = novos.some(i => i.aprovado === true);
    const t = totais(novos, campos.desconto, true);
    const registro = { em: new Date().toISOString(), por, forma, obs, assinatura };
    await api.salvarItens(o.id, novos.map(({ _novo, ...i }) => i), removidos);
    const status = st === "aguardando" ? (algum ? "execucao" : "recusado") : st;
    await api.atualizarOrdem(o.id, { aprovacao: o.aprovacao ? { ...registro, anteriores: (o.aprovacao.anteriores || []).concat([{ ...o.aprovacao, anteriores: undefined }]) } : registro,
      status, total: t.total, custo: t.custo, diagnostico: campos.diagnostico, previsao_entrega: campos.previsao_entrega || null, condicoes_pagamento: campos.condicoes_pagamento, desconto: campos.desconto });
    const aprovados = novos.filter(i => sel[i.id] && pendentes.some(p => p.id === i.id)).length;
    await evento("aprovacao", `${por} aprovou ${aprovados} de ${pendentes.length} itens (${forma}).` + (status === "recusado" ? " Orçamento recusado." : ""));
    setModal(null); avisar(status === "recusado" ? "Nenhum item aprovado: orçamento marcado como recusado." : "Aprovação registrada."); await carregar(); recarregar(["ordens"]);
  });
  const recusar = async () => {
    const taxa = Number(cfg.taxaDiagnostico) || 0;
    if (!await confirmar({ titulo: "Orçamento recusado", texto: taxa ? `O orçamento será marcado como recusado e a taxa de diagnóstico de ${reais(taxa)} será lançada para a retirada.` : "O orçamento será marcado como recusado. O veículo fica aguardando retirada.", botao: "Marcar como recusado", perigo: true })) return;
    acao("recusar", async () => {
      let novos = itens.map(i => ({ ...i, aprovado: i.aprovado === true ? true : false }));
      if (taxa) novos = novos.concat([{ id: uuid(), tipo: "servico", descricao: "Taxa de diagnóstico", codigo: "", fornecedor: "", qtd: 1, valor_unit: taxa, custo_unit: 0, horas: null, servico_id: null, fornecida_cliente: false, qualidade: "", adicional: true, aprovado: true, executado: true }]);
      const t = totais(novos, 0, true);
      await api.salvarItens(o.id, novos, removidos);
      await api.atualizarOrdem(o.id, { status: "recusado", total: t.total, custo: t.custo, desconto: 0 });
      await evento("recusa", "Orçamento recusado pelo cliente." + (taxa ? " Taxa de diagnóstico lançada." : ""));
      await carregar(); recarregar(["ordens"]);
    });
  };
  const marcarExecutado = (it, v) => acao("exec", async () => {
    const novos = itens.map(i => i.id === it.id ? { ...i, executado: v } : i); setItens(novos);
    await api.salvarItens(o.id, [{ ...novos.find(i => i.id === it.id) }].map(({ _novo, ...i }) => i), []);
  });
  const salvarMecanico = mid => acao("mec", async () => {
    const m = dados.perfis.find(p => p.id === mid);
    await api.atualizarOrdem(o.id, { mecanico_id: mid || null, mecanico_nome: m ? m.nome : "" }); await evento("mecanico", "Mecânico responsável: " + (m ? m.nome : "nenhum") + ".");
    setO(x => ({ ...x, mecanico_id: mid || null, mecanico_nome: m ? m.nome : "" })); recarregar(["ordens"]);
  });
  const marcarPronto = async () => {
    const falta = itens.filter(i => i.aprovado === true && !i.executado);
    if (pendentes.length) return avisar("Há itens adicionais aguardando aprovação do cliente. Registre a decisão antes de concluir.", true);
    if (falta.length && !await confirmar({ titulo: "Itens não marcados", texto: falta.length + " item(ns) aprovado(s) não foram marcados como executados: " + falta.map(i => i.descricao).join(", ") + ". Concluir mesmo assim?", botao: "Concluir" })) return;
    acao("pronto", async () => { await salvar({ status: "pronto" }, true); await evento("pronto", "Serviço concluído. Veículo pronto para retirada."); setModal({ tipo: "enviar", qual: "pronto" }); });
  };
  const confirmarEntrega = ({ km, forma, garantia, assin }) => acao("entregar", async () => {
    let assinatura = "";
    if (assin && !assin.vazio()) { const b = await assin.blob(); assinatura = await api.enviarArquivo("assinaturas/" + o.id + "-entrega.png", b, "image/png"); }
    const t = totais(itens, campos.desconto, true);
    await api.atualizarOrdem(o.id, { status: st === "recusado" ? "recusado" : "entregue", km_saida: km, entregue_em: new Date().toISOString(), forma_pagamento: forma, garantia_dias: garantia, assinatura_entrega: assinatura, total: t.total, custo: t.custo });
    const v = dados.veiculos.find(x => x.id === o.veiculo_id);
    if (v && km > (v.km_atual || 0)) await api.veiculos.salvar({ id: v.id, km_atual: km });
    await evento("entrega", (st === "recusado" ? "Veículo retirado sem execução, com " : "Veículo entregue com ") + fmtKm(km) + (forma ? ". Pagamento: " + forma : "") + ".");
    setModal(null); await carregar(); recarregar(["ordens", "veiculos"]);
    setModal({ tipo: "enviar", qual: st === "recusado" ? null : "entrega" });
  });
  const cancelar = async () => {
    if (!await confirmar({ titulo: "Cancelar " + numOS(o.numero), texto: "A O.S. fica registrada como cancelada no histórico.", botao: "Cancelar O.S.", perigo: true })) return;
    acao("cancelar", async () => { await api.atualizarOrdem(o.id, { status: "cancelado" }); await evento("cancelamento", "O.S. cancelada."); await carregar(); recarregar(["ordens"]); });
  };
  const excluir = async () => {
    if (!await confirmar({ titulo: "Excluir " + numOS(o.numero), texto: "Remove a O.S., os itens, as fotos e o histórico definitivamente. Prefira cancelar: o histórico protege a oficina.", botao: "Excluir definitivamente", perigo: true })) return;
    acao("excluir", async () => { await api.removerArquivos((o.fotos || []).map(f => f.caminho).concat([o.assinatura_entrada, o.assinatura_entrega].filter(Boolean))); await api.excluirOrdem(o.id); await recarregar(["ordens"]); ir("/ordens"); });
  };
  const enviarFotoExec = arq => acao("foto", async () => {
    const { blob, w, h } = await reduzirImagem(arq, 1280, "image/jpeg", 0.72);
    const caminho = await api.enviarArquivo("os/" + o.id + "/" + uuid() + ".jpg", blob, "image/jpeg");
    await api.incluirFotos([{ ordem_id: o.id, caminho, rotulo: "Execução " + ((o.fotos || []).filter(f => f.etapa !== "entrada").length + 1), etapa: "execucao", largura: w, altura: h }]);
    const r = await api.ordem(o.id); setO(x => ({ ...x, fotos: r.fotos, eventos: r.eventos }));
  });
  const documento = qual => acao("pdf-" + qual, async () => {
    if (sujo) await salvar({}, true);
    const atual = await api.ordem(o.id);
    const gerar = { entrada: pdfEntrada, orcamento: pdfOrcamento, os: pdfOS }[qual];
    const nomes = { entrada: "Checklist", orcamento: "Orcamento", os: "OS" };
    const blob = await gerar(atual, cfg);
    await entregarArquivo(blob, `${nomes[qual]}_${String(o.numero).padStart(5, "0")}_${o.veiculo.placa}.pdf`);
  });
  const whats = qual => {
    const fn = MSG[qual]; if (!fn) return;
    const lista = qual === "adicionais" ? pendentes : itens.filter(i => i.aprovado !== false);
    window.open(linkWhats(o.cliente.telefone, fn({ ...o, ...campos, total: tAtual.total }, cfg, lista)), "_blank", "noopener");
    evento("whatsapp", "Mensagem de WhatsApp aberta: " + qual + ".");
  };

  // ---- barra de ações por etapa
  const B = (rot, fn, pri, dis) => html`<button type="button" class=${"btn" + (pri ? " btn-pri" : "")} disabled=${!!ocupado || dis} onClick=${fn}>${rot}</button>`;
  let acoes = [];
  if (st === "diagnostico" && pode(perfil, "orcar")) acoes = [B(ocupado === "enviar" ? "Enviando…" : "Enviar orçamento ao cliente", enviarOrcamento, true), sujo ? B("Salvar", () => acao("salvar", () => salvar())) : null];
  if (st === "aguardando" && pode(perfil, "aprovar")) acoes = [B("Registrar aprovação", () => setModal({ tipo: "aprovar" }), true), B("Reenviar WhatsApp", () => whats("orcamento")), B("Revisar orçamento", revisarOrcamento), B("Cliente recusou", recusar)];
  if (st === "execucao" && pode(perfil, "executar")) acoes = [B("Concluir serviço", marcarPronto, true), pendentes.length && pode(perfil, "aprovar") ? B("Aprovar adicionais", () => setModal({ tipo: "aprovar" })) : null, pendentes.length && pode(perfil, "aprovar") ? B("WhatsApp adicionais", () => whats("adicionais")) : null, sujo ? B("Salvar", () => acao("salvar", () => salvar())) : null];
  if (st === "pronto" && pode(perfil, "entregar")) acoes = [B("Registrar entrega", () => setModal({ tipo: "entrega" }), true), B("Avisar cliente", () => whats("pronto"))];
  if (st === "recusado" && pode(perfil, "entregar") && !o.entregue_em) acoes = [B("Registrar retirada", () => setModal({ tipo: "entrega" }), true)];
  if (st === "entregue" && pode(perfil, "entregar")) acoes = [B("O.S. em PDF", () => documento("os"), true), B("WhatsApp de garantia", () => whats("entrega"))];
  acoes = acoes.filter(Boolean);

  const passo = FLUXO.indexOf(st);
  const grupo = (tipo, titulo) => {
    const g = itens.filter(i => i.tipo === tipo);
    const podeEditar = editavelOrc || podeAdicional;
    if (!g.length && !podeEditar) return null;
    return html`<div class="grupo-itens"><div class="secao-topo"><h4>${titulo}</h4>${podeEditar ? html`<button type="button" class="btn btn-sm" onClick=${() => novoItem(tipo)}>+ Adicionar</button>` : null}</div>
      ${g.length ? html`<div class="lista">${g.map(i => html`<${ItemLinha} key=${i.id} i=${i} verValores=${verValores} mostrarAprov=${st !== "diagnostico"}
        onClick=${(editavelOrc || (podeAdicional && (i.aprovado === null || i.aprovado === undefined))) ? () => setModal({ tipo: "item", item: i }) : null} />`)}</div>` : html`<span class="dica">Nenhum item.</span>`}</div>`;
  };

  const abaOrc = html`
    <section class="card"><h3>Diagnóstico técnico</h3>
      ${editavelOrc ? html`<${Area} id="diag" placeholder="O que foi constatado, testes feitos, causa provável e solução proposta." valor=${campos.diagnostico} onMuda=${v => setCampo({ diagnostico: v })} />`
        : html`<p class="texto-pre">${o.diagnostico || "—"}</p>`}</section>
    <section class="card"><div class="secao-topo"><h3>Itens do orçamento</h3>${st === "aguardando" ? html`<span class="sub">Enviado em ${fmtDataHora(o.orcamento_enviado_em)} · válido até ${fmtData(o.validade_orcamento)}</span>` : null}</div>
      ${grupo("servico", "Mão de obra")}${grupo("peca", "Peças")}${grupo("terceiro", "Serviços de terceiros")}
      ${verValores ? html`<div class="totais">
        <div><span>Mão de obra</span><b>${reais(tAtual.servicos)}</b></div><div><span>Peças</span><b>${reais(tAtual.pecas)}</b></div>
        ${tAtual.terceiros ? html`<div><span>Terceiros</span><b>${reais(tAtual.terceiros)}</b></div>` : null}
        <div><span>Desconto</span>${editavelOrc ? html`<${Dinheiro} id="desc" valor=${campos.desconto} onMuda=${v => setCampo({ desconto: v })} />` : html`<b>${reais(tAtual.desconto)}</b>`}</div>
        <div class="tot"><span>Total${["execucao", "pronto", "entregue", "recusado"].includes(st) ? " aprovado" : ""}</span><b>${reais(tAtual.total)}</b></div>
        <div class="interno"><span>Custo de peças e terceiros</span><b>${reais(tAtual.custo)}</b></div>
        <div class="interno"><span>Margem bruta</span><b class=${tAtual.margemPct < 30 && tAtual.total > 0 ? "c-warn" : ""}>${reais(tAtual.margem)} · ${tAtual.margemPct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</b></div>
      </div>` : null}</section>
    ${verValores ? html`<section class="card"><h3>Prazo e pagamento</h3>
      <div class="grade">
        <${Campo} id="prev" rotulo="Previsão de entrega">${editavelOrc ? html`<input id="prev" type="date" class="inp" min=${hojeISO()} value=${campos.previsao_entrega || ""} onInput=${e => setCampo({ previsao_entrega: e.target.value })} />` : html`<b>${o.previsao_entrega ? fmtData(o.previsao_entrega) : "A combinar"}</b>`}</${Campo}>
        <${Campo} id="cond" rotulo="Condições de pagamento">${editavelOrc ? html`<${Texto} id="cond" valor=${campos.condicoes_pagamento} onMuda=${v => setCampo({ condicoes_pagamento: v })} />` : html`<b>${o.condicoes_pagamento || "—"}</b>`}</${Campo}>
      </div></section>` : null}
    ${o.aprovacao ? html`<section class="card"><h3>Aprovação</h3><div class="kv"><div><span>Aprovado por</span><b>${o.aprovacao.por}</b></div><div><span>Quando</span><b>${fmtDataHora(o.aprovacao.em)}</b></div><div><span>Forma</span><b>${o.aprovacao.forma}</b></div>${o.aprovacao.obs ? html`<div><span>Obs.</span><b>${o.aprovacao.obs}</b></div>` : null}</div>
      ${o.aprovacao.assinatura ? html`<${Foto} caminho=${o.aprovacao.assinatura} alt="Assinatura" class="img-assin" />` : null}</section>` : null}`;

  const execucaoVisivel = ["execucao", "pronto", "entregue"].includes(st);
  const mecanicos = dados.perfis.filter(p => p.ativo !== false && ["mecanico", "admin", "consultor"].includes(p.papel));
  const abaExec = html`
    ${!execucaoVisivel ? html`<div class="info">A execução começa depois que o cliente aprovar o orçamento.</div>` : null}
    ${execucaoVisivel ? html`<section class="card"><h3>Responsável pela execução</h3>
      <select id="mec" class="inp" disabled=${st !== "execucao"} value=${o.mecanico_id || ""} onChange=${e => salvarMecanico(e.target.value)}>
        <option value="">Selecione o mecânico</option>${mecanicos.map(m => html`<option key=${m.id} value=${m.id}>${m.nome}</option>`)}</select></section>
    <section class="card"><div class="secao-topo"><h3>Serviços aprovados</h3><span class="sub">${itens.filter(i => i.aprovado === true && i.executado).length} de ${itens.filter(i => i.aprovado === true).length} concluídos</span></div>
      <div class="lista">${itens.filter(i => i.aprovado === true).map(i => html`<label class="linha linha-check" key=${i.id}><input type="checkbox" disabled=${st !== "execucao" || !pode(perfil, "executar")} checked=${i.executado} onChange=${e => marcarExecutado(i, e.target.checked)} />
        <span class="meio"><strong>${i.descricao}</strong><span>${{ servico: "Mão de obra", peca: "Peça", terceiro: "Terceiro" }[i.tipo]}${i.tipo === "peca" ? " · " + qtdFmt(i.qtd) + " un" + (i.codigo ? " · " + i.codigo : "") : ""}${i.fornecida_cliente ? " · peça do cliente" : ""}</span></span></label>`)}</div>
      ${pendentes.length ? html`<div class="aviso">${pendentes.length} item(ns) adicional(is) aguardando aprovação do cliente. Não execute antes da aprovação.</div>` : null}
      ${st === "execucao" && !pode(perfil, "orcar") ? html`<span class="dica">Encontrou algo a mais? Registre nas observações e avise o consultor para orçar como adicional.</span>` : null}
    </section>
    <section class="card"><h3>Observações da execução</h3>
      ${st === "execucao" ? html`<${Area} id="obs-exec" placeholder="Peças trocadas, medições, recomendações ao cliente para as próximas revisões." valor=${campos.obs_execucao} onMuda=${v => setCampo({ obs_execucao: v })} />
        ${sujo ? html`<button type="button" class="btn" onClick=${() => acao("salvar", () => salvar())}>Salvar observações</button>` : null}` : html`<p class="texto-pre">${o.obs_execucao || "—"}</p>`}</section>
    <section class="card"><div class="secao-topo"><h3>Fotos do serviço</h3>
      ${st === "execucao" ? html`<label class="btn btn-sm" for="foto-exec">${ocupado === "foto" ? "Enviando…" : "+ Foto"}</label><input id="foto-exec" class="vh" type="file" accept="image/*" capture="environment" onChange=${e => { const a = e.target.files[0]; e.target.value = ""; if (a) enviarFotoExec(a); }} />` : null}</div>
      ${(o.fotos || []).filter(f => f.etapa !== "entrada").length ? html`<div class="fotos">${o.fotos.filter(f => f.etapa !== "entrada").map(f => html`<button type="button" class="foto" key=${f.id} onClick=${() => setModal({ tipo: "foto", f })}><div class="img"><${Foto} caminho=${f.caminho} alt=${f.rotulo} /></div><div class="rot">${f.rotulo}</div></button>`)}</div>`
        : html`<span class="dica">Fotos de peças substituídas e do serviço feito ajudam a justificar o orçamento e a garantia.</span>`}</section>` : null}
    ${st === "entregue" ? html`<section class="card"><h3>Entrega</h3><div class="kv"><div><span>Entregue em</span><b>${fmtDataHora(o.entregue_em)}</b></div><div><span>KM saída</span><b>${fmtKm(o.km_saida)}</b></div>
      <div><span>Pagamento</span><b>${o.forma_pagamento || "—"}</b></div><div><span>Garantia</span><b>${o.garantia_dias} dias · até ${fmtData(somaDias(o.entregue_em, o.garantia_dias))}</b></div></div>
      ${o.assinatura_entrega ? html`<${Foto} caminho=${o.assinatura_entrega} alt="Assinatura na retirada" class="img-assin" />` : null}</section>` : null}`;

  const ck = o.checkin || {}, secs = secoesCheckin(ck.itensExtras), ach = achados(ck.resp, secs);
  const podeCk = pode(perfil, "entrada") && !["entregue", "cancelado", "recusado"].includes(st);
  const abaEntrada = !ck.feito ? html`
    <section class="card ck-vazio"><h3>Checklist de entrada</h3>
      <p>O checklist não foi feito nesta O.S. Ele é opcional e registra combustível, avarias, pneus, acessórios, fotos e a assinatura do cliente, protegendo a oficina em caso de reclamação.</p>
      <div class="kv"><div><span>Entrada</span><b>${fmtDataHora(o.criado_em)}</b></div><div><span>KM</span><b>${fmtKm(o.km_entrada)}${ck.kmDivergente ? " ⚠" : ""}</b></div><div><span>Consultor</span><b>${o.consultor_nome || "—"}</b></div></div>
      ${ck.kmDivergente ? html`<div class="aviso">KM menor que o registro anterior (${fmtKm(ck.kmAnterior)}). Divergência confirmada na abertura.</div>` : null}
      ${podeCk ? html`<button type="button" class="btn btn-pri" onClick=${() => ir("/os/" + o.id + "/checklist")}>Fazer checklist de entrada</button>` : null}
    </section>` : html`
    <section class="card"><div class="secao-topo"><h3>Checklist de entrada</h3>${podeCk ? html`<button type="button" class="btn btn-sm" onClick=${() => ir("/os/" + o.id + "/checklist")}>Editar checklist</button>` : null}</div>
      <span class="sub">Feito em ${fmtDataHora(ck.em)}${ck.por ? " por " + ck.por : ""}</span>
      <div class="kv">
      <div><span>KM</span><b>${fmtKm(o.km_entrada)}${ck.kmDivergente ? " ⚠" : ""}</b></div>
      <div><span>Combustível</span><b>${o.combustivel}</b></div><div><span>Funcionando</span><b>${o.funcionando}</b></div>
      <div><span>Objetos declarados</span><b>${ck.objetosValor || "Nenhum"}</b></div></div>
      ${ck.kmDivergente ? html`<div class="aviso">KM menor que o registro anterior (${fmtKm(ck.kmAnterior)}). Divergência confirmada na abertura.</div>` : null}
      ${ck.observacoes ? html`<p class="texto-pre">${ck.observacoes}</p>` : null}</section>
    ${ach.length ? html`<section class="card"><h3>Observado na entrada</h3><ul class="res-lista">${ach.map((a, n) => html`<li key=${n}><span class=${"dot s-" + a.s}></span><span><b>${a.l}</b>: ${a.v}${a.obs ? " (" + a.obs + ")" : ""}</span></li>`)}</ul></section>` : null}
    ${(o.fotos || []).some(f => f.etapa === "entrada") ? html`<section class="card"><h3>Fotos da entrada</h3><div class="fotos">${o.fotos.filter(f => f.etapa === "entrada").map(f => html`<button type="button" class="foto" key=${f.id} onClick=${() => setModal({ tipo: "foto", f })}><div class="img"><${Foto} caminho=${f.caminho} alt=${f.rotulo} /></div><div class="rot">${f.rotulo}</div></button>`)}</div></section>` : null}
    ${secs.map(s => html`<details class="card" key=${s.id}><summary><h3>${s.titulo}</h3></summary><table class="tab-res"><tbody>${s.itens.map(it => { const r = (ck.resp || {})[it.k] || {}; return html`<tr key=${it.k}><td>${it.l}${r.obs ? html`<small>${r.obs}</small>` : null}</td><td class=${"c-" + (r.s || "na")}>${r.v || "—"}</td></tr>`; })}</tbody></table></details>`)}
    <section class="card"><h3>Assinatura na entrada</h3>${o.assinatura_entrada ? html`<${Foto} caminho=${o.assinatura_entrada} alt="Assinatura" class="img-assin" /><span class="sub">${o.assinante_entrada}</span>` : html`<span class="sub">Sem assinatura digital.</span>`}</section>`;
  const legado = ck.legado;

  const abaHist = html`<section class="card"><h3>Histórico da O.S.</h3>
    ${(o.eventos || []).length ? html`<ol class="linha-tempo">${o.eventos.map(e => html`<li key=${e.id}><b>${fmtDataHora(e.criado_em)}</b> · ${e.usuario_nome || "—"}<div>${e.texto}</div></li>`)}</ol>` : html`<span class="sub">Sem eventos.</span>`}</section>
    ${pode(perfil, "orcar") && !["entregue", "cancelado"].includes(st) ? html`<button type="button" class="btn btn-perigo" onClick=${cancelar}>Cancelar O.S.</button>` : null}
    ${pode(perfil, "excluir") ? html`<button type="button" class="btn-link perigo" onClick=${excluir}>Excluir O.S. definitivamente</button>` : null}`;

  const abas = [["orcamento", "Orçamento"], ["execucao", "Execução"], ["entrada", ck.feito ? "Checklist ✓" : "Checklist"], ["historico", "Histórico"]];
  return html`<div class="pagina">
    <button type="button" class="btn-link voltar" onClick=${() => history.length > 1 ? history.back() : ir("/ordens")}>← Voltar</button>
    <section class="card cab-os">
      <div class="det-cab"><button type="button" class="botao-limpo" title="Ficha do veículo" disabled=${!o.veiculo_id} onClick=${() => ir("/veiculo/" + o.veiculo_id)}><${Placa} placa=${o.veiculo.placa} grande /></button><div class="meio"><h2>${o.veiculo.marca} ${o.veiculo.modelo} ${o.veiculo.ano}</h2>
        <div class="sub">${numOS(o.numero)} · entrada ${fmtDataHora(o.criado_em)} · há ${tempoDesde(o.criado_em)}</div></div><${Status} s=${st} /></div>
      <div class="cli-linha"><div>${o.cliente_id ? html`<button type="button" class="btn-link nome-cli" onClick=${() => ir("/cliente/" + o.cliente_id)}>${o.cliente.nome}</button>` : html`<b>${o.cliente.nome}</b>`}<span>${fmtTel(o.cliente.telefone)}${o.cliente.doc ? " · " + fmtDoc(o.cliente.doc) : ""}</span></div>
        ${o.cliente.telefone ? html`<a class="btn btn-sm btn-whats" href=${linkWhats(o.cliente.telefone, "Olá, " + primeiroNome(o) + "! ")} target="_blank" rel="noopener">${I.whats} WhatsApp</a>` : null}</div>
      ${o.reclamacao ? html`<div class="reclamacao"><span>Reclamação</span>${o.reclamacao}</div>` : null}
      ${legado ? html`<div class="info">O.S. ${legado.numero} importada do OS Oficina 3.0${legado.situacao ? " · situação no sistema anterior: " + legado.situacao : ""}.</div>` : null}
      ${!ck.feito && !legado && podeCk ? html`<div class="aviso ck-aviso"><span>Checklist de entrada não realizado.</span><button type="button" class="btn btn-sm" onClick=${() => ir("/os/" + o.id + "/checklist")}>Fazer agora</button></div>` : null}
      ${passo >= 0 ? html`<ol class="trilha">${FLUXO.map((s, n) => html`<li key=${s} class=${n < passo ? "feito" : n === passo ? "atual" : ""}>${STATUS[s].curto}</li>`)}</ol>` : html`<div class=${st === "recusado" ? "aviso" : "info"}>${STATUS[st].t}${st === "recusado" && o.entregue_em ? " · veículo retirado em " + fmtDataHora(o.entregue_em) : ""}</div>`}
      ${acoes.length ? html`<div class="acoes">${acoes}</div>` : null}
      <div class="docs"><span class="sub">Documentos:</span>
        ${ck.feito ? html`<button type="button" class="btn-link" disabled=${!!ocupado} onClick=${() => documento("entrada")}>${ocupado === "pdf-entrada" ? "Gerando…" : "Checklist de entrada"}</button>` : null}
        ${verValores && itens.length ? html`<button type="button" class="btn-link" disabled=${!!ocupado} onClick=${() => documento("orcamento")}>${ocupado === "pdf-orcamento" ? "Gerando…" : "Orçamento"}</button>` : null}
        ${verValores && aprovadoAlgum ? html`<button type="button" class="btn-link" disabled=${!!ocupado} onClick=${() => documento("os")}>${ocupado === "pdf-os" ? "Gerando…" : "Ordem de serviço"}</button>` : null}
        ${st === "diagnostico" && o.cliente.telefone ? html`<button type="button" class="btn-link" onClick=${() => whats("entrada")}>Avisar recebimento</button>` : null}
      </div>
    </section>
    <${Abas} abas=${abas} ativa=${aba} onTroca=${setAba} />
    ${aba === "orcamento" ? abaOrc : aba === "execucao" ? abaExec : aba === "entrada" ? abaEntrada : abaHist}
    ${sujo && (editavelOrc || st === "execucao") ? html`<div class="rodape-acoes"><div class="in"><button type="button" class="btn" onClick=${carregar}>Descartar alterações</button><button type="button" class="btn btn-pri" disabled=${!!ocupado} onClick=${() => acao("salvar", () => salvar())}>${ocupado === "salvar" ? "Salvando…" : "Salvar O.S."}</button></div></div>` : null}

    ${modal && modal.tipo === "item" ? html`<${ItemModal} item=${modal.item} onFechar=${() => setModal(null)} onSalvar=${salvarItem} onExcluir=${() => excluirItem(modal.item)} />` : null}
    ${modal && modal.tipo === "aprovar" ? html`<${AprovacaoModal} o=${o} pendentes=${pendentes} onFechar=${() => setModal(null)} onConfirmar=${confirmarAprovacao} />` : null}
    ${modal && modal.tipo === "entrega" ? html`<${EntregaModal} o=${{ ...o, total: tAprov.total }} cfg=${cfg} onFechar=${() => setModal(null)} onConfirmar=${confirmarEntrega} />` : null}
    ${modal && modal.tipo === "foto" ? html`<div class="visor" onClick=${() => setModal(null)} role="dialog" aria-label="Foto ampliada"><${Foto} caminho=${modal.f.caminho} alt=${modal.f.rotulo} /><p>${modal.f.rotulo} · toque para fechar</p></div>` : null}
    ${modal && modal.tipo === "enviar" && modal.qual ? html`<${Modal} titulo=${{ orcamento: "Orçamento pronto para envio", pronto: "Serviço concluído", entrega: "Entrega registrada" }[modal.qual]} onFechar=${() => setModal(null)}>
      <p>${{ orcamento: "Envie a mensagem com o resumo e, em seguida, o PDF do orçamento.", pronto: "Avise o cliente que o veículo está pronto para retirada.", entrega: "Envie a ordem de serviço com a garantia para o cliente." }[modal.qual]}</p>
      <div class="acoes col">
        ${o.cliente.telefone ? html`<button type="button" class="btn btn-whats" onClick=${() => whats(modal.qual)}>${I.whats} Abrir WhatsApp com a mensagem</button>` : html`<span class="aviso">Cliente sem telefone cadastrado.</span>`}
        ${modal.qual === "orcamento" ? html`<button type="button" class="btn" onClick=${() => documento("orcamento")}>PDF do orçamento</button>` : null}
        ${modal.qual === "entrega" ? html`<button type="button" class="btn" onClick=${() => documento("os")}>PDF da ordem de serviço</button>` : null}
        <button type="button" class="btn-link" onClick=${() => setModal(null)}>Fechar</button></div></${Modal}>` : null}
  </div>`;
}
