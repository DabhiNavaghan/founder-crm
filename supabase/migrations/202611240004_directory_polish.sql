-- FoundReach public directory polish. Run after 202611240003_directory_v2.sql.
-- Safe to run more than once. Paste the whole file into the Supabase SQL editor and run it.
--
-- Only public read functions change. None of them returns emails, notes, phone numbers or owner ids.
--   * collections are narrower: keywords are matched as whole words in the one-line description only
--     (the part before " — "), and "newly launched" is the latest two batches;
--   * catalog_similar prefers the same sub-sector, then shared description keywords, then the industry;
--   * catalog_company also returns source_labels for the "Source:" line;
--   * catalog_list and catalog_stats are restated only to use the new collection rules efficiently;
--   * catalog_sitemap lists sector and city pages only when they have 10 or more companies.

begin;

-- ---------------------------------------------------------------- helpers
-- The one-line description: the stored text is "one-liner — longer text".
create or replace function public.fr_oneliner(t text) returns text
language sql immutable parallel safe as $$
  select btrim(split_part(coalesce(t, ''), ' — ', 1))
$$;

-- Meaningful lower-case words of a text: 3 or more characters, common and generic startup words removed.
create or replace function public.fr_keywords(t text) returns text[]
language sql immutable parallel safe as $$
  select coalesce(array_agg(distinct w), '{}'::text[])
    from regexp_split_to_table(lower(left(coalesce(t, ''), 500)), '[^a-z0-9]+') as w
   where length(w) >= 3
     and w <> all (array[
       'the','and','for','with','that','this','your','you','our','from','into','their','them','they','are','was','has','have','can','will',
       'all','any','one','new','now','not','but','out','who','how','what','when','where','why','its','than','then','also','more','most',
       'via','per','get','gets','use','uses','used','using','make','makes','making','made','help','helps','helping','build','builds','building','built',
       'let','lets','run','runs','turn','turns','every','each','other','over','just','like','way','ways','best','better','easy','easier','fast','faster',
       'first','next','world','people','based','powered','driven','platform','platforms','company','companies','startup','startups','business','businesses',
       'software','tool','tools','solution','solutions','product','products','service','services','team','teams','work','works','working',
       'app','apps','end','modern','simple','single','real','time','need','needs','take','takes','their','through','without','within','across',
       'enable','enables','enabling','provide','provides','providing','create','creates','creating','automate','automates','automating','automated','automation',
       'customers','customer','users','user','data','native','online','digital','technology','tech','inc','llc','san','francisco','york'
     ])
$$;

-- The latest two YC batches that have a page (5 or more companies).
create or replace function public.fr_latest_batches() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(s.batch), '{}'::text[])
    from (select batch
            from public.companies
           where is_catalog and slug is not null and batch ~ '^[WXSF][0-9]{2}$'
           group by batch
          having count(*) >= 5
           order by max(batch_year) desc nulls last, public.fr_season_rank(batch) desc
           limit 2) s
$$;

-- ---------------------------------------------------------------- collections
-- Keywords are whole words and are looked for in the one-line description only; sector names are whole words too.
create or replace function public.fr_collections(c public.companies, p_latest text[]) returns text[]
language sql immutable as $$
  select array_remove(array[
    case when coalesce(c.sector, '') ~* '\m(ai|artificial intelligence|machine learning)\M'
           or public.fr_oneliner(c.description) ~* '\m(ai|llms?|machine learning|agents?|generative)\M' then 'ai' end,
    case when public.fr_slugify(c.industry) = 'fintech' or public.fr_slugify(c.sector) = 'fintech' then 'fintech' end,
    case when coalesce(c.sector, '') ~* '\m(developer tools|infrastructure)\M'
           or public.fr_oneliner(c.description) ~* '\m(apis?|sdks?|developers?)\M' then 'developer-tools' end,
    case when public.fr_slugify(c.industry) = 'healthcare' or public.fr_slugify(c.sector) = 'healthcare' then 'healthcare' end,
    case when (coalesce(c.sector, '') || ' ' || public.fr_oneliner(c.description)) ~* '\m(climate|carbon|energy|solar|battery|batteries)\M' then 'climate-energy' end,
    case when public.fr_oneliner(c.description) ~* '\mopen[- ]source\M' then 'open-source' end,
    case when (coalesce(c.sector, '') || ' ' || public.fr_oneliner(c.description)) ~* '\m(robotics|hardware|drones?)\M' then 'robotics-hardware' end,
    case when c.batch = any (coalesce(p_latest, '{}'::text[])) then 'newly-launched' end
  ], null)
$$;

create or replace function public.fr_collections(c public.companies) returns text[]
language sql stable as $$
  select public.fr_collections(c, public.fr_latest_batches())
$$;

-- The list and the stats work out the latest batches once per call instead of once per company.
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
       and (nullif(public.fr_slugify(p_collection), '') is null or public.fr_slugify(p_collection) = any (public.fr_collections(c, (select public.fr_latest_batches()))))
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
           public.fr_sources(k) as sources, public.fr_collections(k, (select public.fr_latest_batches())) as collections
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

-- ---------------------------------------------------------------- similar companies
-- Tier 1: the same sub-sector (sector). Tier 2: the same industry and at least two shared description keywords.
-- Tier 3: the same industry. A lower tier is only added while fewer than 3 companies are found.
-- Inside a tier: more shared keywords first, then +2 same city, +1 batch year within 1, +1 hiring.
-- Returns the top 6, or nothing when fewer than 3 exist. A company without an industry is matched on its sector.
create or replace function public.catalog_similar(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  with me as (
    select c.id, nullif(public.fr_slugify(c.industry), '') as ik, nullif(public.fr_slugify(c.sector), '') as sk,
           nullif(public.fr_slugify(c.location), '') as ck, c.batch_year,
           public.fr_keywords(c.description) as kw
      from public.companies c
     where c.is_catalog and c.slug = lower(btrim(coalesce(p_slug, '')))
     limit 1
  ), cand as (
    select o.id, o.batch_year, o.name, o.slug,
           (me.sk is not null and public.fr_slugify(o.sector) = me.sk
              and (me.ik is null or nullif(public.fr_slugify(o.industry), '') is null or public.fr_slugify(o.industry) = me.ik)) as same_sector,
           (me.ik is not null and public.fr_slugify(o.industry) = me.ik) as same_industry,
           (select count(*) from unnest(public.fr_keywords(o.description)) w where w = any (me.kw)) as shared,
           (case when me.ck is not null and public.fr_slugify(o.location) = me.ck then 2 else 0 end)
         + (case when me.batch_year is not null and o.batch_year is not null and abs(o.batch_year - me.batch_year) <= 1 then 1 else 0 end)
         + (case when public.fr_safe_url(o.careers_url) is not null then 1 else 0 end) as score
      from me
      join public.companies o
        on o.is_catalog and o.slug is not null and o.id <> me.id
       and ((me.ik is not null and public.fr_slugify(o.industry) = me.ik)
            or (me.sk is not null and public.fr_slugify(o.sector) = me.sk))
  ), tiered as (
    select k.*, case when k.same_sector then 1 when k.same_industry and k.shared >= 2 then 2 when k.same_industry then 3 end as tier
      from cand k
  ), lim as (
    select case when (select count(*) from tiered where tier = 1) >= 3 then 1
                when (select count(*) from tiered where tier <= 2) >= 3 then 2
                else 3 end as max_tier
  ), pool as (
    select t.* from tiered t, lim where t.tier is not null and t.tier <= lim.max_tier
  ), top as (
    select s.id, row_number() over (order by s.tier, s.shared desc, s.score desc, s.batch_year desc nulls last, lower(s.name), s.slug) as rn
      from pool s
     order by rn
     limit 6
  )
  select case when (select count(*) from pool) >= 3
    then coalesce((select jsonb_agg(public.fr_catalog_row(c) order by t.rn) from top t join public.companies c on c.id = t.id), '[]'::jsonb)
    else '[]'::jsonb end
$$;

-- ---------------------------------------------------------------- company page, sitemap
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
    -- Names of the public lists this company comes from, for the "Source:" line. Empty when none is known.
    'source_labels', (
      select coalesce(jsonb_agg(y.l order by y.o), '[]'::jsonb)
        from (select x.l, min(x.o) as o
                from (select public.fr_source_label(b.j ->> 'source') as l, b.ord as o
                        from jsonb_array_elements(public.fr_badges(c)) with ordinality as b(j, ord)
                       where b.j ? 'source') x
               where coalesce(x.l, '') <> ''
               group by x.l) y
    ),
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
       where d.slug = any (public.fr_collections(c, (select public.fr_latest_batches())))
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

-- Sector and city pages are listed only when they have 10 or more companies (smaller ones still render, with noindex).
create or replace function public.catalog_sitemap() returns jsonb
language sql stable security definer set search_path = public as $$
  with c as (
    select k.slug, k.batch, k.batch_year, greatest(k.updated_at, k.created_at) as lastmod,
           public.fr_slugify(k.industry) as ik, public.fr_slugify(k.location) as ck,
           public.fr_safe_url(k.careers_url) is not null as hiring,
           public.fr_sources(k) as sources, public.fr_collections(k, (select public.fr_latest_batches())) as collections
      from public.companies k
     where k.is_catalog and k.slug is not null
  )
  select jsonb_build_object(
    'lastmod', (select max(lastmod) from c),
    'companies', coalesce((select jsonb_agg(jsonb_build_object('slug', slug, 'lastmod', to_char(lastmod at time zone 'UTC', 'YYYY-MM-DD')) order by slug) from c), '[]'::jsonb),
    'sectors', coalesce((select jsonb_agg(ik order by ik) from (select ik from c where ik <> '' group by ik having count(*) >= 10) s), '[]'::jsonb),
    'cities', coalesce((select jsonb_agg(ck order by ck) from (select ck from c where ck <> '' group by ck having count(*) >= 10) s), '[]'::jsonb),
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
revoke execute on function public.fr_collections(public.companies, text[]) from public, anon, authenticated;
revoke execute on function public.fr_collections(public.companies) from public, anon, authenticated;
revoke execute on function public.fr_latest_batches() from public, anon, authenticated;
grant execute on function public.catalog_list(text, text, text, text, integer, boolean, integer, integer, text, text, text) to anon, authenticated;
grant execute on function public.catalog_stats() to anon, authenticated;
grant execute on function public.catalog_company(text) to anon, authenticated;
grant execute on function public.catalog_similar(text) to anon, authenticated;
grant execute on function public.catalog_sitemap() to anon, authenticated;

commit;

notify pgrst, 'reload schema';
