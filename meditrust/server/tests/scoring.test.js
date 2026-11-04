import fs from "fs";
import { describe, it, expect } from "vitest";
import { computeFactors, coldStartBaseline, bandFor, factorWeights } from "../services/scoring.js";

const tier1 = { name: "Cipla", regulatoryTier: "tier1", yearsOfMarketPresence: 40 };
const tier2 = { name: "SmallCo", regulatoryTier: "tier2", yearsOfMarketPresence: 5 };
const tier3 = { name: "TinyCo", regulatoryTier: "tier3", yearsOfMarketPresence: 1 };

describe("bandFor", () => {
  it("maps score bands per spec (High>=75, Moderate 50-74, Low<50)", () => {
    expect(bandFor(90)).toBe("High");
    expect(bandFor(75)).toBe("High");
    expect(bandFor(74)).toBe("Moderate");
    expect(bandFor(60)).toBe("Moderate");
    expect(bandFor(50)).toBe("Moderate");
    expect(bandFor(49)).toBe("Low");
    expect(bandFor(20)).toBe("Low");
  });
});

describe("computeFactors", () => {
  it("clean tier1 manufacturer gets High band", () => {
    const { score, band, factors, version, computedAt } = computeFactors({
      manufacturer: tier1,
      signals: [],
      numProducts: 10,
      teCode: "A",
    });
    expect(score).toBeGreaterThanOrEqual(75);
    expect(band).toBe("High");
    expect(factors).toHaveLength(6);
    expect(version).toBe("rules-v1");
    expect(computedAt).toBeDefined();
    const totalWeight = Object.values(factorWeights).reduce((a, b) => a + b, 0);
    const sum = factors.reduce((a, f) => a + f.contribution, 0);
    expect(Math.round(sum)).toBe(score);
  });

  it("TE code A=1.0, B=0.3, none=0 in approval factor", () => {
    const a = computeFactors({ manufacturer: tier2, signals: [], numProducts: 5, teCode: "A" });
    const b = computeFactors({ manufacturer: tier2, signals: [], numProducts: 5, teCode: "B" });
    const none = computeFactors({ manufacturer: tier2, signals: [], numProducts: 5, teCode: null });
    const aFactor = a.factors.find((f) => f.name === "regulatory_approval");
    const bFactor = b.factors.find((f) => f.name === "regulatory_approval");
    const noneFactor = none.factors.find((f) => f.name === "regulatory_approval");
    expect(aFactor.value).toBe(100);
    expect(bFactor.value).toBe(30);
    expect(noneFactor.value).toBe(0);
  });

  it("many NSQs reduce score", () => {
    const base = computeFactors({ manufacturer: tier2, signals: [], numProducts: 5, teCode: "A" });
    const manyNsq = computeFactors({
      manufacturer: tier2,
      signals: Array.from({ length: 5 }, (_, i) => ({
        type: "NSQ",
        date: new Date(),
        _id: `nsq${i}`,
      })),
      numProducts: 5,
      teCode: "A",
    });
    expect(manyNsq.score).toBeLessThan(base.score);
  });

  it("recalls reduce score", () => {
    const clean = computeFactors({ manufacturer: tier2, signals: [], numProducts: 5, teCode: "A" });
    const recalled = computeFactors({
      manufacturer: tier2,
      signals: [
        { type: "RECALL", date: new Date(), severity: "critical", _id: "r1" },
      ],
      numProducts: 5,
      teCode: "A",
    });
    expect(recalled.score).toBeLessThan(clean.score);
  });

  it("weights sum to 1", () => {
    const total = Object.values(factorWeights).reduce((a, b) => a + b, 0);
    expect(Math.abs(total - 1)).toBeLessThan(1e-9);
  });

  it("time-decayed old recall has less impact", () => {
    const recent = computeFactors({
      manufacturer: tier2,
      signals: [{ type: "RECALL", date: new Date(), severity: "critical", _id: "r1" }],
      numProducts: 5,
      teCode: "A",
    });
    const old = computeFactors({
      manufacturer: tier2,
      signals: [
        {
          type: "RECALL",
          date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 800),
          severity: "critical",
          _id: "r2",
        },
      ],
      numProducts: 5,
      teCode: "A",
    });
    expect(old.score).toBeGreaterThan(recent.score);
  });

  it("future-dated signals are ignored", () => {
    const clean = computeFactors({ manufacturer: tier2, signals: [], numProducts: 5, teCode: "A" });
    const future = computeFactors({
      manufacturer: tier2,
      signals: [
        { type: "NSQ", date: new Date(Date.now() + 86400000 * 365), _id: "f1" },
      ],
      numProducts: 5,
      teCode: "A",
    });
    expect(future.score).toBe(clean.score);
  });
});

describe("coldStartBaseline", () => {
  it("returns LimitedData band with tier baseline", () => {
    const res = coldStartBaseline(tier3);
    expect(res.band).toBe("LimitedData");
    expect(res.limitedData).toBe(true);
    expect(res.score).toBeGreaterThan(0);
    expect(res.factors).toHaveLength(1);
    expect(res.version).toBe("rules-v1");
    expect(res.computedAt).toBeDefined();
  });
});

describe("worked example (spec 5.1)", () => {
  it("returns score 69, band Moderate", () => {
    // A-rated TE, 2 NSQ in 24mo, one MEDIUM recall 18mo ago, 9 years, 7 products, CDSCO GMP (tier2)
    const mfr = { name: "SpecMfr", regulatoryTier: "tier2", yearsOfMarketPresence: 9 };
    const signals = [
      { type: "NSQ", date: new Date(), _id: "s1" },
      { type: "NSQ", date: new Date(), _id: "s2" },
      { type: "RECALL", date: new Date(Date.now() - 18 * 30 * 24 * 60 * 60 * 1000), severity: "medium", _id: "s3" },
    ];
    const result = computeFactors({ manufacturer: mfr, signals, numProducts: 7, teCode: "A" });
    expect(result.score).toBe(69);
    expect(result.band).toBe("Moderate");
  });
});
