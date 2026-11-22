-- FoundReach pipeline. Run after 202611240001_multi_source.sql (it also runs safely without it).
-- Safe to run more than once. Paste the whole file into the Supabase SQL editor and run it.
--
--   * claim_company(): the catalog owner now gets a normal saved copy too, so the owner's
--     pipeline holds only companies they saved, never the catalog itself;
--   * a saved copy also carries industry, badges, source link and domain;
--   * companies.archived_at backs the Archive action in the pipeline;
--   * one-off: outreach the catalog owner logged directly on catalog rows moves onto saved copies.
--     Catalog rows and catalog contacts are not changed.

begin;

-- Columns added by the multi-source migration; restated so this file stands alone.
alter table public.companies add column if not exists industry text;
alter table public.companies add column if not exists source_url text;
alter table public.companies add column if not exists badges jsonb;
alter table public.companies add column if not exists domain text;
alter table public.companies add column if not exists verified_at timestamptz;

alter table public.companies add column if not exists archived_at timestamptz;

create index if not exists companies_owner_private_idx on public.companies (owner_id, created_at desc) where not is_catalog;

-- ---------------------------------------------------------------- copy one catalog company into a user's own rows
-- Internal: only claim_company() and this migration call it.
create or replace function public.fr_claim_for(p_uid text, p_slug text, p_enforce_cap boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_src public.companies%rowtype;
  v_id uuid;
  v_created boolean := false;
  v_map jsonb;
begin
  if p_uid is null or p_uid = '' then
    raise exception 'Sign in to add this company.' using errcode = '28000';
  end if;
  select * into v_src from public.companies where is_catalog and slug = v_slug limit 1;
  if not found then
    raise exception 'That company is no longer in the directory.' using errcode = 'P0002';
  end if;

  select id into v_id from public.companies
   where owner_id = p_uid and catalog_slug = v_slug and not is_catalog limit 1;
  if v_id is null then
    if p_enforce_cap and (select count(*) from public.companies
         where owner_id = p_uid and catalog_slug is not null and created_at > now() - interval '1 day') >= 100 then
      raise exception 'Daily limit reached: you can add up to 100 directory companies per day.' using errcode = 'P0001';
    end if;
    insert into public.companies (owner_id, name, website, country, industry, sector, product_type, description, careers_url, contact_url,
                                  linkedin_url, contact_email, email_verified, priority, notes, logo_url, hiring_email,
                                  location, source, source_url, badges, domain, batch, batch_year, catalog_slug)
    values (p_uid, v_src.name, v_src.website, v_src.country, v_src.industry, v_src.sector, v_src.product_type, v_src.description,
            v_src.careers_url, v_src.contact_url, v_src.linkedin_url, v_src.contact_email, v_src.email_verified, v_src.priority,
            v_src.notes, v_src.logo_url, v_src.hiring_email, v_src.location, v_src.source, v_src.source_url, v_src.badges,
            v_src.domain, v_src.batch, v_src.batch_year, v_slug)
    on conflict (owner_id, catalog_slug) where catalog_slug is not null do nothing
    returning id into v_id;
    if v_id is null then
      -- Another request for the same user and company got there first.
      select id into v_id from public.companies
       where owner_id = p_uid and catalog_slug = v_slug and not is_catalog limit 1;
    else
      v_created := true;
      insert into public.contacts (owner_id, company_id, first_name, last_name, role, role_category, linkedin_url, email,
                                   email_verified, priority, quality_score, catalog_contact_id)
      select p_uid, v_id, k.first_name, k.last_name, k.role, k.role_category, k.linkedin_url, k.email,
             k.email_verified, k.priority, k.quality_score, k.id
        from public.contacts k
       where k.company_id = v_src.id;
    end if;
  end if;

  select coalesce(jsonb_object_agg(k.catalog_contact_id::text, k.id::text), '{}'::jsonb) into v_map
    from public.contacts k
   where k.owner_id = p_uid and k.company_id = v_id and k.catalog_contact_id is not null;
  return jsonb_build_object('company_id', v_id, 'contacts', v_map, 'own', false, 'created', v_created);
end $$;

-- ---------------------------------------------------------------- claim: what the app calls
-- Same contract as before: {company_id, contacts{catalogContactId: newId}, own, created}; 100 new copies per day.
-- "own" is now always false: every caller, the catalog owner included, gets a saved copy.
create or replace function public.claim_company(p_slug text) returns jsonb
language sql security definer set search_path = public as $$
  select public.fr_claim_for(auth.jwt()->>'sub', p_slug, true)
$$;

revoke execute on function public.fr_claim_for(text, text, boolean) from public, anon, authenticated;
revoke execute on function public.claim_company(text) from public, anon;
grant execute on function public.claim_company(text) to authenticated;

-- ---------------------------------------------------------------- copies made before this file: fill the new fields
update public.companies c
   set industry = coalesce(c.industry, s.industry),
       badges = coalesce(c.badges, s.badges),
       source_url = coalesce(c.source_url, s.source_url),
       domain = coalesce(c.domain, s.domain),
       logo_url = coalesce(c.logo_url, s.logo_url)
  from public.companies s
 where s.is_catalog and s.slug = c.catalog_slug
   and not c.is_catalog and c.catalog_slug is not null
   and ((c.industry is null and s.industry is not null)
     or (c.badges is null and s.badges is not null)
     or (c.source_url is null and s.source_url is not null)
     or (c.domain is null and s.domain is not null)
     or (c.logo_url is null and s.logo_url is not null));

-- ---------------------------------------------------------------- one-off: move outreach off catalog rows
-- Any message or event the catalog owner logged against a catalog company (or one of its people) is
-- re-pointed at that owner's saved copy, which is created here when missing. Does nothing when there is none.
do $$
declare
  r record;
  v_new uuid;
  v_created boolean;
  v_first timestamptz;
begin
  for r in
    select c.owner_id, c.id as src_id, c.slug
      from public.companies c
     where c.is_catalog and c.slug is not null
       and (exists (select 1 from public.outreach_events e
                     where e.owner_id = c.owner_id
                       and (e.company_id = c.id
                            or e.contact_id in (select k.id from public.contacts k where k.company_id = c.id)))
         or exists (select 1 from public.outreach_messages m
                     where m.owner_id = c.owner_id
                       and (m.company_id = c.id
                            or m.contact_id in (select k.id from public.contacts k where k.company_id = c.id))))
  loop
    select (j->>'company_id')::uuid, (j->>'created')::boolean into v_new, v_created
      from public.fr_claim_for(r.owner_id, r.slug, false) j;

    -- A person added to the catalog after the copy was made, but who has outreach: copy them too.
    insert into public.contacts (owner_id, company_id, first_name, last_name, role, role_category, linkedin_url, email,
                                 email_verified, priority, quality_score, catalog_contact_id)
    select r.owner_id, v_new, k.first_name, k.last_name, k.role, k.role_category, k.linkedin_url, k.email,
           k.email_verified, k.priority, k.quality_score, k.id
      from public.contacts k
     where k.company_id = r.src_id
       and not exists (select 1 from public.contacts n where n.company_id = v_new and n.catalog_contact_id = k.id)
       and (exists (select 1 from public.outreach_events e where e.owner_id = r.owner_id and e.contact_id = k.id)
         or exists (select 1 from public.outreach_messages m where m.owner_id = r.owner_id and m.contact_id = k.id));

    -- The outreach state lives with the copy from now on.
    update public.contacts n
       set status = o.status,
           next_follow_up_at = coalesce(n.next_follow_up_at, o.next_follow_up_at),
           warm_contact = n.warm_contact or o.warm_contact,
           notes = coalesce(n.notes, o.notes)
      from public.contacts o
     where n.company_id = v_new and n.catalog_contact_id = o.id
       and n.status = 'researching' and o.status <> 'researching';

    select min(t) into v_first from (
      select e.occurred_at as t from public.outreach_events e
       where e.owner_id = r.owner_id
         and (e.company_id = r.src_id or e.contact_id in (select k.id from public.contacts k where k.company_id = r.src_id))
      union all
      select m.created_at from public.outreach_messages m
       where m.owner_id = r.owner_id
         and (m.company_id = r.src_id or m.contact_id in (select k.id from public.contacts k where k.company_id = r.src_id))
    ) s;

    update public.outreach_events e
       set company_id = v_new,
           contact_id = (select n.id from public.contacts n where n.company_id = v_new and n.catalog_contact_id = e.contact_id limit 1)
     where e.owner_id = r.owner_id
       and (e.company_id = r.src_id or e.contact_id in (select k.id from public.contacts k where k.company_id = r.src_id));

    update public.outreach_messages m
       set company_id = v_new,
           contact_id = (select n.id from public.contacts n where n.company_id = v_new and n.catalog_contact_id = m.contact_id limit 1)
     where m.owner_id = r.owner_id
       and (m.company_id = r.src_id or m.contact_id in (select k.id from public.contacts k where k.company_id = r.src_id));

    -- A copy made here is dated by its first outreach, so it does not count against today's saving limit.
    if v_created and v_first is not null then
      update public.companies set created_at = least(created_at, v_first) where id = v_new;
    end if;
  end loop;
end $$;

commit;

notify pgrst, 'reload schema';
