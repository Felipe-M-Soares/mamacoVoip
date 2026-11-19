-- PARTE 013 (antiga 013_audit_fixes.sql)

create or replace function public.mfa_requirement_met()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not exists (
        select 1 from auth.mfa_factors f
        where f.user_id = auth.uid() and f.status = 'verified'
      );
$$;

create or replace function public.is_timed_out(p_server_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.server_members
    where server_id = p_server_id and user_id = p_user_id
      and timeout_until is not null and timeout_until > now()
  );
$$;

create or replace function public.is_username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_username is not null
     and p_username ~ '^[a-zA-Z0-9_.]{3,32}$'
     and not exists (select 1 from public.profiles where lower(username) = lower(p_username));
$$;

create or replace function public.generate_invite_code()
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  v_raw text;
begin
  v_raw := translate(encode(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()), 'base64'), '+/=', '');
  return substr(v_raw, 1, 10);
end;
$$;

alter function public.is_group_member(uuid, uuid) set search_path = public;
alter function public.handle_updated_at() set search_path = public;
alter function public.handle_message_edited() set search_path = public;
alter function public.protect_group_conversation_owner() set search_path = public;
alter function public.debug_whoami() set search_path = public;

create or replace function public.guard_message_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  new.created_at := now();
  new.edited_at := null;
  new.pinned_at := null;
  new.pinned_by := null;
  if new.system_event is not null then
    raise exception 'Não é permitido criar mensagens de sistema';
  end if;

  if new.reply_to_id is not null and not exists (
    select 1 from public.messages m where m.id = new.reply_to_id and m.channel_id = new.channel_id
  ) then
    new.reply_to_id := null;
  end if;

  if new.thread_id is not null and not exists (
    select 1 from public.threads t where t.id = new.thread_id and t.channel_id = new.channel_id
  ) then
    raise exception 'Thread inválida para este canal';
  end if;

  return new;
end;
$$;

drop trigger if exists on_message_insert_guard on public.messages;
create trigger on_message_insert_guard
  before insert on public.messages
  for each row execute function public.guard_message_insert();

create or replace function public.guard_message_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if new.id is distinct from old.id
    or new.channel_id is distinct from old.channel_id
    or new.server_id is distinct from old.server_id
    or new.author_id is distinct from old.author_id
    or new.created_at is distinct from old.created_at
    or new.system_event is distinct from old.system_event
    or new.thread_id is distinct from old.thread_id
    or (new.reply_to_id is distinct from old.reply_to_id and new.reply_to_id is not null)
  then
    raise exception 'Não é permitido alterar esses campos da mensagem';
  end if;

  if old.author_id is distinct from auth.uid() and new.content is distinct from old.content then
    raise exception 'Só o autor pode editar o conteúdo da mensagem';
  end if;

  if new.pinned_at is distinct from old.pinned_at then
    new.pinned_by := case when new.pinned_at is null then null else auth.uid() end;
  elsif new.pinned_by is distinct from old.pinned_by and new.pinned_by is not null then
    raise exception 'Não é permitido alterar quem fixou a mensagem';
  end if;

  return new;
end;
$$;

drop trigger if exists on_message_update_guard on public.messages;
create trigger on_message_update_guard
  before update on public.messages
  for each row execute function public.guard_message_update();

create or replace function public.protect_message_pin_columns()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_server_id uuid;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.pinned_at is not distinct from old.pinned_at
     and (new.pinned_by is not distinct from old.pinned_by or new.pinned_by is null) then
    return new;
  end if;

  v_server_id := public.channel_server_id(new.channel_id);
  if v_server_id is null or not public.has_permission(v_server_id, auth.uid(), 'manage_messages') then
    raise exception 'Você não tem permissão para fixar/desafixar mensagens';
  end if;
  return new;
end;
$$;

drop policy if exists "messages_pin_update" on public.messages;
create policy "messages_pin_update"
  on public.messages for update to authenticated
  using (public.has_permission(server_id, auth.uid(), 'manage_messages'))
  with check (public.has_permission(server_id, auth.uid(), 'manage_messages'));

create index if not exists messages_author_created_idx on public.messages (author_id, created_at desc);
create index if not exists messages_channel_author_created_idx on public.messages (channel_id, author_id, created_at desc);

create or replace function public.guard_dm_message()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.created_at := now();
    new.edited_at := null;
    if new.reply_to_id is not null and not exists (
      select 1 from public.dm_messages m where m.id = new.reply_to_id and m.conversation_id = new.conversation_id
    ) then
      new.reply_to_id := null;
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
    or new.conversation_id is distinct from old.conversation_id
    or new.author_id is distinct from old.author_id
    or new.created_at is distinct from old.created_at
    or (new.reply_to_id is distinct from old.reply_to_id and new.reply_to_id is not null)
  then
    raise exception 'Não é permitido alterar esses campos da mensagem';
  end if;
  return new;
end;
$$;

drop trigger if exists on_dm_message_guard on public.dm_messages;
create trigger on_dm_message_guard
  before insert or update on public.dm_messages
  for each row execute function public.guard_dm_message();

create or replace function public.guard_group_message()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.created_at := now();
    new.edited_at := null;
    if new.reply_to_id is not null and not exists (
      select 1 from public.group_messages m where m.id = new.reply_to_id and m.group_id = new.group_id
    ) then
      new.reply_to_id := null;
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
    or new.group_id is distinct from old.group_id
    or new.author_id is distinct from old.author_id
    or new.created_at is distinct from old.created_at
    or (new.reply_to_id is distinct from old.reply_to_id and new.reply_to_id is not null)
  then
    raise exception 'Não é permitido alterar esses campos da mensagem';
  end if;
  return new;
end;
$$;

drop trigger if exists on_group_message_guard on public.group_messages;
create trigger on_group_message_guard
  before insert or update on public.group_messages
  for each row execute function public.guard_group_message();

drop trigger if exists on_group_message_edited on public.group_messages;
create trigger on_group_message_edited
  before update on public.group_messages
  for each row execute function public.handle_message_edited();

create or replace function public.check_group_message_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  select count(*) into v_count
  from public.group_messages
  where author_id = new.author_id
    and created_at > now() - interval '10 seconds';

  if v_count >= 8 then
    raise exception 'Você está enviando mensagens rápido demais. Aguarde um instante.';
  end if;
  return new;
end;
$$;

drop trigger if exists on_group_message_rate_limit on public.group_messages;
create trigger on_group_message_rate_limit
  before insert on public.group_messages
  for each row execute function public.check_group_message_rate_limit();

drop policy if exists "group_messages_update" on public.group_messages;
create policy "group_messages_update"
  on public.group_messages for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid() and public.is_group_member(group_id, auth.uid()));

create index if not exists dm_messages_author_created_idx on public.dm_messages (author_id, created_at desc);
create index if not exists group_messages_author_created_idx on public.group_messages (author_id, created_at desc);

drop policy if exists "group_members_insert" on public.group_conversation_members;
create policy "group_members_insert"
  on public.group_conversation_members for insert to authenticated
  with check (
    exists (select 1 from public.group_conversations g where g.id = group_id and g.created_by = auth.uid())
    and (
      user_id = auth.uid()
      or not exists (
        select 1 from public.blocked_users b
        where (b.blocker_id = auth.uid() and b.blocked_id = user_id)
           or (b.blocker_id = user_id and b.blocked_id = auth.uid())
      )
    )
  );

drop policy if exists "group_conversations_select" on public.group_conversations;
create policy "group_conversations_select"
  on public.group_conversations for select to authenticated
  using (created_by = auth.uid() or public.is_group_member(id, auth.uid()));

drop policy if exists "group_conversations_update" on public.group_conversations;
create policy "group_conversations_update"
  on public.group_conversations for update to authenticated
  using (public.is_group_member(id, auth.uid()))
  with check (public.is_group_member(id, auth.uid()));

drop policy if exists "group_conversations_delete" on public.group_conversations;
create policy "group_conversations_delete"
  on public.group_conversations for delete to authenticated
  using (created_by = auth.uid());

create index if not exists group_conversation_members_user_idx on public.group_conversation_members (user_id);

create or replace function public.assert_role_input(
  p_server_id uuid,
  p_name text,
  p_color text,
  p_permissions text[],
  p_existing text[] default '{}'
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_perm text;
begin
  if p_name is null or char_length(trim(p_name)) not between 1 and 100 then
    raise exception 'O nome do cargo precisa ter de 1 a 100 caracteres';
  end if;
  if p_color is null or p_color !~ '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$' then
    raise exception 'Cor inválida';
  end if;
  if p_permissions is null then
    return;
  end if;
  if not (p_permissions <@ public.valid_permissions()) then
    raise exception 'Permissão desconhecida';
  end if;
  if not exists (select 1 from public.servers where id = p_server_id and owner_id = auth.uid()) then
    foreach v_perm in array p_permissions loop
      if not (v_perm = any(coalesce(p_existing, '{}'))) and not public.has_permission(p_server_id, auth.uid(), v_perm) then
        raise exception 'Você não pode conceder uma permissão que você mesmo não tem (%)', v_perm;
      end if;
    end loop;
  end if;
end;
$$;

create or replace function public.create_role(p_server_id uuid, p_name text, p_color text, p_permissions text[])
returns public.roles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_position int;
  v_top int;
  v_role public.roles;
begin
  if not public.mfa_requirement_met() then
    raise exception 'Confirme a verificação em duas etapas primeiro';
  end if;
  if not public.has_permission(p_server_id, auth.uid(), 'manage_roles') then
    raise exception 'Você não tem permissão para gerenciar cargos';
  end if;
  perform public.assert_role_input(p_server_id, p_name, p_color, coalesce(p_permissions, '{}'));

  if (select count(*) from public.roles where server_id = p_server_id) >= 250 then
    raise exception 'Limite de cargos do servidor atingido';
  end if;

  if exists (select 1 from public.servers where id = p_server_id and owner_id = auth.uid()) then
    select coalesce(max(position), 0) + 1 into v_position from public.roles where server_id = p_server_id;
  else
    v_top := public.top_role_position(p_server_id, auth.uid());
    update public.roles set position = position + 1 where server_id = p_server_id and position >= v_top;
    v_position := greatest(v_top, 0);
  end if;

  insert into public.roles (server_id, name, color, position, permissions)
  values (p_server_id, trim(p_name), p_color, v_position, coalesce(p_permissions, '{}'))
  returning * into v_role;

  insert into public.moderation_logs (server_id, actor_id, action, metadata)
  values (p_server_id, auth.uid(), 'role_created', jsonb_build_object('role_id', v_role.id, 'name', v_role.name));

  return v_role;
end;
$$;

create or replace function public.update_role(p_role_id uuid, p_name text, p_color text, p_permissions text[])
returns public.roles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.roles;
  v_role public.roles;
begin
  if not public.mfa_requirement_met() then
    raise exception 'Confirme a verificação em duas etapas primeiro';
  end if;
  select * into v_old from public.roles where id = p_role_id;
  if v_old.id is null then
    raise exception 'Cargo não encontrado';
  end if;
  if not public.has_permission(v_old.server_id, auth.uid(), 'manage_roles') then
    raise exception 'Você não tem permissão para gerenciar cargos';
  end if;
  if v_old.position >= public.top_role_position(v_old.server_id, auth.uid()) then
    raise exception 'Você não pode editar um cargo igual ou acima do seu próprio nível';
  end if;
  perform public.assert_role_input(v_old.server_id, p_name, p_color, coalesce(p_permissions, '{}'), v_old.permissions);

  update public.roles set name = trim(p_name), color = p_color, permissions = coalesce(p_permissions, '{}')
    where id = p_role_id
    returning * into v_role;

  return v_role;
end;
$$;

create or replace function public.delete_role(p_role_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_server_id uuid;
  v_name text;
  v_position int;
begin
  if not public.mfa_requirement_met() then
    raise exception 'Confirme a verificação em duas etapas primeiro';
  end if;
  select server_id, name, position into v_server_id, v_name, v_position from public.roles where id = p_role_id;
  if v_server_id is null then
    return;
  end if;
  if not public.has_permission(v_server_id, auth.uid(), 'manage_roles') then
    raise exception 'Você não tem permissão para gerenciar cargos';
  end if;
  if v_position >= public.top_role_position(v_server_id, auth.uid()) then
    raise exception 'Você não pode excluir um cargo igual ou acima do seu próprio nível';
  end if;

  delete from public.roles where id = p_role_id;

  insert into public.moderation_logs (server_id, actor_id, action, metadata)
  values (v_server_id, auth.uid(), 'role_deleted', jsonb_build_object('role_id', p_role_id, 'name', v_name));
end;
$$;

create or replace function public.assign_role(p_server_id uuid, p_user_id uuid, p_role_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role_position int;
begin
  if not public.mfa_requirement_met() then
    raise exception 'Confirme a verificação em duas etapas primeiro';
  end if;
  if not public.has_permission(p_server_id, auth.uid(), 'manage_roles') then
    raise exception 'Você não tem permissão para gerenciar cargos';
  end if;

  select position into v_role_position from public.roles where id = p_role_id and server_id = p_server_id;
  if v_role_position is null then
    raise exception 'Cargo não encontrado';
  end if;
  if v_role_position >= public.top_role_position(p_server_id, auth.uid()) then
    raise exception 'Você não pode atribuir um cargo igual ou acima do seu próprio nível';
  end if;
  if not public.is_server_member(p_server_id, p_user_id) then
    raise exception 'Essa pessoa não é membro do servidor';
  end if;

  insert into public.server_member_roles (server_id, user_id, role_id)
  values (p_server_id, p_user_id, p_role_id)
  on conflict do nothing;

  insert into public.moderation_logs (server_id, actor_id, action, target_user_id, metadata)
  values (p_server_id, auth.uid(), 'role_assigned', p_user_id, jsonb_build_object('role_id', p_role_id));
end;
$$;

create or replace function public.remove_role(p_server_id uuid, p_user_id uuid, p_role_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role_position int;
begin
  if not public.mfa_requirement_met() then
    raise exception 'Confirme a verificação em duas etapas primeiro';
  end if;
  if not public.has_permission(p_server_id, auth.uid(), 'manage_roles') then
    raise exception 'Você não tem permissão para gerenciar cargos';
  end if;

  select position into v_role_position from public.roles where id = p_role_id and server_id = p_server_id;
  if v_role_position is null then
    raise exception 'Cargo não encontrado';
  end if;
  if v_role_position >= public.top_role_position(p_server_id, auth.uid()) then
    raise exception 'Você não pode remover um cargo igual ou acima do seu próprio nível';
  end if;

  delete from public.server_member_roles
    where server_id = p_server_id and user_id = p_user_id and role_id = p_role_id;

  insert into public.moderation_logs (server_id, actor_id, action, target_user_id, metadata)
  values (p_server_id, auth.uid(), 'role_removed', p_user_id, jsonb_build_object('role_id', p_role_id));
end;
$$;

create or replace function public.kick_member(p_server_id uuid, p_user_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.mfa_requirement_met() then
    raise exception 'Confirme a verificação em duas etapas primeiro';
  end if;
  if not public.has_permission(p_server_id, auth.uid(), 'kick_members') then
    raise exception 'Você não tem permissão para expulsar membros';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Use "sair do servidor" para sair';
  end if;
  if exists (select 1 from public.servers where id = p_server_id and owner_id = p_user_id) then
    raise exception 'O dono do servidor não pode ser expulso';
  end if;
  if public.top_role_position(p_server_id, p_user_id) >= public.top_role_position(p_server_id, auth.uid()) then
    raise exception 'Você não pode expulsar alguém com cargo igual ou superior ao seu';
  end if;

  delete from public.server_members where server_id = p_server_id and user_id = p_user_id;

  insert into public.moderation_logs (server_id, actor_id, action, target_user_id, reason)
  values (p_server_id, auth.uid(), 'kick', p_user_id, left(nullif(trim(p_reason), ''), 500));
end;
$$;

create or replace function public.ban_member(p_server_id uuid, p_user_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := left(nullif(trim(p_reason), ''), 500);
begin
  if not public.mfa_requirement_met() then
    raise exception 'Confirme a verificação em duas etapas primeiro';
  end if;
  if not public.has_permission(p_server_id, auth.uid(), 'ban_members') then
    raise exception 'Você não tem permissão para banir membros';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Você não pode banir a si mesmo';
  end if;
  if exists (select 1 from public.servers where id = p_server_id and owner_id = p_user_id) then
    raise exception 'O dono do servidor não pode ser banido';
  end if;
  if public.top_role_position(p_server_id, p_user_id) >= public.top_role_position(p_server_id, auth.uid()) then
    raise exception 'Você não pode banir alguém com cargo igual ou superior ao seu';
  end if;

  insert into public.bans (server_id, user_id, banned_by, reason)
  values (p_server_id, p_user_id, auth.uid(), v_reason)
  on conflict (server_id, user_id) do update set reason = excluded.reason, banned_by = excluded.banned_by;

  delete from public.server_members where server_id = p_server_id and user_id = p_user_id;

  insert into public.moderation_logs (server_id, actor_id, action, target_user_id, reason)
  values (p_server_id, auth.uid(), 'ban', p_user_id, v_reason);
end;
$$;

create or replace function public.unban_member(p_server_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.mfa_requirement_met() then
    raise exception 'Confirme a verificação em duas etapas primeiro';
  end if;
  if not public.has_permission(p_server_id, auth.uid(), 'ban_members') then
    raise exception 'Você não tem permissão para banir membros';
  end if;

  delete from public.bans where server_id = p_server_id and user_id = p_user_id;

  insert into public.moderation_logs (server_id, actor_id, action, target_user_id)
  values (p_server_id, auth.uid(), 'unban', p_user_id);
end;
$$;

create or replace function public.timeout_member(p_server_id uuid, p_user_id uuid, p_minutes int, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.mfa_requirement_met() then
    raise exception 'Confirme a verificação em duas etapas primeiro';
  end if;
  if not public.has_permission(p_server_id, auth.uid(), 'timeout_members') then
    raise exception 'Você não tem permissão para silenciar membros';
  end if;
  if p_minutes is null or p_minutes < 1 or p_minutes > 40320 then
    raise exception 'Duração inválida (de 1 minuto a 28 dias)';
  end if;
  if exists (select 1 from public.servers where id = p_server_id and owner_id = p_user_id) then
    raise exception 'O dono do servidor não pode ser silenciado';
  end if;
  if public.top_role_position(p_server_id, p_user_id) >= public.top_role_position(p_server_id, auth.uid()) then
    raise exception 'Você não pode silenciar alguém com cargo igual ou superior ao seu';
  end if;
  if not public.is_server_member(p_server_id, p_user_id) then
    raise exception 'Essa pessoa não é membro do servidor';
  end if;

  update public.server_members
    set timeout_until = now() + make_interval(mins => p_minutes)
    where server_id = p_server_id and user_id = p_user_id;

  insert into public.moderation_logs (server_id, actor_id, action, target_user_id, reason, metadata)
  values (p_server_id, auth.uid(), 'timeout', p_user_id, left(nullif(trim(p_reason), ''), 500),
          jsonb_build_object('minutes', p_minutes));
end;
$$;

create or replace function public.remove_timeout(p_server_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.mfa_requirement_met() then
    raise exception 'Confirme a verificação em duas etapas primeiro';
  end if;
  if not public.has_permission(p_server_id, auth.uid(), 'timeout_members') then
    raise exception 'Você não tem permissão para silenciar membros';
  end if;
  if p_user_id <> auth.uid()
     and public.top_role_position(p_server_id, p_user_id) >= public.top_role_position(p_server_id, auth.uid()) then
    raise exception 'Você não pode mexer no silenciamento de alguém com cargo igual ou superior ao seu';
  end if;

  update public.server_members set timeout_until = null
    where server_id = p_server_id and user_id = p_user_id;

  insert into public.moderation_logs (server_id, actor_id, action, target_user_id)
  values (p_server_id, auth.uid(), 'remove_timeout', p_user_id);
end;
$$;

create index if not exists server_member_roles_role_idx on public.server_member_roles (role_id);
create index if not exists channel_role_access_role_idx on public.channel_role_access (role_id);

-- parte 016, item 7.

create index if not exists server_invites_created_by_idx on public.server_invites (created_by);

create or replace function public.guard_profile_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  new.id := old.id;
  new.created_at := old.created_at;

  if new.username is distinct from old.username then
    if new.username !~ '^[a-zA-Z0-9_.]{3,32}$' or lower(new.username) in ('everyone', 'here') then
      raise exception 'Nome de usuário inválido (3 a 32 letras, números, ponto ou underline)';
    end if;
    if exists (select 1 from public.profiles where lower(username) = lower(new.username) and id <> new.id) then
      raise exception 'Esse nome de usuário já está em uso';
    end if;
  end if;

  if new.display_name is distinct from old.display_name and char_length(coalesce(new.display_name, '')) > 32 then
    raise exception 'O nome de exibição pode ter no máximo 32 caracteres';
  end if;
  if new.custom_status is distinct from old.custom_status and char_length(coalesce(new.custom_status, '')) > 128 then
    raise exception 'O status personalizado pode ter no máximo 128 caracteres';
  end if;
  if new.playing is distinct from old.playing and char_length(coalesce(new.playing, '')) > 128 then
    raise exception 'O texto de "jogando" pode ter no máximo 128 caracteres';
  end if;

  if new.avatar_url is distinct from old.avatar_url and new.avatar_url is not null
     and not public.is_trusted_storage_url(new.avatar_url, 'avatars', new.id::text) then
    raise exception 'URL de avatar inválida';
  end if;
  if new.banner_url is distinct from old.banner_url and new.banner_url is not null
     and not public.is_trusted_storage_url(new.banner_url, 'profile-banners', new.id::text) then
    raise exception 'URL de banner inválida';
  end if;
  if new.avatar_decoration_url is distinct from old.avatar_decoration_url and new.avatar_decoration_url is not null
     and not public.is_trusted_storage_url(new.avatar_decoration_url, 'avatar-decorations', new.id::text) then
    raise exception 'URL de decoração inválida';
  end if;

  return new;
end;
$$;

alter table public.profiles add column if not exists banner_url text;
alter table public.profiles add column if not exists avatar_decoration_url text;

drop trigger if exists on_profile_update_guard on public.profiles;
create trigger on_profile_update_guard
  before update on public.profiles
  for each row execute function public.guard_profile_update();

do $$
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'profiles_username_lower_unique') then
    begin
      create unique index profiles_username_lower_unique on public.profiles (lower(username));
    exception when unique_violation then
      raise notice 'Existem usernames repetidos ignorando maiúsculas — índice único não criado. Resolva as duplicatas e rode de novo.';
    end;
  end if;
end $$;

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
  v_base := regexp_replace(coalesce(v_base, ''), '[^a-zA-Z0-9_.]', '', 'g');
  v_base := left(v_base, 26);
  if char_length(v_base) < 3 or lower(v_base) in ('everyone', 'here') then
    v_base := 'usuario' || v_base;
  end if;

  v_username := v_base;
  while exists (select 1 from public.profiles where lower(username) = lower(v_username)) loop
    v_suffix := v_suffix + 1;
    v_username := v_base || v_suffix::text;
  end loop;

  v_display_name := left(coalesce(
    nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
    nullif(trim(new.raw_user_meta_data->>'name'), ''),
    v_base
  ), 32);

  insert into public.profiles (id, username, display_name)
  values (new.id, v_username, v_display_name);

  return new;
end;
$$;

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('message_attachments', 'message_attachments_sane', 'file_size >= 0 and char_length(file_name) <= 255 and char_length(mime_type) <= 255'),
      ('dm_message_attachments', 'dm_message_attachments_sane', 'file_size >= 0 and char_length(file_name) <= 255 and char_length(mime_type) <= 255'),
      ('group_message_attachments', 'group_message_attachments_sane', 'file_size >= 0 and char_length(file_name) <= 255 and char_length(mime_type) <= 255'),
      ('server_emojis', 'server_emojis_image_url_http', 'image_url ~* ''^https?://'''),
      ('server_emojis', 'server_emojis_name_format', 'name ~ ''^[a-zA-Z0-9_]{2,32}$'''),
      ('servers', 'servers_icon_url_http', 'icon_url is null or icon_url ~* ''^https?://'''),
      ('servers', 'servers_banner_url_http', 'banner_url is null or banner_url ~* ''^https?://'''),
      ('servers', 'servers_afk_timeout_range', 'afk_timeout_minutes between 1 and 1440'),
      ('group_conversations', 'group_conversations_icon_url_http', 'icon_url is null or icon_url ~* ''^https?://'''),
      ('group_conversations', 'group_conversations_name_length', 'name is null or char_length(name) <= 100'),
      ('channels', 'channels_slowmode_range', 'slowmode_seconds between 0 and 21600'),
      ('channels', 'channels_user_limit_range', 'user_limit between 0 and 99'),
      ('channels', 'channels_topic_length', 'topic is null or char_length(topic) <= 1024'),
      ('server_members', 'server_members_nickname_length', 'nickname is null or char_length(nickname) <= 32'),
      ('roles', 'roles_color_hex', 'color ~ ''^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$'''),
      ('threads', 'threads_name_length', 'char_length(name) between 1 and 100'),
      ('server_events', 'server_events_text_length', 'char_length(name) between 1 and 100 and (description is null or char_length(description) <= 1000)'),
      ('server_events', 'server_events_dates', 'ends_at is null or ends_at >= starts_at'),
      ('reports', 'reports_text_length', 'char_length(reason) between 1 and 100 and (details is null or char_length(details) <= 1000)'),
      ('friendships', 'friendships_note_length', 'request_note is null or char_length(request_note) <= 200'),
      ('bans', 'bans_reason_length', 'reason is null or char_length(reason) <= 500')
    ) as t(tbl, con, expr)
  loop
    if not exists (
      select 1 from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace n on n.oid = cl.relnamespace
      where n.nspname = 'public' and cl.relname = r.tbl and c.conname = r.con
    ) then
      execute format('alter table public.%I add constraint %I check (%s) not valid', r.tbl, r.con, r.expr);
    end if;
  end loop;
end $$;

drop policy if exists "Membros removem os próprios anexos" on storage.objects;
create policy "Membros removem os próprios anexos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'attachments'
    and (
      owner = auth.uid()
      or public.has_permission((storage.foldername(name))[1]::uuid, auth.uid(), 'manage_messages')
    )
  );

drop policy if exists "dm_attachments_delete_own" on storage.objects;
create policy "dm_attachments_delete_own"
  on storage.objects for delete to authenticated
  using (bucket_id = 'dm-attachments' and owner = auth.uid());

drop policy if exists "group_attachments_delete_own" on storage.objects;
create policy "group_attachments_delete_own"
  on storage.objects for delete to authenticated
  using (bucket_id = 'group-attachments' and owner = auth.uid());

drop policy if exists "soundboard_objects_insert" on storage.objects;
create policy "soundboard_objects_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'soundboard'
    and public.is_server_member((storage.foldername(name))[1]::uuid, auth.uid())
    and not public.is_timed_out((storage.foldername(name))[1]::uuid, auth.uid())
  );

drop policy if exists "soundboard_objects_delete" on storage.objects;
create policy "soundboard_objects_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'soundboard'
    and (
      owner = auth.uid()
      or public.has_permission((storage.foldername(name))[1]::uuid, auth.uid(), 'manage_messages')
    )
  );

drop policy if exists "soundboard_sounds_insert" on public.soundboard_sounds;
create policy "soundboard_sounds_insert"
  on public.soundboard_sounds for insert to authenticated
  with check (
    public.is_server_member(server_id, auth.uid())
    and uploaded_by = auth.uid()
    and not public.is_timed_out(server_id, auth.uid())
    and storage_path like server_id::text || '/%'
  );

drop policy if exists "server_event_rsvps_insert" on public.server_event_rsvps;
create policy "server_event_rsvps_insert"
  on public.server_event_rsvps for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.server_events e
      where e.id = event_id and public.is_server_member(e.server_id, auth.uid())
    )
  );

drop policy if exists "server_events_insert" on public.server_events;
create policy "server_events_insert"
  on public.server_events for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.has_permission(server_id, auth.uid(), 'manage_channels')
    and (channel_id is null or public.channel_server_id(channel_id) = server_id)
  );

create or replace function public.limit_reports()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_server_id uuid;
  v_channel_id uuid;
begin
  if (select count(*) from public.reports
      where reporter_id = auth.uid() and created_at > now() - interval '10 minutes') >= 10 then
    raise exception 'Você enviou muitas denúncias em pouco tempo. Aguarde alguns minutos.';
  end if;

  if new.target_type = 'message' and new.message_id is not null then
    select server_id, channel_id into v_server_id, v_channel_id from public.messages where id = new.message_id;
    if v_server_id is null
       or not public.is_server_member(v_server_id, auth.uid())
       or not public.can_view_channel(v_channel_id) then
      raise exception 'mensagem não encontrada';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists a_limit_reports on public.reports;
create trigger a_limit_reports
  before insert on public.reports
  for each row execute function public.limit_reports();

create index if not exists reports_message_idx on public.reports (message_id) where message_id is not null;
create index if not exists reports_reported_user_idx on public.reports (reported_user_id);

create or replace function public.guard_server_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  new.id := old.id;
  new.created_at := old.created_at;
  if new.owner_id is distinct from old.owner_id then
    raise exception 'A transferência de dono não é permitida por aqui';
  end if;
  if new.afk_channel_id is distinct from old.afk_channel_id and new.afk_channel_id is not null
     and not exists (
       select 1 from public.channels c
       where c.id = new.afk_channel_id and c.server_id = new.id and c.type = 'voice'
     ) then
    raise exception 'Canal AFK inválido';
  end if;
  if new.icon_url is distinct from old.icon_url and new.icon_url is not null
     and not public.is_trusted_storage_url(new.icon_url, 'server-icons', new.id::text) then
    raise exception 'URL de ícone inválida';
  end if;
  if new.banner_url is distinct from old.banner_url and new.banner_url is not null
     and not public.is_trusted_storage_url(new.banner_url, 'server-icons', new.id::text) then
    raise exception 'URL de banner inválida';
  end if;
  return new;
end;
$$;

drop trigger if exists on_server_update_guard on public.servers;
create trigger on_server_update_guard
  before update on public.servers
  for each row execute function public.guard_server_update();

create or replace function public.guard_channel_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.server_id is distinct from old.server_id then
    raise exception 'Não é permitido mover para outro servidor';
  end if;
  if tg_table_name = 'channels' then
    if new.category_id is not null and new.category_id is distinct from old.category_id
       and not exists (select 1 from public.categories c where c.id = new.category_id and c.server_id = new.server_id) then
      raise exception 'Categoria inválida';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists on_channel_update_guard on public.channels;
create trigger on_channel_update_guard
  before update on public.channels
  for each row execute function public.guard_channel_update();

drop trigger if exists on_category_update_guard on public.categories;
create trigger on_category_update_guard
  before update on public.categories
  for each row execute function public.guard_channel_update();

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  if not public.mfa_requirement_met() then
    raise exception 'Confirme a verificação em duas etapas antes de excluir a conta';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.prorettype = 'trigger'::regtype as is_trigger
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    if not r.is_trigger then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end $$;

grant execute on function public.is_username_available(text) to anon, authenticated;

alter default privileges in schema public revoke execute on functions from public, anon;

create index if not exists messages_server_idx on public.messages (server_id);
create index if not exists messages_reply_to_idx on public.messages (reply_to_id) where reply_to_id is not null;
create index if not exists message_reactions_user_idx on public.message_reactions (user_id);
create index if not exists dm_messages_reply_to_idx on public.dm_messages (reply_to_id) where reply_to_id is not null;
create index if not exists dm_message_attachments_message_idx on public.dm_message_attachments (message_id);
create index if not exists group_messages_reply_to_idx on public.group_messages (reply_to_id) where reply_to_id is not null;
create index if not exists group_message_attachments_message_idx on public.group_message_attachments (message_id);
create index if not exists blocked_users_blocked_idx on public.blocked_users (blocked_id);
create index if not exists bans_user_idx on public.bans (user_id);
create index if not exists moderation_logs_target_idx on public.moderation_logs (target_user_id) where target_user_id is not null;
create index if not exists moderation_logs_actor_idx on public.moderation_logs (actor_id);
create index if not exists channel_read_state_user_idx on public.channel_read_state (user_id);
create index if not exists dm_read_state_user_idx on public.dm_read_state (user_id);
create index if not exists channel_mutes_channel_idx on public.channel_mutes (channel_id);
create index if not exists threads_channel_idx on public.threads (channel_id);
create index if not exists threads_server_idx on public.threads (server_id);
create index if not exists server_events_server_starts_idx on public.server_events (server_id, starts_at);
create index if not exists server_events_channel_idx on public.server_events (channel_id) where channel_id is not null;
create index if not exists server_event_rsvps_user_idx on public.server_event_rsvps (user_id);
create index if not exists servers_owner_idx on public.servers (owner_id);
create index if not exists servers_afk_channel_idx on public.servers (afk_channel_id) where afk_channel_id is not null;
create index if not exists group_conversations_created_by_idx on public.group_conversations (created_by);
create index if not exists soundboard_sounds_uploaded_by_idx on public.soundboard_sounds (uploaded_by);
create index if not exists friendships_created_idx on public.friendships (user_id, created_at desc);
create index if not exists reports_reporter_created_idx on public.reports (reporter_id, created_at desc);

-- PARTE 014 (antiga 014_move_members.sql)

create or replace function public.valid_permissions()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['administrator','manage_server','manage_roles','manage_channels','manage_messages',
               'kick_members','ban_members','timeout_members','view_audit_log','move_members']::text[];
$$;

do $$
declare
  r record;
begin
  for r in
    select conname from pg_constraint
    where contype = 'c' and conrelid = 'public.moderation_logs'::regclass
      and pg_get_constraintdef(oid) ilike '%action%'
  loop
    execute format('alter table public.moderation_logs drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.moderation_logs add constraint moderation_logs_action_check check (
  action in (
    'kick', 'ban', 'unban', 'timeout', 'remove_timeout',
    'role_created', 'role_deleted', 'role_assigned', 'role_removed',
    'message_deleted', 'member_moved'
  )
);

create table if not exists public.voice_move_requests (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers(id) on delete cascade,
  target_user_id uuid not null references auth.users(id) on delete cascade,
  to_channel_id uuid not null references public.channels(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists voice_move_requests_target_idx on public.voice_move_requests (target_user_id);
create index if not exists voice_move_requests_created_idx on public.voice_move_requests (created_at);
create index if not exists voice_move_requests_requester_idx on public.voice_move_requests (requested_by, created_at);
create index if not exists voice_move_requests_server_idx on public.voice_move_requests (server_id);
create index if not exists voice_move_requests_channel_idx on public.voice_move_requests (to_channel_id);

alter table public.voice_move_requests enable row level security;

drop policy if exists "Alvo vê os próprios pedidos de mover" on public.voice_move_requests;
create policy "Alvo vê os próprios pedidos de mover"
  on public.voice_move_requests for select to authenticated
  using (target_user_id = (select auth.uid()));

drop policy if exists "Exige 2FA quando ativado" on public.voice_move_requests;
create policy "Exige 2FA quando ativado"
  on public.voice_move_requests as restrictive for all to authenticated
  using ((select public.mfa_requirement_met())) with check ((select public.mfa_requirement_met()));

revoke all on table public.voice_move_requests from public, anon, authenticated;
grant select on table public.voice_move_requests to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'voice_move_requests'
  ) then
    alter publication supabase_realtime add table public.voice_move_requests;
  end if;
end $$;

create or replace function public.move_voice_member(p_server_id uuid, p_user_id uuid, p_to_channel_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_channel public.channels;
  v_id uuid;
begin
  if v_caller is null then
    raise exception 'Faça login primeiro';
  end if;
  if not public.mfa_requirement_met() then
    raise exception 'Confirme a verificação em duas etapas primeiro';
  end if;
  if p_server_id is null or p_user_id is null or p_to_channel_id is null then
    raise exception 'Dados incompletos para mover o membro';
  end if;

  if not public.has_permission(p_server_id, v_caller, 'move_members') then
    raise exception 'Você não tem permissão para mover membros';
  end if;

  if not exists (select 1 from public.server_members where server_id = p_server_id and user_id = p_user_id)
     and not exists (select 1 from public.servers where id = p_server_id and owner_id = p_user_id) then
    raise exception 'Essa pessoa não é membro do servidor';
  end if;

  if p_user_id <> v_caller
     and public.top_role_position(p_server_id, p_user_id) >= public.top_role_position(p_server_id, v_caller) then
    raise exception 'Você não pode mover alguém com cargo igual ou superior ao seu';
  end if;

  select * into v_channel from public.channels where id = p_to_channel_id;
  if v_channel.id is null or v_channel.server_id <> p_server_id then
    raise exception 'Canal de destino não encontrado neste servidor';
  end if;
  if v_channel.type <> 'voice' then
    raise exception 'O canal de destino precisa ser um canal de voz';
  end if;

  if v_channel.is_restricted
     and not exists (select 1 from public.servers where id = p_server_id and owner_id = p_user_id)
     and not public.has_permission(p_server_id, p_user_id, 'manage_channels')
     and not public.user_has_channel_role_access(v_channel.id, p_user_id) then
    raise exception 'Essa pessoa não tem acesso ao canal de destino';
  end if;

  if (
    select count(*) from public.voice_move_requests
    where requested_by = v_caller and created_at > now() - interval '1 minute'
  ) >= 30 then
    raise exception 'Muitas movimentações seguidas — espere um pouco e tente de novo';
  end if;

  delete from public.voice_move_requests where created_at < now() - interval '1 day';

  insert into public.voice_move_requests (server_id, target_user_id, to_channel_id, requested_by)
  values (p_server_id, p_user_id, p_to_channel_id, v_caller)
  returning id into v_id;

  insert into public.moderation_logs (server_id, actor_id, action, target_user_id, metadata)
  values (
    p_server_id, v_caller, 'member_moved', p_user_id,
    jsonb_build_object('to_channel_id', v_channel.id, 'to_channel_name', v_channel.name)
  );

  return v_id;
end;
$$;

revoke execute on function public.move_voice_member(uuid, uuid, uuid) from public, anon;
grant execute on function public.move_voice_member(uuid, uuid, uuid) to authenticated;
revoke execute on function public.valid_permissions() from public, anon;
grant execute on function public.valid_permissions() to authenticated;

-- PARTE 015 (antiga 015_nsfw_channels.sql)

alter table public.channels add column if not exists is_nsfw boolean not null default false;

comment on column public.channels.is_nsfw is
  'Canal com restrição de idade (+18): conteúdo só aparece pra quem confirmou ser maior de idade; o seletor de GIF usa rating "r".';

alter table public.profiles add column if not exists age_verified_adult_at timestamptz;

comment on column public.profiles.age_verified_adult_at is
  'Quando a pessoa confirmou ter 18 anos ou mais (autodeclaração). null = não confirmou / revogou.';

create or replace function public.stamp_profile_age_verification()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.age_verified_adult_at is not null then
      new.age_verified_adult_at := now();
    end if;
    return new;
  end if;
  if new.age_verified_adult_at is distinct from old.age_verified_adult_at
     and new.age_verified_adult_at is not null then
    new.age_verified_adult_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists on_profile_age_verification_stamp on public.profiles;
create trigger on_profile_age_verification_stamp
  before insert or update of age_verified_adult_at on public.profiles
  for each row execute function public.stamp_profile_age_verification();

notify pgrst, 'reload schema';

-- PARTE 016 (antiga 016_security_hardening_2.sql)

create table if not exists public.user_private_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  age_verified_adult_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.user_private_settings is
  'Configurações privadas da conta (RLS: só o próprio usuário). Ex.: confirmação de idade +18.';
comment on column public.user_private_settings.age_verified_adult_at is
  'Quando a pessoa confirmou ter 18 anos ou mais (autodeclaração; hora do servidor). null = não confirmou / revogou.';

alter table public.user_private_settings enable row level security;

drop policy if exists "Dono vê as próprias configurações privadas" on public.user_private_settings;
create policy "Dono vê as próprias configurações privadas"
  on public.user_private_settings for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Dono cria as próprias configurações privadas" on public.user_private_settings;
create policy "Dono cria as próprias configurações privadas"
  on public.user_private_settings for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "Dono altera as próprias configurações privadas" on public.user_private_settings;
create policy "Dono altera as próprias configurações privadas"
  on public.user_private_settings for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "Dono apaga as próprias configurações privadas" on public.user_private_settings;
create policy "Dono apaga as próprias configurações privadas"
  on public.user_private_settings for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on table public.user_private_settings from public, anon, authenticated;
grant select, insert, update, delete on table public.user_private_settings to authenticated;

drop trigger if exists on_private_settings_age_verification_stamp on public.user_private_settings;
create trigger on_private_settings_age_verification_stamp
  before insert or update of age_verified_adult_at on public.user_private_settings
  for each row execute function public.stamp_profile_age_verification();

drop trigger if exists on_private_settings_updated_at on public.user_private_settings;
create trigger on_private_settings_updated_at
  before update on public.user_private_settings
  for each row execute function public.handle_updated_at();

create or replace function public.can_view_channel(p_channel_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.channels c
    where c.id = p_channel_id
      and public.is_server_member(c.server_id, auth.uid())
      and (
        not c.is_restricted
        or public.has_permission(c.server_id, auth.uid(), 'manage_channels')
        or public.user_has_channel_role_access(c.id, auth.uid())
      )
  );
$$;

create or replace function public.is_age_verified_adult()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_private_settings
    where user_id = auth.uid() and age_verified_adult_at is not null
  );
$$;

create or replace function public.can_read_channel_content(p_channel_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_view_channel(p_channel_id)
     and (
       not coalesce((select c.is_nsfw from public.channels c where c.id = p_channel_id), false)
       or public.is_age_verified_adult()
     );
$$;

create or replace function public.can_access_voice_room(p_room uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
      select 1 from public.channels c
      where c.id = p_room and c.type = 'voice' and public.can_view_channel(c.id)
    )
    or public.is_group_member(p_room, auth.uid())
    or exists (
      select 1 from public.dm_conversations d
      where d.id = p_room and auth.uid() in (d.user_a, d.user_b)
    );
$$;

create or replace function public.can_access_typing_topic(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_read_channel_content(p_id)
    or exists (
      select 1 from public.threads t
      where t.id = p_id and public.can_read_channel_content(t.channel_id)
    )
    or public.is_group_member(p_id, auth.uid())
    or exists (
      select 1 from public.dm_conversations d
      where d.id = p_id
        and auth.uid() in (d.user_a, d.user_b)
        and not exists (
          select 1 from public.blocked_users b
          where (b.blocker_id = d.user_a and b.blocked_id = d.user_b)
             or (b.blocker_id = d.user_b and b.blocked_id = d.user_a)
        )
    );
$$;

create or replace function public.realtime_topic_allowed(p_topic text, p_extension text, p_write boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_kind text;
  v_id uuid;
begin
  if auth.uid() is null or not public.mfa_requirement_met() then
    return false;
  end if;
  if p_extension is null or p_extension not in ('broadcast', 'presence') then
    return false;
  end if;

  if p_topic = 'presence:online' then
    return not p_write or p_extension = 'presence';
  end if;

  if p_topic is null
     or p_topic !~ '^(voice|typing):[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return false;
  end if;
  v_kind := split_part(p_topic, ':', 1);
  v_id := split_part(p_topic, ':', 2)::uuid;

  if v_kind = 'voice' then
    return (not p_write or p_extension = 'presence') and public.can_access_voice_room(v_id);
  end if;
  if v_kind = 'typing' then
    return (not p_write or p_extension = 'broadcast') and public.can_access_typing_topic(v_id);
  end if;
  return false;
end;
$$;

revoke execute on function public.can_view_channel(uuid) from public, anon;
revoke execute on function public.is_age_verified_adult() from public, anon;
revoke execute on function public.can_read_channel_content(uuid) from public, anon;
revoke execute on function public.can_access_voice_room(uuid) from public, anon;
revoke execute on function public.can_access_typing_topic(uuid) from public, anon;
revoke execute on function public.realtime_topic_allowed(text, text, boolean) from public, anon;
grant execute on function public.can_view_channel(uuid) to authenticated;
grant execute on function public.is_age_verified_adult() to authenticated;
grant execute on function public.can_read_channel_content(uuid) to authenticated;
grant execute on function public.can_access_voice_room(uuid) to authenticated;
grant execute on function public.can_access_typing_topic(uuid) to authenticated;
grant execute on function public.realtime_topic_allowed(text, text, boolean) to authenticated;

do $$
begin
  if to_regclass('realtime.messages') is null then
    raise notice 'realtime.messages não existe neste banco — políticas do Realtime não criadas.';
    return;
  end if;

  execute 'drop policy if exists "mamaco_realtime_receber" on realtime.messages';
  execute $pol$
    create policy "mamaco_realtime_receber"
      on realtime.messages for select to authenticated
      using (public.realtime_topic_allowed((select realtime.topic()), realtime.messages.extension, false))
  $pol$;

  execute 'drop policy if exists "mamaco_realtime_enviar" on realtime.messages';
  execute $pol$
    create policy "mamaco_realtime_enviar"
      on realtime.messages for insert to authenticated
      with check (public.realtime_topic_allowed((select realtime.topic()), realtime.messages.extension, true))
  $pol$;
end $$;

create table if not exists public.soundboard_plays (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers(id) on delete cascade,
  channel_id uuid not null references public.channels(id) on delete cascade,
  sound_id uuid not null references public.soundboard_sounds(id) on delete cascade,
  played_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists soundboard_plays_channel_idx on public.soundboard_plays (channel_id, created_at desc);
create index if not exists soundboard_plays_player_idx on public.soundboard_plays (played_by, created_at desc);
create index if not exists soundboard_plays_created_idx on public.soundboard_plays (created_at);
create index if not exists soundboard_plays_server_idx on public.soundboard_plays (server_id);
create index if not exists soundboard_plays_sound_idx on public.soundboard_plays (sound_id);

alter table public.soundboard_plays enable row level security;

drop policy if exists "Quem vê o canal de voz vê os sons tocados" on public.soundboard_plays;
create policy "Quem vê o canal de voz vê os sons tocados"
  on public.soundboard_plays for select to authenticated
  using (public.can_view_channel(channel_id));

revoke all on table public.soundboard_plays from public, anon, authenticated;
grant select on table public.soundboard_plays to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'soundboard_plays'
     ) then
    alter publication supabase_realtime add table public.soundboard_plays;
  end if;
end $$;

create or replace function public.play_soundboard_sound(p_channel_id uuid, p_sound_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_channel public.channels;
  v_sound public.soundboard_sounds;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Não autenticado';
  end if;
  if not public.mfa_requirement_met() then
    raise exception 'Confirme a verificação em duas etapas primeiro';
  end if;

  select * into v_channel from public.channels where id = p_channel_id;
  if v_channel.id is null or v_channel.type <> 'voice' or not public.can_view_channel(v_channel.id) then
    raise exception 'Canal de voz não encontrado';
  end if;
  if public.is_timed_out(v_channel.server_id, v_uid) then
    raise exception 'Você está silenciado neste servidor';
  end if;
  if v_channel.is_stage and not public.has_permission(v_channel.server_id, v_uid, 'manage_channels') then
    raise exception 'Só quem está no palco pode tocar sons';
  end if;

  select * into v_sound from public.soundboard_sounds where id = p_sound_id;
  if v_sound.id is null or v_sound.server_id <> v_channel.server_id then
    raise exception 'Som não encontrado neste servidor';
  end if;

  if (
    select count(*) from public.soundboard_plays
    where played_by = v_uid and created_at > now() - interval '10 seconds'
  ) >= 5 then
    raise exception 'Calma! Muitos sons seguidos — espere um pouco.';
  end if;

  delete from public.soundboard_plays where created_at < now() - interval '1 hour';

  insert into public.soundboard_plays (server_id, channel_id, sound_id, played_by)
  values (v_channel.server_id, v_channel.id, v_sound.id, v_uid)
  returning id into v_id;

  update public.soundboard_sounds set play_count = play_count + 1 where id = v_sound.id;

  return v_id;
end;
$$;

revoke execute on function public.play_soundboard_sound(uuid, uuid) from public, anon;
grant execute on function public.play_soundboard_sound(uuid, uuid) to authenticated;

drop policy if exists "Membros veem mensagens do servidor" on public.messages;
create policy "Membros veem mensagens do servidor"
  on public.messages for select to authenticated
  using (public.can_read_channel_content(channel_id));

drop policy if exists "Membros veem anexos" on public.message_attachments;
create policy "Membros veem anexos"
  on public.message_attachments for select to authenticated
  using (
    exists (
      select 1 from public.messages m
      where m.id = message_id and public.can_read_channel_content(m.channel_id)
    )
  );

drop policy if exists "Membros veem reações" on public.message_reactions;
create policy "Membros veem reações"
  on public.message_reactions for select to authenticated
  using (
    exists (
      select 1 from public.messages m
      where m.id = message_id and public.can_read_channel_content(m.channel_id)
    )
  );

drop policy if exists "Membros reagem com o próprio usuário" on public.message_reactions;
create policy "Membros reagem com o próprio usuário"
  on public.message_reactions for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.messages m
      where m.id = message_id
        and public.is_server_member(m.server_id, auth.uid())
        and not public.is_timed_out(m.server_id, auth.uid())
        and public.can_read_channel_content(m.channel_id)
    )
  );

drop policy if exists "threads_select" on public.threads;
create policy "threads_select"
  on public.threads for select to authenticated
  using (public.can_read_channel_content(channel_id));

drop policy if exists "threads_insert" on public.threads;
create policy "threads_insert"
  on public.threads for insert to authenticated
  with check (
    created_by = auth.uid()
    and not public.is_timed_out(threads.server_id, auth.uid())
    and exists (
      select 1 from public.messages m
      join public.channels c on c.id = m.channel_id
      where m.id = threads.parent_message_id
        and c.id = threads.channel_id
        and c.server_id = threads.server_id
        and public.is_server_member(c.server_id, auth.uid())
        and public.can_read_channel_content(c.id)
    )
  );

drop policy if exists "Autor edita a própria mensagem" on public.messages;
create policy "Autor edita a própria mensagem"
  on public.messages for update to authenticated
  using (
    author_id = auth.uid()
    and public.is_server_member(server_id, auth.uid())
    and not public.is_timed_out(server_id, auth.uid())
  )
  with check (
    author_id = auth.uid()
    and public.is_server_member(server_id, auth.uid())
    and not public.is_timed_out(server_id, auth.uid())
    and public.can_view_channel(channel_id)
  );

drop policy if exists "Autor edita a própria DM" on public.dm_messages;
create policy "Autor edita a própria DM"
  on public.dm_messages for update to authenticated
  using (
    author_id = auth.uid()
    and not exists (
      select 1 from public.dm_conversations c
      join public.blocked_users b on (
        (b.blocker_id = c.user_a and b.blocked_id = c.user_b) or
        (b.blocker_id = c.user_b and b.blocked_id = c.user_a)
      )
      where c.id = conversation_id
    )
  )
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

drop policy if exists "Autor da mensagem anexa arquivos" on public.message_attachments;
create policy "Autor da mensagem anexa arquivos"
  on public.message_attachments for insert to authenticated
  with check (
    exists (
      select 1 from public.messages m
      where m.id = message_id
        and m.author_id = auth.uid()
        and public.is_server_member(m.server_id, auth.uid())
        and not public.is_timed_out(m.server_id, auth.uid())
        and public.can_view_channel(m.channel_id)
    )
  );

create or replace function public.is_trusted_storage_url(
  p_url text,
  p_bucket text,
  p_folder text,
  p_allow_private boolean default false
)
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
  v_base text := nullif(rtrim(coalesce(current_setting('app.settings.supabase_url', true), ''), '/'), '');
  v_rest text;
  v_modes text := case when p_allow_private then '(public|authenticated|sign)' else 'public' end;
begin
  if p_url is null or p_bucket is null or p_folder is null then
    return false;
  end if;
  if char_length(p_url) > 2048 or position('..' in p_url) > 0 or p_url ~* '(%2e%2e|%2f|%5c|\\)' then
    return false;
  end if;

  if v_base is not null and left(p_url, char_length(v_base) + 1) = v_base || '/' then
    v_rest := substr(p_url, char_length(v_base) + 1);
  elsif p_url ~ '^https://[a-z0-9-]+\.supabase\.co/' then
    v_rest := regexp_replace(p_url, '^https://[a-z0-9-]+\.supabase\.co', '');
  else
    return false;
  end if;

  return v_rest ~ (
    '^/storage/v1/object/' || v_modes || '/' || p_bucket || '/' || p_folder || '/[^?#/][^?#]*'
    || case when p_allow_private then '(\?[^#]*)?' else '' end
    || '$'
  );
end;
$$;

revoke execute on function public.is_trusted_storage_url(text, text, text, boolean) from public, anon;
grant execute on function public.is_trusted_storage_url(text, text, text, boolean) to authenticated;

create or replace function public.guard_server_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.icon_url is not null and not public.is_trusted_storage_url(new.icon_url, 'server-icons', new.id::text) then
    raise exception 'URL de ícone inválida';
  end if;
  if new.banner_url is not null and not public.is_trusted_storage_url(new.banner_url, 'server-icons', new.id::text) then
    raise exception 'URL de banner inválida';
  end if;
  return new;
end;
$$;

drop trigger if exists on_server_insert_guard on public.servers;
create trigger on_server_insert_guard
  before insert on public.servers
  for each row execute function public.guard_server_insert();

create or replace function public.guard_server_emoji()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.server_id is distinct from old.server_id then
    raise exception 'Não é permitido mover o emoji para outro servidor';
  end if;
  if (tg_op = 'INSERT' or new.image_url is distinct from old.image_url)
     and not public.is_trusted_storage_url(new.image_url, 'server-icons', new.server_id::text) then
    raise exception 'URL de emoji inválida';
  end if;
  return new;
end;
$$;

drop trigger if exists on_server_emoji_guard on public.server_emojis;
create trigger on_server_emoji_guard
  before insert or update on public.server_emojis
  for each row execute function public.guard_server_emoji();

create or replace function public.guard_attachment_url()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_bucket text;
  v_folder text;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.file_url is not distinct from old.file_url then
    return new;
  end if;

  if tg_table_name = 'message_attachments' then
    v_bucket := 'attachments';
    select m.server_id::text || '/' || m.channel_id::text into v_folder
    from public.messages m where m.id = new.message_id;
  elsif tg_table_name = 'dm_message_attachments' then
    v_bucket := 'dm-attachments';
    select m.conversation_id::text into v_folder
    from public.dm_messages m where m.id = new.message_id;
  elsif tg_table_name = 'group_message_attachments' then
    v_bucket := 'group-attachments';
    select m.group_id::text into v_folder
    from public.group_messages m where m.id = new.message_id;
  end if;

  if v_folder is null then
    raise exception 'Mensagem do anexo não encontrada';
  end if;

  if public.is_trusted_storage_url(new.file_url, v_bucket, v_folder, true) then
    return new;
  end if;
  if new.file_url is not null
     and char_length(new.file_url) <= 1024
     and position('..' in new.file_url) = 0
     and new.file_url !~ '\\'
     and new.file_url ~ ('^' || v_folder || '/[^?#/][^?#]*$') then
    return new;
  end if;
  raise exception 'URL de anexo inválida';
end;
$$;

drop trigger if exists on_message_attachment_url_guard on public.message_attachments;
create trigger on_message_attachment_url_guard
  before insert or update on public.message_attachments
  for each row execute function public.guard_attachment_url();

drop trigger if exists on_dm_attachment_url_guard on public.dm_message_attachments;
create trigger on_dm_attachment_url_guard
  before insert or update on public.dm_message_attachments
  for each row execute function public.guard_attachment_url();

drop trigger if exists on_group_attachment_url_guard on public.group_message_attachments;
create trigger on_group_attachment_url_guard
  before insert or update on public.group_message_attachments
  for each row execute function public.guard_attachment_url();

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'age_verified_adult_at'
  ) then
    execute $mig$
      insert into public.user_private_settings (user_id, age_verified_adult_at)
      select p.id, p.age_verified_adult_at
      from public.profiles p
      where p.age_verified_adult_at is not null
        and exists (select 1 from auth.users u where u.id = p.id)
      on conflict (user_id) do update
        set age_verified_adult_at = coalesce(public.user_private_settings.age_verified_adult_at, excluded.age_verified_adult_at)
    $mig$;
  end if;
end $$;

drop trigger if exists on_profile_age_verification_stamp on public.profiles;
alter table public.profiles drop column if exists age_verified_adult_at;

create or replace function public.create_server_invite(
  p_server_id uuid,
  p_max_uses int default null,
  p_expires_hours int default null
)
returns public.server_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_invite public.server_invites;
  v_attempt int := 0;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  if not public.mfa_requirement_met() then
    raise exception 'Confirme a verificação em duas etapas primeiro';
  end if;
  if not public.is_server_member(p_server_id, auth.uid()) then
    raise exception 'Você não é membro deste servidor';
  end if;
  if p_max_uses is not null and (p_max_uses < 1 or p_max_uses > 1000) then
    raise exception 'Número máximo de usos inválido (1 a 1000)';
  end if;
  if p_expires_hours is not null and (p_expires_hours < 1 or p_expires_hours > 8760) then
    raise exception 'Validade inválida (1 hora a 1 ano)';
  end if;
  if (
    select count(*) from public.server_invites
    where server_id = p_server_id
      and (expires_at is null or expires_at > now())
      and (max_uses is null or uses < max_uses)
  ) >= 50 then
    raise exception 'Este servidor já tem convites ativos demais. Revogue alguns antes de criar outro.';
  end if;

  loop
    v_attempt := v_attempt + 1;
    v_code := public.generate_invite_code();
    begin
      insert into public.server_invites (server_id, code, created_by, max_uses, expires_at)
      values (
        p_server_id,
        v_code,
        auth.uid(),
        p_max_uses,
        case when p_expires_hours is null then null else now() + make_interval(hours => p_expires_hours) end
      )
      returning * into v_invite;
      exit;
    exception when unique_violation then
      if v_attempt >= 5 then
        raise;
      end if;
    end;
  end loop;

  return v_invite;
end;
$$;

create or replace function public.join_server_via_invite(p_code text)
returns public.servers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.server_invites;
  v_server public.servers;
  v_code text := trim(coalesce(p_code, ''));
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  if not public.mfa_requirement_met() then
    raise exception 'Confirme a verificação em duas etapas primeiro';
  end if;
  if v_code !~ '^[A-Za-z0-9]{6,32}$' then
    raise exception 'Convite inválido ou expirado';
  end if;

  select * into v_invite from public.server_invites where code = v_code for update;

  if v_invite.id is null then
    raise exception 'Convite inválido ou expirado';
  end if;
  if v_invite.expires_at is not null and v_invite.expires_at < now() then
    raise exception 'Convite inválido ou expirado';
  end if;

  select * into v_server from public.servers where id = v_invite.server_id;

  if public.is_server_member(v_invite.server_id, auth.uid()) then
    return v_server;
  end if;

  if v_invite.max_uses is not null and v_invite.uses >= v_invite.max_uses then
    raise exception 'Convite inválido ou expirado';
  end if;
  if exists (select 1 from public.bans where server_id = v_invite.server_id and user_id = auth.uid()) then
    raise exception 'Você foi banido deste servidor';
  end if;

  insert into public.server_members (server_id, user_id)
  values (v_invite.server_id, auth.uid())
  on conflict (server_id, user_id) do nothing;

  update public.server_invites set uses = uses + 1 where id = v_invite.id;

  return v_server;
end;
$$;

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
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  if not public.mfa_requirement_met() then
    raise exception 'Confirme a verificação em duas etapas primeiro';
  end if;

  if (select count(*) from public.friendships
      where user_id = auth.uid() and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Você enviou muitos pedidos de amizade. Tente de novo mais tarde.';
  end if;

  select id into v_target_id from public.profiles where lower(username) = lower(trim(p_username));

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
  if v_existing.id is not null then
    raise exception 'Pedido já enviado ou vocês já são amigos';
  end if;

  select * into v_reverse from public.friendships where user_id = v_target_id and friend_id = auth.uid();
  if v_reverse.id is not null then
    if v_reverse.status = 'accepted' then
      raise exception 'Vocês já são amigos';
    end if;
    update public.friendships set status = 'accepted' where id = v_reverse.id returning * into v_result;
    return v_result;
  end if;

  insert into public.friendships (user_id, friend_id, status, request_note)
  values (auth.uid(), v_target_id, 'pending', left(nullif(trim(coalesce(p_note, '')), ''), 200))
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
  if not public.mfa_requirement_met() then
    raise exception 'Confirme a verificação em duas etapas primeiro';
  end if;
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
  if not public.mfa_requirement_met() then
    raise exception 'Confirme a verificação em duas etapas primeiro';
  end if;
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
  if not public.mfa_requirement_met() then
    raise exception 'Confirme a verificação em duas etapas primeiro';
  end if;
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
  if not public.mfa_requirement_met() then
    raise exception 'Confirme a verificação em duas etapas primeiro';
  end if;
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
  if not public.mfa_requirement_met() then
    raise exception 'Confirme a verificação em duas etapas primeiro';
  end if;
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

create or replace function public.hide_dm_conversation(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_convo public.dm_conversations;
begin
  if not public.mfa_requirement_met() then
    raise exception 'Confirme a verificação em duas etapas primeiro';
  end if;
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

create or replace function public.delete_soundboard_sound(p_sound_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sound public.soundboard_sounds;
begin
  if not public.mfa_requirement_met() then
    raise exception 'Confirme a verificação em duas etapas primeiro';
  end if;
  select * into v_sound from public.soundboard_sounds where id = p_sound_id;
  if v_sound.id is null then
    return;
  end if;

  if v_sound.uploaded_by is distinct from auth.uid()
     and not public.has_permission(v_sound.server_id, auth.uid(), 'manage_messages') then
    raise exception 'Você não tem permissão para apagar este som';
  end if;

  delete from public.soundboard_sounds where id = p_sound_id;

  begin
    delete from storage.objects where bucket_id = 'soundboard' and name = v_sound.storage_path;
  exception when others then
    null;
  end;
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
  if not public.mfa_requirement_met() then
    raise exception 'Confirme a verificação em duas etapas primeiro';
  end if;
  select server_id into v_server_id from public.soundboard_sounds where id = p_sound_id;

  if v_server_id is null or not public.is_server_member(v_server_id, auth.uid()) then
    raise exception 'Som não encontrado';
  end if;

  update public.soundboard_sounds set play_count = play_count + 1 where id = p_sound_id;
end;
$$;

create or replace function public.reorder_channels(p_category_id uuid, p_channel_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_server_id uuid;
  v_id uuid;
  v_pos int := 0;
begin
  if not public.mfa_requirement_met() then
    raise exception 'Confirme a verificação em duas etapas primeiro';
  end if;
  select server_id into v_server_id from public.channels where id = p_channel_ids[1];

  if v_server_id is null or not exists (
    select 1 from public.servers where id = v_server_id and owner_id = auth.uid()
  ) then
    raise exception 'Você não tem permissão para reordenar canais';
  end if;

  if p_category_id is not null and not exists (
    select 1 from public.categories where id = p_category_id and server_id = v_server_id
  ) then
    raise exception 'Categoria inválida';
  end if;

  foreach v_id in array p_channel_ids loop
    update public.channels
      set position = v_pos, category_id = p_category_id
      where id = v_id and server_id = v_server_id;
    v_pos := v_pos + 1;
  end loop;
end;
$$;

create or replace function public.reorder_categories(p_server_id uuid, p_category_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_pos int := 0;
begin
  if not public.mfa_requirement_met() then
    raise exception 'Confirme a verificação em duas etapas primeiro';
  end if;
  if not exists (select 1 from public.servers where id = p_server_id and owner_id = auth.uid()) then
    raise exception 'Você não tem permissão para reordenar categorias';
  end if;

  foreach v_id in array p_category_ids loop
    update public.categories set position = v_pos where id = v_id and server_id = p_server_id;
    v_pos := v_pos + 1;
  end loop;
end;
$$;

create or replace function public.my_permissions(p_server_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.mfa_requirement_met() then
    raise exception 'Confirme a verificação em duas etapas primeiro';
  end if;
  return (
    select case
      when auth.uid() is null then array[]::text[]
      when exists (select 1 from public.servers where id = p_server_id and owner_id = auth.uid())
        then array['administrator','manage_server','manage_roles','manage_channels','manage_messages',
                   'kick_members','ban_members','timeout_members','view_audit_log','move_members']
      when not exists (select 1 from public.server_members where server_id = p_server_id and user_id = auth.uid())
        then array[]::text[]
      else coalesce((
        select array_agg(distinct u.perm)
        from public.server_member_roles smr
        join public.roles r on r.id = smr.role_id
        cross join lateral unnest(r.permissions) as u(perm)
        where smr.server_id = p_server_id and smr.user_id = auth.uid()
      ), array[]::text[])
    end
  );
end;
$$;

drop policy if exists "Exige 2FA quando ativado" on storage.objects;
create policy "Exige 2FA quando ativado"
  on storage.objects as restrictive for all to authenticated
  using ((select public.mfa_requirement_met()))
  with check ((select public.mfa_requirement_met()));

do $$
declare
  r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  loop
    execute format('drop policy if exists %I on public.%I', 'Exige 2FA quando ativado', r.relname);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated using ((select public.mfa_requirement_met())) with check ((select public.mfa_requirement_met()))',
      'Exige 2FA quando ativado', r.relname
    );
  end loop;
end $$;

revoke execute on function public.guard_server_insert() from public, anon;
revoke execute on function public.guard_server_emoji() from public, anon;
revoke execute on function public.guard_attachment_url() from public, anon;
revoke execute on function public.my_permissions(uuid) from public, anon;
grant execute on function public.my_permissions(uuid) to authenticated;

notify pgrst, 'reload schema';

-- PARTE 017 (antiga 017_private_attachments.sql)

create or replace function public.storage_path_uuid(p_name text, p_index int)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(p_name, '/', p_index) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part(p_name, '/', p_index)::uuid
    else null
  end;
$$;

create or replace function public.can_read_attachment_object(p_bucket text, p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_first uuid := public.storage_path_uuid(p_name, 1);
  v_second uuid;
  v_channel record;
begin
  if v_uid is null or v_first is null or p_name ~ '(^|/)\.\.?(/|$)' then
    return false;
  end if;
  if not public.mfa_requirement_met() then
    return false;
  end if;

  if p_bucket = 'dm-attachments' then
    return exists (
      select 1 from public.dm_conversations c
      where c.id = v_first and (c.user_a = v_uid or c.user_b = v_uid)
    );
  elsif p_bucket = 'group-attachments' then
    return public.is_group_member(v_first, v_uid);
  elsif p_bucket = 'attachments' then
    if not public.is_server_member(v_first, v_uid) then
      return false;
    end if;
    if array_length(string_to_array(p_name, '/'), 1) >= 3 then
      v_second := public.storage_path_uuid(p_name, 2);
      if v_second is null then
        return false;
      end if;
      select c.id, c.server_id, c.is_restricted into v_channel
      from public.channels c where c.id = v_second;
      if not found or v_channel.server_id <> v_first then
        return false;
      end if;
      return not v_channel.is_restricted
        or public.has_permission(v_first, v_uid, 'manage_channels')
        or public.user_has_channel_role_access(v_second, v_uid);
    end if;
    return true;
  end if;
  return false;
end;
$$;

create or replace function public.can_upload_server_attachment(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_server uuid := public.storage_path_uuid(p_name, 1);
begin
  if v_server is null or public.storage_path_uuid(p_name, 2) is null then
    return false;
  end if;
  if array_length(string_to_array(p_name, '/'), 1) <> 3 then
    return false;
  end if;
  return public.can_read_attachment_object('attachments', p_name)
    and not public.is_timed_out(v_server, auth.uid());
end;
$$;

revoke execute on function public.storage_path_uuid(text, int) from public, anon;
revoke execute on function public.can_read_attachment_object(text, text) from public, anon;
revoke execute on function public.can_upload_server_attachment(text) from public, anon;
grant execute on function public.storage_path_uuid(text, int) to authenticated;
grant execute on function public.can_read_attachment_object(text, text) to authenticated;
grant execute on function public.can_upload_server_attachment(text) to authenticated;

update storage.buckets
set public = false
where id in ('attachments', 'dm-attachments', 'group-attachments');

drop policy if exists "Membros veem anexos do servidor" on storage.objects;
create policy "Membros veem anexos do servidor"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments'
    and public.can_read_attachment_object(bucket_id, name)
  );

drop policy if exists "dm_attachments_select" on storage.objects;
create policy "dm_attachments_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'dm-attachments'
    and public.can_read_attachment_object(bucket_id, name)
  );

drop policy if exists "group_attachments_select" on storage.objects;
create policy "group_attachments_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'group-attachments'
    and public.can_read_attachment_object(bucket_id, name)
  );

drop policy if exists "Membros enviam anexos no servidor" on storage.objects;
create policy "Membros enviam anexos no servidor"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and public.can_upload_server_attachment(name)
  );

drop policy if exists "dm_attachments_insert" on storage.objects;
create policy "dm_attachments_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'dm-attachments'
    and array_length(string_to_array(name, '/'), 1) = 2
    and public.can_read_attachment_object(bucket_id, name)
  );

drop policy if exists "group_attachments_insert" on storage.objects;
create policy "group_attachments_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'group-attachments'
    and array_length(string_to_array(name, '/'), 1) = 2
    and public.can_read_attachment_object(bucket_id, name)
  );

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('message_attachments', 'message_attachments_file_url_http', 'message_attachments_file_url_safe'),
      ('dm_message_attachments', 'dm_message_attachments_file_url_http', 'dm_message_attachments_file_url_safe'),
      ('group_message_attachments', 'group_message_attachments_file_url_http', 'group_message_attachments_file_url_safe')
    ) as t(tbl, old_con, new_con)
  loop
    execute format('alter table public.%I drop constraint if exists %I', r.tbl, r.old_con);
    if not exists (
      select 1 from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace n on n.oid = cl.relnamespace
      where n.nspname = 'public' and cl.relname = r.tbl and c.conname = r.new_con
    ) then
      execute format(
        'alter table public.%I add constraint %I check (%s) not valid',
        r.tbl, r.new_con,
        $expr$file_url ~* '^https?://' or (char_length(file_url) <= 1024 and file_url ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^\s\\]+$' and file_url !~ '(^|/)\.\.?(/|$)' and file_url !~ '//')$expr$
      );
    end if;
  end loop;
end $$;

create or replace function public.check_attachment_storage_path()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
begin
  if new.file_url ~* '^https?://' then
    return new;
  end if;

  if tg_table_name = 'message_attachments' then
    select m.server_id::text || '/' || m.channel_id::text || '/' || m.id::text || '-'
      into v_prefix from public.messages m where m.id = new.message_id;
  elsif tg_table_name = 'dm_message_attachments' then
    select m.conversation_id::text || '/' || m.id::text || '-'
      into v_prefix from public.dm_messages m where m.id = new.message_id;
  elsif tg_table_name = 'group_message_attachments' then
    select m.group_id::text || '/' || m.id::text || '-'
      into v_prefix from public.group_messages m where m.id = new.message_id;
  end if;

  if v_prefix is null or left(new.file_url, char_length(v_prefix)) <> v_prefix then
    raise exception 'Caminho de anexo inválido pra esta mensagem'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke execute on function public.check_attachment_storage_path() from public, anon, authenticated;

drop trigger if exists check_attachment_storage_path on public.message_attachments;
create trigger check_attachment_storage_path
  before insert or update of file_url, message_id on public.message_attachments
  for each row execute function public.check_attachment_storage_path();

drop trigger if exists check_attachment_storage_path on public.dm_message_attachments;
create trigger check_attachment_storage_path
  before insert or update of file_url, message_id on public.dm_message_attachments
  for each row execute function public.check_attachment_storage_path();

drop trigger if exists check_attachment_storage_path on public.group_message_attachments;
create trigger check_attachment_storage_path
  before insert or update of file_url, message_id on public.group_message_attachments
  for each row execute function public.check_attachment_storage_path();

create or replace function public.orphan_attachment_objects(p_older_than interval default interval '1 day', p_limit int default 1000)
returns table (bucket_id text, name text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select o.bucket_id, o.name, o.created_at
  from storage.objects o
  where o.bucket_id in ('attachments', 'dm-attachments', 'group-attachments')
    and o.created_at < now() - p_older_than
    and not exists (
      select 1 from public.message_attachments a
      where o.bucket_id = 'attachments'
        and (a.file_url = o.name or right(a.file_url, char_length('/storage/v1/object/public/attachments/' || o.name)) = '/storage/v1/object/public/attachments/' || o.name)
    )
    and not exists (
      select 1 from public.dm_message_attachments a
      where o.bucket_id = 'dm-attachments'
        and (a.file_url = o.name or right(a.file_url, char_length('/storage/v1/object/public/dm-attachments/' || o.name)) = '/storage/v1/object/public/dm-attachments/' || o.name)
    )
    and not exists (
      select 1 from public.group_message_attachments a
      where o.bucket_id = 'group-attachments'
        and (a.file_url = o.name or right(a.file_url, char_length('/storage/v1/object/public/group-attachments/' || o.name)) = '/storage/v1/object/public/group-attachments/' || o.name)
    )
  order by o.created_at
  limit greatest(1, least(p_limit, 10000));
$$;

revoke execute on function public.orphan_attachment_objects(interval, int) from public, anon, authenticated;
grant execute on function public.orphan_attachment_objects(interval, int) to service_role;

create or replace function public.is_group_creator(p_group_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_group_id is not null
     and p_user_id is not null
     and exists (
       select 1 from public.group_conversations g
       where g.id = p_group_id and g.created_by = p_user_id
     );
$$;

revoke execute on function public.is_group_creator(uuid, uuid) from public, anon;
grant execute on function public.is_group_creator(uuid, uuid) to authenticated;

drop policy if exists "group_attachments_delete_creator" on storage.objects;
create policy "group_attachments_delete_creator"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'group-attachments'
    and public.is_group_creator(public.storage_path_uuid(name, 1), auth.uid())
  );

create or replace function public.group_attachment_objects(p_group_id uuid, p_limit int default 1000)
returns setof text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  if not public.mfa_requirement_met() then
    raise exception 'Confirme a verificação em duas etapas primeiro';
  end if;
  if not public.is_group_creator(p_group_id, auth.uid()) then
    raise exception 'Só quem criou o grupo pode apagá-lo'
      using errcode = '42501';
  end if;

  return query
    select o.name
    from storage.objects o
    where o.bucket_id = 'group-attachments'
      and o.name like p_group_id::text || '/%'
    order by o.name
    limit greatest(1, least(coalesce(p_limit, 1000), 10000));
end;
$$;

revoke execute on function public.group_attachment_objects(uuid, int) from public, anon;
grant execute on function public.group_attachment_objects(uuid, int) to authenticated;

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'Publicação supabase_realtime não existe — Realtime dos grupos não configurado.';
    return;
  end if;
  foreach t in array array['group_conversations', 'group_conversation_members'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';

create or replace function public.unread_overview()
returns table (kind text, id uuid, server_id uuid, last_message_at timestamptz, last_read_at timestamptz)
language sql
stable
set search_path = public
as $$
  select 'channel'::text, c.id, c.server_id, lm.created_at, r.last_read_at
  from public.server_members sm
  join public.channels c on c.server_id = sm.server_id and c.type = 'text'
  cross join lateral (
    select m.created_at
    from public.messages m
    where m.channel_id = c.id
    order by m.created_at desc
    limit 1
  ) lm
  left join public.channel_read_state r on r.channel_id = c.id and r.user_id = sm.user_id
  where sm.user_id = auth.uid()
    and public.can_read_channel_content(c.id)
    and (r.last_read_at is null or lm.created_at > r.last_read_at)
  union all
  select 'dm'::text, d.id, null::uuid, lm.created_at, r.last_read_at
  from public.dm_conversations d
  cross join lateral (
    select dm.created_at
    from public.dm_messages dm
    where dm.conversation_id = d.id
    order by dm.created_at desc
    limit 1
  ) lm
  left join public.dm_read_state r on r.conversation_id = d.id and r.user_id = auth.uid()
  where auth.uid() in (d.user_a, d.user_b)
    and (r.last_read_at is null or lm.created_at > r.last_read_at);
$$;

revoke execute on function public.unread_overview() from public, anon;
grant execute on function public.unread_overview() to authenticated;

notify pgrst, 'reload schema';

-- PARTE 19 — REVISÃO FINAL (terceira revisão de segurança independente)

create or replace function public.realtime_topic_allowed(p_topic text, p_extension text, p_write boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_kind text;
  v_id uuid;
begin
  if auth.uid() is null or not public.mfa_requirement_met() then
    return false;
  end if;
  if p_extension is null or p_extension not in ('broadcast', 'presence') then
    return false;
  end if;

  if p_topic ~ '^pgc:[A-Za-z0-9_.:-]{1,200}$' then
    return not coalesce(p_write, true);
  end if;

  if p_topic = 'presence:online' then
    return not p_write or p_extension = 'presence';
  end if;

  if p_topic is null
     or p_topic !~ '^(voice|typing):[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return false;
  end if;
  v_kind := split_part(p_topic, ':', 1);
  v_id := split_part(p_topic, ':', 2)::uuid;

  if v_kind = 'voice' then
    return (not p_write or p_extension = 'presence') and public.can_access_voice_room(v_id);
  end if;
  if v_kind = 'typing' then
    return (not p_write or p_extension = 'broadcast') and public.can_access_typing_topic(v_id);
  end if;
  return false;
end;
$$;

revoke execute on function public.realtime_topic_allowed(text, text, boolean) from public, anon;
grant execute on function public.realtime_topic_allowed(text, text, boolean) to authenticated;

create or replace function public.is_trusted_storage_url(
  p_url text,
  p_bucket text,
  p_folder text,
  p_allow_private boolean default false
)
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
  v_base text := nullif(rtrim(coalesce(current_setting('app.settings.supabase_url', true), ''), '/'), '');
  v_headers json;
  v_host text;
  v_url_host text;
  v_rest text;
  v_modes text := case when p_allow_private then '(public|authenticated|sign)' else 'public' end;
  v_m text[];
begin
  if p_url is null or p_bucket is null or p_folder is null then
    return false;
  end if;
  if char_length(p_url) > 2048 or position('..' in p_url) > 0 or p_url ~* '(%2e%2e|%2f|%5c|\\)' then
    return false;
  end if;

  if v_base is not null then
    if left(p_url, char_length(v_base) + 1) <> v_base || '/' then
      return false;
    end if;
    v_rest := substr(p_url, char_length(v_base) + 1);
  else
    begin
      v_headers := nullif(current_setting('request.headers', true), '')::json;
    exception when others then
      v_headers := null;
    end;
    v_host := lower(btrim(split_part(
      coalesce(nullif(btrim(v_headers ->> 'x-forwarded-host'), ''), v_headers ->> 'host', ''), ',', 1)));
    v_host := regexp_replace(v_host, ':(443|80)$', '');
    if v_host is null or v_host !~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?$' then
      return false;
    end if;
    v_m := regexp_match(p_url, '^https?://([^/?#@]+)(/.*)$', 'i');
    if v_m is null then
      return false;
    end if;
    v_url_host := regexp_replace(lower(v_m[1]), ':(443|80)$', '');
    if v_url_host <> v_host then
      return false;
    end if;
    v_rest := v_m[2];
  end if;

  return v_rest ~ (
    '^/storage/v1/object/' || v_modes || '/' || p_bucket || '/' || p_folder || '/[^?#/][^?#]*'
    || case when p_allow_private then '(\?[^#]*)?' else '' end
    || '$'
  );
end;
$$;

revoke execute on function public.is_trusted_storage_url(text, text, text, boolean) from public, anon;
grant execute on function public.is_trusted_storage_url(text, text, text, boolean) to authenticated;

create or replace function public.add_group_creator_as_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.created_by is not null then
    insert into public.group_conversation_members (group_id, user_id)
    values (new.id, new.created_by)
    on conflict do nothing;
  end if;
  return null;
end;
$$;

revoke execute on function public.add_group_creator_as_member() from public, anon, authenticated;

drop trigger if exists on_group_conversation_created_add_creator on public.group_conversations;
create trigger on_group_conversation_created_add_creator
  after insert on public.group_conversations
  for each row execute function public.add_group_creator_as_member();

create or replace function public.is_group_creator(p_group_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_group_id is not null
     and p_user_id is not null
     and exists (
       select 1 from public.group_conversations g
       where g.id = p_group_id and g.created_by = p_user_id
     )
     and public.is_group_member(p_group_id, p_user_id);
$$;

revoke execute on function public.is_group_creator(uuid, uuid) from public, anon;
grant execute on function public.is_group_creator(uuid, uuid) to authenticated;

drop policy if exists "group_conversations_select" on public.group_conversations;
create policy "group_conversations_select"
  on public.group_conversations for select to authenticated
  using (public.is_group_member(id, auth.uid()));

drop policy if exists "group_conversations_delete" on public.group_conversations;
create policy "group_conversations_delete"
  on public.group_conversations for delete to authenticated
  using (created_by = auth.uid() and public.is_group_member(id, auth.uid()));

drop policy if exists "group_members_insert" on public.group_conversation_members;
create policy "group_members_insert"
  on public.group_conversation_members for insert to authenticated
  with check (
    public.is_group_creator(group_id, auth.uid())
    and (
      user_id = auth.uid()
      or not exists (
        select 1 from public.blocked_users b
        where (b.blocker_id = auth.uid() and b.blocked_id = user_id)
           or (b.blocker_id = user_id and b.blocked_id = auth.uid())
      )
    )
  );

create or replace function public.remove_timeout(p_server_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.mfa_requirement_met() then
    raise exception 'Confirme a verificação em duas etapas primeiro';
  end if;
  if not public.has_permission(p_server_id, auth.uid(), 'timeout_members') then
    raise exception 'Você não tem permissão para silenciar membros';
  end if;
  if public.top_role_position(p_server_id, p_user_id) >= public.top_role_position(p_server_id, auth.uid()) then
    raise exception 'Você não pode mexer no silenciamento de alguém com cargo igual ou superior ao seu';
  end if;

  update public.server_members set timeout_until = null
    where server_id = p_server_id and user_id = p_user_id;

  insert into public.moderation_logs (server_id, actor_id, action, target_user_id)
  values (p_server_id, auth.uid(), 'remove_timeout', p_user_id);
end;
$$;

create or replace function public.unban_member(p_server_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_banned_by uuid;
begin
  if not public.mfa_requirement_met() then
    raise exception 'Confirme a verificação em duas etapas primeiro';
  end if;
  if not public.has_permission(p_server_id, auth.uid(), 'ban_members') then
    raise exception 'Você não tem permissão para banir membros';
  end if;

  select banned_by into v_banned_by
  from public.bans where server_id = p_server_id and user_id = p_user_id;
  if v_banned_by is not null
     and v_banned_by <> auth.uid()
     and public.top_role_position(p_server_id, v_banned_by) > public.top_role_position(p_server_id, auth.uid()) then
    raise exception 'Esse banimento foi aplicado por alguém com cargo superior ao seu';
  end if;

  delete from public.bans where server_id = p_server_id and user_id = p_user_id;

  insert into public.moderation_logs (server_id, actor_id, action, target_user_id)
  values (p_server_id, auth.uid(), 'unban', p_user_id);
end;
$$;

revoke execute on function public.remove_timeout(uuid, uuid) from public, anon;
revoke execute on function public.unban_member(uuid, uuid) from public, anon;
grant execute on function public.remove_timeout(uuid, uuid) to authenticated;
grant execute on function public.unban_member(uuid, uuid) to authenticated;

drop policy if exists "Avatares são publicamente visíveis" on storage.objects;
drop policy if exists "Banners são publicamente visíveis" on storage.objects;
drop policy if exists "Decorações são publicamente visíveis" on storage.objects;
drop policy if exists "Ícones de servidor são publicamente visíveis" on storage.objects;

drop policy if exists "Dono lista os próprios arquivos de perfil" on storage.objects;
create policy "Dono lista os próprios arquivos de perfil"
  on storage.objects for select to authenticated
  using (
    bucket_id in ('avatars', 'profile-banners', 'avatar-decorations')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Dono do servidor lista os arquivos do servidor" on storage.objects;
create policy "Dono do servidor lista os arquivos do servidor"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'server-icons'
    and (storage.foldername(name))[1] in (
      select s.id::text from public.servers s where s.owner_id = auth.uid()
    )
  );

create or replace function public.soundboard_upload_allowed(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_name is not null
     and auth.uid() is not null
     and exists (
       select 1 from public.soundboard_sounds s
       where s.storage_path = p_name
         and s.uploaded_by = auth.uid()
         and s.server_id::text = split_part(p_name, '/', 1)
         and public.is_server_member(s.server_id, auth.uid())
         and not public.is_timed_out(s.server_id, auth.uid())
     );
$$;

revoke execute on function public.soundboard_upload_allowed(text) from public, anon;
grant execute on function public.soundboard_upload_allowed(text) to authenticated;

drop policy if exists "soundboard_objects_insert" on storage.objects;
create policy "soundboard_objects_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'soundboard'
    and public.soundboard_upload_allowed(name)
  );

drop policy if exists "soundboard_objects_select_own" on storage.objects;
create policy "soundboard_objects_select_own"
  on storage.objects for select to authenticated
  using (bucket_id = 'soundboard' and owner = auth.uid());

create or replace function public.limit_soundboard_sounds()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.storage_path is null
     or new.storage_path !~ ('^' || new.server_id::text || '/[A-Za-z0-9_-]{1,64}\.[A-Za-z0-9]{1,8}$') then
    raise exception 'Caminho de arquivo inválido para o som';
  end if;
  if (select count(*) from public.soundboard_sounds where server_id = new.server_id) >= 60 then
    raise exception 'Limite de 60 sons por servidor atingido';
  end if;
  if not public.has_permission(new.server_id, auth.uid(), 'manage_server')
     and (select count(*) from public.soundboard_sounds
          where server_id = new.server_id and uploaded_by = new.uploaded_by) >= 10 then
    raise exception 'Limite de 10 sons por pessoa neste servidor atingido';
  end if;
  return new;
end;
$$;

revoke execute on function public.limit_soundboard_sounds() from public, anon, authenticated;

drop trigger if exists a_limit_soundboard_sounds on public.soundboard_sounds;
create trigger a_limit_soundboard_sounds
  before insert on public.soundboard_sounds
  for each row execute function public.limit_soundboard_sounds();

alter table public.user_private_settings add column if not exists terms_accepted_at timestamptz;
alter table public.user_private_settings add column if not exists terms_version text;
alter table public.user_private_settings add column if not exists age_declared_adult_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'user_private_settings_terms_version_len'
      and conrelid = 'public.user_private_settings'::regclass
  ) then
    alter table public.user_private_settings
      add constraint user_private_settings_terms_version_len
      check (terms_version is null or terms_version ~ '^[A-Za-z0-9._-]{1,32}$');
  end if;
end $$;

comment on column public.user_private_settings.terms_accepted_at is
  'Quando a pessoa aceitou os Termos de Uso/Política de Privacidade (hora do servidor). null = não aceitou.';
comment on column public.user_private_settings.terms_version is
  'Versão dos termos aceita (ex.: 2026-09).';
comment on column public.user_private_settings.age_declared_adult_at is
  'Quando a pessoa declarou ter 18 anos ou mais no cadastro (autodeclaração; hora do servidor).';

create or replace function public.stamp_private_settings_consent()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.terms_accepted_at is not null then new.terms_accepted_at := now(); end if;
    if new.age_declared_adult_at is not null then new.age_declared_adult_at := now(); end if;
    return new;
  end if;
  if new.terms_accepted_at is distinct from old.terms_accepted_at and new.terms_accepted_at is not null then
    new.terms_accepted_at := now();
  end if;
  if new.age_declared_adult_at is distinct from old.age_declared_adult_at and new.age_declared_adult_at is not null then
    new.age_declared_adult_at := now();
  end if;
  return new;
end;
$$;

revoke execute on function public.stamp_private_settings_consent() from public, anon, authenticated;

drop trigger if exists on_private_settings_consent_stamp on public.user_private_settings;
create trigger on_private_settings_consent_stamp
  before insert or update of terms_accepted_at, age_declared_adult_at on public.user_private_settings
  for each row execute function public.stamp_private_settings_consent();

create or replace function public.accept_terms(p_version text, p_is_adult boolean)
returns public.user_private_settings
language plpgsql
volatile
set search_path = public
as $$
declare
  v_row public.user_private_settings;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  if p_is_adult is distinct from true then
    raise exception 'Você precisa ter 18 anos ou mais';
  end if;
  if p_version is null or p_version !~ '^[A-Za-z0-9._-]{1,32}$' then
    raise exception 'Versão dos termos inválida';
  end if;

  insert into public.user_private_settings (user_id, terms_accepted_at, terms_version, age_declared_adult_at)
  values (auth.uid(), now(), p_version, now())
  on conflict (user_id) do update
    set terms_accepted_at = now(),
        terms_version = excluded.terms_version,
        age_declared_adult_at = coalesce(public.user_private_settings.age_declared_adult_at, now())
  returning * into v_row;
  return v_row;
end;
$$;

revoke execute on function public.accept_terms(text, boolean) from public, anon;
grant execute on function public.accept_terms(text, boolean) to authenticated;

create table if not exists public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.app_admins is
  'Administradores da PLATAFORMA (recebem denúncias sem servidor/escaladas). Inserir só pelo SQL Editor: insert into public.app_admins values (''<uuid>'');';

alter table public.app_admins enable row level security;

drop policy if exists "Admin vê a própria linha" on public.app_admins;
create policy "Admin vê a própria linha"
  on public.app_admins for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Exige 2FA quando ativado" on public.app_admins;
create policy "Exige 2FA quando ativado"
  on public.app_admins as restrictive for all to authenticated
  using ((select public.mfa_requirement_met()))
  with check ((select public.mfa_requirement_met()));

revoke all on table public.app_admins from public, anon, authenticated;
grant select on table public.app_admins to authenticated;

create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and exists (select 1 from public.app_admins a where a.user_id = auth.uid())
     and public.mfa_requirement_met();
$$;

revoke execute on function public.is_app_admin() from public, anon;
grant execute on function public.is_app_admin() to authenticated;

alter table public.reports add column if not exists dm_message_id uuid references public.dm_messages(id) on delete set null;
alter table public.reports add column if not exists group_message_id uuid references public.group_messages(id) on delete set null;
alter table public.reports add column if not exists dm_conversation_id uuid references public.dm_conversations(id) on delete set null;
alter table public.reports add column if not exists group_id uuid references public.group_conversations(id) on delete set null;
alter table public.reports add column if not exists escalated boolean not null default false;
alter table public.reports add column if not exists content_snapshot text;
alter table public.reports add column if not exists scope text
  generated always as (case when server_id is null or escalated then 'platform' else 'server' end) stored;

alter table public.reports drop constraint if exists reports_target_type_check;
alter table public.reports add constraint reports_target_type_check
  check (target_type in ('message', 'user', 'dm_message', 'group_message'));

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'reports_message_id_fkey'
      and conrelid = 'public.reports'::regclass
      and confdeltype <> 'n'
  ) then
    alter table public.reports drop constraint reports_message_id_fkey;
    alter table public.reports add constraint reports_message_id_fkey
      foreign key (message_id) references public.messages(id) on delete set null;
  end if;
end $$;

create index if not exists reports_dm_message_idx on public.reports (dm_message_id) where dm_message_id is not null;
create index if not exists reports_group_message_idx on public.reports (group_message_id) where group_message_id is not null;
create index if not exists reports_dm_conversation_idx on public.reports (dm_conversation_id) where dm_conversation_id is not null;
create index if not exists reports_group_idx on public.reports (group_id) where group_id is not null;
create index if not exists reports_platform_idx on public.reports (status, created_at desc) where server_id is null or escalated;

create or replace function public.set_report_context()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_server_id uuid;
  v_author_id uuid;
  v_content text;
  v_conv uuid;
  v_group uuid;
begin
  if new.reporter_id is distinct from auth.uid() then
    raise exception 'reporter_id precisa ser o usuário autenticado';
  end if;

  if new.target_type = 'message' then
    if new.message_id is null then
      raise exception 'message_id é obrigatório para denúncia de mensagem';
    end if;
    select server_id, author_id, content into v_server_id, v_author_id, v_content
    from public.messages where id = new.message_id;
    if v_server_id is null then
      raise exception 'mensagem não encontrada';
    end if;
    if v_author_id = auth.uid() then
      raise exception 'não é possível denunciar a própria mensagem';
    end if;
    new.server_id := v_server_id;
    new.reported_user_id := v_author_id;
    new.dm_message_id := null;
    new.group_message_id := null;
    new.dm_conversation_id := null;
    new.group_id := null;
    new.content_snapshot := left(v_content, 4000);

  elsif new.target_type = 'dm_message' then
    if new.dm_message_id is null then
      raise exception 'dm_message_id é obrigatório para denúncia de mensagem direta';
    end if;
    select m.conversation_id, m.author_id, m.content into v_conv, v_author_id, v_content
    from public.dm_messages m
    join public.dm_conversations d on d.id = m.conversation_id
    where m.id = new.dm_message_id and auth.uid() in (d.user_a, d.user_b);
    if v_conv is null then
      raise exception 'mensagem não encontrada';
    end if;
    if v_author_id = auth.uid() then
      raise exception 'não é possível denunciar a própria mensagem';
    end if;
    new.server_id := null;
    new.message_id := null;
    new.group_message_id := null;
    new.group_id := null;
    new.dm_conversation_id := v_conv;
    new.reported_user_id := v_author_id;
    new.content_snapshot := left(v_content, 4000);

  elsif new.target_type = 'group_message' then
    if new.group_message_id is null then
      raise exception 'group_message_id é obrigatório para denúncia de mensagem de grupo';
    end if;
    select m.group_id, m.author_id, m.content into v_group, v_author_id, v_content
    from public.group_messages m
    where m.id = new.group_message_id and public.is_group_member(m.group_id, auth.uid());
    if v_group is null then
      raise exception 'mensagem não encontrada';
    end if;
    if v_author_id = auth.uid() then
      raise exception 'não é possível denunciar a própria mensagem';
    end if;
    new.server_id := null;
    new.message_id := null;
    new.dm_message_id := null;
    new.dm_conversation_id := null;
    new.group_id := v_group;
    new.reported_user_id := v_author_id;
    new.content_snapshot := left(v_content, 4000);

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
    new.message_id := null;
    new.dm_message_id := null;
    new.group_message_id := null;
    new.dm_conversation_id := null;
    new.group_id := null;
    new.content_snapshot := null;
  else
    raise exception 'target_type inválido';
  end if;

  new.escalated := coalesce(new.escalated, false);
  new.status := 'pending';
  new.reviewed_by := null;
  new.reviewed_at := null;
  new.created_at := now();
  return new;
end;
$$;

create or replace function public.protect_report_immutable_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.reporter_id is distinct from old.reporter_id
    or new.target_type is distinct from old.target_type
    or new.reported_user_id is distinct from old.reported_user_id
    or new.reason is distinct from old.reason
    or new.details is distinct from old.details
    or new.server_id is distinct from old.server_id
    or new.created_at is distinct from old.created_at
    or new.content_snapshot is distinct from old.content_snapshot
    or (new.message_id is distinct from old.message_id and new.message_id is not null)
    or (new.dm_message_id is distinct from old.dm_message_id and new.dm_message_id is not null)
    or (new.group_message_id is distinct from old.group_message_id and new.group_message_id is not null)
    or (new.dm_conversation_id is distinct from old.dm_conversation_id and new.dm_conversation_id is not null)
    or (new.group_id is distinct from old.group_id and new.group_id is not null)
    or (old.escalated and not new.escalated)
  then
    raise exception 'só é permitido alterar o status da denúncia';
  end if;
  if new.status is distinct from old.status then
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  else
    new.reviewed_by := old.reviewed_by;
    new.reviewed_at := old.reviewed_at;
  end if;
  return new;
end;
$$;

revoke execute on function public.set_report_context() from public, anon, authenticated;
revoke execute on function public.protect_report_immutable_columns() from public, anon, authenticated;

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
    or ((server_id is null or escalated) and public.is_app_admin())
  );

drop policy if exists "reports_update_moderator" on public.reports;
create policy "reports_update_moderator" on public.reports
  for update to authenticated
  using (
    (
      server_id is not null
      and (
        exists (select 1 from public.servers where id = server_id and owner_id = auth.uid())
        or public.has_permission(server_id, auth.uid(), 'manage_messages')
      )
    )
    or ((server_id is null or escalated) and public.is_app_admin())
  )
  with check (
    (
      server_id is not null
      and (
        exists (select 1 from public.servers where id = server_id and owner_id = auth.uid())
        or public.has_permission(server_id, auth.uid(), 'manage_messages')
      )
    )
    or ((server_id is null or escalated) and public.is_app_admin())
  );

create or replace function public.admin_report_context(p_report_id uuid)
returns table (
  report_id uuid,
  target_type text,
  server_id uuid,
  channel_id uuid,
  dm_conversation_id uuid,
  group_id uuid,
  message_id uuid,
  author_id uuid,
  author_username text,
  content text,
  message_created_at timestamptz,
  from_snapshot boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r public.reports;
  v_msg_id uuid;
  v_author uuid;
  v_content text;
  v_created timestamptz;
  v_channel uuid;
begin
  if not public.is_app_admin() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select * into r from public.reports where id = p_report_id;
  if r.id is null or not (r.server_id is null or r.escalated) then
    raise exception 'Denúncia não encontrada';
  end if;

  if r.target_type = 'message' and r.message_id is not null then
    select m.id, m.author_id, m.content, m.created_at, m.channel_id
      into v_msg_id, v_author, v_content, v_created, v_channel
    from public.messages m where m.id = r.message_id;
  elsif r.target_type = 'dm_message' and r.dm_message_id is not null then
    select m.id, m.author_id, m.content, m.created_at
      into v_msg_id, v_author, v_content, v_created
    from public.dm_messages m where m.id = r.dm_message_id;
  elsif r.target_type = 'group_message' and r.group_message_id is not null then
    select m.id, m.author_id, m.content, m.created_at
      into v_msg_id, v_author, v_content, v_created
    from public.group_messages m where m.id = r.group_message_id;
  end if;

  report_id := r.id;
  target_type := r.target_type;
  server_id := r.server_id;
  channel_id := v_channel;
  dm_conversation_id := r.dm_conversation_id;
  group_id := r.group_id;
  message_id := v_msg_id;
  author_id := coalesce(v_author, r.reported_user_id);
  select p.username into author_username from public.profiles p where p.id = coalesce(v_author, r.reported_user_id);
  if v_msg_id is not null then
    content := v_content;
    from_snapshot := false;
  else
    content := r.content_snapshot;
    from_snapshot := r.content_snapshot is not null;
  end if;
  message_created_at := v_created;
  return next;
end;
$$;

create or replace function public.admin_remove_reported_message(p_report_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  r public.reports;
  v_deleted int := 0;
begin
  if not public.is_app_admin() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select * into r from public.reports where id = p_report_id for update;
  if r.id is null or not (r.server_id is null or r.escalated) then
    raise exception 'Denúncia não encontrada';
  end if;
  if r.target_type not in ('message', 'dm_message', 'group_message') then
    raise exception 'Essa denúncia não é de uma mensagem';
  end if;

  update public.reports set status = 'reviewed' where id = r.id;

  if r.target_type = 'message' and r.message_id is not null then
    delete from public.messages where id = r.message_id;
    get diagnostics v_deleted = row_count;
  elsif r.target_type = 'dm_message' and r.dm_message_id is not null then
    delete from public.dm_messages where id = r.dm_message_id;
    get diagnostics v_deleted = row_count;
  elsif r.target_type = 'group_message' and r.group_message_id is not null then
    delete from public.group_messages where id = r.group_message_id;
    get diagnostics v_deleted = row_count;
  end if;
  return v_deleted > 0;
end;
$$;

revoke execute on function public.admin_report_context(uuid) from public, anon;
revoke execute on function public.admin_remove_reported_message(uuid) from public, anon;
grant execute on function public.admin_report_context(uuid) to authenticated;
grant execute on function public.admin_remove_reported_message(uuid) to authenticated;

-- parte 016, item 2).

-- PARTE 20) Ordem dos cargos (hierarquia) — sobe/desce um cargo,
create or replace function public.move_role(p_role_id uuid, p_up boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.roles;
  v_other public.roles;
  v_top int;
begin
  if not public.mfa_requirement_met() then
    raise exception 'Confirme a verificação em duas etapas primeiro';
  end if;
  select * into v_role from public.roles where id = p_role_id for update;
  if v_role.id is null then
    raise exception 'Cargo não encontrado';
  end if;
  if not public.has_permission(v_role.server_id, auth.uid(), 'manage_roles') then
    raise exception 'Você não tem permissão para gerenciar cargos';
  end if;
  v_top := public.top_role_position(v_role.server_id, auth.uid());
  if v_role.position >= v_top then
    raise exception 'Você não pode mover um cargo igual ou acima do seu próprio nível';
  end if;

  if p_up then
    select * into v_other from public.roles
      where server_id = v_role.server_id and position > v_role.position
      order by position asc limit 1 for update;
  else
    select * into v_other from public.roles
      where server_id = v_role.server_id and position < v_role.position
      order by position desc limit 1 for update;
  end if;
  if v_other.id is null then
    return;
  end if;
  if v_other.position >= v_top then
    raise exception 'Você não pode colocar um cargo acima do seu próprio nível';
  end if;

  update public.roles set position = v_other.position where id = v_role.id;
  update public.roles set position = v_role.position where id = v_other.id;
end;
$$;

revoke execute on function public.move_role(uuid, boolean) from public, anon;
grant execute on function public.move_role(uuid, boolean) to authenticated;

-- PARTE 21 — revisão de segurança (out/2026)

create or replace function public.can_access_voice_room(p_room uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
      select 1 from public.channels c
      where c.id = p_room and c.type = 'voice' and public.can_view_channel(c.id)
    )
    or public.is_group_member(p_room, auth.uid())
    or exists (
      select 1 from public.dm_conversations d
      where d.id = p_room
        and auth.uid() in (d.user_a, d.user_b)
        and not exists (
          select 1 from public.blocked_users b
          where (b.blocker_id = d.user_a and b.blocked_id = d.user_b)
             or (b.blocker_id = d.user_b and b.blocked_id = d.user_a)
        )
    );
$$;
revoke execute on function public.can_access_voice_room(uuid) from public, anon;
grant execute on function public.can_access_voice_room(uuid) to authenticated;

create or replace function public.create_server_invite(
  p_server_id uuid,
  p_max_uses int default null,
  p_expires_hours int default null
)
returns public.server_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_invite public.server_invites;
  v_attempt int := 0;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  if not public.mfa_requirement_met() then
    raise exception 'Confirme a verificação em duas etapas primeiro';
  end if;
  if not public.is_server_member(p_server_id, auth.uid()) then
    raise exception 'Você não é membro deste servidor';
  end if;
  if public.is_timed_out(p_server_id, auth.uid()) then
    raise exception 'Você está de castigo neste servidor e não pode criar convites agora';
  end if;
  if p_max_uses is not null and (p_max_uses < 1 or p_max_uses > 1000) then
    raise exception 'Número máximo de usos inválido (1 a 1000)';
  end if;
  if p_expires_hours is not null and (p_expires_hours < 1 or p_expires_hours > 8760) then
    raise exception 'Validade inválida (1 hora a 1 ano)';
  end if;
  if (
    select count(*) from public.server_invites
    where server_id = p_server_id
      and (expires_at is null or expires_at > now())
      and (max_uses is null or uses < max_uses)
  ) >= 50 then
    raise exception 'Este servidor já tem convites ativos demais. Revogue alguns antes de criar outro.';
  end if;

  loop
    v_attempt := v_attempt + 1;
    v_code := public.generate_invite_code();
    begin
      insert into public.server_invites (server_id, code, created_by, max_uses, expires_at)
      values (
        p_server_id,
        v_code,
        auth.uid(),
        p_max_uses,
        case when p_expires_hours is null then null else now() + make_interval(hours => p_expires_hours) end
      )
      returning * into v_invite;
      exit;
    exception when unique_violation then
      if v_attempt >= 5 then
        raise;
      end if;
    end;
  end loop;

  return v_invite;
end;
$$;

delete from public.server_invites where code ~ '^[0-9a-f]{8}$';

-- PARTE 22 — painel de usuários (só administradores da plataforma)

create table if not exists public.user_plans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan ~ '^[a-z0-9_-]{1,32}$'),
  expires_at timestamptz,
  note text check (note is null or char_length(note) <= 500),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table public.user_plans enable row level security;
drop policy if exists "Usuário vê o próprio plano" on public.user_plans;
create policy "Usuário vê o próprio plano"
  on public.user_plans for select to authenticated
  using (user_id = auth.uid());
revoke all on table public.user_plans from public, anon, authenticated;
grant select on table public.user_plans to authenticated;

create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  admin_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_user_id uuid references auth.users(id) on delete set null,
  details jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_log_created_idx on public.admin_audit_log (created_at desc);
alter table public.admin_audit_log enable row level security;
drop policy if exists "Admins leem o registro" on public.admin_audit_log;
create policy "Admins leem o registro"
  on public.admin_audit_log for select to authenticated
  using (public.is_app_admin());
revoke all on table public.admin_audit_log from public, anon, authenticated;
grant select on table public.admin_audit_log to authenticated;

create or replace function public.mask_email(p_email text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_email is null or position('@' in p_email) < 2 then null
    else left(p_email, 1) || '***' || substr(p_email, position('@' in p_email))
  end;
$$;
revoke execute on function public.mask_email(text) from public, anon;

create or replace function public.admin_user_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_app_admin() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'total', (select count(*) from auth.users where deleted_at is null),
    'new_7d', (select count(*) from auth.users where deleted_at is null and created_at > now() - interval '7 days'),
    'new_30d', (select count(*) from auth.users where deleted_at is null and created_at > now() - interval '30 days'),
    'active_7d', (select count(*) from auth.users where deleted_at is null and last_sign_in_at > now() - interval '7 days'),
    'paid', (select count(*) from public.user_plans where plan <> 'free' and (expires_at is null or expires_at > now()))
  );
end;
$$;
revoke execute on function public.admin_user_stats() from public, anon;
grant execute on function public.admin_user_stats() to authenticated;

drop function if exists public.admin_list_users(text, text, int, int);
create or replace function public.admin_list_users(
  p_search text default null,
  p_plan text default null,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_url text,
  email_masked text,
  provider text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  email_confirmed boolean,
  plan text,
  plan_expires_at timestamptz,
  plan_note text,
  server_count bigint,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_search text := nullif(trim(coalesce(p_search, '')), '');
  v_like text;
begin
  if not public.is_app_admin() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if v_search is not null then
    v_search := left(v_search, 100);
    v_like := '%' || replace(replace(replace(lower(v_search), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  return query
  with base as (
    select
      u.id,
      p.username,
      p.display_name,
      p.avatar_url,
      public.mask_email(u.email::text) as email_masked,
      coalesce(u.raw_app_meta_data->>'provider', 'email') as provider,
      u.created_at,
      u.last_sign_in_at,
      (u.email_confirmed_at is not null) as email_confirmed,
      case when up.expires_at is not null and up.expires_at <= now() then 'free' else coalesce(up.plan, 'free') end as plan,
      up.expires_at as plan_expires_at,
      up.note as plan_note
    from auth.users u
    left join public.profiles p on p.id = u.id
    left join public.user_plans up on up.user_id = u.id
    where u.deleted_at is null
      and (
        v_search is null
        or lower(coalesce(p.username, '')) like v_like
        or lower(coalesce(p.display_name, '')) like v_like
        or lower(u.email::text) = lower(v_search)
        or u.id::text = v_search
      )
  ),
  filtered as (
    select * from base b where p_plan is null or p_plan = '' or b.plan = p_plan
  )
  select
    f.id, f.username, f.display_name, f.avatar_url, f.email_masked, f.provider,
    f.created_at, f.last_sign_in_at, f.email_confirmed, f.plan, f.plan_expires_at, f.plan_note,
    (select count(*) from public.server_members sm where sm.user_id = f.id) as server_count,
    count(*) over () as total_count
  from filtered f
  order by f.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;
revoke execute on function public.admin_list_users(text, text, int, int) from public, anon;
grant execute on function public.admin_list_users(text, text, int, int) to authenticated;

create or replace function public.admin_reveal_email(p_user_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  if not public.is_app_admin() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  select u.email::text into v_email from auth.users u where u.id = p_user_id;
  insert into public.admin_audit_log (admin_id, action, target_user_id)
  values (auth.uid(), 'reveal_email', p_user_id);
  return v_email;
end;
$$;
revoke execute on function public.admin_reveal_email(uuid) from public, anon;
grant execute on function public.admin_reveal_email(uuid) to authenticated;

create or replace function public.admin_set_user_plan(
  p_user_id uuid,
  p_plan text,
  p_expires_at timestamptz default null,
  p_note text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_plan text := lower(trim(coalesce(p_plan, 'free')));
begin
  if not public.is_app_admin() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if v_plan !~ '^[a-z0-9_-]{1,32}$' then
    raise exception 'Plano inválido';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'Conta não encontrada';
  end if;
  if v_plan = 'free' then
    delete from public.user_plans where user_id = p_user_id;
  else
    insert into public.user_plans (user_id, plan, expires_at, note, updated_at, updated_by)
    values (p_user_id, v_plan, p_expires_at, nullif(left(trim(coalesce(p_note, '')), 500), ''), now(), auth.uid())
    on conflict (user_id) do update
      set plan = excluded.plan,
          expires_at = excluded.expires_at,
          note = excluded.note,
          updated_at = now(),
          updated_by = auth.uid();
  end if;
  insert into public.admin_audit_log (admin_id, action, target_user_id, details)
  values (auth.uid(), 'set_plan', p_user_id, jsonb_build_object('plan', v_plan, 'expires_at', p_expires_at));
end;
$$;
revoke execute on function public.admin_set_user_plan(uuid, text, timestamptz, text) from public, anon;
grant execute on function public.admin_set_user_plan(uuid, text, timestamptz, text) to authenticated;

-- PARTE 23 — cargos só com o dono ou um Administrador
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
            and (
              r.permissions @> array['administrator']
              or (p_permission <> 'manage_roles' and r.permissions @> array[p_permission])
            )
        )
      )
    );
$$;

-- PARTE 24 — cartão de atividade (loja/tempo jogando) e sala AFK padrão

alter table public.profiles add column if not exists playing_app text;
alter table public.profiles add column if not exists playing_since timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_playing_app_format') then
    alter table public.profiles add constraint profiles_playing_app_format
      check (playing_app is null or playing_app ~ '^(steam:[0-9]{1,10}|[a-z0-9 ._-]{1,40})$');
  end if;
end $$;

alter table public.servers alter column afk_timeout_minutes set default 20;

create or replace function public.handle_new_server_channels()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_afk uuid;
begin
  insert into public.channels (server_id, name, type, position) values
    (new.id, 'geral', 'text', 0),
    (new.id, 'Geral', 'voice', 1);
  insert into public.channels (server_id, name, type, position)
  values (new.id, 'AFK', 'voice', 999)
  returning id into v_afk;
  update public.servers set afk_channel_id = v_afk, afk_timeout_minutes = 20 where id = new.id;
  return new;
end;
$$;

do $$
declare
  r record;
  v_afk uuid;
begin
  for r in select id from public.servers where afk_channel_id is null loop
    insert into public.channels (server_id, name, type, position)
    values (r.id, 'AFK', 'voice', 999)
    returning id into v_afk;
    update public.servers set afk_channel_id = v_afk where id = r.id;
  end loop;
end $$;
update public.servers set afk_timeout_minutes = 20 where afk_timeout_minutes = 10;

-- PARTE 25 — Cada sala de voz tem o seu chat de texto (mesmo nome, mesma
create table if not exists public.app_once_flags (
  key text primary key,
  done_at timestamptz not null default now()
);
alter table public.app_once_flags enable row level security;
revoke all on public.app_once_flags from anon, authenticated;

do $$
begin
  if not exists (select 1 from public.app_once_flags where key = 'voice_text_pairs_2026_10') then
    insert into public.channels (server_id, category_id, name, type, position)
    select distinct on (v.server_id, v.category_id, v.slug)
      v.server_id, v.category_id, left(v.slug, 100), 'text', v.position
    from (
      select c.*, lower(regexp_replace(btrim(c.name), '\s+', '-', 'g')) as slug
      from public.channels c
      where c.type = 'voice' and not c.is_stage
        and not exists (select 1 from public.servers s where s.afk_channel_id = c.id)
    ) v
    where char_length(v.slug) >= 1
      and not exists (
        select 1 from public.channels t
        where t.server_id = v.server_id and t.type = 'text'
          and t.category_id is not distinct from v.category_id
          and t.name = v.slug
      )
    order by v.server_id, v.category_id, v.slug, v.position;
    insert into public.app_once_flags (key) values ('voice_text_pairs_2026_10');
  end if;
end $$;

notify pgrst, 'reload schema';

-- PARTE 26 — Ícone de jogo na categoria (out/2026)
alter table public.categories add column if not exists game text;
alter table public.categories drop constraint if exists categories_game_len;
alter table public.categories add constraint categories_game_len check (game is null or char_length(game) <= 80);

notify pgrst, 'reload schema';

-- PARTE 27 — Imagem própria no ícone da categoria (out/2026)
alter table public.categories add column if not exists icon_url text;

create or replace function public.guard_category_icon()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.icon_url is not null and (
       not public.is_trusted_storage_url(new.icon_url, 'server-icons', new.server_id::text)
       or position('/categorias/' in new.icon_url) = 0
     ) then
    raise exception 'Imagem da categoria inválida';
  end if;
  return new;
end;
$$;

drop trigger if exists on_category_icon_guard on public.categories;
create trigger on_category_icon_guard
  before insert or update of icon_url on public.categories
  for each row execute function public.guard_category_icon();

drop policy if exists "category_icons_insert" on storage.objects;
create policy "category_icons_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'server-icons'
    and (storage.foldername(name))[2] = 'categorias'
    and exists (
      select 1 from public.servers s
      where s.id::text = (storage.foldername(name))[1]
        and public.has_permission(s.id, auth.uid(), 'manage_channels')
    )
  );

drop policy if exists "category_icons_select" on storage.objects;
create policy "category_icons_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'server-icons'
    and (storage.foldername(name))[2] = 'categorias'
    and exists (
      select 1 from public.servers s
      where s.id::text = (storage.foldername(name))[1]
        and public.has_permission(s.id, auth.uid(), 'manage_channels')
    )
  );

drop policy if exists "category_icons_delete" on storage.objects;
create policy "category_icons_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'server-icons'
    and (storage.foldername(name))[2] = 'categorias'
    and exists (
      select 1 from public.servers s
      where s.id::text = (storage.foldername(name))[1]
        and public.has_permission(s.id, auth.uid(), 'manage_channels')
    )
  );

notify pgrst, 'reload schema';

-- PARTE 28 — O nome de usuário não pode revelar o e-mail (out/2026)
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
  v_tries int := 0;
begin
  v_base := nullif(trim(new.raw_user_meta_data->>'username'), '');
  v_base := regexp_replace(coalesce(v_base, ''), '[^a-zA-Z0-9_.]', '', 'g');
  v_base := left(v_base, 26);

  if char_length(v_base) >= 3 and lower(v_base) not in ('everyone', 'here') then
    v_username := v_base;
    while exists (select 1 from public.profiles where lower(username) = lower(v_username)) loop
      v_suffix := v_suffix + 1;
      v_username := v_base || v_suffix::text;
    end loop;
  else
    loop
      v_username := 'mamaco' || lpad((floor(random() * 1000000))::int::text, 6, '0');
      exit when not exists (select 1 from public.profiles where lower(username) = lower(v_username));
      v_tries := v_tries + 1;
      if v_tries > 20 then
        v_username := 'mamaco' || replace(left(new.id::text, 13), '-', '');
        exit;
      end if;
    end loop;
  end if;

  v_display_name := left(coalesce(
    nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
    nullif(trim(new.raw_user_meta_data->>'name'), ''),
    v_username
  ), 32);

  insert into public.profiles (id, username, display_name)
  values (new.id, v_username, v_display_name);

  return new;
end;
$$;

do $$
declare
  r record;
  v_new text;
begin
  if exists (select 1 from public.app_once_flags where key = 'username_not_email_2026_10') then
    return;
  end if;
  for r in
    select p.id, p.username, p.display_name, u.email::text as email
    from public.profiles p
    join auth.users u on u.id = p.id
    where coalesce(u.raw_app_meta_data->>'provider', 'email') <> 'email'
      and u.email is not null
      and lower(p.username) like lower(left(regexp_replace(split_part(u.email::text, '@', 1), '[^a-zA-Z0-9_.]', '', 'g'), 26)) || '%'
      and char_length(regexp_replace(split_part(u.email::text, '@', 1), '[^a-zA-Z0-9_.]', '', 'g')) >= 3
  loop
    loop
      v_new := 'mamaco' || lpad((floor(random() * 1000000))::int::text, 6, '0');
      exit when not exists (select 1 from public.profiles where lower(username) = lower(v_new));
    end loop;
    update public.profiles
      set username = v_new,
          display_name = case
            when lower(display_name) = lower(r.username)
              or lower(display_name) = lower(split_part(r.email, '@', 1)) then v_new
            else display_name
          end
      where id = r.id;
  end loop;
  insert into public.app_once_flags (key) values ('username_not_email_2026_10');
end $$;

notify pgrst, 'reload schema';

-- PARTE 29 — Notificações no celular (out/2026)

create table if not exists public.push_tokens (
  token text primary key check (char_length(token) between 20 and 4096),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null default 'android' check (platform in ('android', 'ios', 'web')),
  updated_at timestamptz not null default now()
);
create index if not exists push_tokens_user_idx on public.push_tokens (user_id);
alter table public.push_tokens enable row level security;
revoke all on public.push_tokens from anon, authenticated;

create or replace function public.register_push_token(p_token text, p_platform text default 'android')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  if p_token is null or char_length(p_token) not between 20 and 4096 then
    raise exception 'Token inválido';
  end if;
  insert into public.push_tokens (token, user_id, platform, updated_at)
  values (p_token, auth.uid(), coalesce(nullif(p_platform, ''), 'android'), now())
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
  delete from public.push_tokens t
  where t.user_id = auth.uid()
    and t.token not in (
      select token from public.push_tokens where user_id = auth.uid() order by updated_at desc limit 10
    );
end;
$$;
revoke execute on function public.register_push_token(text, text) from public, anon;
grant execute on function public.register_push_token(text, text) to authenticated;

create or replace function public.unregister_push_token(p_token text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.push_tokens where token = p_token and user_id = auth.uid();
$$;
revoke execute on function public.unregister_push_token(text) from public, anon;
grant execute on function public.unregister_push_token(text) to authenticated;

create table if not exists public.push_config (
  id int primary key default 1 check (id = 1),
  function_url text not null,
  secret text not null default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  enabled boolean not null default true
);
alter table public.push_config enable row level security;
revoke all on public.push_config from anon, authenticated;
insert into public.push_config (id, function_url)
values (1, 'https://wnsfnlmbtpxnlxxrizbv.supabase.co/functions/v1/push-notify')
on conflict (id) do nothing;

create extension if not exists pg_net with schema extensions;

create or replace function public.notify_push_new_message()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  cfg record;
begin
  select function_url, secret, enabled into cfg from public.push_config where id = 1;
  if cfg is null or not cfg.enabled then
    return new;
  end if;
  if not exists (select 1 from public.push_tokens limit 1) then
    return new;
  end if;
  perform net.http_post(
    url := cfg.function_url,
    body := jsonb_build_object('table', tg_table_name, 'id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', cfg.secret),
    timeout_milliseconds := 5000
  );
  return new;
exception when others then
  return new;
end;
$$;
revoke execute on function public.notify_push_new_message() from public, anon, authenticated;

drop trigger if exists on_message_push on public.messages;
create trigger on_message_push after insert on public.messages
  for each row execute function public.notify_push_new_message();
drop trigger if exists on_dm_message_push on public.dm_messages;
create trigger on_dm_message_push after insert on public.dm_messages
  for each row execute function public.notify_push_new_message();
drop trigger if exists on_group_message_push on public.group_messages;
create trigger on_group_message_push after insert on public.group_messages
  for each row execute function public.notify_push_new_message();

notify pgrst, 'reload schema';

-- PARTE 30 — Tempo de uso do app (telão do modo 3D) (nov/2026)

create table if not exists public.app_usage_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  seconds integer not null default 0 check (seconds between 0 and 86400),
  last_ping timestamptz not null default now(),
  primary key (user_id, day)
);
alter table public.app_usage_daily enable row level security;
revoke all on public.app_usage_daily from anon, authenticated;

create or replace function public.track_app_usage(p_seconds integer default 300)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_day date := (now() at time zone 'America/Sao_Paulo')::date;
  v_last timestamptz;
  v_add integer;
begin
  if v_uid is null then
    return;
  end if;
  v_add := least(greatest(coalesce(p_seconds, 0), 0), 300);
  select max(last_ping) into v_last from public.app_usage_daily where user_id = v_uid;
  if v_last is not null then
    v_add := least(v_add, greatest(0, floor(extract(epoch from (now() - v_last)))::integer));
  end if;
  insert into public.app_usage_daily as u (user_id, day, seconds, last_ping)
  values (v_uid, v_day, v_add, now())
  on conflict (user_id, day) do update
    set seconds = least(86400, u.seconds + excluded.seconds),
        last_ping = now();
end;
$$;
revoke execute on function public.track_app_usage(integer) from public, anon;
grant execute on function public.track_app_usage(integer) to authenticated;

create or replace function public.get_friends_app_usage(p_days integer default 7)
returns table (user_id uuid, display_name text, username text, avatar_url text, seconds bigint)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select auth.uid() as id
  ),
  circle as (
    select me.id as uid from me where me.id is not null
    union
    select case when f.user_id = me.id then f.friend_id else f.user_id end
    from public.friendships f, me
    where f.status = 'accepted' and me.id in (f.user_id, f.friend_id)
  )
  select p.id, p.display_name, p.username, p.avatar_url, coalesce(sum(u.seconds), 0)::bigint as seconds
  from circle c
  join public.profiles p on p.id = c.uid
  left join public.app_usage_daily u
    on u.user_id = c.uid
   and u.day > (now() at time zone 'America/Sao_Paulo')::date - greatest(1, least(coalesce(p_days, 7), 31))
  group by p.id, p.display_name, p.username, p.avatar_url
  order by 5 desc, p.username
  limit 20;
$$;
revoke execute on function public.get_friends_app_usage(integer) from public, anon;
grant execute on function public.get_friends_app_usage(integer) to authenticated;

notify pgrst, 'reload schema';

-- PARTE 31 — Modo Escritório: visual do mamaco sincronizado + emotes (nov/2026)
alter table public.profiles add column if not exists office_skin jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_office_skin_check') then
    alter table public.profiles add constraint profiles_office_skin_check
      check (office_skin is null or (jsonb_typeof(office_skin) = 'object' and octet_length(office_skin::text) <= 1024));
  end if;
end $$;

create or replace function public.realtime_topic_allowed(p_topic text, p_extension text, p_write boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_kind text;
  v_id uuid;
begin
  if auth.uid() is null or not public.mfa_requirement_met() then
    return false;
  end if;
  if p_extension is null or p_extension not in ('broadcast', 'presence') then
    return false;
  end if;

  if p_topic ~ '^pgc:[A-Za-z0-9_.:-]{1,200}$' then
    return not coalesce(p_write, true);
  end if;

  if p_topic = 'presence:online' then
    return not p_write or p_extension = 'presence';
  end if;

  if p_topic is null
     or p_topic !~ '^(voice|typing|office):[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return false;
  end if;
  v_kind := split_part(p_topic, ':', 1);
  v_id := split_part(p_topic, ':', 2)::uuid;

  if v_kind = 'voice' then
    return (not p_write or p_extension = 'presence') and public.can_access_voice_room(v_id);
  end if;
  if v_kind = 'typing' then
    return (not p_write or p_extension = 'broadcast') and public.can_access_typing_topic(v_id);
  end if;
  if v_kind = 'office' then
    return (not p_write or p_extension = 'broadcast') and public.is_server_member(v_id, auth.uid());
  end if;
  return false;
end;
$$;

revoke execute on function public.realtime_topic_allowed(text, text, boolean) from public, anon;
grant execute on function public.realtime_topic_allowed(text, text, boolean) to authenticated;

notify pgrst, 'reload schema';

-- PARTE 32 — Ranking dos minigames entre amigos (nov/2026)

create table if not exists public.minigame_bests (
  user_id uuid not null references auth.users(id) on delete cascade,
  game text not null check (game in ('kart', 'banana3d', 'cobra', 'memoria', 'reflexo')),
  value integer not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, game)
);
alter table public.minigame_bests enable row level security;
revoke all on public.minigame_bests from anon, authenticated;

create or replace function public.submit_minigame_score(p_game text, p_value integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_lower boolean;
  v_best integer;
begin
  if v_uid is null or p_value is null then
    return null;
  end if;
  if not (
       (p_game = 'kart' and p_value between 30000 and 1800000)
    or (p_game = 'banana3d' and p_value between 0 and 600)
    or (p_game = 'cobra' and p_value between 0 and 430)
    or (p_game = 'memoria' and p_value between 8 and 500)
    or (p_game = 'reflexo' and p_value between 100 and 3000)
  ) then
    return null;
  end if;
  v_lower := p_game in ('kart', 'memoria', 'reflexo');
  insert into public.minigame_bests as b (user_id, game, value, updated_at)
  values (v_uid, p_game, p_value, now())
  on conflict (user_id, game) do update
    set value = case when v_lower then least(b.value, excluded.value) else greatest(b.value, excluded.value) end,
        updated_at = case when (v_lower and excluded.value < b.value) or (not v_lower and excluded.value > b.value) then now() else b.updated_at end
  returning value into v_best;
  return v_best;
end;
$$;
revoke execute on function public.submit_minigame_score(text, integer) from public, anon;
grant execute on function public.submit_minigame_score(text, integer) to authenticated;

create or replace function public.get_friends_minigame_ranking(p_game text)
returns table (user_id uuid, display_name text, username text, avatar_url text, value integer, updated_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select auth.uid() as id
  ),
  circle as (
    select me.id as uid from me where me.id is not null
    union
    select case when f.user_id = me.id then f.friend_id else f.user_id end
    from public.friendships f, me
    where f.status = 'accepted' and me.id in (f.user_id, f.friend_id)
  )
  select p.id, p.display_name, p.username, p.avatar_url, b.value, b.updated_at
  from circle c
  join public.minigame_bests b on b.user_id = c.uid and b.game = p_game
  join public.profiles p on p.id = c.uid
  order by case when p_game in ('kart', 'memoria', 'reflexo') then b.value else -b.value end, b.updated_at
  limit 30;
$$;
revoke execute on function public.get_friends_minigame_ranking(text) from public, anon;
grant execute on function public.get_friends_minigame_ranking(text) to authenticated;

notify pgrst, 'reload schema';

-- PARTE 33 — Corrida de kart com a sala (nov/2026)
create or replace function public.realtime_topic_allowed(p_topic text, p_extension text, p_write boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_kind text;
  v_id uuid;
begin
  if auth.uid() is null or not public.mfa_requirement_met() then
    return false;
  end if;
  if p_extension is null or p_extension not in ('broadcast', 'presence') then
    return false;
  end if;

  if p_topic ~ '^pgc:[A-Za-z0-9_.:-]{1,200}$' then
    return not coalesce(p_write, true);
  end if;

  if p_topic = 'presence:online' then
    return not p_write or p_extension = 'presence';
  end if;

  if p_topic is null
     or p_topic !~ '^(voice|typing|office|kart):[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return false;
  end if;
  v_kind := split_part(p_topic, ':', 1);
  v_id := split_part(p_topic, ':', 2)::uuid;

  if v_kind = 'voice' then
    return (not p_write or p_extension = 'presence') and public.can_access_voice_room(v_id);
  end if;
  if v_kind = 'typing' then
    return (not p_write or p_extension = 'broadcast') and public.can_access_typing_topic(v_id);
  end if;
  if v_kind in ('office', 'kart') then
    return (not p_write or p_extension = 'broadcast') and public.is_server_member(v_id, auth.uid());
  end if;
  return false;
end;
$$;

revoke execute on function public.realtime_topic_allowed(text, text, boolean) from public, anon;
grant execute on function public.realtime_topic_allowed(text, text, boolean) to authenticated;

notify pgrst, 'reload schema';
