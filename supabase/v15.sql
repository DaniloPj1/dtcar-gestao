-- DTCar Gestão — v15: envio das alterações de O.S. feitas sem internet no programa para Windows (etapa 3)
-- Uma função que confere e grava cada alteração NUMA TRANSAÇÃO, com a O.S. e os itens travados durante a conferência
-- (ninguém grava no meio; nada fica gravado pela metade; O.S. entregue no meio do envio não recebe item).
-- Regras de conflito (devolve {"conflito": "..."} e não grava nada):
--   - carga nova do sistema antigo (espelho) depois da alteração;
--   - O.S. apagada, ou entregue/cancelada no online depois da alteração;
--   - campo que no online não está mais como estava no PC (nem igual ao que foi feito no PC);
--   - item alterado/removido no PC cujo conteúdo mudou no online; item criado no PC que já existe com outro conteúdo.
-- p_forcar = true ("Enviar por cima", decisão do usuário): grava sem conferir.
-- Comparação pelo TIPO da coluna (datas em formatos diferentes e jsonb com chaves em outra ordem são iguais).
-- Pode rodar mais de uma vez. Não altera dados. Roda com as permissões de quem chama (RLS vale).
-- Período de transição: não cria dado operacional novo; antes e depois da virada o comportamento é o mesmo.

create or replace function public.sincronizar_alteracao_os(p_op jsonb, p_forcar boolean default false)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_tipo text := p_op->>'tipo';
  v_os uuid;
  o public.ordens%rowtype;
  oj jsonb; aj jsonb; pj jsonb;
  v_k text; v_ger text; v_cols text; v_mudou text[] := '{}';
  it jsonb; v_id uuid; cur public.os_itens%rowtype; cj jsonb; bj jsonb; mj jsonb; v_base jsonb;
  v_igual boolean; v_intacto boolean;
  c_ordens text[] := (select array_agg(attname::text) from pg_attribute where attrelid = 'public.ordens'::regclass and attnum > 0 and not attisdropped);
  c_itens text[] := (select array_agg(attname::text) from pg_attribute where attrelid = 'public.os_itens'::regclass and attnum > 0 and not attisdropped);
begin
  if v_tipo = 'ping' then return jsonb_build_object('ok', 'pong'); end if;
  v_os := (p_op->>'ordem_id')::uuid;
  select * into o from public.ordens where id = v_os for update;
  if not found then return jsonb_build_object('conflito', 'a O.S. não existe mais no online (apagada ou substituída pela carga do sistema antigo)'); end if;
  oj := to_jsonb(o);

  if not p_forcar and p_op ? 'espelho' then
    select dados->'ultimoEspelho'->>'em' into v_ger from public.config where id = 1;
    if coalesce(v_ger, '') is distinct from coalesce(p_op->>'espelho', '') then
      return jsonb_build_object('conflito', 'houve uma carga nova do sistema antigo depois desta alteração (a O.S. foi recarregada)');
    end if;
  end if;

  if v_tipo = 'alterar_os' then
    -- valores do PC convertidos para o tipo das colunas (o que não for coluna é ignorado)
    aj := to_jsonb(jsonb_populate_record(o, p_op->'antes'));
    pj := to_jsonb(jsonb_populate_record(o, p_op->'patch'));
    -- reenvio: já está como foi feito aqui
    if not exists (select 1 from jsonb_object_keys(p_op->'patch') x(k) where oj->k is distinct from pj->k) then return jsonb_build_object('ok', true, 'reenvio', true); end if;
    if not p_forcar then
      if o.status in ('entregue', 'cancelado') and o.status is distinct from p_op->>'status_base' then
        return jsonb_build_object('conflito', 'a O.S. foi ' || case o.status when 'entregue' then 'entregue' else 'cancelada' end || ' no online');
      end if;
      select coalesce(array_agg(x.k order by x.k), '{}') into v_mudou from jsonb_object_keys(p_op->'patch') x(k)
        where oj->x.k is distinct from aj->x.k and oj->x.k is distinct from pj->x.k;
      if array_length(v_mudou, 1) > 0 then
        return jsonb_build_object('conflito', 'no online alteraram ' || array_to_string(v_mudou, ', ') || ' desta O.S. enquanto este computador estava sem internet');
      end if;
    end if;
    select string_agg(format('%I = r.%I', x.k, x.k), ', ') into v_cols from jsonb_object_keys(p_op->'patch') x(k) where x.k <> all (array['id', 'numero', 'criado_em', 'atualizado_em']) and x.k = any (c_ordens);
    if v_cols is not null then
      execute format('update public.ordens t set %s from jsonb_populate_record(null::public.ordens, $1) r where t.id = $2', v_cols) using p_op->'patch', v_os;
    end if;
    return jsonb_build_object('ok', true);

  elsif v_tipo = 'itens_os' then
    if not p_forcar and o.status in ('entregue', 'cancelado') and o.status is distinct from p_op->'antes'->>'status' then
      return jsonb_build_object('conflito', 'a O.S. foi ' || case o.status when 'entregue' then 'entregue' else 'cancelada' end || ' no online');
    end if;
    -- 1º confere tudo (itens travados), depois grava tudo
    if not p_forcar then
      for it in select * from jsonb_array_elements(coalesce(p_op->'itens', '[]')) loop
        v_id := (it->>'id')::uuid; v_base := p_op->'antes'->'itens'->(v_id::text);
        select * into cur from public.os_itens where id = v_id for update;
        if not found then
          if v_base is not null and jsonb_typeof(v_base) = 'object' then
            return jsonb_build_object('conflito', 'o item “' || coalesce(it->>'descricao', '') || '” foi removido no online');
          end if;
          continue;
        end if;
        cj := to_jsonb(cur);
        mj := to_jsonb(jsonb_populate_record(cur, it - 'atualizado_em' - 'criado_em'));
        v_igual := not exists (select 1 from jsonb_object_keys(it) x(k) where x.k not in ('atualizado_em', 'criado_em') and cj->x.k is distinct from mj->x.k);
        if v_igual then continue; end if; -- reenvio
        if v_base is null or jsonb_typeof(v_base) <> 'object' then
          return jsonb_build_object('conflito', 'o item “' || coalesce(cur.descricao, '') || '” já existe no online com outro conteúdo');
        end if;
        bj := to_jsonb(jsonb_populate_record(cur, v_base));
        v_intacto := not exists (select 1 from jsonb_object_keys(v_base) x(k) where x.k not in ('atualizado_em', 'criado_em') and cj->x.k is distinct from bj->x.k);
        if not v_intacto then return jsonb_build_object('conflito', 'o item “' || coalesce(cur.descricao, '') || '” foi alterado no online'); end if;
      end loop;
      for v_k in select jsonb_array_elements_text(coalesce(p_op->'removidos', '[]')) loop
        v_base := p_op->'antes'->'itens'->v_k;
        select * into cur from public.os_itens where id = v_k::uuid for update;
        if not found or v_base is null or jsonb_typeof(v_base) <> 'object' then continue; end if;
        cj := to_jsonb(cur); bj := to_jsonb(jsonb_populate_record(cur, v_base));
        if exists (select 1 from jsonb_object_keys(v_base) x(k) where x.k not in ('atualizado_em', 'criado_em') and cj->x.k is distinct from bj->x.k) then
          return jsonb_build_object('conflito', 'o item “' || coalesce(cur.descricao, '') || '” foi alterado no online');
        end if;
      end loop;
    end if;
    delete from public.os_itens where id in (select x::uuid from jsonb_array_elements_text(coalesce(p_op->'removidos', '[]')) x) and ordem_id = v_os;
    for it in select * from jsonb_array_elements(coalesce(p_op->'itens', '[]')) loop
      v_id := (it->>'id')::uuid;
      it := (it - 'atualizado_em' - 'criado_em') || jsonb_build_object('ordem_id', v_os);
      if exists (select 1 from public.os_itens where id = v_id) then
        select string_agg(format('%I = r.%I', x.k, x.k), ', ') into v_cols from jsonb_object_keys(it) x(k) where x.k <> 'id' and x.k = any (c_itens);
        if v_cols is not null then execute format('update public.os_itens t set %s from jsonb_populate_record(null::public.os_itens, $1) r where t.id = $2', v_cols) using it, v_id; end if;
      else
        select string_agg(format('%I', x.k), ', ') into v_cols from jsonb_object_keys(it) x(k) where x.k = any (c_itens);
        execute format('insert into public.os_itens (%s) select %s from jsonb_populate_record(null::public.os_itens, $1)', v_cols, v_cols) using it;
      end if;
    end loop;
    return jsonb_build_object('ok', true);

  elsif v_tipo = 'evento_os' then
    -- a data de criação é a identidade do evento: reenvio não duplica
    if not exists (select 1 from public.eventos e where e.ordem_id = v_os and e.tipo = p_op->'evento'->>'tipo' and e.criado_em = (p_op->'evento'->>'criado_em')::timestamptz) then
      insert into public.eventos (ordem_id, tipo, texto, usuario_nome, criado_em)
      values (v_os, p_op->'evento'->>'tipo', coalesce(p_op->'evento'->>'texto', ''), coalesce(p_op->'evento'->>'usuario_nome', ''), (p_op->'evento'->>'criado_em')::timestamptz);
    end if;
    return jsonb_build_object('ok', true);
  end if;
  raise exception 'Alteração desconhecida: %', v_tipo;
end $$;
revoke all on function public.sincronizar_alteracao_os(jsonb, boolean) from public, anon;
grant execute on function public.sincronizar_alteracao_os(jsonb, boolean) to authenticated;
