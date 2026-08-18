-- ============================================================
-- Correções de segurança/funcionalidade encontradas numa revisão:
--
-- 1) `messages` e `dm_messages` exigiam pelo menos 1 caractere de
--    texto (`between 1 and 4000`) — isso quebra silenciosamente o
--    envio de mensagem "só com anexo" (ex: mensagem de voz sem
--    texto, ou só um GIF), porque o app manda content vazio nesses
--    casos e o banco rejeitava.
--
-- 2) `group_messages` não tinha limite de tamanho NENHUM — dava pra
--    mandar uma mensagem de tamanho arbitrário num grupo.
--
-- Rode isto no SQL Editor do Supabase.
-- ============================================================

-- Remove qualquer check constraint existente na coluna content de
-- cada tabela (sem depender de adivinhar o nome exato que o Postgres
-- gerou automaticamente) e recria com o limite correto (0 a 4000,
-- permitindo mensagem vazia quando só tem anexo).
do $$
declare
  r record;
begin
  for r in
    select conname, conrelid::regclass::text as tbl
    from pg_constraint
    where contype = 'c'
      and conrelid in ('public.messages'::regclass, 'public.dm_messages'::regclass, 'public.group_messages'::regclass)
      and pg_get_constraintdef(oid) ilike '%content%'
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;

alter table public.messages
  add constraint messages_content_length check (char_length(content) between 0 and 4000);

alter table public.dm_messages
  add constraint dm_messages_content_length check (char_length(content) between 0 and 4000);

alter table public.group_messages
  add constraint group_messages_content_length check (char_length(content) between 0 and 4000);
