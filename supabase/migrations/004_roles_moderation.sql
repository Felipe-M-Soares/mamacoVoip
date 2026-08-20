-- ============================================================
-- CONSOLIDADO 004: cargos, permissões, banimentos, log de moderação
-- (junta: 006_roles_moderation)
--
-- Só pra ORGANIZAÇÃO/REFERÊNCIA — não rode num banco que já tem essa
-- migration aplicada.
-- ============================================================


-- ==== originalmente: 006_roles_moderation.sql ====
-- ============================================================
-- FASE 7 — Administração (cargos, permissões, moderação)
-- Rode isto no SQL Editor do Supabase, depois da 005_friends_dms.sql
-- ============================================================

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  color text not null default '#99aab5',
  position int not null default 0, -- maior posição = mais alto na hierarquia
  permissions text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.server_member_roles (
  server_id uuid not null references public.servers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (server_id, user_id, role_id)
);

create table if not exists public.bans (
  server_id uuid not null references public.servers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  banned_by uuid not null references auth.users(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now(),
  primary key (server_id, user_id)
);

create table if not exists public.moderation_logs (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (
    action in (
      'kick', 'ban', 'unban', 'timeout', 'remove_timeout',
      'role_created', 'role_deleted', 'role_assigned', 'role_removed',
      'message_deleted'
    )
  ),
  target_user_id uuid references auth.users(id) on delete set null,
  reason text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

-- timeout_until já está direto na tabela server_members, lá no 001_core.sql

create index if not exists roles_server_idx on public.roles (server_id);
create index if not exists server_member_roles_user_idx on public.server_member_roles (server_id, user_id);
create index if not exists moderation_logs_server_idx on public.moderation_logs (server_id, created_at);

-- ============================================================
-- Permissões válidas (documentação — não é um enum de verdade pra
-- manter flexibilidade, mas as funções abaixo só reconhecem estas):
-- 'administrator'    — ignora todas as outras checagens
-- 'manage_server'    — editar nome/ícone do servidor (dono sempre pode)
-- 'manage_roles'     — criar/editar/excluir cargos e atribuí-los
-- 'manage_channels'  — criar/editar/excluir canais e categorias
-- 'manage_messages'  — excluir mensagens de qualquer membro
-- 'kick_members'
-- 'ban_members'
-- 'timeout_members'
-- 'view_audit_log'
-- ============================================================

-- ============================================================
-- Helper: verifica permissão (dono do servidor sempre passa)
-- ============================================================
create or replace function public.has_permission(p_server_id uuid, p_user_id uuid, p_permission text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    exists (select 1 from public.servers where id = p_server_id and owner_id = p_user_id)
    or exists (
      select 1
      from public.server_member_roles smr
      join public.roles r on r.id = smr.role_id
      where smr.server_id = p_server_id
        and smr.user_id = p_user_id
        and (r.permissions @> array['administrator'] or r.permissions @> array[p_permission])
    );
$$;

-- ============================================================
-- Helper: posição do cargo mais alto do usuário (dono = infinito)
-- Usado pra impedir que alguém modere/atribua cargo igual ou acima
-- do próprio nível hierárquico.
-- ============================================================
create or replace function public.top_role_position(p_server_id uuid, p_user_id uuid)
returns int
language sql
security definer
stable
set search_path = public
as $$
  select case
    when exists (select 1 from public.servers where id = p_server_id and owner_id = p_user_id)
      then 2147483647
    else coalesce(
      (
        select max(r.position)
        from public.server_member_roles smr
        join public.roles r on r.id = smr.role_id
        where smr.server_id = p_server_id and smr.user_id = p_user_id
      ),
      -1
    )
  end;
$$;

-- ============================================================
-- RLS: roles / server_member_roles / bans / moderation_logs
-- ============================================================
alter table public.roles enable row level security;
alter table public.server_member_roles enable row level security;
alter table public.bans enable row level security;
alter table public.moderation_logs enable row level security;

drop policy if exists "Membros veem os cargos do servidor" on public.roles;
create policy "Membros veem os cargos do servidor"
  on public.roles for select to authenticated
  using (public.is_server_member(server_id, auth.uid()));

drop policy if exists "Membros veem os cargos atribuídos no servidor" on public.server_member_roles;
create policy "Membros veem os cargos atribuídos no servidor"
  on public.server_member_roles for select to authenticated
  using (public.is_server_member(server_id, auth.uid()));

drop policy if exists "Quem pode banir vê a lista de banidos" on public.bans;
create policy "Quem pode banir vê a lista de banidos"
  on public.bans for select to authenticated
  using (public.has_permission(server_id, auth.uid(), 'ban_members'));

drop policy if exists "Quem pode ver o log vê o log" on public.moderation_logs;
create policy "Quem pode ver o log vê o log"
  on public.moderation_logs for select to authenticated
  using (public.has_permission(server_id, auth.uid(), 'view_audit_log'));

-- roles/server_member_roles/bans/moderation_logs não têm policy de
-- INSERT/UPDATE/DELETE — toda escrita passa pelas funções abaixo,
-- que checam permissão E hierarquia antes de agir.

-- ============================================================
-- Atualiza policies de fases anteriores pra respeitar permissões
-- de cargo, não só o dono (canais, categorias, mensagens)
-- ============================================================
drop policy if exists "Dono cria categorias" on public.categories;
drop policy if exists "Dono edita categorias" on public.categories;
drop policy if exists "Dono exclui categorias" on public.categories;
drop policy if exists "Dono cria canais" on public.channels;
drop policy if exists "Dono edita canais" on public.channels;
drop policy if exists "Dono exclui canais" on public.channels;

drop policy if exists "Quem administra canais cria categorias" on public.categories;
create policy "Quem administra canais cria categorias"
  on public.categories for insert to authenticated
  with check (public.has_permission(server_id, auth.uid(), 'manage_channels'));

drop policy if exists "Quem administra canais edita categorias" on public.categories;
create policy "Quem administra canais edita categorias"
  on public.categories for update to authenticated
  using (public.has_permission(server_id, auth.uid(), 'manage_channels'));

drop policy if exists "Quem administra canais exclui categorias" on public.categories;
create policy "Quem administra canais exclui categorias"
  on public.categories for delete to authenticated
  using (public.has_permission(server_id, auth.uid(), 'manage_channels'));

drop policy if exists "Quem administra canais cria canais" on public.channels;
create policy "Quem administra canais cria canais"
  on public.channels for insert to authenticated
  with check (public.has_permission(server_id, auth.uid(), 'manage_channels'));

drop policy if exists "Quem administra canais edita canais" on public.channels;
create policy "Quem administra canais edita canais"
  on public.channels for update to authenticated
  using (public.has_permission(server_id, auth.uid(), 'manage_channels'));

drop policy if exists "Quem administra canais exclui canais" on public.channels;
create policy "Quem administra canais exclui canais"
  on public.channels for delete to authenticated
  using (public.has_permission(server_id, auth.uid(), 'manage_channels'));

drop policy if exists "Autor ou dono do servidor exclui mensagem" on public.messages;

drop policy if exists "Autor ou moderador exclui mensagem" on public.messages;
create policy "Autor ou moderador exclui mensagem"
  on public.messages for delete to authenticated
  using (
    author_id = auth.uid()
    or public.has_permission(server_id, auth.uid(), 'manage_messages')
  );

-- Bloqueia envio de mensagens por quem está em timeout
drop policy if exists "Membros enviam mensagens" on public.messages;

drop policy if exists "Membros enviam mensagens, se não estiverem em timeout" on public.messages;
create policy "Membros enviam mensagens, se não estiverem em timeout"
  on public.messages for insert to authenticated
  with check (
    public.is_server_member(server_id, auth.uid())
    and author_id = auth.uid()
    and not exists (
      select 1 from public.server_members sm
      where sm.server_id = messages.server_id
        and sm.user_id = auth.uid()
        and sm.timeout_until is not null
        and sm.timeout_until > now()
    )
  );

-- Impede reingresso de usuários banidos, mesmo com convite válido
create or replace function public.join_server_via_invite(p_code text)
returns public.servers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.server_invites;
  v_server public.servers;
begin
  select * into v_invite from public.server_invites where code = p_code;

  if v_invite is null then
    raise exception 'Convite inválido ou expirado';
  end if;

  if v_invite.expires_at is not null and v_invite.expires_at < now() then
    raise exception 'Convite inválido ou expirado';
  end if;

  if v_invite.max_uses is not null and v_invite.uses >= v_invite.max_uses then
    raise exception 'Convite inválido ou expirado';
  end if;

  if exists (select 1 from public.bans where server_id = v_invite.server_id and user_id = auth.uid()) then
    raise exception 'Você foi banido deste servidor';
  end if;

  select * into v_server from public.servers where id = v_invite.server_id;

  insert into public.server_members (server_id, user_id)
  values (v_invite.server_id, auth.uid())
  on conflict (server_id, user_id) do nothing;

  update public.server_invites set uses = uses + 1 where id = v_invite.id;

  return v_server;
end;
$$;

-- ============================================================
-- Funções: cargos
-- ============================================================
create or replace function public.create_role(p_server_id uuid, p_name text, p_color text, p_permissions text[])
returns public.roles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_position int;
  v_role public.roles;
begin
  if not public.has_permission(p_server_id, auth.uid(), 'manage_roles') then
    raise exception 'Você não tem permissão para gerenciar cargos';
  end if;

  select coalesce(max(position), 0) + 1 into v_position from public.roles where server_id = p_server_id;

  insert into public.roles (server_id, name, color, position, permissions)
  values (p_server_id, p_name, p_color, v_position, p_permissions)
  returning * into v_role;

  insert into public.moderation_logs (server_id, actor_id, action, metadata)
  values (p_server_id, auth.uid(), 'role_created', jsonb_build_object('role_id', v_role.id, 'name', p_name));

  return v_role;
end;
$$;

create or replace function public.update_role(p_role_id uuid, p_name text, p_color text, p_permissions text[])
returns public.roles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_server_id uuid;
  v_role public.roles;
begin
  select server_id into v_server_id from public.roles where id = p_role_id;

  if v_server_id is null then
    raise exception 'Cargo não encontrado';
  end if;

  if not public.has_permission(v_server_id, auth.uid(), 'manage_roles') then
    raise exception 'Você não tem permissão para gerenciar cargos';
  end if;

  update public.roles set name = p_name, color = p_color, permissions = p_permissions
    where id = p_role_id
    returning * into v_role;

  return v_role;
end;
$$;

create or replace function public.delete_role(p_role_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_server_id uuid;
  v_name text;
begin
  select server_id, name into v_server_id, v_name from public.roles where id = p_role_id;

  if v_server_id is null then
    return;
  end if;

  if not public.has_permission(v_server_id, auth.uid(), 'manage_roles') then
    raise exception 'Você não tem permissão para gerenciar cargos';
  end if;

  delete from public.roles where id = p_role_id;

  insert into public.moderation_logs (server_id, actor_id, action, metadata)
  values (v_server_id, auth.uid(), 'role_deleted', jsonb_build_object('role_id', p_role_id, 'name', v_name));
end;
$$;

create or replace function public.assign_role(p_server_id uuid, p_user_id uuid, p_role_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role_position int;
begin
  if not public.has_permission(p_server_id, auth.uid(), 'manage_roles') then
    raise exception 'Você não tem permissão para gerenciar cargos';
  end if;

  select position into v_role_position from public.roles where id = p_role_id and server_id = p_server_id;

  if v_role_position is null then
    raise exception 'Cargo não encontrado';
  end if;

  if v_role_position >= public.top_role_position(p_server_id, auth.uid()) then
    raise exception 'Você não pode atribuir um cargo igual ou acima do seu próprio nível';
  end if;

  insert into public.server_member_roles (server_id, user_id, role_id)
  values (p_server_id, p_user_id, p_role_id)
  on conflict do nothing;

  insert into public.moderation_logs (server_id, actor_id, action, target_user_id, metadata)
  values (p_server_id, auth.uid(), 'role_assigned', p_user_id, jsonb_build_object('role_id', p_role_id));
end;
$$;

create or replace function public.remove_role(p_server_id uuid, p_user_id uuid, p_role_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_permission(p_server_id, auth.uid(), 'manage_roles') then
    raise exception 'Você não tem permissão para gerenciar cargos';
  end if;

  delete from public.server_member_roles
    where server_id = p_server_id and user_id = p_user_id and role_id = p_role_id;

  insert into public.moderation_logs (server_id, actor_id, action, target_user_id, metadata)
  values (p_server_id, auth.uid(), 'role_removed', p_user_id, jsonb_build_object('role_id', p_role_id));
end;
$$;

-- ============================================================
-- Funções: moderação (kick / ban / unban / timeout)
-- Todas protegem o dono do servidor e respeitam hierarquia: você só
-- modera quem tem um cargo mais baixo que o seu (dono é sempre o topo).
-- ============================================================
create or replace function public.kick_member(p_server_id uuid, p_user_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_permission(p_server_id, auth.uid(), 'kick_members') then
    raise exception 'Você não tem permissão para expulsar membros';
  end if;

  if exists (select 1 from public.servers where id = p_server_id and owner_id = p_user_id) then
    raise exception 'O dono do servidor não pode ser expulso';
  end if;

  if public.top_role_position(p_server_id, p_user_id) >= public.top_role_position(p_server_id, auth.uid()) then
    raise exception 'Você não pode expulsar alguém com cargo igual ou superior ao seu';
  end if;

  delete from public.server_members where server_id = p_server_id and user_id = p_user_id;

  insert into public.moderation_logs (server_id, actor_id, action, target_user_id, reason)
  values (p_server_id, auth.uid(), 'kick', p_user_id, p_reason);
end;
$$;

create or replace function public.ban_member(p_server_id uuid, p_user_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_permission(p_server_id, auth.uid(), 'ban_members') then
    raise exception 'Você não tem permissão para banir membros';
  end if;

  if exists (select 1 from public.servers where id = p_server_id and owner_id = p_user_id) then
    raise exception 'O dono do servidor não pode ser banido';
  end if;

  if public.top_role_position(p_server_id, p_user_id) >= public.top_role_position(p_server_id, auth.uid()) then
    raise exception 'Você não pode banir alguém com cargo igual ou superior ao seu';
  end if;

  insert into public.bans (server_id, user_id, banned_by, reason)
  values (p_server_id, p_user_id, auth.uid(), p_reason)
  on conflict (server_id, user_id) do update set reason = excluded.reason, banned_by = excluded.banned_by;

  delete from public.server_members where server_id = p_server_id and user_id = p_user_id;

  insert into public.moderation_logs (server_id, actor_id, action, target_user_id, reason)
  values (p_server_id, auth.uid(), 'ban', p_user_id, p_reason);
end;
$$;

create or replace function public.unban_member(p_server_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_permission(p_server_id, auth.uid(), 'ban_members') then
    raise exception 'Você não tem permissão para banir membros';
  end if;

  delete from public.bans where server_id = p_server_id and user_id = p_user_id;

  insert into public.moderation_logs (server_id, actor_id, action, target_user_id)
  values (p_server_id, auth.uid(), 'unban', p_user_id);
end;
$$;

create or replace function public.timeout_member(p_server_id uuid, p_user_id uuid, p_minutes int, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_permission(p_server_id, auth.uid(), 'timeout_members') then
    raise exception 'Você não tem permissão para silenciar membros';
  end if;

  if exists (select 1 from public.servers where id = p_server_id and owner_id = p_user_id) then
    raise exception 'O dono do servidor não pode ser silenciado';
  end if;

  if public.top_role_position(p_server_id, p_user_id) >= public.top_role_position(p_server_id, auth.uid()) then
    raise exception 'Você não pode silenciar alguém com cargo igual ou superior ao seu';
  end if;

  update public.server_members
    set timeout_until = now() + (p_minutes || ' minutes')::interval
    where server_id = p_server_id and user_id = p_user_id;

  insert into public.moderation_logs (server_id, actor_id, action, target_user_id, reason, metadata)
  values (p_server_id, auth.uid(), 'timeout', p_user_id, p_reason, jsonb_build_object('minutes', p_minutes));
end;
$$;

create or replace function public.remove_timeout(p_server_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_permission(p_server_id, auth.uid(), 'timeout_members') then
    raise exception 'Você não tem permissão para silenciar membros';
  end if;

  update public.server_members set timeout_until = null
    where server_id = p_server_id and user_id = p_user_id;

  insert into public.moderation_logs (server_id, actor_id, action, target_user_id)
  values (p_server_id, auth.uid(), 'remove_timeout', p_user_id);
end;
$$;

-- ============================================================
-- Canal restrito por cargo — visibilidade específica por canal,
-- além das permissões gerais do servidor. Fica aqui (não em
-- 001_core.sql) porque depende de has_permission() e da tabela
-- roles, que só existem a partir deste arquivo.
-- ============================================================

-- Quais cargos conseguem ver um canal marcado como restrito
create table if not exists public.channel_role_access (
  channel_id uuid not null references public.channels(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  primary key (channel_id, role_id)
);

alter table public.channel_role_access enable row level security;

drop policy if exists "Quem vê o canal vê os cargos liberados" on public.channel_role_access;
create policy "Quem vê o canal vê os cargos liberados"
  on public.channel_role_access for select to authenticated
  using (
    exists (
      select 1 from public.channels c
      where c.id = channel_id and public.is_server_member(c.server_id, auth.uid())
    )
  );

drop policy if exists "Quem gerencia canais define o acesso" on public.channel_role_access;
create policy "Quem gerencia canais define o acesso"
  on public.channel_role_access for all to authenticated
  using (
    exists (
      select 1 from public.channels c
      where c.id = channel_id and public.has_permission(c.server_id, auth.uid(), 'manage_channels')
    )
  )
  with check (
    exists (
      select 1 from public.channels c
      where c.id = channel_id and public.has_permission(c.server_id, auth.uid(), 'manage_channels')
    )
  );

-- Substitui a política de visibilidade de canal (criada em
-- 001_core.sql) pra respeitar canais restritos: dono e quem tem
-- manage_channels sempre vê tudo; o resto só vê canal restrito se
-- tiver algum cargo liberado pra ele.
drop policy if exists "Membros veem canais do servidor" on public.channels;
create policy "Membros veem canais do servidor"
  on public.channels for select to authenticated
  using (
    public.is_server_member(server_id, auth.uid())
    and (
      not is_restricted
      or public.has_permission(server_id, auth.uid(), 'manage_channels')
      or exists (
        select 1 from public.channel_role_access cra
        join public.server_member_roles smr on smr.role_id = cra.role_id
        where cra.channel_id = channels.id
          and smr.user_id = auth.uid()
          and smr.server_id = channels.server_id
      )
    )
  );

-- Igual precisa valer pra mensagens também (defesa em profundidade —
-- mesmo que o canal não apareça na lista, a mensagem não pode
-- vazar por uma consulta direta).
drop policy if exists "Membros veem mensagens do servidor" on public.messages;
create policy "Membros veem mensagens do servidor"
  on public.messages for select to authenticated
  using (
    exists (
      select 1 from public.channels c
      where c.id = channel_id
        and public.is_server_member(c.server_id, auth.uid())
        and (
          not c.is_restricted
          or public.has_permission(c.server_id, auth.uid(), 'manage_channels')
          or exists (
            select 1 from public.channel_role_access cra
            join public.server_member_roles smr on smr.role_id = cra.role_id
            where cra.channel_id = c.id
              and smr.user_id = auth.uid()
              and smr.server_id = c.server_id
          )
        )
    )
  );
