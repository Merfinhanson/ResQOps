const CATEGORIES = ['Fire Emergency', 'Road Accident', 'Medical Emergency', 'Flood', 'Building Collapse', 'Other Emergencies'];
const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const CLASSIFICATION_VERSION = 'resqops-severity-v2';

const peopleThresholds = [[10, 'CRITICAL'], [5, 'HIGH'], [1, 'MEDIUM']];
const riskRules = [
  ['CRITICAL', 'Unconsciousness or unresponsiveness', /\b(?:unconscious|unresponsive|not responding|passed out|lost consciousness)\b/g],
  ['CRITICAL', 'Absent breathing or cardiac arrest', /\b(?:not (?:currently )?breathing|isn['’]?t breathing|no (?:signs of )?breathing|stopped breathing|cannot breathe|can['’]?t breathe|cardiac arrest)\b/g],
  ['CRITICAL', 'Person reported trapped', /\b(?:trapped|pinned under|unable to escape)\b/g],
  ['CRITICAL', 'Multiple serious casualties', /\bmultiple (?:serious (?:injuries|casualties)|casualties|critically injured)\b/g],
  ['CRITICAL', 'Major explosion or immediate threat to life', /\b(?:major explosion|life threatening|immediate (?:threat to life|danger to life))\b/g],
  ['HIGH', 'Serious injury or severe bleeding', /\b(?:serious(?:ly)? injur(?:y|ies|ed)|severe (?:injur(?:y|ies)|bleeding)|heavy bleeding)\b/g],
  ['HIGH', 'Escalating fire, flooding or structural danger', /\b(?:spreading fire|fire (?:is )?spreading|(?:heavy|significant|rapid) flooding|major (?:structural )?collapse|active danger|immediate danger|explosion)\b/g],
  ['MEDIUM', 'Injury reported', /\b(?:minor injur(?:y|ies)|injur(?:y|ies|ed))\b/g],
  ['MEDIUM', 'Localized fire or manageable flooding', /\b(?:(?:small|localized|contained) fire|manageable flooding|minor flooding)\b/g],
];

const normalize = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[‐‑‒–—-]/g, ' ').replace(/\s+/g, ' ').trim();
const categoryKey = value => normalize(value).replace(/[^a-z0-9]/g, '');
const canonicalCategories = new Map(CATEGORIES.map(category => [categoryKey(category), category]));
const normalizeCategory = value => typeof value === 'string' ? canonicalCategories.get(categoryKey(value)) : undefined;
const negative = /\b(?:no|not|never|without|denies|denied|none|nobody|neither|isn['’]?t|wasn['’]?t|aren['’]?t|weren['’]?t)\b/;
const uncertain = /\b(?:maybe|possibly|possible|suspected|unclear|unknown|unconfirmed|might|could be|not sure|not (?:yet )?known|whether)\b|\?/;

function classifySeverity({ category, peopleAffected, title, description, injuryStatus, activeDanger }) {
  const clauses = [title, description].filter(Boolean).flatMap(value =>
    normalize(value).split(/(?<=[.!?;,:])\s*|\b(?:but|however|although|whereas)\b/).filter(Boolean));
  const triggers = [];
  const review = new Set();
  let injuryReported = false;
  let injuryDenied = injuryStatus === 'none' || clauses.some(clause => /\b(?:no (?:known )?injur(?:y|ies)|not injured|without injur(?:y|ies))\b/.test(clause));
  const dangerDenied = activeDanger === false || clauses.some(clause => /\b(?:no|without) (?:known )?(?:immediate |active )?danger\b/.test(clause));
  const add = (severity, reason) => triggers.push({ severity, reason });
  for (const [threshold, severity] of peopleThresholds) {
    if (peopleAffected >= threshold) add(severity, `${peopleAffected} affected (threshold ${threshold})`);
  }
  for (const [severity, label, pattern] of riskRules) {
    let positive = false;
    let denied = false;
    for (const clause of clauses) {
      for (const match of clause.matchAll(pattern)) {
        const left = clause.slice(0, match.index).split(/\b(?:and|then)\b(?=\s*(?:(?:a |the |one )?(?:person|driver|patient|someone|they|he|she)\b|$))/).pop();
        const prefix = left.trim().split(/\s+/).slice(-6).join(' ');
        const context = prefix + ' ' + clause.slice(match.index, match.index + match[0].length + 28);
        if (uncertain.test(context)) review.add(`Uncertain: ${label.toLowerCase()}`);
        const negativeContext = negative.test(prefix)
          || /^\s+(?:ruled out|was ruled out|not reported|not present)\b/.test(clause.slice(match.index + match[0].length));
        if (negativeContext && !/\bnot (?:sure|known)\b/.test(prefix)) { denied = true; continue; }
        positive = true;
      }
    }
    if (positive) add(severity, label);
    if (positive && denied) review.add(`Conflicting reports: ${label.toLowerCase()}`);
    if (/injury|casualties/i.test(label)) {
      injuryReported ||= positive;
      injuryDenied ||= denied;
    }
  }
  if (injuryStatus === 'serious') { add('HIGH', 'Serious injury indicated'); injuryReported = true; }
  if (injuryStatus === 'minor') { add('MEDIUM', 'Minor injury indicated'); injuryReported = true; }
  if (activeDanger === true) add('HIGH', 'Active danger indicated');
  if (category === 'Building Collapse' && peopleAffected > 0) add('HIGH', 'Building collapse with affected people');
  if (category === 'Medical Emergency') add('MEDIUM', 'Medical incident category');
  if (injuryDenied && injuryReported) review.add('Conflicting injury details');
  if (dangerDenied && triggers.some(item => ['HIGH', 'CRITICAL'].includes(item.severity) && !item.reason.includes('threshold'))) review.add('Hazard reported alongside a denial of danger');
  if (peopleAffected === 0 && injuryReported) review.add('Injury reported with zero affected people');
  if (peopleAffected === 0 && triggers.some(item => /unconsciousness|breathing|person reported trapped/i.test(item.reason))) {
    review.add('A person is described in danger but the affected count is zero');
  }
  if (clauses.some(clause => /\b(?:details (?:are )?unknown|not enough (?:information|details)|(?:unclear|unknown) (?:what happened|whether))\b/.test(clause))) review.add('Incident details are incomplete');
  triggers.sort((a, b) => SEVERITIES.indexOf(b.severity) - SEVERITIES.indexOf(a.severity));
  const severity = triggers[0]?.severity ?? 'LOW';
  const reason = [...new Set(triggers.map(item => item.reason))].join('; ') || 'No elevated risk rule matched the reported details.';
  return { severity, reason, source: 'Rule-Based', version: CLASSIFICATION_VERSION, reviewRequired: review.size > 0, reviewReasons: [...review] };
}

module.exports = { classifySeverity, normalizeCategory, CATEGORIES, SEVERITIES };
