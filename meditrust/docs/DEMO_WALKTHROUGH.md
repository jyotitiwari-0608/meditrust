# MediTrust Demo Walkthrough

Run the ENTIRE pipeline in 5 minutes against synthetic demo data. No MongoDB setup required — the seed script starts an in-memory database.

## Prerequisites

```bash
cd meditrust/server
npm install
cd ../client && npm install && cd ..
```

## Step 0: Seed the demo database (run once)

```bash
cd server
npm run seed:demo:all
```

Expected output: "Demo seed complete.", "Scored N demo manufacturers.", "Extracted N demo snippets (cached mode).", then a PASS/FAIL summary table.

To reset and re-seed:
```bash
npm run seed:demo:reset -- --reset
npm run seed:demo:all
```

## Step 1: Start the servers

Terminal A (server, demo mode):
```bash
cd server
DEMO_MODE=true npm run dev
```

Terminal B (client):
```bash
cd client
npm run dev
```

Open http://localhost:5173 — you should see a **DEMO DATA** banner at the top.

## Step 2: Show raw input (NSQ snippet + source PDF row)

Go to the seed data directly. The 6 raw snippets live in `data/demo/fixtures.json` → `rawTexts`.

Example snippet to show:
> "Gamma Test Remedies batch GT-2024-095 contaminated; recall initiated immediately."

Source: `Synthetic demo record` | `https://example.com/demo`

## Step 3: Run extraction and show structured JSON

The extraction step was already run during `seed:demo:all`. To re-run live extraction:

```bash
npm run seed:demo:extract
```

Expected: each snippet returns JSON `{manufacturer, drug, batch, issueType, severity, date, confidence}`.
- Snippet 5 ("A batch of unknown origin...") → `confidence: 0.45`, `needsReview: true`
- All others → `confidence > 0.7`, `needsReview: false`

If no LLM API key is set, cached responses from `data/demo/llm-cached.json` are used (logged as "cached mode").

## Step 4: Show signal linked to manufacturer via fuzzy matching (incl. one unmatched)

The signal for "Unverified Herbal Co" (batch UH-2024-110) is UNMATCHED — no fictional manufacturer with that name exists, so it is flagged for manual review.

All other signals are fuzzy-matched to their fictional manufacturer (e.g. "Gamma Test Remedies" → Gamma Test Remedies).

## Step 5: Show score with factor breakdown (scenarios a, c, d) + LimitedData

Call the evidence endpoint for each scenario product:

- **a. HIGH TRUST** — Alpha Demo Pharma Ltd / AlphaAmlod 5 (amlodipine)
  `GET /api/products/<id>/evidence` → band **High**, factors shown, no signals
- **c. LOW TRUST** — Gamma Test Remedies / GammaLo 5 (amlodipine)
  `GET /api/products/<id>/evidence` → band **Low**, 3 recent NSQ + 1 HIGH recall
- **d. COLD START** — Delta Newco Pharma / DeltaDip 5 (amlodipine)
  `GET /api/products/<id>/evidence` → band **Limited data**, tier-3 baseline, no penalty

## Step 6: Search 'amlodipine' and typo 'amlodpine'

Use the search bar at http://localhost:5173:

- Search **amlodipine** → 8 ranked equivalents, sorted by trust score then price
- Search **amlodpine** (typo) → fuzzy fallback still returns amlodipine results

Verify:
- Savings tag shown (vs highest-MRP reference brand AlphaAmlod 5 at ₹45.00)
- Trust badges: green (High), amber (Moderate), red (Low), grey (Limited data)
- Jan Aushadhi products at the bottom (cheapest: ₹9.50 / ₹11.00)
- Click "Show evidence" → factor breakdown + source links

## Step 7: Show LLM justification + template fallback

The justification is generated from the score object. With no LLM key, the template fallback is used:

> "This manufacturer has a trust score of X out of 100, rated Y. The score is built from weighted factors including regulatory approval, NSQ/recall signals, market presence, product count, and regulatory tier."

## Step 8: Doctor widget — propose substitution (NTI warning + confirm)

Go to http://localhost:5173/doctor:

1. Search **metformin**
2. Pick a generic equivalent → click **Propose substitution**
3. Confirmation modal shows: from-brand, to-brand, price, score, band
4. If the drug is in `data/demo/config/nti.json` (e.g. warfarin, digoxin), a **NARROW TI** risk tag appears
5. Check the checkbox ("I confirm...") then click **Confirm substitution**
6. Entry is written to the audit collection

Expected: nothing is submitted without the checkbox + confirm click (no auto-prescribe).

## Step 9: Scanner — QR codes for 2 demo products

QR images were to be generated into `data/demo/qr/`. In this demo, use the manual search fallback on the Scan page:
1. Go to http://localhost:5173/scan
2. Type "amlodipine" → confirm a match
3. Camera QR mode requires browser camera permission (optional)

## Step 10: Calibration table + logistic regression metrics

```bash
cd server
node scripts/calibrate.js
node scripts/trainRiskModel.js
```

Expected: accuracy/precision/recall printed, weights saved to `config/model_weights.json`, with the honest note that the labelled dataset is small (proof-of-concept only).

## Expected results summary

| Scenario | Manufacturer | Drug | Expected Band |
|---|---|---|---|
| a. High trust | Alpha Demo Pharma Ltd | amlodipine 5 mg | High |
| b. Moderate | Beta Sample Labs | amlodipine 5 mg | Moderate |
| c. Low trust | Gamma Test Remedies | amlodipine 5 mg | Low |
| d. Cold start | Delta Newco Pharma | amlodipine 5 mg | Limited data |
| e. NTI | (doctor widget) | metformin 500 mg | NARROW TI warning |

If any step fails, check the server console for errors and confirm `DEMO_MODE=true` is set.
