-- FoundReach: companies from sources beyond Y Combinator.
-- Run after 202611230002_directory_fixes.sql. Safe to run more than once.
--
--   * companies.source_url, badges, domain, verified_at (+ backfill for the existing catalog);
--   * ingest_catalog(): loads companies from any source, deduplicated on website domain;
--   * ingest_companies() (daily YC cron) now also stores badges / source_url / domain / verified_at,
--     and adds a YC badge to an existing row instead of creating a second row for the same website.
--
-- Column contract
--   source       text   primary source name: 'Y Combinator', '500 Global', 'Antler', 'a16z', 'Accel', 'Hacker News', ...
--   source_url   text   the page on the source that lists the company
--   badges       jsonb  [{"label": "YC S24", "source": "yc"}, {"label": "a16z portfolio", "source": "a16z"}, ...]
--                       source is a URL-safe lower-case slug; a company can carry several badges
--   domain       text   website host, lower-case, without "www."
--   verified_at  timestamptz  when the record was last confirmed from its source

begin;

alter table public.companies add column if not exists source_url text;
alter table public.companies add column if not exists badges jsonb not null default '[]'::jsonb;
alter table public.companies add column if not exists domain text;
alter table public.companies add column if not exists verified_at timestamptz;

-- ---------------------------------------------------------------- helpers
-- 'https://www.Example.com/path?x' -> 'example.com'; null when there is no usable host.
create or replace function public.fr_domain(u text) returns text
language sql immutable parallel safe as $$
  select case when h ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' then h end
    from (select regexp_replace(
                   lower(substring(btrim(coalesce(u, '')) from '^(?:[A-Za-z][A-Za-z0-9+.-]*://)?(?:[^/@?#]*@)?([^/:?#]+)')),
                   '^www\.', '') as h) s
$$;

-- Hosts shared by many unrelated projects: a match on one of these says nothing about who the company is.
create or replace function public.fr_shared_host(d text) returns boolean
language sql immutable parallel safe as $$
  select coalesce(d, '') ~ '(^|\.)(github\.com|github\.io|gitlab\.com|google\.com|apple\.com|notion\.site|notion\.so|linktr\.ee|linkedin\.com|twitter\.com|x\.com|facebook\.com|instagram\.com|youtube\.com|medium\.com|substack\.com|vercel\.app|netlify\.app|herokuapp\.com|pages\.dev|web\.app|ycombinator\.com|producthunt\.com|carrd\.co|wixsite\.com|wordpress\.com|typeform\.com|calendly\.com)$'
$$;

-- Keeps well-formed badges only: label 1-60 chars (no emails), source a URL-safe lower-case slug. Duplicates dropped, order kept.
create or replace function public.fr_clean_badges(b jsonb) returns jsonb
language sql immutable parallel safe as $$
  select coalesce(jsonb_agg(jsonb_build_object('label', k.label, 'source', k.source) order by k.ord), '[]'::jsonb)
    from (
      select distinct on (lower(label), source) label, source, ord
        from (
          select left(btrim(regexp_replace(public.fr_strip_emails(e.value->>'label'), '\s+', ' ', 'g')), 60) as label,
                 lower(btrim(e.value->>'source')) as source,
                 e.ord
            from jsonb_array_elements(case when jsonb_typeof(b) = 'array' then b else '[]'::jsonb end) with ordinality as e(value, ord)
           where jsonb_typeof(e.value) = 'object'
        ) x
       where x.label <> '' and x.source ~ '^[a-z0-9][a-z0-9-]{0,39}$'
       order by lower(label), source, ord
    ) k
$$;

-- a, then whatever b adds.
create or replace function public.fr_merge_badges(a jsonb, b jsonb) returns jsonb
language sql immutable parallel safe as $$
  select public.fr_clean_badges(
    (case when jsonb_typeof(a) = 'array' then a else '[]'::jsonb end) || (case when jsonb_typeof(b) = 'array' then b else '[]'::jsonb end))
$$;

-- ---------------------------------------------------------------- backfill (catalog rows)
update public.companies
   set domain = public.fr_domain(website)
 where is_catalog and domain is null and public.fr_domain(website) is not null;

-- Y Combinator rows: badge from the batch, source_url = the YC page (it is inside notes; otherwise built from the slug).
update public.companies c
   set badges = public.fr_merge_badges(
         jsonb_build_array(jsonb_build_object('label', case when c.batch is not null then 'YC ' || c.batch else 'Y Combinator' end, 'source', 'yc')),
         c.badges)
 where c.is_catalog
   and (c.batch is not null or coalesce(c.source, '') ilike 'y combinator%')
   and not c.badges @> '[{"source": "yc"}]'::jsonb;

update public.companies c
   set source_url = coalesce(
         substring(c.notes from 'https?://www\.ycombinator\.com/companies/[A-Za-z0-9_-]+'),
         'https://www.ycombinator.com/companies/' || c.slug)
 where c.is_catalog and c.source_url is null and c.slug is not null
   and (c.batch is not null or coalesce(c.source, '') ilike 'y combinator%');

update public.companies c
   set source = 'Y Combinator'
 where c.is_catalog and c.batch is not null and nullif(btrim(coalesce(c.source, '')), '') is null;

-- The few rows imported from topstartups.io.
update public.companies c
   set source_url = coalesce(c.source_url, 'https://topstartups.io/'),
       badges = public.fr_merge_badges(c.badges, '[{"label": "topstartups.io", "source": "topstartups"}]'::jsonb)
 where c.is_catalog and c.source = 'topstartups.io' and c.batch is null
   and (c.source_url is null or not c.badges @> '[{"source": "topstartups"}]'::jsonb);

-- Last confirmed from the source: the day the row was loaded.
update public.companies
   set verified_at = coalesce(created_at, first_seen_at, now())
 where is_catalog and verified_at is null;

create index if not exists companies_catalog_domain_idx on public.companies (domain) where is_catalog;
create index if not exists companies_catalog_source_idx on public.companies (public.fr_slugify(source)) where is_catalog;
create index if not exists companies_catalog_badges_idx on public.companies using gin (badges jsonb_path_ops) where is_catalog;

-- ---------------------------------------------------------------- ingest from any source
-- p_rows: [{domain, slug, name, website, description, location, sector, industry, logo_url, careers_url, contact_url, linkedin_url,
--           contact_email, hiring_email, source, source_url, badges:[{label, source}], batch_year, notes,
--           people:[{first_name, last_name, role, role_category, linkedin_url}]}]
--   or a "badge add" row: {badge_only: true, domain and/or slug, badges:[...]}  (only ever touches a row that already exists)
--
-- A row is matched to the catalog by website domain. If the company is already there, only its empty fields are filled,
-- its badges are merged and missing people are added (matched on lower-cased full name); nothing that is already set is overwritten.
-- Otherwise it is inserted under the catalog owner with is_catalog = true.
-- p_new: true -> new rows count as "new this week" (first_seen_at = now()); false (bulk loads) -> they do not.
create or replace function public.ingest_catalog(p_secret text, p_rows jsonb, p_new boolean default true)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_owner text;
  r jsonb;
  f jsonb;
  v_id uuid;
  v_domain text;
  v_slug text;
  v_base text;
  v_cand text;
  v_n integer;
  v_name text;
  v_site text;
  v_source text;
  v_badges jsonb;
  v_old jsonb;
  v_only boolean;
  v_first text;
  v_last text;
  v_added integer := 0;
  v_updated integer := 0;
  v_badged integer := 0;
  v_people integer := 0;
  v_skipped integer := 0;
  v_suppressed integer := 0;
  v_unmatched integer := 0;
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
    for r in select value from jsonb_array_elements(p_rows) limit 500 loop
      continue when jsonb_typeof(r) <> 'object';
      v_only := coalesce(r->>'badge_only', '') = 'true';
      v_badges := public.fr_clean_badges(r->'badges');
      v_domain := public.fr_domain(coalesce(nullif(btrim(coalesce(r->>'domain', '')), ''), r->>'website'));
      v_slug := lower(btrim(coalesce(r->>'slug', '')));
      if v_slug !~ '^[a-z0-9][a-z0-9_-]{0,99}$' then v_slug := null; end if;
      if public.fr_shared_host(v_domain) then v_domain := null; end if;

      -- ---- already in the catalog?
      v_id := null;
      if v_domain is not null then
        select id into v_id from public.companies where is_catalog and domain = v_domain order by created_at, id limit 1;
      end if;
      if v_id is null and v_only and v_slug is not null then
        select id into v_id from public.companies where is_catalog and slug = v_slug limit 1;
      end if;

      if v_id is not null then
        select badges into v_old from public.companies where id = v_id;
        if v_only then
          update public.companies
             set badges = public.fr_merge_badges(badges, v_badges)
           where id = v_id and badges is distinct from public.fr_merge_badges(badges, v_badges);
        else
          update public.companies c
             set badges = public.fr_merge_badges(c.badges, v_badges),
                 verified_at = now(),
                 description = coalesce(nullif(btrim(c.description), ''), nullif(left(btrim(public.fr_strip_emails(coalesce(r->>'description', ''))), 700), '')),
                 location = coalesce(nullif(btrim(c.location), ''), nullif(left(btrim(coalesce(r->>'location', '')), 120), '')),
                 sector = coalesce(nullif(btrim(c.sector), ''), nullif(left(btrim(coalesce(r->>'sector', '')), 120), '')),
                 industry = coalesce(nullif(btrim(c.industry), ''), nullif(left(btrim(coalesce(r->>'industry', '')), 80), '')),
                 logo_url = coalesce(nullif(btrim(c.logo_url), ''), public.fr_safe_url(left(r->>'logo_url', 500))),
                 careers_url = coalesce(nullif(btrim(c.careers_url), ''), public.fr_safe_url(left(r->>'careers_url', 500))),
                 contact_url = coalesce(nullif(btrim(c.contact_url), ''), public.fr_contact_url(left(r->>'contact_url', 500))),
                 linkedin_url = coalesce(nullif(btrim(c.linkedin_url), ''), public.fr_safe_linkedin(left(r->>'linkedin_url', 500))),
                 contact_email = coalesce(nullif(btrim(c.contact_email), ''), nullif(left(btrim(coalesce(r->>'contact_email', '')), 200), '')),
                 hiring_email = coalesce(nullif(btrim(c.hiring_email), ''), nullif(left(btrim(coalesce(r->>'hiring_email', '')), 200), '')),
                 source = coalesce(nullif(btrim(c.source), ''), nullif(left(btrim(coalesce(r->>'source', '')), 80), '')),
                 source_url = coalesce(nullif(btrim(c.source_url), ''), public.fr_safe_url(left(r->>'source_url', 500)))
           where c.id = v_id;
          v_updated := v_updated + 1;
        end if;
        if (select badges from public.companies where id = v_id) is distinct from v_old then
          v_badged := v_badged + 1;
        end if;
      elsif v_only then
        v_unmatched := v_unmatched + 1;
        continue;
      else
        -- ---- a new company
        v_name := left(btrim(regexp_replace(public.fr_strip_emails(coalesce(r->>'name', '')), '\s+', ' ', 'g')), 200);
        v_site := public.fr_safe_url(left(r->>'website', 500));
        v_source := nullif(left(btrim(coalesce(r->>'source', '')), 80), '');
        if v_name = '' or v_domain is null or v_site is null or v_source is null
           or nullif(btrim(coalesce(r->>'description', '')), '') is null then
          v_skipped := v_skipped + 1;
          continue;
        end if;
        v_base := coalesce(v_slug, nullif(left(public.fr_slugify(v_name), 80), ''), 'company');
        -- Removed on request (or ruled out): never comes back under the same address.
        if exists (select 1 from public.suppressed_slugs s
                    where s.slug in (v_base, left(public.fr_slugify(v_name), 80)) and coalesce(s.reason, '') not like 'merged:%') then
          v_suppressed := v_suppressed + 1;
          continue;
        end if;
        v_cand := v_base;
        if exists (select 1 from public.companies where is_catalog and slug = v_cand) then
          v_cand := left(v_base || '-' || public.fr_slugify(split_part(v_domain, '.', 1)), 96);
          v_base := v_cand;
          v_n := 1;
          while exists (select 1 from public.companies where is_catalog and slug = v_cand) loop
            v_n := v_n + 1;
            v_cand := v_base || '-' || v_n;
          end loop;
        end if;

        insert into public.companies (owner_id, name, website, country, industry, sector, description, careers_url, contact_url, linkedin_url,
                                      contact_email, hiring_email, priority, notes, logo_url, location, source, source_url, badges, domain,
                                      verified_at, is_catalog, slug, batch_year, first_seen_at)
        values (
          v_owner, v_name, v_site, 'United States',
          nullif(left(btrim(coalesce(r->>'industry', '')), 80), ''),
          nullif(left(btrim(coalesce(r->>'sector', '')), 120), ''),
          nullif(left(btrim(public.fr_strip_emails(coalesce(r->>'description', ''))), 700), ''),
          public.fr_safe_url(left(r->>'careers_url', 500)),
          public.fr_contact_url(left(r->>'contact_url', 500)),
          public.fr_safe_linkedin(left(r->>'linkedin_url', 500)),
          nullif(left(btrim(coalesce(r->>'contact_email', '')), 200), ''),
          nullif(left(btrim(coalesce(r->>'hiring_email', '')), 200), ''),
          3,
          nullif(left(btrim(coalesce(r->>'notes', '')), 500), ''),
          public.fr_safe_url(left(r->>'logo_url', 500)),
          nullif(left(btrim(coalesce(r->>'location', '')), 120), ''),
          v_source,
          public.fr_safe_url(left(r->>'source_url', 500)),
          v_badges, v_domain, now(), true, v_cand,
          case when coalesce(r->>'batch_year', '') ~ '^(19|20)[0-9]{2}$' then (r->>'batch_year')::integer end,
          case when coalesce(p_new, true) then now() else timestamptz '2020-01-01 00:00:00+00' end
        )
        returning id into v_id;
        v_added := v_added + 1;
      end if;

      -- ---- people the source (or the company's own site) publishes; never a second copy of the same name
      if not v_only and jsonb_typeof(r->'people') = 'array' then
        for f in select value from jsonb_array_elements(r->'people') limit 12 loop
          v_first := left(btrim(public.fr_strip_emails(coalesce(f->>'first_name', ''))), 80);
          v_last := nullif(left(btrim(public.fr_strip_emails(coalesce(f->>'last_name', ''))), 120), '');
          continue when v_first = '';
          continue when exists (
            select 1 from public.contacts k
             where k.company_id = v_id
               and lower(btrim(k.first_name || ' ' || coalesce(k.last_name, ''))) = lower(btrim(v_first || ' ' || coalesce(v_last, ''))));
          insert into public.contacts (owner_id, company_id, first_name, last_name, role, role_category, linkedin_url, priority, quality_score)
          values (
            v_owner, v_id, v_first, v_last,
            nullif(left(btrim(coalesce(f->>'role', '')), 160), ''),
            case when f->>'role_category' = 'Secondary' then 'Secondary' else 'Primary' end,
            -- people only link to a personal /in/ profile
            case when public.fr_safe_linkedin(left(f->>'linkedin_url', 500)) ~* 'linkedin\.com/in/' then public.fr_safe_linkedin(left(f->>'linkedin_url', 500)) end,
            3,
            least(100, 10 + 15
              + case when v_last is not null then 5 else 0 end
              + case when public.fr_safe_linkedin(f->>'linkedin_url') ~* 'linkedin\.com/in/' then 20 else 0 end
              + 10
              + case when nullif(btrim(coalesce(r->>'description', '')), '') is not null then 10 else 0 end)
          );
          v_people := v_people + 1;
        end loop;
      end if;
    end loop;
  end if;

  select count(*) into v_our from public.companies where is_catalog and slug is not null;
  return jsonb_build_object('added', v_added, 'updated', v_updated, 'badged', v_badged, 'contacts', v_people, 'skipped', v_skipped,
                            'suppressed', v_suppressed, 'unmatched', v_unmatched, 'catalog_count', v_our);
end $$;

-- ---------------------------------------------------------------- daily YC ingest: same contract as before, plus the new columns
-- If the company's website is already in the catalog under another source, the existing row gets the YC badge and batch
-- (no second row), and the YC slug is remembered as 'merged:<slug>' so the cron stops asking for it.
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
  v_batch text;
  v_year integer;
  v_domain text;
  v_badge jsonb;
  v_url text;
  v_added integer := 0;
  v_skipped integer := 0;
  v_merged integer := 0;
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
      v_batch := case when coalesce(r->>'batch', '') ~ '^[WXSF][0-9]{2}$' then r->>'batch' end;
      v_year := case when coalesce(r->>'batch_year', '') ~ '^(19|20)[0-9]{2}$' then (r->>'batch_year')::integer end;
      v_domain := public.fr_domain(r->>'website');
      v_badge := jsonb_build_array(jsonb_build_object('label', case when v_batch is not null then 'YC ' || v_batch else 'Y Combinator' end, 'source', 'yc'));
      v_url := 'https://www.ycombinator.com/companies/' || v_slug;

      -- Same website already listed from another source: add the YC badge there instead of a second row.
      v_id := null;
      if v_domain is not null and not public.fr_shared_host(v_domain) then
        select id into v_id from public.companies
         where is_catalog and domain = v_domain and not badges @> '[{"source": "yc"}]'::jsonb
         order by created_at, id limit 1;
      end if;
      if v_id is not null then
        update public.companies c
           set badges = public.fr_merge_badges(c.badges, v_badge),
               batch = coalesce(c.batch, v_batch),
               batch_year = case when c.batch is null then coalesce(v_year, c.batch_year) else c.batch_year end,
               industry = coalesce(nullif(btrim(c.industry), ''), nullif(left(btrim(coalesce(r->>'industry', '')), 80), '')),
               location = coalesce(nullif(btrim(c.location), ''), nullif(left(btrim(coalesce(r->>'location', '')), 120), '')),
               verified_at = now()
         where c.id = v_id;
        insert into public.suppressed_slugs (slug, reason)
        values (v_slug, left('merged:' || coalesce((select slug from public.companies where id = v_id), ''), 80))
        on conflict (slug) do nothing;
        v_merged := v_merged + 1;
        continue;
      end if;

      insert into public.companies (owner_id, name, website, country, industry, sector, description, careers_url, contact_url, linkedin_url,
                                    priority, notes, logo_url, location, source, is_catalog, slug, batch, batch_year, first_seen_at,
                                    source_url, badges, domain, verified_at)
      values (
        v_owner,
        left(btrim(r->>'name'), 200),
        public.fr_safe_url(left(r->>'website', 500)),
        'United States',
        nullif(left(btrim(coalesce(r->>'industry', '')), 80), ''),
        nullif(left(btrim(coalesce(r->>'sector', '')), 120), ''),
        nullif(left(btrim(public.fr_strip_emails(coalesce(r->>'description', ''))), 700), ''),
        public.fr_safe_url(left(r->>'careers_url', 500)),
        public.fr_contact_url(left(r->>'contact_url', 500)),
        public.fr_safe_linkedin(left(r->>'linkedin_url', 500)),
        v_pri,
        nullif(left(btrim(coalesce(r->>'notes', '')), 500), ''),
        public.fr_safe_url(left(r->>'logo_url', 500)),
        nullif(left(btrim(coalesce(r->>'location', '')), 120), ''),
        'Y Combinator',
        true,
        v_slug,
        v_batch,
        v_year,
        now(),
        v_url, v_badge, v_domain, now()
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
  return jsonb_build_object('added', v_added, 'skipped', v_skipped, 'merged', v_merged, 'contacts', v_people, 'catalog_count', v_our, 'yc_count', p_yc_total);
end $$;

-- ---------------------------------------------------------------- who may call what
-- Both check the cron secret themselves; they are called with the publishable key.
grant execute on function public.ingest_catalog(text, jsonb, boolean) to anon, authenticated;
grant execute on function public.ingest_companies(text, jsonb, integer, integer) to anon, authenticated;

commit;

notify pgrst, 'reload schema';
