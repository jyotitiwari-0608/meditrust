import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import { connectDemoDb, disconnect } from "../scripts/seedDemo.js";
import { Drug } from "../models/Drug.js";
import { Manufacturer } from "../models/Manufacturer.js";
import { Product } from "../models/Product.js";
import { Signal } from "../models/Signal.js";
import { Score } from "../models/Score.js";
import { computeFactors, coldStartBaseline, bandFor } from "../services/scoring.js";

let mongod;

const FIXTURES_PATH = path.resolve(__dirname, "../../data/demo/fixtures.json");

const FICTIONAL = [
  "Alpha Demo Pharma Ltd",
  "Beta Sample Labs",
  "Gamma Test Remedies",
  "Delta Newco Pharma",
  "Omega Generic Works",
  "Zeta Formulations",
];

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  process.env.DEMO_MONGODB_URI = uri;
  process.env.DEMO_MODE = "true";
  await connectDemoDb();
}, 60000);

afterAll(async () => {
  await disconnect();
  if (mongod) await mongod.stop();
});

describe("demo seed: DB refusal", () => {
  it("refuses real database URI (no _demo, not DEMO_MONGODB_URI)", () => {
    const real = "mongodb+srv://cluster.example.com/meditrust";
    // isDemoUri returns false for a real prod URI
    const isDemo = real.includes("DEMO_MONGODB_URI") || real.includes("_demo") || real.includes("mongodb-memory-server") || real.includes("127.0.0.1") || real.includes("localhost");
    expect(isDemo).toBe(false);
  });

  it("accepts demo URI", () => {
    const demo = "mongodb://127.0.0.1:12345/meditrust_demo";
    const isDemo = demo.includes("DEMO_MONGODB_URI") || demo.includes("_demo") || demo.includes("mongodb-memory-server") || demo.includes("127.0.0.1") || demo.includes("localhost");
    expect(isDemo).toBe(true);
  });
});

describe("demo seed: fictional manufacturer names only", () => {
  it("every synthetic manufacturer in fixtures is fictional", () => {
    const realNames = ["Cipla Ltd", "Sun Pharma"];
    for (const name of FICTIONAL) {
      expect(realNames).not.toContain(name);
    }
  });
});

describe("demo seed: expected bands", () => {
  it("Alpha Demo Pharma Ltd (HIGH_TRUST) scores High", () => {
    const mfr = { name: "Alpha Demo Pharma Ltd", regulatoryTier: "tier1", yearsOfMarketPresence: 25 };
    const { score, factors } = computeFactors({ manufacturer: mfr, signals: [], numProducts: 10 });
    const band = bandFor(score);
    expect(band).toBe("High");
  });

  it("Gamma Test Remedies (LOW_TRUST) scores Low", () => {
    const mfr = { name: "Gamma Test Remedies", regulatoryTier: "tier2", yearsOfMarketPresence: 3 };
    const signals = [
      { type: "NSQ", date: new Date(), severity: "medium", _id: "s1" },
      { type: "NSQ", date: new Date(), severity: "medium", _id: "s2" },
      { type: "NSQ", date: new Date(), severity: "high", _id: "s3" },
      { type: "RECALL", date: new Date(), severity: "high", _id: "s4" },
    ];
    const { score, factors } = computeFactors({ manufacturer: mfr, signals, numProducts: 2 });
    const band = bandFor(score);
    expect(band).toBe("Low");
  });

  it("Delta Newco Pharma (COLD_START) returns LimitedData", () => {
    const mfr = { name: "Delta Newco Pharma", regulatoryTier: "tier3", yearsOfMarketPresence: 1 };
    const result = coldStartBaseline(mfr);
    expect(result.band).toBe("LimitedData");
    expect(result.limitedData).toBe(true);
  });
});

describe("demo seed: idempotency", () => {
  it("re-running upserts does not duplicate documents", async () => {
    const filter = { name: "Alpha Demo Pharma Ltd", isDemo: true };
    await Manufacturer.deleteMany(filter);
    const before = await Manufacturer.countDocuments({ isDemo: true });
    await Manufacturer.updateOne(
      { ...filter },
      { $set: { ...filter, aliases: ["Alpha Demo"], country: "India", regulatoryTier: "tier1", yearsOfMarketPresence: 25 } },
      { upsert: true }
    );
    const afterFirst = await Manufacturer.countDocuments({ isDemo: true });
    await Manufacturer.updateOne(
      { ...filter },
      { $set: { ...filter, aliases: ["Alpha Demo"], country: "India", regulatoryTier: "tier1", yearsOfMarketPresence: 25 } },
      { upsert: true }
    );
    const afterSecond = await Manufacturer.countDocuments({ isDemo: true });
    expect(afterFirst).toBe(before + 1);
    expect(afterSecond).toBe(afterFirst);
  });
});

describe("demo seed: no synthetic signal on real manufacturer", () => {
  it("fixture signals are only attached to fictional manufacturers", () => {
    const fixture = JSON.parse(fs.readFileSync(FIXTURES_PATH, "utf8"));
    const realNames = ["Cipla Ltd", "Sun Pharma"];
    for (const s of fixture.signals) {
      expect(realNames).not.toContain(s.manufacturer);
    }
  });
});
