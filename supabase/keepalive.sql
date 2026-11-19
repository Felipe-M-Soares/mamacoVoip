create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'mamacos-keepalive-ping',
  '17 4 */3 * *',
  $$
  select net.http_get(
    url := 'https://SEU_PROJECT_URL.supabase.co/rest/v1/',
    headers := jsonb_build_object('apikey', 'SUA_ANON_KEY', 'Authorization', 'Bearer SUA_ANON_KEY')
  );
  $$
);

create table if not exists public._keepalive (
  id boolean primary key default true,
  pinged_at timestamptz not null default now(),
  constraint _keepalive_singleton check (id)
);
insert into public._keepalive (id) values (true) on conflict (id) do nothing;
alter table public._keepalive enable row level security;

select cron.schedule(
  'mamacos-keepalive-heartbeat',
  '43 3 * * *',
  $$ update public._keepalive set pinged_at = now() where id = true; $$
);
