-- ============================================================
-- FASE 1 — Base de dados: perfis de usuário
-- Rode isto no SQL Editor do Supabase (Project > SQL Editor)
-- ============================================================

-- Tabela de perfis públicos, espelhando auth.users (que é privada)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  display_name text,
  avatar_url text,
  status text not null default 'offline' check (status in ('online', 'idle', 'dnd', 'offline')),
  custom_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Índice para buscas por username (ex: adicionar amigo por @usuario)
create index profiles_username_idx on public.profiles (lower(username));

-- ============================================================
-- Trigger: cria o profile automaticamente quando alguém se cadastra
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- Trigger: mantém updated_at sempre atualizado
-- ============================================================
create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger on_profiles_updated
  before update on public.profiles
  for each row execute function public.handle_updated_at();

-- ============================================================
-- RLS — Row Level Security
-- ============================================================
alter table public.profiles enable row level security;

-- Qualquer usuário autenticado pode VER perfis (necessário para chat,
-- lista de membros, busca de amigos etc.)
create policy "Perfis são visíveis para usuários autenticados"
  on public.profiles for select
  to authenticated
  using (true);

-- Usuário só pode alterar o PRÓPRIO perfil
create policy "Usuário só pode atualizar seu próprio perfil"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Ninguém insere perfil manualmente — só o trigger (security definer) faz isso.
-- Não criamos policy de insert para authenticated, então inserts diretos
-- do frontend são bloqueados por padrão (RLS nega o que não tem policy).

-- Ninguém pode deletar o próprio perfil diretamente (deve ser feito
-- deletando a conta via auth admin, que cascade-deleta o profile).
