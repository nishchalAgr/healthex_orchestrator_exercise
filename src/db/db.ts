import Database from 'better-sqlite3';
import type { PatientStudy } from './types.ts';

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