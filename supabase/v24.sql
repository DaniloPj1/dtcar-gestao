-- =====================================================================
-- DTCar Gestão — v24: WhatsApp, etapa 2 — motor no Android e revezamento.
--
-- O "motor" é um programa que roda num celular Android (Termux) e mantém a
-- conexão com o WhatsApp ligada o dia todo. Quando ele não está ligado, a função
-- "zap" do Supabase faz o serviço sob demanda (reserva).
--
-- Segurança: o motor NÃO recebe a chave mestra do banco. Ele usa uma chave
-- própria, gerada pelo administrador na tela Sistema › WhatsApp, que só serve
-- para as funções whatsapp_motor_* abaixo (sessão e situação do WhatsApp). O
-- banco guarda só o resumo (sha256) da chave. Gerar outra chave ou revogar
-- invalida a anterior na hora.
--
-- Revezamento: quem está com a conexão (dono = 'android' ou 'supabase') renova
-- a vez a cada 30 s (dono_ate). Ninguém conecta enquanto a vez de outro estiver
-- valendo, para nunca haver duas conexões com a mesma sessão.
--
-- Rode depois do v23. Pode rodar mais de uma vez. Não mexe em dados da oficina.
-- =====================================================================

alter table public.whatsapp_conexao add column if not exists dono_id text;              -- processo que está com a vez
alter table public.whatsapp_conexao add column if not exists dono_ate timestamptz;       -- a vez vale até
alter table public.whatsapp_conexao add column if not exists motor_hash text;            -- sha256 da chave do motor
alter table public.whatsapp_conexao add column if not exists motor_chave_em timestamptz; -- quando a chave foi gerada
alter table public.whatsapp_conexao add column if not exists motor_visto timestamptz;    -- último sinal do motor
alter table public.whatsapp_conexao add column if not exists motor_info jsonb;           -- versão, aparelho, contadores
alter table public.whatsapp_conexao add column if not exists pedido text;                -- pedido ao motor ('desconectar')

-- a tela (administrador) lê a situação, mas não o resumo da chave
revoke select on public.whatsapp_conexao from authenticated;
grant select (id, situacao, numero, dono, detalhe, ultimo_teste, atualizado_em, qr_svg, dono_ate,
              motor_chave_em, motor_visto, motor_info, pedido) on public.whatsapp_conexao to authenticated;

-- Pega ou renova a vez da conexão. Devolve true se ficou com ela.
-- Uso interno (motor e função zap); não fica exposta ao sistema.
create or replace function public.whatsapp_pegar_vez(p_dono text, p_id text, p_segundos int)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.whatsapp_conexao
     set dono = p_dono, dono_id = p_id, dono_ate = now() + make_interval(secs => least(greatest(p_segundos, 10), 300))
   where id = 1 and (dono_ate is null or dono_ate < now() or dono_id = p_id);
  return found;
end $$;

create or replace function public.whatsapp_soltar_vez(p_id text)
returns void language sql security definer set search_path = public as $$
  update public.whatsapp_conexao set dono_ate = null where id = 1 and dono_id = p_id;
$$;

revoke all on function public.whatsapp_pegar_vez(text, text, int) from public, anon, authenticated;
revoke all on function public.whatsapp_soltar_vez(text) from public, anon, authenticated;
grant execute on function public.whatsapp_pegar_vez(text, text, int) to service_role;
grant execute on function public.whatsapp_soltar_vez(text) to service_role;

-- ---------------------------------------------------------------------
-- Chave do motor (só administrador). Devolve a chave UMA vez; o banco guarda o resumo.
-- ---------------------------------------------------------------------
create or replace function public.whatsapp_motor_nova_chave()
returns text language plpgsql security definer set search_path = public as $$
declare v_chave text;
begin
  if not public.e_admin() then raise exception 'Só o administrador gera a chave do motor.'; end if;
  -- 2 UUID aleatórios = 244 bits de acaso (gerador seguro do Postgres)
  v_chave := 'dtm_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  update public.whatsapp_conexao
     set motor_hash = encode(sha256(convert_to(v_chave, 'UTF8')), 'hex'), motor_chave_em = now(), atualizado_em = now()
   where id = 1;
  return v_chave;
end $$;

create or replace function public.whatsapp_motor_revogar()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.e_admin() then raise exception 'Só o administrador revoga a chave do motor.'; end if;
  -- tira a chave e, se o motor estava com a vez, libera (a função zap pode conectar)
  update public.whatsapp_conexao
     set motor_hash = null, motor_chave_em = null,
         dono_ate = case when dono = 'android' then null else dono_ate end, atualizado_em = now()
   where id = 1;
end $$;

-- pedido ao motor feito pela tela (hoje só 'desconectar'); quem chama é a função zap (chave de servidor)
revoke all on function public.whatsapp_motor_nova_chave() from public, anon;
revoke all on function public.whatsapp_motor_revogar() from public, anon;
grant execute on function public.whatsapp_motor_nova_chave() to authenticated;
grant execute on function public.whatsapp_motor_revogar() to authenticated;

-- ---------------------------------------------------------------------
-- Funções que o motor chama (com a chave publicável + a chave do motor).
-- ---------------------------------------------------------------------
create or replace function public.whatsapp_motor_conferir(p_chave text)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if p_chave is null or length(p_chave) < 40 or not exists (
       select 1 from public.whatsapp_conexao
        where id = 1 and motor_hash is not null and motor_hash = encode(sha256(convert_to(p_chave, 'UTF8')), 'hex')) then
    raise exception 'Chave do motor inválida ou revogada.' using errcode = '28000';
  end if;
end $$;

-- a vez do motor só vale com a chave certa E sendo ele o dono atual
create or replace function public.whatsapp_motor_com_vez(p_chave text, p_id text)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  perform public.whatsapp_motor_conferir(p_chave);
  if not exists (select 1 from public.whatsapp_conexao where id = 1 and dono = 'android' and dono_id = p_id and dono_ate > now()) then
    raise exception 'O motor não está com a vez da conexão.' using errcode = '55000';
  end if;
end $$;

-- Sinal a cada ~30 s: registra o motor, tenta pegar/renovar a vez e devolve o que fazer.
-- Sem celular vinculado o motor não fica com a vez (o pareamento por QR Code é feito pela função zap).
create or replace function public.whatsapp_motor_pulso(p_chave text, p_id text, p_info jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_vez boolean := false; v_vinculado boolean; v public.whatsapp_conexao;
begin
  perform public.whatsapp_motor_conferir(p_chave);
  update public.whatsapp_conexao set motor_visto = now(), motor_info = coalesce(p_info, '{}'::jsonb) where id = 1;
  -- pelo QR Code a sessão tem creds.me; pelo código, creds.registered
  select exists (select 1 from public.whatsapp_sessao where chave = 'creds'
                  and (valor -> 'me' ->> 'id' is not null or coalesce((valor ->> 'registered')::boolean, false)))
    into v_vinculado;
  if v_vinculado then v_vez := public.whatsapp_pegar_vez('android', p_id, 90);
  else perform public.whatsapp_soltar_vez(p_id); end if;
  select * into v from public.whatsapp_conexao where id = 1;
  return jsonb_build_object('vez', v_vez, 'vinculado', v_vinculado, 'pedido', case when v_vez then v.pedido end,
                            'situacao', v.situacao, 'dono', v.dono, 'dono_ate', v.dono_ate);
end $$;

create or replace function public.whatsapp_motor_soltar(p_chave text, p_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.whatsapp_motor_conferir(p_chave);
  perform public.whatsapp_soltar_vez(p_id);
end $$;

-- Lê chaves da sessão (só com a vez).
create or replace function public.whatsapp_motor_ler(p_chave text, p_id text, p_chaves text[])
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.whatsapp_motor_com_vez(p_chave, p_id);
  return coalesce((select jsonb_object_agg(chave, valor) from public.whatsapp_sessao
                    where chave = any(p_chaves) and chave <> 'pareamento'), '{}'::jsonb);
end $$;

-- Grava (p_poe: {chave: valor}) e apaga (p_tira) chaves da sessão (só com a vez).
create or replace function public.whatsapp_motor_gravar(p_chave text, p_id text, p_poe jsonb, p_tira text[] default '{}')
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.whatsapp_motor_com_vez(p_chave, p_id);
  if p_poe is not null and jsonb_typeof(p_poe) = 'object' then
    insert into public.whatsapp_sessao (chave, valor, atualizado_em)
    select e.key, e.value, now() from jsonb_each(p_poe) e where e.key <> 'pareamento' and e.value <> 'null'::jsonb
    on conflict (chave) do update set valor = excluded.valor, atualizado_em = excluded.atualizado_em;
  end if;
  if p_tira is not null and array_length(p_tira, 1) > 0 then
    delete from public.whatsapp_sessao where chave = any(p_tira) and chave <> 'pareamento';
  end if;
end $$;

-- O celular desvinculou o aparelho (ou pedido de desconectar): apaga a sessão inteira (só com a vez).
create or replace function public.whatsapp_motor_apagar_sessao(p_chave text, p_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.whatsapp_motor_com_vez(p_chave, p_id);
  delete from public.whatsapp_sessao where chave <> 'pareamento';
end $$;

-- Atualiza a situação mostrada na tela (só os campos permitidos; só com a vez).
create or replace function public.whatsapp_motor_situacao(p_chave text, p_id text, p_situacao text, p_detalhe text,
                                                           p_numero text default null, p_limpar_pedido boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.whatsapp_motor_com_vez(p_chave, p_id);
  if p_situacao not in ('desligado', 'conectado', 'erro') then raise exception 'Situação inválida: %', p_situacao; end if;
  update public.whatsapp_conexao
     set situacao = p_situacao, detalhe = left(coalesce(p_detalhe, ''), 300),
         numero = coalesce(left(p_numero, 30), numero), qr_svg = null,
         pedido = case when p_limpar_pedido then null else pedido end, atualizado_em = now()
   where id = 1;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'whatsapp_motor_conferir(text)', 'whatsapp_motor_com_vez(text, text)', 'whatsapp_motor_pulso(text, text, jsonb)',
    'whatsapp_motor_soltar(text, text)', 'whatsapp_motor_ler(text, text, text[])', 'whatsapp_motor_gravar(text, text, jsonb, text[])',
    'whatsapp_motor_apagar_sessao(text, text)', 'whatsapp_motor_situacao(text, text, text, text, text, boolean)'] loop
    execute 'revoke all on function public.' || f || ' from public, authenticated';
    execute 'grant execute on function public.' || f || ' to anon, service_role';
  end loop;
  if exists (select 1 from pg_roles where rolname = 'agente_leitura') then
    execute 'revoke all on public.whatsapp_conexao from agente_leitura';
  end if;
end $$;
-- conferir e com_vez são internas: não precisam ficar chamáveis de fora
revoke execute on function public.whatsapp_motor_conferir(text) from anon;
revoke execute on function public.whatsapp_motor_com_vez(text, text) from anon;

notify pgrst, 'reload schema';
