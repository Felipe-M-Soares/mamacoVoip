-- ============================================================
-- 013 — CORREÇÕES DA AUDITORIA DE SEGURANÇA/DESEMPENHO
--
-- Resultado de uma revisão completa das migrations 001–012 (RLS,
-- funções security definer, buckets, índices). Cada bloco abaixo diz
-- qual era o problema e o que muda. Nada aqui remove funcionalidade de
-- uso normal — só fecha brechas que um usuário mal-intencionado
-- (chamando a API direto, fora do app) conseguiria explorar.
--
-- IDEMPOTENTE: pode rodar quantas vezes quiser (CREATE OR REPLACE,
-- DROP ... IF EXISTS, IF NOT EXISTS, checagens em pg_constraint).
-- Rode DEPOIS das migrations 001 a 012, no SQL Editor do Supabase.
-- ============================================================


-- ================================================================
-- 0) Funções auxiliares usadas no resto do arquivo
-- ================================================================

-- A sessão atual cumpre o 2FA? Verdadeiro se a pessoa NÃO tem 2FA
-- ativado, ou se tem e a sessão já passou pelo código (aal2).
--
-- Por quê: até aqui o 2FA só era cobrado pela TELA do app
-- (MfaChallengeScreen). Quem soubesse só a senha de uma conta com 2FA
-- conseguia logar (sessão aal1) e usar a API REST/Realtime direto —
-- ler mensagens, DMs etc. — sem nunca digitar o código. As políticas
-- restritivas do item 12 usam isso pra exigir aal2 no banco também.
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

-- Membro está em "castigo" (timeout) agora?
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

-- Lista de permissões EFETIVAS do usuário logado num servidor (dono =
-- todas). Substitui as 9 chamadas separadas de has_permission() que o
-- app fazia toda vez que abria as configurações/menu de moderação.
create or replace function public.my_permissions(p_server_id uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then array[]::text[]
    when exists (select 1 from public.servers where id = p_server_id and owner_id = auth.uid())
      then array['administrator','manage_server','manage_roles','manage_channels','manage_messages',
                 'kick_members','ban_members','timeout_members','view_audit_log']
    when not exists (select 1 from public.server_members where server_id = p_server_id and user_id = auth.uid())
      then array[]::text[]
    else coalesce((
      select array_agg(distinct u.perm)
      from public.server_member_roles smr
      join public.roles r on r.id = smr.role_id
      cross join lateral unnest(r.permissions) as u(perm)
      where smr.server_id = p_server_id and smr.user_id = auth.uid()
    ), array[]::text[])
  end;
$$;

-- Nome de usuário livre? Usado no cadastro (a pessoa ainda não está
-- logada, por isso é liberada pra anon) pra avisar ANTES de criar a
-- conta — senão o gatilho handle_new_user troca "joao" por "joao1"
-- sem avisar ninguém. Só responde sim/não sobre um nome exato.
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

-- Permissões reconhecidas pelo app (ver PERMISSIONS em src/types/database.ts)
create or replace function public.valid_permissions()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['administrator','manage_server','manage_roles','manage_channels','manage_messages',
               'kick_members','ban_members','timeout_members','view_audit_log']::text[];
$$;

-- Gera um código de convite de 10 caracteres [A-Za-z0-9] usando
-- gen_random_uuid() (aleatoriedade criptográfica). O código antigo
-- (md5(random())) tinha só 8 caracteres hexadecimais (~4 bilhões de
-- combinações) e vinha de random(), que NÃO é criptográfico — dava pra
-- varrer convites por força bruta.
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


-- ================================================================
-- 1) ALTO — funções sem "search_path" fixo.
--
-- is_group_member é SECURITY DEFINER e não fixava o search_path — um
-- objeto com o mesmo nome criado em outro schema no caminho de busca
-- podia ser usado no lugar do certo (ataque clássico de
-- "search_path hijacking"). As outras são funções de gatilho comuns;
-- fixar o caminho é boa prática (e some com o aviso do Security
-- Advisor do Supabase).
-- ================================================================
alter function public.is_group_member(uuid, uuid) set search_path = public;
alter function public.handle_updated_at() set search_path = public;
alter function public.handle_message_edited() set search_path = public;
alter function public.protect_group_conversation_owner() set search_path = public;
alter function public.debug_whoami() set search_path = public;


-- ================================================================
-- 2) ALTO — mensagens: dava pra MOVER uma mensagem pra qualquer canal
--    (inclusive de servidor alheio), forjar data de envio pra fugir do
--    limite anti-flood, e moderador conseguia EDITAR o texto dos outros.
--
-- a) A política "Autor edita a própria mensagem" só conferia
--    author_id — nunca impedia mudar channel_id/server_id. Bastava um
--    UPDATE na própria mensagem apontando pra um canal de outro
--    servidor (mesmo um que você nunca entrou) pra ela aparecer lá.
-- b) A política "messages_pin_update" (quem tem manage_messages) não
--    tem WITH CHECK nem limite de coluna — o moderador podia reescrever
--    o CONTEÚDO da mensagem de qualquer um.
-- c) created_at vinha do cliente se ele mandasse: com created_at no
--    passado, o gatilho de rate limit (conta mensagens dos últimos 10s)
--    e o modo lento nunca enxergavam a mensagem — flood ilimitado.
-- d) system_event ("fulano entrou no servidor") podia ser forjado.
-- e) reply_to_id/thread_id podiam apontar pra mensagem/thread de
--    outro canal.
--
-- RLS não restringe coluna, então a correção é um gatilho. Só vale
-- pra chamadas vindas da API (papel "authenticated"/"anon"); funções
-- internas (security definer, dono postgres) continuam livres.
-- ================================================================
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
    -- reply_to_id só pode virar NULL (é o que o "on delete set null"
    -- faz quando a mensagem respondida é apagada)
    or (new.reply_to_id is distinct from old.reply_to_id and new.reply_to_id is not null)
  then
    raise exception 'Não é permitido alterar esses campos da mensagem';
  end if;

  -- Quem não é o autor (moderador fixando) só mexe em pinned_at/pinned_by.
  if old.author_id is distinct from auth.uid() and new.content is distinct from old.content then
    raise exception 'Só o autor pode editar o conteúdo da mensagem';
  end if;

  if new.pinned_at is distinct from old.pinned_at then
    -- Quem fixou é sempre quem está fazendo a ação (não dá pra forjar).
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

-- O gatilho de fixar da migration 011 era SECURITY DEFINER e rodava
-- também quando o próprio banco mexe na linha — ex.: ao EXCLUIR A
-- CONTA de alguém que já fixou mensagens, o "on delete set null" de
-- pinned_by disparava o gatilho, has_permission() dava falso e a
-- exclusão da conta inteira falhava. Agora só vale pra chamadas da API
-- e ignora pinned_by virando NULL sozinho.
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

-- Garante o WITH CHECK na política de fixar (antes caía no USING).
drop policy if exists "messages_pin_update" on public.messages;
create policy "messages_pin_update"
  on public.messages for update to authenticated
  using (public.has_permission(server_id, auth.uid(), 'manage_messages'))
  with check (public.has_permission(server_id, auth.uid(), 'manage_messages'));

-- Rate limit: índice próprio pro COUNT do gatilho (antes varria todas
-- as mensagens do autor).
create index if not exists messages_author_created_idx on public.messages (author_id, created_at desc);
-- Modo lento: max(created_at) por canal+autor.
create index if not exists messages_channel_author_created_idx on public.messages (channel_id, author_id, created_at desc);


-- ================================================================
-- 3) ALTO — DMs 1-pra-1 e em grupo: mesma falha de "mover" mensagem.
--
-- dm_messages: o autor podia trocar conversation_id e jogar uma
-- mensagem (com o nome dele) dentro da conversa privada de outras
-- duas pessoas. group_messages: a política de UPDATE nem tinha WITH
-- CHECK — dava pra trocar group_id da mesma forma. Grupo também não
-- tinha limite anti-flood nenhum.
-- ================================================================
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

-- edited_at automático no grupo também (DM e canal já tinham)
drop trigger if exists on_group_message_edited on public.group_messages;
create trigger on_group_message_edited
  before update on public.group_messages
  for each row execute function public.handle_message_edited();

-- Rate limit do grupo (mesma regra dos canais/DMs: 8 a cada 10s)
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


-- ================================================================
-- 4) CRÍTICO — qualquer pessoa conseguia ENTRAR em qualquer grupo de DM.
--
-- A política de insert em group_conversation_members aceitava
-- "user_id = auth.uid()" sozinho — ou seja, qualquer usuário logado
-- que soubesse (ou achasse) o id de um grupo se adicionava nele e
-- passava a ler todo o histórico. Agora só quem CRIOU o grupo adiciona
-- membros (é exatamente o que o app faz em createGroup), e nunca
-- alguém que bloqueou/foi bloqueado por quem está adicionando.
--
-- Aproveita pra: deixar o criador ver o grupo logo após criar
-- (insert().select() precisa disso, antes de existirem membros), e
-- permitir que o criador apague o grupo (o app faz isso quando a
-- criação falha no meio).
-- ================================================================
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


-- ================================================================
-- 5) ALTO — escalada de privilégio pelos cargos.
--
-- Com a permissão "manage_roles" (sem ser administrador), dava pra:
--  - update_role no PRÓPRIO cargo (ou em qualquer cargo acima do seu)
--    adicionando 'administrator' → virava admin do servidor;
--  - create_role com permissões que você mesmo não tem;
--  - remove_role/delete_role em cargos ACIMA do seu (tirar o cargo
--    de admin de quem está acima);
--  - assign_role em quem nem é membro do servidor.
-- remove_timeout também não respeitava hierarquia, e timeout_member
-- aceitava minutos negativos/absurdos.
--
-- Regras novas (iguais às do Discord): só mexe em cargos ABAIXO do seu
-- cargo mais alto, e só concede permissões que você mesmo tem (dono e
-- administrador têm todas). Assinaturas das funções não mudam.
-- ================================================================

-- Confere nome/cor/permissões de um cargo e se o autor da ação pode
-- conceder essas permissões. Levanta exceção se algo estiver errado.
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
  -- Dono pode tudo; os demais só ACRESCENTAM permissões que eles
  -- mesmos têm (renomear um cargo que já tinha uma permissão que você
  -- não tem continua permitido).
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
    -- Quem não é dono cria o cargo logo ABAIXO do próprio cargo mais
    -- alto (antes ia pro topo, acima de quem criou, e aí nem ele
    -- conseguia mais editar/atribuir o cargo que acabou de criar).
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

-- Índices pras junções de cargo (has_permission/top_role_position/
-- user_has_channel_role_access rodam em quase toda política de RLS).
create index if not exists server_member_roles_role_idx on public.server_member_roles (role_id);
create index if not exists channel_role_access_role_idx on public.channel_role_access (role_id);


-- ================================================================
-- 6) MÉDIO — convites: código fraco, contagem de uso com corrida e
--    parâmetros sem limite.
--
-- - Código novo: 10 caracteres [A-Za-z0-9] de fonte criptográfica
--   (~59 bits) em vez de 8 hex de random() (32 bits). Convites antigos
--   continuam funcionando.
-- - join: trava a linha do convite (FOR UPDATE) — antes dois cliques
--   simultâneos podiam passar do max_uses; não gasta um "uso" de quem
--   já é membro; exige estar logado; confere o formato do código.
-- - create: max_uses 1–1000 e validade 1h–1 ano (antes aceitava
--   negativo/zero/absurdo); limite de 50 convites ativos por servidor.
-- ================================================================
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

  -- Já é membro: só devolve o servidor, sem gastar um uso do convite.
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

create index if not exists server_invites_created_by_idx on public.server_invites (created_by);


-- ================================================================
-- 7) MÉDIO — perfil: colunas livres demais.
--
-- A política de UPDATE do perfil libera a LINHA inteira; qualquer
-- coluna podia receber qualquer valor pela API: username fora do padrão
-- (espaços, emoji, "everyone", 5000 caracteres, igual a outro só
-- mudando maiúscula), display_name/status gigantes, e avatar/banner/
-- decoração apontando pra QUALQUER URL (rastreador de IP de quem abre
-- o perfil, "javascript:", arquivo de outra pessoa...).
-- Agora: regras de formato/tamanho só quando o campo MUDA (dados
-- antigos não quebram), e as URLs de imagem precisam ser do próprio
-- Storage, dentro da pasta do próprio usuário.
-- ================================================================
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
     and new.avatar_url !~ ('^https?://[^/?#]+/storage/v1/object/public/avatars/' || new.id::text || '/[^?#]+$') then
    raise exception 'URL de avatar inválida';
  end if;
  if new.banner_url is distinct from old.banner_url and new.banner_url is not null
     and new.banner_url !~ ('^https?://[^/?#]+/storage/v1/object/public/profile-banners/' || new.id::text || '/[^?#]+$') then
    raise exception 'URL de banner inválida';
  end if;
  if new.avatar_decoration_url is distinct from old.avatar_decoration_url and new.avatar_decoration_url is not null
     and new.avatar_decoration_url !~ ('^https?://[^/?#]+/storage/v1/object/public/avatar-decorations/' || new.id::text || '/[^?#]+$') then
    raise exception 'URL de decoração inválida';
  end if;

  return new;
end;
$$;

-- banner_url/avatar_decoration_url existem desde a fase de
-- personalização de perfil; garante as colunas antes do gatilho
-- (bancos muito antigos).
alter table public.profiles add column if not exists banner_url text;
alter table public.profiles add column if not exists avatar_decoration_url text;

drop trigger if exists on_profile_update_guard on public.profiles;
create trigger on_profile_update_guard
  before update on public.profiles
  for each row execute function public.guard_profile_update();

-- Username único SEM diferenciar maiúsculas (a busca de amigo já usa
-- lower(username)). Só cria se não houver duplicatas antigas — se
-- houver, o aviso aparece e o resto da migration continua.
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

-- Cadastro: limita o username gerado a 32 caracteres (antes um e-mail
-- com parte local longa gerava username gigante) e garante mínimo de 3.
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


-- ================================================================
-- 8) MÉDIO — URLs de anexos/emoji/ícones: "javascript:" no href.
--
-- file_url dos anexos vem do cliente e é usado direto como link
-- (<a href={att.file_url}>) na tela de quem recebe. Um anexo inserido
-- pela API com file_url = 'javascript:...' virava XSS armazenado ao
-- clicar (roubo de sessão). Agora o banco só aceita http(s).
-- Constraints NOT VALID: valem pra linhas novas/alteradas, não
-- quebram dados antigos.
-- ================================================================
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('message_attachments', 'message_attachments_file_url_http', 'file_url ~* ''^https?://'''),
      ('dm_message_attachments', 'dm_message_attachments_file_url_http', 'file_url ~* ''^https?://'''),
      ('group_message_attachments', 'group_message_attachments_file_url_http', 'file_url ~* ''^https?://'''),
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


-- ================================================================
-- 9) MÉDIO — Storage.
--
-- a) Bucket "attachments": a política de DELETE deixava QUALQUER membro
--    do servidor apagar QUALQUER anexo daquele servidor (o nome dizia
--    "próprios anexos", mas a condição só olhava a pasta do servidor).
--    Agora: só quem enviou o arquivo, ou quem tem manage_messages.
-- b) dm-attachments/group-attachments: não tinham política de DELETE
--    (ninguém conseguia apagar o próprio arquivo). Agora o dono apaga.
-- c) soundboard: as políticas do bucket nunca foram versionadas no
--    repositório. Cria as corretas (membro envia na pasta do servidor;
--    quem enviou ou moderador apaga). ATENÇÃO: se no painel existirem
--    políticas antigas mais permissivas com outro nome, elas continuam
--    valendo (políticas somam) — confira em Storage → Policies.
-- ================================================================
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

-- delete_soundboard_sound: (1) com uploaded_by NULL (quem enviou apagou
-- a conta) a condição "uploaded_by <> auth.uid()" dava NULL e deixava
-- QUALQUER pessoa (até de fora do servidor) apagar o som; (2) as
-- versões novas do Storage do Supabase proíbem DELETE direto em
-- storage.objects — isso fazia a função inteira falhar. Agora o
-- arquivo é apagado pelo app (Storage API) e aqui só a linha.
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
    -- Storage novo bloqueia DELETE direto — o app remove o arquivo pela API.
    null;
  end;
end;
$$;


-- ================================================================
-- 10) MÉDIO — timeout ("castigo") só bloqueava mensagem de texto.
--
-- Quem estava em timeout ainda conseguia reagir, criar thread e subir
-- som no soundboard. Agora essas ações também respeitam o timeout.
-- ================================================================
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
    )
  );

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

-- RSVP só em evento de servidor do qual você é membro (antes bastava
-- ter o id do evento).
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

-- Evento: canal informado precisa ser do mesmo servidor.
drop policy if exists "server_events_insert" on public.server_events;
create policy "server_events_insert"
  on public.server_events for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.has_permission(server_id, auth.uid(), 'manage_channels')
    and (channel_id is null or public.channel_server_id(channel_id) = server_id)
  );


-- ================================================================
-- 11) MÉDIO — denúncias, pedidos de amizade e servidor: limites.
-- ================================================================

-- Denúncia de mensagem: só de mensagem que você consegue ver (antes dava
-- pra "denunciar" qualquer id e, pela própria denúncia devolvida,
-- descobrir o autor e o servidor de mensagens de servidores alheios).
-- Limite: 10 denúncias a cada 10 minutos por pessoa.
create or replace function public.limit_reports()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_server_id uuid;
begin
  if (select count(*) from public.reports
      where reporter_id = auth.uid() and created_at > now() - interval '10 minutes') >= 10 then
    raise exception 'Você enviou muitas denúncias em pouco tempo. Aguarde alguns minutos.';
  end if;

  if new.target_type = 'message' and new.message_id is not null then
    select server_id into v_server_id from public.messages where id = new.message_id;
    if v_server_id is null or not public.is_server_member(v_server_id, auth.uid()) then
      raise exception 'mensagem não encontrada';
    end if;
  end if;
  return new;
end;
$$;

-- Nome começa com "a" pra rodar ANTES de before_insert_report (gatilhos
-- do mesmo tipo rodam em ordem alfabética).
drop trigger if exists a_limit_reports on public.reports;
create trigger a_limit_reports
  before insert on public.reports
  for each row execute function public.limit_reports();

create index if not exists reports_message_idx on public.reports (message_id) where message_id is not null;
create index if not exists reports_reported_user_idx on public.reports (reported_user_id);

-- Pedido de amizade: limite de 20 pedidos enviados por hora (antes dava
-- pra disparar pedido pra todo mundo em loop).
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
    -- Mesma mensagem de "não encontrado" pra não revelar o bloqueio.
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

-- Servidor: AFK precisa ser um canal de VOZ do próprio servidor, e o
-- dono não pode "passar" o servidor mudando owner_id pela API (não há
-- função de transferência; se um dia houver, que seja uma função
-- própria com checagens).
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
  return new;
end;
$$;

drop trigger if exists on_server_update_guard on public.servers;
create trigger on_server_update_guard
  before update on public.servers
  for each row execute function public.guard_server_update();

-- Canal/categoria: não dá pra "mover" pra outro servidor via UPDATE
-- (a política de UPDATE não tinha WITH CHECK próprio).
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
  -- (IF aninhado: em "categories" o registro não tem category_id, e o
  -- PL/pgSQL não faz curto-circuito na mesma expressão.)
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

-- Excluir a própria conta exige 2FA concluído (se a pessoa tiver 2FA).
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


-- ================================================================
-- 12) ALTO — 2FA cobrado no banco (políticas RESTRITIVAS).
--
-- Ver mfa_requirement_met() no topo. Uma política "as restrictive" é
-- somada com E (não OU) às políticas existentes: pra quem NÃO tem 2FA
-- nada muda; pra quem tem, a API só responde depois do código.
-- Aplicada em todas as tabelas do schema public que têm RLS ligado.
-- ================================================================
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


-- ================================================================
-- 13) MÉDIO — funções chamáveis por ANÔNIMO.
--
-- O Supabase dá EXECUTE pra "anon" em toda função nova do schema
-- public (por "default privileges" — por isso o REVOKE ... FROM PUBLIC
-- da migration 011 não adiantava: anon tem o GRANT dele próprio).
-- Nenhuma RPC do app faz sentido sem login, então tira de anon/public
-- e deixa só pra authenticated. Exceção: is_username_available (usada
-- na tela de cadastro, antes de existir sessão).
-- ================================================================
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

-- Funções criadas no futuro por este mesmo papel também nascem sem anon.
alter default privileges in schema public revoke execute on functions from public, anon;


-- ================================================================
-- 14) Índices em chaves estrangeiras / filtros frequentes.
--
-- Sem índice em FK, apagar um servidor/usuário/mensagem (cascade) varre
-- a tabela filha inteira, e as políticas de RLS que filtram por essas
-- colunas ficam lentas conforme o banco cresce.
-- ================================================================
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
