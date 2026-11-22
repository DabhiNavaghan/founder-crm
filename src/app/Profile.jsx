// Profile: who the drafts speak for. Admin tools (the Excel import) show only for the catalog owner.
import React, { Suspense, lazy, useEffect, useState } from 'react';
import { useDesk } from './store.jsx';
import { PageHead } from './ui.jsx';

const AdminImport = lazy(() => import('./AdminImport.jsx'));
const FIELDS = [
  ['headline', 'Your role or headline', 'Freelance product designer for B2B startups', 2],
  ['services', 'What you offer', 'What you do for a client or employer, in plain words', 3],
  ['experience', 'Experience and proof', 'Past work, numbers, names people would recognise', 3],
  ['audience', 'Who you want to reach', 'Founders of seed-stage fintech companies', 2],
  ['industries', 'Industries you know', '', 2],
  ['value_proposition', 'Why it is worth their time', '', 2],
  ['tone', 'Tone', 'Direct and warm', 1],
  ['cta', 'What you ask for', 'A 15-minute call next week', 1],
];

export function Profile() {
  const { data, loaded, saveProfile, isAdmin, user } = useDesk();
  const [form, setForm] = useState(data.profile || {});
  const [busy, setBusy] = useState(false);
  useEffect(() => setForm(data.profile || {}), [data.profile]);
  const dirty = FIELDS.some(([k]) => (form[k] || '') !== (data.profile?.[k] || ''));
  const submit = async e => { e.preventDefault(); setBusy(true); await saveProfile(form); setBusy(false); };
  return <>
    <PageHead title="Profile" sub="Drafts are written in your voice from what you put here. Nothing is made up." />
    <div className="profile">
      <form className="card form" onSubmit={submit} aria-busy={!loaded.profile}>
        <h2 style={{ margin: 0 }}>About you</h2>
        {FIELDS.map(([key, label, hint, rows]) => <div key={key}>
          <label className="label" htmlFor={'pf-' + key}>{label}</label>
          {rows > 1
            ? <textarea className="field" id={'pf-' + key} rows={rows} maxLength={2000} placeholder={hint} disabled={!loaded.profile} value={form[key] || ''} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} />
            : <input className="field" id={'pf-' + key} maxLength={300} placeholder={hint} disabled={!loaded.profile} value={form[key] || ''} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} />}
        </div>)}
        <div><button className="btn btn-dark" type="submit" disabled={busy || !loaded.profile || !dirty}>{busy ? 'Saving…' : dirty ? 'Save profile' : 'Saved'}</button></div>
      </form>
      <section className="card" aria-labelledby="pf-acct">
        <h2 id="pf-acct">Account</h2>
        <p className="t-sub">Signed in as {user?.primaryEmailAddress?.emailAddress || user?.fullName || 'you'}. Sign-in details and sign out are in the account menu at the top right.</p>
      </section>
      {isAdmin && <section className="card" aria-labelledby="pf-admin">
        <h2 id="pf-admin">Admin tools</h2>
        <Suspense fallback={<p className="t-sub">Loading…</p>}><AdminImport /></Suspense>
      </section>}
    </div>
  </>;
}
