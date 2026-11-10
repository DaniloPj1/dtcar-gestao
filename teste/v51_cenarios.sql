-- Cenários do v51 (grupos de produtos). Roda depois de montar_banco.sh (até v50) + v51. Qualquer falha para o psql.
\set ON_ERROR_STOP on
-- administrador logado (as funções agente_* exigem)
insert into auth.users (id, email, raw_user_meta_data) values ('99999999-9999-9999-9999-999999999999', 'danilo@oficina.test', '{"nome": "Danilo"}') on conflict do nothing;
select null from set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', false);
insert into public.perfis (id, nome, papel, ativo) values ('99999999-9999-9999-9999-999999999999', 'Danilo', 'admin', true)
  on conflict (id) do update set papel = 'admin', ativo = true;
insert into public.config (id, dados) values (1, '{}') on conflict (id) do nothing;

-- 1. grafia oficial: três grafias do mesmo grupo viram a mais usada
insert into public.produtos (tipo, descricao, referencia, categoria, marca, unidade, custo, estoque_atual, controla_estoque, ativo) values
  ('produto', 'FILTRO DE AR GOL', 'ARL-1', 'FILTRO AR MOTOR', 'TECFIL', 'UN', 10, 2, true, true),
  ('produto', 'FILTRO DE AR UNO', 'ARL-2', 'FILTRO AR MOTOR', 'MANN', 'UN', 12, 0, true, true),
  ('produto', 'FILTRO DE AR PALIO', 'ARL-3', 'filtro ar  motor', 'MANN', 'UN', 9, 1, true, true),
  ('produto', 'PASTILHA DIANTEIRA', 'PST-1', 'Freios', 'COBREQ', 'JG', 50, 3, true, true),
  ('produto', 'PEÇA SEM GRUPO', 'SG-1', '', '', 'UN', 5, 1, true, true);
do $$ begin
  if (select categoria from public.produtos where referencia = 'ARL-3') <> 'FILTRO AR MOTOR' then raise exception 'FALHOU 1: grafia diferente não virou a oficial (%)', (select categoria from public.produtos where referencia = 'ARL-3'); end if;
  if (select count(distinct categoria) from public.produtos where public.grupo_chave(categoria) = 'filtro ar motor') <> 1 then raise exception 'FALHOU 1b: mais de uma grafia'; end if;
end $$;

-- 2. grafia da lista oficial (cfg.gruposProduto) vale acima da mais usada; renomear via lista + update
update public.config set dados = dados || '{"gruposProduto": ["Filtros de ar", "Freios"]}' where id = 1;
update public.produtos set categoria = 'filtros de ar' where public.grupo_chave(categoria) = 'filtro ar motor' or referencia = 'SG-1';
do $$ begin
  if (select count(*) from public.produtos where categoria = 'Filtros de ar') <> 4 then raise exception 'FALHOU 2: renomear não aplicou a grafia da lista (%)', (select string_agg(distinct categoria, '|') from public.produtos); end if;
  if public.grupo_canonico('  FREIOS ') <> 'Freios' then raise exception 'FALHOU 2b: grupo_canonico'; end if;
  if public.grupo_canonico('Suspensão') <> 'Suspensão' then raise exception 'FALHOU 2c: grupo novo tem de voltar como digitado'; end if;
  if public.grupo_canonico('') <> '' then raise exception 'FALHOU 2d: vazio'; end if;
end $$;

-- 3. consultar_estoque: por grupo (sem texto), com texto, "sem grupo", e a lista de grupos
do $$ declare r jsonb; begin
  r := public.agente_estoque(null, 'filtros de AR');
  if jsonb_array_length(r->'itens') <> 4 then raise exception 'FALHOU 3: por grupo devia trazer 4, trouxe %', jsonb_array_length(r->'itens'); end if;
  if (r->'itens'->0->>'grupo') <> 'Filtros de ar' then raise exception 'FALHOU 3b: sem o grupo na resposta'; end if;
  r := public.agente_estoque('pastilha');
  if jsonb_array_length(r->'itens') <> 1 or (r->'itens'->0->>'grupo') <> 'Freios' then raise exception 'FALHOU 3c: busca por texto'; end if;
  r := public.agente_estoque('filtro', 'freios');
  if jsonb_array_length(r->'itens') <> 0 then raise exception 'FALHOU 3d: texto + grupo combinam'; end if;
  update public.produtos set categoria = '' where referencia = 'SG-1';
  r := public.agente_estoque(null, 'sem grupo');
  if jsonb_array_length(r->'itens') <> 1 or (r->'itens'->0->>'referencia') <> 'SG-1' then raise exception 'FALHOU 3e: sem grupo'; end if;
  if (select count(*) from jsonb_array_elements(r->'grupos')) <> 2 then raise exception 'FALHOU 3f: lista de grupos (%)', r->'grupos'; end if;
  begin perform public.agente_estoque('a'); raise exception 'FALHOU 3g: devia recusar texto curto sem grupo';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
end $$;

-- 4. sugestão de grupo para produto novo da nota: mesma referência ou mesma descrição
do $$ begin
  if public.produtos_grupo_sugerido('arl-2', null) <> 'Filtros de ar' then raise exception 'FALHOU 4: pela referência'; end if;
  if public.produtos_grupo_sugerido('XX-9', 'pastilha dianteira') <> 'Freios' then raise exception 'FALHOU 4b: pela descrição'; end if;
  if public.produtos_grupo_sugerido('XX-9', 'nada parecido') is not null then raise exception 'FALHOU 4c: sem sugestão'; end if;
end $$;

-- 5. agente_entrada_nfe: produto novo recebe a categoria pedida (grafia oficial) ou a sugerida pela referência.
--    Nota de mentira em nfe_recebidas com dois itens: um com referência já cadastrada (ARL-2) e um desconhecido.
insert into public.fornecedores (razao, fantasia, cnpj) values ('DPK LTDA', 'DPK', '11222333000181') on conflict do nothing;
insert into public.nfe_recebidas (chave, numero, cnpj_emitente, nome_emitente, emissao, valor, status, situacao, xml) values
  ('35260111222333000181550010000099991000099991', 9999, '11222333000181', 'DPK LTDA', now(), 100, 'nova', 'autorizada',
   '<?xml version="1.0"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe35260111222333000181550010000099991000099991"><ide><nNF>9999</nNF><serie>1</serie><dhEmi>2026-11-10T10:00:00-03:00</dhEmi></ide>'
   || '<emit><CNPJ>11222333000181</CNPJ><xNome>DPK LTDA</xNome><xFant>DPK</xFant></emit>'
   || '<det nItem="1"><prod><cProd>ARL-2</cProd><xProd>FILTRO AR UNO NOVO</xProd><uCom>UN</uCom><qCom>2</qCom><vUnCom>12</vUnCom><vProd>24</vProd></prod><imposto/></det>'
   || '<det nItem="2"><prod><cProd>AMT-7</cProd><xProd>AMORTECEDOR TRAS</xProd><uCom>UN</uCom><qCom>1</qCom><vUnCom>76</vUnCom><vProd>76</vProd></prod><imposto/></det>'
   || '<total><ICMSTot><vProd>100</vProd><vNF>100</vNF><vDesc>0</vDesc><vFrete>0</vFrete><vSeg>0</vSeg><vOutro>0</vOutro><vIPI>0</vIPI><vST>0</vST></ICMSTot></total><cobr/></infNFe></NFe></nfeProc>')
  on conflict (chave) do nothing;
do $$ declare r jsonb; begin
  -- força os dois como "novo": o 1º sem categoria (sugestão pela referência ARL-2), o 2º com "suspensao" (vira "Suspensão"? não: grupo novo fica como digitado, aparado)
  r := public.agente_entrada_nfe('{"chave": "35260111222333000181550010000099991000099991", "lancar_contas": false,
        "itens": [{"n": 1, "acao": "novo"}, {"n": 2, "acao": "novo", "categoria": " suspensao "}]}'::jsonb);
  if (select categoria from public.produtos where descricao = 'FILTRO AR UNO NOVO') <> 'Filtros de ar' then raise exception 'FALHOU 5: produto novo da nota sem o grupo sugerido (%)', (select categoria from public.produtos where descricao = 'FILTRO AR UNO NOVO'); end if;
  if (select categoria from public.produtos where descricao = 'AMORTECEDOR TRAS') <> 'suspensao' then raise exception 'FALHOU 5b: categoria pedida (%)', (select categoria from public.produtos where descricao = 'AMORTECEDOR TRAS'); end if;
end $$;

select 'v51 OK' as resultado;
