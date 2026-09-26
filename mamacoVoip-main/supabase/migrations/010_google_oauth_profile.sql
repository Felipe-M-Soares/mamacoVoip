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
