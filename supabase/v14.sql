-- DTCar Gestão — v14: numeração de clientes e produtos depois da carga do sistema antigo (espelho)
-- Problema (31/10/2026): o espelho volta a numeração de produtos para 1; na carga, produto com código repetido no OS Oficina
-- recebia o próximo número da sequência (1, 2, 3…), que já era código de outro produto do backup → "produtos_codigo_unico".
-- O site já resolve os repetidos antes de enviar (js/legado.js). Aqui: a sequência passa a começar acima dos códigos do
-- backup e fica no maior código ao final de cada lote (produto novo cadastrado no DTCar Gestão não bate com código existente).
-- Pode rodar mais de uma vez. Não altera dados.
-- Período de transição: só mexe na numeração; antes e depois da virada o comportamento é o mesmo.

do $$
declare f text := pg_get_functiondef('public.importar_legado(text,jsonb,boolean)'::regprocedure);
begin
  if position('v14: sequência de produtos' in f) > 0 then return; end if;
  f := replace(f, '    insert into public.produtos (id, codigo,',
    '    -- v14: sequência de produtos acima dos códigos já gravados e dos que chegam neste lote
    perform setval(''public.produtos_codigo_seq'', greatest((select max(codigo) from public.produtos), (select max(codigo) from x), 1));
    insert into public.produtos (id, codigo,');
  f := replace(f, '    -- serviço do cadastro antigo substitui',
    '    perform setval(''public.produtos_codigo_seq'', greatest((select max(codigo) from public.produtos), 1));
    -- serviço do cadastro antigo substitui');
  f := replace(f, '    insert into public.clientes (id, codigo,',
    '    perform setval(''public.clientes_codigo_seq'', greatest((select max(codigo) from public.clientes), (select max(codigo) from x), 1));
    insert into public.clientes (id, codigo,');
  if position('v14: sequência de produtos' in f) = 0 then raise exception 'importar_legado diferente do esperado: v14 não aplicado'; end if;
  execute f;
end $$;

-- acerta agora (depois de uma carga interrompida ou de produtos cadastrados à mão)
select setval('public.produtos_codigo_seq', greatest((select max(codigo) from public.produtos), 1));
select setval('public.clientes_codigo_seq', greatest((select max(codigo) from public.clientes), 1));
