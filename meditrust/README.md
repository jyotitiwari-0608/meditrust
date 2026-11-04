# MediTrust

MERN-stack decision-support platform showing cost-ranked generic equivalents of a medicine
with an explainable manufacturer trust score. College minor project — **FREE tools only**.

## Stack
- Server: Node.js, Express, Mongoose, ES modules
- Client: React + Vite, React Router
- Database: MongoDB Atlas M0 free tier
- LLM: provider-agnostic (`server/services/llmClient.js`) — Gemini / Groq / Ollama / Anthropic

## Core rules
- Every score/figure carries source provenance (source name, URL, date).
- Trust score = transparent weighted sum; per-factor breakdown returned with the score.
- Sparse-data manufacturers get a cold-start "Limited data" baseline, never penalized.
- LLM returns JSON only, grounded in provided facts, outputs confidence; low confidence → `needsReview=true`.
- Never auto-prescribes. Substitution requires an explicit confirm click.
- Every patient/doctor screen shows a decision-support disclaimer.
- Small tested modules; `.env` for secrets; a README section per feature.

## Repository layout
```
/meditrust
  /server          Express, Mongoose, services/, ingestion/, routes/, models/, scripts/
  /client          React + Vite (patient app + /doctor widget)
  /data            raw downloads (never committed if large)
  /config          pilot.json, weights.json, reference.json, narrowTherapeuticIndex.json
  /prompts         LLM prompt templates
  AGENTS.md        agent context
  prompts.md       build plan & free replacements
  render.yaml      Render deployment
  README.md        this file
```

## Quick start

### Prerequisites
- Node.js 18+
- MongoDB Atlas M0 cluster (free) or local MongoDB
- A free LLM API key (Google AI Studio Gemini, Groq, or Ollama locally)

### 1. Clone & install
```bash
cd meditrust
cd server && npm install && cd ..
cd client && npm install && cd ..
```

### 2. Environment
```bash
cd server
cp .env.example .env
# edit .env: set MONGODB_URI, LLM_PROVIDER, API keys, CORS_ORIGIN
cd ..
```

### 3. Seed the database
```bash
cd server
npm run seed
cd ..
```

### 4. Run dev
Terminal A (server):
```bash
cd server
npm run dev
```
Terminal B (client):
```bash
cd client
npm run dev
```
Client: http://localhost:5173  |  Server: http://localhost:4000  |  Health: http://localhost:4000/health

## Data sources (free)
- FDA Orange Book (TE codes) — downloadable products.txt
- openFDA drug enforcement API (recalls)
- CDSCO monthly NSQ / spurious drug alert PDFs
- Kaggle Indian medicines dataset (brand/composition/manufacturer/price)
- PMBJP / Jan Aushadhi price list & NPPA ceiling prices
- PubMed E-utilities (bioequivalence abstracts)

See `prompts.md` for download steps and the pilot category (antihypertensives).

## Ingestion scripts (`server/ingestion/`)
- `orangeBook.js` — FDA Orange Book products.txt → Drug/Manufacturer/Product + TE codes
- `indianMeds.js` — Kaggle CSV → normalized salt/strength/form
- `janAushadhi.js` — Jan Aushadhi price list → low-cost generic reference
- `cdscoNsq.js` — CDSCO NSQ PDFs (pdf-parse) → Signal (NSQ)
- `openFdaRecalls.js` — openFDA enforcement API → Signal (RECALL)

All idempotent, pilot-category restricted (`config/pilot.json`), log counts.

## Scoring (`server/services/scoring.js`)
Factors (weights in `config/weights.json`):
- regulatory approval / TE code
- recent NSQ count
- recall history (severity-weighted, time-decayed)
- years of market presence
- number of approved products
- regulatory tier

Output: `{ score 0-100, band: High|Moderate|Low|LimitedData, factors[{name, value, weight, contribution, evidence}] }`.
Cold-start: few signals/products → regulatory-tier baseline, band `LimitedData`, no penalty.

Tests: `npm test` (vitest) — 7 scoring tests + 6 LLM tests.

### Calibration
```bash
cd server
npm run seed
node scripts/calibrate.js   # expected vs computed for 15 reference manufacturers
```

## Risk model (`server/scripts/trainRiskModel.js`)
Time-split labelled dataset (no leakage): label=1 if serious NSQ/recall after split date.
Trains `ml-logistic-regression` on rule-based factors, reports accuracy/precision/recall,
saves weights to `config/model_weights.json`. Documented small-data limitation.

```bash
node scripts/trainRiskModel.js
```

## LLM (`server/services/llmClient.js`, `prompts/`)
- Provider switch via `LLM_PROVIDER` (gemini/groq/ollama/anthropic), retries + rate-limit backoff.
- `extraction.js`: signal text → strict JSON `{manufacturer, drug, batch, issueType, severity, date, confidence}`; invalid JSON or confidence < 0.7 → `needsReview=true`.
- `justification.js`: score object → 2-3 sentence plain-language explanation with fact post-check; falls back to template.

## API
- `GET /health`
- `GET /api/search?q=` — text index + fuzzy fallback, paginated
- `GET /api/drugs/:id/equivalents` — same salt/strength/form, sorted by score then price, with savings vs reference
- `GET /api/products/:id/evidence` — factor breakdown + provenance source links
- `POST /api/audit` — log confirmed substitutions

## Patient UI (`/`)
- SearchBar (debounced), ResultsList ranked equivalents, TrustBadge (green/amber/red/grey), SavingsTag, expandable EvidencePanel, persistent disclaimer footer, loading/empty/no-data states.

## Favorites
- Select an equivalent from search results to add it to the Favourites section. Remove it there to unsave it.
- Favorites persist in the current browser using local storage; they are not synced across browsers or devices.

## About and Contact sections
- About summarizes the medicine search, comparison, and evidence review journey.
- Contact displays clearly labeled fictional demo identities and placeholder details; it does not send or receive messages.

## Scan (`/scan`)
- html5-qrcode barcode/QR + Tesseract.js photo-of-strip OCR; fuzzy match against `/api/search`; confirm matches; camera-permission error handling + manual search fallback.

## Doctor widget (`/doctor`)
- Ranked equivalents table with score, price, evidence link.
- "Propose substitution" → confirmation modal (change summary, narrow-TI risk flags, explicit checkbox + confirm click, never auto-submit).
- Confirmed actions logged to `audit` collection.

## Deployment
- Server: Render (`render.yaml`), health check at `/health`
- Client: Vercel (build output `client/dist`)
- Set `MONGODB_URI` Atlas IP allowlist to include Render outbound IPs / VPC.

## Demo script
With `DEMO_MODE=true` in `server/.env`, the server starts an isolated in-memory MongoDB and automatically loads the fictional demo fixtures. No Atlas URI or LLM API key is needed. Demo data is reset when the server stops, so restarting it restores the fixture data. Run the client separately with `cd client && npm run dev` and open `http://localhost:5173`.

1. Search 3 drugs (amlodipine, telmisartan, metformin) — view ranked equivalents + savings.
2. Select a cold-start manufacturer — confirm "Limited data" band, no penalty.
3. Trigger an extraction on an ambiguous signal — observe `needsReview=true` (low confidence).
4. Doctor: propose a substitution → check the narrow-TI risk flag → tick the checkbox → confirm → audit log entry.

## CI
`.github/workflows/test.yml` — runs `npm test` and client build on push/PR using a service-container MongoDB.

---

*Decision-support disclaimer: MediTrust provides information only, not medical advice. Scores are decision support and do not replace a clinician's judgement. Any substitution requires an explicit confirm click and clinician review.*
