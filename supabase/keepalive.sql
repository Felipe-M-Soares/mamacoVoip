-- ============================================================
-- Mamacos Voip — mantém o projeto Supabase (plano grátis) ativo
-- ============================================================
--
-- O plano grátis do Supabase PAUSA o projeto automaticamente depois de
-- um período sem atividade (na prática, sem requisições reais chegando
-- na API — REST/Auth/Storage/Realtime). Um projeto pausado derruba o
-- app inteiro (login, chat, voz, tudo) até alguém entrar no dashboard e
-- reativar manualmente.
--
-- Este script cria um "batimento cardíaco" automático, DENTRO do
-- próprio Supabase, sem precisar de nenhum serviço externo: o banco
-- (via pg_cron) se auto-pinga periodicamente fazendo uma chamada HTTP
-- de verdade (via pg_net) pra sua própria API REST — isso conta como
-- atividade real de API, não só uma query interna do banco.
--
-- COMO USAR:
--   1. Troque os dois placeholders abaixo (SEU_PROJECT_URL e
--      SUA_ANON_KEY) pelos valores do SEU projeto — os dois já estão
--      no seu arquivo .env (VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY).
--      A anon key é pública por design (é a mesma que o app usa no
--      navegador) — não tem problema ela aparecer aqui.
--   2. Cole o resultado no SQL Editor do seu projeto Supabase e rode.
--   3. Confirme que os dois jobs foram criados: `select * from cron.job;`
--
-- Esse script é seguro de rodar de novo (idempotente) — `cron.schedule`
-- com o mesmo nome de job só atualiza o horário/comando, não duplica.

-- 1) Habilita as extensões necessárias. No Supabase, normalmente já vêm
--    disponíveis; se o CREATE EXTENSION abaixo der erro de permissão,
--    habilite pelo dashboard em Database > Extensions (procure por
--    "pg_cron" e "pg_net" e ative os dois) e pule esta parte.
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- 2) Job: chama a própria API REST do projeto a cada 3 dias — bem
--    dentro da janela de 7 dias de inatividade que causaria a pausa,
--    com folga de sobra mesmo se algum ciclo falhar. `/rest/v1/` (raiz,
--    sem nenhuma tabela) responde rápido e não depende de nenhuma
--    tabela existir.
--
--    >>> TROQUE AQUI: SEU_PROJECT_URL e SUA_ANON_KEY <<<
select cron.schedule(
  'mamacos-keepalive-ping',
  '17 4 */3 * *', -- às 04:17 UTC, a cada 3 dias — horário de baixo movimento, não importa muito
  $$
  select net.http_get(
    url := 'https://SEU_PROJECT_URL.supabase.co/rest/v1/',
    headers := jsonb_build_object('apikey', 'SUA_ANON_KEY', 'Authorization', 'Bearer SUA_ANON_KEY')
  );
  $$
);

-- 3) Camada extra (opcional, mas recomendada): um heartbeat que roda
--    DENTRO do banco, sem depender de rede saindo do projeto (pg_net
--    pode falhar se a rede do projeto tiver algum bloqueio temporário)
--    — grava um timestamp numa tabelinha própria, todo dia. Sozinho,
--    talvez não conte como "atividade de API" pro Supabase, mas ajuda
--    a diagnosticar (dá pra ver quando foi o último ping rodando) e é
--    de graça.
create table if not exists public._keepalive (
  id boolean primary key default true,
  pinged_at timestamptz not null default now(),
  constraint _keepalive_singleton check (id)
);
insert into public._keepalive (id) values (true) on conflict (id) do nothing;
alter table public._keepalive enable row level security;
-- Ninguém de fora precisa ler/escrever isso — pg_cron roda como
-- superuser internamente e não passa pela RLS, então não precisa de
-- nenhuma policy aqui (a tabela fica inacessível pra qualquer
-- requisição vinda do app, o que é o esperado).

select cron.schedule(
  'mamacos-keepalive-heartbeat',
  '43 3 * * *', -- todo dia às 03:43 UTC
  $$ update public._keepalive set pinged_at = now() where id = true; $$
);

-- ============================================================
-- Verificação e manutenção
-- ============================================================
-- Ver os jobs agendados:
--   select jobid, jobname, schedule, active from cron.job;
--
-- Ver o histórico de execuções (sucesso/erro) dos últimos pings:
--   select jobid, status, return_message, start_time
--   from cron.job_run_details
--   order by start_time desc
--   limit 20;
--
-- Desligar (se um dia quiser remover):
--   select cron.unschedule('mamacos-keepalive-ping');
--   select cron.unschedule('mamacos-keepalive-heartbeat');
