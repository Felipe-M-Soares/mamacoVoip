-- ============================================================
-- Grupos de conversa (DM em grupo) — rode isto no SQL Editor do
-- Supabase, depois da 020_dm_attachments.sql
--
-- Implementado como um sistema SEPARADO das conversas 1-pra-1
-- (dm_conversations/dm_messages) de propósito — evita qualquer
-- risco de quebrar o que já funciona lá.
-- ============================================================
create table if not exists public.group_conversations (
  id uuid primary key default gen_random_uuid(),
  name text,
  icon_url text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.group_conversation_members (
  group_id uuid not null references public.group_conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists public.group_messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.group_conversations(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  content text not null default '',
  reply_to_id uuid references public.group_messages(id) on delete set null,
  edited_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.group_message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.group_messages(id) on delete cascade,
  file_url text not null,
  file_name text not null,
  file_size integer not null,
  mime_type text not null,
  created_at timestamptz not null default now()
);

create index if not exists group_messages_group_idx on public.group_messages (group_id, created_at);

alter table public.group_conversations enable row level security;
alter table public.group_conversation_members enable row level security;
alter table public.group_messages enable row level security;
alter table public.group_message_attachments enable row level security;

-- Função auxiliar (evita recursão de política em cima da própria tabela de membros)
create or replace function public.is_group_member(p_group_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.group_conversation_members
    where group_id = p_group_id and user_id = p_user_id
  );
$$;

drop policy if exists "group_conversations_select" on public.group_conversations;
create policy "group_conversations_select"
  on public.group_conversations for select
  using (public.is_group_member(id, auth.uid()));

drop policy if exists "group_conversations_insert" on public.group_conversations;
create policy "group_conversations_insert"
  on public.group_conversations for insert
  with check (created_by = auth.uid());

drop policy if exists "group_conversations_update" on public.group_conversations;
create policy "group_conversations_update"
  on public.group_conversations for update
  using (public.is_group_member(id, auth.uid()));

drop policy if exists "group_members_select" on public.group_conversation_members;
create policy "group_members_select"
  on public.group_conversation_members for select
  using (public.is_group_member(group_id, auth.uid()));

drop policy if exists "group_members_insert" on public.group_conversation_members;
create policy "group_members_insert"
  on public.group_conversation_members for insert
  with check (
    -- o próprio dono do grupo adicionando alguém, OU a própria pessoa entrando
    user_id = auth.uid()
    or exists (select 1 from public.group_conversations g where g.id = group_id and g.created_by = auth.uid())
  );

drop policy if exists "group_members_delete" on public.group_conversation_members;
create policy "group_members_delete"
  on public.group_conversation_members for delete
  using (user_id = auth.uid());

drop policy if exists "group_messages_select" on public.group_messages;
create policy "group_messages_select"
  on public.group_messages for select
  using (public.is_group_member(group_id, auth.uid()));

drop policy if exists "group_messages_insert" on public.group_messages;
create policy "group_messages_insert"
  on public.group_messages for insert
  with check (author_id = auth.uid() and public.is_group_member(group_id, auth.uid()));

drop policy if exists "group_messages_update" on public.group_messages;
create policy "group_messages_update"
  on public.group_messages for update
  using (author_id = auth.uid());

drop policy if exists "group_messages_delete" on public.group_messages;
create policy "group_messages_delete"
  on public.group_messages for delete
  using (author_id = auth.uid());

drop policy if exists "group_message_attachments_select" on public.group_message_attachments;
create policy "group_message_attachments_select"
  on public.group_message_attachments for select
  using (
    exists (
      select 1 from public.group_messages m
      where m.id = message_id and public.is_group_member(m.group_id, auth.uid())
    )
  );

drop policy if exists "group_message_attachments_insert" on public.group_message_attachments;
create policy "group_message_attachments_insert"
  on public.group_message_attachments for insert
  with check (
    exists (select 1 from public.group_messages m where m.id = message_id and m.author_id = auth.uid())
  );

-- Bucket de armazenamento pros arquivos (pasta raiz = id do grupo)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'group-attachments',
  'group-attachments',
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

drop policy if exists "group_attachments_select" on storage.objects;
create policy "group_attachments_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'group-attachments'
    and public.is_group_member((storage.foldername(name))[1]::uuid, auth.uid())
  );

drop policy if exists "group_attachments_insert" on storage.objects;
create policy "group_attachments_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'group-attachments'
    and public.is_group_member((storage.foldername(name))[1]::uuid, auth.uid())
  );
