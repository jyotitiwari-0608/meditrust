import fs from "fs";
import path from "path";

const REVIEW_DIR = path.join(process.cwd(), "data", "review");
const REVIEW_FILE = path.join(REVIEW_DIR, "manufacturer-matches.json");

function ensureReviewDir() {
  if (!fs.existsSync(REVIEW_DIR)) {
    fs.mkdirSync(REVIEW_DIR, { recursive: true });
  }
}

function loadReviewMatches() {
  ensureReviewDir();
  try {
    return JSON.parse(fs.readFileSync(REVIEW_FILE, "utf8"));
  } catch (e) {
    return [];
  }
}

function saveReviewMatch({ incomingName, bestMatchName, score, source, signalId }) {
  ensureReviewDir();
  const matches = loadReviewMatches();
  matches.push({
    incomingName,
    bestMatchName,
    score,
    source,
    signalId: signalId || null,
    createdAt: new Date().toISOString(),
    status: "pending",
  });
  fs.writeFileSync(REVIEW_FILE, JSON.stringify(matches, null, 2));
  return matches;
}

export { loadReviewMatches, saveReviewMatch, REVIEW_FILE };
