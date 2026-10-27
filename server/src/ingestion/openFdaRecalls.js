import 'dotenv/config';
import axios from 'axios';
import { connectDB, disconnectDB } from '../config/db.js';
import { Drug, Manufacturer, Product } from '../models/index.js';
import { pilotEntries } from '../utils/config.js';
import { fuzzyManufacturerMatch } from '../utils/fuzzy.js';
import { upsertSignal } from '../utils/upserts.js';
import { isMain } from '../utils/isMain.js';

const BASE_URL = process.env.OPENFDA_BASE_URL ?? 'https://api.fda.gov';
const API_KEY = process.env.OPENFDA_API_KEY;
const PAGE_SIZE = Number(process.env.OPENFDA_PAGE_SIZE) || 100;
const MAX_PAGES = Number(process.env.OPENFDA_MAX_PAGES) || 3;
const RATE_LIMIT_MS = Number(process.env.OPENFDA_RATE_LIMIT_MS) || 300;
const MAX_RETRIES = 3;

const SEVERITY_BY_CLASS = {
  'class i': 'CRITICAL',
  'class ii': 'HIGH',
  'class iii': 'MEDIUM',
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseOpenFdaDate(value) {
  if (!value) return null;
  const cleaned = String(value).replace(/[^0-9]/g, '');
  if (cleaned.length !== 8) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const date = new Date(
    Date.UTC(
      Number(cleaned.slice(0, 4)),
      Number(cleaned.slice(4, 6)) - 1,
      Number(cleaned.slice(6, 8))
    )
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

async function fetchPage(search, skip) {
  const params = { search, limit: PAGE_SIZE, skip };
  if (API_KEY) params.api_key = API_KEY;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await axios.get(`${BASE_URL}/drug/enforcement.json`, {
        params,
        timeout: 20000,
      });
      return response.data;
    } catch (error) {
      const status = error.response?.status;
      if (status === 404) return { results: [], meta: { results: { total: 0 } } };
      if (status !== 429 && status < 500) throw error;

      const retryAfter = Number(error.response?.headers?.['retry-after']);
      const waitMs = Number.isFinite(retryAfter)
        ? retryAfter * 1000
        : Math.min(30000, 1000 * 2 ** attempt);
      console.warn(`openFDA ${status ?? 'error'}; backing off ${waitMs}ms`);
      await sleep(waitMs);
    }
  }

  throw new Error('openFDA request failed after retries');
}

export async function ingestOpenFdaRecalls() {
  const manufacturers = await Manufacturer.find({}).lean();
  const counts = {
    queries: 0,
    fetched: 0,
    signals: 0,
    unmatched: 0,
  };

  for (const pilot of pilotEntries()) {
    const search = `product_description:"${pilot.salt}"`;
    counts.queries += 1;

    const drug = await Drug.findOne({ salt: pilot.salt }).lean();

    for (let page = 0; page < MAX_PAGES; page += 1) {
      if (page > 0 || counts.queries > 1) await sleep(RATE_LIMIT_MS);

      const data = await fetchPage(search, page * PAGE_SIZE);
      const results = data?.results ?? [];
      counts.fetched += results.length;

      for (const recall of results) {
        const recallNumber = recall.recall_number;
        if (!recallNumber) continue;

        const match = fuzzyManufacturerMatch(
          recall.recalling_firm,
          manufacturers,
          0.55
        );
        const manufacturer = match ? match.manufacturer : null;
        if (!manufacturer) counts.unmatched += 1;

        let product = null;
        if (drug && manufacturer) {
          product = await Product.findOne({
            drug: drug._id,
            manufacturer: manufacturer._id,
          }).lean();
        }

        const classification = String(recall.classification ?? '').toLowerCase();
        const severity = SEVERITY_BY_CLASS[classification] ?? 'MEDIUM';
        const date =
          parseOpenFdaDate(recall.report_date) ??
          parseOpenFdaDate(recall.event_date) ??
          new Date();

        await upsertSignal({
          externalId: `openfda:${recallNumber}`,
          product: product?._id ?? null,
          manufacturer: manufacturer?._id ?? null,
          type: 'RECALL',
          date,
          severity,
          sourceName: 'openFDA drug enforcement',
          sourceUrl: `${BASE_URL}/drug/enforcement.json`,
          rawText: [
            recall.product_description,
            recall.reason_for_recall,
            recall.distribution_pattern,
          ]
            .filter(Boolean)
            .join(' | '),
          needsReview: !manufacturer,
          reviewReason: manufacturer
            ? undefined
            : 'Recalling firm could not be matched to a known manufacturer',
        });

        counts.signals += 1;
      }

      const total = data?.meta?.results?.total ?? 0;
      if (results.length < PAGE_SIZE || (page + 1) * PAGE_SIZE >= total) break;
    }
  }

  return counts;
}

async function main() {
  await connectDB();
  const counts = await ingestOpenFdaRecalls();
  console.log('openFDA recalls ingestion complete:');
  console.log(`  pilot queries:        ${counts.queries}`);
  console.log(`  recall records read:  ${counts.fetched}`);
  console.log(`  signals upserted:     ${counts.signals}`);
  console.log(`  unmatched (review):   ${counts.unmatched}`);
  console.log(
    `  rate limit: ${RATE_LIMIT_MS}ms between requests, max ${MAX_PAGES} page(s) per drug`
  );
}

if (isMain(import.meta.url)) {
  main()
    .catch((error) => {
      console.error(`openFDA ingestion failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await disconnectDB();
    });
}
