-- =====================================================================
-- DTCar Gestão — v33: Notas fiscais anexadas à O.S. (pedido do Danilo, 04/11/2026).
--
-- A NF de venda é emitida fora do sistema (ObjetivaWeb). Para mandar por e-mail junto
-- com a O.S. e o boleto, o PDF e/ou o XML da nota são anexados à mão na tela da O.S.
-- (Documentos › NF). O Claude pede pelo conector: anexo { fonte: "nf", os: 1887 }.
--   os_notas:     um registro por arquivo, ligado pelo NÚMERO da O.S. (o mesmo do OS Oficina).
--   pasta "notas": arquivos, privada.
-- PRESERVADA pelo espelho do sistema antigo (fora de espelho_legado_zerar), sem chave
-- estrangeira para ordens: a NF emitida é documento fiscal real e continua valendo depois de
-- cada carga; o número da O.S. não muda com a carga (vem do OS Oficina).
-- Antes da virada: só guarda o arquivo da nota que já foi emitida no ObjetivaWeb (não lança
-- nada de O.S., dinheiro ou estoque). Depois da virada: igual.
-- Só o administrador lê, inclui e exclui (o agente_leitura não lê).
-- Pode rodar mais de uma vez.
-- =====================================================================

create table if not exists public.os_notas (
  id uuid primary key default gen_random_uuid(),
  os_numero int not null,
  placa text not null default '',
  numero_nf text not null default '',            -- número da nota (lido do XML ou digitado)
  arquivo text not null,                         -- caminho na pasta "notas"
  nome_arquivo text not null default '',
  tipo_arquivo text not null default '',
  tamanho int not null default 0,
  obs text not null default '',
  criado_por text not null default '',
  criado_em timestamptz not null default now()
);
create index if not exists os_notas_os on public.os_notas (os_numero);
alter table public.os_notas enable row level security;
drop policy if exists os_notas_admin on public.os_notas;
create policy os_notas_admin on public.os_notas for all to authenticated using (public.e_admin()) with check (public.e_admin());
revoke all on public.os_notas from anon, authenticated;
grant select, insert, update, delete on public.os_notas to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'agente_leitura') then
    execute 'revoke all on public.os_notas from agente_leitura';
  end if;
end $$;

-- pasta privada (até 5 MB por arquivo: PDF e XML)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('notas', 'notas', false, 5242880, array['application/pdf', 'application/xml', 'text/xml'])
on conflict (id) do nothing;
drop policy if exists notas_storage_ler on storage.objects;
create policy notas_storage_ler on storage.objects for select to authenticated using (bucket_id = 'notas' and public.e_admin());
drop policy if exists notas_storage_incluir on storage.objects;
create policy notas_storage_incluir on storage.objects for insert to authenticated with check (bucket_id = 'notas' and public.e_admin());
drop policy if exists notas_storage_excluir on storage.objects;
create policy notas_storage_excluir on storage.objects for delete to authenticated using (bucket_id = 'notas' and public.e_admin());

-- ---------------------------------------------------------------------
-- E-mail com anexo (função "email", anexos.ts): o histórico guarda os NOMES dos arquivos
-- enviados (nunca o conteúdo). Sem o v29 rodado, esta parte não faz nada.
-- ---------------------------------------------------------------------
do $$ begin
  if to_regclass('public.email_envios') is not null then
    execute 'alter table public.email_envios add column if not exists anexos text not null default ''''';
    execute $f$
create or replace function public.email_registrar_envio(p jsonb)
returns bigint language plpgsql security definer set search_path = public as $b$
declare v_id bigint; quem text;
begin
  if not public.e_admin() then raise exception 'Só o administrador mexe no e-mail.'; end if;
  select nome into quem from public.perfis where id = auth.uid();
  insert into public.email_envios (tipo, para, cc, assunto, resumo, resposta_a, pedido, por, anexos)
  values (coalesce(p->>'tipo', 'enviar'), left(coalesce(p->>'para', ''), 1000), left(coalesce(p->>'cc', ''), 1000), left(coalesce(p->>'assunto', ''), 300),
          left(coalesce(p->>'texto', ''), 300), left(coalesce(p->>'resposta_a', ''), 300), left(coalesce(p->>'pedido', ''), 500), coalesce(quem, ''),
          left(coalesce(p->>'anexos', ''), 1000))
  returning id into v_id;
  insert into public.agente_acoes (ferramenta, pedido, tabela, registro, antes, depois, confirmado_por)
  values ('email_' || coalesce(p->>'tipo', 'enviar'), coalesce(p->>'pedido', ''), 'email_envios', v_id::text, null,
          jsonb_build_object('para', p->>'para', 'cc', p->>'cc', 'assunto', p->>'assunto', 'resposta_a', p->>'resposta_a', 'resumo', left(coalesce(p->>'texto', ''), 300),
                             'anexos', coalesce(p->>'anexos', '')),
          coalesce(quem, ''));
  update public.email_conexao set ultimo_uso = now() where id = 1;
  return v_id;
end $b$;
$f$;
  end if;
end $$;
