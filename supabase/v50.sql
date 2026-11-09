-- =====================================================================
-- DTCar Gestão — v50 (09/11/2026): o conector do Claude alcança o sistema inteiro,
-- desconto no fim da O.S. e técnico responsável pela lista de Funcionários.
--
-- Pedidos do Danilo (09/11/2026):
--   * "De acesso a tudo exceto o ObjetivaWeb", numa atualização só, revisada.
--     Ficam de fora (regras fixas do projeto): certificado, Importar OS Oficina, restaurar backup,
--     pagar/transferir/aceitar no banco, chave do motor do WhatsApp, parear/desconectar o WhatsApp e
--     conectar o e-mail da Microsoft (pedem o celular ou o login dele).
--   * Desconto manual no fim da O.S.: editável no total da O.S. até receber (não só no orçamento) e
--     também no quadro de receber; se houver parcelas a receber, a última é reduzida (sobra cancelada).
--   * Técnico responsável escolhido entre os funcionários ativos (com ou sem acesso ao sistema).
--
-- O que este arquivo cria:
--   1. ordens.tecnico_id (funcionário escolhido) e tecnicos_lista() (lista da O.S. para toda a equipe,
--      só nome; salário e documentos continuam só para o administrador).
--   2. os_aplicar_desconto(): o desconto da O.S. numa transação (tela e conector), com as parcelas.
--   3. Ações novas do conector pelo agente_fazer (prévia = faz e desfaz; tudo em agente_acoes):
--      desconto_os, fornecedor, venda_balcao, recibo_avulso, funcionario, nota_sefaz, boleto_pago,
--      boleto_situacao, pedido_compra, parcela, despesa_fixa, ajustes, equipe, site, rh_documento.
--      alterar_os passa a aceitar dados.tecnico (nome do funcionário) e dados.desconto (pelo item 2).
--   5. whatsapp_mensagens_de() mostra o foto_id das mensagens com foto (anexar_na_os do conector).
-- Rode depois do v49. Pode rodar mais de uma vez.
-- Período de transição: o espelho está desligado desde a virada (02/11/2026). ordens.tecnico_id vai junto
-- com a O.S. (se o espelho fosse religado, a carga recriaria as O.S. sem técnico do cadastro, como hoje).
-- Nenhuma tabela nova: backup, banco do PC e cópia de leitura não mudam (a coluna nova entra sozinha).
-- =====================================================================

-- =====================================================================
-- 1. Técnico responsável
-- =====================================================================
alter table public.ordens add column if not exists tecnico_id uuid;
comment on column public.ordens.tecnico_id is
  'v50: funcionário (funcionarios.id) escolhido como técnico responsável. Sem chave estrangeira: o backup restaura as tabelas em qualquer ordem. mecanico_nome continua com o nome (impressão e relatórios).';

-- quem aparece na lista "Técnico responsável" da O.S.: os funcionários ativos (com ou sem acesso ao sistema)
-- e quem tem acesso (administrador, consultor, mecânico) sem ficha de funcionário ligada
create or replace function public.tecnicos_lista()
returns table (tipo text, id uuid, nome text, apelido text, perfil_id uuid, funcao text)
language sql stable security definer set search_path = public as $$
  with hoje as (select (now() at time zone 'America/Sao_Paulo')::date d),
  ativos as (select f.* from public.funcionarios f, hoje where f.ativo and (f.demissao is null or f.demissao >= hoje.d))
  select x.tipo, x.id, x.nome, x.apelido, x.perfil_id, x.funcao from (
    select 'funcionario'::text tipo, a.id, a.nome, coalesce(a.apelido, '') apelido, a.perfil_id, coalesce(a.funcao, '') funcao from ativos a
    union all
    select 'acesso', p.id, p.nome, '', p.id, p.papel from public.perfis p
    where p.ativo and p.papel in ('admin', 'consultor', 'mecanico') and not exists (select 1 from ativos a where a.perfil_id = p.id)
  ) x where public.e_membro()
  order by lower(x.nome)
$$;

-- nome do técnico → os três campos da O.S. (tecnico_id, mecanico_id, mecanico_nome); "" ou "nenhum" limpa
create or replace function public.agente_tecnico(p_nome text) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare v_txt text := lower(public.unaccent_simples(trim(coalesce(p_nome, '')))); v_n int; t record; v_lista text;
begin
  if v_txt in ('', 'nenhum', 'ninguem', 'sem tecnico') then return jsonb_build_object('tecnico_id', null, 'mecanico_id', null, 'mecanico_nome', ''); end if;
  -- igual (nome ou apelido); senão, parte do nome — só se for um só
  select count(*) into v_n from public.tecnicos_lista() l
    where lower(public.unaccent_simples(l.nome)) = v_txt or (l.apelido <> '' and lower(public.unaccent_simples(l.apelido)) = v_txt);
  if v_n = 0 then
    select count(*) into v_n from public.tecnicos_lista() l where lower(public.unaccent_simples(l.nome || ' ' || l.apelido)) like '%' || v_txt || '%';
    select * into t from public.tecnicos_lista() l where lower(public.unaccent_simples(l.nome || ' ' || l.apelido)) like '%' || v_txt || '%' limit 1;
  else
    select * into t from public.tecnicos_lista() l
      where lower(public.unaccent_simples(l.nome)) = v_txt or (l.apelido <> '' and lower(public.unaccent_simples(l.apelido)) = v_txt) limit 1;
  end if;
  select string_agg(l.nome, ', ') into v_lista from public.tecnicos_lista() l;
  if v_n = 0 then raise exception 'Técnico "%" não está na lista. Técnicos: %.', p_nome, coalesce(v_lista, 'nenhum (cadastre em Funcionários)'); end if;
  if v_n > 1 then raise exception 'Mais de um técnico com "%": diga o nome completo. Técnicos: %.', p_nome, v_lista; end if;
  return jsonb_build_object('tecnico_id', case when t.tipo = 'funcionario' then t.id end, 'mecanico_id', t.perfil_id, 'mecanico_nome', t.nome);
end $$;

-- =====================================================================
-- 2. Desconto da O.S. (tela: quadro "Desconto" e quadro de receber; conector: desconto_os)
-- =====================================================================
-- valor dos itens que entram no total, como a tela (totais em js/util.js): aprovada → só os aprovados;
-- orçamento → todos menos os recusados
create or replace function public.os_valor_itens(p_ordem uuid) returns numeric
language sql stable security invoker set search_path = public as $$
  select coalesce(sum(round(coalesce(i.qtd, 0) * coalesce(i.valor_unit, 0) - coalesce(i.desconto, 0), 2)), 0)
  from public.os_itens i join public.ordens o on o.id = i.ordem_id
  where o.id = p_ordem
    and case when o.status in ('execucao', 'pronto', 'entregue', 'recusado') then i.aprovado is true else i.aprovado is distinct from false end
$$;

-- Aplica o desconto (em reais) no total da O.S., numa transação:
--   * O.S. cancelada, recusada ou fechada não muda (fechada: reabra antes);
--   * o desconto não passa do valor dos itens e o total não fica menor que o já recebido;
--   * parcelas a receber em aberto que passarem do saldo novo: a mais nova é reduzida (zerada = cancelada);
--     parcela com boleto Sicredi registrado não muda (o cliente pagaria o valor antigo): peça a baixa antes;
--   * O.S. entregue que fica quitada fecha sozinha (gatilho do v12/v17);
--   * grava pela sincronizar_alteracao_os (v15) e registra no histórico da O.S.
-- p_gravar = false: só mostra o que aconteceria (nada fica gravado).
create or replace function public.os_aplicar_desconto(p_ordem uuid, p_desconto numeric, p_motivo text default '', p_gravar boolean default true)
returns jsonb language plpgsql volatile security invoker set search_path = public as $$
declare
  o public.ordens; v_desc numeric := round(coalesce(p_desconto, -1), 2); v_bruto numeric; v_total numeric; v_total_antes numeric; v_rec numeric;
  v_saldo numeric; v_abertas numeric; v_excesso numeric; v_corte numeric; pa public.receber; v_ajustes jsonb := '[]'; avisos text[] := '{}';
  v_quem text; v_res jsonb; v_fechou boolean := false; v_motivo text := trim(coalesce(p_motivo, '')); v_mudou boolean;
begin
  if not public.e_gestor() then raise exception 'Só o administrador ou o consultor dá desconto na O.S.'; end if;
  if v_desc < 0 then raise exception 'Informe o desconto em reais (zero ou mais).'; end if;
  select * into o from public.ordens where id = p_ordem for update;
  if o.id is null then raise exception 'O.S. não encontrada.'; end if;
  v_mudou := abs(v_desc - coalesce(o.desconto, 0)) > 0.005;
  if v_mudou then  -- o mesmo desconto não muda nada: nem as travas abaixo valem (O.S. fechada pelo pagamento, por exemplo)
    if o.status in ('cancelado', 'recusado') then raise exception 'A O.S. % está "%": não recebe desconto.', o.numero, public.agente_etapa(o); end if;
    if o.status = 'entregue' and o.finalizada_em is not null then raise exception 'A O.S. % está fechada (quitada). Reabra antes de mudar o desconto.', o.numero; end if;
  end if;
  v_bruto := public.os_valor_itens(o.id);
  if v_mudou and v_desc > v_bruto + 0.005 then raise exception 'O desconto (%) não pode passar do valor dos itens (%).', public.agente_reais(v_desc), public.agente_reais(v_bruto); end if;
  v_total_antes := round(greatest(0, v_bruto - coalesce(o.desconto, 0)), 2);
  v_total := round(greatest(0, v_bruto - v_desc), 2);
  select coalesce(sum(valor), 0) into v_rec from public.recibos where ordem_id = o.id and not cancelado;
  if v_mudou and v_total < v_rec - 0.009 then
    raise exception 'Com esse desconto o total (%) fica menor que o já recebido (%). O desconto máximo agora é %.',
      public.agente_reais(v_total), public.agente_reais(v_rec), public.agente_reais(greatest(0, v_bruto - v_rec));
  end if;
  select coalesce(nullif(nome, ''), 'administrador') into v_quem from public.perfis where id = auth.uid();
  v_quem := coalesce(v_quem, 'administrador');
  v_saldo := round(v_total - v_rec, 2);
  select coalesce(sum(valor), 0) into v_abertas from public.receber where ordem_id = o.id and status = 'aberta';
  v_excesso := round(v_abertas - v_saldo, 2);
  if not v_mudou then
    avisos := array_append(avisos, 'O desconto já é ' || public.agente_reais(v_desc) || ': nada mudou.');
    if v_desc > v_bruto + 0.005 or v_total < v_rec - 0.009 then
      avisos := array_append(avisos, 'Atenção: o desconto passa do valor dos itens ou o total ficou menor que o já recebido: confira os itens e os recibos.');
    end if;
    if v_excesso > 0.009 then
      avisos := array_append(avisos, 'As parcelas a receber passam do saldo em ' || public.agente_reais(v_excesso) || ': confira em Contas a receber.');
    end if;
  end if;

  begin
    -- parcelas que passam do saldo novo: da mais nova para a mais antiga (só quando o desconto muda; sempre com histórico na O.S.)
    if v_mudou and v_excesso > 0.009 then
      for pa in select * from public.receber where ordem_id = o.id and status = 'aberta' order by vencimento desc, parcela desc, id desc for update loop
        exit when v_excesso <= 0.009;
        if exists (select 1 from public.boletos b where b.receber_id = pa.id and b.situacao in ('gerado', 'enviado', 'registrado', 'baixa_pedida')) then
          raise exception 'A parcela %/% (% para %) tem boleto Sicredi no banco: peça a baixa do boleto antes de mudar o valor (o cliente pagaria o valor antigo).',
            pa.parcela, pa.parcelas, public.agente_reais(pa.valor), to_char(pa.vencimento, 'DD/MM/YYYY');
        end if;
        if pa.forma ~* 'boleto' then
          avisos := array_append(avisos, 'A parcela ' || pa.parcela || '/' || pa.parcelas || ' é de boleto emitido fora do sistema (PicPay?): ajuste ou cancele esse boleto lá.');
        end if;
        v_corte := least(v_excesso, pa.valor);
        if pa.valor - v_corte <= 0.009 then
          update public.receber set status = 'cancelada', obs = trim(coalesce(obs, '') || ' Cancelada pelo desconto na O.S. (' || v_quem || ').') where id = pa.id;
        else
          update public.receber set valor = round(pa.valor - v_corte, 2),
            obs = trim(coalesce(obs, '') || ' Reduzida em ' || public.agente_reais(v_corte) || ' pelo desconto na O.S. (' || v_quem || ').') where id = pa.id;
        end if;
        v_ajustes := v_ajustes || jsonb_build_array(jsonb_build_object('parcela', pa.parcela || '/' || pa.parcelas, 'vencimento', pa.vencimento,
          'valor_antes', pa.valor, 'valor', round(pa.valor - v_corte, 2), 'cancelada', pa.valor - v_corte <= 0.009));
        v_excesso := round(v_excesso - v_corte, 2);
      end loop;
    end if;
    if v_mudou then
      perform public.agente_patch_os(o.id, jsonb_build_object('desconto', v_desc, 'total', v_total));
      insert into public.eventos (ordem_id, tipo, texto, usuario_nome)
      values (o.id, 'desconto', 'Desconto da O.S. de ' || public.agente_reais(coalesce(o.desconto, 0)) || ' para ' || public.agente_reais(v_desc)
        || ' (total ' || public.agente_reais(v_total) || ')' || case when v_motivo <> '' then '. Motivo: ' || v_motivo else '' end
        || case when jsonb_array_length(v_ajustes) > 0 then '. Parcelas ajustadas: ' || jsonb_array_length(v_ajustes) else '' end || '.', v_quem);
    end if;
    select finalizada_em is not null and o.finalizada_em is null into v_fechou from public.ordens where id = o.id;
    if v_fechou then avisos := array_append(avisos, 'Com o desconto a O.S. ficou quitada e foi fechada.'); end if;
    -- entregue: parte do saldo sem parcela (o desconto diminuiu, o total subiu)
    select coalesce(sum(valor), 0) into v_abertas from public.receber where ordem_id = o.id and status = 'aberta';
    if o.status = 'entregue' and not v_fechou and v_saldo - v_abertas > 0.009 and v_abertas > 0 then
      avisos := array_append(avisos, public.agente_reais(v_saldo - v_abertas) || ' do saldo ainda não têm prazo: combine o prazo na O.S. (ou pelo conector, parcela acao=combinar_prazo).');
    end if;
    v_res := jsonb_build_object('os', o.numero, 'id', o.id, 'valor_itens', v_bruto, 'desconto_antes', coalesce(o.desconto, 0), 'desconto', v_desc, 'mudou', v_mudou,
      'total_antes', v_total_antes, 'total', v_total, 'recebido', v_rec, 'saldo', v_saldo, 'parcelas_ajustadas', v_ajustes, 'fechou', v_fechou,
      'avisos', to_jsonb(avisos));
    if not coalesce(p_gravar, true) then raise exception using errcode = 'DT001', message = 'previa'; end if;
  exception when sqlstate 'DT001' then
    return v_res || jsonb_build_object('gravado', false, 'previa', true);
  end;
  return v_res || jsonb_build_object('gravado', true);
end $$;

-- =====================================================================
-- 3. Ações novas do conector (pelo agente_fazer: prévia = faz e desfaz). Todas exigem administrador
--    e ficam em agente_acoes (antes e depois).
-- =====================================================================

-- ---------- utilidades ----------
-- A prévia (confirmar=false) faz e desfaz a ação, mas a sequência dos números (recibo, venda) não volta atrás: na prévia, quem gera
-- recibo ou venda NÃO grava — confere tudo e devolve a conta, sem número (o número sai só na gravação, sem pular nenhum).
-- O agente_fazer marca a transação com dtcar.agente_previa = sim/nao.
create or replace function public.agente_em_previa() returns boolean language sql stable set search_path = public as $$
  select coalesce(current_setting('dtcar.agente_previa', true), '') = 'sim' $$;

-- CPF/CNPJ com dígitos verificadores (o mesmo de docValido em js/util.js)
create or replace function public.agente_doc_valido(p text) returns boolean language plpgsql immutable as $$
declare c text := regexp_replace(coalesce(p, ''), '\D', '', 'g'); s int; d int; i int; pesos int[];
begin
  if length(c) not in (11, 14) or c ~ '^(\d)\1+$' then return false; end if;
  if length(c) = 11 then
    s := 0; for i in 1..9 loop s := s + substr(c, i, 1)::int * (11 - i); end loop;
    d := (s * 10) % 11; if d = 10 then d := 0; end if; if d <> substr(c, 10, 1)::int then return false; end if;
    s := 0; for i in 1..10 loop s := s + substr(c, i, 1)::int * (12 - i); end loop;
    d := (s * 10) % 11; if d = 10 then d := 0; end if; return d = substr(c, 11, 1)::int;
  end if;
  pesos := array[5,4,3,2,9,8,7,6,5,4,3,2];
  s := 0; for i in 1..12 loop s := s + substr(c, i, 1)::int * pesos[i]; end loop;
  d := case when s % 11 < 2 then 0 else 11 - s % 11 end; if d <> substr(c, 13, 1)::int then return false; end if;
  pesos := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
  s := 0; for i in 1..13 loop s := s + substr(c, i, 1)::int * pesos[i]; end loop;
  d := case when s % 11 < 2 then 0 else 11 - s % 11 end; return d = substr(c, 14, 1)::int;
end $$;

-- forma de pagamento da lista de Ajustes (sem diferença de maiúscula/acento); erro com a lista
create or replace function public.agente_forma_valida(p_forma text) returns text language plpgsql stable security invoker set search_path = public as $$
declare v text; formas text[] := coalesce((select array_agg(x) from public.config, jsonb_array_elements_text(dados->'formasPagamento') x where id = 1),
  array['PIX', 'Dinheiro', 'Cartão de débito', 'Cartão de crédito', 'Boleto']);
begin
  select f into v from unnest(formas) f where lower(public.unaccent_simples(f)) = lower(public.unaccent_simples(trim(coalesce(p_forma, '')))) limit 1;
  if v is null then raise exception 'Forma de pagamento "%" não existe. Use uma destas: %.', coalesce(p_forma, ''), array_to_string(formas, ', '); end if;
  return v;
end $$;

-- conta de entrada sugerida pela forma (contaSugerida em js/regras.js): dinheiro → espécie/caixa; o resto → conta padrão de recebimento
create or replace function public.agente_conta_sugerida(p_forma text) returns text language plpgsql stable security invoker set search_path = public as $$
declare cfg jsonb; contas text[] := public.agente_contas_nomes(); v text;
begin
  select dados into cfg from public.config where id = 1;
  if coalesce(p_forma, '') ~* 'dinheiro' then select c into v from unnest(contas) c where c ~* '(esp[eé]cie|caixa|dinheiro)' limit 1; end if;
  if v is null then
    v := case when coalesce(cfg->>'contaRecebimento', '') = any (contas) then cfg->>'contaRecebimento'
              else coalesce((select c from unnest(contas) c where c !~* '(esp[eé]cie|caixa|dinheiro)' limit 1), contas[1]) end;
  end if;
  return v;
end $$;

-- data AAAA-MM-DD (vazio = hoje); nunca no futuro quando p_futuro = false
create or replace function public.agente_data(p_txt text, p_futuro boolean default false) returns date language plpgsql stable as $$
declare v date;
begin
  if coalesce(trim(p_txt), '') = '' then return public.agente_hoje(); end if;
  if trim(p_txt) !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Data "%" fora do formato AAAA-MM-DD.', p_txt; end if;
  v := trim(p_txt)::date;
  if not p_futuro and v > public.agente_hoje() then raise exception 'A data (%) não pode ser no futuro.', to_char(v, 'DD/MM/YYYY'); end if;
  return v;
end $$;

-- ---------- desconto da O.S. ----------
-- p: numero; desconto (R$) ou desconto_pct (% do valor dos itens); motivo
create or replace function public.agente_desconto_os(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare o public.ordens; v_desc numeric; r jsonb;
begin
  perform public.agente_exige_admin();
  if coalesce(p->>'numero', '') !~ '^\s*[0-9]+\s*$' then raise exception 'Informe o número da O.S.'; end if;
  select * into o from public.ordens where numero = (p->>'numero')::int order by criado_em desc limit 1;
  if o.id is null then raise exception 'O.S. % não encontrada.', p->>'numero'; end if;
  if jsonb_typeof(p->'desconto_pct') = 'number' then
    if (p->>'desconto_pct')::numeric < 0 or (p->>'desconto_pct')::numeric > 100 then raise exception 'O desconto em % vai de 0 a 100.', '%'; end if;
    v_desc := round(public.os_valor_itens(o.id) * (p->>'desconto_pct')::numeric / 100, 2);
  elsif jsonb_typeof(p->'desconto') = 'number' then v_desc := (p->>'desconto')::numeric;
  else raise exception 'Informe desconto (em reais) ou desconto_pct (em %%).'; end if;
  r := public.os_aplicar_desconto(o.id, v_desc, trim(coalesce(p->>'motivo', '') || ' (agente, Claude)'), true) - 'gravado';
  perform public.agente_registrar('desconto_os', p, 'ordens', o.id::text, jsonb_build_object('desconto', o.desconto, 'total', o.total), r);
  return r;
end $$;

-- alterar_os (v40) com técnico pelo nome (dados.tecnico/mecanico) e desconto pelo os_aplicar_desconto (dados.desconto)
create or replace function public.agente_alterar_os_v50(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare v_dados jsonb := coalesce(p->'dados', '{}'); v_desc jsonb; v_acao text := lower(coalesce(trim(p->>'acao'), '')); r jsonb; rd jsonb; o public.ordens;
  v_resto boolean; v_antes boolean; v_itens boolean;
begin
  perform public.agente_exige_admin();
  if jsonb_typeof(v_dados) <> 'object' then raise exception 'dados deve ser um objeto {campo: valor}.'; end if;
  if v_dados ? 'tecnico' or v_dados ? 'mecanico' or v_dados ? 'mecanico_nome' then
    v_dados := (v_dados - 'tecnico' - 'mecanico' - 'mecanico_nome' - 'mecanico_id' - 'tecnico_id')
               || public.agente_tecnico(coalesce(v_dados->>'tecnico', v_dados->>'mecanico', v_dados->>'mecanico_nome'));
  elsif v_dados ? 'tecnico_id' or v_dados ? 'mecanico_id' then
    raise exception 'Para trocar o técnico, use dados.tecnico com o nome (lista de Funcionários).';
  end if;
  if v_dados ? 'desconto' then v_desc := v_dados->'desconto'; v_dados := v_dados - 'desconto'; end if;
  p := jsonb_set(p, '{dados}', v_dados);
  v_itens := jsonb_array_length(coalesce(p->'itens_incluir', '[]')) + jsonb_array_length(coalesce(p->'itens_alterar', '[]')) + jsonb_array_length(coalesce(p->'itens_remover', '[]')) > 0;
  v_resto := v_acao <> '' or v_dados <> '{}'::jsonb or coalesce(p->>'cliente_id', '') <> '' or coalesce(p->>'placa', '') <> '' or coalesce(p->>'veiculo_id', '') <> '' or v_itens;
  if v_desc is not null and v_acao in ('cancelar', 'excluir', 'recusar', 'retirar') then
    raise exception 'Desconto não combina com acao=%: mande só o que quer fazer.', v_acao; end if;
  if v_desc is not null and v_acao = 'entregar' and v_itens then
    raise exception 'Numa chamada só não dá para mexer nos itens, dar desconto e entregar: mande os itens primeiro.'; end if;
  if v_desc is not null and v_itens then
    select * into o from public.ordens where numero = (p->>'numero')::int order by criado_em desc limit 1;
    if o.id is not null and jsonb_typeof(v_desc) = 'number' and abs((v_desc #>> '{}')::numeric - coalesce(o.desconto, 0)) <= 0.005 then
      v_desc := null;  -- o mesmo desconto: nada a fazer
    elsif o.status = 'entregue' then
      raise exception 'Na O.S. entregue, mande os itens e o desconto em chamadas separadas (no meio o total muda e a O.S. pode fechar sozinha).';
    end if;
  end if;
  -- desconto antes só na entrega (as parcelas usam o saldo novo); nos outros casos, depois — vale sobre os itens e a etapa já mudados
  -- (o os_aplicar_desconto confere de novo: não passa do valor dos itens e o total não fica menor que o recebido)
  v_antes := v_acao = 'entregar';
  if v_desc is not null and v_antes then
    rd := public.agente_desconto_os(jsonb_build_object('numero', p->'numero', 'desconto', v_desc, 'motivo', coalesce(p->>'motivo', ''), 'pedido', coalesce(p->>'pedido', '')));
  end if;
  if v_resto or v_desc is null then r := public.agente_alterar_os(p); end if;  -- sem nada: a mensagem "Nada a fazer" do v40
  if v_desc is not null and not v_antes then
    rd := public.agente_desconto_os(jsonb_build_object('numero', p->'numero', 'desconto', v_desc, 'motivo', coalesce(p->>'motivo', ''), 'pedido', coalesce(p->>'pedido', '')));
  end if;
  if rd is null then return r; end if;
  if coalesce((r->>'excluida')::boolean, false) then return r; end if;
  select * into o from public.ordens where numero = (p->>'numero')::int order by criado_em desc limit 1;
  return public.agente_os_json(o) || jsonb_build_object(
    'feito', coalesce(r->'feito', '[]') || to_jsonb('desconto de ' || public.agente_reais((rd->>'desconto')::numeric) || ' (total ' || public.agente_reais((rd->>'total')::numeric) || ')'),
    'avisos', coalesce(r->'avisos', '[]') || coalesce(rd->'avisos', '[]'), 'desconto', rd - 'avisos');
end $$;

-- ---------- fornecedores ----------
-- p: acao (criar | editar | excluir | inativar | ativar); id, cnpj ou busca (nome); campos {razao, fantasia, cnpj, ie, telefone, email,
--    endereco, bairro, cidade, uf, cep, contato, obs, prestador, categoria_padrao, ativo}
create or replace function public.agente_fornecedor(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare v_acao text := lower(coalesce(p->>'acao', 'editar')); f public.fornecedores; v_antes jsonb; v_novo jsonb; v_campos jsonb; v_cols text; v_doc text;
  v_n int; v_cand text; avisos text[] := '{}'; v_cats text[]; k text;
begin
  perform public.agente_exige_admin();
  if v_acao not in ('criar', 'editar', 'excluir', 'inativar', 'ativar') then raise exception 'acao deve ser criar, editar, excluir, inativar ou ativar.'; end if;
  v_campos := public.agente_campos('fornecedores', p->'campos', array['id', 'criado_em', 'atualizado_em']);
  for k in select jsonb_object_keys(v_campos) loop
    if k in ('cnpj', 'telefone', 'cep') then v_campos := jsonb_set(v_campos, array[k], to_jsonb(regexp_replace(coalesce(v_campos->>k, ''), '\D', '', 'g'))); end if;
    if k = 'uf' then v_campos := jsonb_set(v_campos, '{uf}', to_jsonb(upper(left(trim(coalesce(v_campos->>'uf', '')), 2)))); end if;
    if k in ('razao', 'fantasia') then v_campos := jsonb_set(v_campos, array[k], to_jsonb(trim(coalesce(v_campos->>k, '')))); end if;
  end loop;
  if v_acao <> 'criar' then
    if coalesce(p->>'id', '') <> '' then select * into f from public.fornecedores where id = (p->>'id')::uuid for update;
    elsif length(regexp_replace(coalesce(p->>'cnpj', ''), '\D', '', 'g')) in (11, 14) then
      select * into f from public.fornecedores where regexp_replace(cnpj, '\D', '', 'g') = regexp_replace(p->>'cnpj', '\D', '', 'g') limit 1 for update;
    elsif coalesce(trim(p->>'busca'), '') <> '' then
      select count(*), string_agg(coalesce(nullif(fantasia, ''), razao) || ' (' || coalesce(nullif(cnpj, ''), 'sem CNPJ') || ')', '; ') into v_n, v_cand
      from public.fornecedores where razao ilike '%' || trim(p->>'busca') || '%' or fantasia ilike '%' || trim(p->>'busca') || '%';
      if v_n > 1 then raise exception 'Achei % fornecedores com "%": diga o CNPJ ou o nome completo. %', v_n, p->>'busca', left(v_cand, 1200); end if;
      select * into f from public.fornecedores where razao ilike '%' || trim(p->>'busca') || '%' or fantasia ilike '%' || trim(p->>'busca') || '%' limit 1 for update;
    end if;
    if f.id is null then raise exception 'Fornecedor não encontrado (informe id, cnpj ou busca).'; end if;
    v_antes := to_jsonb(f);
  end if;
  if v_acao = 'excluir' then
    -- as ligações com fornecedores apagam em cascata ou ficam sem fornecedor (o banco não barra): só exclui o que não tem nada ligado
    select array_to_string(array_remove(array[
      (select case when count(*) > 0 then count(*) || ' conta(s) a pagar' end from public.contas where fornecedor_id = f.id),
      (select case when count(*) > 0 then count(*) || ' nota(s) de entrada' end from public.notas_entrada where fornecedor_id = f.id),
      (select case when count(*) > 0 then count(*) || ' produto(s)' end from public.produtos where fornecedor_id = f.id),
      (select case when count(*) > 0 then count(*) || ' código(s) de produto do fornecedor' end from public.produto_fornecedor where fornecedor_id = f.id),
      (select case when count(*) > 0 then count(*) || ' item(ns) de O.S.' end from public.os_itens where fornecedor_id = f.id),
      (select case when count(*) > 0 then count(*) || ' pedido(s) de compra' end from public.pre_notas where fornecedor_id = f.id),
      (select case when count(*) > 0 then count(*) || ' regra(s) aprendida(s)' end from public.agente_regras where fornecedor_id = f.id)], null), ', ') into v_cand;
    if coalesce(v_cand, '') <> '' then
      raise exception 'O fornecedor % tem % ligados: use acao=inativar (some das listas e o histórico fica).', coalesce(nullif(f.fantasia, ''), f.razao), v_cand;
    end if;
    delete from public.fornecedores where id = f.id;
    perform public.agente_registrar('fornecedor', p, 'fornecedores', f.id::text, v_antes, jsonb_build_object('excluido', true));
    return jsonb_build_object('acao', 'excluir', 'excluido', true, 'fornecedor', jsonb_build_object('razao', f.razao, 'fantasia', f.fantasia, 'cnpj', f.cnpj));
  end if;
  if v_acao in ('inativar', 'ativar') then v_campos := v_campos || jsonb_build_object('ativo', v_acao = 'ativar'); end if;
  if v_campos = '{}'::jsonb then raise exception 'Informe os campos.'; end if;
  if (v_acao = 'criar' or v_campos ? 'razao') and coalesce(v_campos->>'razao', '') = '' then raise exception 'Informe a razão social (campos.razao).'; end if;
  v_doc := coalesce(v_campos->>'cnpj', '');
  if v_campos ? 'cnpj' and v_doc <> '' then
    if not public.agente_doc_valido(v_doc) then raise exception 'CNPJ/CPF % inválido: confira os dígitos (ou deixe em branco).', v_doc; end if;
    select string_agg(coalesce(nullif(fantasia, ''), razao), ', ') into v_cand from public.fornecedores
      where regexp_replace(cnpj, '\D', '', 'g') = v_doc and id is distinct from f.id;
    if v_cand is not null then raise exception 'Já existe fornecedor com este CNPJ/CPF: %.', v_cand; end if;
  end if;
  if coalesce(v_campos->>'categoria_padrao', '') <> '' then
    select array_agg(x) into v_cats from public.config, jsonb_array_elements_text(dados->'categoriasDespesa') x where id = 1;
    if v_cats is not null and not ((v_campos->>'categoria_padrao') = any (v_cats)) then
      avisos := array_append(avisos, 'A categoria "' || (v_campos->>'categoria_padrao') || '" não está na lista de Ajustes (categorias de despesa).');
    end if;
  end if;
  perform jsonb_populate_record(null::public.fornecedores, v_campos); -- confere os tipos
  if v_acao = 'criar' then
    select string_agg(format('%I', x), ', ') into v_cols from jsonb_object_keys(v_campos) x;
    execute format('insert into public.fornecedores (%s) select %s from jsonb_populate_record(null::public.fornecedores, $1) returning to_jsonb(fornecedores.*)', v_cols, v_cols)
      into v_novo using v_campos;
  else
    select string_agg(format('%I = r.%I', x, x), ', ') into v_cols from jsonb_object_keys(v_campos) x;
    execute format('update public.fornecedores t set %s from jsonb_populate_record(null::public.fornecedores, $1) r where t.id = $2 returning to_jsonb(t.*)', v_cols)
      into v_novo using v_campos, f.id;
  end if;
  perform public.agente_registrar('fornecedor', p, 'fornecedores', v_novo->>'id', v_antes, v_novo);
  return jsonb_build_object('acao', v_acao, 'avisos', to_jsonb(avisos), 'fornecedor', jsonb_build_object('id', v_novo->'id', 'razao', v_novo->'razao', 'fantasia', v_novo->'fantasia',
    'cnpj', v_novo->'cnpj', 'prestador', v_novo->'prestador', 'categoria_padrao', v_novo->'categoria_padrao', 'ativo', v_novo->'ativo'),
    'alterado', (select coalesce(jsonb_agg(x), '[]') from jsonb_object_keys(v_campos) x));
end $$;

-- ---------- venda de balcão ----------
-- p: acao (vender | cancelar)
--    vender: cliente_id ou cliente {nome, doc} (sem nada = "Consumidor"); itens [{codigo (estoque/catálogo) ou descricao + valor_unit (item avulso),
--            qtd, valor_unit (padrão: preço da tabela), desconto, tipo (produto|servico, item avulso)}]; tabela (vista|prazo|atacado);
--            desconto (da venda, R$); forma; obs; receber (padrão: emite o recibo do total, menos em boleto, promissória e cheque), conta (entrada), data do recibo
--    cancelar: numero, motivo (estoque volta e o recibo da venda é cancelado)
create or replace function public.agente_venda(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare v_acao text := lower(coalesce(p->>'acao', 'vender')); v public.vendas; c public.clientes; it jsonb; pr public.produtos; v_itens jsonb := '[]';
  v_tab text := lower(coalesce(nullif(trim(p->>'tabela'), ''), 'vista')); v_forma text; v_valor numeric; v_cli jsonb; v_res jsonb; v_rec public.recibos;
  v_conta text; v_receber boolean; avisos text[] := '{}'; v_quem text := public.agente_quem(); v_sub numeric := 0;
  v_cus numeric := 0; v_usado jsonb := '{}'; v_desc numeric; v_total numeric; v_data date;
begin
  perform public.agente_exige_admin();
  if v_acao = 'cancelar' then
    if coalesce(p->>'numero', '') !~ '^\s*[0-9]+\s*$' then raise exception 'Informe o número da venda.'; end if;
    select * into v from public.vendas where numero = (p->>'numero')::int;
    if v.id is null then raise exception 'Venda % não encontrada.', p->>'numero'; end if;
    if v.status = 'cancelada' then raise exception 'A venda % já está cancelada.', v.numero; end if;
    if coalesce(trim(p->>'motivo'), '') = '' then raise exception 'Informe o motivo do cancelamento.'; end if;
    perform public.cancelar_venda(v.id, trim(p->>'motivo') || ' (agente, Claude)');
    perform public.agente_registrar('venda_balcao', p, 'vendas', v.id::text, to_jsonb(v), jsonb_build_object('cancelada', true));
    return jsonb_build_object('acao', 'cancelar', 'venda', v.numero, 'total', v.total, 'cancelada', true,
      'recibos_cancelados', (select count(*) from public.recibos where venda_id = v.id and cancelado), 'aviso', 'As peças voltaram ao estoque.');
  end if;
  if v_acao <> 'vender' then raise exception 'acao deve ser vender ou cancelar.'; end if;
  if v_tab not in ('vista', 'prazo', 'atacado') then raise exception 'tabela deve ser vista, prazo ou atacado.'; end if;
  if jsonb_typeof(p->'itens') is distinct from 'array' or jsonb_array_length(p->'itens') = 0 then raise exception 'Inclua pelo menos um item.'; end if;
  v_forma := public.agente_forma_valida(p->>'forma');
  -- recibo do total: padrão sim, menos boleto/promissória/cheque (venda a prazo)
  v_receber := coalesce((p->>'receber')::boolean, v_forma !~* '(boleto|promiss|cheque)');
  -- cliente: cadastro (bloqueado não compra) ou avulso
  if coalesce(p->>'cliente_id', '') <> '' then
    select * into c from public.clientes where id = (p->>'cliente_id')::uuid;
    if c.id is null then raise exception 'Cliente % não encontrado.', p->>'cliente_id'; end if;
    if coalesce(to_jsonb(c)->>'situacao', '') = 'bloqueado' then
      raise exception 'Cliente bloqueado: %.', coalesce(nullif(to_jsonb(c)->>'restricao', ''), 'verifique o cadastro'); end if;
    v_cli := jsonb_build_object('nome', c.nome, 'doc', coalesce(to_jsonb(c)->>'doc', ''), 'telefone', coalesce(c.telefone, ''));
  else
    v_cli := jsonb_build_object('nome', coalesce(nullif(trim(p->'cliente'->>'nome'), ''), 'Consumidor'), 'doc', regexp_replace(coalesce(p->'cliente'->>'doc', ''), '\D', '', 'g'));
  end if;
  for it in select * from jsonb_array_elements(p->'itens') loop
    if jsonb_typeof(it->'qtd') is distinct from 'number' or (it->>'qtd')::numeric <= 0 then raise exception 'Item "%": informe a quantidade.', coalesce(it->>'codigo', it->>'descricao', '?'); end if;
    pr := null;
    if coalesce(it->>'codigo', '') <> '' then
      select * into pr from public.produtos x where x.codigo::text = trim(it->>'codigo') or (coalesce(x.codigo_barras, '') <> '' and lower(x.codigo_barras) = lower(trim(it->>'codigo')))
        order by x.ativo desc limit 1;
      if pr.id is null then raise exception 'Código % não existe no cadastro de produtos e serviços.', it->>'codigo'; end if;
      if not pr.ativo then avisos := array_append(avisos, pr.descricao || ' está inativo no cadastro.'); end if;
      -- preço da tabela escolhida (precoTabela em js/util.js)
      v_valor := coalesce(nullif(it->>'valor_unit', '')::numeric,
        nullif(case v_tab when 'prazo' then pr.preco_prazo when 'atacado' then pr.preco_atacado else pr.preco_vista end, 0), nullif(pr.preco_vista, 0), 0);
      if v_valor <= 0 then raise exception '% está sem preço de venda: informe valor_unit.', pr.descricao; end if;
      -- estoque: a mesma conferência do finalizar_venda (v4), somando o mesmo produto em mais de uma linha
      if pr.tipo = 'produto' and pr.controla_estoque then
        if coalesce(pr.estoque_atual, 0) - coalesce((v_usado->>pr.id::text)::numeric, 0) < (it->>'qtd')::numeric then
          if not coalesce(pr.vender_sem_estoque, false) then
            raise exception 'Estoque insuficiente de % (há % %).', pr.descricao,
              trim(to_char(coalesce(pr.estoque_atual, 0) - coalesce((v_usado->>pr.id::text)::numeric, 0), 'FM999990.###')), pr.unidade;
          end if;
          avisos := array_append(avisos, pr.descricao || ': estoque ' || trim(to_char(coalesce(pr.estoque_atual, 0), 'FM999990.###')) || ' (vai ficar negativo).');
        end if;
        v_usado := v_usado || jsonb_build_object(pr.id::text, coalesce((v_usado->>pr.id::text)::numeric, 0) + (it->>'qtd')::numeric);
      end if;
      v_itens := v_itens || jsonb_build_array(jsonb_build_object('produto_id', pr.id, 'tipo', case when pr.tipo = 'servico' then 'servico' else 'produto' end,
        'descricao', pr.descricao, 'codigo', pr.codigo::text, 'qtd', (it->>'qtd')::numeric, 'valor_unit', round(v_valor, 2), 'desconto', round(coalesce(nullif(it->>'desconto', '')::numeric, 0), 2)));
    else
      if coalesce(trim(it->>'descricao'), '') = '' or coalesce(nullif(it->>'valor_unit', '')::numeric, 0) <= 0 then
        raise exception 'Item sem código precisa de descricao e valor_unit.'; end if;
      v_itens := v_itens || jsonb_build_array(jsonb_build_object('produto_id', null, 'tipo', case when lower(coalesce(it->>'tipo', '')) = 'servico' then 'servico' else 'produto' end,
        'descricao', trim(it->>'descricao'), 'codigo', '', 'qtd', (it->>'qtd')::numeric, 'valor_unit', round((it->>'valor_unit')::numeric, 2),
        'desconto', round(coalesce(nullif(it->>'desconto', '')::numeric, 0), 2), 'custo_unit', round(coalesce(nullif(it->>'custo_unit', '')::numeric, 0), 2)));
      avisos := array_append(avisos, '"' || trim(it->>'descricao') || '" entra sem ligação com o estoque.');
    end if;
    if (v_itens->-1->>'desconto')::numeric < 0 or (v_itens->-1->>'desconto')::numeric > (v_itens->-1->>'qtd')::numeric * (v_itens->-1->>'valor_unit')::numeric + 0.005 then
      raise exception 'Item "%": desconto maior que o valor do item.', v_itens->-1->>'descricao'; end if;
    v_sub := v_sub + (v_itens->-1->>'qtd')::numeric * (v_itens->-1->>'valor_unit')::numeric - (v_itens->-1->>'desconto')::numeric;
    v_cus := v_cus + (v_itens->-1->>'qtd')::numeric * coalesce(pr.custo, nullif(v_itens->-1->>'custo_unit', '')::numeric, 0);
  end loop;
  if coalesce(nullif(p->>'desconto', '')::numeric, 0) < 0 or coalesce(nullif(p->>'desconto', '')::numeric, 0) > v_sub + 0.005 then
    raise exception 'O desconto da venda não pode passar de %.', public.agente_reais(v_sub); end if;
  v_desc := round(coalesce(nullif(p->>'desconto', '')::numeric, 0), 2);
  v_total := greatest(0, round(v_sub - v_desc, 2));
  if v_receber and v_total > 0 then
    v_conta := case when coalesce(trim(p->>'conta'), '') <> '' then public.agente_conta_valida(p->>'conta') else public.agente_conta_sugerida(v_forma) end;
    v_data := public.agente_data(p->>'data');
  end if;
  -- prévia: a conta da venda sem gravar (o número da venda e do recibo só saem na gravação, sem pular nenhum)
  if public.agente_em_previa() then
    return jsonb_build_object('acao', 'vender', 'venda', null, 'id', null, 'cliente', v_cli->>'nome', 'forma', v_forma, 'tabela', v_tab,
      'subtotal', round(v_sub, 2), 'desconto', v_desc, 'total', v_total, 'custo', round(v_cus, 2),
      'itens', (select jsonb_agg(jsonb_build_object('codigo', x->>'codigo', 'descricao', x->>'descricao', 'qtd', (x->>'qtd')::numeric, 'valor_unit', (x->>'valor_unit')::numeric,
                'desconto', (x->>'desconto')::numeric)) from jsonb_array_elements(v_itens) x),
      'recibo', case when v_receber and v_total > 0 then jsonb_build_object('numero', null, 'valor', v_total, 'conta', v_conta, 'data', v_data) end,
      'avisos', to_jsonb(avisos || array['Prévia: o número da venda' || case when v_receber and v_total > 0 then ' e o do recibo saem' else ' sai' end || ' na gravação.']));
  end if;
  v_res := public.finalizar_venda(jsonb_build_object('cliente_id', nullif(p->>'cliente_id', ''), 'cliente', v_cli, 'tabela_preco', v_tab,
    'desconto', round(coalesce(nullif(p->>'desconto', '')::numeric, 0), 2), 'forma_pagamento', v_forma, 'obs', trim(coalesce(p->>'obs', '') || ' (agente, Claude)'), 'itens', v_itens));
  select * into v from public.vendas where id = (v_res->>'id')::uuid;
  -- recibo do total (o dinheiro entra no saldo da conta)
  if v_receber and v.total > 0 then
    v_conta := coalesce(v_conta, public.agente_conta_sugerida(v_forma));
    insert into public.recibos (venda_id, cliente_id, pagador, doc, valor, referente, forma, conta_destino, data, obs, emitido_por)
    values (v.id, v.cliente_id, coalesce(nullif(v.cliente->>'nome', ''), 'Consumidor'), coalesce(v.cliente->>'doc', ''), v.total,
            'pagamento da venda de balcão nº ' || lpad(v.numero::text, 5, '0'), v_forma, v_conta, coalesce(v_data, public.agente_data(p->>'data')),
            'Lançado pelo agente (Claude).', v_quem) returning * into v_rec;
  end if;
  perform public.agente_registrar('venda_balcao', p, 'vendas', v.id::text, null, to_jsonb(v));
  return jsonb_build_object('acao', 'vender', 'venda', v.numero, 'id', v.id, 'cliente', v.cliente->>'nome', 'forma', v.forma_pagamento, 'tabela', v.tabela_preco,
    'subtotal', v.subtotal, 'desconto', v.desconto, 'total', v.total, 'custo', v.custo,
    'itens', (select jsonb_agg(jsonb_build_object('codigo', i.codigo, 'descricao', i.descricao, 'qtd', i.qtd, 'valor_unit', i.valor_unit, 'desconto', i.desconto)
              order by i.posicao) from public.venda_itens i where i.venda_id = v.id),
    'recibo', case when v_rec.id is not null then jsonb_build_object('numero', v_rec.numero, 'valor', v_rec.valor, 'conta', v_rec.conta_destino, 'data', v_rec.data) end,
    'avisos', to_jsonb(avisos), 'imprimir', 'https://gestao.dtcarcentroautomotivo.com.br/#/imprimir/venda/' || v.id);
end $$;

-- trava a linha da venda até o fim da transação e devolve como ela está (a tabela vendas só é gravada pelas funções do v4, com a chave do
-- dono: o logado não tem "for update" nela). É a mesma trava do cancelar_venda (v4): recibo e cancelamento da mesma venda não se cruzam.
create or replace function public.venda_travar(p_id uuid) returns public.vendas
language plpgsql volatile security definer set search_path = public as $$
declare v public.vendas;
begin
  if not public.e_gestor() then raise exception 'Seu usuário não tem permissão para mexer em vendas.'; end if;
  select * into v from public.vendas where id = p_id for update;
  return v;
end $$;

-- ---------- recibo avulso (sem O.S.: venda de balcão, serviço sem O.S., outro recebimento) ----------
-- p: pagador ou cliente_id; doc; valor; referente; forma; conta; data; obs; venda (número da venda de balcão); receber_mesmo_repetido
create or replace function public.agente_recibo_avulso(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare v_forma text; v_conta text; v_data date; c public.clientes; vd public.vendas; v_pag text; v_doc text; v_ref text; r public.recibos; v_valor numeric;
begin
  perform public.agente_exige_admin();
  if coalesce(p->>'os', p->>'numero_os', '') <> '' then raise exception 'Recibo de O.S.: use receber_os (baixa as parcelas e fecha a O.S.).'; end if;
  if jsonb_typeof(p->'valor') is distinct from 'number' or (p->>'valor')::numeric <= 0 then raise exception 'Informe o valor recebido.'; end if;
  v_valor := round((p->>'valor')::numeric, 2);
  v_forma := public.agente_forma_valida(p->>'forma');
  v_conta := case when coalesce(trim(p->>'conta'), '') <> '' then public.agente_conta_valida(p->>'conta') else public.agente_conta_sugerida(v_forma) end;
  v_data := public.agente_data(p->>'data');
  if coalesce(p->>'venda', '') <> '' then
    select * into vd from public.vendas where numero = nullif(regexp_replace(p->>'venda', '\D', '', 'g'), '')::int;
    if vd.id is null then raise exception 'Venda % não encontrada.', p->>'venda'; end if;
    -- trava a venda (a mesma trava do cancelar_venda) e relê: dois recibos ao mesmo tempo, ou recibo e cancelamento, não se cruzam (Codex no #62)
    vd := public.venda_travar(vd.id);
    if vd.status = 'cancelada' then raise exception 'A venda % está cancelada.', vd.numero; end if;
    if v_valor > vd.total - coalesce((select sum(valor) from public.recibos where venda_id = vd.id and not cancelado), 0) + 0.009 then
      raise exception 'A venda % (total %) já tem % recebido: falta só %.', vd.numero, public.agente_reais(vd.total),
        public.agente_reais(coalesce((select sum(valor) from public.recibos where venda_id = vd.id and not cancelado), 0)),
        public.agente_reais(greatest(0, vd.total - coalesce((select sum(valor) from public.recibos where venda_id = vd.id and not cancelado), 0)));
    end if;
  end if;
  if coalesce(p->>'cliente_id', '') <> '' then
    select * into c from public.clientes where id = (p->>'cliente_id')::uuid;
    if c.id is null then raise exception 'Cliente % não encontrado.', p->>'cliente_id'; end if;
  end if;
  v_pag := coalesce(nullif(trim(p->>'pagador'), ''), c.nome, nullif(vd.cliente->>'nome', ''));
  if v_pag is null then raise exception 'Informe quem pagou (pagador ou cliente_id).'; end if;
  v_doc := regexp_replace(coalesce(nullif(p->>'doc', ''), to_jsonb(c)->>'doc', vd.cliente->>'doc', ''), '\D', '', 'g');
  v_ref := coalesce(nullif(trim(p->>'referente'), ''), case when vd.id is not null then 'pagamento da venda de balcão nº ' || lpad(vd.numero::text, 5, '0') end);
  if v_ref is null then raise exception 'Informe a que se refere o pagamento (referente).'; end if;
  if not coalesce((p->>'receber_mesmo_repetido')::boolean, false) and exists (select 1 from public.recibos x where not x.cancelado and x.valor = v_valor
       and lower(x.pagador) = lower(v_pag) and x.criado_em > now() - interval '10 minutes') then
    raise exception 'Já existe recibo de % para % nos últimos 10 minutos. Se for outro pagamento, mande receber_mesmo_repetido=true.', public.agente_reais(v_valor), v_pag;
  end if;
  if public.agente_em_previa() then  -- o número do recibo só sai na gravação (sem pular nenhum)
    return jsonb_build_object('recibo', null, 'id', null, 'pagador', v_pag, 'valor', v_valor, 'referente', v_ref, 'forma', v_forma,
      'conta', v_conta, 'data', v_data, 'venda', vd.numero, 'aviso', 'Prévia: o número do recibo sai na gravação.');
  end if;
  insert into public.recibos (venda_id, cliente_id, pagador, doc, valor, referente, forma, conta_destino, data, obs, emitido_por)
  values (vd.id, coalesce(c.id, vd.cliente_id), v_pag, v_doc, v_valor, v_ref, v_forma, v_conta, v_data,
          trim(coalesce(p->>'obs', '') || ' Lançado pelo agente (Claude).'), public.agente_quem()) returning * into r;
  perform public.agente_registrar('recibo_avulso', p, 'recibos', r.id::text, null, to_jsonb(r));
  return jsonb_build_object('recibo', r.numero, 'id', r.id, 'pagador', r.pagador, 'valor', r.valor, 'referente', r.referente, 'forma', r.forma,
    'conta', r.conta_destino, 'data', r.data, 'venda', vd.numero, 'imprimir', 'https://gestao.dtcarcentroautomotivo.com.br/#/imprimir/recibo/' || r.id);
end $$;

-- ---------- funcionários (cadastro e lançamentos do mês) ----------
-- p: acao: criar | editar | desligar | reativar | excluir | lancar | editar_lancamento | excluir_lancamento
--    cadastro: id ou funcionario (nome); campos {nome, apelido, cpf, telefone, funcao, vinculo, admissao, demissao, salario, horas_mes,
--              he_pct, comissao_pct, perfil_id, jornada, banco, pix, obs...}; desligar: data (padrão hoje)
--    lançamento: funcionario (nome ou id), mes (AAAA-MM, padrão o mês atual), data, tipo, qtd, valor, descricao;
--                editar/excluir: id do lançamento (veja consultar funcionario_lanc)
-- O cálculo do mês (folha) e o "Lançar em Contas a pagar" ficam na ferramenta (mesmo js/folha.js da tela).
create or replace function public.agente_funcionario(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_acao text := lower(coalesce(p->>'acao', '')); f public.funcionarios; l public.funcionario_lanc; v_antes jsonb; v_novo jsonb; v_campos jsonb; v_cols text;
  v_n int; v_cand text; k text; v_busca text := trim(coalesce(p->>'funcionario', p->>'nome', '')); v_mes date; v_tipo text; v_qtd numeric; v_valor numeric;
  v_tipos text[] := array['hora_extra', 'comissao', 'bonus', 'falta', 'vale', 'adiantamento', 'desconto', 'inss', 'pagamento'];
  v_vinculos text[] := array['clt', 'experiencia', 'mei', 'diarista', 'estagio', 'socio']; v_hoje date := public.agente_hoje();
  c_jornada jsonb := '{"seg":{"e":"07:30","sa":"11:30","r":"13:00","s":"17:00"},"ter":{"e":"07:30","sa":"11:30","r":"13:00","s":"17:00"},"qua":{"e":"07:30","sa":"11:30","r":"13:00","s":"17:00"},"qui":{"e":"07:30","sa":"11:30","r":"13:00","s":"17:00"},"sex":{"e":"07:30","sa":"11:30","r":"13:00","s":"17:00"},"sab":{"e":"07:30","sa":"","r":"","s":"11:30"},"dom":null}';
begin
  perform public.agente_exige_admin();
  if v_acao not in ('criar', 'editar', 'desligar', 'reativar', 'excluir', 'lancar', 'editar_lancamento', 'excluir_lancamento') then
    raise exception 'acao deve ser criar, editar, desligar, reativar, excluir, lancar, editar_lancamento ou excluir_lancamento.';
  end if;

  -- ---------- lançamento já existente ----------
  if v_acao in ('editar_lancamento', 'excluir_lancamento') then
    select * into l from public.funcionario_lanc where id = nullif(p->>'id', '')::uuid for update;
    if l.id is null then raise exception 'Lançamento não encontrado (informe o id; veja consultar tabela=funcionario_lanc).'; end if;
    select * into f from public.funcionarios where id = l.funcionario_id;
    if v_acao = 'excluir_lancamento' then
      delete from public.funcionario_lanc where id = l.id;
      perform public.agente_registrar('funcionario', p, 'funcionario_lanc', l.id::text, to_jsonb(l), jsonb_build_object('excluido', true));
      return jsonb_build_object('acao', v_acao, 'excluido', true, 'funcionario', f.nome, 'lancamento', jsonb_build_object('tipo', l.tipo, 'data', l.data, 'qtd', l.qtd, 'valor', l.valor));
    end if;
    -- campos.mes (AAAA-MM) muda o mês de referência (competencia)
    if jsonb_typeof(p->'campos') = 'object' and p->'campos' ? 'mes' then
      if coalesce(p->'campos'->>'mes', '') !~ '^\d{4}-\d{2}$' then raise exception 'mes no formato AAAA-MM.'; end if;
      p := jsonb_set(p, '{campos}', ((p->'campos') - 'mes') || jsonb_build_object('competencia', (p->'campos'->>'mes') || '-01'));
    end if;
    v_campos := public.agente_campos('funcionario_lanc', p->'campos', array['id', 'funcionario_id', 'conta_id', 'usuario_nome', 'criado_em', 'atualizado_em']);
    if v_campos = '{}'::jsonb then raise exception 'Informe os campos a mudar (data, tipo, qtd, valor, descricao, competencia).'; end if;
    v_tipo := coalesce(v_campos->>'tipo', l.tipo); v_qtd := coalesce(nullif(v_campos->>'qtd', '')::numeric, l.qtd); v_valor := coalesce(nullif(v_campos->>'valor', '')::numeric, l.valor);
  elsif v_acao <> 'criar' then
    -- ---------- funcionário pelo id ou pelo nome ----------
    if coalesce(p->>'id', '') <> '' then select * into f from public.funcionarios where id = (p->>'id')::uuid for update;
    elsif v_busca ~* '^[0-9a-f]{8}-[0-9a-f]{4}-' then select * into f from public.funcionarios where id = v_busca::uuid for update;
    elsif v_busca <> '' then
      select count(*) into v_n from public.funcionarios x where lower(public.unaccent_simples(x.nome)) = lower(public.unaccent_simples(v_busca))
        or (x.apelido <> '' and lower(public.unaccent_simples(x.apelido)) = lower(public.unaccent_simples(v_busca)));
      if v_n = 1 then
        select * into f from public.funcionarios x where lower(public.unaccent_simples(x.nome)) = lower(public.unaccent_simples(v_busca))
          or (x.apelido <> '' and lower(public.unaccent_simples(x.apelido)) = lower(public.unaccent_simples(v_busca))) for update;
      else
        select count(*), string_agg(x.nome, ', ') into v_n, v_cand from public.funcionarios x
          where lower(public.unaccent_simples(x.nome || ' ' || x.apelido)) like '%' || lower(public.unaccent_simples(v_busca)) || '%';
        if v_n > 1 then raise exception 'Mais de um funcionário com "%": %. Diga o nome completo.', v_busca, v_cand; end if;
        select * into f from public.funcionarios x where lower(public.unaccent_simples(x.nome || ' ' || x.apelido)) like '%' || lower(public.unaccent_simples(v_busca)) || '%' for update;
      end if;
    end if;
    if f.id is null then raise exception 'Funcionário não encontrado (informe id ou funcionario com o nome).'; end if;
    v_antes := to_jsonb(f);
  end if;

  -- ---------- lançamento novo ----------
  if v_acao = 'lancar' then
    v_tipo := lower(coalesce(p->>'tipo', '')); v_qtd := coalesce(nullif(p->>'qtd', '')::numeric, 0); v_valor := coalesce(nullif(p->>'valor', '')::numeric, 0);
    if coalesce(p->>'mes', '') <> '' then
      if trim(p->>'mes') !~ '^\d{4}-\d{2}$' then raise exception 'mes no formato AAAA-MM.'; end if;
      v_mes := (trim(p->>'mes') || '-01')::date;
    else v_mes := date_trunc('month', v_hoje)::date; end if;
    v_campos := jsonb_build_object('tipo', v_tipo, 'qtd', v_qtd, 'valor', v_valor);
  elsif v_acao = 'editar_lancamento' then
    if v_campos ? 'competencia' then v_campos := jsonb_set(v_campos, '{competencia}', to_jsonb(date_trunc('month', (v_campos->>'competencia')::date)::date)); end if;
  end if;
  if v_acao in ('lancar', 'editar_lancamento') then
    if not (v_tipo = any (v_tipos)) then raise exception 'Tipo "%" não existe. Tipos: %.', v_tipo, array_to_string(v_tipos, ', '); end if;
    if v_qtd < 0 or v_valor < 0 then raise exception 'Quantidade e valor não podem ser negativos.'; end if;
    if v_tipo in ('hora_extra', 'falta') then
      if not (v_qtd > 0 or v_valor > 0) then raise exception 'Informe a quantidade de % ou o valor.', case v_tipo when 'hora_extra' then 'horas' else 'dias' end; end if;
    elsif not (v_valor > 0) then raise exception 'Informe o valor.'; end if;
    if v_acao = 'lancar' then
      insert into public.funcionario_lanc (funcionario_id, competencia, data, tipo, qtd, valor, descricao, usuario_nome)
      values (f.id, v_mes, public.agente_data(p->>'data'), v_tipo, v_qtd, round(v_valor, 2), trim(coalesce(p->>'descricao', '')), public.agente_quem())
      returning * into l;
      perform public.agente_registrar('funcionario', p, 'funcionario_lanc', l.id::text, null, to_jsonb(l));
    else
      if v_campos ? 'data' then perform public.agente_data(v_campos->>'data'); end if;
      perform jsonb_populate_record(null::public.funcionario_lanc, v_campos);
      select string_agg(format('%I = r.%I', x, x), ', ') into v_cols from jsonb_object_keys(v_campos) x;
      execute format('update public.funcionario_lanc t set %s from jsonb_populate_record(null::public.funcionario_lanc, $1) r where t.id = $2', v_cols) using v_campos, l.id;
      perform public.agente_registrar('funcionario', p, 'funcionario_lanc', l.id::text, to_jsonb(l), (select to_jsonb(x) from public.funcionario_lanc x where x.id = l.id));
      select * into l from public.funcionario_lanc where id = l.id;
    end if;
    return jsonb_build_object('acao', v_acao, 'funcionario', f.nome, 'lancamento', jsonb_build_object('id', l.id, 'mes', to_char(l.competencia, 'YYYY-MM'),
      'data', l.data, 'tipo', l.tipo, 'qtd', l.qtd, 'valor', l.valor, 'descricao', l.descricao),
      'aviso', 'O cálculo do mês (salário, extras, comissão, descontos e saldo) sai em funcionario acao=folha.');
  end if;

  -- ---------- cadastro ----------
  if v_acao = 'excluir' then
    select count(*) into v_n from public.funcionario_lanc where funcionario_id = f.id;
    if v_n > 0 then raise exception '% tem % lançamento(s) no histórico: use acao=desligar (o histórico fica).', f.nome, v_n; end if;
    select count(*) into v_n from public.ordens where tecnico_id = f.id;
    if v_n > 0 then raise exception '% é o técnico responsável de % O.S.: use acao=desligar (a comissão dessas O.S. continua com ele).', f.nome, v_n; end if;
    delete from public.funcionarios where id = f.id;
    perform public.agente_registrar('funcionario', p, 'funcionarios', f.id::text, v_antes, jsonb_build_object('excluido', true));
    return jsonb_build_object('acao', 'excluir', 'excluido', true, 'funcionario', f.nome);
  end if;
  if v_acao = 'desligar' then
    v_campos := jsonb_build_object('demissao', public.agente_data(p->>'data', true));
  elsif v_acao = 'reativar' then
    v_campos := jsonb_build_object('ativo', true, 'demissao', null);
  else
    v_campos := public.agente_campos('funcionarios', p->'campos', array['id', 'criado_em', 'atualizado_em']);
    if v_campos = '{}'::jsonb then raise exception 'Informe os campos.'; end if;
  end if;
  for k in select jsonb_object_keys(v_campos) loop
    if k in ('cpf', 'telefone', 'pis') then v_campos := jsonb_set(v_campos, array[k], to_jsonb(regexp_replace(coalesce(v_campos->>k, ''), '\D', '', 'g'))); end if;
    if k in ('nome', 'apelido', 'funcao') then v_campos := jsonb_set(v_campos, array[k], to_jsonb(trim(coalesce(v_campos->>k, '')))); end if;
  end loop;
  if (v_acao = 'criar' or v_campos ? 'nome') and coalesce(v_campos->>'nome', '') = '' then raise exception 'Informe o nome do funcionário.'; end if;
  if v_campos ? 'vinculo' and not ((v_campos->>'vinculo') = any (v_vinculos)) then raise exception 'vinculo deve ser: %.', array_to_string(v_vinculos, ', '); end if;
  if v_campos ? 'comissao_pct' and coalesce(nullif(v_campos->>'comissao_pct', '')::numeric, 0) not between 0 and 100 then raise exception 'comissao_pct vai de 0 a 100.'; end if;
  if (v_campos ? 'salario' and coalesce(nullif(v_campos->>'salario', '')::numeric, 0) < 0) or (v_campos ? 'he_pct' and coalesce(nullif(v_campos->>'he_pct', '')::numeric, 0) < 0) then
    raise exception 'Salário e adicional de hora extra não podem ser negativos.'; end if;
  if v_campos ? 'horas_mes' and coalesce(nullif(v_campos->>'horas_mes', '')::numeric, 0) <= 0 then raise exception 'horas_mes (divisor) precisa ser maior que zero.'; end if;
  if coalesce(v_campos->>'cpf', '') <> '' and length(v_campos->>'cpf') = 11 and not public.agente_doc_valido(v_campos->>'cpf') then raise exception 'CPF inválido.'; end if;
  if coalesce(v_campos->>'perfil_id', '') <> '' and not exists (select 1 from public.perfis where id = (v_campos->>'perfil_id')::uuid) then
    raise exception 'perfil_id não é um acesso do sistema (veja consultar tabela=perfis).'; end if;
  if v_acao = 'criar' and not (v_campos ? 'jornada') then v_campos := v_campos || jsonb_build_object('jornada', c_jornada); end if;
  perform jsonb_populate_record(null::public.funcionarios, v_campos); -- confere os tipos
  if coalesce(v_campos->>'demissao', '') <> '' and coalesce(v_campos->>'admissao', v_antes->>'admissao', '') <> ''
     and (v_campos->>'demissao')::date < coalesce(v_campos->>'admissao', v_antes->>'admissao')::date then
    raise exception 'A data de desligamento é anterior à admissão.'; end if;
  -- como a tela: desligado com data até hoje fica inativo
  if coalesce(v_campos->>'demissao', '') <> '' and (v_campos->>'demissao')::date <= v_hoje then v_campos := v_campos || jsonb_build_object('ativo', false); end if;
  if v_acao = 'criar' then
    select string_agg(format('%I', x), ', ') into v_cols from jsonb_object_keys(v_campos) x;
    execute format('insert into public.funcionarios (%s) select %s from jsonb_populate_record(null::public.funcionarios, $1) returning to_jsonb(funcionarios.*)', v_cols, v_cols)
      into v_novo using v_campos;
  else
    select string_agg(format('%I = r.%I', x, x), ', ') into v_cols from jsonb_object_keys(v_campos) x;
    execute format('update public.funcionarios t set %s from jsonb_populate_record(null::public.funcionarios, $1) r where t.id = $2 returning to_jsonb(t.*)', v_cols)
      into v_novo using v_campos, f.id;
  end if;
  perform public.agente_registrar('funcionario', p, 'funcionarios', v_novo->>'id', v_antes, v_novo);
  -- salário, documentos e pix só voltam ao chat quando foram o que mudou
  return jsonb_build_object('acao', v_acao, 'funcionario', jsonb_build_object('id', v_novo->'id', 'nome', v_novo->'nome', 'apelido', v_novo->'apelido',
    'funcao', v_novo->'funcao', 'vinculo', v_novo->'vinculo', 'ativo', v_novo->'ativo', 'admissao', v_novo->'admissao', 'demissao', v_novo->'demissao',
    'comissao_pct', v_novo->'comissao_pct', 'tem_acesso', v_novo->>'perfil_id' is not null),
    'alterado', (select coalesce(jsonb_agg(x), '[]') from jsonb_object_keys(v_campos) x),
    'aviso', case when v_acao = 'criar' then 'Funcionário cadastrado: já aparece na lista de técnico responsável da O.S.' end);
end $$;

-- ---------- notas da SEFAZ ----------
-- nota pela chave (44 dígitos) ou pelo número (+ fornecedor: parte do nome ou CNPJ)
create or replace function public.agente_achar_nota(p jsonb) returns public.nfe_recebidas
language plpgsql stable security invoker set search_path = public as $$
declare n public.nfe_recebidas; v_cand jsonb; v_n int;
begin
  if length(regexp_replace(coalesce(p->>'chave', ''), '\D', '', 'g')) = 44 then
    select * into n from public.nfe_recebidas where chave = regexp_replace(p->>'chave', '\D', '', 'g');
  elsif coalesce(p->>'numero', '') <> '' then
    select coalesce(jsonb_agg(jsonb_build_object('chave', x.chave, 'numero', x.numero, 'emitente', x.nome_emitente, 'emissao', x.emissao, 'valor', x.valor)), '[]'), count(*) into v_cand, v_n
    from public.nfe_recebidas x where ltrim(x.numero::text, '0') = ltrim(trim(p->>'numero'), '0')
      and (coalesce(p->>'fornecedor', '') = '' or x.nome_emitente ilike '%' || trim(p->>'fornecedor') || '%' or x.cnpj_emitente = regexp_replace(p->>'fornecedor', '\D', '', 'g'));
    if v_n > 1 then raise exception 'Achei % notas com o número %: diga a chave ou o fornecedor. %', v_n, p->>'numero', left(v_cand::text, 1200); end if;
    select * into n from public.nfe_recebidas where chave = v_cand->0->>'chave';
  else raise exception 'Informe a chave da NF-e ou o número (veja notas_da_sefaz).'; end if;
  if n.chave is null then raise exception 'Nota não encontrada nas Notas da SEFAZ.'; end if;
  return n;
end $$;

-- p: acao: manifestar (tipo: ciencia | confirmada | desconhecida | nao_realizada; justificativa) | ignorar | voltar | sem_ciencia (valor true/false)
--          | obs (texto) | vincular_os (os, itens [{item_id, nf_item ou custo_total}]) | consultar_agora | configurar (buscar_automatico, ciencia_automatica)
create or replace function public.agente_nota_sefaz(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare v_acao text := lower(coalesce(p->>'acao', '')); n public.nfe_recebidas; v_antes jsonb; r jsonb; v_tipo text; o public.ordens; it jsonb; cur public.os_itens;
  nf jsonb; ni jsonb; v_itens jsonb := '[]'; v_custo numeric; v_usado jsonb := '{}'; v_resta numeric; c public.sefaz_config;
begin
  perform public.agente_exige_admin();
  if v_acao = 'consultar_agora' then
    r := public.pedir_consulta_sefaz();
    perform public.agente_registrar('nota_sefaz', p, 'sefaz_config', '1', null, r);
    return r || jsonb_build_object('pedido', true, 'aviso', 'O robô consulta em até 10 minutos. Sem nota nova, a SEFAZ só deixa consultar de novo depois de 1 hora.');
  end if;
  if v_acao = 'configurar' then
    select * into c from public.sefaz_config where id = 1;
    if not (p ? 'buscar_automatico' or p ? 'ciencia_automatica') then raise exception 'Informe buscar_automatico e/ou ciencia_automatica (true/false).'; end if;
    update public.sefaz_config set ativo = coalesce((p->>'buscar_automatico')::boolean, ativo), ciencia_automatica = coalesce((p->>'ciencia_automatica')::boolean, ciencia_automatica)
    where id = 1 returning * into c;
    perform public.agente_registrar('nota_sefaz', p, 'sefaz_config', '1', null, jsonb_build_object('ativo', c.ativo, 'ciencia_automatica', c.ciencia_automatica));
    return jsonb_build_object('buscar_automatico', c.ativo, 'ciencia_automatica', c.ciencia_automatica);
  end if;
  n := public.agente_achar_nota(p);
  v_antes := to_jsonb(n) - 'xml';
  if v_acao = 'manifestar' then
    v_tipo := lower(coalesce(p->>'tipo', ''));
    if v_tipo not in ('ciencia', 'confirmada', 'desconhecida', 'nao_realizada') then raise exception 'tipo deve ser ciencia, confirmada, desconhecida ou nao_realizada.'; end if;
    perform public.pedir_manifestacao(n.chave, v_tipo, coalesce(p->>'justificativa', ''));
    -- como a tela: desconhecer ou "não realizada" tira a nota das novas
    if v_tipo in ('desconhecida', 'nao_realizada') and n.status = 'nova' then update public.nfe_recebidas set status = 'ignorada' where chave = n.chave; end if;
  elsif v_acao in ('ignorar', 'voltar') then
    if v_acao = 'ignorar' and n.status <> 'nova' then raise exception 'A nota está "%": só nota nova é ignorada.', n.status; end if;
    if v_acao = 'voltar' and n.status <> 'ignorada' then raise exception 'A nota não está ignorada.'; end if;
    update public.nfe_recebidas set status = case v_acao when 'ignorar' then 'ignorada' else 'nova' end where chave = n.chave;
  elsif v_acao = 'sem_ciencia' then
    if jsonb_typeof(p->'valor') is distinct from 'boolean' then raise exception 'Informe valor true (não dar ciência) ou false.'; end if;
    update public.nfe_recebidas set sem_ciencia = (p->>'valor')::boolean where chave = n.chave;
  elsif v_acao = 'obs' then
    update public.nfe_recebidas set obs = left(trim(coalesce(p->>'texto', '')), 500) where chave = n.chave;
  elsif v_acao = 'vincular_os' then
    -- custo das peças da O.S. a partir da nota (o mesmo "Vincular à O.S." da tela; triangulação do v9)
    if coalesce(p->>'os', '') !~ '^\s*[0-9]+\s*$' then raise exception 'Informe a O.S. (número).'; end if;
    select * into o from public.ordens where numero = (p->>'os')::int order by criado_em desc limit 1;
    if o.id is null then raise exception 'O.S. % não encontrada.', p->>'os'; end if;
    if o.status = 'cancelado' then raise exception 'A O.S. % está cancelada.', o.numero; end if;
    if jsonb_typeof(p->'itens') is distinct from 'array' or jsonb_array_length(p->'itens') = 0 then
      raise exception 'Informe itens: [{item_id (peça da O.S., veja buscar_os), nf_item (nº do item na nota) ou custo_total}].'; end if;
    if n.xml is not null then nf := public.agente_ler_nfe(n.xml); end if;
    perform 1 from public.nfe_recebidas where chave = n.chave for update;  -- dois vínculos ao mesmo tempo não passam juntos da quantidade da nota
    -- já usado de cada item da nota (outras peças); a peça que está sendo vinculada de novo não conta (o vincular_nfe_os troca o vínculo dela)
    select coalesce(jsonb_object_agg(v.nf_item::text, v.q), '{}') into v_usado
      from (select nf_item, sum(qtd) q from public.nfe_os_vinculos where chave = n.chave and nf_item is not null
              and item_id not in (select (x->>'item_id')::uuid from jsonb_array_elements(p->'itens') x where coalesce(x->>'item_id', '') <> '')
            group by nf_item) v;
    for it in select * from jsonb_array_elements(p->'itens') loop
      select * into cur from public.os_itens where id = nullif(it->>'item_id', '')::uuid and ordem_id = o.id;
      if cur.id is null then raise exception 'Item % não é da O.S. % (veja os ids em buscar_os).', coalesce(it->>'item_id', '?'), o.numero; end if;
      if cur.tipo = 'servico' or cur.fornecida_cliente then raise exception '"%" não é peça comprada (serviço ou peça do cliente).', cur.descricao; end if;
      ni := null;
      if coalesce(it->>'nf_item', '') <> '' then
        if nf is null then raise exception 'A nota ainda não tem o XML: informe custo_total de cada peça.'; end if;
        select x into ni from jsonb_array_elements(nf->'itens') x where (x->>'n')::int = (it->>'nf_item')::int;
        if ni is null then raise exception 'A nota não tem o item %.', it->>'nf_item'; end if;
        v_resta := (ni->>'qtd')::numeric - coalesce((v_usado->>(ni->>'n'))::numeric, 0);
        if cur.qtd > v_resta + 0.0001 then
          raise exception 'O item % da nota (%) tem % restante(s) e a peça da O.S. usa %.', ni->>'n', ni->>'descricao_nf', trim(to_char(v_resta, 'FM999990.###')), cur.qtd; end if;
        v_usado := jsonb_set(v_usado, array[ni->>'n'], to_jsonb(coalesce((v_usado->>(ni->>'n'))::numeric, 0) + cur.qtd));
      end if;
      v_custo := coalesce(nullif(it->>'custo_total', '')::numeric, round((ni->>'custo_unit')::numeric * cur.qtd, 2));
      if v_custo is null or v_custo <= 0 then raise exception 'Informe o custo de "%" (nf_item ou custo_total).', cur.descricao; end if;
      v_itens := v_itens || jsonb_build_array(jsonb_build_object('item_id', cur.id, 'nf_item', (ni->>'n')::int,
        'descricao_nf', coalesce(ni->>'descricao_nf', 'Valor informado'), 'qtd', case when ni is null then 0 else cur.qtd end, 'custo_total', round(v_custo, 2)));
    end loop;
    r := public.vincular_nfe_os(jsonb_build_object('chave', n.chave, 'ordem_id', o.id, 'itens', v_itens));
    perform public.agente_registrar('nota_sefaz', p, 'nfe_os_vinculos', n.chave, v_antes, r);
    return r || jsonb_build_object('nota', n.numero, 'fornecedor', n.nome_emitente, 'os', o.numero, 'itens', v_itens);
  else
    raise exception 'acao deve ser manifestar, ignorar, voltar, sem_ciencia, obs, vincular_os, consultar_agora ou configurar.';
  end if;
  select * into n from public.nfe_recebidas where chave = n.chave;
  perform public.agente_registrar('nota_sefaz', p, 'nfe_recebidas', n.chave, v_antes, to_jsonb(n) - 'xml');
  return jsonb_build_object('acao', v_acao, 'nota', n.numero, 'fornecedor', n.nome_emitente, 'valor', n.valor, 'situacao', n.status,
    'manifestacao_pedida', n.manifestacao_pedida, 'manifestacao', n.manifestacao, 'sem_ciencia', n.sem_ciencia, 'obs', n.obs,
    'aviso', case when v_acao = 'manifestar' then 'O pedido vai à SEFAZ em até 10 minutos (robô).' end);
end $$;

-- ---------- boletos Sicredi: pagamento confirmado pelo banco e situação (o conector consulta o banco pela função "sicredi") ----------
-- O mesmo registrarPagamento da tela Boletos Sicredi: marca pago (nunca duas vezes), recibo na conta da carteira, baixa a parcela
-- (parcial deixa o resto em aberto) e registra no histórico da O.S. — tudo numa transação.
-- p: id ou nosso_numero; valor_pago; data (do pagamento); data_credito; forma (Pix | Boleto); ocorrencia; valor_liquido
create or replace function public.agente_boleto_pago(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare b public.boletos; pa public.receber; o public.ordens; cfg jsonb; v_conta text; v_valor numeric; v_data date; v_forma text; r public.recibos; v_ref text;
  v_parte numeric; v_quem text := public.agente_quem(); v_nn text; v_veic text;
begin
  perform public.agente_exige_admin();
  -- a prévia é da ferramenta "boleto" (consulta o banco e mostra); aqui só grava, para o número do recibo não pular
  if public.agente_em_previa() then raise exception 'boleto_pago só grava: a prévia é a da ferramenta boleto (atualizar com confirmar=false).'; end if;
  select * into b from public.boletos where (coalesce(p->>'id', '') <> '' and id = (p->>'id')::uuid) or (coalesce(p->>'nosso_numero', '') <> '' and nosso_numero = regexp_replace(p->>'nosso_numero', '\D', '', 'g')) for update;
  if b.id is null then raise exception 'Boleto não encontrado.'; end if;
  if b.situacao = 'pago' then return jsonb_build_object('nosso_numero', b.nosso_numero, 'ja_registrado', true, 'aviso', 'Pagamento já registrado antes.'); end if;
  select dados into cfg from public.config where id = 1;
  v_valor := round(coalesce(nullif(p->>'valor_pago', '')::numeric, b.valor), 2);
  if v_valor <= 0 then raise exception 'Valor pago inválido.'; end if;
  v_data := public.agente_data(p->>'data');
  v_forma := case when coalesce(p->>'forma', '') ~* 'pix' then 'Pix' else 'Boleto' end;
  update public.boletos set situacao = 'pago', valor_pago = v_valor, valor_liquido = nullif(p->>'valor_liquido', '')::numeric, data_pagamento = v_data,
    data_credito = nullif(p->>'data_credito', '')::date, forma_pagamento = v_forma, ocorrencia = coalesce(nullif(p->>'ocorrencia', ''), 'Pago no banco') where id = b.id;
  if b.receber_id is not null then select * into pa from public.receber where id = b.receber_id for update; end if;
  if pa.id is not null and pa.status <> 'aberta' then
    update public.boletos set ocorrencia = 'Pago no banco, mas a parcela já estava recebida no sistema: confira se não há recibo em dobro.' where id = b.id;
    perform public.agente_registrar('boleto_pago', p, 'boletos', b.id::text, to_jsonb(b), jsonb_build_object('pago', true, 'sem_recibo', true));
    return jsonb_build_object('nosso_numero', b.nosso_numero, 'pagador', b.pagador_nome, 'valor_pago', v_valor, 'forma', v_forma, 'data', v_data,
      'aviso', 'Pago no banco, mas a parcela já estava baixada no sistema: nenhum recibo novo foi feito — confira se não há recibo em dobro.');
  end if;
  if b.ordem_id is not null then select * into o from public.ordens where id = b.ordem_id; end if;
  v_veic := nullif(trim(concat_ws(' ', o.veiculo->>'marca', o.veiculo->>'modelo')), '');
  -- "Referente a" como a tela (referenteOS + parcela)
  v_ref := case when o.id is null then 'pagamento' else 'pagamento da Ordem de Serviço nº ' || lpad(o.numero::text, 5, '0')
    || case when coalesce(o.veiculo->>'placa', '') <> '' then ' – ' || coalesce(v_veic || ' ', '') || 'placa '
         || case when (o.veiculo->>'placa') ~ '^[A-Z]{3}[0-9]{4}$' then left(o.veiculo->>'placa', 3) || '-' || right(o.veiculo->>'placa', 4) else o.veiculo->>'placa' end
       else '' end end
    || case when pa.id is not null and pa.parcelas > 1 then ' (parcela ' || pa.parcela || '/' || pa.parcelas || ')' else '' end;
  v_conta := coalesce(nullif(cfg->'cobranca'->>'contaEntrada', ''), 'Sicredi');
  v_nn := case when length(b.nosso_numero) = 9 then substr(b.nosso_numero, 1, 2) || '/' || substr(b.nosso_numero, 3, 6) || '-' || substr(b.nosso_numero, 9, 1) else b.nosso_numero end;
  insert into public.recibos (ordem_id, cliente_id, pagador, doc, valor, referente, forma, conta_destino, data, obs, emitido_por)
  values (b.ordem_id, b.cliente_id, coalesce(nullif(b.pagador_nome, ''), 'Cliente'), coalesce(b.pagador_doc, ''), v_valor, v_ref, v_forma, v_conta, v_data,
    'Boleto Sicredi ' || v_nn || case when v_valor > b.valor + 0.009 then '; inclui ' || public.agente_reais(v_valor - b.valor) || ' de juros/multa' else '' end || '.', v_quem)
  returning * into r;
  if pa.id is not null then
    v_parte := least(v_valor, pa.valor);
    if pa.valor - v_parte > 0.009 then
      insert into public.receber (ordem_id, cliente_id, cliente_nome, descricao, forma, parcela, parcelas, valor, vencimento, obs, criado_por)
      values (pa.ordem_id, pa.cliente_id, pa.cliente_nome, pa.descricao, pa.forma, pa.parcela, pa.parcelas, round(pa.valor - v_parte, 2), pa.vencimento,
              'Restante após pagamento parcial de ' || public.agente_reais(v_parte), v_quem);
      update public.receber set status = 'paga', pago_em = v_data, recibo_id = r.id, valor = round(v_parte, 2) where id = pa.id;
    else
      update public.receber set status = 'paga', pago_em = v_data, recibo_id = r.id where id = pa.id;
    end if;
  end if;
  update public.boletos set recibo_id = r.id where id = b.id;
  if b.ordem_id is not null then
    insert into public.eventos (ordem_id, tipo, texto, usuario_nome)
    values (b.ordem_id, 'recibo', 'Boleto Sicredi pago (' || v_forma || '): ' || public.agente_reais(v_valor) || ' em ' || to_char(v_data, 'DD/MM/YYYY') || ' (agente, Claude).', v_quem);
  end if;
  perform public.agente_registrar('boleto_pago', p, 'boletos', b.id::text, to_jsonb(b), jsonb_build_object('recibo', r.numero, 'valor', v_valor));
  return jsonb_build_object('nosso_numero', b.nosso_numero, 'pagador', b.pagador_nome, 'os', o.numero, 'valor_pago', v_valor, 'forma', v_forma, 'data', v_data,
    'recibo', r.numero, 'conta', v_conta, 'parcela_baixada', pa.id is not null, 'os_fechada', (select finalizada_em is not null from public.ordens where id = b.ordem_id));
end $$;

-- p: id ou nosso_numero; situacao (registrado | baixado | rejeitado | baixa_pedida); ocorrencia
create or replace function public.agente_boleto_situacao(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare b public.boletos; v_sit text := lower(coalesce(p->>'situacao', ''));
begin
  perform public.agente_exige_admin();
  if v_sit not in ('registrado', 'baixado', 'rejeitado', 'baixa_pedida', '') then raise exception 'situacao deve ser registrado, baixado, rejeitado ou baixa_pedida.'; end if;
  select * into b from public.boletos where (coalesce(p->>'id', '') <> '' and id = (p->>'id')::uuid) or (coalesce(p->>'nosso_numero', '') <> '' and nosso_numero = regexp_replace(p->>'nosso_numero', '\D', '', 'g')) for update;
  if b.id is null then raise exception 'Boleto não encontrado.'; end if;
  if b.situacao = 'pago' then raise exception 'O boleto % já está pago.', b.nosso_numero; end if;
  update public.boletos set situacao = coalesce(nullif(v_sit, ''), situacao), ocorrencia = coalesce(nullif(p->>'ocorrencia', ''), ocorrencia) where id = b.id;
  perform public.agente_registrar('boleto_situacao', p, 'boletos', b.id::text, jsonb_build_object('situacao', b.situacao, 'ocorrencia', b.ocorrencia),
    jsonb_build_object('situacao', coalesce(nullif(v_sit, ''), b.situacao), 'ocorrencia', coalesce(nullif(p->>'ocorrencia', ''), b.ocorrencia)));
  return jsonb_build_object('nosso_numero', b.nosso_numero, 'pagador', b.pagador_nome, 'valor', b.valor, 'situacao_antes', b.situacao, 'situacao', coalesce(nullif(v_sit, ''), b.situacao));
end $$;

-- ---------- pedidos de compra (cupons, pré-vendas): conferir, voltar, cancelar, editar ----------
-- p: acao (conferir | reabrir | cancelar | editar); ids [..] ou id; conta_id (conferir: conta paga que cobriu); campos {documento, data, total, obs, os_numero, placa} (editar)
create or replace function public.agente_pedido_compra(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare v_acao text := lower(coalesce(p->>'acao', '')); v_ids uuid[]; v_antes jsonb; v_campos jsonb; v_cols text; v_n int; o public.ordens;
begin
  perform public.agente_exige_admin();
  if v_acao not in ('conferir', 'reabrir', 'cancelar', 'editar') then raise exception 'acao deve ser conferir, reabrir, cancelar ou editar.'; end if;
  v_ids := coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p->'ids', '[]')) x), '{}');
  if coalesce(p->>'id', '') <> '' then v_ids := v_ids || (p->>'id')::uuid; end if;
  if cardinality(v_ids) = 0 then raise exception 'Informe id ou ids dos pedidos (veja pre_notas).'; end if;
  select count(*), coalesce(jsonb_agg(to_jsonb(x)), '[]') into v_n, v_antes from public.pre_notas x where x.id = any (v_ids);
  if v_n <> cardinality(v_ids) then raise exception 'Algum pedido não foi encontrado (confira os ids em pre_notas).'; end if;
  if v_acao = 'conferir' then
    if exists (select 1 from public.pre_notas where id = any (v_ids) and situacao = 'cancelada') then raise exception 'Pedido cancelado não é conferido (reabra antes).'; end if;
    if coalesce(p->>'conta_id', '') <> '' and not exists (select 1 from public.contas where id = (p->>'conta_id')::uuid) then raise exception 'Conta % não encontrada.', p->>'conta_id'; end if;
    update public.pre_notas set situacao = 'conferida', conferida_em = now(), conferida_por = public.agente_quem(),
      conta_id = coalesce(nullif(p->>'conta_id', '')::uuid, conta_id) where id = any (v_ids);
  elsif v_acao = 'reabrir' then
    update public.pre_notas set situacao = 'aberta', conferida_em = null, conferida_por = '', conta_id = null where id = any (v_ids);
  elsif v_acao = 'cancelar' then
    update public.pre_notas set situacao = 'cancelada' where id = any (v_ids);
  else
    if cardinality(v_ids) <> 1 then raise exception 'Edite um pedido por vez.'; end if;
    v_campos := public.agente_campos('pre_notas', p->'campos', array['id', 'situacao', 'conferida_em', 'conferida_por', 'conta_id', 'criado_em', 'atualizado_em', 'criado_por', 'fotos', 'triangulada_em', 'ordem_id']);
    if v_campos ? 'os_numero' and coalesce(v_campos->>'os_numero', '') <> '' then
      select * into o from public.ordens where numero = (v_campos->>'os_numero')::int order by criado_em desc limit 1;
      if o.id is null then raise exception 'O.S. % não encontrada.', v_campos->>'os_numero'; end if;
      v_campos := v_campos || jsonb_build_object('ordem_id', o.id, 'placa', coalesce(nullif(v_campos->>'placa', ''), o.veiculo->>'placa', ''));
    end if;
    if v_campos = '{}'::jsonb then raise exception 'Informe os campos.'; end if;
    perform jsonb_populate_record(null::public.pre_notas, v_campos);
    select string_agg(format('%I = r.%I', x, x), ', ') into v_cols from jsonb_object_keys(v_campos) x;
    execute format('update public.pre_notas t set %s from jsonb_populate_record(null::public.pre_notas, $1) r where t.id = $2', v_cols) using v_campos, v_ids[1];
  end if;
  perform public.agente_registrar('pedido_compra', p, 'pre_notas', array_to_string(v_ids, ','), v_antes,
    (select jsonb_agg(to_jsonb(x)) from public.pre_notas x where x.id = any (v_ids)));
  return jsonb_build_object('acao', v_acao, 'pedidos', (select jsonb_agg(jsonb_build_object('id', x.id, 'fornecedor', coalesce(nullif(x.fornecedor_nome, ''), f.fantasia, f.razao),
    'documento', x.documento, 'data', x.data, 'total', x.total, 'situacao', x.situacao, 'os', x.os_numero) order by x.data)
    from public.pre_notas x left join public.fornecedores f on f.id = x.fornecedor_id where x.id = any (v_ids)));
end $$;

-- ---------- parcelas a receber: combinar prazo (O.S. entregue), editar, cancelar ----------
-- p: acao: combinar_prazo (numero da O.S., forma, parcelas [{valor, vencimento}]) | editar (id; vencimento, forma, obs) | cancelar (id, motivo)
create or replace function public.agente_parcela(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare v_acao text := lower(coalesce(p->>'acao', '')); o public.ordens; pa public.receber; v_rec numeric; v_ab numeric; v_saldo numeric; v_sem numeric; v_soma numeric := 0;
  v_n int; v_forma text; v_formas text[]; x jsonb; v_quem text := public.agente_quem(); v_venc date;
begin
  perform public.agente_exige_admin();
  if v_acao = 'combinar_prazo' then
    if coalesce(p->>'numero', '') !~ '^\s*[0-9]+\s*$' then raise exception 'Informe o número da O.S.'; end if;
    select * into o from public.ordens where numero = (p->>'numero')::int order by criado_em desc limit 1 for update;
    if o.id is null then raise exception 'O.S. % não encontrada.', p->>'numero'; end if;
    if not (o.status = 'entregue' and o.finalizada_em is null) then
      raise exception 'A O.S. % está "%": combinar prazo vale para O.S. entregue a receber (na entrega, use alterar_os acao=entregar com parcelas).', o.numero, public.agente_etapa(o); end if;
    select coalesce(sum(valor), 0) into v_rec from public.recibos where ordem_id = o.id and not cancelado;
    select coalesce(sum(valor), 0) into v_ab from public.receber where ordem_id = o.id and status = 'aberta';
    v_saldo := round(greatest(0, o.total - v_rec), 2); v_sem := round(greatest(0, v_saldo - v_ab), 2);
    if v_sem <= 0.009 then raise exception 'A O.S. % não tem saldo sem prazo (saldo %, parcelas em aberto %).', o.numero, public.agente_reais(v_saldo), public.agente_reais(v_ab); end if;
    -- formas de receber da tela (formasReceber em js/telas/receber.js): as de Ajustes + Boleto + Promissória
    v_formas := array(select distinct fz from unnest(coalesce((select array_agg(y) from public.config, jsonb_array_elements_text(dados->'formasPagamento') y where id = 1), '{}') || array['Boleto', 'Promissória']) fz);
    select f into v_forma from unnest(v_formas) f where lower(public.unaccent_simples(f)) = lower(public.unaccent_simples(trim(coalesce(p->>'forma', '')))) limit 1;
    if v_forma is null then raise exception 'Forma "%" não existe. Use uma destas: %.', coalesce(p->>'forma', ''), array_to_string(v_formas, ', '); end if;
    if jsonb_typeof(p->'parcelas') is distinct from 'array' or jsonb_array_length(p->'parcelas') = 0 then raise exception 'Informe parcelas [{valor, vencimento}].'; end if;
    v_n := jsonb_array_length(p->'parcelas');
    if v_n > 1 and v_forma not in ('Boleto', 'Promissória', 'Cheque', 'Cartão de crédito') then raise exception '% não é parcelável: use uma parcela só.', v_forma; end if;
    for x in select * from jsonb_array_elements(p->'parcelas') loop
      if jsonb_typeof(x->'valor') <> 'number' or (x->>'valor')::numeric <= 0 or coalesce(x->>'vencimento', '') !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'Cada parcela precisa de valor e vencimento (AAAA-MM-DD).'; end if;
      v_soma := v_soma + round((x->>'valor')::numeric, 2);
    end loop;
    if abs(v_soma - v_sem) > 0.009 then raise exception 'As parcelas somam % e o saldo sem prazo é %: a soma precisa ser igual.', public.agente_reais(v_soma), public.agente_reais(v_sem); end if;
    insert into public.receber (ordem_id, cliente_id, cliente_nome, descricao, forma, parcela, parcelas, valor, vencimento, obs, criado_por)
    select o.id, o.cliente_id, coalesce(o.cliente->>'nome', ''), 'OS ' || lpad(o.numero::text, 5, '0') || ' · ' || coalesce(o.veiculo->>'placa', ''), v_forma, y.n, v_n,
           round((y.e->>'valor')::numeric, 2), (y.e->>'vencimento')::date, 'Lançado pelo agente (Claude).', v_quem
    from jsonb_array_elements(p->'parcelas') with ordinality y(e, n);
    if coalesce(o.forma_pagamento, '') = '' then perform public.agente_patch_os(o.id, jsonb_build_object('forma_pagamento', v_forma)); end if;
    insert into public.eventos (ordem_id, tipo, texto, usuario_nome)
    values (o.id, 'prazo', 'Pagamento a prazo: ' || v_forma || ', ' || (select string_agg(public.agente_reais((e->>'valor')::numeric) || ' em ' || to_char((e->>'vencimento')::date, 'DD/MM/YYYY'), '; ')
      from jsonb_array_elements(p->'parcelas') e) || ' (agente, Claude).', v_quem);
    perform public.agente_registrar('parcela', p, 'receber', o.id::text, null, p->'parcelas');
    return jsonb_build_object('acao', v_acao, 'os', o.numero, 'cliente', o.cliente->>'nome', 'forma', v_forma, 'saldo_sem_prazo', v_sem,
      'parcelas', (select jsonb_agg(jsonb_build_object('parcela', r.parcela || '/' || r.parcelas, 'valor', r.valor, 'vencimento', r.vencimento) order by r.parcela)
                   from public.receber r where r.ordem_id = o.id and r.status = 'aberta'));
  end if;
  if v_acao not in ('editar', 'cancelar') then raise exception 'acao deve ser combinar_prazo, editar ou cancelar.'; end if;
  select * into pa from public.receber where id = nullif(p->>'id', '')::uuid for update;
  if pa.id is null then raise exception 'Parcela não encontrada (informe o id; veja contas_a_receber ou buscar_os).'; end if;
  if pa.status <> 'aberta' then raise exception 'A parcela está "%": só parcela em aberto muda.', pa.status; end if;
  if exists (select 1 from public.boletos b where b.receber_id = pa.id and b.situacao in ('gerado', 'enviado', 'registrado', 'baixa_pedida')) then
    raise exception 'A parcela tem boleto Sicredi no banco: peça a baixa do boleto antes (boleto acao=pedir_baixa).'; end if;
  if v_acao = 'cancelar' then
    update public.receber set status = 'cancelada', obs = trim(coalesce(obs, '') || ' Cancelada pelo agente (Claude)' || coalesce(': ' || nullif(trim(p->>'motivo'), ''), '') || '.') where id = pa.id;
    if pa.ordem_id is not null then
      insert into public.eventos (ordem_id, tipo, texto, usuario_nome) values (pa.ordem_id, 'prazo', 'Parcela ' || pa.parcela || '/' || pa.parcelas || ' de ' || public.agente_reais(pa.valor)
        || ' cancelada (agente, Claude)' || coalesce(': ' || nullif(trim(p->>'motivo'), ''), '') || '.', v_quem);
    end if;
  else
    v_venc := case when coalesce(p->>'vencimento', '') <> '' then public.agente_data(p->>'vencimento', true) else pa.vencimento end;
    if coalesce(p->>'forma', '') <> '' then
      v_formas := array(select distinct fz from unnest(coalesce((select array_agg(y) from public.config, jsonb_array_elements_text(dados->'formasPagamento') y where id = 1), '{}') || array['Boleto', 'Promissória']) fz);
      select f into v_forma from unnest(v_formas) f where lower(public.unaccent_simples(f)) = lower(public.unaccent_simples(trim(p->>'forma'))) limit 1;
      if v_forma is null then raise exception 'Forma "%" não existe. Use uma destas: %.', p->>'forma', array_to_string(v_formas, ', '); end if;
    end if;
    if p ? 'valor' then raise exception 'O valor da parcela não muda por aqui: use desconto_os (desconto) ou cancelar e combinar o prazo de novo.'; end if;
    update public.receber set vencimento = v_venc, forma = coalesce(v_forma, forma), obs = case when p ? 'obs' then trim(coalesce(p->>'obs', '')) else obs end where id = pa.id;
  end if;
  perform public.agente_registrar('parcela', p, 'receber', pa.id::text, to_jsonb(pa), (select to_jsonb(r) from public.receber r where r.id = pa.id));
  return (select jsonb_build_object('acao', v_acao, 'parcela', r.parcela || '/' || r.parcelas, 'cliente', r.cliente_nome, 'valor', r.valor, 'vencimento', r.vencimento,
    'forma', r.forma, 'situacao', r.status) from public.receber r where r.id = pa.id);
end $$;

-- ---------- despesa fixa (v43): tornar uma conta fixa ou encerrar a sequência ----------
-- p: acao (tornar | encerrar); id da conta (contas_a_pagar) ou busca
create or replace function public.agente_despesa_fixa(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare v_acao text := lower(coalesce(p->>'acao', '')); c public.contas; r jsonb; v_n int; v_cand jsonb;
begin
  perform public.agente_exige_admin();
  if v_acao not in ('tornar', 'encerrar') then raise exception 'acao deve ser tornar ou encerrar.'; end if;
  if coalesce(p->>'id', '') <> '' then select * into c from public.contas where id = (p->>'id')::uuid;
  elsif coalesce(trim(p->>'busca'), '') <> '' then
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'descricao', x.descricao, 'vencimento', x.vencimento, 'valor', x.valor, 'fixa', x.fixa) order by x.vencimento desc), '[]'), count(*)
      into v_cand, v_n from public.contas x where x.status <> 'cancelada' and concat_ws(' ', x.descricao, x.favorecido) ilike '%' || trim(p->>'busca') || '%'
        and (v_acao = 'tornar' or x.fixa);
    if v_n = 0 then raise exception 'Nenhuma conta % com "%".', case when v_acao = 'tornar' then '' else 'fixa' end, p->>'busca'; end if;
    if v_n > 1 and v_acao = 'tornar' then raise exception 'Achei % contas: diga qual (id): %', v_n, left(v_cand::text, 1500); end if;
    if v_acao = 'encerrar' and (select count(distinct x.grupo) from public.contas x where x.id in (select (e->>'id')::uuid from jsonb_array_elements(v_cand) e)) > 1 then
      raise exception 'Achei mais de uma despesa fixa com "%": diga qual (id): %', p->>'busca', left(v_cand::text, 1500); end if;
    select * into c from public.contas where id = (v_cand->0->>'id')::uuid;
  end if;
  if c.id is null then raise exception 'Conta não encontrada (informe id ou busca).'; end if;
  if v_acao = 'tornar' then r := public.tornar_despesa_fixa(c.id);
  else
    if not coalesce(c.fixa, false) or c.grupo is null then raise exception 'A conta "%" não é despesa fixa.', c.descricao; end if;
    r := jsonb_build_object('encerradas', public.encerrar_despesa_fixa(c.grupo));
  end if;
  perform public.agente_registrar('despesa_fixa', p, 'contas', c.id::text, to_jsonb(c), r);
  return jsonb_build_object('acao', v_acao, 'conta', c.descricao, 'valor', c.valor, 'resultado', r);
end $$;

-- ---------- Ajustes da oficina e do sistema ----------
-- p: campos {chave: valor} dos Ajustes (nome, endereco, telefone, cnpj, cidade, valorHora, markupPecas, markupTerceiros, garantiaDias,
--    validadeDias, taxaDiagnostico, impressaoVias, exigirFotos, condicoesPadrao, termoEntrada, termoOrcamento, termoGarantia,
--    textoRecibo, formasPagamento, situacoesOS, tiposCliente, categoriasDespesa, itensExtras);
--    encargos {fgts, inssPatronal, ferias, decimo} (Funcionários); rh_remetentes [e-mails]; email_ligado (true/false);
--    sefaz {buscar_automatico, ciencia_automatica}
-- Fora daqui: contas e saldos (atualizar_saldos), carteira de cobrança, espelho/importação, logotipo e o layout do painel.
-- Só na tela (revisão do #62): o número dos avisos do WhatsApp (as mensagens dele dão OK/CANCELAR/AGORA ao sistema) e o backup de
-- leitura (para onde vão todos os dados) — um texto malicioso num e-mail ou mensagem não pode levar o conector a trocá-los.
create or replace function public.agente_ajustes(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare cfg jsonb; v_patch jsonb := '{}'; k text; v jsonb; v_antes jsonb := '{}'; v_depois jsonb := '{}'; v_lista jsonb; x text; feito text[] := '{}'; r jsonb;
  c_texto text[] := array['nome', 'endereco', 'telefone', 'cnpj', 'cidade', 'condicoesPadrao', 'termoEntrada', 'termoOrcamento', 'termoGarantia', 'textoRecibo'];
  c_num text[] := array['valorHora', 'markupPecas', 'markupTerceiros', 'taxaDiagnostico'];
  c_int text[] := array['garantiaDias', 'validadeDias', 'impressaoVias'];
  c_lista text[] := array['formasPagamento', 'situacoesOS', 'tiposCliente', 'categoriasDespesa'];
begin
  perform public.agente_exige_admin();
  select dados into cfg from public.config where id = 1;
  cfg := coalesce(cfg, '{}');
  if jsonb_typeof(p->'campos') = 'object' then
    for k, v in select * from jsonb_each(p->'campos') loop
      if k = any (c_texto) then
        if jsonb_typeof(v) <> 'string' then raise exception '% deve ser texto.', k; end if;
        v := to_jsonb(trim(v #>> '{}'));
        -- telefone e CNPJ ficam como foram escritos (a impressão da O.S. e do recibo mostra o texto); o CNPJ só tem os dígitos conferidos
        if k = 'cnpj' and (v #>> '{}') <> '' and not public.agente_doc_valido(v #>> '{}') then raise exception 'CNPJ inválido.'; end if;
        if k = 'nome' and (v #>> '{}') = '' then raise exception 'O nome da oficina não pode ficar vazio.'; end if;
      elsif k = any (c_num) or k = any (c_int) then
        if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric < 0 then raise exception '% deve ser um número (zero ou mais).', k; end if;
        if k = any (c_int) and (v #>> '{}')::numeric <> trunc((v #>> '{}')::numeric) then raise exception '% deve ser um número inteiro.', k; end if;
        if k = 'impressaoVias' and (v #>> '{}')::int not between 1 and 3 then raise exception 'impressaoVias vai de 1 a 3.'; end if;
      elsif k = 'exigirFotos' then
        if jsonb_typeof(v) <> 'boolean' then raise exception 'exigirFotos deve ser true ou false.'; end if;
      elsif k = 'itensExtras' then
        -- itens extras do checklist: a tela grava {id, nome} e as respostas de cada O.S. ficam na chave "x_" + id (Codex no #62).
        -- Aceita nomes ou {id, nome}; o item que já existe (pelo id ou pelo nome) mantém o id; o novo ganha um (8 letras, como a tela)
        if jsonb_typeof(v) <> 'array' then raise exception 'itensExtras deve ser uma lista de nomes (ou de {id, nome}).'; end if;
        select coalesce(jsonb_agg(jsonb_build_object('id', coalesce(ex.id, left(gen_random_uuid()::text, 8)), 'nome', t.nome) order by t.n), '[]') into v
        from (select distinct on (lower(z.nome)) z.nome, z.id_dado, z.n from (
                select trim(case when jsonb_typeof(e) = 'object' then e->>'nome' else e #>> '{}' end) nome,
                       case when jsonb_typeof(e) = 'object' then nullif(e->>'id', '') end id_dado, n
                from jsonb_array_elements(v) with ordinality a(e, n)) z
              where coalesce(z.nome, '') <> '' order by lower(z.nome), z.n) t
        left join lateral (select ie->>'id' id from jsonb_array_elements(coalesce(cfg->'itensExtras', '[]')) with ordinality w(ie, m)
                           where (t.id_dado is not null and ie->>'id' = t.id_dado) or lower(trim(ie->>'nome')) = lower(t.nome)
                           order by (t.id_dado is not null and ie->>'id' = t.id_dado) desc, m limit 1) ex on true;
      elsif k = any (c_lista) then
        if jsonb_typeof(v) <> 'array' then raise exception '% deve ser uma lista de textos.', k; end if;
        select coalesce(jsonb_agg(distinct trim(e)), '[]') into v_lista from jsonb_array_elements_text(v) e where trim(e) <> '';
        -- a ordem que o Danilo mandou (sem repetir)
        select coalesce(jsonb_agg(t.e order by t.n), '[]') into v from (select distinct on (lower(trim(e))) trim(e) e, n from jsonb_array_elements_text(v) with ordinality a(e, n)
          where trim(e) <> '' order by lower(trim(e)), n) t;
        if k = 'formasPagamento' and jsonb_array_length(v) = 0 then raise exception 'A lista de formas de pagamento não pode ficar vazia.'; end if;
      else
        raise exception 'O ajuste "%" não muda por aqui. Ajustes: %, %, %, exigirFotos, itensExtras, %.', k, array_to_string(c_texto, ', '), array_to_string(c_num, ', '),
          array_to_string(c_int, ', '), array_to_string(c_lista, ', ');
      end if;
      v_antes := v_antes || jsonb_build_object(k, cfg->k); v_patch := v_patch || jsonb_build_object(k, v);
    end loop;
  end if;
  if jsonb_typeof(p->'encargos') = 'object' then
    for k, v in select * from jsonb_each(p->'encargos') loop
      if k not in ('fgts', 'inssPatronal', 'ferias', 'decimo') then raise exception 'Encargo "%" não existe: fgts, inssPatronal, ferias, decimo.', k; end if;
      if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric not between 0 and 100 then raise exception 'Encargo % deve ser um percentual de 0 a 100.', k; end if;
    end loop;
    v_antes := v_antes || jsonb_build_object('encargos', cfg->'encargos');
    v_patch := v_patch || jsonb_build_object('encargos', coalesce(cfg->'encargos', '{}') || (p->'encargos'));
  end if;
  if p ? 'backup_leitura' or p ? 'whatsapp_alerta' then
    raise exception 'O backup de leitura e o número dos avisos do WhatsApp só mudam na tela (Sistema › Backup e Sistema › WhatsApp): são proteções contra ordem falsa.';
  end if;
  if jsonb_typeof(p->'rh_remetentes') = 'array' then
    select coalesce(jsonb_agg(distinct lower(trim(e))), '[]') into v_lista from jsonb_array_elements_text(p->'rh_remetentes') e where trim(e) <> '';
    if jsonb_array_length(v_lista) = 0 then raise exception 'Informe pelo menos um e-mail da contabilidade.'; end if;
    for x in select jsonb_array_elements_text(v_lista) loop
      if x !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-mail inválido: %.', x; end if;
    end loop;
    v_antes := v_antes || jsonb_build_object('rh', cfg->'rh'); v_patch := v_patch || jsonb_build_object('rh', coalesce(cfg->'rh', '{}') || jsonb_build_object('remetentes', v_lista));
  end if;
  if v_patch <> '{}'::jsonb then
    update public.config set dados = coalesce(dados, '{}') || v_patch, atualizado_em = now() where id = 1;
    if not found then insert into public.config (id, dados) values (1, v_patch); end if;
    v_depois := v_patch;
    feito := array_append(feito, 'ajustes: ' || (select string_agg(kk, ', ') from jsonb_object_keys(v_patch) kk));
  end if;
  -- e-mail e SEFAZ (as mesmas funções das telas)
  if p ? 'email_ligado' then
    if jsonb_typeof(p->'email_ligado') <> 'boolean' then raise exception 'email_ligado deve ser true ou false.'; end if;
    perform public.email_ligar((p->>'email_ligado')::boolean);
    v_depois := v_depois || jsonb_build_object('email_ligado', p->'email_ligado'); feito := array_append(feito, 'e-mail ' || case when (p->>'email_ligado')::boolean then 'ligado' else 'desligado' end);
  end if;
  if jsonb_typeof(p->'sefaz') = 'object' then
    r := public.agente_nota_sefaz(jsonb_build_object('acao', 'configurar') || (p->'sefaz'));
    v_depois := v_depois || jsonb_build_object('sefaz', r); feito := array_append(feito, 'Notas da SEFAZ');
  end if;
  if array_length(feito, 1) is null then raise exception 'Nada a mudar: informe campos, encargos, rh_remetentes, email_ligado ou sefaz.'; end if;
  perform public.agente_registrar('ajustes', p, 'config', '1', v_antes, v_depois);
  return jsonb_build_object('feito', to_jsonb(feito), 'antes', v_antes, 'depois', v_depois,
    'aviso', 'As telas abertas pegam os ajustes novos ao recarregar (ou no próximo minuto).');
end $$;

-- ---------- Equipe (acessos ao sistema) ----------
-- p: perfil (id, e-mail ou nome); papel (admin | consultor | mecanico | pendente); ativo (true/false); nome
create or replace function public.agente_equipe(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare u public.perfis; v_busca text := trim(coalesce(p->>'perfil', p->>'id', '')); v_n int; v_cand text; v_papel text := lower(coalesce(p->>'papel', '')); v_antes jsonb;
begin
  perform public.agente_exige_admin();
  if v_busca = '' then raise exception 'Informe o perfil (id, e-mail ou nome; veja consultar tabela=perfis).'; end if;
  if v_busca ~* '^[0-9a-f]{8}-[0-9a-f]{4}-' then select * into u from public.perfis where id = v_busca::uuid;
  else
    -- igual (e-mail ou nome) primeiro; parte do nome/e-mail só quando não há igual — e só se for um (Codex no #62: "Ana" não pega "Mariana")
    select count(*), string_agg(nome || ' <' || email || '>', '; ') into v_n, v_cand from public.perfis
      where lower(email) = lower(v_busca) or lower(public.unaccent_simples(nome)) = lower(public.unaccent_simples(v_busca));
    if v_n = 1 then
      select * into u from public.perfis where lower(email) = lower(v_busca) or lower(public.unaccent_simples(nome)) = lower(public.unaccent_simples(v_busca));
    elsif v_n > 1 then raise exception 'Mais de um acesso com "%": %. Use o e-mail.', v_busca, v_cand;
    else
      select count(*), string_agg(nome || ' <' || email || '>', '; ') into v_n, v_cand from public.perfis
        where lower(public.unaccent_simples(nome || ' ' || email)) like '%' || lower(public.unaccent_simples(v_busca)) || '%';
      if v_n > 1 then raise exception 'Mais de um acesso com "%": %.', v_busca, v_cand; end if;
      select * into u from public.perfis where lower(public.unaccent_simples(nome || ' ' || email)) like '%' || lower(public.unaccent_simples(v_busca)) || '%';
    end if;
  end if;
  if u.id is null then raise exception 'Acesso "%" não encontrado.', v_busca; end if;
  v_antes := to_jsonb(u);
  if v_papel <> '' and v_papel not in ('admin', 'consultor', 'mecanico', 'pendente') then raise exception 'papel deve ser admin, consultor, mecanico ou pendente.'; end if;
  if p ? 'ativo' and jsonb_typeof(p->'ativo') <> 'boolean' then raise exception 'ativo deve ser true ou false.'; end if;
  if u.id = auth.uid() and (v_papel <> '' and v_papel <> u.papel or (p ? 'ativo' and not (p->>'ativo')::boolean)) then
    raise exception 'Você não pode mudar o seu próprio papel nem se desativar (peça a outro administrador).'; end if;
  -- sempre fica pelo menos um administrador ativo
  if u.papel = 'admin' and u.ativo and ((v_papel <> '' and v_papel <> 'admin') or (p ? 'ativo' and not (p->>'ativo')::boolean))
     and not exists (select 1 from public.perfis where papel = 'admin' and ativo and id <> u.id) then
    raise exception 'O sistema ficaria sem administrador ativo.'; end if;
  if v_papel = '' and not (p ? 'ativo') and coalesce(trim(p->>'nome'), '') = '' then raise exception 'Informe papel, ativo ou nome.'; end if;
  update public.perfis set papel = coalesce(nullif(v_papel, ''), papel), ativo = coalesce((p->>'ativo')::boolean, ativo),
    nome = coalesce(nullif(trim(p->>'nome'), ''), nome) where id = u.id returning * into u;
  perform public.agente_registrar('equipe', p, 'perfis', u.id::text, v_antes, to_jsonb(u));
  return jsonb_build_object('nome', u.nome, 'email', u.email, 'papel', u.papel, 'ativo', u.ativo,
    'papel_antes', v_antes->>'papel', 'ativo_antes', (v_antes->>'ativo')::boolean);
end $$;

-- ---------- Site institucional (rascunho do editor e publicação; v47/v48) ----------
-- p: acao: ler (resumo do rascunho e da versão no ar) | alterar (alteracoes [{caminho: ["secoes", 2, "titulo"] ou "secoes.2.titulo", valor}])
--          | publicar (observacao) | voltar_versao (versao: id de site_publicacoes → vira o rascunho)
create or replace function public.agente_site(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare v_acao text := lower(coalesce(p->>'acao', 'ler')); d jsonb; v_novo jsonb; a jsonb; v_cam text[]; v_lista jsonb := '[]'; pub public.site_publicacoes; v_id bigint;
begin
  perform public.agente_exige_admin();
  select dados into d from public.site_rascunho where id = 1;
  if v_acao = 'ler' then
    select * into pub from public.site_publicacoes order by id desc limit 1;
    return jsonb_build_object('rascunho', d, 'no_ar', jsonb_build_object('versao', pub.id, 'publicado_em', pub.publicado_em, 'observacao', pub.observacao),
      'rascunho_igual_ao_no_ar', d is not distinct from pub.dados);
  end if;
  if v_acao = 'alterar' then
    if d is null then raise exception 'O site ainda não tem rascunho: abra o editor do site uma vez (rodapé › Editar site).'; end if;
    if jsonb_typeof(p->'alteracoes') is distinct from 'array' or jsonb_array_length(p->'alteracoes') = 0 then raise exception 'Informe alteracoes [{caminho, valor}].'; end if;
    v_novo := d;
    for a in select * from jsonb_array_elements(p->'alteracoes') loop
      v_cam := case jsonb_typeof(a->'caminho') when 'array' then array(select jsonb_array_elements_text(a->'caminho')) when 'string' then string_to_array(a->>'caminho', '.') end;
      if v_cam is null or cardinality(v_cam) = 0 then raise exception 'Cada alteração precisa de caminho (lista ou "a.b.0.c").'; end if;
      if not (a ? 'valor') then raise exception 'Cada alteração precisa de valor.'; end if;
      -- só muda o que existe (ou acrescenta uma chave num objeto que existe)
      if cardinality(v_cam) > 1 and jsonb_typeof(v_novo #> v_cam[1:cardinality(v_cam) - 1]) is null then
        raise exception 'O caminho % não existe no site (veja site acao=ler).', array_to_string(v_cam, '.'); end if;
      if v_novo #> v_cam is null and jsonb_typeof(v_novo #> v_cam[1:cardinality(v_cam) - 1]) = 'array' then
        raise exception 'O item % não existe na lista.', array_to_string(v_cam, '.'); end if;
      v_lista := v_lista || jsonb_build_array(jsonb_build_object('caminho', array_to_string(v_cam, '.'), 'antes', v_novo #> v_cam, 'depois', a->'valor'));
      v_novo := jsonb_set(v_novo, v_cam, a->'valor', true);
    end loop;
    if octet_length(v_novo::text) > 300000 then raise exception 'O conteúdo do site passou do tamanho máximo.'; end if;
    update public.site_rascunho set dados = v_novo, atualizado_em = now() where id = 1;
    perform public.agente_registrar('site', p, 'site_rascunho', '1', d, v_novo);
    return jsonb_build_object('acao', 'alterar', 'alteracoes', v_lista, 'aviso', 'Mudou o rascunho. Para ir ao ar: site acao=publicar.');
  end if;
  if v_acao = 'publicar' then
    if d is null then raise exception 'O site ainda não tem rascunho.'; end if;
    insert into public.site_publicacoes (dados, observacao) values (d, left(trim(coalesce(p->>'observacao', '')) || ' (agente, Claude)', 200)) returning * into pub;
    perform public.agente_registrar('site', p, 'site_publicacoes', pub.id::text, null, jsonb_build_object('versao', pub.id));
    return jsonb_build_object('acao', 'publicar', 'versao', pub.id, 'publicado_em', pub.publicado_em, 'site', 'https://dtcarcentroautomotivo.com.br');
  end if;
  if v_acao = 'voltar_versao' then
    v_id := nullif(p->>'versao', '')::bigint;
    select * into pub from public.site_publicacoes where id = v_id;
    if pub.id is null then raise exception 'Versão % não encontrada (veja consultar tabela=site_publicacoes).', p->>'versao'; end if;
    update public.site_rascunho set dados = pub.dados, atualizado_em = now() where id = 1;
    if not found then insert into public.site_rascunho (id, dados) values (1, pub.dados); end if;
    perform public.agente_registrar('site', p, 'site_rascunho', '1', d, pub.dados);
    return jsonb_build_object('acao', 'voltar_versao', 'versao', pub.id, 'aviso', 'O rascunho voltou para a versão ' || pub.id || '. Para ir ao ar: site acao=publicar.');
  end if;
  raise exception 'acao deve ser ler, alterar, publicar ou voltar_versao.';
end $$;

-- ---------- Documentos do RH: mudar tipo/mês/título/observação ou excluir (o arquivo sai da pasta pela ferramenta) ----------
-- p: id; acao (editar | excluir); tipo, mes (AAAA-MM), titulo, obs
create or replace function public.agente_rh_documento(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare dc public.rh_documentos; v_acao text := lower(coalesce(p->>'acao', 'editar'));
begin
  perform public.agente_exige_admin();
  select * into dc from public.rh_documentos where id = nullif(p->>'id', '')::uuid for update;
  if dc.id is null then raise exception 'Documento não encontrado (veja rh_documentos).'; end if;
  if v_acao = 'excluir' then
    delete from public.rh_documentos where id = dc.id;
    perform public.agente_registrar('rh_documento', p, 'rh_documentos', dc.id::text, to_jsonb(dc), jsonb_build_object('excluido', true));
    return jsonb_build_object('acao', 'excluir', 'excluido', true, 'titulo', dc.titulo, 'arquivo', dc.arquivo);
  end if;
  if v_acao <> 'editar' then raise exception 'acao deve ser editar ou excluir.'; end if;
  if coalesce(p->>'tipo', '') <> '' and p->>'tipo' not in ('recibo', 'adiantamento', 'pro_labore', 'folha_ponto', 'darf', 'fgts', 'das', 'inss', 'laudo', 'epi', 'outro') then
    raise exception 'tipo deve ser recibo, adiantamento, pro_labore, folha_ponto, darf, fgts, das, inss, laudo, epi ou outro.'; end if;
  if coalesce(p->>'mes', '') <> '' and p->>'mes' !~ '^\d{4}-\d{2}$' then raise exception 'mes no formato AAAA-MM.'; end if;
  update public.rh_documentos set tipo = coalesce(nullif(p->>'tipo', ''), tipo), competencia = coalesce(nullif(p->>'mes', ''), competencia),
    titulo = coalesce(nullif(trim(p->>'titulo'), ''), titulo), obs = case when p ? 'obs' then trim(coalesce(p->>'obs', '')) else obs end, atualizado_em = now()
  where id = dc.id returning * into dc;
  perform public.agente_registrar('rh_documento', p, 'rh_documentos', dc.id::text, null, to_jsonb(dc));
  return jsonb_build_object('acao', 'editar', 'id', dc.id, 'tipo', dc.tipo, 'mes', dc.competencia, 'titulo', dc.titulo, 'obs', dc.obs);
end $$;

-- =====================================================================
-- 4. Entrada única do conector com as ações novas (as do v40, v41 e v42 continuam)
-- =====================================================================
create or replace function public.agente_fazer(p_acao text, p jsonb, p_gravar boolean default false) returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare v jsonb; v_fn text;
begin
  perform public.agente_exige_admin();
  v_fn := case p_acao
    when 'alterar_os' then 'agente_alterar_os_v50' when 'salvar_cadastro' then 'agente_salvar_cadastro'
    when 'conta_pagar' then 'agente_conta' when 'atualizar_saldos' then 'agente_guardar_saldos'
    when 'transferir' then 'agente_transferencia' when 'cancelar_recibo' then 'agente_recibo'
    when 'movimentar_estoque' then 'agente_movimentar_estoque' when 'produto' then 'agente_produto'
    when 'boleto_preparar' then 'agente_boleto_preparar' when 'boleto_gravar' then 'agente_boleto_gravar' when 'boleto_desfazer' then 'agente_boleto_desfazer'
    when 'entrada_nota' then 'agente_entrada_nfe'
    -- v50
    when 'desconto_os' then 'agente_desconto_os' when 'fornecedor' then 'agente_fornecedor' when 'venda_balcao' then 'agente_venda'
    when 'recibo_avulso' then 'agente_recibo_avulso' when 'funcionario' then 'agente_funcionario' when 'nota_sefaz' then 'agente_nota_sefaz'
    when 'boleto_pago' then 'agente_boleto_pago' when 'boleto_situacao' then 'agente_boleto_situacao' when 'pedido_compra' then 'agente_pedido_compra'
    when 'parcela' then 'agente_parcela' when 'despesa_fixa' then 'agente_despesa_fixa' when 'ajustes' then 'agente_ajustes'
    when 'equipe' then 'agente_equipe' when 'site' then 'agente_site' when 'rh_documento' then 'agente_rh_documento' end;
  if v_fn is null then raise exception 'Ação desconhecida: %', p_acao; end if;
  perform set_config('dtcar.agente_previa', case when coalesce(p_gravar, false) then 'nao' else 'sim' end, true);
  begin
    execute format('select public.%I($1)', v_fn) into v using coalesce(p, '{}'::jsonb);
    if not coalesce(p_gravar, false) then raise exception using errcode = 'DT001', message = 'previa'; end if;
  exception when sqlstate 'DT001' then
    return v || jsonb_build_object('gravado', false, 'previa', true);
  end;
  return v || jsonb_build_object('gravado', true);
end $$;

-- ---------- permissões ----------
do $$
declare f text;
begin
  foreach f in array array['tecnicos_lista()', 'agente_tecnico(text)', 'agente_em_previa()', 'venda_travar(uuid)', 'os_valor_itens(uuid)', 'os_aplicar_desconto(uuid, numeric, text, boolean)',
    'agente_doc_valido(text)', 'agente_forma_valida(text)', 'agente_conta_sugerida(text)', 'agente_data(text, boolean)', 'agente_desconto_os(jsonb)',
    'agente_alterar_os_v50(jsonb)', 'agente_fornecedor(jsonb)', 'agente_venda(jsonb)', 'agente_recibo_avulso(jsonb)', 'agente_funcionario(jsonb)',
    'agente_achar_nota(jsonb)', 'agente_nota_sefaz(jsonb)', 'agente_boleto_pago(jsonb)', 'agente_boleto_situacao(jsonb)', 'agente_pedido_compra(jsonb)',
    'agente_parcela(jsonb)', 'agente_despesa_fixa(jsonb)', 'agente_ajustes(jsonb)', 'agente_equipe(jsonb)', 'agente_site(jsonb)', 'agente_rh_documento(jsonb)',
    'agente_fazer(text, jsonb, boolean)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;


-- =====================================================================
-- 5. WhatsApp: as mensagens com foto mostram o foto_id (o conector anexa a foto na O.S. com anexar_na_os)
--    O mesmo whatsapp_mensagens_de do v32, só com a chave foto_id a mais.
-- =====================================================================
create or replace function public.whatsapp_mensagens_de(p_telefone text, p_limite int default 30, p_marcar_lidas boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_chave text := public.whatsapp_chave_tel(p_telefone); v jsonb; v_ids bigint[]; v_cli public.clientes;
begin
  if not public.e_admin() then raise exception 'Só o administrador vê o WhatsApp.'; end if;
  if length(regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g')) < 8 then raise exception 'Informe o telefone com DDD.'; end if;
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('em', em, 'de', case when de_mim then 'oficina' else coalesce(nullif(nome, ''), 'cliente') end,
                                               'texto', texto, 'tipo', tipo,
                                               'entrega', case when de_mim then coalesce(entrega, 'enviada') end,
                                               'entregue_em', case when de_mim then entregue_em end,
                                               'lida_em', case when de_mim then lida_em end,
                                               'foto_guardada_ate', case when midia_path is not null then midia_expira end,
                                               'foto_id', case when midia_path is not null then id end,
                                               'midia_nao_processada', midia_erro)) order by em), '[]'::jsonb), array_agg(id)
    into v, v_ids from (select * from public.whatsapp_mensagens where public.whatsapp_chave_tel(telefone) = v_chave
                  order by em desc limit least(greatest(coalesce(p_limite, 30), 1), 200)) t;
  if p_marcar_lidas then update public.whatsapp_mensagens set lida = true where id = any(v_ids) and not lida; end if;
  select * into v_cli from public.clientes where id = public.whatsapp_cliente_do_tel(p_telefone);
  return jsonb_build_object('telefone', p_telefone, 'mensagens', v,
    'cliente', case when v_cli.id is null then null else jsonb_build_object('id', v_cli.id, 'nome', v_cli.nome) end,
    'cadastrado', v_cli.id is not null,
    'os_abertas', public.whatsapp_os_abertas(v_cli.id),
    'na_fila', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'status', status, 'texto', left(texto, 120), 'erro', erro, 'criado_em', criado_em) order by id), '[]'::jsonb)
                  from public.whatsapp_fila where public.whatsapp_chave_tel(telefone) = v_chave and status in ('pendente', 'enviando', 'erro') and criado_em > now() - interval '7 days'),
    'pediu_parar', exists (select 1 from public.whatsapp_optout where telefone = v_chave),
    'sobre_a_entrega', 'entrega: enviada = chegou ao WhatsApp; entregue = chegou ao celular; lida = abriu (quem desligou a confirmação de leitura nunca aparece como lida); ouvida = áudio ouvido.');
end $$;
