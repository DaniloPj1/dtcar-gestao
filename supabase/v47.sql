-- =====================================================================
-- DTCar Gestão — v47: conteúdo editável do site institucional (dtcarcentroautomotivo.com.br).
--
-- Pedido do Danilo (08/11/2026): editar o site da oficina pelo próprio site, com o login do DTCar Gestão.
--
-- Como funciona:
--   * O site (repositório dtcar-site) tem o conteúdo padrão escrito nele. Ao abrir, pede a versão publicada
--     (site_conteudo_publicado(), liberada para qualquer visitante) e aplica por cima. Se o Supabase não responder,
--     o site continua com o conteúdo padrão.
--   * Só administrador edita: o rascunho fica em site_rascunho (uma linha só) e cada "Publicar" grava uma linha nova em
--     site_publicacoes (histórico; "voltar para esta" publica de novo uma versão antiga). Nada é apagado.
--   * O conteúdo é JSON com textos, tamanhos, links, fotos e ordem/visibilidade das seções. O site aplica texto sempre
--     como texto puro (nunca HTML) e só aceita links https, mailto e tel e fotos desta pasta ou do próprio site.
--   * Fotos ficam na pasta pública "site" (até 5 MB, jpg/png/webp). Só administrador envia ou apaga.
--
-- Fora do backup, do banco do PC e do espelho: não é dado da oficina (O.S., dinheiro, cadastro, estoque) e o histórico
-- de publicações já guarda todas as versões. Igual antes e depois da virada.
-- Pode rodar mais de uma vez.
-- =====================================================================

create table if not exists public.site_rascunho (
  id int primary key default 1 check (id = 1),
  dados jsonb not null default '{}'::jsonb check (octet_length(dados::text) <= 300000),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid default auth.uid()
);

create table if not exists public.site_publicacoes (
  id bigint generated always as identity primary key,
  dados jsonb not null check (octet_length(dados::text) <= 300000),
  observacao text not null default '' check (length(observacao) <= 200),
  publicado_em timestamptz not null default now(),
  publicado_por uuid default auth.uid()
);
create index if not exists site_publicacoes_recentes on public.site_publicacoes (publicado_em desc);

alter table public.site_rascunho enable row level security;
alter table public.site_publicacoes enable row level security;

drop policy if exists site_rascunho_admin on public.site_rascunho;
create policy site_rascunho_admin on public.site_rascunho for all to authenticated
  using (public.e_admin()) with check (public.e_admin());

-- Publicações: administrador lê e inclui; ninguém altera nem apaga (histórico).
drop policy if exists site_publicacoes_ler on public.site_publicacoes;
create policy site_publicacoes_ler on public.site_publicacoes for select to authenticated using (public.e_admin());
drop policy if exists site_publicacoes_incluir on public.site_publicacoes;
create policy site_publicacoes_incluir on public.site_publicacoes for insert to authenticated with check (public.e_admin());
revoke update, delete on public.site_publicacoes from anon, authenticated;
revoke all on public.site_rascunho, public.site_publicacoes from anon;
grant select, insert, update on public.site_rascunho to authenticated;
grant select, insert on public.site_publicacoes to authenticated;

-- Versão publicada para o visitante (sem login). Só devolve o conteúdo e a data, nunca quem publicou.
create or replace function public.site_conteudo_publicado() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select jsonb_build_object('dados', dados, 'publicado_em', publicado_em, 'versao', id)
       from public.site_publicacoes order by publicado_em desc, id desc limit 1),
    '{}'::jsonb)
$$;
revoke all on function public.site_conteudo_publicado() from public;
grant execute on function public.site_conteudo_publicado() to anon, authenticated;

-- Pasta pública das fotos do site.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site', 'site', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists site_fotos_incluir on storage.objects;
create policy site_fotos_incluir on storage.objects for insert to authenticated
  with check (bucket_id = 'site' and public.e_admin());
drop policy if exists site_fotos_alterar on storage.objects;
create policy site_fotos_alterar on storage.objects for update to authenticated
  using (bucket_id = 'site' and public.e_admin()) with check (bucket_id = 'site' and public.e_admin());
drop policy if exists site_fotos_apagar on storage.objects;
create policy site_fotos_apagar on storage.objects for delete to authenticated
  using (bucket_id = 'site' and public.e_admin());
