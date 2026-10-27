import 'dotenv/config';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { Manufacturer } from '../src/models/index.js';
import { scoreManufacturer } from '../src/services/scoring.js';
import { loadReference } from '../src/utils/config.js';
import { normalizeName } from '../src/utils/normalize.js';
import { fuzzyManufacturerMatch } from '../src/utils/fuzzy.js';
import { isMain } from '../src/utils/isMain.js';

export async function calibrateScoring() {
  const reference = loadReference();
  const manufacturers = await Manufacturer.find({}).lean();
  const rows = [];

  for (const entry of reference.manufacturers) {
    const target = normalizeName(entry.name);
    let manufacturer = manufacturers.find(
      (item) =>
        normalizeName(item.name) === target ||
        (item.aliases ?? []).some((alias) => normalizeName(alias) === target)
    );

    if (!manufacturer) {
      const match = fuzzyManufacturerMatch(entry.name, manufacturers, 0.6);
      manufacturer = match?.manufacturer ?? null;
    }

    if (!manufacturer) {
      rows.push({
        name: entry.name,
        expected: entry.expectedScore,
        computed: null,
        delta: null,
        expectedBand: entry.expectedBand,
        computedBand: null,
        coldStart: null,
      });
      continue;
    }

    const result = await scoreManufacturer(manufacturer._id);
    rows.push({
      name: entry.name,
      expected: entry.expectedScore,
      computed: result.score,
      delta: Number((result.score - entry.expectedScore).toFixed(2)),
      expectedBand: entry.expectedBand,
      computedBand: result.band,
      coldStart: result.coldStart,
    });
  }

  const scored = rows.filter((row) => row.computed !== null);
  const meanAbsoluteError = scored.length
    ? Number(
        (
          scored.reduce((sum, row) => sum + Math.abs(row.delta), 0) /
          scored.length
        ).toFixed(2)
      )
    : null;

  return { rows, meanAbsoluteError, found: scored.length, total: rows.length };
}

async function main() {
  await connectDB();
  const result = await calibrateScoring();

  console.log('Scoring calibration (expected vs computed):');
  console.table(result.rows);
  console.log(
    `Found ${result.found}/${result.total} reference manufacturers in the database.`
  );
  console.log(
    `Mean absolute error: ${result.meanAbsoluteError ?? 'n/a'} (small sample; directional only).`
  );
}

if (isMain(import.meta.url)) {
  main()
    .catch((error) => {
      console.error(`Calibration failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await disconnectDB();
    });
}
