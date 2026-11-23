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
    clientes: [{ id: "c1", nome: "Cliente Teste", telefone: "27999990000", situacao: "liberado" }], veiculos: [{ id: "v1", placa: "ABC1D23", marca: "Fiat", modelo: "Uno", ano: "2015", cliente_id: "c1", km_atual: 1000, motor: "", ficha_oleo: null }, { id: "v2", placa: "QXN1E49", marca: "Toyota", modelo: "Hilux", ano: "2022", cliente_id: "c1", km_atual: 50000, motor: "", ficha_oleo: null }], fornecedores: [{ id: "f1", razao: "AUTO PECAS COLATINA LTDA", fantasia: "AutoPeças", cnpj: "", telefone: "27988887777", contato: "Joao", cidade: "Colatina", uf: "ES" }, { id: "f2", razao: "DPK DISTRIBUIDORA", fantasia: "", cnpj: "", telefone: "", cidade: "Vitoria", uf: "ES" }],
    produto_fornecedor: [{ id: "pf1", produto_id: "pr1", fornecedor_id: "f2", codigo: "KYB-334", fator: 1, ultimo_custo: 610, ultima_compra: "2026-10-01" }],
    ordens: [{ id: "o2", numero: 1898, recebido: 0, status: "execucao", cliente_id: "c1", veiculo_id: "v2", mecanico_nome: "Carlos", criado_em: "2026-10-29T07:15:00-03:00", atualizado_em: "2026-10-29T07:15:00-03:00", cliente: { nome: "Ministério Vale do Rio Doce", telefone: "27999990000" }, veiculo: { placa: "QXN1E49", marca: "Toyota", modelo: "Hilux", ano: "2022" }, km_entrada: 51000, total: 2650, checkin: { feito: true }, box: "3", situacao: "", tabela_preco: "vista", condicoes_pagamento: "Pagamento na retirada do veículo." },
      { id: "o3", numero: 1897, status: "pronto", cliente_id: "c1", veiculo_id: "v1", mecanico_nome: "Carlos", criado_em: "2026-10-29T07:10:00-03:00", cliente: { nome: "Cliente Teste", telefone: "27999990000" }, veiculo: { placa: "ABC1D23", marca: "Fiat", modelo: "Uno", ano: "2015" }, km_entrada: 1200, total: 300, recebido: 0, checkin: { feito: true }, tabela_preco: "vista" },
      { id: "o4", numero: 1896, status: "aguardando", cliente_id: "c1", veiculo_id: "v1", criado_em: "2026-10-28T10:00:00-03:00", cliente: { nome: "Cliente Teste", telefone: "27999990000" }, veiculo: { placa: "ABC1D23", marca: "Fiat", modelo: "Uno", ano: "2015" }, km_entrada: 1100, total: 500, recebido: 0, checkin: { feito: true }, tabela_preco: "vista" },
      { id: "o5", numero: 1745, status: "entregue", legado: 1745, legado_receber: true, recebido: 3854.84, finalizada_em: null, entregue_em: "2026-07-29T12:00:00-03:00", criado_em: "2026-07-29T12:00:00-03:00", cliente: { nome: "Marbrasa Norte Mineradora Ltda" }, veiculo: { placa: "PWE7D33" }, total: 5354.84 },
      { id: "o6", numero: 1700, status: "entregue", legado: 1700, recebido: 0, finalizada_em: "2026-06-01T12:00:00-03:00", entregue_em: "2026-06-01T12:00:00-03:00", criado_em: "2026-06-01T10:00:00-03:00", cliente: { nome: "Cliente Antigo" }, veiculo: { placa: "AAA1B22" }, total: 400 },
      { id: "o1", numero: 1890, status: "entregue", garantia_dias: 90, mecanico_id: "p2", mecanico_nome: "Carlos Mecânico", entregue_em: "2026-10-10T15:00:00-03:00", criado_em: "2026-10-09T10:00:00-03:00", cliente: { nome: "Cliente Teste" }, veiculo: { placa: "ABC1D23" }, total: 900 }],
    os_itens: [{ id: "i6", ordem_id: "o3", tipo: "servico", descricao: "REVISÃO", qtd: 1, valor_unit: 300, desconto: 0, aprovado: true, executado: true, posicao: 0 },
      { id: "i7", ordem_id: "o4", tipo: "peca", descricao: "PASTILHA", qtd: 1, valor_unit: 200, desconto: 0, aprovado: null, posicao: 0 }, { id: "i8", ordem_id: "o4", tipo: "servico", descricao: "TROCA DE PASTILHAS", qtd: 1, valor_unit: 300, desconto: 0, aprovado: null, posicao: 1 },{ id: "i3", ordem_id: "o2", tipo: "peca", codigo: "KYB-334", descricao: "AMORTECEDOR DIANT TOYOTA HILUX", qtd: 2, valor_unit: 890, desconto: 0, aprovado: true, executado: false, posicao: 0 },
      { id: "i4", ordem_id: "o2", tipo: "servico", descricao: "TROCA DE AMORTECEDORES DIANTEIROS", qtd: 1, valor_unit: 350, desconto: 0, aprovado: true, executado: true, posicao: 1 },
      { id: "i5", ordem_id: "o2", tipo: "peca", codigo: "PST-11", descricao: "PASTILHA DE FREIO DIANT", qtd: 1, valor_unit: 260, desconto: 20, aprovado: null, posicao: 2 },{ id: "i1", ordem_id: "o1", tipo: "servico", qtd: 1, valor_unit: 600, desconto: 0, aprovado: true }, { id: "i2", ordem_id: "o1", tipo: "peca", qtd: 1, valor_unit: 300, desconto: 0, aprovado: true }],
    funcionarios: [], funcionario_lanc: [], receber: [], config: { espelhoLegado: true }, // espelho ligado: os testes conferem a faixa do período de transição
    // pedidos de compra por fornecedor (pre_notas, v19/v31)
    pre_notas: [{ id: "pn1", data: "2026-10-20", fornecedor_id: "f1", fornecedor_nome: "AutoPeças", documento: "PV 100", total: 500, os_numero: 1898, ordem_id: "o2", placa: "QXN1E49", situacao: "aberta", obs: "" },
      { id: "pn2", data: "2026-10-22", fornecedor_id: "f1", fornecedor_nome: "AutoPeças", documento: "PV 101", total: 350, os_numero: null, ordem_id: null, placa: "", situacao: "aberta", obs: "" },
      { id: "pn3", data: "2026-10-23", fornecedor_id: null, fornecedor_nome: "Somax", documento: "Pedido 35136", total: 117, os_numero: 1898, ordem_id: "o2", placa: "QXN1E49", situacao: "aberta", obs: "" }],
  };
  const net = () => { if (!navigator.onLine) throw new Error("TypeError: Failed to fetch"); };
  const tab = n => ({ listar: async () => { net(); return db[n].slice(); }, salvar: async o => { if (o.id) { const i = db[n].findIndex(x => x.id === o.id); db[n][i] = { ...db[n][i], ...o, atualizado_em: now() }; return db[n][i]; } const x = { id: uid(), criado_em: now(), atualizado_em: now(), ...o }; db[n].push(x); return x; }, excluir: async id => { db[n] = db[n].filter(x => x.id !== id); } });
  window.__DB = db;
  window.__API_MOCK = {
    tipo: "mock",
    auth: { sessao: async () => ({ user: { id: "p1", email: "d@x" } }), aoMudar: () => () => {}, sair: async () => {} },
    meuPerfil: async () => { net(); const eu = (window.__PERFIL_ID && db.perfis.find(p => p.id === window.__PERFIL_ID)) || db.perfis[0]; return window.__PAPEL ? { ...eu, papel: window.__PAPEL } : eu; }, perfis: async () => { net(); return window.__PERFIS_VAZIOS ? [] : db.perfis; },
    config: async () => { net(); return db.config; }, salvarConfig: async d => { db.config = d; },
    // função "equipe" de mentira: cria o acesso (como o gatilho + a função) e troca senha; window.__EQUIPE guarda o que foi pedido
    avisosApp: async () => { net(); const orcs = (db.orcamentos || []).filter(o => (o.situacao === "elaboracao" || o.situacao === "enviado") && /^Pedido pelo app/.test(o.obs_internas || ""));
      const evs = (db.eventos || []).filter(e => e.tipo === "a_orcar");
      return [...orcs.map(o => ({ chave: "orc:" + o.id + ":" + (String(o.reclamacao || "").match(/\n— /g) || []).length, tipo: "orcamento", id: o.id, numero: o.numero, veiculo: o.veiculo || {}, cliente: o.cliente || {}, texto: o.reclamacao || "", quem: o.consultor_nome || "", quando: o.atualizado_em || o.criado_em, acrescimo: (String(o.reclamacao || "").match(/\n— /g) || []).length > 0 })),
        ...evs.map(e => { const o = db.ordens.find(x => x.id === e.ordem_id) || { numero: 0, veiculo: {} }; return { chave: "ev:" + e.id, tipo: "os", id: e.ordem_id, numero: o.numero, veiculo: o.veiculo || {}, cliente: {}, texto: e.texto, quem: e.usuario_nome, quando: e.criado_em, acrescimo: false }; })]; },
    // função "pedido" de mentira (pedido de orçamento pelo app): grava em db.orcamentos como a função faria
    pedido: { novo: async d => { net(); window.__PEDIDO = (window.__PEDIDO || []).concat([{ acao: "novo", ...d }]); const texto = String(d.texto || "").trim(); if (texto.length < 3) throw new Error("Escreva o que é para orçar."); db.orcamentos = db.orcamentos || []; window.__ORC_SEQ = (window.__ORC_SEQ || 0) + 1;
        const o = { id: uid(), numero: window.__ORC_SEQ, situacao: "elaboracao", cliente_id: d.cliente_id || null, veiculo_id: d.veiculo_id || null, cliente: { nome: (d.cliente || {}).nome || "", telefone: (d.cliente || {}).telefone || "" }, veiculo: { placa: d.placa || "", ...(d.veiculo || {}) }, reclamacao: texto, obs: "", obs_internas: "Pedido pelo app — " + db.perfis[0].nome + ", 16/11/2026 15:30", total: 0, desconto: 0, itens: [], consultor_id: db.perfis[0].id, consultor_nome: db.perfis[0].nome, criado_por: db.perfis[0].id, criado_em: now(), atualizado_em: now(), enviado_em: null, respondido_em: null, ordem_id: null, os_numero: null };
        db.orcamentos.push(o); return { ok: true, id: o.id, numero: o.numero }; },
      acrescentar: async (id, texto) => { net(); window.__PEDIDO = (window.__PEDIDO || []).concat([{ acao: "acrescentar", id, texto }]); const o = (db.orcamentos || []).find(x => x.id === id); if (!o) throw new Error("Este orçamento não existe mais."); if (o.situacao !== "elaboracao" && o.situacao !== "enviado") throw new Error("Este orçamento já foi aprovado e virou O.S.: acrescente pela O.S."); o.reclamacao = (o.reclamacao || "").trim() + "\n— " + db.perfis[0].nome + ", 16/11/2026 15:31: " + String(texto).trim(); o.atualizado_em = now(); return { ok: true, id, numero: o.numero }; } },
    equipe: { criar: async d => { net(); window.__EQUIPE = (window.__EQUIPE || []).concat([{ acao: "criar", ...d }]); const login = String(d.login || d.email || "").toLowerCase(), email = login.includes("@") ? login : login + "@app.dtcarcentroautomotivo.com.br"; if (db.perfis.some(p => p.email === email)) throw new Error((login.includes("@") ? "Este e-mail" : "Este usuário") + " já tem acesso. Use “Trocar senha” na pessoa, ou escolha outro."); const id = "p" + (db.perfis.length + 1); db.perfis.push({ id, nome: d.nome, email, papel: d.papel, ativo: true }); return { ok: true, id, email, usuario: login.includes("@") ? "" : login }; },
      senha: async d => { net(); window.__EQUIPE = (window.__EQUIPE || []).concat([{ acao: "senha", ...d }]); return { ok: true, id: d.id }; } },
    clientes: tab("clientes"), veiculos: tab("veiculos"), produtos: tab("produtos"), fornecedores: tab("fornecedores"),
    ordens: async () => { net(); return db.ordens; }, alterados: async (k, desde) => (db[k] || []).filter(r => r.atualizado_em && (!desde || r.atualizado_em > desde)), urlArquivo: async () => "",
    itensDasOrdens: async ids => { net(); return db.os_itens.filter(i => ids.includes(i.ordem_id)); },
    sincronizarAbertura: async op => { net(); window.__SEQ = (window.__SEQ || 1898) + 1; const o = { ...op.ordem, numero: window.__SEQ }; db.ordens.unshift(o); if (op.cliente) db.clientes.push(op.cliente); if (op.veiculo) db.veiculos.push(op.veiculo); window.__SYNC = (window.__SYNC || []).concat([op.provisorio + "->" + o.numero]); return { id: o.id, numero: o.numero, nova: true }; },
    evento: async (oid, tipo, texto, usuario_nome) => { (window.__EV = window.__EV || []).push(tipo + ": " + texto); (db.eventos = db.eventos || []).push({ id: uid(), ordem_id: oid, tipo, texto, usuario_nome: usuario_nome || "", criado_em: now() }); },
    temV11: () => true, temV12: () => true,
    // v50: lista do técnico responsável (funcionários ativos + acessos sem ficha) e desconto da O.S. com as parcelas
    tecnicos: async () => { net(); if (window.__SEM_V50) return null;
      const f = db.funcionarios.filter(x => x.ativo !== false).map(x => ({ tipo: "funcionario", id: x.id, nome: x.nome, apelido: x.apelido || "", perfil_id: x.perfil_id || null, funcao: x.funcao || "" }));
      const p = db.perfis.filter(x => x.ativo !== false && ["admin", "consultor", "mecanico"].includes(x.papel) && !db.funcionarios.some(y => y.ativo !== false && y.perfil_id === x.id))
        .map(x => ({ tipo: "acesso", id: x.id, nome: x.nome, apelido: "", perfil_id: x.id, funcao: x.papel }));
      return f.concat(p).sort((a, b) => a.nome.localeCompare(b.nome)); },
    descontoOS: async (ordemId, desconto, motivo, gravar = true) => { net();
      const r2 = v => Math.round(v * 100) / 100, o = db.ordens.find(x => x.id === ordemId), apr = ["execucao", "pronto", "entregue", "recusado"].includes(o.status);
      if (o.status === "entregue" && o.finalizada_em) throw new Error("A O.S. está fechada (quitada). Reabra antes de mudar o desconto.");
      const bruto = r2(db.os_itens.filter(i => i.ordem_id === ordemId && (apr ? i.aprovado === true : i.aprovado !== false)).reduce((s, i) => s + i.qtd * i.valor_unit - (i.desconto || 0), 0));
      if (desconto > bruto + 0.005) throw new Error("O desconto não pode passar do valor dos itens.");
      const total = r2(bruto - desconto), rec = (db.recibos || []).filter(x => x.ordem_id === ordemId && !x.cancelado).reduce((s, x) => s + Number(x.valor), 0);
      if (total < rec - 0.009) throw new Error("Com esse desconto o total fica menor que o já recebido.");
      const abertas = db.receber.filter(x => x.ordem_id === ordemId && x.status === "aberta").sort((a, b) => b.vencimento.localeCompare(a.vencimento));
      let excesso = r2(abertas.reduce((s, x) => s + x.valor, 0) - (total - rec)); const ajustes = [];
      for (const x of abertas) { if (excesso <= 0.009) break; const corte = Math.min(excesso, x.valor), fica = r2(x.valor - corte);
        ajustes.push({ parcela: x.parcela + "/" + x.parcelas, valor_antes: x.valor, valor: fica, cancelada: fica <= 0.009 });
        if (gravar) { if (fica <= 0.009) x.status = "cancelada"; else x.valor = fica; } excesso = r2(excesso - corte); }
      const fechou = o.status === "entregue" && rec >= total - 0.009;
      if (gravar) { o.desconto = desconto; o.total = total; if (fechou) o.finalizada_em = now(); (window.__EV = window.__EV || []).push("desconto: " + desconto + (motivo ? " (" + motivo + ")" : "")); }
      return { os: o.numero, valor_itens: bruto, desconto, total, recebido: rec, saldo: r2(total - rec), parcelas_ajustadas: ajustes, fechou, avisos: [], gravado: !!gravar }; },
    whatsapp: { situacao: async () => ({ ...(window.__ZAP = window.__ZAP || { situacao: "desligado", numero: "", detalhe: "", atualizado_em: now(), dono_ate: null, motor_chave_em: null, motor_visto: null, motor_info: null, pedido: null }) }),
      novaChaveMotor: async () => { window.__ZAP.motor_chave_em = now(); return "dtm_" + "c".repeat(64); },
      revogarMotor: async () => { window.__ZAP.motor_chave_em = null; },
      fila: async () => (window.__ZAP_FILA || []).slice(),
      alertas: async () => ((window.__ZAP || {}).alertas) || {},
      alertaTelefone: async tel => { const d = String(tel || "").replace(/\D/g, ""); if (d && !/^(55)?\d{10,11}$/.test(d)) throw new Error("Telefone inválido: use DDD + número (ex.: 27 99999-0000)."); window.__ZAP.alerta_telefone = d ? (d.length <= 11 ? "55" + d : d) : null; return { alerta_telefone: window.__ZAP.alerta_telefone }; },
      resumo: async () => ({ sem_resposta: (window.__ZAP_SEM_RESPOSTA || []).slice() }),
      fotos: async () => (window.__ZAP_FOTOS || []).slice(),
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
        // agente de mensagens (23/11/2026): o padrão vem da função; o texto que vale é o da config, quando o Danilo gravou um
        if (b.acao === "agente") { if (window.__ZAP_SEM_AGENTE) throw new Error("Ação desconhecida.");
          const meu = ((db.config || {}).zapAgente || {}).texto || "";
          const padrao = window.__ZAP_AGENTE_PADRAO || "MOLDE: título com ícone em negrito, saudação pela hora, tópicos com • e a assinatura no fim.\nDTCar Centro Automotivo\n*Mensagem gerada pelo sistema Gestão DTCar*";
          return { padrao, texto: meu || padrao, proprio: !!meu, modelo: "claude-haiku-5-5", tem_chave: window.__ZAP_SEM_CHAVE_IA !== true }; }
        throw new Error("Ação desconhecida."); } },
    // NF anexada à O.S. (v33)
    notasOS: { listar: async n => (window.__NOTAS = window.__NOTAS || []).filter(x => x.os_numero === n),
      baixar: async c => new Blob(["%PDF-1.4 nf"], { type: "application/pdf" }),
      adicionar: async (arq, d) => { const x = { id: uid(), ...d, arquivo: d.os_numero + "/" + arq.name, nome_arquivo: arq.name, tipo_arquivo: /xml/i.test(arq.name) ? "application/xml" : "application/pdf", tamanho: arq.size, criado_em: now() };
        (window.__NOTAS = window.__NOTAS || []).push(x); return x; },
      excluir: async n => { window.__NOTAS = window.__NOTAS.filter(y => y.id !== n.id); } },
    // Documentos do RH (v30)
    rh: { listar: async () => (window.__RH = window.__RH || []).slice().sort((a, b) => b.competencia.localeCompare(a.competencia)),
      baixar: async c => { (window.__RH_BAIXADOS = window.__RH_BAIXADOS || []).push(c); return new Blob(["%PDF-1.4 teste"], { type: "application/pdf" }); },
      adicionar: async (arq, d) => { const x = { id: uid(), arquivo: d.competencia + "/x-" + arq.name, nome_arquivo: arq.name, tipo_arquivo: arq.type || "application/pdf", tamanho: arq.size, origem: "manual", criado_em: now(), linha_digitavel: "", ...d }; (window.__RH = window.__RH || []).push(x); return x; },
      atualizar: async (id, patch) => { const x = window.__RH.find(y => y.id === id); Object.assign(x, patch); return x; },
      excluir: async doc => { window.__RH = window.__RH.filter(y => y.id !== doc.id); } },
    // e-mail da oficina (v29 + função "email")
    email: { chamar: async b => { (window.__EMAIL_CHAMADAS = window.__EMAIL_CHAMADAS || []).push(b.acao);
        if (b.acao === "whatsapp") { (window.__ZAP_ENVIOS = window.__ZAP_ENVIOS || []).push(JSON.parse(JSON.stringify(b)));
          return { gravado: b.confirmar === true, erros: [], avisos: ["Fora do horário comercial: a mensagem sai no próximo horário de envio."], telefone: "5527999990000", cliente: { nome: "Cliente Teste" },
            texto: b.texto || "Olá, Cliente! O orçamento do seu Fiat Uno está pronto (OS 0" + b.numero_os + ").", arquivo: b.anexo ? { nome: "Orcamento_0" + b.numero_os + "_ABC1D23.pdf", kb: 150 } : null,
            ...(b.confirmar ? { id: 9, posicao_na_fila: 1 } : {}) }; }
        const e = window.__EMAIL = window.__EMAIL || { situacao: "desligado", ligado: true, conta: "", nome: "", detalhe: "", conectado_em: null, ultimo_uso: null, enviados_hoje: 0,
          configurado: false, endereco_retorno: "https://exemplo.supabase.co/functions/v1/email",
          lista_regras: [{ id: 1, tipo: "fraude", alvo: "nome", valor: "sisbra", obs: "Cobrança fraudulenta no DDA (02/11/2026)", origem: "padrao" }, { id: 2, tipo: "importante", alvo: "dominio", valor: "sicredi.com.br", obs: "Banco", origem: "padrao" }] };
        if (b.acao === "situacao") return { ...e, regras: e.lista_regras.length, lista_regras: e.lista_regras.slice() };
        if (b.acao === "conectar") { if (!e.configurado) throw new Error("Falta cadastrar o segredo MS_CLIENT_ID da função \"email\" no Supabase (Edge Functions › Secrets)."); window.__EMAIL_LOGIN = true; return { url: "about:blank#login-microsoft", validade_min: 10 }; }
        if (b.acao === "desconectar") { Object.assign(e, { situacao: "desligado", conta: "", nome: "" }); return { ok: true }; }
        if (b.acao === "regra") { if (b.alvo === "remetente" && !/@/.test(b.valor)) throw new Error("Remetente precisa ser um e-mail completo (nome@dominio)."); const r = { id: Date.now(), tipo: b.tipo, alvo: b.alvo, valor: String(b.valor).toLowerCase().trim(), obs: b.obs || "", origem: "danilo" }; e.lista_regras.push(r); return r; }
        if (b.acao === "importar_rh") { (window.__RH_IMPORT = window.__RH_IMPORT || []).push(b.remetentes); const fila = window.__RH_EMAIL || []; const lote = fila.splice(0, 2);
          for (const x of lote) (window.__RH = window.__RH || []).push({ id: uid(), origem: "email", criado_em: now(), linha_digitavel: "", valor: null, vencimento: null, tipo_arquivo: "image/png", ...x });
          return { importados: lote.length, restam: fila.length }; }
        // v35: cópia de leitura (backup_situacao / backup_leitura)
        if (b.acao === "backup_situacao") { const c = (db.config && db.config.backupLeitura) || {}; return { execucoes: (window.__BACKUP_EXEC = window.__BACKUP_EXEC || []).slice().reverse(), senha_cadastrada: window.__BACKUP_SEM_SENHA !== true,
          config: { ativo: c.ativo !== false, emails: c.emails || ["centroautomotivodtcar@hotmail.com", "dono@exemplo.com"] }, horario: "todo dia às 18h" }; }
        if (b.acao === "backup_leitura") { const l = window.__BACKUP_EXEC = window.__BACKUP_EXEC || [];
          l.push({ id: l.length + 1, iniciado_em: now(), terminado_em: now(), origem: "tela", situacao: "ok", passo: "enviar", para: ["centroautomotivodtcar@hotmail.com", "dono@exemplo.com"], detalhe: { zips: [{ nome: "DTCar-Backup.zip", bytes: 1130000 }] } });
          return { exec: l.length, aviso: "Backup começou: em 1 a 2 minutos chega nos e-mails." }; }
        if (b.acao === "remover_regra") { e.lista_regras = e.lista_regras.filter(r => r.id !== b.id); return { ok: true }; }
        throw new Error("Ação desconhecida."); },
      envios: async () => (window.__EMAIL_ENVIOS || []).slice(),
      ligar: async v => { window.__EMAIL.ligado = !!v; return {}; } },
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
    // Consulta pela placa (função "placa", v55): window.__PLACA guarda as chamadas e deixa o teste mudar a resposta.
    // Padrão: toda placa nova é um VW CrossFox; ZZZ9Z99 não existe; "situacao" simula função desligada ("desligada"), sem saldo ("saldo")
    // ou servidor sem resposta ("semresposta": o que o navegador vê sem conexão ou com a função ainda não publicada).
    placa: async body => { const P = window.__PLACA = window.__PLACA || {}; P.chamadas = P.chamadas || []; P.chamadas.push(body);
      if (P.saldo === undefined) P.saldo = 1000;
      if (P.situacao === "desligada") return { ok: false, desligada: true, erro: "A consulta de placa ainda não foi ligada: falta a chave do API Placas." };
      if (P.situacao === "semresposta") return { ok: false, semRede: true, erro: "Sem resposta da consulta de placa (sem conexão, ou a consulta ainda não foi ligada no Supabase)." };
      if (body.acao === "saldo") return { ok: true, saldo_centavos: P.saldo, saldo_formatado: "R$ " + (P.saldo / 100).toFixed(2).replace(".", ","), consultas_disponiveis: Math.floor(P.saldo / 3), preco: { basico: 3, completa: 20 }, limite_dia: 100, pagas_hoje: 0 };
      if (P.situacao === "saldo") return { ok: false, sem_saldo: true, erro: "Acabou o saldo da consulta de placa (API Placas)." };
      if (body.placa === "ZZZ9Z99") return { ok: true, encontrado: false, placa: body.placa };
      const cad = db.veiculos.find(v => v.placa === body.placa);
      if (cad && body.acao === "basico" && cad.marca && cad.modelo && cad.ano_fab && cad.cor && cad.combustivel) return { ok: true, encontrado: true, placa: body.placa, tipo: "basico", origem: "cadastro", dados: cad, valor_centavos: 0 };
      const valor = body.acao === "completa" ? 20 : 3; P.saldo -= valor;
      const dados = { ...(P.dados || { marca: "Volkswagen", modelo: "CROSSFOX", ano_fab: 2007, ano_mod: 2008, cor: "Prata", combustivel: "Flex", combustivel_detran: "Alcool / Gasolina", motor: "1.6", municipio: "Colatina", uf: "ES", final_chassi: "04251" }),
        ...(body.acao === "completa" ? { chassi: "9BWZZZ377VT004251", renavam: "00123456789", motor_numero: "BAH123456" } : {}) };
      (db.placa_consultas = db.placa_consultas || []).push({ tipo: body.acao, valor_centavos: valor, saldo_centavos: P.saldo, em: now() });
      return { ok: true, encontrado: true, placa: body.placa, tipo: body.acao, dados, origem: "api", valor_centavos: valor, saldo_centavos: P.saldo }; },
    // Consulta pelo CPF (função "cpf"): window.__CPF guarda as chamadas e deixa o teste mudar a resposta.
    // Padrão: todo CPF novo é "MARIA APARECIDA DE SOUZA", nascida em 15/07/1985; 11144477735 não existe; "situacao" simula
    // "desligada", "semresposta", "creditos" (CPF fora da base e sem crédito) e "limite".
    cpf: async body => { const C = window.__CPF = window.__CPF || {}; C.chamadas = C.chamadas || []; C.chamadas.push(body);
      if (C.demora && body.acao === "consultar") await new Promise(r => setTimeout(r, C.demora));   // resposta lenta (teste da troca de CPF no meio)
      if (C.situacao === "desligada") return { ok: false, desligada: true, erro: "A consulta de CPF ainda não foi ligada: falta a chave da API CPF." };
      if (C.situacao === "semresposta") return { ok: false, semRede: true, erro: "Sem resposta da consulta de CPF." };
      if (body.acao === "gravar_chave") { if (body.chave === "chave-vencida-0000000") return { ok: false, erro: "Esta chave está vencida. Renove no painel apicpf.com e cadastre a chave renovada." };
        C.chaveEm = "2026-11-15T13:00:00Z"; C.situacao = ""; return { ok: true, ligada: true, gravada: true, conferida: true, origem: "ajustes", chave_em: C.chaveEm }; }
      if (C.situacao === "vencida") return { ok: false, desligada: true, vencida: true, erro: "A chave da API CPF venceu. Renove no painel apicpf.com (sem custo no plano grátis) e cadastre a chave em Ajustes › Consulta do cliente pelo CPF." };
      if (body.acao === "situacao") return C.semChave ? { ok: false, desligada: true, erro: "A consulta de CPF ainda não foi ligada: falta cadastrar a chave da API CPF em Ajustes › Consulta do cliente pelo CPF." } : { ok: true, ligada: true, origem: C.chaveEm ? "ajustes" : "supabase", chave_em: C.chaveEm || null };
      if (C.situacao === "limite") return { ok: false, limite: true, erro: "O limite de consultas de CPF de hoje acabou. Amanhã volta a funcionar." };
      if (C.situacao === "creditos") return { ok: true, encontrado: false, sem_creditos: true, cpf: body.cpf };
      if (body.cpf === "11144477735") return { ok: true, encontrado: false, cpf: body.cpf };
      const cad = db.clientes.find(c => String(c.doc || "").replace(/\D/g, "") === body.cpf);
      if (cad) return { ok: true, encontrado: true, cpf: body.cpf, origem: "cadastro", cliente_id: cad.id, dados: { nome: cad.nome, nascimento: cad.nascimento || "" } };
      return { ok: true, encontrado: true, cpf: body.cpf, origem: "api", dados: C.dados || { nome: "MARIA APARECIDA DE SOUZA", nascimento: "1985-07-15" }, creditos: 5 }; },
    placaUso: async desde => (db.placa_consultas || []).filter(x => x.em >= desde),
    // API do Sicredi (função "sicredi"): respostas como as da documentação v3.9.1; window.__SICREDI guarda as chamadas e o que o "banco" sabe
    sicredi: async body => { const S = window.__SICREDI = window.__SICREDI || { chamadas: [], situacao: {}, seq: 0 }; S.chamadas.push(body);
      if (body.acao === "teste_completo") return { ok: true, passos: [{ passo: "Entrar no Sicredi (token)", ok: true, detalhe: "Token recebido (vale 300 s)." }, { passo: "Emitir boleto de teste (R$ 1,00, com Pix)", ok: true, detalhe: "Nosso número 261000019, com QR Code Pix." }] };
      if (body.acao === "testar") { if (window.__SICREDI_SEM_CODIGO) throw new Error("Falta o código de acesso: gere no internet banking (Cobrança › Código de Acesso) e grave no Supabase como SICREDI_CODIGO_ACESSO."); return { ok: true, ambiente: body.ambiente }; }
      if (body.acao === "emitir") { const nn = "261" + String(++S.seq).padStart(5, "0") + "0"; S.situacao[nn] = "EM CARTEIRA PIX";
        return { txid: "tx" + nn, qrCode: "00020101021226930014br.gov.bcb.pix2571pix-qrcode.sicredi.com.br/qr/v2/cobv/" + nn + "5204000053039865802BR5903PIX6006Cidade62070503***6304ABCD",
          linhaDigitavel: "74891161560000001905231685453109116560000123456".slice(0, 47), codigoBarras: "74891165600001234561126200001905231685453109", cooperativa: "0523", posto: "16", nossoNumero: nn }; }
      if (body.acao === "consultar") { const st = S.situacao[body.nosso_numero] || "EM CARTEIRA"; return { nossoNumero: body.nosso_numero, situacao: st, dadosLiquidacao: /^LIQUIDADO/.test(st) ? { data: "2026-11-06T10:00:00", valor: S.valorPago || 0 } : null }; }
      if (body.acao === "baixar") { S.situacao[body.nosso_numero] = "BAIXADO POR SOLICITACAO"; return { statusComando: "MOVIMENTO_ENVIADO" }; }
      throw new Error("Ação desconhecida."); },
    espelhoZerar: async () => ({}),
    ordemNoAparelho: async id => (window.__GUARD = window.__GUARD || {})[id] || null,
    guardarOrdem: async id => { net(); const o = db.ordens.find(x => x.id === id); (window.__GUARD = window.__GUARD || {})[id] = { ...o }; return o; },
    testarConexao: async () => navigator.onLine,
    atualizarOrdem: async (id, patch) => { net(); const o = db.ordens.find(x => x.id === id); Object.assign(o, patch, { atualizado_em: new Date().toISOString() });
      if (o.status === "entregue") o.finalizada_em = (o.recebido || 0) >= (o.total || 0) ? (o.finalizada_em || new Date().toISOString()) : null; },
    salvarItens: async (oid, itens, rem) => { db.os_itens = db.os_itens.filter(i => !(rem || []).includes(i.id)); for (const it of itens) { const k = db.os_itens.findIndex(x => x.id === it.id); if (k >= 0) db.os_itens[k] = { ...it, ordem_id: oid }; else db.os_itens.push({ ...it, ordem_id: oid }); } },
    enviarArquivo: async c => c, incluirFotos: async () => {},
    recibos: { dasVendas: async ids => [...new Set((db.recibos || []).filter(r => r.venda_id && !r.cancelado && (ids || []).includes(r.venda_id)).map(r => r.venda_id))], desde: async de => { if (window.__FALHA_RECIBOS) throw new Error("falha simulada"); return (db.recibos || []).filter(r => !r.data || r.data >= de); }, listar: async ({ ordemId, de, ate } = {}) => (db.recibos || []).filter(r => (!ordemId || r.ordem_id === ordemId) && (!de || String(r.data || r.criado_em || "").slice(0, 10) >= de) && (!ate || String(r.data || r.criado_em || "").slice(0, 10) <= ate)), salvar: async r => { if (r.id) { const o = db.recibos.find(y => y.id === r.id); if (r.cancelado && !o.cancelado && o.conta_destino) (db.estornos = db.estornos || []).push({ id: "e" + Date.now(), conta: o.conta_destino, valor: -o.valor, origem: "recibo", registro: o.id, original_em: o.criado_em, registrado_em: new Date().toISOString() }); Object.assign(o, r); return o; } const x = { id: "r" + Date.now(), numero: 1, criado_em: new Date().toISOString(), ...r }; (db.recibos = db.recibos || []).push(x); const o = db.ordens.find(y => y.id === r.ordem_id); if (o) { o.recebido = (o.recebido || 0) + Number(r.valor); if (o.status === "entregue" && o.recebido >= o.total) o.finalizada_em = new Date().toISOString(); } return x; }, um: async id => db.recibos.find(x => x.id === id) }, criarOrdem: async d => { net(); window.__SEQ = (window.__SEQ || 1898) + 1; const o = { id: "n" + window.__SEQ, numero: window.__SEQ, ...d }; db.ordens.unshift(o); return o; },
    ordem: async id => { net(); const o = db.ordens.find(x => x.id === id); return { ...o, itens: db.os_itens.filter(i => i.ordem_id === id), fotos: [], eventos: (db.eventos || []).filter(e => e.ordem_id === id) }; },
    // orçamento separado da O.S. (v52): mesma conta e mesmas recusas da orcamento_salvar
    orcamentos: { listar: async () => { net(); if (window.__SEM_V52) throw new Error("Could not find the table 'public.orcamentos' in the schema cache"); return (db.orcamentos = db.orcamentos || []).slice().sort((a, b) => b.numero - a.numero); },
      um: async id => { net(); const o = (db.orcamentos || []).find(x => x.id === id); return o ? JSON.parse(JSON.stringify(o)) : null; },
      salvar: async p => { net(); db.orcamentos = db.orcamentos || []; let o = p.id && db.orcamentos.find(x => x.id === p.id);
        if (o && o.situacao === "aprovado") throw new Error("O orçamento já virou O.S.: não pode mais ser alterado.");
        if (!String((p.cliente || {}).nome || "").trim()) throw new Error("Informe o cliente (cadastro ou nome).");
        if (p.situacao === "recusado" && !String(p.motivo || "").trim()) throw new Error("Informe o motivo da recusa.");
        const sub = p.itens.filter(i => i.aprovado !== false).reduce((s, i) => s + Math.round((i.qtd * i.valor_unit - (i.desconto || 0)) * 100) / 100, 0);
        if ((p.desconto || 0) > sub + 0.001) throw new Error("O desconto não pode ser maior que o valor dos itens.");
        const custo = p.itens.filter(i => i.aprovado !== false).reduce((s, i) => s + i.qtd * (i.custo_unit || 0), 0);
        if (!o) { window.__ORC_SEQ = (window.__ORC_SEQ || 0) + 1; o = { id: uid(), numero: window.__ORC_SEQ, criado_em: now(), consultor_nome: db.perfis[0].nome, enviado_em: null, respondido_em: null, ordem_id: null, os_numero: null }; db.orcamentos.push(o); }
        Object.assign(o, p, { total: Math.max(0, sub - (p.desconto || 0)), custo, validade: p.validade || null, atualizado_em: now(),
          enviado_em: p.situacao === "enviado" ? o.enviado_em || now() : o.enviado_em, respondido_em: p.situacao === "recusado" ? o.respondido_em || now() : null, motivo: p.situacao === "recusado" ? p.motivo : "" });
        return JSON.parse(JSON.stringify(o)); },
      excluir: async id => { db.orcamentos = (db.orcamentos || []).filter(x => x.id !== id); },
      // v53: mesma conferência e mesmo efeito da orcamento_aprovar (O.S. em execução, vínculo, baixa do estoque dos itens aprovados)
      aprovar: async (id, { itensFora = [], por = "", forma = "", gravar = false } = {}) => { net(); if (window.__SEM_V53) throw new Error("Could not find the function public.orcamento_aprovar in the schema cache");
        const o = db.orcamentos.find(x => x.id === id), ref = "ORC-" + String(o.numero).padStart(5, "0");
        if (o.situacao === "aprovado") throw new Error("O orçamento " + ref + " já foi aprovado e virou a O.S. " + o.os_numero + ".");
        const vao = o.itens.filter(i => !itensFora.includes(i.id) && i.aprovado !== false), ficam = o.itens.filter(i => itensFora.includes(i.id) || i.aprovado === false);
        const sub = vao.reduce((s, i) => s + i.qtd * i.valor_unit - (i.desconto || 0), 0), erros = [], avisos = [];
        if (!vao.length) erros.push("Nenhum item aprovado: o orçamento precisa de pelo menos um item para virar O.S.");
        const tel = String(o.cliente.telefone || "").replace(/\D/g, "");
        if (!o.cliente_id && (tel.length < 10 || tel.length > 11)) erros.push("Cliente sem cadastro: informe o telefone com DDD no orçamento (a O.S. precisa do cadastro do cliente).");
        if (!o.veiculo_id && !/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(o.veiculo.placa || "")) erros.push("Informe a placa do veículo no orçamento (ABC1234 ou ABC1D23): a O.S. precisa do veículo.");
        if ((o.desconto || 0) > sub + 0.001 && vao.length) erros.push("O desconto do orçamento ficou maior que os itens aprovados.");
        const resumo = { orcamento: ref, itens_aprovados: vao.length, itens_nao_aprovados: ficam.length, nao_aprovados: ficam.map(i => i.descricao).join("; "), subtotal: sub, desconto: o.desconto || 0, total: Math.max(0, sub - (o.desconto || 0)), cliente_novo: !o.cliente_id, veiculo_novo: !o.veiculo_id, avisos };
        if (erros.length) return { ...resumo, pode_aprovar: false, gravado: false, erros };
        if (!gravar) return { ...resumo, pode_aprovar: true, gravado: false };
        let cli = o.cliente_id && db.clientes.find(c => c.id === o.cliente_id); if (!cli) { cli = { id: uid(), nome: o.cliente.nome, telefone: tel, codigo: 900 + db.clientes.length }; db.clientes.push(cli); }
        let vei = o.veiculo_id && db.veiculos.find(v => v.id === o.veiculo_id); if (!vei) { vei = { id: uid(), ...o.veiculo, cliente_id: cli.id }; db.veiculos.push(vei); }
        window.__SEQ = Math.max(window.__SEQ || 0, ...db.ordens.map(x => Number(x.numero) || 0)) + 1;
        const os = { id: uid(), numero: window.__SEQ, status: "execucao", cliente_id: cli.id, veiculo_id: vei.id, cliente: { nome: cli.nome, telefone: cli.telefone }, veiculo: { placa: vei.placa, marca: vei.marca || "", modelo: vei.modelo || "", ano: vei.ano || "" },
          km_entrada: null, reclamacao: o.reclamacao, checkin: { feito: false, aguardando_veiculo: true, orcamento: ref }, total: resumo.total, desconto: o.desconto || 0, recebido: 0, tabela_preco: o.tabela_preco, condicoes_pagamento: o.condicoes_pagamento,
          aprovacao: { em: now(), por: por || cli.nome, forma: forma || "Orçamento " + ref + " aprovado" }, orcamento_id: o.id, orcamento_numero: o.numero, criado_em: now(), atualizado_em: now(), diagnostico: "", obs_internas: "",
          obs_execucao: [o.obs, ficam.length ? "Itens apontados pela oficina no orçamento " + ref + " e NÃO aprovados pelo cliente: " + resumo.nao_aprovados + "." : ""].filter(Boolean).join("\n") };
        db.ordens.unshift(os);
        vao.forEach((i, n) => { db.os_itens.push({ ...i, id: uid(), ordem_id: os.id, aprovado: true, executado: false, adicional: false, posicao: n + 1 });
          const p = i.produto_id && db.produtos.find(x => x.id === i.produto_id); if (p && p.tipo === "produto" && p.controla_estoque && !i.fornecida_cliente) p.estoque_atual -= i.qtd; });
        o.itens.forEach(i => { i.aprovado = vao.includes(i); });
        Object.assign(o, { situacao: "aprovado", respondido_em: now(), ordem_id: os.id, os_numero: os.numero, cliente_id: cli.id, veiculo_id: vei.id, total: resumo.total });
        (window.__EV = window.__EV || []).push("abertura: O.S. aberta a partir do orçamento " + ref);
        return { ...resumo, pode_aprovar: true, gravado: true, ordem_id: os.id, os_numero: os.numero }; } },
    // agenda da oficina (v54): mesmas regras do gatilho agendamentos_regras (remarcação, motivo só no cancelado)
    // apontamentos de serviço pelo app (v60) de mentira: só leitura para o relatório
    apontamentos: { listar: async ({ perfil_id } = {}) => { net(); return (db.apontamentos = db.apontamentos || [{ id: "ap1", ordem_id: (db.ordens[0] || {}).id, os_numero: (db.ordens[0] || {}).numero, perfil_id: "p2", perfil_nome: "Carlos Mecânico", situacao: "finalizado", inicio: new Date(Date.now() - 3 * 3600000).toISOString(), fim: new Date(Date.now() - 3600000).toISOString(), motivo_pausa: "", pausas: [{ em: new Date(Date.now() - 2 * 3600000).toISOString(), motivo: "Aguardando peças", retomado_em: new Date(Date.now() - 1.5 * 3600000).toISOString() }], itens_executados: ["i1"], indicacoes: [{ item_id: "i2", descricao: "ALINHAMENTO", para_id: "p1", para_nome: "Danilo", em: new Date().toISOString(), visto_em: null }] }]).filter(a => !perfil_id || a.perfil_id === perfil_id); },
      abrir: async () => { throw new Error("só no app"); }, atualizar: async () => { throw new Error("só no app"); }, visto: async () => {}, indicadasPara: async () => [] },
    semV60: () => false,
    agenda: { listar: async ({ de, ate } = {}) => { net(); if (window.__SEM_V54) throw new Error("Could not find the table 'public.agendamentos' in the schema cache");
        return (db.agendamentos = db.agendamentos || []).filter(a => (!de || a.data >= de) && (!ate || a.data <= ate)).map(a => ({ ...a })); },
      um: async id => { net(); const a = (db.agendamentos || []).find(x => x.id === id); return a ? { ...a } : null; },
      salvar: async p => { net(); db.agendamentos = db.agendamentos || []; let a = p.id && db.agendamentos.find(x => x.id === p.id);
        const { id, criado_em, atualizado_em, criado_por, criado_por_nome, remarcacoes, data_anterior, hora_anterior, ...r } = p;
        if (!a) { if (!String((r.cliente || {}).nome || "").trim()) throw new Error('new row violates check constraint "agendamentos_cliente"');
          if (!String(r.servico || "").trim()) throw new Error('new row violates check constraint "agendamentos_servico"');
          a = { id: uid(), situacao: "agendado", hora: null, cliente_id: null, veiculo_id: null, cliente: {}, veiculo: {}, obs: "", motivo: "", remarcacoes: 0, data_anterior: null, hora_anterior: null,
            ordem_id: null, os_numero: null, orcamento_id: null, orc_numero: null, mensagens: {}, criado_por_nome: db.perfis[0].nome, criado_em: now(), ...r, hora: r.hora ? r.hora + (r.hora.length === 5 ? ":00" : "") : null };
          db.agendamentos.push(a); return { ...a }; }
        const h = "hora" in r ? (r.hora ? r.hora + (r.hora.length === 5 ? ":00" : "") : null) : a.hora, d = "data" in r ? r.data : a.data;
        const novo = { ...a, ...r, hora: h, data: d, atualizado_em: now() };
        if (d !== a.data || h !== a.hora) { novo.remarcacoes = a.remarcacoes + 1; novo.data_anterior = a.data; novo.hora_anterior = a.hora; const m = { ...(novo.mensagens || {}) }; delete m.confirmacao; delete m.lembrete; novo.mensagens = m;
          if (novo.situacao === "confirmado" && a.situacao === "confirmado") novo.situacao = "agendado"; }
        if (novo.situacao === "cancelado" && !String(novo.motivo || "").trim()) throw new Error('new row violates check constraint "agendamentos_motivo"');
        if (novo.situacao !== "cancelado") novo.motivo = "";
        Object.assign(a, novo); return { ...a }; },
      excluir: async id => { db.agendamentos = (db.agendamentos || []).filter(x => x.id !== id); },
      chegouPeloOrcamento: async (orcId, o) => { net(); const l = (db.agendamentos || []).filter(a => a.orcamento_id === orcId && ["agendado", "confirmado"].includes(a.situacao));
        l.forEach(a => Object.assign(a, { situacao: "chegou", ordem_id: o.id, os_numero: o.numero })); return l.map(a => ({ id: a.id })); } },
    produtos: { ...tab("produtos"), trocarGrupo: async ({ ids, de, para }) => { let n = 0; for (const p of window.__DB.produtos) if ((ids && ids.includes(p.id)) || (!ids && de && de.includes(p.categoria))) { p.categoria = String(para || "").trim(); p.atualizado_em = new Date().toISOString(); n++; } return n; } },
    vinculos: { doProduto: async () => [], listar: async () => (db.produto_fornecedor || []).slice() },
    // Compras (v59): fornecedores conectados, preços, carrinho e pedidos. window.__SEM_V59 simula o banco sem o SQL.
    compras: (() => {
      const v59 = () => { net(); if (window.__SEM_V59) throw new Error("Could not find the table 'public.compras_precos' in the schema cache"); };
      const nm = t => String(t || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      const fornNome = fid => { const f = db.fornecedores.find(x => x.id === fid); return f ? (f.fantasia || f.razao) : ""; };
      db.compras_fornecedores = db.compras_fornecedores || []; db.compras_precos = db.compras_precos || []; db.compras_carrinho = db.compras_carrinho || [];
      db.compras_pedidos = db.compras_pedidos || []; db.compras_pedido_itens = db.compras_pedido_itens || []; window.__SEGREDOS = window.__SEGREDOS || {};
      return {
        conexoes: { listar: async () => { v59(); return db.compras_fornecedores.slice(); },
          salvar: async c => { v59(); if (c.id) { const o = db.compras_fornecedores.find(x => x.id === c.id); Object.assign(o, c, { atualizado_em: now() }); return o; }
            if (db.compras_fornecedores.some(x => x.fornecedor_id === c.fornecedor_id)) throw new Error("duplicate key value violates unique constraint");
            const { id: _, ...resto } = c; const x = { id: uid(), situacao: "aguardando", detalhe: "", criado_em: now(), atualizado_em: now(), ...resto }; db.compras_fornecedores.push(x); return x; },
          excluir: async id => { v59(); db.compras_fornecedores = db.compras_fornecedores.filter(x => x.id !== id); delete window.__SEGREDOS["compras_acesso:" + id]; } },
        acessos: async () => { v59(); return Object.keys(window.__SEGREDOS).filter(k => k.startsWith("compras_acesso:")).map(k => ({ id: k.slice(15), gravado_em: now() })); },
        gravarAcesso: async (id, senha) => { v59(); if (!senha) { delete window.__SEGREDOS["compras_acesso:" + id]; return { gravado: false }; } window.__SEGREDOS["compras_acesso:" + id] = senha; return { gravado: true, gravado_em: now() }; },
        // função "compras" de mentira (consulta ao vivo): registra a chamada e, para cada conexão com portal reconhecido e senha, "acha" um preço por código
        aoVivo: async body => { net(); window.__AOVIVO = window.__AOVIVO || []; window.__AOVIVO.push(body); if (window.__AOVIVO_ATRASO) await new Promise(r => setTimeout(r, window.__AOVIVO_ATRASO)); if (window.__AOVIVO_RESPOSTA) return window.__AOVIVO_RESPOSTA;
          const robo = c => /dpk/.test(c.endereco || "") ? "dpk" : /rolemar/.test(c.endereco || "") ? "rolemar" : /pellegrino/.test(c.endereco || "") ? "pellegrino" : /toli/.test(c.endereco || "") ? "toli" : null;
          const cxs = db.compras_fornecedores.filter(c => c.ativo !== false && (!body.conexoes || body.conexoes.includes(c.id)) && (body.acao !== "testar" || c.id === body.conexao));
          const consultar = c => { const r = robo(c); if (!r) return { conexao: c.id, fornecedor_id: c.fornecedor_id, robo: null, ok: false, ofertas: [], erro: "Portal não reconhecido pelo endereço." };
            if (r === "toli") return { conexao: c.id, fornecedor_id: c.fornecedor_id, robo: r, ok: false, ofertas: [], no_pc: true, erro: "Portal Toli: consulta pelo programa do PC (em preparação)." };
            if (!window.__SEGREDOS["compras_acesso:" + c.id]) { Object.assign(c, { situacao: "erro", detalhe: "Sem senha guardada: cadastre a senha em Ajustes › Fornecedores conectados." }); return { conexao: c.id, fornecedor_id: c.fornecedor_id, robo: r, ok: false, ofertas: [], erro: c.detalhe }; }
            const ofertas = (body.termos || ["WK84213"]).map(t => ({ codigo: t, marca: "MANN", descricao: "PEÇA DO PORTAL " + t, preco: 63.24, estoque: 12, prazo: "" }));
            Object.assign(c, { situacao: "ok", detalhe: (body.acao === "testar" ? "Conectado em " : "Última consulta ") + now() + " (" + ofertas.length + " preço(s))." });
            if (body.acao !== "testar") for (const o of ofertas) { const k = nm(o.codigo); let x = db.compras_precos.find(p => p.fornecedor_id === c.fornecedor_id && p.codigo_norm === k);
              if (!x) { x = { id: uid(), fornecedor_id: c.fornecedor_id, codigo: o.codigo, codigo_norm: k, criado_em: now(), criado_por_nome: "robô", obs: "", prazo: "" }; db.compras_precos.push(x); }
              Object.assign(x, { marca: o.marca, descricao: o.descricao, preco: o.preco, estoque: o.estoque, origem: "ao_vivo", consultado_em: now(), atualizado_em: now() }); }
            return { conexao: c.id, fornecedor_id: c.fornecedor_id, robo: r, ok: true, ofertas, gravadas: ofertas.length, em: now() }; };
          if (body.acao === "testar") { const c = cxs[0]; if (!c) return { ok: false, erro: "Fornecedor conectado não encontrado." }; const x = consultar(c); return x.no_pc ? { ok: true, robo: "toli", no_pc: true } : x.ok ? { ok: true, robo: x.robo, ofertas: x.ofertas } : { ok: false, robo: x.robo, erro: x.erro }; }
          return { ok: true, termos: body.termos, em: now(), resultados: cxs.map(consultar) }; },
        precos: { listar: async () => { v59(); return db.compras_precos.slice(); },
          salvar: async p => { v59(); const k = nm(p.codigo); let o = db.compras_precos.find(x => x.fornecedor_id === p.fornecedor_id && x.codigo_norm === k);
            if (o) Object.assign(o, p, { codigo_norm: k, origem: "manual", consultado_em: now(), atualizado_em: now() });
            else { o = { id: uid(), criado_em: now(), atualizado_em: now(), consultado_em: now(), criado_por_nome: "Danilo", ...p, codigo_norm: k, origem: "manual", marca: String(p.marca || "").toUpperCase(), descricao: String(p.descricao || "").toUpperCase() }; db.compras_precos.push(o); } return o; },
          excluir: async id => { v59(); db.compras_precos = db.compras_precos.filter(x => x.id !== id); } },
        carrinho: { listar: async () => { v59(); return db.compras_carrinho.slice(); },
          incluir: async i => { v59(); const x = { id: uid(), criado_em: now(), atualizado_em: now(), criado_por_nome: "Danilo", ...i, descricao: String(i.descricao).toUpperCase() }; db.compras_carrinho.push(x); return x; },
          atualizar: async (id, patch) => { v59(); const o = db.compras_carrinho.find(x => x.id === id); if (patch.preco !== undefined && patch.preco !== o.preco) Object.assign(o, { origem_preco: "manual", preco_em: now() }); Object.assign(o, patch); return o; },
          excluir: async id => { v59(); db.compras_carrinho = db.compras_carrinho.filter(x => x.id !== id); } },
        pedidos: { listar: async () => { v59(); return db.compras_pedidos.slice().sort((a, b) => b.numero - a.numero).map(p => ({ ...p, itens: db.compras_pedido_itens.filter(i => i.pedido_id === p.id) })); },
          gerar: async ids => { v59(); const its = db.compras_carrinho.filter(c => !ids || !ids.length || ids.includes(c.id)); if (!its.length) throw new Error("O carrinho está vazio."); const out = [];
            for (const fid of [...new Set(its.map(i => i.fornecedor_id))]) { const mine = its.filter(i => i.fornecedor_id === fid); window.__PED_SEQ = (window.__PED_SEQ || 0) + 1;
              const p = { id: uid(), numero: window.__PED_SEQ, fornecedor_id: fid, fornecedor_nome: fornNome(fid), situacao: "a_finalizar", total: Math.round(mine.reduce((s, i) => s + i.qtd * i.preco, 0) * 100) / 100, documento: "", motivo: "", obs: "", criado_por_nome: "Danilo", criado_em: now(), atualizado_em: now() };
              db.compras_pedidos.push(p); mine.forEach((i, n) => db.compras_pedido_itens.push({ id: uid(), pedido_id: p.id, posicao: n, codigo: i.codigo, marca: i.marca, descricao: i.descricao, qtd: i.qtd, preco: i.preco, origem_preco: i.origem_preco, preco_em: i.preco_em, os_numero: i.os_numero, placa: i.placa, obs: i.obs || "" }));
              out.push({ id: p.id, numero: p.numero, fornecedor: p.fornecedor_nome, total: p.total, itens: mine.length }); }
            db.compras_carrinho = db.compras_carrinho.filter(c => !its.includes(c)); return out; },
          voltar: async id => { v59(); const p = db.compras_pedidos.find(x => x.id === id); if (p.situacao !== "a_finalizar") throw new Error("Só volta para o carrinho o pedido que ainda não foi finalizado nem cancelado.");
            const its = db.compras_pedido_itens.filter(i => i.pedido_id === id); its.forEach(i => db.compras_carrinho.push({ id: uid(), fornecedor_id: p.fornecedor_id, codigo: i.codigo, marca: i.marca, descricao: i.descricao, qtd: i.qtd, preco: i.preco, origem_preco: i.origem_preco, preco_em: i.preco_em, os_numero: i.os_numero, placa: i.placa, obs: i.obs, criado_por_nome: "Danilo", criado_em: now(), atualizado_em: now() }));
            Object.assign(p, { situacao: "cancelado", motivo: "Voltou para o carrinho" }); return { pedido: p.numero, itens: its.length }; },
          atualizar: async (id, patch) => { v59(); const p = db.compras_pedidos.find(x => x.id === id); if (p.situacao === "cancelado" && patch.situacao && patch.situacao !== "cancelado") throw new Error("Pedido cancelado não volta. Gere outro pelo carrinho.");
            if (patch.situacao === "cancelado" && !String(patch.motivo || "").trim()) throw new Error("check constraint compras_pedidos_motivo");
            if (patch.situacao === "finalizado" && p.situacao !== "finalizado") Object.assign(p, { finalizado_em: now(), finalizado_por_nome: "Danilo" }); if (patch.situacao && patch.situacao !== "finalizado") Object.assign(p, { finalizado_em: null, finalizado_por_nome: "" });
            Object.assign(p, patch, { atualizado_em: now() }); return p; } },
      };
    })(),
    notas: { listar: async () => [] },
    estoque: { movimentos: async () => [], movimentar: async (id, tipo, q) => { const p = db.produtos.find(x => x.id === id); p.estoque_atual = tipo === "entrada" ? +p.estoque_atual + q : tipo === "saida" ? +p.estoque_atual - q : q; return p.estoque_atual; } },
    contas: { abertas: async () => db.contas.filter(c => c.status === "aberta"),
      // despesa fixa (v43): mesma regra do tornar_despesa_fixa / gerar_despesas_fixas
      fixas: async () => db.contas.filter(c => c.fixa),
      tornarFixa: async id => { const c = db.contas.find(x => x.id === id); const g = c.grupo || (c.grupo = uid()); const lim = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
        const prim = db.contas.filter(x => x.grupo === g && x.status === "aberta").sort((a, b) => a.vencimento.localeCompare(b.vencimento))[0];
        let canceladas = 0; db.contas.filter(x => x.grupo === g && x.status === "aberta" && x.vencimento > lim && x !== prim).forEach(x => { x.status = "cancelada"; x.obs = ((x.obs || "") + " Substituída pela despesa fixa (lançada um mês por vez).").trim(); canceladas++; });
        db.contas.filter(x => x.grupo === g && x.status !== "cancelada").forEach(x => Object.assign(x, { fixa: true, origem: x.origem === "manual" ? "recorrente" : x.origem, parcela: null, parcelas: null }));
        db.contas.filter(x => x.grupo === g && x.status === "cancelada").forEach(x => { x.fixa = true; });
        window.__FIXAS = (window.__FIXAS || []).concat([id]); return { grupo: g, canceladas, lancadas: 0 }; },
      encerrarFixa: async g => { db.contas.filter(x => x.grupo === g).forEach(x => { x.fixa = false; }); return 1; }, listar: async ({ de, ate, campo = "vencimento", status } = {}) => db.contas.filter(c => (!de || (c[campo] || "") >= de) && (!ate || (c[campo] || "") <= ate) && (!status || c.status === status) && (campo !== "pago_em" || c[campo])), salvar: async c => { if (c.id) { const o = db.contas.find(x => x.id === c.id); const antes = o.status; Object.assign(o, c, { atualizado_em: now() }); if (o.status === "paga" && antes !== "paga") o.pago_registrado_em = now(); if (o.status !== "paga") o.pago_registrado_em = null; return o; } const x = { id: uid(), status: "aberta", ...c }; db.contas.push(x); return x; } },
    preNotas: { listar: async ({ de, ate } = {}) => { net(); return db.pre_notas.filter(p => p.situacao !== "cancelada" && (!de || p.data >= de) && (!ate || p.data <= ate)); },
      abertasDo: async (fid, nome) => db.pre_notas.filter(p => p.situacao === "aberta" && (fid ? p.fornecedor_id === fid : !p.fornecedor_id && p.fornecedor_nome.toLowerCase() === String(nome || "").toLowerCase())),
      incluir: async p => { const x = { id: uid(), situacao: "aberta", criado_em: now(), ...p }; db.pre_notas.push(x); return x; },
      atualizar: async (ids, patch) => db.pre_notas.filter(p => ids.includes(p.id)).map(p => Object.assign(p, patch)) },
    transferencias: { listar: async ({ de, ate } = {}) => (db.transferencias || []).filter(t => (!de || t.data >= de) && (!ate || t.data <= ate)), salvar: async t => { const x = { id: uid(), criado_em: now(), ...t }; (db.transferencias = db.transferencias || []).push(x); return x; }, excluir: async id => { db.transferencias = db.transferencias.filter(t => t.id !== id); } },
    temV18: () => true,
    // mesmas regras da função saldos_contas do v18 (no servidor, numa consulta só)
    // vendas de balcão e relatorio_itens de mentira (Painel Financeiro e relatórios)
    vendas: { listar: async ({ de, ate } = {}) => (db.vendas || []).filter(v => (!de || (v.criado_em || "") >= de) && (!ate || (v.criado_em || "") <= ate)), periodo: async o => window.__API_MOCK.vendas.listar(o), uma: async id => (db.vendas || []).find(v => v.id === id) },
    relatorioItens: async (ini, fim, base) => { const campo = base === "abertura" ? "criado_em" : "entregue_em";
      const linhas = [];
      for (const o of db.ordens.filter(o => ["entregue", "recusado"].includes(o.status) && (o[campo] || "") >= ini && (o[campo] || "") < fim)) {
        const cab = { ordem_id: o.id, numero: o.numero, status: o.status, criado_em: o.criado_em, entregue_em: o.entregue_em, cliente_id: o.cliente_id, cliente: (o.cliente || {}).nome, placa: (o.veiculo || {}).placa, veiculo: ((o.veiculo || {}).marca || "") + " " + ((o.veiculo || {}).modelo || ""), km: o.km_entrada, mecanico: o.mecanico_nome || "", forma_pagamento: o.forma_pagamento || "", ordem_total: o.total, ordem_desconto: o.desconto || 0, legado: o.legado };
        const its = db.os_itens.filter(i => i.ordem_id === o.id);
        if (!its.length) linhas.push({ ...cab });
        for (const i of its) linhas.push({ ...cab, item_id: i.id, tipo: i.tipo, descricao: i.descricao, qtd: i.qtd, valor_unit: i.valor_unit, desconto: i.desconto, custo_unit: i.custo_unit, aprovado: i.aprovado, horas: i.horas, fornecida_cliente: i.fornecida_cliente });
      }
      return linhas; },
    saldosContas: async () => { if (window.__FALHA_RECIBOS) throw new Error("sem conexão");
      // dia LOCAL, como o saldos_contas() de verdade (v18: at time zone America/Sao_Paulo) — em UTC o teste falhava depois das 21h de Brasília
      const dia = em => { if (!em) return ""; const d = new Date(em); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
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
      osComoTecnico: async id => db.ordens.filter(o => o.tecnico_id === id).length,
      ordensEntregues: async (ini, fim) => db.ordens.filter(o => o.status === "entregue" && o.entregue_em >= ini.slice(0, 10) && o.entregue_em < fim.slice(0, 10)) },
  };
})();
