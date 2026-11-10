const test=require('node:test'); const assert=require('node:assert/strict'); const {classifySeverity}=require('../src/severity');
test('12 affected is critical',()=>assert.equal(classifySeverity({category:'Road Accident',peopleAffected:12,description:'collision'}).severity,'CRITICAL'));
test('critical keywords are case insensitive',()=>assert.equal(classifySeverity({category:'Other Emergencies',peopleAffected:0,description:'Person is UNCONSCIOUS'}).severity,'CRITICAL'));
test('high risk keyword returns high',()=>assert.equal(classifySeverity({category:'Other Emergencies',peopleAffected:0,description:'There is heavy flooding'}).severity,'HIGH'));
test('one affected person returns medium',()=>assert.equal(classifySeverity({category:'Other Emergencies',peopleAffected:1,description:'Need help'}).severity,'MEDIUM'));
test('other zero impact report returns low',()=>assert.equal(classifySeverity({category:'Other Emergencies',peopleAffected:0,description:'Suspicious noise'}).severity,'LOW'));
