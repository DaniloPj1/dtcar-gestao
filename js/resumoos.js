// Resumo de O.S. em aberto (pedido do Danilo em 13/11/2026): as O.S. em aberto de um cliente ou de um veículo num
// documento só — os itens de cada O.S., o total, o que já foi recebido e o que falta receber — com o total geral no fim.
// Usado pela tela de impressão (js/telas/imprimir.js, #/imprimir/resumo/<id>?de=cliente|veiculo) e pelo PDF
// (js/pdfresumo.js), que a função "email" gera para o WhatsApp e o e-mail. Sem window/document: este arquivo também
// roda no Supabase. Só leitura: não mexe em O.S., estoque, financeiro nem no banco.
import { totais, arred, exPlaca, fmtDataHora, fmtTel, fmtDoc, endCompleto } from "./util.js";
import { etapaOS, situacaoOS } from "./regras.js";
import { osQuitada } from "./osrecibo.js";

const n5 = n => String(n ?? "").padStart(5, "0");
const limpo = s => String(s ?? "").replace(/\s+/g, " ").trim();
const curto = (s, n) => s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;

/** Etapa da O.S. para o resumo: "orcamento", "execucao" ou "pagamento". "" = não entra (fechada, recusada, cancelada).
 *  O.S. do sistema antigo entregue sem "a receber" conta como paga (v17), igual ao painel e à O.S. Recibo. */
export function etapaNoResumo(o) {
  const e = etapaOS(o);
  if (e !== "orcamento" && e !== "execucao" && e !== "pagamento") return "";
  if (o.status === "entregue" && osQuitada(o)) return "";
  return e;
}
/** Entra marcada: aprovada (em execução) ou aguardando pagamento. Orçamento não aprovado só entra se o Danilo marcar. */
export const marcadaNoResumo = o => { const e = etapaNoResumo(o); return e === "execucao" || e === "pagamento"; };

/**
 * Tudo o que o resumo mostra, igual na tela e no PDF.
 * ordens = as O.S. escolhidas (linhas da tabela, com a cópia do cliente e do veículo); itens = os itens delas (com ordem_id);
 * de = "cliente" ou "veiculo"; cliente/veiculo = fichas do cadastro para o cabeçalho (opcionais).
 */
export function dadosResumoOS({ ordens = [], itens = [], de = "cliente", cliente = null, veiculo = null, agora = null } = {}) {
  const porOS = new Map();
  for (const i of itens || []) { if (!porOS.has(i.ordem_id)) porOS.set(i.ordem_id, []); porOS.get(i.ordem_id).push(i); }
  const lista = [...(ordens || [])].sort((a, b) => Number(a.numero || 0) - Number(b.numero || 0));
  const chaveVei = o => o.veiculo_id || (o.veiculo && o.veiculo.placa) || "";
  const variosVeiculos = new Set(lista.map(chaveVei)).size > 1;

  const blocos = lista.map(o => {
    // na ordem da O.S.: pela posição e, no empate (posição 0 em tudo), pela hora em que o item entrou
    const its = (porOS.get(o.id) || []).slice().sort((a, b) => (Number(a.posicao) || 0) - (Number(b.posicao) || 0) || String(a.criado_em || "").localeCompare(String(b.criado_em || "")));
    // mesma regra da impressão da O.S. (ViaOS): depois de aprovada, só os itens aprovados; no orçamento, os não recusados
    const aprov = ["execucao", "pronto", "entregue", "recusado"].includes(o.status) && its.some(i => i.aprovado === true);
    const vis = its.filter(i => aprov ? i.aprovado === true : i.aprovado !== false);
    const t = totais(its, o.desconto, aprov);
    const recebido = arred(o.recebido), falta = arred(Math.max(0, t.total - recebido));
    const v = o.veiculo || {}, etapa = etapaNoResumo(o), rec = limpo(o.reclamacao);
    const placa = exPlaca(v.placa), modelo = [v.marca, v.modelo].filter(Boolean).join(" ");
    return {
      id: o.id, numero: o.numero, n5: n5(o.numero), etapa, orcamento: etapa === "orcamento", situacao: (situacaoOS(o) || {}).t || "",
      aberta: o.criado_em ? fmtDataHora(o.criado_em) : "", placa, veiculo: modelo, clienteNome: limpo((o.cliente || {}).nome),
      reclamacao: rec,
      // faixa do título: número, o veículo (só quando o resumo tem mais de um) e a reclamação quando é curta
      faixaVeiculo: variosVeiculos ? [placa, modelo].filter(Boolean).join(" ") : "",
      recNaFaixa: !!rec && rec.length <= (variosVeiculos ? 26 : 46),
      pecas: vis.filter(i => i.tipo === "peca"), servicos: vis.filter(i => i.tipo === "servico"), terceiros: vis.filter(i => i.tipo !== "peca" && i.tipo !== "servico"),
      t, total: t.total, recebido, falta,
    };
  });

  const som = f => arred(blocos.reduce((s, b) => s + (Number(f(b)) || 0), 0));
  const soma = { pecas: som(b => b.t.pecas), servicos: som(b => b.t.servicos), terceiros: som(b => b.t.terceiros), desconto: som(b => b.t.desconto),
    total: som(b => b.total), recebido: som(b => b.recebido), falta: som(b => b.falta) };
  const comRecebido = soma.recebido > 0.005, comTerceiros = blocos.some(b => b.terceiros.length), comOrcamento = blocos.some(b => b.orcamento);

  // ---- cabeçalho: cliente (ficha do cadastro; sem ela, a cópia das O.S. quando todas são do mesmo nome)
  const nomes = [...new Set(blocos.map(b => b.clienteNome).filter(Boolean))];
  const copia = lista.length && nomes.length === 1 ? (lista[0].cliente || {}) : null;
  const base = cliente || copia;
  const cli = base ? { nome: limpo(base.nome), codigo: cliente && cliente.codigo != null ? cliente.codigo : null, doc: base.doc ? fmtDoc(base.doc) : "",
    telefone: [base.telefone, cliente && cliente.telefone2].filter(Boolean).map(fmtTel).join(" / "), endereco: cliente ? endCompleto(cliente) : limpo(base.endereco) } : null;
  // ---- cabeçalho: veículo (um só) ou a lista das placas
  const c0 = lista.length ? (lista[0].veiculo || {}) : {};
  const pega = k => limpo((veiculo && veiculo[k]) || c0[k]);
  const vei = !variosVeiculos && (lista.length || veiculo) ? { placa: exPlaca(pega("placa")), modelo: [pega("marca"), pega("modelo")].filter(Boolean).join(" "), ano: pega("ano"), cor: pega("cor") } : null;
  const vistos = new Set(), veiculos = [];
  for (const b of blocos) { const k = b.placa || b.veiculo; if (!k || vistos.has(k)) continue; vistos.add(k); veiculos.push({ placa: b.placa, modelo: b.veiculo }); }

  // ---- colunas do quadro "Resumo geral", iguais na tela e no PDF (no máximo 4, para a folha e o celular):
  // sem nada recebido, o total aberto em produtos, serviços e terceiros; com algum recebimento, total, recebido e falta receber
  const colunas = comRecebido
    ? [{ t: "Total", de: b => b.total, soma: soma.total }, { t: "Recebido", de: b => b.recebido, soma: soma.recebido }, { t: "Falta receber", de: b => b.falta, soma: soma.falta, forte: true }]
    : [{ t: "Produtos", de: b => b.t.pecas, soma: soma.pecas }, { t: "Serviços", de: b => b.t.servicos, soma: soma.servicos }]
      .concat(comTerceiros ? [{ t: "Terceiros", de: b => b.t.terceiros, soma: soma.terceiros }] : [], [{ t: "Total", de: b => b.total, soma: soma.total, forte: true }]);

  const numeros = blocos.map(b => b.n5);
  const emitidoEm = fmtDataHora((agora ? new Date(agora) : new Date()).toISOString());
  const nota = "Resumo emitido em " + emitidoEm.replace(", ", " às ") + ". " + (blocos.length === 1 ? "A O.S. está em aberto" : "As O.S. estão em aberto")
    + ": os valores podem mudar até o fechamento." + (comOrcamento ? " Orçamento ainda não aprovado está indicado na própria O.S." : "")
    + (comRecebido ? "" : " Nenhum valor foi recebido até a emissão.");
  return {
    de: de === "veiculo" ? "veiculo" : "cliente", blocos, soma, colunas, comRecebido, comTerceiros, comOrcamento, variosVeiculos, cli, vei, veiculos, numeros,
    // "Nº 01927 e 01928" (até duas) ou "7 O.S. em aberto"
    numeroCab: numeros.length && numeros.length <= 2 ? numeros.join(" e ") : "", tituloQtd: numeros.length > 2 ? numeros.length + " O.S. em aberto" : "",
    emitidoEm, nota, clientesDiferentes: nomes.length > 1 ? nomes : [],
  };
}

/** Linha do quadro "Resumo geral": "O.S. 01927 · QOW-8427 · Revisão" (placa só com mais de um veículo; reclamação resumida). */
export const rotuloNoResumo = (b, d) => "O.S. " + b.n5 + (d.variosVeiculos && b.placa ? " · " + b.placa : "") + (b.reclamacao ? " · " + curto(b.reclamacao, 60) : "");

/** Linhas do fecho de cada O.S.: desconto (se houver), total e, com algum recebimento, recebido e falta receber. [{ r, v (número), menos?, forte? }] */
export function fechoDaOS(b) {
  const l = [];
  if (b.t.desconto > 0.005) l.push({ r: "Desconto", v: b.t.desconto, menos: true });
  l.push({ r: "Total da O.S. " + b.n5, v: b.total, forte: true });
  if (b.recebido > 0.005) l.push({ r: "Recebido", v: b.recebido }, { r: "Falta receber", v: b.falta, forte: true });
  return l;
}

/** Nome do arquivo: "Resumo_OS_QOW8427.pdf" (veículo) ou "Resumo_OS_cliente_509.pdf". */
export const nomeArquivoResumo = d => "Resumo_OS_" + (d.de === "veiculo" && d.vei && d.vei.placa ? d.vei.placa.replace(/[^A-Za-z0-9]/g, "")
  : "cliente" + (d.cli && d.cli.codigo != null ? "_" + d.cli.codigo : "")) + ".pdf";
