-- Lets the daily pipeline apply a reviewed migration file without a database password or a service
-- key. The pipeline calls run_migration() with a secret that exists only on the agents server; its
-- hash sits in app_secrets under the name 'migrate'. Without that row nobody can call it.
-- Each file is applied once, in one transaction, and recorded in applied_migrations.

begin;

create table if not exists public.applied_migrations (
  name text primary key,
  sha256 text not null,
  applied_at timestamptz not null default now()
);
alter table public.applied_migrations enable row level security;
revoke all on public.applied_migrations from anon, authenticated;

create or replace function public.run_migration(p_secret text, p_name text, p_sql text) returns jsonb
language plpgsql security definer set search_path = public set statement_timeout = '120s' as $$
declare
  v_hash text := encode(sha256(convert_to(coalesce(p_sql, ''), 'utf8')), 'hex');
begin
  if coalesce(length(p_secret), 0) < 32 or not exists (
    select 1 from public.app_secrets s
     where s.name = 'migrate'
       and lower(s.sha256) = encode(sha256(convert_to(p_secret, 'utf8')), 'hex')
  ) then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  if p_name is null or p_name !~ '^[0-9]{12}_[a-z0-9_]{1,80}\.sql$' then
    raise exception 'Bad migration name' using errcode = '22023';
  end if;
  if coalesce(length(p_sql), 0) < 10 or length(p_sql) > 400000 then
    raise exception 'Bad migration size' using errcode = '22023';
  end if;
  if exists (select 1 from public.applied_migrations m where m.name = p_name) then
    return jsonb_build_object('applied', false, 'already', true);
  end if;
  execute p_sql;
  insert into public.applied_migrations (name, sha256) values (p_name, v_hash);
  return jsonb_build_object('applied', true, 'already', false);
end $$;

revoke all on function public.run_migration(text, text, text) from public;
grant execute on function public.run_migration(text, text, text) to anon, authenticated;

commit;
