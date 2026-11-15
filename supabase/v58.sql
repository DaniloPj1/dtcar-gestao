-- v58 — Cadastros antigos em LETRAS MAIÚSCULAS (pedido do Danilo em 15/11/2026).
-- A partir da v146 das telas, o nome do cliente e a descrição de produtos e serviços já são gravados em maiúsculas.
-- Este arquivo converte o que foi cadastrado antes. Mesma regra da tela (MAIUSC em js/maiusculas.js):
-- tira espaços sobrando e passa para maiúsculas. Não muda mais nada (telefone, endereço, preço, estoque ficam como estão).
-- Pode rodar mais de uma vez: só mexe em linha que ainda não está em maiúsculas.
-- As O.S., recibos e notas já emitidos guardam a própria cópia do nome e NÃO são alterados.

update public.clientes
   set nome = upper(btrim(regexp_replace(nome, '\s+', ' ', 'g')))
 where nome is not null
   and nome is distinct from upper(btrim(regexp_replace(nome, '\s+', ' ', 'g')));

update public.produtos
   set descricao = upper(btrim(regexp_replace(descricao, '\s+', ' ', 'g')))
 where descricao is not null
   and descricao is distinct from upper(btrim(regexp_replace(descricao, '\s+', ' ', 'g')));

-- Conferência: as duas contagens têm de dar zero.
select 'clientes fora de maiúsculas' as conferencia, count(*) as quantos from public.clientes where nome is distinct from upper(btrim(regexp_replace(nome, '\s+', ' ', 'g')))
union all
select 'produtos e serviços fora de maiúsculas', count(*) from public.produtos where descricao is distinct from upper(btrim(regexp_replace(descricao, '\s+', ' ', 'g')));
