// Pipeline rules. Pure functions over the user's own companies, contacts and outreach events.
export const DAY = 86400000;
export const FOLLOW_UP_DAYS = 5;
export const STAGES = ['saved', 'contacted', 'replied', 'meeting'];
export const TABS = [
  { id: 'saved', label: 'Saved' },
  { id: 'contacted', label: 'Contacted' },
  { id: 'replied', label: 'Replied' },
  { id: 'meeting', label: 'Meeting' },
  { id: 'archived', label: 'Archived' },
];
export const STAGE_LABEL = { saved: 'Saved', contacted: 'Contacted', replied: 'Replied', meeting: 'Meeting', archived: 'Archived' };

const STATUS_RANK = { contacted: 1, replied: 2, meeting_booked: 3 };
const EVENT_RANK = { sent: 1, follow_up: 1, replied: 2, meeting: 3 };
const OUTBOUND = new Set(['sent', 'follow_up']);
const ANSWER = new Set(['replied', 'meeting', 'bounced', 'not_interested']);
const CLOSED = new Set(['bounced', 'not_interested']);
const time = v => { const t = v ? new Date(v).getTime() : NaN; return Number.isFinite(t) ? t : 0; };

export const personName = c => [c?.first_name, c?.last_name].filter(Boolean).join(' ').trim() || 'Unnamed';

// Local calendar day of a timestamp, as a number that sorts (yyyymmdd).
export const dayKey = t => { const d = new Date(t); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); };

// Everything the lists need to know about one person. events: that person's events, any order.
export function personFacts(contact, events, now) {
  const evs = [...(events || [])].sort((a, b) => time(a.occurred_at) - time(b.occurred_at));
  let rank = STATUS_RANK[contact.status] || 0;
  // answered: a reply, meeting, bounce or "not interested" came after the last message we sent.
  let lastOut = null, lastReply = null, closed = false, answered = false;
  for (const e of evs) {
    rank = Math.max(rank, EVENT_RANK[e.event_type] || 0);
    if (OUTBOUND.has(e.event_type)) { lastOut = e; answered = false; closed = false; }
    else if (ANSWER.has(e.event_type)) { answered = true; closed = CLOSED.has(e.event_type); }
    if (e.event_type === 'replied') lastReply = e;
  }
  const last = evs[evs.length - 1] || null;
  const stage = STAGES[rank];
  const outAt = time(lastOut?.occurred_at);
  // They replied and nothing has happened since.
  const replyWaiting = stage === 'replied' && (lastReply ? last === lastReply : true);
  const explicit = time(contact.next_follow_up_at);
  const open = !replyWaiting && stage !== 'meeting' && !closed;
  const waitingOnThem = open && Boolean(lastOut) && !answered;
  const autoDue = waitingOnThem ? outAt + FOLLOW_UP_DAYS * DAY : 0;
  // A date the user set wins over the 5-day rule.
  const followUpAt = explicit || autoDue || 0;
  const followUpDue = !replyWaiting && (explicit ? dayKey(explicit) <= dayKey(now) : Boolean(autoDue) && now >= autoDue);
  const awaiting = waitingOnThem && !followUpDue;
  return {
    stage, rank, closed, last, lastAt: time(last?.occurred_at), lastOutAt: outAt, lastReplyAt: time(lastReply?.occurred_at),
    replyWaiting, followUpDue, awaiting, followUpAt, events: evs,
  };
}

// Founders and primary contacts first, then the people who are easiest to reach.
export function sortPeople(people) {
  const tier = p => (p.role_category === 'Secondary' ? 1 : 0);
  const reach = p => (p.linkedin_url ? 2 : 0) + (p.email ? 1 : 0);
  return [...people].sort((a, b) => (tier(a) - tier(b)) || ((b.priority || 3) - (a.priority || 3)) || (reach(b) - reach(a)) || personName(a).localeCompare(personName(b)));
}

// One row per company: its people with their facts, the company stage and dates.
export function buildPipeline({ companies, contacts, events }, now = Date.now()) {
  const byContact = new Map(), byCompany = new Map(), people = new Map();
  for (const e of events || []) {
    if (e.contact_id) { if (!byContact.has(e.contact_id)) byContact.set(e.contact_id, []); byContact.get(e.contact_id).push(e); }
    if (e.company_id) { if (!byCompany.has(e.company_id)) byCompany.set(e.company_id, []); byCompany.get(e.company_id).push(e); }
  }
  for (const c of contacts || []) { if (!people.has(c.company_id)) people.set(c.company_id, []); people.get(c.company_id).push(c); }
  return (companies || []).map(company => {
    const list = sortPeople(people.get(company.id) || []).map(contact => ({ contact, ...personFacts(contact, byContact.get(contact.id), now) }));
    const own = byCompany.get(company.id) || [];
    // The company stage is the furthest stage among its people (events logged on the company alone count too).
    const rank = Math.max(0, ...list.map(p => p.rank), ...own.map(e => EVENT_RANK[e.event_type] || 0));
    const lastAt = Math.max(0, ...list.map(p => p.lastAt), ...own.map(e => time(e.occurred_at)));
    const due = list.filter(p => p.followUpAt).map(p => p.followUpAt);
    const archived = Boolean(company.archived_at);
    return {
      company, people: list, archived,
      stage: archived ? 'archived' : STAGES[rank],
      hasEvents: own.length > 0 || list.some(p => p.events.length > 0),
      lastAt, savedAt: time(company.created_at),
      nextFollowUpAt: due.length ? Math.min(...due) : 0,
    };
  });
}

export function tabCounts(rows) {
  const n = { saved: 0, contacted: 0, replied: 0, meeting: 0, archived: 0 };
  for (const r of rows) n[r.stage]++;
  return n;
}

export function searchRows(rows, text) {
  const q = String(text || '').trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(r => [r.company.name, r.company.location, r.company.sector, r.company.industry, ...r.people.flatMap(p => [p.contact.first_name, p.contact.last_name, p.contact.role])]
    .filter(Boolean).join(' ').toLowerCase().includes(q));
}

// Badges are [{label, source}] from the catalog; older copies only have a batch code.
export function badgesOf(company) {
  const out = [];
  const raw = Array.isArray(company?.badges) ? company.badges : [];
  for (const b of raw) {
    const label = typeof b === 'string' ? b : b && typeof b.label === 'string' ? b.label : '';
    if (label.trim() && !out.includes(label.trim())) out.push(label.trim().slice(0, 40));
  }
  if (!out.length && company?.batch) out.push('YC ' + company.batch);
  return out.slice(0, 3);
}

// What changes on a person when something is logged. Used for the optimistic update and the write.
export function contactPatch(contact, eventType) {
  const rank = STATUS_RANK[contact.status] || 0;
  if (eventType === 'sent' || eventType === 'follow_up') return { status: rank >= 1 ? contact.status : 'contacted', next_follow_up_at: null };
  if (eventType === 'replied') return { status: rank >= 3 ? contact.status : 'replied', next_follow_up_at: null };
  if (eventType === 'meeting') return { status: 'meeting_booked', next_follow_up_at: null };
  return {};
}

export function relativeDay(t, now = Date.now()) {
  if (!t) return '';
  const days = Math.round((new Date(new Date(t).toDateString()).getTime() - new Date(new Date(now).toDateString()).getTime()) / DAY);
  if (days === 0) return 'today';
  if (days === -1) return 'yesterday';
  if (days === 1) return 'tomorrow';
  if (days < 0 && days >= -30) return -days + ' days ago';
  if (days > 0 && days <= 30) return 'in ' + days + ' days';
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
