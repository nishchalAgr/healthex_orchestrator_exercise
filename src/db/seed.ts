import { createPatientStudy } from './db.ts';

function getSeedCount(): number {
  const arg = parseInt(process.argv[2], 10);
  console.log(`Seed count: ${arg}`);
  if (!isNaN(arg) && arg > 0) return arg;

  return 10;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Returns a random subset of EHRs (1 to 3)
function randomEhrs(): string[] {
  const allEhrs = ['epic', 'cerner', 'athena'];
  const count = randomInt(1, allEhrs.length); // 1, 2, or 3
  const shuffled = [...allEhrs].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

async function seedDatabase(count: number) {
  console.log(`🌱 Seeding ${count} random patient–study records...`);

  const usedPairs = new Set<string>();

  for (let i = 0; i < count; i++) {
    let patientId: string;
    let studyId: string;
    let key: string;
    let attempts = 0;

    do {
      const patientNum = randomInt(1, count * 100);
      const studyNum = randomInt(1, count * 100);
      patientId = `patient_${patientNum}`;
      studyId = `study_${studyNum}`;
      key = `${patientId}|${studyId}`;
      attempts++;
      if (attempts > 1000) break;
    } while (usedPairs.has(key));

    if (usedPairs.has(key)) continue;

    usedPairs.add(key);

    const frequencySeconds = randomInt(20, 120); // 20 sec – 2 min
    const dataSources = randomEhrs(); // e.g., ['epic', 'cerner']

    createPatientStudy(patientId, studyId, frequencySeconds, dataSources);
  }

  console.log(`✅ Seeded ${usedPairs.size} unique patient–study pairs.`);
  console.log(`   Frequencies: 20–120s. Data sources: random subsets of epic/cerner/athena.`);
}


const count = getSeedCount();
seedDatabase(count)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seeding failed:', err);
    process.exit(1);
  });
