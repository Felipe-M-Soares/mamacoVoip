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
