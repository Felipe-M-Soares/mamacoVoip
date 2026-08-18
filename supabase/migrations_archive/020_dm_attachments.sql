-- ============================================================
-- Anexos em mensagens diretas (DM) — rode isto no SQL Editor do
-- Supabase, depois da 019_stage_channels.sql
-- ============================================================

-- audio/webm é o formato que a gravação de mensagem de voz produz —
-- faltava na lista de tipos aceitos no bucket de anexos dos canais.
update storage.buckets
set allowed_mime_types = array[
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'video/mp4', 'video/webm',
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm',
  'application/pdf', 'text/plain',
  'application/zip'
]
where id = 'attachments';

create table if not exists public.dm_message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.dm_messages(id) on delete cascade,
  file_url text not null,
  file_name text not null,
  file_size integer not null,
  mime_type text not null,
  created_at timestamptz not null default now()
);

alter table public.dm_message_attachments enable row level security;

drop policy if exists "dm_message_attachments_select" on public.dm_message_attachments;
create policy "dm_message_attachments_select"
  on public.dm_message_attachments for select
  using (
    exists (
      select 1 from public.dm_messages m
      join public.dm_conversations c on c.id = m.conversation_id
      where m.id = message_id and (c.user_a = auth.uid() or c.user_b = auth.uid())
    )
  );

drop policy if exists "dm_message_attachments_insert" on public.dm_message_attachments;
create policy "dm_message_attachments_insert"
  on public.dm_message_attachments for insert
  with check (
    exists (
      select 1 from public.dm_messages m
      where m.id = message_id and m.author_id = auth.uid()
    )
  );

-- Bucket de armazenamento pros arquivos em si (pasta raiz = id da
-- conversa, checado contra quem participa dela)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'dm-attachments',
  'dm-attachments',
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

drop policy if exists "dm_attachments_select" on storage.objects;
create policy "dm_attachments_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'dm-attachments'
    and exists (
      select 1 from public.dm_conversations c
      where c.id = (storage.foldername(name))[1]::uuid
        and (c.user_a = auth.uid() or c.user_b = auth.uid())
    )
  );

drop policy if exists "dm_attachments_insert" on storage.objects;
create policy "dm_attachments_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'dm-attachments'
    and exists (
      select 1 from public.dm_conversations c
      where c.id = (storage.foldername(name))[1]::uuid
        and (c.user_a = auth.uid() or c.user_b = auth.uid())
    )
  );
