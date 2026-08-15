-- ============================================================
-- FASE 3 — Servidores
-- Rode isto no SQL Editor do Supabase, depois da 001_profiles.sql
-- ============================================================

create table public.servers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 100),
  icon_url text,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.server_members (
  server_id uuid not null references public.servers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  nickname text,
  joined_at timestamptz not null default now(),
  primary key (server_id, user_id)
);

create table public.server_invites (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers(id) on delete cascade,
  code text not null unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  max_uses int,
  uses int not null default 0,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index server_members_user_idx on public.server_members (user_id);
create index server_invites_server_idx on public.server_invites (server_id);

create trigger on_servers_updated
  before update on public.servers
  for each row execute function public.handle_updated_at();

-- ============================================================
-- Trigger: dono vira membro automaticamente ao criar o servidor
-- ============================================================
create or replace function public.handle_new_server()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.server_members (server_id, user_id) values (new.id, new.owner_id);
  return new;
end;
$$;

create trigger on_server_created
  after insert on public.servers
  for each row execute function public.handle_new_server();

-- ============================================================
-- Helper: função security definer pra checar membership sem
-- causar recursão infinita nas policies de server_members
-- ============================================================
create or replace function public.is_server_member(p_server_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists(
    select 1 from public.server_members
    where server_id = p_server_id and user_id = p_user_id
  );
$$;

-- ============================================================
-- RLS
-- ============================================================
alter table public.servers enable row level security;
alter table public.server_members enable row level security;
alter table public.server_invites enable row level security;

-- servers -------------------------------------------------
create policy "Membros veem os servidores dos quais participam"
  on public.servers for select to authenticated
  using (public.is_server_member(id, auth.uid()));

create policy "Usuário autenticado pode criar servidor"
  on public.servers for insert to authenticated
  with check (owner_id = auth.uid());

create policy "Somente o dono edita o servidor"
  on public.servers for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "Somente o dono exclui o servidor"
  on public.servers for delete to authenticated
  using (owner_id = auth.uid());

-- server_members --------------------------------------------
create policy "Membros veem outros membros do mesmo servidor"
  on public.server_members for select to authenticated
  using (public.is_server_member(server_id, auth.uid()));

-- Não há policy de INSERT direta: entrar num servidor só acontece
-- via join_server_via_invite() (security definer) ou pelo trigger
-- que adiciona o dono. Isso evita gente se auto-adicionando a
-- qualquer servidor sem convite válido.

create policy "Membro sai do servidor, exceto o dono"
  on public.server_members for delete to authenticated
  using (
    user_id = auth.uid()
    and not exists (
      select 1 from public.servers s where s.id = server_id and s.owner_id = auth.uid()
    )
  );

-- server_invites ----------------------------------------------
create policy "Membros veem convites do servidor"
  on public.server_invites for select to authenticated
  using (public.is_server_member(server_id, auth.uid()));

create policy "Criador ou dono pode revogar convite"
  on public.server_invites for delete to authenticated
  using (
    created_by = auth.uid()
    or exists (select 1 from public.servers s where s.id = server_id and s.owner_id = auth.uid())
  );

-- Não há policy de INSERT direta: convites só são criados via
-- create_server_invite() abaixo, que valida membership e gera
-- o código, evitando criação massiva/arbitrária pelo frontend.

-- ============================================================
-- Função: entrar em um servidor usando um código de convite
-- ============================================================
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

  select * into v_server from public.servers where id = v_invite.server_id;

  insert into public.server_members (server_id, user_id)
  values (v_invite.server_id, auth.uid())
  on conflict (server_id, user_id) do nothing;

  update public.server_invites set uses = uses + 1 where id = v_invite.id;

  return v_server;
end;
$$;

-- ============================================================
-- Função: criar convite (gera código aleatório de 8 caracteres)
-- ============================================================
create or replace function public.create_server_invite(
  p_server_id uuid,
  p_max_uses int default null,
  p_expires_hours int default null
)
returns public.server_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_invite public.server_invites;
begin
  if not public.is_server_member(p_server_id, auth.uid()) then
    raise exception 'Você não é membro deste servidor';
  end if;

  v_code := substr(md5(random()::text || clock_timestamp()::text), 1, 8);

  insert into public.server_invites (server_id, code, created_by, max_uses, expires_at)
  values (
    p_server_id,
    v_code,
    auth.uid(),
    p_max_uses,
    case when p_expires_hours is null then null else now() + (p_expires_hours || ' hours')::interval end
  )
  returning * into v_invite;

  return v_invite;
end;
$$;

-- ============================================================
-- Storage: bucket público para ícones de servidor
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('server-icons', 'server-icons', true, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

-- Convenção de path: {server_id}/{filename}. Isso permite checar
-- dono do servidor a partir do primeiro segmento do path.
create policy "Ícones de servidor são publicamente visíveis"
  on storage.objects for select
  using (bucket_id = 'server-icons');

create policy "Dono pode enviar ícone do próprio servidor"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'server-icons'
    and (storage.foldername(name))[1] in (
      select id::text from public.servers where owner_id = auth.uid()
    )
  );

create policy "Dono pode atualizar o ícone do próprio servidor"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'server-icons'
    and (storage.foldername(name))[1] in (
      select id::text from public.servers where owner_id = auth.uid()
    )
  );

create policy "Dono pode remover o ícone do próprio servidor"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'server-icons'
    and (storage.foldername(name))[1] in (
      select id::text from public.servers where owner_id = auth.uid()
    )
  );
