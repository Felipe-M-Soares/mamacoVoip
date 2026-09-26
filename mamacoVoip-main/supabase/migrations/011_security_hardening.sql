-- ============================================================
-- ENDURECIMENTO DE SEGURANÇA — resultado de uma auditoria completa
-- do banco (RLS, funções, buckets) pedida pelo dono do app. Corrige
-- vários problemas reais encontrados, do mais grave pro mais leve.
-- Nenhuma dessas mudanças remove funcionalidade nenhuma pra uso normal
-- — só fecha brechas que só um usuário mal-intencionado exploraria.
--
-- Seguro rodar mais de uma vez. Rode isto no SQL Editor do Supabase
-- (Dashboard → SQL Editor → colar → Run) DEPOIS de já ter aplicado as
-- migrations 001 a 010.
-- ============================================================


-- ================================================================
-- 1) CRÍTICO — quem sai/é expulso/banido de um servidor continuava
--    com todas as permissões de qualquer cargo que tivesse antes.
--
-- has_permission() e top_role_position() só olhavam a tabela de
-- "cargos atribuídos" (server_member_roles) — nunca conferiam se a
-- pessoa CONTINUA sendo membro do servidor (server_members). Sair,
-- ser expulso ou ser banido só apaga a linha de server_members; a
-- atribuição de cargo (server_member_roles) ficava órfã, esquecida,
-- e continuava valendo pra sempre. Um ex-moderador podia continuar
-- banindo/expulsando gente, apagando mensagens, criando cargos de
-- administrador pra si mesmo, etc. — de fora do servidor, indefinida-
-- mente, chamando as funções diretamente.
--
-- Corrige nas duas pontas: (a) as funções agora também exigem
-- filiação atual, e (b) um gatilho novo limpa server_member_roles
-- automaticamente sempre que alguém deixa de ser membro, pra não
-- deixar lixo acumulando (e cobrir qualquer outra função futura que
-- porventura esqueça de checar isso).
-- ================================================================

create or replace function public.has_permission(p_server_id uuid, p_user_id uuid, p_permission text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    -- Só responde sobre você mesmo, ou sobre alguém de um servidor do
    -- qual você TAMBÉM faz parte (fecha também o problema 4 abaixo,
    -- de descoberta de permissão/cargo de gente sem relação nenhuma
    -- com você).
    (p_user_id = auth.uid() or exists (
      select 1 from public.server_members where server_id = p_server_id and user_id = auth.uid()
    ))
    and (
      exists (select 1 from public.servers where id = p_server_id and owner_id = p_user_id)
      or (
        -- A parte nova: precisa CONTINUAR sendo membro, não só ter um
        -- cargo atribuído em algum momento do passado.
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
    -- A parte nova: se a pessoa não é mais membro, a posição mais alta
    -- dela é a mesma de qualquer estranho (-1) — não conta mais os
    -- cargos que ela tinha antes de sair/ser removida.
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

-- Limpeza automática: assim que alguém deixa de ser membro (saiu,
-- foi expulso, foi banido), some com qualquer cargo que ainda
-- estivesse atribuído a ela nesse servidor — mesmo sem essa limpeza
-- as duas funções acima já bloqueiam o problema, mas isso evita lixo
-- acumulando nas tabelas pra sempre.
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


-- ================================================================
-- 2) CRÍTICO — mensagem podia ser inserida com server_id e channel_id
--    de servidores DIFERENTES, "vazando" pro canal errado.
--
-- A política de inserção de mensagens conferia se você é membro do
-- server_id que você mesmo informou — mas nunca conferia se esse
-- server_id BATE com o servidor de verdade do channel_id informado.
-- Como os dois campos vêm do cliente, alguém podia mandar
-- channel_id = canal de um servidor QUALQUER (mesmo um privado que
-- nunca foi convidado a entrar) junto de server_id = um servidor
-- comum seu — a checagem passava pelo servidor errado (o seu), e a
-- mensagem era escrita apontando pro canal de verdade, aparecendo lá
-- pra quem tem acesso a esse canal. Também aproveita pra fechar o
-- mesmo tipo de furo pro caso de CANAL RESTRITO (cargo específico):
-- antes só a LEITURA respeitava isso, o ENVIO não.
-- ================================================================

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


-- ================================================================
-- 3) ALTO — qualquer pessoa conseguia fixar a PRÓPRIA mensagem (e
--    forjar "fixado por fulano"), sem ter permissão de gerenciar
--    mensagens — bastava usar a mesma chamada de "editar" normal.
--
-- O RLS do Postgres não restringe COLUNA por política — só LINHA. A
-- política "Autor edita a própria mensagem" (qualquer edição de
-- conteúdo pela própria pessoa) e a política "messages_pin_update"
-- (só quem administra mensagens) são combinadas com "OU": bastava
-- satisfazer UMA das duas pra passar, então author_id = auth.uid()
-- já liberava mudar QUALQUER coluna, incluindo pinned_at/pinned_by.
-- RLS sozinho não resolve isso — a correção certa é um gatilho que
-- barra a mudança dessas duas colunas específicas pra quem não tem
-- permissão, não importa qual política "abriu a porta".
-- ================================================================

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


-- ================================================================
-- 4) MÉDIO — descoberta indevida de filiação/permissão/hierarquia.
--
-- has_permission/top_role_position/is_server_member/is_group_member/
-- channel_server_id/user_has_channel_role_access são funções
-- "security definer" (rodam com privilégio elevado) e, por padrão do
-- Postgres, QUALQUER usuário autenticado (ou até anônimo) consegue
-- chamá-las diretamente via API — mesmo sem nunca serem usadas assim
-- pelo próprio app. Isso permitia perguntar "fulano é membro do
-- servidor X?" ou "fulano tem permissão Y no servidor Z?" sobre
-- QUALQUER pessoa e QUALQUER servidor, mesmo sem nenhuma relação com
-- eles. has_permission já ficou mais restrita no item 1 acima; aqui
-- fecha o acesso ANÔNIMO nas demais (a essas funções só de apoio
-- interno — o app nunca precisa delas fora de estar logado).
-- ================================================================

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


-- ================================================================
-- 5) MÉDIO — qualquer membro do grupo de DM podia se apossar do
--    "created_by" de um grupo, ganhando o poder de adicionar
--    qualquer pessoa nele (privilégio reservado a quem criou).
--
-- A política de update de group_conversations não tinha um WITH
-- CHECK próprio, então caía no padrão (repetir o USING) — o que NÃO
-- protege as colunas de verdade sendo alteradas. Agora, um gatilho
-- trava qualquer tentativa de mudar quem é o "dono" do grupo (não
-- existe hoje uma função de "transferir grupo" de propósito — se um
-- dia for adicionada, deve ser uma função própria com suas próprias
-- checagens, não uma edição livre).
-- ================================================================

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


-- ================================================================
-- 6) MÉDIO — qualquer membro do servidor conseguia ver QUAIS canais
--    restritos existem (só não via o conteúdo), mesmo sem ter acesso
--    liberado a eles — bastava ler channel_role_access diretamente.
-- ================================================================

drop policy if exists "Quem vê o canal vê os cargos liberados" on public.channel_role_access;
create policy "Quem vê o canal vê os cargos liberados"
  on public.channel_role_access for select to authenticated
  using (
    public.has_permission(public.channel_server_id(channel_id), auth.uid(), 'manage_channels')
    or public.user_has_channel_role_access(channel_id, auth.uid())
  );


-- ================================================================
-- 7) MÉDIO — criar uma "thread" não conferia se o canal/mensagem
--    informados realmente combinam com o servidor informado. Como
--    parent_message_id é ÚNICO no banco inteiro, alguém de QUALQUER
--    servidor podia "sequestrar" o id de uma mensagem que nem
--    consegue ver, travando pra sempre a criação de thread nela pelos
--    moderadores de verdade daquele servidor.
-- ================================================================

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


-- ================================================================
-- 8) BAIXO — confiabilidade: duas pessoas clicando ao mesmo tempo
--    pra iniciar a PRIMEIRA conversa uma com a outra podiam fazer
--    uma das duas chamadas falhar com um erro de "linha duplicada"
--    em vez de simplesmente devolver a conversa já criada pela outra.
-- ================================================================

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


-- ================================================================
-- 9) Recria o que faltava no controle de versão: os buckets de
--    banner/decoração de perfil e do soundboard (junto com a tabela e
--    as funções do soundboard) nunca tinham sido salvos neste
--    repositório — só existiam direto no banco, aplicados numa sessão
--    anterior sem gerar um arquivo .sql correspondente. Recriando tudo
--    aqui (idempotente — não apaga nada que já exista) pra garantir
--    que a proteção de tipo de arquivo/tamanho/dono está de fato
--    ativa e documentada, e não só supondo que alguém configurou
--    certo manualmente.
-- ================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-banners', 'profile-banners', true, 15728640, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update set allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatar-decorations', 'avatar-decorations', true, 5242880, array['image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('soundboard', 'soundboard', true, 2097152, array['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm'])
on conflict (id) do update set allowed_mime_types = excluded.allowed_mime_types;

-- Convenção de path igual à do avatar: {user_id}/banner-{timestamp}.ext
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

-- Soundboard: tabela + RLS + funções (delete/contagem de uso) — o
-- envio em si (INSERT) é feito direto pelo cliente (useSoundboard.ts),
-- não por uma função, então a política de insert é o que garante que
-- só dá pra criar som em servidor do qual você é membro de verdade.
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

-- Apagar/contar reprodução passam por função (não por policy direta)
-- pra poder checar "dono do som OU quem administra mensagens", igual
-- o próprio botão de apagar já decide na tela (SoundboardPanel.tsx).
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
