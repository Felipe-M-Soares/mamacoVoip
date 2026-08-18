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
--
-- Usa to_regclass() em vez de ::regclass porque to_regclass() retorna
-- NULL se a tabela não existir, em vez de dar erro — importante pra
-- group_messages, que só existe se a migration de grupos de DM já
-- tiver sido aplicada.
do $$
declare
  r record;
  v_tables regclass[];
begin
  select array_agg(t) into v_tables
  from unnest(array[
    to_regclass('public.messages'),
    to_regclass('public.dm_messages'),
    to_regclass('public.group_messages')
  ]) as t
  where t is not null;

  for r in
    select conname, conrelid::regclass::text as tbl
    from pg_constraint
    where contype = 'c'
      and conrelid = any(v_tables)
      and pg_get_constraintdef(oid) ilike '%content%'
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;

alter table public.messages
  add constraint messages_content_length check (char_length(content) between 0 and 4000);

alter table public.dm_messages
  add constraint dm_messages_content_length check (char_length(content) between 0 and 4000);

-- group_messages só existe se a migration de grupos de DM (021_group_dms.sql
-- ou 003_social.sql consolidado) já tiver sido aplicada
do $$
begin
  if to_regclass('public.group_messages') is not null then
    alter table public.group_messages drop constraint if exists group_messages_content_length;
    alter table public.group_messages
      add constraint group_messages_content_length check (char_length(content) between 0 and 4000);
  end if;
end $$;
