-- ============================================================
-- Canal "Palco" (Stage) — só quem modera pode falar, resto só
-- escuta. Rode isto no SQL Editor do Supabase, depois da
-- 018_afk_channel.sql
-- ============================================================
alter table public.channels add column if not exists is_stage boolean not null default false;
