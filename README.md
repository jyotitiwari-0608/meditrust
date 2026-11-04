# MediTrust

MediTrust is a MERN-stack decision-support platform that shows cost-ranked
generic equivalents of a medicine alongside an explainable manufacturer trust
score. It is a college minor project built entirely on free tools and
open-source libraries.

MediTrust never prescribes. It presents evidence for a clinician or patient to
review, and any substitution requires an explicit confirmation.

## Stack

- **Server:** Node.js, Express, Mongoose, dotenv, cors, helmet, morgan (ES modules)
- **Client:** React + Vite
- **Database:** MongoDB Atlas M0 free tier
- **Tests:** Node's built-in test runner (`node:test`)

## Project structure

```
meditrust/
  package.json            npm workspaces root
  server/
    .env.example
    src/
      app.js              Express app (security, CORS, logging, routes)
      index.js            server bootstrap and graceful shutdown
      config/db.js        MongoDB connection helpers
      models/             Mongoose models and shared provenance schema
      routes/health.js    GET /health and GET /api/health
      seed/seed.js        sample catalogue, signals, scores, extractions
    test/                 model and health-route tests
  client/
    vite.config.js        dev proxy to the API
    src/
      App.jsx             scaffold dashboard with health status
      components/         Disclaimer
      lib/api.js          API helpers
```

## Quick start

```powershell
# 1. Install all workspace dependencies
npm install

# 2. Configure the server
Copy-Item server\.env.example server\.env
# Edit server\.env and set MONGODB_URI to your MongoDB Atlas connection string

# 3. Seed sample data
npm run seed

# 4. Run the API (terminal 1)
npm run dev:server

# 5. Run the client (terminal 2)
npm run dev:client
```

- API: http://localhost:5000
- Health: http://localhost:5000/health
- Client: http://localhost:5173

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `MONGODB_URI` | yes | - | MongoDB Atlas connection string |
| `PORT` | no | `5000` | API port |
| `NODE_ENV` | no | `development` | Logging format |
| `CLIENT_ORIGIN` | no | `*` | Allowed CORS origin(s), comma-separated |
| `LOW_CONFIDENCE_THRESHOLD` | no | `0.6` | Extractions below this are flagged for review |

Secrets live only in `server/.env`, which is git-ignored. Commit
`server/.env.example` instead.

## Features

### Monorepo scaffold

The root `package.json` uses npm workspaces so `npm install` sets up both
packages. `server` and `client` are independent ES-module packages.

### Health check

`GET /health` (also `GET /api/health`) returns:

```json
{
  "status": "ok",
  "service": "meditrust-api",
  "db": "connected",
  "uptime": 42,
  "timestamp": "2026-10-27T09:00:00.000Z"
}
```

The route works even when the database is down; `db` reports the current
Mongoose connection state. The client dashboard calls it through the Vite dev
proxy.

### Data models

| Model | Fields |
| --- | --- |
| `Drug` | `salt`, `strength`, `form`, `atcCode` |
| `Brand` | `name`, `manufacturer`, `drug`, `source` |
| `Manufacturer` | `name`, `aliases[]`, `country`, `regulatoryTier` |
| `Product` | `drug`, `manufacturer`, `brand`, `mrp`, `teCode`, `source` |
| `Signal` | `product`/`manufacturer` ref, `type` (`NSQ`/`RECALL`/`INSPECTION`/`APPROVAL`), `date`, `severity`, `sourceName`, `sourceUrl`, `rawText` |
| `Score` | `product`, `value`, `factors[]`, `computedAt`, `version` |
| `Extraction` | `signal`, `json`, `confidence`, `needsReview` |

Signals must reference at least one product or manufacturer. `teCode` is unique
when present. All models use timestamps.

### Search indexes

MongoDB text indexes are defined for the fields users search:

- `Drug`: `salt`, `atcCode`
- `Brand`: `name`
- `Manufacturer`: `name`, `aliases`
- `Signal`: `rawText`, `sourceName`

Compound indexes support common lookups such as products by drug and price,
signals by manufacturer and date, and scores by product and date.

### Seed data

`npm run seed` clears the MediTrust collections and inserts:

- 3 manufacturers (one deliberately sparse, `Acme Generics`)
- 3 drugs, 5 brands, 5 products
- 4 signals across all signal types
- 4 scores with full per-factor breakdowns
- 4 extractions, including one low-confidence extraction that is automatically
  flagged `needsReview: true`

The seed is destructive by design so it can be re-run for a clean demo.

### Trust score transparency

A score is a weighted sum of named factors. Each factor stores its `key`,
`label`, `weight`, `value`, `contribution` and its own provenance. Mongoose
validation enforces:

- factor weights sum to `1` (within `0.01`)
- `score.value` equals the sum of factor contributions (within `0.01`)
- at least one factor is present

The breakdown is stored with the score, so the UI can explain every point.

### Source provenance

`Product.source` and every `Score.factors[].source` use a shared provenance
shape: `sourceName`, `sourceUrl`, `sourceDate`. A product or factor cannot be
saved without complete provenance. Signals carry `sourceName` and `sourceUrl`
directly, with a required `date`.

### Cold-start handling

Manufacturers with sparse data are never penalised for missing fields. The
seed includes `Acme Generics` with sparse records and intentionally leaves it
without a score; the upcoming scoring service will assign a neutral cold-start
baseline and label the manufacturer "Limited data". The client already reserves
space to explain this.

### Extraction review

`Extraction` documents store the LLM's JSON output and a confidence value. When
`confidence < LOW_CONFIDENCE_THRESHOLD`, a validation hook forces
`needsReview: true`. The future LLM client will be provider-agnostic
(`gemini`, `groq`, `ollama`, `anthropic`), return JSON only, and stay grounded
in supplied facts.

### Safety guardrails

- Every patient/doctor screen includes a decision-support disclaimer.
- The system never auto-prescribes.
- Substitution actions require an explicit confirm click.

## Tests

```powershell
npm test
```

The suite covers model validation rules (provenance, signal subjects, weighted
score sums, low-confidence review flags) and the `/health` and 404 routes.

## Free-tier notes

- MongoDB Atlas M0 is sufficient for the seeded catalogue and demo traffic.
- The API is designed to deploy on Render's free tier; the Vite client on
  Vercel's free tier.
- No paid APIs are required for this scaffold.
