import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PDFParse } from 'pdf-parse';
import { connectDB, disconnectDB } from '../config/db.js';
import { Drug, Manufacturer, Product } from '../models/index.js';
import { findPilotSalt } from '../utils/config.js';
import { fuzzyManufacturerMatch } from '../utils/fuzzy.js';
import { parseComposition, splitNsqRows } from '../utils/parsers.js';
import { upsertSignal } from '../utils/upserts.js';
import { isMain } from '../utils/isMain.js';

const CDSCO_URL =
  process.env.CDSCO_NSQ_URL ??
  'https://cdsco.gov.in/opencms/opencms/en/Reports/NSQ-Drugs/';

function dateFromFilename(filename, fallback) {
  const match = filename.match(/(20\d{2})[-_]?(\d{2})(?:[-_]?(\d{2}))?/);
  if (!match) return fallback;

  const [, year, month, day] = match;
  const date = new Date(
    Date.UTC(Number(year), Number(month) - 1, day ? Number(day) : 1)
  );
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function externalIdFor(filename, row) {
  const hash = crypto
    .createHash('sha1')
    .update(`${filename}|${row.batch}|${row.rawText}`)
    .digest('hex')
    .slice(0, 16);
  return `cdsco:${filename}:${hash}`;
}

async function extractPdfText(filePath) {
  const buffer = fs.readFileSync(filePath);
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text ?? '';
  } finally {
    await parser.destroy();
  }
}

export async function ingestCdscoNsq(directory) {
  const files = fs
    .readdirSync(directory)
    .filter((file) => file.toLowerCase().endsWith('.pdf'))
    .sort();

  const manufacturers = await Manufacturer.find({}).lean();
  const counts = {
    files: files.length,
    rows: 0,
    signals: 0,
    unmatched: 0,
  };

  for (const filename of files) {
    const filePath = path.join(directory, filename);
    const text = await extractPdfText(filePath);
    const date = dateFromFilename(filename, fs.statSync(filePath).mtime);
    const rows = splitNsqRows(text);

    for (const row of rows) {
      counts.rows += 1;

      const match = fuzzyManufacturerMatch(row.manufacturer, manufacturers, 0.55);
      const manufacturer = match ? match.manufacturer : null;
      if (!manufacturer) counts.unmatched += 1;

      const pilot =
        findPilotSalt(row.drug) ?? parseComposition(row.drug)?.pilot ?? null;
      let product = null;

      if (pilot && manufacturer) {
        const drug = await Drug.findOne({ salt: pilot.salt }).lean();
        if (drug) {
          product = await Product.findOne({
            drug: drug._id,
            manufacturer: manufacturer._id,
          }).lean();
        }
      }

      await upsertSignal({
        externalId: externalIdFor(filename, row),
        product: product?._id ?? null,
        manufacturer: manufacturer?._id ?? null,
        type: 'NSQ',
        date,
        severity: 'HIGH',
        sourceName: 'CDSCO NSQ alert',
        sourceUrl: CDSCO_URL,
        rawText: `${row.rawText}\nDrug: ${row.drug ?? 'Unknown'}\nBatch: ${row.batch}\nReason: ${row.reason ?? 'Unknown'}`,
        needsReview: !manufacturer,
        reviewReason: manufacturer
          ? undefined
          : 'Manufacturer could not be matched to a known record',
      });

      counts.signals += 1;
    }
  }

  return counts;
}

async function main() {
  const directory = path.resolve(
    process.env.DATA_RAW_DIR ?? path.join(process.cwd(), '..', 'data', 'raw')
  );

  if (!fs.existsSync(directory)) {
    throw new Error(
      `Raw data directory not found: ${directory}. Set DATA_RAW_DIR to the folder containing CDSCO PDFs.`
    );
  }

  await connectDB();
  const counts = await ingestCdscoNsq(directory);
  console.log('CDSCO NSQ ingestion complete:');
  console.log(`  PDF files:            ${counts.files}`);
  console.log(`  rows parsed:          ${counts.rows}`);
  console.log(`  signals upserted:     ${counts.signals}`);
  console.log(`  unmatched (review):   ${counts.unmatched}`);
}

if (isMain(import.meta.url)) {
  main()
    .catch((error) => {
      console.error(`CDSCO NSQ ingestion failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await disconnectDB();
    });
}
