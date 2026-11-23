-- Team room: what the agent team is doing, for the admin's dashboard.
--   * agent_events: one row per thing that happened in a run (a step started, ended, a release).
--   * agent_event(): the pipeline on the agents server reports an event, gated by the cron secret.
--   * agent_dashboard(): the signed-in admin (the owner of the catalog rows) reads recent runs.
-- Nobody else can read or write: row level security is on and there are no policies.

begin;

create table if not exists public.agent_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  run text not null,
  kind text not null default 'nightly',
  task_id integer,
  title text,
  stage text not null,
  status text not null,
  note text,
  meta jsonb not null default '{}'::jsonb
);
create index if not exists agent_events_run_idx on public.agent_events (run, id);
create index if not exists agent_events_at_idx on public.agent_events (at desc);
alter table public.agent_events enable row level security;
revoke all on public.agent_events from anon, authenticated;

create or replace function public.agent_event(p_secret text, p_event jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.fr_cron_ok(p_secret) then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  if coalesce(p_event->>'run', '') !~ '^[a-z0-9-]{3,60}$' or coalesce(p_event->>'stage', '') !~ '^[a-z-]{2,30}$' then
    raise exception 'Bad event' using errcode = '22023';
  end if;
  insert into public.agent_events (run, kind, task_id, title, stage, status, note, meta)
  values (
    p_event->>'run',
    left(coalesce(nullif(p_event->>'kind', ''), 'nightly'), 20),
    case when (p_event->>'task_id') ~ '^[0-9]{1,9}$' then (p_event->>'task_id')::integer end,
    left(nullif(p_event->>'title', ''), 200),
    p_event->>'stage',
    left(coalesce(nullif(p_event->>'status', ''), 'info'), 20),
    left(nullif(p_event->>'note', ''), 600),
    case when jsonb_typeof(p_event->'meta') = 'object' and length((p_event->'meta')::text) < 8000 then p_event->'meta' else '{}'::jsonb end
  );
  -- Housekeeping, now and then: three months of history is plenty.
  if random() < 0.02 then
    delete from public.agent_events where at < now() - interval '90 days';
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.agent_dashboard(p_runs integer default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid text := auth.jwt() ->> 'sub';
  v_runs jsonb;
begin
  if v_uid is null or not exists (select 1 from public.companies c where c.is_catalog and c.owner_id = v_uid limit 1) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  with recent as (
    select e.run, min(e.at) as started_at, max(e.at) as last_at
      from public.agent_events e
     where e.at > now() - interval '45 days'
     group by e.run
     order by max(e.at) desc
     limit least(greatest(coalesce(p_runs, 30), 1), 100)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'run', r.run, 'started_at', r.started_at, 'last_at', r.last_at,
           'kind', (select e.kind from public.agent_events e where e.run = r.run order by e.id limit 1),
           'task_id', (select e.task_id from public.agent_events e where e.run = r.run and e.task_id is not null order by e.id limit 1),
           'title', (select e.title from public.agent_events e where e.run = r.run and e.title is not null order by e.id desc limit 1),
           'events', (select jsonb_agg(jsonb_build_object('id', e.id, 'at', e.at, 'stage', e.stage, 'status', e.status, 'note', e.note, 'meta', e.meta) order by e.id)
                        from (select * from public.agent_events x where x.run = r.run order by x.id desc limit 80) e)
         ) order by r.last_at desc), '[]'::jsonb)
    into v_runs
    from recent r;
  return jsonb_build_object('now', now(), 'runs', v_runs);
end $$;

revoke all on function public.agent_event(text, jsonb) from public;
revoke all on function public.agent_dashboard(integer) from public;
grant execute on function public.agent_event(text, jsonb) to anon, authenticated;
grant execute on function public.agent_dashboard(integer) to authenticated;

commit;
