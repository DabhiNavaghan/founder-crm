// Team room: pure derivations from agent_dashboard() for the admin's live view of the agent team.
// No window access and no React, so every rule here is unit-tested. All text stays plain text.

export const AGENTS = [
  { id: 'ceo', name: 'CEO', stages: ['plan'] },
  { id: 'pm', name: 'Product Manager', stages: ['plan'] },
  { id: 'research', name: 'Market Research', stages: ['research'] },
  { id: 'design', name: 'Product Designer', stages: ['design'] },
  { id: 'eng', name: 'Engineering', stages: ['build', 'build-check'] },
  { id: 'cto', name: 'CTO', stages: ['review', 'publish', 'release'] },
  { id: 'data', name: 'Data Collection', stages: ['collect'] },
];

export const STALE_MS = 90 * 60 * 1000;
export const COLUMNS = [
  { id: 'waiting', label: 'Waiting' },
  { id: 'working', label: 'Working' },
  { id: 'review', label: 'In review' },
  { id: 'shipped', label: 'Shipped' },
  { id: 'attention', label: 'Needs attention' },
];
const FAILED = new Set(['failed', 'timeout']);
const OPENING = new Set(['running', 'waiting', 'tasks', 'info']);

// Stage -> agent names. 'plan' belongs to two agents; prepare, retro, report, email... to none.
export const agentForStage = stage => AGENTS.filter(a => a.stages.includes(stage)).map(a => a.name);

// Only strings and numbers become text; anything else (objects, null) is empty.
export const str = v => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const ms = v => { const t = Date.parse(str(v)); return Number.isFinite(t) ? t : null; };
const meta = e => (e && e.meta && typeof e.meta === 'object' && !Array.isArray(e.meta) ? e.meta : {});
const events = run => (Array.isArray(run?.events) ? run.events.filter(e => e && typeof e === 'object') : []);
const byNewest = (a, b) => (ms(b.at) ?? 0) - (ms(a.at) ?? 0) || (num(b.id) ?? 0) - (num(a.id) ?? 0);

// The first meaningful line of an agent-written excerpt, without list or heading markers.
export function oneLine(text, max = 200) {
  const line = str(text).split('\n').map(l => l.replace(/^\s*(?:[#>*-]+|\d+[.)])\s+/, '').trim()).find(Boolean) || '';
  return line.length > max ? line.slice(0, max - 1).trimEnd() + '…' : line;
}

// An https link or nothing. Agent text never reaches an href any other way.
export function safeHref(url) {
  const s = str(url).trim();
  if (!s) return '';
  try { const u = new URL(s); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; }
}
export const prNumber = url => (str(url).match(/\/pull\/(\d+)/) || [])[1] || '';

// The payload as the screen needs it: a list of runs and the server's clock.
export function normalize(data, fallbackNow = Date.now()) {
  const runs = Array.isArray(data?.runs) ? data.runs.filter(r => r && typeof r === 'object' && str(r.run)) : [];
  return { nowMs: ms(data?.now) ?? fallbackNow, runs };
}

// What the RPC answer means for the screen. 42501 = refused (not the admin), PGRST202 / 404 = function missing.
export function classifyResult(res) {
  const err = res?.error;
  if (!err) return 'ok';
  const code = str(err.code);
  if (code === '42501') return 'denied';
  if (code === 'PGRST202' || res?.status === 404 || num(err.status) === 404) return 'missing';
  return 'error';
}

export const runKind = run => {
  const name = str(run?.run);
  if (name === 'queue') return 'queue';
  if (/^task-/.test(name)) return 'task';
  if (/^collect-/.test(name)) return 'collect';
  return ['nightly', 'task', 'collect'].includes(run?.kind) ? run.kind : 'nightly';
};
export const taskNumber = run => num(run?.task_id) ?? num((str(run?.run).match(/^task-(\d+)-/) || [])[1]);
export function runTitle(run) {
  const title = str(run?.title).trim();
  if (title) return title;
  const kind = runKind(run), date = (str(run?.run).match(/\d{4}-\d{2}-\d{2}/) || [''])[0];
  if (kind === 'task') return 'Task #' + (taskNumber(run) ?? '?');
  if (kind === 'collect') return 'Data collection' + (date ? ' ' + date : '');
  return 'Nightly run' + (date ? ' ' + date : '');
}

// A run is open while its last event is running, or its whole-run marker (run / collect) has not closed.
export function isOpen(run) {
  const ev = events(run);
  if (!ev.length || runKind(run) === 'queue') return false;
  if (ev[ev.length - 1].status === 'running') return true;
  const top = [...ev].reverse().find(e => e.stage === 'run' || e.stage === 'collect');
  return Boolean(top) && top.status === 'running';
}
const lastAt = run => ms(run?.last_at) ?? Math.max(0, ...events(run).map(e => ms(e.at) ?? 0));
// Open but silent for longer than any stage may take: it stopped without a final report.
export const isStale = (run, nowMs) => isOpen(run) && nowMs - lastAt(run) > STALE_MS;
export const isLive = (run, nowMs) => isOpen(run) && !isStale(run, nowMs);

// Steps of one run, in order: each running event paired with the event that closed it.
export function stepTimeline(evs) {
  const list = Array.isArray(evs) ? evs.filter(e => e && typeof e === 'object') : [];
  const steps = [], openByStage = new Map();
  for (const e of list) {
    const stage = str(e.stage), m = meta(e);
    if (e.status === 'running') {
      const step = { key: str(e.id) || stage + steps.length, stage, agents: agentForStage(stage), status: 'running', startAt: ms(e.at), endAt: null, seconds: null, turns: null, tokens: null, cost: null, note: str(e.note), text: str(m.text) };
      steps.push(step); openByStage.set(stage, step);
      continue;
    }
    let step = openByStage.get(stage);
    if (step) openByStage.delete(stage);
    else { step = { key: str(e.id) || stage + steps.length, stage, agents: agentForStage(stage), startAt: null, note: '', text: '' }; steps.push(step); }
    const endAt = ms(e.at);
    const gap = step.startAt != null && endAt != null ? Math.round((endAt - step.startAt) / 1000) : null;
    Object.assign(step, {
      status: str(e.status), endAt, seconds: num(m.seconds) ?? gap,
      turns: num(m.turns), tokens: num(m.tokens), cost: num(m.cost_usd),
      note: str(e.note) || step.note, text: str(m.text) || step.text,
    });
  }
  return steps;
}

// Status word -> square style and the text label always shown next to it (never colour alone).
const LOOK = {
  working: ['working', 'Working', 'st-reply'], running: ['working', 'Running', 'st-reply'],
  done: ['done', 'Done', ''], ok: ['done', 'OK', ''], merged: ['done', 'Merged', ''], partial: ['done', 'Partial', ''],
  failed: ['failed', 'Failed', 'st-due'], timeout: ['failed', 'Timed out', 'st-due'], held: ['failed', 'Held', 'st-due'],
  idle: ['idle', 'Idle', ''], skipped: ['idle', 'Skipped', ''], none: ['idle', 'None', ''], waiting: ['idle', 'Waiting', ''], tasks: ['idle', 'Queue', ''],
};
export function statusLook(status) {
  const s = str(status);
  const [sq, label, pill] = (Object.hasOwn(LOOK, s) && LOOK[s]) || ['idle', s ? s.charAt(0).toUpperCase() + s.slice(1) : '–', ''];
  return { sq, label, pill };
}

export const fmtNum =v => { const n = num(v); return n == null ? '–' : n.toLocaleString('en-US'); };
export const fmtCost = v => { const n = num(v); return n == null ? '–' : '$' + n.toFixed(2); };
export function fmtDuration(s) {
  const n = num(s);
  if (n == null || n < 0) return '–';
  if (n < 60) return Math.round(n) + ' s';
  const m = Math.round(n / 60);
  return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
}
export const hhmm = t => (t == null || !Number.isFinite(t) ? '–' : new Date(t).toISOString().slice(11, 16));

// The run named "queue" carries the founder's open tasks; its newest queue/tasks event is the current list.
export function queueFromRuns(runs, nowMs = Date.now()) {
  const q = (Array.isArray(runs) ? runs : []).find(r => r?.run === 'queue');
  const ev = events(q).slice().sort(byNewest);
  const latest = ev.find(e => e.stage === 'queue' && e.status === 'tasks' && Array.isArray(meta(e).tasks));
  const tasks = latest ? meta(latest).tasks.filter(t => t && typeof t === 'object' && num(t.number) != null)
    .map(t => ({ number: num(t.number), title: str(t.title), opened: str(t.opened), state: str(t.state) })) : [];
  const wait = ev.find(e => e.status === 'waiting' && str(e.note));
  const note = wait && nowMs - (ms(wait.at) ?? 0) <= 15 * 60 * 1000 ? str(wait.note) : '';
  return { tasks, waiting: tasks.filter(t => t.state === 'waiting'), note };
}

const latestOf = (run, stage) => events(run).filter(e => e.stage === stage).sort(byNewest)[0] || null;
const closingOf = (run, stage) => events(run).filter(e => e.stage === stage && !OPENING.has(e.status)).sort(byNewest)[0] || null;

// Which board column a run belongs in. null for the queue run.
export function boardColumn(run, nowMs) {
  if (runKind(run) === 'queue' || !events(run).length) return null;
  if (isOpen(run)) {
    if (isStale(run, nowMs)) return 'attention';
    const cur = [...events(run)].reverse().find(e => e.stage !== 'run');
    return cur && ['review', 'publish', 'release'].includes(cur.stage) ? 'review' : 'working';
  }
  const rel = latestOf(run, 'release');
  if (rel) {
    if (rel.status === 'merged') return 'shipped';
    if (rel.status === 'held' || safeHref(meta(rel).pr)) return 'attention';
  }
  const top = closingOf(run, 'run') || closingOf(run, 'collect');
  if (top && FAILED.has(top.status)) return 'attention';
  if (events(run).some(e => FAILED.has(e.status))) return 'attention';
  if (!rel && closingOf(run, 'review')?.status === 'ok') return 'review';
  return 'shipped';
}

export function runCard(run, nowMs) {
  const rel = latestOf(run, 'release');
  const pr = safeHref(meta(rel).pr);
  return {
    key: 'run:' + str(run.run), run: str(run.run), kind: runKind(run), title: runTitle(run), taskId: taskNumber(run),
    startedAt: ms(run.started_at), lastAt: lastAt(run), pr, prNumber: prNumber(pr), stale: isStale(run, nowMs),
  };
}

// Board: the founder's tasks and the nightly runs in their columns, plus waiting tasks that have no run yet.
// Collection runs stay off the board (they show in Now, the Data Collection card and the night shift).
export function board(runs, nowMs) {
  const cols = Object.fromEntries(COLUMNS.map(c => [c.id, []]));
  const list = Array.isArray(runs) ? runs : [];
  for (const run of list) {
    const col = runKind(run) === 'collect' ? null : boardColumn(run, nowMs);
    if (col) cols[col].push(runCard(run, nowMs));
  }
  for (const t of queueFromRuns(list, nowMs).waiting) {
    if (list.some(r => runKind(r) === 'task' && taskNumber(r) === t.number)) continue;
    cols.waiting.push({ key: 'task:' + t.number, run: '', kind: 'task', title: t.title || 'Task #' + t.number, taskId: t.number, startedAt: ms(t.opened), lastAt: null, pr: '', prNumber: '', stale: false });
  }
  return cols;
}

// One card per agent: its latest step anywhere, with a status and a one-line result.
export function teamCards(runs, nowMs) {
  const list = (Array.isArray(runs) ? runs : []).filter(r => runKind(r) !== 'queue');
  const all = list.flatMap(run => events(run).map(e => ({ e, run }))).sort((a, b) => byNewest(a.e, b.e));
  return AGENTS.map(agent => {
    const hit = all.find(x => agent.stages.includes(x.e.stage));
    if (!hit) return { id: agent.id, name: agent.name, status: 'idle', line: 'No work in the latest runs', stage: '', at: null, run: '', runTitle: '' };
    const { e, run } = hit, m = meta(e);
    let status, line;
    if (e.status === 'running') {
      if (isStale(run, nowMs)) { status = 'failed'; line = 'Stopped without a final report'; }
      else { status = 'working'; line = oneLine(e.note) || 'Started ' + e.stage; }
    } else {
      status = FAILED.has(e.status) ? 'failed' : e.status === 'skipped' || e.status === 'none' ? 'idle' : 'done';
      line = oneLine(m.text) || oneLine(e.note) || (e.stage + ' ' + str(e.status)).trim();
    }
    return { id: agent.id, name: agent.name, status, line, stage: str(e.stage), at: ms(e.at), run: str(run.run), runTitle: runTitle(run) };
  });
}

// What runs this minute: open, recent runs, newest first, with the step and agents on it now.
export function nowRunning(runs, nowMs) {
  return (Array.isArray(runs) ? runs : []).filter(r => isLive(r, nowMs)).map(run => {
    const cur = [...events(run)].reverse().find(e => e.stage !== 'run' && e.status === 'running')
      || [...events(run)].reverse().find(e => e.stage !== 'run') || null;
    const stage = cur ? str(cur.stage) : 'run';
    return { run: str(run.run), kind: runKind(run), title: runTitle(run), taskId: taskNumber(run), stage, agents: agentForStage(stage), since: cur?.status === 'running' ? ms(cur.at) : ms(run.started_at), startedAt: ms(run.started_at) };
  }).sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
}

// Next scheduled starts: collection 03:30 UTC, agents 04:30 UTC.
export function nextRuns(nowMs) {
  const next = (h, m) => {
    const d = new Date(nowMs);
    let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m);
    if (t <= nowMs) t += 24 * 60 * 60 * 1000;
    return t;
  };
  return { collect: next(3, 30), agents: next(4, 30) };
}

// Latest events across all runs, newest first.
export function nightShift(runs, n = 40) {
  return (Array.isArray(runs) ? runs : [])
    .flatMap(run => events(run).map(e => ({ e, run })))
    .sort((a, b) => byNewest(a.e, b.e)).slice(0, n)
    .map(({ e, run }) => ({ key: str(run.run) + ':' + (str(e.id) || str(e.at)), at: ms(e.at), stage: str(e.stage), status: str(e.status), agents: agentForStage(e.stage), note: oneLine(e.note) || oneLine(meta(e).text), run: str(run.run), runTitle: runTitle(run), seconds: num(meta(e).seconds) }));
}

// Everything the run detail window shows.
export function runDetail(run) {
  const plan = closingOf(run, 'plan'), review = closingOf(run, 'review'), rel = latestOf(run, 'release');
  const rm = meta(rel), verdict = str(rm.verdict).trim();
  return {
    run: str(run.run), title: runTitle(run), kind: runKind(run), taskId: taskNumber(run),
    steps: stepTimeline(events(run)),
    decisions: str(meta(plan).text),
    review: review ? { status: str(review.status), text: str(meta(review).text) || str(review.note) } : null,
    verdict: verdict && verdict !== 'NONE' ? verdict : '',
    release: rel ? {
      status: str(rel.status), note: str(rel.note), pr: safeHref(rm.pr), prNumber: prNumber(safeHref(rm.pr)),
      previous: str(rm.previous), previousHref: safeHref(rm.previous), previousCommit: str(rm.previous_commit),
      next: str(rm.new), nextHref: safeHref(rm.new), nextCommit: str(rm.new_commit),
    } : null,
    asks: str(rm.asks).trim(),
  };
}
