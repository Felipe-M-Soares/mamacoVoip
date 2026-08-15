-- ============================================================
-- FASE 4 — Canais
-- Rode isto no SQL Editor do Supabase, depois da 002_servers.sql
-- ============================================================

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  name text not null check (char_length(name) between 1 and 100),
  type text not null default 'text' check (type in ('text', 'voice')),
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index categories_server_idx on public.categories (server_id);
create index channels_server_idx on public.channels (server_id);
create index channels_category_idx on public.channels (category_id);

-- ============================================================
-- Trigger: cria canais padrão ("geral" e "Sala Geral") ao criar o servidor
-- ============================================================
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

create trigger on_server_created_channels
  after insert on public.servers
  for each row execute function public.handle_new_server_channels();

-- ============================================================
-- RLS
-- ============================================================
alter table public.categories enable row level security;
alter table public.channels enable row level security;

-- Leitura: qualquer membro do servidor
create policy "Membros veem categorias do servidor"
  on public.categories for select to authenticated
  using (public.is_server_member(server_id, auth.uid()));

create policy "Membros veem canais do servidor"
  on public.channels for select to authenticated
  using (public.is_server_member(server_id, auth.uid()));

-- Escrita: por enquanto só o dono (cargos/permissões granulares chegam
-- na Fase 7 — quando isso acontecer, essas policies serão substituídas
-- por uma checagem de permissão "manage_channels" por cargo).
create policy "Dono cria categorias"
  on public.categories for insert to authenticated
  with check (exists (select 1 from public.servers s where s.id = server_id and s.owner_id = auth.uid()));

create policy "Dono edita categorias"
  on public.categories for update to authenticated
  using (exists (select 1 from public.servers s where s.id = server_id and s.owner_id = auth.uid()));

create policy "Dono exclui categorias"
  on public.categories for delete to authenticated
  using (exists (select 1 from public.servers s where s.id = server_id and s.owner_id = auth.uid()));

create policy "Dono cria canais"
  on public.channels for insert to authenticated
  with check (exists (select 1 from public.servers s where s.id = server_id and s.owner_id = auth.uid()));

create policy "Dono edita canais"
  on public.channels for update to authenticated
  using (exists (select 1 from public.servers s where s.id = server_id and s.owner_id = auth.uid()));

create policy "Dono exclui canais"
  on public.channels for delete to authenticated
  using (exists (select 1 from public.servers s where s.id = server_id and s.owner_id = auth.uid()));

-- ============================================================
-- Funções: reordenar canais e categorias (atômico, valida dono)
-- ============================================================
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
