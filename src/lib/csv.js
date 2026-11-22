// CSV export of the user's own rows: one line per person (or one per company with no people).
const cell = v => {
  let s = v == null ? '' : String(v);
  // Spreadsheet apps run cells that start with = + - @ as formulas; a leading apostrophe keeps them text.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const day = t => (t ? new Date(t).toISOString().slice(0, 10) : '');

export const CSV_HEADER = ['Company', 'Status', 'City', 'Sector', 'Website', 'Careers', 'Contact page', 'Company LinkedIn', 'Company email', 'Hiring email',
  'Person', 'Role', 'Person LinkedIn', 'Person email', 'Person status', 'Last activity', 'Next follow-up', 'Saved on', 'Notes'];

export function pipelineCsv(rows, labels) {
  const lines = [CSV_HEADER.map(cell).join(',')];
  for (const r of rows) {
    const c = r.company;
    const base = [c.name, labels[r.stage] || r.stage, c.location, c.sector || c.industry, c.website, c.careers_url, c.contact_url, c.linkedin_url, c.contact_email, c.hiring_email];
    const tail = [day(c.created_at), c.notes];
    if (!r.people.length) lines.push([...base, '', '', '', '', '', day(r.lastAt), '', ...tail].map(cell).join(','));
    for (const p of r.people) {
      const k = p.contact;
      lines.push([...base, [k.first_name, k.last_name].filter(Boolean).join(' '), k.role, k.linkedin_url, k.email, labels[p.stage] || p.stage, day(p.lastAt), day(p.followUpAt), ...tail].map(cell).join(','));
    }
  }
  return lines.join('\r\n') + '\r\n';
}
