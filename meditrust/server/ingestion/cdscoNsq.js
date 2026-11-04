import mongoose from "mongoose";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { Signal } from "../models/Signal.js";
import { Manufacturer } from "../models/Manufacturer.js";
import pdfParse from "pdf-parse";
import { matchManufacturer } from "../utils/fuzzy.js";
import { saveReviewMatch } from "../utils/review.js";

dotenv.config();

const RAW_DIR = process.env.CDSCO_RAW_DIR || path.resolve("data/raw");
const NSQ_HIGH_KEYWORDS = ["spurious", "adulterated", "counterfeit", "fake"];

function severityFor(reason) {
  const r = (reason || "").toLowerCase();
  if (NSQ_HIGH_KEYWORDS.some((k) => r.includes(k))) return "high";
  return "medium";
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  let files;
  try {
    files = fs
      .readdirSync(RAW_DIR)
      .filter((f) => f.toLowerCase().endsWith(".pdf"))
      .sort();
  } catch (e) {
    console.log(`No CDSCO raw directory: ${RAW_DIR}`);
    await mongoose.disconnect();
    process.exit(0);
  }
  if (!files.length) {
    console.log("No CDSCO PDFs found in", RAW_DIR);
    await mongoose.disconnect();
    process.exit(0);
  }
  const manufacturers = await Manufacturer.find();
  let totalRows = 0,
    signals = 0,
    review = 0,
    ocrFiles = 0,
    aliases = 0;
  for (const file of files) {
    const filePath = path.join(RAW_DIR, file);
    let data;
    try {
      const dataBuffer = fs.readFileSync(filePath);
      data = await pdfParse(dataBuffer);
    } catch (e) {
      console.log(`PDF parse error for ${file}: ${e.message} — needs OCR/manual entry`);
      ocrFiles++;
      continue;
    }
    const text = data.text || "";
    if (!text.trim()) {
      console.log(`Empty text extracted from ${file} — needs OCR/manual entry`);
      ocrFiles++;
      continue;
    }
    const rows = text.split(/\n/).filter((l) => l.trim().length > 3);
    totalRows += rows.length;
    const operations = [];
    for (const row of rows) {
      const reason = row;
      const mfrResult = matchManufacturer(row, manufacturers);
      let manufacturerId = null;
      let matchStatus = mfrResult.status;
      let matchedVia = null;
      if (mfrResult.match) {
        manufacturerId = mfrResult.match._id;
        matchedVia = "fuzzy";
        if (mfrResult.shouldStoreAlias) {
          const aliases = mfrResult.match.aliases || [];
          if (!aliases.includes(row.trim())) {
            await Manufacturer.findByIdAndUpdate(mfrResult.match._id, {
              $addToSet: { aliases: row.trim() },
            });
            aliases++;
          }
        }
      } else if (mfrResult.shouldReview) {
        saveReviewMatch({
          incomingName: row.trim(),
          bestMatchName: mfrResult.match ? mfrResult.match.name : null,
          score: mfrResult.score,
          source: "CDSCO",
        });
        review++;
      }
      operations.push({
        updateOne: {
          filter: { sourceUrl: file, rawText: row.trim() },
          update: {
            $set: {
              type: "NSQ",
              date: new Date(),
              severity: severityFor(reason),
              raw_classification: null,
              sourceName: "CDSCO",
              sourceUrl: file,
              rawText: row.trim(),
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
      await Signal.bulkWrite(operations, { ordered: false });
    }
    console.log(`Processed ${file}: ${rows.length} rows`);
  }
  console.log(
    `CDSCO NSQ: totalRows=${totalRows} signals=${signals} review=${review} aliases=${aliases}`
  );
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
