-- ============================================================
-- Silenciar canal (por usuário) — rode isto no SQL Editor do
-- Supabase, depois da 013_channel_topic.sql
-- ============================================================
create table if not exists public.channel_mutes (
  user_id uuid not null references public.profiles(id) on delete cascade,
  channel_id uuid not null references public.channels(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, channel_id)
);

alter table public.channel_mutes enable row level security;

drop policy if exists "channel_mutes_select_own" on public.channel_mutes;
create policy "channel_mutes_select_own"
  on public.channel_mutes for select
  using (user_id = auth.uid());

drop policy if exists "channel_mutes_insert_own" on public.channel_mutes;
create policy "channel_mutes_insert_own"
  on public.channel_mutes for insert
  with check (user_id = auth.uid());

drop policy if exists "channel_mutes_delete_own" on public.channel_mutes;
create policy "channel_mutes_delete_own"
  on public.channel_mutes for delete
  using (user_id = auth.uid());
