-- ============================================================
-- 015 — CANAIS COM RESTRIÇÃO DE IDADE (+18)
--
-- Modelo do Discord: conteúdo adulto (inclusive GIFs com rating "r"
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
