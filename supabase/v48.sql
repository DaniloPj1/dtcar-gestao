-- =====================================================================
-- DTCar Gestão — v48: ajuste das permissões do conteúdo do site (complementa o v47).
--
-- Achados da revisão independente (08/11/2026):
--   * O navegador podia mandar a data de publicação (ex.: 2099) e deixar uma versão "presa" no ar, porque a versão
--     publicada era escolhida pela data. Agora vale a ÚLTIMA gravada (id), e a data/autor saem só do banco.
--   * O padrão do Supabase dá todas as permissões ao usuário logado (inclusive apagar e TRUNCATE, que passa por cima
--     das regras). Agora o logado só lê, inclui e altera as colunas que o editor usa; o histórico continua sem
--     alterar nem apagar. As regras de administrador (RLS) do v47 continuam valendo.
-- Rode depois do v47. Pode rodar mais de uma vez. Não muda nada para a oficina.
-- =====================================================================

revoke all on public.site_rascunho, public.site_publicacoes from authenticated;
revoke all on public.site_rascunho, public.site_publicacoes from anon;

grant select on public.site_rascunho to authenticated;
grant insert (id, dados, atualizado_em) on public.site_rascunho to authenticated;
grant update (dados, atualizado_em) on public.site_rascunho to authenticated;

grant select on public.site_publicacoes to authenticated;
grant insert (dados, observacao) on public.site_publicacoes to authenticated;

create or replace function public.site_conteudo_publicado() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select jsonb_build_object('dados', dados, 'publicado_em', publicado_em, 'versao', id)
       from public.site_publicacoes order by id desc limit 1),
    '{}'::jsonb)
$$;
revoke all on function public.site_conteudo_publicado() from public;
grant execute on function public.site_conteudo_publicado() to anon, authenticated;
