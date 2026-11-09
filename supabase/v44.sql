-- =====================================================================
-- DTCar Gestão — v44: "Excluir O.S. definitivamente" com peça do estoque (07/11/2026)
--
-- Defeito achado na revisão do v40: ao excluir uma O.S. que tem peça reservada no estoque,
-- a exclusão em cascata dos itens devolve a peça ao estoque gravando um movimento que aponta
-- para a O.S. que está saindo, e o banco recusa (chave do estoque_mov). A tela mostrava erro.
-- excluir_ordem: numa transação, tira os itens primeiro (a peça volta ao estoque com o
-- movimento ainda ligado à O.S.; depois a ligação fica vazia) e então a O.S.
-- Só administrador (mesma regra da exclusão pela tela). Pode rodar mais de uma vez.
-- Antes do v44 rodar, a tela usa o caminho antigo (que continua funcionando sem peça do estoque).
-- =====================================================================
create or replace function public.excluir_ordem(p_id uuid) returns void
language plpgsql volatile security invoker set search_path = public as $$
begin
  if not public.e_admin() then raise exception 'Só o administrador exclui O.S.'; end if;
  perform 1 from public.ordens where id = p_id for update;
  if not found then raise exception 'O.S. não encontrada.'; end if;
  delete from public.os_itens where ordem_id = p_id;
  delete from public.ordens where id = p_id;
end $$;
revoke all on function public.excluir_ordem(uuid) from public, anon;
grant execute on function public.excluir_ordem(uuid) to authenticated;
