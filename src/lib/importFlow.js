// The admin's Excel import. It matches the sheet against the admin's existing rows (catalog rows included),
// adds what is new and fills gaps in what exists. The rows it needs are loaded here, at import time only:
// the desk itself never downloads the catalog.
import { supabase, pageAll } from './data.js';
import { parseWorkbook, COMPANY_FIELDS, EXTRA_FIELDS, packExtras } from './importCompanies.js';

const norm = v => String(v || '').trim().toLowerCase().replace(/\/+$/, '');
function scoreContact(c, company) {
  let n = 0;
  if (c.first_name) n += 10; if (c.last_name) n += 5; if (c.role) n += 15; if (c.linkedin_url) n += 20;
  if (c.email) n += 15; if (c.email && c.email_verified) n += 15; if (company?.website) n += 10; if (company?.description) n += 10;
  return Math.min(100, n);
}

// -> { added, updated, people } or throws. onProgress(text) reports each stage.
export async function importWorkbook(file, userId, onProgress = () => {}) {
  onProgress('Reading the file');
  const parsed = await parseWorkbook(await file.arrayBuffer());
  if (!parsed.length) throw new Error('No companies found. The sheet needs a "Company" column.');

  onProgress('Loading existing companies');
  // Saved copies of directory companies (catalog_slug set) are someone's pipeline rows, not import targets.
  const existing = await pageAll(() => supabase.from('companies').select('id,name,website,priority').is('catalog_slug', null).order('id'));
  onProgress('Loading existing contacts');
  const existingPeople = await pageAll(() => supabase.from('contacts').select('id,company_id,first_name,last_name,email,linkedin_url,role_category').order('id'));

  // Until the enrichment migration has been run, the extra columns do not exist: keep their data in existing fields instead of failing.
  const probe = await supabase.from('companies').select(EXTRA_FIELDS.join(',')).limit(1);
  if (probe.error) for (const { company } of parsed) {
    const packed = packExtras(company); if (packed) company.product_type = packed;
    for (const f of EXTRA_FIELDS) delete company[f];
  }
  const fields = probe.error ? [...COMPANY_FIELDS.filter(f => !EXTRA_FIELDS.includes(f)), 'product_type'] : COMPANY_FIELDS;
  const byName = new Map(existing.map(c => [norm(c.name), c]));
  const byWebsite = new Map(existing.filter(c => c.website).map(c => [norm(c.website), c]));
  const fresh = [], updates = [];
  for (const { company } of parsed) {
    const hit = byName.get(norm(company.name)) || (company.website && byWebsite.get(norm(company.website)));
    if (hit) updates.push({ id: hit.id, ...company });
    else fresh.push({ owner_id: userId, name: company.name, ...Object.fromEntries(fields.map(f => [f, company[f] || null])), notes: company.notes || null, priority: company.priority || 3 });
  }
  const saved = [];
  for (let i = 0; i < fresh.length; i += 500) {
    onProgress('Saving companies ' + Math.min(i + 500, fresh.length) + ' / ' + fresh.length);
    const r = await supabase.from('companies').insert(fresh.slice(i, i + 500)).select();
    if (r.error) throw new Error(r.error.message);
    saved.push(...r.data);
  }
  // Existing companies only get the fields the sheet actually has; nothing is blanked out.
  for (let i = 0; i < updates.length; i += 10) {
    onProgress('Updating companies ' + Math.min(i + 10, updates.length) + ' / ' + updates.length);
    const results = await Promise.all(updates.slice(i, i + 10).map(({ id, ...patch }) => supabase.from('companies').update(patch).eq('id', id).select().single()));
    const failed = results.find(r => r.error); if (failed) throw new Error(failed.error.message);
    saved.push(...results.map(r => r.data));
  }
  const idByName = new Map(saved.map(c => [norm(c.name), c]));
  const known = new Map(existingPeople.map(c => [c.company_id + '|' + norm(c.first_name + ' ' + (c.last_name || '')), c]));
  const people = [], patches = [];
  for (const { company, contacts } of parsed) {
    const owner = idByName.get(norm(company.name)) || saved.find(c => company.website && norm(c.website) === norm(company.website));
    if (!owner) continue;
    for (const c of contacts) {
      const id = owner.id + '|' + norm(c.first_name + ' ' + (c.last_name || ''));
      const have = known.get(id);
      if (have) {
        const patch = {};
        if (c.email && !have.email) patch.email = c.email;
        if (c.linkedin_url && !have.linkedin_url) patch.linkedin_url = c.linkedin_url;
        if (c.role_category && !have.role_category) patch.role_category = c.role_category;
        if (have.id && Object.keys(patch).length) patches.push({ id: have.id, ...patch });
        continue;
      }
      known.set(id, c);
      people.push({ owner_id: userId, company_id: owner.id, first_name: c.first_name, last_name: c.last_name || null, role: c.role || null, role_category: c.role_category || null, linkedin_url: c.linkedin_url || null, email: c.email || null, priority: owner.priority || 3, quality_score: scoreContact(c, owner) });
    }
  }
  for (let i = 0; i < people.length; i += 500) {
    onProgress('Saving contacts ' + Math.min(i + 500, people.length) + ' / ' + people.length);
    const r = await supabase.from('contacts').insert(people.slice(i, i + 500));
    if (r.error) throw new Error(r.error.message);
  }
  for (let i = 0; i < patches.length; i += 10) {
    onProgress('Updating contacts ' + Math.min(i + 10, patches.length) + ' / ' + patches.length);
    const results = await Promise.all(patches.slice(i, i + 10).map(({ id, ...patch }) => supabase.from('contacts').update(patch).eq('id', id)));
    const failed = results.find(r => r.error); if (failed) throw new Error(failed.error.message);
  }
  return { added: fresh.length, updated: updates.length, people: people.length };
}
