-- ============================================================
-- 006 — AJUSTES DE 2025 (antigas migrations 007 a 012, juntas)
--
-- Este arquivo é a concatenação EXATA, na mesma ordem, das antigas:
--   007_server_members_realtime.sql, 008_profile_asset_size.sql,
--   009_dm_unhide_on_recreate.sql, 010_google_oauth_profile.sql,
--   011_security_hardening.sql, 012_content_reports.sql
-- Nenhuma linha de SQL foi mudada — só os cabeçalhos de seção abaixo
-- (comentários). Não existia 006 antes; o número ficou livre.
--
-- Quem JÁ RODOU as antigas 007..012 não precisa rodar este arquivo.
-- Banco novo: rode 001, 002, 003, 004, 005, 006 e 007, nessa ordem.
-- (Ver supabase/README.md.)
-- ============================================================


-- ##################################################################
-- ANTIGA 007_server_members_realtime.sql
-- ##################################################################

-- ============================================================
-- Realtime em server_members — sem isso, os avisos abaixo escutam a
-- tabela mas nunca recebem nenhum evento de verdade (o Supabase só
-- manda Realtime pras tabelas que estão explicitamente na publicação
-- "supabase_realtime", mesmo esquema usado em 002_messaging.sql e
-- 003_social.sql pras outras tabelas):
--   - ServersContext.tsx escuta a MINHA linha em server_members pra
--     saber a hora que entrei num servidor novo (convite por link,
--     convite pelo chat, ou ter sido adicionado por outra pessoa) e
--     atualizar a lista sozinho, sem precisar fechar e abrir o app.
--   - useServerMembers.ts escuta as linhas de UM servidor pra saber
--     assim que alguém novo entra, e conseguir mostrar o NOME de quem
--     entrou (em vez do genérico "Alguém entrou no servidor").
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'server_members'
  ) then
    alter publication supabase_realtime add table public.server_members;
  end if;
end $$;


-- ##################################################################
-- ANTIGA 008_profile_asset_size.sql
-- ##################################################################

-- ============================================================
-- Aumenta o limite de tamanho das imagens de edição do perfil. Esses
-- valores precisam bater com AVATAR_MAX_BYTES/BANNER_MAX_BYTES/
-- DECORATION_MAX_BYTES em src/lib/profileAssetLimits.ts — o app já
-- confere o tamanho no navegador ANTES de tentar enviar (pra não
-- gastar tempo de upload à toa), mas quem trava de verdade um arquivo
-- grande demais é o limite do próprio bucket aqui no banco. Se só um
-- dos dois lados for aumentado, o upload passa na checagem do app e
-- falha depois, então os dois valores sempre precisam mudar juntos.
--
--   avatars              5MB -> 10MB
--   profile-banners      8MB -> 15MB
--   avatar-decorations   2MB -> 5MB
-- ============================================================
update storage.buckets set file_size_limit = 10485760 where id = 'avatars';
update storage.buckets set file_size_limit = 15728640 where id = 'profile-banners';
update storage.buckets set file_size_limit = 5242880 where id = 'avatar-decorations';


-- ##################################################################
-- ANTIGA 009_dm_unhide_on_recreate.sql
-- ##################################################################

-- ============================================================
-- Corrige: depois de apagar uma conversa de mensagem direta, não dava
-- pra criar/reabrir outra conversa com a mesma pessoa.
--
-- Como funciona o "apagar" de uma DM (ver 003_social_FIX_dm_delete.sql):
-- apagar não é um delete de verdade — só marca hidden_for_a/hidden_for_b
-- (dependendo de qual lado da conversa é você) como true, e a lista
-- (useConversations.ts) filtra fora qualquer conversa marcada como
-- escondida pro seu lado. Isso é de propósito: a OUTRA pessoa continua
-- vendo a conversa normalmente, e se ela mandar mensagem nova a
-- conversa volta a aparecer pra você sozinha.
--
-- O problema: como só existe UMA linha de dm_conversations por par de
-- usuários (unique(user_a, user_b)), quando você mesmo tenta começar
-- uma conversa nova com alguém que você tinha apagado antes,
-- get_or_create_dm encontra essa MESMA linha antiga — mas nunca
-- limpava a sua própria flag de "escondida", então a conversa
-- continuava invisível pra você mesmo já "existindo" de novo.
--
-- Esta migration é auto-suficiente (recria as colunas/função/gatilho de
-- 003_social_FIX_dm_delete.sql caso ainda não existam, é seguro rodar
-- de novo mesmo que já existam) e corrige só o get_or_create_dm pra
-- sempre limpar a flag de quem está chamando ao reencontrar uma
-- conversa antiga.
--
-- Rode isto no SQL Editor do Supabase (Dashboard → SQL Editor → New
-- query → colar isto → Run).
-- ============================================================

alter table public.dm_conversations add column if not exists hidden_for_a boolean not null default false;
alter table public.dm_conversations add column if not exists hidden_for_b boolean not null default false;

-- Apaga (esconde) a conversa só do lado de quem chamou.
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

-- Toda vez que chega uma mensagem nova, a conversa "reaparece" pros dois
-- lados (mesmo pra quem tinha apagado) — assim ninguém perde uma
-- mensagem nova só porque tinha limpado a conversa antes.
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

-- ============================================================
-- A CORREÇÃO NOVA: get_or_create_dm agora limpa a flag de "escondida"
-- de quem está chamando, sempre que reencontra uma conversa que já
-- existia (escondida ou não — não faz mal nenhum limpar de novo).
-- ============================================================
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
    -- Linha já existia: limpa só o lado de quem está chamando agora
    -- (o lado da outra pessoa não muda, exatamente como o
    -- unhide-on-message acima já respeita).
    update public.dm_conversations
    set hidden_for_a = (case when v_a = auth.uid() then false else hidden_for_a end),
        hidden_for_b = (case when v_b = auth.uid() then false else hidden_for_b end)
    where id = v_convo.id
    returning * into v_convo;
  end if;

  return v_convo;
end;
$$;


-- ##################################################################
-- ANTIGA 010_google_oauth_profile.sql
-- ##################################################################

-- ============================================================
-- Ajusta a criação automática de perfil (handle_new_user, de
-- 001_core.sql) pra funcionar bem também com quem se cadastra pelo
-- login do Google, não só pelo formulário de e-mail/senha.
--
-- Duas diferenças de quem entra pelo Google:
--
-- 1. Não vem "username" nenhum (isso só é mandado explicitamente no
--    cadastro por e-mail/senha, em signUp() no AuthContext.tsx) — o
--    código ORIGINAL já cobria isso caindo pro texto antes do @ do
--    e-mail (ex: "joao" de "joao@gmail.com"). Mas como username é
--    UNIQUE, duas pessoas DIFERENTES com o mesmo texto antes do @ (uma
--    no Gmail, outra no Outlook, por exemplo) fariam a segunda travar
--    o cadastro inteiro com um erro de banco que ela não teria como
--    entender. Agora, se o nome já estiver em uso, tenta variações com
--    um número no final até achar uma livre, em vez de falhar.
--
-- 2. O Google manda um nome de exibição de verdade (raw_user_meta_data
--    ->>'full_name' ou ->>'name', dependendo de como o provedor
--    devolve) — melhor usar ele no display_name em vez de repetir o
--    username ali, quando disponível.
--
-- Rode isto no SQL Editor do Supabase (Dashboard → SQL Editor → New
-- query → colar isto → Run).
-- ============================================================

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
  -- username só aceita letras/números/ponto/underline no cadastro por
  -- e-mail (ver validate() em Register.tsx) — o texto antes do @ de um
  -- e-mail de verdade pode ter outros caracteres (ex: "joao+voip"),
  -- então limpa aqui também pra manter os dois cadastros consistentes.
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


-- ##################################################################
-- ANTIGA 011_security_hardening.sql
-- ##################################################################

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


-- ##################################################################
-- ANTIGA 012_content_reports.sql
-- ##################################################################

-- Sistema de denúncia de conteúdo: mensagens de servidor e usuários.
-- Quem denuncia só enxerga a própria denúncia; quem modera o servidor
-- (dono ou quem tem a permissão manage_messages) enxerga e resolve as
-- denúncias daquele servidor. Nada aqui confia em valores vindos do
-- cliente pra decidir quem pode ver o quê — server_id e
-- reported_user_id são sempre recalculados no servidor a partir do
-- que realmente existe no banco (ver set_report_context() abaixo),
-- então não dá pra forjar uma denúncia apontando pra outro servidor
-- ou "roubando" a identidade de quem denuncia.

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

-- Preenche server_id/reported_user_id a partir dos dados reais no
-- banco (nunca confia no que o cliente mandou pra esses dois campos),
-- valida o alvo, e impede autodenúncia.
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
    -- server_id é opcional numa denúncia de usuário (só indica em qual
    -- servidor a denúncia deveria aparecer pros moderadores) — se vier
    -- preenchido, só é aceito quando quem denuncia é membro de fato
    -- daquele servidor; caso contrário a denúncia ainda é criada, só
    -- sem servidor associado (ninguém além do próprio denunciante a vê).
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

-- Depois de criada, uma denúncia só pode ter status/revisão alterados
-- (por um moderador) — o conteúdo da denúncia em si é imutável.
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
