import { Queue, createNodeRedisClient } from 'bullmq';
import { createClient } from 'redis';

const rawClient = createClient({
  url: 'redis://localhost:6379',
});

export const queueName = 'refresh-queue';
export const connection = createNodeRedisClient(rawClient);
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

  return refreshQueue.add(
    'refresh',
    { patientId, studyId },
    { priority, delay }
  );
}