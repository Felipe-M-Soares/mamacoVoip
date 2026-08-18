-- ============================================================
-- CONSOLIDADO 002: mensagens, anexos, reações, leitura, fixar,
-- silenciar canal, modo lento
-- (junta: 004_messages, 007_read_state, 012_pinned_messages,
--  014_channel_mutes, 022_slowmode_and_notifications)
--
-- Só pra ORGANIZAÇÃO/REFERÊNCIA — não rode num banco que já tem essas
-- migrations aplicadas.
-- ============================================================


-- ==== originalmente: 004_messages.sql ====
-- ============================================================
-- FASE 5 — Chat
-- Rode isto no SQL Editor do Supabase, depois da 003_channels.sql
-- ============================================================

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  server_id uuid not null references public.servers(id) on delete cascade, -- denormalizado pra simplificar RLS
  author_id uuid not null references auth.users(id) on delete cascade,
  content text not null check (char_length(content) between 0 and 4000),
  reply_to_id uuid references public.messages(id) on delete set null,
  edited_at timestamptz,
  pinned_at timestamptz,
  pinned_by uuid references public.profiles(id) on delete set null,
  -- thread_id fica como ALTER TABLE no arquivo 005_extras.sql, já
  -- que referencia a tabela threads, que só existe a partir de lá.
  created_at timestamptz not null default now()
);

create table public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  file_url text not null,
  file_name text not null,
  file_size int not null,
  mime_type text not null,
  created_at timestamptz not null default now()
);

create table public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 8),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create index messages_channel_created_idx on public.messages (channel_id, created_at);
create index messages_author_idx on public.messages (author_id);
create index message_attachments_message_idx on public.message_attachments (message_id);
create index message_reactions_message_idx on public.message_reactions (message_id);

-- ============================================================
-- Trigger: marca edited_at quando o conteúdo muda
-- ============================================================
create or replace function public.handle_message_edited()
returns trigger
language plpgsql
as $$
begin
  if new.content is distinct from old.content then
    new.edited_at = now();
  end if;
  return new;
end;
$$;

create trigger on_message_edited
  before update on public.messages
  for each row execute function public.handle_message_edited();

-- ============================================================
-- Trigger: rate limit — no máximo 8 mensagens a cada 10 segundos por usuário
-- ============================================================
create or replace function public.check_message_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  select count(*) into v_count
  from public.messages
  where author_id = new.author_id
    and created_at > now() - interval '10 seconds';

  if v_count >= 8 then
    raise exception 'Você está enviando mensagens rápido demais. Aguarde um instante.';
  end if;

  return new;
end;
$$;

create trigger on_message_rate_limit
  before insert on public.messages
  for each row execute function public.check_message_rate_limit();

-- ============================================================
-- RLS
-- ============================================================
alter table public.messages enable row level security;
alter table public.message_attachments enable row level security;
alter table public.message_reactions enable row level security;

-- messages ---------------------------------------------------
create policy "Membros veem mensagens do servidor"
  on public.messages for select to authenticated
  using (public.is_server_member(server_id, auth.uid()));

create policy "Membros enviam mensagens"
  on public.messages for insert to authenticated
  with check (public.is_server_member(server_id, auth.uid()) and author_id = auth.uid());

create policy "Autor edita a própria mensagem"
  on public.messages for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

create policy "Autor ou dono do servidor exclui mensagem"
  on public.messages for delete to authenticated
  using (
    author_id = auth.uid()
    or exists (select 1 from public.servers s where s.id = server_id and s.owner_id = auth.uid())
  );

-- message_attachments -----------------------------------------
create policy "Membros veem anexos"
  on public.message_attachments for select to authenticated
  using (
    exists (
      select 1 from public.messages m
      where m.id = message_id and public.is_server_member(m.server_id, auth.uid())
    )
  );

create policy "Autor da mensagem anexa arquivos"
  on public.message_attachments for insert to authenticated
  with check (
    exists (select 1 from public.messages m where m.id = message_id and m.author_id = auth.uid())
  );

create policy "Autor remove os próprios anexos"
  on public.message_attachments for delete to authenticated
  using (
    exists (select 1 from public.messages m where m.id = message_id and m.author_id = auth.uid())
  );

-- message_reactions ---------------------------------------------
create policy "Membros veem reações"
  on public.message_reactions for select to authenticated
  using (
    exists (
      select 1 from public.messages m
      where m.id = message_id and public.is_server_member(m.server_id, auth.uid())
    )
  );

create policy "Membros reagem com o próprio usuário"
  on public.message_reactions for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.messages m
      where m.id = message_id and public.is_server_member(m.server_id, auth.uid())
    )
  );

create policy "Usuário remove a própria reação"
  on public.message_reactions for delete to authenticated
  using (user_id = auth.uid());

-- ============================================================
-- Realtime: habilita eventos de INSERT/UPDATE/DELETE nessas tabelas
-- ============================================================
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.message_reactions;

-- ============================================================
-- Storage: bucket de anexos
-- ============================================================
-- Convenção de path: {server_id}/{channel_id}/{message_id}-{filename}
--
-- Observação de segurança: o bucket é público (como o de ícones de
-- servidor) — quem tem o link direto consegue acessar o arquivo sem
-- passar pela RLS, o mesmo modelo de confiança que o CDN de anexos do
-- Discord usa. A RLS aqui impede que não-membros DESCUBRAM o link pela
-- API/app; ela não impede acesso a um link já vazado. Pra um app de
-- produção real com dados sensíveis, o próximo passo seria trocar por
-- bucket privado + signed URLs com expiração curta.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments',
  'attachments',
  true,
  26214400, -- 25 MB
  array[
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    'video/mp4', 'video/webm',
    'audio/mpeg', 'audio/ogg', 'audio/wav',
    'application/pdf', 'text/plain',
    'application/zip'
  ]
)
on conflict (id) do nothing;

create policy "Membros veem anexos do servidor"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments'
    and public.is_server_member((storage.foldername(name))[1]::uuid, auth.uid())
  );

create policy "Membros enviam anexos no servidor"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and public.is_server_member((storage.foldername(name))[1]::uuid, auth.uid())
  );

create policy "Membros removem os próprios anexos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'attachments'
    and public.is_server_member((storage.foldername(name))[1]::uuid, auth.uid())
  );

-- ==== originalmente: 007_read_state.sql ====
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

-- ==== originalmente: 012_pinned_messages.sql ====
-- ============================================================
-- Mensagens fixadas (pin)
-- (pinned_at/pinned_by já incorporados direto na tabela messages, lá em cima)
-- ============================================================
create index if not exists messages_pinned_idx on public.messages (channel_id, pinned_at) where pinned_at is not null;

-- Só quem tem permissão de gerenciar mensagens no servidor (dono ou
-- cargo com essa permissão) pode fixar/desafixar — reaproveita a
-- função has_permission() já criada na migration 006.
drop policy if exists "messages_pin_update" on public.messages;
create policy "messages_pin_update"
  on public.messages for update
  using (
    exists (
      select 1 from public.channels ch
      join public.servers s on s.id = ch.server_id
      where ch.id = messages.channel_id
        and (s.owner_id = auth.uid() or public.has_permission(s.id, auth.uid(), 'manage_messages'))
    )
  );

-- ==== originalmente: 014_channel_mutes.sql ====
-- ============================================================
-- Silenciar canal (por usuário) — rode isto no SQL Editor do
-- Supabase, depois da 013_channel_topic.sql
-- ============================================================
create table if not exists public.channel_mutes (
  user_id uuid not null references public.profiles(id) on delete cascade,
  channel_id uuid not null references public.channels(id) on delete cascade,
  mentions_only boolean not null default false, -- true = só notifica em menção; false + linha existe = totalmente mudo
  created_at timestamptz not null default now(),
  primary key (user_id, channel_id)
);

alter table public.channel_mutes enable row level security;

drop policy if exists "channel_mutes_select_own" on public.channel_mutes;
create policy "channel_mutes_select_own"
  on public.channel_mutes for select
  using (user_id = auth.uid());

drop policy if exists "channel_mutes_insert_own" on public.channel_mutes;
create policy "channel_mutes_insert_own"
  on public.channel_mutes for insert
  with check (user_id = auth.uid());

drop policy if exists "channel_mutes_delete_own" on public.channel_mutes;
create policy "channel_mutes_delete_own"
  on public.channel_mutes for delete
  using (user_id = auth.uid());

-- ==== originalmente: 022_slowmode_and_notifications.sql ====
-- ============================================================
-- Modo lento por canal (a coluna slowmode_seconds já está direto na
-- tabela channels, lá no 001_core.sql) + notificação "só menções"
-- (mentions_only já está direto na tabela channel_mutes, acima)
-- ============================================================

create or replace function public.check_channel_slowmode()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slowmode int;
  v_last_at timestamptz;
  v_is_owner boolean;
begin
  select slowmode_seconds into v_slowmode from public.channels where id = new.channel_id;

  if v_slowmode is null or v_slowmode <= 0 then
    return new;
  end if;

  -- Donos do servidor não são afetados pelo modo lento
  select exists (
    select 1 from public.servers s where s.id = new.server_id and s.owner_id = new.author_id
  ) into v_is_owner;
  if v_is_owner then
    return new;
  end if;

  select max(created_at) into v_last_at
  from public.messages
  where channel_id = new.channel_id and author_id = new.author_id;

  if v_last_at is not null and v_last_at > now() - make_interval(secs => v_slowmode) then
    raise exception 'Modo lento ativado neste canal — aguarde um pouco antes de mandar outra mensagem.';
  end if;

  return new;
end;
$$;

drop trigger if exists on_channel_slowmode on public.messages;
create trigger on_channel_slowmode
  before insert on public.messages
  for each row execute function public.check_channel_slowmode();
