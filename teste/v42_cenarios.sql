-- Cenários do supabase/v42.sql (teste/teste_v42.sh). Para no primeiro que falhar.
\set ON_ERROR_STOP 1
create or replace function pg_temp.ok(c boolean, m text) returns void language plpgsql as $$
begin if c is not true then raise exception 'FALHOU: %', m; end if; end $$;
create or replace function pg_temp.erro(cmd text, trecho text) returns void language plpgsql as $$
begin
  begin execute cmd; exception when others then
    if sqlerrm ilike '%' || trecho || '%' then return; end if;
    raise exception 'FALHOU: esperava erro com "%", veio "%"', trecho, sqlerrm;
  end;
  raise exception 'FALHOU: esperava erro com "%" e passou', trecho;
end $$;
-- NF-e de teste (procNFe), 3 itens: um já vinculado ao fornecedor (caixa com 4), um pelo EAN, um novo; 2 duplicatas
insert into public.fornecedores (id, cnpj, razao, fantasia) values ('00000000-0000-0000-0000-0000000000b1', '20149617000342', 'BIANCARDI AUTO PECAS LTDA', 'BIANCARDI');
insert into public.produtos (id, codigo, descricao, custo, estoque_atual, codigo_barras, margem_vista) values
  ('00000000-0000-0000-0000-0000000000a2', 200, 'Vela de ignição', 10, 0, '', 0),
  ('00000000-0000-0000-0000-0000000000a3', 201, 'Filtro de ar Gol', 30, 1, '7891234567895', 100);
insert into public.produto_fornecedor (produto_id, fornecedor_id, codigo, fator) values ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b1', 'BK-VELA', 4);
insert into public.nfe_recebidas (chave, cnpj_emitente, nome_emitente, numero, emissao, valor, xml) values ('32261120149617000342550010000126271000126270', '20149617000342',
  'BIANCARDI AUTO PECAS LTDA', '12627', '2026-11-05 10:00-03', 290, $x$<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe32261120149617000342550010000126271000126270" versao="4.00">
<ide><nNF>12627</nNF><serie>1</serie><dhEmi>2026-11-05T10:00:00-03:00</dhEmi></ide>
<emit><CNPJ>20149617000342</CNPJ><xNome>BIANCARDI AUTO PECAS LTDA</xNome><xFant>BIANCARDI</xFant><IE>123</IE><enderEmit><xLgr>Rua A</xLgr><nro>10</nro><xBairro>Centro</xBairro><xMun>Colatina</xMun><UF>ES</UF><CEP>29700000</CEP></enderEmit></emit>
<det nItem="1"><prod><cProd>BK-VELA</cProd><cEAN>SEM GTIN</cEAN><xProd>VELA BK CX4</xProd><NCM>85111000</NCM><uCom>CX</uCom><qCom>2.0000</qCom><vUnCom>40.00</vUnCom><vProd>80.00</vProd></prod><imposto><IPI><IPITrib><vIPI>8.00</vIPI></IPITrib></IPI></imposto></det>
<det nItem="2"><prod><cProd>FA-123</cProd><cEAN>7891234567895</cEAN><xProd>FILTRO AR GOL</xProd><uCom>UN</uCom><qCom>3</qCom><vUnCom>25</vUnCom><vProd>75.00</vProd><vDesc>3.00</vDesc></prod><imposto/></det>
<det nItem="3"><prod><cProd>J&amp;K-9</cProd><cEAN>SEM GTIN</cEAN><xProd>PASTILHA D&amp;W DIANT</xProd><uCom>JG</uCom><qCom>1</qCom><vUnCom>130</vUnCom><vProd>130.00</vProd></prod><imposto/></det>
<total><ICMSTot><vNF>290.00</vNF></ICMSTot></total>
<cobr><fat><nFat>12627</nFat></fat><dup><nDup>001</nDup><dVenc>2026-12-05</dVenc><vDup>145.00</vDup></dup><dup><nDup>002</nDup><dVenc>2027-01-05</dVenc><vDup>145.00</vDup></dup></cobr>
</infNFe></NFe></nfeProc>$x$);
update public.config set dados = dados || '{"markupPecas": 50}' where id = 1;

do $$
declare r jsonb; it jsonb;
begin
  -- prévia: reconhece, mostra e não grava nada
  r := public.agente_fazer('entrada_nota', '{"numero": "12627"}', false);
  perform pg_temp.ok((r->>'gravado')::boolean = false and not exists (select 1 from public.notas_entrada), 'prévia não grava');
  perform pg_temp.ok((select estoque_atual from public.produtos where codigo = 200) = 0, 'prévia não mexe no estoque');
  it := r->'itens';
  perform pg_temp.ok(it->0->>'acao' = 'vincular' and (it->0->>'qtd_estoque')::numeric = 8 and (it->0->>'custo_unit_estoque')::numeric = 11, 'item 1 pelo vínculo: 2 cx × 4 = 8, custo (80+8)/2/4 = 11 — ' || (it->0)::text);
  perform pg_temp.ok(it->1->>'acao' = 'vincular' and (it->1->>'custo_unit_estoque')::numeric = 24, 'item 2 pelo EAN, custo (75-3)/3 = 24');
  perform pg_temp.ok(it->2->>'acao' = 'novo', 'item 3 novo');
  perform pg_temp.ok((r->>'contas_lancadas')::int = 2, 'prévia mostra 2 duplicatas');
  perform pg_temp.ok(it->2->>'produto' = 'PASTILHA D&W DIANT', 'texto do XML sem &amp;: ' || (it->2)::text);
  perform pg_temp.erro($c$select public.agente_fazer('entrada_nota', '{"numero": "12627", "itens": [{"n": 9, "acao": "ignorar"}]}', false)$c$, 'não existe');
  update public.nfe_recebidas set situacao = 'cancelada'; 
  perform pg_temp.erro($c$select public.agente_fazer('entrada_nota', '{"numero": "12627"}', false)$c$, 'cancelada');
  update public.nfe_recebidas set situacao = 'autorizada';
  -- 1 das 2 caixas de vela já foi para uma O.S. (v9): só a sobra entra
  insert into public.nfe_os_vinculos (chave, nf_item, descricao_nf, qtd) select chave, 1, 'VELA BK CX4', 1 from public.nfe_recebidas;
  -- de verdade, com o item 3 vinculado a mão a um produto que já existe e o 2 ignorado
  r := public.agente_fazer('entrada_nota', '{"numero": "12627", "itens": [{"n": 3, "codigo": "201"}, {"n": 2, "acao": "ignorar"}]}', true);
  perform pg_temp.ok((select estoque_atual from public.produtos where codigo = 200) = 4, 'vela: só a sobra (1 cx = 4) em estoque');
  perform pg_temp.ok((select estoque_atual from public.produtos where codigo = 201) = 2 and (select custo from public.produtos where codigo = 201) = 130, 'filtro (item 3 a mão): +1, custo 130');
  perform pg_temp.ok((select preco_vista from public.produtos where codigo = 201) = 260, 'preço recalculado pela margem 100%');
  perform pg_temp.ok((select count(*) from public.contas where chave_nfe like '3226%' and origem = 'nfe') = 2, '2 contas a pagar');
  perform pg_temp.ok(r->'avisos'->>0 like '%sobra%', 'aviso da sobra');
  perform pg_temp.ok((select status = 'lancada' and contas_lancadas from public.nfe_recebidas where numero = '12627'), 'nota marcada como lançada');
  perform pg_temp.erro($c$select public.agente_fazer('entrada_nota', '{"numero": "12627"}', false)$c$, 'já teve entrada');
end $$;
select null from pg_temp.erro($c$select public.agente_fazer('entrada_nota', '{"numero": "999"}', false)$c$, 'não encontrada');
\echo 'OK: v42 (todos os cenários)'
