-- ============================================================
-- CONSOLIDADO 003: amizades, bloqueios, conversas diretas (1-pra-1
-- e em grupo), anexos de DM
-- (junta: 005_friends_dms, 020_dm_attachments, 021_group_dms)
--
-- Só pra ORGANIZAÇÃO/REFERÊNCIA — não rode num banco que já tem essas
-- migrations aplicadas.
-- ============================================================


-- ==== originalmente: 005_friends_dms.sql ====
-- ============================================================
-- FASE 6 — Usuários (amigos, mensagens privadas, bloqueio)
-- Rode isto no SQL Editor do Supabase, depois da 004_messages.sql
-- ============================================================

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,   -- quem enviou o pedido
  friend_id uuid not null references auth.users(id) on delete cascade, -- quem recebeu
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  request_note text check (char_length(request_note) <= 200), -- mensagem opcional ao enviar o pedido
  created_at timestamptz not null default now(),
  unique (user_id, friend_id),
  check (user_id <> friend_id)
);

create table if not exists public.blocked_users (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table if not exists public.dm_conversations (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references auth.users(id) on delete cascade, -- sempre o menor uuid dos dois
  user_b uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_a, user_b)
);

create table if not exists public.dm_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.dm_conversations(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  content text not null check (char_length(content) between 0 and 4000),
  reply_to_id uuid references public.dm_messages(id) on delete set null,
  edited_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists friendships_user_idx on public.friendships (user_id);
create index if not exists friendships_friend_idx on public.friendships (friend_id);
create index if not exists dm_conversations_user_a_idx on public.dm_conversations (user_a);
create index if not exists dm_conversations_user_b_idx on public.dm_conversations (user_b);
create index if not exists dm_messages_conversation_idx on public.dm_messages (conversation_id, created_at);

-- Rede de segurança pra bancos que já tinham essas tabelas criadas
-- antes destas colunas/constraints existirem
alter table public.friendships add column if not exists request_note text;
do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where contype = 'c' and conrelid = 'public.dm_messages'::regclass and pg_get_constraintdef(oid) ilike '%content%'
  loop
    execute format('alter table public.dm_messages drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.dm_messages add constraint dm_messages_content_length check (char_length(content) between 0 and 4000);

-- ============================================================
-- Trigger: edited_at + rate limit (mesma lógica das mensagens de canal)
-- ============================================================
drop trigger if exists on_dm_message_edited on public.friendships;
create trigger on_dm_message_edited
  before update on public.dm_messages
  for each row execute function public.handle_message_edited();

create or replace function public.check_dm_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  select count(*) into v_count
  from public.dm_messages
  where author_id = new.author_id
    and created_at > now() - interval '10 seconds';

  if v_count >= 8 then
    raise exception 'Você está enviando mensagens rápido demais. Aguarde um instante.';
  end if;

  return new;
end;
$$;

drop trigger if exists on_dm_rate_limit on public.dm_messages;
create trigger on_dm_rate_limit
  before insert on public.dm_messages
  for each row execute function public.check_dm_rate_limit();

-- ============================================================
-- RLS
-- ============================================================
alter table public.friendships enable row level security;
alter table public.blocked_users enable row level security;
alter table public.dm_conversations enable row level security;
alter table public.dm_messages enable row level security;

-- friendships: leitura pros dois lados; toda escrita passa por função
-- (evita pedidos duplicados, respeita bloqueios, valida quem responde)
drop policy if exists "Vê as próprias amizades e pedidos" on public.friendships;
create policy "Vê as próprias amizades e pedidos"
  on public.friendships for select to authenticated
  using (auth.uid() = user_id or auth.uid() = friend_id);

-- blocked_users: só o bloqueador vê a própria lista (não expõe pra quem foi bloqueado)
drop policy if exists "Vê a própria lista de bloqueios" on public.blocked_users;
create policy "Vê a própria lista de bloqueios"
  on public.blocked_users for select to authenticated
  using (auth.uid() = blocker_id);

-- dm_conversations: só os participantes
drop policy if exists "Participantes veem a própria conversa" on public.dm_conversations;
create policy "Participantes veem a própria conversa"
  on public.dm_conversations for select to authenticated
  using (auth.uid() = user_a or auth.uid() = user_b);

-- dm_messages
drop policy if exists "Participantes veem as mensagens da conversa" on public.dm_messages;
create policy "Participantes veem as mensagens da conversa"
  on public.dm_messages for select to authenticated
  using (
    exists (
      select 1 from public.dm_conversations c
      where c.id = conversation_id and (c.user_a = auth.uid() or c.user_b = auth.uid())
    )
  );

drop policy if exists "Participantes enviam DMs, se não bloqueados" on public.dm_messages;
create policy "Participantes enviam DMs, se não bloqueados"
  on public.dm_messages for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.dm_conversations c
      where c.id = conversation_id and (c.user_a = auth.uid() or c.user_b = auth.uid())
    )
    and not exists (
      select 1 from public.dm_conversations c
      join public.blocked_users b on (
        (b.blocker_id = c.user_a and b.blocked_id = c.user_b) or
        (b.blocker_id = c.user_b and b.blocked_id = c.user_a)
      )
      where c.id = conversation_id
    )
  );

drop policy if exists "Autor edita a própria DM" on public.dm_messages;
create policy "Autor edita a própria DM"
  on public.dm_messages for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

drop policy if exists "Autor exclui a própria DM" on public.dm_messages;
create policy "Autor exclui a própria DM"
  on public.dm_messages for delete to authenticated
  using (author_id = auth.uid());

-- ============================================================
-- Funções: amizade, bloqueio e conversas (security definer —
-- validam regras de negócio que RLS sozinha não expressa bem)
-- ============================================================
create or replace function public.send_friend_request(p_username text, p_note text default null)
returns public.friendships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_id uuid;
  v_existing public.friendships;
  v_reverse public.friendships;
  v_result public.friendships;
begin
  select id into v_target_id from public.profiles where lower(username) = lower(p_username);

  if v_target_id is null then
    raise exception 'Usuário não encontrado';
  end if;

  if v_target_id = auth.uid() then
    raise exception 'Você não pode adicionar a si mesmo';
  end if;

  if exists (
    select 1 from public.blocked_users
    where (blocker_id = auth.uid() and blocked_id = v_target_id)
       or (blocker_id = v_target_id and blocked_id = auth.uid())
  ) then
    raise exception 'Não é possível enviar pedido de amizade para este usuário';
  end if;

  select * into v_existing from public.friendships where user_id = auth.uid() and friend_id = v_target_id;
  if v_existing is not null then
    raise exception 'Pedido já enviado ou vocês já são amigos';
  end if;

  select * into v_reverse from public.friendships where user_id = v_target_id and friend_id = auth.uid();

  if v_reverse is not null then
    if v_reverse.status = 'accepted' then
      raise exception 'Vocês já são amigos';
    end if;
    -- o outro usuário já tinha te chamado: aceita automaticamente
    update public.friendships set status = 'accepted' where id = v_reverse.id returning * into v_result;
    return v_result;
  end if;

  insert into public.friendships (user_id, friend_id, status, request_note)
  values (auth.uid(), v_target_id, 'pending', nullif(trim(coalesce(p_note, '')), ''))
  returning * into v_result;

  return v_result;
end;
$$;

create or replace function public.respond_friend_request(p_request_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_accept then
    update public.friendships set status = 'accepted'
      where id = p_request_id and friend_id = auth.uid() and status = 'pending';
  else
    delete from public.friendships
      where id = p_request_id and friend_id = auth.uid() and status = 'pending';
  end if;
end;
$$;

create or replace function public.remove_friend(p_other_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.friendships
    where (user_id = auth.uid() and friend_id = p_other_user_id)
       or (user_id = p_other_user_id and friend_id = auth.uid());
end;
$$;

create or replace function public.block_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id = auth.uid() then
    raise exception 'Você não pode bloquear a si mesmo';
  end if;

  insert into public.blocked_users (blocker_id, blocked_id)
  values (auth.uid(), p_user_id)
  on conflict do nothing;

  delete from public.friendships
    where (user_id = auth.uid() and friend_id = p_user_id)
       or (user_id = p_user_id and friend_id = auth.uid());
end;
$$;

create or replace function public.unblock_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.blocked_users where blocker_id = auth.uid() and blocked_id = p_user_id;
end;
$$;

create or replace function public.get_or_create_dm(p_other_user_id uuid)
returns public.dm_conversations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_a uuid;
  v_b uuid;
  v_convo public.dm_conversations;
begin
  if p_other_user_id = auth.uid() then
    raise exception 'Você não pode iniciar uma conversa consigo mesmo';
  end if;

  if exists (
    select 1 from public.blocked_users
    where (blocker_id = auth.uid() and blocked_id = p_other_user_id)
       or (blocker_id = p_other_user_id and blocked_id = auth.uid())
  ) then
    raise exception 'Não é possível enviar mensagem para este usuário';
  end if;

  if auth.uid() < p_other_user_id then
    v_a := auth.uid();
    v_b := p_other_user_id;
  else
    v_a := p_other_user_id;
    v_b := auth.uid();
  end if;

  select * into v_convo from public.dm_conversations where user_a = v_a and user_b = v_b;

  if v_convo is null then
    insert into public.dm_conversations (user_a, user_b) values (v_a, v_b) returning * into v_convo;
  end if;

  return v_convo;
end;
$$;

-- ============================================================
-- Realtime
-- ============================================================
alter publication supabase_realtime add table public.dm_messages;
alter publication supabase_realtime add table public.friendships;

-- ============================================================
-- Storage: bucket público de avatares
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

-- Convenção de path: {user_id}/avatar-{timestamp}.ext
create policy "Avatares são publicamente visíveis"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "Usuário envia o próprio avatar"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Usuário atualiza o próprio avatar"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Usuário remove o próprio avatar"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ==== originalmente: 020_dm_attachments.sql ====
-- ============================================================
-- Anexos em mensagens diretas (DM) — rode isto no SQL Editor do
-- Supabase, depois da 019_stage_channels.sql
-- ============================================================

-- audio/webm é o formato que a gravação de mensagem de voz produz —
-- faltava na lista de tipos aceitos no bucket de anexos dos canais.
update storage.buckets
set allowed_mime_types = array[
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'video/mp4', 'video/webm',
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm',
  'application/pdf', 'text/plain',
  'application/zip'
]
where id = 'attachments';

create table if not exists public.dm_message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.dm_messages(id) on delete cascade,
  file_url text not null,
  file_name text not null,
  file_size integer not null,
  mime_type text not null,
  created_at timestamptz not null default now()
);

alter table public.dm_message_attachments enable row level security;

drop policy if exists "dm_message_attachments_select" on public.dm_message_attachments;
create policy "dm_message_attachments_select"
  on public.dm_message_attachments for select
  using (
    exists (
      select 1 from public.dm_messages m
      join public.dm_conversations c on c.id = m.conversation_id
      where m.id = message_id and (c.user_a = auth.uid() or c.user_b = auth.uid())
    )
  );

drop policy if exists "dm_message_attachments_insert" on public.dm_message_attachments;
create policy "dm_message_attachments_insert"
  on public.dm_message_attachments for insert
  with check (
    exists (
      select 1 from public.dm_messages m
      where m.id = message_id and m.author_id = auth.uid()
    )
  );

-- Bucket de armazenamento pros arquivos em si (pasta raiz = id da
-- conversa, checado contra quem participa dela)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'dm-attachments',
  'dm-attachments',
  true,
  26214400,
  array[
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    'video/mp4', 'video/webm',
    'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm',
    'application/pdf', 'text/plain',
    'application/zip'
  ]
)
on conflict (id) do nothing;

drop policy if exists "dm_attachments_select" on storage.objects;
create policy "dm_attachments_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'dm-attachments'
    and exists (
      select 1 from public.dm_conversations c
      where c.id = (storage.foldername(name))[1]::uuid
        and (c.user_a = auth.uid() or c.user_b = auth.uid())
    )
  );

drop policy if exists "dm_attachments_insert" on storage.objects;
create policy "dm_attachments_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'dm-attachments'
    and exists (
      select 1 from public.dm_conversations c
      where c.id = (storage.foldername(name))[1]::uuid
        and (c.user_a = auth.uid() or c.user_b = auth.uid())
    )
  );

-- ==== originalmente: 021_group_dms.sql ====
-- ============================================================
-- Grupos de conversa (DM em grupo) — rode isto no SQL Editor do
-- Supabase, depois da 020_dm_attachments.sql
--
-- Implementado como um sistema SEPARADO das conversas 1-pra-1
-- (dm_conversations/dm_messages) de propósito — evita qualquer
-- risco de quebrar o que já funciona lá.
-- ============================================================
create table if not exists public.group_conversations (
  id uuid primary key default gen_random_uuid(),
  name text,
  icon_url text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.group_conversation_members (
  group_id uuid not null references public.group_conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists public.group_messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.group_conversations(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  content text not null default '' check (char_length(content) between 0 and 4000),
  reply_to_id uuid references public.group_messages(id) on delete set null,
  edited_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.group_message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.group_messages(id) on delete cascade,
  file_url text not null,
  file_name text not null,
  file_size integer not null,
  mime_type text not null,
  created_at timestamptz not null default now()
);

create index if not exists group_messages_group_idx on public.group_messages (group_id, created_at);

do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where contype = 'c' and conrelid = 'public.group_messages'::regclass and pg_get_constraintdef(oid) ilike '%content%'
  loop
    execute format('alter table public.group_messages drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.group_messages add constraint group_messages_content_length check (char_length(content) between 0 and 4000);

alter table public.group_conversations enable row level security;
alter table public.group_conversation_members enable row level security;
alter table public.group_messages enable row level security;
alter table public.group_message_attachments enable row level security;

-- Função auxiliar (evita recursão de política em cima da própria tabela de membros)
create or replace function public.is_group_member(p_group_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.group_conversation_members
    where group_id = p_group_id and user_id = p_user_id
  );
$$;

drop policy if exists "group_conversations_select" on public.group_conversations;
create policy "group_conversations_select"
  on public.group_conversations for select
  using (public.is_group_member(id, auth.uid()));

drop policy if exists "group_conversations_insert" on public.group_conversations;
create policy "group_conversations_insert"
  on public.group_conversations for insert
  with check (created_by = auth.uid());

drop policy if exists "group_conversations_update" on public.group_conversations;
create policy "group_conversations_update"
  on public.group_conversations for update
  using (public.is_group_member(id, auth.uid()));

drop policy if exists "group_members_select" on public.group_conversation_members;
create policy "group_members_select"
  on public.group_conversation_members for select
  using (public.is_group_member(group_id, auth.uid()));

drop policy if exists "group_members_insert" on public.group_conversation_members;
create policy "group_members_insert"
  on public.group_conversation_members for insert
  with check (
    -- o próprio dono do grupo adicionando alguém, OU a própria pessoa entrando
    user_id = auth.uid()
    or exists (select 1 from public.group_conversations g where g.id = group_id and g.created_by = auth.uid())
  );

drop policy if exists "group_members_delete" on public.group_conversation_members;
create policy "group_members_delete"
  on public.group_conversation_members for delete
  using (user_id = auth.uid());

drop policy if exists "group_messages_select" on public.group_messages;
create policy "group_messages_select"
  on public.group_messages for select
  using (public.is_group_member(group_id, auth.uid()));

drop policy if exists "group_messages_insert" on public.group_messages;
create policy "group_messages_insert"
  on public.group_messages for insert
  with check (author_id = auth.uid() and public.is_group_member(group_id, auth.uid()));

drop policy if exists "group_messages_update" on public.group_messages;
create policy "group_messages_update"
  on public.group_messages for update
  using (author_id = auth.uid());

drop policy if exists "group_messages_delete" on public.group_messages;
create policy "group_messages_delete"
  on public.group_messages for delete
  using (author_id = auth.uid());

drop policy if exists "group_message_attachments_select" on public.group_message_attachments;
create policy "group_message_attachments_select"
  on public.group_message_attachments for select
  using (
    exists (
      select 1 from public.group_messages m
      where m.id = message_id and public.is_group_member(m.group_id, auth.uid())
    )
  );

drop policy if exists "group_message_attachments_insert" on public.group_message_attachments;
create policy "group_message_attachments_insert"
  on public.group_message_attachments for insert
  with check (
    exists (select 1 from public.group_messages m where m.id = message_id and m.author_id = auth.uid())
  );

-- Bucket de armazenamento pros arquivos (pasta raiz = id do grupo)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'group-attachments',
  'group-attachments',
  true,
  26214400,
  array[
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    'video/mp4', 'video/webm',
    'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm',
    'application/pdf', 'text/plain',
    'application/zip'
  ]
)
on conflict (id) do nothing;

drop policy if exists "group_attachments_select" on storage.objects;
create policy "group_attachments_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'group-attachments'
    and public.is_group_member((storage.foldername(name))[1]::uuid, auth.uid())
  );

drop policy if exists "group_attachments_insert" on storage.objects;
create policy "group_attachments_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'group-attachments'
    and public.is_group_member((storage.foldername(name))[1]::uuid, auth.uid())
  );
