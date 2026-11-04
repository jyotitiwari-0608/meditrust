import fs from "fs";
import path from "path";
import { search as ffSearch } from "fast-fuzzy";
import { normalizeName } from "./normalize.js";

const matchingPath = path.join(process.cwd(), "config", "matching.json");
let matchingConfig = { high: 0.92, low: 0.75 };
try {
  matchingConfig = JSON.parse(fs.readFileSync(matchingPath, "utf8"));
} catch (e) {
  console.log(`Using default matching thresholds (config/matching.json not found): high=0.92 low=0.75`);
}

function simpleScore(query, target) {
  const q = normalizeName(query);
  const t = normalizeName(target);
  if (!q || !t) return 0;
  if (q === t) return 1;
  if (t.includes(q) || q.includes(t)) return 0.85;
  const qs = q.split(" ");
  const ts = t.split(" ");
  let overlap = 0;
  for (const w of qs) if (ts.includes(w)) overlap++;
  return qs.length ? overlap / qs.length : 0;
}

export function matchManufacturer(name, candidates) {
  const { high, low } = matchingConfig;
  if (!name || !candidates.length) {
    return { match: null, score: 0, status: "UNMATCHED", shouldStoreAlias: false, shouldReview: false };
  }
  const fuzzyMatches = ffSearch(name, candidates.map((c) => c.name));
  const matchedNames = new Set(fuzzyMatches);
  let best = null;
  let bestScore = 0;
  for (const c of candidates) {
    if (!matchedNames.has(c.name)) continue;
    const s = simpleScore(name, c.name);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  if (!best) {
    return { match: null, score: 0, status: "UNMATCHED", shouldStoreAlias: false, shouldReview: false };
  }
  if (bestScore >= high) {
    return { match: best, score: bestScore, status: "MATCHED", shouldStoreAlias: true, shouldReview: false };
  }
  if (bestScore >= low) {
    return { match: best, score: bestScore, status: "REVIEW", shouldStoreAlias: false, shouldReview: true };
  }
  return { match: null, score: bestScore, status: "UNMATCHED", shouldStoreAlias: false, shouldReview: false };
}

export { matchingConfig };
