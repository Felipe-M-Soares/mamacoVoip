-- ============================================================
-- Tópico do canal — rode isto no SQL Editor do Supabase, depois
-- da 012_pinned_messages.sql
-- ============================================================
alter table public.channels add column if not exists topic text;
