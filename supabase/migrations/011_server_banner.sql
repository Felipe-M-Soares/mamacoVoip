-- ============================================================
-- Capa/banner do servidor (imagem ou GIF customizado)
-- Rode isto no SQL Editor do Supabase, depois da 010_playing_status.sql
-- ============================================================
alter table public.servers add column if not exists banner_url text;
