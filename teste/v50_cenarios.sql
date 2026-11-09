-- Cenários do supabase/v50.sql (teste/teste_v50.sh), no banco INTEIRO montado por teste/montar_banco.sh.
-- Roda como o papel "authenticated" (RLS de verdade), com o login do administrador, do consultor ou do mecânico.
-- Para no primeiro que falhar.
\set ON_ERROR_STOP 1
create or replace function pg_temp.ok(c boolean, m text) returns void language plpgsql as $$
begin if c is not true then raise exception 'FALHOU: %', m; end if; end $$;
create or replace function pg_temp.erro(cmd text, trecho text) returns void language plpgsql as $$
begin
  begin execute cmd; exception when others then
    if sqlerrm ilike '%' || trecho || '%' then return; end if;
    raise exception 'FALHOU: esperava erro com "%", veio "%"', trecho, sqlerrm;
  end;
  raise exception 'FALHOU: esperava erro com "%" e passou', trecho;
end $$;
create or replace function pg_temp.como(p_uid text) returns void language sql as $$ select set_config('request.jwt.claim.sub', p_uid, false) $$;
grant execute on function pg_temp.ok(boolean, text), pg_temp.erro(text, text), pg_temp.como(text) to authenticated;

-- ---------------------------------------------------------------- dados
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'danilo@oficina.test', '{"nome": "Danilo"}'),
  ('22222222-2222-2222-2222-222222222222', 'tiago@oficina.test', '{"nome": "Tiago"}'),
  ('33333333-3333-3333-3333-333333333333', 'carlos@oficina.test', '{"nome": "Carlos Mecânico"}');
select null from pg_temp.como('11111111-1111-1111-1111-111111111111');
update public.perfis set papel = 'admin' where id = '11111111-1111-1111-1111-111111111111';
update public.perfis set papel = 'consultor' where id = '22222222-2222-2222-2222-222222222222';
update public.perfis set papel = 'mecanico' where id = '33333333-3333-3333-3333-333333333333';
update public.config set dados = coalesce(dados, '{}') || '{"formasPagamento": ["PIX", "Dinheiro", "Cartão de débito", "Cartão de crédito", "Boleto"],
  "contasFinanceiras": [{"nome": "Sicredi", "saldo": 1000}, {"nome": "PicPay PJ", "saldo": 0}, {"nome": "Espécie", "saldo": 100}],
  "contaRecebimento": "Sicredi", "contaPagamento": "Sicredi", "categoriasDespesa": ["Fornecedores de peças", "Aluguel"],
  "cobranca": {"contaEntrada": "Sicredi"}, "nome": "DTCAR CENTRO AUTOMOTIVO"}' where id = 1;

insert into public.clientes (id, nome, doc, telefone) values ('00000000-0000-0000-0000-0000000000c1', 'Ana Souza', '52998224725', '27999990000');
insert into public.clientes (id, nome, situacao, restricao) values ('00000000-0000-0000-0000-0000000000c2', 'Caloteiro', 'bloqueado', 'deve 3 O.S.');
insert into public.veiculos (id, placa, marca, modelo, ano, cliente_id) values ('00000000-0000-0000-0000-0000000000f1', 'ABC1D23', 'Fiat', 'Uno', '2015', '00000000-0000-0000-0000-0000000000c1');
insert into public.produtos (id, codigo, tipo, descricao, custo, preco_vista, preco_prazo, estoque_atual, controla_estoque)
values ('00000000-0000-0000-0000-0000000000a1', 100, 'produto', 'Filtro de óleo', 20, 50, 55, 10, true),
       ('00000000-0000-0000-0000-0000000000a2', 200, 'servico', 'Alinhamento', 0, 80, 80, 0, false);
insert into public.funcionarios (id, nome, apelido, funcao, comissao_pct) values ('00000000-0000-0000-0000-0000000000e1', 'João Silva', 'Joãozinho', 'Mecânico', 10);
insert into public.funcionarios (id, nome, funcao, perfil_id) values ('00000000-0000-0000-0000-0000000000e2', 'Carlos Mecânico', 'Mecânico', '33333333-3333-3333-3333-333333333333');
insert into public.funcionarios (id, nome, funcao, ativo, demissao) values ('00000000-0000-0000-0000-0000000000e3', 'Saiu Faz Tempo', 'Mecânico', false, '2025-01-10');

-- O.S. 100 em execução (500); 101 entregue a receber (1000: recibo 200 + parcelas 400 + 400); 102 fechada; 103 entregue com boleto Sicredi na parcela
insert into public.ordens (id, numero, status, cliente_id, veiculo_id, cliente, veiculo, km_entrada, total, entregue_em)
values ('00000000-0000-0000-0000-000000000100', 100, 'execucao', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000f1',
        '{"nome": "Ana Souza"}', '{"placa": "ABC1D23", "marca": "Fiat", "modelo": "Uno"}', 1000, 500, null),
       ('00000000-0000-0000-0000-000000000101', 101, 'entregue', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000f1',
        '{"nome": "Ana Souza"}', '{"placa": "ABC1D23", "marca": "Fiat", "modelo": "Uno"}', 1000, 1000, now()),
       ('00000000-0000-0000-0000-000000000102', 102, 'entregue', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000f1',
        '{"nome": "Ana Souza"}', '{"placa": "ABC1D23"}', 1000, 300, now()),
       ('00000000-0000-0000-0000-000000000103', 103, 'entregue', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000f1',
        '{"nome": "Ana Souza"}', '{"placa": "ABC1D23"}', 1000, 600, now());
insert into public.os_itens (id, ordem_id, tipo, descricao, qtd, valor_unit, aprovado, executado) values
  ('00000000-0000-0000-0000-00000000a100', '00000000-0000-0000-0000-000000000100', 'servico', 'Revisão', 1, 300, true, false),
  ('00000000-0000-0000-0000-00000000a101', '00000000-0000-0000-0000-000000000100', 'peca', 'Pastilha', 2, 100, true, false),
  ('00000000-0000-0000-0000-00000000a102', '00000000-0000-0000-0000-000000000100', 'peca', 'Disco', 1, 50, false, false),
  ('00000000-0000-0000-0000-00000000b100', '00000000-0000-0000-0000-000000000101', 'servico', 'Motor', 1, 1000, true, true),
  ('00000000-0000-0000-0000-00000000c100', '00000000-0000-0000-0000-000000000102', 'servico', 'Freio', 1, 300, true, true),
  ('00000000-0000-0000-0000-00000000d100', '00000000-0000-0000-0000-000000000103', 'servico', 'Suspensão', 1, 600, true, true);
insert into public.recibos (ordem_id, cliente_id, pagador, valor, referente, forma, conta_destino, data)
values ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-0000000000c1', 'Ana Souza', 200, 'entrada', 'PIX', 'Sicredi', current_date),
       ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-0000000000c1', 'Ana Souza', 300, 'tudo', 'PIX', 'Sicredi', current_date);
insert into public.receber (id, ordem_id, cliente_id, cliente_nome, descricao, forma, parcela, parcelas, valor, vencimento) values
  ('00000000-0000-0000-0000-0000000001a1', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-0000000000c1', 'Ana Souza', 'OS 00101', 'Promissória', 1, 2, 400, current_date + 20),
  ('00000000-0000-0000-0000-0000000001a2', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-0000000000c1', 'Ana Souza', 'OS 00101', 'Promissória', 2, 2, 400, current_date + 50),
  ('00000000-0000-0000-0000-0000000001b1', '00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-0000000000c1', 'Ana Souza', 'OS 00103', 'Boleto', 1, 1, 600, current_date + 10);
insert into public.boletos (id, receber_id, ordem_id, os_numero, cliente_id, pagador_nome, pagador_doc, valor, vencimento, nosso_numero, situacao)
values ('00000000-0000-0000-0000-0000000b0001', '00000000-0000-0000-0000-0000000001b1', '00000000-0000-0000-0000-000000000103', '103',
        '00000000-0000-0000-0000-0000000000c1', 'Ana Souza', '52998224725', 600, current_date + 10, '260000011', 'registrado');
insert into public.fornecedores (id, cnpj, razao, fantasia) values ('00000000-0000-0000-0000-0000000000b1', '11222333000181', 'Peças Brasil Ltda', 'Peças Brasil');
insert into public.contas (id, descricao, favorecido, valor, vencimento, categoria) values ('00000000-0000-0000-0000-0000000000d1', 'Aluguel novembro', 'Imobiliária', 5500, current_date + 5, 'Aluguel');
insert into public.pre_notas (id, data, fornecedor_id, fornecedor_nome, documento, total, situacao) values
  ('00000000-0000-0000-0000-0000000000a5', current_date, '00000000-0000-0000-0000-0000000000b1', '', '123', 150, 'aberta'),
  ('00000000-0000-0000-0000-0000000000a6', current_date, null, 'Auto Peças X', '77', 80, 'aberta');
insert into public.site_rascunho (id, dados) values (1, '{"secoes": [{"titulo": "Bem-vindo", "itens": ["a", "b"]}], "contato": {"telefone": "2732220000"}}');
insert into public.rh_documentos (id, competencia, tipo, titulo, arquivo, nome_arquivo, tipo_arquivo, tamanho, origem)
values ('00000000-0000-0000-0000-0000000000f9', '2026-10', 'recibo', 'RECIBO 10.2026', '2026-10/x.pdf', 'x.pdf', 'application/pdf', 10, 'manual');
insert into public.nfe_recebidas (chave, numero, serie, cnpj_emitente, nome_emitente, emissao, valor, situacao, status, xml) values
  ('32261111222333000181550010000004561000004562', '456', '1', '11222333000181', 'Peças Brasil Ltda', now(), 90, 'autorizada', 'nova',
   '<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe32261111222333000181550010000004561000004562"><ide><nNF>456</nNF><serie>1</serie><dhEmi>2026-11-08T10:00:00-03:00</dhEmi></ide>'
   || '<emit><CNPJ>11222333000181</CNPJ><xNome>Peças Brasil Ltda</xNome></emit>'
   || '<det nItem="1"><prod><cProd>P1</cProd><cEAN>SEM GTIN</cEAN><xProd>PASTILHA FREIO</xProd><NCM>87083090</NCM><uCom>JG</uCom><qCom>2.0000</qCom><vUnCom>30.00</vUnCom><vProd>60.00</vProd></prod><imposto/></det>'
   || '<det nItem="2"><prod><cProd>P2</cProd><cEAN>SEM GTIN</cEAN><xProd>DISCO FREIO</xProd><NCM>87083090</NCM><uCom>UN</uCom><qCom>1.0000</qCom><vUnCom>30.00</vUnCom><vProd>30.00</vProd></prod><imposto/></det>'
   || '<total><ICMSTot><vNF>90.00</vNF></ICMSTot></total></infNFe></NFe></nfeProc>');

select pg_temp.ok((select finalizada_em is not null from public.ordens where numero = 102), 'semente: O.S. 102 fechada pelo gatilho');
select pg_temp.ok((select recebido from public.ordens where numero = 101) = 200, 'semente: O.S. 101 com 200 recebidos');

set role authenticated;

-- ---------------------------------------------------------------- 1. técnico responsável
do $$
declare n int; r jsonb;
begin
  perform pg_temp.como('33333333-3333-3333-3333-333333333333'); -- mecânico vê a lista (só nomes)
  select count(*) into n from public.tecnicos_lista();
  perform pg_temp.ok(n = 4, 'lista: 2 funcionários ativos + Danilo e Tiago (Carlos tem ficha; desligado fica fora): ' || n);
  perform pg_temp.ok((select count(*) from public.tecnicos_lista() where nome = 'Carlos Mecânico' and tipo = 'funcionario') = 1, 'Carlos aparece como funcionário (com acesso ligado)');
  perform pg_temp.ok(not exists (select 1 from public.tecnicos_lista() where nome = 'Saiu Faz Tempo'), 'desligado não aparece');
  perform pg_temp.como('');  -- sem login: lista vazia
  perform pg_temp.ok((select count(*) from public.tecnicos_lista()) = 0, 'sem login não vê a lista');
  perform pg_temp.como('11111111-1111-1111-1111-111111111111');
  r := public.agente_tecnico('joaozinho');
  perform pg_temp.ok(r->>'tecnico_id' = '00000000-0000-0000-0000-0000000000e1' and r->>'mecanico_nome' = 'João Silva' and r->'mecanico_id' = 'null', 'técnico pelo apelido sem acento');
  r := public.agente_tecnico('Carlos');
  perform pg_temp.ok(r->>'mecanico_id' = '33333333-3333-3333-3333-333333333333' and r->>'tecnico_id' = '00000000-0000-0000-0000-0000000000e2', 'Carlos: funcionário + acesso');
  perform pg_temp.erro($q$select public.agente_tecnico('Pedro')$q$, 'não está na lista');
  r := public.agente_fazer('alterar_os', '{"numero": 100, "dados": {"tecnico": "João"}}', true);
  perform pg_temp.ok((select tecnico_id::text = '00000000-0000-0000-0000-0000000000e1' and mecanico_nome = 'João Silva' and mecanico_id is null from public.ordens where numero = 100),
    'alterar_os grava o técnico (funcionário)');
  perform pg_temp.erro($q$select public.agente_fazer('alterar_os', '{"numero": 100, "dados": {"tecnico_id": "00000000-0000-0000-0000-0000000000e1"}}', true)$q$, 'dados.tecnico');
end $$;

-- ---------------------------------------------------------------- 2. desconto
do $$
declare r jsonb; o public.ordens;
begin
  -- consultor dá desconto pela tela; mecânico não
  perform pg_temp.como('33333333-3333-3333-3333-333333333333');
  perform pg_temp.erro($q$select public.os_aplicar_desconto('00000000-0000-0000-0000-000000000100', 10, '', true)$q$, 'administrador ou o consultor');
  perform pg_temp.como('22222222-2222-2222-2222-222222222222');
  r := public.os_aplicar_desconto('00000000-0000-0000-0000-000000000100', 50, 'cliente antigo', false);
  perform pg_temp.ok((r->>'gravado')::boolean = false and (r->>'total')::numeric = 450 and (r->>'valor_itens')::numeric = 500, 'prévia: 500 de itens aprovados (disco recusado fora) − 50');
  perform pg_temp.ok((select desconto from public.ordens where numero = 100) = 0, 'prévia não gravou');
  r := public.os_aplicar_desconto('00000000-0000-0000-0000-000000000100', 50, 'cliente antigo', true);
  select * into o from public.ordens where numero = 100;
  perform pg_temp.ok(o.desconto = 50 and o.total = 450, 'desconto em execução grava desconto e total');
  perform pg_temp.ok(exists (select 1 from public.eventos where ordem_id = o.id and tipo = 'desconto' and texto like '%cliente antigo%'), 'histórico da O.S.');
  perform pg_temp.erro($q$select public.os_aplicar_desconto('00000000-0000-0000-0000-000000000100', 501, '', true)$q$, 'não pode passar do valor dos itens');
  perform pg_temp.erro($q$select public.os_aplicar_desconto('00000000-0000-0000-0000-000000000102', 10, '', true)$q$, 'fechada');

  -- entregue a receber: total 1000, recebido 200, parcelas 400 + 400. Desconto 300 → saldo 500: a 2ª parcela cai para 100
  r := public.os_aplicar_desconto('00000000-0000-0000-0000-000000000101', 300, 'acerto', true);
  perform pg_temp.ok((r->>'total')::numeric = 700 and (r->>'saldo')::numeric = 500, 'entregue: total 700, saldo 500');
  perform pg_temp.ok((select valor from public.receber where id = '00000000-0000-0000-0000-0000000001a2') = 100
                     and (select valor from public.receber where id = '00000000-0000-0000-0000-0000000001a1') = 400, 'a parcela mais nova foi reduzida');
  -- desconto 700 → saldo 100: a 2ª é cancelada e a 1ª cai para 100
  r := public.os_aplicar_desconto('00000000-0000-0000-0000-000000000101', 700, '', true);
  perform pg_temp.ok((select status from public.receber where id = '00000000-0000-0000-0000-0000000001a2') = 'cancelada'
                     and (select valor from public.receber where id = '00000000-0000-0000-0000-0000000001a1') = 100, 'parcela zerada cancelada; a anterior reduzida');
  perform pg_temp.erro($q$select public.os_aplicar_desconto('00000000-0000-0000-0000-000000000101', 900, '', true)$q$, 'menor que o já recebido');
  -- desconto 800 → total 200 = recebido: a O.S. fecha sozinha e a última parcela é cancelada
  r := public.os_aplicar_desconto('00000000-0000-0000-0000-000000000101', 800, '', true);
  perform pg_temp.ok((r->>'fechou')::boolean and (select finalizada_em is not null from public.ordens where numero = 101), 'quitada pelo desconto: fecha');
  perform pg_temp.ok((select count(*) from public.receber where ordem_id = '00000000-0000-0000-0000-000000000101' and status = 'aberta') = 0, 'sem parcela em aberto');
  -- parcela com boleto registrado: não muda
  perform pg_temp.erro($q$select public.os_aplicar_desconto('00000000-0000-0000-0000-000000000103', 100, '', true)$q$, 'boleto Sicredi');

  -- pelo conector (administrador): desconto_pct e dados.desconto no alterar_os
  perform pg_temp.como('11111111-1111-1111-1111-111111111111');
  r := public.agente_fazer('desconto_os', '{"numero": 100, "desconto_pct": 10, "motivo": "pediu"}', false);
  perform pg_temp.ok((r->>'desconto')::numeric = 50 and (r->>'total')::numeric = 450 and (r->>'gravado')::boolean = false, '10% de 500 = 50 (prévia)');
  r := public.agente_fazer('alterar_os', '{"numero": 100, "dados": {"desconto": 100, "box": "3"}}', true);
  select * into o from public.ordens where numero = 100;
  perform pg_temp.ok(o.desconto = 100 and o.total = 400 and o.box = '3' and (r->>'total')::numeric = 400, 'alterar_os: desconto pelo os_aplicar_desconto + outros dados');
  r := public.agente_fazer('alterar_os', '{"numero": 100, "dados": {"desconto": 0}}', true);
  perform pg_temp.ok((select total from public.ordens where numero = 100) = 500, 'só desconto no alterar_os (sem "Nada a fazer")');
end $$;

-- ---------------------------------------------------------------- 3. fornecedor
do $$
declare r jsonb;
begin
  perform pg_temp.como('11111111-1111-1111-1111-111111111111');
  r := public.agente_fazer('fornecedor', '{"acao": "criar", "campos": {"razao": "Retífica Central", "cnpj": "11.444.777/0001-61", "prestador": true, "categoria_padrao": "Serviços de terceiros"}}', true);
  perform pg_temp.ok(r->'fornecedor'->>'cnpj' = '11444777000161' and jsonb_array_length(r->'avisos') = 1, 'criado com CNPJ só números e aviso de categoria fora da lista');
  perform pg_temp.erro($q$select public.agente_fazer('fornecedor', '{"acao": "criar", "campos": {"razao": "X", "cnpj": "11444777000162"}}', true)$q$, 'inválido');
  perform pg_temp.erro($q$select public.agente_fazer('fornecedor', '{"acao": "criar", "campos": {"razao": "Y", "cnpj": "11444777000161"}}', true)$q$, 'Já existe');
  r := public.agente_fazer('fornecedor', '{"acao": "editar", "busca": "retífica", "campos": {"telefone": "(27) 3722-0000"}}', true);
  perform pg_temp.ok((select telefone from public.fornecedores where cnpj = '11444777000161') = '2737220000', 'editar pela busca');
  r := public.agente_fazer('fornecedor', '{"acao": "inativar", "cnpj": "11444777000161"}', true);
  perform pg_temp.ok((select not ativo from public.fornecedores where cnpj = '11444777000161'), 'inativar');
  r := public.agente_fazer('fornecedor', '{"acao": "excluir", "cnpj": "11444777000161"}', true);
  perform pg_temp.ok(not exists (select 1 from public.fornecedores where cnpj = '11444777000161'), 'excluir');
end $$;

-- ---------------------------------------------------------------- 4. venda de balcão e recibo avulso
do $$
declare r jsonb; v_rec int; v_sv bigint; v_sr bigint;
begin
  perform pg_temp.como('11111111-1111-1111-1111-111111111111');
  v_sv := (select last_value from public.vendas_numero_seq); v_sr := (select last_value from public.recibos_numero_seq);
  r := public.agente_fazer('venda_balcao', '{"itens": [{"codigo": "100", "qtd": 2}, {"descricao": "Palheta", "valor_unit": 30, "qtd": 1}], "forma": "pix", "cliente_id": "00000000-0000-0000-0000-0000000000c1"}', false);
  perform pg_temp.ok((r->>'total')::numeric = 130 and (r->'recibo'->>'conta') = 'Sicredi' and (r->>'gravado')::boolean = false and (r->>'custo')::numeric = 40, 'prévia: 2×50 + 30, custo 2×20, recibo no Sicredi');
  perform pg_temp.ok((select estoque_atual from public.produtos where codigo = 100) = 10, 'prévia não tirou do estoque');
  perform pg_temp.ok((select last_value from public.vendas_numero_seq) = v_sv and (select last_value from public.recibos_numero_seq) = v_sr
    and r->'venda' = 'null' and r->'recibo'->'numero' = 'null', 'prévia não gasta número de venda nem de recibo (nada pula)');
  update public.produtos set vender_sem_estoque = false where codigo = 100;
  perform pg_temp.erro($q$select public.agente_fazer('venda_balcao', '{"itens": [{"codigo": "100", "qtd": 6}, {"codigo": "100", "qtd": 5}], "forma": "Pix"}', false)$q$, 'estoque insuficiente de Filtro de óleo (há 4');
  update public.produtos set vender_sem_estoque = true where codigo = 100;
  r := public.agente_fazer('venda_balcao', '{"itens": [{"codigo": "100", "qtd": 6}, {"codigo": "100", "qtd": 5}], "forma": "Pix"}', false);
  perform pg_temp.ok(r->'avisos'->>0 like '%vai ficar negativo%', 'produto que pode vender sem estoque: só avisa');
  r := public.agente_fazer('venda_balcao', '{"itens": [{"codigo": "100", "qtd": 2}], "forma": "Dinheiro", "tabela": "prazo", "desconto": 10}', true);
  perform pg_temp.ok((r->>'total')::numeric = 100 and r->'recibo'->>'conta' = 'Espécie' and r->>'cliente' = 'Consumidor', 'tabela a prazo (2×55 − 10), dinheiro → Espécie');
  perform pg_temp.ok((select estoque_atual from public.produtos where codigo = 100) = 8, 'baixou o estoque');
  r := public.agente_fazer('venda_balcao', '{"itens": [{"codigo": "100", "qtd": 1}], "forma": "Boleto"}', true);
  perform pg_temp.ok(r->'recibo' = 'null', 'boleto: sem recibo (venda a prazo)');
  perform pg_temp.erro($q$select public.agente_fazer('venda_balcao', '{"itens": [{"codigo": "100", "qtd": 1}], "forma": "Pix", "cliente_id": "00000000-0000-0000-0000-0000000000c2"}', true)$q$, 'bloqueado');
  perform pg_temp.erro($q$select public.agente_fazer('venda_balcao', '{"itens": [{"codigo": "100", "qtd": 1}], "forma": "Cheque"}', true)$q$, 'não existe');
  -- cancelar a venda: estoque volta e o recibo é cancelado
  r := public.agente_fazer('venda_balcao', format('{"acao": "cancelar", "numero": %s, "motivo": "desistiu"}', (select max(numero) - 1 from public.vendas))::jsonb, true);
  perform pg_temp.ok((r->>'cancelada')::boolean and (select estoque_atual from public.produtos where codigo = 100) = 9 and (r->>'recibos_cancelados')::int = 1, 'cancelar venda');
  -- recibo avulso (prévia sem número; gravado pega o número seguinte)
  v_sr := (select last_value from public.recibos_numero_seq);
  r := public.agente_fazer('recibo_avulso', '{"pagador": "Marcos", "valor": 80, "referente": "conserto de pneu sem O.S.", "forma": "PIX"}', false);
  perform pg_temp.ok(r->'recibo' = 'null' and (select last_value from public.recibos_numero_seq) = v_sr and r->>'conta' = 'Sicredi', 'recibo avulso: prévia sem número');
  r := public.agente_fazer('recibo_avulso', '{"pagador": "Marcos", "valor": 80, "referente": "conserto de pneu sem O.S.", "forma": "PIX"}', true);
  perform pg_temp.ok((r->>'recibo')::bigint = v_sr + 1, 'recibo avulso gravado com o número seguinte, sem pular');
  perform pg_temp.ok(r->>'conta' = 'Sicredi' and (r->>'valor')::numeric = 80, 'recibo avulso');
  perform pg_temp.erro($q$select public.agente_fazer('recibo_avulso', '{"pagador": "Marcos", "valor": 80, "referente": "conserto", "forma": "PIX"}', true)$q$, '10 minutos');
  perform pg_temp.erro($q$select public.agente_fazer('recibo_avulso', '{"os": 101, "valor": 80, "forma": "PIX"}', true)$q$, 'receber_os');
  perform pg_temp.erro($q$select public.agente_fazer('recibo_avulso', '{"pagador": "Z", "valor": 10, "referente": "x", "forma": "PIX", "data": "2099-01-01"}', true)$q$, 'futuro');
end $$;

-- ---------------------------------------------------------------- 5. funcionários
do $$
declare r jsonb;
begin
  perform pg_temp.como('11111111-1111-1111-1111-111111111111');
  r := public.agente_fazer('funcionario', '{"acao": "criar", "campos": {"nome": " Pedro Alves ", "funcao": "Auxiliar", "salario": 2000, "cpf": "529.982.247-25"}}', true);
  perform pg_temp.ok(r->'funcionario'->>'nome' = 'Pedro Alves' and (select jornada ? 'sab' and cpf = '52998224725' from public.funcionarios where nome = 'Pedro Alves'), 'criar com jornada padrão e CPF só números');
  perform pg_temp.ok(exists (select 1 from public.tecnicos_lista() where nome = 'Pedro Alves'), 'novo funcionário já aparece na lista de técnicos');
  r := public.agente_fazer('funcionario', '{"acao": "lancar", "funcionario": "pedro", "tipo": "vale", "valor": 150, "mes": "2026-11"}', true);
  perform pg_temp.ok((select count(*) from public.funcionario_lanc l join public.funcionarios f on f.id = l.funcionario_id where f.nome = 'Pedro Alves' and l.tipo = 'vale' and l.valor = 150 and l.competencia = '2026-11-01') = 1, 'vale lançado');
  perform pg_temp.erro($q$select public.agente_fazer('funcionario', '{"acao": "lancar", "funcionario": "pedro", "tipo": "hora_extra"}', true)$q$, 'quantidade de horas');
  perform pg_temp.erro($q$select public.agente_fazer('funcionario', '{"acao": "lancar", "funcionario": "pedro", "tipo": "premio", "valor": 1}', true)$q$, 'não existe');
  r := public.agente_fazer('funcionario', format('{"acao": "editar_lancamento", "id": "%s", "campos": {"valor": 200, "mes": "2026-10"}}',
         (select l.id from public.funcionario_lanc l join public.funcionarios f on f.id = l.funcionario_id where f.nome = 'Pedro Alves'))::jsonb, true);
  perform pg_temp.ok((r->'lancamento'->>'valor')::numeric = 200 and r->'lancamento'->>'mes' = '2026-10', 'editar lançamento (valor e mês)');
  perform pg_temp.erro($q$select public.agente_fazer('funcionario', '{"acao": "excluir", "funcionario": "Pedro Alves"}', true)$q$, 'desligar');
  r := public.agente_fazer('funcionario', '{"acao": "desligar", "funcionario": "Pedro Alves", "data": "2026-11-01"}', true);
  perform pg_temp.ok((select not ativo and demissao = '2026-11-01' from public.funcionarios where nome = 'Pedro Alves'), 'desligar');
  perform pg_temp.ok(not exists (select 1 from public.tecnicos_lista() where nome = 'Pedro Alves'), 'desligado sai da lista de técnicos');
  r := public.agente_fazer('funcionario', '{"acao": "reativar", "funcionario": "Pedro Alves"}', true);
  perform pg_temp.ok((select ativo and demissao is null from public.funcionarios where nome = 'Pedro Alves'), 'reativar');
  perform pg_temp.erro($q$select public.agente_fazer('funcionario', '{"acao": "editar", "funcionario": "Pedro Alves", "campos": {"vinculo": "pj"}}', true)$q$, 'vinculo deve ser');
end $$;

-- ---------------------------------------------------------------- 6. notas da SEFAZ
do $$
declare r jsonb;
begin
  perform pg_temp.como('11111111-1111-1111-1111-111111111111');
  r := public.agente_fazer('nota_sefaz', '{"acao": "manifestar", "numero": "456", "tipo": "desconhecida"}', false);
  perform pg_temp.ok(r->>'situacao' = 'ignorada' and r->>'manifestacao_pedida' = 'desconhecida', 'prévia: desconhecer tira das novas');
  perform pg_temp.ok((select status from public.nfe_recebidas where numero = '456') = 'nova', 'prévia não gravou');
  perform pg_temp.erro($q$select public.agente_fazer('nota_sefaz', '{"acao": "manifestar", "numero": "456", "tipo": "nao_realizada", "justificativa": "curta"}', true)$q$, '15 caracteres');
  r := public.agente_fazer('nota_sefaz', '{"acao": "ignorar", "numero": "456"}', true);
  perform pg_temp.ok((select status from public.nfe_recebidas where numero = '456') = 'ignorada', 'ignorar');
  r := public.agente_fazer('nota_sefaz', '{"acao": "voltar", "numero": "456"}', true);
  perform pg_temp.ok((select status from public.nfe_recebidas where numero = '456') = 'nova', 'voltar para novas');
  r := public.agente_fazer('nota_sefaz', '{"acao": "vincular_os", "numero": "456", "os": 100, "itens": [{"item_id": "00000000-0000-0000-0000-00000000a101", "nf_item": 1}]}', true);
  perform pg_temp.ok((select custo_unit from public.os_itens where id = '00000000-0000-0000-0000-00000000a101') = 30, 'custo da pastilha veio da nota (2 × 30 / 2)');
  perform pg_temp.erro($q$select public.agente_fazer('nota_sefaz', '{"acao": "vincular_os", "numero": "456", "os": 100, "itens": [{"item_id": "00000000-0000-0000-0000-00000000a101", "nf_item": 2}]}', true)$q$, 'restante');
  perform pg_temp.erro($q$select public.agente_fazer('nota_sefaz', '{"acao": "vincular_os", "numero": "456", "os": 100, "itens": [{"item_id": "00000000-0000-0000-0000-00000000a100", "nf_item": 2}]}', true)$q$, 'não é peça');
  perform pg_temp.ok((select status from public.nfe_recebidas where numero = '456') = 'vinculada', 'nota vinculada à O.S.');
  r := public.agente_fazer('nota_sefaz', '{"acao": "consultar_agora"}', true);
  perform pg_temp.ok((select pedido_em is not null from public.sefaz_config where id = 1), 'consultar agora');
  r := public.agente_fazer('ajustes', '{"sefaz": {"ciencia_automatica": false}}', true);
  perform pg_temp.ok((select not ciencia_automatica from public.sefaz_config where id = 1), 'ajustes: ciência automática desligada');
end $$;

-- ---------------------------------------------------------------- 7. boletos (pagamento confirmado pelo banco)
do $$
declare r jsonb; n int;
begin
  perform pg_temp.como('11111111-1111-1111-1111-111111111111');
  r := public.agente_fazer('boleto_pago', ('{"nosso_numero": "260000011", "valor_pago": 612, "data": "' || current_date || '", "forma": "Pix"}')::jsonb, true);
  perform pg_temp.ok((r->>'recibo') is not null and r->>'conta' = 'Sicredi' and (r->>'os_fechada')::boolean, 'boleto pago: recibo (com juros) e O.S. fechada');
  perform pg_temp.ok((select status from public.receber where id = '00000000-0000-0000-0000-0000000001b1') = 'paga', 'parcela baixada');
  select count(*) into n from public.recibos where ordem_id = '00000000-0000-0000-0000-000000000103';
  r := public.agente_fazer('boleto_pago', '{"nosso_numero": "260000011", "valor_pago": 612}', true);
  perform pg_temp.erro($q$select public.agente_fazer('boleto_pago', '{"nosso_numero": "260000011", "valor_pago": 612}', false)$q$, 'só grava');
  perform pg_temp.ok((r->>'ja_registrado')::boolean and (select count(*) from public.recibos where ordem_id = '00000000-0000-0000-0000-000000000103') = n, 'nunca dois recibos');
  perform pg_temp.erro($q$select public.agente_fazer('boleto_situacao', '{"nosso_numero": "260000011", "situacao": "baixado"}', true)$q$, 'já está pago');
end $$;

-- ---------------------------------------------------------------- 8. pedidos de compra, parcelas, despesa fixa
do $$
declare r jsonb;
begin
  perform pg_temp.como('11111111-1111-1111-1111-111111111111');
  r := public.agente_fazer('pedido_compra', '{"acao": "conferir", "ids": ["00000000-0000-0000-0000-0000000000a5", "00000000-0000-0000-0000-0000000000a6"]}', true);
  perform pg_temp.ok((select count(*) from public.pre_notas where situacao = 'conferida' and conferida_por = 'Danilo') = 2, 'conferir 2 pedidos');
  r := public.agente_fazer('pedido_compra', '{"acao": "editar", "id": "00000000-0000-0000-0000-0000000000a6", "campos": {"os_numero": 100, "total": 85}}', true);
  perform pg_temp.ok((select ordem_id = '00000000-0000-0000-0000-000000000100' and placa = 'ABC1D23' and total = 85 from public.pre_notas where id = '00000000-0000-0000-0000-0000000000a6'), 'editar: liga à O.S.');
  r := public.agente_fazer('pedido_compra', '{"acao": "cancelar", "id": "00000000-0000-0000-0000-0000000000a5"}', true);
  perform pg_temp.erro($q$select public.agente_fazer('pedido_compra', '{"acao": "conferir", "id": "00000000-0000-0000-0000-0000000000a5"}', true)$q$, 'cancelado');
  -- O.S. 100 entregue sem prazo: combinar
  perform public.agente_fazer('alterar_os', '{"numero": 100, "acao": "entregar", "km_saida": 1100}', true);
  r := public.agente_fazer('parcela', '{"acao": "combinar_prazo", "numero": 100, "forma": "boleto", "parcelas": [{"valor": 250, "vencimento": "2026-12-20"}, {"valor": 250, "vencimento": "2027-01-20"}]}', true);
  perform pg_temp.ok(jsonb_array_length(r->'parcelas') = 2 and r->>'forma' = 'Boleto', 'combinar prazo em 2x');
  perform pg_temp.erro($q$select public.agente_fazer('parcela', '{"acao": "combinar_prazo", "numero": 100, "forma": "Boleto", "parcelas": [{"valor": 1, "vencimento": "2026-12-20"}]}', true)$q$, 'não tem saldo sem prazo');
  r := public.agente_fazer('parcela', format('{"acao": "editar", "id": "%s", "vencimento": "2026-12-28"}',
         (select id from public.receber where ordem_id = '00000000-0000-0000-0000-000000000100' and parcela = 1))::jsonb, true);
  perform pg_temp.ok(r->>'vencimento' = '2026-12-28', 'editar vencimento');
  perform pg_temp.erro(format($q$select public.agente_fazer('parcela', '{"acao": "editar", "id": "%s", "valor": 1}', true)$q$,
         (select id from public.receber where ordem_id = '00000000-0000-0000-0000-000000000100' and parcela = 1)), 'não muda por aqui');
  r := public.agente_fazer('despesa_fixa', '{"acao": "tornar", "busca": "Aluguel"}', true);
  perform pg_temp.ok((select fixa from public.contas where id = '00000000-0000-0000-0000-0000000000d1'), 'aluguel virou despesa fixa');
  r := public.agente_fazer('despesa_fixa', '{"acao": "encerrar", "id": "00000000-0000-0000-0000-0000000000d1"}', true);
end $$;

-- ---------------------------------------------------------------- 9. ajustes, equipe, site, RH
do $$
declare r jsonb;
begin
  perform pg_temp.como('11111111-1111-1111-1111-111111111111');
  r := public.agente_fazer('ajustes', '{"campos": {"valorHora": 120, "garantiaDias": 180, "formasPagamento": ["PIX", "Dinheiro", "pix", " Cartão de débito "]}, "encargos": {"fgts": 8}}', true);
  perform pg_temp.ok((select dados->'formasPagamento' = '["PIX", "Dinheiro", "Cartão de débito"]'::jsonb and (dados->>'valorHora')::numeric = 120 and dados->'encargos'->>'fgts' = '8' from public.config where id = 1),
    'ajustes gravados (lista sem repetir, na ordem)');
  perform pg_temp.ok((select dados->>'contaRecebimento' = 'Sicredi' from public.config where id = 1), 'o resto da config continua');
  perform pg_temp.erro($q$select public.agente_fazer('ajustes', '{"campos": {"espelhoLegado": true}}', true)$q$, 'não muda por aqui');
  perform pg_temp.erro($q$select public.agente_fazer('ajustes', '{"campos": {"impressaoVias": 5}}', true)$q$, '1 a 3');
  -- revisão do #62: o número que dá ordens pelo WhatsApp e o destino do backup só mudam na tela
  perform pg_temp.erro($q$select public.agente_fazer('ajustes', '{"whatsapp_alerta": "(27) 99769-6545"}', true)$q$, 'só mudam na tela');
  perform pg_temp.erro($q$select public.agente_fazer('ajustes', '{"backup_leitura": {"emails": ["a@b.com"]}}', true)$q$, 'só mudam na tela');
  -- equipe
  r := public.agente_fazer('equipe', '{"perfil": "carlos", "ativo": false}', true);
  perform pg_temp.ok((select not ativo from public.perfis where id = '33333333-3333-3333-3333-333333333333'), 'desativar acesso');
  perform pg_temp.erro($q$select public.agente_fazer('equipe', '{"perfil": "Danilo", "papel": "consultor"}', true)$q$, 'próprio papel');
  r := public.agente_fazer('equipe', '{"perfil": "tiago@oficina.test", "papel": "admin"}', true);
  perform pg_temp.ok((select papel from public.perfis where id = '22222222-2222-2222-2222-222222222222') = 'admin', 'Tiago vira administrador');
  -- site
  r := public.agente_fazer('site', '{"acao": "alterar", "alteracoes": [{"caminho": "secoes.0.titulo", "valor": "Oficina completa"}, {"caminho": ["contato", "whatsapp"], "valor": "27992470140"}]}', true);
  perform pg_temp.ok((select dados #>> '{secoes,0,titulo}' = 'Oficina completa' and dados #>> '{contato,whatsapp}' = '27992470140' from public.site_rascunho), 'site: alterar o rascunho');
  perform pg_temp.erro($q$select public.agente_fazer('site', '{"acao": "alterar", "alteracoes": [{"caminho": "secoes.5.titulo", "valor": "x"}]}', true)$q$, 'não existe');
  perform pg_temp.erro($q$select public.agente_fazer('site', '{"acao": "alterar", "alteracoes": [{"caminho": "rodape.texto", "valor": "x"}]}', true)$q$, 'não existe');
  r := public.agente_fazer('site', '{"acao": "publicar", "observacao": "título novo"}', true);
  perform pg_temp.ok((select dados #>> '{secoes,0,titulo}' from public.site_publicacoes order by id desc limit 1) = 'Oficina completa', 'site: publicar');
  perform pg_temp.ok((public.site_conteudo_publicado()->'dados'->'secoes'->0->>'titulo') = 'Oficina completa', 'o visitante vê a versão nova');
  -- RH
  r := public.agente_fazer('rh_documento', '{"id": "00000000-0000-0000-0000-0000000000f9", "tipo": "pro_labore", "mes": "2026-09"}', true);
  perform pg_temp.ok((select tipo = 'pro_labore' and competencia = '2026-09' from public.rh_documentos where id = '00000000-0000-0000-0000-0000000000f9'), 'RH: mudar tipo e mês');
  r := public.agente_fazer('rh_documento', '{"id": "00000000-0000-0000-0000-0000000000f9", "acao": "excluir"}', true);
  perform pg_temp.ok(r->>'arquivo' = '2026-10/x.pdf' and not exists (select 1 from public.rh_documentos where id = '00000000-0000-0000-0000-0000000000f9'), 'RH: excluir devolve o arquivo para tirar da pasta');
end $$;

-- ---------------------------------------------------------------- 10. só o administrador usa o conector; histórico
do $$
begin
  perform pg_temp.como('22222222-2222-2222-2222-222222222222'); -- Tiago virou admin no cenário 9: volta a consultor
  perform pg_temp.como('11111111-1111-1111-1111-111111111111');
  perform public.agente_fazer('equipe', '{"perfil": "tiago@oficina.test", "papel": "consultor"}', true);
  perform pg_temp.como('22222222-2222-2222-2222-222222222222');
  perform pg_temp.erro($q$select public.agente_fazer('fornecedor', '{"acao": "criar", "campos": {"razao": "Z"}}', true)$q$, 'só atende o administrador');
  perform pg_temp.como('11111111-1111-1111-1111-111111111111');
  perform pg_temp.ok((select count(distinct ferramenta) from public.agente_acoes) >= 14, 'histórico de todas as ferramentas novas');
end $$;

-- ---------------------------------------------------------------- 11. foto_id do WhatsApp; alterar_os sem nada
reset role;
insert into public.whatsapp_mensagens (msg_id, jid, telefone, nome, de_mim, texto, tipo, em, midia_path, midia_tipo, midia_expira)
values ('WAFOTO1', '5527999990000@s.whatsapp.net', '27999990000', 'Ana', false, '', 'imagem', now(), '2026/11/09/WAFOTO1.jpg', 'image/jpeg', now() + interval '30 days'),
       ('WATEXTO', '5527999990000@s.whatsapp.net', '27999990000', 'Ana', false, 'oi', 'texto', now() - interval '1 minute', null, null, null);
set role authenticated;
do $$
declare r jsonb;
begin
  perform pg_temp.como('11111111-1111-1111-1111-111111111111');
  r := public.whatsapp_mensagens_de('27999990000', 10, false);
  perform pg_temp.ok((select count(*) from jsonb_array_elements(r->'mensagens') m where m ? 'foto_id') = 1
    and (select (m->>'foto_id')::bigint from jsonb_array_elements(r->'mensagens') m where m ? 'foto_id') = (select id from public.whatsapp_mensagens where msg_id = 'WAFOTO1'),
    'WhatsApp: só a mensagem com foto mostra o foto_id');
  perform pg_temp.erro($q$select public.agente_fazer('alterar_os', '{"numero": 100}', false)$q$, 'Nada a fazer');
end $$;

-- ---------------------------------------------------------------- 12. revisão independente do PR #62
reset role;
-- O.S. 105 entregue a receber: itens 600 + 400, recibo 300, parcelas 350 + 350
insert into public.ordens (id, numero, status, cliente_id, veiculo_id, cliente, veiculo, km_entrada, total, entregue_em)
values ('00000000-0000-0000-0000-000000000105', 105, 'entregue', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000f1',
        '{"nome": "Ana Souza"}', '{"placa": "ABC1D23"}', 1000, 1000, now());
insert into public.os_itens (id, ordem_id, tipo, descricao, qtd, valor_unit, aprovado, executado) values
  ('00000000-0000-0000-0000-00000000e105', '00000000-0000-0000-0000-000000000105', 'servico', 'Motor', 1, 600, true, true),
  ('00000000-0000-0000-0000-00000000e106', '00000000-0000-0000-0000-000000000105', 'servico', 'Câmbio', 1, 400, true, true);
insert into public.recibos (ordem_id, cliente_id, pagador, valor, referente, forma, conta_destino, data)
values ('00000000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-0000000000c1', 'Ana Souza', 300, 'entrada', 'PIX', 'Sicredi', current_date);
insert into public.receber (id, ordem_id, cliente_id, cliente_nome, descricao, forma, parcela, parcelas, valor, vencimento) values
  ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-0000000000c1', 'Ana Souza', 'OS 00105', 'Promissória', 1, 2, 350, current_date + 20),
  ('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-0000000000c1', 'Ana Souza', 'OS 00105', 'Promissória', 2, 2, 350, current_date + 50);
-- duas despesas fixas parecidas
insert into public.contas (id, descricao, favorecido, valor, vencimento, categoria, fixa, grupo) values
  ('00000000-0000-0000-0000-0000000000d7', 'Aluguel casa 1', 'Imobiliária', 900, current_date + 8, 'Aluguel', true, '00000000-0000-0000-0000-00000000ca51'),
  ('00000000-0000-0000-0000-0000000000d8', 'Aluguel casa 2', 'Imobiliária', 700, current_date + 9, 'Aluguel', true, '00000000-0000-0000-0000-00000000ca52');
-- fornecedor com conta a pagar ligada
insert into public.fornecedores (id, cnpj, razao, fantasia) values ('00000000-0000-0000-0000-0000000000b9', '', 'Torno do Zé', 'Torno do Zé');
insert into public.contas (id, descricao, fornecedor_id, favorecido, valor, vencimento) values
  ('00000000-0000-0000-0000-0000000000d9', 'Torno', '00000000-0000-0000-0000-0000000000b9', 'Torno do Zé', 120, current_date + 3);
set role authenticated;
do $$
declare r jsonb; o public.ordens;
begin
  perform pg_temp.como('11111111-1111-1111-1111-111111111111');
  -- (2) desconto junto com itens: vale sobre os itens já mudados (antes passava do valor dos itens e fechava a O.S. com parcela aberta)
  perform pg_temp.erro($q$select public.agente_fazer('alterar_os', '{"numero": 105, "dados": {"desconto": 650}, "itens_remover": ["00000000-0000-0000-0000-00000000e106"]}', true)$q$,
    'não pode passar do valor dos itens');
  perform pg_temp.ok((select count(*) from public.os_itens where ordem_id = '00000000-0000-0000-0000-000000000105') = 2, 'recusado: nada mudou (itens continuam)');
  r := public.agente_fazer('alterar_os', '{"numero": 105, "dados": {"desconto": 100}, "itens_remover": ["00000000-0000-0000-0000-00000000e106"]}', true);
  select * into o from public.ordens where numero = 105;
  perform pg_temp.ok(o.desconto = 100 and o.total = 500 and o.finalizada_em is null, 'itens primeiro (600), depois o desconto: total 500 — ' || o.total);
  perform pg_temp.ok((select status from public.receber where id = '00000000-0000-0000-0000-0000000005a2') = 'cancelada'
                     and (select valor from public.receber where id = '00000000-0000-0000-0000-0000000005a1') = 200, 'parcelas acompanham o saldo novo (200)');
  perform pg_temp.erro($q$select public.agente_fazer('alterar_os', '{"numero": 100, "acao": "entregar", "km_saida": "1100", "dados": {"desconto": 10}, "itens_remover": ["00000000-0000-0000-0000-00000000a102"]}', true)$q$,
    'mande os itens primeiro');
  perform pg_temp.erro($q$select public.agente_fazer('alterar_os', '{"numero": 100, "acao": "cancelar", "motivo": "teste", "dados": {"desconto": 10}}', true)$q$, 'não combina');
  -- (4) o mesmo desconto: nada muda (as parcelas só acompanham uma mudança de desconto)
  update public.receber set valor = 400 where id = '00000000-0000-0000-0000-0000000005a1';  -- parcela acima do saldo (como depois de mexer nos itens)
  r := public.os_aplicar_desconto('00000000-0000-0000-0000-000000000105', 100, '', true);
  perform pg_temp.ok(not (r->>'mudou')::boolean and r->'avisos'->>0 like '%nada mudou%' and r->'avisos'->>1 like '%passam do saldo%'
                     and (select valor from public.receber where id = '00000000-0000-0000-0000-0000000005a1') = 400, 'mesmo desconto: nada muda, só avisa');
  -- (3) fornecedor com conta ligada não é excluído (o banco não barra: a conta ficaria sem fornecedor)
  perform pg_temp.erro($q$select public.agente_fazer('fornecedor', '{"acao": "excluir", "busca": "Torno do Zé"}', true)$q$, '1 conta(s) a pagar');
  perform pg_temp.ok(exists (select 1 from public.fornecedores where id = '00000000-0000-0000-0000-0000000000b9'), 'fornecedor continua');
  -- (5) recibo avulso de uma venda não passa do que falta receber dela
  r := public.agente_fazer('venda_balcao', '{"itens": [{"descricao": "Lâmpada", "valor_unit": 25, "qtd": 2}], "forma": "PIX"}', true);
  perform pg_temp.erro(format($q$select public.agente_fazer('recibo_avulso', '{"venda": %s, "valor": 50, "forma": "PIX", "receber_mesmo_repetido": true}', true)$q$, r->>'venda'), 'falta só');
  r := public.agente_fazer('venda_balcao', '{"itens": [{"descricao": "Lâmpada", "valor_unit": 25, "qtd": 2}], "forma": "PIX", "receber": false}', true);
  r := public.agente_fazer('recibo_avulso', format('{"venda": %s, "valor": 50, "forma": "PIX", "receber_mesmo_repetido": true}', r->>'venda')::jsonb, true);
  perform pg_temp.ok((r->>'valor')::numeric = 50, 'venda sem recibo: recibo do que falta');
  -- (10) encerrar despesa fixa: busca que acha duas sequências é recusada
  perform pg_temp.erro($q$select public.agente_fazer('despesa_fixa', '{"acao": "encerrar", "busca": "Aluguel casa"}', true)$q$, 'mais de uma despesa fixa');
  r := public.agente_fazer('despesa_fixa', '{"acao": "encerrar", "busca": "Aluguel casa 2"}', false);
  perform pg_temp.ok(r->>'conta' = 'Aluguel casa 2', 'busca exata encerra a certa (prévia)');
  -- (11) vincular de novo a mesma peça à mesma linha da nota (acertar o custo)
  r := public.agente_fazer('nota_sefaz', '{"acao": "vincular_os", "numero": "456", "os": 100, "itens": [{"item_id": "00000000-0000-0000-0000-00000000a101", "custo_total": 70}]}', true);
  perform pg_temp.ok((select custo_unit from public.os_itens where id = '00000000-0000-0000-0000-00000000a101') = 35, 'custo acertado (70 / 2)');
  r := public.agente_fazer('nota_sefaz', '{"acao": "vincular_os", "numero": "456", "os": 100, "itens": [{"item_id": "00000000-0000-0000-0000-00000000a101", "nf_item": 1}]}', true);
  perform pg_temp.ok((select custo_unit from public.os_itens where id = '00000000-0000-0000-0000-00000000a101') = 30, 'religar à mesma linha da nota não acusa falta (a própria peça não conta)');
  -- Codex no #62: acesso pelo nome exato não pega outro que contém o nome ("Ana" × "Mariana")
  reset role;
  insert into auth.users (id, email, raw_user_meta_data) values
    ('44444444-4444-4444-4444-444444444444', 'mariana@oficina.test', '{"nome": "Mariana"}'),
    ('55555555-5555-5555-5555-555555555555', 'ana@oficina.test', '{"nome": "Ana"}');
  update public.perfis set papel = 'consultor' where id in ('44444444-4444-4444-4444-444444444444', '55555555-5555-5555-5555-555555555555');
  set role authenticated;
  perform pg_temp.como('11111111-1111-1111-1111-111111111111');
  r := public.agente_fazer('equipe', '{"perfil": "Ana", "ativo": false}', true);
  perform pg_temp.ok((select not ativo from public.perfis where id = '55555555-5555-5555-5555-555555555555')
                     and (select ativo from public.perfis where id = '44444444-4444-4444-4444-444444444444'), 'equipe: "Ana" desativa a Ana, não a Mariana');
  perform pg_temp.erro($q$select public.agente_fazer('equipe', '{"perfil": "an", "ativo": false}', true)$q$, 'Mais de um acesso');
  -- (12) funcionário que é técnico de O.S. não é excluído
  r := public.agente_fazer('funcionario', '{"acao": "criar", "campos": {"nome": "Zé Teste", "funcao": "Mecânico"}}', true);
  r := public.agente_fazer('alterar_os', '{"numero": 105, "dados": {"tecnico": "Zé Teste"}}', true);
  perform pg_temp.erro($q$select public.agente_fazer('funcionario', '{"acao": "excluir", "funcionario": "Zé Teste"}', true)$q$, 'técnico responsável de 1 O.S.');
end $$;

reset role;
select 'v50: todos os cenários passaram' as resultado;
