import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { connectDB, disconnectDB } from '../config/db.js';
import { findPilotSalt } from '../utils/config.js';
import { parseForm } from '../utils/parsers.js';
import {
  findOrCreateManufacturer,
  upsertBrand,
  upsertDrug,
  upsertProduct,
} from '../utils/upserts.js';
import { isMain } from '../utils/isMain.js';

const ORANGE_BOOK_URL =
  process.env.ORANGE_BOOK_URL ??
  'https://www.fda.gov/drugs/drug-approvals-and-databases/orange-book-data-files';

function parseDelimited(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];

  const headers = lines[0].split('~').map((header) => header.trim().toLowerCase());
  const rows = [];

  for (const line of lines.slice(1)) {
    const values = line.split('~');
    const row = {};
    headers.forEach((header, index) => {
      row[header] = (values[index] ?? '').trim();
    });
    rows.push(row);
  }

  return rows;
}

function pick(row, keys) {
  for (const key of keys) {
    if (row[key]) return row[key];
  }
  return '';
}

function cleanForm(value) {
  const parsed = parseForm(value);
  if (parsed) return parsed;
  if (!value) return 'Unspecified';
  return value.split(';')[0].trim().toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export async function ingestOrangeBook(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const rows = parseDelimited(text);
  const source = {
    sourceName: 'FDA Orange Book',
    sourceUrl: ORANGE_BOOK_URL,
    sourceDate: fs.statSync(filePath).mtime,
  };

  const counts = {
    rows: rows.length,
    skippedNotPilot: 0,
    skippedDiscontinued: 0,
    products: 0,
  };

  for (const row of rows) {
    const ingredient = pick(row, ['ingredient', 'ingredients']);
    const pilot = findPilotSalt(ingredient);
    if (!pilot) {
      counts.skippedNotPilot += 1;
      continue;
    }

    const type = pick(row, ['type']).toUpperCase();
    if (type === 'DISCN') {
      counts.skippedDiscontinued += 1;
      continue;
    }

    const strength = pick(row, ['strength']) || 'Unspecified';
    const form = cleanForm(pick(row, ['df;route', 'dosage form;route']));
    const tradeName =
      pick(row, ['trade_name', 'trade name']) || `${pilot.salt} ${strength}`;
    const applicant = pick(row, [
      'applicant_full_name',
      'applicant full name',
      'applicant',
    ]);
    const teCode = pick(row, ['te_code', 'te code']);

    const manufacturer = await findOrCreateManufacturer(applicant, {
      country: 'United States',
      regulatoryTier: 'Tier 1',
    });
    if (!manufacturer) continue;

    const drug = await upsertDrug({
      salt: pilot.salt,
      strength,
      form,
      atcCode: pilot.atcCode,
    });

    const brand = await upsertBrand({
      name: tradeName,
      manufacturer: manufacturer._id,
      drug: drug._id,
      source,
    });

    await upsertProduct({
      drug: drug._id,
      manufacturer: manufacturer._id,
      brand: brand._id,
      mrp: 0,
      teCode,
      source,
    });

    counts.products += 1;
  }

  return counts;
}

async function main() {
  const filePath = process.env.ORANGE_BOOK_PATH;
  if (!filePath) {
    throw new Error(
      'ORANGE_BOOK_PATH is not set. Point it to the downloaded Orange Book products.txt file.'
    );
  }

  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Orange Book file not found: ${resolved}`);
  }

  await connectDB();
  const counts = await ingestOrangeBook(resolved);
  console.log('Orange Book ingestion complete:');
  console.log(`  rows:                 ${counts.rows}`);
  console.log(`  products upserted:    ${counts.products}`);
  console.log(`  skipped (not pilot):  ${counts.skippedNotPilot}`);
  console.log(`  skipped (discontinued): ${counts.skippedDiscontinued}`);
  console.log('  note: Orange Book has no price, so mrp is stored as 0 (unavailable).');
}

if (isMain(import.meta.url)) {
  main()
    .catch((error) => {
      console.error(`Orange Book ingestion failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await disconnectDB();
    });
}
