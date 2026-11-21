-- FounderFlow initial schema. Clerk is the identity provider; owner_id stores Clerk's immutable user ID.
create extension if not exists pgcrypto;

create table if not exists public.companies (
 id uuid primary key default gen_random_uuid(),
 owner_id text not null,
 name text not null,
 website text,
 country text,
 sector text,
 product_type text,
 description text,
 careers_url text,
 contact_url text,
 linkedin_url text,
 contact_email text,
 email_verified boolean not null default false,
 status text not null default 'researching',
 priority integer not null default 3 check (priority between 1 and 5),
 outreach_angle text,
 recent_news text,
 notes text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.contacts (
 id uuid primary key default gen_random_uuid(),
 owner_id text not null,
 company_id uuid not null references public.companies(id) on delete cascade,
 first_name text not null,
 last_name text,
 role text,
 role_category text,
 linkedin_url text,
 email text,
 email_verified boolean not null default false,
 phone text,
 warm_contact boolean not null default false,
 priority integer not null default 3 check (priority between 1 and 5),
 next_follow_up_at timestamptz,
 status text not null default 'researching',
 quality_score integer not null default 0 check (quality_score between 0 and 100),
 notes text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.sender_profiles (
 id uuid primary key default gen_random_uuid(),
 owner_id text not null unique,
 headline text,
 services text,
 experience text,
 audience text,
 industries text,
 value_proposition text,
 tone text,
 cta text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.outreach_messages (
 id uuid primary key default gen_random_uuid(),
 owner_id text not null,
 contact_id uuid references public.contacts(id) on delete set null,
 company_id uuid references public.companies(id) on delete set null,
 channel text not null check(channel in ('LinkedIn','Email')),
 variant text not null default 'A' check(variant in ('A','B','C')),
 subject text,
 body text not null,
 relevance_score integer check(relevance_score between 1 and 10),
 improvement text,
 research_context text,
 status text not null default 'draft',
 created_at timestamptz not null default now()
);
create table if not exists public.outreach_events (
 id uuid primary key default gen_random_uuid(),
 owner_id text not null,
 contact_id uuid references public.contacts(id) on delete set null,
 company_id uuid references public.companies(id) on delete set null,
 message_id uuid references public.outreach_messages(id) on delete set null,
 event_type text not null check(event_type in ('sent','replied','meeting','follow_up','bounced','not_interested')),
 channel text,
 variant text,
 occurred_at timestamptz not null default now(),
 notes text
);
create index if not exists companies_owner_idx on public.companies(owner_id);
create index if not exists contacts_owner_idx on public.contacts(owner_id);
create index if not exists contacts_followup_idx on public.contacts(owner_id,next_follow_up_at);
create index if not exists messages_owner_idx on public.outreach_messages(owner_id);
create index if not exists events_owner_idx on public.outreach_events(owner_id);

do $$
declare t text;
begin
 foreach t in array array['companies','contacts','sender_profiles','outreach_messages','outreach_events'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('grant select, insert, update, delete on public.%I to authenticated',t);
  execute format('create policy "owner select" on public.%I for select to authenticated using (owner_id = (select auth.jwt()->>''sub''))',t);
  execute format('create policy "owner insert" on public.%I for insert to authenticated with check (owner_id = (select auth.jwt()->>''sub''))',t);
  execute format('create policy "owner update" on public.%I for update to authenticated using (owner_id = (select auth.jwt()->>''sub'')) with check (owner_id = (select auth.jwt()->>''sub''))',t);
  execute format('create policy "owner delete" on public.%I for delete to authenticated using (owner_id = (select auth.jwt()->>''sub''))',t);
 end loop;
end $$;
