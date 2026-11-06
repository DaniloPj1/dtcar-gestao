-- =====================================================================
-- DTCar Gestão — v41: emitir boleto Sicredi pelo conector do Claude (06/11/2026)
--
-- Pedido do Danilo (06/11/2026): "quero que emita boleto quando solicitado".
-- O registro no banco é feito pela função "sicredi" (API de Cobrança, a mesma da tela
-- Boletos Sicredi). Aqui ficam as duas pontas no banco:
--   agente_boleto_preparar: confere a carteira (API em produção), o cadastro do
--     pagador (CPF/CNPJ, endereço, CEP, cidade, UF) e escolhe as parcelas em aberto
--     da O.S. sem boleto ativo; com vencimento informado e sem parcela, cria a
--     parcela "Boleto" do saldo (ou do valor pedido). Devolve o que vai ao Sicredi
--     (mesma referência da tela: "REF. O.S. 1887 - NF 131 - PARCELA 1/2").
--   agente_boleto_gravar: guarda o boleto registrado (nosso número, linha, Pix),
--     com histórico na O.S. e em agente_acoes.
-- Mesmas regras da tela: só parcelas criadas a partir de cfg.cobranca.desde (as
-- antigas já têm boleto PicPay — decisão do Danilo em 04/11/2026); vencimento não
-- pode ter passado; parcela com boleto ativo ou pago não recebe outro.
-- Rode depois do v40. Pode rodar mais de uma vez. Nenhuma tabela nova.
-- =====================================================================

create or replace function public.agente_boleto_preparar(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare
  o public.ordens; c public.clientes; cfg jsonb; cob jsonb; pg jsonb; faltam text[] := '{}'; avisos text[] := '{}'; v_hoje date := public.agente_hoje();
  v_desde date; v_nf text := regexp_replace(coalesce(p->>'nf', ''), '[^0-9A-Za-z/-]', '', 'g'); pa public.receber; v_lista jsonb := '[]';
  v_saldo numeric; v_valor numeric; v_venc date; v_ref text;
begin
  perform public.agente_exige_admin();
  if coalesce(p->>'numero', '') !~ '^\s*[0-9]+\s*$' then raise exception 'Informe o número da O.S.'; end if;
  select * into o from public.ordens where numero = (p->>'numero')::int order by criado_em desc limit 1 for update;
  if o.id is null then raise exception 'O.S. % não encontrada.', p->>'numero'; end if;
  if o.status in ('cancelado', 'recusado') then raise exception 'A O.S. % está "%".', o.numero, public.agente_etapa(o); end if;
  select dados into cfg from public.config where id = 1;
  cob := coalesce(cfg->'cobranca', '{}');
  if coalesce(cob->>'modo', '') <> 'api' or coalesce(cob->>'ambiente', '') <> 'producao' then
    raise exception 'A emissão pela API do Sicredi não está ligada em produção (Boletos Sicredi › Dados da carteira).';
  end if;
  v_desde := coalesce(nullif(cob->>'desde', '')::date, date '2026-11-04');

  -- pagador: cadastro do cliente (como pagadorDe da tela)
  select * into c from public.clientes where id = o.cliente_id;
  pg := jsonb_build_object('nome', coalesce(nullif(c.nome, ''), o.cliente->>'nome', ''),
    'doc', regexp_replace(coalesce(nullif(c.doc, ''), o.cliente->>'doc', ''), '\D', '', 'g'),
    'endereco', coalesce(nullif(trim(concat_ws(' ', nullif(c.rua, ''), nullif(c.complemento, ''))), ''), c.endereco, ''),
    'bairro', coalesce(c.bairro, ''), 'cep', regexp_replace(coalesce(c.cep, ''), '\D', '', 'g'), 'cidade', coalesce(c.cidade, ''), 'uf', upper(coalesce(c.uf, '')),
    'telefone', coalesce(c.telefone, ''));
  if length(pg->>'doc') not in (11, 14) then faltam := array_append(faltam, 'CPF/CNPJ'); end if;
  if coalesce(pg->>'nome', '') = '' then faltam := array_append(faltam, 'nome'); end if;
  if coalesce(pg->>'endereco', '') = '' then faltam := array_append(faltam, 'endereço (rua)'); end if;
  if length(pg->>'cep') <> 8 then faltam := array_append(faltam, 'CEP'); end if;
  if coalesce(pg->>'cidade', '') = '' then faltam := array_append(faltam, 'cidade'); end if;
  if (pg->>'uf') !~ '^[A-Z]{2}$' then faltam := array_append(faltam, 'UF'); end if;
  if array_length(faltam, 1) > 0 then
    raise exception 'Cadastro do cliente % incompleto para boleto: falta %. Complete com salvar_cadastro (tipo cliente, id %).', pg->>'nome', array_to_string(faltam, ', '), o.cliente_id;
  end if;

  -- parcela nova a partir do vencimento informado (e do valor; padrão = saldo ainda sem parcela)
  if coalesce(p->>'vencimento', '') <> '' then
    v_venc := (p->>'vencimento')::date;
    select greatest(0, o.total - coalesce((select sum(valor) from public.recibos where ordem_id = o.id and not cancelado), 0)
                     - coalesce((select sum(valor) from public.receber where ordem_id = o.id and status = 'aberta'), 0)) into v_saldo;
    v_valor := round(coalesce(nullif(p->>'valor', '')::numeric, v_saldo), 2);
    if v_valor <= 0 then raise exception 'A O.S. % não tem saldo sem parcela. Para emitir das parcelas que já existem, não informe vencimento.', o.numero; end if;
    if v_valor > v_saldo + 0.009 then avisos := array_append(avisos, 'O valor (' || public.agente_reais(v_valor) || ') é maior que o saldo sem parcela (' || public.agente_reais(v_saldo) || ').'); end if;
    insert into public.receber (ordem_id, cliente_id, cliente_nome, descricao, forma, parcela, parcelas, valor, vencimento, obs, criado_por)
    values (o.id, o.cliente_id, coalesce(o.cliente->>'nome', ''), 'O.S. ' || o.numero, 'Boleto', 1, 1, v_valor, v_venc, 'Lançada pelo agente (Claude) para boleto.', public.agente_quem());
    avisos := array_append(avisos, 'Parcela nova de ' || public.agente_reais(v_valor) || ' para ' || to_char(v_venc, 'DD/MM/YYYY') || ' em Contas a receber.');
  end if;

  for pa in select * from public.receber r where r.ordem_id = o.id and r.status = 'aberta'
              and (nullif(p->>'parcela', '') is null or r.parcela = (p->>'parcela')::int or coalesce(p->>'vencimento', '') <> '')
              and (coalesce(p->>'vencimento', '') = '' or r.vencimento = (p->>'vencimento')::date)
              and not exists (select 1 from public.boletos b where b.receber_id = r.id and b.situacao in ('gerado', 'enviado', 'registrado', 'baixa_pedida', 'pago'))
            order by r.vencimento, r.parcela loop
    if pa.vencimento < v_hoje then raise exception 'A parcela de % venceu em %: mude o vencimento da parcela antes de emitir.', public.agente_reais(pa.valor), to_char(pa.vencimento, 'DD/MM/YYYY'); end if;
    if pa.criado_em::date < v_desde then
      raise exception 'A parcela de % (vencimento %) é de antes de %: as antigas já têm boleto emitido fora (PicPay).', public.agente_reais(pa.valor), to_char(pa.vencimento, 'DD/MM/YYYY'), to_char(v_desde, 'DD/MM/YYYY');
    end if;
    if pa.forma <> 'Boleto' then avisos := array_append(avisos, 'A parcela de ' || public.agente_reais(pa.valor) || ' estava como ' || pa.forma || ': passa para Boleto.');
      update public.receber set forma = 'Boleto' where id = pa.id; end if;
    v_ref := 'REF. ' || array_to_string(array_remove(array['O.S. ' || o.numero, case when v_nf <> '' then 'NF ' || v_nf end,
               case when pa.parcelas > 1 then 'PARCELA ' || pa.parcela || '/' || pa.parcelas end], null), ' - ');
    v_lista := v_lista || jsonb_build_array(jsonb_build_object(
      'receber_id', pa.id, 'ordem_id', o.id, 'os_numero', o.numero::text, 'cliente_id', o.cliente_id, 'pagador_nome', pg->>'nome', 'pagador_doc', pg->>'doc',
      'pagador', pg - 'telefone',
      'descricao', 'O.S. ' || o.numero || case when v_nf <> '' then ' · NF ' || v_nf else '' end || case when pa.parcelas > 1 then ' · parcela ' || pa.parcela || '/' || pa.parcelas else '' end,
      'valor', pa.valor, 'vencimento', pa.vencimento, 'seu_numero', left(o.numero || '-' || pa.parcela, 10),
      'boleto', jsonb_build_object('mensagem', left(array_to_string(array_remove(array[left(v_ref, 75), nullif(cob->>'mensagem', '')], null), ' - '), 80),
        'valor', pa.valor, 'vencimento', pa.vencimento, 'seu_numero', left(o.numero || '-' || pa.parcela, 10), 'especie', coalesce(nullif(cob->>'especie', ''), '03'),
        'juros_mes', coalesce(nullif(cob->>'jurosMes', '')::numeric, 0), 'multa', coalesce(nullif(cob->>'multa', '')::numeric, 0), 'id_titulo', pa.id, 'pagador', pg)));
  end loop;
  if jsonb_array_length(v_lista) = 0 then
    raise exception 'A O.S. % não tem parcela em aberto sem boleto%. Informe o vencimento (e o valor, se não for o saldo) para criar a parcela.', o.numero,
      case when nullif(p->>'parcela', '') is not null then ' com o número ' || (p->>'parcela') else '' end;
  end if;
  return jsonb_build_object('os', o.numero, 'cliente', pg->>'nome', 'boletos', v_lista, 'total', (select sum((x->>'valor')::numeric) from jsonb_array_elements(v_lista) x),
    'juros_mes', cob->'jurosMes', 'multa', cob->'multa', 'avisos', to_jsonb(avisos));
end $$;

-- guarda o boleto que o Sicredi registrou. p: o item de agente_boleto_preparar + nosso_numero, codigo_barras, linha_digitavel, qr_code, txid
create or replace function public.agente_boleto_gravar(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare b public.boletos;
begin
  perform public.agente_exige_admin();
  if coalesce(p->>'nosso_numero', '') !~ '^[0-9]{9}$' then raise exception 'Nosso número inválido: %', coalesce(p->>'nosso_numero', ''); end if;
  insert into public.boletos (receber_id, ordem_id, os_numero, cliente_id, pagador_nome, pagador_doc, pagador, descricao, valor, vencimento, emissao,
                              nosso_numero, seu_numero, codigo_barras, linha_digitavel, qr_url, txid, situacao, ocorrencia, criado_por)
  values (nullif(p->>'receber_id', '')::uuid, nullif(p->>'ordem_id', '')::uuid, coalesce(p->>'os_numero', ''), nullif(p->>'cliente_id', '')::uuid,
          coalesce(p->>'pagador_nome', ''), coalesce(p->>'pagador_doc', ''), coalesce(p->'pagador', '{}'), coalesce(p->>'descricao', ''),
          (p->>'valor')::numeric, (p->>'vencimento')::date, public.agente_hoje(), p->>'nosso_numero', coalesce(p->>'seu_numero', ''),
          coalesce(p->>'codigo_barras', ''), coalesce(p->>'linha_digitavel', ''), coalesce(p->>'qr_code', ''), coalesce(p->>'txid', ''), 'registrado',
          case when coalesce(p->>'qr_code', '') <> '' then 'Registrado pela API com QR Code Pix (agente, Claude)' else 'Registrado pela API SEM QR Code — confira o boleto híbrido no Portal PJ' end,
          public.agente_quem())
  returning * into b;
  if b.ordem_id is not null then
    insert into public.eventos (ordem_id, tipo, texto, usuario_nome)
    values (b.ordem_id, 'boleto', 'Boleto Sicredi registrado pelo agente (Claude): ' || public.agente_reais(b.valor) || ' para ' || to_char(b.vencimento, 'DD/MM/YYYY')
            || ' (nosso número ' || b.nosso_numero || ').', public.agente_quem());
  end if;
  perform public.agente_registrar('emitir_boleto', p, 'boletos', b.id::text, null, to_jsonb(b));
  return jsonb_build_object('id', b.id, 'nosso_numero', b.nosso_numero, 'valor', b.valor, 'vencimento', b.vencimento, 'linha_digitavel', b.linha_digitavel,
    'pix', b.qr_url <> '', 'pagador', b.pagador_nome);
end $$;

-- as duas entram na entrada única do conector (agente_fazer do v40)
do $$
declare src text;
begin
  select pg_get_functiondef('public.agente_fazer(text, jsonb, boolean)'::regprocedure) into src;
  if src not like '%agente_boleto_preparar%' then
    src := replace(src, $a$when 'produto' then 'agente_produto' end;$a$,
                        $b$when 'produto' then 'agente_produto' when 'boleto_preparar' then 'agente_boleto_preparar' when 'boleto_gravar' then 'agente_boleto_gravar' end;$b$);
    if src not like '%agente_boleto_preparar%' then raise exception 'v41: não reconheci a agente_fazer do v40 (rode o v40 antes).'; end if;
    execute src;
  end if;
end $$;

revoke all on function public.agente_boleto_preparar(jsonb) from public, anon;
revoke all on function public.agente_boleto_gravar(jsonb) from public, anon;
grant execute on function public.agente_boleto_preparar(jsonb) to authenticated;
grant execute on function public.agente_boleto_gravar(jsonb) to authenticated;
