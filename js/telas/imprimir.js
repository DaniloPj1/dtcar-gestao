// Impressão: O.S. (A4 ou cupom 80 mm), recibo de pagamento e fichas cadastrais (cliente e veículo)
import { html, useState, useEffect } from "../lib.js";
import { api } from "../api.js";
import { useApp, Foto } from "../ui.js";
import { fmtDoc, fmtTel, fmtKm, fmtDataHora, fmtData, reais, qtdFmt, totais, totalItem, numOS, somaDias, exPlaca, extenso, endCompleto } from "../util.js";
import { STATUS, pode, TERMO_GARANTIA, TERMO_ORCAMENTO, SITUACAO_CLIENTE, TABELAS_PRECO } from "../regras.js";

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const dataExtenso = iso => { const d = /^\d{4}-\d{2}-\d{2}$/.test(iso || "") ? new Date(iso + "T12:00:00") : new Date(iso || Date.now()); return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`; };
const n5 = n => String(n ?? "").padStart(5, "0");

function Cabecalho({ titulo, numero, direita }) {
  const { cfg } = useApp();
  return html`<header class="imp-cab">
    <div class="imp-logo">${cfg.logo ? html`<${Foto} caminho=${cfg.logo} alt="Logotipo" />` : html`<img src="icons/logo-preto.png" alt="DTCar Centro Automotivo" />`}</div>
    <div class="imp-emp"><b>${cfg.nome}</b>${cfg.endereco ? html`<span>${cfg.endereco}</span>` : null}
      <span>${[cfg.telefone ? "Tel. " + cfg.telefone : "", cfg.cnpj ? "CNPJ " + cfg.cnpj : ""].filter(Boolean).join(" · ")}</span></div>
    <div class="imp-tit"><b>${titulo}</b>${numero ? html`<strong>Nº ${numero}</strong>` : null}${direita}</div>
  </header>`;
}
const Par = ({ r, v, largo }) => html`<div class=${"imp-par" + (largo ? " largo" : "")}><span>${r}</span><b>${v || "—"}</b></div>`;
function Assinatura({ nome, img, rotulo }) {
  return html`<div class="imp-assin">${img ? html`<${Foto} caminho=${img} alt="Assinatura" />` : html`<div class="imp-linha-assin"></div>`}<span>${rotulo}${nome ? ": " + nome : ""}</span></div>`;
}

/* ---------------- O.S. em A4 ---------------- */
function TabelaItens({ titulo, itens, valores, comRef, total }) {
  if (!itens.length) return null;
  return html`<table class="imp-tab"><thead><tr>${comRef ? html`<th class="ref">Referência</th>` : null}<th>${titulo}</th><th class="num">Qtd.</th>
    ${valores ? html`<th class="num">Valor</th><th class="num">Desc.</th><th class="num">Total</th>` : null}</tr></thead>
    <tbody>${itens.map(i => html`<tr key=${i.id}>${comRef ? html`<td class="ref">${i.codigo || ""}</td>` : null}
      <td>${i.descricao}${i.fornecida_cliente ? " (peça do cliente)" : i.qualidade === "usada" ? " (usada, autorizada pelo cliente)" : ""}${i.aprovado === false ? " — não aprovado" : ""}</td>
      <td class="num">${i.horas ? qtdFmt(i.horas) + " h" : qtdFmt(i.qtd)}</td>
      ${valores ? html`<td class="num">${i.fornecida_cliente ? "—" : reais(i.valor_unit)}</td><td class="num">${Number(i.desconto) ? reais(i.desconto) : ""}</td><td class="num">${i.fornecida_cliente || i.aprovado === false ? "—" : reais(totalItem(i))}</td>` : null}</tr>`)}</tbody>
    ${valores ? html`<tfoot><tr><td colspan=${comRef ? 5 : 4}>${total[0]}</td><td class="num">${reais(total[1])}</td></tr></tfoot>` : null}</table>`;
}

function ViaOS({ o, cli, vei, valores, via, nVias }) {
  const { cfg } = useApp();
  const orc = ["diagnostico", "aguardando", "recusado"].includes(o.status) && !o.itens.some(i => i.aprovado === true && o.status !== "recusado");
  const aprov = ["execucao", "pronto", "entregue", "recusado"].includes(o.status);
  const lista = o.itens.filter(i => aprov ? i.aprovado !== false : true);
  const t = totais(o.itens, o.desconto, aprov);
  const ck = o.checkin || {};
  const termo = orc ? (cfg.termoOrcamento || TERMO_ORCAMENTO) : (cfg.termoGarantia || TERMO_GARANTIA).replace("{dias}", o.garantia_dias || cfg.garantiaDias || 90);
  const tels = [o.cliente.telefone, cli && cli.telefone2].filter(Boolean).map(fmtTel).join(" / ");
  return html`<article class="folha">
    <${Cabecalho} titulo=${orc ? "ORÇAMENTO" : "ORDEM DE SERVIÇO"} numero=${n5(o.numero)} direita=${html`<span>Entrada: ${fmtDataHora(o.criado_em)}</span>${nVias > 1 ? html`<em>${via === 1 ? "1ª via – Cliente" : "2ª via – Oficina"}</em>` : null}`} />
    <section class="imp-bloco"><h4>Cliente</h4><div class="imp-grade">
      <${Par} r="Cliente" v=${o.cliente.nome + (cli && cli.codigo ? " (cód. " + cli.codigo + ")" : "")} largo /><${Par} r="CPF/CNPJ" v=${fmtDoc(o.cliente.doc || (cli && cli.doc))} />
      <${Par} r="Endereço" v=${(cli && [cli.rua, cli.complemento].filter(Boolean).join(" ")) || o.cliente.endereco} largo /><${Par} r="Bairro" v=${cli && cli.bairro} />
      <${Par} r="Cidade" v=${cli && [cli.cidade, cli.uf].filter(Boolean).join(" - ")} /><${Par} r="CEP" v=${cli && cli.cep} /><${Par} r="Telefone" v=${tels} /><${Par} r="Contato" v=${o.contato || (cli && cli.contato)} />
    </div></section>
    <section class="imp-bloco"><h4>Veículo</h4><div class="imp-grade">
      <${Par} r="Placa" v=${exPlaca(o.veiculo.placa)} /><${Par} r="Marca" v=${o.veiculo.marca} /><${Par} r="Modelo" v=${o.veiculo.modelo} /><${Par} r="Cor" v=${o.veiculo.cor} />
      <${Par} r="Ano" v=${o.veiculo.ano} /><${Par} r="KM atual" v=${o.km_entrada != null ? fmtKm(o.km_entrada) : ""} /><${Par} r="Combustível" v=${(vei && vei.combustivel) || o.veiculo.motor} /><${Par} r="Box" v=${o.box} />
      ${vei && vei.chassi ? html`<${Par} r="Chassi" v=${vei.chassi} />` : null}${o.combustivel ? html`<${Par} r="Nível combustível" v=${o.combustivel} />` : null}
    </div>${ck.feito ? html`<p class="imp-nota">Checklist de entrada realizado em ${fmtDataHora(ck.em)}${ck.observacoes ? ": " + ck.observacoes : "."}</p>` : null}</section>
    ${o.reclamacao ? html`<section class="imp-bloco"><h4>Defeito reclamado</h4><p class="texto-pre">${o.reclamacao}</p></section>` : null}
    ${o.diagnostico ? html`<section class="imp-bloco"><h4>Defeito constatado / diagnóstico</h4><p class="texto-pre">${o.diagnostico}</p></section>` : null}
    <${TabelaItens} titulo="Produtos / peças" itens=${lista.filter(i => i.tipo === "peca")} valores=${valores} comRef total=${["Total das peças", t.pecas]} />
    <${TabelaItens} titulo="Serviços / mão de obra" itens=${lista.filter(i => i.tipo === "servico")} valores=${valores} total=${["Total dos serviços", t.servicos]} />
    <${TabelaItens} titulo="Outros valores" itens=${lista.filter(i => i.tipo === "terceiro")} valores=${valores} total=${["Total de outros valores", t.terceiros]} />
    ${o.obs_execucao ? html`<section class="imp-bloco"><h4>Serviços executados / observações</h4><p class="texto-pre">${o.obs_execucao}</p></section>` : null}
    <section class="imp-resumo">
      <div class="imp-grade">
        <${Par} r="Responsável" v=${o.mecanico_nome} /><${Par} r="Consultor" v=${o.consultor_nome} />
        <${Par} r="Situação atual" v=${STATUS[o.status].t + (o.situacao ? " · " + o.situacao : "")} />
        <${Par} r=${o.status === "entregue" ? "Entrega" : "Previsão"} v=${o.status === "entregue" ? fmtDataHora(o.entregue_em) : o.previsao_entrega ? fmtData(o.previsao_entrega) + (o.previsao_hora ? " " + o.previsao_hora : "") : "a combinar"} />
        <${Par} r="Forma de pagamento" v=${o.forma_pagamento} /><${Par} r="Condições" v=${o.condicoes_pagamento} />
        ${orc && o.validade_orcamento ? html`<${Par} r="Validade do orçamento" v=${fmtData(o.validade_orcamento)} />` : null}
        ${o.tabela_preco && o.tabela_preco !== "vista" ? html`<${Par} r="Tabela de preços" v=${TABELAS_PRECO[o.tabela_preco]} />` : null}
      </div>
      ${valores ? html`<div class="imp-totais"><div><span>Valor dos produtos</span><b>${reais(t.pecas)}</b></div><div><span>Valor dos serviços</span><b>${reais(t.servicos)}</b></div>
        ${t.terceiros ? html`<div><span>Outros valores</span><b>${reais(t.terceiros)}</b></div>` : null}<div><span>Desconto</span><b>${reais(t.desconto)}</b></div>
        <div class="tot"><span>VALOR TOTAL</span><b>${reais(t.total)}</b></div></div>` : null}
    </section>
    <p class="imp-termo">${termo}${!orc && o.status === "entregue" ? " Garantia válida até " + fmtData(somaDias(o.entregue_em, o.garantia_dias)) + "." : ""}</p>
    ${orc ? html`<div class="imp-autoriza"><p>Autorizo a execução do(s) serviço(s) nas condições acima discriminadas.</p><p class="imp-marcar">(   ) Aprovado      (   ) Reprovado</p>
        <div class="imp-assins"><${Assinatura} rotulo="Assinatura do cliente" nome=${o.cliente.nome} /><div class="imp-data">Data: ____/____/________</div></div></div>`
      : html`${o.aprovacao ? html`<p class="imp-nota">Serviços autorizados por ${o.aprovacao.por} em ${fmtDataHora(o.aprovacao.em)} (${o.aprovacao.forma}).</p>` : null}
        <div class="imp-assins"><${Assinatura} rotulo="Cliente" nome=${o.cliente.nome} img=${o.assinatura_entrega} /><${Assinatura} rotulo="Visto da oficina" /></div>
        <p class="imp-nota">Declaro ter recebido o veículo com os serviços executados e testados, nas condições acima.</p>`}
    <footer class="imp-rodape">Este documento não vale como recibo de pagamento.</footer>
  </article>`;
}

/* ---------------- O.S. em cupom 80 mm ---------------- */
function CupomOS({ o, valores }) {
  const { cfg } = useApp();
  const aprov = ["execucao", "pronto", "entregue", "recusado"].includes(o.status);
  const lista = o.itens.filter(i => aprov ? i.aprovado === true : i.aprovado !== false);
  const t = totais(o.itens, o.desconto, aprov);
  return html`<article class="cupom">
    <b class="c-centro">${cfg.nome}</b>${cfg.endereco ? html`<div class="c-centro">${cfg.endereco}</div>` : null}<div class="c-centro">${[cfg.telefone, cfg.cnpj ? "CNPJ " + cfg.cnpj : ""].filter(Boolean).join(" · ")}</div>
    <hr /><b>${aprov ? "ORDEM DE SERVIÇO" : "ORÇAMENTO"} ${n5(o.numero)}</b><div>Entrada: ${fmtDataHora(o.criado_em)}</div>
    <div>Cliente: ${o.cliente.nome}</div>${o.cliente.telefone ? html`<div>Tel.: ${fmtTel(o.cliente.telefone)}</div>` : null}
    <hr /><div>Placa: ${exPlaca(o.veiculo.placa)}  ${o.veiculo.marca} ${o.veiculo.modelo}</div><div>Ano: ${o.veiculo.ano || "—"}  Cor: ${o.veiculo.cor || "—"}</div><div>KM: ${fmtKm(o.km_entrada)}${o.box ? "  Box: " + o.box : ""}</div>
    <hr />${lista.map(i => html`<div class="c-item" key=${i.id}><div>${i.descricao}</div>${valores ? html`<div class="c-dir">${i.horas ? qtdFmt(i.horas) + " h" : qtdFmt(i.qtd)} x ${reais(i.valor_unit)}${Number(i.desconto) ? " - " + reais(i.desconto) : ""} = ${reais(totalItem(i))}</div>` : html`<div class="c-dir">${qtdFmt(i.qtd)}</div>`}</div>`)}
    ${valores ? html`<hr /><div class="c-lin"><span>Produtos</span><span>${reais(t.pecas)}</span></div><div class="c-lin"><span>Serviços</span><span>${reais(t.servicos)}</span></div>
      ${t.terceiros ? html`<div class="c-lin"><span>Outros</span><span>${reais(t.terceiros)}</span></div>` : null}${t.desconto ? html`<div class="c-lin"><span>Desconto</span><span>${reais(t.desconto)}</span></div>` : null}
      <div class="c-lin c-tot"><span>TOTAL</span><span>${reais(t.total)}</span></div>` : null}
    <hr /><div>Situação: ${STATUS[o.status].t}${o.situacao ? " · " + o.situacao : ""}</div>${o.forma_pagamento ? html`<div>Pagamento: ${o.forma_pagamento}</div>` : null}
    ${o.mecanico_nome ? html`<div>Responsável: ${o.mecanico_nome}</div>` : null}
    <div class="c-centro c-peq">Este documento não vale como recibo de pagamento.</div><div class="c-assin">Visto: ________________________</div>
  </article>`;
}

/* ---------------- Recibo ---------------- */
function ViaRecibo({ r, via, nVias }) {
  const { cfg } = useApp();
  return html`<article class=${"folha recibo" + (r.cancelado ? " cancelado" : "")}>
    <${Cabecalho} titulo="RECIBO" numero=${n5(r.numero)} direita=${nVias > 1 ? html`<em>${via === 1 ? "1ª via – Cliente" : "2ª via – Oficina"}</em>` : null} />
    <div class="rec-valor"><span>VALOR DO RECIBO</span><b>${reais(r.valor)}</b></div>
    <p class="rec-texto">Recebemos de <b>${r.pagador}</b>${r.doc ? html`, CPF/CNPJ <b>${fmtDoc(r.doc)}</b>` : null}, a importância de <b>${reais(r.valor)}</b> (${extenso(r.valor)}),
      referente a ${r.referente}${r.forma ? html`, pago em <b>${r.forma === r.forma.toUpperCase() ? r.forma : r.forma.charAt(0).toLowerCase() + r.forma.slice(1)}</b>` : null}.</p>
    ${r.obs ? html`<p class="rec-texto">Observação: ${r.obs}</p>` : null}
    <p class="rec-texto">${cfg.textoRecibo}</p>
    <p class="rec-local">${(cfg.cidade || "Colatina-ES")}, ${dataExtenso(r.data)}.</p>
    <div class="imp-assins rec-assins"><div class="imp-assin"><div class="imp-linha-assin"></div><span>${cfg.nome}${cfg.cnpj ? " · CNPJ " + cfg.cnpj : ""}</span></div></div>
    ${r.cancelado ? html`<div class="rec-cancelado">CANCELADO${r.cancelado_motivo ? html`<small>${r.cancelado_motivo}</small>` : null}</div>` : null}
    <footer class="imp-rodape">Emitido por ${r.emitido_por || "—"} em ${fmtDataHora(r.criado_em)}.</footer>
  </article>`;
}

/* ---------------- Fichas cadastrais ---------------- */
function FichaCliente({ c }) {
  const { dados, perfil } = useApp();
  const f = c.ficha || {}, ver = pode(perfil, "verValores");
  const veics = dados.veiculos.filter(v => v.cliente_id === c.id);
  const os = dados.ordens.filter(o => o.cliente_id === c.id && o.status !== "cancelado");
  const gasto = os.filter(o => o.status === "entregue").reduce((s, o) => s + Number(o.total || 0), 0);
  return html`<article class="folha">
    <${Cabecalho} titulo="FICHA CADASTRAL DO CLIENTE" numero=${c.codigo} direita=${html`<span>Cadastro: ${fmtData(c.criado_em)}</span>`} />
    <section class="imp-bloco"><h4>Identificação</h4><div class="imp-grade">
      <${Par} r="Nome / razão social" v=${c.nome} largo /><${Par} r="Nome fantasia" v=${c.fantasia} /><${Par} r="Situação" v=${(SITUACAO_CLIENTE[c.situacao] || {}).t + (c.restricao ? " – " + c.restricao : "")} />
      <${Par} r="CPF/CNPJ" v=${fmtDoc(c.doc)} /><${Par} r="RG" v=${[c.rg, c.orgao_emissor].filter(Boolean).join(" ")} /><${Par} r="Insc. estadual" v=${c.ie} /><${Par} r="Insc. municipal" v=${c.im} />
      <${Par} r="Nascimento" v=${c.nascimento ? fmtData(c.nascimento) : ""} /><${Par} r="Tipo de cliente" v=${c.tipo_cliente} /><${Par} r="Como conheceu" v=${c.origem} /></div></section>
    <section class="imp-bloco"><h4>Endereço e contatos</h4><div class="imp-grade">
      <${Par} r="Endereço" v=${endCompleto(c)} largo /><${Par} r="Celular / WhatsApp" v=${fmtTel(c.telefone)} /><${Par} r="Telefone 2" v=${fmtTel(c.telefone2)} /><${Par} r="Telefone 3" v=${fmtTel(c.telefone3)} />
      <${Par} r="E-mail" v=${c.email} /><${Par} r="Contato" v=${c.contato} /></div></section>
    <section class="imp-bloco"><h4>Filiação e avaliação financeira</h4><div class="imp-grade">
      <${Par} r="Sexo" v=${f.sexo} /><${Par} r="Estado civil" v=${f.estado_civil} /><${Par} r="Pai" v=${f.pai} /><${Par} r="Mãe" v=${f.mae} /><${Par} r="Cônjuge" v=${f.conjuge} />
      <${Par} r="Naturalidade" v=${f.naturalidade} /><${Par} r="Nacionalidade" v=${f.nacionalidade} /><${Par} r="Profissão" v=${f.profissao} /><${Par} r="Local de trabalho" v=${f.trabalho} />
      <${Par} r="Tel. trabalho" v=${fmtTel(f.tel_trabalho)} /><${Par} r="Melhor horário" v=${f.melhor_horario} />
      ${ver ? html`<${Par} r="Renda" v=${f.renda ? reais(f.renda) : ""} /><${Par} r="Limite de crédito" v=${f.limite ? reais(f.limite) : ""} />` : null}<${Par} r="Avaliado por" v=${f.avaliador} /></div></section>
    <section class="imp-bloco"><h4>Veículos (${veics.length})</h4>${veics.length ? html`<table class="imp-tab"><thead><tr><th>Placa</th><th>Veículo</th><th>Ano</th><th>Cor</th><th class="num">KM</th></tr></thead>
      <tbody>${veics.map(v => html`<tr key=${v.id}><td>${exPlaca(v.placa)}</td><td>${v.marca} ${v.modelo}</td><td>${v.ano}</td><td>${v.cor}</td><td class="num">${fmtKm(v.km_atual)}</td></tr>`)}</tbody></table>` : html`<p>Nenhum veículo vinculado.</p>`}</section>
    <section class="imp-bloco"><h4>Atendimentos</h4><div class="imp-grade"><${Par} r="O.S." v=${String(os.length)} />${ver ? html`<${Par} r="Total em serviços" v=${reais(gasto)} />` : null}
      <${Par} r="Última O.S." v=${os[0] ? numOS(os[0].numero) + " em " + fmtData(os[0].criado_em) : ""} /></div></section>
    ${c.obs ? html`<section class="imp-bloco"><h4>Observações</h4><p class="texto-pre">${c.obs}</p></section>` : null}
    ${c.historico ? html`<section class="imp-bloco"><h4>Histórico</h4><p class="texto-pre">${c.historico}</p></section>` : null}
  </article>`;
}
function FichaVeiculo({ v }) {
  const { dados, perfil } = useApp();
  const [itens, setItens] = useState(null);
  const ver = pode(perfil, "verValores");
  const dono = dados.clientes.find(c => c.id === v.cliente_id);
  const os = dados.ordens.filter(o => o.veiculo_id === v.id && o.status === "entregue").sort((a, b) => (b.entregue_em || "").localeCompare(a.entregue_em || ""));
  useEffect(() => { if (!os.length) { setItens([]); return; } api.itensDasOrdens(os.map(o => o.id)).then(setItens).catch(() => setItens([])); }, [v.id]);
  return html`<article class="folha">
    <${Cabecalho} titulo="FICHA CADASTRAL DO VEÍCULO" numero=${exPlaca(v.placa)} direita=${html`<span>Cadastro: ${fmtData(v.criado_em)}</span>`} />
    <section class="imp-bloco"><h4>Veículo</h4><div class="imp-grade">
      <${Par} r="Placa" v=${exPlaca(v.placa)} /><${Par} r="Marca" v=${v.marca} /><${Par} r="Modelo" v=${v.modelo} /><${Par} r="Ano fab./mod." v=${v.ano} /><${Par} r="Cor" v=${v.cor} />
      <${Par} r="Combustível" v=${v.combustivel} /><${Par} r="Motor" v=${v.motor} /><${Par} r="Chassi" v=${v.chassi} /><${Par} r="Renavam" v=${v.renavam} /><${Par} r="KM atual" v=${fmtKm(v.km_atual)} /></div></section>
    <section class="imp-bloco"><h4>Proprietário</h4><div class="imp-grade"><${Par} r="Nome" v=${dono ? dono.nome + " (cód. " + dono.codigo + ")" : ""} largo /><${Par} r="Telefone" v=${dono ? fmtTel(dono.telefone) : ""} /><${Par} r="Motorista" v=${v.motorista} /></div></section>
    <section class="imp-bloco"><h4>Manutenção programada</h4><div class="imp-grade">
      <${Par} r="Revisão" v=${[v.revisao_data ? fmtData(v.revisao_data) : "", v.revisao_km ? fmtKm(v.revisao_km) : ""].filter(Boolean).join(" · ")} />
      <${Par} r="Troca de óleo" v=${[v.oleo_data ? fmtData(v.oleo_data) : "", v.oleo_km ? fmtKm(v.oleo_km) : ""].filter(Boolean).join(" · ")} />
      <${Par} r="Troca de filtros" v=${[v.filtro_data ? fmtData(v.filtro_data) : "", v.filtro_km ? fmtKm(v.filtro_km) : ""].filter(Boolean).join(" · ")} /></div></section>
    ${v.obs ? html`<section class="imp-bloco"><h4>Observações</h4><p class="texto-pre">${v.obs}</p></section>` : null}
    <section class="imp-bloco"><h4>Serviços executados (${os.length})</h4>
      ${!itens ? html`<p>Carregando…</p>` : os.length ? html`<table class="imp-tab"><thead><tr><th>O.S.</th><th>Data</th><th class="num">KM</th><th>Itens</th>${ver ? html`<th class="num">Total</th>` : null}</tr></thead>
        <tbody>${os.map(o => html`<tr key=${o.id}><td>${n5(o.numero)}</td><td>${fmtData(o.entregue_em)}</td><td class="num">${o.km_entrada ? fmtKm(o.km_entrada) : ""}</td>
          <td>${itens.filter(i => i.ordem_id === o.id && i.aprovado !== false).map(i => i.descricao).join("; ")}</td>${ver ? html`<td class="num">${reais(o.total)}</td>` : null}</tr>`)}</tbody></table>` : html`<p>Nenhum serviço entregue.</p>`}</section>
  </article>`;
}

/* ---------------- tela de impressão ---------------- */
export function Imprimir({ tipo, id, params }) {
  const { dados, perfil, avisar, confirmar, ir, cfg } = useApp();
  const [doc, setDoc] = useState(null), [erro, setErro] = useState("");
  const [vias, setVias] = useState(Number(params.vias) || (tipo === "recibo" ? 2 : Number(cfg.impressaoVias) || 1));
  const valores = params.valores !== "0" && pode(perfil, "verValores");
  const formato = params.formato === "cupom" ? "cupom" : "a4";
  useEffect(() => {
    if (tipo === "os") api.ordem(id).then(setDoc).catch(e => setErro(e.message));
    else if (tipo === "recibo") api.recibos.um(id).then(setDoc).catch(e => setErro(e.message));
    else if (tipo === "cliente") { const c = dados.clientes.find(x => x.id === id); c ? setDoc(c) : setErro("Cliente não encontrado."); }
    else if (tipo === "veiculo") { const v = dados.veiculos.find(x => x.id === id); v ? setDoc(v) : setErro("Veículo não encontrado."); }
    else setErro("Documento desconhecido.");
  }, [tipo, id]);
  useEffect(() => { const t = document.title; if (doc) document.title = { os: "OS " + n5(doc.numero), recibo: "Recibo " + n5(doc.numero), cliente: "Ficha " + (doc.nome || ""), veiculo: "Ficha " + (doc.placa || "") }[tipo] || t; return () => { document.title = t; }; }, [doc]);
  const voltar = () => history.length > 1 ? history.back() : ir(tipo === "os" ? "/os/" + id : tipo === "recibo" ? "/recibos" : tipo === "cliente" ? "/cliente/" + id : "/veiculo/" + id);
  const cancelarRecibo = async () => {
    if (!await confirmar({ titulo: "Cancelar recibo " + n5(doc.numero), texto: "O recibo continua registrado, marcado como cancelado, e deixa de contar como pagamento recebido.", botao: "Cancelar recibo", perigo: true })) return;
    try { await api.recibos.salvar({ id: doc.id, cancelado: true, cancelado_motivo: "Cancelado por " + perfil.nome + " em " + new Date().toLocaleDateString("pt-BR") });
      if (doc.ordem_id) await api.evento(doc.ordem_id, "recibo", "Recibo " + n5(doc.numero) + " cancelado.", perfil.nome).catch(() => {});
      setDoc(await api.recibos.um(doc.id)); avisar("Recibo cancelado."); } catch (e) { avisar(e.message, true); }
  };
  const cli = doc && tipo === "os" ? dados.clientes.find(c => c.id === doc.cliente_id) : null;
  const vei = doc && tipo === "os" ? dados.veiculos.find(v => v.id === doc.veiculo_id) : null;
  const nVias = formato === "cupom" || tipo === "cliente" || tipo === "veiculo" ? 1 : vias;
  return html`<div class=${"imprimir" + (formato === "cupom" ? " imp-cupom" : "")}>
    ${formato === "cupom" ? html`<style>@page { size: 80mm auto; margin: 3mm; }</style>` : html`<style>@page { size: A4; margin: 9mm; }</style>`}
    <div class="imp-barra so-tela">
      <button type="button" class="btn" onClick=${voltar}>← Voltar</button>
      ${(tipo === "os" && formato === "a4") || tipo === "recibo" ? html`<div class="seg" role="group" aria-label="Vias">${[1, 2].map(n => html`<button type="button" key=${n} aria-pressed=${vias === n ? "true" : "false"} onClick=${() => setVias(n)}>${n} via${n > 1 ? "s" : ""}</button>`)}</div>` : null}
      <span class="espaco"></span>
      ${tipo === "recibo" && doc && !doc.cancelado && pode(perfil, "entregar") ? html`<button type="button" class="btn btn-perigo" onClick=${cancelarRecibo}>Cancelar recibo</button>` : null}
      <button type="button" class="btn btn-pri" disabled=${!doc} onClick=${() => window.print()}>Imprimir / salvar PDF</button>
    </div>
    ${erro ? html`<div class="erros so-tela">${erro}</div>` : !doc ? html`<div class="carregando">Preparando documento…</div>`
      : tipo === "os" ? (formato === "cupom" ? html`<${CupomOS} o=${doc} valores=${valores} />` : Array.from({ length: nVias }, (_, n) => html`<${ViaOS} key=${n} o=${doc} cli=${cli} vei=${vei} valores=${valores} via=${n + 1} nVias=${nVias} />`))
      : tipo === "recibo" ? html`<div class=${"recibos-folha v" + nVias}>${Array.from({ length: nVias }, (_, n) => html`<${ViaRecibo} key=${n} r=${doc} via=${n + 1} nVias=${nVias} />`)}</div>`
      : tipo === "cliente" ? html`<${FichaCliente} c=${doc} />` : html`<${FichaVeiculo} v=${doc} />`}
  </div>`;
}
