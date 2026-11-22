// Pipeline: every saved company with its people, filtered by status. Emails are shown here (and in the studio) only.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDesk } from './store.jsx';
import { Link } from '../lib/router.jsx';
import { paths } from '../lib/routes.js';
import { STAGE_LABEL, TABS, badgesOf, personName, relativeDay, searchRows, tabCounts } from '../lib/pipeline.js';
import { pipelineCsv } from '../lib/csv.js';
import { hostOf, safeEmail, safeSlug, safeUrl } from '../lib/url.js';
import { CopyButton, Ext, LoadError, Logo, Menu, PageHead, SkeletonList } from './ui.jsx';

const PAGE = 30;
const EMPTY_TAB = {
  saved: ['Nothing waiting for a first message.', 'Companies you save show up here until you contact someone there.'],
  contacted: ['No one contacted yet.', 'Log a message as sent and the company moves here.'],
  replied: ['No replies yet.', 'People you mark as replied show up here.'],
  meeting: ['No meetings booked yet.', 'Mark a meeting as booked and the company moves here.'],
  archived: ['Nothing archived.', 'Archive a company to take it off your lists without losing its history.'],
};
const dateInput = t => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

function statusOf(p) {
  if (p.replyWaiting) return ['Replied', 'st-reply'];
  if (p.followUpDue) return ['Follow-up due', 'st-due'];
  if (p.stage === 'meeting') return ['Meeting', 'st-meet'];
  if (p.stage === 'replied') return ['Replied', 'st-reply'];
  if (p.stage === 'contacted') return ['Contacted', ''];
  return ['To contact', ''];
}

function PersonRow({ p, company }) {
  const { logEvent, setFollowUp, toast } = useDesk();
  const [busy, setBusy] = useState(false);
  const [dating, setDating] = useState(false);
  const c = p.contact, name = personName(c);
  const [label, cls] = statusOf(p);
  const email = safeEmail(c.email), linkedin = safeUrl(c.linkedin_url);
  const [date, setDate] = useState('');
  const act = async type => { setBusy(true); await logEvent(c, type); setBusy(false); };
  const openDate = () => { setDate(dateInput(c.next_follow_up_at || Date.now() + 5 * 86400000)); setDating(true); };
  const saveDate = async e => {
    e.preventDefault();
    const t = new Date(date + 'T09:00:00');
    if (!date || Number.isNaN(t.getTime())) return;
    setDating(false);
    await setFollowUp(c, t.toISOString());
  };
  const last = p.lastAt ? (p.last.event_type === 'replied' ? 'replied ' : p.last.event_type === 'meeting' ? 'meeting booked ' : 'sent ') + relativeDay(p.lastAt) : 'not contacted';
  const primary = p.replyWaiting ? 'Draft reply' : p.followUpDue ? 'Follow up' : 'Draft';
  return <li className="task task-p">
    <div className="t-body">
      <p className="t-title">{name} <span className={'status ' + cls}>{label}</span></p>
      <p className="t-sub">{[c.role, last, c.next_follow_up_at && 'follow up ' + relativeDay(c.next_follow_up_at)].filter(Boolean).join(' · ')}</p>
      {(linkedin || email) && <p className="who-links">
        {linkedin && <Ext href={linkedin}>LinkedIn</Ext>}
        {email && <><a href={'mailto:' + email}>{email}</a><CopyButton className="link" text={email} label="Copy email" what={'of ' + name} onCopied={err => toast(err ? err.message : 'Email copied', err ? 'error' : 'ok')} /></>}
      </p>}
    </div>
    <div className="t-act">
      <Link className="btn btn-dark" to={paths.studio(c.id)} aria-label={primary + ': ' + name + ' at ' + company.name}>{primary}</Link>
      <Menu label={'More actions for ' + name}>
        <button type="button" disabled={busy} onClick={() => act('sent')}>Log sent</button>
        <button type="button" disabled={busy} onClick={() => act('replied')}>Mark replied</button>
        <button type="button" disabled={busy} onClick={() => act('meeting')}>Meeting booked</button>
        <button type="button" onClick={openDate}>Set follow-up</button>
      </Menu>
    </div>
    {dating && <form className="fu" onSubmit={saveDate}>
      <label className="sr-only" htmlFor={'fu-' + c.id}>Follow-up date for {name}</label>
      <input className="field" id={'fu-' + c.id} type="date" value={date} min={dateInput(Date.now())} onChange={e => setDate(e.target.value)} required autoFocus />
      <button className="btn btn-dark btn-sm" type="submit">Save date</button>
      {c.next_follow_up_at && <button className="btn btn-sm" type="button" onClick={() => { setDating(false); setFollowUp(c, null); }}>Clear</button>}
      <button className="btn btn-sm" type="button" onClick={() => setDating(false)}>Cancel</button>
    </form>}
  </li>;
}

function PersonForm({ company, onDone }) {
  const { addPerson } = useDesk();
  const [busy, setBusy] = useState(false);
  const submit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries());
    const parts = f.name.trim().split(/\s+/);
    if (!parts[0]) return;
    setBusy(true);
    const saved = await addPerson(company, { first_name: parts[0], last_name: parts.slice(1).join(' ') || null, role: f.role.trim() || null, linkedin_url: safeUrl(f.linkedin) || null, email: safeEmail(f.email) || null });
    setBusy(false);
    if (saved) onDone();
  };
  const id = 'np-' + company.id;
  return <form className="inline-form" onSubmit={submit}>
    <div className="row2">
      <div><label className="label" htmlFor={id + 'n'}>Name</label><input className="field" id={id + 'n'} name="name" required maxLength={120} autoFocus /></div>
      <div><label className="label" htmlFor={id + 'r'}>Role</label><input className="field" id={id + 'r'} name="role" maxLength={120} placeholder="Founder, CTO…" /></div>
      <div><label className="label" htmlFor={id + 'l'}>LinkedIn profile</label><input className="field" id={id + 'l'} name="linkedin" type="url" placeholder="https://www.linkedin.com/in/…" /></div>
      <div><label className="label" htmlFor={id + 'e'}>Email</label><input className="field" id={id + 'e'} name="email" type="email" /></div>
    </div>
    <div className="tools"><button className="btn btn-dark" type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add person'}</button><button className="btn" type="button" onClick={onDone}>Cancel</button></div>
  </form>;
}

function CompanyDetails({ row }) {
  const { saveNotes, setArchived, toast } = useDesk();
  const c = row.company;
  const [notes, setNotes] = useState(c.notes || '');
  const [saving, setSaving] = useState(false);
  useEffect(() => setNotes(c.notes || ''), [c.notes]);
  const copied = err => toast(err ? err.message : 'Email copied', err ? 'error' : 'ok');
  const emails = [['Company email', safeEmail(c.contact_email)], ['Hiring email', safeEmail(c.hiring_email)]].filter(e => e[1]);
  const links = [['Website', c.website], ['Careers', c.careers_url], ['Contact page', c.contact_url], ['LinkedIn', c.linkedin_url], ['Source', c.source_url]].filter(l => safeUrl(l[1]));
  const slug = safeSlug(c.catalog_slug);
  const dirty = notes !== (c.notes || '');
  return <div className="pc-body">
    <div className="pc-cols">
      <div>
        <h3>Emails</h3>
        {emails.length ? emails.map(([label, email]) => <div className="copy-row" key={label}>
          <span><small>{label}</small><a href={'mailto:' + email}>{email}</a></span>
          <CopyButton text={email} what={label.toLowerCase()} onCopied={copied} />
        </div>) : <p className="t-sub">No company email on file. Use the contact page or a person's LinkedIn.</p>}
      </div>
      <div>
        <h3>Links</h3>
        {links.length ? <div className="out" style={{ gridTemplateColumns: '1fr' }}>{links.map(([label, url]) => <Ext href={url} key={label}><b>{label}</b><small>{hostOf(url)}</small></Ext>)}</div> : <p className="t-sub">No links on file.</p>}
      </div>
    </div>
    {c.description && <div><h3>About</h3><p className="t-sub">{c.description}</p></div>}
    <div>
      <label className="label" htmlFor={'notes-' + c.id}>Notes</label>
      <textarea className="field" id={'notes-' + c.id} style={{ minHeight: 88 }} value={notes} maxLength={4000} onChange={e => setNotes(e.target.value)} placeholder="Anything worth remembering before you write." />
      <div className="tools">
        <button type="button" className="btn btn-sm" disabled={!dirty || saving} onClick={async () => { setSaving(true); await saveNotes(c, notes); setSaving(false); }}>{saving ? 'Saving…' : 'Save notes'}</button>
        {slug && <a className="btn btn-sm" href={'/companies/' + slug}>Public page</a>}
        <button type="button" className="btn btn-sm" onClick={() => setArchived(c, !row.archived)}>{row.archived ? 'Move back to pipeline' : 'Archive'}</button>
      </div>
    </div>
  </div>;
}

function CompanyCard({ row, open, toggle, cardRef }) {
  const [adding, setAdding] = useState(false);
  const c = row.company;
  const badges = badgesOf(c);
  const meta = [c.location, row.people.length + (row.people.length === 1 ? ' person' : ' people'),
    row.lastAt ? 'last activity ' + relativeDay(row.lastAt) : 'saved ' + relativeDay(row.savedAt),
    row.nextFollowUpAt && !row.archived ? 'next follow-up ' + relativeDay(row.nextFollowUpAt) : ''].filter(Boolean);
  return <li className="card pcard" ref={cardRef} id={'co-' + c.id}>
    <button type="button" className="pc-head" aria-expanded={open} aria-controls={'det-' + c.id} onClick={toggle}>
      <Logo company={c} />
      <span className="row-body">
        <span className="row-head"><span className="row-name pc-name" role="heading" aria-level={2}>{c.name}</span>{badges.length > 0 && <span className="tags">{badges.map(b => <span className="tag" key={b}>{b}</span>)}</span>}</span>
        <span className="t-sub pc-meta">{meta.map((m, i) => <span className="m" key={i}>{m}</span>)}</span>
      </span>
      <svg className="pc-chev" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 8l5 5 5-5" /></svg>
      <span className="sr-only">{open ? 'Hide' : 'Show'} emails, links and notes</span>
    </button>
    <div id={'det-' + c.id} hidden={!open}>{open && <CompanyDetails row={row} />}</div>
    <ul className="pc-people">
      {row.people.map(p => <PersonRow key={p.contact.id} p={p} company={c} />)}
      {!row.people.length && !adding && <li className="task task-p"><div className="t-body"><p className="t-sub">No people listed yet. Add the person you want to reach.</p></div><div className="t-act"><button type="button" className="btn" onClick={() => setAdding(true)}>Add a person</button></div></li>}
      {adding && <li className="task task-p"><div className="t-body" style={{ gridColumn: '1/-1' }}><PersonForm company={c} onDone={() => setAdding(false)} /></div></li>}
      {row.people.length > 0 && !adding && open && <li className="task task-p"><div className="t-body"><button type="button" className="link" onClick={() => setAdding(true)}>Add another person</button></div></li>}
    </ul>
  </li>;
}

function AddCompanyDialog({ onClose, onAdded }) {
  const { addCompany } = useDesk();
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal(); }, []);
  const submit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries());
    if (!f.name.trim()) return;
    setBusy(true);
    const parts = f.person.trim().split(/\s+/).filter(Boolean);
    const company = await addCompany(
      { name: f.name.trim().slice(0, 200), website: safeUrl(f.website) || null, location: f.location.trim() || null, sector: f.sector.trim() || null, contact_email: safeEmail(f.email) || null, source: 'Added by hand' },
      parts.length ? { first_name: parts[0], last_name: parts.slice(1).join(' ') || null, role: f.role.trim() || null, linkedin_url: safeUrl(f.linkedin) || null } : null);
    setBusy(false);
    if (company) { onAdded(company); onClose(); }
  };
  return <dialog className="dlg" ref={ref} onClose={onClose} aria-labelledby="add-co-h">
    <form onSubmit={submit}>
      <h2 id="add-co-h">Add a company</h2>
      <div><label className="label" htmlFor="ac-name">Company name</label><input className="field" id="ac-name" name="name" required maxLength={200} autoFocus /></div>
      <div className="inline-form" style={{ margin: 0 }}><div className="row2">
        <div><label className="label" htmlFor="ac-web">Website</label><input className="field" id="ac-web" name="website" placeholder="example.com" /></div>
        <div><label className="label" htmlFor="ac-city">City</label><input className="field" id="ac-city" name="location" maxLength={120} /></div>
        <div><label className="label" htmlFor="ac-sector">Sector</label><input className="field" id="ac-sector" name="sector" maxLength={120} /></div>
        <div><label className="label" htmlFor="ac-email">Company email</label><input className="field" id="ac-email" name="email" type="email" /></div>
        <div><label className="label" htmlFor="ac-person">Person to reach (optional)</label><input className="field" id="ac-person" name="person" maxLength={120} placeholder="Full name" /></div>
        <div><label className="label" htmlFor="ac-role">Their role</label><input className="field" id="ac-role" name="role" maxLength={120} /></div>
      </div></div>
      <div><label className="label" htmlFor="ac-li">Their LinkedIn profile</label><input className="field" id="ac-li" name="linkedin" type="url" placeholder="https://www.linkedin.com/in/…" /></div>
      <div className="actions"><button className="btn" type="button" onClick={() => ref.current.close()}>Cancel</button><button className="btn btn-dark" type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add company'}</button></div>
    </form>
  </dialog>;
}

export function Pipeline({ companyId }) {
  const { rows, loaded, error, reload, toast } = useDesk();
  const [tab, setTab] = useState('saved');
  const [q, setQ] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState(() => new Set());
  const [adding, setAdding] = useState(false);
  const focusRef = useRef(null);
  const handled = useRef('');
  const counts = useMemo(() => tabCounts(rows), [rows]);
  const target = companyId ? rows.find(r => r.company.id === companyId) : null;

  // /app/pipeline/:companyId opens that company: right tab, expanded, scrolled into view.
  useEffect(() => {
    if (!loaded.core || !companyId || handled.current === companyId || !target) return;
    handled.current = companyId;
    setTab(target.stage); setQ(''); setShown(Infinity);
    setOpen(s => new Set(s).add(companyId));
    window.requestAnimationFrame(() => focusRef.current?.scrollIntoView({ block: 'start' }));
  }, [loaded.core, companyId, target]);
  useEffect(() => { if (!companyId) handled.current = ''; }, [companyId]);

  const inTab = useMemo(() => rows.filter(r => r.stage === tab).sort((a, b) => (b.lastAt || b.savedAt) - (a.lastAt || a.savedAt)), [rows, tab]);
  const list = useMemo(() => searchRows(inTab, q), [inTab, q]);
  const people = rows.reduce((n, r) => n + (r.archived ? 0 : r.people.length), 0);
  const active = rows.length - counts.archived;

  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob(['﻿' + pipelineCsv(rows, STAGE_LABEL)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'foundreach-pipeline-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.append(a); a.click(); a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Exported ' + rows.length + (rows.length === 1 ? ' company' : ' companies'));
  };
  const toggle = id => setOpen(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const head = <PageHead title="Pipeline" sub={loaded.core ? active + (active === 1 ? ' company, ' : ' companies, ') + people + (people === 1 ? ' person' : ' people') : undefined}>
    <div className="actions">
      <a className="btn btn-dark" href="/companies">Find companies</a>
      <button type="button" className="btn" onClick={() => setAdding(true)} disabled={!loaded.core}>Add company manually</button>
      <button type="button" className="btn" onClick={exportCsv} disabled={!loaded.core || !rows.length}>Export CSV</button>
    </div>
  </PageHead>;
  const dialog = adding && <AddCompanyDialog onClose={() => setAdding(false)} onAdded={c => { setTab('saved'); setQ(''); setOpen(s => new Set(s).add(c.id)); }} />;

  if (error && !loaded.core) return <>{head}<LoadError error={error} retry={reload} /></>;
  if (!loaded.core) return <>{head}<div aria-busy="true"><p className="sr-only" role="status">Loading your pipeline</p><SkeletonList rows={5} /></div></>;
  if (!rows.length) return <>{head}
    <div className="state">
      <h2>Nothing saved yet.</h2>
      <p>Save a company from the directory and it lands here with the people who run it.</p>
      <div className="actions"><a className="btn btn-dark" href="/companies">Browse the directory</a><a className="btn" href="/new">See new this week</a></div>
    </div>{dialog}</>;

  return <>
    {head}
    {error && <p className="note note-warn" role="alert">Your pipeline may be out of date: {error} <button type="button" className="btn btn-sm" onClick={reload}>Reload</button></p>}
    {companyId && !target && <p className="note" role="status">That company is not in your pipeline. It may have been removed, or it belongs to another account.</p>}
    <nav aria-label="Filter by status">
      <ul className="pills tabs">
        {TABS.map(t => <li key={t.id}><button type="button" className="pill" aria-current={tab === t.id ? 'true' : undefined} onClick={() => { setTab(t.id); setShown(PAGE); }}>{t.label} <small>{counts[t.id]}</small></button></li>)}
      </ul>
    </nav>
    {inTab.length > 5 && <div className="tools"><label className="sr-only" htmlFor="pl-q">Search this list</label><input className="field" id="pl-q" type="search" placeholder="Search by company, city or person" value={q} onChange={e => { setQ(e.target.value); setShown(PAGE); }} /></div>}
    {list.length ? <ul className="pcards">
      {list.slice(0, shown).map(r => <CompanyCard key={r.company.id} row={r} open={open.has(r.company.id)} toggle={() => toggle(r.company.id)} cardRef={r.company.id === companyId ? focusRef : undefined} />)}
    </ul> : <div className="state">
      <h2>{q ? 'No match in this list.' : EMPTY_TAB[tab][0]}</h2>
      <p>{q ? 'Try a different name, or look in another status.' : EMPTY_TAB[tab][1]}</p>
      {q ? <div className="actions"><button type="button" className="btn" onClick={() => setQ('')}>Clear search</button></div>
        : tab === 'saved' && <div className="actions"><a className="btn btn-dark" href="/companies">Find companies</a></div>}
    </div>}
    {list.length > shown && <div className="actions"><button type="button" className="btn" onClick={() => setShown(n => n + PAGE)}>Show {Math.min(PAGE, list.length - shown)} more</button></div>}
    {dialog}
  </>;
}
