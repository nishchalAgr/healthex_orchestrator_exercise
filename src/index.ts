import express from 'express';
import { addRefreshJob } from './queue.ts';
import { createWorker } from './worker.ts';
import { getAllPendingStudies, getPatientStudies, getAllPatientStudies } from './db/db.ts';
import type { PatientStudy } from './db/types.ts';
import { sleep } from './utils.ts';


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

  let delay = 0;
  for (const record of pending) {
    delay += 100;
    await addRefreshJob(record.patient_id, record.study_id, 1, delay);
  }

  console.log(`✅ ${pending.length} initial jobs queued.`);
})();

const EHR_BASE_LATENCY: Record<string, number> = {
  epic: 800,
  cerner: 1200,
  athena: 500,
};

app.get('/mock/:ehr/:patientId', async (req, res) => {
  const { ehr, patientId } = req.params;
  const base = EHR_BASE_LATENCY[ehr] || 1000;
  const variance = Math.random() * 1000;
  const totalTime = base + variance;

  console.log(`[Mock ${ehr}] Simulating API call for patient ${patientId} (${totalTime.toFixed(0)}ms)`);
  
  // Simulate network latency
  await sleep(totalTime);

  // Simulate a successful response (with a small chance of failure for realism)
  if (Math.random() < 0.05) { // 5% chance of simulated failure
    console.log(`[Mock ${ehr}] ❌ Simulated failure for patient ${patientId}`);
    return res.status(500).json({ error: 'Simulated EHR internal error' });
  }

  res.status(200).json({
    status: 'success',
    ehr,
    patientId,
    simulatedTime: totalTime,
    message: 'Data retrieved successfully',
    data: {
      patient: patientId,
      records: [
        { type: 'Observation', count: Math.floor(Math.random() * 100) },
        { type: 'Condition', count: Math.floor(Math.random() * 20) },
      ],
    },
  });
});

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