import { Worker } from 'bullmq';
import { connection, addRefreshJob, queueName } from './queue.ts';
import { getPatientStudy, updateStatus } from './db/db.ts';
import type { PatientStudy } from './db/types.ts';
import { sleep } from './utils.ts';
import http from 'node:http';

// Base latency (ms) for each EHR API call
const EHR_BASE_LATENCY: Record<string, number> = {
  epic: 800,
  cerner: 1200,
  athena: 500,
};

async function callEhrMockWithRetry(
  ehr: string,
  patientId: string,
  maxRetries: number = 5
): Promise<{ ehr: string; time: number }> {
  let attempt = 0;
  let lastError: Error | null = null;

  while (attempt < maxRetries) {
    try {
      const result = await callEhrMockOnce(ehr, patientId);
      return result; // success
    } catch (err: any) {
      lastError = err;
      attempt++;
      if (attempt >= maxRetries) break;

      // Exponential backoff: 100ms * 2^(attempt-1) + jitter (0–100ms)
      const baseDelay = 100 * Math.pow(2, attempt - 1);
      const jitter = Math.random() * 100;
      const delay = baseDelay + jitter;
      console.log(`   🔄 Retry ${attempt}/${maxRetries} for ${ehr} in ${delay.toFixed(0)}ms`);
      await sleep(delay);
    }
  }

  // All retries exhausted
  throw new Error(`EHR ${ehr} failed after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`);
}

function callEhrMockOnce(ehr: string, patientId: string): Promise<{ ehr: string; time: number }> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const options = {
      hostname: 'localhost',
      port: 3000,
      path: `/mock/${ehr}/${patientId}`,
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      timeout: 5000,
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const elapsed = Date.now() - startTime;
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`   ✅ ${ehr} call completed in ${elapsed}ms (status: ${res.statusCode})`);
          resolve({ ehr, time: elapsed });
        } else {
          const errorMsg = `HTTP ${res.statusCode}: ${data}`;
          console.error(`   ❌ ${ehr} failed: ${errorMsg}`);
          reject(new Error(errorMsg));
        }
      });
    });

    req.on('error', (err) => {
      console.error(`   ❌ ${ehr} network error: ${err.message}`);
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy();
      console.error(`   ❌ ${ehr} timeout`);
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

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
      // Call each EHR with retry, concurrently
      const ehrCalls = ehrs.map((ehr) => callEhrMockWithRetry(ehr, patientId, 5));
      const results = await Promise.allSettled(ehrCalls);

      const succeeded = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      // Determine final status
      const now = new Date().toISOString();
      let finalStatus: PatientStudy['status'];
      if (failed === 0) {
        finalStatus = 'DONE';
      } else {
        finalStatus = 'FAILED';
        // Log each failure
        results.forEach((r, idx) => {
          if (r.status === 'rejected') {
            console.warn(`[Worker ${workerId}]   Final failure for ${ehrs[idx]}: ${r.reason.message}`);
          }
        });
      }

      await updateStatus(patientId, studyId, finalStatus, now);
      console.log(
        `[Worker ${workerId}] Status -> ${finalStatus} at ${now} ` +
        `(${succeeded} succeeded, ${failed} failed)`
      );

      // Schedule next run regardless
      await scheduleNextRun(patientId, studyId, study.frequency_seconds, workerId);
    },
    {
      connection,
      concurrency: 1,
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