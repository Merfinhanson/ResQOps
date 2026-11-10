const test=require('node:test'); const assert=require('node:assert/strict'); const {classifySeverity}=require('../src/severity');
test('12 affected is critical',()=>assert.equal(classifySeverity({category:'Road Accident',peopleAffected:12,description:'collision'}).severity,'CRITICAL'));
test('critical keywords are case insensitive',()=>assert.equal(classifySeverity({category:'Other Emergencies',peopleAffected:0,description:'Person is UNCONSCIOUS'}).severity,'CRITICAL'));
test('high risk keyword returns high',()=>assert.equal(classifySeverity({category:'Other Emergencies',peopleAffected:0,description:'There is heavy flooding'}).severity,'HIGH'));
test('one affected person returns medium',()=>assert.equal(classifySeverity({category:'Other Emergencies',peopleAffected:1,description:'Need help'}).severity,'MEDIUM'));
test('other zero impact report returns low',()=>assert.equal(classifySeverity({category:'Other Emergencies',peopleAffected:0,description:'Suspicious noise'}).severity,'LOW'));

const cases = [
  ['LOW', 'Road Accident', 0, 'Minor roadside obstruction', 'No injuries or immediate danger. No one is trapped or unconscious.'],
  ['MEDIUM', 'Road Accident', 2, 'Small road accident', 'Two people have minor injuries.'],
  ['HIGH', 'Fire Emergency', 6, 'Spreading building fire', 'Fire is spreading. Occupants are evacuating.'],
  ['CRITICAL', 'Road Accident', 12, 'Major collision', 'Multiple serious injuries.'],
  ['CRITICAL', 'Medical Emergency', 1, 'Medical emergency', 'Person is unconscious and not breathing.'],
  ['LOW', 'Road Accident', 0, 'Car stopped', 'No injuries reported. Driver was not injured.'],
  ['CRITICAL', 'Other Emergencies', 1, 'Person not breathing', 'One person is affected.'],
];
for (const [severity, category, peopleAffected, title, description] of cases) {
  test('assessment example: '+title, () => {
    const result = classifySeverity({severity,category,peopleAffected,title,description});
    assert.equal(result.severity,severity);
    assert.ok(result.reason);
  });
}
test('contradictory and uncertain high-risk evidence requires human review', () => {
  const result = classifySeverity({category:'Road Accident',peopleAffected:1,title:'Possible severe bleeding',description:'No injuries reported. A person could be trapped.'});
  assert.equal(result.severity,'CRITICAL');
  assert.equal(result.reviewRequired,true);
  assert.match(result.reviewReasons.join(' '),/Conflicting injury details/);
});
test('structured absence conflicts with reported injuries while unknown is neutral', () => {
  const incident = {category:'Road Accident',peopleAffected:2,description:'A passenger has severe bleeding.'};
  assert.equal(classifySeverity({...incident,injuryStatus:'unknown'}).reviewRequired,false);
  assert.equal(classifySeverity({...incident,injuryStatus:'none'}).reviewRequired,true);
});
test('migration retains legacy effective severity without fabricating missing override evidence', () => {
  const {DatabaseSync}=require('node:sqlite');
  const {migrateClassification,classificationFields}=require('../src/classification-store');
  const db=new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE incidents (id TEXT, severity TEXT, severity_reason TEXT, severity_overridden INTEGER, created_at TEXT);
      INSERT INTO incidents VALUES ('one','HIGH','Previous rule explanation',0,'2025-01-01T00:00:00Z'),
      ('two','LOW','Manually overridden by administrator',1,'2025-01-01T00:00:00Z');`);
    migrateClassification(db);
    migrateClassification(db);
    const [initial,overridden]=db.prepare('SELECT * FROM incidents ORDER BY id').all();
    assert.equal(classificationFields(initial).automatedSeverity,'HIGH');
    assert.equal(classificationFields(initial).classificationReason,'Previous rule explanation');
    assert.equal(overridden.severity,'LOW');
    assert.equal(classificationFields(overridden).automatedSeverity,null);
    assert.equal(classificationFields(overridden).severitySource,'Admin Override');
  } finally {db.close();}
});

test('critical breathing variants trigger a review for zero affected count', () => {
  for (const description of ['No one is breathing.', 'Nobody was breathing.']) {
    const result = classifySeverity({category:'Medical Emergency',peopleAffected:0,title:'Emergency report',description});
    assert.equal(result.severity,'CRITICAL');
    assert.equal(result.reviewRequired,true);
  }
});

test('no pulse or heartbeat is classified as critical', () => {
  for (const description of ['No pulse detected.', 'There is no heartbeat.']) {
    const result = classifySeverity({category:'Medical Emergency',peopleAffected:1,title:'Patient emergency',description});
    assert.equal(result.severity,'CRITICAL');
  }
});

test('loss of consciousness is critical while the negated form is not', () => {
  assert.equal(classifySeverity({category:'Medical Emergency',peopleAffected:1,title:'Medical report',description:'The patient is not conscious.'}).severity,'CRITICAL');
  assert.equal(classifySeverity({category:'Other Emergencies',peopleAffected:0,title:'Public report',description:'The person is not unconscious.'}).severity,'LOW');
});

test('critical additions do not regress existing severity cases', () => {
  for (const [description,category,count,expected] of [
    ['Person is unconscious.','Medical Emergency',1,'CRITICAL'],
    ['A patient is not breathing.','Medical Emergency',1,'CRITICAL'],
    ['Fire is spreading.','Fire Emergency',0,'HIGH'],
    ['Two people have minor injuries.','Road Accident',2,'MEDIUM'],
    ['No injuries reported.','Other Emergencies',0,'LOW'],
    ['There is no fire.','Other Emergencies',0,'LOW'],
  ]) {
    assert.equal(classifySeverity({description,category,peopleAffected:count,title:'Emergency report'}).severity,expected);
  }
});
