-- Cenários do supabase/v29.sql (teste/teste_v29.sh). Cada falha para o teste com uma mensagem.
\set ON_ERROR_STOP 1
create or replace function pg_temp.confere(cond boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'FALHOU: %', msg; end if; raise notice 'ok: %', msg; end $$;

-- 1. regras de partida (uma vez só, mesmo rodando o SQL duas vezes)
select pg_temp.confere((select count(*) from email_regras where origem = 'padrao') = 11, 'regras de partida: 11, sem repetir');
select pg_temp.confere((select count(*) from email_regras where tipo = 'fraude') = 7, '7 golpes conhecidos do DDA');

-- 2. só o administrador
set dtcar.uid = '00000000-0000-0000-0000-00000000000b';
do $$ begin perform public.email_resumo(); raise exception 'consultor leu o resumo'; exception when raise_exception then
  if sqlerrm not like 'Só o administrador%' then raise; end if; end $$;
do $$ begin perform public.email_contatos(); raise exception 'consultor leu os contatos'; exception when raise_exception then
  if sqlerrm not like 'Só o administrador%' then raise; end if; end $$;
do $$ begin perform public.email_regra_salvar('ignorar', 'dominio', 'x.com.br'); raise exception 'consultor criou regra'; exception when raise_exception then
  if sqlerrm not like 'Só o administrador%' then raise; end if; end $$;
select pg_temp.confere(true, 'consultor não lê nem grava');

set dtcar.uid = '00000000-0000-0000-0000-00000000000a';
-- 3. resumo
select pg_temp.confere((public.email_resumo()->>'situacao') = 'desligado' and (public.email_resumo()->>'ligado')::boolean
  and (public.email_resumo()->>'regras')::int = 11, 'resumo: desligado, ligado, 11 regras');

-- 4. contatos: vários endereços por campo, minúsculo, sem inativo/inválido, sem repetir (fornecedor ganha do cliente)
select pg_temp.confere(jsonb_array_length(public.email_contatos()) = 6, 'contatos: 6 (2 DPK, retífica, Danilo, consultor ativo, Marbrasa)');
select pg_temp.confere(exists (select 1 from jsonb_array_elements(public.email_contatos()) x where x->>'email' = 'cobranca@dpk.com.br' and x->>'tipo' = 'fornecedor' and x->>'nome' = 'DPK'),
  'DPK com nome fantasia e e-mail em minúsculo');
select pg_temp.confere(exists (select 1 from jsonb_array_elements(public.email_contatos()) x where x->>'email' = 'nfe@dpk.com.br' and x->>'tipo' = 'fornecedor'),
  'mesmo e-mail em fornecedor e cliente: fica fornecedor');
select pg_temp.confere(exists (select 1 from jsonb_array_elements(public.email_contatos()) x where x->>'email' = 'retifica@x.com.br' and x->>'tipo' = 'prestador'), 'prestador');
select pg_temp.confere(not exists (select 1 from jsonb_array_elements(public.email_contatos()) x where x->>'email' in ('inativo@y.com.br', 'saiu@exemplo.com', 'nao-e-email')),
  'sem fornecedor inativo, sem quem saiu da equipe, sem endereço inválido');

-- 5. regras: normaliza, valida, troca o tipo sem duplicar, registra no histórico
select pg_temp.confere((public.email_regra_salvar('importante', 'remetente', '  Financeiro <Boleto@Fornecedor.com.br> ', 'boletos', 'danilo')->>'valor') = 'boleto@fornecedor.com.br',
  'remetente com nome vira só o e-mail, minúsculo');
select pg_temp.confere((public.email_regra_salvar('ignorar', 'dominio', 'ofertas@WWW.Loja.com.br')->>'valor') = 'loja.com.br', 'domínio tirado do e-mail');
select pg_temp.confere((public.email_regra_salvar('importante', 'dominio', 'loja.com.br')->>'tipo') = 'importante', 'mesma regra muda de tipo');
select pg_temp.confere((select count(*) from email_regras where alvo = 'dominio' and valor = 'loja.com.br') = 1, 'sem regra repetida');
do $$ begin perform public.email_regra_salvar('importante', 'remetente', 'sem-arroba'); raise exception 'aceitou remetente inválido'; exception when raise_exception then
  if sqlerrm not like 'Remetente precisa%' then raise; end if; end $$;
do $$ begin perform public.email_regra_salvar('apagar', 'nome', 'x y'); raise exception 'aceitou tipo inválido'; exception when raise_exception then
  if sqlerrm not like 'Tipo de regra%' then raise; end if; end $$;
do $$ begin perform public.email_regra_salvar('ignorar', 'dominio', 'semponto'); raise exception 'aceitou domínio inválido'; exception when raise_exception then
  if sqlerrm not like 'Domínio inválido%' then raise; end if; end $$;
select pg_temp.confere(true, 'regras inválidas recusadas');
select pg_temp.confere((select count(*) from agente_acoes where ferramenta = 'email_regra') = 3, 'cada regra gravada vai para o histórico do agente');

-- 6. remover = desativar (ninguém apaga) e reativar ao salvar de novo
select public.email_regra_remover((select id from email_regras where valor = 'loja.com.br'));
select pg_temp.confere(not (select ativo from email_regras where valor = 'loja.com.br'), 'regra desativada, não apagada');
select public.email_regra_salvar('ignorar', 'dominio', 'loja.com.br');
select pg_temp.confere((select ativo and tipo = 'ignorar' from email_regras where valor = 'loja.com.br'), 'regra volta ativa ao salvar');

-- 7. envio no histórico
select public.email_registrar_envio('{"tipo":"responder","para":"cobranca@dpk.com.br","assunto":"Re: Boleto","texto":"Recebido, obrigado.","resposta_a":"Boleto NF 1234","pedido":"responde a DPK"}');
select pg_temp.confere((select count(*) from email_envios where tipo = 'responder' and por = 'Danilo') = 1, 'envio registrado com quem confirmou');
select pg_temp.confere((select count(*) from agente_acoes where ferramenta = 'email_responder') = 1, 'envio no histórico do agente');
select pg_temp.confere((public.email_resumo()->>'enviados_hoje')::int = 1 and (public.email_resumo()->>'ultimo_uso') is not null, 'resumo conta o envio de hoje');

-- 8. chave liga/desliga
select pg_temp.confere(not (public.email_ligar(false)->>'ligado')::boolean, 'desligou');
select pg_temp.confere((public.email_ligar(true)->>'ligado')::boolean, 'ligou');

-- 9. acesso direto: a tabela do token não abre para ninguém do sistema; o site só lê (não grava) as outras
select pg_temp.confere(not has_table_privilege('authenticated', 'public.email_token', 'select'), 'token fechado para o site');
select pg_temp.confere(not has_table_privilege('agente_leitura', 'public.email_token', 'select') and not has_table_privilege('agente_leitura', 'public.email_regras', 'select'),
  'agente_leitura não lê o e-mail');
select pg_temp.confere(has_table_privilege('authenticated', 'public.email_regras', 'select') and not has_table_privilege('authenticated', 'public.email_regras', 'insert')
  and not has_table_privilege('authenticated', 'public.email_conexao', 'update'), 'site só lê regras e situação');
select pg_temp.confere(not has_function_privilege('anon', 'public.email_contatos()', 'execute'), 'anônimo não chama as funções');
