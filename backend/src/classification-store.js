function migrateClassification(db) {
  const fields = {
    automated_severity: 'TEXT',
    classification_reason: 'TEXT',
    severity_source: "TEXT NOT NULL DEFAULT 'Rule-Based'",
    classification_version: "TEXT NOT NULL DEFAULT 'legacy'",
    classified_at: 'TEXT',
    review_required: 'INTEGER NOT NULL DEFAULT 0',
    review_reasons: "TEXT NOT NULL DEFAULT '[]'",
  };
  const columns = new Set(db.prepare('PRAGMA table_info(incidents)').all().map(column => column.name));
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [name, type] of Object.entries(fields)) {
      if (!columns.has(name)) db.exec(`ALTER TABLE incidents ADD COLUMN ${name} ${type}`);
    }
    db.exec(`
      UPDATE incidents SET automated_severity=severity, classification_reason=severity_reason, classified_at=created_at
      WHERE classification_version='legacy' AND severity_overridden=0 AND automated_severity IS NULL;
      UPDATE incidents SET severity_source='Admin Override'
      WHERE classification_version='legacy' AND severity_overridden=1 AND severity_source<>'Admin Override';
      CREATE TABLE IF NOT EXISTS severity_overrides (
        id INTEGER PRIMARY KEY,
        incident_id TEXT NOT NULL,
        previous_severity TEXT NOT NULL,
        new_severity TEXT NOT NULL,
        admin_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        changed_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS severity_overrides_incident ON severity_overrides(incident_id, id);
    `);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function classificationFields(row) {
  return {
    automatedSeverity: row.automated_severity,
    classificationReason: row.classification_reason,
    classificationVersion: row.classification_version,
    classifiedAt: row.classified_at,
    severitySource: row.severity_source,
    reviewRequired: Boolean(row.review_required),
    reviewReasons: JSON.parse(row.review_reasons ?? '[]'),
  };
}

function overrideHistory(db, incidentId) {
  return db.prepare(`SELECT id, previous_severity AS previousSeverity, new_severity AS newSeverity,
    admin_id AS adminId, reason, changed_at AS changedAt
    FROM severity_overrides WHERE incident_id=? ORDER BY id DESC`).all(incidentId);
}

function overrideSeverity(db, incidentId, severity, reason, adminId) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const current = db.prepare('SELECT * FROM incidents WHERE id=?').get(incidentId);
    if (!current || current.severity === severity) {
      db.exec('COMMIT');
      return current;
    }
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO severity_overrides
      (incident_id,previous_severity,new_severity,admin_id,reason,changed_at) VALUES (?,?,?,?,?,?)`)
      .run(incidentId, current.severity, severity, adminId, reason, now);
    db.prepare("UPDATE incidents SET severity=?, severity_reason=?, severity_overridden=1, severity_source='Admin Override', updated_at=? WHERE id=?")
      .run(severity, reason, now, incidentId);
    const updated = db.prepare('SELECT * FROM incidents WHERE id=?').get(incidentId);
    db.exec('COMMIT');
    return updated;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

module.exports = { migrateClassification, classificationFields, overrideHistory, overrideSeverity };
