create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  display_name text,
  avatar_url text,
  status text not null default 'offline' check (status in ('online', 'idle', 'dnd', 'offline')),
  custom_status text,
  playing text,
  profile_visibility text not null default 'everyone' check (profile_visibility in ('everyone', 'friends_only')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_username_idx on public.profiles (lower(username));

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

grant execute on function public.delete_own_account() to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_profiles_updated on public.profiles;
create trigger on_profiles_updated
  before update on public.profiles
  for each row execute function public.handle_updated_at();

alter table public.profiles enable row level security;

drop policy if exists "Perfis são visíveis para usuários autenticados" on public.profiles;
create policy "Perfis são visíveis para usuários autenticados"
  on public.profiles for select
  to authenticated
  using (true);

drop policy if exists "Usuário só pode atualizar seu próprio perfil" on public.profiles;
create policy "Usuário só pode atualizar seu próprio perfil"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create table if not exists public.servers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 100),
  icon_url text,
  banner_url text,
  description text check (char_length(description) <= 300),
  owner_id uuid not null references auth.users(id) on delete cascade,
  afk_timeout_minutes integer not null default 10,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.server_members (
  server_id uuid not null references public.servers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  nickname text,
  timeout_until timestamptz,
  joined_at timestamptz not null default now(),
  primary key (server_id, user_id)
);

create table if not exists public.server_invites (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers(id) on delete cascade,
  code text not null unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  max_uses int,
  uses int not null default 0,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists server_members_user_idx on public.server_members (user_id);
create index if not exists server_invites_server_idx on public.server_invites (server_id);

drop trigger if exists on_servers_updated on public.servers;
create trigger on_servers_updated
  before update on public.servers
  for each row execute function public.handle_updated_at();

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

drop trigger if exists on_server_created on public.servers;
create trigger on_server_created
  after insert on public.servers
  for each row execute function public.handle_new_server();

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

alter table public.servers enable row level security;
alter table public.server_members enable row level security;
alter table public.server_invites enable row level security;

drop policy if exists "Membros veem os servidores dos quais participam" on public.servers;
create policy "Membros veem os servidores dos quais participam"
  on public.servers for select to authenticated
  using (owner_id = auth.uid() or public.is_server_member(id, auth.uid()));

drop policy if exists "Usuário autenticado pode criar servidor" on public.servers;
create policy "Usuário autenticado pode criar servidor"
  on public.servers for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists "Somente o dono edita o servidor" on public.servers;
create policy "Somente o dono edita o servidor"
  on public.servers for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "Somente o dono exclui o servidor" on public.servers;
create policy "Somente o dono exclui o servidor"
  on public.servers for delete to authenticated
  using (owner_id = auth.uid());

drop policy if exists "Membros veem outros membros do mesmo servidor" on public.server_members;
create policy "Membros veem outros membros do mesmo servidor"
  on public.server_members for select to authenticated
  using (public.is_server_member(server_id, auth.uid()));

drop policy if exists "Membro sai do servidor, exceto o dono" on public.server_members;
create policy "Membro sai do servidor, exceto o dono"
  on public.server_members for delete to authenticated
  using (
    user_id = auth.uid()
    and not exists (
      select 1 from public.servers s where s.id = server_id and s.owner_id = auth.uid()
    )
  );

drop policy if exists "Membros veem convites do servidor" on public.server_invites;
create policy "Membros veem convites do servidor"
  on public.server_invites for select to authenticated
  using (public.is_server_member(server_id, auth.uid()));

drop policy if exists "Criador ou dono pode revogar convite" on public.server_invites;
create policy "Criador ou dono pode revogar convite"
  on public.server_invites for delete to authenticated
  using (
    created_by = auth.uid()
    or exists (select 1 from public.servers s where s.id = server_id and s.owner_id = auth.uid())
  );

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

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('server-icons', 'server-icons', true, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

drop policy if exists "Ícones de servidor são publicamente visíveis" on storage.objects;
create policy "Ícones de servidor são publicamente visíveis"
  on storage.objects for select
  using (bucket_id = 'server-icons');

drop policy if exists "Dono pode enviar ícone do próprio servidor" on storage.objects;
create policy "Dono pode enviar ícone do próprio servidor"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'server-icons'
    and (storage.foldername(name))[1] in (
      select id::text from public.servers where owner_id = auth.uid()
    )
  );

drop policy if exists "Dono pode atualizar o ícone do próprio servidor" on storage.objects;
create policy "Dono pode atualizar o ícone do próprio servidor"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'server-icons'
    and (storage.foldername(name))[1] in (
      select id::text from public.servers where owner_id = auth.uid()
    )
  );

drop policy if exists "Dono pode remover o ícone do próprio servidor" on storage.objects;
create policy "Dono pode remover o ícone do próprio servidor"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'server-icons'
    and (storage.foldername(name))[1] in (
      select id::text from public.servers where owner_id = auth.uid()
    )
  );

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.channels (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  name text not null check (char_length(name) between 1 and 100),
  type text not null default 'text' check (type in ('text', 'voice')),
  topic text,
  is_stage boolean not null default false,
  slowmode_seconds integer not null default 0,
  user_limit integer not null default 0,
  is_restricted boolean not null default false,
  is_spoiler boolean not null default false,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists categories_server_idx on public.categories (server_id);
create index if not exists channels_server_idx on public.channels (server_id);
create index if not exists channels_category_idx on public.channels (category_id);

create or replace function public.handle_new_server_channels()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.channels (server_id, name, type, position) values
    (new.id, 'geral', 'text', 0),
    (new.id, 'Sala Geral', 'voice', 1);
  return new;
end;
$$;

drop trigger if exists on_server_created_channels on public.servers;
create trigger on_server_created_channels
  after insert on public.servers
  for each row execute function public.handle_new_server_channels();

alter table public.categories enable row level security;
alter table public.channels enable row level security;

drop policy if exists "Membros veem categorias do servidor" on public.categories;
create policy "Membros veem categorias do servidor"
  on public.categories for select to authenticated
  using (public.is_server_member(server_id, auth.uid()));

drop policy if exists "Membros veem canais do servidor" on public.channels;
create policy "Membros veem canais do servidor"
  on public.channels for select to authenticated
  using (public.is_server_member(server_id, auth.uid()));

drop policy if exists "Dono cria categorias" on public.categories;
create policy "Dono cria categorias"
  on public.categories for insert to authenticated
  with check (exists (select 1 from public.servers s where s.id = server_id and s.owner_id = auth.uid()));

drop policy if exists "Dono edita categorias" on public.categories;
create policy "Dono edita categorias"
  on public.categories for update to authenticated
  using (exists (select 1 from public.servers s where s.id = server_id and s.owner_id = auth.uid()));

drop policy if exists "Dono exclui categorias" on public.categories;
create policy "Dono exclui categorias"
  on public.categories for delete to authenticated
  using (exists (select 1 from public.servers s where s.id = server_id and s.owner_id = auth.uid()));

drop policy if exists "Dono cria canais" on public.channels;
create policy "Dono cria canais"
  on public.channels for insert to authenticated
  with check (exists (select 1 from public.servers s where s.id = server_id and s.owner_id = auth.uid()));

drop policy if exists "Dono edita canais" on public.channels;
create policy "Dono edita canais"
  on public.channels for update to authenticated
  using (exists (select 1 from public.servers s where s.id = server_id and s.owner_id = auth.uid()));

drop policy if exists "Dono exclui canais" on public.channels;
create policy "Dono exclui canais"
  on public.channels for delete to authenticated
  using (exists (select 1 from public.servers s where s.id = server_id and s.owner_id = auth.uid()));

create or replace function public.reorder_channels(p_category_id uuid, p_channel_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_server_id uuid;
  v_id uuid;
  v_pos int := 0;
begin
  select server_id into v_server_id from public.channels where id = p_channel_ids[1];

  if v_server_id is null or not exists (
    select 1 from public.servers where id = v_server_id and owner_id = auth.uid()
  ) then
    raise exception 'Você não tem permissão para reordenar canais';
  end if;

  foreach v_id in array p_channel_ids loop
    update public.channels
      set position = v_pos, category_id = p_category_id
      where id = v_id and server_id = v_server_id;
    v_pos := v_pos + 1;
  end loop;
end;
$$;

create or replace function public.reorder_categories(p_server_id uuid, p_category_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_pos int := 0;
begin
  if not exists (select 1 from public.servers where id = p_server_id and owner_id = auth.uid()) then
    raise exception 'Você não tem permissão para reordenar categorias';
  end if;

  foreach v_id in array p_category_ids loop
    update public.categories set position = v_pos where id = v_id and server_id = p_server_id;
    v_pos := v_pos + 1;
  end loop;
end;
$$;

alter table public.servers add column if not exists afk_channel_id uuid references public.channels(id) on delete set null;

alter table public.profiles add column if not exists profile_visibility text not null default 'everyone';
alter table public.profiles drop constraint if exists profiles_profile_visibility_check;
alter table public.profiles add constraint profiles_profile_visibility_check check (profile_visibility in ('everyone', 'friends_only'));
alter table public.channels add column if not exists is_spoiler boolean not null default false;
alter table public.channels add column if not exists user_limit integer not null default 0;
alter table public.channels add column if not exists is_restricted boolean not null default false;
alter table public.channels add column if not exists topic text;
alter table public.channels add column if not exists is_stage boolean not null default false;
alter table public.channels add column if not exists slowmode_seconds integer not null default 0;
