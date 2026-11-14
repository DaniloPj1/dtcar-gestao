-- v56 (14/11/2026, regra do Danilo): A CONSULTA COMPLETA PELA PLACA É SÓ DO ADMINISTRADOR + acerto do valor gravado da completa.
-- Achado no teste da primeira consulta de verdade (placa MST2E41, 14/11/2026):
--   1. Chassi, Renavam e nº do motor (o que só a consulta completa traz, R$ 0,20) saíam para quem não devia: o consultor lia a
--      tabela das consultas pagas (política do v55) e o pedido básico devolvia a cópia da completa inteira para qualquer pessoa
--      da equipe. A função "placa" passa a recusar a completa para quem não é administrador e a devolver só o básico no pedido
--      básico (supabase/functions/placa/index.ts); aqui, só o administrador lê a tabela (a tela que a lê é o cartão de Ajustes,
--      que já é só do administrador).
--   2. A completa custa R$ 0,20, mas foi gravada com R$ 0,03 e com o saldo de antes do desconto inteiro: o API Placas desconta
--      R$ 0,03 na hora e R$ 0,17 logo depois, e a rota de saldo informava R$ 0,03 como preço dela. A função já grava certo daqui
--      para a frente; este SQL acerta as completas gravadas até a função nova ser publicada (valor para R$ 0,20 e o saldo menos
--      a diferença). Na linha da MST2E41: R$ 0,03 → R$ 0,20 e saldo R$ 49,94 → R$ 49,77 (o saldo conferido no API Placas).
-- Nada muda para o site antes de rodar este SQL (nenhuma tela depende dele). Período de transição: a tabela continua
-- preservada pelo espelho e fora do backup, do banco do PC e da restauração, como no v55; nada muda antes nem depois da virada.
-- Idempotente: pode rodar mais de uma vez (o acerto só pega completa gravada abaixo de R$ 0,20).

drop policy if exists placa_consultas_ler on public.placa_consultas;
create policy placa_consultas_ler on public.placa_consultas for select to authenticated using (public.e_admin());

update public.placa_consultas
   set saldo_centavos = case when saldo_centavos is null then null else greatest(0, saldo_centavos - (20 - valor_centavos)) end,
       valor_centavos = 20
 where tipo = 'completa' and valor_centavos > 0 and valor_centavos < 20;
