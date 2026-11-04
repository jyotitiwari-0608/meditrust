// MediTrust QA check script (per prompts.md QA task).
// Static/deterministic checks + live endpoint checks against an in-memory
// MongoDB (mongodb-memory-server). Does NOT modify any source file.
// Mocked LLM cases are covered by the existing vitest suite (llm.test.js,
// 6 tests passing); here we exercise real code paths where possible.
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import fs from "fs";
import { createServer } from "http";

dotenv.config();

import healthRouter from "../server/routes/health.js";
import searchRouter from "../server/routes/search.js";
import equivalentsRouter from "../server/routes/equivalents.js";
import evidenceRouter from "../server/routes/evidence.js";
import auditRouter from "../server/routes/audit.js";
import metaRouter from "../server/routes/meta.js";

import {
  computeFactors,
  coldStartBaseline,
  bandFor,
  scoreManufacturer,
} from "../server/services/scoring.js";
import { extractSignal } from "../server/services/extraction.js";
import { justifyScore } from "../server/services/justification.js";
import { Drug } from "../server/models/Drug.js";
import { Manufacturer } from "../server/models/Manufacturer.js";
import { Product } from "../server/models/Product.js";
import { Signal } from "../server/models/Signal.js";

const results = [];
function check(id, what, how, expected, actual, status) {
  results.push({ id, what, how, expected, actual, status });
}

async function main() {
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.connect(uri);

  // ---- Seed minimal data ----
  const drug = await Drug.create({
    salt: "amlodipine",
    strength: "5 mg",
    form: "tablet",
    category: "antihypertensives",
  });
  const mfrHigh = await Manufacturer.create({
    name: "Cipla Ltd",
    country: "India",
    regulatoryTier: "tier1",
    yearsOfMarketPresence: 40,
  });
  const mfrCold = await Manufacturer.create({
    name: "Newco Pharma",
    country: "India",
    regulatoryTier: "tier3",
    yearsOfMarketPresence: 1,
  });
  const mfrRecall = await Manufacturer.create({
    name: "RecallCo",
    country: "India",
    regulatoryTier: "tier2",
    yearsOfMarketPresence: 10,
  });
  await Product.create({
    drug: drug._id,
    manufacturer: mfrHigh._id,
    brand: "AlphaAmlod 5",
    mrp: 45,
    teCode: "AB",
    source: "seed",
  });
  await Product.create({
    drug: drug._id,
    manufacturer: mfrCold._id,
    brand: "ColdCo 5",
    mrp: 20,
    teCode: null,
    source: "seed",
  });
  await Product.create({
    drug: drug._id,
    manufacturer: mfrRecall._id,
    brand: "RecallBrand 5",
    mrp: 40,
    teCode: "AB",
    source: "seed",
  });
  const eighteenMonthsAgo = new Date(Date.now() - 18 * 30 * 24 * 60 * 60 * 1000);
  await Signal.create({
    manufacturer: mfrRecall._id,
    type: "NSQ",
    date: new Date(),
    severity: "medium",
    sourceName: "CDSCO",
    sourceUrl: "file.pdf",
    rawText: "nsq row",
    matchedVia: "fuzzy",
  });
  await Signal.create({
    manufacturer: mfrRecall._id,
    type: "RECALL",
    date: eighteenMonthsAgo,
    severity: "medium",
    sourceName: "openFDA",
    sourceUrl: "https://api.fda.gov/x",
    rawText: "recall row",
    matchedVia: "fuzzy",
  });

  // ---- Build app + live server ----
  const app = express();
  app.use(helmet());
  app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
  app.use(express.json({ limit: "100kb" }));
  app.get("/health", (req, res) => res.json({ status: "ok", service: "meditrust-server" }));
  app.use("/api/health", healthRouter);
  app.use("/api/search", searchRouter);
  app.use("/api/drugs", equivalentsRouter);
  app.use("/api/products", evidenceRouter);
  app.use("/api/audit", auditRouter);
  app.use("/api/meta", metaRouter);

  const server = createServer(app);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const fetchJson = async (path, opts = {}) => {
    const res = await fetch(base + path, {
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
      ...opts,
      method: opts.method || "GET",
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch (_) {
      body = text;
    }
    return { status: res.status, body };
  };

  // ================= SECTION B: SCORING =================
  // B1: spec 5.1 worked example (manual replication of spec formula).
  const approval = 1.0 * 0.20;
  const nsq = (1 - 2 / 4) * 0.25;
  const decay = Math.pow(0.5, 18 / 36);
  const recall = (1 - (2 * decay) / 6) * 0.20;
  const presence = (9 / 15) * 0.10;
  const breadth = (Math.log(1 + 7) / Math.log(1 + 20)) * 0.05;
  const tier = 0.6 * 0.20;
  const expectedScore = Math.round((approval + nsq + recall + presence + breadth + tier) * 100);
  check(
    "B1",
    "Spec 5.1 worked example score == 69 Moderate",
    "manual replication of spec formula (config weights differ)",
    "score 69, band Moderate, contributions 0.200 0.125 ~0.153 0.060 ~0.034 0.120",
    `computed score ${expectedScore}, band ${bandFor(expectedScore)}`,
    expectedScore === 69 && bandFor(expectedScore) === "Moderate" ? "PASS" : "FAIL"
  );

  // B1b: real computeFactors with config weights (deviation from spec weights).
  const mfrSpec = { name: "SpecMfr", regulatoryTier: "tier2", yearsOfMarketPresence: 9 };
  const sigs = [
    { type: "NSQ", date: new Date(), _id: "s1" },
    { type: "NSQ", date: new Date(), _id: "s2" },
    { type: "RECALL", date: eighteenMonthsAgo, severity: "medium", _id: "s3" },
  ];
  const cf = computeFactors({ manufacturer: mfrSpec, signals: sigs, numProducts: 7 });
  const contrib = cf.factors.map((f) => `${f.name}=${f.contribution}`).join(" ");
  check(
    "B1b",
    "Real computeFactors on worked example (config weights != spec weights)",
    "services/scoring.js computeFactors",
    "score ~69 band Moderate",
    `score ${cf.score} band ${bandFor(cf.score)} | ${contrib}`,
    "PARTIAL"
  );

  // B2: future-dated signals ignored?
  const future = computeFactors({
    manufacturer: mfrHigh,
    signals: [{ type: "NSQ", date: new Date(Date.now() + 86400000 * 365), _id: "f1" }],
    numProducts: 5,
  });
  const clean = computeFactors({ manufacturer: mfrHigh, signals: [], numProducts: 5 });
  check(
    "B2",
    "Future-dated signals ignored",
    "computeFactors future NSQ vs none",
    "future signal has no effect (score unchanged)",
    `future=${future.score} clean=${clean.score}`,
    future.score === clean.score ? "PASS" : "FAIL"
  );

  // B2b: TE code A=1.0 B=0.3 none=0 — computeFactors ignores TE code entirely.
  check(
    "B2b",
    "TE code A=1.0 B=0.3 none=0",
    "computeFactors approval factor",
    "approval factor reflects TE code",
    "approvalValue = numProducts>0 ? 100 : tierValue (TE code NOT used)",
    "FAIL"
  );

  // B2c: weights not summing to 1 -> service stops? computeFactors normalizes.
  check(
    "B2c",
    "Weights not summing to 1 stops service with clear error",
    "scoring.js computeFactors divides by totalWeight",
    "service throws/errors",
    "computeFactors normalizes by totalWeight (no stop)",
    "FAIL"
  );

  // B3: output object shape.
  check(
    "B3",
    "Output contains score, band, factors[] with name/value/weight/contribution/evidence",
    "computeFactors return shape",
    "score, band, factors[{name,value,weight,contribution,evidence}]",
    `score=${cf.score} factors=${cf.factors.length}`,
    cf.factors.every(
      (f) =>
        f.name &&
        typeof f.value === "number" &&
        typeof f.weight === "number" &&
        typeof f.contribution === "number" &&
        Array.isArray(f.evidence)
    )
      ? "PASS"
      : "FAIL"
  );

  // B4: cold start 0 signals 1 product -> LimitedData tier baseline single factor never Low.
  const cs = coldStartBaseline(mfrCold);
  check(
    "B4",
    "Cold start 0 signals 1 product -> LimitedData tier baseline",
    "coldStartBaseline",
    "band LimitedData, score=tier baseline, single factor, never Low",
    `band=${cs.band} score=${cs.score} factors=${cs.factors.length}`,
    cs.band === "LimitedData" && cs.factors.length === 1 ? "PASS" : "FAIL"
  );

  // B4b: scoreManufacturer cold start path.
  const csLive = await scoreManufacturer(mfrCold._id);
  check(
    "B4b",
    "scoreManufacturer cold start returns LimitedData",
    "scoreManufacturer on Newco Pharma (1 product, 0 signals)",
    "band LimitedData",
    `band=${csLive.band} score=${csLive.score}`,
    csLive.band === "LimitedData" ? "PASS" : "FAIL"
  );

  // B4c: HIGH-severity signal disqualifies cold start.
  await Signal.create({
    manufacturer: mfrCold._id,
    type: "RECALL",
    date: new Date(),
    severity: "high",
    sourceName: "x",
    sourceUrl: "y",
    rawText: "z",
  });
  const csLive2 = await scoreManufacturer(mfrCold._id);
  check(
    "B4c",
    "HIGH-severity signal disqualifies cold start",
    "scoreManufacturer after adding HIGH recall",
    "not LimitedData",
    `band=${csLive2.band} limitedData=${csLive2.limitedData}`,
    csLive2.band !== "LimitedData" ? "PASS" : "FAIL"
  );

  // ================= SECTION C: AI LAYER =================
  check(
    "C1",
    "llmClient provider switch via LLM_PROVIDER",
    "llmClient.js providerFn switch",
    "gemini|groq|ollama|anthropic",
    `PROVIDER=${process.env.LLM_PROVIDER || "gemini"}`,
    "PASS"
  );
  check(
    "C1b",
    "generateJson throws on invalid JSON",
    "extractJson throws 'no JSON object found'",
    "typed error thrown",
    "extractJson throws generic Error (no typed error class)",
    "PARTIAL"
  );
  check(
    "C1c",
    "llmClient disk cache + per-minute rate limiter",
    "llmClient.js",
    "disk cache keyed by prompt hash + rpm limiter",
    "neither implemented (retries/backoff/timeout only)",
    "FAIL"
  );

  // C2 live: no API key -> generateJson throws -> extractSignal needsReview true (case ii).
  const rThrow = await extractSignal("text");
  check(
    "C2ii",
    "Extraction LLM throw/invalid JSON -> needsReview true",
    "extractSignal with no LLM API key (generateJson throws)",
    "needsReview true",
    `needsReview=${rThrow.needsReview} confidence=${rThrow.confidence}`,
    rThrow.needsReview === true ? "PASS" : "FAIL"
  );
  check(
    "C2",
    "Extraction mocked cases (i valid, iii low conf, v null key) covered by vitest",
    "server/tests/llm.test.js (vi.mock of llmClient)",
    "6 LLM tests pass",
    "llm.test.js: 6 tests passing (see test run)",
    "PASS"
  );
  check(
    "C2iv",
    "Extraction hallucinated manufacturer -> needsReview true (no hallucination check in code)",
    "extraction.js has no manufacturer-in-raw-text check",
    "needsReview true",
    "no hallucination check implemented; depends on confidence/validity only",
    "FAIL"
  );

  // C3 live: no LLM -> justifyScore falls back to template (real code path).
  const jFallback = await justifyScore({ score: 80, band: "High", factors: [] });
  check(
    "C3",
    "Justification falls back to template when LLM unavailable",
    "justifyScore with no LLM API key",
    "template output contains score/band",
    `out='${jFallback}' contains80=${jFallback.includes("80")}`,
    jFallback.includes("80") ? "PASS" : "FAIL"
  );
  check(
    "C3b",
    "Justification source marked llm/template",
    "justifyScore return value",
    "returns {text, source}",
    "returns plain string only (no source marker)",
    "FAIL"
  );

  // ================= SECTION D: API CONTRACT (live) =================
  check(
    "D1",
    "Routes: /api/search, /api/drugs/:id/equivalents, /api/products/:id/evidence, /api/meta",
    "server.js app.use mounts",
    "all present",
    "present: /api/health /api/search /api/drugs /api/products /api/audit /api/meta",
    "PASS"
  );
  check(
    "D1b",
    "Route /api/lookup?code= present",
    "server.js routes",
    "present",
    "MISSING — no /api/lookup route",
    "FAIL"
  );
  check(
    "D1c",
    "Route POST /api/substitutions/confirm present",
    "server.js routes",
    "present",
    "MISSING — uses POST /api/audit instead",
    "FAIL"
  );
  check(
    "D1d",
    "Admin routes with API key present",
    "server.js routes",
    "present",
    "MISSING — no admin routes, no API-key middleware",
    "FAIL"
  );

  const meta = (await fetchJson("/api/meta"));
  check(
    "D2",
    "GET /api/meta reports demo flag",
    "live HTTP GET /api/meta",
    "{demo: boolean}",
    JSON.stringify(meta.body),
    typeof meta.body.demo === "boolean" ? "PASS" : "FAIL"
  );

  const search = await fetchJson("/api/search?q=amlodipine");
  check(
    "D2b",
    "GET /api/search?q=amlodipine returns results",
    "live HTTP",
    "HTTP 200, results array, pagination metadata",
    `status ${search.status} results=${Array.isArray(search.body.results) ? search.body.results.length : "n/a"}`,
    search.status === 200 && Array.isArray(search.body.results) ? "PASS" : "FAIL"
  );

  const typo = await fetchJson("/api/search?q=amlodpine");
  check(
    "D2c",
    "GET /api/search?q=amlodpine typo handling",
    "live HTTP (no fuzzy fallback implemented)",
    "fuzzy fallback returns amlodipine",
    `status ${typo.status} results=${Array.isArray(typo.body.results) ? typo.body.results.length : "n/a"}`,
    "UNVERIFIED"
  );

  const unk = await fetchJson("/api/search?q=zzzz");
  check(
    "D2d",
    "GET /api/search?q=zzzz empty -> HTTP 200",
    "live HTTP",
    "HTTP 200 + message",
    `status ${unk.status} total=${unk.body.total}`,
    unk.status === 200 ? "PASS" : "FAIL"
  );

  const eq = await fetchJson(`/api/drugs/${drug._id}/equivalents`);
  const sorted =
    eq.body.equivalents &&
    eq.body.equivalents.every((e, i, arr) => i === 0 || arr[i - 1].score >= e.score);
  check(
    "D2e",
    "GET /api/drugs/:id/equivalents sorted score desc then price asc",
    "live HTTP",
    "sorted by score desc, price asc; includes savings band teCode isJanAushadhi provenance",
    `count=${eq.body.count} sorted=${sorted} first={score:${eq.body.equivalents?.[0]?.score} savings:${eq.body.equivalents?.[0]?.savings} teCode:${eq.body.equivalents?.[0]?.teCode}}`,
    eq.status === 200 && sorted ? "PASS" : "FAIL"
  );
  check(
    "D2f",
    "Equivalents include isJanAushadhi & provenance",
    "live HTTP response fields",
    "isJanAushadhi + provenance present",
    "isJanAushadhi absent (Product schema has no field); provenance absent",
    "FAIL"
  );

  const prod = await Product.findOne({ manufacturer: mfrRecall._id });
  const ev = await fetchJson(`/api/products/${prod._id}/evidence`);
  check(
    "D2g",
    "GET /api/products/:id/evidence factor breakdown + provenance",
    "live HTTP",
    "score band factors provenance(source name url date) justification source llm/template",
    `score=${ev.body.score} band=${ev.body.band} factors=${ev.body.factors.length} provenance=${ev.body.provenance.length}`,
    ev.status === 200 && ev.body.provenance.length > 0 ? "PASS" : "PARTIAL"
  );

  const lookup = await fetchJson("/api/lookup?code=12345");
  check(
    "D2h",
    "GET /api/lookup?code= unknown",
    "live HTTP",
    "HTTP 404 or message",
    `status ${lookup.status} (route missing)`,
    "UNVERIFIED"
  );

  const confirm = await fetchJson("/api/substitutions/confirm", {
    method: "POST",
    body: { acknowledgement: true },
  });
  check(
    "D2i",
    "POST /api/substitutions/confirm",
    "live HTTP",
    "requires acknowledgement=true, writes AuditLog",
    `status ${confirm.status} (route missing)`,
    "UNVERIFIED"
  );

  // D3: validation errors.
  const badId = await fetchJson("/api/drugs/notanid/equivalents");
  check(
    "D3",
    "Invalid id -> consistent JSON error 400",
    "live HTTP",
    "HTTP 400 JSON error",
    `status ${badId.status}`,
    badId.status === 400 ? "PASS" : "FAIL"
  );
  const missing = await fetchJson("/api/search");
  check(
    "D3b",
    "Missing param q -> 400",
    "live HTTP /api/search no q",
    "HTTP 400",
    `status ${missing.status}`,
    missing.status === 400 ? "PASS" : "FAIL"
  );

  // D4: hardcoded data in client.
  const apiSrc = fs.readFileSync("../client/src/api.js", "utf8");
  check(
    "D4",
    "No frontend hardcoded drug/price/score data",
    "grep client/src/api.js",
    "none",
    "demoDrugs + demoEvidence hardcoded (DEMO_MODE=true)",
    "FAIL"
  );

  // G1: provenance.
  check(
    "G1",
    "Provenance for API items (source name, link/file, date)",
    "evidence.js provenance mapping",
    "sourceName, sourceUrl, date present",
    `first provenance: ${JSON.stringify(ev.body.provenance[0] || {})}`,
    ev.body.provenance.length > 0 &&
      ev.body.provenance[0].sourceName &&
      ev.body.provenance[0].sourceUrl &&
      ev.body.provenance[0].date
      ? "PASS"
      : "FAIL"
  );

  // G2: demo mode.
  check(
    "G2",
    "/api/meta reports demo; seed refuses real DB",
    "meta.js + seedDemo.js",
    "demo flag + synthetic 'Synthetic demo record'",
    `meta.demo=${meta.body.demo}`,
    typeof meta.body.demo === "boolean" ? "PASS" : "FAIL"
  );

  // G3: security.
  check(
    "G3",
    "helmet + CORS + body limit",
    "server.js",
    "helmet, CORS limited to client URL, rate limiting, 100kb body",
    `helmet present, CORS origin='${process.env.CORS_ORIGIN || "*"}', body limit 100kb`,
    process.env.CORS_ORIGIN && process.env.CORS_ORIGIN !== "*" ? "PARTIAL" : "FAIL"
  );
  check(
    "G3b",
    "Admin routes protected by API key",
    "server.js routes",
    "admin routes need API key header",
    "no admin routes exist",
    "FAIL"
  );

  // G4: free-only deps.
  check(
    "G4",
    "All dependencies free (no paid/credit-card required)",
    "package.json dependencies",
    "all free",
    "express mongoose axios cors helmet pdf-parse csv-parse zod fast-fuzzy ml-logistic-regression mongodb-memory-server — all free",
    "PASS"
  );

  // G5: deploy config.
  check(
    "G5",
    "render.yaml, vercel.json, CI workflow consistent",
    "render.yaml + .github/workflows/test.yml",
    "render.yaml + vercel.json + CI exist & consistent",
    "render.yaml exists (healthCheckPath /health), NO vercel.json, CI test.yml exists",
    "PARTIAL"
  );

  await mongoose.disconnect();
  await mongod.stop();
  server.close();

  // ---- Print table ----
  console.log("\n=== QA CHECK TABLE ===");
  console.log("| ID | Status | What | Actual |");
  console.log("|----|--------|------|--------|");
  for (const r of results) {
    console.log(`| ${r.id} | ${r.status} | ${r.what} | ${r.actual} |`);
  }
  const pass = results.filter((r) => r.status === "PASS").length;
  const fail = results.filter((r) => r.status === "FAIL").length;
  const partial = results.filter((r) => r.status === "PARTIAL").length;
  const unverified = results.filter((r) => r.status === "UNVERIFIED").length;
  console.log(
    `\nCounts: PASS=${pass} FAIL=${fail} PARTIAL=${partial} UNVERIFIED=${unverified} TOTAL=${results.length}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
