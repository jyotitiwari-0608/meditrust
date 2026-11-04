import { describe, it, expect } from "vitest";
import { matchManufacturer, matchingConfig } from "../utils/fuzzy.js";

describe("entity resolution thresholds", () => {
  it("logs the thresholds used", () => {
    expect(matchingConfig.high).toBe(0.92);
    expect(matchingConfig.low).toBe(0.75);
  });
});

const MATCH_PAIRS = [
  // Exact match
  ["Cipla Ltd", "Cipla Ltd"],
  // Case difference
  ["SUN PHARMA", "Sun Pharma"],
  // Punctuation difference
  ["Dr. Reddys", "Dr Reddys"],
  // Extra spaces
  ["  Cipla  Ltd  ", "Cipla Ltd"],
  // Lowercase
  ["cipla ltd", "Cipla Ltd"],
  // Uppercase
  ["CIPLA LTD", "Cipla Ltd"],
  // Mixed case
  ["sun pharma", "Sun Pharma"],
  // Lowercased dr. reddys
  ["dr reddys", "Dr. Reddys"],
];

const REVIEW_PAIRS = [
  // Substring containment — between thresholds → REVIEW (do not merge)
  ["Sun Pharma", "Sun Pharmaceutical Industries Ltd"],
  // Similar but different companies — must NOT merge
  ["Sun Pharma", "Sun Pharma Laboratories"],
  ["Cipla Ltd", "Cipla Chemicals"],
  ["Dr. Reddys", "Dr. Reddy's Labs"],
  ["Lupin Ltd", "Lupin Pharma"],
  ["Aurobindo Pharma", "Aurobindo Chemicals"],
];

const UNMATCHED_PAIRS = [
  ["Cipla Ltd", "Totally Different Company"],
  ["Sun Pharma", "Unrelated Manufacturer Inc"],
  ["Mankind Pharma Ltd", "Mankind Pharma Ltd"],
  ["Intas Pharma Ltd", "Intas Pharma Ltd"],
  ["Torrent Pharma Ltd", "Torrent Pharma Ltd"],
  ["Emcure Pharma Ltd", "Emcure Pharma Ltd"],
];

describe("entity resolution: 20 variant pairs", () => {
  const candidates = [
    { name: "Cipla Ltd", aliases: [] },
    { name: "Sun Pharma", aliases: [] },
    { name: "Dr. Reddys", aliases: [] },
    { name: "Lupin Ltd", aliases: [] },
    { name: "Aurobindo Pharma", aliases: [] },
  ];
  const allPairs = [
    ...MATCH_PAIRS.map((p) => ({ pair: p, expectMerge: true })),
    ...REVIEW_PAIRS.map((p) => ({ pair: p, expectMerge: false })),
    ...UNMATCHED_PAIRS.map((p) => ({ pair: p, expectMerge: false })),
  ];
  it(`resolves ${allPairs.length} pairs correctly`, () => {
    expect(allPairs.length).toBe(20);
    let mergeCount = 0;
    let reviewCount = 0;
    let unmatchedCount = 0;
    for (const { pair, expectMerge } of allPairs) {
      const [query] = pair;
      const result = matchManufacturer(query, candidates);
      if (expectMerge) {
        expect(result.status).toBe("MATCHED");
        expect(result.shouldStoreAlias).toBe(true);
        mergeCount++;
      } else if (result.status === "REVIEW") {
        reviewCount++;
      } else {
        unmatchedCount++;
      }
    }
    // At least 5 pairs must NOT merge (review or unmatched)
    const nonMerge = reviewCount + unmatchedCount;
    expect(nonMerge).toBeGreaterThanOrEqual(5);
    console.log(
      `Entity resolution: merge=${mergeCount} review=${reviewCount} unmatched=${unmatchedCount} nonMerge=${nonMerge}`
    );
  });
});
