-- ============================================================
-- Canal AFK (move automaticamente quem fica inativo) — rode isto
-- no SQL Editor do Supabase, depois da 017_server_events.sql
-- ============================================================
alter table public.servers add column if not exists afk_channel_id uuid references public.channels(id) on delete set null;
alter table public.servers add column if not exists afk_timeout_minutes integer not null default 10;
