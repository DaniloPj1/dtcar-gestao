-- Cenários do v61 (ferramentas de orçamento no conector). Roda depois de montar_banco.sh (até v60) + v61.
-- Qualquer falha para o psql.
\set ON_ERROR_STOP on
insert into auth.users (id, email, raw_user_meta_data) values ('99999999-9999-9999-9999-999999999999', 'danilo@oficina.test', '{"nome": "Danilo"}') on conflict do nothing;
insert into public.perfis (id, nome, papel, ativo) values ('99999999-9999-9999-9999-999999999999', 'Danilo', 'admin', true) on conflict (id) do update set papel = 'admin', ativo = true;
select null from set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', false);
insert into public.config (id, dados) values (1, '{"garantiaDias": 90, "condicoesPadrao": "Pagamento na retirada."}') on conflict (id) do update set dados = excluded.dados;
insert into public.produtos (id, tipo, descricao, unidade, custo, preco_vista, estoque_atual, controla_estoque, ativo) values
  ('00000000-0000-0000-0000-0000000000b1', 'produto', 'BIELETA', 'UN', 30, 80, 10, true, true)
  on conflict (id) do nothing;

create temp table antes_orc as select (select last_value from public.orc_numero_seq) seq, (select is_called from public.orc_numero_seq) chamada, (select count(*) from public.orcamentos) qtd;

-- 1. PRÉVIA de criar: não grava nada e NÃO gasta número ORC (a sequência não volta atrás numa transação desfeita)
do $$ declare r jsonb; a record; begin
  r := public.agente_fazer('orcamento', '{"acao": "criar", "cliente": {"nome": "JOSE DA SILVA", "telefone": "(27) 98888-0000"},
    "veiculo": {"placa": "KYN9G83", "marca": "Chevrolet", "modelo": "ONIX 1.4AT LTZ", "ano": "2018"},
    "reclamacao": "Suspensão", "itens": [{"tipo": "peca", "descricao": "BIELETA", "qtd": 2, "valor_unit": 80, "custo_unit": 30}]}'::jsonb, false);
  if (r->>'gravado')::boolean or not (r->>'previa')::boolean then raise exception 'FALHOU 1: devia ser prévia (%)', r; end if;
  if (r->>'numero') is not null then raise exception 'FALHOU 1a: prévia não dá número (%)', r; end if;
  if (r->>'total')::numeric <> 160 or (r->>'custo')::numeric <> 60 then raise exception 'FALHOU 1b: conta da prévia (%)', r; end if;
  select * into a from antes_orc;
  if (select count(*) from public.orcamentos) <> a.qtd then raise exception 'FALHOU 1c: a prévia gravou orçamento'; end if;
  if (select last_value from public.orc_numero_seq) <> a.seq or (select is_called from public.orc_numero_seq) <> a.chamada then raise exception 'FALHOU 1d: a prévia gastou número ORC'; end if;
end $$;

-- 1e. prévia confere o que o orcamento_salvar confere
do $$ declare r jsonb; begin
  begin r := public.agente_fazer('orcamento', '{"acao": "criar", "cliente": {"nome": ""}, "itens": []}'::jsonb, false);
    raise exception 'FALHOU 1e: devia exigir o cliente';
  exception when others then if sqlerrm not like '%Informe o cliente%' then raise; end if; end;
  begin r := public.agente_fazer('orcamento', '{"acao": "criar", "cliente": {"nome": "X"}, "desconto": 500,
      "itens": [{"tipo": "peca", "descricao": "BIELETA", "qtd": 1, "valor_unit": 80}]}'::jsonb, false);
    raise exception 'FALHOU 1f: devia barrar desconto maior que os itens';
  exception when others then if sqlerrm not like '%desconto%' then raise; end if; end;
end $$;

-- 2. criar de verdade
do $$ declare r jsonb; o public.orcamentos; begin
  r := public.agente_fazer('orcamento', '{"acao": "criar", "cliente": {"nome": "JOSE DA SILVA", "telefone": "(27) 98888-0000"},
    "veiculo": {"placa": "KYN9G83", "marca": "Chevrolet", "modelo": "ONIX 1.4AT LTZ", "ano": "2018"},
    "reclamacao": "Suspensão dianteira", "validade_dias": 10, "pedido": "orçamento do Onix",
    "itens": [{"tipo": "peca", "descricao": "BIELETA", "qtd": 2, "valor_unit": 80, "custo_unit": 30},
              {"tipo": "servico", "descricao": "SUBSTITUIR BIELETAS", "qtd": 1, "valor_unit": 120}]}'::jsonb, true);
  if not (r->>'gravado')::boolean then raise exception 'FALHOU 2: não gravou (%)', r; end if;
  if r->>'numero' !~ '^ORC-\d{5}$' then raise exception 'FALHOU 2a: número no jeito da tela (%)', r->>'numero'; end if;
  if (r->>'total')::numeric <> 280 or (r->>'custo')::numeric <> 60 then raise exception 'FALHOU 2b: total e custo (%)', r; end if;
  if r->>'situacao' <> 'elaboracao' then raise exception 'FALHOU 2c: nasce em elaboração (%)', r->>'situacao'; end if;
  select * into o from public.orcamentos where id = (r->>'id')::uuid;
  if o.validade <> (now() at time zone 'America/Sao_Paulo')::date + 10 then raise exception 'FALHOU 2d: validade_dias (%)', o.validade; end if;
  if o.veiculo->>'placa' <> 'KYN9G83' or o.cliente->>'nome' <> 'JOSE DA SILVA' then raise exception 'FALHOU 2e: cópia do cliente e do veículo'; end if;
  if (select count(*) from public.orcamento_itens where orcamento_id = o.id) <> 2 then raise exception 'FALHOU 2f: itens'; end if;
  if not exists (select 1 from public.agente_acoes where ferramenta = 'orcamento' and registro = o.id::text and pedido = 'orçamento do Onix') then
    raise exception 'FALHOU 2g: histórico em agente_acoes'; end if;
  -- o estoque não se mexe: orçamento não reserva nem baixa peça
  if (select estoque_atual from public.produtos where id = '00000000-0000-0000-0000-0000000000b1') <> 10 then raise exception 'FALHOU 2h: orçamento mexeu no estoque'; end if;
  create temp table orc1 as select o.id, o.numero;
end $$;

-- 3. buscar pelo número (5 = ORC-00005) e listar
do $$ declare r jsonb; n int; begin
  select numero into n from orc1;
  r := public.agente_buscar_orcamento(jsonb_build_object('numero', n));
  if r->>'numero' <> public.orc_numero_texto(n) then raise exception 'FALHOU 3: buscar pelo número (%)', r; end if;
  if jsonb_array_length(r->'itens') <> 2 then raise exception 'FALHOU 3a: itens na ficha'; end if;
  if (r->'itens'->0->>'id') is null then raise exception 'FALHOU 3b: o item precisa do id (para itens_alterar/itens_fora)'; end if;
  if (r->'itens'->0->>'total')::numeric <> 160 then raise exception 'FALHOU 3c: total do item (%)', r->'itens'->0; end if;
  r := public.agente_orcamentos('{"situacao": "abertos", "busca": "KYN9G83"}'::jsonb);
  if (r->>'quantidade')::int < 1 or (r->'orcamentos'->0->>'placa') <> 'KYN9G83' then raise exception 'FALHOU 3d: lista por placa (%)', r; end if;
  begin r := public.agente_buscar_orcamento('{"numero": 99999}'::jsonb); raise exception 'FALHOU 3e: devia dizer que não achou';
  exception when others then if sqlerrm not like '%não encontrado%' then raise; end if; end;
end $$;

-- 4. mexer na lista sem mandar tudo de novo: incluir, alterar e remover
do $$ declare r jsonb; id1 uuid; it jsonb; v_item text; begin
  select id into id1 from orc1;
  r := public.agente_buscar_orcamento(jsonb_build_object('id', id1));
  it := r->'itens'->0;   -- a bieleta
  r := public.agente_fazer('orcamento', jsonb_build_object('id', id1,
         'itens_alterar', jsonb_build_array(jsonb_build_object('id', it->>'id', 'qtd', 4)),
         'itens_incluir', jsonb_build_array(jsonb_build_object('tipo', 'peca', 'descricao', 'BUCHA DO ESTABILIZADOR', 'qtd', 2, 'valor_unit', 25))), true);
  if (r->>'total')::numeric <> 490 then raise exception 'FALHOU 4: 4x80 + 120 + 2x25 = 490 (%)', r->>'total'; end if;
  if jsonb_array_length(r->'itens') <> 3 then raise exception 'FALHOU 4a: devia ficar com 3 itens'; end if;
  -- remover o serviço
  r := public.agente_buscar_orcamento(jsonb_build_object('id', id1));
  select e->>'id' into v_item from jsonb_array_elements(r->'itens') e where e->>'tipo' = 'servico';
  r := public.agente_fazer('orcamento', jsonb_build_object('id', id1, 'itens_remover', jsonb_build_array(v_item)), true);
  if jsonb_array_length(r->'itens') <> 2 or (r->>'total')::numeric <> 370 then raise exception 'FALHOU 4b: remover item (%)', r->>'total'; end if;
  -- item de outro orçamento não entra
  begin r := public.agente_fazer('orcamento', jsonb_build_object('id', id1, 'itens_remover', jsonb_build_array(gen_random_uuid())), true);
    raise exception 'FALHOU 4c: devia recusar item de fora';
  exception when others then if sqlerrm not like '%não é deste orçamento%' then raise; end if; end;
end $$;

-- 5. enviar, recusar (motivo obrigatório) e reabrir
do $$ declare r jsonb; id1 uuid; begin
  select id into id1 from orc1;
  r := public.agente_fazer('orcamento', jsonb_build_object('acao', 'enviar', 'id', id1), true);
  if r->>'situacao' <> 'enviado' or (select enviado_em from public.orcamentos where id = id1) is null then raise exception 'FALHOU 5: enviar (%)', r->>'situacao'; end if;
  begin r := public.agente_fazer('orcamento', jsonb_build_object('acao', 'recusar', 'id', id1), true);
    raise exception 'FALHOU 5a: devia exigir o motivo';
  exception when others then if sqlerrm not like '%motivo%' then raise; end if; end;
  r := public.agente_fazer('orcamento', jsonb_build_object('acao', 'recusar', 'id', id1, 'motivo', 'achou caro'), true);
  if r->>'situacao' <> 'recusado' or (select motivo from public.orcamentos where id = id1) <> 'achou caro' then raise exception 'FALHOU 5b: recusar (%)', r; end if;
  r := public.agente_fazer('orcamento', jsonb_build_object('acao', 'reabrir', 'id', id1), true);
  if r->>'situacao' <> 'elaboracao' or (select motivo from public.orcamentos where id = id1) <> '' then raise exception 'FALHOU 5c: reabrir (%)', r; end if;
end $$;

-- 6. vencido é calculado (validade passada sem resposta), não gravado
do $$ declare r jsonb; id1 uuid; begin
  select id into id1 from orc1;
  update public.orcamentos set validade = (now() at time zone 'America/Sao_Paulo')::date - 1 where id = id1;
  r := public.agente_buscar_orcamento(jsonb_build_object('id', id1));
  if r->>'situacao' <> 'vencido' or r->>'situacao_gravada' <> 'elaboracao' then raise exception 'FALHOU 6: vencido é calculado (%)', r->>'situacao'; end if;
  r := public.agente_orcamentos('{"situacao": "vencido"}'::jsonb);
  if (r->>'quantidade')::int < 1 then raise exception 'FALHOU 6a: filtro de vencidos'; end if;
  update public.orcamentos set validade = (now() at time zone 'America/Sao_Paulo')::date + 10 where id = id1;
end $$;

-- 7. aprovar: a prévia não gasta número de O.S.; gravando vira O.S. (baixa de estoque: cenário 13)
do $$ declare r jsonb; id1 uuid; seq bigint; chamada boolean; os public.ordens; begin
  select id into id1 from orc1;
  seq := (select last_value from public.os_numero_seq); chamada := (select is_called from public.os_numero_seq);
  r := public.agente_fazer('orcamento_aprovar', jsonb_build_object('id', id1), false);
  if (r->>'gravado')::boolean or not (r->>'pode_aprovar')::boolean then raise exception 'FALHOU 7: prévia da aprovação (%)', r; end if;
  if (select last_value from public.os_numero_seq) <> seq or (select is_called from public.os_numero_seq) <> chamada then raise exception 'FALHOU 7a: a prévia gastou número de O.S.'; end if;
  r := public.agente_fazer('orcamento_aprovar', jsonb_build_object('id', id1, 'por', 'José (por WhatsApp)', 'forma', 'WhatsApp', 'pedido', 'cliente aprovou'), true);
  if not (r->>'gravado')::boolean or (r->>'os_numero') is null then raise exception 'FALHOU 7b: aprovar (%)', r; end if;
  select * into os from public.ordens where id = (r->>'ordem_id')::uuid;
  if os.status <> 'execucao' or os.orcamento_id <> id1 then raise exception 'FALHOU 7c: O.S. em execução e ligada ao orçamento'; end if;
  if (select situacao from public.orcamentos where id = id1) <> 'aprovado' then raise exception 'FALHOU 7d: orçamento aprovado'; end if;
  if r->>'link_os' is null then raise exception 'FALHOU 7e: link da O.S.'; end if;
  if not exists (select 1 from public.agente_acoes where ferramenta = 'orcamento_aprovar' and registro = id1::text) then raise exception 'FALHOU 7f: histórico da aprovação'; end if;
end $$;

-- 8. orçamento aprovado: não altera e não exclui
do $$ declare r jsonb; id1 uuid; begin
  select id into id1 from orc1;
  begin r := public.agente_fazer('orcamento', jsonb_build_object('id', id1, 'obs', 'mudando'), true);
    raise exception 'FALHOU 8: devia barrar alterar orçamento aprovado';
  exception when others then if sqlerrm not like '%já virou O.S.%' then raise; end if; end;
  begin r := public.agente_fazer('orcamento', jsonb_build_object('acao', 'excluir', 'id', id1), true);
    raise exception 'FALHOU 8a: devia barrar excluir orçamento aprovado';
  exception when others then if sqlerrm not like '%não pode ser excluído%' then raise; end if; end;
  begin r := public.agente_fazer('orcamento_aprovar', jsonb_build_object('id', id1), true);
    raise exception 'FALHOU 8b: devia barrar aprovar duas vezes';
  exception when others then if sqlerrm not like '%já foi aprovado%' then raise; end if; end;
end $$;

-- 9. excluir um orçamento que não virou O.S. (leva os itens junto) e fica no histórico
do $$ declare r jsonb; id2 uuid; begin
  r := public.agente_fazer('orcamento', '{"acao": "criar", "cliente": {"nome": "PARA EXCLUIR"},
    "itens": [{"tipo": "servico", "descricao": "REVISAO", "qtd": 1, "valor_unit": 100}]}'::jsonb, true);
  id2 := (r->>'id')::uuid;
  r := public.agente_fazer('orcamento', jsonb_build_object('acao', 'excluir', 'id', id2), true);
  if (select count(*) from public.orcamentos where id = id2) <> 0 then raise exception 'FALHOU 9: não excluiu'; end if;
  if (select count(*) from public.orcamento_itens where orcamento_id = id2) <> 0 then raise exception 'FALHOU 9a: itens ficaram'; end if;
  if (select count(*) from public.exclusoes where tabela = 'orcamentos' and registro = id2::text) <> 1 then raise exception 'FALHOU 9b: a exclusão precisa avisar o banco do PC'; end if;
end $$;

-- 10. ação desconhecida e orçamento inexistente dão recado claro
do $$ declare r jsonb; begin
  begin r := public.agente_fazer('orcamento', '{"acao": "mandar_email", "numero": 1}'::jsonb, true); raise exception 'FALHOU 10: ação desconhecida';
  exception when others then if sqlerrm not like '%Ação desconhecida%' then raise; end if; end;
  begin r := public.agente_fazer('orcamento', '{"numero": 99999, "obs": "x"}'::jsonb, true); raise exception 'FALHOU 10a: orçamento inexistente';
  exception when others then if sqlerrm not like '%não encontrado%' then raise; end if; end;
  begin r := public.agente_fazer('orcamento', '{"acao": "criar", "numero": 7, "cliente": {"nome": "X"}}'::jsonb, true); raise exception 'FALHOU 10b: criar com número';
  exception when others then if sqlerrm not like '%não se informa número%' then raise; end if; end;
end $$;

-- 11. aprovar que NÃO pode: nunca responde "gravado" (a orcamento_aprovar devolve erros em vez de levantar)
do $$ declare r jsonb; id3 uuid; n int; begin
  r := public.agente_fazer('orcamento', '{"acao": "criar", "cliente": {"nome": "SEM TELEFONE"},
    "itens": [{"tipo": "servico", "descricao": "REVISAO", "qtd": 1, "valor_unit": 100}]}'::jsonb, true);
  id3 := (r->>'id')::uuid;
  n := (select count(*) from public.ordens);
  begin
    r := public.agente_fazer('orcamento_aprovar', jsonb_build_object('id', id3), true);
    raise exception 'FALHOU 11: aprovar sem telefone/placa devia ser recusado, veio %', r;
  exception when others then
    if sqlerrm not like '%não pode virar O.S.%' then raise; end if;
  end;
  if (select count(*) from public.ordens) <> n then raise exception 'FALHOU 11a: abriu O.S. mesmo assim'; end if;
  if (select situacao from public.orcamentos where id = id3) <> 'elaboracao' then raise exception 'FALHOU 11b: mexeu no orçamento'; end if;
  -- a prévia continua mostrando os erros, sem levantar
  r := public.agente_fazer('orcamento_aprovar', jsonb_build_object('id', id3), false);
  if (r->>'pode_aprovar')::boolean or (r->>'erros') is null then raise exception 'FALHOU 11c: a prévia deve listar os erros (%)', r; end if;
end $$;

-- 12. só o administrador grava pelo conector (o consultor usa a tela)
do $$ declare r jsonb; begin
  insert into auth.users (id, email) values ('88888888-8888-8888-8888-888888888888', 'consultor@oficina.test') on conflict do nothing;
  insert into public.perfis (id, nome, papel, ativo) values ('88888888-8888-8888-8888-888888888888', 'Consultor', 'consultor', true)
    on conflict (id) do update set papel = 'consultor', ativo = true;
  perform set_config('request.jwt.claim.sub', '88888888-8888-8888-8888-888888888888', false);
  begin r := public.agente_orcamento('{"acao": "criar", "cliente": {"nome": "X"}}'::jsonb); raise exception 'FALHOU 12: consultor gravou';
  exception when others then if sqlerrm not like '%administrador%' then raise; end if; end;
  begin r := public.agente_orcamento_aprovar('{"numero": 1}'::jsonb); raise exception 'FALHOU 12a: consultor aprovou';
  exception when others then if sqlerrm not like '%administrador%' then raise; end if; end;
  begin r := public.agente_orcamentos('{}'::jsonb); raise exception 'FALHOU 12b: consultor listou';
  exception when others then if sqlerrm not like '%administrador%' then raise; end if; end;
  perform set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', false);
end $$;

-- 13. peça com código do estoque: liga no produto, pega o custo e a aprovação dá BAIXA de verdade
do $$ declare r jsonb; id4 uuid; cod text; saldo numeric; it jsonb; begin
  select codigo::text into cod from public.produtos where id = '00000000-0000-0000-0000-0000000000b1';
  saldo := (select estoque_atual from public.produtos where id = '00000000-0000-0000-0000-0000000000b1');
  r := public.agente_fazer('orcamento', jsonb_build_object('acao', 'criar',
    'cliente', jsonb_build_object('nome', 'COM ESTOQUE', 'telefone', '(27) 98888-1111'),
    'veiculo', jsonb_build_object('placa', 'KYN9G84', 'marca', 'Chevrolet', 'modelo', 'ONIX', 'ano', '2018'),
    'itens', jsonb_build_array(jsonb_build_object('tipo', 'peca', 'descricao', 'BIELETA', 'codigo', cod, 'qtd', 2, 'valor_unit', 80))), true);
  id4 := (r->>'id')::uuid;
  select to_jsonb(i) into it from public.orcamento_itens i where i.orcamento_id = id4;
  if (it->>'produto_id') is null then raise exception 'FALHOU 13: o código devia ligar no produto do estoque'; end if;
  if (it->>'custo_unit')::numeric <> 30 then raise exception 'FALHOU 13a: devia pegar o custo do estoque (%)', it->>'custo_unit'; end if;
  r := public.agente_fazer('orcamento_aprovar', jsonb_build_object('id', id4, 'por', 'Cliente'), true);
  if not (r->>'gravado')::boolean then raise exception 'FALHOU 13b: não aprovou (%)', r; end if;
  if (select estoque_atual from public.produtos where id = '00000000-0000-0000-0000-0000000000b1') <> saldo - 2 then
    raise exception 'FALHOU 13c: a aprovação tinha de baixar 2 do estoque (de % para %)', saldo,
      (select estoque_atual from public.produtos where id = '00000000-0000-0000-0000-0000000000b1'); end if;
  -- código que não existe é recusado, em vez de virar item solto
  begin r := public.agente_fazer('orcamento', '{"acao": "criar", "cliente": {"nome": "X"},
    "itens": [{"tipo": "peca", "descricao": "NADA", "codigo": "999999", "qtd": 1, "valor_unit": 10}]}'::jsonb, true);
    raise exception 'FALHOU 13d: código inexistente devia ser recusado';
  exception when others then if sqlerrm not like '%não existe no estoque%' then raise; end if; end;
end $$;

-- 14. produto_id não vem de fora e campo errado não passa calado
do $$ declare r jsonb; id1 uuid; it text; begin
  select id into id1 from orc1;
  begin r := public.agente_fazer('orcamento', '{"acao": "criar", "cliente": {"nome": "X"},
    "itens": [{"tipo": "peca", "descricao": "Y", "qtd": 1, "valor_unit": 10, "produto_id": "00000000-0000-0000-0000-0000000000b1"}]}'::jsonb, true);
    raise exception 'FALHOU 14: produto_id não pode vir de fora';
  exception when others then if sqlerrm not like '%pelo "codigo"%' then raise; end if; end;
  select e->>'id' into it from jsonb_array_elements(public.agente_buscar_orcamento(jsonb_build_object('id', id1))->'itens') e limit 1;
  begin r := public.agente_fazer('orcamento', jsonb_build_object('id', id1,
      'itens_alterar', jsonb_build_array(jsonb_build_object('id', it, 'preco', 250))), true);
    raise exception 'FALHOU 14a: campo inventado devia ser recusado';
  exception when others then if sqlerrm not like '%não existe. Campos%' then raise; end if; end;
end $$;

-- 15. orçamento novo nasce com a validade padrão dos Ajustes (como a tela)
do $$ declare r jsonb; o public.orcamentos; begin
  update public.config set dados = coalesce(dados, '{}'::jsonb) || '{"validadeDias": 7}'::jsonb where id = 1;
  r := public.agente_fazer('orcamento', '{"acao": "criar", "cliente": {"nome": "VALIDADE"},
    "itens": [{"tipo": "servico", "descricao": "REVISAO", "qtd": 1, "valor_unit": 50}]}'::jsonb, true);
  select * into o from public.orcamentos where id = (r->>'id')::uuid;
  if o.validade is distinct from public.agente_hoje() + 7 then raise exception 'FALHOU 15: validade padrão (%)', o.validade; end if;
end $$;

-- 16. aprovação leva o CPF e o endereço do orçamento para a ficha do cliente novo
do $$ declare r jsonb; id5 uuid; c public.clientes; begin
  r := public.agente_fazer('orcamento', '{"acao": "criar",
    "cliente": {"nome": "MARIA DO CPF", "telefone": "(27) 98888-2222", "doc": "529.982.247-25", "cep": "29705-390",
                "rua": "Rod. Gether Lopes de Farias", "bairro": "Sao Silvano", "cidade": "Colatina", "uf": "ES"},
    "veiculo": {"placa": "KYN9G85", "marca": "Fiat", "modelo": "UNO", "ano": "2015"},
    "itens": [{"tipo": "servico", "descricao": "REVISAO", "qtd": 1, "valor_unit": 100}]}'::jsonb, true);
  id5 := (r->>'id')::uuid;
  r := public.agente_fazer('orcamento_aprovar', jsonb_build_object('id', id5, 'por', 'Maria'), true);
  if not (r->>'cliente_novo')::boolean then raise exception 'FALHOU 16: devia cadastrar cliente novo'; end if;
  select c2.* into c from public.clientes c2 where c2.id = (select cliente_id from public.ordens where id = (r->>'ordem_id')::uuid);
  if c.doc <> '52998224725' then raise exception 'FALHOU 16a: CPF não foi para o cadastro (%)', c.doc; end if;
  if c.cep <> '29705-390' or c.rua = '' or c.bairro = '' then raise exception 'FALHOU 16b: endereço não foi (% % %)', c.cep, c.rua, c.bairro; end if;
end $$;

-- 17. buscar pelo telefone do cliente não derruba a ferramenta (número grande demais para int)
do $$ declare r jsonb; begin
  r := public.agente_orcamentos('{"busca": "27997696545"}'::jsonb);
  if (r->>'quantidade') is null then raise exception 'FALHOU 17: busca com muitos dígitos'; end if;
  r := public.agente_orcamentos('{"busca": "MARIA"}'::jsonb);
  if (r->>'quantidade')::int < 1 then raise exception 'FALHOU 17a: busca por nome'; end if;
end $$;

-- 18. item de outro orçamento nunca entra pela lista inteira (o total sairia errado), nem id repetido
do $$ declare r jsonb; id1 uuid; outro uuid; begin
  select id into id1 from orc1;
  r := public.agente_fazer('orcamento', '{"acao": "criar", "cliente": {"nome": "OUTRO"},
    "itens": [{"tipo": "servico", "descricao": "LAVAGEM", "qtd": 1, "valor_unit": 50}]}'::jsonb, true);
  select i.id into outro from public.orcamento_itens i where i.orcamento_id = (r->>'id')::uuid limit 1;
  begin r := public.agente_fazer('orcamento', jsonb_build_object('id', id1,
      'itens', jsonb_build_array(jsonb_build_object('id', outro, 'tipo', 'servico', 'descricao', 'ROUBADO', 'qtd', 1, 'valor_unit', 999))), true);
    raise exception 'FALHOU 18: item de outro orçamento não pode entrar';
  exception when others then if sqlerrm not like '%não é deste orçamento%' then raise; end if; end;
end $$;

-- 19. itens junto com itens_incluir é recusado (um ou outro, nunca os dois calados)
do $$ declare r jsonb; id1 uuid; begin
  select id into id1 from orc1;
  begin r := public.agente_fazer('orcamento', jsonb_build_object('id', id1, 'itens', '[]'::jsonb,
      'itens_incluir', jsonb_build_array(jsonb_build_object('tipo', 'servico', 'descricao', 'X', 'qtd', 1, 'valor_unit', 1))), true);
    raise exception 'FALHOU 19: devia recusar os dois juntos';
  exception when others then if sqlerrm not like '%OU as mexidas%' then raise; end if; end;
end $$;

select 'v61 OK' as resultado;
