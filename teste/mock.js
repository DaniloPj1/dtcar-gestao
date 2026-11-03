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
      { id: "o5", numero: 1745, status: "entregue", legado: 1745, legado_receber: true, recebido: 3854.84, finalizada_em: null, entregue_em: "2026-07-29T12:00:00-03:00", criado_em: "2026-07-29T12:00:00-03:00", cliente: { nome: "Marbrasa Norte Mineradora Ltda" }, veiculo: { placa: "PWE7D33" }, total: 5354.84 },
      { id: "o6", numero: 1700, status: "entregue", legado: 1700, recebido: 0, finalizada_em: "2026-06-01T12:00:00-03:00", entregue_em: "2026-06-01T12:00:00-03:00", criado_em: "2026-06-01T10:00:00-03:00", cliente: { nome: "Cliente Antigo" }, veiculo: { placa: "AAA1B22" }, total: 400 },
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
    whatsapp: { situacao: async () => ({ ...(window.__ZAP = window.__ZAP || { situacao: "desligado", numero: "", detalhe: "", atualizado_em: now(), dono_ate: null, motor_chave_em: null, motor_visto: null, motor_info: null, pedido: null }) }),
      novaChaveMotor: async () => { window.__ZAP.motor_chave_em = now(); return "dtm_" + "c".repeat(64); },
      revogarMotor: async () => { window.__ZAP.motor_chave_em = null; },
      fila: async () => (window.__ZAP_FILA || []).slice(),
      conversas: async () => (window.__ZAP_CONVERSAS || []).slice(),
      cancelar: async id => { const f = (window.__ZAP_FILA || []).find(x => x.id === id); if (!f || f.status !== "pendente") throw new Error("Só dá para cancelar mensagem que ainda não saiu (pendente)."); f.status = "cancelada"; f.erro = "Cancelada pelo administrador."; return f; },
      chamar: async b => { (window.__ZAP_CHAMADAS = window.__ZAP_CHAMADAS || []).push(b.acao); const z = window.__ZAP;
        if (b.acao === "testar") { z.detalhe = "Teste de conexão: o WhatsApp respondeu."; return { ok: true, ms: 2300, resposta: "qr", cifras: { ctr: false, gcm: true, cbc: true } }; }
        if (b.acao === "parear_qr") { z.situacao = "pareando"; z.atualizado_em = now(); z.qr_svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect width="2" height="2"/></svg>'; return { qr: true, validade_s: 130 }; }
        if (b.acao === "parear") { z.situacao = "pareando"; z.numero = b.numero; return { codigo: "ABCD1234", validade_s: 120 }; }
        if (b.acao === "conferir") return { ok: true, ms: 3100 };
        if (b.acao === "processar") return { ok: true, iniciado: true, detalhe: "Buscando mensagens novas e enviando a fila (leva até 2 minutos)." };
        if (b.acao === "desconectar" && window.__ZAP_OCUPADA) return { ok: false, resposta: "ocupada", detalhe: "A conexão está em uso (ou o banco não confirmou a reserva). Tente de novo em 1 minuto." };
        if (b.acao === "desconectar") { if (z.dono === "android" && z.dono_ate > now()) { z.pedido = "desconectar"; return { ok: true, pedido: true, detalhe: "Pedido enviado ao motor do Android: ele desconecta em até 30 segundos." }; } z.situacao = "desligado"; z.numero = ""; return { ok: true }; }
        throw new Error("Ação desconhecida."); } },
    receber: { abertas: async () => { net(); return db.receber.filter(p => p.status === "aberta"); }, listar: async ({ status } = {}) => db.receber.filter(p => !status || p.status === status),
      daOrdem: async oid => db.receber.filter(p => p.ordem_id === oid), lancar: async ls => { const xs = ls.map(l => ({ id: uid(), status: "aberta", criado_em: now(), ...l })); db.receber.push(...xs); return xs; },
      atualizar: async (id, patch) => { const p = db.receber.find(x => x.id === id); Object.assign(p, patch); return p; },
      um: async id => { const p = db.receber.find(x => x.id === id); if (!p) throw new Error("não encontrada"); return { ...p }; } },
    // boletos Sicredi (supabase/v28.sql)
    boletos: { listar: async () => { net(); return (db.boletos = db.boletos || []).slice(); }, daOrdem: async oid => (db.boletos || []).filter(b => b.ordem_id === oid),
      porNossoNumero: async l => (db.boletos || []).filter(b => l.includes(b.nosso_numero)),
      incluir: async ls => { db.boletos = db.boletos || []; if (ls.some(l => db.boletos.some(b => b.nosso_numero === l.nosso_numero))) throw new Error("nosso número repetido");
        const xs = ls.map(l => ({ id: uid(), criado_em: now(), tarifa: 0, qr_url: "", txid: "", ocorrencia: "", ...l })); db.boletos.push(...xs); return xs; },
      atualizar: async (id, patch) => { const b = db.boletos.find(x => x.id === id); Object.assign(b, patch); return b; },
      reservarPagamento: async (id, patch) => { const b = db.boletos.find(x => x.id === id); if (b.situacao === "pago") return null; Object.assign(b, patch, { situacao: "pago" }); return b; },
      proximo: async chave => { window.__CONT = window.__CONT || {}; return (window.__CONT[chave] = (window.__CONT[chave] || 0) + 1); },
      arquivos: { listar: async () => (db.boletos_arquivos || []).slice().reverse(), um: async id => (db.boletos_arquivos || []).find(a => a.id === id),
        porHash: async h => (db.boletos_arquivos || []).find(a => a.hash === h) || null,
        salvar: async a => { const x = { id: uid(), criado_em: now(), ...a }; (db.boletos_arquivos = db.boletos_arquivos || []).push(x); return x; } } },
    temBoletos: () => true,
    espelhoZerar: async () => ({}),
    ordemNoAparelho: async id => (window.__GUARD = window.__GUARD || {})[id] || null,
    guardarOrdem: async id => { net(); const o = db.ordens.find(x => x.id === id); (window.__GUARD = window.__GUARD || {})[id] = { ...o }; return o; },
    testarConexao: async () => navigator.onLine,
    atualizarOrdem: async (id, patch) => { net(); const o = db.ordens.find(x => x.id === id); Object.assign(o, patch, { atualizado_em: new Date().toISOString() });
      if (o.status === "entregue") o.finalizada_em = (o.recebido || 0) >= (o.total || 0) ? (o.finalizada_em || new Date().toISOString()) : null; },
    salvarItens: async (oid, itens, rem) => { db.os_itens = db.os_itens.filter(i => !(rem || []).includes(i.id)); for (const it of itens) { const k = db.os_itens.findIndex(x => x.id === it.id); if (k >= 0) db.os_itens[k] = { ...it, ordem_id: oid }; else db.os_itens.push({ ...it, ordem_id: oid }); } },
    enviarArquivo: async c => c, incluirFotos: async () => {},
    recibos: { desde: async de => { if (window.__FALHA_RECIBOS) throw new Error("falha simulada"); return (db.recibos || []).filter(r => !r.data || r.data >= de); }, listar: async ({ ordemId } = {}) => (db.recibos || []).filter(r => !ordemId || r.ordem_id === ordemId), salvar: async r => { if (r.id) { const o = db.recibos.find(y => y.id === r.id); if (r.cancelado && !o.cancelado && o.conta_destino) (db.estornos = db.estornos || []).push({ id: "e" + Date.now(), conta: o.conta_destino, valor: -o.valor, origem: "recibo", registro: o.id, original_em: o.criado_em, registrado_em: new Date().toISOString() }); Object.assign(o, r); return o; } const x = { id: "r" + Date.now(), numero: 1, criado_em: new Date().toISOString(), ...r }; (db.recibos = db.recibos || []).push(x); const o = db.ordens.find(y => y.id === r.ordem_id); if (o) { o.recebido = (o.recebido || 0) + Number(r.valor); if (o.status === "entregue" && o.recebido >= o.total) o.finalizada_em = new Date().toISOString(); } return x; }, um: async id => db.recibos.find(x => x.id === id) }, criarOrdem: async d => { net(); window.__SEQ = (window.__SEQ || 1898) + 1; const o = { id: "n" + window.__SEQ, numero: window.__SEQ, ...d }; db.ordens.unshift(o); return o; },
    ordem: async id => { net(); const o = db.ordens.find(x => x.id === id); return { ...o, itens: db.os_itens.filter(i => i.ordem_id === id), fotos: [], eventos: [] }; },
    produtos: { ...tab("produtos") },
    vinculos: { doProduto: async () => [], listar: async () => [] },
    notas: { listar: async () => [] },
    estoque: { movimentos: async () => [], movimentar: async (id, tipo, q) => { const p = db.produtos.find(x => x.id === id); p.estoque_atual = tipo === "entrada" ? +p.estoque_atual + q : tipo === "saida" ? +p.estoque_atual - q : q; return p.estoque_atual; } },
    contas: { abertas: async () => db.contas.filter(c => c.status === "aberta"), listar: async ({ de, ate, campo = "vencimento", status } = {}) => db.contas.filter(c => (!de || (c[campo] || "") >= de) && (!ate || (c[campo] || "") <= ate) && (!status || c.status === status) && (campo !== "pago_em" || c[campo])), salvar: async c => { if (c.id) { const o = db.contas.find(x => x.id === c.id); const antes = o.status; Object.assign(o, c, { atualizado_em: now() }); if (o.status === "paga" && antes !== "paga") o.pago_registrado_em = now(); if (o.status !== "paga") o.pago_registrado_em = null; return o; } const x = { id: uid(), status: "aberta", ...c }; db.contas.push(x); return x; } },
    transferencias: { listar: async ({ de, ate } = {}) => (db.transferencias || []).filter(t => (!de || t.data >= de) && (!ate || t.data <= ate)), salvar: async t => { const x = { id: uid(), criado_em: now(), ...t }; (db.transferencias = db.transferencias || []).push(x); return x; }, excluir: async id => { db.transferencias = db.transferencias.filter(t => t.id !== id); } },
    temV18: () => true,
    // mesmas regras da função saldos_contas do v18 (no servidor, numa consulta só)
    saldosContas: async () => { if (window.__FALHA_RECIBOS) throw new Error("sem conexão"); const dia = em => em ? new Date(em).toISOString().slice(0, 10) : "";
      return (db.config.contasFinanceiras || []).map(c => { const em = c.em, d0 = dia(em), dep = (data, reg) => !em || (reg ? reg > em && data >= d0 : data > d0);
        const s = l => l.reduce((t, x) => t + Number(x), 0);
        const ent = s((db.recibos || []).filter(r => !r.cancelado && r.conta_destino === c.nome && dep(r.data, r.criado_em || "9")).map(r => r.valor));
        const sai = s(db.contas.filter(x => x.status === "paga" && x.conta_origem === c.nome && dep(x.pago_em, x.pago_registrado_em)).map(x => x.valor_pago ?? x.valor));
        const tEnt = s((db.transferencias || []).filter(t => t.para_conta === c.nome && dep(t.data, t.criado_em)).map(t => t.valor)), tSai = s((db.transferencias || []).filter(t => t.de_conta === c.nome && dep(t.data, t.criado_em)).map(t => t.valor));
        const est = s((db.estornos || []).filter(e => e.conta === c.nome && em && e.original_em && e.original_em <= em && e.registrado_em > em).map(e => e.valor));
        return { ...c, ent: ent + Math.max(est, 0), sai: sai - Math.min(est, 0), tEnt, tSai, est, atual: Math.round((Number(c.saldo) + ent - sai + tEnt - tSai + est) * 100) / 100 }; }); },
    guardarSaldosContas: async (contas, pagar, receber, por) => { const at = await window.__API_MOCK.saldosContas(); const em = new Date().toISOString();
      const novas = contas.map(c => ({ nome: c.nome, saldo: c.saldo == null ? ((at.find(x => x.nome === (c.antigo || c.nome)) || {}).atual || 0) : c.saldo, em, por }));
      db.config = { ...db.config, contasFinanceiras: novas, contaPagamento: pagar, contaRecebimento: receber, caixaSaldo: { valor: novas.reduce((t, c) => t + c.saldo, 0), em, por } }; return novas; },
    estornos: { desde: async (de, ate) => (db.estornos || []).filter(e => e.registrado_em >= de && (!ate || e.registrado_em <= ate)) },
    sefaz: { novas: async () => 0, config: async () => null },
    painel: async () => ({}), contasAbertas: async () => [],
    funcionarios: { ...tab("funcionarios"),
      lancamentos: async (comp, fid) => db.funcionario_lanc.filter(l => l.competencia === comp && (!fid || l.funcionario_id === fid)),
      lancar: async l => { const x = { id: uid(), criado_em: now(), ...l }; db.funcionario_lanc.push(x); return x; },
      excluirLanc: async id => { db.funcionario_lanc = db.funcionario_lanc.filter(x => x.id !== id); },
      ordensEntregues: async (ini, fim) => db.ordens.filter(o => o.status === "entregue" && o.entregue_em >= ini.slice(0, 10) && o.entregue_em < fim.slice(0, 10)) },
  };
})();
