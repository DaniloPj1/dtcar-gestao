// Tela da O.S. no modelo do OS Oficina 3.0: Principais informações · Veículo · Produtos e serviços · Observações · Checklist · Histórico
import { html, useState, useEffect, useRef, useMemo } from "../lib.js";
import { api } from "../api.js";
import { useApp, Placa, Status, Campo, Texto, Area, Dinheiro, Seg, Abas, Modal, Foto, PadAssinatura, I, BuscaCliente } from "../ui.js";
import { soDig, norm, uuid, fmtTel, fmtDoc, fmtKm, fmtDataHora, fmtData, reais, qtdFmt, arred, totais, totalItem, precoTabela, precoPelaMargem, margemDoPreco, numOS, numRecibo, somaDias, hojeISO, exPlaca, linkWhats, reduzirImagem, tempoDesde, parseValor, endCompleto } from "../util.js";
import { STATUS, FLUXO, ABERTOS, pode, QUALIDADE, TABELAS_PRECO, SITUACAO_CLIENTE, secoesCheckin, achados } from "../regras.js";
import { pdfEntrada, pdfOrcamento, pdfOS, entregarArquivo } from "../pdf.js";
import { FormVeiculo, edVeiculo, SitCliente } from "./cadastros.js";
import { ReciboModal } from "./recibos.js";
import { BuscaFornecedor } from "./financeiro.js";

/* ---------------- Mensagens de WhatsApp ---------------- */
const nomeVeic = o => [o.veiculo.marca, o.veiculo.modelo].filter(Boolean).join(" ") + " (" + exPlaca(o.veiculo.placa) + ")";
const primeiroNome = o => ((o.cliente || {}).nome || "").split(" ")[0];
function linhasItensMsg(itens) {
  const L = [];
  const grupo = (tipo, titulo) => { const g = itens.filter(i => i.tipo === tipo); if (!g.length) return;
    L.push("*" + titulo + ":*"); g.forEach(i => L.push("• " + i.descricao + (Number(i.qtd) !== 1 && i.tipo === "peca" ? " (" + qtdFmt(i.qtd) + ")" : "") + (i.fornecida_cliente ? " (peça do cliente)" : " — " + reais(totalItem(i))))); L.push(""); };
  grupo("peca", "Peças"); grupo("servico", "Mão de obra"); grupo("terceiro", "Serviços de terceiros");
  return L;
}
export const MSG = {
  entrada: (o, cfg) => `Olá, ${primeiroNome(o)}! Aqui é da ${cfg.nome}.\n\nRecebemos seu ${nomeVeic(o)} em ${fmtDataHora(o.criado_em)}, com ${fmtKm(o.km_entrada)}. Número do atendimento: *${numOS(o.numero)}*.\n\nVamos fazer o diagnóstico e enviar o orçamento para sua aprovação antes de executar qualquer serviço.`,
  orcamento: (o, cfg, itens) => { const t = totais(itens, o.desconto);
    return [`Olá, ${primeiroNome(o)}! O orçamento do seu ${nomeVeic(o)} está pronto (${numOS(o.numero)}).`, "",
      ...(o.diagnostico ? ["*Diagnóstico:* " + o.diagnostico, ""] : []), ...linhasItensMsg(itens),
      ...(t.desconto ? ["Desconto: " + reais(t.desconto)] : []), `*Total: ${reais(t.total)}*`,
      `Previsão de entrega: ${o.previsao_entrega ? fmtData(o.previsao_entrega) + (o.previsao_hora ? " às " + o.previsao_hora : "") : "a combinar"}`, `Válido até ${fmtData(o.validade_orcamento)}.`, "",
      "Para aprovar, responda *APROVADO*. Se preferir aprovar só parte dos itens, é só dizer quais. Envio o orçamento completo em PDF a seguir."].join("\n"); },
  adicionais: (o, cfg, itens) => { const t = totais(itens, 0);
    return [`Olá, ${primeiroNome(o)}! Durante o serviço no seu ${nomeVeic(o)}, na ${numOS(o.numero)}, identificamos itens adicionais:`, "",
      ...linhasItensMsg(itens), `*Valor adicional: ${reais(t.total)}*`, "", "Só executamos com a sua aprovação. Responda *APROVADO* para incluir, ou diga quais itens deseja."].join("\n"); },
  pronto: (o, cfg) => `Olá, ${primeiroNome(o)}! Seu ${nomeVeic(o)} está pronto para retirada (${numOS(o.numero)}).\n\nValor total: *${reais(o.total)}*.\n${cfg.endereco ? "Endereço: " + cfg.endereco + "\n" : ""}\nQualquer dúvida, estamos à disposição.`,
  entrega: (o, cfg) => `Obrigado pela confiança, ${primeiroNome(o)}!\n\nOs serviços da ${numOS(o.numero)} no seu ${nomeVeic(o)} têm garantia de ${o.garantia_dias} dias, até ${fmtData(somaDias(o.entregue_em, o.garantia_dias))}. Guarde a ordem de serviço que enviamos.\n\n${cfg.nome}${cfg.telefone ? " · " + cfg.telefone : ""}`,
};

/* ---------------- Inclusão / edição de item (busca no cadastro de produtos e serviços) ---------------- */
const NOME_TIPO = { servico: "serviço", peca: "produto / peça", terceiro: "serviço de terceiro" };
function ItemModal({ item, tabela, onSalvar, onExcluir, onFechar }) {
  const { cfg, dados, perfil } = useApp();
  const [i, setI] = useState({ desconto: 0, ...item });
  const [busca, setBusca] = useState(""), [erroEst, setErroEst] = useState("");
  // novo item: abre primeiro o catálogo; "Cadastrar só nesta O.S." cria um item que não entra no cadastro geral
  const [etapa, setEtapa] = useState(item._novo ? "catalogo" : "detalhe");
  const fin = pode(perfil, "financeiro");
  const [conta, setConta] = useState(item._conta || null); // { vencimento } para lançar conta a pagar ao prestador
  const qtdOriginal = !item._novo && item.produto_id ? Number(item.qtd) || 0 : 0;
  const set = p => { setI(o => ({ ...o, ...p })); setErroEst(""); };
  const sugestaoVenda = c => arred(c * (1 + (Number(cfg.markupPecas) || 0) / 100));
  const tipoProd = i.tipo === "servico" ? "servico" : i.tipo === "terceiro" ? "terceiro" : "produto";
  const [margTxt, setMargTxt] = useState(null);
  const margemTer = Number(i.custo_unit) > 0 ? margemDoPreco(i.custo_unit, i.valor_unit) : Number(cfg.markupTerceiros) || 0;
  const prod = i.produto_id ? dados.produtos.find(p => p.id === i.produto_id) : null;
  const cat = useMemo(() => { const q = norm(busca), cod = /^\d+$/.test(busca.trim()) ? +busca.trim() : null;
    return dados.produtos.filter(p => p.ativo !== false && p.tipo === tipoProd && (!q || p.codigo === cod || norm(p.descricao).includes(q) || norm(p.referencia).includes(q) || norm(p.marca).includes(q) || norm(p.categoria).includes(q) || norm(p.obs).includes(q) || p.codigo_barras === busca.trim()))
      .sort((a, b) => a.descricao.localeCompare(b.descricao)).slice(0, 80); }, [busca, dados.produtos, tipoProd]);
  const usar = p => {
    if (p.tipo === "servico" && p.cobranca === "hora") set({ descricao: p.descricao, produto_id: p.id, servico_id: null, horas: Number(p.horas) || 1, qtd: Number(p.horas) || 1, valor_unit: Number(cfg.valorHora) || 0, custo_unit: 0 });
    else if (p.tipo === "servico") set({ descricao: p.descricao, produto_id: p.id, servico_id: null, horas: null, qtd: 1, valor_unit: precoTabela(p, tabela), custo_unit: 0 });
    else if (p.tipo === "terceiro") { const f = p.fornecedor_id && dados.fornecedores.find(x => x.id === p.fornecedor_id);
      set({ descricao: p.descricao, produto_id: p.id, valor_unit: precoTabela(p, tabela), custo_unit: Number(p.custo) || 0, fornecedor_id: f ? f.id : null, fornecedor: f ? f.fantasia || f.razao : i.fornecedor || "" }); }
    else set({ descricao: p.descricao, produto_id: p.id, codigo: p.referencia || String(p.codigo), valor_unit: precoTabela(p, tabela), custo_unit: Number(p.custo) || 0, qualidade: i.qualidade || "original" });
    setBusca(""); setEtapa("detalhe");
  };
  const porHora = i.tipo === "servico" && i.horas !== null && i.horas !== undefined;
  const bruto = (Number(i.qtd) || 0) * (Number(i.valor_unit) || 0);
  const erro = !i.descricao.trim() ? "Informe a descrição." : !(Number(i.qtd) > 0) ? "Quantidade deve ser maior que zero." : Number(i.desconto) > bruto + 0.001 ? "O desconto não pode ser maior que o valor do item." : "";
  const disponivel = prod ? Number(prod.estoque_atual) + (prod.id === item.produto_id ? qtdOriginal : 0) : 0; // a quantidade já lançada nesta O.S. já saiu do estoque
  const semEstoque = prod && prod.tipo === "produto" && prod.controla_estoque && disponivel < Number(i.qtd);
  const salvar = () => {
    if (semEstoque && !prod.vender_sem_estoque) return setErroEst(`Estoque insuficiente: há ${qtdFmt(disponivel)} ${prod.unidade}. Este produto está marcado para não ser vendido sem estoque.`);
    if (conta && !conta.vencimento) return setErroEst("Informe o vencimento da conta do prestador.");
    if (conta && !(Number(i.custo_unit) > 0)) return setErroEst("Informe o custo do prestador para lançar a conta a pagar.");
    onSalvar({ ...i, _conta: i.tipo === "terceiro" && !i.conta_id && conta ? conta : undefined });
  };
  const qtdInp = html`<${Campo} id="it-qtd" rotulo="Quantidade"><input id="it-qtd" class="inp" inputmode="decimal" value=${String(i.qtd).replace(".", ",")} onInput=${e => set({ qtd: Number(e.target.value.replace(",", ".")) || 0 })} /></${Campo}>`;
  const plural = i.tipo === "servico" ? "serviços" : i.tipo === "terceiro" ? "serviços de terceiros" : "produtos";
  if (etapa === "catalogo") return html`<${Modal} titulo=${"Incluir " + NOME_TIPO[i.tipo]} largo onFechar=${onFechar}>
    <div class="cat-topo"><input id="cat-busca" class="inp" type="search" autofocus autocomplete="off" aria-label=${"Buscar " + plural}
        placeholder=${i.tipo === "servico" ? "Buscar serviço: alinhamento, pastilha…" : i.tipo === "terceiro" ? "Buscar serviço de terceiro: retífica, torno, guincho…" : "Buscar por descrição, código, referência, marca ou aplicação"} value=${busca} onInput=${e => setBusca(e.target.value)} />
      <button type="button" class="btn" onClick=${() => { set({ produto_id: null, descricao: busca.trim(), ...(i.tipo === "terceiro" && !i.valor_unit ? { custo_unit: 0, valor_unit: 0 } : {}) }); setEtapa("detalhe"); }}>+ Cadastrar só nesta O.S.</button></div>
    <span class="dica">Tabela de preço: ${TABELAS_PRECO[tabela].toLowerCase()}. ${cat.length === 80 ? "Mostrando os 80 primeiros; refine a busca." : cat.length + " " + plural + " no cadastro."}</span>
    <div class="catalogo">${cat.map(p => { const est = p.tipo === "produto" && p.controla_estoque; const zerado = est && Number(p.estoque_atual) <= 0;
      return html`<button type="button" key=${p.id} class=${"cat-item" + (zerado ? " zerado" : "")} onClick=${() => usar(p)}>
        <span class="cod">${p.codigo}</span><span class="meio"><strong>${p.descricao}</strong><span>${[p.referencia, p.marca, p.categoria, p.tipo === "terceiro" && p.fornecedor_id ? ((dados.fornecedores.find(f => f.id === p.fornecedor_id) || {}).fantasia || (dados.fornecedores.find(f => f.id === p.fornecedor_id) || {}).razao) : "", p.tipo === "terceiro" && pode(perfil, "verValores") && Number(p.custo) ? "custo " + reais(p.custo) : ""].filter(Boolean).join(" · ")}</span></span>
        ${est ? html`<span class=${"cat-est" + (zerado ? " c-bad" : "")}>${qtdFmt(p.estoque_atual)} ${p.unidade}</span>` : null}
        <b>${p.tipo === "servico" && p.cobranca === "hora" ? qtdFmt(p.horas) + " h" : precoTabela(p, tabela) ? reais(precoTabela(p, tabela)) : "sem preço"}</b></button>`; })}
      ${!cat.length ? html`<div class="vazio">Nenhum ${NOME_TIPO[i.tipo]} encontrado. Use “Cadastrar só nesta O.S.”${i.tipo === "terceiro" ? " ou cadastre em Cadastros › Produtos › Terceiros para reutilizar" : ""}.</div>` : null}</div>
  </${Modal}>`;
  return html`<${Modal} titulo=${(item._novo ? "Incluir " : "Alterar ") + NOME_TIPO[i.tipo]} onFechar=${onFechar}>
    ${true ? (prod ? html`<div class="info item-origem"><span>Do cadastro: cód. ${prod.codigo}${prod.tipo === "produto" && prod.controla_estoque ? " · disponível " + qtdFmt(disponivel) + " " + prod.unidade : ""}</span>
        ${item._novo ? html`<button type="button" class="btn-link" onClick=${() => setEtapa("catalogo")}>Trocar</button>` : null}</div>`
      : html`<div class="info item-origem"><span>Item só desta O.S.: não entra no cadastro de ${plural}${i.tipo === "peca" ? " nem no estoque" : ""}.</span>${item._novo ? html`<button type="button" class="btn-link" onClick=${() => setEtapa("catalogo")}>Escolher do cadastro</button>` : null}</div>`) : null}
    <${Campo} id="it-desc" rotulo="Descrição" obrig><${Texto} id="it-desc" valor=${i.descricao} onMuda=${v => set({ descricao: v })} /></${Campo}>
    ${i.tipo === "servico" ? html`
      <${Seg} rotulo="Forma de cobrança" opcoes=${[["Preço fechado", "info"], ["Por hora", "info"]]} valor=${porHora ? "Por hora" : "Preço fechado"}
        onEscolha=${v => v === "Por hora" ? set({ horas: i.horas || 1, qtd: i.horas || 1, valor_unit: Number(cfg.valorHora) || i.valor_unit }) : set({ horas: null, qtd: 1 })} />
      ${porHora ? html`<div class="grade">
          <${Campo} id="it-horas" rotulo="Tempo (horas)"><input id="it-horas" class="inp" inputmode="decimal" value=${String(i.horas ?? "").replace(".", ",")} onInput=${e => { const h = Number(e.target.value.replace(",", ".")) || 0; set({ horas: h, qtd: h }); }} /></${Campo}>
          <${Campo} id="it-vh" rotulo="Valor da hora"><${Dinheiro} id="it-vh" valor=${i.valor_unit} onMuda=${v => set({ valor_unit: v })} /></${Campo}></div>`
        : html`<div class="grade">${qtdInp}<${Campo} id="it-val" rotulo="Valor unitário"><${Dinheiro} id="it-val" valor=${i.valor_unit} onMuda=${v => set({ valor_unit: v })} /></${Campo}></div>`}` : null}
    ${i.tipo === "peca" ? html`
      <div class="grade"><${Campo} id="it-cod" rotulo="Referência / código"><${Texto} id="it-cod" valor=${i.codigo} onMuda=${v => set({ codigo: v })} /></${Campo}>${qtdInp}</div>
      <label class="linha-check"><input type="checkbox" id="it-cli" checked=${i.fornecida_cliente} onChange=${e => set({ fornecida_cliente: e.target.checked, valor_unit: e.target.checked ? 0 : i.valor_unit, custo_unit: e.target.checked ? 0 : i.custo_unit, desconto: 0 })} />
        <span>Peça fornecida pelo cliente (a oficina garante só a mão de obra de instalação)</span></label>
      ${!i.fornecida_cliente ? html`
        <div class="campo"><label>Procedência</label><${Seg} rotulo="Procedência" opcoes=${Object.entries(QUALIDADE).map(([k, t]) => [t, k === "usada" ? "warn" : "info"])} valor=${QUALIDADE[i.qualidade]}
          onEscolha=${t => set({ qualidade: Object.keys(QUALIDADE).find(k => QUALIDADE[k] === t) })} />
          ${i.qualidade === "usada" ? html`<span class="dica erro">Peça usada exige autorização expressa do cliente (CDC, art. 21). Ela aparece identificada no orçamento.</span>` : null}</div>
        <div class="grade">
          <${Campo} id="it-custo" rotulo="Custo unitário (interno)"><${Dinheiro} id="it-custo" valor=${i.custo_unit} onMuda=${v => set({ custo_unit: v, valor_unit: !i.valor_unit || i.valor_unit === sugestaoVenda(i.custo_unit) ? sugestaoVenda(v) : i.valor_unit })} /></${Campo}>
          <${Campo} id="it-venda" rotulo="Preço de venda unitário" dica=${i.produto_id ? "" : "Sugestão com margem de " + (cfg.markupPecas || 0) + "%: " + reais(sugestaoVenda(i.custo_unit))}><${Dinheiro} id="it-venda" valor=${i.valor_unit} onMuda=${v => set({ valor_unit: v })} /></${Campo}>
        </div>` : null}` : null}
    ${i.tipo === "terceiro" ? html`
      <div class="campo"><label for="it-forn">Prestador</label><${BuscaFornecedor} id="it-forn" somentePrestador valor=${i.fornecedor_id} texto=${i.fornecedor_id ? "" : i.fornecedor}
        onEscolha=${f => set({ fornecedor_id: f ? f.id : null, fornecedor: f ? f.fantasia || f.razao : "" })} onTexto=${t => set({ fornecedor_id: null, fornecedor: t })} /></div>
      <div class="grade">
        ${qtdInp}
        <${Campo} id="it-custo" rotulo="Custo do prestador (unitário)"><${Dinheiro} id="it-custo" valor=${i.custo_unit} onMuda=${v => set({ custo_unit: v, ...(v > 0 ? { valor_unit: precoPelaMargem(v, margemTer) } : {}) })} /></${Campo}>
        <${Campo} id="it-marg" rotulo="Margem da oficina"><div class="inp-suf"><input id="it-marg" class="inp" inputmode="decimal" disabled=${!(Number(i.custo_unit) > 0)} value=${margTxt ?? (Number(i.custo_unit) > 0 ? String(margemTer).replace(".", ",") : "")} onInput=${e => { setMargTxt(e.target.value); set({ valor_unit: precoPelaMargem(i.custo_unit, parseValor(e.target.value)) }); }} onBlur=${() => setMargTxt(null)} /><span>%</span></div></${Campo}>
        <${Campo} id="it-venda" rotulo="Valor cobrado do cliente (unitário)"><${Dinheiro} id="it-venda" valor=${i.valor_unit} onMuda=${v => set({ valor_unit: v })} /></${Campo}>
      </div>
      ${Number(i.custo_unit) > 0 ? html`<div class=${"info lucro-item" + (Number(i.valor_unit) < Number(i.custo_unit) ? " c-bad" : "")}><span>Custo ${reais(i.custo_unit * i.qtd)} · cobrado ${reais(totalItem(i))}</span><b>Lucro ${reais(totalItem(i) - i.custo_unit * i.qtd)}${totalItem(i) > 0 ? " (" + Math.round((totalItem(i) - i.custo_unit * i.qtd) / totalItem(i) * 100) + "% do valor)" : ""}</b></div>` : null}
      ${fin && i.conta_id ? html`<span class="dica">A conta a pagar ao prestador já foi lançada no Financeiro.</span>` : fin ? html`<label class="linha-check"><input type="checkbox" id="it-conta" checked=${!!conta} onChange=${e => setConta(e.target.checked ? { vencimento: hojeISO() } : null)} /><span>Lançar conta a pagar ao prestador (${reais((Number(i.custo_unit) || 0) * (Number(i.qtd) || 0))})</span></label>
        ${conta ? html`<${Campo} id="it-conta-venc" rotulo="Vencimento da conta"><input id="it-conta-venc" type="date" class="inp inp-curto" value=${conta.vencimento} onInput=${e => setConta({ vencimento: e.target.value })} /></${Campo}>` : null}` : null}` : null}
    ${!i.fornecida_cliente ? html`<div class="grade">
      <${Campo} id="it-descp" rotulo="Desconto (%)"><input id="it-descp" class="inp" inputmode="decimal" value=${bruto && Number(i.desconto) ? String(arred(Number(i.desconto) / bruto * 100)).replace(".", ",") : ""} onInput=${e => set({ desconto: arred(bruto * parseValor(e.target.value) / 100) })} /></${Campo}>
      <${Campo} id="it-desc-v" rotulo="Desconto (R$)"><${Dinheiro} id="it-desc-v" valor=${i.desconto} onMuda=${v => set({ desconto: v })} /></${Campo}></div>` : null}
    ${semEstoque ? html`<div class=${prod.vender_sem_estoque ? "aviso" : "erros"}>Disponível: ${qtdFmt(disponivel)} ${prod.unidade}. ${prod.vender_sem_estoque ? "Ao salvar, o estoque ficará negativo." : "Este produto não pode ser vendido sem estoque."}</div>` : null}
    <div class="total-item"><span>Total do item</span><b>${reais(totalItem(i))}</b></div>
    ${erro || erroEst ? html`<span class="dica erro">${erro || erroEst}</span>` : null}
    <div class="acoes">${!item._novo ? html`<button type="button" class="btn btn-perigo" onClick=${onExcluir}>Remover</button>` : null}<span class="espaco"></span>
      <button type="button" class="btn" onClick=${onFechar}>Cancelar</button><button type="button" class="btn btn-pri" disabled=${!!erro} onClick=${salvar}>Salvar item</button></div>
  </${Modal}>`;
}

function ItemLinha({ i, verValores, onClick, mostrarAprov, exec }) {
  const sub = [];
  if (i.codigo && i.tipo !== "servico") sub.push(i.codigo);
  if (i.tipo === "servico") sub.push(i.horas ? qtdFmt(i.horas) + " h" + (verValores ? " × " + reais(i.valor_unit) : "") : qtdFmt(i.qtd) + (verValores ? " × " + reais(i.valor_unit) : " un"));
  if (i.tipo === "peca") { sub.push(qtdFmt(i.qtd) + " un" + (verValores && !i.fornecida_cliente ? " × " + reais(i.valor_unit) : "")); sub.push(i.fornecida_cliente ? "peça do cliente" : (QUALIDADE[i.qualidade] || "procedência não informada")); }
  if (i.tipo === "terceiro") { if (i.fornecedor) sub.push(i.fornecedor); if (Number(i.qtd) !== 1) sub.push(qtdFmt(i.qtd) + " un"); if (verValores && (i.conta_id || i._conta)) sub.push("conta a pagar lançada"); }
  if (verValores && Number(i.desconto) > 0) sub.push("desconto " + reais(i.desconto));
  if (verValores && i.tipo !== "servico" && Number(i.custo_unit) > 0) sub.push("custo " + reais(i.custo_unit * i.qtd) + (i.nfe_ref ? " (" + i.nfe_ref + ")" : ""));
  const ap = i.aprovado === true ? (exec ? null : html`<span class="pill p-ok">Aprovado</span>`) : i.aprovado === false ? html`<span class="pill p-bad">Não aprovado</span>` : mostrarAprov ? html`<span class="pill p-warn">Aguardando</span>` : null;
  return html`<div class=${"linha item-os" + (i.aprovado === false ? " recusado" : "")}>
    ${exec ? html`<input type="checkbox" class="chk-exec" aria-label=${"Executado: " + i.descricao} checked=${i.executado} disabled=${exec.disabled} onChange=${e => exec.onMuda(e.target.checked)} />` : null}
    <button type="button" class="meio botao-limpo" onClick=${onClick} disabled=${!onClick}><strong>${i.descricao}${i.adicional ? html` <em class="tag">adicional</em>` : null}${i.produto_id ? html` <em class="tag tag-cad">cadastro</em>` : null}</strong><span>${sub.join(" · ")}</span></button>
    <span class="dir">${verValores ? html`<b>${i.fornecida_cliente ? "—" : reais(totalItem(i))}</b>` : null}${ap}</span></div>`;
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
      <span class="meio"><strong>${i.descricao}</strong><span>${{ servico: "Mão de obra", peca: "Peça", terceiro: "Terceiro" }[i.tipo]}</span></span><b>${i.fornecida_cliente ? "—" : reais(totalItem(i))}</b></label>`)}</div>
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
function EntregaModal({ o, cfg, saldo, onFechar, onConfirmar }) {
  const [km, setKm] = useState(String(o.km_entrada || ""));
  const [forma, setForma] = useState(o.forma_pagamento || "");
  const [garantia, setGarantia] = useState(String(o.garantia_dias || cfg.garantiaDias || 90));
  const [recibo, setRecibo] = useState(saldo > 0);
  const [erro, setErro] = useState("");
  const assin = useRef(null);
  const recusado = o.status === "recusado";
  const confirmar = () => {
    const k = parseInt(soDig(km), 10);
    if (!(k >= (o.km_entrada || 0))) return setErro("O KM de saída não pode ser menor que o de entrada (" + fmtKm(o.km_entrada) + ").");
    if (o.total > 0 && !forma) return setErro("Informe a forma de pagamento.");
    onConfirmar({ km: k, forma, garantia: parseInt(garantia, 10) || 0, assin: assin.current, recibo: recibo && saldo > 0 });
  };
  return html`<${Modal} titulo=${recusado ? "Registrar retirada" : "Registrar entrega"} onFechar=${onFechar}>
    <div class="total-item"><span>Valor da O.S.</span><b>${reais(o.total)}</b></div>
    ${saldo < o.total ? html`<div class="total-item"><span>Saldo a receber</span><b>${reais(saldo)}</b></div>` : null}
    <${Campo} id="ent-km" rotulo="KM de saída" obrig><input id="ent-km" class="inp" inputmode="numeric" value=${km ? Number(soDig(km)).toLocaleString("pt-BR") : ""} onInput=${e => { setKm(soDig(e.target.value).slice(0, 7)); setErro(""); }} /></${Campo}>
    ${o.total > 0 ? html`<div class="campo"><label>Forma de pagamento <i>*</i></label><${Seg} rotulo="Pagamento" opcoes=${(cfg.formasPagamento || []).map(x => [x, "info"])} valor=${forma} onEscolha=${v => { setForma(v); setErro(""); }} /></div>` : null}
    ${saldo > 0 ? html`<label class="linha-check"><input type="checkbox" id="ent-recibo" checked=${recibo} onChange=${e => setRecibo(e.target.checked)} /><span>Pagamento recebido agora: emitir recibo de ${reais(saldo)}</span></label>` : null}
    ${!recusado ? html`<${Campo} id="ent-gar" rotulo="Garantia (dias)" dica="Mínimo legal para serviços: 90 dias (CDC, art. 26, II)."><input id="ent-gar" class="inp" inputmode="numeric" value=${garantia} onInput=${e => setGarantia(soDig(e.target.value))} /></${Campo}>` : null}
    <div class="campo"><label>Assinatura do cliente na retirada</label><${PadAssinatura} apiRef=${assin} altura=${150} /></div>
    ${erro ? html`<div class="erros">${erro}</div>` : null}
    <div class="acoes"><span class="espaco"></span><button type="button" class="btn" onClick=${onFechar}>Cancelar</button><button type="button" class="btn btn-pri" onClick=${confirmar}>Confirmar ${recusado ? "retirada" : "entrega"}</button></div>
  </${Modal}>`;
}

/* ---------------- Impressão (opções) ---------------- */
function ImprimirModal({ o, verValores, onFechar }) {
  const { cfg, ir } = useApp();
  const [vias, setVias] = useState(String(cfg.impressaoVias || 1)), [valores, setValores] = useState(verValores), [formato, setFormato] = useState("a4");
  return html`<${Modal} titulo=${"Imprimir " + numOS(o.numero)} onFechar=${onFechar}>
    <div class="campo"><label>Formato</label><${Seg} rotulo="Formato" opcoes=${[["Folha A4", "info"], ["Cupom 80 mm", "info"]]} valor=${formato === "a4" ? "Folha A4" : "Cupom 80 mm"} onEscolha=${v => setFormato(v.startsWith("Folha") ? "a4" : "cupom")} /></div>
    ${formato === "a4" ? html`<div class="campo"><label>Vias</label><${Seg} rotulo="Vias" opcoes=${[["1 via", "info"], ["2 vias", "info"]]} valor=${vias + " via" + (vias === "2" ? "s" : "")} onEscolha=${v => setVias(v[0])} /></div>` : null}
    ${verValores ? html`<label class="linha-check"><input type="checkbox" checked=${valores} onChange=${e => setValores(e.target.checked)} /><span>Mostrar valores na impressão (desmarque para a via do mecânico)</span></label>` : null}
    <div class="acoes"><span class="espaco"></span><button type="button" class="btn" onClick=${onFechar}>Cancelar</button>
      <button type="button" class="btn btn-pri" onClick=${() => ir(`/imprimir/os/${o.id}?vias=${formato === "a4" ? vias : 1}&valores=${valores ? 1 : 0}&formato=${formato}`)}>Visualizar e imprimir</button></div>
  </${Modal}>`;
}

/* ---------------- Tela da O.S. ---------------- */
export function Ordem({ id }) {
  const { cfg, perfil, dados, avisar, confirmar, ir, recarregar } = useApp();
  const [o, setO] = useState(null);
  const [erroCarga, setErroCarga] = useState("");
  const [aba, setAba] = useState("principal");
  const [itens, setItens] = useState([]);
  const [removidos, setRemovidos] = useState([]);
  const [campos, setCampos] = useState({});
  const [sujo, setSujo] = useState(false);
  const [modal, setModal] = useState(null);
  const [ocupado, setOcupado] = useState("");
  const [recibos, setRecibos] = useState([]);
  const verValores = pode(perfil, "verValores");

  const carregarRecibos = () => verValores ? api.recibos.listar({ ordemId: id }).then(setRecibos).catch(() => {}) : null;
  const carregar = async () => {
    try { const r = await api.ordem(id); setO(r); setItens(r.itens); setRemovidos([]); setSujo(false);
      setCampos({ diagnostico: r.diagnostico, reclamacao: r.reclamacao, previsao_entrega: r.previsao_entrega || "", previsao_hora: r.previsao_hora || "", condicoes_pagamento: r.condicoes_pagamento, desconto: Number(r.desconto) || 0,
        obs_execucao: r.obs_execucao, obs_internas: r.obs_internas || "", box: r.box || "", contato: r.contato || "", situacao: r.situacao || "", tabela_preco: r.tabela_preco || "vista" });
    } catch (e) { setErroCarga(e.message); }
  };
  useEffect(() => { setO(null); carregar(); carregarRecibos(); }, [id]);
  if (erroCarga) return html`<div class="pagina"><div class="erros">Não foi possível abrir a O.S.: ${erroCarga}</div><button class="btn" onClick=${() => ir("/ordens")}>Voltar</button></div>`;
  if (!o) return html`<div class="pagina"><div class="carregando">Abrindo O.S.…</div></div>`;

  const st = o.status;
  const aberta = ABERTOS.includes(st);
  const gestor = pode(perfil, "orcar");
  const editavelOrc = gestor && st === "diagnostico";
  const podeAdicional = gestor && (st === "execucao" || st === "aguardando");
  const editaInfo = gestor && aberta;
  const pendentes = itens.filter(i => i.aprovado === null || i.aprovado === undefined);
  const aprovadoAlgum = itens.some(i => i.aprovado === true);
  const tOrc = totais(itens, campos.desconto, false), tAprov = totais(itens, campos.desconto, true);
  const usaAprov = ["execucao", "pronto", "entregue", "recusado"].includes(st);
  const tAtual = usaAprov ? tAprov : tOrc;
  const recebido = recibos.filter(r => !r.cancelado).reduce((s, r) => s + Number(r.valor), 0);
  const saldo = arred(Math.max(0, tAtual.total - recebido));
  const setCampo = p => { setCampos(c => ({ ...c, ...p })); setSujo(true); };
  const evento = (tipo, texto) => api.evento(o.id, tipo, texto, perfil.nome).catch(() => {});
  const cliCad = dados.clientes.find(c => c.id === o.cliente_id);

  const salvar = async (extra = {}, silencioso) => {
    const aprov = ["execucao", "pronto", "entregue", "recusado"].includes(extra.status || st);
    const t = totais(itens, campos.desconto, aprov);
    let lista = itens;
    if (itens.some(i => i._conta && !i.conta_id)) {
      lista = [];
      for (const i of itens) {
        if (!i._conta || i.conta_id) { lista.push(i); continue; }
        try {
          const nomeP = i.fornecedor || "Prestador";
          const c = await api.contas.salvar({ descricao: i.descricao + " – " + numOS(o.numero) + (o.veiculo && o.veiculo.placa ? " " + exPlaca(o.veiculo.placa) : ""), fornecedor_id: i.fornecedor_id || null, favorecido: nomeP,
            categoria: "Serviços de terceiros", documento: numOS(o.numero), valor: arred(Number(i.custo_unit) * Number(i.qtd)), vencimento: i._conta.vencimento, origem: "os", ordem_id: o.id, criado_por: perfil.nome });
          lista.push({ ...i, conta_id: c.id, _conta: undefined });
        } catch (e) { avisar("O item foi salvo, mas a conta do prestador não foi lançada: " + e.message, true); lista.push({ ...i, _conta: undefined }); }
      }
      setItens(lista);
    }
    await api.salvarItens(o.id, lista.map(({ _novo, _cadastrar, _conta, ...i }, n) => ({ ...i, posicao: n })), removidos);
    await api.atualizarOrdem(o.id, { diagnostico: campos.diagnostico, reclamacao: campos.reclamacao, previsao_entrega: campos.previsao_entrega || null, previsao_hora: campos.previsao_hora || "",
      condicoes_pagamento: campos.condicoes_pagamento, desconto: campos.desconto, obs_execucao: campos.obs_execucao, obs_internas: campos.obs_internas, box: campos.box, contato: campos.contato,
      situacao: campos.situacao, tabela_preco: campos.tabela_preco, total: t.total, custo: t.custo, ...extra });
    if (!silencioso) avisar("O.S. salva.");
    await carregar(); recarregar(["ordens", "produtos"]);
  };
  const acao = async (rotulo, fn) => { setOcupado(rotulo); try { await fn(); } catch (e) { avisar(e.message, true); } finally { setOcupado(""); } };

  const novoItem = tipo => setModal({ tipo: "item", item: { id: uuid(), _novo: true, tipo, descricao: "", codigo: "", fornecedor: "", qtd: 1, valor_unit: 0, custo_unit: 0, desconto: 0, horas: null, servico_id: null, produto_id: null, fornecida_cliente: false, qualidade: tipo === "peca" ? "original" : "", adicional: st !== "diagnostico", aprovado: null, executado: false } });
  const salvarItem = async it => {
    let x = { ...it };
    if (x._cadastrar) {
      try {
        const p = await api.produtos.salvar({ tipo: x.tipo === "servico" ? "servico" : "produto", descricao: x.descricao.trim(), referencia: x.codigo || "", unidade: x.tipo === "servico" ? "SERV" : "UN", custo: x.custo_unit || 0,
          preco_vista: x.valor_unit || 0, preco_prazo: x.valor_unit || 0, preco_atacado: x.valor_unit || 0, margem_vista: x.custo_unit > 0 ? arred((x.valor_unit / x.custo_unit - 1) * 100) : 0,
          cobranca: x.horas ? "hora" : "fixo", horas: x.horas || 0, controla_estoque: x.tipo === "peca", avisar_estoque_baixo: false, vender_sem_estoque: true });
        x.produto_id = p.id; avisar("Incluído no cadastro com o código " + p.codigo + "."); recarregar(["produtos"]);
      } catch (e) { avisar("O item entrou na O.S., mas não foi possível cadastrá-lo: " + e.message, true); }
    }
    delete x._cadastrar;
    setItens(l => l.some(y => y.id === x.id) ? l.map(y => y.id === x.id ? { ...x, _novo: false } : y) : l.concat([{ ...x, _novo: false }])); setSujo(true); setModal(null);
  };
  const excluirItem = it => { setItens(l => l.filter(x => x.id !== it.id)); if (!it._novo) setRemovidos(r => r.concat([it.id])); setSujo(true); setModal(null); };

  const enviarOrcamento = () => acao("enviar", async () => {
    const erros = [];
    if (!itens.length) erros.push("inclua pelo menos um item");
    if (!(campos.diagnostico || "").trim()) erros.push("preencha o defeito constatado / diagnóstico");
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
    setModal(null); avisar(status === "recusado" ? "Nenhum item aprovado: orçamento marcado como recusado." : "Aprovação registrada."); await carregar(); recarregar(["ordens", "produtos"]);
  });
  const recusar = async () => {
    const taxa = Number(cfg.taxaDiagnostico) || 0;
    if (!await confirmar({ titulo: "Orçamento recusado", texto: taxa ? `O orçamento será marcado como recusado e a taxa de diagnóstico de ${reais(taxa)} será lançada para a retirada.` : "O orçamento será marcado como recusado. O veículo fica aguardando retirada.", botao: "Marcar como recusado", perigo: true })) return;
    acao("recusar", async () => {
      let novos = itens.map(i => ({ ...i, aprovado: i.aprovado === true ? true : false }));
      if (taxa) novos = novos.concat([{ id: uuid(), tipo: "servico", descricao: "Taxa de diagnóstico", codigo: "", fornecedor: "", qtd: 1, valor_unit: taxa, custo_unit: 0, desconto: 0, horas: null, servico_id: null, produto_id: null, fornecida_cliente: false, qualidade: "", adicional: true, aprovado: true, executado: true }]);
      const t = totais(novos, 0, true);
      await api.salvarItens(o.id, novos, removidos);
      await api.atualizarOrdem(o.id, { status: "recusado", total: t.total, custo: t.custo, desconto: 0 });
      await evento("recusa", "Orçamento recusado pelo cliente." + (taxa ? " Taxa de diagnóstico lançada." : ""));
      await carregar(); recarregar(["ordens", "produtos"]);
    });
  };
  const marcarExecutado = (it, v) => acao("exec", async () => {
    const novos = itens.map(i => i.id === it.id ? { ...i, executado: v } : i); setItens(novos);
    await api.salvarItens(o.id, [{ ...novos.find(i => i.id === it.id) }].map(({ _novo, ...i }) => i), []);
  });
  const salvarMecanico = mid => acao("mec", async () => {
    const m = dados.perfis.find(p => p.id === mid);
    await api.atualizarOrdem(o.id, { mecanico_id: mid || null, mecanico_nome: m ? m.nome : "" }); await evento("mecanico", "Técnico responsável: " + (m ? m.nome : "nenhum") + ".");
    setO(x => ({ ...x, mecanico_id: mid || null, mecanico_nome: m ? m.nome : "" })); recarregar(["ordens"]);
  });
  const trocarCliente = cid => acao("cliente", async () => {
    const c = dados.clientes.find(x => x.id === cid); if (!c) return;
    if (c.situacao === "bloqueado") throw new Error("Cliente bloqueado: " + (c.restricao || "verifique o cadastro") + ".");
    const cliente = { nome: c.nome, telefone: c.telefone || "", doc: c.doc || "", endereco: endCompleto(c) };
    await api.atualizarOrdem(o.id, { cliente_id: c.id, cliente }); await evento("cliente", "Cliente da O.S. alterado para " + c.nome + ".");
    setO(x => ({ ...x, cliente_id: c.id, cliente })); setModal(null); recarregar(["ordens"]);
  });
  const marcarPronto = async () => {
    const falta = itens.filter(i => i.aprovado === true && !i.executado);
    if (pendentes.length) return avisar("Há itens adicionais aguardando aprovação do cliente. Registre a decisão antes de concluir.", true);
    if (falta.length && !await confirmar({ titulo: "Itens não marcados", texto: falta.length + " item(ns) aprovado(s) não foram marcados como executados: " + falta.map(i => i.descricao).join(", ") + ". Concluir mesmo assim?", botao: "Concluir" })) return;
    acao("pronto", async () => { await salvar({ status: "pronto" }, true); await evento("pronto", "Serviço concluído. Veículo pronto para retirada."); setModal({ tipo: "enviar", qual: "pronto" }); });
  };
  const confirmarEntrega = ({ km, forma, garantia, assin, recibo }) => acao("entregar", async () => {
    let assinatura = "";
    if (assin && !assin.vazio()) { const b = await assin.blob(); assinatura = await api.enviarArquivo("assinaturas/" + o.id + "-entrega.png", b, "image/png"); }
    const t = totais(itens, campos.desconto, true);
    await api.atualizarOrdem(o.id, { status: st === "recusado" ? "recusado" : "entregue", km_saida: km, entregue_em: new Date().toISOString(), forma_pagamento: forma, garantia_dias: garantia, assinatura_entrega: assinatura, total: t.total, custo: t.custo, situacao: "" });
    const v = dados.veiculos.find(x => x.id === o.veiculo_id);
    if (v && km > (v.km_atual || 0)) await api.veiculos.salvar({ id: v.id, km_atual: km });
    await evento("entrega", (st === "recusado" ? "Veículo retirado sem execução, com " : "Veículo entregue com ") + fmtKm(km) + (forma ? ". Pagamento: " + forma : "") + ".");
    setModal(null); await carregar(); recarregar(["ordens", "veiculos", "produtos"]);
    if (recibo) setModal({ tipo: "recibo", forma });
    else setModal({ tipo: "enviar", qual: st === "recusado" ? null : "entrega" });
  });
  const cancelar = async () => {
    if (!await confirmar({ titulo: "Cancelar " + numOS(o.numero), texto: "A O.S. fica registrada como cancelada no histórico.", botao: "Cancelar O.S.", perigo: true })) return;
    acao("cancelar", async () => { await api.atualizarOrdem(o.id, { status: "cancelado" }); await evento("cancelamento", "O.S. cancelada."); await carregar(); recarregar(["ordens", "produtos"]); });
  };
  const reabrir = async () => {
    const destino = st === "entregue" ? "pronto" : "diagnostico";
    if (!await confirmar({ titulo: "Reabrir " + numOS(o.numero), texto: st === "entregue" ? "A O.S. volta para “Pronto para retirada”. As peças continuam baixadas do estoque enquanto a O.S. estiver ativa." : "A O.S. volta para “Em diagnóstico” para refazer o orçamento.", botao: "Reabrir" })) return;
    acao("reabrir", async () => { await api.atualizarOrdem(o.id, { status: destino, ...(destino === "diagnostico" ? { orcamento_enviado_em: null } : {}) }); await evento("reabertura", "O.S. reaberta (" + STATUS[st].t.toLowerCase() + " → " + STATUS[destino].t.toLowerCase() + ")."); await carregar(); recarregar(["ordens", "produtos"]); });
  };
  const excluir = async () => {
    if (!await confirmar({ titulo: "Excluir " + numOS(o.numero), texto: "Remove a O.S., os itens, as fotos e o histórico definitivamente. Prefira cancelar: o histórico protege a oficina.", botao: "Excluir definitivamente", perigo: true })) return;
    acao("excluir", async () => { await api.removerArquivos((o.fotos || []).map(f => f.caminho).concat([o.assinatura_entrada, o.assinatura_entrega].filter(Boolean))); await api.excluirOrdem(o.id); await recarregar(["ordens"], { completo: true }); ir("/ordens"); });
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
  const imprimir = async () => { if (sujo) await acao("salvar", () => salvar({}, true)); setModal({ tipo: "imprimir" }); };
  const whats = qual => {
    const fn = MSG[qual]; if (!fn) return;
    const lista = qual === "adicionais" ? pendentes : itens.filter(i => i.aprovado !== false);
    window.open(linkWhats(o.cliente.telefone, fn({ ...o, ...campos, total: tAtual.total }, cfg, lista)), "_blank", "noopener");
    evento("whatsapp", "Mensagem de WhatsApp aberta: " + qual + ".");
  };

  // ---- barra de ações por etapa
  const B = (rot, fn, pri, dis) => html`<button type="button" class=${"btn" + (pri ? " btn-pri" : "")} disabled=${!!ocupado || dis} onClick=${fn}>${rot}</button>`;
  let acoes = [];
  if (st === "diagnostico" && gestor) acoes = [B(ocupado === "enviar" ? "Enviando…" : "Enviar orçamento ao cliente", enviarOrcamento, true)];
  if (st === "aguardando" && pode(perfil, "aprovar")) acoes = [B("Registrar aprovação", () => setModal({ tipo: "aprovar" }), true), B("Reenviar WhatsApp", () => whats("orcamento")), B("Revisar orçamento", revisarOrcamento), B("Cliente recusou", recusar)];
  if (st === "execucao" && pode(perfil, "executar")) acoes = [B("Concluir serviço", marcarPronto, true), pendentes.length && pode(perfil, "aprovar") ? B("Aprovar adicionais", () => setModal({ tipo: "aprovar" })) : null, pendentes.length && pode(perfil, "aprovar") ? B("WhatsApp adicionais", () => whats("adicionais")) : null];
  if (st === "pronto" && pode(perfil, "entregar")) acoes = [B("Registrar entrega", () => setModal({ tipo: "entrega" }), true), B("Avisar cliente", () => whats("pronto"))];
  if (st === "recusado" && pode(perfil, "entregar") && !o.entregue_em) acoes = [B("Registrar retirada", () => setModal({ tipo: "entrega" }), true)];
  if (st === "entregue" && pode(perfil, "entregar")) acoes = [saldo > 0 ? B("Emitir recibo", () => setModal({ tipo: "recibo" }), true) : null, B("WhatsApp de garantia", () => whats("entrega"))];
  acoes = acoes.filter(Boolean);
  const passo = FLUXO.indexOf(st);

  /* ===== aba Principais informações ===== */
  const mecanicos = dados.perfis.filter(p => p.ativo !== false && ["mecanico", "admin", "consultor"].includes(p.papel));
  const situacoes = [...new Set([...(cfg.situacoesOS || []), campos.situacao].filter(Boolean))];
  const abaPrincipal = html`
    <section class="card"><h3>Atendimento</h3>
      <div class="grade">
        <div class="campo"><label>Entrada</label><b>${fmtDataHora(o.criado_em)}</b></div>
        <${Campo} id="os-prev" rotulo="Previsão de entrega">${editaInfo ? html`<div class="linha-add"><input id="os-prev" type="date" class="inp" value=${campos.previsao_entrega || ""} onInput=${e => setCampo({ previsao_entrega: e.target.value })} />
          <input id="os-prev-h" type="time" class="inp inp-hora" aria-label="Hora prevista" value=${campos.previsao_hora || ""} onInput=${e => setCampo({ previsao_hora: e.target.value })} /></div>` : html`<b>${o.previsao_entrega ? fmtData(o.previsao_entrega) + (o.previsao_hora ? " " + o.previsao_hora : "") : "A combinar"}</b>`}</${Campo}>
        <${Campo} id="os-box" rotulo="Box / prisma">${editaInfo ? html`<${Texto} id="os-box" valor=${campos.box} onMuda=${v => setCampo({ box: v.slice(0, 10) })} />` : html`<b>${o.box || "—"}</b>`}</${Campo}>
        <${Campo} id="os-sit" rotulo="Situação">${editaInfo ? html`<select id="os-sit" class="inp" value=${campos.situacao} onChange=${e => setCampo({ situacao: e.target.value })}><option value="">—</option>${situacoes.map(x => html`<option value=${x}>${x}</option>`)}</select>` : html`<b>${o.situacao || "—"}</b>`}</${Campo}>
        <div class="campo"><label>Consultor</label><b>${o.consultor_nome || "—"}</b></div>
        <${Campo} id="mec" rotulo="Técnico responsável"><select id="mec" class="inp" disabled=${!aberta || !(gestor || st === "execucao")} value=${o.mecanico_id || ""} onChange=${e => salvarMecanico(e.target.value)}>
          <option value="">${o.mecanico_nome && !o.mecanico_id ? o.mecanico_nome : "Selecione"}</option>${mecanicos.map(m => html`<option key=${m.id} value=${m.id}>${m.nome}</option>`)}</select></${Campo}>
      </div>
      ${verValores ? html`<div class="campo"><label>Tabela de preços</label>${editavelOrc ? html`<${Seg} rotulo="Tabela de preços" opcoes=${Object.values(TABELAS_PRECO).map(t => [t, "info"])} valor=${TABELAS_PRECO[campos.tabela_preco]} onEscolha=${t => setCampo({ tabela_preco: Object.keys(TABELAS_PRECO).find(k => TABELAS_PRECO[k] === t) })} />
        <span class="dica">Vale para os próximos itens buscados no cadastro.</span>` : html`<b>${TABELAS_PRECO[o.tabela_preco || "vista"]}</b>`}</div>` : null}
    </section>
    <section class="card"><div class="secao-topo"><h3>Cliente</h3>${editaInfo ? html`<button type="button" class="btn btn-sm" onClick=${() => setModal({ tipo: "cliente" })}>Trocar cliente</button>` : null}</div>
      <div class="kv"><div><span>Nome</span><b>${o.cliente_id ? html`<button type="button" class="btn-link" onClick=${() => ir("/cliente/" + o.cliente_id)}>${o.cliente.nome}</button>` : o.cliente.nome} <${SitCliente} c=${cliCad} /></b></div>
        <div><span>Telefone</span><b>${o.cliente.telefone ? fmtTel(o.cliente.telefone) : "—"}</b></div>${o.cliente.doc ? html`<div><span>CPF/CNPJ</span><b>${fmtDoc(o.cliente.doc)}</b></div>` : null}
        ${cliCad && cliCad.codigo ? html`<div><span>Código</span><b>${cliCad.codigo}</b></div>` : null}</div>
      ${cliCad && cliCad.situacao && cliCad.situacao !== "liberado" ? html`<div class="aviso">Cadastro ${SITUACAO_CLIENTE[cliCad.situacao].t.toLowerCase()}: ${cliCad.restricao}</div>` : null}
      <${Campo} id="os-contato" rotulo="Contato (quem trouxe / responsável)">${editaInfo ? html`<${Texto} id="os-contato" valor=${campos.contato} onMuda=${v => setCampo({ contato: v })} />` : html`<b>${o.contato || "—"}</b>`}</${Campo}>
    </section>
    <section class="card"><h3>Defeito reclamado</h3>
      ${editaInfo ? html`<${Area} id="os-recl" valor=${campos.reclamacao} onMuda=${v => setCampo({ reclamacao: v })} />` : html`<p class="texto-pre">${o.reclamacao || "—"}</p>`}</section>
    <section class="card"><h3>Defeito constatado / diagnóstico</h3>
      ${editavelOrc ? html`<${Area} id="diag" placeholder="O que foi constatado, testes feitos, causa provável e solução proposta." valor=${campos.diagnostico} onMuda=${v => setCampo({ diagnostico: v })} />`
        : html`<p class="texto-pre">${o.diagnostico || "—"}</p>`}</section>
    ${o.aprovacao ? html`<section class="card"><h3>Aprovação</h3><div class="kv"><div><span>Aprovado por</span><b>${o.aprovacao.por}</b></div><div><span>Quando</span><b>${fmtDataHora(o.aprovacao.em)}</b></div><div><span>Forma</span><b>${o.aprovacao.forma}</b></div>${o.aprovacao.obs ? html`<div><span>Obs.</span><b>${o.aprovacao.obs}</b></div>` : null}</div>
      ${o.aprovacao.assinatura ? html`<${Foto} caminho=${o.aprovacao.assinatura} alt="Assinatura" class="img-assin" />` : null}</section>` : null}`;

  /* ===== aba Veículo ===== */
  const vCad = dados.veiculos.find(v => v.id === o.veiculo_id);
  const kv = (rot, x) => x ? html`<div><span>${rot}</span><b>${x}</b></div>` : null;
  const abaVeiculo = html`<section class="card"><div class="secao-topo"><h3>Dados do veículo</h3>
      ${vCad ? html`<button type="button" class="btn btn-sm" onClick=${() => setModal({ tipo: "veiculo" })}>${pode(perfil, "cadastrar") ? "Editar ficha" : "Ver ficha"}</button><button type="button" class="btn btn-sm" onClick=${() => ir("/veiculo/" + vCad.id)}>Serviços executados</button>` : null}</div>
    <div class="kv">${kv("Placa", exPlaca(o.veiculo.placa))}${kv("Marca", o.veiculo.marca)}${kv("Modelo", o.veiculo.modelo)}${kv("Ano", o.veiculo.ano)}${kv("Cor", o.veiculo.cor)}
      ${kv("Combustível", (vCad && vCad.combustivel) || o.veiculo.motor)}${vCad ? html`${kv("Motor", vCad.motor)}${kv("Chassi", vCad.chassi)}${kv("Renavam", vCad.renavam)}${kv("Motorista", vCad.motorista)}` : null}
      ${kv("KM de entrada", fmtKm(o.km_entrada))}${o.km_saida ? kv("KM de saída", fmtKm(o.km_saida)) : null}${o.combustivel ? kv("Nível de combustível", o.combustivel) : null}</div>
    ${vCad && (vCad.revisao_km || vCad.oleo_km || vCad.filtro_km || vCad.revisao_data || vCad.oleo_data || vCad.filtro_data) ? html`<h4 class="sub-titulo">Manutenção programada</h4><div class="kv">
      ${[["Revisão", vCad.revisao_data, vCad.revisao_km], ["Troca de óleo", vCad.oleo_data, vCad.oleo_km], ["Troca de filtros", vCad.filtro_data, vCad.filtro_km]].filter(m => m[1] || m[2]).map(([t, d, k]) => html`<div key=${t}><span>${t}</span><b>${[d ? fmtData(d) : "", k ? fmtKm(k) : ""].filter(Boolean).join(" · ")}</b></div>`)}</div>` : null}
    ${vCad && vCad.obs ? html`<p class="texto-pre sub">${vCad.obs}</p>` : null}
    ${!vCad ? html`<span class="dica">Veículo sem ficha cadastral vinculada.</span>` : null}</section>`;

  /* ===== aba Produtos e serviços ===== */
  const execOn = ["execucao", "pronto", "entregue"].includes(st);
  const grupo = (tipo, titulo) => {
    const g = itens.filter(i => i.tipo === tipo);
    const podeEditar = editavelOrc || podeAdicional;
    if (!g.length && !podeEditar) return null;
    return html`<div class="grupo-itens"><div class="secao-topo"><h4>${titulo}</h4>${podeEditar ? html`<button type="button" class="btn btn-sm" onClick=${() => novoItem(tipo)}>+ Incluir</button>` : null}</div>
      ${g.length ? html`<div class="lista">${g.map(i => html`<${ItemLinha} key=${i.id} i=${i} verValores=${verValores} mostrarAprov=${st !== "diagnostico"}
        exec=${execOn && i.aprovado === true ? { disabled: st !== "execucao" || !pode(perfil, "executar") || !!ocupado, onMuda: v => marcarExecutado(i, v) } : null}
        onClick=${(editavelOrc || (podeAdicional && (i.aprovado === null || i.aprovado === undefined))) ? () => setModal({ tipo: "item", item: i }) : null} />`)}</div>` : html`<span class="dica">Nenhum item.</span>`}</div>`;
  };
  const abaItens = html`
    <section class="card"><div class="secao-topo"><h3>Produtos e serviços</h3>${st === "aguardando" ? html`<span class="sub">Enviado em ${fmtDataHora(o.orcamento_enviado_em)} · válido até ${fmtData(o.validade_orcamento)}</span>` : null}
        ${execOn ? html`<span class="sub">${itens.filter(i => i.aprovado === true && i.executado).length} de ${itens.filter(i => i.aprovado === true).length} executados</span>` : null}</div>
      ${grupo("peca", "Produtos / peças")}${grupo("servico", "Serviços / mão de obra")}${grupo("terceiro", "Serviços de terceiros (retífica, torno, guincho)")}
      ${pendentes.length && st !== "diagnostico" ? html`<div class="aviso">${pendentes.length} item(ns) aguardando aprovação do cliente. Não execute antes da aprovação.</div>` : null}
      ${st === "execucao" && !gestor ? html`<span class="dica">Encontrou algo a mais? Registre nas observações e avise o consultor para orçar como adicional.</span>` : null}
      ${verValores ? html`<div class="totais">
        <div><span>Valor dos produtos</span><b>${reais(tAtual.pecas)}</b></div><div><span>Valor dos serviços</span><b>${reais(tAtual.servicos)}</b></div>
        ${tAtual.terceiros ? html`<div><span>Serviços de terceiros</span><b>${reais(tAtual.terceiros)}</b></div>` : null}
        <div><span>Desconto</span>${editavelOrc ? html`<${Dinheiro} id="desc" valor=${campos.desconto} onMuda=${v => setCampo({ desconto: v })} />` : html`<b>${reais(tAtual.desconto)}</b>`}</div>
        <div class="tot"><span>Valor total${usaAprov ? " aprovado" : ""}</span><b>${reais(tAtual.total)}</b></div>
        <div class="interno"><span>Custo de peças e terceiros</span><b>${reais(tAtual.custo)}</b></div>
        <div class="interno"><span>Margem bruta</span><b class=${tAtual.margemPct < 30 && tAtual.total > 0 ? "c-warn" : ""}>${reais(tAtual.margem)} · ${tAtual.margemPct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</b></div>
      </div>` : null}</section>
    ${verValores ? html`<section class="card"><h3>Pagamento</h3>
      <div class="grade">
        <${Campo} id="cond" rotulo="Condições de pagamento">${editaInfo ? html`<${Texto} id="cond" valor=${campos.condicoes_pagamento} onMuda=${v => setCampo({ condicoes_pagamento: v })} />` : html`<b>${o.condicoes_pagamento || "—"}</b>`}</${Campo}>
        <div class="campo"><label>Forma de pagamento</label><b>${o.forma_pagamento || "informada na entrega"}</b></div>
      </div>
      <div class="kv"><div><span>Recebido</span><b class=${recebido > 0 ? "c-ok" : ""}>${reais(recebido)}</b></div><div><span>Saldo</span><b class=${saldo > 0 && st === "entregue" ? "c-bad" : ""}>${reais(saldo)}</b></div></div>
      ${recibos.length ? html`<div class="lista">${recibos.map(r => html`<button type="button" key=${r.id} class=${"linha" + (r.cancelado ? " inativo" : "")} onClick=${() => ir("/imprimir/recibo/" + r.id)}>
        <span class="meio"><strong>${numRecibo(r.numero)}${r.cancelado ? " · cancelado" : ""}</strong><span>${fmtData(r.data)} · ${r.forma}${r.obs ? " · " + r.obs : ""}</span></span><b>${reais(r.valor)}</b></button>`)}</div>` : null}
      ${pode(perfil, "entregar") && tAtual.total > 0 && st !== "cancelado" ? html`<button type="button" class="btn" disabled=${saldo <= 0} onClick=${() => setModal({ tipo: "recibo" })}>${saldo > 0 ? "Emitir recibo de pagamento" + (st !== "entregue" ? " (sinal / adiantamento)" : "") : "Pagamento quitado"}</button>` : null}
    </section>` : null}`;

  /* ===== aba Observações ===== */
  const podeObsExec = (st === "execucao" && pode(perfil, "executar")) || editaInfo;
  const abaObs = html`
    <section class="card"><h3>Serviços executados / observações gerais</h3><span class="dica">Saem na impressão da O.S.</span>
      ${podeObsExec ? html`<${Area} id="obs-exec" placeholder="Peças trocadas, medições, recomendações ao cliente para as próximas revisões." valor=${campos.obs_execucao} onMuda=${v => setCampo({ obs_execucao: v })} />` : html`<p class="texto-pre">${o.obs_execucao || "—"}</p>`}</section>
    ${gestor ? html`<section class="card"><h3>Observações internas</h3><span class="dica">Não saem na impressão.</span>
      ${editaInfo ? html`<${Area} id="obs-int" valor=${campos.obs_internas} onMuda=${v => setCampo({ obs_internas: v })} />` : html`<p class="texto-pre">${o.obs_internas || "—"}</p>`}</section>` : null}
    ${execOn ? html`<section class="card"><div class="secao-topo"><h3>Fotos do serviço</h3>
      ${st === "execucao" ? html`<label class="btn btn-sm" for="foto-exec">${ocupado === "foto" ? "Enviando…" : "+ Foto"}</label><input id="foto-exec" class="vh" type="file" accept="image/*" capture="environment" onChange=${e => { const a = e.target.files[0]; e.target.value = ""; if (a) enviarFotoExec(a); }} />` : null}</div>
      ${(o.fotos || []).filter(f => f.etapa !== "entrada").length ? html`<div class="fotos">${o.fotos.filter(f => f.etapa !== "entrada").map(f => html`<button type="button" class="foto" key=${f.id} onClick=${() => setModal({ tipo: "foto", f })}><div class="img"><${Foto} caminho=${f.caminho} alt=${f.rotulo} /></div><div class="rot">${f.rotulo}</div></button>`)}</div>`
        : html`<span class="dica">Fotos de peças substituídas e do serviço feito ajudam a justificar o orçamento e a garantia.</span>`}</section>` : null}
    ${st === "entregue" ? html`<section class="card"><h3>Entrega</h3><div class="kv"><div><span>Entregue em</span><b>${fmtDataHora(o.entregue_em)}</b></div><div><span>KM saída</span><b>${fmtKm(o.km_saida)}</b></div>
      <div><span>Pagamento</span><b>${o.forma_pagamento || "—"}</b></div><div><span>Garantia</span><b>${o.garantia_dias} dias · até ${fmtData(somaDias(o.entregue_em, o.garantia_dias))}</b></div></div>
      ${o.assinatura_entrega ? html`<${Foto} caminho=${o.assinatura_entrega} alt="Assinatura na retirada" class="img-assin" />` : null}</section>` : null}`;

  /* ===== aba Checklist ===== */
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
      <div class="kv"><div><span>KM</span><b>${fmtKm(o.km_entrada)}${ck.kmDivergente ? " ⚠" : ""}</b></div>
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
    <div class="acoes">
      ${gestor && !["entregue", "cancelado"].includes(st) ? html`<button type="button" class="btn btn-perigo" onClick=${cancelar}>Cancelar O.S.</button>` : null}
      ${pode(perfil, "ajustes") && ["entregue", "cancelado", "recusado"].includes(st) ? html`<button type="button" class="btn" onClick=${reabrir}>Reabrir O.S.</button>` : null}
      ${pode(perfil, "excluir") ? html`<button type="button" class="btn-link perigo" onClick=${excluir}>Excluir O.S. definitivamente</button>` : null}</div>`;

  const nItens = itens.filter(i => i.aprovado !== false).length;
  const abas = [["principal", "Principais informações"], ["veiculo", "Veículo"], ["itens", "Produtos e serviços" + (nItens ? " (" + nItens + ")" : "")], ["obs", "Observações"], ["entrada", ck.feito ? "Checklist ✓" : "Checklist"], ["historico", "Histórico"]];
  const corpo = { principal: abaPrincipal, veiculo: abaVeiculo, itens: abaItens, obs: abaObs, entrada: abaEntrada, historico: abaHist }[aba] || abaPrincipal;
  const podeSalvar = sujo && (editaInfo || st === "execucao");
  return html`<div class="pagina">
    <button type="button" class="btn-link voltar" onClick=${() => history.length > 1 ? history.back() : ir("/ordens")}>← Voltar</button>
    <section class="card cab-os">
      <div class="det-cab"><button type="button" class="botao-limpo" title="Ficha do veículo" disabled=${!o.veiculo_id} onClick=${() => ir("/veiculo/" + o.veiculo_id)}><${Placa} placa=${o.veiculo.placa} grande /></button><div class="meio"><h2>${o.veiculo.marca} ${o.veiculo.modelo} ${o.veiculo.ano}</h2>
        <div class="sub">${numOS(o.numero)} · entrada ${fmtDataHora(o.criado_em)} · há ${tempoDesde(o.criado_em)}${o.box ? " · box " + o.box : ""}</div></div><div class="pills"><${Status} s=${st} />${o.situacao ? html`<span class="pill p-info">${o.situacao}</span>` : null}</div></div>
      <div class="cli-linha"><div>${o.cliente_id ? html`<button type="button" class="btn-link nome-cli" onClick=${() => ir("/cliente/" + o.cliente_id)}>${o.cliente.nome}</button>` : html`<b>${o.cliente.nome}</b>`}<span>${fmtTel(o.cliente.telefone)}${o.cliente.doc ? " · " + fmtDoc(o.cliente.doc) : ""}</span></div>
        ${o.cliente.telefone ? html`<a class="btn btn-sm btn-whats" href=${linkWhats(o.cliente.telefone, "Olá, " + primeiroNome(o) + "! ")} target="_blank" rel="noopener">${I.whats} WhatsApp</a>` : null}</div>
      ${legado ? html`<div class="info">O.S. ${legado.numero} importada do OS Oficina 3.0${legado.situacao ? " · situação no sistema anterior: " + legado.situacao : ""}.</div>` : null}
      ${!ck.feito && !legado && podeCk ? html`<div class="aviso ck-aviso"><span>Checklist de entrada não realizado.</span><button type="button" class="btn btn-sm" onClick=${() => ir("/os/" + o.id + "/checklist")}>Fazer agora</button></div>` : null}
      ${passo >= 0 ? html`<ol class="trilha">${FLUXO.map((s, n) => html`<li key=${s} class=${n < passo ? "feito" : n === passo ? "atual" : ""}>${STATUS[s].curto}</li>`)}</ol>` : html`<div class=${st === "recusado" ? "aviso" : "info"}>${STATUS[st].t}${st === "recusado" && o.entregue_em ? " · veículo retirado em " + fmtDataHora(o.entregue_em) : ""}</div>`}
      ${acoes.length ? html`<div class="acoes">${acoes}</div>` : null}
      <div class="docs"><span class="sub">Documentos:</span>
        <button type="button" class="btn-link" disabled=${!!ocupado} onClick=${imprimir}>Imprimir O.S.</button>
        ${ck.feito ? html`<button type="button" class="btn-link" disabled=${!!ocupado} onClick=${() => documento("entrada")}>${ocupado === "pdf-entrada" ? "Gerando…" : "Checklist (PDF)"}</button>` : null}
        ${verValores && itens.length ? html`<button type="button" class="btn-link" disabled=${!!ocupado} onClick=${() => documento("orcamento")}>${ocupado === "pdf-orcamento" ? "Gerando…" : "Orçamento (PDF)"}</button>` : null}
        ${verValores && aprovadoAlgum ? html`<button type="button" class="btn-link" disabled=${!!ocupado} onClick=${() => documento("os")}>${ocupado === "pdf-os" ? "Gerando…" : "O.S. (PDF)"}</button>` : null}
        ${verValores && recibos.some(r => !r.cancelado) ? html`<button type="button" class="btn-link" onClick=${() => setAba("itens")}>Recibos (${recibos.filter(r => !r.cancelado).length})</button>` : null}
        ${st === "diagnostico" && o.cliente.telefone ? html`<button type="button" class="btn-link" onClick=${() => whats("entrada")}>Avisar recebimento</button>` : null}
      </div>
    </section>
    <${Abas} abas=${abas} ativa=${aba} onTroca=${setAba} />
    ${corpo}
    ${podeSalvar ? html`<div class="rodape-acoes"><div class="in"><button type="button" class="btn" onClick=${carregar}>Descartar alterações</button><button type="button" class="btn btn-pri" disabled=${!!ocupado} onClick=${() => acao("salvar", () => salvar())}>${ocupado === "salvar" ? "Salvando…" : "Salvar O.S."}</button></div></div>` : null}

    ${modal && modal.tipo === "item" ? html`<${ItemModal} item=${modal.item} tabela=${campos.tabela_preco || "vista"} onFechar=${() => setModal(null)} onSalvar=${salvarItem} onExcluir=${() => excluirItem(modal.item)} />` : null}
    ${modal && modal.tipo === "aprovar" ? html`<${AprovacaoModal} o=${o} pendentes=${pendentes} onFechar=${() => setModal(null)} onConfirmar=${confirmarAprovacao} />` : null}
    ${modal && modal.tipo === "entrega" ? html`<${EntregaModal} o=${{ ...o, total: tAprov.total }} cfg=${cfg} saldo=${arred(Math.max(0, tAprov.total - recebido))} onFechar=${() => setModal(null)} onConfirmar=${confirmarEntrega} />` : null}
    ${modal && modal.tipo === "recibo" ? html`<${ReciboModal} ordem=${{ ...o, total: tAtual.total }} valor=${saldo} forma=${modal.forma || o.forma_pagamento} onFechar=${() => setModal(null)} onEmitido=${r => { setModal(null); ir("/imprimir/recibo/" + r.id); }} />` : null}
    ${modal && modal.tipo === "imprimir" ? html`<${ImprimirModal} o=${o} verValores=${verValores} onFechar=${() => setModal(null)} />` : null}
    ${modal && modal.tipo === "cliente" ? html`<${Modal} titulo="Trocar cliente da O.S." onFechar=${() => setModal(null)}><${BuscaCliente} id="os-cli" valor="" onEscolha=${trocarCliente} /></${Modal}>` : null}
    ${modal && modal.tipo === "veiculo" && vCad ? html`<${FormVeiculo} ed=${modal.ed || edVeiculo(vCad)} setEd=${ed => {
      if (ed === null) { setModal(null); return; }
      setModal(m => ({ ...m, ed: typeof ed === "function" ? ed(m.ed || edVeiculo(vCad)) : ed })); }}
      onSalvo=${async v => { if (aberta && v) { const veiculo = { ...o.veiculo, placa: v.placa, marca: v.marca, modelo: v.modelo, ano: v.ano, cor: v.cor, motor: v.combustivel || v.motor || "" }; await api.atualizarOrdem(o.id, { veiculo }); setO(x => ({ ...x, veiculo })); recarregar(["ordens"]); } }} />` : null}
    ${modal && modal.tipo === "foto" ? html`<div class="visor" onClick=${() => setModal(null)} role="dialog" aria-label="Foto ampliada"><${Foto} caminho=${modal.f.caminho} alt=${modal.f.rotulo} /><p>${modal.f.rotulo} · toque para fechar</p></div>` : null}
    ${modal && modal.tipo === "enviar" && modal.qual ? html`<${Modal} titulo=${{ orcamento: "Orçamento pronto para envio", pronto: "Serviço concluído", entrega: "Entrega registrada" }[modal.qual]} onFechar=${() => setModal(null)}>
      <p>${{ orcamento: "Envie a mensagem com o resumo e, em seguida, o PDF do orçamento.", pronto: "Avise o cliente que o veículo está pronto para retirada.", entrega: "Envie a ordem de serviço com a garantia para o cliente." }[modal.qual]}</p>
      <div class="acoes col">
        ${o.cliente.telefone ? html`<button type="button" class="btn btn-whats" onClick=${() => whats(modal.qual)}>${I.whats} Abrir WhatsApp com a mensagem</button>` : html`<span class="aviso">Cliente sem telefone cadastrado.</span>`}
        ${modal.qual === "orcamento" ? html`<button type="button" class="btn" onClick=${() => documento("orcamento")}>PDF do orçamento</button>` : null}
        ${modal.qual === "entrega" ? html`<button type="button" class="btn" onClick=${() => documento("os")}>PDF da ordem de serviço</button><button type="button" class="btn" onClick=${() => setModal({ tipo: "imprimir" })}>Imprimir O.S.</button>` : null}
        <button type="button" class="btn-link" onClick=${() => setModal(null)}>Fechar</button></div></${Modal}>` : null}
  </div>`;
}
