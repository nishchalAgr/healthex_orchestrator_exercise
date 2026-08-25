import Database from 'better-sqlite3';

const db = new Database('data.db');

try {
  // Delete all records from the patient_studies table
  const stmt = db.prepare('DELETE FROM patient_studies');
  const result = stmt.run();
  
  console.log(`🧹 Cleanup complete. Removed ${result.changes} record(s) from patient_studies.`);
} catch (error) {
  console.error('❌ Cleanup failed:', error);
  process.exit(1);
} finally {
  db.close();
}