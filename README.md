# HealthEx Patient Data Refresh Orchestrator

A robust, scalable job orchestrator that schedules, prioritizes, and executes patient data refreshes across multiple EHR endpoints (Epic, Cerner, Athena). Built with Node.js, TypeScript, BullMQ, Redis, and SQLite.

---

## Quick Start (Docker)
### 1. Setup
First, clone the repository and then setup the env through docker
```
cd healthex_imp
docker compose up -d
docker compose exec app sh
```
### 2. Seed the DB
Before starting the orchestrator itself, we need to add test rows to the db. Included is a test script that randomly populates the DB. Here is an example command that adds 10 patient-study rows. 
```
npm run seed 10
```
### 3. Run and test the server
```
npm run dev
```
```
# Check status of all studies for a patient
curl 'http://localhost:3000/patients/:patient_id/data-retrieval/status'

# Trigger a manual refresh ([] means all studies)
curl -X POST 'http://localhost:3000/patients/:patient_id/updateData' \
  -H 'Content-Type: application/json' \
  -d '{"studies":[]}'
```
### 4. Other
The server can only be run after freshly seeding the db. In other words, run the cleanup script after you are done testing the server.
```
# Empty the db and redis cache
npm run cleanup
```
You can also add specific test cases in the seed script. Check `seed.ts` for an example
```
# Add data for test case 1
npm run seed t 1
```

## Design Summary - Key Design Decisions

| Feature | Implementation |
| :--- | :--- |
| **Deduplication** | `patient_source_refresh` prevents duplicate fetches for the same patient‑source within 1 minute. |
| **Concurrency Control** | Atomic `UPDATE ... WHERE status NOT IN ('IN_PROGRESS')` ensures only one worker claims a source. |
| **Retries** | Exponential backoff with jitter for transient failures. |
| **Thundering Herd Prevention** | Jitter (0-15%) added to scheduled delays. |
| **Priority** | Manual triggers (`priority=0`) preempt scheduled jobs (`priority=1`). |
| **Mock EHRs** | Simulated latencies and failure rates for testing. |

## Design Summary - Data flow


### 1. Job Creation

**Scheduled Jobs:**
- On server startup, all records with `status = 'PENDING'` are queued.
- Each job receives a random initial delay (0–2s) to spread load.
- After a job completes successfully, it reschedules itself using the study's `frequency_seconds` plus 5–15% jitter.

**Manual Jobs:**
- `POST /patients/:id/updateData` creates jobs with `priority=0` (highest).
- These are processed immediately, ahead of scheduled `priority=1` jobs.

### 2. Worker Processing
Currently, the server initializes with 10 workers. This can be adjusted in `index.js`

When a worker claims a job from the BullMQ queue:

1. **Status Update:** Sets `patient_studies.status = 'IN_PROGRESS'`.

2. **Source Check:** For each EHR in the patient‑study's `data_sources` array:
   - Checks `patient_source_refresh` for that patient + source.
   - If `status = 'IN_PROGRESS'`, skips (another worker is handling it).
   - If `last_refresh_at` is within 1 minute, skips (data is fresh enough). If job was manually requested, this check is ignored. 
   - Otherwise, atomically sets `status = 'IN_PROGRESS'` (locking the source).

3. **Fetch Data:** Makes concurrent HTTP `GET` requests to appropriate EHR endpoints for the job:
   - `GET /mock/epic/:patientId`
   - `GET /mock/cerner/:patientId`
   - `GET /mock/athena/:patientId`
   - Each call has base latency (Epic: 800ms, Cerner: 1200ms, Athena: 500ms) + random variance (0–1000ms).
   - 5% chance of simulated failure for realism.

4. **Retry Logic:** If an EHR call fails, it retries up to 5 times with exponential backoff:
   - Delay = `100 * 2^(attempt-1) + random(0–100)ms`
   - Retry on network errors, timeouts, and HTTP 5xx responses.

5. **Completion:**
   - **Success:** Updates `patient_source_refresh` with `status = 'COMPLETED'` and `last_refresh_at = NOW()`.
   - **Failure (after retries):** Sets `patient_source_refresh.status = 'FAILED'`.
   - Overall job status:
     - All sources succeeded → `patient_studies.status = 'SUCCESS'`
     - Any source failed → `patient_studies.status = 'EXTERNAL_API_ERROR'`

6. **Reschedule:** The worker schedules the next job based on the study's frequency (plus 15% jitter) and the job completes.

### 3. Status Polling

- `GET /patients/:id/data-retrieval/status` reads from `patient_studies` and returns the current status and `last_refresh_at` for each study.
---

## Design Summary - Data Schema

The system uses two SQLite tables to track patient‑study associations, job statuses, and per‑source refresh timestamps.

### `patient_studies`

Stores the configuration and overall status for each patient‑study pair.

| Column | Type | Description |
| :--- | :--- | :--- |
| `patient_id` | TEXT | Primary key|
| `study_id` | TEXT | Primary key |
| `frequency_seconds` | INTEGER | How often to refresh (e.g., 60 for 1 minute) |
| `status` | TEXT | Current job status: `PENDING`, `IN_PROGRESS`, `SUCCESS`, `EXTERNAL_API_ERROR`, `FAILED` |
| `last_refresh_at` | DATETIME | Timestamp of the last successful refresh (NULL if never) |
| `data_sources` | TEXT | JSON array of EHR names, e.g., `["epic","cerner"]` |
| `created_at` | DATETIME | Auto‑set on insert |

### `patient_source_refresh`

Tracks per‑patient, per‑source refresh state to prevent duplicate fetches.

| Column | Type | Description |
| :--- | :--- | :--- |
| `patient_id` | TEXT | Primary key |
| `data_source` | TEXT | Primary key, e.g., `"epic"`, `"cerner"`, `"athena"` |
| `last_refresh_at` | DATETIME | Timestamp of the last successful fetch for this source (NULL if never) |
| `status` | TEXT | Lock state: `PENDING`, `IN_PROGRESS`, `COMPLETED`, `FAILED` |

## Downsides and Potential Improvements
### Rate limits
Currently, the orchestrator does not explicitly take EHR rate limits into account. To solve this issue, we could modify the current design in such a way:
1. Using redis, create a token queue per EHR endpoint
2. Refill each queue at the rate limit for the given EHR endpoint. For example, if Athena has a rate limit of 30RPM, then the Athena queue can have at most 30 tokens and 1 token would be added every 2 seconds
3. Before making a request to an endpoint, the Worker will repeatedly try to remove a token from the queue until one is available. 



