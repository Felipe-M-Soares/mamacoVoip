-- ============================================================
-- 014 — MOVER MEMBROS ENTRE CANAIS DE VOZ ("arrastar" estilo Discord)
--
-- Dono do servidor (ou quem tem a permissão nova `move_members`, ou
-- `administrator`) pode arrastar alguém de uma sala de voz pra outra.
--
-- Por que uma tabela + RPC em vez de um broadcast do Realtime: o
-- payload de broadcast é montado pelo próprio cliente — qualquer um
-- poderia forjar um "você foi movido" e ficar jogando os outros de
-- sala em sala. Aqui só a função move_voice_member() (security
-- definer, que confere permissão, filiação, tipo do canal e hierarquia
-- de cargos) grava em voice_move_requests; o app do alvo escuta os
-- INSERTs dessa tabela via postgres_changes (que respeita a RLS: cada
-- um só recebe as linhas em que é o alvo) e troca de sala sozinho.
--
-- IDEMPOTENTE: pode rodar quantas vezes quiser. Rode DEPOIS da 013.
-- ============================================================


-- ================================================================
-- 1) Permissão nova: move_members
--
-- valid_permissions() e my_permissions() (013) têm a lista fixa —
-- precisam conhecer a permissão nova, senão create_role/update_role
-- recusam o cargo e o dono não aparece com ela no app.
-- ================================================================
create or replace function public.valid_permissions()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['administrator','manage_server','manage_roles','manage_channels','manage_messages',
               'kick_members','ban_members','timeout_members','view_audit_log','move_members']::text[];
$$;

create or replace function public.my_permissions(p_server_id uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then array[]::text[]
    when exists (select 1 from public.servers where id = p_server_id and owner_id = auth.uid())
      then array['administrator','manage_server','manage_roles','manage_channels','manage_messages',
                 'kick_members','ban_members','timeout_members','view_audit_log','move_members']
    when not exists (select 1 from public.server_members where server_id = p_server_id and user_id = auth.uid())
      then array[]::text[]
    else coalesce((
      select array_agg(distinct u.perm)
      from public.server_member_roles smr
      join public.roles r on r.id = smr.role_id
      cross join lateral unnest(r.permissions) as u(perm)
      where smr.server_id = p_server_id and smr.user_id = auth.uid()
    ), array[]::text[])
  end;
$$;


-- ================================================================
-- 2) Log de moderação: ação nova 'member_moved'
--
-- A checagem de "action" foi criada inline na 004 (nome gerado pelo
-- Postgres). Troca por uma com nome fixo que inclui a ação nova.
-- ================================================================
do $$
declare
  r record;
begin
  for r in
    select conname from pg_constraint
    where contype = 'c' and conrelid = 'public.moderation_logs'::regclass
      and pg_get_constraintdef(oid) ilike '%action%'
  loop
    execute format('alter table public.moderation_logs drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.moderation_logs add constraint moderation_logs_action_check check (
  action in (
    'kick', 'ban', 'unban', 'timeout', 'remove_timeout',
    'role_created', 'role_deleted', 'role_assigned', 'role_removed',
    'message_deleted', 'member_moved'
  )
);


-- ================================================================
-- 3) Tabela de pedidos de "mover" (só a RPC escreve)
-- ================================================================
create table if not exists public.voice_move_requests (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers(id) on delete cascade,
  target_user_id uuid not null references auth.users(id) on delete cascade,
  to_channel_id uuid not null references public.channels(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists voice_move_requests_target_idx on public.voice_move_requests (target_user_id);
create index if not exists voice_move_requests_created_idx on public.voice_move_requests (created_at);
create index if not exists voice_move_requests_requester_idx on public.voice_move_requests (requested_by, created_at);
create index if not exists voice_move_requests_server_idx on public.voice_move_requests (server_id);
create index if not exists voice_move_requests_channel_idx on public.voice_move_requests (to_channel_id);

alter table public.voice_move_requests enable row level security;

-- Só leitura, e só das próprias linhas (é isso que filtra o
-- postgres_changes: o Realtime entrega um INSERT só pra quem passa na
-- política de SELECT). Nenhuma política de insert/update/delete —
-- ninguém escreve direto, só via move_voice_member().
drop policy if exists "Alvo vê os próprios pedidos de mover" on public.voice_move_requests;
create policy "Alvo vê os próprios pedidos de mover"
  on public.voice_move_requests for select to authenticated
  using (target_user_id = (select auth.uid()));

-- Mesma regra da 013 (item 12): com 2FA ativado, só responde em sessão aal2.
drop policy if exists "Exige 2FA quando ativado" on public.voice_move_requests;
create policy "Exige 2FA quando ativado"
  on public.voice_move_requests as restrictive for all to authenticated
  using ((select public.mfa_requirement_met())) with check ((select public.mfa_requirement_met()));

revoke all on table public.voice_move_requests from public, anon, authenticated;
grant select on table public.voice_move_requests to authenticated;

-- Realtime (postgres_changes) precisa da tabela na publicação.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'voice_move_requests'
  ) then
    alter publication supabase_realtime add table public.voice_move_requests;
  end if;
end $$;


-- ================================================================
-- 4) RPC: move_voice_member
--
-- Valida tudo no banco e grava o pedido. Quem de fato troca de sala é
-- o app do alvo (a conexão de voz/LiveKit é dele) — se ele não estiver
-- numa sala de voz desse servidor, o pedido é simplesmente ignorado.
-- ================================================================
create or replace function public.move_voice_member(p_server_id uuid, p_user_id uuid, p_to_channel_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_channel public.channels;
  v_id uuid;
begin
  if v_caller is null then
    raise exception 'Faça login primeiro';
  end if;
  if not public.mfa_requirement_met() then
    raise exception 'Confirme a verificação em duas etapas primeiro';
  end if;
  if p_server_id is null or p_user_id is null or p_to_channel_id is null then
    raise exception 'Dados incompletos para mover o membro';
  end if;

  -- has_permission já trata dono (sempre true) e administrator.
  if not public.has_permission(p_server_id, v_caller, 'move_members') then
    raise exception 'Você não tem permissão para mover membros';
  end if;

  if not exists (select 1 from public.server_members where server_id = p_server_id and user_id = p_user_id)
     and not exists (select 1 from public.servers where id = p_server_id and owner_id = p_user_id) then
    raise exception 'Essa pessoa não é membro do servidor';
  end if;

  -- Hierarquia: não dá pra mover alguém com cargo igual ou superior ao
  -- seu (o dono do servidor fica sempre no topo). Mover a si mesmo pode.
  if p_user_id <> v_caller
     and public.top_role_position(p_server_id, p_user_id) >= public.top_role_position(p_server_id, v_caller) then
    raise exception 'Você não pode mover alguém com cargo igual ou superior ao seu';
  end if;

  select * into v_channel from public.channels where id = p_to_channel_id;
  if v_channel.id is null or v_channel.server_id <> p_server_id then
    raise exception 'Canal de destino não encontrado neste servidor';
  end if;
  if v_channel.type <> 'voice' then
    raise exception 'O canal de destino precisa ser um canal de voz';
  end if;

  -- Canal restrito: o ALVO precisa conseguir entrar nele.
  if v_channel.is_restricted
     and not exists (select 1 from public.servers where id = p_server_id and owner_id = p_user_id)
     and not public.has_permission(p_server_id, p_user_id, 'manage_channels')
     and not public.user_has_channel_role_access(v_channel.id, p_user_id) then
    raise exception 'Essa pessoa não tem acesso ao canal de destino';
  end if;

  -- Anti-flood: no máximo 30 movimentações por minuto por pessoa.
  if (
    select count(*) from public.voice_move_requests
    where requested_by = v_caller and created_at > now() - interval '1 minute'
  ) >= 30 then
    raise exception 'Muitas movimentações seguidas — espere um pouco e tente de novo';
  end if;

  -- Limpeza: os pedidos só servem no instante em que chegam pelo Realtime.
  delete from public.voice_move_requests where created_at < now() - interval '1 day';

  insert into public.voice_move_requests (server_id, target_user_id, to_channel_id, requested_by)
  values (p_server_id, p_user_id, p_to_channel_id, v_caller)
  returning id into v_id;

  insert into public.moderation_logs (server_id, actor_id, action, target_user_id, metadata)
  values (
    p_server_id, v_caller, 'member_moved', p_user_id,
    jsonb_build_object('to_channel_id', v_channel.id, 'to_channel_name', v_channel.name)
  );

  return v_id;
end;
$$;

revoke execute on function public.move_voice_member(uuid, uuid, uuid) from public, anon;
grant execute on function public.move_voice_member(uuid, uuid, uuid) to authenticated;
revoke execute on function public.valid_permissions() from public, anon;
grant execute on function public.valid_permissions() to authenticated;
revoke execute on function public.my_permissions(uuid) from public, anon;
grant execute on function public.my_permissions(uuid) to authenticated;
