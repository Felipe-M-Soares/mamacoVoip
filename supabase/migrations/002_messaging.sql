create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  server_id uuid not null references public.servers(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  content text not null check (char_length(content) between 0 and 4000),
  reply_to_id uuid references public.messages(id) on delete set null,
  edited_at timestamptz,
  pinned_at timestamptz,
  pinned_by uuid references public.profiles(id) on delete set null,
  system_event text,
  created_at timestamptz not null default now()
);

alter table public.messages add column if not exists system_event text;

create or replace function public.announce_member_join()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_channel_id uuid;
begin
  select id into v_channel_id
  from public.channels
  where server_id = new.server_id and type = 'text'
  order by position asc
  limit 1;

  if v_channel_id is not null then
    insert into public.messages (channel_id, server_id, author_id, content, system_event)
    values (v_channel_id, new.server_id, new.user_id, '', 'member_join');
  end if;

  return new;
end;
$$;

drop trigger if exists on_member_joined_announce on public.server_members;
create trigger on_member_joined_announce
  after insert on public.server_members
  for each row execute function public.announce_member_join();

create table if not exists public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  file_url text not null,
  file_name text not null,
  file_size int not null,
  mime_type text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 34),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where contype = 'c' and conrelid = 'public.messages'::regclass and pg_get_constraintdef(oid) ilike '%content%'
  loop
    execute format('alter table public.messages drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.messages add constraint messages_content_length check (char_length(content) between 0 and 4000);

do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where contype = 'c' and conrelid = 'public.message_reactions'::regclass and pg_get_constraintdef(oid) ilike '%emoji%'
  loop
    execute format('alter table public.message_reactions drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.message_reactions add constraint message_reactions_emoji_length check (char_length(emoji) between 1 and 34);

create index if not exists messages_channel_created_idx on public.messages (channel_id, created_at);
create index if not exists messages_author_idx on public.messages (author_id);
create index if not exists message_attachments_message_idx on public.message_attachments (message_id);
create index if not exists message_reactions_message_idx on public.message_reactions (message_id);

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

drop trigger if exists on_message_edited on public.messages;
create trigger on_message_edited
  before update on public.messages
  for each row execute function public.handle_message_edited();

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

drop trigger if exists on_message_rate_limit on public.messages;
create trigger on_message_rate_limit
  before insert on public.messages
  for each row execute function public.check_message_rate_limit();

alter table public.messages enable row level security;
alter table public.message_attachments enable row level security;
alter table public.message_reactions enable row level security;

drop policy if exists "Membros veem mensagens do servidor" on public.messages;
create policy "Membros veem mensagens do servidor"
  on public.messages for select to authenticated
  using (public.is_server_member(server_id, auth.uid()));

drop policy if exists "Membros enviam mensagens" on public.messages;
create policy "Membros enviam mensagens"
  on public.messages for insert to authenticated
  with check (public.is_server_member(server_id, auth.uid()) and author_id = auth.uid());

drop policy if exists "Autor edita a própria mensagem" on public.messages;
create policy "Autor edita a própria mensagem"
  on public.messages for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

drop policy if exists "Autor ou dono do servidor exclui mensagem" on public.messages;
create policy "Autor ou dono do servidor exclui mensagem"
  on public.messages for delete to authenticated
  using (
    author_id = auth.uid()
    or exists (select 1 from public.servers s where s.id = server_id and s.owner_id = auth.uid())
  );

drop policy if exists "Membros veem anexos" on public.message_attachments;
create policy "Membros veem anexos"
  on public.message_attachments for select to authenticated
  using (
    exists (
      select 1 from public.messages m
      where m.id = message_id and public.is_server_member(m.server_id, auth.uid())
    )
  );

drop policy if exists "Autor da mensagem anexa arquivos" on public.message_attachments;
create policy "Autor da mensagem anexa arquivos"
  on public.message_attachments for insert to authenticated
  with check (
    exists (select 1 from public.messages m where m.id = message_id and m.author_id = auth.uid())
  );

drop policy if exists "Autor remove os próprios anexos" on public.message_attachments;
create policy "Autor remove os próprios anexos"
  on public.message_attachments for delete to authenticated
  using (
    exists (select 1 from public.messages m where m.id = message_id and m.author_id = auth.uid())
  );

drop policy if exists "Membros veem reações" on public.message_reactions;
create policy "Membros veem reações"
  on public.message_reactions for select to authenticated
  using (
    exists (
      select 1 from public.messages m
      where m.id = message_id and public.is_server_member(m.server_id, auth.uid())
    )
  );

drop policy if exists "Membros reagem com o próprio usuário" on public.message_reactions;
create policy "Membros reagem com o próprio usuário"
  on public.message_reactions for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.messages m
      where m.id = message_id and public.is_server_member(m.server_id, auth.uid())
    )
  );

drop policy if exists "Usuário remove a própria reação" on public.message_reactions;
create policy "Usuário remove a própria reação"
  on public.message_reactions for delete to authenticated
  using (user_id = auth.uid());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_reactions'
  ) then
    alter publication supabase_realtime add table public.message_reactions;
  end if;
end $$;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_attachments'
  ) then
    alter publication supabase_realtime add table public.message_attachments;
  end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments',
  'attachments',
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

update storage.buckets
set allowed_mime_types = array[
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'video/mp4', 'video/webm',
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm',
  'application/pdf', 'text/plain',
  'application/zip'
]
where id = 'attachments';

drop policy if exists "Membros veem anexos do servidor" on storage.objects;
create policy "Membros veem anexos do servidor"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments'
    and public.is_server_member((storage.foldername(name))[1]::uuid, auth.uid())
  );

drop policy if exists "Membros enviam anexos no servidor" on storage.objects;
create policy "Membros enviam anexos no servidor"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and public.is_server_member((storage.foldername(name))[1]::uuid, auth.uid())
  );

drop policy if exists "Membros removem os próprios anexos" on storage.objects;
create policy "Membros removem os próprios anexos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'attachments'
    and public.is_server_member((storage.foldername(name))[1]::uuid, auth.uid())
  );

create table if not exists public.channel_read_state (
  channel_id uuid not null references public.channels(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

alter table public.channel_read_state enable row level security;

drop policy if exists "Usuário vê o próprio estado de leitura de canais" on public.channel_read_state;
create policy "Usuário vê o próprio estado de leitura de canais"
  on public.channel_read_state for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Usuário marca seus canais como lidos" on public.channel_read_state;
create policy "Usuário marca seus canais como lidos"
  on public.channel_read_state for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Usuário atualiza o próprio estado de leitura de canais" on public.channel_read_state;
create policy "Usuário atualiza o próprio estado de leitura de canais"
  on public.channel_read_state for update to authenticated
  using (user_id = auth.uid());

create index if not exists messages_pinned_idx on public.messages (channel_id, pinned_at) where pinned_at is not null;

create table if not exists public.channel_mutes (
  user_id uuid not null references public.profiles(id) on delete cascade,
  channel_id uuid not null references public.channels(id) on delete cascade,
  mentions_only boolean not null default false,
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
