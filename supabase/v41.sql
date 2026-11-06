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
  v_saldo numeric; v_valor numeric; v_venc date; v_ref text; v_nova uuid; v_res uuid;
begin
  perform public.agente_exige_admin();
  if coalesce(p->>'numero', '') !~ '^\s*[0-9]+\s*$' then raise exception 'Informe o número da O.S.'; end if;
  select * into o from public.ordens where numero = (p->>'numero')::int order by criado_em desc limit 1 for update;
  if o.id is null then raise exception 'O.S. % não encontrada.', p->>'numero'; end if;
  select dados into cfg from public.config where id = 1;
  cob := coalesce(cfg->'cobranca', '{}');
  if coalesce(cob->>'modo', '') <> 'api' or coalesce(cob->>'ambiente', '') <> 'producao' then
    raise exception 'A emissão pela API do Sicredi não está ligada em produção (Boletos Sicredi › Dados da carteira).';
  end if;
  -- como o botão da tela: boleto real só depois da virada (cfg.espelhoLegado = false)
  if coalesce(cfg->>'espelhoLegado', 'true') <> 'false' then raise exception 'Período de transição ligado (cfg.espelhoLegado): boleto real só depois da virada.'; end if;
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

  if o.status not in ('execucao', 'pronto', 'entregue') or o.finalizada_em is not null then
    raise exception 'A O.S. % está "%": boleto só para O.S. aprovada, aguardando pagamento ou entregue a receber.', o.numero, public.agente_etapa(o);
  end if;
  if nullif(p->>'valor', '') is not null and coalesce(p->>'vencimento', '') = '' then raise exception 'Valor sem vencimento: informe o vencimento da parcela nova (ou não informe valor para emitir as parcelas que já existem).'; end if;
  if nullif(p->>'parcela', '') is not null and coalesce(p->>'vencimento', '') <> '' then raise exception 'Use parcela (para uma que já existe) ou vencimento (para criar uma nova), não os dois.'; end if;

  -- parcela nova a partir do vencimento informado (e do valor; padrão = saldo ainda sem parcela)
  if coalesce(p->>'vencimento', '') <> '' then
    v_venc := (p->>'vencimento')::date;
    select greatest(0, o.total - coalesce((select sum(valor) from public.recibos where ordem_id = o.id and not cancelado), 0)
                     - coalesce((select sum(valor) from public.receber where ordem_id = o.id and status = 'aberta'), 0)) into v_saldo;
    v_valor := round(coalesce(nullif(p->>'valor', '')::numeric, v_saldo), 2);
    if v_saldo <= 0.009 then
      raise exception 'A O.S. % não tem saldo sem parcela (as parcelas em aberto já cobrem o total). Para emitir das parcelas que existem, chame sem vencimento (ou com parcela=N).', o.numero;
    end if;
    if v_valor <= 0 or v_valor > v_saldo + 0.009 then raise exception 'O valor (%) tem de ser maior que zero e até o saldo sem parcela (%).', public.agente_reais(v_valor), public.agente_reais(v_saldo); end if;
    insert into public.receber (ordem_id, cliente_id, cliente_nome, descricao, forma, parcela, parcelas, valor, vencimento, obs, criado_por)
    values (o.id, o.cliente_id, coalesce(o.cliente->>'nome', ''), 'O.S. ' || o.numero, 'Boleto', 1, 1, v_valor, v_venc, 'Lançada pelo agente (Claude) para boleto.', public.agente_quem())
    returning id into v_nova;
    perform public.agente_registrar('emitir_boleto', p, 'receber', v_nova::text, null, jsonb_build_object('parcela_nova', v_valor, 'vencimento', v_venc));
    avisos := array_append(avisos, 'Parcela nova de ' || public.agente_reais(v_valor) || ' para ' || to_char(v_venc, 'DD/MM/YYYY') || ' em Contas a receber.');
  end if;

  -- parcelas: a nova; ou a escolhida (parcela=N); ou todas as "Boleto" em aberto sem boleto ativo (como a tela)
  for pa in select * from public.receber r where r.ordem_id = o.id and r.status = 'aberta'
              and case when v_nova is not null then r.id = v_nova
                       when nullif(p->>'parcela', '') is not null then r.parcela = (p->>'parcela')::int
                       else r.forma = 'Boleto' end
              and not exists (select 1 from public.boletos b where b.receber_id = r.id and b.situacao in ('gerado', 'enviado', 'registrado', 'baixa_pedida', 'pago'))
            order by r.vencimento, r.parcela for update loop
    if pa.vencimento < v_hoje or pa.criado_em::date < v_desde then
      if v_nova is null and nullif(p->>'parcela', '') is null then
        avisos := array_append(avisos, 'Parcela de ' || public.agente_reais(pa.valor) || ' (vencimento ' || to_char(pa.vencimento, 'DD/MM/YYYY') || ') ficou de fora: '
          || case when pa.vencimento < v_hoje then 'já venceu.' else 'é de antes de ' || to_char(v_desde, 'DD/MM/YYYY') || ' (boleto emitido fora, PicPay).' end);
        continue;
      end if;
      if pa.vencimento < v_hoje then raise exception 'A parcela de % venceu em %: mude o vencimento da parcela antes de emitir.', public.agente_reais(pa.valor), to_char(pa.vencimento, 'DD/MM/YYYY'); end if;
      raise exception 'A parcela de % (vencimento %) é de antes de %: as antigas já têm boleto emitido fora (PicPay).', public.agente_reais(pa.valor), to_char(pa.vencimento, 'DD/MM/YYYY'), to_char(v_desde, 'DD/MM/YYYY');
    end if;
    if pa.forma <> 'Boleto' then avisos := array_append(avisos, 'A parcela de ' || public.agente_reais(pa.valor) || ' estava como ' || pa.forma || ': passa para Boleto.');
      update public.receber set forma = 'Boleto' where id = pa.id; end if;
    v_ref := 'REF. ' || array_to_string(array_remove(array['O.S. ' || o.numero, case when v_nf <> '' then 'NF ' || v_nf end,
               case when pa.parcelas > 1 then 'PARCELA ' || pa.parcela || '/' || pa.parcelas end], null), ' - ');
    -- reserva: a parcela fica com um boleto "aguardando o banco" ANTES de chamar o Sicredi (ninguém emite outro para ela no meio)
    loop
      begin
        insert into public.boletos (receber_id, ordem_id, os_numero, cliente_id, pagador_nome, pagador_doc, pagador, descricao, valor, vencimento, emissao,
                                    nosso_numero, seu_numero, situacao, ocorrencia, criado_por)
        values (pa.id, o.id, o.numero::text, o.cliente_id, pg->>'nome', pg->>'doc', pg - 'telefone',
                'O.S. ' || o.numero || case when v_nf <> '' then ' · NF ' || v_nf else '' end || case when pa.parcelas > 1 then ' · parcela ' || pa.parcela || '/' || pa.parcelas else '' end,
                pa.valor, pa.vencimento, v_hoje, '000' || lpad(floor(random() * 1000000)::int::text, 6, '0'), left(o.numero || '-' || pa.parcela, 10), 'gerado',
                'Reservado pelo agente (Claude) para emitir no Sicredi. Se ficar assim, confira no Portal PJ antes de emitir de novo.', public.agente_quem())
        returning id into v_res;
        exit;
      exception when unique_violation then
        if exists (select 1 from public.boletos b where b.receber_id = pa.id and b.situacao in ('gerado', 'enviado', 'registrado', 'baixa_pedida', 'pago')) then
          raise exception 'A parcela de % já tem boleto (outra emissão em andamento).', public.agente_reais(pa.valor);
        end if; -- senão: número provisório repetido, tenta outro
      end;
    end loop;
    v_lista := v_lista || jsonb_build_array(jsonb_build_object(
      'reserva_id', v_res, 'receber_id', pa.id, 'descricao', 'O.S. ' || o.numero || case when v_nf <> '' then ' · NF ' || v_nf else '' end
        || case when pa.parcelas > 1 then ' · parcela ' || pa.parcela || '/' || pa.parcelas else '' end,
      'valor', pa.valor, 'vencimento', pa.vencimento,
      'boleto', jsonb_build_object('mensagem', left(array_to_string(array_remove(array[left(v_ref, 75), nullif(cob->>'mensagem', '')], null), ' - '), 80),
        'valor', pa.valor, 'vencimento', pa.vencimento, 'seu_numero', left(o.numero || '-' || pa.parcela, 10), 'especie', coalesce(nullif(cob->>'especie', ''), '03'),
        'juros_mes', coalesce(nullif(cob->>'jurosMes', '')::numeric, 0), 'multa', coalesce(nullif(cob->>'multa', '')::numeric, 0), 'id_titulo', pa.id, 'pagador', pg)));
  end loop;
  if jsonb_array_length(v_lista) = 0 then
    raise exception 'A O.S. % não tem parcela "Boleto" em aberto sem boleto%. Informe o vencimento (e o valor, se não for o saldo) para criar a parcela, ou parcela=N para usar outra.%', o.numero,
      case when nullif(p->>'parcela', '') is not null then ' com o número ' || (p->>'parcela') else '' end,
      case when array_length(avisos, 1) > 0 then ' ' || array_to_string(avisos, ' ') else '' end;
  end if;
  return jsonb_build_object('os', o.numero, 'cliente', pg->>'nome', 'boletos', v_lista, 'total', (select sum((x->>'valor')::numeric) from jsonb_array_elements(v_lista) x),
    'parcela_criada', v_nova, 'juros_mes', cob->'jurosMes', 'multa', cob->'multa', 'avisos', to_jsonb(avisos));
end $$;

-- o Sicredi registrou: a reserva vira o boleto de verdade. p: reserva_id, nosso_numero, codigo_barras, linha_digitavel, qr_code, txid
create or replace function public.agente_boleto_gravar(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare b public.boletos;
begin
  perform public.agente_exige_admin();
  if coalesce(p->>'nosso_numero', '') !~ '^[0-9]{9}$' then raise exception 'Nosso número inválido: %', coalesce(p->>'nosso_numero', ''); end if;
  update public.boletos set nosso_numero = p->>'nosso_numero', codigo_barras = coalesce(p->>'codigo_barras', ''), linha_digitavel = coalesce(p->>'linha_digitavel', ''),
    qr_url = coalesce(p->>'qr_code', ''), txid = coalesce(p->>'txid', ''), situacao = 'registrado',
    ocorrencia = case when coalesce(p->>'qr_code', '') <> '' then 'Registrado pela API com QR Code Pix (agente, Claude)' else 'Registrado pela API SEM QR Code — confira o boleto híbrido no Portal PJ' end
  where id = nullif(p->>'reserva_id', '')::uuid and situacao = 'gerado'
  returning * into b;
  if b.id is null then raise exception 'Reserva do boleto não encontrada (já gravada ou desfeita).'; end if;
  if b.ordem_id is not null then
    insert into public.eventos (ordem_id, tipo, texto, usuario_nome)
    values (b.ordem_id, 'boleto', 'Boleto Sicredi registrado pelo agente (Claude): ' || public.agente_reais(b.valor) || ' para ' || to_char(b.vencimento, 'DD/MM/YYYY')
            || ' (nosso número ' || b.nosso_numero || ').', public.agente_quem());
  end if;
  perform public.agente_registrar('emitir_boleto', p, 'boletos', b.id::text, null, to_jsonb(b));
  return jsonb_build_object('id', b.id, 'nosso_numero', b.nosso_numero, 'valor', b.valor, 'vencimento', b.vencimento, 'linha_digitavel', b.linha_digitavel,
    'pix', b.qr_url <> '', 'pagador', b.pagador_nome);
end $$;

-- o Sicredi RECUSOU (resposta clara do banco): as reservas saem e a parcela criada nesta emissão também.
-- p: reservas [ids], parcela_criada, motivo. Falta de resposta (tempo, rede) NÃO chama esta função: a reserva fica para conferir.
create or replace function public.agente_boleto_desfazer(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare v_n int; v_parc boolean := false;
begin
  perform public.agente_exige_admin();
  delete from public.boletos where id in (select x::uuid from jsonb_array_elements_text(coalesce(p->'reservas', '[]')) x) and situacao = 'gerado' and nosso_numero like '000%';
  get diagnostics v_n = row_count;
  if nullif(p->>'parcela_criada', '') is not null then
    delete from public.receber r where r.id = (p->>'parcela_criada')::uuid and r.status = 'aberta' and r.recibo_id is null
      and not exists (select 1 from public.boletos b where b.receber_id = r.id);
    v_parc := found;
  end if;
  perform public.agente_registrar('emitir_boleto', p, 'boletos', '', null, jsonb_build_object('desfeito', true, 'reservas', v_n, 'parcela_apagada', v_parc, 'motivo', p->>'motivo'));
  return jsonb_build_object('reservas_desfeitas', v_n, 'parcela_apagada', v_parc);
end $$;

-- uma parcela, um boleto ativo (reforço da reserva; se o banco já tiver repetidos, fica sem o índice e avisa)
do $$ begin
  create unique index if not exists boletos_um_ativo_por_parcela on public.boletos (receber_id)
    where receber_id is not null and situacao in ('gerado', 'enviado', 'registrado', 'baixa_pedida', 'pago');
exception when unique_violation then raise notice 'v41: há parcela com mais de um boleto ativo; índice boletos_um_ativo_por_parcela não criado (confira em Boletos Sicredi).';
end $$;

-- as duas entram na entrada única do conector (agente_fazer do v40)
do $$
declare src text;
begin
  select pg_get_functiondef('public.agente_fazer(text, jsonb, boolean)'::regprocedure) into src;
  if src not like '%agente_boleto_preparar%' then
    src := replace(src, $a$when 'produto' then 'agente_produto' end;$a$,
                        $b$when 'produto' then 'agente_produto' when 'boleto_preparar' then 'agente_boleto_preparar' when 'boleto_gravar' then 'agente_boleto_gravar' when 'boleto_desfazer' then 'agente_boleto_desfazer' end;$b$);
    if src not like '%agente_boleto_preparar%' then raise exception 'v41: não reconheci a agente_fazer do v40 (rode o v40 antes).'; end if;
    execute src;
  end if;
end $$;

revoke all on function public.agente_boleto_preparar(jsonb) from public, anon;
revoke all on function public.agente_boleto_gravar(jsonb) from public, anon;
revoke all on function public.agente_boleto_desfazer(jsonb) from public, anon;
grant execute on function public.agente_boleto_desfazer(jsonb) to authenticated;
grant execute on function public.agente_boleto_preparar(jsonb) to authenticated;
grant execute on function public.agente_boleto_gravar(jsonb) to authenticated;
