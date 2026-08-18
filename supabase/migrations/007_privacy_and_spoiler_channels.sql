-- ============================================================
-- Nota em pedido de amizade + privacidade de perfil + canal spoiler
-- Rode isto no SQL Editor do Supabase, depois da
-- 006_content_constraint_fixes.sql
-- ============================================================

-- --- 1) Nota ao enviar pedido de amizade -------------------------
alter table public.friendships add column if not exists request_note text check (char_length(request_note) <= 200);

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

-- --- 2) Privacidade de perfil -------------------------------------
-- 'everyone' = qualquer um que compartilhe um servidor vê o perfil
-- completo (padrão). 'friends_only' = só amigos veem o perfil
-- completo; o resto vê uma versão limitada (isso é reforçado no
-- app, não no banco, porque o app ainda precisa enxergar nome/foto
-- básicos de qualquer um no mesmo servidor pro chat funcionar).
alter table public.profiles add column if not exists profile_visibility text not null default 'everyone'
  check (profile_visibility in ('everyone', 'friends_only'));

-- --- 3) Canal "spoiler" (conteúdo borrado até clicar pra revelar) --
alter table public.channels add column if not exists is_spoiler boolean not null default false;
