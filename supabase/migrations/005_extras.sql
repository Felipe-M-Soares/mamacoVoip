-- ============================================================
-- CONSOLIDADO 005: função de debug, emoji customizado, threads,
-- eventos do servidor
-- (junta: 008_debug_whoami, 015_server_emojis, 016_threads,
--  017_server_events)
--
-- Só pra ORGANIZAÇÃO/REFERÊNCIA — não rode num banco que já tem essas
-- migrations aplicadas.
-- ============================================================


-- ==== originalmente: 008_debug_whoami.sql ====
-- ============================================================
-- Diagnóstico — função temporária pra descobrir por que a criação
-- de servidor está sendo barrada pela RLS. Segura de rodar de novo.
-- ============================================================
create or replace function public.debug_whoami()
returns table(jwt_uid uuid, jwt_role text)
language sql
security invoker
stable
as $$
  select auth.uid(), auth.role();
$$;

-- ==== originalmente: 015_server_emojis.sql ====
-- ============================================================
-- Emojis customizados do servidor — rode isto no SQL Editor do
-- Supabase, depois da 014_channel_mutes.sql
-- ============================================================
create table if not exists public.server_emojis (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers(id) on delete cascade,
  name text not null,
  image_url text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (server_id, name)
);

alter table public.server_emojis enable row level security;

drop policy if exists "server_emojis_select" on public.server_emojis;
create policy "server_emojis_select"
  on public.server_emojis for select
  using (public.is_server_member(server_id, auth.uid()));

drop policy if exists "server_emojis_insert" on public.server_emojis;
create policy "server_emojis_insert"
  on public.server_emojis for insert
  with check (exists (select 1 from public.servers s where s.id = server_id and s.owner_id = auth.uid()));

drop policy if exists "server_emojis_delete" on public.server_emojis;
create policy "server_emojis_delete"
  on public.server_emojis for delete
  using (exists (select 1 from public.servers s where s.id = server_id and s.owner_id = auth.uid()));

-- ==== originalmente: 016_threads.sql ====
-- ============================================================
-- Threads (respostas ramificadas a partir de uma mensagem) — rode
-- isto no SQL Editor do Supabase, depois da 015_server_emojis.sql
-- ============================================================
create table if not exists public.threads (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  server_id uuid not null references public.servers(id) on delete cascade,
  parent_message_id uuid not null references public.messages(id) on delete cascade,
  name text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (parent_message_id)
);

alter table public.messages add column if not exists thread_id uuid references public.threads(id) on delete cascade;
-- (thread_id não dá pra declarar direto na tabela messages lá no
-- 002_messaging.sql, porque a tabela threads só é criada aqui)

create index if not exists messages_thread_idx on public.messages (thread_id) where thread_id is not null;

alter table public.threads enable row level security;

drop policy if exists "threads_select" on public.threads;
create policy "threads_select"
  on public.threads for select
  using (public.is_server_member(server_id, auth.uid()));

drop policy if exists "threads_insert" on public.threads;
create policy "threads_insert"
  on public.threads for insert
  with check (public.is_server_member(server_id, auth.uid()) and created_by = auth.uid());

-- ==== originalmente: 017_server_events.sql ====
-- ============================================================
-- Eventos do servidor (agendados, com confirmação de presença)
-- Rode isto no SQL Editor do Supabase, depois da 016_threads.sql
-- ============================================================
create table if not exists public.server_events (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers(id) on delete cascade,
  channel_id uuid references public.channels(id) on delete set null,
  name text not null,
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.server_event_rsvps (
  event_id uuid not null references public.server_events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

alter table public.server_events enable row level security;
alter table public.server_event_rsvps enable row level security;

drop policy if exists "server_events_select" on public.server_events;
create policy "server_events_select"
  on public.server_events for select
  using (public.is_server_member(server_id, auth.uid()));

drop policy if exists "server_events_insert" on public.server_events;
create policy "server_events_insert"
  on public.server_events for insert
  with check (
    public.is_server_member(server_id, auth.uid())
    and created_by = auth.uid()
    and (
      exists (select 1 from public.servers s where s.id = server_id and s.owner_id = auth.uid())
      or public.has_permission(server_id, auth.uid(), 'manage_channels')
    )
  );

drop policy if exists "server_events_delete" on public.server_events;
create policy "server_events_delete"
  on public.server_events for delete
  using (
    created_by = auth.uid()
    or exists (select 1 from public.servers s where s.id = server_id and s.owner_id = auth.uid())
  );

drop policy if exists "server_event_rsvps_select" on public.server_event_rsvps;
create policy "server_event_rsvps_select"
  on public.server_event_rsvps for select
  using (
    exists (
      select 1 from public.server_events e
      where e.id = event_id and public.is_server_member(e.server_id, auth.uid())
    )
  );

drop policy if exists "server_event_rsvps_insert" on public.server_event_rsvps;
create policy "server_event_rsvps_insert"
  on public.server_event_rsvps for insert
  with check (user_id = auth.uid());

drop policy if exists "server_event_rsvps_delete" on public.server_event_rsvps;
create policy "server_event_rsvps_delete"
  on public.server_event_rsvps for delete
  using (user_id = auth.uid());
