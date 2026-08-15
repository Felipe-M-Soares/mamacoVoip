-- ============================================================
-- FASE 9 — Finalização: estado de leitura (pra badges de não lidos
-- e notificações)
-- Rode isto no SQL Editor do Supabase, depois da 006_roles_moderation.sql
--
-- Esta versão é segura pra rodar mais de uma vez (idempotente): usa
-- IF NOT EXISTS / DROP POLICY IF EXISTS em tudo, então não importa se
-- uma tentativa anterior já criou parte das coisas — só cria o que
-- ainda está faltando.
-- ============================================================

create table if not exists public.channel_read_state (
  channel_id uuid not null references public.channels(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

create table if not exists public.dm_read_state (
  conversation_id uuid not null references public.dm_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

alter table public.channel_read_state enable row level security;
alter table public.dm_read_state enable row level security;

drop policy if exists "Usuário vê o próprio estado de leitura de canais" on public.channel_read_state;
create policy "Usuário vê o próprio estado de leitura de canais"
  on public.channel_read_state for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Usuário vê o próprio estado de leitura de DMs" on public.dm_read_state;
create policy "Usuário vê o próprio estado de leitura de DMs"
  on public.dm_read_state for select to authenticated
  using (user_id = auth.uid());

-- Upsert só pelo próprio usuário, direto (não precisa de função aqui —
-- não há regra de negócio sensível, só "marquei como lido até agora")
drop policy if exists "Usuário marca seus canais como lidos" on public.channel_read_state;
create policy "Usuário marca seus canais como lidos"
  on public.channel_read_state for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Usuário atualiza o próprio estado de leitura de canais" on public.channel_read_state;
create policy "Usuário atualiza o próprio estado de leitura de canais"
  on public.channel_read_state for update to authenticated
  using (user_id = auth.uid());

drop policy if exists "Usuário marca suas DMs como lidas" on public.dm_read_state;
create policy "Usuário marca suas DMs como lidas"
  on public.dm_read_state for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Usuário atualiza o próprio estado de leitura de DMs" on public.dm_read_state;
create policy "Usuário atualiza o próprio estado de leitura de DMs"
  on public.dm_read_state for update to authenticated
  using (user_id = auth.uid());
