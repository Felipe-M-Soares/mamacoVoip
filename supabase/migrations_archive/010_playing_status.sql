-- ============================================================
-- Presença de jogo ("Jogando X") — só o app desktop (Electron)
-- consegue detectar e preencher este campo, já que navegadores não
-- têm acesso à lista de processos do sistema por segurança.
-- Rode isto no SQL Editor do Supabase, depois da 009_server_description.sql
-- ============================================================
alter table public.profiles add column if not exists playing text;
