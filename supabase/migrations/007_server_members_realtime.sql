-- ============================================================
-- Realtime em server_members — sem isso, os avisos abaixo escutam a
-- tabela mas nunca recebem nenhum evento de verdade (o Supabase só
-- manda Realtime pras tabelas que estão explicitamente na publicação
-- "supabase_realtime", mesmo esquema usado em 002_messaging.sql e
-- 003_social.sql pras outras tabelas):
--   - ServersContext.tsx escuta a MINHA linha em server_members pra
--     saber a hora que entrei num servidor novo (convite por link,
--     convite pelo chat, ou ter sido adicionado por outra pessoa) e
--     atualizar a lista sozinho, sem precisar fechar e abrir o app.
--   - useServerMembers.ts escuta as linhas de UM servidor pra saber
--     assim que alguém novo entra, e conseguir mostrar o NOME de quem
--     entrou (em vez do genérico "Alguém entrou no servidor").
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'server_members'
  ) then
    alter publication supabase_realtime add table public.server_members;
  end if;
end $$;
