const CATEGORIES = ['Fire Emergency','Road Accident','Medical Emergency','Flood','Building Collapse','Other Emergencies'];
const SEVERITIES = ['LOW','MEDIUM','HIGH','CRITICAL'];
function classifySeverity({ category, peopleAffected, description }) {
  const text = String(description || '').toLowerCase();
  const has = (...terms) => terms.some(term => text.includes(term));
  if (peopleAffected >= 10 || has('unconscious','not breathing','multiple casualties','trapped','major collapse','explosion')) return { severity:'CRITICAL', reason: peopleAffected >= 10 ? `${peopleAffected} people affected (10 or more)` : 'Description contains a critical risk keyword' };
  if (peopleAffected >= 5 || has('serious injury','spreading fire','severe bleeding','heavy flooding') || (category === 'Building Collapse' && peopleAffected >= 1)) return { severity:'HIGH', reason: peopleAffected >= 5 ? `${peopleAffected} people affected (5 or more)` : 'Description or category indicates a high risk' };
  if (peopleAffected >= 1 || CATEGORIES.slice(0,5).includes(category)) return { severity:'MEDIUM', reason: peopleAffected >= 1 ? 'At least one person affected' : 'Emergency category requires attention' };
  return { severity:'LOW', reason:'No elevated risk indicators detected' };
}
module.exports = { classifySeverity, CATEGORIES, SEVERITIES };
