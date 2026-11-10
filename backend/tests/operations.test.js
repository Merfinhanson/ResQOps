const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { mountOperations, priority, distanceKm } = require('../src/operations');

test('priority changes with each factor, stays bounded, and uses Haversine distance', () => {
  const now = Date.UTC(2026, 10, 10);
  const base = { severity: 'LOW', people_affected: 0, created_at: new Date(now).toISOString(), category: 'Other Emergencies' };
  const score = patch => priority({ ...base, ...patch }, now).score;
  for (const patch of [{ severity: 'CRITICAL' }, { people_affected: 7 },
    { created_at: new Date(now - 60 * 60000).toISOString() }, { category: 'Fire Emergency' }]) {
    assert.ok(score(patch) > score({}));
  }
  assert.equal(score({ severity: 'CRITICAL', people_affected: 900, created_at: '2020-01-01', category: 'Fire Emergency' }), 100);
  assert.ok(Math.abs(distanceKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 }) - 111.195) < 0.001);
});

test('team persistence, recommendations, assignment conflicts, lifecycle and analytics', t => {
  const directory = mkdtempSync(join(tmpdir(), 'resqops-operations-'));
  const file = join(directory, 'test.sqlite');
  let db = new DatabaseSync(file);
  t.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
  db.exec(`CREATE TABLE incidents (
    id TEXT PRIMARY KEY, title TEXT, location TEXT, category TEXT, severity TEXT,
    people_affected INTEGER, created_at TEXT, updated_at TEXT, latitude REAL, longitude REAL, status TEXT
  );`);
  const created = new Date().toISOString();
  const insert = db.prepare('INSERT INTO incidents VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  insert.run('first', 'First crash', 'Demo area', 'Road Accident', 'CRITICAL', 15, created, created, 0, 0, 'Reported');
  insert.run('second', 'Second crash', 'Demo area', 'Road Accident', 'HIGH', 3, created, created, 0, 0, 'Pending');
  insert.run('unmapped', 'Unmapped', 'Demo area', 'Flood', 'LOW', 0, created, created, null, null, 'Reported');
  const routes = new Map();
  const app = Object.fromEntries(['get', 'post', 'patch', 'delete'].map(method => [method,
    (path, auth, handler) => routes.set(method + path, { auth, handler })]));
  const auth = (req, res, next) => req.admin ? next() : res.status(401).json({});
  const mount = () => mountOperations({ app, db, isAdmin: auth, toIncident: row => ({ ...row, createdAt: row.created_at }) });
  mount();
  function call(method, path, { id, body, admin = true, query = {} } = {}) {
    const route = routes.get(method + '/api/admin' + path);
    let status = 200;
    let data;
    const req = { params: { id }, body, query, admin };
    const res = { status(code) { status = code; return this; }, json(value) { data = value; }, end() {} };
    route.auth(req, res, () => route.handler(req, res, error => { throw error; }));
    return { status, data };
  }
  const create = (name, category, longitude, availability = 'Available') =>
    call('post', '/teams', { body: { name, category, latitude: 0, longitude, availability } });
  assert.equal(call('get', '/teams', { admin: false }).status, 401);
  const nearest = create('Near medical', 'Medical', 1);
  const farther = create('Far rescue', 'Rescue', 2);
  create('Unsuitable fire', 'Fire', 0.1);
  create('Busy medical', 'Medical', 0.2, 'Busy');
  assert.equal(nearest.status, 201);
  assert.equal(create('Invalid rescue', 'Rescue', 181).status, 400);
  const teamId = nearest.data.team.id;
  db.close();
  db = new DatabaseSync(file);
  mount();
  assert.equal(call('get', '/teams').data.teams.length, 4);
  assert.equal(call('patch', '/teams/:id', { id: farther.data.team.id, body: { latitude: 0.1 } }).data.team.latitude, 0.1);
  assert.deepEqual(call('get', '/priority-queue').data.incidents.map(row => [row.id, row.rank]), [['first', 1], ['second', 2], ['unmapped', 3]]);
  const suggestions = id => call('get', '/incidents/:id/recommendations', { id }).data;
  assert.equal(suggestions('unmapped').needsLocation, true);
  assert.equal(call('patch', '/incidents/:id/location', { id: 'unmapped', body: { latitude: 0, longitude: 0 } }).status, 200);
  assert.deepEqual(suggestions('first').recommendations.map(team => team.id), [teamId, farther.data.team.id]);
  assert.ok(Math.abs(suggestions('first').recommendations[0].distanceKm - 111.195) < 0.001);
  const assign = id => call('post', '/incidents/:id/assign', { id, body: { teamId } });
  const assigned = assign('first');
  assert.equal(assigned.status, 201);
  assert.equal(assigned.data.incident.status, 'Assigned');
  assert.equal(suggestions('first').assignedTeam.availability, 'Busy');
  assert.equal(assign('first').status, 409);
  assert.equal(assign('second').status, 409);
  assert.equal(call('delete', '/teams/:id', { id: teamId }).status, 409);
  assert.equal(call('patch', '/teams/:id', { id: teamId, body: { availability: 'Available' } }).status, 409);
  const stats = () => call('get', '/analytics').data;
  assert.deepEqual([stats().total, stats().critical, stats().availableTeams, stats().busyTeams, stats().assigned, stats().resolved], [3, 1, 2, 2, 1, 0]);
  assert.equal(stats().categories.find(category => category.category === 'Road Accident').count, 2);
  const status = value => call('patch', '/incidents/:id/status', { id: 'first', body: { status: value } });
  assert.equal(status('Resolved').status, 409);
  assert.equal(status('In Progress').data.incident.status, 'In Progress');
  assert.ok(suggestions('first').assignments[0].startedAt);
  assert.equal(status('Resolved').data.incident.status, 'Resolved');
  assert.equal(stats().assigned, 0);
  assert.equal(stats().resolved, 1);
  assert.equal(stats().availableTeams, 3);
  assert.ok(suggestions('first').assignments[0].resolvedAt);
  assert.equal(call('delete', '/teams/:id', { id: teamId }).status, 204);
  assert.equal(suggestions('first').assignments[0].teamName, 'Near medical');
  assert.equal(call('get', '/priority-queue', { query: { status: 'Pending' } }).data.incidents[0].id, 'second');
});
