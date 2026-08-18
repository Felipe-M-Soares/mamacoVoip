-- ============================================================
-- Mais configurações de servidor: descrição
-- Rode isto no SQL Editor do Supabase, depois da 008_debug_whoami.sql
-- ============================================================
alter table public.servers add column if not exists description text;
alter table public.servers drop constraint if exists servers_description_length;
alter table public.servers add constraint servers_description_length check (char_length(description) <= 300);
