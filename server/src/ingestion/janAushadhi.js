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

const SOURCE_URL = process.env.JAN_AUSHADHI_SOURCE_URL ?? 'https://janaushadhi.gov.in/';

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

export async function ingestJanAushadhi(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const records = parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }).map(normalizeHeaders);

  const source = {
    sourceName: 'Jan Aushadhi (PMBJP) price list',
    sourceUrl: SOURCE_URL,
    sourceDate: fs.statSync(filePath).mtime,
  };

  const manufacturer = await findOrCreateManufacturer('Jan Aushadhi (PMBJP)', {
    aliases: ['Pradhan Mantri Bhartiya Janaushadhi Pariyojana', 'PMBJP'],
    country: 'India',
    regulatoryTier: 'Tier 2',
  });

  const counts = {
    rows: records.length,
    skippedNotPilot: 0,
    skippedMissingPrice: 0,
    products: 0,
  };

  for (const row of records) {
    const medicineName = pick(row, [
      'medicine name',
      'name of medicine',
      'brand',
      'product name',
      'name',
    ]);
    const composition = pick(row, ['composition', 'salt', 'generic name', 'content']);
    const strength = pick(row, ['strength', 'dosage']);
    const form = pick(row, ['form', 'dosage form', 'type']);
    const price = parsePrice(pick(row, ['mrp', 'price', 'price (inr)', 'price_inr']));

    const parsed = parseComposition(composition || medicineName, {
      strength,
      form,
    });

    if (!parsed) {
      counts.skippedNotPilot += 1;
      continue;
    }

    if (price === null) {
      counts.skippedMissingPrice += 1;
      continue;
    }

    const resolvedStrength = parsed.strength ?? strength ?? 'Unspecified';
    const resolvedForm = parsed.form ?? form ?? 'Unspecified';

    const drug = await upsertDrug({
      salt: parsed.salt,
      strength: resolvedStrength,
      form: resolvedForm,
      atcCode: parsed.atcCode,
    });

    const brand = await upsertBrand({
      name: medicineName || `${parsed.salt} ${resolvedStrength}`,
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
  const filePath = process.env.JAN_AUSHADHI_CSV;
  if (!filePath) {
    throw new Error(
      'JAN_AUSHADHI_CSV is not set. Point it to the Jan Aushadhi price list CSV file.'
    );
  }

  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Jan Aushadhi CSV not found: ${resolved}`);
  }

  await connectDB();
  const counts = await ingestJanAushadhi(resolved);
  console.log('Jan Aushadhi ingestion complete:');
  console.log(`  rows:                 ${counts.rows}`);
  console.log(`  products upserted:    ${counts.products}`);
  console.log(`  skipped (not pilot):  ${counts.skippedNotPilot}`);
  console.log(`  skipped (no price):   ${counts.skippedMissingPrice}`);
}

if (isMain(import.meta.url)) {
  main()
    .catch((error) => {
      console.error(`Jan Aushadhi ingestion failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await disconnectDB();
    });
}
