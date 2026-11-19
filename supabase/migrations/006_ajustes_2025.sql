do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'server_members'
  ) then
    alter publication supabase_realtime add table public.server_members;
  end if;
end $$;

update storage.buckets set file_size_limit = 10485760 where id = 'avatars';
update storage.buckets set file_size_limit = 15728640 where id = 'profile-banners';
update storage.buckets set file_size_limit = 5242880 where id = 'avatar-decorations';

alter table public.dm_conversations add column if not exists hidden_for_a boolean not null default false;
alter table public.dm_conversations add column if not exists hidden_for_b boolean not null default false;

create or replace function public.hide_dm_conversation(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_convo public.dm_conversations;
begin
  select * into v_convo from public.dm_conversations where id = p_conversation_id;

  if v_convo is null then
    raise exception 'Conversa não encontrada';
  end if;

  if v_convo.user_a = auth.uid() then
    update public.dm_conversations set hidden_for_a = true where id = p_conversation_id;
  elsif v_convo.user_b = auth.uid() then
    update public.dm_conversations set hidden_for_b = true where id = p_conversation_id;
  else
    raise exception 'Você não participa dessa conversa';
  end if;
end;
$$;

create or replace function public.unhide_dm_conversation_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.dm_conversations
    set hidden_for_a = false, hidden_for_b = false
    where id = new.conversation_id and (hidden_for_a or hidden_for_b);
  return new;
end;
$$;

drop trigger if exists on_dm_message_unhide_conversation on public.dm_messages;
create trigger on_dm_message_unhide_conversation
  after insert on public.dm_messages
  for each row execute function public.unhide_dm_conversation_on_message();

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
  else
    update public.dm_conversations
    set hidden_for_a = (case when v_a = auth.uid() then false else hidden_for_a end),
        hidden_for_b = (case when v_b = auth.uid() then false else hidden_for_b end)
    where id = v_convo.id
    returning * into v_convo;
  end if;

  return v_convo;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base text;
  v_username text;
  v_suffix int := 0;
  v_display_name text;
begin
  v_base := coalesce(
    nullif(trim(new.raw_user_meta_data->>'username'), ''),
    split_part(new.email, '@', 1)
  );
  v_base := regexp_replace(v_base, '[^a-zA-Z0-9_.]', '', 'g');
  if v_base = '' then
    v_base := 'usuario';
  end if;

  v_username := v_base;
  while exists (select 1 from public.profiles where lower(username) = lower(v_username)) loop
    v_suffix := v_suffix + 1;
    v_username := v_base || v_suffix::text;
  end loop;

  v_display_name := coalesce(
    nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
    nullif(trim(new.raw_user_meta_data->>'name'), ''),
    v_base
  );

  insert into public.profiles (id, username, display_name)
  values (new.id, v_username, v_display_name);

  return new;
end;
$$;

create or replace function public.has_permission(p_server_id uuid, p_user_id uuid, p_permission text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    (p_user_id = auth.uid() or exists (
      select 1 from public.server_members where server_id = p_server_id and user_id = auth.uid()
    ))
    and (
      exists (select 1 from public.servers where id = p_server_id and owner_id = p_user_id)
      or (
        exists (select 1 from public.server_members where server_id = p_server_id and user_id = p_user_id)
        and exists (
          select 1
          from public.server_member_roles smr
          join public.roles r on r.id = smr.role_id
          where smr.server_id = p_server_id
            and smr.user_id = p_user_id
            and (r.permissions @> array['administrator'] or r.permissions @> array[p_permission])
        )
      )
    );
$$;

create or replace function public.top_role_position(p_server_id uuid, p_user_id uuid)
returns int
language sql
security definer
stable
set search_path = public
as $$
  select case
    when exists (select 1 from public.servers where id = p_server_id and owner_id = p_user_id)
      then 2147483647
    when not exists (select 1 from public.server_members where server_id = p_server_id and user_id = p_user_id)
      then -1
    else coalesce(
      (
        select max(r.position)
        from public.server_member_roles smr
        join public.roles r on r.id = smr.role_id
        where smr.server_id = p_server_id and smr.user_id = p_user_id
      ),
      -1
    )
  end;
$$;

create or replace function public.cleanup_member_roles_on_leave()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.server_member_roles
    where server_id = old.server_id and user_id = old.user_id;
  return old;
end;
$$;

drop trigger if exists on_server_member_removed on public.server_members;
create trigger on_server_member_removed
  after delete on public.server_members
  for each row execute function public.cleanup_member_roles_on_leave();

drop policy if exists "Membros enviam mensagens, se não estiverem em timeout" on public.messages;
create policy "Membros enviam mensagens, se não estiverem em timeout"
  on public.messages for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.channels ch
      where ch.id = messages.channel_id
        and ch.server_id = messages.server_id
        and public.is_server_member(ch.server_id, auth.uid())
        and (
          not ch.is_restricted
          or public.has_permission(ch.server_id, auth.uid(), 'manage_channels')
          or public.user_has_channel_role_access(ch.id, auth.uid())
        )
    )
    and not exists (
      select 1 from public.server_members sm
      where sm.server_id = messages.server_id
        and sm.user_id = auth.uid()
        and sm.timeout_until is not null
        and sm.timeout_until > now()
    )
  );

create or replace function public.protect_message_pin_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_server_id uuid;
begin
  if new.pinned_at is not distinct from old.pinned_at and new.pinned_by is not distinct from old.pinned_by then
    return new;
  end if;

  select ch.server_id into v_server_id from public.channels ch where ch.id = new.channel_id;

  if v_server_id is null or not public.has_permission(v_server_id, auth.uid(), 'manage_messages') then
    raise exception 'Você não tem permissão para fixar/desafixar mensagens';
  end if;

  return new;
end;
$$;

drop trigger if exists on_message_pin_columns_protected on public.messages;
create trigger on_message_pin_columns_protected
  before update on public.messages
  for each row execute function public.protect_message_pin_columns();

revoke execute on function public.has_permission(uuid, uuid, text) from public;
grant execute on function public.has_permission(uuid, uuid, text) to authenticated;

revoke execute on function public.top_role_position(uuid, uuid) from public;
grant execute on function public.top_role_position(uuid, uuid) to authenticated;

revoke execute on function public.is_server_member(uuid, uuid) from public;
grant execute on function public.is_server_member(uuid, uuid) to authenticated;

revoke execute on function public.is_group_member(uuid, uuid) from public;
grant execute on function public.is_group_member(uuid, uuid) to authenticated;

revoke execute on function public.channel_server_id(uuid) from public;
grant execute on function public.channel_server_id(uuid) to authenticated;

revoke execute on function public.user_has_channel_role_access(uuid, uuid) from public;
grant execute on function public.user_has_channel_role_access(uuid, uuid) to authenticated;

create or replace function public.protect_group_conversation_owner()
returns trigger
language plpgsql
as $$
begin
  new.created_by := old.created_by;
  return new;
end;
$$;

drop trigger if exists on_group_conversation_owner_protected on public.group_conversations;
create trigger on_group_conversation_owner_protected
  before update on public.group_conversations
  for each row execute function public.protect_group_conversation_owner();

drop policy if exists "Quem vê o canal vê os cargos liberados" on public.channel_role_access;
create policy "Quem vê o canal vê os cargos liberados"
  on public.channel_role_access for select to authenticated
  using (
    public.has_permission(public.channel_server_id(channel_id), auth.uid(), 'manage_channels')
    or public.user_has_channel_role_access(channel_id, auth.uid())
  );

drop policy if exists "threads_insert" on public.threads;
create policy "threads_insert"
  on public.threads for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.messages m
      join public.channels c on c.id = m.channel_id
      where m.id = threads.parent_message_id
        and c.id = threads.channel_id
        and c.server_id = threads.server_id
        and public.is_server_member(c.server_id, auth.uid())
    )
  );

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

  insert into public.dm_conversations (user_a, user_b)
  values (v_a, v_b)
  on conflict (user_a, user_b) do nothing;

  select * into v_convo from public.dm_conversations where user_a = v_a and user_b = v_b;

  if (v_a = auth.uid() and v_convo.hidden_for_a) or (v_b = auth.uid() and v_convo.hidden_for_b) then
    update public.dm_conversations
    set hidden_for_a = (case when v_a = auth.uid() then false else hidden_for_a end),
        hidden_for_b = (case when v_b = auth.uid() then false else hidden_for_b end)
    where id = v_convo.id
    returning * into v_convo;
  end if;

  return v_convo;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-banners', 'profile-banners', true, 15728640, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update set allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatar-decorations', 'avatar-decorations', true, 5242880, array['image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('soundboard', 'soundboard', true, 2097152, array['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm'])
on conflict (id) do update set allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Banners são publicamente visíveis" on storage.objects;
create policy "Banners são publicamente visíveis"
  on storage.objects for select
  using (bucket_id = 'profile-banners');

drop policy if exists "Usuário envia o próprio banner" on storage.objects;
create policy "Usuário envia o próprio banner"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'profile-banners' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Usuário atualiza o próprio banner" on storage.objects;
create policy "Usuário atualiza o próprio banner"
  on storage.objects for update to authenticated
  using (bucket_id = 'profile-banners' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Usuário remove o próprio banner" on storage.objects;
create policy "Usuário remove o próprio banner"
  on storage.objects for delete to authenticated
  using (bucket_id = 'profile-banners' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Decorações são publicamente visíveis" on storage.objects;
create policy "Decorações são publicamente visíveis"
  on storage.objects for select
  using (bucket_id = 'avatar-decorations');

drop policy if exists "Usuário envia a própria decoração" on storage.objects;
create policy "Usuário envia a própria decoração"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatar-decorations' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Usuário atualiza a própria decoração" on storage.objects;
create policy "Usuário atualiza a própria decoração"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatar-decorations' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Usuário remove a própria decoração" on storage.objects;
create policy "Usuário remove a própria decoração"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatar-decorations' and (storage.foldername(name))[1] = auth.uid()::text);

create table if not exists public.soundboard_sounds (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 32),
  storage_path text not null,
  uploaded_by uuid references public.profiles(id) on delete set null,
  play_count int not null default 0,
  created_at timestamptz not null default now(),
  unique (server_id, name)
);

create index if not exists soundboard_sounds_server_idx on public.soundboard_sounds (server_id);

alter table public.soundboard_sounds enable row level security;

drop policy if exists "soundboard_sounds_select" on public.soundboard_sounds;
create policy "soundboard_sounds_select"
  on public.soundboard_sounds for select to authenticated
  using (public.is_server_member(server_id, auth.uid()));

drop policy if exists "soundboard_sounds_insert" on public.soundboard_sounds;
create policy "soundboard_sounds_insert"
  on public.soundboard_sounds for insert to authenticated
  with check (public.is_server_member(server_id, auth.uid()) and uploaded_by = auth.uid());

create or replace function public.delete_soundboard_sound(p_sound_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sound public.soundboard_sounds;
begin
  select * into v_sound from public.soundboard_sounds where id = p_sound_id;

  if v_sound is null then
    return;
  end if;

  if v_sound.uploaded_by <> auth.uid() and not public.has_permission(v_sound.server_id, auth.uid(), 'manage_messages') then
    raise exception 'Você não tem permissão para apagar este som';
  end if;

  delete from public.soundboard_sounds where id = p_sound_id;
  delete from storage.objects where bucket_id = 'soundboard' and name = v_sound.storage_path;
end;
$$;

create or replace function public.bump_soundboard_play_count(p_sound_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_server_id uuid;
begin
  select server_id into v_server_id from public.soundboard_sounds where id = p_sound_id;

  if v_server_id is null or not public.is_server_member(v_server_id, auth.uid()) then
    raise exception 'Som não encontrado';
  end if;

  update public.soundboard_sounds set play_count = play_count + 1 where id = p_sound_id;
end;
$$;

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  server_id uuid references public.servers(id) on delete cascade,
  target_type text not null check (target_type in ('message', 'user')),
  message_id uuid references public.messages(id) on delete cascade,
  reported_user_id uuid references auth.users(id) on delete cascade,
  reason text not null,
  details text,
  status text not null default 'pending' check (status in ('pending', 'reviewed', 'dismissed')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists reports_server_status_idx on public.reports(server_id, status);
create index if not exists reports_reporter_idx on public.reports(reporter_id);

create or replace function public.set_report_context()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_server_id uuid;
  v_author_id uuid;
begin
  if new.reporter_id is distinct from auth.uid() then
    raise exception 'reporter_id precisa ser o usuário autenticado';
  end if;

  if new.target_type = 'message' then
    if new.message_id is null then
      raise exception 'message_id é obrigatório para denúncia de mensagem';
    end if;
    select server_id, author_id into v_server_id, v_author_id
    from public.messages where id = new.message_id;
    if v_server_id is null then
      raise exception 'mensagem não encontrada';
    end if;
    if v_author_id = auth.uid() then
      raise exception 'não é possível denunciar a própria mensagem';
    end if;
    new.server_id := v_server_id;
    new.reported_user_id := v_author_id;
  elsif new.target_type = 'user' then
    if new.reported_user_id is null then
      raise exception 'reported_user_id é obrigatório para denúncia de usuário';
    end if;
    if new.reported_user_id = auth.uid() then
      raise exception 'não é possível denunciar a si mesmo';
    end if;
    if new.server_id is not null and not exists (
      select 1 from public.server_members where server_id = new.server_id and user_id = auth.uid()
    ) then
      new.server_id := null;
    end if;
  else
    raise exception 'target_type inválido';
  end if;

  new.status := 'pending';
  new.reviewed_by := null;
  new.reviewed_at := null;
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists before_insert_report on public.reports;
create trigger before_insert_report
  before insert on public.reports
  for each row execute function public.set_report_context();

create or replace function public.protect_report_immutable_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.reporter_id is distinct from old.reporter_id
    or new.target_type is distinct from old.target_type
    or new.message_id is distinct from old.message_id
    or new.reported_user_id is distinct from old.reported_user_id
    or new.reason is distinct from old.reason
    or new.details is distinct from old.details
    or new.server_id is distinct from old.server_id
    or new.created_at is distinct from old.created_at
  then
    raise exception 'só é permitido alterar o status da denúncia';
  end if;
  new.reviewed_by := auth.uid();
  new.reviewed_at := now();
  return new;
end;
$$;

drop trigger if exists before_update_report on public.reports;
create trigger before_update_report
  before update on public.reports
  for each row execute function public.protect_report_immutable_columns();

alter table public.reports enable row level security;

drop policy if exists "reports_insert_own" on public.reports;
create policy "reports_insert_own" on public.reports
  for insert to authenticated
  with check (reporter_id = auth.uid());

drop policy if exists "reports_select_own_or_moderator" on public.reports;
create policy "reports_select_own_or_moderator" on public.reports
  for select to authenticated
  using (
    reporter_id = auth.uid()
    or (
      server_id is not null
      and (
        exists (select 1 from public.servers where id = server_id and owner_id = auth.uid())
        or public.has_permission(server_id, auth.uid(), 'manage_messages')
      )
    )
  );

drop policy if exists "reports_update_moderator" on public.reports;
create policy "reports_update_moderator" on public.reports
  for update to authenticated
  using (
    server_id is not null
    and (
      exists (select 1 from public.servers where id = server_id and owner_id = auth.uid())
      or public.has_permission(server_id, auth.uid(), 'manage_messages')
    )
  )
  with check (
    server_id is not null
    and (
      exists (select 1 from public.servers where id = server_id and owner_id = auth.uid())
      or public.has_permission(server_id, auth.uid(), 'manage_messages')
    )
  );

revoke all on public.reports from public, anon;
grant select, insert, update on public.reports to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reports'
  ) then
    alter publication supabase_realtime add table public.reports;
  end if;
end $$;
