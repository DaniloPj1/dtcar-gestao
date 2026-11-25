-- Cenários do v65 (mensagem interna para GRUPO do WhatsApp). Roda depois de montar_banco.sh (até v64) + v65.
-- O que precisa valer: só grupo escolhido na tela recebe; sem números autorizados não sai nada; a mensagem de grupo
-- é interna (não gasta o limite dos clientes); grupo tirado da tela não é enviado; conversa de grupo não entra nas
-- conversas de cliente; e quem envia recebe a lista de participantes para conferir o grupo na hora.
\set ON_ERROR_STOP on
insert into auth.users (id, email, raw_user_meta_data) values ('99999999-9999-9999-9999-999999999999', 'danilo@oficina.test', '{"nome": "Danilo"}') on conflict do nothing;
insert into public.perfis (id, nome, papel, ativo) values ('99999999-9999-9999-9999-999999999999', 'Danilo', 'admin', true) on conflict (id) do update set papel = 'admin', ativo = true;

-- cenário estável a qualquer hora: horário de envio aberto e silêncio da noite desligado
update public.whatsapp_conexao set situacao = 'conectado', numero = '5527988881111',
       regras = jsonb_build_object('dias', jsonb_build_array(1,2,3,4,5,6,7), 'inicio', '00:00', 'fim', '23:59',
                                   'intervalo_min', 1, 'intervalo_max', 1, 'por_hora', 20, 'por_dia', 80),
       avisos = jsonb_build_object('silencio_inicio', '23:59', 'silencio_fim', '23:59'),
       proximo_envio = null, dono = '', dono_id = '', dono_ate = null, grupos = null
 where id = 1;
delete from public.whatsapp_fila;
delete from public.whatsapp_mensagens;
delete from public.whatsapp_optout;

select null from set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', false);
set role authenticated;

-- 1. sem grupo escolhido na tela: recusa com o caminho do que fazer
do $$ declare r jsonb; begin
  update public.config set dados = dados - 'zapGrupos' where id = 1;
  r := public.whatsapp_enfileirar('{"grupo":"financeiro","texto":"Caixa de hoje: R$ 1.000,00"}'::jsonb, true);
  if (r ->> 'gravado')::boolean or not (r ->> 'erros') like '%não está escolhido em Sistema%' then raise exception 'FALHOU 1: %', r; end if;
  if exists (select 1 from public.whatsapp_fila) then raise exception 'FALHOU 1b: entrou na fila sem grupo escolhido'; end if;
end $$;

-- 2. grupo escolhido mas sem números autorizados: também não sai (a regra é "só eu e o sócio")
do $$ declare r jsonb; begin
  update public.config set dados = jsonb_set(dados, '{zapGrupos}', jsonb_build_object(
    'financeiro', jsonb_build_object('jid', '120363000000000001@g.us', 'nome', 'Financeiro',
                                     'ids', jsonb_build_array('5527988881111@s.whatsapp.net', '5527997696545@s.whatsapp.net')))) where id = 1;
  r := public.whatsapp_enfileirar('{"grupo":"financeiro","texto":"Caixa de hoje"}'::jsonb, true);
  if (r ->> 'gravado')::boolean or not (r ->> 'erros') like '%números autorizados%' then raise exception 'FALHOU 2: %', r; end if;
end $$;

-- 3. grupo escolhido e com autorizados: prévia limpa e a mensagem entra como INTERNA, sem telefone
do $$ declare r jsonb; v public.whatsapp_fila; begin
  update public.config set dados = jsonb_set(dados, '{zapGrupos}', jsonb_build_object(
    'numeros', jsonb_build_array('5527997696545', '5527999674855'),
    'financeiro', jsonb_build_object('jid', '120363000000000001@g.us', 'nome', 'Financeiro',
                                     'ids', jsonb_build_array('5527988881111@s.whatsapp.net', '5527997696545@s.whatsapp.net', '5527999674855@s.whatsapp.net')))) where id = 1;
  r := public.whatsapp_enfileirar('{"grupo":"financeiro","texto":"Caixa de hoje: R$ 1.000,00"}'::jsonb, false);
  if (r ->> 'gravado')::boolean or jsonb_array_length(r -> 'erros') <> 0 then raise exception 'FALHOU 3: prévia com erro: %', r; end if;
  if (r -> 'grupo' ->> 'nome') <> 'Financeiro' or (r ->> 'interno')::boolean is not true then raise exception 'FALHOU 3b: %', r; end if;
  r := public.whatsapp_enfileirar('{"grupo":"financeiro","texto":"Caixa de hoje: R$ 1.000,00","pedido":"teste"}'::jsonb, true);
  if not (r ->> 'gravado')::boolean then raise exception 'FALHOU 3c: não gravou: %', r; end if;
  select * into v from public.whatsapp_fila where id = (r ->> 'id')::bigint;
  if v.grupo_jid <> '120363000000000001@g.us' or v.telefone <> '' or not v.interno then raise exception 'FALHOU 3d: %', to_jsonb(v); end if;
end $$;

-- 4. mesma mensagem para o mesmo grupo em 10 minutos não repete; telefone junto do grupo é recusado;
--    modelo e PDF são de cliente, não de grupo
do $$ declare r jsonb; begin
  r := public.whatsapp_enfileirar('{"grupo":"financeiro","texto":"Caixa de hoje: R$ 1.000,00"}'::jsonb, true);
  if (r ->> 'gravado')::boolean or not (r ->> 'erros') like '%já está na fila%' then raise exception 'FALHOU 4: %', r; end if;
  r := public.whatsapp_enfileirar('{"grupo":"financeiro","telefone":"27999112233","texto":"oi"}'::jsonb, false);
  if not (r ->> 'erros') like '%não para os dois%' then raise exception 'FALHOU 4b: %', r; end if;
  r := public.whatsapp_enfileirar('{"grupo":"financeiro","modelo":"cobranca","texto":"oi"}'::jsonb, false);
  if not (r ->> 'erros') like '%é para cliente%' then raise exception 'FALHOU 4c: %', r; end if;
end $$;

-- 5. a mensagem de grupo não gasta o limite do dia dos clientes (é interna)
do $$ declare n int; begin
  select count(*) into n from public.whatsapp_fila where not interno;
  if n <> 0 then raise exception 'FALHOU 5: mensagem de grupo contada como de cliente (%)', n; end if;
end $$;

-- 6. quem envia recebe o grupo com os participantes conferidos e os números autorizados
reset role;
update public.whatsapp_conexao set dono = 'supabase', dono_id = 'teste', dono_ate = now() + interval '2 minutes', proximo_envio = null where id = 1;
do $$ declare p jsonb; g jsonb; begin
  p := public.whatsapp_pegar_proxima('supabase', 'teste', true);
  g := p -> 'mensagem' -> 'grupo';
  if g is null or (g ->> 'jid') <> '120363000000000001@g.us' then raise exception 'FALHOU 6: %', p; end if;
  if jsonb_array_length(g -> 'ids') <> 3 or jsonb_array_length(g -> 'numeros') <> 2 then raise exception 'FALHOU 6b: %', g; end if;
  -- enviada: a conversa do grupo NÃO entra nas conversas de cliente
  perform public.whatsapp_resultado('supabase', 'teste', (p -> 'mensagem' ->> 'id')::bigint, true, 'MSG-G1', '120363000000000001@g.us', null);
  if exists (select 1 from public.whatsapp_mensagens) then raise exception 'FALHOU 6c: grupo entrou nas conversas de cliente'; end if;
  if (select status from public.whatsapp_fila where id = (p -> 'mensagem' ->> 'id')::bigint) <> 'enviada' then raise exception 'FALHOU 6d: a fila não marcou enviada'; end if;
end $$;
set role authenticated;

-- 7. grupo tirado da tela: a mensagem que estava na fila NÃO é enviada e o motivo fica escrito
do $$ declare r jsonb; begin
  r := public.whatsapp_enfileirar('{"grupo":"financeiro","texto":"Fechamento do mês"}'::jsonb, true);
  if not (r ->> 'gravado')::boolean then raise exception 'FALHOU 7-pre: %', r; end if;
end $$;
reset role;
update public.config set dados = jsonb_set(dados, '{zapGrupos}', jsonb_build_object('numeros', jsonb_build_array('5527997696545'))) where id = 1;
update public.whatsapp_conexao set proximo_envio = null, dono_ate = now() + interval '2 minutes' where id = 1;
do $$ declare p jsonb; v public.whatsapp_fila; begin
  p := public.whatsapp_pegar_proxima('supabase', 'teste', true);
  if (p ->> 'motivo') <> 'grupo sem autorização' then raise exception 'FALHOU 7: %', p; end if;
  select * into v from public.whatsapp_fila where texto = 'Fechamento do mês';
  if v.status <> 'erro' or v.erro not like '%não está mais escolhido%' then raise exception 'FALHOU 7b: %', to_jsonb(v); end if;
end $$;
set role authenticated;

-- 8. PARAR de um número não cancela mensagem de grupo (grupo não tem telefone)
reset role;
update public.config set dados = jsonb_set(dados, '{zapGrupos}', jsonb_build_object(
  'numeros', jsonb_build_array('5527997696545'),
  'financeiro', jsonb_build_object('jid', '120363000000000001@g.us', 'nome', 'Financeiro',
                                   'ids', jsonb_build_array('5527988881111@s.whatsapp.net', '5527997696545@s.whatsapp.net')))) where id = 1;
insert into public.whatsapp_optout (telefone) values (public.whatsapp_chave_tel('')) on conflict do nothing;
set role authenticated;
do $$ declare r jsonb; begin
  r := public.whatsapp_enfileirar('{"grupo":"financeiro","texto":"Contas a vencer esta semana"}'::jsonb, true);
  if not (r ->> 'gravado')::boolean then raise exception 'FALHOU 8: %', r; end if;
end $$;
reset role;
update public.whatsapp_conexao set proximo_envio = null, dono_ate = now() + interval '2 minutes' where id = 1;
do $$ declare p jsonb; begin
  p := public.whatsapp_pegar_proxima('supabase', 'teste', true);
  if p -> 'mensagem' is null then raise exception 'FALHOU 8b: o PARAR de um número cancelou a mensagem do grupo: %', p; end if;
end $$;
set role authenticated;

-- 9. a lista de grupos levantada fica guardada para a tela, e o pedido se encerra ao gravar
do $$ declare r jsonb; begin
  r := public.whatsapp_pedir_grupos();
  if (r ->> 'pedido') <> 'grupos' then raise exception 'FALHOU 9: %', r; end if;
end $$;
-- quem grava a lista é a função zap/o motor (chave de serviço), não a tela
reset role;
do $$ declare v public.whatsapp_conexao; begin
  perform public.whatsapp_grupos_gravar(jsonb_build_array(
    jsonb_build_object('jid', '120363000000000001@g.us', 'nome', 'Financeiro', 'participantes', 2, 'autorizado', true, 'motivo', ''),
    jsonb_build_object('jid', '120363000000000002@g.us', 'nome', 'Clientes', 'participantes', 9, 'autorizado', false, 'motivo', 'participante não autorizado: 5527991234567')));
  select * into v from public.whatsapp_conexao where id = 1;
  if jsonb_array_length(v.grupos -> 'lista') <> 2 or v.pedido is not null then raise exception 'FALHOU 9b: %', to_jsonb(v.grupos); end if;
end $$;

select 'v65 OK: grupo autorizado recebe, grupo sem autorização não sai, e a conversa de grupo fica fora das conversas de cliente' as resultado;
