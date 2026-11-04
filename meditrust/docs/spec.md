# MediTrust: Functional Specification

**Version 1.1 | Project:** MediTrust, AI-Assisted Generic Drug Substitution and Manufacturer Trust Platform
**Team:** Jyoti Tiwari, Tanpragya Bharadwaj, Alok Tripathi, Ayush Sharma | **Mentor:** Dr. Rubeena Vohra
**Institution:** Bharati Vidyapeeth's College of Engineering, New Delhi (Department of ECE, minor project)

This document defines how every MediTrust feature must behave. It is used to brief the AI agent, to review the code, to write tests, and to explain the system in the project report. If the code and this spec disagree, either the code is wrong or the spec must be updated and the change recorded in Section 27. Section 0 is the single source of truth for every constant.

---

## 0. Decisions and constants (single source of truth)

Every number used by the system is listed here. Code reads these from `/config`; tests assert them. If a value changes, update this table, the config file and the tests together.

| Item | Value | Config location |
|---|---|---|
| Factor weights (sum = 1.00) | approval 0.20, recentNsq 0.25, recallHistory 0.20, marketPresence 0.10, portfolioBreadth 0.05, regulatoryTier 0.20 | `config/weights.json` |
| Bands | High >= 75, Moderate 50 to 74, Low < 50 | `config/weights.json` |
| Special band | `LimitedData` (cold start only, never produced by the score thresholds) | code constant |
| TE code mapping | A-rated = 1.0, B-rated = 0.3, none or null = 0 | `config/weights.json` |
| Tier baselines (cold start score) | STRICT_REGULATORY 80, CDSCO_GMP 60, UNKNOWN 30 | `config/weights.json` |
| Tier values (factor, 0 to 1) | STRICT_REGULATORY 1.0, CDSCO_GMP 0.6, UNKNOWN 0.3 | `config/weights.json` |
| Cold start rule | applies only if total signals < 3 AND products < 3 AND no HIGH-severity signal | `config/weights.json` |
| NSQ window and cap | last 24 months; value = max(0, 1 - count/4) | `config/weights.json` |
| Recall points | HIGH 3, MEDIUM 2, LOW 1; half-life 36 months; value = max(0, 1 - total/6) | `config/weights.json` |
| Market presence | min(1, years / 15) | `config/weights.json` |
| Portfolio breadth | log(1+n) / log(1+20), capped at 1 | `config/weights.json` |
| Entity matching thresholds | high = 0.92 (auto-match), low = 0.75 (below = unmatched) | `config/matching.json` |
| Extraction review threshold | needsReview if confidence < 0.7 | `config/llm.json` |
| LLM settings | temperature 0, timeout 30 s, 2 retries, 15 requests/minute | `config/llm.json` |
| Risk model blend alpha | 0.3 | `config/weights.json` |
| Risk model cutoff date | 2023-01-01 (features before, labels after) | `config/model.json` |
| Admin auth | header `x-api-key` equals `ADMIN_API_KEY` | env |
| Request body limit | 100 kb | server constant |
| Rate limit | 100 requests per minute per IP (public), 30 per minute (admin) | `config/security.json` |
| Pagination | default limit 20, maximum 50 | server constant |
| Worked example (Section 5.1) | score 69, band Moderate | `tests/scoring.test.js` |

**Worked example check:** with the weights above, the example manufacturer in Section 5.1 must score exactly 69 (0.200 + 0.125 + 0.153 + 0.060 + 0.034 + 0.120 = 0.692). A scoring test must assert this.

---

## 1. System overview

MediTrust has two halves: an **offline pipeline** that collects and scores data, and an **online app** that serves it.

```
RAW SOURCES                 PIPELINE (scripts)                      STORAGE
Orange Book (txt)  ---->  parse + normalize + resolve names  ---->  Drug, Manufacturer, Product
Indian meds (csv)  ---->  salt/strength/form + price         ---->  Brand, Product
Jan Aushadhi (csv) ---->  low-cost reference price           ---->  Product (isJanAushadhi)
CDSCO NSQ (pdf)    ---->  text -> rows -> Signal (NSQ)        ---->  Signal
openFDA (api)      ---->  recalls -> Signal (RECALL)         ---->  Signal
                              |
                              v
                  LLM extraction (optional, validated)       ---->  Extraction (needsReview)
                              |
                              v
                  Scoring service (rules + optional model)   ---->  Score (factors, evidence)

ONLINE APP
Patient UI / Doctor widget  <---- REST API (Express)  <---- MongoDB
   search, scan, equivalents, evidence, substitution proposal (confirm required)
```

The golden path for a user: **search or scan a medicine, see cheaper equivalents ranked by trust, open the evidence for any score, and (for a doctor) propose a substitution that needs an explicit confirmation.**

## 2. Non-negotiable principles

1. **Decision support only.** The system informs. It never prescribes, never auto-substitutes, and every screen shows a disclaimer.
2. **Provenance everywhere.** Any price, signal or score on screen can be traced to a source name, a link or file name, and a date.
3. **Explainable scoring.** The score is a weighted sum of named factors. A user can always see which factor contributed how many points.
4. **No penalty for missing data.** A manufacturer with little public data is labelled 'Limited data' and scored from a neutral baseline, never marked Low for being unknown.
5. **LLM is a helper, not a judge.** It only extracts facts from given text and rephrases a finished score. It never computes or changes a score, and every output is validated.
6. **Humans handle uncertainty.** Low-confidence or unmatched items go to a review queue instead of being silently used.
7. **Free tools only.**

## 3. Data model (what is stored)

- **Drug:** the normalized medicine identity: salt (e.g. amlodipine), strength (5 mg), form (tablet). A unique `normalizedKey` such as `amlodipine|5mg|tablet` makes products comparable.
- **Brand:** a trade name linked to a drug and manufacturer.
- **Manufacturer:** canonical name, normalized name, aliases (spelling variants), country, regulatory tier (STRICT_REGULATORY, CDSCO_GMP, UNKNOWN), first-seen year.
- **Product:** one manufacturer's version of one drug: price, price per unit, pack size, TE code (null if blank), `isJanAushadhi`, and source.
- **Signal:** one regulatory event: type (NSQ, RECALL, INSPECTION, APPROVAL), date, severity (HIGH, MEDIUM, LOW, UNKNOWN), batch, reason, raw text, raw classification, source name, source link, and match status (MATCHED, UNMATCHED, REVIEW).
- **Extraction:** LLM output for a signal: structured JSON, confidence, needsReview, model name, prompt version, reviewer, reviewed time.
- **Score:** the result for a product: value 0 to 100, band, factor list with evidence signal ids, version, time computed.
- **Barcode:** code, type (brand or drug), reference id, source, added time.
- **AuditLog:** record of every confirmed substitution proposal.
- **Demo records** carry `isDemo: true`.

---

## 4. Pipeline features

### 4.1 Orange Book import

**Purpose:** gives approved products and therapeutic-equivalence (TE) codes, the strongest regulatory-approval signal available for free.

**How it works**
1. Read the downloaded `products.txt` (tilde-delimited). Each row has ingredient, dosage form and route, trade name, applicant, strength, TE code, approval date.
2. Keep only rows whose ingredient is in the pilot list (`config/pilot.json`).
3. Normalize: lowercase the salt, split the strength into number and unit, map the form to a standard word (TABLET; ORAL becomes 'tablet').
4. Build the drug key and upsert the Drug.
5. Clean the applicant name (remove Inc, Ltd, Pharma and punctuation), resolve it against existing manufacturers (see 4.4), and upsert the Manufacturer with country US and tier STRICT_REGULATORY.
6. Upsert the Product with TE code, approval date and source (name 'FDA Orange Book', file, download date).

**Output:** drugs, manufacturers and products in the database; a log line with rows read, inserted, updated, skipped, errors.

**Edge cases:** blank TE code is stored as null (never an empty string and never defaulted to 'A'); multi-ingredient products are skipped and counted; strengths written differently ('5MG', '5 mg'); repeated rows (upsert, never duplicate).

**Limitation to state:** Orange Book is US data. It is used as a reference for approval quality and equivalence rules, and Indian products are linked by salt, strength and form, not by identical manufacturer.

**Acceptance test:** run twice, counts stay the same; 10 sampled products match the raw file.

### 4.2 Indian medicines import

**Purpose:** gives the brand-to-composition mapping, Indian manufacturers and prices.

**How it works**
1. Stream the CSV with csv-parse.
2. Parse the composition text (e.g. 'Amlodipine (5mg)') into salt and strength. Rows with several salts are skipped for now and counted.
3. Detect the form from the pack or product name when the column is missing.
4. Compute price per unit = price / pack size (tablets or ml). Rows without a usable pack size keep the price but are flagged so that savings are not computed from them.
5. Create the Brand, resolve the Manufacturer (country IN, tier CDSCO_GMP), and upsert the Product.

**Edge cases:** different spellings of the same company; missing prices; discontinued products; currency symbols and commas in numbers.

**Acceptance test:** for 5 hand-picked brands, price, manufacturer and strength match the CSV exactly.

### 4.3 Jan Aushadhi price list import

**Purpose:** the government low-cost generic benchmark.

**How it works:** parse the list, match each item to a Drug by the normalized key, and create or update a Product with `isJanAushadhi = true` and the listed price. These products appear in results with a visible 'Jan Aushadhi' tag and act as the price floor in savings comparisons.

**Edge cases:** items with no matching drug are logged, not forced into a match.

### 4.4 Manufacturer entity resolution

**Purpose:** the same company appears under many spellings across sources ('Sun Pharmaceutical Industries Ltd', 'SUN PHARMA'). Signals only help if they reach the right company.

**How it works** (thresholds from `config/matching.json`)
1. Normalize the incoming name (lowercase, remove punctuation and legal suffixes).
2. Exact match against canonical names and aliases. If found, use it.
3. Otherwise fuzzy match (fast-fuzzy) and get the best candidate with a similarity score.
4. **Score >= 0.92:** match automatically and store the new spelling as an alias.
5. **Score from 0.75 up to 0.92:** do not merge. Write the pair (incoming name, best match, score) to the review file or collection and mark the signal REVIEW.
6. **Score < 0.75:** create a new manufacturer (reference sources) or mark the signal UNMATCHED (signals).
7. Log the thresholds used in every run.

**Why it matters:** a wrong merge attaches one company's failures to another, which is the worst error in the whole system. So the design prefers sending doubtful cases to a human over guessing.

**Acceptance test:** a list of 20 known variant pairs resolves correctly; at least 5 similar but different companies are not merged.

### 4.5 CDSCO NSQ ingestion

**Purpose:** the main India-specific quality signal: drug batches declared 'Not of Standard Quality' or spurious.

**How it works**
1. Read each monthly PDF from `/data/raw/cdsco/`.
2. Extract text with pdf-parse.
3. Split into table rows: drug name, batch, manufacturer, reason. The splitter handles rows broken across lines.
4. Keep rows whose drug matches a pilot salt.
5. Create a Signal (type NSQ) with raw row text, source name 'CDSCO NSQ alert', the file name or link, and the date taken from the alert month.
6. Try to link to a manufacturer (4.4). Rows that cannot be parsed are still stored with status REVIEW so no data is silently lost.
7. Print how many rows were found, kept, and sent to review.

**Severity rule** (from `config/severity.json`): HIGH if the reason contains spurious, adulterated, counterfeit or fake; otherwise MEDIUM.

**Edge cases:** PDFs that are scanned images (text extraction returns nothing: log 'needs OCR/manual entry' and continue, never crash); month names in different formats; the same batch listed in two months (deduplicate by a hash).

**Acceptance test:** compare 10 rows against the PDF by eye and record the parsing accuracy.

### 4.6 openFDA recall ingestion

**Purpose:** gives labelled recall history, and is the main source for the later ML step.

**How it works**
1. For each pilot salt, call the drug enforcement endpoint with pagination.
2. Respect rate limits (wait and retry with backoff).
3. For each record take recalling firm, reason, classification, recall date, and product description.
4. Map classification to severity: Class I is HIGH, Class II is MEDIUM, Class III is LOW. Keep the raw class in `rawClassification`.
5. Save as a Signal (type RECALL) with the openFDA link, then resolve the manufacturer.

**Edge cases:** no results (not an error); repeated recall records (hash to deduplicate); dates in YYYYMMDD format.

### 4.7 Idempotency and logging

Every ingestion script can be run any number of times with the same result. This is achieved by upserting on natural keys (normalized key, normalized name, signal hash) and by never deleting data automatically. Every script logs rows read, inserted, updated, skipped and errors (from the bulkWrite result).

### 4.8 PubMed abstracts (supporting feature)

**Purpose:** gives bioequivalence literature as extra evidence, and extra text for testing the extraction prompts.

**How it works:** query the PubMed E-utilities (esearch then efetch) for 'bioequivalence AND <salt>', store title, year, PMID link and abstract. In the UI these appear as 'Supporting literature' links on the evidence panel. They are context for the reader and are **not** a scoring input unless the team defines and documents a rule for it.

---

## 5. Scoring features

### 5.1 Rule-based trust score

**Purpose:** one number from 0 to 100 per manufacturer-drug product, plus a clear explanation of how it was reached.

**Factors** (each converted to a value between 0 and 1, then multiplied by its weight; weights live in `config/weights.json` and sum to 1)

| Factor | What it measures | How the value is derived | Weight |
|---|---|---|---|
| Regulatory approval | Approved and rated equivalent | TE code A-rated = 1.0, B-rated = 0.3, none or null = 0 | 0.20 |
| Recent NSQ | Quality failures in the last 24 months | 1 minus (count / 4), minimum 0 | 0.25 |
| Recall history | Severity and recency of recalls | Severity points (HIGH 3, MEDIUM 2, LOW 1) multiplied by time decay (half-life 36 months), then 1 minus (total / 6), minimum 0 | 0.20 |
| Market presence | Years the manufacturer has been seen | years / 15, maximum 1 | 0.10 |
| Portfolio breadth | Number of approved products | log(1 + n) / log(1 + 20), maximum 1 | 0.05 |
| Regulatory tier | Strength of the home regulator | Strict regulator 1.0, CDSCO GMP 0.6, unknown 0.3 | 0.20 |

**Calculation:** score = 100 x sum of (value x weight). Bands: High 75 or more, Moderate 50 to 74, Low below 50. Only MATCHED signals dated on or before today are used. Future-dated signals are ignored.

**Worked example.** A manufacturer has an A-rated TE code, 2 NSQ in 24 months, one MEDIUM recall 18 months ago, 9 years in market, 7 products, tier CDSCO_GMP.
- Approval: 1.0 x 0.20 = 0.200
- NSQ: (1 - 2/4) = 0.5 x 0.25 = 0.125
- Recall: 2 points x 0.707 decay = 1.41; 1 - 1.41/6 = 0.765 x 0.20 = 0.153
- Market presence: 9/15 = 0.6 x 0.10 = 0.060
- Breadth: log(8)/log(21) = 0.683 x 0.05 = 0.034
- Tier: 0.6 x 0.20 = 0.120
- Total 0.692, so the **score is 69, band Moderate.**

**Output object**
```
{ score: 69, band: 'Moderate', version: 'rules-v1',
  factors: [ { name, value, weight, contribution, explanation, evidence: [signalIds] } ],
  computedAt }
```
Every factor that used a signal lists those signal ids, so the UI can show the exact NSQ or recall rows that moved the score.

**Start-up check:** if the weights do not sum to 1, the service stops at start-up with a clear error. It never normalizes silently.

**Edge cases:** a manufacturer with enough data and no signals gets full value on the NSQ and recall factors; a manufacturer without enough data is cold start (5.2).

**Acceptance test:** the worked example above is a unit test and must give 69.

### 5.2 Cold-start fallback

**Purpose:** be fair to new or small manufacturers. Absence of public data is not evidence of poor quality.

**How it works**
1. Count the manufacturer's matched signals and products.
2. If signals < 3 **and** products < 3 **and** there is no HIGH-severity signal, skip the factor calculation.
3. Return the regulatory-tier baseline as the score (STRICT_REGULATORY 80, CDSCO_GMP 60, UNKNOWN 30), band **LimitedData**, and a single factor line named `coldStartBaseline` saying 'Limited public data available. Score is a baseline from the regulator tier. No penalty applied.'
4. The UI shows a grey 'Limited data' badge with a tooltip, and these products are still listed, never hidden.

**Edge case:** a new manufacturer that already has a HIGH-severity signal is not cold start. Its factors are calculated normally.

**Acceptance test:** a manufacturer with zero signals and one product returns LimitedData and is never labelled Low.

### 5.3 Calibration

**Purpose:** sanity check that the formula behaves like an informed person would expect.

**How it works:** `config/reference.json` holds 10 to 15 manufacturers with an expected band and a reason, reviewed by the mentor. The calibration script scores each and prints expected vs computed with a MISMATCH marker. Humans adjust weights in small steps and re-run. Every change and reason is logged for the report. The script never edits weights by itself.

### 5.4 Logistic regression risk model (proof of concept)

**Purpose:** learn from past outcomes whether the factor values predict later serious problems.

**How it works**
1. Pick a cutoff date (`config/model.json`). **Features** are the factor values computed only from data before the cutoff.
2. The **label** is 1 if the manufacturer had a HIGH-severity recall or an NSQ after the cutoff, otherwise 0.
3. Train with ml-logistic-regression using cross-validation, because the dataset is small.
4. Report accuracy, precision, recall, F1 and a confusion matrix, and compare with a majority-class baseline and the rule score alone.
5. In 'blended' mode: final score = (1 - alpha) x rule score + alpha x (100 - 100 x risk probability). Alpha is in config (default 0.3).
6. Explain the model through its coefficients: show the top three drivers in the factor breakdown.
7. Cold-start manufacturers skip the model.

**Honesty rule:** if the model does not beat the baseline, say so. Describe it as a proof of concept, not a validated clinical tool. Details are in Section 25.

---

## 6. AI layer features

### 6.1 LLM client

**Purpose:** one place for all LLM calls so you can swap providers without touching the features.

**How it works:** `generateJson({system, user, schema})` picks the provider from `LLM_PROVIDER` (gemini, groq, ollama, anthropic). It uses temperature 0, a timeout, retries with exponential backoff on rate-limit and server errors, a requests-per-minute limiter, and a disk cache keyed by the hash of provider, model and prompt in `/data/cache`. It strips code fences, parses JSON, and throws a typed `LlmParseError` if the result is not valid JSON.

### 6.2 Structured extraction

**Purpose:** turn messy NSQ, recall or inspection text into clean fields.

**How it works**
1. Take a Signal's raw text.
2. Send it with a prompt that says: use only this text, return null for anything not stated, never guess, return JSON only.
3. Expected JSON: manufacturer, drug, batch, issueType, severity, date, confidence (0 to 1).
4. Validate with zod.
5. Run the **hallucination check**: the extracted manufacturer and drug must appear (fuzzily) in the raw text.
6. Set `needsReview = true` under the triggers in Section 15.4.
7. Save as an Extraction with model name and prompt version. The original Signal is never overwritten.
8. Only approved or high-confidence extractions are allowed to fill gaps (such as a missing severity) in scoring inputs.

**Acceptance test:** on a gold set of hand-labelled rows, report field-level accuracy. A gibberish input must end in the review queue.

### 6.3 Plain-language justification

**Purpose:** a 2 to 3 sentence explanation a patient can understand.

**How it works**
1. The input is only the finished score object. The LLM is told to rephrase it and not to add anything.
2. After generation, a checker confirms every number and every factor or manufacturer name in the text appears in the input.
3. If the check fails or the LLM is unavailable, a deterministic template sentence is built from the top contributing factors.
4. The API returns `{ text, source }` where source is 'llm' or 'template', and the result is cached by score hash.

**Example output:** 'This manufacturer scores 69 (Moderate). It has an approved equivalent product and about nine years on the market, but two quality-failure alerts in the last two years lowered the score.'

### 6.4 Human review queue

**How it works:** an admin screen or API lists every Extraction and Signal marked needsReview or UNMATCHED or REVIEW. The reviewer sees the raw text next to the extracted JSON, can approve, correct fields, or reject, and the system stores who reviewed and when. After approval, the score is recomputed for the affected manufacturer. The full workflow is in Section 20.

---

## 7. API features

The complete request and response contract (with examples, error codes and validation rules) is in **Section 14**. Summary of endpoints and their users:

| Endpoint | Used by |
|---|---|
| GET /api/health | Deployment health check |
| GET /api/meta | All pages (demo flag) |
| GET /api/search | Search bar, scanner |
| GET /api/drugs/:id/equivalents | Results list, doctor widget |
| GET /api/products/:id/evidence | Evidence panel, drawer |
| GET /api/lookup | Scanner |
| GET /api/config/nti | Doctor widget |
| POST /api/substitutions/confirm | Doctor modal |
| Admin routes (API key) | Review screen |

All inputs are validated, all lists are paginated, errors have one consistent JSON shape, and the client and server agree on field names (for example `score`, `band`, `pricePerUnit`).

---

## 8. Patient app features

### 8.1 Search

User types a brand or salt. After a 300 ms pause the app calls the search API and shows suggestions. A typo such as 'amlodpine' still returns amlodipine through the fuzzy fallback. If nothing matches, the screen says no data was found and suggests checking the spelling or scanning the pack. Selecting a result opens the equivalents page.

### 8.2 Ranked equivalents and savings

The page shows the searched medicine at the top, then equivalent products ranked by trust score and price. Each row shows manufacturer, brand, price, price per unit, trust badge, and a savings tag.

**Savings rule:** savings per unit = searched brand price per unit minus equivalent price per unit; percent = savings divided by the searched price. Example: brand Rs 12 per tablet and generic Rs 3 gives Rs 9 saved, 75 percent. If either price is missing or the pack sizes are not comparable, no savings number is shown rather than a wrong one.

| Brand per unit | Generic per unit | Shown |
|---|---|---|
| Rs 12 | Rs 3 | Rs 9, 75% |
| Rs 12 | Rs 12 | no savings tag |
| Rs 12 | missing | no savings number |
| missing | Rs 3 | no savings number |
| Rs 5 | Rs 8 (more expensive) | no savings tag |

Jan Aushadhi items carry a tag. Limited-data items are shown with their grey badge, not hidden. Users can switch sorting between 'Trust' and 'Price'.

### 8.3 Trust badge

- **High** green, **Moderate** amber, **Low** red, **Limited data** grey.
- Every badge also has text, so the meaning never depends on colour alone.
- The grey tooltip says: 'Little public data is available for this manufacturer. No penalty has been applied.'

### 8.4 Evidence panel

Tapping 'Why this score?' expands a panel. It shows the score and band, a bar for each factor with its contribution in points, the plain-language justification, and a list of evidence (type, date, severity, reason, and a link to the source). Source links open in a new tab with `rel='noopener noreferrer'`. At the bottom, it shows the data date and the disclaimer.

### 8.5 Scanner

- **Barcode or QR mode:** the camera starts after permission. A scanned code is looked up through the API. A match opens the equivalents page. An unknown code shows a message and offers text search. The camera stops when the page closes.
- **Strip photo mode (stretch):** the user takes or uploads a photo. Tesseract.js reads the text in the browser. The app extracts candidate words, fuzzy-matches them against the search API, and shows the top three matches. **The user must pick one**; nothing is selected automatically. A note says OCR can be wrong.
- Camera denied, no camera or unsupported browser falls back to manual search with a clear message.

### 8.6 States and accessibility

Every data view has loading, empty, no-data and error-with-retry states. The layout works on a phone first. Interactive parts are keyboard-usable and labelled. A fixed footer on every page says: 'MediTrust is decision support only. It is not medical advice and does not replace a doctor or pharmacist.'

---

## 9. Doctor widget features

### 9.1 Ranked table

A compact table of the same equivalents: manufacturer, price, savings, badge, band, an Evidence link (opens the evidence panel in a drawer), and a 'Propose substitution' button. The widget is an embeddable component (`DoctorWidget.jsx` with props `drugId`, `brandId`, `onConfirm`) with a separate build entry, and the /doctor page uses it. The narrow-therapeutic-index list comes from `GET /api/config/nti`, not from a hardcoded array.

### 9.2 Confirm-required substitution

1. Doctor presses 'Propose substitution'.
2. A modal summarizes: current product, proposed product, price difference, trust band, any Limited data warning, and a highlighted warning if the drug is on the narrow-therapeutic-index list.
3. The Confirm button is **disabled** until the doctor ticks 'I have reviewed the evidence and take clinical responsibility'.
4. Confirm sends `POST /api/substitutions/confirm`. The server rejects it if `acknowledgement` is not true, and otherwise writes an AuditLog entry (who, from, to, time, band shown).
5. Esc or Cancel closes the modal with no request sent.
6. Nothing is ever submitted automatically, on page load, or on a timer. In this prototype the confirmation records an audit entry only and does not connect to any real prescribing system.

The widget never labels a product as 'best for this patient'. It only presents ranked information.

---

## 10. Platform features

- **Admin protection:** admin routes need an API key in the `x-api-key` header; the key is only in environment variables. If the key is unset on the server, all admin routes reject every request.
- **Demo mode:** when the app runs on the demo database, `/api/meta` says so and the UI shows a 'DEMO DATA' banner. Synthetic records use fictional manufacturer names and say 'Synthetic demo record' as their source.
- **Security basics:** helmet headers, CORS limited to the client URL (the server refuses to start in production without `CORS_ORIGIN`), rate limiting, request size limits, no secrets in code.
- **Deployment:** backend on Render free tier (sleeps when idle, so wake it before a demo), frontend on Vercel (with `vercel.json` SPA rewrites), database on Atlas M0, tests run by GitHub Actions on every push.

## 11. End-to-end walkthrough (what should happen)

1. A CDSCO PDF is dropped into the raw folder and the NSQ script runs. Rows become Signals; a row naming 'Beta Sample Labs' is linked to that manufacturer, and a doubtful name goes to review.
2. The extraction job runs on pending signals. One has low confidence and appears in the review queue. The reviewer approves it.
3. The scoring job recomputes scores. Beta Sample Labs drops from High to Moderate because of a new NSQ, and the factor breakdown shows exactly which signal caused it.
4. A patient searches 'amlodpine', gets amlodipine 5 mg, and sees ranked equivalents with savings and badges.
5. The patient opens 'Why this score?' for the second product and sees the factor bars, the justification, and the link to the CDSCO source.
6. A doctor opens the widget for the same drug, proposes a substitution, sees the warning, ticks the box, confirms, and an AuditLog entry appears.
7. Everywhere, the disclaimer is visible, and nothing was changed without a human click.

## 12. Feature acceptance checklist

- Re-running any ingestion script creates no duplicates and logs inserted vs updated counts.
- 10 sampled NSQ rows and 10 sampled price rows match their sources.
- A wrong manufacturer merge cannot happen without human review.
- The worked scoring example returns 69, and a data-less manufacturer returns LimitedData.
- Every score, price and signal shown in the UI carries source, link and date.
- Extraction output is always validated, and doubtful items reach the review queue.
- The justification text never contains a number or name absent from the score object.
- No code path submits a substitution without the checkbox and the confirm click.
- Every page shows the disclaimer.
- Every UI feature has a matching API route, and the field names match on both sides.
- The frontend contains no hardcoded drug, price or score data.
- The whole system runs on free tiers.

## 13. Known limitations to state in the report

- Orange Book is US data and is linked to Indian products only by salt, strength and form.
- NSQ PDFs are parsed with imperfect accuracy; the measured accuracy should be reported.
- Labelled outcome data is small, so the logistic regression model is a proof of concept.
- Barcode lookup works only for products in the pilot barcode table; strip OCR can misread text.
- The score reflects public regulatory data, not clinical outcomes in individual patients.
- The prototype does not connect to real prescribing or pharmacy systems.

---

## 14. API contract

All responses are JSON. Success lists use `{ data: [...], pagination: {...} }`. Single items use `{ data: {...} }`. All errors use `{ error: { code, message, details? } }`. Pagination object: `{ page, limit, total, pages }`.

**Common error codes:** `INVALID_PARAM` (400), `INVALID_ID` (400), `NOT_FOUND` (404), `UNAUTHORIZED` (401), `RATE_LIMITED` (429), `ACKNOWLEDGEMENT_REQUIRED` (400), `INTERNAL` (500).

### 14.1 GET /api/health

Response 200: `{ status: 'ok', db: 'connected' | 'disconnected', uptime: 123.4 }`

### 14.2 GET /api/meta

Response 200: `{ demo: false, service: 'meditrust-server', version: '1.0.0', dataUpdatedAt: '2026-10-30' }`

The client must read `demo` from here, never from a constant.

### 14.3 GET /api/search?q=&page=&limit=

- `q` is required (1 to 80 characters). Missing or empty returns 400 `INVALID_PARAM`.
- Method: MongoDB text index first; if fewer than 3 results, fuzzy match (fast-fuzzy) on brand names and salts.
- No results returns 200 with an empty list and a message.

Response 200:
```json
{
  "data": [
    { "type": "brand", "id": "665f...", "name": "Amlokind-5", "drugId": "664a...", "salt": "amlodipine", "strength": "5 mg", "form": "tablet" },
    { "type": "drug", "id": "664a...", "salt": "amlodipine", "strength": "5 mg", "form": "tablet" }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 2, "pages": 1 },
  "message": null
}
```
Empty: `{ "data": [], "pagination": {...total: 0}, "message": "No medicines found. Check the spelling or try scanning the pack." }`

### 14.4 GET /api/drugs/:id/equivalents?brandId=&sort=trust|price&page=&limit=

- `:id` must be a valid ObjectId (else 400 `INVALID_ID`; unknown id returns 404 `NOT_FOUND`).
- Returns all products with the same salt, strength and form.
- Default sort `trust`: score descending, then pricePerUnit ascending. `price` sorts by pricePerUnit ascending.
- `savings` is computed only when `brandId` is given and both prices and pack sizes are comparable; otherwise `null`.
- `LimitedData` items are included and flagged.

Response 200:
```json
{
  "data": [
    {
      "productId": "666a...",
      "manufacturer": { "id": "663b...", "name": "Example Pharma Ltd", "country": "IN", "regulatoryTier": "CDSCO_GMP" },
      "brand": "ExampleAmlo 5",
      "price": 30.0,
      "packSize": 10,
      "pricePerUnit": 3.0,
      "savings": { "amount": 9.0, "percent": 75.0, "versusBrand": "Amlokind-5" },
      "score": 69,
      "band": "Moderate",
      "teCode": "AB",
      "isJanAushadhi": false,
      "provenance": { "sourceName": "Indian medicines dataset", "sourceUrl": "https://example.org/dataset", "date": "2026-10-01" }
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 7, "pages": 1 },
  "searched": { "drugId": "664a...", "brand": "Amlokind-5", "pricePerUnit": 12.0 }
}
```

### 14.5 GET /api/products/:id/evidence

Response 200:
```json
{
  "data": {
    "productId": "666a...",
    "manufacturer": { "id": "663b...", "name": "Example Pharma Ltd" },
    "score": 69,
    "band": "Moderate",
    "version": "rules-v1",
    "computedAt": "2026-11-01T10:00:00Z",
    "factors": [
      { "name": "regulatoryApproval", "value": 1.0, "weight": 0.20, "contribution": 0.200, "explanation": "Approved with A-rated TE code", "evidence": [] },
      { "name": "recentNsq", "value": 0.5, "weight": 0.25, "contribution": 0.125, "explanation": "2 NSQ alerts in the last 24 months", "evidence": ["sig1", "sig2"] }
    ],
    "evidence": [
      { "id": "sig1", "type": "NSQ", "date": "2026-03-01", "severity": "MEDIUM", "batch": "B123", "reason": "Dissolution failure", "sourceName": "CDSCO NSQ alert", "sourceUrl": "file: nsq-2026-03.pdf" }
    ],
    "justification": { "text": "This manufacturer scores 69 (Moderate)...", "source": "llm" },
    "literature": [ { "title": "...", "year": 2021, "pmid": "12345678", "url": "https://pubmed.ncbi.nlm.nih.gov/12345678/" } ],
    "disclaimer": "MediTrust is decision support only. It is not medical advice and does not replace a doctor or pharmacist."
  }
}
```
`justification.source` is `llm` or `template`. A LimitedData product returns one factor named `coldStartBaseline`.

### 14.6 GET /api/lookup?code=

- `code` required, 4 to 64 characters.
- Found: 200 `{ data: { type: 'brand'|'drug', id, name, drugId, salt, strength, form } }`
- Not found: 404 `{ error: { code: 'NOT_FOUND', message: 'Code not recognised. Try searching by name.' } }`

### 14.7 GET /api/config/nti

Response 200: `{ data: [ { "salt": "warfarin", "note": "Narrow therapeutic index: confirm with prescriber" } ] }`. Source file: `config/nti.json`. The client must use this and not a hardcoded list.

### 14.8 POST /api/substitutions/confirm

Request body (validated with zod):
```json
{ "fromProductId": "666a...", "toProductId": "666b...", "clinician": "Dr. Example", "acknowledgement": true }
```
- `acknowledgement` must be exactly `true`; otherwise 400 `ACKNOWLEDGEMENT_REQUIRED`.
- Writes one `AuditLog` (clinician, from, to, bandShown, flags such as `nti` and `limitedData`, timestamp).
- Never modifies Product or Score data.
- Response 201: `{ data: { auditId, createdAt } }`.

### 14.9 Admin routes (header `x-api-key` required; 401 if missing or wrong; 401 for all if `ADMIN_API_KEY` is unset)

| Route | Behaviour |
|---|---|
| POST /api/admin/extract/run | Body `{ limit?: number }`. Runs extraction on pending signals in batches. Response 200 `{ data: { processed, needsReview, failed } }`. |
| GET /api/admin/review?status=needsReview\|unmatched\|all&page= | Lists review items: signal id, raw text, extracted JSON, confidence, reasons for review, candidate manufacturer matches. |
| PATCH /api/admin/review/:id | Body `{ action: 'approve'\|'correct'\|'reject', corrections?: {...}, reviewer: string }`. Stores reviewer and time. Approve or correct triggers a score recompute for the affected manufacturer. Response 200 with the updated item and the new score. |
| GET /api/admin/audit?page= | Lists AuditLog entries. |

---

## 15. Severity, status and lifecycle tables

### 15.1 Severity rules

| Source | Condition | Severity |
|---|---|---|
| openFDA | Class I | HIGH |
| openFDA | Class II | MEDIUM |
| openFDA | Class III | LOW |
| CDSCO NSQ | reason contains spurious, adulterated, counterfeit or fake (list in `config/severity.json`) | HIGH |
| CDSCO NSQ | any other NSQ reason | MEDIUM |
| Any | cannot be determined | UNKNOWN |

The raw openFDA classification is stored in a separate field (`rawClassification`).

### 15.2 Signal matchStatus

| Status | Meaning | Who sets it | Allowed next states |
|---|---|---|---|
| MATCHED | linked to a manufacturer with score >= 0.92 or by a reviewer | pipeline or reviewer | REVIEW |
| REVIEW | doubtful match (0.75 to 0.92) or unparseable row, needs a human | pipeline | MATCHED, UNMATCHED |
| UNMATCHED | no acceptable manufacturer found | pipeline | MATCHED (after review) |

Only MATCHED signals count in scoring.

### 15.3 Extraction lifecycle

`pending` (no Extraction yet) -> `extracted` (needsReview false, confidence >= 0.7) or `needsReview` -> `approved` / `corrected` / `rejected` (reviewer, time stored). Only `extracted`, `approved` and `corrected` extractions may fill gaps such as a missing severity. `rejected` and `needsReview` are never used by scoring.

### 15.4 needsReview triggers

Any of: confidence < 0.7; JSON invalid after one retry; any key field (manufacturer, drug, issueType) is null; extracted manufacturer or drug does not appear (fuzzily) in the raw text.

---

## 16. Configuration files reference

| File | Contents (example) |
|---|---|
| `config/pilot.json` | `{ "salts": ["amlodipine", "telmisartan", "metformin"], "maxManufacturers": 30 }` |
| `config/weights.json` | `{ "version": "rules-v1", "weights": {...}, "bands": {"high": 75, "moderate": 50}, "teMapping": {"A": 1.0, "B": 0.3, "none": 0}, "tierValues": {...}, "tierBaselines": {...}, "coldStart": {"minSignals": 3, "minProducts": 3}, "nsq": {"windowMonths": 24, "cap": 4}, "recall": {"halfLifeMonths": 36, "cap": 6, "points": {"HIGH": 3, "MEDIUM": 2, "LOW": 1}}, "presence": {"capYears": 15}, "breadth": {"capProducts": 20}, "alpha": 0.3 }` |
| `config/matching.json` | `{ "high": 0.92, "low": 0.75, "legalSuffixes": ["ltd", "pvt", "limited", "inc", "pharma", "laboratories", "labs"] }` |
| `config/severity.json` | `{ "nsqHighKeywords": ["spurious", "adulterated", "counterfeit", "fake"], "openFda": {"Class I": "HIGH", "Class II": "MEDIUM", "Class III": "LOW"} }` |
| `config/nti.json` | list of narrow-therapeutic-index salts with a short note each (verify from a trusted reference before the demo) |
| `config/reference.json` | 10 to 15 manufacturers: `{ "name", "expectedBand", "reason", "reviewedBy" }` |
| `config/extraction-gold.json` | 5 or more hand-labelled raw texts with the correct JSON |
| `config/llm.json` | temperature, timeout, retries, requests per minute, confidence threshold |
| `config/model.json` | `{ "cutoffDate": "2023-01-01", "minLabelledManufacturers": 30, "folds": 5 }` |
| `config/security.json` | rate limits, body limit, allowed origins by environment |

No constant listed in Section 0 may be hardcoded in application code.

## 17. Data sources

| Source | File or API | Key fields | Notes |
|---|---|---|---|
| FDA Orange Book | `products.txt` from the downloadable ZIP, delimiter `~` | Ingredient, DF;Route, Trade_Name, Applicant, Strength, Appl_Type, Appl_No, Product_No, TE_Code, Approval_Date, RLD, RS, Type, Applicant_Full_Name | US data. Linked to Indian products by salt, strength and form only. Blank TE code = null. |
| Indian medicines CSV (Kaggle) | CSV in `data/raw/indian-meds/` | brand name, composition, manufacturer, price, pack size (verify the exact column names of the file you downloaded and write them here) | Check the dataset licence. Quality varies: expect missing prices and pack sizes. |
| Jan Aushadhi (PMBJP) list | CSV or Excel in `data/raw/jan-aushadhi/` | drug name, strength, pack size, price | Low-cost reference. Sets `isJanAushadhi = true`. |
| CDSCO NSQ and spurious alerts | monthly PDFs in `data/raw/cdsco/`, named like `nsq-YYYY-MM.pdf` | drug name, batch, manufacturer, reason, sampling authority | Tables break across lines. Parsing accuracy must be measured and reported. Date comes from the alert month. |
| openFDA drug enforcement | `https://api.fda.gov/drug/enforcement.json` | `openfda.generic_name`, `recalling_firm`, `classification`, `reason_for_recall`, `recall_initiation_date`, `report_date`, `product_description`, `recall_number` | Free, optional API key. Dates are `YYYYMMDD`. |
| PubMed E-utilities | `esearch` then `efetch` | title, year, PMID, abstract | Optional supporting literature. Not a scoring input. |
| NPPA ceiling prices | optional list | drug, strength, ceiling price | Optional, used only to flag prices above the ceiling. |

Every ingested row stores `source: { name, url or filename, date }`.

## 18. Environment variables

| Variable | Required | Default | Used by |
|---|---|---|---|
| `NODE_ENV` | no | development | server |
| `PORT` | no | 5000 | server |
| `MONGODB_URI` | yes | none | server, scripts |
| `DEMO_MONGODB_URI` | for demo | none | seed scripts |
| `CORS_ORIGIN` | yes in production | `http://localhost:5173` in development | server |
| `ADMIN_API_KEY` | yes for admin routes | none (admin routes reject everything if unset) | server |
| `LLM_PROVIDER` | no | gemini | llmClient |
| `GEMINI_API_KEY` | if provider is gemini | none | llmClient |
| `GROQ_API_KEY` | if provider is groq | none | llmClient |
| `OLLAMA_URL` | if provider is ollama | `http://localhost:11434` | llmClient |
| `ANTHROPIC_API_KEY` | only if used | none | llmClient |
| `LLM_RPM` | no | 15 | llmClient |
| `OPENFDA_API_KEY` | no | none | openFDA ingestion |
| `VITE_API_URL` | yes in production | proxy `/api` in development | client |

`.env.example` must list all of these with empty values. Real values are never committed.

## 19. Non-functional requirements

- **Disclaimer text (exact):** "MediTrust is decision support only. It is not medical advice and does not replace a doctor or pharmacist." Shown on every patient and doctor screen and in the confirm modal.
- **Performance targets (demo data):** search and equivalents respond in under 1 second; evidence under 1.5 seconds; first load of the free Render service may take up to 60 seconds (wake before the demo).
- **Security:** helmet headers; CORS limited to the client origin (no `*` in production, the server refuses to start in production without `CORS_ORIGIN`); rate limits per Section 0; body limit 100 kb; all inputs validated with zod; admin routes protected; no secrets in the repo or git history.
- **Accessibility:** keyboard navigation, labelled controls, `aria-expanded` on collapsibles, colour is never the only signal (text labels on every badge), contrast of at least 4.5:1 for text.
- **Browsers and devices:** latest Chrome, Edge, Firefox and Safari; phone width of 360 px and up; camera features need HTTPS or localhost.
- **Logging:** a small logger utility, no `console.log` in final code, no personal data or keys in logs.
- **Compatibility:** all npm scripts run on Windows PowerShell and Linux.
- **Privacy:** no patient data is collected. The only personal data in the system is the clinician name or id in the AuditLog.

## 20. Review and admin workflow

1. Open `/admin` and enter the admin key (kept in memory for the session only).
2. The page shows a queue with tabs: **Needs review** and **Unmatched or doubtful**.
3. Each item shows: raw text, the extracted JSON, confidence, the reasons it needs review (from Section 15.4), and for matching items the candidate manufacturers with scores.
4. Actions: **Approve** (use as is), **Correct** (edit fields, then save), **Reject** (ignore this item). Each action stores `reviewer` and time.
5. After approve or correct, the affected manufacturer's score is recomputed and the item leaves the queue. Reject leaves the score unchanged.
6. The audit tab lists confirmed substitutions (read only).
7. Every action is recorded; nothing in the review flow deletes source data.

## 21. Barcode lookup and demo mode

### 21.1 Barcode collection

Fields: `code` (unique string), `type` (`brand` or `drug`), `refId`, `source`, `addedAt`. Seeded with a script for pilot products only. Indian pack barcodes usually carry only a product code, so unknown codes are expected; they return 404 with a message and the UI offers text search.

### 21.2 Demo mode

- Demo data lives in a separate database (`DEMO_MONGODB_URI`). The seed script refuses to run against the real database and offers `--reset`, which drops demo collections only.
- Every demo document has `isDemo: true`. `GET /api/meta` returns `demo: true` and the UI shows a 'DEMO DATA' banner.
- Synthetic manufacturers use fictional names only (for example 'Alpha Demo Pharma Ltd'). Synthetic signals say 'Synthetic demo record' as source name and use `https://example.com/demo` as the link. A synthetic signal is never attached to a real company name.
- Demo scenarios: high trust, moderate, low trust (3 NSQ plus a recall), cold start (new company, no signals), and one narrow-therapeutic-index drug. Expected bands: High, Moderate, Low, LimitedData.
- Demo seed goes through the same normalization, matching and scoring code as real data.

## 22. Traceability matrix

| Feature | Spec | API | UI component | Test file | QA IDs |
|---|---|---|---|---|---|
| Orange Book import | 4.1 | (script) | n/a | `ingestion.test.js` | A1 |
| Indian medicines import | 4.2 | (script) | n/a | `ingestion.test.js` | A2 |
| Jan Aushadhi import | 4.3 | (script), equivalents | JanAushadhiTag | `ingestion.test.js` | A3 |
| Entity resolution | 4.4 | (script), admin review | Admin review page | `matching.test.js` | A4 |
| CDSCO NSQ ingestion | 4.5 | (script) | n/a | `nsq.test.js` | A5 |
| openFDA recalls | 4.6 | (script) | n/a | `recalls.test.js` | A6 |
| Idempotency | 4.7 | (scripts) | n/a | `ingestion.test.js` | A7 |
| PubMed literature | 4.8 | evidence | EvidencePanel | `pubmed.test.js` | A8 |
| Rule-based score | 5.1 | evidence | EvidencePanel | `scoring.test.js` | B1 to B3 |
| Cold start | 5.2 | equivalents, evidence | TrustBadge | `scoring.test.js` | B4 |
| Calibration | 5.3 | (script) | n/a | `calibrate.test.js` | B5 |
| Risk model | 5.4 | (script) | n/a | `model.test.js` | B6 |
| LLM client | 6.1 | n/a | n/a | `llm.test.js` | C1 |
| Extraction | 6.2 | admin extract | Admin review page | `extraction.test.js` | C2 |
| Justification | 6.3 | evidence | EvidencePanel | `justification.test.js` | C3 |
| Review queue | 6.4, 20 | admin routes | Admin review page | `admin.test.js` | C4 |
| Search and typo fallback | 8.1 | GET /api/search | SearchBar | `search.test.js` | D2, E1 |
| Equivalents and savings | 8.2 | GET /api/drugs/:id/equivalents | ResultsList, SavingsTag | `equivalents.test.js` | D2, E2 |
| Trust badge | 8.3 | equivalents | TrustBadge | `TrustBadge.test.jsx` | E3 |
| Evidence panel | 8.4 | GET /api/products/:id/evidence | EvidencePanel | `EvidencePanel.test.jsx` | D2, E4 |
| Scanner | 8.5 | GET /api/lookup | Scan page | `lookup.test.js` | D2, E5 |
| States and accessibility | 8.6 | n/a | all pages | component tests | E6 |
| Doctor table and widget | 9.1 | equivalents, GET /api/config/nti | DoctorWidget | `DoctorWidget.test.jsx` | F1, F2 |
| Confirm-required substitution | 9.2 | POST /api/substitutions/confirm | ConfirmModal | `substitution.test.js` | F3, F4 |
| Admin protection | 10 | admin routes | Admin page | `admin.test.js` | G3 |
| Demo mode | 21 | GET /api/meta | DemoBanner | `demo.test.js` | G2 |
| Provenance | 2 | all data routes | all lists | `provenance.test.js` | G1 |
| Deployment | 10 | GET /api/health | n/a | CI workflow | G5 |

Rename test files to match your repo. Every row must have a test; any empty cell is a gap to fix.

## 23. Out of scope

- Integration with real prescribing, e-prescription or pharmacy systems (the prototype only records an audit entry).
- Drugs outside the pilot list, and combination (multi-salt) drugs.
- User accounts, login for patients, and storing any patient data.
- Real-time price updates and online purchase.
- Clinical recommendations for an individual patient.
- Scraping websites (only downloaded files and official APIs are used).
- Native mobile apps (the web app is mobile-friendly).

## 24. Test strategy and definition of done

**Test layers**
- Unit tests: normalization, parsing, each scoring factor, cold start, time decay, blend formula, LLM validation and hallucination check.
- API tests: supertest with `mongodb-memory-server`, covering every endpoint in Section 14 for success, validation errors and empty results.
- Component tests: SearchBar, TrustBadge (all four bands), EvidencePanel, ConfirmModal, DoctorWidget, Scan page error states.
- QA script: `/qa/checks.mjs` runs the live checks reported in `/qa/REPORT.md`.

**Required fixtures and cases**
- Worked example gives exactly 69 and band Moderate.
- A manufacturer with no signals and one product is `LimitedData`, never `Low`.
- A new manufacturer with one HIGH recall is not cold start.
- A future-dated signal changes nothing.
- TE code mapping A, B, none.
- Weights that do not sum to 1 make the service fail at start-up with a clear error.
- Entity matching: 20 variant pairs with at least 5 that must not merge.
- Confirm endpoint rejects a missing or false acknowledgement with 400.
- Admin routes reject a missing key, a wrong key and an unset server key.
- Justification containing an invented number or name falls back to the template.

**Rules**
- A test may never be weakened, skipped or special-cased to make it pass.
- A task is done when code, tests, README section and a verification note exist, and server tests, client tests and the client build all pass.
- Items needing a browser or real data files are marked UNVERIFIED until a human checks them.

## 25. Risk model details

- **Cutoff:** features use only signals before `cutoffDate`; labels use signals after it. A test must prove no leakage.
- **Label:** 1 if the manufacturer had a HIGH-severity recall or an NSQ after the cutoff, else 0.
- **Minimum data:** train only if at least 30 labelled manufacturers exist and at least 5 are positive. Otherwise the script prints 'insufficient data' and the blended mode stays off.
- **Validation:** stratified k-fold (default 5) or repeated hold-out. Report accuracy, precision, recall, F1 and the confusion matrix, and compare with the majority-class baseline and with the rule score alone.
- **Blend:** `final = (1 - alpha) * ruleScore + alpha * (100 - 100 * riskProbability)`. Cold-start manufacturers skip the model.
- **Explainability:** show the top three coefficient drivers in the factor breakdown (`modelContribution`).
- **Honest reporting:** if the model does not beat the baseline, the report says so. The model is called a proof of concept, not a validated clinical tool.

## 26. Glossary

| Term | Meaning |
|---|---|
| NSQ | Not of Standard Quality: a drug batch declared failing quality tests by CDSCO |
| Spurious drug | A drug that is counterfeit or falsely labelled |
| CDSCO | Central Drugs Standard Control Organisation (India's drug regulator) |
| SUGAM | CDSCO's online portal for drug regulatory approvals |
| TE code | Therapeutic Equivalence code in the FDA Orange Book (A-rated means considered substitutable) |
| NTI | Narrow therapeutic index: small dose changes can cause failure or toxicity, so substitution needs extra care |
| PMBJP / Jan Aushadhi | Government scheme selling low-cost generic medicines |
| NPPA | National Pharmaceutical Pricing Authority (sets ceiling prices) |
| Bioequivalence | Evidence that two products release the same amount of drug at the same rate |
| Cold start | A manufacturer with too little public data to score fairly |
| Provenance | The source, link and date behind a figure |
| Decision support | Information that helps a human decide; it does not decide |
| Entity resolution | Matching different spellings of a company name to one record |
| Idempotent | Running a script again gives the same result without duplicates |

## 27. Change log

| Version | Date | Change | By |
|---|---|---|---|
| 1.0 | 2026-11-02 | First full functional specification | team |
| 1.1 | 2026-11-02 | Added decisions table, API contract, lifecycle tables, config, data sources, env vars, NFRs, review workflow, demo rules, traceability, test strategy, glossary | team |

Update this table whenever the spec changes, and put the spec version in each QA report.