const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const express = require('express');
const session = require('express-session');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const helmet = require('helmet');
const { z } = require('zod');
const { randomUUID } = require('node:crypto');
const http = require('node:http');
const { Server } = require('socket.io');
const fs = require('node:fs');
const { classifySeverity, CATEGORIES, SEVERITIES } = require('./severity');
const { mountCircles } = require('./circles');
const { mountOperations } = require('./operations');

const app = express();
const port = Number(process.env.PORT || 3001);
const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '../data'));
fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'resqops.sqlite'));
db.exec('PRAGMA journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS incidents (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL,
 location TEXT NOT NULL, latitude REAL, longitude REAL, people_affected INTEGER NOT NULL, reporter_name TEXT, contact_phone TEXT,
 severity TEXT NOT NULL, severity_reason TEXT NOT NULL, severity_overridden INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'Reported', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)`);
const incidentColumns = new Set(db.prepare('PRAGMA table_info(incidents)').all().map(column => column.name));
if (!incidentColumns.has('latitude')) db.exec('ALTER TABLE incidents ADD COLUMN latitude REAL');
if (!incidentColumns.has('longitude')) db.exec('ALTER TABLE incidents ADD COLUMN longitude REAL');
app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173', credentials: true }));
app.use(express.json({ limit: '32kb' }));
db.exec('CREATE TABLE IF NOT EXISTS admin_sessions (sid TEXT PRIMARY KEY, data TEXT NOT NULL, expires_at INTEGER NOT NULL)');
class SQLiteSessionStore extends session.Store {
  get(sid, callback) { try { const row=db.prepare('SELECT data,expires_at FROM admin_sessions WHERE sid=?').get(sid); if(!row || row.expires_at < Date.now()){ if(row) db.prepare('DELETE FROM admin_sessions WHERE sid=?').run(sid); return callback(null,null); } callback(null,JSON.parse(row.data)); } catch(e){callback(e)} }
  set(sid, value, callback=()=>{}) { try { const expiry=value.cookie?.expires ? new Date(value.cookie.expires).getTime() : Date.now()+8*60*60*1000; db.prepare('INSERT INTO admin_sessions(sid,data,expires_at) VALUES(?,?,?) ON CONFLICT(sid) DO UPDATE SET data=excluded.data,expires_at=excluded.expires_at').run(sid,JSON.stringify(value),expiry); callback(); } catch(e){callback(e)} }
  destroy(sid, callback=()=>{}) { try { db.prepare('DELETE FROM admin_sessions WHERE sid=?').run(sid); callback(); } catch(e){callback(e)} }
  touch(sid, value, callback=()=>{}) { try { const expiry=value.cookie?.expires ? new Date(value.cookie.expires).getTime() : Date.now()+8*60*60*1000; db.prepare('UPDATE admin_sessions SET expires_at=? WHERE sid=?').run(expiry,sid); callback(); } catch(e){callback(e)} }
}
const sessionMiddleware = session({ name:'resqops.sid', secret:process.env.SESSION_SECRET || 'dev-only-change-this-session-secret-before-deployment', resave:false, saveUninitialized:false, store:new SQLiteSessionStore(), cookie:{ httpOnly:true, sameSite:'lax', secure:process.env.NODE_ENV === 'production', maxAge:8*60*60*1000 } });
app.use(sessionMiddleware);

const isAdmin = (req,res,next) => req.session?.admin ? next() : res.status(401).json({ error:'Authentication required' });
const reportSchema = z.object({ title:z.string().trim().min(4).max(120), description:z.string().trim().min(10).max(3000), category:z.enum(CATEGORIES), location:z.string().trim().min(3).max(240), latitude:z.number().min(-90).max(90).optional(), longitude:z.number().min(-180).max(180).optional(), peopleAffected:z.number().int().min(0).max(100000), reporterName:z.string().trim().max(100).optional().or(z.literal('')), contactPhone:z.string().trim().max(40).optional().or(z.literal('')) }).superRefine((v,ctx)=>{if((v.latitude===undefined)!==(v.longitude===undefined))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Latitude and longitude must be provided together',path:['latitude']})});
const toIncident = row => row && ({ id:row.id, title:row.title, description:row.description, category:row.category, location:row.location, latitude:row.latitude, longitude:row.longitude, peopleAffected:row.people_affected, reporterName:row.reporter_name, contactPhone:row.contact_phone, severity:row.severity, severityReason:row.severity_reason, severityOverridden:Boolean(row.severity_overridden), status:row.status, createdAt:row.created_at, updatedAt:row.updated_at });

app.get('/api/health', (_req,res) => res.json({ ok:true, service:'ResQOps API' }));
app.post('/api/incidents', (req,res,next) => {
  try {
    const parsed = reportSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error:'Please check the required fields.', details:parsed.error.flatten().fieldErrors });
    const data = parsed.data; const { severity, reason } = classifySeverity({ category:data.category, peopleAffected:data.peopleAffected, description:data.description });
    const id = `RQ-${randomUUID().slice(0,8).toUpperCase()}`; const now = new Date().toISOString();
    db.prepare(`INSERT INTO incidents (id,title,description,category,location,latitude,longitude,people_affected,reporter_name,contact_phone,severity,severity_reason,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'Reported',?,?)`).run(id,data.title,data.description,data.category,data.location,data.latitude ?? null,data.longitude ?? null,data.peopleAffected,data.reporterName || null,data.contactPhone || null,severity,reason,now,now);
    res.status(201).json({ incident:{ id, category:data.category, severity, severityReason:reason, status:'Reported', createdAt:now } });
  } catch (e) { next(e); }
});
app.post('/api/admin/login', async (req,res,next) => {
  try {
    const { username, password } = req.body || {};
    if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD_HASH) return res.status(503).json({ error:'Admin account is not configured. Set ADMIN_USERNAME and ADMIN_PASSWORD_HASH.' });
    const okUser = typeof username === 'string' && username === process.env.ADMIN_USERNAME;
    const okPass = typeof password === 'string' && await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);
    if (!okUser || !okPass) return res.status(401).json({ error:'Invalid username or password.' });
    req.session.admin = { username }; req.session.regenerate(err => { if (err) return next(err); req.session.admin={ username }; res.json({ authenticated:true, username }); });
  } catch(e) { next(e); }
});
app.post('/api/admin/logout', (req,res) => req.session.destroy(err => { if(err) return res.status(500).json({error:'Could not end session'}); res.clearCookie('resqops.sid'); res.json({authenticated:false}); }));
app.get('/api/admin/session', (req,res) => res.json({ authenticated:Boolean(req.session?.admin), username:req.session?.admin?.username || null }));
mountOperations({ app, db, isAdmin, toIncident });
app.get('/api/admin/incidents/:id', isAdmin, (req,res) => { const row=db.prepare('SELECT * FROM incidents WHERE id=?').get(req.params.id); if(!row) return res.status(404).json({error:'Incident not found'}); res.json({incident:toIncident(row)}); });
app.patch('/api/admin/incidents/:id/severity', isAdmin, (req,res) => { const severity=z.enum(SEVERITIES).safeParse(req.body?.severity); if(!severity.success) return res.status(400).json({error:'Unsupported severity'}); const result=db.prepare('UPDATE incidents SET severity=?,severity_reason=?,severity_overridden=1,updated_at=? WHERE id=?').run(severity.data,'Manually overridden by administrator',new Date().toISOString(),req.params.id); if(!result.changes) return res.status(404).json({error:'Incident not found'}); res.json({incident:toIncident(db.prepare('SELECT * FROM incidents WHERE id=?').get(req.params.id))}); });
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors:{ origin:process.env.FRONTEND_ORIGIN || 'http://localhost:5173', credentials:true } });
mountCircles({ app, db, sessionMiddleware, io });
app.use((err,_req,res,_next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({error:'Request body must be valid JSON.'});
  if (err.type === 'entity.too.large') return res.status(413).json({error:'Request body is too large.'});
  console.error(err);
  res.status(500).json({error:'Something went wrong. Please try again.'});
});
httpServer.listen(port, process.env.RESQOPS_HOST || '127.0.0.1', () => {
  const address = httpServer.address();
  console.log(`ResQOps API listening on port ${address.port}`);
  process.send?.({ port: address.port });
});
