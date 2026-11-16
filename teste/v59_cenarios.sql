-- Cenários do v59 (Compras, etapa 1). Roda depois de montar_banco.sh (até v58) + v59. Qualquer falha para o psql.
\set ON_ERROR_STOP on
insert into auth.users (id, email, raw_user_meta_data) values ('99999999-9999-9999-9999-999999999999', 'danilo@oficina.test', '{"nome": "Danilo"}') on conflict do nothing;
insert into auth.users (id, email, raw_user_meta_data) values ('77777777-7777-7777-7777-777777777777', 'consultor@oficina.test', '{"nome": "Consultor"}') on conflict do nothing;
insert into auth.users (id, email, raw_user_meta_data) values ('88888888-8888-8888-8888-888888888888', 'mecanico@oficina.test', '{"nome": "Zé"}') on conflict do nothing;
insert into public.perfis (id, nome, papel, ativo) values ('99999999-9999-9999-9999-999999999999', 'Danilo', 'admin', true) on conflict (id) do update set nome = 'Danilo', papel = 'admin', ativo = true;
select null from set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', false);
insert into public.perfis (id, nome, papel, ativo) values ('77777777-7777-7777-7777-777777777777', 'Consultor', 'consultor', true) on conflict (id) do update set nome = 'Consultor', papel = 'consultor', ativo = true;
insert into public.perfis (id, nome, papel, ativo) values ('88888888-8888-8888-8888-888888888888', 'Zé', 'mecanico', true) on conflict (id) do update set nome = 'Zé', papel = 'mecanico', ativo = true;
insert into public.fornecedores (id, razao, fantasia) values ('00000000-0000-0000-0000-0000000000f1', 'AUTO PECAS COLATINA LTDA', 'AutoPeças'),
  ('00000000-0000-0000-0000-0000000000f2', 'DPK DISTRIBUIDORA', '') on conflict (id) do nothing;

create temp table antes as select (select count(*) from public.ordens) ordens, (select count(*) from public.estoque_mov) mov,
  (select count(*) from public.contas) contas, (select count(*) from public.recibos) recibos, (select count(*) from public.produtos) produtos;
grant select on antes to authenticated;

-- 1. administrador conecta o fornecedor: a tela não escolhe a situação; endereço tem de ser https; fornecedor não troca
set role authenticated;
do $$ declare c public.compras_fornecedores; begin
  insert into public.compras_fornecedores (id, fornecedor_id, tipo, endereco, usuario, situacao, detalhe)
    values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000f1', 'webservice', ' https://ws.autopecas.test/api ', ' oficina01 ', 'ok', 'inventado')
    returning * into c;
  if c.situacao <> 'aguardando' or c.detalhe <> '' or c.endereco <> 'https://ws.autopecas.test/api' or c.usuario <> 'oficina01' then raise exception 'FALHOU 1: %', to_jsonb(c); end if;
  update public.compras_fornecedores set situacao = 'ok', fornecedor_id = '00000000-0000-0000-0000-0000000000f2' where id = c.id returning * into c;
  if c.situacao <> 'aguardando' or c.fornecedor_id <> '00000000-0000-0000-0000-0000000000f1' then raise exception 'FALHOU 1b: %', to_jsonb(c); end if;
  begin insert into public.compras_fornecedores (fornecedor_id, endereco) values ('00000000-0000-0000-0000-0000000000f2', 'ftp://x'); raise exception 'FALHOU 1c: aceitou endereço sem https';
  exception when check_violation then null; end;
  insert into public.compras_fornecedores (id, fornecedor_id, tipo) values ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000f2', 'portal');
end $$;

-- 2. senha do fornecedor: vai para segredos, nunca volta; ninguém do sistema lê segredos; vazio apaga
do $$ declare r jsonb; n int; begin
  r := public.compras_gravar_acesso('00000000-0000-0000-0000-0000000000c1', 'S3nh@ Secreta');
  if not (r->>'gravado')::boolean or r::text like '%S3nh@%' then raise exception 'FALHOU 2: %', r; end if;
  r := public.compras_acessos();
  if jsonb_array_length(r) <> 1 or r->0->>'id' <> '00000000-0000-0000-0000-0000000000c1' or r::text like '%S3nh@%' then raise exception 'FALHOU 2b: %', r; end if;
  begin select count(*) into n from public.segredos; raise exception 'FALHOU 2c: authenticated leu segredos';
  exception when insufficient_privilege then null; end;
  r := public.compras_gravar_acesso('00000000-0000-0000-0000-0000000000c2', 'outra');
  r := public.compras_gravar_acesso('00000000-0000-0000-0000-0000000000c2', '   ');
  if (r->>'gravado')::boolean then raise exception 'FALHOU 2d: vazio não apagou'; end if;
end $$;
reset role;
do $$ begin
  if (select valor from public.segredos where chave = 'compras_acesso:00000000-0000-0000-0000-0000000000c1') <> 'S3nh@ Secreta' then raise exception 'FALHOU 2e: senha não ficou em segredos'; end if;
  if exists (select 1 from public.segredos where chave = 'compras_acesso:00000000-0000-0000-0000-0000000000c2') then raise exception 'FALHOU 2f: senha apagada ficou'; end if;
end $$;

-- 3. consultor não grava conexão nem senha, mas usa preços, carrinho e pedidos; mecânico não vê nada
select null from set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-777777777777', false);
set role authenticated;
do $$ declare n int; r jsonb; begin
  select count(*) into n from public.compras_fornecedores; if n <> 2 then raise exception 'FALHOU 3: consultor devia ler as conexões (%)', n; end if;
  update public.compras_fornecedores set obs = 'x'; get diagnostics n = row_count; if n <> 0 then raise exception 'FALHOU 3b: consultor alterou conexão'; end if;
  begin r := public.compras_gravar_acesso('00000000-0000-0000-0000-0000000000c1', 'roubada'); raise exception 'FALHOU 3c: consultor gravou senha';
  exception when raise_exception then if sqlerrm like 'FALHOU%' then raise; end if; end;
  begin r := public.compras_acessos(); raise exception 'FALHOU 3d: consultor viu os acessos';
  exception when raise_exception then if sqlerrm like 'FALHOU%' then raise; end if; end;
end $$;

-- 4. preço digitado: sempre "manual" com a data de agora; código normalizado; o mesmo código no mesmo fornecedor atualiza (upsert)
do $$ declare p public.compras_precos; n int; begin
  insert into public.compras_precos (fornecedor_id, codigo, marca, descricao, preco, estoque, prazo, origem, consultado_em)
    values ('00000000-0000-0000-0000-0000000000f1', ' N-1234 ', 'nakata', 'amortecedor dianteiro', 289.90, 4, 'amanhã', 'ao_vivo', '2020-01-01') returning * into p;
  if p.origem <> 'manual' or p.codigo_norm <> 'N1234' or p.consultado_em < now() - interval '1 minute' or p.criado_por_nome <> 'Consultor' or p.marca <> 'NAKATA' then raise exception 'FALHOU 4: %', to_jsonb(p); end if;
  insert into public.compras_precos (fornecedor_id, codigo, marca, preco) values ('00000000-0000-0000-0000-0000000000f1', 'n 1234', 'NAKATA', 279.90)
    on conflict (fornecedor_id, codigo_norm) do update set preco = excluded.preco returning * into p;
  select count(*) into n from public.compras_precos where codigo_norm = 'N1234';
  if n <> 1 or p.preco <> 279.90 then raise exception 'FALHOU 4b: upsert (% linhas, preço %)', n, p.preco; end if;
  insert into public.compras_precos (fornecedor_id, codigo, preco) values ('00000000-0000-0000-0000-0000000000f2', 'N1234', 301.00);
  begin insert into public.compras_precos (fornecedor_id, codigo, preco) values ('00000000-0000-0000-0000-0000000000f2', '--', 10); raise exception 'FALHOU 4c: aceitou código vazio';
  exception when check_violation then null; end;
  begin insert into public.compras_precos (fornecedor_id, codigo, preco) values ('00000000-0000-0000-0000-0000000000f2', 'X1', 0); raise exception 'FALHOU 4d: aceitou preço zero';
  exception when check_violation then null; end;
end $$;

-- 5. carrinho: dois fornecedores; preço trocado à mão vira "manual"
do $$ declare c public.compras_carrinho; begin
  insert into public.compras_carrinho (id, fornecedor_id, codigo, marca, descricao, qtd, preco, origem_preco, preco_em, os_numero, placa)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1', 'N1234', 'nakata', 'amortecedor dianteiro', 2, 279.90, 'manual', now(), 1950, 'onx-2a20') returning * into c;
  if c.descricao <> 'AMORTECEDOR DIANTEIRO' or c.placa <> 'ONX2A20' or c.criado_por_nome <> 'Consultor' then raise exception 'FALHOU 5: %', to_jsonb(c); end if;
  insert into public.compras_carrinho (id, fornecedor_id, codigo, descricao, qtd, preco, origem_preco, preco_em)
    values ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000f1', 'PST11', 'pastilha de freio', 1, 120.00, 'ultima_compra', '2026-10-01'),
           ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000f2', 'KIT9', 'kit embreagem', 1, 650.50, 'ultima_compra', '2026-09-01');
  update public.compras_carrinho set preco = 115.00 where id = '00000000-0000-0000-0000-0000000000a2' returning * into c;
  if c.origem_preco <> 'manual' or c.preco_em < now() - interval '1 minute' then raise exception 'FALHOU 5b: %', to_jsonb(c); end if;
  update public.compras_carrinho set qtd = 1 where id = '00000000-0000-0000-0000-0000000000a3' returning * into c;
  if c.origem_preco <> 'ultima_compra' then raise exception 'FALHOU 5c: mudar a quantidade trocou a origem do preço'; end if;
end $$;

-- 6. a tela não cria pedido direto (só pela função, que soma o total)
do $$ begin
  begin insert into public.compras_pedidos (fornecedor_nome, total) values ('X', 1); raise exception 'FALHOU 6: inseriu pedido direto';
  exception when insufficient_privilege then null; end;
  begin insert into public.compras_pedido_itens (pedido_id, descricao, qtd, preco) values (gen_random_uuid(), 'X', 1, 1); raise exception 'FALHOU 6b: inseriu item direto';
  exception when insufficient_privilege then null; end;
end $$;

-- 7. gerar pedidos: só os escolhidos; depois o resto; um pedido por fornecedor, total do banco, carrinho esvazia; de novo = vazio
do $$ declare r jsonb; p public.compras_pedidos; n int; begin
  r := public.compras_gerar_pedidos(array['00000000-0000-0000-0000-0000000000a3']::uuid[]);
  if jsonb_array_length(r) <> 1 or r->0->>'fornecedor' <> 'DPK DISTRIBUIDORA' or (r->0->>'total')::numeric <> 650.50 then raise exception 'FALHOU 7: %', r; end if;
  select count(*) into n from public.compras_carrinho; if n <> 2 then raise exception 'FALHOU 7b: carrinho (%)', n; end if;
  r := public.compras_gerar_pedidos(null);
  if jsonb_array_length(r) <> 1 or r->0->>'fornecedor' <> 'AutoPeças' or (r->0->>'total')::numeric <> 674.80 or (r->0->>'itens')::int <> 2 then raise exception 'FALHOU 7c: %', r; end if;
  select * into p from public.compras_pedidos where numero = (r->0->>'numero')::int;
  if p.situacao <> 'a_finalizar' or p.criado_por_nome <> 'Consultor' then raise exception 'FALHOU 7d: %', to_jsonb(p); end if;
  select count(*) into n from public.compras_pedido_itens where pedido_id = p.id and os_numero = 1950 and placa = 'ONX2A20' and qtd = 2;
  if n <> 1 then raise exception 'FALHOU 7e: item sem O.S./placa/qtd'; end if;
  select count(*) into n from public.compras_carrinho; if n <> 0 then raise exception 'FALHOU 7f: carrinho não esvaziou'; end if;
  begin r := public.compras_gerar_pedidos(null); raise exception 'FALHOU 7g: gerou com o carrinho vazio';
  exception when raise_exception then if sqlerrm not like '%vazio%' then raise; end if; end;
end $$;

-- 8. a tela não muda número, fornecedor nem total; finalizar grava quem e quando; cancelar pede motivo e não volta
do $$ declare p public.compras_pedidos; begin
  select * into p from public.compras_pedidos where fornecedor_nome = 'AutoPeças';
  update public.compras_pedidos set total = 1, numero = 999, fornecedor_nome = 'Outro', situacao = 'finalizado', documento = ' 45678 ' where id = p.id returning * into p;
  if p.total <> 674.80 or p.numero = 999 or p.fornecedor_nome <> 'AutoPeças' then raise exception 'FALHOU 8: %', to_jsonb(p); end if;
  if p.finalizado_em is null or p.finalizado_por_nome <> 'Consultor' or p.documento <> '45678' then raise exception 'FALHOU 8b: %', to_jsonb(p); end if;
  update public.compras_pedidos set situacao = 'a_finalizar' where id = p.id returning * into p;
  if p.finalizado_em is not null or p.finalizado_por_nome <> '' then raise exception 'FALHOU 8c: desfazer não limpou'; end if;
  begin update public.compras_pedidos set situacao = 'cancelado' where id = p.id; raise exception 'FALHOU 8d: cancelou sem motivo';
  exception when check_violation then null; end;
  update public.compras_pedidos set situacao = 'cancelado', motivo = ' achei mais barato ' where id = p.id returning * into p;
  if p.motivo <> 'achei mais barato' then raise exception 'FALHOU 8e'; end if;
  begin update public.compras_pedidos set situacao = 'a_finalizar' where id = p.id; raise exception 'FALHOU 8f: cancelado voltou';
  exception when raise_exception then if sqlerrm like 'FALHOU%' then raise; end if; end;
end $$;

-- 9. voltar para o carrinho: itens voltam iguais, pedido fica cancelado com o motivo; finalizado/cancelado não volta
do $$ declare p public.compras_pedidos; r jsonb; n int; begin
  select * into p from public.compras_pedidos where fornecedor_nome = 'DPK DISTRIBUIDORA';
  r := public.compras_pedido_voltar(p.id);
  if (r->>'itens')::int <> 1 then raise exception 'FALHOU 9: %', r; end if;
  select * into p from public.compras_pedidos where id = p.id;
  if p.situacao <> 'cancelado' or p.motivo <> 'Voltou para o carrinho' then raise exception 'FALHOU 9b: %', to_jsonb(p); end if;
  select count(*) into n from public.compras_carrinho where codigo = 'KIT9' and preco = 650.50 and origem_preco = 'ultima_compra' and fornecedor_id = '00000000-0000-0000-0000-0000000000f2';
  if n <> 1 then raise exception 'FALHOU 9c: item não voltou igual'; end if;
  begin r := public.compras_pedido_voltar(p.id); raise exception 'FALHOU 9d: cancelado voltou de novo';
  exception when raise_exception then if sqlerrm like 'FALHOU%' then raise; end if; end;
end $$;
reset role;

-- 10. mecânico não vê preços, carrinho nem pedidos e não gera pedido
select null from set_config('request.jwt.claim.sub', '88888888-8888-8888-8888-888888888888', false);
set role authenticated;
do $$ declare n int; r jsonb; begin
  select (select count(*) from public.compras_precos) + (select count(*) from public.compras_carrinho) + (select count(*) from public.compras_pedidos)
       + (select count(*) from public.compras_pedido_itens) + (select count(*) from public.compras_fornecedores) into n;
  if n <> 0 then raise exception 'FALHOU 10: mecânico leu % linha(s)', n; end if;
  begin r := public.compras_gerar_pedidos(null); raise exception 'FALHOU 10b: mecânico gerou pedido';
  exception when raise_exception then if sqlerrm like 'FALHOU%' then raise; end if; end;
  begin insert into public.compras_carrinho (fornecedor_id, descricao, preco) values ('00000000-0000-0000-0000-0000000000f1', 'X', 1); raise exception 'FALHOU 10c: mecânico pôs no carrinho';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select null from set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', false);

-- 11. compras não mexe em O.S., estoque, produtos nem financeiro
do $$ declare x record; begin
  select * into x from antes;
  if (select count(*) from public.ordens) <> x.ordens or (select count(*) from public.estoque_mov) <> x.mov or (select count(*) from public.contas) <> x.contas
     or (select count(*) from public.recibos) <> x.recibos or (select count(*) from public.produtos) <> x.produtos then raise exception 'FALHOU 11: compras mexeu em O.S., estoque ou financeiro'; end if;
end $$;

-- 12. backup: restaura pedido com número e empurra a sequência; exclusão avisa o banco do PC; conexão apagada leva a senha
do $$ declare r jsonb; ped public.compras_pedidos; n int; begin
  -- linhas como vêm no arquivo de backup (todas as colunas): cópia de um pedido existente com outro id e número
  r := public.restaurar_tabela('compras_pedidos', (select jsonb_build_array(to_jsonb(p) || jsonb_build_object('id', '00000000-0000-0000-0000-0000000000b5', 'numero', 500,
        'fornecedor_nome', 'Restaurado')) from public.compras_pedidos p where p.fornecedor_nome = 'AutoPeças'));
  if (r->>'incluidos')::int <> 1 then raise exception 'FALHOU 12: %', r; end if;
  r := public.restaurar_tabela('compras_pedido_itens', (select jsonb_build_array(to_jsonb(i) || jsonb_build_object('id', gen_random_uuid(), 'pedido_id', '00000000-0000-0000-0000-0000000000b5'))
        from public.compras_pedido_itens i limit 1));
  if (r->>'incluidos')::int <> 1 then raise exception 'FALHOU 12b: %', r; end if;
  r := public.restaurar_tabela('compras_fornecedores', '[]'::jsonb);
  r := public.compras_gerar_pedidos(null);
  if (r->0->>'numero')::int <= 500 then raise exception 'FALHOU 12c: número repetiu depois da restauração (%)', r; end if;
  delete from public.compras_pedidos where id = '00000000-0000-0000-0000-0000000000b5';
  select count(*) into n from public.exclusoes where tabela in ('compras_pedidos', 'compras_pedido_itens');
  if n < 2 then raise exception 'FALHOU 12d: exclusão não registrada (%)', n; end if;
  delete from public.compras_fornecedores where id = '00000000-0000-0000-0000-0000000000c1';
  if exists (select 1 from public.segredos where chave like 'compras_acesso:%') then raise exception 'FALHOU 12e: senha ficou depois de apagar a conexão'; end if;
end $$;
select 'v59 OK' as resultado;
