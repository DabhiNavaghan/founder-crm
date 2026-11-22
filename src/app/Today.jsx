// Today: what needs you, in order. One primary button per row.
import React, { useEffect, useMemo, useState } from 'react';
import { useDesk } from './store.jsx';
import { Link } from '../lib/router.jsx';
import { paths } from '../lib/routes.js';
import { buildToday, onboarding, MAX_ROWS } from '../lib/today.js';
import { DAY, dayKey, relativeDay } from '../lib/pipeline.js';
import { loadStats } from '../lib/stats.js';
import { LoadError, Logo, PageHead, SkeletonList } from './ui.jsx';

const daysBetween = (a, b) => Math.round((new Date(new Date(a).toDateString()) - new Date(new Date(b).toDateString())) / DAY);

function Group({ id, title, items, empty, render, more }) {
  if (!items.length && !empty) return null;
  return <section className="grp" aria-labelledby={id}>
    <h2 className="grp-h" id={id}>{title} {items.length > 0 && <span className="n-badge">{items.length}</span>}</h2>
    {items.length ? <ul className="list">{items.slice(0, MAX_ROWS).map(render)}</ul> : <p className="grp-empty">{empty}</p>}
    {items.length > MAX_ROWS && <Link className="grp-more" to={paths.pipeline()}>{items.length - MAX_ROWS} more in Pipeline &rarr;</Link>}
    {more}
  </section>;
}

function PersonTask({ item, status, statusClass, note, children }) {
  return <li className="task">
    <Logo company={item.company} small />
    <div className="t-body">
      <p className="t-title">{item.name} <span className="muted">at</span> <Link to={paths.pipeline(item.company.id)}>{item.company.name}</Link></p>
      <p className="t-sub">{status && <span className={'status ' + statusClass}>{status}</span>} {note}</p>
    </div>
    <div className="t-act">{children}</div>
  </li>;
}

export function Today() {
  const { data, rows, loaded, error, reload, logEvent, user } = useDesk();
  const [stats, setStats] = useState(null);
  const [busy, setBusy] = useState('');
  useEffect(() => { let on = true; loadStats().then(s => { if (on) setStats(s); }); return () => { on = false; }; }, []);
  const now = Date.now();
  const today = useMemo(() => buildToday(rows, data.events, now), [rows, data.events]);
  const start = onboarding(data);
  const date = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  if (error && !loaded.core) return <><PageHead title="Today" eyebrow={date} /><LoadError error={error} retry={reload} /></>;
  if (!loaded.core) return <><PageHead title="Today" eyebrow={date} /><div className="facts" aria-hidden="true">{[0, 1, 2, 3].map(i => <div key={i}><b className="dim">&ndash;</b><span>&nbsp;</span></div>)}</div><section className="grp" aria-busy="true"><p className="sr-only" role="status">Loading your desk</p><SkeletonList rows={4} /></section></>;

  const { lists, stats: s } = today;
  const need = lists.replies.length + lists.followUps.length;
  const markReplied = async item => { setBusy(item.key); await logEvent(item.contact, 'replied'); setBusy(''); };
  const newest = stats?.newest || [];
  const newGroup = <Group id="g-new" title="New this week" items={newest} empty={stats ? '' : ''} render={c => <li className="task" key={c.slug}>
    <Logo company={{ name: c.name, logo_url: c.logo_url }} small />
    <div className="t-body">
      <p className="t-title"><a href={c.href}>{c.name}</a></p>
      <p className="t-sub">{[c.sector, c.city].filter(Boolean).join(' · ') || c.description}</p>
    </div>
    <div className="t-act"><a className="btn" href={c.href} aria-label={'View ' + c.name}>View</a></div>
  </li>} more={newest.length > 0 && <a className="grp-more" href="/new">See everything new &rarr;</a>} />;

  const facts = <div className="facts" role="group" aria-label="Your outreach in numbers">
    <div><b>{s.saved}</b><span>saved</span></div>
    <div><b>{s.sent7}</b><span>sent, last 7 days</span></div>
    <div><b className={s.replyRate30 == null ? 'dim' : undefined}>{s.replyRate30 == null ? '–' : s.replyRate30 + '%'}</b><span>reply rate, last 30 days</span></div>
    <div><b>{s.followUpsDue}</b><span>follow-ups due</span></div>
  </div>;

  if (start.show) {
    const done = Object.fromEntries(start.steps.map(x => [x.id, x.done]));
    return <>
      <PageHead title={'Welcome' + (user?.firstName ? ', ' + user.firstName : '')} eyebrow={date} />
      {facts}
      <section className="grp card" aria-labelledby="g-start">
        <h2 id="g-start">Three steps to your first reply</h2>
        <ol className="onboard">
          <li className={done.profile ? 'done' : undefined}><div><b>Complete your profile</b><span>{done.profile ? 'Done. Drafts will sound like you.' : 'Two lines about what you do, so drafts sound like you.'}</span></div><Link className={'btn' + (done.profile ? '' : ' btn-dark')} to={paths.profile()}>{done.profile ? 'Edit profile' : 'Set up profile'}</Link></li>
          <li className={done.save ? 'done' : undefined}><div><b>Save a company from the directory</b><span>Pick one you would like to talk to. It lands in your pipeline with its people.</span></div><a className={'btn' + (done.profile ? ' btn-dark' : '')} href="/companies">Find companies</a></li>
          <li className={done.draft ? 'done' : undefined}><div><b>Draft your first message</b><span>Give one real detail. You get a first version to edit and send yourself.</span></div><Link className="btn" to={paths.studio()}>Open studio</Link></li>
        </ol>
      </section>
      {newGroup}
    </>;
  }

  return <>
    <PageHead title="Today" eyebrow={date}>
      <p className="muted">{need ? need + (need === 1 ? ' thing needs you' : ' things need you') : 'Nothing is waiting on you'}</p>
    </PageHead>
    {error && <p className="note note-warn" role="alert">Some of your desk may be out of date: {error} <button type="button" className="btn btn-sm" onClick={reload}>Reload</button></p>}
    {facts}

    <Group id="g-rep" title="Replies waiting" items={lists.replies}
      empty="No replies waiting. When someone writes back, mark it replied and it shows up here."
      render={item => <PersonTask key={item.key} item={item} status="Replied" statusClass="st-reply"
        note={'You marked this replied ' + (item.facts.lastReplyAt ? relativeDay(item.facts.lastReplyAt, now) : 'earlier') + ' and have not answered'}>
        <Link className="btn btn-dark" to={paths.studio(item.contact.id)}>Draft reply</Link>
      </PersonTask>} />

    <Group id="g-due" title="Follow-ups due" items={lists.followUps}
      empty="Nothing due. Follow-ups appear here 5 days after you send a message, or on the date you set."
      render={item => {
        const late = daysBetween(now, item.facts.followUpAt);
        const reminder = Boolean(item.contact.next_follow_up_at);
        return <PersonTask key={item.key} item={item} status={late > 0 ? late + (late === 1 ? ' day overdue' : ' days overdue') : 'Due today'} statusClass="st-due"
          note={reminder ? 'You set a reminder for ' + relativeDay(item.facts.followUpAt, now) : 'Sent ' + relativeDay(item.facts.lastOutAt, now) + ', no reply yet'}>
          <Link className="btn btn-dark" to={paths.studio(item.contact.id)}>Follow up</Link>
        </PersonTask>;
      }} />

    <Group id="g-wait" title="Awaiting reply" items={lists.awaiting}
      render={item => <PersonTask key={item.key} item={item}
        note={'Sent ' + relativeDay(item.facts.lastOutAt, now) + (item.facts.followUpAt && dayKey(item.facts.followUpAt) > dayKey(now) ? ' · follow up ' + relativeDay(item.facts.followUpAt, now) : '')}>
        <button type="button" className="btn" disabled={busy === item.key} onClick={() => markReplied(item)}>Mark replied</button>
      </PersonTask>} />

    <Group id="g-ready" title="Ready to draft" items={lists.ready}
      empty={<>Every saved company has a message out. <a href="/companies">Find more companies</a>.</>}
      render={item => <li className="task" key={item.key}>
        <Logo company={item.company} small />
        <div className="t-body">
          <p className="t-title"><Link to={paths.pipeline(item.company.id)}>{item.company.name}</Link></p>
          <p className="t-sub">Saved {relativeDay(item.savedAt, now)} · {item.contact ? 'start with ' + item.name + (item.people > 1 ? ' (' + item.people + ' people)' : '') : 'no people listed yet'}</p>
        </div>
        <div className="t-act">{item.contact
          ? <Link className="btn btn-dark" to={paths.studio(item.contact.id)} aria-label={'Draft a message to ' + item.name + ' at ' + item.company.name}>Draft</Link>
          : <Link className="btn" to={paths.pipeline(item.company.id)}>Add a person</Link>}</div>
      </li>} />

    {newGroup}
  </>;
}
