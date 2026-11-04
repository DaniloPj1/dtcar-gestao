-- =====================================================================
-- DTCar Gestão — v30: Documentos do RH (Financeiro › Funcionários e RH).
--
-- Guarda os PDFs que a contabilidade manda (recibos, pró-labore, folha de ponto,
-- DARF, FGTS, laudos) para consultar e imprimir pelo sistema.
--   rh_documentos: um registro por arquivo, com competência (AAAA-MM), tipo e,
--                  nas guias, valor, vencimento e linha digitável.
--   pasta "rh":    arquivos, privada. Só o administrador lê, inclui e exclui.
-- Os arquivos chegam:
--   * do e-mail da oficina (função "email", ação importar_rh): a função grava com a
--     chave de servidor e nunca importa o mesmo anexo duas vezes (email_id + anexo_id);
--   * à mão, pela tela (ex.: DAS recebido no WhatsApp).
-- Contém dado pessoal e salário: só o administrador. Fora do espelho (preservado),
-- fora do banco do PC e fora do backup (o arquivo fica na pasta do Supabase).
-- Pode rodar mais de uma vez. Precisa do v29 (e-mail) só para importar do e-mail.
-- =====================================================================

create table if not exists public.rh_documentos (
  id uuid primary key default gen_random_uuid(),
  competencia text not null check (competencia ~ '^\d{4}-\d{2}$'),     -- mês a que o documento se refere
  tipo text not null default 'outro' check (tipo in ('recibo', 'adiantamento', 'pro_labore', 'folha_ponto', 'darf', 'fgts', 'das', 'inss', 'laudo', 'epi', 'outro')),
  titulo text not null default '',
  arquivo text not null,                         -- caminho na pasta "rh"
  nome_arquivo text not null default '',
  tipo_arquivo text not null default '',
  tamanho int not null default 0,
  origem text not null default 'manual' check (origem in ('email', 'manual')),
  email_id text,                                 -- mensagem e anexo de origem (evita importar duas vezes)
  anexo_id text,
  email_de text not null default '',
  email_assunto text not null default '',
  email_data timestamptz,
  valor numeric(12,2),                           -- guias: lidos do PDF
  vencimento date,
  linha_digitavel text not null default '',
  obs text not null default '',
  criado_por text not null default '',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists rh_documentos_anexo on public.rh_documentos (email_id, anexo_id) where email_id is not null;
create index if not exists rh_documentos_comp on public.rh_documentos (competencia, tipo);
alter table public.rh_documentos enable row level security;
drop policy if exists rh_documentos_admin on public.rh_documentos;
create policy rh_documentos_admin on public.rh_documentos for all to authenticated using (public.e_admin()) with check (public.e_admin());
revoke all on public.rh_documentos from anon, authenticated;
grant select, insert, update, delete on public.rh_documentos to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'agente_leitura') then
    execute 'revoke all on public.rh_documentos from agente_leitura';
  end if;
end $$;

-- pasta privada dos arquivos (até 15 MB por arquivo: PDF e imagem)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('rh', 'rh', false, 15728640, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
drop policy if exists rh_storage_ler on storage.objects;
create policy rh_storage_ler on storage.objects for select to authenticated using (bucket_id = 'rh' and public.e_admin());
drop policy if exists rh_storage_incluir on storage.objects;
create policy rh_storage_incluir on storage.objects for insert to authenticated with check (bucket_id = 'rh' and public.e_admin());
drop policy if exists rh_storage_excluir on storage.objects;
create policy rh_storage_excluir on storage.objects for delete to authenticated using (bucket_id = 'rh' and public.e_admin());
