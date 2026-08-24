import express from 'express';
import { addRefreshJob } from './queue.ts';
import { createWorker } from './worker.ts';
import { getAllPendingStudies, getPatientStudies, getAllPatientStudies } from './db/db.ts';
import { PatientStudy } from './db/types.ts';

const app = express();
app.use(express.json());

const N = 10;
const workers = [];
for (let i = 0; i < N; i++) {
  workers.push(createWorker(i + 1));
}
console.log(`✅ Initialized ${N} workers.`);

(async function scheduleInitialJobs() {
  const pending = getAllPendingStudies();
  console.log(`📋 Found ${pending.length} pending records. Scheduling initial jobs...`);

  for (const record of pending) {
    const baseDelay = Math.floor(Math.random() * 2000);
    await addRefreshJob(record.patient_id, record.study_id, 1, baseDelay);
  }

  console.log(`✅ ${pending.length} initial jobs queued.`);
})();

app.post('/patients/:id/$updateData', async (req, res) => {
  const { id } = req.params;
  let { studies } = req.body;

  let patients: PatientStudy[] = [];
  if (!studies) {
    patients = await getAllPatientStudies(id);
  } else if (Array.isArray(studies)) {
    patients = await getPatientStudies(id, studies);
  } else {
    return res.status(400).json({ error: 'studies must be an array or ' });
  }

  if (patients.length === 0) {
    return res.status(404).json({ error: 'No matching studies found for patient' });
  }

  const targetStudyIds = patients.map(p => p.study_id);
  const jobs = [];
  for (const studyId of targetStudyIds) {
    const job = await addRefreshJob(id, studyId, 0);
    jobs.push({ studyId: studyId, jobId: job.id });
  }

  res.status(202).json({
    message: 'Manual refresh triggered',
    patient_id: id,
    jobs: jobs,
  });
});

app.get('/patients/:id/data-retrieval/status', async (req, res) => {
  const { id } = req.params;
  const studies = await getAllPatientStudies(id);

  res.json({
    patient_id: id,
    studies: studies.map(s => ({
      study_id: s.study_id,
      status: s.status,
      last_refresh_at: s.last_refresh_at,
    })),
  });
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:3000`);
});