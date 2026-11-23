// Team room derivations from agent_dashboard() payloads. Fixtures follow the shapes the pipeline emits
// (automation/run-daily.sh, collect.sh, task-poll.sh). No network, no database.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agentForStage, board, boardColumn, classifyResult, fmtCost, fmtDuration, fmtNum, hhmm, isStale, nextRuns,
  nightShift, normalize, nowRunning, oneLine, queueFromRuns, runCard, runDetail, runTitle, safeHref, statusLook, stepTimeline, teamCards,
} from '../src/lib/team.js';

const NOW = Date.parse('2026-11-23T08:30:00Z');
let id = 0;
const ev = (at, stage, status, note = null, meta = {}) => ({ id: ++id, at, stage, status, note, meta });
const mk = (run, kind, events, extra = {}) => ({
  run, kind, task_id: null, title: null, events,
  started_at: events[0].at, last_at: events[events.length - 1].at, ...extra,
});

const shipped = mk('2026-11-22', 'nightly', [
  ev('2026-11-22T04:30:00Z', 'run', 'running'),
  ev('2026-11-22T04:31:00Z', 'plan', 'running', 'started, up to 20 minutes'),
  ev('2026-11-22T04:40:00Z', 'plan', 'ok', null, { seconds: 540, turns: 16, cost_usd: 0.42, tokens: 12000, text: '- Ship the hiring filter\n- Drop the map' }),
  ev('2026-11-22T04:41:00Z', 'build', 'running', 'started, up to 50 minutes'),
  ev('2026-11-22T05:20:00Z', 'build', 'ok', null, { seconds: 2340, turns: null, cost_usd: null, text: 'Built the filter' }),
  ev('2026-11-22T05:21:00Z', 'review', 'running'),
  ev('2026-11-22T05:30:00Z', 'review', 'ok', null, { seconds: 540, text: 'PASS. Tests green.' }),
  ev('2026-11-22T05:40:00Z', 'release', 'merged', 'Merged and live', { pr: 'https://github.com/o/r/pull/2', verdict: 'PASS', previous: 'https://old.example', previous_commit: 'abc1234', new: 'https://new.example', new_commit: 'def5678', asks: '' }),
  ev('2026-11-22T05:45:00Z', 'run', 'done', 'Finished in 75 minutes'),
], { title: 'Hiring filter' });

const live = mk('task-4-2026-11-23', 'task', [
  ev('2026-11-23T08:07:00Z', 'run', 'running', null, { text: 'Build me a Team room' }),
  ev('2026-11-23T08:08:00Z', 'research', 'running', 'started, up to 25 minutes'),
  ev('2026-11-23T08:10:00Z', 'research', 'ok', null, { text: 'Shortlist ready' }),
  ev('2026-11-23T08:20:00Z', 'build', 'running', 'started, up to 50 minutes'),
], { task_id: 4, title: 'Team room' });

const held = mk('task-3-2026-11-20', 'task', [
  ev('2026-11-20T09:00:00Z', 'run', 'running'),
  ev('2026-11-20T10:00:00Z', 'release', 'held', 'Migration held', { pr: 'https://github.com/o/r/pull/3', verdict: 'PASS', previous: '', new: '', asks: '- Approve the migration' }),
  ev('2026-11-20T10:01:00Z', 'run', 'done'),
], { task_id: 3, title: 'India slice' });

const stale = mk('2026-11-21', 'nightly', [
  ev('2026-11-21T04:30:00Z', 'run', 'running'),
  ev('2026-11-21T05:00:00Z', 'build', 'running', 'started, up to 50 minutes'),
]);

const collect = mk('collect-2026-11-23', 'collect', [
  ev('2026-11-23T03:30:00Z', 'collect', 'running'),
  ev('2026-11-23T03:50:00Z', 'collect', 'ok', '120 new companies', { sources: 4, new_in_file: 120, seconds: 1200 }),
]);

const queue = mk('queue', 'task', [
  ev('2026-11-23T07:00:00Z', 'queue', 'tasks', null, { tasks: [{ number: 9, title: 'Old', opened: '2026-11-22T00:00:00Z', state: 'waiting' }] }),
  ev('2026-11-23T08:05:00Z', 'queue', 'tasks', null, { tasks: [
    { number: 4, title: 'Team room', opened: '2026-11-23T08:00:00Z', state: 'agent-running' },
    { number: 5, title: 'Usage bars', opened: '2026-11-23T08:01:00Z', state: 'waiting' },
    { number: 6, title: 'Careers links', opened: '2026-11-23T08:02:00Z', state: 'waiting' },
  ] }),
  ev('2026-11-23T08:25:00Z', 'queue', 'waiting', 'Task #5 is waiting for the running task'),
]);

const RUNS = [live, queue, collect, shipped, stale, held];

test('agents by stage', () => {
  assert.deepEqual(agentForStage('build-check'), ['Engineering']);
  assert.deepEqual(agentForStage('build'), ['Engineering']);
  assert.deepEqual(agentForStage('release'), ['CTO']);
  assert.deepEqual(agentForStage('collect'), ['Data Collection']);
  assert.deepEqual(agentForStage('plan'), ['CEO', 'Product Manager']);
  assert.deepEqual(agentForStage('retro'), []);
  assert.deepEqual(agentForStage('research'), ['Market Research']);
  assert.deepEqual(agentForStage('design'), ['Product Designer']);
});

test('board columns', () => {
  assert.equal(boardColumn(shipped, NOW), 'shipped');
  assert.equal(boardColumn(held, NOW), 'attention');
  assert.equal(isStale(stale, NOW), true);
  assert.equal(boardColumn(stale, NOW), 'attention');
  assert.equal(boardColumn(live, NOW), 'working');
  assert.equal(boardColumn(queue, NOW), null);
  const inReview = mk('task-7-2026-11-23', 'task', [ev('2026-11-23T08:00:00Z', 'run', 'running'), ev('2026-11-23T08:20:00Z', 'review', 'running')]);
  assert.equal(boardColumn(inReview, NOW), 'review');
  const failed = mk('2026-11-19', 'nightly', [ev('2026-11-19T04:30:00Z', 'run', 'running'), ev('2026-11-19T05:00:00Z', 'build', 'timeout'), ev('2026-11-19T05:01:00Z', 'run', 'failed')]);
  assert.equal(boardColumn(failed, NOW), 'attention');
});

test('board: waiting tasks without a run, collection kept off', () => {
  const cols = board(RUNS, NOW);
  assert.deepEqual(cols.waiting.map(c => c.taskId), [5, 6]);
  assert.deepEqual(cols.working.map(c => c.run), ['task-4-2026-11-23']);
  assert.deepEqual(cols.shipped.map(c => c.run), ['2026-11-22']);
  assert.deepEqual(cols.attention.map(c => c.run).sort(), ['2026-11-21', 'task-3-2026-11-20']);
  assert.equal(cols.shipped[0].prNumber, '2');
  assert.ok(!Object.values(cols).flat().some(c => c.run.startsWith('collect-') || c.run === 'queue'));
  // A waiting task that already has a run is not shown twice.
  const q2 = mk('queue', 'nightly', [ev('2026-11-23T08:05:00Z', 'queue', 'tasks', null, { tasks: [{ number: 4, title: 'Team room', state: 'waiting' }] })]);
  assert.equal(board([live, q2], NOW).waiting.length, 0);
});

test('queue comes from the newest queue/tasks event of the run named queue', () => {
  const q = queueFromRuns(RUNS, NOW);
  assert.deepEqual(q.tasks.map(t => t.number), [4, 5, 6]);
  assert.deepEqual(q.waiting.map(t => t.number), [5, 6]);
  assert.equal(q.note, 'Task #5 is waiting for the running task');
  assert.equal(queueFromRuns(RUNS, NOW + 60 * 60 * 1000).note, '');
  // Matched on the name, not on kind.
  assert.equal(queueFromRuns([{ ...queue, run: 'queue-x' }], NOW).tasks.length, 0);
  assert.deepEqual(queueFromRuns([], NOW), { tasks: [], waiting: [], note: '' });
});

test('durations: meta.seconds, else the gap; null numbers show as a dash', () => {
  const steps = stepTimeline(live.events);
  const research = steps.find(s => s.stage === 'research');
  assert.equal(research.seconds, 120);
  assert.equal(research.status, 'ok');
  assert.equal(steps.find(s => s.stage === 'build').status, 'running');
  const build = stepTimeline(shipped.events).find(s => s.stage === 'build');
  assert.equal(build.seconds, 2340);
  assert.equal(fmtNum(build.turns), '–');
  assert.equal(fmtCost(build.cost), '–');
  assert.equal(fmtCost(0.42), '$0.42');
  assert.equal(fmtNum(12000), '12,000');
  assert.equal(fmtNum(NaN), '–');
  assert.equal(fmtDuration(null), '–');
  assert.equal(fmtDuration(45), '45 s');
  assert.equal(fmtDuration(2340), '39 min');
  assert.equal(fmtDuration(4500), '1 h 15 min');
  for (const s of stepTimeline(shipped.events)) {
    for (const text of [fmtNum(s.turns), fmtCost(s.cost), fmtDuration(s.seconds)]) assert.doesNotMatch(text, /null|NaN|undefined/);
  }
});

test('next scheduled runs in UTC', () => {
  const n = nextRuns(Date.parse('2026-11-23T03:00:00Z'));
  assert.equal(new Date(n.collect).toISOString(), '2026-11-23T03:30:00.000Z');
  assert.equal(new Date(n.agents).toISOString(), '2026-11-23T04:30:00.000Z');
  const later = nextRuns(Date.parse('2026-11-23T04:00:00Z'));
  assert.equal(new Date(later.collect).toISOString(), '2026-11-24T03:30:00.000Z');
  assert.equal(new Date(later.agents).toISOString(), '2026-11-23T04:30:00.000Z');
  assert.equal(hhmm(later.collect), '03:30');
  assert.equal(hhmm(null), '–');
});

test('safeHref accepts https only', () => {
  assert.equal(safeHref('javascript:alert(1)'), '');
  assert.equal(safeHref(''), '');
  assert.equal(safeHref(null), '');
  assert.equal(safeHref('http://example.com'), '');
  assert.equal(safeHref('data:text/html,x'), '');
  assert.equal(safeHref('https://github.com/o/r/pull/3'), 'https://github.com/o/r/pull/3');
  const bad = mk('task-8-2026-11-22', 'task', [ev('2026-11-22T09:00:00Z', 'run', 'running'), ev('2026-11-22T10:00:00Z', 'release', 'held', null, { pr: 'javascript:alert(1)', previous: 'javascript:x', new: 'https://ok.example' }), ev('2026-11-22T10:01:00Z', 'run', 'done')]);
  const d = runDetail(bad);
  assert.equal(d.release.pr, '');
  assert.equal(d.release.previousHref, '');
  assert.equal(d.release.previous, 'javascript:x'); // still shown, as text only
  assert.equal(d.release.nextHref, 'https://ok.example/');
  assert.equal(boardColumn(bad, NOW), 'attention'); // held is never shipped, even without a usable PR link
  assert.equal(runCard(bad, NOW).pr, '');
});

test('team cards: status and one line per agent', () => {
  const cards = Object.fromEntries(teamCards(RUNS, NOW).map(c => [c.name, c]));
  assert.equal(Object.keys(cards).length, 7);
  assert.equal(cards.Engineering.status, 'working');
  assert.equal(cards.Engineering.line, 'started, up to 50 minutes');
  assert.equal(cards['Market Research'].status, 'done');
  assert.equal(cards['Market Research'].line, 'Shortlist ready');
  assert.equal(cards.CEO.line, 'Ship the hiring filter');
  assert.equal(cards['Product Manager'].line, cards.CEO.line);
  assert.equal(cards.CTO.status, 'done');
  assert.equal(cards['Data Collection'].line, '120 new companies');
  assert.equal(cards['Product Designer'].status, 'idle');
  // A stale running step reads as failed.
  const only = Object.fromEntries(teamCards([stale], NOW).map(c => [c.name, c]));
  assert.equal(only.Engineering.status, 'failed');
  assert.equal(only.Engineering.line, 'Stopped without a final report');
});

test('now: live runs with the agent on them', () => {
  const n = nowRunning(RUNS, NOW);
  assert.deepEqual(n.map(r => r.run), ['task-4-2026-11-23']);
  assert.equal(n[0].stage, 'build');
  assert.deepEqual(n[0].agents, ['Engineering']);
  assert.equal(hhmm(n[0].since), '08:20');
  assert.deepEqual(nowRunning([shipped, stale], NOW), []);
});

test('night shift: newest first, at most n', () => {
  const feed = nightShift(RUNS, 40);
  assert.ok(feed.length <= 40);
  assert.equal(feed[0].stage, 'queue');
  assert.equal(feed[1].stage, 'build');
  for (let i = 1; i < feed.length; i++) assert.ok(feed[i - 1].at >= feed[i].at);
  assert.equal(nightShift(RUNS, 3).length, 3);
});

test('run detail: decisions, verdict, release, asks', () => {
  const d = runDetail(shipped);
  assert.equal(d.title, 'Hiring filter');
  assert.match(d.decisions, /Ship the hiring filter/);
  assert.equal(d.verdict, 'PASS');
  assert.equal(d.review.text, 'PASS. Tests green.');
  assert.equal(d.release.prNumber, '2');
  assert.equal(d.release.previousHref, 'https://old.example/');
  assert.equal(d.asks, '');
  assert.equal(runDetail(held).asks, '- Approve the migration');
  const none = runDetail(live);
  assert.equal(none.release, null);
  assert.equal(none.verdict, '');
});

test('titles and plain text', () => {
  assert.equal(runTitle({ run: '2026-11-21' }), 'Nightly run 2026-11-21');
  assert.equal(runTitle({ run: 'collect-2026-11-23' }), 'Data collection 2026-11-23');
  assert.equal(runTitle({ run: 'task-12-2026-11-23' }), 'Task #12');
  assert.equal(oneLine('## Built\n- 3 mockups ready'), 'Built');
  assert.equal(oneLine('\n\n- 3 mockups ready'), '3 mockups ready');
  assert.equal(oneLine({ evil: 1 }), '');
  assert.equal(oneLine('x'.repeat(300)).length, 200);
  // Agent text that looks like markup stays a string; nothing parses it.
  assert.equal(oneLine('<img src=x onerror=alert(1)>'), '<img src=x onerror=alert(1)>');
});

test('status labels always carry text', () => {
  for (const s of ['working', 'done', 'failed', 'idle', 'running', 'ok', 'partial', 'timeout', 'skipped', 'merged', 'held', 'none', 'waiting', 'tasks', 'weird', '', 'constructor']) {
    const look = statusLook(s);
    assert.ok(look.label.length > 0, s);
    assert.ok(['working', 'done', 'failed', 'idle'].includes(look.sq), s);
  }
  assert.equal(statusLook('timeout').label, 'Timed out');
});

test('RPC answers: refused, missing, error, ok; payload normalised', () => {
  assert.equal(classifyResult({ data: { runs: [] }, error: null }), 'ok');
  assert.equal(classifyResult({ error: { code: '42501', message: 'Not allowed' } }), 'denied');
  assert.equal(classifyResult({ error: { code: 'PGRST202' } }), 'missing');
  assert.equal(classifyResult({ error: { code: '' }, status: 404 }), 'missing');
  assert.equal(classifyResult({ error: { message: 'Failed to fetch' } }), 'error');
  assert.deepEqual(normalize(null, 5).runs, []);
  assert.equal(normalize(null, 5).nowMs, 5);
  assert.equal(normalize({ now: '2026-11-23T08:30:00Z', runs: [null, { run: '' }, shipped] }).runs.length, 1);
  assert.equal(normalize({ now: '2026-11-23T08:30:00Z', runs: 'x' }).nowMs, NOW);
});
