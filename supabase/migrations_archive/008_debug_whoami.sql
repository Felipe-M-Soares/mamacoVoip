-- ============================================================
-- Diagnóstico — função temporária pra descobrir por que a criação
-- de servidor está sendo barrada pela RLS. Segura de rodar de novo.
-- ============================================================
create or replace function public.debug_whoami()
returns table(jwt_uid uuid, jwt_role text)
language sql
security invoker
stable
as $$
  select auth.uid(), auth.role();
$$;
