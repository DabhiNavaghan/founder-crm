// Message studio: pick a person, give one real detail, get a draft, edit it, send it yourself, log it.
// If the AI service is unavailable the draft box still works: write by hand and log it.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDesk } from './store.jsx';
import { Link, navigate } from '../lib/router.jsx';
import { paths } from '../lib/routes.js';
import { personName, relativeDay } from '../lib/pipeline.js';
import { hostOf, safeEmail, safeUrl } from '../lib/url.js';
import { CopyButton, Ext, LoadError, Logo, PageHead, SkeletonList } from './ui.jsx';

const BLANK = { subject: '', body: '', score: null, improvement: '', savedId: '' };

const MAX_OPTIONS = 50;

// Searchable picker: type a person's name, a role or a company name. Arrow keys, Enter and Escape work.
function PersonPicker({ id, groups, person, company, onPick }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef(null);
  const all = useMemo(() => groups.flatMap(r => r.people.map(p => {
    const name = personName(p.contact), role = p.contact.role || '';
    return { id: p.contact.id, name, role, company: r.company.name, hay: (name + ' ' + role + ' ' + r.company.name).toLowerCase() };
  })), [groups]);
  const found = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return terms.length ? all.filter(o => terms.every(t => o.hay.includes(t))) : all;
  }, [all, query]);
  const shown = found.slice(0, MAX_OPTIONS);
  const chosen = person ? personName(person) + (company ? ' · ' + company.name : '') : '';

  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => { if (open) listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [active, open]);

  const pick = o => { setOpen(false); setQuery(''); onPick(o.id); };
  const key = e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      if (shown.length) setActive(i => (i + (e.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length);
    } else if (e.key === 'Enter') {
      if (open && shown[active]) { e.preventDefault(); pick(shown[active]); }
    } else if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(false); setQuery(''); }
  };

  return <div className="picker">
    <input className="field" id={id} type="text" role="combobox" autoComplete="off" spellCheck={false}
      aria-expanded={open} aria-controls={id + '-list'} aria-autocomplete="list" aria-describedby={id + '-hint'}
      aria-activedescendant={open && shown[active] ? id + '-o-' + shown[active].id : undefined}
      placeholder={chosen || 'Search by person or company'} value={open ? query : chosen}
      onChange={e => { setQuery(e.target.value); setOpen(true); }}
      onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onBlur={() => { setOpen(false); setQuery(''); }} onKeyDown={key} />
    {open && <ul className="picker-list" id={id + '-list'} role="listbox" aria-label="People" ref={listRef}>
      {shown.map((o, i) => <li key={o.id} id={id + '-o-' + o.id} role="option" aria-selected={i === active}
        className={person && o.id === person.id ? 'is-chosen' : undefined}
        onMouseDown={e => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => pick(o)}>
        <b>{o.name}</b><small>{[o.role, o.company].filter(Boolean).join(' · ')}</small>
      </li>)}
      {!shown.length && <li className="picker-none" role="presentation">No one matches "{query.trim()}". Try a company name.</li>}
      {found.length > shown.length && <li className="picker-none" role="presentation">Showing {shown.length} of {found.length}. Keep typing to narrow it down.</li>}
    </ul>}
    <p className="hint" id={id + '-hint'}>{all.length} {all.length === 1 ? 'person' : 'people'} in your pipeline. Type a name, a role or a company.</p>
    <p className="sr-only" role="status">{open ? (shown.length ? found.length + (found.length === 1 ? ' match' : ' matches') : 'No matches') : ''}</p>
  </div>;
}

export function Studio({ contactId }) {
  const { data, rows, loaded, error, reload, getToken, saveMessage, logEvent, toast } = useDesk();
  const [channel, setChannel] = useState('LinkedIn');
  const [variant, setVariant] = useState('A');
  const [context, setContext] = useState('');
  const [draft, setDraft] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [logging, setLogging] = useState(false);
  const [aiError, setAiError] = useState('');

  const person = useMemo(() => data.contacts.find(c => c.id === contactId) || null, [data.contacts, contactId]);
  const company = person ? data.companies.find(c => c.id === person.company_id) || null : null;
  const facts = useMemo(() => { for (const r of rows) for (const p of r.people) if (p.contact.id === contactId) return p; return null; }, [rows, contactId]);
  const saved = useMemo(() => data.messages.filter(m => m.contact_id === contactId), [data.messages, contactId]);
  const groups = useMemo(() => rows.filter(r => !r.archived && r.people.length).sort((a, b) => a.company.name.localeCompare(b.company.name)), [rows]);

  // A different person means a clean sheet.
  useEffect(() => { setDraft(BLANK); setAiError(''); setContext(''); }, [contactId]);

  const email = safeEmail(person?.email), linkedin = safeUrl(person?.linkedin_url);
  const name = person ? personName(person) : '';
  const text = (channel === 'Email' && draft.subject.trim() ? 'Subject: ' + draft.subject.trim() + '\n\n' : '') + draft.body;
  const copied = err => toast(err ? err.message : 'Copied', err ? 'error' : 'ok');

  const generate = async () => {
    if (!person || !company || busy) return;
    if (context.trim().length < 20) { setAiError('Add one specific detail first (at least a sentence): a product detail, a launch, a job opening or a post.'); return; }
    setBusy(true); setAiError('');
    try {
      const token = await getToken();
      const response = await fetch('/api/generate-message', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({
          contact: { first_name: person.first_name, last_name: person.last_name, role: person.role },
          company: { name: company.name, description: company.description, sector: company.sector || company.industry },
          context: context.trim(), channel, profile: data.profile,
        }),
      });
      let result = null;
      try { result = await response.json(); } catch { /* not JSON: handled below */ }
      if (!response.ok || !result || typeof result.message !== 'string') throw new Error(result?.error || 'The drafting service did not answer (' + response.status + ').');
      const score = Number.isFinite(Number(result.score)) ? Math.max(1, Math.min(10, Math.round(Number(result.score)))) : null;
      const next = { subject: result.subject || '', body: result.message, score, improvement: result.improvement || '', savedId: '' };
      try {
        const row = await saveMessage({ contact_id: person.id, company_id: company.id, channel, variant, subject: next.subject || null, body: next.body, relevance_score: score, improvement: next.improvement, research_context: context.trim(), status: 'draft' });
        next.savedId = row.id;
        toast('Draft ' + variant + ' saved');
      } catch (e) { toast('The draft is below, but it was not saved: ' + e.message, 'error'); }
      setDraft(next);
    } catch (e) {
      setAiError((e.message || 'The drafting service is unavailable.') + ' You can still write your message below and log it when you send it.');
    } finally { setBusy(false); }
  };

  const markSent = async () => {
    if (!person || logging) return;
    setLogging(true);
    let messageId = draft.savedId || '';
    const body = draft.body.trim();
    // A message written or edited by hand is kept with the event.
    const savedRow = messageId ? data.messages.find(m => m.id === messageId) : null;
    if (body && (!savedRow || savedRow.body !== draft.body || (savedRow.subject || '') !== draft.subject)) {
      try {
        const row = await saveMessage({ contact_id: person.id, company_id: person.company_id, channel, variant, subject: channel === 'Email' ? draft.subject.trim() || null : null, body, relevance_score: null, improvement: '', research_context: context.trim() || null, status: 'sent' });
        messageId = row.id;
        setDraft(d => ({ ...d, savedId: row.id }));
      } catch (e) { toast('The message text was not saved: ' + e.message, 'error'); messageId = ''; }
    }
    await logEvent(person, 'sent', { channel, variant, message_id: messageId || null });
    setLogging(false);
  };

  const head = <PageHead title="Message studio" sub="One real detail in, one message worth answering out. You send it yourself." />;
  if (error && !loaded.core) return <>{head}<LoadError error={error} retry={reload} /></>;
  if (!loaded.core) return <>{head}<div aria-busy="true"><p className="sr-only" role="status">Loading your people</p><SkeletonList rows={3} /></div></>;
  if (!groups.length) return <>{head}
    <div className="state">
      <h2>No one to write to yet.</h2>
      <p>Save a company from the directory, or add one by hand in Pipeline, and its people show up here.</p>
      <div className="actions"><a className="btn btn-dark" href="/companies">Find companies</a><Link className="btn" to={paths.pipeline()}>Open Pipeline</Link></div>
    </div></>;

  const reach = company ? [['Website', company.website], ['Careers', company.careers_url], ['Contact page', company.contact_url], ['Company LinkedIn', company.linkedin_url]].filter(l => safeUrl(l[1])) : [];
  const companyEmails = company ? [['Company email', safeEmail(company.contact_email)], ['Hiring email', safeEmail(company.hiring_email)]].filter(e => e[1]) : [];

  return <>
    {head}
    {contactId && !person && <p className="note" role="status">That person is not in your pipeline. Pick someone below.</p>}
    <div className="studio">
      <div className="cards" style={{ gridTemplateColumns: '1fr' }}>
        <section className="card" aria-labelledby="st-who">
          <h2 id="st-who">1. Who are you writing to?</h2>
          <div>
            <label className="label" htmlFor="st-contact">Person</label>
            <PersonPicker id="st-contact" groups={groups} person={person} company={company} onPick={id => navigate(paths.studio(id), { replace: true })} />
          </div>
          <div className="inline-form" style={{ margin: 0 }}><div className="row2">
            <div><label className="label" htmlFor="st-channel">Channel</label>
              <select className="field" id="st-channel" value={channel} onChange={e => setChannel(e.target.value)}><option>LinkedIn</option><option>Email</option></select></div>
            <div><label className="label" htmlFor="st-variant">Variant</label>
              <select className="field" id="st-variant" value={variant} onChange={e => setVariant(e.target.value)}><option value="A">Variant A</option><option value="B">Variant B</option><option value="C">Variant C</option></select></div>
          </div></div>
          {person && channel === 'Email' && !email && <p className="note note-warn">No email on file for {name}. You can still draft, then send through LinkedIn or the company's contact page.</p>}
          {person && channel === 'Email' && email && !person.email_verified && <p className="note">This address comes from a public source and has not been verified. Check it before you send.</p>}
        </section>

        <section className="card" aria-labelledby="st-detail">
          <h2 id="st-detail">2. Bring one specific detail</h2>
          <div>
            <label className="label" htmlFor="st-context">A product detail, recent news, job opening or post</label>
            <textarea className="field" id="st-context" value={context} maxLength={3000} onChange={e => setContext(e.target.value)} placeholder="Paste something real. The draft will only use what you give it and your profile." aria-describedby="st-context-hint" />
            <p className="hint" id="st-context-hint">{facts?.replyWaiting ? 'They replied: paste what they said, and what you want to answer.' : facts?.lastOutAt ? 'This is a follow-up: say what you sent before and what is new.' : 'Nothing is invented. A vague detail gives a vague message.'}</p>
          </div>
          {!data.profile && loaded.profile && <p className="note">Your profile is empty, so the draft cannot say what you do. <Link to={paths.profile()}>Complete your profile</Link>.</p>}
          <div><button type="button" className="btn btn-dark" onClick={generate} disabled={!person || busy}>{busy ? 'Writing…' : 'Draft variant ' + variant}</button></div>
          {aiError && <p className="note note-warn" role="alert">{aiError}</p>}
        </section>

        <section className="card" aria-labelledby="st-draft">
          <h2 id="st-draft">3. Your message</h2>
          {draft.score != null && <p className="draft-meta"><span>Relevance {draft.score}/10{draft.score < 7 ? ': needs a stronger detail' : ''}</span>{draft.improvement && <span>{draft.improvement}</span>}</p>}
          {channel === 'Email' && <div><label className="label" htmlFor="st-subject">Subject</label><input className="field" id="st-subject" value={draft.subject} maxLength={200} onChange={e => setDraft(d => ({ ...d, subject: e.target.value }))} /></div>}
          <div>
            <label className="label" htmlFor="st-body">Message{person ? ' to ' + name : ''}</label>
            <textarea className="field draft-text" id="st-body" value={draft.body} maxLength={6000} onChange={e => setDraft(d => ({ ...d, body: e.target.value }))} placeholder="Your draft appears here. You can also write it yourself." />
          </div>
          <div className="tools">
            <CopyButton className="btn" text={text} label="Copy message" onCopied={copied} />
            <button type="button" className="btn btn-dark" onClick={markSent} disabled={!person || logging}>{logging ? 'Saving…' : 'I sent this manually'}</button>
          </div>
          <p className="hint">FoundReach never sends for you. Copy the message, send it from LinkedIn or your inbox, then log it here so follow-ups are tracked.</p>
        </section>

        {person && <section className="card" aria-labelledby="st-saved">
          <h2 id="st-saved">Saved drafts for {name}</h2>
          {saved.length ? <ul className="variants">{saved.map(m => <li key={m.id}>
            <div><b>{m.channel} · Variant {m.variant}{m.relevance_score ? ' · ' + m.relevance_score + '/10' : ''}{m.status === 'sent' ? ' · sent' : ''}</b><p>{m.body}</p></div>
            <button type="button" className="btn btn-sm" onClick={() => { setChannel(m.channel); setVariant(m.variant); setDraft({ subject: m.subject || '', body: m.body, score: m.relevance_score || null, improvement: m.improvement || '', savedId: m.id }); document.getElementById('st-body')?.focus(); }}>Use</button>
          </li>)}</ul> : <p className="t-sub">Drafts you generate for {name} are kept here.</p>}
        </section>}
      </div>

      <aside className="studio-side cards" style={{ gridTemplateColumns: '1fr' }} aria-label="How to reach them">
        {person && company ? <>
          <section className="card">
            <div className="pc-head" style={{ padding: 0, cursor: 'default', gridTemplateColumns: '44px minmax(0,1fr)' }}>
              <Logo company={company} />
              <div className="row-body"><p className="pc-name">{name}</p><p className="t-sub">{[person.role, company.name].filter(Boolean).join(' · ')}</p></div>
            </div>
            {facts && <p className="t-sub">{facts.lastAt ? 'Last activity ' + relativeDay(facts.lastAt) : 'Not contacted yet'}{person.next_follow_up_at ? ' · follow up ' + relativeDay(person.next_follow_up_at) : ''}</p>}
            {email && <div className="copy-row"><span><small>Email</small><a href={'mailto:' + email}>{email}</a></span><CopyButton text={email} what="email" onCopied={copied} /></div>}
            {linkedin ? <div className="out" style={{ gridTemplateColumns: '1fr' }}><Ext href={linkedin}><b>LinkedIn profile</b><small>{name}</small></Ext></div>
              : <div className="out" style={{ gridTemplateColumns: '1fr' }}><Ext href={'https://www.linkedin.com/search/results/people/?keywords=' + encodeURIComponent(name + ' ' + company.name)}><b>Find on LinkedIn</b><small>search</small></Ext></div>}
            {!email && <p className="t-sub">No email on file for {name}.</p>}
          </section>
          <section className="card">
            <h2>Reach {company.name}</h2>
            {companyEmails.map(([label, value]) => <div className="copy-row" key={label}><span><small>{label}</small><a href={'mailto:' + value}>{value}</a></span><CopyButton text={value} what={label.toLowerCase()} onCopied={copied} /></div>)}
            {reach.length > 0 && <div className="out" style={{ gridTemplateColumns: '1fr' }}>{reach.map(([label, url]) => <Ext href={url} key={label}><b>{label}</b><small>{hostOf(url)}</small></Ext>)}</div>}
            {!reach.length && !companyEmails.length && <p className="t-sub">No links on file for this company.</p>}
            <Link className="more" to={paths.pipeline(company.id)}>Open in Pipeline &rarr;</Link>
          </section>
        </> : <section className="card"><h2>How to reach them</h2><p className="t-sub">Choose a person and their email, LinkedIn and the company's links appear here.</p></section>}
      </aside>
    </div>
  </>;
}
