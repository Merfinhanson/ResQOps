const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fork, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const { mkdtempSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const bcrypt = require('bcryptjs');
const { io } = require('socket.io-client');

function fixture(t) {
  const data = mkdtempSync(join(tmpdir(), 'resqops-http-'));
  const env = { ...process.env, DATA_DIR: data, RESQOPS_HOST: '127.0.0.1', PORT: '0',
    NODE_ENV: 'test', ADMIN_USERNAME: 'judge-test', ADMIN_PASSWORD_HASH: bcrypt.hashSync('Temporary-test-pass!', 4),
    SESSION_SECRET: 'isolated-integration-test-secret' };
  let child;
  let base;
  const stop = async () => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  };
  t.after(async () => { await stop(); rmSync(data, { recursive: true, force: true }); });
  async function start() {
    child = fork(require.resolve('../src/server'), [], { env, execArgv: [], stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    const [ready] = await once(child, 'message', { signal: AbortSignal.timeout(8000) });
    base = 'http://127.0.0.1:' + ready.port;
  }
  function client() {
    let cookie = '';
    return {
      socket: () => io(base, { transports: ['websocket'], extraHeaders: { Cookie: cookie }, reconnection: false }),
      async request(path, expected = 200, method = 'GET', body) {
        const response = await fetch(base + '/api' + path, {
          method, headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(6000),
        });
        cookie = response.headers.get('set-cookie')?.split(';')[0] ?? cookie;
        const result = response.status === 204 ? null : await response.json();
        if (expected !== null) assert.equal(response.status, expected, JSON.stringify(result));
        return expected === null ? { status: response.status, data: result } : result;
      },
    };
  }
  return { start, stop, client, seed: () => execFileSync(process.execPath, [require.resolve('../src/seed')], { env, stdio: 'pipe' }) };
}

test('HTTP reports, persistent sessions and teams, atomic competing requests, and lifecycle analytics', async t => {
  const server = fixture(t);
  await server.start();
  const publicClient = server.client();
  const admin = server.client();
  const form = { title: 'DEMO critical accident', description: 'Fictional incident used for a test.', category: 'Road Accident',
    location: 'DEMO junction', latitude: 0, longitude: 0, peopleAffected: 12, contactPhone: '555-0100' };
  assert.equal((await publicClient.request('/health')).ok, true);
  await publicClient.request('/admin/teams', 401);
  await publicClient.request('/admin/incidents/unknown/assign', 401, 'POST', {});
  const invalidInputs = [{ peopleAffected: null }, { peopleAffected: -1 }, { category: 'Invalid' }, { longitude: undefined }];
  for (const invalid of invalidInputs) await publicClient.request('/incidents', 400, 'POST', { ...form, ...invalid });
  const { incident } = await publicClient.request('/incidents', 201, 'POST', form);
  assert.deepEqual([incident.category, incident.severity, incident.status], ['Road Accident', 'CRITICAL', 'Reported']);
  assert.equal(incident.contactPhone, undefined);
  await publicClient.request('/admin/incidents/'+incident.id, 401);
  const second = (await publicClient.request('/incidents', 201, 'POST', { ...form, peopleAffected: 2 })).incident;
  await admin.request('/admin/login', 200, 'POST', { username: 'judge-test', password: 'Temporary-test-pass!' });
  const getStats = () => admin.request('/admin/analytics');
  assert.equal((await getStats()).total, 2);
  const team = (await admin.request('/admin/teams', 201, 'POST', { name: 'DEMO medical', category: 'Medical', latitude: 0, longitude: 1, availability: 'Available' })).team;
  await admin.request('/admin/teams/'+team.id, 200, 'PATCH', { longitude: 0.5 });
  await server.stop();
  await server.start();
  assert.equal((await admin.request('/admin/incidents/'+incident.id)).incident.contactPhone, '555-0100');
  assert.equal((await admin.request('/admin/teams')).teams[0].longitude, 0.5);
  assert.equal((await admin.request('/admin/priority-queue')).incidents[0].id, incident.id);
  const competing = await Promise.all([incident.id, second.id].map(id =>
    admin.request('/admin/incidents/'+id+'/assign', null, 'POST', { teamId: team.id })));
  assert.deepEqual(competing.map(x => x.status).sort(), [201,409]);
  const assigned = competing.find(x => x.status === 201).data;
  assert.equal(assigned.incident.status, 'Assigned');
  assert.equal(assigned.team.availability, 'Busy');
  assert.ok(assigned.assignments[0].assignedAt);
  const path = '/admin/incidents/'+assigned.incident.id;
  const before = await getStats();
  assert.deepEqual([before.total,before.critical,before.availableTeams,before.busyTeams,before.assigned,before.resolved,before.categories[0].count], [2,1,0,1,1,0,2]);
  await admin.request(path+'/status', 200, 'PATCH', { status: 'In Progress' });
  const underway = await getStats();
  assert.deepEqual([underway.assigned, underway.inProgress, underway.activeAssignments], [0,1,1]);
  await admin.request(path+'/status', 200, 'PATCH', { status: 'Resolved' });
  assert.equal((await admin.request('/admin/teams')).teams[0].availability, 'Available');
  const history = (await admin.request(path+'/recommendations')).assignments[0];
  assert.ok(history.startedAt && history.resolvedAt);
  assert.equal((await admin.request('/admin/priority-queue')).incidents.length, 1);
  assert.equal((await admin.request('/admin/priority-queue?status=Resolved')).incidents[0].id, assigned.incident.id);
  const duplicate = [incident.id, second.id].find(id => id !== assigned.incident.id);
  await admin.request('/admin/incidents/'+duplicate, 204, 'DELETE');
  assert.equal((await getStats()).total, 1);
  await admin.request(path, 409, 'DELETE');
});

test('demo seed is idempotent and adds visibly labelled incident and team fixtures', async t => {
  const server = fixture(t);
  server.seed();
  server.seed();
  await server.start();
  const admin = server.client();
  await admin.request('/admin/login', 200, 'POST', { username: 'judge-test', password: 'Temporary-test-pass!' });
  const { incidents } = await admin.request('/admin/incidents');
  const { teams } = await admin.request('/admin/teams');
  assert.equal(incidents.length, 4);
  assert.equal(teams.length, 4);
  assert.ok(incidents.every(row => row.title.startsWith('DEMO ·')));
  assert.ok(teams.every(row => row.name.startsWith('DEMO ·')));
});

test('private family chat, alerts, moderation visibility and leaving a circle', async t => {
  const server = fixture(t);
  await server.start();
  const first = server.client(), second = server.client(), outsider = server.client();
  for (const [client, name] of [[first,'First'],[second,'Second'],[outsider,'Outsider']]) {
    await client.request('/circle-auth/register', 201, 'POST', { displayName: name, email: name+'@example.test', password: 'Circle-test-123!' });
  }
  const { circle } = await first.request('/circles', 201, 'POST', { name: 'Demo family', type: 'Family', description: '' });
  const path = '/circles/'+circle.id;
  const { code } = await first.request(path+'/invitations', 201, 'POST', {});
  await second.request('/circles/join', 200, 'POST', { code });
  await outsider.request(path+'/messages', 403);
  async function joinSocket(client) {
    const socket = client.socket();
    t.after(() => socket.disconnect());
    await once(socket, 'connect', { signal: AbortSignal.timeout(5000) });
    assert.equal((await socket.timeout(5000).emitWithAck('circle:join', { circleId: circle.id })).ok, true);
    return socket;
  }
  const adminSocket = await joinSocket(first);
  const memberSocket = await joinSocket(second);
  const received = once(memberSocket, 'circle:message', { signal: AbortSignal.timeout(5000) });
  const { message } = await first.request(path+'/messages', 201, 'POST', { body: 'Fictional family check-in' });
  assert.equal((await received)[0].body, 'Fictional family check-in');
  assert.equal((await second.request(path+'/messages')).messages[0].body, 'Fictional family check-in');
  const { alert } = await first.request(path+'/alerts', 201, 'POST', { category: 'Flood', body: 'Fictional alert' });
  await second.request(path+'/alerts/'+alert.id+'/ack', 200, 'POST', {});
  assert.equal((await second.request(path+'/messages')).messages.find(item => item.alertId === alert.id).ackCount, 1);
  const reportEvent = once(adminSocket, 'circle:messageReport', { signal: AbortSignal.timeout(5000) });
  let memberSawReport = false;
  memberSocket.on('circle:messageReport', () => { memberSawReport = true; });
  await second.request(path+'/messages/'+message.id+'/report', 201, 'POST', { reason: 'Fictional moderation case' });
  assert.equal((await reportEvent)[0].messageId, message.id);
  await second.request(path+'/message-reports', 403);
  await second.request(path+'/members/me', 204, 'DELETE');
  await second.request(path+'/messages', 403);
  assert.equal(memberSawReport, false);
});
