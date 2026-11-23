-- Companies from countries other than the United States (founder task #2: India first).
--   * ingest_catalog(): a new company is stored with the country its row states, instead of the literal 'United States'.
--     Empty or missing -> 'United States' (today's behaviour); us / usa / united states / united states of america -> 'United States';
--     india / in -> 'India'; any other value -> the row is not inserted and counts as skipped.
--     Rows that are already in the catalog are never relabelled (the update branch is unchanged).
--     The body is copied from 202611240001_multi_source.sql lines 117-296; the only changes are the v_country variable,
--     the country check next to the "incomplete row" check, and v_country in the insert.
--   * catalog_list_country(): the body of catalog_list (202611240004_directory_polish.sql lines 77-132) with one more filter, by country.
--     A new name rather than a new overload of catalog_list, so existing calls stay unambiguous.
--   * fr_country_ingest_ready(): lets scripts/ingest.mjs see that this file is applied before it sends non-US rows.
-- Only adds or replaces functions. Idempotent.

-- ---------------------------------------------------------------- loader
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
  v_country text;
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
          -- A badge add from the row's own primary source also confirms the row (weekly re-runs keep verified_at fresh).
          update public.companies c
             set badges = public.fr_merge_badges(c.badges, v_badges),
                 verified_at = case when exists (select 1 from jsonb_array_elements(v_badges) b
                                                  where b->>'source' = public.fr_slugify(c.source)) then now() else c.verified_at end
           where c.id = v_id;
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
        -- The country the row states. Empty keeps today's behaviour; an unknown value is never stored.
        v_country := case
          when nullif(btrim(coalesce(r->>'country', '')), '') is null then 'United States'
          when lower(btrim(r->>'country')) in ('us', 'usa', 'united states', 'united states of america') then 'United States'
          when lower(btrim(r->>'country')) in ('india', 'in') then 'India'
        end;
        if v_name = '' or v_domain is null or v_site is null or v_source is null or v_country is null
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
          v_owner, v_name, v_site, v_country,
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

grant execute on function public.ingest_catalog(text, jsonb, boolean) to anon, authenticated;

-- ---------------------------------------------------------------- list, filtered by country
create or replace function public.catalog_list_country(
  p_country text default null,
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
       and (nullif(public.fr_slugify(p_country), '') is null or public.fr_slugify(c.country) = public.fr_slugify(p_country))
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

grant execute on function public.catalog_list_country(text, text, text, text, text, integer, boolean, integer, integer, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------- readiness probe for scripts/ingest.mjs
create or replace function public.fr_country_ingest_ready() returns boolean
language sql stable as $$ select true $$;

grant execute on function public.fr_country_ingest_ready() to anon, authenticated;
