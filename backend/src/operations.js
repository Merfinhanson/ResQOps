const { randomUUID } = require('node:crypto');
const { z } = require('zod');

const teamCategories = ['Fire', 'Medical', 'Rescue', 'General Emergency'];
const capabilities = {
  'Fire Emergency': ['Fire', 'Rescue'],
  'Road Accident': ['Medical', 'Rescue'],
  'Medical Emergency': ['Medical'],
  Flood: ['Rescue'],
  'Building Collapse': ['Rescue'],
  'Other Emergencies': ['General Emergency', 'Rescue'],
};
const urgency = { 'Fire Emergency': 15, 'Road Accident': 13, 'Medical Emergency': 15, Flood: 12, 'Building Collapse': 15, 'Other Emergencies': 6 };
const priorityRules = {
  severity: { CRITICAL: 40, HIGH: 30, MEDIUM: 18, LOW: 8 },
  maxPeoplePoints: 25,
  maxWaitingPoints: 20,
  minutesPerWaitingPoint: 10,
  category: urgency,
};
const coordinates = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) });
const teamSchema = coordinates.extend({
  name: z.string().trim().min(2).max(100),
  category: z.enum(teamCategories),
  availability: z.enum(['Available', 'Busy']),
}).strict();

function priority(incident, now = Date.now()) {
  const waitingMinutes = Math.max(0, Math.floor((now - Date.parse(incident.created_at)) / 60000)) || 0;
  const factors = {
    severity: priorityRules.severity[incident.severity] ?? 0,
    people: Math.min(priorityRules.maxPeoplePoints, Math.max(0, incident.people_affected)),
    waiting: Math.min(priorityRules.maxWaitingPoints, Math.floor(waitingMinutes / priorityRules.minutesPerWaitingPoint)),
    category: priorityRules.category[incident.category] ?? 0,
  };
  return { score: Object.values(factors).reduce((sum, points) => sum + points, 0), waitingMinutes, factors };
}

function distanceKm(from, to) {
  const rad = degrees => degrees * Math.PI / 180;
  const a = Math.sin(rad(to.latitude - from.latitude) / 2) ** 2
    + Math.cos(rad(from.latitude)) * Math.cos(rad(to.latitude))
    * Math.sin(rad(to.longitude - from.longitude) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
}

function migrateOperations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS response_teams (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
      latitude REAL NOT NULL, longitude REAL NOT NULL,
      availability TEXT NOT NULL CHECK (availability IN ('Available','Busy')),
      archived_at TEXT
    );
    CREATE TABLE IF NOT EXISTS incident_assignments (
      id TEXT PRIMARY KEY, incident_id TEXT NOT NULL REFERENCES incidents(id),
      team_id TEXT NOT NULL REFERENCES response_teams(id), assigned_at TEXT NOT NULL,
      started_at TEXT, resolved_at TEXT,
      status TEXT NOT NULL CHECK (status IN ('Assigned','In Progress','Resolved'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS active_incident_assignment ON incident_assignments(incident_id) WHERE resolved_at IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS active_team_assignment ON incident_assignments(team_id) WHERE resolved_at IS NULL;
  `);
}

function mountOperations({ app, db, isAdmin, toIncident }) {
  migrateOperations(db);
  const root = '/api/admin';
  const stamp = () => new Date().toISOString();
  const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
  const route = (method, path, handler) => app[method](root + path, isAdmin, (req, res, next) => {
    try { handler(req, res); } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message });
      next(error);
    }
  });
  const parse = (schema, body) => {
    const result = schema.safeParse(body);
    if (!result.success) fail(400, 'Check ' + (result.error.issues[0].path.join('.') || 'the submitted fields') + '.');
    return result.data;
  };
  const transaction = work => {
    db.exec('BEGIN IMMEDIATE');
    try { const value = work(); db.exec('COMMIT'); return value; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const incident = id => db.prepare('SELECT * FROM incidents WHERE id=?').get(id) ?? fail(404, 'Incident not found.');
  const teams = () => db.prepare(`SELECT t.id,t.name,t.category,t.latitude,t.longitude,t.availability,
    a.incident_id assignedIncidentId FROM response_teams t LEFT JOIN incident_assignments a
    ON a.team_id=t.id AND a.resolved_at IS NULL WHERE t.archived_at IS NULL ORDER BY t.name,t.id`).all();
  const team = id => teams().find(t => t.id === id) ?? fail(404, 'Team not found.');
  const history = id => db.prepare(`SELECT a.id,a.incident_id incidentId,a.team_id teamId,t.name teamName,
    a.assigned_at assignedAt,a.started_at startedAt,a.resolved_at resolvedAt,a.status
    FROM incident_assignments a JOIN response_teams t ON t.id=a.team_id
    WHERE a.incident_id=? ORDER BY a.assigned_at DESC,a.rowid DESC`).all(id);
  const recommend = row => {
    if (!coordinates.safeParse(row).success) return [];
    const suitable = capabilities[row.category] ?? [];
    return teams().filter(t => t.availability === 'Available' && !t.assignedIncidentId
      && suitable.includes(t.category) && coordinates.safeParse(t).success)
      .map(t => ({ ...t, distanceKm: distanceKm(row, t), reason: `${t.category} covers ${row.category} and this team is available.` }))
      .sort((a, b) => a.distanceKm - b.distanceKm || a.id.localeCompare(b.id));
  };
  const queue = () => {
    const now = Date.now();
    let rank = 0;
    return db.prepare('SELECT * FROM incidents').all().map(row => ({ ...toIncident(row), priority: priority(row, now) }))
      .sort((a, b) => Number(a.status === 'Resolved') - Number(b.status === 'Resolved')
        || b.priority.score - a.priority.score || (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0)
        || a.id.localeCompare(b.id))
      .map(row => ({ ...row, rank: row.status === 'Resolved' ? null : ++rank }));
  };
  const getQueue = (activeOnly) => (req, res) => {
    const { search = '', category = '', severity = '', status = '' } = parse(
      z.object({ search: z.string().max(240).optional(), category: z.string().optional(), severity: z.string().optional(), status: z.string().optional() }), req.query);
    const term = search.trim().toLowerCase();
    res.json({ incidents: queue().filter(row => (!activeOnly || status || row.status !== 'Resolved')
      && (!category || row.category === category)
      && (!severity || row.severity === severity) && (!status || row.status === status)
      && [row.title, row.id, row.location].some(value => value.toLowerCase().includes(term))) });
  };
  route('get', '/priority-queue', getQueue(true));
  route('get', '/incidents', getQueue(false));
  route('get', '/teams', (_req, res) => res.json({ teams: teams() }));
  route('post', '/teams', (req, res) => {
    const data = parse(teamSchema, req.body);
    const id = `TEAM-${randomUUID()}`;
    db.prepare('INSERT INTO response_teams(id,name,category,latitude,longitude,availability) VALUES(?,?,?,?,?,?)')
      .run(id, data.name, data.category, data.latitude, data.longitude, data.availability);
    res.status(201).json({ team: team(id) });
  });
  route('patch', '/teams/:id', (req, res) => {
    const patch = parse(teamSchema.partial().refine(value => Object.keys(value).length > 0), req.body);
    const updated = transaction(() => {
      const current = team(req.params.id);
      const data = { ...current, ...patch };
      if (current.assignedIncidentId && data.availability !== 'Busy') fail(409, 'Resolve the assigned incident before releasing this team.');
      db.prepare('UPDATE response_teams SET name=?,category=?,latitude=?,longitude=?,availability=? WHERE id=?')
        .run(data.name, data.category, data.latitude, data.longitude, data.availability, current.id);
      return team(current.id);
    });
    res.json({ team: updated });
  });
  route('delete', '/teams/:id', (req, res) => {
    transaction(() => {
      const current = team(req.params.id);
      if (current.assignedIncidentId) fail(409, 'Resolve the assigned incident before removing this team.');
      db.prepare('UPDATE response_teams SET archived_at=? WHERE id=?').run(stamp(), current.id);
    });
    res.status(204).end();
  });
  route('get', '/incidents/:id/recommendations', (req, res) => {
    const row = incident(req.params.id);
    const assignments = history(row.id);
    const needsLocation = !coordinates.safeParse(row).success;
    const active = assignments.find(a => !a.resolvedAt);
    const assignedTeam = active ? team(active.teamId) : null;
    const assignedDistanceKm = assignedTeam && !needsLocation ? distanceKm(row, assignedTeam) : null;
    res.json({ assignments, needsLocation, assignedTeam, assignedDistanceKm,
      recommendations: row.status === 'Resolved' || active ? [] : recommend(row) });
  });
  route('patch', '/incidents/:id/location', (req, res) => {
    const data = parse(coordinates, req.body);
    const row = incident(req.params.id);
    db.prepare('UPDATE incidents SET latitude=?,longitude=?,updated_at=? WHERE id=?').run(data.latitude, data.longitude, stamp(), row.id);
    res.json({ incident: toIncident(incident(row.id)) });
  });
  route('post', '/incidents/:id/assign', (req, res) => {
    const { teamId } = parse(z.object({ teamId: z.string().min(1).max(80) }).strict(), req.body);
    const row = transaction(() => {
      const current = incident(req.params.id);
      if (current.status === 'Resolved' || history(current.id).some(a => !a.resolvedAt)) fail(409, 'This incident cannot receive another active assignment.');
      if (!coordinates.safeParse(current).success) fail(400, 'Set incident coordinates before assigning a team.');
      if (!recommend(current).some(t => t.id === teamId)) fail(409, 'This team is no longer available or suitable. Refresh recommendations.');
      const now = stamp();
      db.prepare("INSERT INTO incident_assignments(id,incident_id,team_id,assigned_at,status) VALUES(?,?,?,?,'Assigned')")
        .run(randomUUID(), current.id, teamId, now);
      db.prepare("UPDATE response_teams SET availability='Busy' WHERE id=?").run(teamId);
      db.prepare("UPDATE incidents SET status='Assigned',updated_at=? WHERE id=?").run(now, current.id);
      return incident(current.id);
    });
    res.status(201).json({ incident: toIncident(row), assignments: history(row.id), team: team(teamId) });
  });
  route('patch', '/incidents/:id/status', (req, res) => {
    const { status } = parse(z.object({ status: z.enum(['Reported', 'Pending', 'Assigned', 'In Progress', 'Resolved']) }), req.body);
    const row = transaction(() => {
      const current = incident(req.params.id);
      if (status === current.status) return current;
      const active = history(current.id).find(a => !a.resolvedAt);
      if (status === 'Assigned') fail(409, 'Use Assign team to set this status.');
      if (active && !['In Progress', 'Resolved'].includes(status)) fail(409, 'An active assignment can only be started or resolved.');
      if (active && status === 'Resolved' && active.status !== 'In Progress') fail(409, 'Mark the response In Progress before resolving it.');
      const now = stamp();
      if (active && status === 'In Progress') {
        db.prepare("UPDATE incident_assignments SET status=?,started_at=COALESCE(started_at,?) WHERE id=?").run(status, now, active.id);
      }
      if (active && status === 'Resolved') {
        db.prepare('UPDATE incident_assignments SET status=?,resolved_at=? WHERE id=?').run(status, now, active.id);
        db.prepare("UPDATE response_teams SET availability='Available' WHERE id=? AND NOT EXISTS(SELECT 1 FROM incident_assignments WHERE team_id=? AND resolved_at IS NULL)")
          .run(active.teamId, active.teamId);
      }
      db.prepare('UPDATE incidents SET status=?,updated_at=? WHERE id=?').run(status, now, current.id);
      return incident(current.id);
    });
    res.json({ incident: toIncident(row) });
  });
  route('delete', '/incidents/:id', (req, res) => {
    transaction(() => {
      const row = incident(req.params.id);
      if (history(row.id).length) fail(409, 'Incidents with assignment history are retained.');
      db.prepare('DELETE FROM incidents WHERE id=?').run(row.id);
    });
    res.status(204).end();
  });
  const analytics = (_req, res) => {
    const metrics = db.prepare(`SELECT COUNT(*) total, COUNT(*) FILTER(WHERE severity='CRITICAL') critical,
      COUNT(*) FILTER(WHERE status IN ('Reported','Pending')) pending,
      COUNT(*) FILTER(WHERE status='Assigned') assigned,
      COUNT(*) FILTER(WHERE status='In Progress') inProgress,
      COUNT(*) FILTER(WHERE status='Resolved') resolved,
      COUNT(*) FILTER(WHERE latitude IS NULL OR longitude IS NULL) unmapped FROM incidents`).get();
    const availability = db.prepare(`SELECT COUNT(*) FILTER(WHERE availability='Available') availableTeams,
      COUNT(*) FILTER(WHERE availability='Busy') busyTeams FROM response_teams WHERE archived_at IS NULL`).get();
    const assignments = db.prepare(`SELECT COUNT(*) FILTER(WHERE resolved_at IS NULL) activeAssignments,
      COUNT(*) FILTER(WHERE status='Assigned') awaitingStart, COUNT(*) FILTER(WHERE status='In Progress') responding,
      COUNT(*) FILTER(WHERE status='Resolved') completedAssignments FROM incident_assignments`).get();
    res.json({ ...metrics, ...availability, ...assignments,
      categories: db.prepare('SELECT category,COUNT(*) count FROM incidents GROUP BY category').all(),
      severities: db.prepare('SELECT severity,COUNT(*) count FROM incidents GROUP BY severity').all() });
  };
  route('get', '/analytics', analytics);
  route('get', '/stats', analytics);
}

module.exports = { mountOperations, migrateOperations, priority, distanceKm };
