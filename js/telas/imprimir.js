// Impressão: O.S. (A4 ou cupom 80 mm), recibo de pagamento, fichas cadastrais (cliente e veículo) e resumo das O.S. em aberto
import { html, useState, useEffect } from "../lib.js";
import { api } from "../api.js";
import { erroDeRede } from "../local.js";
import { useApp, Foto } from "../ui.js";
import { fmtDoc, fmtTel, fmtKm, fmtDataHora, fmtData, reais, qtdFmt, totais, totalItem, numOS, somaDias, exPlaca, extenso, endCompleto } from "../util.js";
import { STATUS, situacaoOS, pode, TERMO_GARANTIA, TERMO_ORCAMENTO, SITUACAO_CLIENTE, TABELAS_PRECO } from "../regras.js";
import { diasDoMes, nomeMes, horasSemana, fmtHoras, VINCULOS, calcularMes, com_encargos } from "../folha.js";
import { dadosDoMes } from "./funcionarios.js";
import { dadosOSRecibo, condicoesGarantia, CUIDADOS_MOTOR, osQuitada } from "../osrecibo.js";
import { etapaNoResumo, marcadaNoResumo, dadosResumoOS, rotuloNoResumo, fechoDaOS } from "../resumoos.js";

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
/** Campo impresso só quando preenchido */
const Par = ({ r, v, largo }) => v === null || v === undefined || String(v).trim() === "" || v === "—" ? null : html`<div class=${"imp-par" + (largo ? " largo" : "")}><span>${r}</span><b>${v}</b></div>`;
/** Campo em linha corrida (quadros compactos de cliente e veículo), só quando preenchido */
const Inl = ({ r, v }) => v === null || v === undefined || String(v).trim() === "" || v === "—" ? null : html`<span class="imp-inl"><span>${r}</span> <b>${v}</b></span>`;
function Assinatura({ nome, img, rotulo }) {
  return html`<div class="imp-assin">${img ? html`<${Foto} caminho=${img} alt="Assinatura" />` : html`<div class="imp-linha-assin"></div>`}<span>${rotulo}${nome ? ": " + nome : ""}</span></div>`;
}

/* ---------------- tabela de itens (colunas só quando usadas) ---------------- */
function TabelaItens({ titulo, itens, valores, total }) {
  if (!itens.length) return null;
  const comRef = itens.some(i => i.codigo), comDesc = valores && itens.some(i => Number(i.desconto) > 0);
  const cols = 2 + (comRef ? 1 : 0) + (valores ? 2 + (comDesc ? 1 : 0) : 0);
  return html`<table class="imp-tab"><thead><tr><th>${titulo}</th>${comRef ? html`<th class="ref">Ref.</th>` : null}<th class="num">Qtd.</th>
    ${valores ? html`<th class="num">Unit.</th>${comDesc ? html`<th class="num">Desc.</th>` : null}<th class="num">Total</th>` : null}</tr></thead>
    <tbody>${itens.map(i => html`<tr key=${i.id}><td>${i.descricao}${i.fornecida_cliente ? " (peça do cliente)" : i.qualidade === "usada" ? " (usada, autorizada)" : ""}</td>${comRef ? html`<td class="ref">${i.codigo || ""}</td>` : null}
      <td class="num">${i.horas ? qtdFmt(i.horas) + " h" : qtdFmt(i.qtd)}</td>
      ${valores ? html`<td class="num">${i.fornecida_cliente ? "—" : reais(i.valor_unit)}</td>${comDesc ? html`<td class="num">${Number(i.desconto) ? reais(i.desconto) : ""}</td>` : null}<td class="num">${i.fornecida_cliente ? "—" : reais(totalItem(i))}</td>` : null}</tr>`)}</tbody>
    ${valores ? html`<tfoot><tr><td colspan=${cols - 1}>${total[0]}</td><td class="num">${reais(total[1])}</td></tr></tfoot>` : null}</table>`;
}

/* ---------------- O.S. em A4: uma folha, só o que foi preenchido ---------------- */
function ViaOS({ o, cli, vei, valores, via, nVias }) {
  const { cfg } = useApp();
  const aprov = ["execucao", "pronto", "entregue", "recusado"].includes(o.status) && o.itens.some(i => i.aprovado === true);
  const orc = !aprov;
  const lista = o.itens.filter(i => aprov ? i.aprovado === true : i.aprovado !== false);
  const t = totais(o.itens, o.desconto, aprov);
  const termo = orc ? (cfg.termoOrcamento || TERMO_ORCAMENTO) : (cfg.termoGarantia || TERMO_GARANTIA).replace("{dias}", o.garantia_dias || cfg.garantiaDias || 90);
  const tels = [o.cliente.telefone, cli && cli.telefone2].filter(Boolean).map(fmtTel).join(" / ");
  const endereco = cli ? endCompleto(cli) : o.cliente.endereco;
  const quando = o.status === "entregue" ? ["Entregue em", fmtDataHora(o.entregue_em)] : o.previsao_entrega ? ["Previsão", fmtData(o.previsao_entrega) + (o.previsao_hora ? " " + o.previsao_hora : "")] : null;
  const linhasTot = [["Produtos", t.pecas], ["Serviços", t.servicos], ["Serviços de terceiros", t.terceiros], ["Desconto", -t.desconto]].filter(([, v]) => Number(v));
  return html`<article class="folha os-a4">
    <${Cabecalho} titulo=${orc ? "ORÇAMENTO" : "ORDEM DE SERVIÇO"} numero=${n5(o.numero)} direita=${html`<span>${fmtDataHora(o.criado_em)}</span>${nVias > 1 ? html`<em>${via === 1 ? "Via do cliente" : "Via da oficina"}</em>` : null}`} />
    <section class="imp-duas imp-comp">
      <div class="imp-bloco"><h4>Cliente</h4>
        <div class="imp-l"><b class="imp-dest">${o.cliente.nome}</b>${cli && cli.codigo ? html`<span class="imp-cod">(cód. ${cli.codigo})</span>` : null}</div>
        <div class="imp-l"><${Inl} r="CPF/CNPJ" v=${fmtDoc(o.cliente.doc || (cli && cli.doc) || "")} /><${Inl} r="Tel." v=${tels} /><${Inl} r="Contato" v=${o.contato} /></div>
        <div class="imp-l"><${Inl} r="End." v=${endereco} /></div></div>
      <div class="imp-bloco"><h4>Veículo</h4>
        <div class="imp-l"><b class="imp-dest">${exPlaca(o.veiculo.placa)}</b><b>${[o.veiculo.marca, o.veiculo.modelo].filter(Boolean).join(" ")}</b></div>
        <div class="imp-l"><${Inl} r="Ano" v=${o.veiculo.ano} /><${Inl} r="Cor" v=${o.veiculo.cor} /><${Inl} r="KM" v=${o.km_entrada != null ? fmtKm(o.km_entrada) : ""} />
          <${Inl} r="Comb." v=${(vei && vei.combustivel) || o.veiculo.motor} /><${Inl} r="Box" v=${o.box} /><${Inl} r="Chassi" v=${vei && vei.chassi} /></div></div>
    </section>
    ${o.reclamacao || o.diagnostico ? html`<section class="imp-bloco imp-texto">
      ${o.reclamacao ? html`<p><b>Reclamação:</b> ${o.reclamacao}</p>` : null}${o.diagnostico ? html`<p><b>Diagnóstico:</b> ${o.diagnostico}</p>` : null}</section>` : null}
    <${TabelaItens} titulo="Produtos e peças" itens=${lista.filter(i => i.tipo === "peca")} valores=${valores} total=${["Total de produtos", t.pecas]} />
    <${TabelaItens} titulo="Serviços" itens=${lista.filter(i => i.tipo === "servico")} valores=${valores} total=${["Total de serviços", t.servicos]} />
    <${TabelaItens} titulo="Serviços de terceiros" itens=${lista.filter(i => i.tipo === "terceiro")} valores=${valores} total=${["Total de serviços de terceiros", t.terceiros]} />
    ${o.obs_execucao ? html`<section class="imp-bloco imp-texto"><p><b>Observações:</b> ${o.obs_execucao}</p></section>` : null}
    <section class="imp-resumo">
      <div class="imp-grade g2">
        <${Par} r="Responsável" v=${o.mecanico_nome} /><${Par} r="Consultor" v=${o.consultor_nome} />
        <${Par} r="Situação" v=${(situacaoOS(o) || STATUS[o.status]).t + (o.situacao ? " · " + o.situacao : "")} />${quando ? html`<${Par} r=${quando[0]} v=${quando[1]} />` : null}
        <${Par} r="Pagamento" v=${o.forma_pagamento} /><${Par} r="Condições" v=${o.condicoes_pagamento} />
        ${orc && o.validade_orcamento ? html`<${Par} r="Válido até" v=${fmtData(o.validade_orcamento)} />` : null}
        ${o.tabela_preco && o.tabela_preco !== "vista" ? html`<${Par} r="Tabela" v=${TABELAS_PRECO[o.tabela_preco]} />` : null}
      </div>
      ${valores ? html`<div class="imp-totais">${linhasTot.length > 1 ? linhasTot.map(([r, v]) => html`<div key=${r}><span>${r}</span><b>${v < 0 ? "− " + reais(-v) : reais(v)}</b></div>`) : null}
        <div class="tot"><span>Total</span><b>${reais(t.total)}</b></div></div>` : null}
    </section>
    <p class="imp-termo">${termo}${!orc && o.status === "entregue" ? " Garantia válida até " + fmtData(somaDias(o.entregue_em, o.garantia_dias)) + "." : ""}</p>
    ${orc ? html`<div class="imp-assins"><div class="imp-autoriza"><p>Autorizo a execução nas condições acima.</p><p class="imp-marcar">(   ) Aprovado    (   ) Reprovado    Data: ____/____/______</p></div><${Assinatura} rotulo="Cliente" nome=${o.cliente.nome} /></div>`
      : html`<div class="imp-assins"><${Assinatura} rotulo="Cliente" nome=${o.cliente.nome} img=${o.assinatura_entrega} /><${Assinatura} rotulo="Oficina" /></div>
        ${o.aprovacao ? html`<p class="imp-nota">Autorizado por ${o.aprovacao.por} em ${fmtDataHora(o.aprovacao.em)} (${o.aprovacao.forma}). Na retirada, o cliente declara receber o veículo com os serviços executados e testados.</p>` : null}`}
    <footer class="imp-rodape">Não vale como recibo de pagamento</footer>
  </article>`;
}

/* ---------------- Ficha do salão (pedido do Danilo em 11/11/2026) ----------------
 * O que fazer no carro, em letras grandes, para o mecânico. A4, preto e branco e só contornos (pouca tinta).
 * Os serviços saem da reclamação da O.S. (separados por "//", quebra de linha, ";" ou fim de frase);
 * sem reclamação, dos serviços lançados. Sem valores. */
export function servicosSalao(o) {
  const texto = String((o && o.reclamacao) || "");
  const daReclamacao = texto.split(/\/\/|\n|;|\.\s+(?=[A-ZÀ-Ú])/).map(x => x.replace(/\s+/g, " ").replace(/^[\s.\-–•]+|[\s.\-–•]+$/g, "")).filter(Boolean);
  if (daReclamacao.length) return { lista: daReclamacao, de: "reclamacao" };
  const servicos = ((o && o.itens) || []).filter(i => (i.tipo === "servico" || i.tipo === "terceiro") && i.aprovado !== false).map(i => String(i.descricao || "").trim()).filter(Boolean);
  return { lista: servicos, de: servicos.length ? "servicos" : "" };
}
const semSufixoEmpresa = n => String(n || "").replace(/\s+(LTDA|ME|EPP|EIRELI|S\/?A)\.?$/i, "");
function FichaSalao({ o }) {
  const { lista, de } = servicosSalao(o);
  const orc = ["diagnostico", "aguardando"].includes(o.status);
  const tam = lista.length <= 5 ? "s-poucos" : lista.length <= 8 ? "s-medio" : lista.length <= 12 ? "s-muitos" : "s-lotado";
  const sit = situacaoOS(o) || STATUS[o.status] || { t: o.status };
  const linha2 = [o.veiculo.ano, semSufixoEmpresa(o.cliente.nome)].filter(Boolean).join(" · ");
  const linha3 = ["Entrada em " + fmtData(o.criado_em), o.consultor_nome ? "Consultor: " + String(o.consultor_nome).split(" ")[0] : ""].filter(Boolean).join(" · ");
  const campo = (r, v) => html`<div><span>${r}:</span> <b>${v}</b></div>`;
  return html`<article class=${"folha salao " + tam}>
    <header class="sl-topo"><div class="sl-marca">DTCAR<small>CENTRO AUTOMOTIVO</small></div>
      <div class="sl-num">ORDEM DE SERVIÇO<b>Nº ${n5(o.numero)}</b></div></header>
    <section class="sl-carro"><div class="sl-placa"><span>BRASIL</span><b>${exPlaca(o.veiculo.placa)}</b></div>
      <div class="sl-vei"><b>${[o.veiculo.marca, o.veiculo.modelo].filter(Boolean).join(" ").toUpperCase()}</b><span>${linha2}</span><span>${linha3}</span></div></section>
    <h2 class="sl-tit">O QUE FAZER NO CARRO</h2>
    ${lista.length ? html`<ol class="sl-lista">${lista.map((t, n) => html`<li key=${n}><i>${n + 1}</i><span>${t.toUpperCase()}</span><em></em></li>`)}</ol>`
      : html`<div class="sl-vazio">A O.S. ainda não tem reclamação nem serviços lançados. Escreva abaixo o que fazer:</div>
        <div class="sl-linhas">${[1, 2, 3, 4, 5].map(n => html`<div key=${n}></div>`)}</div>`}
    ${de === "servicos" ? html`<p class="sl-origem">Lista tirada dos serviços lançados na O.S. (a reclamação está em branco).</p>` : null}
    ${orc ? html`<div class="sl-aviso">Achou peça gasta ou com defeito? <b>AVISE O CONSULTOR ANTES DE TROCAR</b> — a O.S. ainda está em orçamento.</div>` : null}
    <div class="sl-campos">${campo("KM", o.km_entrada ? fmtKm(o.km_entrada) : "")}${campo("Mecânico", o.mecanico_nome || "")}${campo("Box", o.box || "")}</div>
    <footer class="sl-rodape"><span>Etapa: ${sit.t}</span><span>DTCar Gestão · O.S. ${n5(o.numero)}</span></footer>
  </article>`;
}

/* ---------------- Venda de balcão ---------------- */
function ViaVenda({ v, via, nVias }) {
  const prod = v.itens.filter(i => i.tipo !== "servico"), serv = v.itens.filter(i => i.tipo === "servico");
  const sub = (l) => l.reduce((s, i) => s + totalItem(i), 0);
  return html`<article class=${"folha os-a4" + (v.status === "cancelada" ? " cancelado" : "")}>
    <${Cabecalho} titulo="VENDA DE BALCÃO" numero=${n5(v.numero)} direita=${html`<span>${fmtDataHora(v.criado_em)}</span>${nVias > 1 ? html`<em>${via === 1 ? "Via do cliente" : "Via da oficina"}</em>` : null}`} />
    <section class="imp-bloco"><div class="imp-grade"><${Par} r="Cliente" v=${(v.cliente || {}).nome} largo /><${Par} r="CPF/CNPJ" v=${fmtDoc((v.cliente || {}).doc || "")} />
      <${Par} r="Telefone" v=${(v.cliente || {}).telefone ? fmtTel(v.cliente.telefone) : ""} /><${Par} r="Atendente" v=${v.vendedor_nome} /></div></section>
    <${TabelaItens} titulo="Produtos e peças" itens=${prod} valores total=${["Total de produtos", sub(prod)]} />
    <${TabelaItens} titulo="Serviços" itens=${serv} valores total=${["Total de serviços", sub(serv)]} />
    ${v.obs ? html`<section class="imp-bloco imp-texto"><p><b>Observação:</b> ${v.obs}</p></section>` : null}
    <section class="imp-resumo"><div class="imp-grade g2"><${Par} r="Pagamento" v=${v.forma_pagamento} />${v.tabela_preco !== "vista" ? html`<${Par} r="Tabela" v=${TABELAS_PRECO[v.tabela_preco]} />` : null}</div>
      <div class="imp-totais">${Number(v.desconto) ? html`<div><span>Subtotal</span><b>${reais(v.subtotal)}</b></div><div><span>Desconto</span><b>− ${reais(v.desconto)}</b></div>` : null}
        <div class="tot"><span>Total</span><b>${reais(v.total)}</b></div></div></section>
    ${v.status === "cancelada" ? html`<div class="rec-cancelado">CANCELADA<small>${v.cancelada_motivo || ""}</small></div>` : null}
    <div class="imp-assins"><${Assinatura} rotulo="Cliente" /><${Assinatura} rotulo="Oficina" /></div>
    <footer class="imp-rodape">Documento sem valor fiscal</footer>
  </article>`;
}
function CupomVenda({ v }) {
  const { cfg } = useApp();
  return html`<article class="cupom">
    <b class="c-centro">${cfg.nome}</b>${cfg.endereco ? html`<div class="c-centro">${cfg.endereco}</div>` : null}<div class="c-centro">${[cfg.telefone, cfg.cnpj ? "CNPJ " + cfg.cnpj : ""].filter(Boolean).join(" · ")}</div>
    <hr /><b>VENDA ${n5(v.numero)}</b>${v.status === "cancelada" ? html` <b>(CANCELADA)</b>` : null}<div>${fmtDataHora(v.criado_em)}</div><div>Cliente: ${(v.cliente || {}).nome || "Consumidor"}</div>
    <hr />${v.itens.map(i => html`<div class="c-item" key=${i.id}><div>${i.descricao}</div><div class="c-dir">${qtdFmt(i.qtd)} x ${reais(i.valor_unit)}${Number(i.desconto) ? " - " + reais(i.desconto) : ""} = ${reais(totalItem(i))}</div></div>`)}
    <hr />${Number(v.desconto) ? html`<div class="c-lin"><span>Desconto</span><span>${reais(v.desconto)}</span></div>` : null}<div class="c-lin c-tot"><span>TOTAL</span><span>${reais(v.total)}</span></div>
    <div>Pagamento: ${v.forma_pagamento}</div><div class="c-centro c-peq">Documento sem valor fiscal.</div>
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
      ${t.terceiros ? html`<div class="c-lin"><span>Terceiros</span><span>${reais(t.terceiros)}</span></div>` : null}${t.desconto ? html`<div class="c-lin"><span>Desconto</span><span>${reais(t.desconto)}</span></div>` : null}
      <div class="c-lin c-tot"><span>TOTAL</span><span>${reais(t.total)}</span></div>` : null}
    <hr /><div>Situação: ${(situacaoOS(o) || STATUS[o.status]).t}${o.situacao ? " · " + o.situacao : ""}</div>${o.forma_pagamento ? html`<div>Pagamento: ${o.forma_pagamento}</div>` : null}
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

/* ---------------- O.S. Recibo (pedido do Danilo em 12/11/2026) ----------------
 * A O.S. paga em forma de recibo, com o prazo e as condições da garantia e, se marcado, os cuidados com o motor.
 * Mesmo leiaute do js/pdfrecibo.js (PDF do WhatsApp e do e-mail): mudou aqui, mude lá. Textos em js/osrecibo.js. */
function TabelaRecibo({ titulo, itens }) {
  if (!itens.length) return null;
  const comRef = itens.some(i => i.codigo);
  return html`<table class="osr-tab"><thead><tr><th>${titulo}</th>${comRef ? html`<th class="ref">Ref.</th>` : null}<th class="num">Qtd.</th><th class="num">Unit.</th><th class="num">Total</th></tr></thead>
    <tbody>${itens.map(i => html`<tr key=${i.id}><td>${i.descricao}${i.fornecida_cliente ? " (peça do cliente)" : ""}</td>${comRef ? html`<td class="ref">${i.codigo || ""}</td>` : null}
      <td class="num">${i.horas ? qtdFmt(i.horas) + " h" : qtdFmt(i.qtd)}</td><td class="num">${i.fornecida_cliente ? "—" : reais(i.valor_unit)}</td><td class="num">${i.fornecida_cliente ? "—" : reais(totalItem(i))}</td></tr>`)}</tbody></table>`;
}
function ViaOSRecibo({ o, recibos, cli, motor }) {
  const { cfg } = useApp();
  const d = dadosOSRecibo(o, recibos, cfg), t = d.t;
  const doc = o.cliente.doc || (cli && cli.doc) || "";
  const veic = [o.veiculo.marca, o.veiculo.modelo, o.veiculo.ano, o.veiculo.cor].filter(Boolean).join(" – ");
  const cond = condicoesGarantia({ dias: d.dias, numero: o.numero, telefone: cfg.telefone, motor, entrega: d.entrega, validade: d.validade });
  const forma = d.formas ? (d.formas === d.formas.toUpperCase() ? d.formas : d.formas.charAt(0).toLowerCase() + d.formas.slice(1)) : "";
  return html`<article class="folha osrec">
    <header class="osr-topo">
      <div class="osr-logo">${cfg.logo ? html`<${Foto} caminho=${cfg.logo} alt="Logotipo" />` : html`<img src="icons/logo-preto.png" alt="DTCar Centro Automotivo" />`}</div>
      <div class="osr-emp"><b>${cfg.nome}</b>${cfg.cnpj ? html`<span>CNPJ ${cfg.cnpj}</span>` : null}${cfg.endereco ? html`<span>${cfg.endereco}</span>` : null}${cfg.telefone ? html`<span>Telefone: ${cfg.telefone}</span>` : null}</div>
    </header>
    <div class="osr-titulo"><h1>Recibo de Ordem de Serviço</h1><div class="osr-num">O.S. Nº ${n5(o.numero)}</div></div>
    <div class="osr-sub">Pago em ${fmtData(d.pagoEm)}${o.criado_em ? " · O.S. aberta em " + fmtData(o.criado_em) : ""}</div>
    <h2>Cliente e veículo</h2>
    <table class="osr-dados"><tbody>
      <tr><td class="r">Cliente</td><td>${o.cliente.nome}</td><td class="r">Telefone</td><td>${fmtTel(o.cliente.telefone) || ""}</td></tr>
      <tr><td class="r">Veículo</td><td>${veic}</td><td class="r">Placa</td><td>${exPlaca(o.veiculo.placa)}</td></tr>
      <tr><td class="r">KM na entrega</td><td>${o.km_saida ? fmtKm(o.km_saida) : ""}</td><td class="r">Data de entrega</td><td>${d.entrega ? fmtData(d.entrega) : ""}</td></tr>
      <tr><td class="r">Técnico</td><td>${o.mecanico_nome || ""}</td><td class="r">CPF/CNPJ</td><td>${doc ? fmtDoc(doc) : ""}</td></tr>
    </tbody></table>
    <h2>Serviços e peças</h2>
    <${TabelaRecibo} titulo="Produtos e peças" itens=${d.pecas} />
    <${TabelaRecibo} titulo="Serviços" itens=${d.servicos} />
    <${TabelaRecibo} titulo="Serviços de terceiros" itens=${d.terceiros} />
    <div class="osr-total">${t.desconto ? html`<span>Desconto: − ${reais(t.desconto)}</span>` : null}<b>VALOR TOTAL DA O.S.: ${reais(t.total)}</b></div>
    <h2>Pagamento</h2>
    <p class="osr-recebemos">Recebemos de <b>${o.cliente.nome}</b>${doc ? html`, CPF/CNPJ <b>${fmtDoc(doc)}</b>` : null}, a importância de <b>${reais(d.valorPago)}</b> (${extenso(d.valorPago)}),
      referente à Ordem de Serviço nº ${n5(o.numero)}${forma ? html`, pago em <b>${forma}</b>` : null}, dando plena quitação.</p>
    ${d.pagos.length > 1 ? html`<p class="osr-pagos">${d.pagos.map((r, n) => html`<span key=${n}>${fmtData(r.data)} · ${r.forma || "—"} · ${reais(r.valor)}</span>`)}</p>` : null}
    <h2>Prazo e condições da garantia</h2>
    <ol class="osr-cond">${cond.map((c, n) => html`<li key=${n}>${c.r ? html`<b>${c.r}</b> ` : null}${c.t}</li>`)}</ol>
    ${motor ? html`<h2>${CUIDADOS_MOTOR.titulo}</h2>
      <div class="osr-cuidados"><p>${CUIDADOS_MOTOR.intro}</p>
        <div class="osr-destaque">⚠ ${CUIDADOS_MOTOR.destaque} ${CUIDADOS_MOTOR.destaque2}</div>
        <ul>${CUIDADOS_MOTOR.itens.map((c, n) => html`<li key=${n}><b>${c.r}</b>${c.t ? " " + c.t : ""}</li>`)}</ul></div>` : null}
    <div class="osr-ass">
      <div class="osr-local">${cfg.cidade || "Colatina/ES"}, ${fmtData(d.pagoEm)}</div>
      <div class="osr-linhas"><div><b>${cfg.nome}</b>${cfg.cnpj ? "CNPJ " + cfg.cnpj : ""}</div>
        <div><b>Cliente: ${o.cliente.nome}</b>Declaro ter recebido o veículo e ciência deste termo</div></div>
    </div>
    ${!osQuitada(o) ? html`<div class="osr-aviso so-tela">Atenção: esta O.S. ainda não está paga. A O.S. Recibo é para O.S. fechada (quitada).</div>` : null}
    <footer class="osr-rodape">Gerado pelo sistema Gestão DTCar · O.S. ${n5(o.numero)} · ${exPlaca(o.veiculo.placa)}</footer>
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

/* ---------------- Resumo de O.S. em aberto (pedido do Danilo em 13/11/2026) ----------------
 * As O.S. em aberto de um cliente ou de um veículo num documento só, no padrão da O.S. (mesmo cabeçalho, quadros e tabelas).
 * Contas e textos em js/resumoos.js. O PDF do conector (js/pdfresumo.js) segue este leiaute: mudou um, mude o outro. */
/** Sem internet no navegador ou no celular (no programa Windows o banco do PC responde antes): os itens vêm da cópia de cada O.S.
 * guardada no aparelho, a mesma que abre a O.S. sem internet. O.S. sem cópia NÃO vira lista vazia (o total sairia errado): avisa
 * quais faltam. Vale o registro mais novo: a cópia (cabeçalho e itens juntos) ou, se a lista for mais nova que a cópia, a linha da
 * lista com os itens da cópia — e a tela avisa que os itens dessa O.S. podem estar desatualizados. */
async function copiasParaResumo(ordens) {
  const faltam = [], antigas = [], usadas = [], itens = [];
  for (const o of ordens) {
    const c = api.ordemNoAparelho ? await api.ordemNoAparelho(o.id) : null;
    if (!c || !Array.isArray(c.itens)) { faltam.push(n5(o.numero)); continue; }
    const { itens: daCopia, fotos, eventos, _local, ...cab } = c;
    const antiga = !o._pendente && Date.parse(c.atualizado_em || "") < Date.parse(o.atualizado_em || "");
    if (antiga) antigas.push(n5(o.numero));
    usadas.push(antiga ? o : { ...o, ...cab }); itens.push(...daCopia);
  }
  if (faltam.length) throw new Error("Sem conexão com a internet: " + (faltam.length > 1 ? "as O.S. " + faltam.join(", ") + " não estão guardadas" : "a O.S. " + faltam[0] + " não está guardada")
    + " neste aparelho. O resumo abre quando a conexão voltar.");
  const abertas = usadas.filter(etapaNoResumo);
  return { ordens: abertas, itens, semInternet: true, copiasAntigas: antigas.filter(n => abertas.some(o => n5(o.numero) === n)) };
}
function ResumoOS({ doc, params }) {
  const pedidas = String(params.os || "").split(/[^0-9]+/).filter(Boolean).map(Number);
  const [marcadas, setMarcadas] = useState(() => new Set(doc.ordens.filter(o => pedidas.length ? pedidas.includes(Number(o.numero)) : marcadaNoResumo(o)).map(o => o.id)));
  const [detalhe, setDetalhe] = useState(params.itens !== "0");
  const [agora] = useState(() => new Date().toISOString());
  const trocar = id => setMarcadas(m => { const n = new Set(m); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const escolhidas = doc.ordens.filter(o => marcadas.has(o.id));
  const d = dadosResumoOS({ ordens: escolhidas, itens: doc.itens, de: doc.de, cliente: doc.cliente, veiculo: doc.veiculo, agora });
  const dono = doc.de === "veiculo" ? "deste veículo" : "deste cliente";
  return html`
    <section class="resos-escolha so-tela" aria-label="O.S. deste resumo">
      <div class="resos-escolha-topo"><b>O.S. em aberto ${dono}</b>
        <div class="seg" role="group" aria-label="Nível de detalhe">${[[true, "Detalhado"], [false, "Só o resumo"]].map(([v, t]) => html`<button type="button" key=${t} aria-pressed=${detalhe === v ? "true" : "false"} onClick=${() => setDetalhe(v)}>${t}</button>`)}</div></div>
      ${doc.ordens.length ? html`<div class="resos-opcoes">${doc.ordens.map(o => html`<label class="linha-check" key=${o.id}><input type="checkbox" checked=${marcadas.has(o.id)} onChange=${() => trocar(o.id)} />
        <span><b>O.S. ${n5(o.numero)}</b> · ${[exPlaca((o.veiculo || {}).placa), (o.cliente || {}).nome].filter(Boolean).join(" · ")} · ${(situacaoOS(o) || {}).t} · ${reais(o.total)}</span></label>`)}</div>
        <p class="dica">Orçamento ainda não aprovado entra só se você marcar. O que estiver marcado sai na folha abaixo.</p>` : html`<p class="dica">Nenhuma O.S. em aberto ${dono}.</p>`}
      ${doc.semInternet ? html`<div class="aviso">Sem internet: os itens e os valores são da cópia das O.S. guardada neste aparelho.${(doc.copiasAntigas || []).length
        ? (doc.copiasAntigas.length > 1 ? " As cópias das O.S. " + doc.copiasAntigas.join(", ") + " são mais antigas" : " A cópia da O.S. " + doc.copiasAntigas[0] + " é mais antiga") + " que a lista: os itens podem estar desatualizados." : ""} Confira de novo quando a conexão voltar.</div>` : null}
      ${d.clientesDiferentes.length ? html`<div class="aviso">As O.S. marcadas estão em nomes diferentes (${d.clientesDiferentes.join("; ")}). O resumo sai no nome de ${d.cli ? d.cli.nome : "—"}.</div>` : null}
    </section>
    ${!escolhidas.length ? (doc.ordens.length ? html`<div class="erros so-tela">Marque pelo menos uma O.S. para montar o resumo.</div>` : null) : html`<article class="folha os-a4 resos">
      <${Cabecalho} titulo="RESUMO DE ORDENS DE SERVIÇO" numero=${d.numeroCab} direita=${html`${d.tituloQtd ? html`<strong>${d.tituloQtd}</strong>` : null}<span>Emitido em ${d.emitidoEm}</span>`} />
      <section class="imp-duas imp-comp">
        <div class="imp-bloco"><h4>Cliente</h4>
          ${d.cli ? html`<div class="imp-l"><b class="imp-dest">${d.cli.nome}</b>${d.cli.codigo != null ? html`<span class="imp-cod">(cód. ${d.cli.codigo})</span>` : null}</div>
            <div class="imp-l"><${Inl} r="CPF/CNPJ" v=${d.cli.doc} /><${Inl} r="Tel." v=${d.cli.telefone} /></div>
            <div class="imp-l"><${Inl} r="End." v=${d.cli.endereco} /></div>` : html`<div class="imp-l">Clientes diferentes nas O.S.</div>`}</div>
        <div class="imp-bloco"><h4>${d.vei ? "Veículo" : "Veículos"}</h4>
          ${d.vei ? html`<div class="imp-l"><b class="imp-dest">${d.vei.placa}</b><b>${d.vei.modelo}</b></div><div class="imp-l"><${Inl} r="Ano" v=${d.vei.ano} /><${Inl} r="Cor" v=${d.vei.cor} /></div>`
            : html`<div class="imp-l">${d.veiculos.map((v, n) => html`<span key=${n}><b>${v.placa}</b> ${v.modelo}</span>`)}</div>`}</div>
      </section>
      ${detalhe ? d.blocos.map(b => html`<section class="resos-os" key=${b.id}>
        <div class="resos-faixa"><span><b>ORDEM DE SERVIÇO Nº ${b.n5}</b>${b.faixaVeiculo ? " · " + b.faixaVeiculo : ""}${b.recNaFaixa ? " · " + b.reclamacao : ""}</span>
          <span class="dir">${b.aberta ? "Aberta em " + b.aberta + " · " : ""}${b.situacao}</span></div>
        ${b.reclamacao && !b.recNaFaixa ? html`<p class="resos-rec"><b>Reclamação:</b> ${b.reclamacao}</p>` : null}
        <${TabelaItens} titulo="Produtos e peças" itens=${b.pecas} valores=${true} total=${["Total de produtos", b.t.pecas]} />
        <${TabelaItens} titulo="Serviços" itens=${b.servicos} valores=${true} total=${["Total de serviços", b.t.servicos]} />
        <${TabelaItens} titulo="Serviços de terceiros" itens=${b.terceiros} valores=${true} total=${["Total de serviços de terceiros", b.t.terceiros]} />
        ${!b.pecas.length && !b.servicos.length && !b.terceiros.length ? html`<p class="resos-rec">Sem itens lançados.</p>` : null}
        <div class="resos-fecho">${fechoDaOS(b).map(l => html`<div key=${l.r} class=${l.forte ? "forte" : ""}><span>${l.r}</span><b>${l.menos ? "− " : ""}${reais(l.v)}</b></div>`)}</div>
      </section>`) : null}
      <table class="imp-tab resos-geral"><thead><tr><th>Resumo geral</th>${d.colunas.map(c => html`<th class="num" key=${c.t}>${c.t}</th>`)}</tr></thead>
        <tbody>${d.blocos.map(b => html`<tr key=${b.id}><td>${rotuloNoResumo(b, d)}${!detalhe ? html`<span class="resos-sit">${b.situacao}</span>` : null}</td>${d.colunas.map(c => html`<td class="num" key=${c.t}>${reais(c.de(b))}</td>`)}</tr>`)}</tbody>
        <tfoot><tr><td>Total geral</td>${d.colunas.map(c => html`<td class=${"num" + (c.forte ? " forte" : "")} key=${c.t}>${reais(c.soma)}</td>`)}</tr></tfoot></table>
      <p class="imp-termo">${d.nota}</p>
      <footer class="imp-rodape">Não vale como recibo de pagamento</footer>
    </article>`}`;
}

/* ---------------- folha de ponto mensal (para anotar e assinar) ---------------- */
function FolhaPonto({ f, ym, extras }) {
  const { cfg } = useApp();
  const dias = diasDoMes(ym, f.jornada, extras);
  const prev = j => j ? [j.e, j.sa && j.r ? j.sa + "–" + j.r : "", j.s].filter(Boolean).join(" / ") : "";
  return html`<article class="folha ponto">
    <${Cabecalho} titulo="FOLHA DE PONTO" direita=${html`<span>${nomeMes(ym)}</span>`} />
    <section class="imp-bloco"><div class="ponto-cab">
      <${Par} r="Funcionário" v=${f.nome} largo /><${Par} r="Função" v=${f.funcao} /><${Par} r="Admissão" v=${f.admissao ? fmtData(f.admissao) : ""} />
      <${Par} r="CPF" v=${f.cpf ? fmtDoc(f.cpf) : ""} /><${Par} r="CTPS" v=${f.ctps} /><${Par} r="PIS" v=${f.pis} /><${Par} r="Jornada semanal" v=${fmtHoras(horasSemana(f.jornada))} /></div></section>
    <table class="ponto-tab"><thead><tr><th>Dia</th><th>Horário previsto</th><th>Entrada</th><th>Saída almoço</th><th>Retorno</th><th>Saída</th><th>H. extras</th><th>Assinatura</th></tr></thead>
      <tbody>${dias.map(d => { const folga = !d.jornada || d.feriado; return html`<tr key=${d.dia} class=${folga ? "folga" : ""}>
        <td class="c">${String(d.dia).padStart(2, "0")} ${d.nomeDia.slice(0, 3)}</td>
        <td class="c">${d.feriado ? d.feriado : d.jornada ? prev(d.jornada) : "Descanso"}</td><td></td><td></td><td></td><td></td><td></td><td class="ass-ponto"></td></tr>`; })}</tbody></table>
    <p class="imp-termo">Declaro que os horários anotados nesta folha correspondem à minha jornada efetivamente cumprida no mês. Intervalo para repouso e alimentação conforme o art. 71 da CLT.</p>
    <div class="ponto-assins"><${Assinatura} rotulo="Funcionário" nome=${f.nome} /><${Assinatura} rotulo=${cfg.nome} /></div>
  </article>`;
}

/* ---------------- resumo do mês do funcionário ---------------- */
function ResumoFuncionario({ f, ym, m }) {
  const { cfg } = useApp();
  const r = calcularMes(f, ym, m.lancs, m.base, cfg.encargos);
  const lin = (t, v, neg) => v ? html`<tr key=${t}><td>${t}</td><td class="num">${neg ? "− " : ""}${reais(v)}</td></tr>` : null;
  return html`<article class="folha">
    <${Cabecalho} titulo="RESUMO DO MÊS" direita=${html`<span>${nomeMes(ym)}</span>`} />
    <section class="imp-bloco"><div class="imp-grade g2"><${Par} r="Funcionário" v=${f.nome} /><${Par} r="Função" v=${f.funcao} /><${Par} r="Vínculo" v=${VINCULOS[f.vinculo]} /><${Par} r="CPF" v=${f.cpf ? fmtDoc(f.cpf) : ""} /></div></section>
    <table class="imp-tab"><thead><tr><th>Descrição</th><th class="num">Valor</th></tr></thead><tbody>
      ${lin("Salário" + (r.diasSalario < 30 ? " (" + r.diasSalario + " dias)" : ""), r.salario)}${lin("Horas extras" + (r.qtdHorasExtras ? " (" + fmtHoras(r.qtdHorasExtras) + ")" : ""), r.horasExtras)}
      ${lin("Comissão", r.comissao)}${lin("Bônus / prêmios", r.bonus)}${lin("Faltas" + (r.qtdFaltas ? " (" + r.qtdFaltas + " dia(s))" : ""), r.faltas, true)}
      ${lin("Vales e adiantamentos", r.vales, true)}${lin("INSS / IRRF", r.inss, true)}${lin("Outros descontos", r.descontos, true)}${lin("Já pago", r.pagos, true)}</tbody>
      <tfoot><tr><td>Saldo a pagar</td><td class="num">${reais(r.saldo)}</td></tr></tfoot></table>
    ${m.lancs.length ? html`<table class="imp-tab"><thead><tr><th>Data</th><th>Lançamento</th><th class="num">Valor</th></tr></thead><tbody>
      ${m.lancs.map(l => html`<tr key=${l.id}><td>${fmtData(l.data)}</td><td>${l.descricao || l.tipo.replace("_", " ")}</td><td class="num">${reais(r.valorDe(l))}</td></tr>`)}</tbody></table>` : null}
    ${m.os.length ? html`<table class="imp-tab"><thead><tr><th>O.S. (comissão ${f.comissao_pct}%)</th><th>Entrega</th><th class="num">Mão de obra</th></tr></thead><tbody>
      ${m.os.map(o => html`<tr key=${o.id}><td>${n5(o.numero)}</td><td>${fmtData(o.entregue_em)}</td><td class="num">${reais(o.maoDeObra)}</td></tr>`)}</tbody></table>` : null}
    <p class="imp-termo">Documento de controle interno da oficina. Não substitui o recibo de pagamento de salário (holerite) emitido pela contabilidade.</p>
    <div class="ponto-assins"><${Assinatura} rotulo="Funcionário" nome=${f.nome} /><${Assinatura} rotulo=${cfg.nome} /></div>
  </article>`;
}

/* ---------------- tela de impressão ---------------- */
export function Imprimir({ tipo, id, params }) {
  const { dados, perfil, avisar, confirmar, ir, cfg, recarregar } = useApp();
  const recarregarProdutos = () => recarregar(["produtos"]);
  const [doc, setDoc] = useState(null), [erro, setErro] = useState("");
  const [vias, setVias] = useState(Number(params.vias) || (tipo === "recibo" ? 2 : Number(cfg.impressaoVias) || 1));
  const valores = params.valores !== "0" && pode(perfil, "verValores");
  const formato = params.formato === "cupom" ? "cupom" : "a4";
  useEffect(() => {
    if (tipo === "os" || tipo === "salao") api.ordem(id).then(setDoc).catch(e => setErro(e.message));
    else if (tipo === "osrecibo") {
      // mostra preços, total e pagamentos: só para quem vê valores (a rota de impressão abre antes de "restrito")
      if (!pode(perfil, "verValores")) { setErro("A O.S. Recibo mostra valores: só para quem tem acesso aos valores da O.S."); return; }
      Promise.all([api.ordem(id), api.recibos.listar({ ordemId: id })]).then(([o, r]) => setDoc({ ...o, recibosDaOS: r || [] })).catch(e => setErro(e.message));
    }
    else if (tipo === "recibo") api.recibos.um(id).then(setDoc).catch(e => setErro(e.message));
    else if (tipo === "resumo") {
      // mostra preços e totais: só para quem vê valores (a rota de impressão abre antes de "restrito")
      if (!pode(perfil, "verValores")) { setErro("O resumo das O.S. mostra valores: só para quem tem acesso aos valores da O.S."); return; }
      const de = params.de === "veiculo" ? "veiculo" : "cliente";
      const ficha = de === "veiculo" ? dados.veiculos.find(x => x.id === id) : dados.clientes.find(x => x.id === id);
      if (!ficha) { setErro(de === "veiculo" ? "Veículo não encontrado." : "Cliente não encontrado."); return; }
      const ordens = dados.ordens.filter(o => (de === "veiculo" ? o.veiculo_id === id : o.cliente_id === id) && etapaNoResumo(o)).sort((a, b) => Number(a.numero) - Number(b.numero));
      // pelo veículo, o cabeçalho leva o proprietário do cadastro
      const base = { de, ordens, cliente: de === "veiculo" ? dados.clientes.find(c => c.id === ficha.cliente_id) || null : ficha, veiculo: de === "veiculo" ? ficha : null };
      if (!ordens.length) setDoc({ ...base, itens: [] });
      else api.itensDasOrdens(ordens.map(o => o.id)).then(itens => setDoc({ ...base, itens }))
        .catch(e => erroDeRede(e) ? copiasParaResumo(ordens).then(c => setDoc({ ...base, ...c })) : Promise.reject(e)).catch(e => setErro(e.message));
    }
    else if (tipo === "venda") api.vendas.uma(id).then(setDoc).catch(e => setErro(e.message));
    else if (tipo === "cliente") { const c = dados.clientes.find(x => x.id === id); c ? setDoc(c) : setErro("Cliente não encontrado."); }
    else if (tipo === "veiculo") { const v = dados.veiculos.find(x => x.id === id); v ? setDoc(v) : setErro("Veículo não encontrado."); }
    else if (tipo === "ponto" || tipo === "funcionario") {
      if (!pode(perfil, "financeiro")) { setErro("Apenas o administrador imprime documentos de funcionários."); return; }
      api.funcionarios.listar("nome").then(async l => { const f = l.find(x => x.id === id); if (!f) return setErro("Funcionário não encontrado.");
        setDoc(tipo === "ponto" ? { f } : { f, m: (await dadosDoMes(params.mes, [f]))[f.id] }); }).catch(e => setErro(e.message));
    }
    else setErro("Documento desconhecido.");
  }, [tipo, id]);
  useEffect(() => { const t = document.title; if (doc) document.title = { os: "OS " + n5(doc.numero), osrecibo: "OS Recibo " + n5(doc.numero), salao: "Salão OS " + n5(doc.numero), venda: "Venda " + n5(doc.numero), recibo: "Recibo " + n5(doc.numero), cliente: "Ficha " + (doc.nome || ""), veiculo: "Ficha " + (doc.placa || ""), ponto: "Folha de ponto " + (doc.f ? doc.f.nome : ""), funcionario: "Resumo " + (doc.f ? doc.f.nome : ""), resumo: "Resumo OS " + (doc.veiculo ? doc.veiculo.placa || "" : doc.cliente ? doc.cliente.nome || "" : "") }[tipo] || t; return () => { document.title = t; }; }, [doc]);
  const voltar = () => history.length > 1 ? history.back() : ir(tipo === "os" || tipo === "salao" || tipo === "osrecibo" ? "/os/" + id : tipo === "venda" ? "/balcao?aba=historico" : tipo === "recibo" ? "/recibos" : tipo === "cliente" ? "/cliente/" + id : tipo === "ponto" ? "/funcionario/" + id + "?aba=jornada" : tipo === "funcionario" ? "/funcionario/" + id + "?aba=mes&mes=" + params.mes : tipo === "resumo" && params.de !== "veiculo" ? "/cliente/" + id : "/veiculo/" + id);
  const cancelarRecibo = async () => {
    if (!await confirmar({ titulo: "Cancelar recibo " + n5(doc.numero), texto: "O recibo continua registrado, marcado como cancelado, e deixa de contar como pagamento recebido.", botao: "Cancelar recibo", perigo: true })) return;
    try { await api.recibos.salvar({ id: doc.id, cancelado: true, cancelado_motivo: "Cancelado por " + perfil.nome + " em " + new Date().toLocaleDateString("pt-BR") });
      if (doc.ordem_id) await api.evento(doc.ordem_id, "recibo", "Recibo " + n5(doc.numero) + " cancelado.", perfil.nome).catch(() => {});
      setDoc(await api.recibos.um(doc.id)); avisar("Recibo cancelado."); } catch (e) { avisar(e.message, true); }
  };
  const cancelarVenda = async () => {
    if (!await confirmar({ titulo: "Cancelar venda " + n5(doc.numero), texto: "Os produtos voltam para o estoque e os recibos desta venda são cancelados.", botao: "Cancelar venda", perigo: true })) return;
    try { await api.vendas.cancelar(doc.id, "Cancelada por " + perfil.nome); setDoc(await api.vendas.uma(doc.id)); avisar("Venda cancelada."); recarregarProdutos(); } catch (e) { avisar(e.message, true); }
  };
  const cli = doc && (tipo === "os" || tipo === "osrecibo") ? dados.clientes.find(c => c.id === doc.cliente_id) : null;
  const vei = doc && tipo === "os" ? dados.veiculos.find(v => v.id === doc.veiculo_id) : null;
  const nVias = formato === "cupom" || tipo === "salao" || tipo === "osrecibo" || tipo === "resumo" || tipo === "cliente" || tipo === "veiculo" || tipo === "ponto" || tipo === "funcionario" ? 1 : vias;
  return html`<div class=${"imprimir" + (formato === "cupom" ? " imp-cupom" : "")}>
    ${formato === "cupom" ? html`<style>@page { size: 80mm auto; margin: 3mm; }</style>` : (tipo === "salao" ? html`<style>@page { size: A4; margin: 12mm; }</style>` : tipo === "osrecibo" ? html`<style>@page { size: A4; margin: 9mm 11mm; }</style>` : html`<style>@page { size: A4; margin: 9mm; }</style>`)}
    <div class="imp-barra so-tela">
      <button type="button" class="btn" onClick=${voltar}>← Voltar</button>
      ${((tipo === "os" || tipo === "venda") && formato === "a4") || tipo === "recibo" ? html`<div class="seg" role="group" aria-label="Vias">${[1, 2].map(n => html`<button type="button" key=${n} aria-pressed=${vias === n ? "true" : "false"} onClick=${() => setVias(n)}>${n} via${n > 1 ? "s" : ""}</button>`)}</div>` : null}
      ${tipo === "osrecibo" ? html`<div class="seg" role="group" aria-label="Cuidados do motor">${[["1", "Com cuidados do motor"], ["0", "Sem cuidados do motor"]].map(([v, t]) => html`<button type="button" key=${v} aria-pressed=${(params.motor !== "0") === (v === "1") ? "true" : "false"} onClick=${() => ir("/imprimir/osrecibo/" + id + (v === "0" ? "?motor=0" : ""))}>${t}</button>`)}</div>` : null}
      <span class="espaco"></span>
      ${tipo === "recibo" && doc && !doc.cancelado && pode(perfil, "entregar") ? html`<button type="button" class="btn btn-perigo" onClick=${cancelarRecibo}>Cancelar recibo</button>` : null}
      ${tipo === "venda" && doc && doc.status === "concluida" && pode(perfil, "entregar") ? html`<button type="button" class="btn btn-perigo" onClick=${cancelarVenda}>Cancelar venda</button>` : null}
      ${tipo === "venda" && doc ? html`<button type="button" class="btn" onClick=${() => ir("/imprimir/venda/" + id + (formato === "cupom" ? "" : "?formato=cupom"))}>${formato === "cupom" ? "Folha A4" : "Cupom 80 mm"}</button>` : null}
      <button type="button" class="btn btn-pri" disabled=${!doc} onClick=${() => window.print()}>Imprimir / salvar PDF</button>
    </div>
    ${erro ? html`<div class="erros so-tela">${erro}</div>` : !doc ? html`<div class="carregando">Preparando documento…</div>`
      : tipo === "os" ? (formato === "cupom" ? html`<${CupomOS} o=${doc} valores=${valores} />` : Array.from({ length: nVias }, (_, n) => html`<${ViaOS} key=${n} o=${doc} cli=${cli} vei=${vei} valores=${valores} via=${n + 1} nVias=${nVias} />`))
      : tipo === "salao" ? html`<${FichaSalao} o=${doc} />`
      : tipo === "osrecibo" ? html`<${ViaOSRecibo} o=${doc} recibos=${doc.recibosDaOS} cli=${cli} motor=${params.motor !== "0"} />`
      : tipo === "resumo" ? html`<${ResumoOS} doc=${doc} params=${params} />`
      : tipo === "venda" ? (formato === "cupom" ? html`<${CupomVenda} v=${doc} />` : Array.from({ length: nVias }, (_, n) => html`<${ViaVenda} key=${n} v=${doc} via=${n + 1} nVias=${nVias} />`))
      : tipo === "recibo" ? html`<div class=${"recibos-folha v" + nVias}>${Array.from({ length: nVias }, (_, n) => html`<${ViaRecibo} key=${n} r=${doc} via=${n + 1} nVias=${nVias} />`)}</div>`
      : tipo === "ponto" ? html`<${FolhaPonto} f=${doc.f} ym=${params.mes} extras=${String(params.feriados || "").split(/[^0-9]+/).filter(Boolean).map(Number)} />`
      : tipo === "funcionario" ? html`<${ResumoFuncionario} f=${doc.f} ym=${params.mes} m=${doc.m} />`
      : tipo === "cliente" ? html`<${FichaCliente} c=${doc} />` : html`<${FichaVeiculo} v=${doc} />`}
  </div>`;
}
