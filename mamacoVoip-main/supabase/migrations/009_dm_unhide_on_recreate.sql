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
