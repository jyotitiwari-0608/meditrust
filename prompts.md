Write ingestion scripts in /server/ingestion:
1. orangeBook.js: read the downloaded FDA Orange Book products.txt (path from env),
   parse the ~ delimited file, and upsert Drug, Manufacturer and Product with TE codes.
2. indianMeds.js: import a Kaggle CSV of Indian medicines (brand, composition,
   manufacturer, price) with csv-parse and normalize composition into salt+strength+form.
3. janAushadhi.js: import the Jan Aushadhi price list CSV as the low-cost generic reference.
Restrict to the pilot category list in config/pilot.json. Make scripts idempotent
and log counts. Include a normalizeName() util and fuzzy manufacturer matching with fast-fuzzy.

Create ingestion/cdscoNsq.js: take CDSCO monthly NSQ/spurious drug alert PDFs from
/data/raw, extract text with pdf-parse, and split into rows (drug, batch,
manufacturer, reason). Save raw rows as Signal documents (type NSQ) with the
source filename/URL and date. Create ingestion/openFdaRecalls.js using the free
openFDA drug enforcement API (axios, rate-limit aware, paginated) to store RECALL
signals for the pilot drugs. Link each signal to a manufacturer using the fuzzy
matcher and mark unmatched ones for manual review.

Implement server/services/scoring.js. Factors (weights in config/weights.json):
regulatory approval/TE code, recent NSQ count, recall history (severity-weighted,
time-decayed), years of market presence, number of approved products, regulatory
tier of country. Return {score 0-100, band: High|Moderate|Low|LimitedData,
factors:[{name, value, weight, contribution, evidence:[signal ids]}]}.
Cold-start: if fewer than N signals/products, use the regulatory-tier baseline and
band=LimitedData with no penalty. Add unit tests (Vitest/Jest) including edge cases.
Add a script that scores 15 reference manufacturers from config/reference.json
and prints expected vs computed for calibration.

Build routes: GET /api/search?q= (text index plus fuzzy fallback on brand/salt),
GET /api/drugs/:id/equivalents (same salt/strength/form, sorted by trust score then
price, returning price, savings vs the searched brand, score, band, and provenance),
GET /api/products/:id/evidence (factor breakdown plus source links). Add pagination,
validation (zod), error handling and clear "no data" responses.

In /client build the patient app: SearchBar with debounce, ResultsList of ranked
equivalents, TrustBadge (green/amber/red/grey for Limited data), SavingsTag, and an
expandable EvidencePanel that shows factor breakdown and source links. Handle
loading, empty and "no data" states. Mobile-first, accessible, with a persistent
disclaimer footer. Use React Router and a small api.js wrapper.

Implement server/services/llmClient.js with a provider switch (gemini/groq/ollama/
anthropic) via env, with retries and rate-limit backoff. Then:
1. extraction.js: given the raw text of an NSQ/recall/inspection signal, return strict
   JSON {manufacturer, drug, batch, issueType, severity, date, confidence}. Validate with
   zod; on invalid JSON or confidence < 0.7 set needsReview=true. Use temperature 0.
2. justification.js: given ONLY the structured score object, produce a 2-3 sentence
   plain-language explanation. Post-check that every number and fact in the output
   exists in the input; otherwise fall back to a template string.
Include the prompt templates in /server/prompts and tests with mocked LLM responses.

Add a Scan page: use html5-qrcode for barcode/QR, and a "photo of strip" mode that
runs Tesseract.js in the browser, extracts candidate drug names, fuzzy-matches them
against /api/search, and shows the top matches for the user to confirm. Add
camera-permission error handling and a manual search fallback.


Create a /doctor route with a compact table widget (embeddable as a standalone
component) showing ranked equivalents with score, price, and an "evidence" link.
Add a "Propose substitution" button that opens a confirmation modal summarizing
the change, risks (flag narrow-therapeutic-index drugs via a config list) and
requires an explicit checkbox plus a confirm click. Never auto-submit. Log
confirmed actions to an audit collection.

Build scripts/trainRiskModel.js: create a labelled dataset where label=1 if a
manufacturer had a serious recall/NSQ in a later time window than the feature
window (avoid leakage by splitting on time). Features: the rule-based factors.
Train with ml-logistic-regression, report accuracy/precision/recall on a held-out
split, save weights to JSON, and add a scoring mode that blends the rule score and
model probability. Keep the factor breakdown explainable using the coefficients.
Document the small-data limitation in the output.