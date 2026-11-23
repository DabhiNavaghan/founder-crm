// The Team room route: admin-only nav entry and route matching. Pure, no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_NAV, NAV, TITLES, matchRoute, paths } from '../src/lib/routes.js';

test('/app/team is a route; deeper paths are not', () => {
  assert.equal(matchRoute('/app/team').name, 'team');
  assert.equal(matchRoute('/app/team/').name, 'team');
  assert.equal(matchRoute('/app/team/x').name, 'notfound');
  assert.equal(matchRoute('/app/team', '?run=2026-11-23').query.run, '2026-11-23');
});

test('the Team entry is kept out of the shared nav', () => {
  assert.ok(!NAV.some(i => i.name === 'team'));
  assert.deepEqual(ADMIN_NAV.map(i => i.path), ['/app/team']);
  assert.equal(TITLES.team, 'Team room');
});

test('team paths encode the run name', () => {
  assert.equal(paths.team(), '/app/team');
  assert.equal(paths.team('task-4-2026-11-23'), '/app/team?run=task-4-2026-11-23');
  assert.equal(paths.team('a&b'), '/app/team?run=a%26b');
});

test('other routes are unchanged', () => {
  assert.equal(matchRoute('/app/today').name, 'today');
  assert.equal(matchRoute('/app/nope').name, 'notfound');
  assert.equal(matchRoute('/app/profile').name, 'profile');
});
