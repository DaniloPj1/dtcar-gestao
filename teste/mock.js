(() => {
  const uid = () => Math.random().toString(16).slice(2) + "-0000-4000-8000-" + Math.random().toString(16).slice(2, 14);
  const now = () => new Date().toISOString();
  const db = {
    contas: [{ id: "k1", descricao: "Boleto Auto Peças", fornecedor_id: "f1", favorecido: "", categoria: "Fornecedores de peças", documento: "123", valor: 850, vencimento: "2026-10-20", status: "aberta", origem: "boleto" },
      { id: "k2", descricao: "Energia", favorecido: "EDP", categoria: "Energia", documento: "", valor: 420, vencimento: "2026-10-29", status: "aberta", origem: "recorrente" },
      { id: "k3", descricao: "Aluguel", favorecido: "Imobiliária", categoria: "Aluguel", documento: "", valor: 3000, vencimento: "2026-10-05", status: "paga", pago_em: "2026-10-05", valor_pago: 3000, forma_pagamento: "PIX", origem: "recorrente" },
      { id: "k4", descricao: "Peças NF 555", fornecedor_id: "f1", categoria: "Fornecedores de peças", documento: "555-1", valor: 1200, vencimento: "2026-11-10", status: "aberta", origem: "nfe", parcela: 1, parcelas: 2 }],
    perfis: [{ id: "p1", nome: "Danilo", email: "d@x", papel: "admin", ativo: true }, { id: "p2", nome: "Carlos Mecânico", email: "c@x", papel: "mecanico", ativo: true }],
    produtos: [{ id: "pr1", codigo: 101, tipo: "produto", descricao: "AMORTECEDOR DIANT TOYOTA HILUX", referencia: "KYB-334", unidade: "UN", preco_vista: 890, preco_prazo: 940, controla_estoque: true, estoque_atual: 4, ativo: true, categoria: "SUSPENSAO", marca: "KAYABA" },{ id: "pr2", codigo: 102, tipo: "produto", descricao: "PASTILHA DE FREIO DIANT", referencia: "PST-11", unidade: "JG", preco_vista: 260, controla_estoque: true, estoque_atual: 0, ativo: true },{ id: "pr3", codigo: 103, tipo: "produto", descricao: "FILTRO DE OLEO", unidade: "UN", preco_vista: 45, controla_estoque: true, estoque_atual: 1, estoque_min: 3, avisar_estoque_baixo: true, ativo: true },{ id: "pr4", codigo: 104, tipo: "servico", descricao: "ALINHAMENTO", unidade: "SERV", preco_vista: 120, ativo: true }],
    clientes: [{ id: "c1", nome: "Cliente Teste", telefone: "27999990000", situacao: "liberado" }], veiculos: [{ id: "v1", placa: "ABC1D23", marca: "Fiat", modelo: "Uno", ano: "2015", cliente_id: "c1", km_atual: 1000 }, { id: "v2", placa: "QXN1E49", marca: "Toyota", modelo: "Hilux", ano: "2022", cliente_id: "c1", km_atual: 50000 }], fornecedores: [{ id: "f1", razao: "AUTO PECAS COLATINA LTDA", fantasia: "AutoPeças", cnpj: "", telefone: "", cidade: "Colatina", uf: "ES" }],
    ordens: [{ id: "o2", numero: 1898, recebido: 0, status: "execucao", cliente_id: "c1", veiculo_id: "v2", mecanico_nome: "Carlos", criado_em: "2026-10-29T07:15:00-03:00", atualizado_em: "2026-10-29T07:15:00-03:00", cliente: { nome: "Ministério Vale do Rio Doce", telefone: "27999990000" }, veiculo: { placa: "QXN1E49", marca: "Toyota", modelo: "Hilux", ano: "2022" }, km_entrada: 51000, total: 2650, checkin: { feito: true }, box: "3", situacao: "", tabela_preco: "vista", condicoes_pagamento: "Pagamento na retirada do veículo." },
      { id: "o3", numero: 1897, status: "pronto", cliente_id: "c1", veiculo_id: "v1", mecanico_nome: "Carlos", criado_em: "2026-10-29T07:10:00-03:00", cliente: { nome: "Cliente Teste", telefone: "27999990000" }, veiculo: { placa: "ABC1D23", marca: "Fiat", modelo: "Uno", ano: "2015" }, km_entrada: 1200, total: 300, recebido: 0, checkin: { feito: true }, tabela_preco: "vista" },
      { id: "o4", numero: 1896, status: "aguardando", cliente_id: "c1", veiculo_id: "v1", criado_em: "2026-10-28T10:00:00-03:00", cliente: { nome: "Cliente Teste", telefone: "27999990000" }, veiculo: { placa: "ABC1D23", marca: "Fiat", modelo: "Uno", ano: "2015" }, km_entrada: 1100, total: 500, recebido: 0, checkin: { feito: true }, tabela_preco: "vista" },
      { id: "o1", numero: 1890, status: "entregue", mecanico_id: "p2", mecanico_nome: "Carlos Mecânico", entregue_em: "2026-10-10T15:00:00-03:00", criado_em: "2026-10-09T10:00:00-03:00", cliente: { nome: "Cliente Teste" }, veiculo: { placa: "ABC1D23" }, total: 900 }],
    os_itens: [{ id: "i6", ordem_id: "o3", tipo: "servico", descricao: "REVISÃO", qtd: 1, valor_unit: 300, desconto: 0, aprovado: true, executado: true, posicao: 0 },
      { id: "i7", ordem_id: "o4", tipo: "peca", descricao: "PASTILHA", qtd: 1, valor_unit: 200, desconto: 0, aprovado: null, posicao: 0 }, { id: "i8", ordem_id: "o4", tipo: "servico", descricao: "TROCA DE PASTILHAS", qtd: 1, valor_unit: 300, desconto: 0, aprovado: null, posicao: 1 },{ id: "i3", ordem_id: "o2", tipo: "peca", codigo: "KYB-334", descricao: "AMORTECEDOR DIANT TOYOTA HILUX", qtd: 2, valor_unit: 890, desconto: 0, aprovado: true, executado: false, posicao: 0 },
      { id: "i4", ordem_id: "o2", tipo: "servico", descricao: "TROCA DE AMORTECEDORES DIANTEIROS", qtd: 1, valor_unit: 350, desconto: 0, aprovado: true, executado: true, posicao: 1 },
      { id: "i5", ordem_id: "o2", tipo: "peca", codigo: "PST-11", descricao: "PASTILHA DE FREIO DIANT", qtd: 1, valor_unit: 260, desconto: 20, aprovado: null, posicao: 2 },{ id: "i1", ordem_id: "o1", tipo: "servico", qtd: 1, valor_unit: 600, desconto: 0, aprovado: true }, { id: "i2", ordem_id: "o1", tipo: "peca", qtd: 1, valor_unit: 300, desconto: 0, aprovado: true }],
    funcionarios: [], funcionario_lanc: [], receber: [], config: {},
  };
  const net = () => { if (!navigator.onLine) throw new Error("TypeError: Failed to fetch"); };
  const tab = n => ({ listar: async () => { net(); return db[n].slice(); }, salvar: async o => { if (o.id) { const i = db[n].findIndex(x => x.id === o.id); db[n][i] = { ...db[n][i], ...o, atualizado_em: now() }; return db[n][i]; } const x = { id: uid(), criado_em: now(), atualizado_em: now(), ...o }; db[n].push(x); return x; }, excluir: async id => { db[n] = db[n].filter(x => x.id !== id); } });
  window.__DB = db;
  window.__API_MOCK = {
    tipo: "mock",
    auth: { sessao: async () => ({ user: { id: "p1", email: "d@x" } }), aoMudar: () => () => {}, sair: async () => {} },
    meuPerfil: async () => { net(); return db.perfis[0]; }, perfis: async () => { net(); return db.perfis; },
    config: async () => { net(); return db.config; }, salvarConfig: async d => { db.config = d; },
    clientes: tab("clientes"), veiculos: tab("veiculos"), produtos: tab("produtos"), fornecedores: tab("fornecedores"),
    ordens: async () => { net(); return db.ordens; }, alterados: async () => [], urlArquivo: async () => "",
    itensDasOrdens: async ids => db.os_itens.filter(i => ids.includes(i.ordem_id)),
    sincronizarAbertura: async op => { net(); window.__SEQ = (window.__SEQ || 1898) + 1; const o = { ...op.ordem, numero: window.__SEQ }; db.ordens.unshift(o); if (op.cliente) db.clientes.push(op.cliente); if (op.veiculo) db.veiculos.push(op.veiculo); window.__SYNC = (window.__SYNC || []).concat([op.provisorio + "->" + o.numero]); return { id: o.id, numero: o.numero, nova: true }; },
    evento: async (oid, tipo, texto) => { (window.__EV = window.__EV || []).push(tipo + ": " + texto); },
    temV11: () => true, temV12: () => true,
    receber: { abertas: async () => { net(); return db.receber.filter(p => p.status === "aberta"); }, listar: async ({ status } = {}) => db.receber.filter(p => !status || p.status === status),
      daOrdem: async oid => db.receber.filter(p => p.ordem_id === oid), lancar: async ls => { const xs = ls.map(l => ({ id: uid(), status: "aberta", criado_em: now(), ...l })); db.receber.push(...xs); return xs; },
      atualizar: async (id, patch) => { const p = db.receber.find(x => x.id === id); Object.assign(p, patch); return p; } },
    espelhoZerar: async () => ({}),
    ordemNoAparelho: async id => (window.__GUARD = window.__GUARD || {})[id] || null,
    guardarOrdem: async id => { net(); const o = db.ordens.find(x => x.id === id); (window.__GUARD = window.__GUARD || {})[id] = { ...o }; return o; },
    testarConexao: async () => navigator.onLine,
    atualizarOrdem: async (id, patch) => { net(); const o = db.ordens.find(x => x.id === id); Object.assign(o, patch, { atualizado_em: new Date().toISOString() });
      if (o.status === "entregue") o.finalizada_em = (o.recebido || 0) >= (o.total || 0) ? (o.finalizada_em || new Date().toISOString()) : null; },
    salvarItens: async (oid, itens, rem) => { db.os_itens = db.os_itens.filter(i => !(rem || []).includes(i.id)); for (const it of itens) { const k = db.os_itens.findIndex(x => x.id === it.id); if (k >= 0) db.os_itens[k] = { ...it, ordem_id: oid }; else db.os_itens.push({ ...it, ordem_id: oid }); } },
    enviarArquivo: async c => c, incluirFotos: async () => {},
    recibos: { listar: async ({ ordemId } = {}) => (db.recibos || []).filter(r => !ordemId || r.ordem_id === ordemId), salvar: async r => { const x = { id: "r" + Date.now(), numero: 1, ...r }; (db.recibos = db.recibos || []).push(x); const o = db.ordens.find(y => y.id === r.ordem_id); if (o) { o.recebido = (o.recebido || 0) + Number(r.valor); if (o.status === "entregue" && o.recebido >= o.total) o.finalizada_em = new Date().toISOString(); } return x; }, um: async id => db.recibos.find(x => x.id === id) }, criarOrdem: async d => { net(); window.__SEQ = (window.__SEQ || 1898) + 1; const o = { id: "n" + window.__SEQ, numero: window.__SEQ, ...d }; db.ordens.unshift(o); return o; },
    ordem: async id => { net(); const o = db.ordens.find(x => x.id === id); return { ...o, itens: db.os_itens.filter(i => i.ordem_id === id), fotos: [], eventos: [] }; },
    produtos: { ...tab("produtos") },
    vinculos: { doProduto: async () => [], listar: async () => [] },
    notas: { listar: async () => [] },
    estoque: { movimentos: async () => [], movimentar: async (id, tipo, q) => { const p = db.produtos.find(x => x.id === id); p.estoque_atual = tipo === "entrada" ? +p.estoque_atual + q : tipo === "saida" ? +p.estoque_atual - q : q; return p.estoque_atual; } },
    contas: { abertas: async () => db.contas.filter(c => c.status === "aberta"), listar: async ({ de, ate, campo = "vencimento", status } = {}) => db.contas.filter(c => (!de || (c[campo] || "") >= de) && (!ate || (c[campo] || "") <= ate) && (!status || c.status === status) && (campo !== "pago_em" || c[campo])), salvar: async c => { const x = { id: uid(), status: "aberta", ...c }; db.contas.push(x); return x; } },
    sefaz: { novas: async () => 0, config: async () => null },
    painel: async () => ({}), contasAbertas: async () => [],
    funcionarios: { ...tab("funcionarios"),
      lancamentos: async (comp, fid) => db.funcionario_lanc.filter(l => l.competencia === comp && (!fid || l.funcionario_id === fid)),
      lancar: async l => { const x = { id: uid(), criado_em: now(), ...l }; db.funcionario_lanc.push(x); return x; },
      excluirLanc: async id => { db.funcionario_lanc = db.funcionario_lanc.filter(x => x.id !== id); },
      ordensEntregues: async (ini, fim) => db.ordens.filter(o => o.status === "entregue" && o.entregue_em >= ini.slice(0, 10) && o.entregue_em < fim.slice(0, 10)) },
  };
})();
