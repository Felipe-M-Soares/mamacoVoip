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
