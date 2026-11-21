-- Enforce that a contact can only reference a company owned by the same Clerk user.
alter table public.companies
  add constraint companies_owner_id_id_unique unique (owner_id, id);

alter table public.contacts
  drop constraint if exists contacts_company_id_fkey;

alter table public.contacts
  add constraint contacts_company_owner_fkey
  foreign key (owner_id, company_id)
  references public.companies (owner_id, id)
  on delete cascade;
