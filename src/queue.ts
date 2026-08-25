import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

export const queueName = 'refresh-queue';

// Create Redis connection using IORedis
export const connection = new Redis({
  host: 'localhost',
  port: 6379,
  maxRetriesPerRequest: null,
});

export const refreshQueue = new Queue(queueName, { connection });

export async function addRefreshJob(
  patientId: string,
  studyId: string,
  priority: number = 1,
  baseDelayMs?: number
) {
  let delay = baseDelayMs || 0;

  // Apply 0–15% jitter
  if (delay > 0) {
    const jitter = delay * Math.random() * 0.15;
    delay = Math.floor(delay + jitter);
  }

  console.log(`Adding new refresh job: ${patientId} , ${studyId}, scheduled to execute in ${delay}ms` );

  return await refreshQueue.add(
    'refresh',
    { patientId, studyId },
    { priority, delay }
  );
}