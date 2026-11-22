import * as XLSX from 'xlsx';

// Column names we accept for each field, compared case-insensitively.
const COLUMNS = {
  name: ['company', 'company name', 'name'],
  website: ['company website', 'website'],
  country: ['country', 'region'],
  sector: ['sector', 'industry'],
  careers_url: ['hiring / careers page', 'careers page', 'careers'],
  linkedin_url: ['company linkedin', 'company linkedin search'],
  contact_email: ['support / contact email', 'contact email', 'email'],
  outreach_angle: ['best outreach angle', 'outreach angle'],
  notes: ['notes'],
  priority: ['priority'],
  funding: ['funding stage'],
  description: ['description', 'about', 'what they do'],
  logo_url: ['logo', 'company logo', 'logo url'],
  hiring_email: ['hiring email', 'careers email', 'hiring / careers email'],
  contact_url: ['contact page', 'contact url'],
  location: ['location', 'city', 'hq'],
  source: ['source'],
};
export const COMPANY_FIELDS = ['website', 'country', 'sector', 'careers_url', 'linkedin_url', 'contact_email', 'outreach_angle', 'description', 'logo_url', 'hiring_email', 'contact_url', 'location', 'source'];
const CONTACT_COLUMNS = [
  { name: 'primary contact', link: 'primary contact link', email: 'primary contact email', role: 'primary contact role' },
  { name: 'secondary contact', link: 'secondary contact link', email: 'secondary contact email', role: 'secondary contact role' },
];
const ROLE_ONLY = /\b(current|head|ceo|cto|coo|cfo|founder|co-founder|cofounder|vp|director|leader|engineering|product|technology|mobile|team)\b/i;
const text = v => String(v ?? '').trim();
const key = v => text(v).toLowerCase();

function pick(row, names) {
  for (const n of names) { const v = text(row[n]); if (v) return v; }
  return '';
}
function parsePriority(v) {
  const s = key(v);
  if (!s) return null;
  if (s === 'high') return 5;
  if (s === 'medium') return 3;
  if (s === 'low') return 1;
  const n = Math.round(Number(s));
  return n >= 1 && n <= 5 ? n : null;
}
// "Eric Glyman, Co-founder & CEO" -> a person. "Head of Product" / "Current CEO" -> a role, not a person.
export function parsePerson(value, fallbackRole) {
  const raw = text(value);
  if (!raw) return null;
  const comma = raw.indexOf(',');
  const name = comma === -1 ? raw : raw.slice(0, comma).trim();
  const role = comma === -1 ? '' : raw.slice(comma + 1).trim();
  if (!name || name.includes('/') || ROLE_ONLY.test(name)) return null;
  const parts = name.split(/\s+/);
  return { first_name: parts[0], last_name: parts.slice(1).join(' '), role: role || fallbackRole || 'Founder / Decision Maker' };
}

export function parseWorkbook(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const out = [];
  const seen = new Set();
  const extraPeople = [];
  for (const sheet of wb.SheetNames) {
    for (const original of XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: '' })) {
      const row = {};
      for (const [k, v] of Object.entries(original)) row[key(k)] = v;
      // A "Contacts" sheet: one person per row, linked to a company by name.
      if ('contact name' in row) {
        const parts = text(row['contact name']).split(/\s+/).filter(Boolean);
        const company = text(row.company);
        if (!parts.length || !company) continue;
        const person = { first_name: parts[0], last_name: parts.slice(1).join(' '), role: text(row.role) || 'Founder' };
        const link = text(row.linkedin), email = text(row.email), type = text(row.type);
        if (link && !/\/search\//.test(link)) person.linkedin_url = link;
        if (email) person.email = email;
        if (type) person.role_category = type;
        extraPeople.push([key(company), person]);
        continue;
      }
      const name = pick(row, COLUMNS.name);
      if (!name || seen.has(key(name))) continue;
      seen.add(key(name));
      const company = { name };
      for (const f of COMPANY_FIELDS) {
        const v = pick(row, COLUMNS[f]); if (v) company[f] = v;
      }
      const funding = pick(row, COLUMNS.funding);
      const notes = [pick(row, COLUMNS.notes), funding && key(funding) !== 'unknown' ? 'Funding stage: ' + funding : ''].filter(Boolean).join('\n');
      if (notes) company.notes = notes;
      const priority = parsePriority(pick(row, COLUMNS.priority));
      if (priority) company.priority = priority;
      const contacts = [];
      for (const c of CONTACT_COLUMNS) {
        const person = parsePerson(row[c.name], text(row[c.role]));
        if (!person) continue;
        const link = text(row[c.link]);
        const email = text(row[c.email]);
        // LinkedIn search-result links are not a person's profile, so they are not stored as one.
        if (link && !/\/search\//.test(link)) person.linkedin_url = link;
        if (email) person.email = email;
        contacts.push(person);
      }
      out.push({ company, contacts });
    }
  }
  const byName = new Map(out.map(o => [key(o.company.name), o]));
  for (const [company, person] of extraPeople) byName.get(company)?.contacts.push(person);
  return out;
}
