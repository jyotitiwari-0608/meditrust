import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { normalizeComposition } from "../utils/normalize.js";
import { matchManufacturer } from "../utils/fuzzy.js";
import { computeFactors, coldStartBaseline, bandFor } from "../services/scoring.js";
import { Drug } from "../models/Drug.js";
import { Manufacturer } from "../models/Manufacturer.js";
import { Product } from "../models/Product.js";
import { Brand } from "../models/Brand.js";
import { Signal } from "../models/Signal.js";
import { Score } from "../models/Score.js";
import { Extraction } from "../models/Extraction.js";

dotenv.config();

const FIXTURES_PATH = path.resolve(__dirname, "../../data/demo/fixtures.json");
const CACHED_LLM_PATH = path.resolve(__dirname, "../../data/demo/llm-cached.json");
const NTI_PATH = path.resolve(__dirname, "../../data/demo/config/nti.json");

let mongoMemoryServer = null;

function isDemoUri(uri) {
  if (!uri) return true;
  return uri.includes("DEMO_MONGODB_URI") || uri.includes("_demo") || uri.includes("mongodb-memory-server") || uri.includes("127.0.0.1") || uri.includes("localhost");
}

async function connectDemoDb() {
  const demoUri = process.env.DEMO_MONGODB_URI;
  const realUri = process.env.MONGODB_URI;

  if (demoUri) {
    if (!isDemoUri(demoUri)) {
      throw new Error("DEMO_MONGODB_URI points to a non-demo database. Refusing to run.");
    }
    await mongoose.connect(demoUri);
    console.log("Connected to DEMO_MONGODB_URI");
    return;
  }

  if (realUri && !isDemoUri(realUri)) {
    throw new Error(
      "MONGODB_URI points to the real database. Refusing to run seed:demo. Set DEMO_MONGODB_URI or let the script start an in-memory demo database."
    );
  }

  // Fall back to in-memory MongoDB (zero setup)
  mongoMemoryServer = await MongoMemoryServer.create();
  const uri = mongoMemoryServer.getUri();
  await mongoose.connect(uri);
  console.log("Connected to in-memory demo database:", uri);
}

async function disconnect() {
  await mongoose.disconnect();
  if (mongoMemoryServer) {
    await mongoMemoryServer.stop();
    mongoMemoryServer = null;
  }
}

function loadFixtures() {
  return JSON.parse(fs.readFileSync(FIXTURES_PATH, "utf8"));
}

function loadCachedLlm() {
  return JSON.parse(fs.readFileSync(CACHED_LLM_PATH, "utf8"));
}

async function resetDemo() {
  const isDemo = { isDemo: true };
  await Drug.deleteMany(isDemo);
  await Manufacturer.deleteMany(isDemo);
  await Product.deleteMany(isDemo);
  await Brand.deleteMany(isDemo);
  await Signal.deleteMany(isDemo);
  await Score.deleteMany(isDemo);
  await Extraction.deleteMany(isDemo);
  console.log("Demo collections reset.");
}

async function seedDrugs(fixture) {
  const drugMap = new Map();
  for (const d of fixture.drugs) {
    let drug = await Drug.findOne({ salt: d.salt, strength: d.strength, isDemo: true });
    if (!drug) {
      drug = await Drug.create({ ...d, isDemo: true });
    } else {
      await Drug.updateOne({ _id: drug._id }, { $set: { atcCode: d.atcCode, category: d.category } });
    }
    drugMap.set(`${d.salt}|${d.strength}`, drug);
  }
  return drugMap;
}

async function seedManufacturers(fixture) {
  const mfrMap = new Map();
  for (const m of fixture.manufacturers) {
    let mfr = await Manufacturer.findOne({ name: m.name, isDemo: true });
    if (!mfr) {
      mfr = await Manufacturer.create({ ...m, isDemo: true });
    } else {
      await Manufacturer.updateOne({ _id: mfr._id }, { $set: { aliases: m.aliases, country: m.country, regulatoryTier: m.regulatoryTier, yearsOfMarketPresence: m.yearsOfMarketPresence } });
    }
    mfrMap.set(m.name, mfr);
  }
  return mfrMap;
}

async function seedProducts(fixture, drugMap, mfrMap) {
  const productMap = new Map();
  for (const p of fixture.products) {
    const drug = drugMap.get(`${p.drugSalt}|${p.drugStrength}`);
    const mfr = mfrMap.get(p.manufacturer);
    if (!drug || !mfr) continue;
    const brandDoc = await Brand.findOneAndUpdate(
      { name: p.brand, manufacturer: mfr._id, isDemo: true },
      { name: p.brand, manufacturer: mfr._id, isDemo: true },
      { upsert: true, new: true }
    );
    const product = await Product.findOneAndUpdate(
      { drug: drug._id, manufacturer: mfr._id, isDemo: true },
      {
        $set: {
          brand: p.brand,
          mrp: p.mrp,
          teCode: p.teCode,
          source: p.source,
          isDemo: true,
        },
      },
      { upsert: true, new: true }
    );
    productMap.set(p.brand, { product, manufacturer: mfr, drug });
  }
  return productMap;
}

async function seedSignals(fixture, mfrMap) {
  const signalMap = new Map();
  for (const s of fixture.signals) {
    const mfr = mfrMap.get(s.manufacturer);
    const match = mfr ? { match: mfr, score: 1, manualReview: false } : { match: null, score: 0, manualReview: true };
    const filter = { sourceUrl: s.sourceUrl, rawText: s.rawText, isDemo: true };
    const update = {
      $set: {
        manufacturer: match.match ? match.match._id : null,
        type: s.type,
        date: new Date(s.date),
        severity: s.severity,
        sourceName: s.sourceName,
        sourceUrl: s.sourceUrl,
        rawText: s.rawText,
        matchedVia: match.match ? "fuzzy" : null,
        manualReview: match.manualReview,
        isDemo: true,
      },
    };
    const signal = await Signal.findOneAndUpdate(filter, update, { upsert: true, new: true });
    signalMap.set(s.rawText.slice(0, 40), signal);
  }
  return signalMap;
}

async function runSeedAll() {
  await connectDemoDb();
  await resetDemo();
  const fixture = loadFixtures();
  const drugMap = await seedDrugs(fixture);
  const mfrMap = await seedManufacturers(fixture);
  await seedProducts(fixture, drugMap, mfrMap);
  await seedSignals(fixture, mfrMap);
  console.log("Demo seed complete.");
  await disconnect();
}

async function runScoreAll() {
  await connectDemoDb();
  const mfrs = await Manufacturer.find({ isDemo: true });
  const products = await Product.find({ isDemo: true }).populate("manufacturer").lean();
  let scored = 0;
  for (const mfr of mfrs) {
    const signals = await Signal.find({ manufacturer: mfr._id, isDemo: true });
    const numProducts = await Product.countDocuments({ manufacturer: mfr._id, isDemo: true });
    let result;
    if (signals.length + numProducts < 5) {
      result = { ...coldStartBaseline(mfr), limitedData: true };
    } else {
      const { score, factors } = computeFactors({ manufacturer: mfr, signals, numProducts });
      result = { score, band: bandFor(score), factors, limitedData: false };
    }
    const prod = products.find((p) => p.manufacturer._id.toString() === mfr._id.toString());
    await Score.findOneAndUpdate(
      { manufacturer: mfr._id, product: prod ? prod._id : null, isDemo: true },
      {
        $set: {
          manufacturer: mfr._id,
          product: prod ? prod._id : null,
          value: result.score,
          band: result.band,
          factors: result.factors.map((f) => ({ name: f.name, value: f.value, weight: f.weight, contribution: f.contribution, evidence: f.evidence || [] })),
          limitedData: result.limitedData || false,
          isDemo: true,
        },
      },
      { upsert: true, new: true }
    );
    scored++;
  }
  console.log(`Scored ${scored} demo manufacturers.`);
  await disconnect();
}

async function runExtractAll() {
  await connectDemoDb();
  const fixture = loadFixtures();
  const cached = loadCachedLlm();
  const provider = process.env.LLM_PROVIDER || "none";
  const useCached = !process.env.GEMINI_API_KEY && !process.env.GROQ_API_KEY && !process.env.ANTHROPIC_API_KEY && provider !== "ollama";
  if (useCached) {
    console.log("LLM provider unavailable — using cached responses from /data/demo/llm-cached.json");
  }
  let extracted = 0;
  for (const snippet of fixture.rawTexts) {
    const signal = await Signal.findOne({ rawText: snippet.text, isDemo: true });
    if (!signal) continue;
    let out;
    if (useCached) {
      out = { signal: signal._id, json: cached[snippet.id], confidence: cached[snippet.id].confidence, needsReview: cached[snippet.id].needsReview, provider: "cached", isDemo: true };
    } else {
      const { extractSignal } = await import("../services/extraction.js");
      out = await extractSignal(snippet.text, { signalId: signal._id });
      out.isDemo = true;
    }
    await Extraction.findOneAndUpdate(
      { signal: signal._id, isDemo: true },
      { $set: { ...out, signal: signal._id, isDemo: true } },
      { upsert: true, new: true }
    );
    extracted++;
  }
  console.log(`Extracted ${extracted} demo snippets (${useCached ? "cached" : "live"} mode).`);
  await disconnect();
}

async function runReset() {
  await connectDemoDb();
  await resetDemo();
  await disconnect();
  console.log("Demo reset complete.");
}

const cmd = process.argv[2];

async function main() {
  try {
    if (cmd === "seed:demo" || cmd === "all") {
      await runSeedAll();
    } else if (cmd === "seed:demo:score" || cmd === "score") {
      await runScoreAll();
    } else if (cmd === "seed:demo:extract" || cmd === "extract") {
      await runExtractAll();
    } else if (cmd === "seed:demo:all" || cmd === "demo:all") {
      await runSeedAll();
      await runScoreAll();
      await runExtractAll();
      console.log("=== DEMO SEED ALL COMPLETE ===");
    } else if (cmd === "seed:demo:reset" || cmd === "reset") {
      const hasResetFlag = process.argv.includes("--reset");
      if (!hasResetFlag) {
        console.error("Use: npm run seed:demo:reset -- --reset");
        process.exit(1);
      }
      await runReset();
    } else {
      console.error("Usage: node scripts/seedDemo.js <seed:demo|seed:demo:score|seed:demo:extract|seed:demo:all|seed:demo:reset -- --reset>");
      process.exit(1);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

export { connectDemoDb, disconnect, resetDemo };

if (process.argv[1] && process.argv[1].endsWith("seedDemo.js")) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
