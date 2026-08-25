import Database from 'better-sqlite3';

const db = new Database('data.db');

try {
  // Wrap in a transaction to ensure atomicity
  db.exec('BEGIN TRANSACTION;');

  // Delete all rows from patient_studies
  const deleteStudies = db.prepare('DELETE FROM patient_studies');
  const studiesResult = deleteStudies.run();

  // Delete all rows from patient_source_refresh
  const deleteSource = db.prepare('DELETE FROM patient_source_refresh');
  const sourceResult = deleteSource.run();

  db.exec('COMMIT;');

  console.log(`🧹 Cleanup complete.`);
  console.log(`   Removed ${studiesResult.changes} record(s) from patient_studies.`);
  console.log(`   Removed ${sourceResult.changes} record(s) from patient_source_refresh.`);
} catch (error) {
  db.exec('ROLLBACK;');
  console.error('❌ Cleanup failed:', error);
  process.exit(1);
} finally {
  db.close();
}