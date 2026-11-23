-- Adds the company's country to the public catalog payloads, so list rows and company pages can show it.
-- Only one key is added to each function: 'country'. No table, column or data changes.
-- Both bodies are the latest ones (fr_catalog_row from 202611240003, catalog_company from 202611240004) plus that key.
-- Idempotent: create or replace with the same signatures, so the existing grants and revokes stay as they are.

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
    'country', nullif(btrim(public.fr_strip_emails(coalesce(c.country, ''))), ''),
    'logo_url', public.fr_safe_url(c.logo_url),
    'hiring', public.fr_safe_url(c.careers_url) is not null,
    'leaders', (select count(*) from public.contacts k where k.company_id = c.id)
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
    'country', nullif(btrim(public.fr_strip_emails(coalesce(c.country, ''))), ''),
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
