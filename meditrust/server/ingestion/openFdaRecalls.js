import mongoose from "mongoose";
import dotenv from "dotenv";
import axios from "axios";
import { Signal } from "../models/Signal.js";
import { Manufacturer } from "../models/Manufacturer.js";
import { matchManufacturer } from "../utils/fuzzy.js";
import { saveReviewMatch } from "../utils/review.js";

dotenv.config();

const BASE = "https://api.fda.gov/drug/enforcement.json";
const LIMIT = 100;
const PILOT_DRUGS = ["amlodipine", "telmisartan", "losartan", "metformin"];
const RATE_MS = 250;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function mapSeverity(classification) {
  if (!classification) return "low";
  const c = String(classification).trim().toLowerCase();
  if (c === "class i" || c === "i") return "high";
  if (c === "class ii" || c === "ii") return "medium";
  if (c === "class iii" || c === "iii") return "low";
  return "low";
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const manufacturers = await Manufacturer.find();
  let totalFetched = 0,
    signals = 0,
    errors = 0,
    review = 0,
    aliases = 0;
  for (const drug of PILOT_DRUGS) {
    let skip = 0;
    let fetchedAny = true;
    while (fetchedAny) {
      fetchedAny = false;
      const url = `${BASE}?search=products.active_ingredient:"${drug}"&limit=${LIMIT}&skip=${skip}`;
      try {
        const res = await axios.get(url, { timeout: 30000 });
        const results = res.data.results || [];
        if (!results.length) break;
        fetchedAny = true;
        totalFetched += results.length;
        const operations = [];
        for (const rec of results) {
          const date = new Date(rec.recall_initiation_date || rec.report_date || Date.now());
          const mfrResult = matchManufacturer(rec.recalling_firm || "", manufacturers);
          const classification = rec.classification || "";
          const severity = mapSeverity(classification);
          let manufacturerId = null;
          let matchStatus = mfrResult.status;
          let matchedVia = null;
          if (mfrResult.match) {
            manufacturerId = mfrResult.match._id;
            matchedVia = "fuzzy";
            if (mfrResult.shouldStoreAlias) {
              const existingAliases = mfrResult.match.aliases || [];
              const incoming = rec.recalling_firm || "";
              if (!existingAliases.includes(incoming)) {
                await Manufacturer.findByIdAndUpdate(mfrResult.match._id, {
                  $addToSet: { aliases: incoming },
                });
                aliases++;
              }
            }
          } else if (mfrResult.shouldReview) {
            saveReviewMatch({
              incomingName: rec.recalling_firm || "",
              bestMatchName: null,
              score: mfrResult.score,
              source: "openFDA",
            });
            review++;
          }
          operations.push({
            updateOne: {
              filter: {
                sourceUrl: url,
                rawText: `${rec.product_description || ""} | ${rec.recalling_firm || ""} | ${rec.reason_for_recall || ""}`,
              },
              update: {
                $set: {
                  type: "RECALL",
                  date,
                  severity,
                  raw_classification: classification,
                  sourceName: "openFDA",
                  sourceUrl: url,
                  rawText: `${rec.product_description || ""} | ${rec.recalling_firm || ""} | ${rec.reason_for_recall || ""}`,
                  manufacturer: manufacturerId,
                  matchedVia,
                  matchStatus,
                  manualReview: mfrResult.shouldReview,
                },
              },
              upsert: true,
            },
          });
          signals++;
        }
        if (operations.length) {
          const result = await Signal.bulkWrite(operations, { ordered: false });
          errors += (result.writeErrors || []).length;
        }
        skip += LIMIT;
        await sleep(RATE_MS);
      } catch (e) {
        if (e.response && e.response.status === 404) break;
        console.error(`openFDA error for ${drug}:`, e.message);
        errors++;
        break;
      }
    }
    console.log(`openFDA ${drug}: done`);
  }
  console.log(`openFDA recalls: totalFetched=${totalFetched} signals=${signals} review=${review} aliases=${aliases} errors=${errors}`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
