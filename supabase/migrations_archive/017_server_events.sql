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
