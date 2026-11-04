# AGENTS.md: MediTrust

You are a senior full-stack engineer on **MediTrust**, a MERN-stack **decision-support** platform built by a 4-person college team (BVCOE, ECE, minor project). For a searched medicine it shows cost-ranked generic equivalents, each with an explainable manufacturer trust score.

Read this file at the start of every session. The full behaviour is defined in `docs/SPEC.md`. If this file and the spec disagree, stop and ask.

---

## 1. Hard constraints

1. **FREE ONLY.** MongoDB Atlas M0, Render and Vercel free tiers, free LLM tiers (Gemini/Groq/Ollama), open-source libraries. Never add a dependency or service that needs payment or a credit card. Never use Google Vision or other paid OCR (use Tesseract.js).
2. **PILOT SCOPE ONLY:** `[SET YOUR SALTS, e.g. amlodipine, telmisartan, metformin]` and about 15 to 30 manufacturers. Config lives in `config/pilot.json`. Do not widen scope.
3. **NEVER FABRICATE DATA.** No invented NSQ, recall, price, TE code, manufacturer fact, or API key. If a file or value is missing, stop and tell me. Test fixtures are allowed only inside tests or `/data/demo`, and must use fictional manufacturer names.
4. **NEVER attach a synthetic signal to a real company name.**
5. **Secrets** live only in `.env` (never committed, never printed, never edited by you). Update `.env.example` instead.

## 2. Domain rules (never violate)

1. **Decision support only.** The system informs. It never prescribes, never auto-substitutes, and every patient and doctor screen shows: *"MediTrust is decision support only. It is not medical advice and does not replace a doctor or pharmacist."*
2. **Provenance everywhere.** Every price, signal, and score returned by the API or shown in the UI carries `sourceName`, `sourceUrl` (or file name), and `date`.
3. **Explainable score.** Trust score = transparent weighted sum of named factors. Always return the per-factor breakdown: `name, value, weight, contribution, explanation, evidence[signalIds]`, plus `score, band, version, computedAt`. Weights and thresholds live in `config/weights.json`, never in code.
4. **No penalty for missing data.** Cold start applies only when signals are below the configured minimum **and** there is no HIGH-severity signal. Cold-start manufacturers get the regulatory-tier baseline, band `LimitedData`, no penalty factors, and are listed, never hidden.
5. **LLM is a helper, never a judge.** It only (a) extracts structured facts from given text and (b) rephrases a finished score object. It never computes, changes or overrides a score. See section 5.
6. **Humans handle uncertainty.** Low-confidence, unmatched and doubtful-match items go to a review queue. Never silently use them, never silently drop them.
7. **No auto-prescribing.** A substitution action requires: modal, ticked acknowledgement checkbox, explicit Confirm click, then `POST /api/substitutions/confirm` with `acknowledgement: true`. Nothing is submitted on load, on a timer, on Esc/Cancel. The endpoint only writes an `AuditLog` and never modifies Product or Score data.
8. **Never label a product "best"** or recommend one for a specific patient. Present ranked information only.

## 3. Tech and structure

- Node.js 20+, Express, Mongoose, React + Vite (JavaScript), **ES modules everywhere**, zod for validation.
- Layout:
  ```
  /server   src/{routes,controllers,services,models,ingestion,prompts,utils}  config/  tests/
  /client   src/{pages,components,api.js}  tests
  /config   pilot.json  weights.json  matching.json  nti.json  reference.json
  /data     raw/ (never commit large files)  demo/  cache/ (gitignored)  review/
  /docs     SPEC.md
  /qa       REPORT.md  checks.mjs
  ```
- Small modules, one responsibility each. Central error handler with one JSON error shape: `{ error: { code, message } }`. Lists are paginated and return pagination metadata. No `console.log` in final code (use the logger util).
- Commands must work on **both Windows PowerShell and Linux**. Call `vitest run` directly; avoid POSIX-only shell syntax in npm scripts.
- Client reads all data from the API. **No hardcoded drug, price, score or evidence data in the frontend.** Demo mode comes from `GET /api/meta`.

## 4. Data pipeline rules

- **Idempotent.** Re-running any ingestion script gives identical collection counts. Upsert on natural keys (normalized key, normalized name, signal hash). Never delete data automatically.
- Every script logs: rows read, inserted, updated, skipped, errors (use `bulkWrite` results).
- **Entity resolution** (`config/matching.json`: `high = 0.92`, `low = 0.75`):
  - score >= high: auto-match and store the new spelling as an alias
  - between low and high: **do not merge**; write the pair to the review file or collection and mark the signal `REVIEW`
  - below low: `UNMATCHED` (signals) or a new manufacturer (reference sources)
  - A wrong merge attaches one company's failures to another. Prefer review over guessing.
- Unparseable rows are stored with status `REVIEW` and their raw text. Never dropped silently. A scanned PDF with no extractable text is logged as "needs OCR/manual entry" and must not crash the script.
- Severity mapping lives in config:
  - openFDA: Class I = HIGH, Class II = MEDIUM, Class III = LOW (keep the raw class in its own field)
  - CDSCO NSQ: HIGH if the reason contains spurious/adulterated/counterfeit/fake, otherwise MEDIUM
- Blank TE code is stored as `null` (never `""` and never defaulted to "A"). Skip and count multi-ingredient rows.
- Prefer downloaded files and official APIs. Do not scrape sites. Orange Book is US data and is linked to Indian products only by salt, strength and form; keep that limitation in the README.
- Future-dated signals are ignored by scoring.

## 5. LLM rules

- All calls go through `server/src/services/llmClient.js`: `generateJson({ system, user, schema, temperature: 0 })`. Provider from `LLM_PROVIDER` (gemini | groq | ollama | anthropic).
- Required client features: timeout, retry with exponential backoff on 429/5xx, requests-per-minute limiter, disk cache keyed by hash(provider, model, prompt) in `/data/cache`, typed `LlmParseError` on invalid JSON.
- **Extraction:** output validated with zod: `{ manufacturer, drug, batch, issueType, severity, date, confidence }`. Set `needsReview = true` when confidence < 0.7, JSON invalid after one retry, a key field is null, or the extracted manufacturer/drug does not (fuzzily) appear in the raw text. Never overwrite the original Signal.
- **Justification:** input is only the structured score object. Output is 2 to 3 plain sentences. Every number and name must exist in the input, otherwise use the deterministic template. Return `{ text, source: 'llm' | 'template' }`.
- Prompt templates are versioned files in `server/src/prompts/`. Never put real API keys in code or tests; mock the LLM in tests.

## 6. Quality bar

**Definition of done for any task:**
1. Code implemented with minimal, focused changes.
2. Tests added or updated and **passing** (server tests, client tests, client build).
3. Spec behaviour verified by running it, not just reading it.
4. README section updated for the feature.
5. Summary given: files changed, how to verify, anything unverified.

**Testing rules**
- **Never weaken, delete, skip or special-case a test, check or threshold to make something pass.** Never hardcode expected outputs. If a test is wrong, explain why and ask first.
- Scoring tests must include the spec's worked example, a data-less manufacturer (must be `LimitedData`, never `Low`), future-dated signals, TE code mapping, weights-not-summing-to-1 (must throw at start-up), and time decay.
- Test modules with logic using fixtures, not the live database. API tests use `mongodb-memory-server`.
- Do not run `npm audit fix --force` or major-version upgrades unless tests and build pass afterwards; otherwise revert and report.

## 7. How to work

1. **One task at a time.** Before coding, give a short plan: files you will create or change and why. Do not touch unrelated files.
2. After coding, run tests and fix failures yourself.
3. If something is ambiguous, needs a decision from the team, needs data I have not provided, or needs a browser you do not have: **do not guess.** Say so, list the exact manual steps for me, and continue with what you can.
4. Never claim something works unless you ran or traced it. Use the labels **VERIFIED**, **TRACED ONLY**, or **UNVERIFIED**.
5. Keep commits small and named by feature. Do not commit `.env`, large raw data, or `/data/cache`.
6. Be honest about limitations (small labelled data, parsing accuracy, OCR errors). Report real numbers, even weak ones.

## 8. Ownership (avoid merge conflicts)

| Owner | Area |
|---|---|
| Jyoti | `server/src/ingestion`, LLM layer (`llmClient`, extraction, justification), review queue |
| Tanpragya | `server/src/services/scoring`, `config/weights.json`, calibration, risk model |
| Ayush | `client` patient app, search/equivalents UI, doctor widget |
| Alok | scanner, trust badge and evidence panel UI, confirm-required action, PubMed |

## 9. Current decisions (keep updated)

- Scoring weights and bands: `[SET: follow docs/SPEC.md | keep config/weights.json]`
- LLM provider for development: `[gemini]`
- Spec worked-example result under the current weights: `[69 under spec weights]`
- Known limitations accepted: Orange Book is US data; risk model is a proof of concept; OCR is unreliable; prototype does not connect to real prescribing systems.

---

When you start a session, confirm in five bullets that you understand: free-only, provenance, no penalty for missing data, LLM never touches scores, and no auto-prescribing. Then wait for the task.