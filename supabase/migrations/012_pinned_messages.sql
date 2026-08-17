-- ============================================================
-- Mensagens fixadas (pin) — rode isto no SQL Editor do Supabase,
-- depois da 011_server_banner.sql
-- ============================================================
alter table public.messages add column if not exists pinned_at timestamptz;
alter table public.messages add column if not exists pinned_by uuid references public.profiles(id) on delete set null;

create index if not exists messages_pinned_idx on public.messages (channel_id, pinned_at) where pinned_at is not null;

-- Só quem tem permissão de gerenciar mensagens no servidor (dono ou
-- cargo com essa permissão) pode fixar/desafixar — reaproveita a
-- função has_permission() já criada na migration 006.
drop policy if exists "messages_pin_update" on public.messages;
create policy "messages_pin_update"
  on public.messages for update
  using (
    exists (
      select 1 from public.channels ch
      join public.servers s on s.id = ch.server_id
      where ch.id = messages.channel_id
        and (s.owner_id = auth.uid() or public.has_permission(s.id, auth.uid(), 'manage_messages'))
    )
  );
