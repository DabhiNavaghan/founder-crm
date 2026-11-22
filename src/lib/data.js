// Database access for the signed-in app. Row-level security limits every table to the signed-in user's rows;
// on top of that the app only ever asks for non-catalog companies, so the catalog owner's desk holds
// just what they saved (the catalog itself is never downloaded here).
import { createClient } from '@supabase/supabase-js';

const env = import.meta.env;
let tokenSource = async () => null;
export const setTokenSource = fn => { tokenSource = fn; };
export const supabase = env.VITE_SUPABASE_URL && env.VITE_SUPABASE_PUBLISHABLE_KEY
  ? createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { accessToken: async () => (await tokenSource()) ?? null })
  : null;

const PAGE = 1000; // the API returns at most 1000 rows per request
export async function pageAll(build) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}
const one = async query => { const { data, error } = await query; if (error) throw new Error(error.message); return data; };

export const loadCompanies = () => pageAll(() => supabase.from('companies').select('*').eq('is_catalog', false).order('created_at', { ascending: false }).order('id'));

export async function loadContacts(companies) {
  try {
    const rows = await pageAll(() => supabase.from('contacts').select('*, companies!inner(is_catalog)').eq('companies.is_catalog', false).order('created_at', { ascending: false }).order('id'));
    return rows.map(({ companies: _joined, ...contact }) => contact);
  } catch {
    // If the join is unavailable, ask for the people of each loaded company instead.
    const ids = companies.map(c => c.id), rows = [];
    for (let i = 0; i < ids.length; i += 100) rows.push(...await pageAll(() => supabase.from('contacts').select('*').in('company_id', ids.slice(i, i + 100)).order('id')));
    return rows;
  }
}
export const loadEvents = () => pageAll(() => supabase.from('outreach_events').select('*').order('occurred_at', { ascending: false }).order('id'));
export const loadMessages = () => pageAll(() => supabase.from('outreach_messages').select('*').order('created_at', { ascending: false }).order('id'));
export const loadProfile = async () => (await one(supabase.from('sender_profiles').select('*').limit(1)))[0] || null;
// The catalog owner (the admin) is whoever owns catalog rows. One row is enough to know.
export const ownsCatalog = async () => (await one(supabase.from('companies').select('id').eq('is_catalog', true).limit(1))).length > 0;

export const claimCompany = slug => one(supabase.rpc('claim_company', { p_slug: slug }));
export const insertRow = (table, row) => one(supabase.from(table).insert(row).select().single());
export const updateRow = (table, id, patch) => one(supabase.from(table).update(patch).eq('id', id).select().single());
export const saveProfileRow = row => one(supabase.from('sender_profiles').upsert(row, { onConflict: 'owner_id' }).select().single());
