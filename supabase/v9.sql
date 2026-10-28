-- =====================================================================
-- DTCar Gestão — versão 9
-- Vínculo nota × O.S.: guarda a quantidade usada de cada item da nota
-- (para saber o que sobrou) e, quando a peça da O.S. é do cadastro e já
-- saiu do estoque, registra a entrada correspondente desta nota.
-- Rode DEPOIS do v8.sql. Pode ser executado mais de uma vez.
-- =====================================================================
alter table public.nfe_os_vinculos add column if not exists qtd numeric(12, 3) not null default 0;
alter table public.nfe_os_vinculos add column if not exists entrada_estoque numeric(12, 3) not null default 0;

-- p = { chave, ordem_id, itens: [{ item_id, nf_item, descricao_nf, qtd, custo_total }] }
create or replace function public.vincular_nfe_os(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n record; o record; it jsonb; item record; pr record; quem text; total numeric := 0; venda numeric := 0; n_itens int := 0; ref text; linhas text := '';
  ja_vinculado boolean; reservado numeric; entrada numeric; entradas text := '';
begin
  if not public.e_gestor() then raise exception 'Seu usuário não pode vincular notas.'; end if;
  select * into n from public.nfe_recebidas where chave = p->>'chave';
  if not found then raise exception 'Nota não encontrada.'; end if;
  select * into o from public.ordens where id = (p->>'ordem_id')::uuid;
  if not found then raise exception 'O.S. não encontrada.'; end if;
  select nome into quem from public.perfis where id = auth.uid();
  ref := 'NF ' || n.numero || ' – ' || coalesce(nullif(n.nome_emitente, ''), n.cnpj_emitente);
  for it in select * from jsonb_array_elements(coalesce(p->'itens', '[]'::jsonb)) loop
    select * into item from public.os_itens where id = (it->>'item_id')::uuid and ordem_id = o.id;
    if not found then raise exception 'Item não pertence a esta O.S.'; end if;
    select exists (select 1 from public.nfe_os_vinculos where item_id = item.id) into ja_vinculado;
    -- peça do cadastro que já saiu do estoque pela O.S.: a compra desta nota entra no estoque (saldo fica correto)
    select coalesce(max(v.entrada_estoque), 0) into entrada from public.nfe_os_vinculos v where v.item_id = item.id;
    if not ja_vinculado and item.produto_id is not null then
      select r.qtd into reservado from public.estoque_reserva r where r.item_id = item.id;
      select * into pr from public.produtos where id = item.produto_id;
      if coalesce(reservado, 0) > 0 and pr.tipo = 'produto' and pr.controla_estoque then
        entrada := reservado;
        perform public.movimentar_estoque(item.produto_id, 'entrada', entrada, null, ref || ' (peça da OS ' || lpad(o.numero::text, 5, '0') || ')');
        entradas := entradas || case when entradas = '' then '' else '; ' end || pr.descricao || ' +' || trim(to_char(entrada, 'FM999999990.###'));
      end if;
    end if;
    delete from public.nfe_os_vinculos where item_id = item.id;
    insert into public.nfe_os_vinculos (chave, ordem_id, item_id, nf_item, descricao_nf, qtd, custo_total, entrada_estoque, usuario_nome)
    values (n.chave, o.id, item.id, nullif(it->>'nf_item', '')::int, coalesce(it->>'descricao_nf', ''), coalesce(nullif(it->>'qtd', '')::numeric, item.qtd),
      (it->>'custo_total')::numeric, entrada, coalesce(quem, ''));
    perform set_config('dtcar.sem_estoque', '1', true);
    update public.os_itens set custo_unit = round((it->>'custo_total')::numeric / greatest(item.qtd, 0.001), 2), nfe_chave = n.chave, nfe_ref = ref where id = item.id;
    perform set_config('dtcar.sem_estoque', '', true);
    total := total + (it->>'custo_total')::numeric;
    venda := venda + item.qtd * item.valor_unit - item.desconto;
    n_itens := n_itens + 1;
    linhas := linhas || case when n_itens > 1 then '; ' else '' end || item.descricao || ' custo ' || public.fmt_reais((it->>'custo_total')::numeric);
  end loop;
  if n_itens = 0 then raise exception 'Escolha pelo menos um item da O.S.'; end if;
  update public.ordens set custo = (select coalesce(sum(round(i.qtd * i.custo_unit, 2)), 0) from public.os_itens i
    where i.ordem_id = o.id and i.tipo <> 'servico' and not i.fornecida_cliente
      and (case when o.status in ('execucao', 'pronto', 'entregue', 'recusado') then i.aprovado is true else i.aprovado is distinct from false end))
  where id = o.id;
  insert into public.eventos (ordem_id, tipo, texto, usuario_nome)
  values (o.id, 'nota', ref || ' vinculada: ' || linhas || '. Custo total ' || public.fmt_reais(total) || ', vendido ' || public.fmt_reais(venda) || '.'
    || case when entradas <> '' then ' Entrada no estoque desta compra: ' || entradas || '.' else '' end, coalesce(quem, ''));
  update public.nfe_recebidas set status = 'vinculada' where id = n.id and status = 'nova';
  return jsonb_build_object('itens', n_itens, 'custo', total, 'venda', venda, 'ordem', o.numero, 'entradas', entradas);
end $$;
grant execute on function public.vincular_nfe_os(jsonb) to authenticated;
