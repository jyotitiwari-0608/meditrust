import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { connectDB, disconnectDB } from '../config/db.js';
import { parseComposition, parsePrice } from '../utils/parsers.js';
import {
  findOrCreateManufacturer,
  upsertBrand,
  upsertDrug,
  upsertProduct,
} from '../utils/upserts.js';
import { isMain } from '../utils/isMain.js';

const SOURCE_URL =
  process.env.INDIAN_MEDS_SOURCE_URL ??
  'https://www.kaggle.com/datasets';

function normalizeHeaders(record) {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key.trim().toLowerCase(),
      typeof value === 'string' ? value.trim() : value,
    ])
  );
}

function pick(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== '') return row[key];
  }
  return '';
}

export async function ingestIndianMeds(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const records = parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }).map(normalizeHeaders);

  const source = {
    sourceName: 'Kaggle Indian medicines dataset',
    sourceUrl: SOURCE_URL,
    sourceDate: fs.statSync(filePath).mtime,
  };

  const counts = {
    rows: records.length,
    skippedNotPilot: 0,
    skippedMissingPrice: 0,
    products: 0,
  };

  for (const row of records) {
    const brandName = pick(row, [
      'brand',
      'brand name',
      'medicine name',
      'name',
      'trade name',
    ]);
    const composition = pick(row, [
      'composition',
      'generic',
      'salt',
      'content',
    ]);
    const manufacturerName = pick(row, [
      'manufacturer',
      'company',
      'marketer',
      'mfg',
    ]);
    const price = parsePrice(
      pick(row, ['price', 'mrp', 'price (inr)', 'price_inr'])
    );

    const parsed = parseComposition(composition, {
      strength: pick(row, ['strength', 'dosage']),
      form: pick(row, ['form', 'dosage form', 'type']),
    });

    if (!parsed) {
      counts.skippedNotPilot += 1;
      continue;
    }

    if (price === null) {
      counts.skippedMissingPrice += 1;
      continue;
    }

    const strength = parsed.strength ?? 'Unspecified';
    const form = parsed.form ?? 'Unspecified';
    const manufacturer = await findOrCreateManufacturer(manufacturerName, {
      country: 'India',
      regulatoryTier: 'Unrated',
    });
    if (!manufacturer) continue;

    const drug = await upsertDrug({
      salt: parsed.salt,
      strength,
      form,
      atcCode: parsed.atcCode,
    });

    const brand = await upsertBrand({
      name: brandName || `${parsed.salt} ${strength}`,
      manufacturer: manufacturer._id,
      drug: drug._id,
      source,
    });

    await upsertProduct({
      drug: drug._id,
      manufacturer: manufacturer._id,
      brand: brand._id,
      mrp: price,
      teCode: undefined,
      source,
    });

    counts.products += 1;
  }

  return counts;
}

async function main() {
  const filePath = process.env.INDIAN_MEDS_CSV;
  if (!filePath) {
    throw new Error(
      'INDIAN_MEDS_CSV is not set. Point it to the Kaggle Indian medicines CSV file.'
    );
  }

  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Indian medicines CSV not found: ${resolved}`);
  }

  await connectDB();
  const counts = await ingestIndianMeds(resolved);
  console.log('Indian medicines ingestion complete:');
  console.log(`  rows:                 ${counts.rows}`);
  console.log(`  products upserted:    ${counts.products}`);
  console.log(`  skipped (not pilot):  ${counts.skippedNotPilot}`);
  console.log(`  skipped (no price):   ${counts.skippedMissingPrice}`);
}

if (isMain(import.meta.url)) {
  main()
    .catch((error) => {
      console.error(`Indian medicines ingestion failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await disconnectDB();
    });
}
