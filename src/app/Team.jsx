// Team room (admin only): what the agent team is doing, live. Reads agent_dashboard() every 15 s while the tab is visible.
// Every agent-written value is rendered as React text; links only come through safeHref (https only).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '../lib/router.jsx';
import { paths } from '../lib/routes.js';
import { loadDashboard } from '../lib/data.js';
import { PageHead } from './ui.jsx';
import { NotFound } from './NotFound.jsx';
import {
  COLUMNS, board, classifyResult, fmtCost, fmtDuration, fmtNum, hhmm, nextRuns, nightShift, normalize,
  nowRunning, oneLine, queueFromRuns, runDetail, statusLook, teamCards,
} from '../lib/team.js';

const POLL_MS = 15000;
const RUNS = 30;
const local = t => (t == null ? '–' : new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

function Win({ file, eyebrow, title, id, headRef, children }) {
  return <section className="win" aria-labelledby={id}>
    <div className="win-bar" aria-hidden="true"><span className="win-dots"><i /><i /><i /></span>{file}</div>
    <div className="win-body">
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="grp-h" id={id} ref={headRef} tabIndex={headRef ? -1 : undefined}>{title}</h2>
      {children}
    </div>
  </section>;
}

function Status({ status }) {
  const look = statusLook(status);
  return <span className="st"><span className={'sq sq-' + look.sq} aria-hidden="true" /><span className={'status ' + look.pill}>{look.label}</span></span>;
}

const Pr = ({ href, n }) => (href ? <a className="go" href={href} rel="noopener noreferrer">{n ? 'PR #' + n : 'Pull request'}</a> : null);
const Ext = ({ href, children }) => (href ? <a className="go" href={href} rel="noopener noreferrer">{children}</a> : <>{children}</>);

export function Team({ run = '' }) {
  const [state, setState] = useState({ phase: 'loading', data: null, updatedAt: null, failed: false });
  const alive = useRef(true);
  const busy = useRef(false);

  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    let res;
    try { res = await loadDashboard(RUNS); } catch (e) { res = { error: { message: String(e?.message || 'Network error') } }; }
    busy.current = false;
    if (!alive.current) return;
    const kind = classifyResult(res);
    if (kind === 'denied') setState(s => ({ ...s, phase: 'denied' }));
    else if (kind === 'missing') setState({ phase: 'ok', data: normalize(null), updatedAt: Date.now(), failed: false });
    else if (kind === 'error') setState(s => ({ ...s, phase: s.data ? 'ok' : 'error', failed: true }));
    else setState({ phase: 'ok', data: normalize(res.data), updatedAt: Date.now(), failed: false });
  }, []);

  // One interval, skipped while the tab is hidden; refetch at once when the tab comes back.
  useEffect(() => {
    alive.current = true;
    load();
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') load(); }, POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { alive.current = false; window.clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, [load]);

  const view = useMemo(() => {
    if (!state.data) return null;
    const { runs, nowMs } = state.data;
    return {
      nowMs, runs,
      live: nowRunning(runs, nowMs), queue: queueFromRuns(runs, nowMs), next: nextRuns(nowMs),
      cards: teamCards(runs, nowMs), cols: board(runs, nowMs), feed: nightShift(runs, 40),
    };
  }, [state.data]);

  const selected = run && view ? view.runs.find(r => r.run === run && r.run !== 'queue') : null;
  const detail = useMemo(() => (selected ? runDetail(selected) : null), [selected]);

  // Opening a run moves focus to its heading, once per run.
  const detailHead = useRef(null);
  const focused = useRef('');
  useEffect(() => {
    if (!run) { focused.current = ''; return; }
    if (view && focused.current !== run) { focused.current = run; detailHead.current?.focus({ preventScroll: false }); }
  }, [run, view]);

  if (state.phase === 'denied') return <NotFound />;
  if (state.phase === 'loading') return <div className="boot" role="status" style={{ minHeight: '50vh' }}><p>Loading the team room…</p></div>;

  const head = <PageHead title="Team room" eyebrow="AGENTS · LIVE" sub={'Private: only your admin account can open this page.' + (state.updatedAt ? ' Updated ' + hhmm(state.updatedAt) + ' UTC.' : '')} />;
  const errorLine = state.failed && <p className="grp-empty" role="status">{state.updatedAt
    ? 'Could not refresh. Showing data from ' + hhmm(state.updatedAt) + ' UTC. Trying again in 15 seconds.'
    : 'Could not load the team room. Trying again in 15 seconds.'}</p>;

  if (!view) return <>{head}{errorLine}</>;
  if (!view.runs.length) return <>{head}{errorLine}<div className="state"><h2>No agent activity yet</h2><p>When the team starts a run, it shows up here within 15 seconds.</p></div></>;

  const { live, queue, next, cards, cols, feed } = view;
  return <>
    {head}
    {errorLine}

    <Win file="now.live" eyebrow="NOW · LIVE" title="Now" id="tr-now">
      {live.length ? <ul className="list">{live.map(r => <li className="task task-p" key={r.run}>
        <div className="t-body">
          <p className="t-title"><Link className="go" to={paths.team(r.run)}>Running: {r.title}</Link></p>
          <p className="t-sub">{(r.agents.length ? r.agents.join(' and ') : 'The pipeline') + ' on ' + r.stage + ' since ' + hhmm(r.since) + ' UTC'}</p>
        </div>
      </li>)}</ul>
        : <p className="grp-empty">{'Nothing is running. Next collection ' + hhmm(next.collect) + ' UTC (' + local(next.collect) + ' your time), next agent run ' + hhmm(next.agents) + ' UTC (' + local(next.agents) + ' your time).'}</p>}
      <h3>Waiting in line</h3>
      {queue.waiting.length
        ? <ol className="list">{queue.waiting.map(t => <li className="task task-p" key={t.number}><div className="t-body"><p className="t-title">{'#' + t.number + ' ' + (t.title || 'Untitled task')}</p></div></li>)}</ol>
        : <p className="t-sub">Nothing is waiting.</p>}
      {queue.note && <p className="t-sub">{queue.note}</p>}
    </Win>

    {run && <Win file="run.detail" eyebrow="RUN · DETAIL" title={detail ? detail.title : 'Run not found'} id="tr-run" headRef={detailHead}>
      {!detail ? <p className="grp-empty">That run is not among the latest 30.</p> : <>
        <p className="t-sub">{[detail.taskId != null ? 'Task #' + detail.taskId : '', detail.kind === 'collect' ? 'Data collection' : detail.kind === 'task' ? 'Founder task' : 'Nightly run'].filter(Boolean).join(' · ')}</p>
        <h3>Steps</h3>
        {detail.steps.length ? <ol className="tl">{detail.steps.map(s => <li key={s.key}>
          <span className="tl-t">{hhmm(s.startAt ?? s.endAt)}</span>
          <div>
            <p className="tl-x"><b>{s.stage}</b>{s.agents.length > 0 && <span className="muted">{s.agents.join(', ')}</span>}<Status status={s.status} /></p>
            <p className="t-sub">{fmtDuration(s.seconds) + ' · ' + fmtNum(s.turns) + ' turns · ' + fmtNum(s.tokens) + ' tokens · ' + fmtCost(s.cost)}</p>
            {(s.text || s.note) && <p className="t-sub">{oneLine(s.text) || oneLine(s.note)}</p>}
          </div>
        </li>)}</ol> : <p className="t-sub">–</p>}
        <h3>Plan decisions</h3>
        <p className="pre">{detail.decisions || '–'}</p>
        <h3>CTO verdict</h3>
        <p className="tl-x"><b>{detail.verdict || '–'}</b>{detail.review && <Status status={detail.review.status} />}</p>
        {detail.review?.text && <p className="pre">{detail.review.text}</p>}
        <h3>Release</h3>
        {detail.release ? <>
          <p className="tl-x"><Status status={detail.release.status} /><Pr href={detail.release.pr} n={detail.release.prNumber} /></p>
          <p>Before: <Ext href={detail.release.previousHref}>{detail.release.previous || '–'}</Ext>{detail.release.previousCommit && <span className="muted">{' (' + detail.release.previousCommit + ')'}</span>}</p>
          <p>Now: <Ext href={detail.release.nextHref}>{detail.release.next || '–'}</Ext>{detail.release.nextCommit && <span className="muted">{' (' + detail.release.nextCommit + ')'}</span>}</p>
          {detail.release.note && <p className="t-sub">{detail.release.note}</p>}
        </> : <p className="t-sub">–</p>}
        <h3>Needs you</h3>
        <p className="pre">{detail.asks || 'Nothing.'}</p>
      </>}
      <p><Link className="go" to={paths.team()}>Back to the board</Link></p>
    </Win>}

    <Win file="team.sys" eyebrow="THE TEAM" title="The team" id="tr-team">
      <ul className="cards">{cards.map(c => <li className="card" key={c.id}>
        <p className="t-title">{c.name}</p>
        <p><Status status={c.status} /></p>
        <p className="t-sub">{c.line}</p>
        {c.at != null && <p className="t-sub">{c.stage + ' · ' + hhmm(c.at) + ' UTC · '}<Link className="go" to={paths.team(c.run)}>{c.runTitle}</Link></p>}
      </li>)}</ul>
    </Win>

    <Win file="board.app" eyebrow="TASKS · BOARD" title="Board" id="tr-board">
      <div className="board">{COLUMNS.map(col => <section className="board-col" key={col.id} aria-labelledby={'tr-col-' + col.id}>
        <h3 id={'tr-col-' + col.id}>{col.label} <span className="n-badge">{cols[col.id].length}</span></h3>
        {cols[col.id].length ? <ul className="list">{cols[col.id].map(c => <li className="task task-p" key={c.key}>
          <div className="t-body">
            <p className="t-title">{c.run ? <Link className="go" to={paths.team(c.run)}>{c.title}</Link> : c.title}</p>
            <p className="t-sub">{[c.taskId != null ? 'Task #' + c.taskId : (c.kind === 'nightly' ? 'Nightly run' : ''), c.startedAt != null ? (c.run ? 'started ' : 'opened ') + hhmm(c.startedAt) + ' UTC' : '', c.stale ? 'stopped without a final report' : ''].filter(Boolean).join(' · ')}</p>
            {c.pr && <p className="t-sub"><Pr href={c.pr} n={c.prNumber} /></p>}
          </div>
        </li>)}</ul> : <p className="t-sub">None</p>}
      </section>)}</div>
    </Win>

    <Win file="night_shift.log" eyebrow="WHILE YOU SLEEP" title="Night shift" id="tr-night">
      {feed.length ? <ol className="tl">{feed.map(f => <li key={f.key}>
        <span className="tl-t">{hhmm(f.at)}</span>
        <div>
          <p className="tl-x"><b>{f.stage}</b>{f.agents.length > 0 && <span className="muted">{f.agents.join(', ')}</span>}<Status status={f.status} /></p>
          {f.note && <p className="t-sub">{f.note}</p>}
          <p className="t-sub">{f.run === 'queue' ? 'Queue' : <Link className="go" to={paths.team(f.run)}>{f.runTitle}</Link>}</p>
        </div>
      </li>)}</ol> : <p className="t-sub">None</p>}
    </Win>
  </>;
}
