import { Worker } from 'bullmq';
import { connection, addRefreshJob, queueName } from './queue.ts';
import { getPatientStudy, updateStatus } from './db/db.ts';
import { sleep } from './utils.ts';

// Base latency (ms) for each EHR API call
const EHR_BASE_LATENCY: Record<string, number> = {
  epic: 800,
  cerner: 1200,
  athena: 500,
};

export function createWorker(workerId: number) {
  return new Worker(
    queueName,
    async (job) => {
      const { patientId, studyId } = job.data;
      console.log(`[Worker ${workerId}] Starting job: patient=${patientId}, study=${studyId}`);

      // --- Step 1: Mark status as REFRESH_STARTED ---
      await updateStatus(patientId, studyId, 'IN_PROGRESS');
      console.log(`[Worker ${workerId}] Status -> IN_PROGRESS`);

      // --- Fetch the study to get data_sources ---
      const study = await getPatientStudy(patientId, studyId);
      if (!study) {
        console.error(`[Worker ${workerId}] Study ${studyId} not found for patient ${patientId}`);
        await updateStatus(patientId, studyId, 'FAILED');
        return;
      }

      // Parse the JSON array of EHRs
      let ehrs: string[] = [];
      try {
        ehrs = study.data_sources ? JSON.parse(study.data_sources) : [];
      } catch (e) {
        console.error(`[Worker ${workerId}] Failed to parse data_sources: ${study.data_sources}`);
        await updateStatus(patientId, studyId, 'FAILED');
        return;
      }

      if (ehrs.length === 0) {
        console.warn(`[Worker ${workerId}] No EHRs configured for ${patientId}/${studyId}. Marking DONE.`);
        const now = new Date().toISOString();
        await updateStatus(patientId, studyId, 'DONE', now);
        // Still schedule next run
        await scheduleNextRun(patientId, studyId, study.frequency_seconds, workerId);
        return;
      }

      console.log(`[Worker ${workerId}] EHRs to call: ${ehrs.join(', ')}`);

      // --- Step 2: Fetch info from EACH EHR concurrently ---
      const ehrCalls = ehrs.map(async (ehr) => {
        const base = EHR_BASE_LATENCY[ehr] || 1000; // fallback to 1s
        const variance = Math.random() * 1000; // 0–1000ms random variance
        const totalTime = base + variance;

        // Simulate the network call
        await sleep(totalTime);

        // Simulated successful response
        console.log(
          `[Worker ${workerId}]   ✅ ${ehr} call completed in ${totalTime.toFixed(0)}ms ` +
          `(base ${base}ms + variance ${variance.toFixed(0)}ms)`
        );

        return { ehr, time: totalTime };
      });

      // Run all EHR calls concurrently – use allSettled so one failure doesn't block others
      const results = await Promise.allSettled(ehrCalls);

      // Check if any failed (though our simulation always resolves, this is future-proof)
      const failed = results.filter(r => r.status === 'rejected');
      if (failed.length > 0) {
        console.error(`[Worker ${workerId}] ⚠️ ${failed.length} EHR call(s) failed.`);
        // In a real system, you might mark as FAILED or retry. For now, we log but still proceed.
      }

      // --- Step 3: Mark status as REFRESH_DONE and update timestamp ---
      const now = new Date().toISOString();
      await updateStatus(patientId, studyId, 'DONE', now);
      console.log(`[Worker ${workerId}] Status -> DONE at ${now} (${results.length} EHRs processed)`);

      // --- Schedule the next run for this patient-study ---
      await scheduleNextRun(patientId, studyId, study.frequency_seconds, workerId);
    },
    {
      connection,
      concurrency: 1, // Each worker handles one job at a time
    }
  );
}

// Helper to schedule the next run with jitter applied inside addRefreshJob
async function scheduleNextRun(
  patientId: string,
  studyId: string,
  frequencySeconds: number,
  workerId: number
) {
  const delayMs = frequencySeconds * 1000;
  await addRefreshJob(patientId, studyId, 1, delayMs);
  console.log(
    `[Worker ${workerId}] Scheduled next run for ${patientId}/${studyId} ` +
    `in ~${(delayMs / 1000).toFixed(1)}s (plus 5–15% jitter)`
  );
}