-- ============================================================
-- 007 — SEGURANÇA E RECURSOS 2026 (antigas migrations 013 a 017,
--       juntas, + apagar grupos)
--
-- Conteúdo, na ordem: antigas 013_audit_fixes, 014_move_members,
-- 015_nsfw_channels, 016_security_hardening_2, 017_private_attachments
-- e, no fim, as partes novas "APAGAR GRUPOS", "NÃO LIDOS NUMA CONSULTA SÓ"
-- e "PARTE 19 — REVISÃO FINAL" (que redefine algumas funções/políticas
-- de cima; onde isso acontece há um aviso "(Redefinida na PARTE 19…)").
--
-- Ao juntar, as definições repetidas foram removidas: quando uma função
-- (CREATE OR REPLACE, mesma assinatura) ou política (DROP + CREATE, mesmo
-- nome) era redefinida mais abaixo neste mesmo arquivo, ficou só a
-- última versão. Onde a primeira aparição era necessária pela ordem (um
-- gatilho criado logo depois precisa da função), a versão FINAL subiu
-- pro lugar da primeira. Cada ponto removido deixou um comentário
-- dizendo onde está a versão que vale. O resultado no banco é o mesmo
-- de rodar 013, 014, 015, 016 e 017 originais em sequência.
--
-- IDEMPOTENTE DE PONTA A PONTA: pode rodar quantas vezes quiser, inclusive
-- num banco que já tenha rodado qualquer uma das antigas 013..017.
-- Rode DEPOIS de 001..006 (ou das antigas 001..012), no SQL Editor do
-- Supabase. (Ver supabase/README.md.)
-- ============================================================


-- ##################################################################
-- PARTE 013 (antiga 013_audit_fixes.sql)
-- ##################################################################

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

-- my_permissions(p_server_id): lista de permissões EFETIVAS do usuário
-- logado num servidor (dono = todas). Substitui as 9 chamadas separadas
-- de has_permission() que o app fazia. Versão final (com move_members
-- e 2FA) na parte 016, item 7.

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

-- valid_permissions(): permissões reconhecidas pelo app (ver PERMISSIONS
-- em src/types/database.ts). Definida na parte 014, item 1.

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

-- (group_conversations_select/_delete e group_members_insert: versão
-- final na PARTE 19, item 19.3 — só membro vê o grupo.)
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
-- Regras novas (iguais às de apps de chat populares): só mexe em cargos ABAIXO do seu
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

-- (Redefinida na PARTE 19, item 19.4 — hierarquia de quem baniu.)
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

-- (Redefinida na PARTE 19, item 19.4 — sem tirar o próprio castigo.)
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
-- create_server_invite(): versão final (com tudo acima + 2FA) na parte
-- 016, item 7.

-- join_server_via_invite(): versão final (com tudo acima + 2FA) na
-- parte 016, item 7.

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
-- (Versão final: as URLs de imagem são conferidas por
-- is_trusted_storage_url(), da parte 016 item 5 — a regra de "pasta
-- do próprio usuário" continua a mesma.)
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
-- (Pro file_url dos anexos a regra final é *_file_url_safe, parte
-- 017 item 4: http(s) OU caminho dentro do bucket.)
-- Constraints NOT VALID: valem pra linhas novas/alteradas, não
-- quebram dados antigos.
-- ================================================================
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

-- (soundboard_objects_insert: versão final na PARTE 19, item 19.5.)
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
-- (Versão final de delete_soundboard_sound, com 2FA: parte 016, item 7.)


-- ================================================================
-- 10) MÉDIO — timeout ("castigo") só bloqueava mensagem de texto.
--
-- Quem estava em timeout ainda conseguia reagir, criar thread e subir
-- som no soundboard. Agora essas ações também respeitam o timeout.
-- ================================================================
-- Reações e threads: as políticas "Membros reagem com o próprio
-- usuário" e "threads_insert" (com timeout E acesso ao canal) estão
-- na parte 016, item 3.


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
-- (Versão final: inclui o ajuste B10 da parte 016, item 8 — só
-- denuncia mensagem de canal que você consegue ver.)
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
-- (Versão final de send_friend_request, com 2FA: parte 016, item 7.)

-- Servidor: AFK precisa ser um canal de VOZ do próprio servidor, e o
-- dono não pode "passar" o servidor mudando owner_id pela API (não há
-- função de transferência; se um dia houver, que seja uma função
-- própria com checagens).
-- (Versão final: inclui o ajuste da parte 016, item 5 — ícone/banner
-- só do bucket server-icons, na pasta do próprio servidor.)
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
-- O laço que cria as políticas está na parte 016, item 9 (roda depois
-- de criadas todas as tabelas, então cobre todas de uma vez).


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


-- ##################################################################
-- PARTE 014 (antiga 014_move_members.sql)
-- ##################################################################

-- ============================================================
-- 014 — MOVER MEMBROS ENTRE CANAIS DE VOZ ("arrastar" estilo apps de chat)
--
-- Dono do servidor (ou quem tem a permissão nova `move_members`, ou
-- `administrator`) pode arrastar alguém de uma sala de voz pra outra.
--
-- Por que uma tabela + RPC em vez de um broadcast do Realtime: o
-- payload de broadcast é montado pelo próprio cliente — qualquer um
-- poderia forjar um "você foi movido" e ficar jogando os outros de
-- sala em sala. Aqui só a função move_voice_member() (security
-- definer, que confere permissão, filiação, tipo do canal e hierarquia
-- de cargos) grava em voice_move_requests; o app do alvo escuta os
-- INSERTs dessa tabela via postgres_changes (que respeita a RLS: cada
-- um só recebe as linhas em que é o alvo) e troca de sala sozinho.
--
-- IDEMPOTENTE: pode rodar quantas vezes quiser. Rode DEPOIS da 013.
-- ============================================================


-- ================================================================
-- 1) Permissão nova: move_members
--
-- valid_permissions() (e my_permissions(), versão final na parte 016)
-- têm a lista fixa —
-- precisam conhecer a permissão nova, senão create_role/update_role
-- recusam o cargo e o dono não aparece com ela no app.
-- ================================================================
create or replace function public.valid_permissions()
returns text[]
language sql
immutable
set search_path = public
as $$
  select array['administrator','manage_server','manage_roles','manage_channels','manage_messages',
               'kick_members','ban_members','timeout_members','view_audit_log','move_members']::text[];
$$;



-- ================================================================
-- 2) Log de moderação: ação nova 'member_moved'
--
-- A checagem de "action" foi criada inline na 004 (nome gerado pelo
-- Postgres). Troca por uma com nome fixo que inclui a ação nova.
-- ================================================================
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


-- ================================================================
-- 3) Tabela de pedidos de "mover" (só a RPC escreve)
-- ================================================================
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

-- Só leitura, e só das próprias linhas (é isso que filtra o
-- postgres_changes: o Realtime entrega um INSERT só pra quem passa na
-- política de SELECT). Nenhuma política de insert/update/delete —
-- ninguém escreve direto, só via move_voice_member().
drop policy if exists "Alvo vê os próprios pedidos de mover" on public.voice_move_requests;
create policy "Alvo vê os próprios pedidos de mover"
  on public.voice_move_requests for select to authenticated
  using (target_user_id = (select auth.uid()));

-- Mesma regra da 013 (item 12): com 2FA ativado, só responde em sessão aal2.
drop policy if exists "Exige 2FA quando ativado" on public.voice_move_requests;
create policy "Exige 2FA quando ativado"
  on public.voice_move_requests as restrictive for all to authenticated
  using ((select public.mfa_requirement_met())) with check ((select public.mfa_requirement_met()));

revoke all on table public.voice_move_requests from public, anon, authenticated;
grant select on table public.voice_move_requests to authenticated;

-- Realtime (postgres_changes) precisa da tabela na publicação.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'voice_move_requests'
  ) then
    alter publication supabase_realtime add table public.voice_move_requests;
  end if;
end $$;


-- ================================================================
-- 4) RPC: move_voice_member
--
-- Valida tudo no banco e grava o pedido. Quem de fato troca de sala é
-- o app do alvo (a conexão de voz/LiveKit é dele) — se ele não estiver
-- numa sala de voz desse servidor, o pedido é simplesmente ignorado.
-- ================================================================
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

  -- has_permission já trata dono (sempre true) e administrator.
  if not public.has_permission(p_server_id, v_caller, 'move_members') then
    raise exception 'Você não tem permissão para mover membros';
  end if;

  if not exists (select 1 from public.server_members where server_id = p_server_id and user_id = p_user_id)
     and not exists (select 1 from public.servers where id = p_server_id and owner_id = p_user_id) then
    raise exception 'Essa pessoa não é membro do servidor';
  end if;

  -- Hierarquia: não dá pra mover alguém com cargo igual ou superior ao
  -- seu (o dono do servidor fica sempre no topo). Mover a si mesmo pode.
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

  -- Canal restrito: o ALVO precisa conseguir entrar nele.
  if v_channel.is_restricted
     and not exists (select 1 from public.servers where id = p_server_id and owner_id = p_user_id)
     and not public.has_permission(p_server_id, p_user_id, 'manage_channels')
     and not public.user_has_channel_role_access(v_channel.id, p_user_id) then
    raise exception 'Essa pessoa não tem acesso ao canal de destino';
  end if;

  -- Anti-flood: no máximo 30 movimentações por minuto por pessoa.
  if (
    select count(*) from public.voice_move_requests
    where requested_by = v_caller and created_at > now() - interval '1 minute'
  ) >= 30 then
    raise exception 'Muitas movimentações seguidas — espere um pouco e tente de novo';
  end if;

  -- Limpeza: os pedidos só servem no instante em que chegam pelo Realtime.
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


-- ##################################################################
-- PARTE 015 (antiga 015_nsfw_channels.sql)
-- ##################################################################

-- ============================================================
-- 015 — CANAIS COM RESTRIÇÃO DE IDADE (+18)
--
-- Modelo de apps de chat populares: conteúdo adulto (inclusive GIFs com rating "r"
-- da GIPHY) só aparece em canais marcados como +18, e só pra quem
-- confirmou ser maior de idade.
--
--   * channels.is_nsfw — o dono / quem tem "manage_channels" liga em
--     "Editar canal". As políticas de UPDATE de channels já existentes
--     (001/004/011/013) continuam valendo: quem não pode editar o canal
--     não consegue mexer nessa coluna.
--   * profiles.age_verified_adult_at — quando a pessoa confirmou (no
--     portão do canal) que tem 18 anos ou mais. null = não confirmou
--     ou revogou nas Configurações.
--
-- Sobre os gatilhos da 013:
--   * guard_channel_update só barra trocar server_id e category_id
--     inválida — não lista colunas permitidas, então is_nsfw passa sem
--     precisar mexer nele.
--   * guard_profile_update também só valida colunas específicas
--     (username, textos, URLs) — age_verified_adult_at passa. Mesmo
--     assim, abaixo há um gatilho PRÓPRIO que carimba a hora do servidor
--     (a pessoa não consegue gravar uma data arbitrária pela API). Os
--     dois gatilhos são independentes, a ordem entre eles não importa.
--
-- IDEMPOTENTE: pode rodar quantas vezes quiser. Rode DEPOIS da 013.
-- ============================================================


-- ================================================================
-- 1) Coluna nos canais
-- ================================================================
alter table public.channels add column if not exists is_nsfw boolean not null default false;

comment on column public.channels.is_nsfw is
  'Canal com restrição de idade (+18): conteúdo só aparece pra quem confirmou ser maior de idade; o seletor de GIF usa rating "r".';


-- ================================================================
-- 2) Coluna no perfil
-- ================================================================
alter table public.profiles add column if not exists age_verified_adult_at timestamptz;

comment on column public.profiles.age_verified_adult_at is
  'Quando a pessoa confirmou ter 18 anos ou mais (autodeclaração). null = não confirmou / revogou.';


-- ================================================================
-- 3) Carimbo de hora do servidor na confirmação de idade
--
-- O cliente manda qualquer valor não-nulo; o banco troca por now().
-- Voltar pra null (revogar) é sempre permitido. Só vale pra chamadas
-- vindas da API (authenticated/anon) — funções internas/admin passam.
-- ================================================================
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


-- ================================================================
-- 4) Recarrega o cache de schema do PostgREST (a API passa a enxergar
--    as colunas novas na hora, sem esperar).
-- ================================================================
notify pgrst, 'reload schema';


-- ##################################################################
-- PARTE 016 (antiga 016_security_hardening_2.sql)
-- ##################################################################

-- ============================================================
-- 016 — ENDURECIMENTO DE SEGURANÇA, PARTE 2
--
-- Resultado de uma segunda revisão de segurança independente (depois da
-- 013). Cada bloco diz qual era o problema e o que muda:
--
--   A2  Realtime (broadcast/presence) sem autorização: canais privados +
--       políticas em realtime.messages; soundboard vira RPC + tabela.
--   A3  Canal restrito "vazava" por anexos, reações e threads.
--   M1  2FA cobrado também nas RPCs que faltavam e no Storage.
--   M3  Editar mensagem depois de ban/castigo/bloqueio.
--   M6  Confirmação de idade (+18) saiu de profiles (legível por todos)
--       pra user_private_settings (só o dono lê).
--   B1  URLs de imagem/anexo presas ao Storage do PRÓPRIO projeto
--       (antes qualquer host servia — imagem rastreadora de IP).
--   B5  Mensagens de canal +18 só pra quem confirmou a idade (no banco).
--   B9  reorder_channels aceitava categoria de outro servidor.
--   B10 Denúncia de mensagem de canal restrito que você não vê.
--
-- Além de rodar este arquivo, é preciso UM passo no painel (ver
-- supabase/README.md): Realtime → Settings → desligar "Allow public
-- access". Sem isso, um cliente modificado ainda consegue assinar os
-- tópicos como canal PÚBLICO, ignorando as políticas abaixo.
--
-- IDEMPOTENTE: pode rodar quantas vezes quiser. Rode DEPOIS da 015.
-- ============================================================


-- ================================================================
-- 0) Tabelas novas usadas pelas funções auxiliares
-- ================================================================

-- M6 — configurações privadas da conta (só o dono lê/escreve).
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

-- Carimbo da hora do servidor: a mesma função da 015 (ela só mexe em
-- NEW.age_verified_adult_at, serve pra qualquer tabela com essa coluna).
drop trigger if exists on_private_settings_age_verification_stamp on public.user_private_settings;
create trigger on_private_settings_age_verification_stamp
  before insert or update of age_verified_adult_at on public.user_private_settings
  for each row execute function public.stamp_profile_age_verification();

drop trigger if exists on_private_settings_updated_at on public.user_private_settings;
create trigger on_private_settings_updated_at
  before update on public.user_private_settings
  for each row execute function public.handle_updated_at();


-- ================================================================
-- 1) Funções auxiliares de acesso (usadas em RLS, RPCs e Realtime)
--
-- Todas respondem só sobre QUEM ESTÁ LOGADO (auth.uid()) — não recebem
-- o usuário por parâmetro, então não servem pra "sondar" o acesso de
-- outras pessoas.
-- ================================================================

-- Pode ver o canal? Membro do servidor e, se o canal for restrito, com
-- manage_channels (dono incluso) ou um cargo liberado. Mesma regra da
-- política "Membros veem canais do servidor" (004).
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

-- Confirmou ser maior de idade (no banco)?
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

-- Pode ler o CONTEÚDO do canal (mensagens/anexos/reações/threads)? Vê o
-- canal e, se ele for +18, confirmou a idade (B5).
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

-- Pode estar na sala de voz <p_room>? Mesma decisão da Edge Function
-- livekit-token: o id é de um canal de VOZ que você vê, de um grupo do
-- qual você é membro, ou de uma DM da qual você participa.
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

-- Pode ver/enviar "digitando..." em <p_id>? O id é de um canal de texto,
-- de uma thread, de um grupo ou de uma DM (ver useTypingIndicator nos
-- componentes ChatArea/ThreadPanel/GroupChatArea/DMChatArea). DM com
-- bloqueio entre as partes: nada.
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

-- Decide o acesso a um tópico do Realtime (A2). p_write = false: receber
-- (SELECT em realtime.messages); true: enviar (INSERT).
--   presence:online  — diretório global de "quem está online": qualquer
--                      logado recebe e se anuncia (só presence).
--   voice:<uuid>     — quem pode estar na sala; só presence é enviável
--                      (o soundboard saiu daqui, ver item 2).
--   typing:<uuid>    — quem lê o canal/thread/grupo/DM; só broadcast é
--                      enviável.
-- Receber da outra extensão (ex.: broadcast em voice:) é liberado pra
-- quem tem acesso ao tópico — ninguém consegue enviar nela mesmo, e
-- assim o "join" do canal privado não é recusado por falta de leitura.
-- (Redefinida na PARTE 19, item 19.1 — tópicos pgc:* de postgres_changes.)
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


-- ================================================================
-- 2) ALTO (A2) — Realtime broadcast/presence sem autorização.
--
-- Os tópicos voice:<id>, typing:<id> e presence:online eram canais
-- PÚBLICOS: qualquer logado (sabendo o id) via quem estava em qualquer
-- sala de voz, lia "fulano está digitando" de canais restritos/DMs
-- alheias e — pior — mandava broadcast 'soundboard-play' pra tocar
-- áudio no app de todo mundo numa call de outro servidor.
--
-- Agora o app assina esses tópicos com `private: true` e o Realtime só
-- deixa entrar/enviar quem passa nas políticas abaixo (Realtime
-- Authorization). IMPORTANTE: desligue "Allow public access" em
-- Realtime → Settings no painel, senão um cliente modificado ainda
-- consegue abrir o mesmo tópico como canal público.
--
-- Risco residual aceito: o conteúdo do broadcast/presence continua
-- vindo do cliente (ex.: o userId no "digitando..." ou a key da
-- presença) — o Realtime não carimba o remetente. O estrago fica
-- limitado a quem JÁ tem acesso àquele tópico.
-- ================================================================
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

-- Soundboard: em vez de broadcast (payload forjável, qualquer URL), a
-- RPC play_soundboard_sound valida e grava em soundboard_plays; o app
-- escuta INSERTs via postgres_changes filtrado por channel_id, e o
-- Realtime só entrega a linha pra quem passa na RLS de SELECT (quem vê o
-- canal de voz). Cada cliente resolve a URL pelo id do som.
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
  -- Palco: só quem pode falar (mesma regra do livekit-token).
  if v_channel.is_stage and not public.has_permission(v_channel.server_id, v_uid, 'manage_channels') then
    raise exception 'Só quem está no palco pode tocar sons';
  end if;

  select * into v_sound from public.soundboard_sounds where id = p_sound_id;
  if v_sound.id is null or v_sound.server_id <> v_channel.server_id then
    raise exception 'Som não encontrado neste servidor';
  end if;

  -- Anti-spam: no máximo 5 sons a cada 10 segundos por pessoa.
  if (
    select count(*) from public.soundboard_plays
    where played_by = v_uid and created_at > now() - interval '10 seconds'
  ) >= 5 then
    raise exception 'Calma! Muitos sons seguidos — espere um pouco.';
  end if;

  -- Limpeza: as linhas só servem no instante em que chegam pelo Realtime.
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


-- ================================================================
-- 3) ALTO (A3) + BAIXO (B5) — canal restrito / +18 vazava por tabelas
--    irmãs.
--
-- Anexos, reações e threads só conferiam "é membro do servidor": quem
-- não tinha acesso a um canal RESTRITO lia os anexos/reações/threads
-- dele pela API. Agora todas usam a mesma regra das mensagens
-- (can_read_channel_content), que também exige a confirmação de idade
-- em canais +18 (B5).
-- ================================================================

-- messages (SELECT): regra da 004 + idade em canal +18.
drop policy if exists "Membros veem mensagens do servidor" on public.messages;
create policy "Membros veem mensagens do servidor"
  on public.messages for select to authenticated
  using (public.can_read_channel_content(channel_id));

-- message_attachments
drop policy if exists "Membros veem anexos" on public.message_attachments;
create policy "Membros veem anexos"
  on public.message_attachments for select to authenticated
  using (
    exists (
      select 1 from public.messages m
      where m.id = message_id and public.can_read_channel_content(m.channel_id)
    )
  );

-- message_reactions
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

-- threads
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


-- ================================================================
-- 4) MÉDIO (M3) — editar depois de ban/castigo/bloqueio.
--
-- "Autor edita a própria mensagem" só conferia author_id: quem foi
-- banido/expulso, está de castigo ou perdeu acesso ao canal restrito
-- continuava editando as próprias mensagens antigas. Em DM, quem foi
-- bloqueado continuava editando as mensagens da conversa. O INSERT de
-- anexos também não olhava castigo/filiação.
-- ================================================================
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


-- ================================================================
-- 5) BAIXO (B1) — URLs de imagem/anexo presas ao Storage do projeto.
--
-- A 013 exigia o CAMINHO certo (/storage/v1/object/public/<bucket>/
-- <pasta do dono>/...), mas aceitava QUALQUER host — dava pra montar
-- https://site-do-atacante/storage/v1/object/public/avatars/<meu id>/x
-- e o app de quem abrisse o perfil/servidor/emoji buscava a imagem lá
-- (rastreamento de IP). Agora o host precisa ser:
--   * o valor de `app.settings.supabase_url`, se configurado (use isso
--     se o projeto tiver DOMÍNIO PRÓPRIO ou pra desenvolvimento local):
--       alter database postgres set app.settings.supabase_url = 'https://api.seudominio.com';
--   * senão, qualquer https://<ref>.supabase.co.
-- (Não dá pra saber o <ref> do projeto aqui dentro da migration — por
-- isso "*.supabase.co": um atacante até pode apontar pra outro projeto
-- Supabase, mas não pra um servidor arbitrário dele sem esse domínio.)
-- ================================================================
-- (Redefinida na PARTE 19, item 19.2 — host confiável = o do projeto.)
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
  -- Sem "..", barras/pontos codificados ou contrabarra (escapar da pasta).
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

-- Perfil: guard_profile_update() — a versão final (com esta checagem
-- de URL por is_trusted_storage_url) já foi aplicada na parte 013,
-- item 7, junto com o gatilho.

-- Servidor: guard_server_update() (013 + ícone/banner no bucket
-- server-icons, na pasta do próprio servidor) — versão final já
-- aplicada na parte 013, item 11, junto com o gatilho.

-- Servidor recém-criado: o app cria sem imagem e só depois faz UPDATE
-- (a pasta usa o id do servidor), mas pela API dava pra criar já com
-- icon_url/banner_url arbitrários.
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

-- Emoji do servidor: server-icons/<server_id>/...
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

-- Anexos: bucket e pasta esperados. Aceita a URL do Storage (pública,
-- autenticada ou assinada — pra conviver com buckets privados) ou o
-- CAMINHO puro dentro do bucket (caso o app passe a gravar só o path).
--   canal: attachments/<server_id>/<channel_id>/...
--   DM:    dm-attachments/<conversation_id>/...
--   grupo: group-attachments/<group_id>/...
-- (SECURITY INVOKER de propósito: em DEFINER, current_user viraria o
-- dono da função e a checagem de "veio da API" abaixo nunca valeria.)
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
  -- Caminho puro dentro do bucket.
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


-- ================================================================
-- 6) MÉDIO (M6) — confirmação de idade legível por qualquer um.
--
-- profiles.age_verified_adult_at (015) ficava no perfil, que qualquer
-- pessoa que te vê lê inteiro (select '*'): dava pra saber quem se
-- declarou maior de idade. Move pra user_private_settings (item 0, RLS
-- só do dono) e REMOVE a coluna do perfil — revogar SELECT só da coluna
-- não serve aqui, porque o app lê o perfil com select('*'), que passaria
-- a falhar pra todo mundo.
-- ================================================================
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


-- ================================================================
-- 7) MÉDIO (M1) — 2FA nas RPCs que ainda não cobravam.
--
-- A 013 cobrou 2FA nas tabelas (políticas restritivas) e nas RPCs de
-- moderação/cargos, mas várias funções SECURITY DEFINER (que passam por
-- cima da RLS) ainda respondiam a uma sessão só com senha (aal1) de
-- quem tem 2FA: entrar em servidor por convite, criar convite, pedir/
-- aceitar/remover amizade, bloquear, abrir DM, apagar som, reordenar
-- canais etc. Cada uma abaixo é a ÚLTIMA versão vigente (fonte
-- indicada), só com a checagem de 2FA acrescentada no começo — e, onde
-- indicado, a correção B9.
-- ================================================================

-- 013 (item 6)
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

-- 013 (item 6)
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

-- 013 (item 11)
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

-- 003
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

-- 003
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

-- 003
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

-- 003
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

-- 011 (item 8)
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

-- 009
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

-- 013 (item 9)
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
    -- Storage novo bloqueia DELETE direto — o app remove o arquivo pela API.
    null;
  end;
end;
$$;

-- 011 (item 9)
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

-- 001 + B9: a categoria de destino precisa ser do MESMO servidor dos
-- canais. Como a função é SECURITY DEFINER, o gatilho
-- guard_channel_update (013, que já barrava isso) não roda pra ela —
-- dava pra pendurar canais numa categoria de outro servidor.
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

-- 001
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

-- 014 (virou plpgsql só pra poder levantar o erro de 2FA; mesmo resultado)
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


-- ================================================================
-- 8) BAIXO (B10) — denúncia de mensagem que você não vê.
--
-- limit_reports (013) só conferia "é membro do servidor" — dava pra
-- denunciar (e, pela denúncia devolvida, descobrir o autor de)
-- mensagens de canais RESTRITOS aos quais você não tem acesso.
-- ================================================================
-- limit_reports(): a versão final (que também confere
-- can_view_channel) já foi aplicada na parte 013, item 11, junto
-- com o gatilho a_limit_reports.


-- ================================================================
-- 9) MÉDIO (M1) — 2FA no Storage e nas tabelas novas.
--
-- As políticas restritivas da 013 só cobriam o schema public. No
-- Storage (storage.objects) uma sessão aal1 de quem tem 2FA ainda
-- enviava/apagava arquivos. Restritiva = somada com E às demais.
-- Só pra "authenticated": leitura pública de bucket público não muda.
-- ================================================================
drop policy if exists "Exige 2FA quando ativado" on storage.objects;
create policy "Exige 2FA quando ativado"
  on storage.objects as restrictive for all to authenticated
  using ((select public.mfa_requirement_met()))
  with check ((select public.mfa_requirement_met()));

-- Mesmo laço da 013 (item 12): cobre as tabelas criadas aqui
-- (user_private_settings, soundboard_plays) e qualquer outra nova.
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
-- 10) Permissões de execução das funções novas/recriadas (nenhuma é
--     chamável por anon) e recarga do cache do PostgREST.
-- ================================================================
revoke execute on function public.guard_server_insert() from public, anon;
revoke execute on function public.guard_server_emoji() from public, anon;
revoke execute on function public.guard_attachment_url() from public, anon;
revoke execute on function public.my_permissions(uuid) from public, anon;
grant execute on function public.my_permissions(uuid) to authenticated;

notify pgrst, 'reload schema';


-- ##################################################################
-- PARTE 017 (antiga 017_private_attachments.sql)
-- ##################################################################

-- ============================================================
-- 017 — ANEXOS PRIVADOS (buckets sem acesso público + URLs assinadas)
--
-- Problema (ALTO): os buckets de anexos de mensagem — "attachments"
-- (servidor, 002), "dm-attachments" (003) e "group-attachments" (003) —
-- eram PÚBLICOS. A URL /storage/v1/object/public/<bucket>/<caminho>
-- baixava o arquivo SEM login, pra sempre, mesmo depois de a mensagem
-- ser apagada ou de a pessoa sair do servidor/grupo. Quem copiasse o
-- link (ou achasse ele num print, log, histórico de navegador) tinha o
-- arquivo; a RLS de SELECT das migrations 002/003 não valia pra esse
-- caminho público.
--
-- O que muda:
--   1) Os três buckets viram PRIVADOS (public = false). O endpoint
--      /object/public/ para de servir esses arquivos.
--   2) Leitura só por URL ASSINADA (createSignedUrl, ~1h), que o
--      Storage só emite pra quem passa na política de SELECT abaixo:
--        - dm-attachments   → participante da conversa (1º segmento do
--                             caminho = id da conversa);
--        - group-attachments→ membro do grupo (1º segmento = id do grupo);
--        - attachments      → membro do servidor (1º segmento) COM acesso
--                             ao canal (2º segmento = id do canal —
--                             canal restrito exige cargo liberado ou
--                             manage_channels). Objetos antigos cujo
--                             caminho não tem o canal caem pra "membro
--                             do servidor".
--      Tudo isso também exige o 2FA cumprido (mfa_requirement_met, 013).
--   3) Upload (INSERT) no bucket de servidor passa a exigir o caminho
--      "<server_id>/<channel_id>/..." com acesso ao canal e sem castigo
--      (timeout) ativo — antes bastava ser membro do servidor.
--   4) file_url dos anexos pode ser o CAMINHO dentro do bucket (formato
--      novo gravado pelo app) ou a URL antiga. A constraint
--      *_file_url_http da 013 (que só aceitava http) é trocada por
--      *_file_url_safe, e um gatilho confere que um caminho novo aponta
--      pra pasta da PRÓPRIA mensagem (não dá pra "apontar" o anexo pro
--      arquivo de outra conversa).
--   5) orphan_attachment_objects(): lista arquivos órfãos (mensagem já
--      apagada) pra uma limpeza periódica — ver o bloco 5.
--
-- Compatibilidade: linhas antigas com file_url = URL pública completa
-- continuam funcionando — o app extrai bucket+caminho da URL e gera a
-- URL assinada (src/lib/storageRef.ts / storageUrls.ts). Versões
-- ANTIGAS do app (que ainda usam a URL pública direto) deixam de exibir
-- anexos até atualizar.
--
-- IDEMPOTENTE: pode rodar quantas vezes quiser (esta parte e o arquivo
-- inteiro).
-- ============================================================


-- ================================================================
-- 0) Funções auxiliares
-- ================================================================

-- N-ésimo segmento do caminho do objeto como uuid, ou NULL se não for
-- um uuid válido. As políticas antigas faziam
-- "(storage.foldername(name))[1]::uuid" direto — um caminho com pasta
-- que não é uuid fazia a consulta inteira ESTOURAR (erro 22P02) em vez
-- de simplesmente negar.
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

-- O usuário atual pode LER o objeto `p_name` do bucket `p_bucket`?
-- security definer: consulta dm_conversations/channels sem reacionar a
-- RLS delas (mesma receita de is_server_member/has_permission).
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
    -- Formato "<server_id>/<channel_id>/<arquivo>": confere o canal.
    -- Formato antigo "<server_id>/<arquivo>" (sem canal): só membro.
    if array_length(string_to_array(p_name, '/'), 1) >= 3 then
      v_second := public.storage_path_uuid(p_name, 2);
      if v_second is null then
        return false;
      end if;
      select c.id, c.server_id, c.is_restricted into v_channel
      from public.channels c where c.id = v_second;
      if not found or v_channel.server_id <> v_first then
        -- Canal apagado (as mensagens foram junto) ou de outro servidor.
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

-- O usuário atual pode ENVIAR o objeto `p_name` pro bucket de anexos
-- de servidor? Exige o caminho completo "<server>/<canal>/<arquivo>",
-- acesso ao canal e nenhum castigo (timeout) ativo.
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


-- ================================================================
-- 1) Buckets privados
-- ================================================================
update storage.buckets
set public = false
where id in ('attachments', 'dm-attachments', 'group-attachments');


-- ================================================================
-- 2) Leitura (SELECT) — é o que o Storage consulta pra emitir a URL
--    assinada. Substitui as políticas de 002/003 (mesmos nomes).
-- ================================================================
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


-- ================================================================
-- 3) Envio (INSERT)
-- ================================================================
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

-- (DELETE continua como na 013: quem enviou apaga; no bucket de servidor
-- quem tem manage_messages também. O app apaga o arquivo logo depois de
-- apagar a mensagem.)


-- ================================================================
-- 4) file_url: aceita o CAMINHO dentro do bucket (formato novo) além
--    da URL http(s) antiga.
-- ================================================================
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
      -- http(s) OU caminho relativo "<uuid>/..." sem "..", "\", espaço
      -- nem esquema. NOT VALID: não revalida linhas antigas.
      execute format(
        'alter table public.%I add constraint %I check (%s) not valid',
        r.tbl, r.new_con,
        $expr$file_url ~* '^https?://' or (char_length(file_url) <= 1024 and file_url ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^\s\\]+$' and file_url !~ '(^|/)\.\.?(/|$)' and file_url !~ '//')$expr$
      );
    end if;
  end loop;
end $$;

-- Caminho novo tem que ser da pasta da PRÓPRIA mensagem:
--   attachments       → "<server_id>/<channel_id>/<message_id>-..."
--   dm-attachments    → "<conversation_id>/<message_id>-..."
--   group-attachments → "<group_id>/<message_id>-..."
-- (URLs completas antigas não passam por aqui — a validação delas é da
-- migration 016.)
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


-- ================================================================
-- 5) Arquivos órfãos (limpeza periódica RECOMENDADA)
--
-- O app apaga o arquivo do Storage logo depois de apagar a mensagem,
-- mas isso é best-effort: mensagem apagada em cascata (canal/servidor/
-- conversa excluídos, conta removida), moderador sem permissão no
-- Storage, app fechado no meio, versão antiga do app... deixam o
-- arquivo pra trás. Com o bucket privado ele já não é acessível por
-- link, mas continua ocupando espaço (e continua legível por quem ainda
-- é membro, se souber o caminho).
--
-- Esta função lista os objetos dos 3 buckets que NENHUMA linha de
-- anexo referencia (nem pelo caminho, nem pela URL antiga), mais velhos
-- que p_older_than (margem pro upload que ainda não gravou a linha).
-- Só service_role pode chamar. Uso sugerido: uma Edge Function
-- agendada (Supabase → Edge Functions → Schedules, ou pg_cron + pg_net)
-- que chama .rpc('orphan_attachment_objects') e depois
-- storage.from(bucket).remove(nomes) — pela API do Storage, NÃO com
-- DELETE direto em storage.objects (isso deixaria o arquivo físico pra
-- trás; versões novas do Supabase inclusive bloqueiam esse DELETE).
-- ================================================================
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


-- ##################################################################
-- PARTE NOVA — APAGAR GRUPOS (quem criou o grupo apaga tudo)
-- ##################################################################

-- ================================================================
-- 1) Quem criou o grupo? security definer: usada na política do
--    Storage abaixo sem reacionar a RLS de group_conversations.
-- ================================================================
-- (Redefinida na PARTE 19, item 19.3 — exige também ser membro.)
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


-- ================================================================
-- 2) Storage: o criador apaga QUALQUER arquivo da pasta do grupo
--    ("<group_id>/..."), não só os que ele mesmo enviou
--    (group_attachments_delete_own, parte 013, continua valendo pra
--    cada um apagar os próprios). Pela API do Storage — o Supabase
--    bloqueia DELETE direto em storage.objects.
-- ================================================================
drop policy if exists "group_attachments_delete_creator" on storage.objects;
create policy "group_attachments_delete_creator"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'group-attachments'
    and public.is_group_creator(public.storage_path_uuid(name, 1), auth.uid())
  );


-- ================================================================
-- 3) Lista os arquivos do grupo pra o app apagar pela API do Storage
--    ANTES de apagar o grupo (depois, ninguém mais passa na política
--    de leitura e os arquivos viram órfãos — a limpeza periódica de
--    orphan_attachment_objects, parte 017, pega o que sobrar).
--    Só o criador, e com o 2FA cumprido.
-- ================================================================
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


-- ================================================================
-- 4) Apagar o grupo em si: a política "group_conversations_delete"
--    (parte 013, item 4) já deixa só o criador apagar a linha, e as
--    chaves estrangeiras levam junto, em cascata, os membros
--    (group_conversation_members), as mensagens (group_messages) e as
--    linhas de anexo (group_message_attachments). Os índices que
--    deixam essa cascata rápida também já existem (parte 013, item 14).
--    Nada a criar aqui.
-- ================================================================


-- ================================================================
-- 5) Realtime: a lista de grupos atualiza sozinha.
--    - group_conversations: o app escuta DELETE (grupo apagado some da
--      lista de todo mundo na hora) e UPDATE (nome/ícone).
--    - group_conversation_members: o app escuta as PRÓPRIAS linhas
--      (entrou/saiu/foi adicionado). O GroupConversationsContext já
--      assinava essa tabela, mas ela nunca tinha sido adicionada à
--      publicação — o evento simplesmente não chegava.
--    Observação: o Realtime não aplica RLS nem filtro em DELETE (só
--    manda a chave primária da linha apagada); o app confere o id
--    antes de reagir.
-- ================================================================
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


-- ##################################################################
-- PARTE NOVA — NÃO LIDOS NUMA CONSULTA SÓ (menos egress e carga no banco)
-- ##################################################################

-- ================================================================
-- Bolinhas de "não lido" numa consulta só.
--
-- Antes, a cada 20s (com o app visível), cada pessoa fazia 7 consultas
-- (useUnreadOverview.ts) e baixava até 1.000 linhas de `messages` + 1.000
-- de `dm_messages` só pra descobrir a última mensagem de cada canal/DM.
-- Com o banco crescendo, isso vira a maior fonte de EGRESS e de carga no
-- banco (a RLS de `messages` roda em cada uma dessas linhas).
--
-- unread_overview() devolve só os canais/DMs COM mensagem mais nova que a
-- última leitura — normalmente 0 a poucas linhas. Uma busca por índice
-- (messages_channel_created_idx / dm_messages_conversation_idx) por
-- canal/DM. SECURITY INVOKER (o padrão): a RLS de sempre continua valendo
-- — canal restrito/+18 sem acesso nunca aparece (e é descartado antes de
-- olhar as mensagens, via can_read_channel_content).
-- O app usa a consulta antiga se esta função ainda não existir.
-- ================================================================
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


-- ##################################################################
-- PARTE 19 — REVISÃO FINAL (terceira revisão de segurança independente)
-- ##################################################################
--
-- IDEMPOTENTE como o resto do arquivo. Onde uma função/política já
-- definida acima é redefinida aqui, VALE A DESTA PARTE (ela roda por
-- último). Itens:
--   1) Realtime: tópicos `pgc:*` (postgres_changes em canal privado).
--   2) is_trusted_storage_url: host confiável = o do PRÓPRIO projeto.
--   3) Grupo: quem criou e saiu perde o acesso (SELECT/token/apagar).
--   4) remove_timeout sem "tirar o próprio castigo"; unban_member
--      respeita a hierarquia de quem baniu.
--   5) Buckets públicos: sem listagem ampla; soundboard amarrado à
--      linha criada + limites por servidor/pessoa.
--   6) Aceite dos termos e declaração de maioridade (accept_terms).
--   7) Denúncias chegando ao dono da plataforma (app_admins, DM/grupo,
--      escalar, admin_report_context, admin_remove_reported_message).
--   8) Riscos residuais aceitos (documentação).
-- ##################################################################


-- ================================================================
-- 19.1) Realtime — TODOS os canais do app são privados.
--
-- Com "Allow public access" DESLIGADO em Realtime → Settings (o
-- recomendado), o servidor do Realtime recusa canal não privado — e os
-- canais de postgres_changes (mensagens, membros, amizades...) eram
-- públicos. Agora o app abre esses canais como privados com tópico
-- `pgc:<nome>:<aleatório>` (src/lib/realtimeChannel.ts → changesChannel).
--
-- Como o Realtime autoriza o join de canal privado: ele testa SELECT em
-- realtime.messages (com realtime.topic() = tópico) para as extensões
-- 'broadcast' e 'presence'; sem leitura em nenhuma, o join é recusado.
-- Enviar (INSERT) é testado a cada broadcast/track. Então `pgc:*`:
--   * LEITURA liberada a qualquer logado com o 2FA em dia (só pro join
--     passar — ninguém publica nada nesses tópicos);
--   * ESCRITA (broadcast/presence) sempre negada.
-- As linhas que chegam por postgres_changes continuam filtradas pela
-- RLS de cada tabela (o Realtime checa a RLS por assinante).
-- ================================================================
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

  -- postgres_changes em canal privado: só leitura (join), nunca envio.
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


-- ================================================================
-- 19.2) is_trusted_storage_url — host confiável = o do projeto.
--
-- A versão da parte 016 aceitava QUALQUER https://<ref>.supabase.co: um
-- atacante hospedava o arquivo no PRÓPRIO projeto Supabase dele e
-- rastreava o IP de quem abria o perfil/servidor/emoji. Agora o host
-- aceito é, em ordem:
--   1) `app.settings.supabase_url`, se configurado (RECOMENDADO — ver
--      supabase/README.md):
--        alter database postgres set app.settings.supabase_url = 'https://<ref>.supabase.co';
--   2) senão, o host da própria requisição que o PostgREST repassa em
--      `request.headers` (JSON com os nomes em minúsculas): primeiro
--      `x-forwarded-host` (o gateway do Supabase reescreve o `host` pro
--      endereço interno do PostgREST e guarda o original ali), depois
--      `host`. É o mesmo endereço que o app usa (VITE_SUPABASE_URL).
--   3) senão (sem requisição HTTP, ex.: SQL puro), URL absoluta é
--      RECUSADA — só caminho relativo passa (guard_attachment_url).
-- ================================================================
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
  -- Sem "..", barras/pontos codificados ou contrabarra (escapar da pasta).
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


-- ================================================================
-- 19.3) Grupo — quem criou e SAIU não acessa mais.
--
-- group_conversations_select aceitava `created_by = auth.uid()`: o
-- criador que saiu continuava vendo o grupo e, pela Edge Function
-- livekit-token (que confia nessa RLS), ganhava token pra entrar na
-- call; também podia se readicionar. Agora:
--   * SELECT só pra membro;
--   * o criador vira membro NA HORA, por gatilho AFTER INSERT (o app
--     cria o grupo sem ler de volta e insere os outros membros depois);
--   * is_group_creator (apagar arquivos do grupo, adicionar membros,
--     group_attachment_objects) exige ser criador E membro;
--   * apagar o grupo: criador E membro.
-- ================================================================
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


-- ================================================================
-- 19.4) Moderação — castigo e banimento.
--
-- remove_timeout tinha a exceção "p_user_id = auth.uid()": um moderador
-- em castigo tirava o PRÓPRIO castigo. Agora vale a hierarquia sempre
-- (o próprio cargo é "igual ao seu" → recusado).
-- unban_member: o banido não tem cargo, então a hierarquia olha QUEM
-- BANIU — só desfaz o banimento quem tem cargo igual ou acima de quem
-- aplicou (dono sempre pode). Continua exigindo ban_members + 2FA e
-- registrando no log.
-- ================================================================
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


-- ================================================================
-- 19.5) Storage — buckets públicos e soundboard.
--
-- a) server-icons, avatars, profile-banners, avatar-decorations são
--    buckets PÚBLICOS: a URL /object/public/... funciona SEM política
--    nenhuma. As políticas SELECT "…publicamente visíveis" só serviam
--    pra LISTAR o bucket inteiro (enumerar arquivos de todo mundo, até
--    os antigos que a pessoa trocou). Saem. Ficam políticas SELECT
--    ESTREITAS, porque a API do Storage precisa de SELECT pra
--    remove() e pra upload com upsert:
--      * perfil: só a própria pasta (<uid>/...) — o app lista a
--        própria pasta ao excluir a conta (deleteOwnProfileFiles);
--      * server-icons: só a pasta de servidor do qual você é dono.
--    ATENÇÃO: políticas criadas pelo painel com outro nome continuam
--    valendo (políticas somam) — confira em Storage → Policies.
-- ================================================================
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

-- b) Soundboard: antes qualquer membro subia QUALQUER arquivo (até 2MB,
--    sem limite de quantidade) na pasta do servidor, sem linha em
--    soundboard_sounds — virava hospedagem de arquivo pública. Agora:
--    * o app cria a LINHA primeiro (id, storage_path) e depois sobe o
--      arquivo; o Storage só aceita o upload se o caminho for
--      exatamente o storage_path de uma linha SUA, daquele servidor,
--      com você membro e fora de castigo;
--    * limites: 60 sons por servidor e 10 por pessoa em cada servidor
--      (quem tem manage_server/dono não tem o limite por pessoa);
--    * caminho no formato <server_id>/<nome-simples>.<ext>;
--    * tamanho/tipo: o próprio bucket (2MB, só áudio — 006).
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

-- remove() da API do Storage precisa de SELECT: quem enviou enxerga o
-- próprio arquivo (pra apagar o órfão se algo der errado).
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


-- ================================================================
-- 19.6) Aceite dos termos e declaração de maioridade.
--
-- Colunas novas em user_private_settings (RLS: só o dono lê/escreve,
-- igual ao resto da tabela):
--   terms_accepted_at      — quando aceitou os Termos/Política (hora
--                            do SERVIDOR, carimbada por gatilho);
--   terms_version          — qual versão aceitou (texto curto);
--   age_declared_adult_at  — quando declarou ter 18+ no cadastro (hora
--                            do servidor). Diferente de
--                            age_verified_adult_at (portão dos canais +18).
-- RPC accept_terms(p_version, p_is_adult) grava tudo de uma vez.
-- ================================================================
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

-- Carimbo da hora do servidor (mesma ideia de stamp_profile_age_verification):
-- vindo da API, qualquer valor não nulo vira now().
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

-- SECURITY INVOKER de propósito: grava pela RLS da tabela (só a própria
-- linha) e respeita o 2FA; o gatilho acima carimba a hora do servidor.
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


-- ================================================================
-- 19.7) Denúncias chegando ao dono da plataforma.
--
-- Antes: denúncia de usuário sem servidor só era vista por quem
-- denunciou, e não havia como denunciar mensagem de DM/grupo. Agora:
--   * app_admins(user_id): quem administra a PLATAFORMA. Sem política
--     de INSERT/UPDATE/DELETE — o dono insere pelo SQL Editor:
--       insert into public.app_admins values ('<seu uuid>');
--     is_app_admin(): a sessão atual é de um admin (com o 2FA em dia).
--   * reports ganha target_type 'dm_message' (dm_message_id) e
--     'group_message' (group_message_id) — o gatilho confere que quem
--     denuncia PARTICIPA da conversa e guarda um retrato do texto
--     (content_snapshot) pra análise mesmo se a mensagem for apagada;
--   * `escalated`: quem denuncia (ao criar) ou um moderador do servidor
--     (depois) manda a denúncia também pra equipe da plataforma;
--     `scope` (gerada): 'platform' se não tem servidor ou foi escalada,
--     'server' caso contrário;
--   * app admins veem/atualizam as denúncias de escopo 'platform';
--     admin_report_context(report_id) devolve texto e autor;
--     admin_remove_reported_message(report_id) apaga a mensagem.
--   * Limite de 10 denúncias/10 min (limit_reports) continua valendo.
-- ================================================================
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

-- Colunas novas.
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

-- A denúncia de mensagem de servidor era APAGADA junto com a mensagem
-- (on delete cascade) — a prova sumia. Agora só perde o vínculo.
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

-- Contexto da denúncia (versão final — substitui a da 006): recalcula
-- no servidor autor/servidor/conversa, confere acesso e guarda o retrato.
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

-- Imutabilidade (versão final — substitui a da 006). Pode mudar:
--   * status (moderador do servidor ou app admin);
--   * escalated só de false pra true;
--   * os vínculos (message_id, dm_message_id, group_message_id,
--     dm_conversation_id, group_id) só pra NULL — é o que o banco faz
--     sozinho (on delete set null) quando a mensagem/conversa some.
-- reviewed_by/reviewed_at só são carimbados quando o status muda.
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

-- Contexto da denúncia pra equipe da plataforma: texto atual da
-- mensagem (ou o retrato guardado, se ela foi apagada) e o autor. Só
-- app admin, só denúncia de escopo 'platform'.
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

-- Apaga a mensagem denunciada (servidor, DM ou grupo) e marca a
-- denúncia como 'reviewed'. Devolve true se havia mensagem pra apagar.
-- Os arquivos anexos viram órfãos no Storage e saem na limpeza de
-- orphan_attachment_objects (parte 017). O retrato do texto fica na
-- denúncia (content_snapshot).
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


-- ================================================================
-- 19.8) Riscos residuais ACEITOS (só documentação, nada muda):
--
-- * DELETE em server_members / group_conversation_members pelo
--   Realtime: o Realtime NÃO aplica RLS em DELETE — manda a chave
--   primária da linha apagada (server_id+user_id / group_id+user_id)
--   pra todo assinante da tabela. Quem está logado e assina a tabela
--   fica sabendo que "o usuário X saiu do servidor/grupo Y" (pares de
--   UUID, sem nome nem conteúdo). Trocar a PK por um id sintético
--   mudaria o app inteiro — fica como risco aceito. O app confere o id
--   antes de reagir.
-- * Conteúdo de broadcast/presence continua vindo do cliente (ver
--   parte 016, item 2).
-- ================================================================

-- ================================================================
-- PARTE 20) Ordem dos cargos (hierarquia) — sobe/desce um cargo,
-- trocando a posição com o vizinho. Mesmas regras de update_role: só
-- quem gerencia cargos, e nunca mexendo num cargo do seu nível ou acima
-- (nem colocando um cargo acima do seu).
-- ================================================================
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
    return; -- já está no topo/fundo
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

-- ============================================================
-- PARTE 21 — revisão de segurança (out/2026)
-- ============================================================

-- (a) Quem está BLOQUEADO não consegue mais entrar na chamada da DM
-- (antes só o "digitando..." respeitava o bloqueio).
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

-- (b) Membro de castigo (timeout) não cria convite.
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

-- (c) Convites do formato ANTIGO (8 letras/números hexadecimais, fáceis
-- de adivinhar por tentativa) deixam de valer. Os novos têm 10
-- caracteres aleatórios. Quem tinha link antigo gera um novo.
delete from public.server_invites where code ~ '^[0-9a-f]{8}$';

-- ============================================================
-- PARTE 22 — painel de usuários (só administradores da plataforma)
-- ============================================================
-- Lista de contas pra quem está em app_admins (com 2FA em dia), base
-- pras futuras funções pagas. Privacidade:
--   * NUNCA expõe mensagens, DMs, senhas, IP ou dados de pagamento;
--   * o e-mail aparece MASCARADO (f***@gmail.com); ver o e-mail completo
--     é uma ação separada e fica registrada em admin_audit_log;
--   * toda mudança de plano também fica registrada.

-- Plano de cada conta (quem não tem linha é 'free').
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

-- Registro do que os administradores fizeram (quem, o quê, em quem).
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

-- Números gerais.
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

-- Lista paginada. p_search procura em nome/@usuário; um e-mail COMPLETO
-- também acha a conta (sem mostrar o e-mail de volta).
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

-- Ver o e-mail completo de UMA conta (suporte/cobrança). Fica registrado.
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

-- Define o plano de uma conta ('free' remove). Fica registrado.
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

-- ============================================================
-- PARTE 23 — cargos só com o dono ou um Administrador
-- ============================================================
-- Criar/editar/excluir/reordenar cargos e decidir quem fica em cada um
-- deixa de valer pela permissão "Gerenciar cargos" sozinha: agora exige
-- ser o DONO do servidor ou ter um cargo com "Administrador". Todas as
-- funções de cargo checam has_permission(..., 'manage_roles'), então a
-- regra vale pra todas de uma vez. As demais permissões não mudam.
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

notify pgrst, 'reload schema';
