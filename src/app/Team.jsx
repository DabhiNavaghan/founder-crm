// Team room (admin only): what the agent team is doing, live. Reads agent_dashboard() every 15 s while the tab is visible.
// A retro desktop over a pixel landscape: the sky follows your clock and the office windows light up per working agent.
// Every agent-written value is rendered as React text; links only come through safeHref (https only).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '../lib/router.jsx';
import { paths } from '../lib/routes.js';
import { loadDashboard } from '../lib/data.js';
import { NotFound } from './NotFound.jsx';
import {
  COLUMNS, board, classifyResult, clock, fmtCost, fmtDuration, fmtNum, hhmm, nextRuns, nightShift, normalize,
  nowRunning, oneLine, progress, queueFromRuns, runDetail, skyFor, statusLook, teamCards, usage,
} from '../lib/team.js';

const POLL_MS = 15000;
const RUNS = 30;
const local = t => (t == null ? '–' : new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
const initials = name => name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

// ---- The scene: an original low-resolution landscape drawn in SVG, scaled up with crisp edges ----
const steps = (seed, base, amp, step = 8) => {
  let d = 'M0,180 L0,' + base;
  for (let x = 0; x <= 320; x += step) {
    const y = base - Math.round(((Math.sin(x * 0.021 + seed) + Math.sin(x * 0.047 + seed * 2.3) * 0.5) * amp) / 2) * 2;
    d += ' L' + x + ',' + y + ' L' + (x + step) + ',' + y;
  }
  return d + ' L320,180 Z';
};
const HILL_FAR = steps(1.3, 132, 9), HILL_NEAR = steps(4.1, 150, 7, 6), GROUND = steps(2.2, 166, 3, 4);
const STARS = Array.from({ length: 46 }, (_, i) => ({ x: (i * 73 + 11) % 320, y: (i * 37 + 5) % 96, d: (i % 5) * 0.7 }));
const TOWERS = [[14, 26, 12], [30, 38, 10], [44, 22, 14], [236, 30, 12], [252, 44, 9], [266, 24, 13], [284, 34, 10], [300, 20, 12]];
const CLOUDS = [{ y: 22, w: 46, t: 95, d: -20 }, { y: 44, w: 30, t: 140, d: -70 }, { y: 14, w: 36, t: 120, d: -100 }];

function Scene({ sky, cards }) {
  return <div className="tr-sky" aria-hidden="true">
    <svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMax slice" shapeRendering="crispEdges">
      <g className="tr-stars">{STARS.map((s, i) => <rect key={i} x={s.x} y={s.y} width="1" height="1" style={{ animationDelay: s.d + 's' }} />)}</g>
      <g className="tr-orb"><rect x="246" y="26" width="14" height="14" /><rect x="244" y="28" width="18" height="10" /><rect x="248" y="24" width="10" height="18" /></g>
      {CLOUDS.map((c, i) => <g key={i} className="tr-cloud" style={{ animationDuration: c.t + 's', animationDelay: c.d + 's' }}>
        <rect x="0" y={c.y + 4} width={c.w} height="6" /><rect x="6" y={c.y} width={c.w - 16} height="6" /><rect x={c.w / 3} y={c.y - 3} width={c.w / 3} height="4" />
      </g>)}
      <g className="tr-towers">{TOWERS.map(([x, h, w], i) => <g key={i}>
        <rect x={x} y={134 - h} width={w} height={h} />
        {Array.from({ length: Math.floor(h / 6) }, (_, r) => <rect key={r} className="tr-lit" x={x + 2 + ((r + i) % 3) * 3} y={134 - h + 3 + r * 6} width="2" height="2" style={{ animationDelay: ((r * 3 + i) % 7) + 's' }} />)}
      </g>)}</g>
      <path className="tr-hill-far" d={HILL_FAR} />
      <path className="tr-hill-near" d={HILL_NEAR} />
      {/* The office: one window per agent, lit while that agent works. */}
      <g className="tr-office">
        <rect x="128" y="104" width="64" height="48" /><rect className="tr-roof" x="124" y="100" width="72" height="5" />
        <rect className="tr-mast" x="159" y="86" width="2" height="14" /><rect className="tr-beacon" x="158" y="83" width="4" height="4" />
        {cards.map((c, i) => <rect key={c.id} className={'tr-pane tr-pane-' + c.status} x={133 + (i % 4) * 14 + (i > 3 ? 7 : 0)} y={i > 3 ? 126 : 110} width="9" height="9" />)}
        <rect className="tr-door" x="156" y="140" width="8" height="12" />
      </g>
      <path className="tr-ground" d={GROUND} />
      <g className="tr-flies">{[40, 96, 208, 262, 300].map((x, i) => <rect key={x} x={x} y={150 - (i % 3) * 7} width="1" height="1" style={{ animationDelay: i * 0.9 + 's' }} />)}</g>
    </svg>
  </div>;
}

function Win({ file, eyebrow, title, mark, id, headRef, className = '', delay = 0, children }) {
  return <section className={'tr-win ' + className} aria-labelledby={id} style={{ animationDelay: delay + 'ms' }}>
    <div className="tr-bar" aria-hidden="true"><span>{file}</span><span className="tr-dots"><i /><i /><i /></span></div>
    <div className="tr-pad">
      {eyebrow && <p className="tr-eye">{eyebrow}</p>}
      <h2 className="tr-h" id={id} ref={headRef} tabIndex={headRef ? -1 : undefined}>{title}{mark && <> <em>{mark}</em></>}</h2>
      {children}
    </div>
  </section>;
}

function Status({ status }) {
  const look = statusLook(status);
  return <span className="tr-st"><i className={'tr-sq tr-sq-' + look.sq} aria-hidden="true" />{look.label}</span>;
}

const Pr = ({ href, n }) => (href ? <a className="tr-link" href={href} rel="noopener noreferrer">{n ? 'PR #' + n : 'Pull request'}</a> : null);
const Ext = ({ href, children }) => (href ? <a className="tr-link" href={href} rel="noopener noreferrer">{children}</a> : <>{children}</>);

// A clock that ticks only while something is running.
function useTick(on) {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return undefined;
    const id = window.setInterval(() => setT(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [on]);
  return t;
}

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
    const { runs, nowMs } = state.data || normalize(null);
    const live = nowRunning(runs, nowMs);
    return {
      nowMs, runs, skew: nowMs - (state.updatedAt || Date.now()),
      live, queue: queueFromRuns(runs, nowMs), next: nextRuns(nowMs),
      cards: teamCards(runs, nowMs), cols: board(runs, nowMs), use: usage(runs, nowMs, 7),
      // A "started" line is only news while that step is still running.
      feed: nightShift(runs, 80).filter(f => f.status !== 'running' || live.some(l => l.run === f.run && l.stage === f.stage)).slice(0, 40),
    };
  }, [state.data, state.updatedAt]);

  const selected = run ? view.runs.find(r => r.run === run && r.run !== 'queue') : null;
  const detail = useMemo(() => (selected ? runDetail(selected) : null), [selected]);
  const liveRun = view.live[0] ? view.runs.find(r => r.run === view.live[0].run) : null;
  const strip = useMemo(() => (liveRun ? progress(liveRun) : []), [liveRun]);
  const tick = useTick(view.live.length > 0);

  // Opening a run moves focus to its heading, once per run.
  const detailHead = useRef(null);
  const focused = useRef('');
  useEffect(() => {
    if (!run) { focused.current = ''; return; }
    if (state.data && focused.current !== run) { focused.current = run; detailHead.current?.focus({ preventScroll: false }); }
  }, [run, state.data]);

  // The scene is full-bleed: the page itself must not scroll sideways.
  useEffect(() => { document.body.classList.add('tr-on'); return () => document.body.classList.remove('tr-on'); }, []);

  if (state.phase === 'denied') return <NotFound />;

  const sky = skyFor(new Date().getHours());
  const { live, queue, next, cards, cols, feed, use } = view;
  const working = cards.filter(c => c.status === 'working');
  const loading = state.phase === 'loading';
  const first = live[0];
  const elapsed = first ? Math.max(0, (tick + view.skew - (first.startedAt ?? tick)) / 1000) : 0;
  const stageElapsed = first ? Math.max(0, (tick + view.skew - (first.since ?? tick)) / 1000) : 0;

  return <div className="tr" data-sky={sky}>
    <Scene sky={sky} cards={cards} />
    <div className="tr-body">

      <div className="tr-hero">
        <section className="tr-win tr-main" aria-labelledby="tr-title">
          <div className="tr-bar" aria-hidden="true"><span>foundreach — team_room.app</span><span className="tr-dots"><i /><i /><i /></span></div>
          <div className="tr-pad">
            <p className="tr-tag"><i className={'tr-sq tr-sq-' + (first ? 'working' : 'idle')} aria-hidden="true" />{first ? 'Agents · live' : 'Agents · standing by'}</p>
            <h1 id="tr-title" tabIndex={-1} data-page-title>
              {loading ? <>Opening the team room<span className="tr-caret" aria-hidden="true" /></>
                : first ? <>The team is on it. <em>{first.stage.charAt(0).toUpperCase() + first.stage.slice(1)} in progress.</em></>
                  : <>All quiet. <em>Next run {hhmm(next.agents)} UTC.</em></>}
            </h1>
            <p className="tr-lead">{first
              ? (first.agents.length ? first.agents.join(' and ') : 'The pipeline') + ' on "' + first.title + '".'
              : 'Collection starts ' + hhmm(next.collect) + ' UTC (' + local(next.collect) + ' your time), the agents ' + hhmm(next.agents) + ' UTC (' + local(next.agents) + ').'}</p>
            <dl className="tr-stats">
              <div><dt>Working</dt><dd>{working.length}<small>/{cards.length}</small></dd></div>
              <div><dt>Waiting</dt><dd>{queue.waiting.length}</dd></div>
              <div><dt>Released</dt><dd>{cols.shipped.length}</dd></div>
              <div className={cols.attention.length ? 'tr-hot' : undefined}><dt>Needs you</dt><dd>{cols.attention.length}</dd></div>
            </dl>
          </div>
          <p className="tr-foot">
            <span className="tr-faces" aria-hidden="true">{cards.map(c => <i key={c.id} className={'tr-face tr-face-' + c.status}>{initials(c.name)}</i>)}</span>
            <span role="status">{state.failed
              ? (state.updatedAt ? 'Could not refresh · showing ' + hhmm(state.updatedAt) + ' UTC · retrying' : 'Could not load · retrying in 15 s')
              : 'Private to you · ' + (state.updatedAt ? 'updated ' + hhmm(state.updatedAt) + ' UTC' : 'loading') + ' · refreshes every 15 s'}</span>
          </p>
        </section>

        <ul className="tr-chips" aria-label="The team">{cards.map((c, i) => <li key={c.id} className={'tr-chip tr-chip-' + c.status} style={{ animationDelay: (i * 90) + 'ms, ' + (-i * 0.8) + 's' }}>
          <i className={'tr-sq tr-sq-' + statusLook(c.status).sq} aria-hidden="true" />
          <div>
            <p className="tr-chip-n">{c.name} <span className="sr-only">{statusLook(c.status).label}</span></p>
            <p className="tr-chip-l">{c.line}</p>
            {c.at != null && <p className="tr-chip-m">{c.stage + ' · ' + hhmm(c.at) + ' UTC · '}<Link className="tr-link" to={paths.team(c.run)}>open run</Link></p>}
          </div>
        </li>)}</ul>
      </div>

      {run && <Win file="run.detail" eyebrow="Run · detail" title={detail ? detail.title : 'Run not found'} id="tr-run" headRef={detailHead} className="tr-wide">
        {!detail ? <p className="tr-mute">That run is not among the latest 30.</p> : <>
          <p className="tr-mono">{[detail.taskId != null ? 'Task #' + detail.taskId : '', detail.kind === 'collect' ? 'Data collection' : detail.kind === 'task' ? 'Founder task' : 'Nightly run'].filter(Boolean).join(' · ')}</p>
          <div className="tr-cols">
            <div>
              <h3>Steps</h3>
              {detail.steps.length ? <ol className="tr-log">{detail.steps.map(s => <li key={s.key}>
                <i className={'tr-sq tr-sq-' + statusLook(s.status).sq} aria-hidden="true" />
                <div>
                  <p><b>{s.stage}</b> {s.agents.length > 0 && <span className="tr-mute">{s.agents.join(', ')}</span>} <span className="tr-pill">{statusLook(s.status).label}</span></p>
                  <p className="tr-mono">{fmtDuration(s.seconds) + ' · ' + fmtNum(s.turns) + ' turns · ' + fmtNum(s.tokens) + ' tokens · ' + fmtCost(s.cost)}</p>
                  {(s.text || s.note) && <p className="tr-mute">{oneLine(s.text) || oneLine(s.note)}</p>}
                </div>
                <time>{hhmm(s.startAt ?? s.endAt)}</time>
              </li>)}</ol> : <p className="tr-mute">–</p>}
            </div>
            <div>
              <h3>Plan decisions</h3>
              <p className="tr-pre">{detail.decisions || '–'}</p>
              <h3>CTO verdict</h3>
              <p><b>{detail.verdict || '–'}</b> {detail.review && <span className="tr-pill">{statusLook(detail.review.status).label}</span>}</p>
              {detail.review?.text && <p className="tr-pre">{detail.review.text}</p>}
              <h3>Release</h3>
              {detail.release ? <>
                <p><Status status={detail.release.status} /> <Pr href={detail.release.pr} n={detail.release.prNumber} /></p>
                <p>Before: <Ext href={detail.release.previousHref}>{detail.release.previous || '–'}</Ext>{detail.release.previousCommit && <span className="tr-mute">{' (' + detail.release.previousCommit + ')'}</span>}</p>
                <p>Now: <Ext href={detail.release.nextHref}>{detail.release.next || '–'}</Ext>{detail.release.nextCommit && <span className="tr-mute">{' (' + detail.release.nextCommit + ')'}</span>}</p>
                {detail.release.note && <p className="tr-mute">{detail.release.note}</p>}
              </> : <p className="tr-mute">–</p>}
              <h3>Needs you</h3>
              <p className="tr-pre">{detail.asks || 'Nothing.'}</p>
            </div>
          </div>
        </>}
        <p><Link className="tr-btn" to={paths.team()}>&larr; Back to the board</Link></p>
      </Win>}

      <div className="tr-grid">
        <Win file="now.live" eyebrow="Now · live" title={first ? 'Running:' : 'Nothing is running.'} mark={first ? first.title : 'The desk is clear.'} id="tr-now" delay={80}>
          {first ? <>
            <p className="tr-run"><span className="tr-timer">RUN {clock(elapsed)}</span><span className="tr-mono">{first.stage + ' · ' + clock(stageElapsed)}</span><Link className="tr-link" to={paths.team(first.run)}>open run</Link></p>
            <ol className="tr-steps">{strip.map(s => <li key={s.stage} className={'tr-step tr-step-' + s.state}>
              <i aria-hidden="true" /><span>{s.stage}</span><span className="sr-only">{s.state}</span>
            </li>)}</ol>
            {live.slice(1).map(r => <p className="tr-mono" key={r.run}>Also running: <Link className="tr-link" to={paths.team(r.run)}>{r.title}</Link> ({r.stage})</p>)}
          </> : <p className="tr-mute">When a run starts, its steps light up here one by one.</p>}
          <h3>Waiting in line</h3>
          {queue.waiting.length
            ? <ol className="tr-queue">{queue.waiting.map((t, i) => <li key={t.number}><span className="tr-mono">{String(i + 1).padStart(2, '0')}</span><b>{'#' + t.number}</b> {t.title || 'Untitled task'}</li>)}</ol>
            : <p className="tr-mute">Nothing is waiting. Open a GitHub issue with the label agent-task to give the team a job.</p>}
          {queue.note && <p className="tr-mono">{queue.note}</p>}
        </Win>

        <Win file="usage.sys" eyebrow="Usage · last 7 days" title="Where the time" mark="goes." id="tr-use" delay={160}>
          <ul className="tr-bars">{use.rows.map((r, i) => <li key={r.id}>
            <span className="tr-mono">{r.name}</span>
            <span className="tr-track" aria-hidden="true"><i style={{ width: Math.max(r.seconds ? 4 : 0, Math.round(r.share * 100)) + '%', animationDelay: (200 + i * 70) + 'ms' }} /></span>
            <span className="tr-mono tr-num">{r.steps ? fmtDuration(r.seconds) : '–'}</span>
            <span className="tr-mono tr-sub">{r.steps ? fmtNum(r.turns) + ' turns · ' + (r.tokens ? fmtNum(r.tokens) + ' tokens · ' : '') + fmtCost(r.cost) : 'no work yet'}</span>
          </li>)}</ul>
          <p className="tr-mono tr-total">Total {fmtDuration(use.total.seconds)} · {fmtCost(use.total.cost)}</p>
        </Win>
      </div>

      <Win file="board.app" eyebrow="Tasks · board" title="Every job," mark="tracked." id="tr-board" className="tr-wide" delay={240}>
        <div className="tr-board">{COLUMNS.map(col => <section className={'tr-col tr-col-' + col.id} key={col.id} aria-labelledby={'tr-col-' + col.id}>
          <h3 id={'tr-col-' + col.id}>{col.label} <span>· {cols[col.id].length}</span></h3>
          {cols[col.id].length ? <ul>{cols[col.id].map(c => <li className="tr-card" key={c.key}>
            <p className="tr-mono">{c.taskId != null ? 'TASK-' + c.taskId : c.kind === 'nightly' ? 'NIGHTLY' : 'RUN'}</p>
            <p className="tr-card-t">{c.run ? <Link to={paths.team(c.run)}>{c.title}</Link> : c.title}</p>
            <p className="tr-mono">{[c.startedAt != null ? (c.run ? 'started ' : 'opened ') + hhmm(c.startedAt) + ' UTC' : '', c.stale ? 'stopped without a final report' : ''].filter(Boolean).join(' · ')}</p>
            {c.pr && <p><Pr href={c.pr} n={c.prNumber} /></p>}
          </li>)}</ul> : <p className="tr-none">empty</p>}
        </section>)}</div>
        <p className="tr-mono">Released means the CTO passed it and it is live on the site. Needs you means it was held or it failed.</p>
      </Win>

      <Win file="night_shift.log — live" eyebrow="While you sleep" title="The night shift," mark="line by line." id="tr-night" className="tr-wide tr-dark" delay={320}>
        {feed.length ? <ol className="tr-log">{feed.map(f => <li key={f.key}>
          <i className={'tr-sq tr-sq-' + statusLook(f.status).sq} aria-hidden="true" />
          <div>
            <p><b>{f.agents.length ? f.agents.join(' and ') : f.stage}</b> <span className="tr-pill">{f.stage + ' · ' + statusLook(f.status).label}</span></p>
            {f.note && <p className="tr-mute">{f.note}</p>}
            <p className="tr-mono">{f.run === 'queue' ? 'queue' : <Link className="tr-link" to={paths.team(f.run)}>{f.runTitle}</Link>}</p>
          </div>
          <time>{hhmm(f.at)}</time>
        </li>)}</ol> : <p className="tr-mute">{loading ? 'Loading…' : 'No agent activity yet. When the team starts a run, it shows up here within 15 seconds.'}</p>}
        <p className="tr-ends"><span>You: {sky === 'night' ? 'asleep' : 'away'}</span><span>Team: {first ? 'online' : 'standing by'}</span></p>
      </Win>
    </div>
  </div>;
}
