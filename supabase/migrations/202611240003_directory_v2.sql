-- FoundReach public directory v2: read functions for the new public pages.
-- Run after 202611240001_multi_source.sql and 202611240002_pipeline.sql.
-- Safe to run more than once. Paste the whole file into the Supabase SQL editor and run it.
--
-- Only public read functions live here. None of them returns emails, notes, phone numbers or owner ids.
--   * catalog_list      gains p_source, p_collection, p_sort and a "facts" block (older calls keep working);
--   * catalog_facets    gains "sources";
--   * catalog_company   gains badges, verified_at, leaders_count, sector_city and collections;
--   * catalog_similar   companies in the same industry, scored;
--   * catalog_stats     counts and link lists for the landing page, the footer and /about-data;
--   * catalog_crosslinks  top cities of a sector / top sectors of a city;
--   * catalog_sitemap   everything the sitemap lists, with thresholds applied.

begin;

do $$
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'companies' and column_name in ('badges', 'verified_at')) < 2 then
    raise exception 'Run 202611240001_multi_source.sql first: companies.badges and companies.verified_at are missing.';
  end if;
end $$;

-- ---------------------------------------------------------------- helpers
-- URL-safe key for a source. "Y Combinator" and the badge source "yc" are the same source.
create or replace function public.fr_source_slug(t text) returns text
language sql immutable parallel safe as $$
  select case
    when btrim(coalesce(t, '')) ilike 'y combinator%' or lower(btrim(coalesce(t, ''))) in ('yc', 'ycombinator') then 'yc'
    else nullif(left(public.fr_slugify(t), 60), '')
  end
$$;

-- Every source a company belongs to: its badges (or, without badges, its source column), and YC when it has a YC batch.
create or replace function public.fr_sources(c public.companies) returns text[]
language sql immutable as $$
  select coalesce(array_agg(distinct x.s) filter (where x.s is not null), '{}'::text[])
    from (
      select public.fr_source_slug(b ->> 'source') as s
        from jsonb_array_elements(case when jsonb_typeof(c.badges) = 'array' then c.badges else '[]'::jsonb end) as b
       where jsonb_typeof(b) = 'object'
      union all
      -- The source column only counts for rows without badges (its spelling can differ from the badge key).
      select public.fr_source_slug(c.source)
       where not (jsonb_typeof(c.badges) = 'array' and c.badges @> '[{}]'::jsonb and jsonb_path_exists(c.badges, '$[*].source'))
      union all
      select 'yc' where c.batch is not null
    ) x
$$;

-- Up to 8 text badges: [{label, source, batch?}]. List rows show two and "+N"; the company page shows all. Falls back to the YC batch, then to the source name.
create or replace function public.fr_badges(c public.companies) returns jsonb
language sql immutable as $$
  with raw as (
    select left(btrim(regexp_replace(public.fr_strip_emails(coalesce(b ->> 'label', '')), '\s+', ' ', 'g')), 40) as label,
           public.fr_source_slug(b ->> 'source') as source,
           ord::integer as ord
      from jsonb_array_elements(case when jsonb_typeof(c.badges) = 'array' then c.badges else '[]'::jsonb end) with ordinality as t(b, ord)
     where jsonb_typeof(b) = 'object'
  ), kept as (
    select label, source, ord from raw where label <> '' order by ord limit 8
  ), from_batch as (
    select 'YC ' || c.batch as label, 'yc'::text as source, 1 as ord
     where c.batch ~ '^[WXSF][0-9]{2}$' and not exists (select 1 from kept)
  ), from_source as (
    select left(btrim(public.fr_strip_emails(c.source)), 40) as label, public.fr_source_slug(c.source) as source, 1 as ord
     where not exists (select 1 from kept) and not exists (select 1 from from_batch)
       and public.fr_source_slug(c.source) is not null
       and btrim(public.fr_strip_emails(coalesce(c.source, ''))) <> ''
  )
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'label', z.label,
           'source', z.source,
           'batch', case when z.source = 'yc'
                         then coalesce(upper(substring(z.label from '\m([WXSFwxsf][0-9]{2})\M')),
                                       case when c.batch ~ '^[WXSF][0-9]{2}$' then c.batch end) end
         )) order by z.ord), '[]'::jsonb)
    from (select * from kept union all select * from from_batch union all select * from from_source) z
$$;

-- Rule-based collections.
create or replace function public.fr_collection_defs() returns table (slug text, name text, ord integer)
language sql immutable parallel safe as $$
  values ('ai', 'AI startups', 1),
         ('fintech', 'Fintech startups', 2),
         ('developer-tools', 'Developer tools startups', 3),
         ('healthcare', 'Healthcare startups', 4),
         ('climate-energy', 'Climate and energy startups', 5),
         ('open-source', 'Open source startups', 6),
         ('robotics-hardware', 'Robotics and hardware startups', 7),
         ('newly-launched', 'Newly launched startups', 8)
$$;

create or replace function public.fr_collections(c public.companies) returns text[]
language sql stable as $$
  select array_remove(array[
    case when coalesce(c.sector, '') ~* '(\mai\M|artificial intelligence|machine learning)'
           or coalesce(c.description, '') ~* '\m(ai|llms?|machine learning|agents?)\M' then 'ai' end,
    case when public.fr_slugify(c.industry) = 'fintech' or public.fr_slugify(c.sector) = 'fintech' then 'fintech' end,
    case when coalesce(c.sector, '') ~* '(developer tools|infrastructure)'
           or coalesce(c.description, '') ~* '\m(apis?|sdks?|developers?)\M' then 'developer-tools' end,
    case when public.fr_slugify(c.industry) = 'healthcare' or public.fr_slugify(c.sector) = 'healthcare' then 'healthcare' end,
    case when (coalesce(c.sector, '') || ' ' || coalesce(c.description, '')) ~* '\m(climate|carbon|energy|solar|battery|batteries)\M' then 'climate-energy' end,
    case when coalesce(c.description, '') ~* '\mopen[- ]source' then 'open-source' end,
    case when (coalesce(c.sector, '') || ' ' || coalesce(c.description, '')) ~* '\m(robotics|hardware|drones?)\M' then 'robotics-hardware' end,
    case when c.batch_year >= extract(year from now())::integer - 1
           or c.first_seen_at >= now() - interval '90 days' then 'newly-launched' end
  ], null)
$$;

-- "S24" -> "YC Summer 2024".
create or replace function public.fr_batch_label(b text) returns text
language sql immutable parallel safe as $$
  select case when b ~ '^[WXSF][0-9]{2}$'
    then 'YC ' || (case left(b, 1) when 'W' then 'Winter' when 'X' then 'Spring' when 'S' then 'Summer' else 'Fall' end)
         || ' ' || (2000 + right(b, 2)::integer)::text
  end
$$;

create or replace function public.fr_source_label(p_slug text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    case p_slug when 'yc' then 'Y Combinator' end,
    -- The most common badge label for this source, without a trailing year ("Techstars 2023" -> "Techstars").
    (select nullif(btrim(regexp_replace(btrim(left(public.fr_strip_emails(b ->> 'label'), 40)), '\s+((19|20)[0-9]{2}|[WXSF][0-9]{2})$', '')), '')
       from public.companies c,
            jsonb_array_elements(case when jsonb_typeof(c.badges) = 'array' then c.badges else '[]'::jsonb end) as b
      where c.is_catalog and c.slug is not null and jsonb_typeof(b) = 'object' and public.fr_source_slug(b ->> 'source') = p_slug
      group by 1 order by count(*) desc, 1 limit 1),
    (select btrim(public.fr_strip_emails(c.source))
       from public.companies c
      where c.is_catalog and c.slug is not null and public.fr_source_slug(c.source) = p_slug
        and btrim(public.fr_strip_emails(coalesce(c.source, ''))) <> ''
      group by 1 order by count(*) desc, 1 limit 1),
    initcap(replace(coalesce(p_slug, ''), '-', ' '))
  )
$$;

-- ---------------------------------------------------------------- list rows
create or replace function public.fr_catalog_row(c public.companies) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'slug', c.slug,
    'name', public.fr_strip_emails(c.name),
    'batch', c.batch,
    'batch_year', c.batch_year,
    'badges', public.fr_badges(c),
    'description', left(btrim(regexp_replace(public.fr_strip_emails(coalesce(c.description, '')), '\s+', ' ', 'g')), 320),
    'industry', nullif(btrim(public.fr_strip_emails(coalesce(c.industry, ''))), ''),
    'sector', nullif(btrim(public.fr_strip_emails(coalesce(c.sector, ''))), ''),
    'city', nullif(btrim(public.fr_strip_emails(coalesce(c.location, ''))), ''),
    'logo_url', public.fr_safe_url(c.logo_url),
    'hiring', public.fr_safe_url(c.careers_url) is not null,
    'leaders', (select count(*) from public.contacts k where k.company_id = c.id)
  )
$$;

-- The 8-argument version is replaced by one with three more optional arguments; older calls keep working.
drop function if exists public.catalog_list(text, text, text, text, integer, boolean, integer, integer);

-- p_sector matches the industry slug or the (finer) sector slug. p_source is a source key such as "yc".
-- p_collection is a collection slug. p_sort = 'hiring' lists hiring companies first, then newest.
create or replace function public.catalog_list(
  p_q text default null,
  p_sector text default null,
  p_city text default null,
  p_batch text default null,
  p_year integer default null,
  p_hiring boolean default false,
  p_page integer default 1,
  p_per integer default 30,
  p_source text default null,
  p_collection text default null,
  p_sort text default null
) returns jsonb
language sql stable security definer set search_path = public as $$
  with f as (
    select c.id, c.batch_year, c.batch, c.name, c.slug, c.first_seen_at,
           (public.fr_safe_url(c.careers_url) is not null) as hiring
      from public.companies c
     where c.is_catalog and c.slug is not null
       and (nullif(btrim(coalesce(p_q, '')), '') is null
            or c.name ilike '%' || public.fr_like(btrim(p_q)) || '%'
            or c.description ilike '%' || public.fr_like(btrim(p_q)) || '%')
       and (nullif(public.fr_slugify(p_sector), '') is null
            or public.fr_slugify(c.industry) = public.fr_slugify(p_sector)
            or public.fr_slugify(c.sector) = public.fr_slugify(p_sector))
       and (nullif(public.fr_slugify(p_city), '') is null or public.fr_slugify(c.location) = public.fr_slugify(p_city))
       and (nullif(btrim(coalesce(p_batch, '')), '') is null or upper(c.batch) = upper(btrim(p_batch)))
       and (p_year is null or c.batch_year = p_year)
       and (not coalesce(p_hiring, false) or public.fr_safe_url(c.careers_url) is not null)
       and (public.fr_source_slug(p_source) is null or public.fr_source_slug(p_source) = any (public.fr_sources(c)))
       and (nullif(public.fr_slugify(p_collection), '') is null or public.fr_slugify(p_collection) = any (public.fr_collections(c)))
  ), page as (
    -- Companies without a batch come after every batched company.
    select f.id,
           row_number() over (order by
             (case when lower(coalesce(p_sort, '')) = 'hiring' and f.hiring then 0 else 1 end),
             (f.batch is null), f.batch_year desc nulls last, public.fr_season_rank(f.batch) desc,
             (case when lower(coalesce(p_sort, '')) = 'hiring' then f.first_seen_at end) desc nulls last,
             lower(f.name), f.slug) as rn
      from f
     order by rn
     limit least(greatest(coalesce(p_per, 30), 1), 100)
    offset (least(greatest(coalesce(p_page, 1), 1), 100000) - 1) * least(greatest(coalesce(p_per, 30), 1), 100)
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    -- Totals for the whole filtered set, shown as the facts strip on page-type pages.
    'facts', jsonb_build_object(
      'hiring', (select count(*) from f where f.hiring),
      'leaders', (select count(*) from public.contacts q join f on f.id = q.company_id),
      'new', (select count(*) from f where f.first_seen_at >= now() - interval '7 days')
    ),
    'rows', coalesce((select jsonb_agg(public.fr_catalog_row(c) order by p.rn)
                        from page p join public.companies c on c.id = p.id), '[]'::jsonb)
  )
$$;

-- Options are merged by slug (the same key catalog_list filters on), shown under their most common spelling.
create or replace function public.catalog_facets() returns jsonb
language sql stable security definer set search_path = public as $$
  with c as (
    select nullif(btrim(coalesce(industry, '')), '') as industry,
           nullif(btrim(coalesce(sector, '')), '') as sector,
           nullif(btrim(coalesce(location, '')), '') as city,
           batch, batch_year, public.fr_sources(k) as sources
      from public.companies k
     where is_catalog and slug is not null
  ), named as (
    select kind, public.fr_slugify(v) as key, (array_agg(v order by n desc, v))[1] as v, sum(n)::bigint as n
      from (
        select 'industries' as kind, industry as v, count(*) as n from c where public.fr_slugify(industry) <> '' group by industry
        union all
        select 'sectors', sector, count(*) from c where public.fr_slugify(sector) <> '' group by sector
        union all
        select 'cities', city, count(*) from c where public.fr_slugify(city) <> '' group by city
      ) s
     group by kind, public.fr_slugify(v)
  ), merged as (
    -- The sector filter matches a slug against industry or sector, so the count shown must do the same.
    select m.kind, m.v,
           case when m.kind = 'cities' then m.n
                else (select count(*) from c where public.fr_slugify(c.industry) = m.key or public.fr_slugify(c.sector) = m.key) end as n
      from named m
  ), src as (
    select s as slug, count(*) as n from c, unnest(c.sources) as s group by s
  )
  select jsonb_build_object(
    'total', (select count(*) from c),
    'industries', coalesce((select jsonb_agg(jsonb_build_object('value', public.fr_strip_emails(v), 'count', n) order by n desc, v) from merged where kind = 'industries'), '[]'::jsonb),
    'sectors', coalesce((select jsonb_agg(jsonb_build_object('value', public.fr_strip_emails(v), 'count', n) order by n desc, v) from merged where kind = 'sectors'), '[]'::jsonb),
    'cities', coalesce((select jsonb_agg(jsonb_build_object('value', public.fr_strip_emails(v), 'count', n) order by n desc, v) from merged where kind = 'cities'), '[]'::jsonb),
    'batches', coalesce((select jsonb_agg(jsonb_build_object('value', v, 'count', n) order by y desc nulls last, public.fr_season_rank(v) desc)
                           from (select batch as v, max(batch_year) as y, count(*) as n from c where batch is not null group by batch) s), '[]'::jsonb),
    'years', coalesce((select jsonb_agg(jsonb_build_object('value', v, 'count', n) order by v desc)
                         from (select batch_year as v, count(*) as n from c where batch_year is not null group by batch_year) s), '[]'::jsonb),
    'sources', coalesce((select jsonb_agg(jsonb_build_object('value', public.fr_source_label(slug), 'slug', slug, 'count', n) order by n desc, slug) from src), '[]'::jsonb)
  )
$$;

-- ---------------------------------------------------------------- company page
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
    'industry', nullif(btrim(public.fr_strip_emails(coalesce(c.industry, ''))), ''),
    'sector', nullif(btrim(public.fr_strip_emails(coalesce(c.sector, ''))), ''),
    'city', nullif(btrim(public.fr_strip_emails(coalesce(c.location, ''))), ''),
    'logo_url', public.fr_safe_url(c.logo_url),
    'website', public.fr_safe_url(c.website),
    'careers_url', public.fr_safe_url(c.careers_url),
    'contact_url', public.fr_contact_url(c.contact_url),
    'linkedin_url', public.fr_safe_linkedin(c.linkedin_url),
    'updated_at', greatest(c.updated_at, c.created_at),
    'verified_at', c.verified_at,
    -- Each YC badge says whether its batch page exists (5 or more companies). Source pages are checked by the server
    -- against catalog_stats().top_sources.
    'badges', (
      select coalesce(jsonb_agg(b.j || jsonb_build_object(
               'batch_page', (b.j ? 'batch') and (select count(*) from public.companies o
                                                    where o.is_catalog and o.slug is not null and o.batch = b.j ->> 'batch') >= 5
             ) order by b.ord), '[]'::jsonb)
        from jsonb_array_elements(public.fr_badges(c)) with ordinality as b(j, ord)
    ),
    -- The /sector/:sector/:city page this company belongs to, when it has 10 or more companies.
    'sector_city', (
      select case when count(*) >= 10 then jsonb_build_object(
               'sector', coalesce(nullif(btrim(public.fr_strip_emails(coalesce(c.industry, ''))), ''), btrim(public.fr_strip_emails(coalesce(c.sector, '')))),
               'sector_slug', k.sk, 'city', btrim(public.fr_strip_emails(coalesce(c.location, ''))), 'city_slug', k.ck, 'count', count(*)) end
        from public.companies o
       where k.sk is not null and k.ck is not null
         and o.is_catalog and o.slug is not null
         and (public.fr_slugify(o.industry) = k.sk or public.fr_slugify(o.sector) = k.sk)
         and public.fr_slugify(o.location) = k.ck
    ),
    -- Every collection the company is in. The server shows at most 2 and only those with a page
    -- (20 or more companies, from catalog_stats().collections).
    'collections', (
      select coalesce(jsonb_agg(jsonb_build_object('slug', d.slug, 'name', d.name) order by d.ord), '[]'::jsonb)
        from public.fr_collection_defs() d
       where d.slug = any (public.fr_collections(c))
    ),
    'leaders_count', (select count(*) from public.contacts q where q.company_id = c.id),
    'leaders', coalesce((
      select jsonb_agg(l.j order by l.tier, l.chief desc, l.created_at, l.id)
        from (
          select jsonb_build_object(
                   'id', q.id,
                   'first_name', btrim(public.fr_strip_emails(coalesce(q.first_name, ''))),
                   'last_name', btrim(public.fr_strip_emails(coalesce(q.last_name, ''))),
                   'role', nullif(btrim(public.fr_strip_emails(coalesce(q.role, ''))), ''),
                   'tier', case when q.role_category = 'Secondary' then 'Secondary' else 'Primary' end,
                   'linkedin_url', public.fr_safe_linkedin(q.linkedin_url)
                 ) as j,
                 case when q.role_category = 'Secondary' then 1 else 0 end as tier,
                 (coalesce(q.role, '') ~* '\m(ceo|chief executive)\M') as chief,
                 q.created_at, q.id
            from public.contacts q
           where q.company_id = c.id
           order by 2, 3 desc, q.created_at, q.id
           limit 40
        ) l
    ), '[]'::jsonb)
  )
    from public.companies c
   cross join lateral (
     select coalesce(nullif(public.fr_slugify(c.industry), ''), nullif(public.fr_slugify(c.sector), '')) as sk,
            nullif(public.fr_slugify(c.location), '') as ck
   ) k
   where c.is_catalog and c.slug = lower(btrim(coalesce(p_slug, '')))
   limit 1
$$;

-- Similar companies: the same industry is required; +3 same sector, +2 same city, +1 batch year within 1, +1 hiring.
-- Returns the top 6, or nothing when fewer than 3 companies share the industry.
create or replace function public.catalog_similar(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  with me as (
    select c.id, nullif(public.fr_slugify(c.industry), '') as ik, nullif(public.fr_slugify(c.sector), '') as sk,
           nullif(public.fr_slugify(c.location), '') as ck, c.batch_year
      from public.companies c
     where c.is_catalog and c.slug = lower(btrim(coalesce(p_slug, '')))
     limit 1
  ), scored as (
    select o.id, o.batch_year, o.name, o.slug,
           (case when me.sk is not null and public.fr_slugify(o.sector) = me.sk then 3 else 0 end)
         + (case when me.ck is not null and public.fr_slugify(o.location) = me.ck then 2 else 0 end)
         + (case when me.batch_year is not null and o.batch_year is not null and abs(o.batch_year - me.batch_year) <= 1 then 1 else 0 end)
         + (case when public.fr_safe_url(o.careers_url) is not null then 1 else 0 end) as score
      from me
      join public.companies o
        on o.is_catalog and o.slug is not null and o.id <> me.id
       and me.ik is not null and public.fr_slugify(o.industry) = me.ik
  ), top as (
    select s.id, row_number() over (order by s.score desc, s.batch_year desc nulls last, lower(s.name), s.slug) as rn
      from scored s
     order by rn
     limit 6
  )
  select case when (select count(*) from scored) >= 3
    then coalesce((select jsonb_agg(public.fr_catalog_row(c) order by t.rn) from top t join public.companies c on c.id = t.id), '[]'::jsonb)
    else '[]'::jsonb end
$$;

-- ---------------------------------------------------------------- stats, cross links, sitemap
-- Counts and link lists for the landing page, the footer on every public page and /about-data.
-- Lists only name pages that exist (batch: 5 or more companies, source: 10 or more, collection: 20 or more).
create or replace function public.catalog_stats() returns jsonb
language sql stable security definer set search_path = public as $$
  with c as (
    select k.id, k.slug, k.name, k.batch, k.batch_year, k.first_seen_at, k.verified_at,
           nullif(btrim(public.fr_strip_emails(coalesce(k.industry, ''))), '') as industry,
           nullif(btrim(public.fr_strip_emails(coalesce(k.location, ''))), '') as city,
           public.fr_safe_url(k.website) is not null as has_site,
           public.fr_safe_url(k.careers_url) is not null as hiring,
           public.fr_contact_url(k.contact_url) is not null as has_contact,
           public.fr_safe_linkedin(k.linkedin_url) is not null as has_linkedin,
           exists (select 1 from public.contacts q where q.company_id = k.id) as has_leaders,
           public.fr_sources(k) as sources, public.fr_collections(k) as collections
      from public.companies k
     where k.is_catalog and k.slug is not null
  ), sec as (
    select public.fr_slugify(industry) as slug, (array_agg(industry order by industry))[1] as label, count(*) as n
      from c where public.fr_slugify(industry) <> '' group by 1
  ), cit as (
    select public.fr_slugify(city) as slug, (array_agg(city order by city))[1] as label, count(*) as n
      from c where public.fr_slugify(city) <> '' group by 1
  ), src as (
    select s as slug, count(*) as n from c, unnest(c.sources) as s group by s
  ), bat as (
    select batch, max(batch_year) as y, count(*) as n from c where batch ~ '^[WXSF][0-9]{2}$' group by batch having count(*) >= 5
  ), col as (
    select d.slug, d.name, d.ord, (select count(*) from c where d.slug = any (c.collections)) as n from public.fr_collection_defs() d
  ), newest as (
    select c.id, row_number() over (order by c.first_seen_at desc nulls last, (c.batch is null), c.batch_year desc nulls last,
                                             public.fr_season_rank(c.batch) desc, lower(c.name), c.slug) as rn
      from c order by rn limit 6
  )
  select jsonb_build_object(
    'companies', (select count(*) from c),
    'leaders', (select count(*) from public.contacts q join c on c.id = q.company_id),
    'hiring', (select count(*) from c where hiring),
    'new_this_week', (select count(*) from c where first_seen_at >= now() - interval '7 days'),
    'sources', (select count(*) from src),
    'top_sectors', coalesce((select jsonb_agg(jsonb_build_object('label', label, 'slug', slug, 'count', n, 'url', '/sector/' || slug) order by n desc, label)
                               from (select * from sec order by n desc, label limit 8) s), '[]'::jsonb),
    'top_cities', coalesce((select jsonb_agg(jsonb_build_object('label', label, 'slug', slug, 'count', n, 'url', '/city/' || slug) order by n desc, label)
                              from (select * from cit order by n desc, label limit 8) s), '[]'::jsonb),
    'top_sources', coalesce((select jsonb_agg(jsonb_build_object('label', public.fr_source_label(slug), 'slug', slug, 'count', n, 'url', '/source/' || slug) order by n desc, slug)
                               from src where n >= 10), '[]'::jsonb),
    'latest_batches', coalesce((select jsonb_agg(jsonb_build_object('label', public.fr_batch_label(batch), 'code', batch, 'slug', lower(batch), 'count', n, 'url', '/batch/' || lower(batch))
                                                 order by y desc nulls last, public.fr_season_rank(batch) desc)
                                  from (select * from bat order by y desc nulls last, public.fr_season_rank(batch) desc limit 6) s), '[]'::jsonb),
    'collections', coalesce((select jsonb_agg(jsonb_build_object('label', name, 'slug', slug, 'count', n, 'url', '/collections/' || slug) order by ord)
                               from col where n >= 20), '[]'::jsonb),
    'hiring_sectors', coalesce((select jsonb_agg(jsonb_build_object('label', label, 'slug', slug, 'count', n, 'url', '/hiring/' || slug) order by n desc, label)
                                  from (select public.fr_slugify(industry) as slug, (array_agg(industry order by industry))[1] as label, count(*) as n
                                          from c where hiring and public.fr_slugify(industry) <> '' group by 1 having count(*) >= 10) s), '[]'::jsonb),
    'newest', coalesce((select jsonb_agg(public.fr_catalog_row(k) order by n.rn) from newest n join public.companies k on k.id = n.id), '[]'::jsonb),
    'coverage', jsonb_build_object(
      'website', (select count(*) from c where has_site),
      'careers', (select count(*) from c where hiring),
      'contact', (select count(*) from c where has_contact),
      'linkedin', (select count(*) from c where has_linkedin),
      'leaders', (select count(*) from c where has_leaders),
      'verified', (select count(*) from c where verified_at is not null),
      'last_verified_at', (select max(verified_at) from c),
      'last_run', (select jsonb_build_object('ran_at', r.ran_at, 'added', r.added)
                     from public.refresh_runs r order by r.ran_at desc, r.id desc limit 1)
    )
  )
$$;

-- For a sector page: its top cities (pages with 10 or more companies) and how many of its companies are hiring.
-- For a city page: its top sectors. Sector means industry here, as on the sector pages.
create or replace function public.catalog_crosslinks(p_sector text default null, p_city text default null) returns jsonb
language sql stable security definer set search_path = public as $$
  with a as (
    select nullif(public.fr_slugify(p_sector), '') as sk, nullif(public.fr_slugify(p_city), '') as ck
  ), c as (
    select nullif(btrim(public.fr_strip_emails(coalesce(k.industry, ''))), '') as industry,
           nullif(btrim(public.fr_strip_emails(coalesce(k.location, ''))), '') as city,
           public.fr_slugify(k.industry) as ik, public.fr_slugify(k.sector) as sk, public.fr_slugify(k.location) as ck,
           public.fr_safe_url(k.careers_url) is not null as hiring
      from public.companies k
     where k.is_catalog and k.slug is not null
  )
  select jsonb_build_object(
    'cities', coalesce((
      select jsonb_agg(jsonb_build_object('label', t.label, 'slug', t.slug, 'count', t.n) order by t.n desc, t.label)
        from (select c.ck as slug, (array_agg(c.city order by c.city))[1] as label, count(*) as n
                from c, a
               where a.sk is not null and (c.ik = a.sk or c.sk = a.sk) and c.ck <> ''
               group by c.ck having count(*) >= 10
               order by count(*) desc, 2 limit 8) t), '[]'::jsonb),
    'sectors', coalesce((
      select jsonb_agg(jsonb_build_object('label', t.label, 'slug', t.slug, 'count', t.n) order by t.n desc, t.label)
        from (select c.ik as slug, (array_agg(c.industry order by c.industry))[1] as label, count(*) as n
                from c, a
               where a.ck is not null and c.ck = a.ck and c.ik <> ''
               group by c.ik having count(*) >= 10
               order by count(*) desc, 2 limit 8) t), '[]'::jsonb),
    'hiring', (select count(*) from c, a where a.sk is not null and (c.ik = a.sk or c.sk = a.sk) and c.hiring)
  )
$$;

-- Everything the sitemap lists. Thresholds are applied here so no listed URL is a 404.
create or replace function public.catalog_sitemap() returns jsonb
language sql stable security definer set search_path = public as $$
  with c as (
    select k.slug, k.batch, k.batch_year, greatest(k.updated_at, k.created_at) as lastmod,
           public.fr_slugify(k.industry) as ik, public.fr_slugify(k.location) as ck,
           public.fr_safe_url(k.careers_url) is not null as hiring,
           public.fr_sources(k) as sources, public.fr_collections(k) as collections
      from public.companies k
     where k.is_catalog and k.slug is not null
  )
  select jsonb_build_object(
    'lastmod', (select max(lastmod) from c),
    'companies', coalesce((select jsonb_agg(jsonb_build_object('slug', slug, 'lastmod', to_char(lastmod at time zone 'UTC', 'YYYY-MM-DD')) order by slug) from c), '[]'::jsonb),
    'sectors', coalesce((select jsonb_agg(ik order by ik) from (select distinct ik from c where ik <> '') s), '[]'::jsonb),
    'cities', coalesce((select jsonb_agg(ck order by ck) from (select distinct ck from c where ck <> '') s), '[]'::jsonb),
    'batches', coalesce((select jsonb_agg(lower(batch) order by y desc nulls last, public.fr_season_rank(batch) desc)
                           from (select batch, max(batch_year) as y from c where batch ~ '^[WXSF][0-9]{2}$' group by batch having count(*) >= 5) s), '[]'::jsonb),
    'sources', coalesce((select jsonb_agg(s order by s) from (select s from c, unnest(c.sources) as s group by s having count(*) >= 10) x), '[]'::jsonb),
    'hiring', (select count(*) from c where hiring),
    'hiring_sectors', coalesce((select jsonb_agg(ik order by ik) from (select ik from c where hiring and ik <> '' group by ik having count(*) >= 10) s), '[]'::jsonb),
    'sector_cities', coalesce((select jsonb_agg(jsonb_build_object('sector', ik, 'city', ck) order by ik, ck)
                                 from (select ik, ck from c where ik <> '' and ck <> '' group by ik, ck having count(*) >= 10) s), '[]'::jsonb),
    'collections', coalesce((select jsonb_agg(d.slug order by d.ord)
                               from public.fr_collection_defs() d
                              where (select count(*) from c where d.slug = any (c.collections)) >= 20), '[]'::jsonb)
  )
$$;

-- ---------------------------------------------------------------- who may call what
revoke execute on function public.fr_catalog_row(public.companies) from public, anon, authenticated;
revoke execute on function public.fr_sources(public.companies) from public, anon, authenticated;
revoke execute on function public.fr_badges(public.companies) from public, anon, authenticated;
revoke execute on function public.fr_collections(public.companies) from public, anon, authenticated;
revoke execute on function public.fr_source_label(text) from public, anon, authenticated;

grant execute on function public.catalog_list(text, text, text, text, integer, boolean, integer, integer, text, text, text) to anon, authenticated;
grant execute on function public.catalog_facets() to anon, authenticated;
grant execute on function public.catalog_company(text) to anon, authenticated;
grant execute on function public.catalog_similar(text) to anon, authenticated;
grant execute on function public.catalog_stats() to anon, authenticated;
grant execute on function public.catalog_crosslinks(text, text) to anon, authenticated;
grant execute on function public.catalog_sitemap() to anon, authenticated;

commit;

notify pgrst, 'reload schema';
