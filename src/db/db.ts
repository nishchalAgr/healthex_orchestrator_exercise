import Database from 'better-sqlite3';
import type { PatientStudy, PatientDataSource } from './types.ts';

const db = new Database('data.db');

// Schema – data_sources stores a JSON array
db.exec(`
  CREATE TABLE IF NOT EXISTS patient_studies (
    patient_id TEXT NOT NULL,
    study_id TEXT NOT NULL,
    frequency_seconds INTEGER NOT NULL,
    status TEXT DEFAULT 'PENDING',
    last_refresh_at DATETIME,
    data_sources TEXT,  -- e.g., '["epic","cerner"]'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (patient_id, study_id)
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS patient_source_refresh (
    patient_id TEXT NOT NULL,
    data_source TEXT NOT NULL,  -- e.g., 'epic', 'cerner', 'athena'
    last_refresh_at DATETIME,
    status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED')),
    PRIMARY KEY (patient_id, data_source)
  );
`);

export function createPatientStudy(
  patientId: string,
  studyId: string,
  frequencySeconds: number,
  dataSources?: string[] // Accepts array of strings
): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO patient_studies 
      (patient_id, study_id, frequency_seconds, data_sources, status)
    VALUES (?, ?, ?, ?, 'PENDING')
  `);
  stmt.run(patientId, studyId, frequencySeconds, JSON.stringify(dataSources || []));

  if (dataSources && dataSources.length > 0) {
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO patient_source_refresh (patient_id, data_source, last_refresh_at, status)
      VALUES (?, ?, NULL, 'PENDING')
    `);
    for (const source of dataSources) {
      insertStmt.run(patientId, source);
    }
  }
}

export function getAllPatientStudies(patientId: string): PatientStudy[] {
  const stmt = db.prepare('SELECT * FROM patient_studies WHERE patient_id = ?');
  return stmt.all(patientId) as PatientStudy[];
}

export function getPatientStudies(patientId: string, studyIds: string[]): PatientStudy[] {
  const stmt = db.prepare('SELECT * FROM patient_studies WHERE patient_id = ? AND study_id IN studyIds');
  return stmt.all(patientId, studyIds) as PatientStudy[];
}

export function getPatientStudy(patientId: string, studyId: string): PatientStudy | undefined {
  const stmt = db.prepare('SELECT * FROM patient_studies WHERE patient_id = ? AND study_id = ?');
  return stmt.get(patientId, studyId) as PatientStudy | undefined;
}

export function getAllPendingStudies(): PatientStudy[] {
  const stmt = db.prepare('SELECT * FROM patient_studies WHERE status = \'PENDING\'');
  return stmt.all() as PatientStudy[];
}

export function updateStatus(
  patientId: string,
  studyId: string,
  status: PatientStudy['status'],
  lastRefreshAt?: string
): void {
  const fields = ['status = ?'];
  const values: any[] = [status];
  
  if (lastRefreshAt) {
    fields.push('last_refresh_at = ?');
    values.push(lastRefreshAt);
  }
  
  values.push(patientId, studyId);
  const stmt = db.prepare(`
    UPDATE patient_studies 
    SET ${fields.join(', ')} 
    WHERE patient_id = ? AND study_id = ?
  `);
  stmt.run(...values);
}

export function getPatientSource(
  patientId: string,
  dataSource: string
): PatientDataSource {
  const stmt = db.prepare(
    'SELECT last_refresh_at FROM patient_source_refresh WHERE patient_id = ? AND data_source = ?'
  );
  return stmt.get(patientId, dataSource) as PatientDataSource;
}

export function completePatientSourceRefresh(
  patientId: string,
  dataSource: string,
  status: 'COMPLETED' | 'FAILED',
  refreshTime?: string
): void {
  const fields = ['status = ?'];
  const values: any[] = [status];
  if (refreshTime) {
    fields.push('last_refresh_at = ?');
    values.push(refreshTime);
  }
  values.push(patientId, dataSource);
  const stmt = db.prepare(`
    UPDATE patient_source_refresh
    SET ${fields.join(', ')}
    WHERE patient_id = ? AND data_source = ?
  `);
  stmt.run(...values);
}

export function tryStartPatientSourceRefresh(patientId: string, dataSource: string): boolean {
  const stmt = db.prepare(`
    UPDATE patient_source_refresh
    SET status = 'IN_PROGRESS'
    WHERE patient_id = ? AND data_source = ? AND status IN ('PENDING', 'FAILED')
  `);
  const result = stmt.run(patientId, dataSource);
  return result.changes > 0;
}