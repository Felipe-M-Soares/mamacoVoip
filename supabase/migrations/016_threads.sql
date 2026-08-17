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
