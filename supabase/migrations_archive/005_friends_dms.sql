-- ============================================================
-- FASE 6 — Usuários (amigos, mensagens privadas, bloqueio)
-- Rode isto no SQL Editor do Supabase, depois da 004_messages.sql
-- ============================================================

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,   -- quem enviou o pedido
  friend_id uuid not null references auth.users(id) on delete cascade, -- quem recebeu
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  unique (user_id, friend_id),
  check (user_id <> friend_id)
);

create table public.blocked_users (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table public.dm_conversations (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references auth.users(id) on delete cascade, -- sempre o menor uuid dos dois
  user_b uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_a, user_b)
);

create table public.dm_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.dm_conversations(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 4000),
  reply_to_id uuid references public.dm_messages(id) on delete set null,
  edited_at timestamptz,
  created_at timestamptz not null default now()
);

create index friendships_user_idx on public.friendships (user_id);
create index friendships_friend_idx on public.friendships (friend_id);
create index dm_conversations_user_a_idx on public.dm_conversations (user_a);
create index dm_conversations_user_b_idx on public.dm_conversations (user_b);
create index dm_messages_conversation_idx on public.dm_messages (conversation_id, created_at);

-- ============================================================
-- Trigger: edited_at + rate limit (mesma lógica das mensagens de canal)
-- ============================================================
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
create policy "Vê as próprias amizades e pedidos"
  on public.friendships for select to authenticated
  using (auth.uid() = user_id or auth.uid() = friend_id);

-- blocked_users: só o bloqueador vê a própria lista (não expõe pra quem foi bloqueado)
create policy "Vê a própria lista de bloqueios"
  on public.blocked_users for select to authenticated
  using (auth.uid() = blocker_id);

-- dm_conversations: só os participantes
create policy "Participantes veem a própria conversa"
  on public.dm_conversations for select to authenticated
  using (auth.uid() = user_a or auth.uid() = user_b);

-- dm_messages
create policy "Participantes veem as mensagens da conversa"
  on public.dm_messages for select to authenticated
  using (
    exists (
      select 1 from public.dm_conversations c
      where c.id = conversation_id and (c.user_a = auth.uid() or c.user_b = auth.uid())
    )
  );

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

create policy "Autor edita a própria DM"
  on public.dm_messages for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

create policy "Autor exclui a própria DM"
  on public.dm_messages for delete to authenticated
  using (author_id = auth.uid());

-- ============================================================
-- Funções: amizade, bloqueio e conversas (security definer —
-- validam regras de negócio que RLS sozinha não expressa bem)
-- ============================================================
create or replace function public.send_friend_request(p_username text)
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

  insert into public.friendships (user_id, friend_id, status)
  values (auth.uid(), v_target_id, 'pending')
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
