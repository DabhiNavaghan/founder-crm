// The desk: the signed-in user's saved companies, people, messages and events, plus every action on them.
// Status actions update the screen first and roll back if the write fails.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as db from '../lib/data.js';
import { buildPipeline, contactPatch } from '../lib/pipeline.js';
import { takeIntent, intentTarget } from '../lib/intent.js';
import { navigate } from '../lib/router.jsx';
import { Toasts } from './ui.jsx';

const EMPTY = { companies: [], contacts: [], events: [], messages: [], profile: null };
const DeskContext = createContext(null);
export { DeskContext };
export const useDesk = () => useContext(DeskContext);
const upsert = (list, row) => [row, ...list.filter(x => x.id !== row.id)];
const swap = (list, id, patch) => list.map(x => (x.id === id ? { ...x, ...patch } : x));
let tmp = 0;

export function DeskProvider({ user, getToken, children }) {
  const [data, setData] = useState(EMPTY);
  const [loaded, setLoaded] = useState({ core: false, profile: false });
  const [error, setError] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [claiming, setClaiming] = useState(false);
  const userId = user.id;
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const dismiss = useCallback(id => setToasts(t => t.filter(x => x.id !== id)), []);
  const toast = useCallback((text, kind = 'ok') => {
    if (!text) return;
    const id = ++tmp;
    setToasts(t => [...t.slice(-2), { id, text, kind }]);
    window.setTimeout(() => dismiss(id), kind === 'error' ? 8000 : 4500);
  }, [dismiss]);
  const fail = useCallback((what, e) => toast(what + (e?.message ? ': ' + e.message : '.'), 'error'), [toast]);

  const loadCore = useCallback(async () => {
    const [companies, events, messages] = await Promise.all([db.loadCompanies(), db.loadEvents(), db.loadMessages()]);
    const contacts = await db.loadContacts(companies);
    // Only outreach on the user's own saved companies and people belongs on the desk.
    const cos = new Set(companies.map(c => c.id)), people = new Set(contacts.map(c => c.id));
    const mine = r => (r.company_id ? cos.has(r.company_id) : true) && (r.contact_id ? people.has(r.contact_id) : true) && (r.company_id || r.contact_id);
    if (!alive.current) return;
    setData(d => ({ ...d, companies, contacts, events: events.filter(mine), messages: messages.filter(mine) }));
    setLoaded(l => ({ ...l, core: true }));
  }, []);

  const load = useCallback(async () => {
    setError('');
    db.loadProfile().then(profile => { if (alive.current) setData(d => ({ ...d, profile })); }).catch(() => {}).finally(() => { if (alive.current) setLoaded(l => ({ ...l, profile: true })); });
    db.ownsCatalog().then(v => { if (alive.current) setIsAdmin(v); }).catch(() => {});
    try { await loadCore(); } catch (e) { if (alive.current) setError(e.message || 'Could not reach the database.'); }
  }, [loadCore]);

  // First load, and the Save / Draft link that brought the user here.
  useEffect(() => {
    db.setTokenSource(() => getToken());
    let intent = null;
    try { intent = takeIntent(window.sessionStorage); } catch { /* storage blocked */ }
    if (!intent) { load(); return; }
    setClaiming(true);
    (async () => {
      let target = null;
      try {
        const claim = await db.claimCompany(intent.slug);
        target = intentTarget(intent, claim);
      } catch (e) {
        fail('Could not save that company', e);
      }
      await load();
      if (!alive.current) return;
      setClaiming(false);
      if (target) { navigate(target.path, { replace: true }); toast(target.toast); }
    })();
  }, [userId]);

  // ---- actions
  const logEvent = useCallback(async (contact, eventType, extra = {}) => {
    const id = 'tmp-' + (++tmp);
    const event = { id, owner_id: userId, contact_id: contact.id, company_id: contact.company_id, event_type: eventType, channel: extra.channel || null, variant: extra.variant || null, message_id: extra.message_id || null, notes: null, occurred_at: new Date().toISOString() };
    const patch = contactPatch(contact, eventType);
    const before = { status: contact.status, next_follow_up_at: contact.next_follow_up_at };
    setData(d => ({ ...d, events: [event, ...d.events], contacts: swap(d.contacts, contact.id, patch) }));
    try {
      const { id: _tmp, occurred_at: _at, ...row } = event;
      const saved = await db.insertRow('outreach_events', row);
      setData(d => ({ ...d, events: d.events.map(e => (e.id === id ? saved : e)) }));
    } catch (e) {
      setData(d => ({ ...d, events: d.events.filter(x => x.id !== id), contacts: swap(d.contacts, contact.id, before) }));
      fail('That was not saved', e);
      return false;
    }
    try { await db.updateRow('contacts', contact.id, patch); }
    catch (e) { fail('Logged, but the status did not update', e); }
    toast(eventType === 'sent' ? 'Marked as sent' : eventType === 'replied' ? 'Marked as replied' : eventType === 'meeting' ? 'Meeting booked' : 'Saved');
    return true;
  }, [userId, toast, fail]);

  const patchRow = useCallback(async (key, table, row, patch, okText, errText) => {
    const before = Object.fromEntries(Object.keys(patch).map(k => [k, row[k] ?? null]));
    setData(d => ({ ...d, [key]: swap(d[key], row.id, patch) }));
    try { await db.updateRow(table, row.id, patch); toast(okText); return true; }
    catch (e) { setData(d => ({ ...d, [key]: swap(d[key], row.id, before) })); fail(errText, e); return false; }
  }, [toast, fail]);

  const setFollowUp = useCallback((contact, iso) => patchRow('contacts', 'contacts', contact, { next_follow_up_at: iso || null }, iso ? 'Follow-up set' : 'Follow-up cleared', 'The follow-up date was not saved'), [patchRow]);
  const setArchived = useCallback((company, on) => patchRow('companies', 'companies', company, { archived_at: on ? new Date().toISOString() : null }, on ? 'Archived' : 'Moved back to your pipeline', on ? 'Could not archive' : 'Could not restore'), [patchRow]);
  const saveNotes = useCallback((company, notes) => patchRow('companies', 'companies', company, { notes: notes.trim() || null }, 'Notes saved', 'Notes were not saved'), [patchRow]);

  const addCompany = useCallback(async (fields, person) => {
    try {
      const company = await db.insertRow('companies', { owner_id: userId, ...fields });
      let contact = null;
      if (person?.first_name) {
        try { contact = await db.insertRow('contacts', { owner_id: userId, company_id: company.id, ...person }); }
        catch (e) { fail('The company was added, but the person was not', e); }
      }
      setData(d => ({ ...d, companies: upsert(d.companies, company), contacts: contact ? upsert(d.contacts, contact) : d.contacts }));
      toast('Company added');
      return company;
    } catch (e) { fail('The company was not added', e); return null; }
  }, [userId, toast, fail]);

  const addPerson = useCallback(async (company, person) => {
    try {
      const contact = await db.insertRow('contacts', { owner_id: userId, company_id: company.id, ...person });
      setData(d => ({ ...d, contacts: upsert(d.contacts, contact) }));
      toast('Person added');
      return contact;
    } catch (e) { fail('The person was not added', e); return null; }
  }, [userId, toast, fail]);

  const saveMessage = useCallback(async row => {
    const saved = await db.insertRow('outreach_messages', { owner_id: userId, ...row });
    setData(d => ({ ...d, messages: upsert(d.messages, saved) }));
    return saved;
  }, [userId]);

  const saveProfile = useCallback(async form => {
    try {
      const { id: _id, created_at: _c, updated_at: _u, ...fields } = form;
      const saved = await db.saveProfileRow({ ...fields, owner_id: userId });
      setData(d => ({ ...d, profile: saved }));
      toast('Profile saved');
      return true;
    } catch (e) { fail('Your profile was not saved', e); return false; }
  }, [userId, toast, fail]);

  const rows = useMemo(() => buildPipeline(data), [data.companies, data.contacts, data.events]);

  const value = useMemo(() => ({
    user, userId, getToken, data, rows, loaded, error, isAdmin, claiming,
    toast, fail, reload: load, logEvent, setFollowUp, setArchived, saveNotes, addCompany, addPerson, saveMessage, saveProfile,
  }), [user, userId, getToken, data, rows, loaded, error, isAdmin, claiming, toast, fail, load, logEvent, setFollowUp, setArchived, saveNotes, addCompany, addPerson, saveMessage, saveProfile]);

  return <DeskContext.Provider value={value}>{children}<Toasts items={toasts} dismiss={dismiss} /></DeskContext.Provider>;
}
