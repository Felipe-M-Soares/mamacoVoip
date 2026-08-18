-- ============================================================
-- Modo lento por canal + notificação "só menções" — rode isto no
-- SQL Editor do Supabase, depois da 021_group_dms.sql
-- ============================================================

-- --- 1) Modo lento (slowmode) configurável por canal -------------
alter table public.channels add column if not exists slowmode_seconds integer not null default 0;

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

-- --- 2) Notificação "só menções" por canal ------------------------
alter table public.channel_mutes add column if not exists mentions_only boolean not null default false;
