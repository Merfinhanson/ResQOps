const path=require('node:path'); require('dotenv').config({path:path.resolve(__dirname,'../../.env')});
const {DatabaseSync}=require('node:sqlite'); const fs=require('node:fs'); const {classifySeverity}=require('./severity');
const {migrateOperations}=require('./operations');
const {migrateClassification}=require('./classification-store');
const dir=path.resolve(process.env.DATA_DIR||path.join(__dirname,'../data')); fs.mkdirSync(dir,{recursive:true}); const db=new DatabaseSync(path.join(dir,'resqops.sqlite'));
db.exec(`CREATE TABLE IF NOT EXISTS incidents (id TEXT PRIMARY KEY,title TEXT NOT NULL,description TEXT NOT NULL,category TEXT NOT NULL,location TEXT NOT NULL,latitude REAL,longitude REAL,people_affected INTEGER NOT NULL,reporter_name TEXT,contact_phone TEXT,severity TEXT NOT NULL,severity_reason TEXT NOT NULL,severity_overridden INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'Reported',created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`);
const cols=new Set(db.prepare('PRAGMA table_info(incidents)').all().map(c=>c.name)); if(!cols.has('latitude'))db.exec('ALTER TABLE incidents ADD COLUMN latitude REAL'); if(!cols.has('longitude'))db.exec('ALTER TABLE incidents ADD COLUMN longitude REAL');
migrateOperations(db);
migrateClassification(db);
const samples=[['DEMO-FIRE-001','DEMO · Kitchen fire contained','Smoke spreading from a small kitchen fire; occupants evacuated.','Fire Emergency','North Avenue, Chennai',2,'Demo Reporter','Reported'],['DEMO-ROAD-002','DEMO · Multi vehicle collision','Three vehicle collision with multiple casualties near the junction.','Road Accident','Central Junction, Chennai',12,'Demo Reporter','Pending'],['DEMO-FLOOD-003','DEMO · Street flooding','Heavy flooding reported after overnight rain.','Flood','Marina Link Road, Chennai',0,'Demo Reporter','In Progress'],['DEMO-MED-004','DEMO · Medical assistance needed','A person with a serious injury needs assistance.','Medical Emergency','Park Street, Chennai',1,'Demo Reporter','Resolved']];
const insert=db.prepare('INSERT INTO incidents (id,title,description,category,location,latitude,longitude,people_affected,reporter_name,contact_phone,severity,severity_reason,severity_overridden,automated_severity,classification_reason,classification_version,classified_at,review_required,review_reasons,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING'); const now=new Date().toISOString();
const coords=[[13.0612,80.2525],[13.0827,80.2707],[13.0475,80.2098],[13.0732,80.2613]];
for(let i=0;i<samples.length;i++){const [id,title,description,category,location,count,name,status]=samples[i]; const {severity,reason,version,reviewRequired,reviewReasons}=classifySeverity({category,peopleAffected:count,title,description}); insert.run(id,title,description,category,location,coords[i][0],coords[i][1],count,name,null,severity,reason,severity,reason,version,now,Number(reviewRequired),JSON.stringify(reviewReasons),status,now,now)}
const teams = [
  ['DEMO-TEAM-MED', 'DEMO · Junction medical team', 'Medical', 13.0927, 80.2707, 'Available'],
  ['DEMO-TEAM-RES', 'DEMO · Riverside rescue team', 'Rescue', 13.116, 80.284, 'Available'],
  ['DEMO-TEAM-FIRE', 'DEMO · North fire team', 'Fire', 13.078, 80.261, 'Available'],
  ['DEMO-TEAM-BUSY', 'DEMO · Busy medical team', 'Medical', 13.083, 80.2707, 'Busy'],
];
const insertTeam = db.prepare('INSERT INTO response_teams (id,name,category,latitude,longitude,availability) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING');
for (const team of teams) insertTeam.run(...team);
db.close();
console.log('Demo incidents and teams are present. Existing records and assignment states were preserved.');
