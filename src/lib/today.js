// Today: what to do next. Pure; takes the rows from buildPipeline().
import { DAY, personName } from './pipeline.js';

export const MAX_ROWS = 10;
const time = v => { const t = v ? new Date(v).getTime() : NaN; return Number.isFinite(t) ? t : 0; };

export function buildToday(rows, events, now = Date.now()) {
  const active = rows.filter(r => !r.archived);
  const replies = [], followUps = [], awaiting = [], ready = [];
  for (const r of active) {
    for (const p of r.people) {
      const item = { key: p.contact.id, company: r.company, contact: p.contact, name: personName(p.contact), facts: p };
      // A person appears in one list only: the first that applies.
      if (p.replyWaiting) replies.push(item);
      else if (p.followUpDue) followUps.push(item);
      else if (p.awaiting) awaiting.push(item);
    }
    // Saved, nothing logged yet, nobody marked as contacted by hand.
    if (!r.hasEvents && r.stage === 'saved') ready.push({ key: r.company.id, company: r.company, contact: r.people[0]?.contact || null, name: r.people[0] ? personName(r.people[0].contact) : '', people: r.people.length, savedAt: r.savedAt });
  }
  replies.sort((a, b) => (b.facts.lastReplyAt || b.facts.lastAt) - (a.facts.lastReplyAt || a.facts.lastAt));
  followUps.sort((a, b) => a.facts.followUpAt - b.facts.followUpAt);
  awaiting.sort((a, b) => a.facts.lastOutAt - b.facts.lastOutAt);
  ready.sort((a, b) => b.savedAt - a.savedAt);

  const sent = (events || []).filter(e => e.event_type === 'sent' || e.event_type === 'follow_up');
  const sent7 = sent.filter(e => now - time(e.occurred_at) <= 7 * DAY).length;
  // Reply rate: of the people messaged in the last 30 days, the share who answered afterwards.
  const firstSent = new Map();
  for (const e of sent) {
    const t = time(e.occurred_at);
    if (!e.contact_id || now - t > 30 * DAY) continue;
    if (!firstSent.has(e.contact_id) || t < firstSent.get(e.contact_id)) firstSent.set(e.contact_id, t);
  }
  const answered = new Set();
  for (const e of events || []) {
    if ((e.event_type === 'replied' || e.event_type === 'meeting') && firstSent.has(e.contact_id) && time(e.occurred_at) >= firstSent.get(e.contact_id)) answered.add(e.contact_id);
  }
  return {
    lists: { replies, followUps, awaiting, ready },
    stats: {
      saved: active.length,
      sent7,
      replyRate30: firstSent.size ? Math.round((answered.size / firstSent.size) * 100) : null,
      followUpsDue: followUps.length,
    },
  };
}

// The checklist a brand-new user sees instead of the lists.
export function onboarding({ companies, messages, events, profile }) {
  const filled = profile && ['headline', 'services', 'experience', 'audience', 'industries', 'value_proposition'].some(k => String(profile[k] || '').trim());
  const steps = [
    { id: 'profile', done: Boolean(filled) },
    { id: 'save', done: (companies || []).length > 0 },
    { id: 'draft', done: (messages || []).length > 0 || (events || []).length > 0 },
  ];
  return { steps, show: (companies || []).length === 0 };
}
