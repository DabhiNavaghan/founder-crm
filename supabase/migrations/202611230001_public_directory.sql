-- FoundReach public directory.
-- Safe to run more than once. Paste the whole file into the Supabase SQL editor and run it.
--
-- What it adds:
--   * a shared read-only "catalog" (companies.is_catalog) that the public pages read through
--     security definer functions which never return emails, notes or owner ids;
--   * claim_company(): a signed-in user copies one catalog company (with emails) into their own rows;
--   * ingest_companies(): the daily cron adds newly listed companies, gated by a secret hash in app_secrets;
--   * request_removal(): the public "Remove or correct my information" form.

begin;

-- ---------------------------------------------------------------- columns
alter table public.companies add column if not exists logo_url text;
alter table public.companies add column if not exists hiring_email text;
alter table public.companies add column if not exists location text;
alter table public.companies add column if not exists source text;

alter table public.companies add column if not exists is_catalog boolean not null default false;
alter table public.companies add column if not exists slug text;
alter table public.companies add column if not exists batch text;
alter table public.companies add column if not exists batch_year integer;
alter table public.companies add column if not exists first_seen_at timestamptz;
alter table public.companies add column if not exists catalog_slug text;
-- On a user's copy: which catalog contact it was copied from (lets the app preselect the right person).
alter table public.contacts add column if not exists catalog_contact_id uuid;

-- ---------------------------------------------------------------- tables (server-side only: RLS on, no policies)
create table if not exists public.app_secrets (
  name text primary key,
  sha256 text not null
);
create table if not exists public.suppressed_slugs (
  slug text primary key,
  reason text,
  created_at timestamptz not null default now()
);
create table if not exists public.refresh_runs (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default now(),
  our_count integer,
  yc_count integer,
  added integer not null default 0
);
create table if not exists public.removal_requests (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  slug text,
  name text not null,
  relation text,
  request text not null,
  status text not null default 'open'
);
alter table public.app_secrets enable row level security;
alter table public.suppressed_slugs enable row level security;
alter table public.refresh_runs enable row level security;
alter table public.removal_requests enable row level security;
revoke all on public.app_secrets, public.suppressed_slugs, public.refresh_runs, public.removal_requests from anon, authenticated;

-- ---------------------------------------------------------------- small helpers
create or replace function public.fr_slugify(t text) returns text
language sql immutable parallel safe as $$
  select trim(both '-' from regexp_replace(lower(coalesce(t, '')), '[^a-z0-9]+', '-', 'g'))
$$;

-- Removes anything shaped like an email address from free text.
create or replace function public.fr_strip_emails(t text) returns text
language sql immutable parallel safe as $$
  select regexp_replace(t, '[^[:space:]<>"''`=:;,()]*@[A-Za-z0-9._-]+\.[A-Za-z]{2,}', '', 'g')
$$;

-- Only http(s) links leave the database; mailto:, bare emails and anything else become null.
create or replace function public.fr_safe_url(u text) returns text
language sql immutable parallel safe as $$
  select case
    when u is null or btrim(u) = '' then null
    when btrim(u) ~ '[^[:space:]<>"''`=:;,()]*@[A-Za-z0-9._-]+\.[A-Za-z]{2,}' then null
    when btrim(u) ~* '^https?://[^\s<>"]+$' then btrim(u)
    when btrim(u) ~* '^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(/[^\s<>"]*)?$' then 'https://' || btrim(u)
    else null
  end
$$;

-- Winter < Spring < Summer < Fall inside one year. Batch codes: W24, X25 (Spring), S24, F24.
create or replace function public.fr_season_rank(b text) returns integer
language sql immutable parallel safe as $$
  select case upper(left(coalesce(b, ''), 1)) when 'W' then 1 when 'X' then 2 when 'S' then 3 when 'F' then 4 else 0 end
$$;

create or replace function public.fr_like(t text) returns text
language sql immutable parallel safe as $$
  select replace(replace(replace(t, '\', '\\'), '%', '\%'), '_', '\_')
$$;

-- ---------------------------------------------------------------- catalog flag + backfill (first run only)
do $$
begin
  if not exists (select 1 from public.companies where is_catalog) then
    update public.companies
       set is_catalog = true
     where country = 'United States'
       and catalog_slug is null
       and owner_id = (select owner_id from public.companies group by owner_id order by count(*) desc limit 1);
  end if;
end $$;

create unique index if not exists companies_catalog_slug_key on public.companies (slug) where is_catalog;

-- Batch and first-seen date from notes such as
-- "Y Combinator Winter 2016 · Team size: 115 · Stage: Growth · Hiring now · https://www.ycombinator.com/companies/deepgram".
update public.companies c
   set batch = (case s.m[1] when 'Winter' then 'W' when 'Spring' then 'X' when 'Summer' then 'S' else 'F' end)
               || lpad(((s.m[2])::int % 100)::text, 2, '0'),
       batch_year = (s.m[2])::int,
       -- Approximate batch date; never later than the day the row was loaded (upcoming batches are listed early).
       first_seen_at = coalesce(c.first_seen_at, least(c.created_at, make_timestamptz(
         (s.m[2])::int,
         case s.m[1] when 'Winter' then 1 when 'Spring' then 4 when 'Summer' then 7 else 10 end,
         15, 0, 0, 0, 'UTC')))
  from (
    select id, regexp_match(notes, 'Y Combinator (Winter|Spring|Summer|Fall) ((?:19|20)\d{2})') as m
      from public.companies
     where is_catalog and batch is null and notes is not null
  ) s
 where c.id = s.id and s.m is not null;

update public.companies set first_seen_at = created_at where is_catalog and first_seen_at is null;

-- Slugs: the YC slug when notes carry the YC URL, else one made from the name; duplicates get -2, -3, ...
do $$
declare
  r record;
  base text;
  cand text;
  n integer;
begin
  for r in
    select id, name, notes
      from public.companies
     where is_catalog and slug is null
     order by (coalesce(notes, '') ~ 'ycombinator\.com/companies/') desc, created_at, id
  loop
    base := lower(substring(coalesce(r.notes, '') from 'ycombinator\.com/companies/([A-Za-z0-9_-]+)'));
    if base is null or base = '' then base := left(public.fr_slugify(r.name), 80); end if;
    if base is null or base = '' then base := 'company'; end if;
    cand := base;
    n := 1;
    while exists (select 1 from public.companies where is_catalog and slug = cand) loop
      n := n + 1;
      cand := base || '-' || n;
    end loop;
    update public.companies set slug = cand where id = r.id;
  end loop;
end $$;

-- ---------------------------------------------------------------- indexes
create unique index if not exists companies_owner_catalog_slug_key on public.companies (owner_id, catalog_slug) where catalog_slug is not null;
create index if not exists companies_catalog_order_idx on public.companies (batch_year desc nulls last, name) where is_catalog;
create index if not exists companies_catalog_sector_idx on public.companies (public.fr_slugify(sector)) where is_catalog;
create index if not exists companies_catalog_location_idx on public.companies (public.fr_slugify(location)) where is_catalog;
create index if not exists companies_catalog_batch_idx on public.companies (batch) where is_catalog;
create index if not exists companies_catalog_seen_idx on public.companies (first_seen_at desc) where is_catalog;
create index if not exists contacts_company_idx on public.contacts (company_id);
create index if not exists removal_requests_created_idx on public.removal_requests (created_at desc);

-- ---------------------------------------------------------------- guard: only the server decides what is in the catalog
-- Signed-in users write their own company rows directly (RLS). This keeps them from publishing a row
-- into the public catalog or changing a catalog row's public address.
create or replace function public.fr_guard_catalog_columns() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.is_catalog := false;
    new.slug := null;
    new.first_seen_at := null;
  else
    new.is_catalog := old.is_catalog;
    new.slug := old.slug;
    new.first_seen_at := old.first_seen_at;
  end if;
  return new;
end $$;
drop trigger if exists companies_guard_catalog on public.companies;
create trigger companies_guard_catalog before insert or update on public.companies
  for each row execute function public.fr_guard_catalog_columns();

-- ---------------------------------------------------------------- public read (safe columns only)
create or replace function public.fr_catalog_row(c public.companies) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'slug', c.slug,
    'name', public.fr_strip_emails(c.name),
    'batch', c.batch,
    'batch_year', c.batch_year,
    'description', left(btrim(regexp_replace(public.fr_strip_emails(coalesce(c.description, '')), '\s+', ' ', 'g')), 320),
    'sector', nullif(btrim(public.fr_strip_emails(coalesce(c.sector, ''))), ''),
    'city', nullif(btrim(public.fr_strip_emails(coalesce(c.location, ''))), ''),
    'logo_url', public.fr_safe_url(c.logo_url),
    'hiring', nullif(btrim(coalesce(c.careers_url, '')), '') is not null,
    'leaders', (select count(*) from public.contacts k where k.company_id = c.id)
  )
$$;

create or replace function public.catalog_list(
  p_q text default null,
  p_sector text default null,
  p_city text default null,
  p_batch text default null,
  p_year integer default null,
  p_hiring boolean default false,
  p_page integer default 1,
  p_per integer default 30
) returns jsonb
language sql stable security definer set search_path = public as $$
  with f as (
    select c.id, c.batch_year, c.batch, c.name, c.slug
      from public.companies c
     where c.is_catalog and c.slug is not null
       and (nullif(btrim(coalesce(p_q, '')), '') is null
            or c.name ilike '%' || public.fr_like(btrim(p_q)) || '%'
            or c.description ilike '%' || public.fr_like(btrim(p_q)) || '%')
       and (nullif(public.fr_slugify(p_sector), '') is null or public.fr_slugify(c.sector) = public.fr_slugify(p_sector))
       and (nullif(public.fr_slugify(p_city), '') is null or public.fr_slugify(c.location) = public.fr_slugify(p_city))
       and (nullif(btrim(coalesce(p_batch, '')), '') is null or upper(c.batch) = upper(btrim(p_batch)))
       and (p_year is null or c.batch_year = p_year)
       and (not coalesce(p_hiring, false) or nullif(btrim(coalesce(c.careers_url, '')), '') is not null)
  ), page as (
    select f.id,
           row_number() over (order by f.batch_year desc nulls last, public.fr_season_rank(f.batch) desc, lower(f.name), f.slug) as rn
      from f
     order by rn
     limit least(greatest(coalesce(p_per, 30), 1), 100)
    offset (least(greatest(coalesce(p_page, 1), 1), 100000) - 1) * least(greatest(coalesce(p_per, 30), 1), 100)
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    'rows', coalesce((select jsonb_agg(public.fr_catalog_row(c) order by p.rn)
                        from page p join public.companies c on c.id = p.id), '[]'::jsonb)
  )
$$;

create or replace function public.catalog_facets() returns jsonb
language sql stable security definer set search_path = public as $$
  with c as (
    select nullif(btrim(public.fr_strip_emails(coalesce(sector, ''))), '') as sector,
           nullif(btrim(public.fr_strip_emails(coalesce(location, ''))), '') as city,
           batch, batch_year
      from public.companies
     where is_catalog and slug is not null
  )
  select jsonb_build_object(
    'total', (select count(*) from c),
    'sectors', coalesce((select jsonb_agg(jsonb_build_object('value', v, 'count', n) order by n desc, v)
                           from (select sector as v, count(*) as n from c where sector is not null group by sector) s), '[]'::jsonb),
    'cities', coalesce((select jsonb_agg(jsonb_build_object('value', v, 'count', n) order by n desc, v)
                          from (select city as v, count(*) as n from c where city is not null group by city) s), '[]'::jsonb),
    'batches', coalesce((select jsonb_agg(jsonb_build_object('value', v, 'count', n) order by y desc nulls last, public.fr_season_rank(v) desc)
                           from (select batch as v, max(batch_year) as y, count(*) as n from c where batch is not null group by batch) s), '[]'::jsonb),
    'years', coalesce((select jsonb_agg(jsonb_build_object('value', v, 'count', n) order by v desc)
                         from (select batch_year as v, count(*) as n from c where batch_year is not null group by batch_year) s), '[]'::jsonb)
  )
$$;

create or replace function public.catalog_company(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'slug', c.slug,
    'name', public.fr_strip_emails(c.name),
    'batch', c.batch,
    'batch_year', c.batch_year,
    'yc', coalesce(c.source, '') ilike 'y combinator%' or c.batch is not null,
    'name_shared', exists (select 1 from public.companies o
                            where o.is_catalog and o.id <> c.id and lower(o.name) = lower(c.name) and o.batch is not distinct from c.batch),
    'description', btrim(public.fr_strip_emails(coalesce(c.description, ''))),
    'sector', nullif(btrim(public.fr_strip_emails(coalesce(c.sector, ''))), ''),
    'city', nullif(btrim(public.fr_strip_emails(coalesce(c.location, ''))), ''),
    'logo_url', public.fr_safe_url(c.logo_url),
    'website', public.fr_safe_url(c.website),
    'careers_url', public.fr_safe_url(c.careers_url),
    'contact_url', public.fr_safe_url(c.contact_url),
    'linkedin_url', public.fr_safe_url(c.linkedin_url),
    'updated_at', greatest(c.updated_at, c.created_at),
    'leaders', coalesce((
      select jsonb_agg(l.j order by l.tier, l.chief desc, l.created_at, l.id)
        from (
          select jsonb_build_object(
                   'id', k.id,
                   'first_name', btrim(public.fr_strip_emails(coalesce(k.first_name, ''))),
                   'last_name', btrim(public.fr_strip_emails(coalesce(k.last_name, ''))),
                   'role', nullif(btrim(public.fr_strip_emails(coalesce(k.role, ''))), ''),
                   'tier', case when k.role_category = 'Secondary' then 'Secondary' else 'Primary' end,
                   'linkedin_url', public.fr_safe_url(k.linkedin_url)
                 ) as j,
                 case when k.role_category = 'Secondary' then 1 else 0 end as tier,
                 (coalesce(k.role, '') ~* '\m(ceo|chief executive)\M') as chief,
                 k.created_at, k.id
            from public.contacts k
           where k.company_id = c.id
           order by 2, 3 desc, k.created_at, k.id
           limit 40
        ) l
    ), '[]'::jsonb)
  )
    from public.companies c
   where c.is_catalog and c.slug = lower(btrim(coalesce(p_slug, '')))
   limit 1
$$;

-- All catalog slugs as one JSON array (a set-returning function would be cut off at PostgREST's row limit).
create or replace function public.catalog_slugs() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(slug order by slug), '[]'::jsonb)
    from public.companies
   where is_catalog and slug is not null
$$;

-- Companies first seen in the last 7 days; if there are none, the 30 most recent. Plus the latest refresh run.
create or replace function public.catalog_new() returns jsonb
language sql stable security definer set search_path = public as $$
  with recent as (
    select c.id
      from public.companies c
     where c.is_catalog and c.slug is not null and c.first_seen_at >= now() - interval '7 days'
     order by c.first_seen_at desc, lower(c.name)
     limit 200
  ), fallback as (
    select c.id
      from public.companies c
     where c.is_catalog and c.slug is not null and not exists (select 1 from recent)
     order by c.first_seen_at desc nulls last, c.created_at desc, lower(c.name)
     limit 30
  ), pick as (
    select id from recent union all select id from fallback
  )
  select jsonb_build_object(
    'fresh', exists (select 1 from recent),
    'rows', coalesce((select jsonb_agg(public.fr_catalog_row(c) || jsonb_build_object('first_seen_at', c.first_seen_at)
                                       order by c.first_seen_at desc nulls last, c.created_at desc, lower(c.name))
                        from pick p join public.companies c on c.id = p.id), '[]'::jsonb),
    'run', (select jsonb_build_object('ran_at', r.ran_at, 'our_count', r.our_count, 'yc_count', r.yc_count, 'added', r.added)
              from public.refresh_runs r order by r.ran_at desc limit 1)
  )
$$;

-- ---------------------------------------------------------------- claim: copy a catalog company into the caller's workspace
create or replace function public.claim_company(p_slug text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid text := auth.jwt()->>'sub';
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_src public.companies%rowtype;
  v_id uuid;
  v_created boolean := false;
  v_map jsonb;
begin
  if v_uid is null or v_uid = '' then
    raise exception 'Sign in to add this company.' using errcode = '28000';
  end if;
  select * into v_src from public.companies where is_catalog and slug = v_slug limit 1;
  if not found then
    raise exception 'That company is no longer in the directory.' using errcode = 'P0002';
  end if;

  -- The catalog owner already has the row: hand it back as is.
  if v_src.owner_id = v_uid then
    select coalesce(jsonb_object_agg(k.id::text, k.id::text), '{}'::jsonb) into v_map
      from public.contacts k where k.company_id = v_src.id;
    return jsonb_build_object('company_id', v_src.id, 'contacts', v_map, 'own', true, 'created', false);
  end if;

  select id into v_id from public.companies where owner_id = v_uid and catalog_slug = v_slug limit 1;
  if v_id is null then
    if (select count(*) from public.companies
         where owner_id = v_uid and catalog_slug is not null and created_at > now() - interval '1 day') >= 100 then
      raise exception 'Daily limit reached: you can add up to 100 directory companies per day.' using errcode = 'P0001';
    end if;
    insert into public.companies (owner_id, name, website, country, sector, product_type, description, careers_url, contact_url,
                                  linkedin_url, contact_email, email_verified, priority, notes, logo_url, hiring_email,
                                  location, source, batch, batch_year, catalog_slug)
    values (v_uid, v_src.name, v_src.website, v_src.country, v_src.sector, v_src.product_type, v_src.description, v_src.careers_url,
            v_src.contact_url, v_src.linkedin_url, v_src.contact_email, v_src.email_verified, v_src.priority, v_src.notes,
            v_src.logo_url, v_src.hiring_email, v_src.location, v_src.source, v_src.batch, v_src.batch_year, v_slug)
    on conflict (owner_id, catalog_slug) where catalog_slug is not null do nothing
    returning id into v_id;
    if v_id is null then
      -- Another request for the same user and company got there first.
      select id into v_id from public.companies where owner_id = v_uid and catalog_slug = v_slug limit 1;
    else
      v_created := true;
      insert into public.contacts (owner_id, company_id, first_name, last_name, role, role_category, linkedin_url, email,
                                   email_verified, priority, quality_score, catalog_contact_id)
      select v_uid, v_id, k.first_name, k.last_name, k.role, k.role_category, k.linkedin_url, k.email,
             k.email_verified, k.priority, k.quality_score, k.id
        from public.contacts k
       where k.company_id = v_src.id;
    end if;
  end if;

  select coalesce(jsonb_object_agg(k.catalog_contact_id::text, k.id::text), '{}'::jsonb) into v_map
    from public.contacts k
   where k.owner_id = v_uid and k.company_id = v_id and k.catalog_contact_id is not null;
  return jsonb_build_object('company_id', v_id, 'contacts', v_map, 'own', false, 'created', v_created);
end $$;

-- ---------------------------------------------------------------- cron: secret check, known slugs, ingest
create or replace function public.fr_cron_ok(p_secret text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(length(p_secret), 0) >= 16 and exists (
    select 1 from public.app_secrets s
     where s.name = 'cron'
       and lower(s.sha256) = encode(sha256(convert_to(p_secret, 'utf8')), 'hex')
  )
$$;

-- Catalog slugs plus slugs the cron must not look at again (removed on request, or not US companies).
create or replace function public.cron_known_slugs(p_secret text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.fr_cron_ok(p_secret) then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  return jsonb_build_object(
    'catalog', (select coalesce(jsonb_agg(slug), '[]'::jsonb) from public.companies where is_catalog and slug is not null),
    'suppressed', (select coalesce(jsonb_agg(slug), '[]'::jsonb) from public.suppressed_slugs)
  );
end $$;

-- p_rows: [{slug, name, website, location, sector, description, logo_url, careers_url, contact_url, linkedin_url,
--           batch, batch_year, notes, priority, founders:[{first_name,last_name,role,role_category,linkedin_url}]}]
-- A row {slug, skip:true, reason} is only remembered in suppressed_slugs so it is not fetched again.
-- p_tracked (optional): how many of the YC companies counted in p_yc_total were already in the catalog before this run.
create or replace function public.ingest_companies(p_secret text, p_rows jsonb, p_yc_total integer, p_tracked integer default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner text;
  r jsonb;
  f jsonb;
  v_slug text;
  v_id uuid;
  v_pri integer;
  v_added integer := 0;
  v_skipped integer := 0;
  v_people integer := 0;
  v_our integer;
begin
  if not public.fr_cron_ok(p_secret) then
    raise exception 'Unauthorized' using errcode = '28000';
  end if;
  select owner_id into v_owner from public.companies where is_catalog group by owner_id order by count(*) desc limit 1;
  if v_owner is null then
    raise exception 'The catalog has no owner yet.';
  end if;

  if jsonb_typeof(p_rows) = 'array' then
    for r in select value from jsonb_array_elements(p_rows) limit 100 loop
      v_slug := lower(btrim(coalesce(r->>'slug', '')));
      if v_slug !~ '^[a-z0-9][a-z0-9_-]{0,99}$' then
        v_skipped := v_skipped + 1;
        continue;
      end if;
      if coalesce(r->>'skip', '') = 'true' then
        insert into public.suppressed_slugs (slug, reason)
        values (v_slug, left(coalesce(r->>'reason', 'skipped'), 80))
        on conflict (slug) do nothing;
        v_skipped := v_skipped + 1;
        continue;
      end if;
      if nullif(btrim(coalesce(r->>'name', '')), '') is null
         or exists (select 1 from public.companies where is_catalog and slug = v_slug)
         or exists (select 1 from public.suppressed_slugs where slug = v_slug) then
        v_skipped := v_skipped + 1;
        continue;
      end if;
      v_pri := case when coalesce(r->>'priority', '') ~ '^[1-5]$' then (r->>'priority')::integer else 3 end;

      insert into public.companies (owner_id, name, website, country, sector, description, careers_url, contact_url, linkedin_url,
                                    priority, notes, logo_url, location, source, is_catalog, slug, batch, batch_year, first_seen_at)
      values (
        v_owner,
        left(btrim(r->>'name'), 200),
        public.fr_safe_url(left(r->>'website', 500)),
        'United States',
        nullif(left(btrim(coalesce(r->>'sector', '')), 120), ''),
        nullif(left(btrim(public.fr_strip_emails(coalesce(r->>'description', ''))), 700), ''),
        public.fr_safe_url(left(r->>'careers_url', 500)),
        public.fr_safe_url(left(r->>'contact_url', 500)),
        public.fr_safe_url(left(r->>'linkedin_url', 500)),
        v_pri,
        nullif(left(btrim(coalesce(r->>'notes', '')), 500), ''),
        public.fr_safe_url(left(r->>'logo_url', 500)),
        nullif(left(btrim(coalesce(r->>'location', '')), 120), ''),
        'Y Combinator',
        true,
        v_slug,
        case when coalesce(r->>'batch', '') ~ '^[WXSF][0-9]{2}$' then r->>'batch' end,
        case when coalesce(r->>'batch_year', '') ~ '^(19|20)[0-9]{2}$' then (r->>'batch_year')::integer end,
        now()
      )
      returning id into v_id;
      v_added := v_added + 1;

      if jsonb_typeof(r->'founders') = 'array' then
        for f in select value from jsonb_array_elements(r->'founders') limit 12 loop
          continue when nullif(btrim(coalesce(f->>'first_name', '')), '') is null;
          insert into public.contacts (owner_id, company_id, first_name, last_name, role, role_category, linkedin_url, priority, quality_score)
          values (
            v_owner,
            v_id,
            left(btrim(f->>'first_name'), 80),
            nullif(left(btrim(coalesce(f->>'last_name', '')), 120), ''),
            coalesce(nullif(left(btrim(coalesce(f->>'role', '')), 160), ''), 'Founder'),
            case when f->>'role_category' = 'Secondary' then 'Secondary' else 'Primary' end,
            public.fr_safe_url(left(f->>'linkedin_url', 500)),
            v_pri,
            least(100, 10 + 15
              + case when nullif(btrim(coalesce(f->>'last_name', '')), '') is not null then 5 else 0 end
              + case when public.fr_safe_url(f->>'linkedin_url') is not null then 20 else 0 end
              + case when public.fr_safe_url(r->>'website') is not null then 10 else 0 end
              + case when nullif(btrim(coalesce(r->>'description', '')), '') is not null then 10 else 0 end)
          );
          v_people := v_people + 1;
        end loop;
      end if;
    end loop;
  end if;

  select count(*) into v_our from public.companies where is_catalog and slug is not null;
  insert into public.refresh_runs (our_count, yc_count, added)
  values (case when p_tracked is null then v_our else least(p_tracked + v_added, p_yc_total) end, p_yc_total, v_added);
  return jsonb_build_object('added', v_added, 'skipped', v_skipped, 'contacts', v_people, 'catalog_count', v_our, 'yc_count', p_yc_total);
end $$;

-- ---------------------------------------------------------------- removal / correction requests
create or replace function public.request_removal(p_slug text, p_name text, p_relation text, p_request text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_request text := btrim(coalesce(p_request, ''));
begin
  if length(v_name) < 2 or length(v_name) > 120 then
    raise exception 'Please enter your name (2 to 120 characters).' using errcode = '22023';
  end if;
  if length(v_request) < 5 or length(v_request) > 4000 then
    raise exception 'Please describe your request (5 to 4000 characters).' using errcode = '22023';
  end if;
  if length(coalesce(p_slug, '')) > 120 or length(coalesce(p_relation, '')) > 120 then
    raise exception 'That request is too long.' using errcode = '22023';
  end if;
  -- Flood guard for a public, unauthenticated form.
  if (select count(*) from public.removal_requests where created_at > now() - interval '1 hour') >= 120 then
    raise exception 'Too many requests right now. Please try again in an hour.' using errcode = '53400';
  end if;
  insert into public.removal_requests (slug, name, relation, request)
  values (nullif(lower(btrim(coalesce(p_slug, ''))), ''), v_name, nullif(btrim(coalesce(p_relation, '')), ''), v_request);
  return true;
end $$;

-- ---------------------------------------------------------------- who may call what
revoke execute on function public.fr_catalog_row(public.companies) from public, anon, authenticated;
revoke execute on function public.fr_cron_ok(text) from public, anon, authenticated;
revoke execute on function public.fr_guard_catalog_columns() from public, anon, authenticated;

grant execute on function public.catalog_list(text, text, text, text, integer, boolean, integer, integer) to anon, authenticated;
grant execute on function public.catalog_facets() to anon, authenticated;
grant execute on function public.catalog_company(text) to anon, authenticated;
grant execute on function public.catalog_slugs() to anon, authenticated;
grant execute on function public.catalog_new() to anon, authenticated;
grant execute on function public.request_removal(text, text, text, text) to anon, authenticated;
-- Both check the cron secret themselves; the cron calls them with the publishable key.
grant execute on function public.cron_known_slugs(text) to anon, authenticated;
grant execute on function public.ingest_companies(text, jsonb, integer, integer) to anon, authenticated;

revoke execute on function public.claim_company(text) from public, anon;
grant execute on function public.claim_company(text) to authenticated;

commit;

notify pgrst, 'reload schema';
