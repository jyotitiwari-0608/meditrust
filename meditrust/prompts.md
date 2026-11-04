You are fixing MediTrust based on an independent QA report. Inputs: /qa/REPORT.md
(findings), docs/SPEC.md (the intended behaviour), AGENTS.md (rules). Work in
the current git branch.

DECISION (made by me, do not override):
- Scoring weights and bands: [CHOOSE ONE and delete the other]
  (A) follow docs/SPEC.md: weights approval 0.20, nsq 0.25, recall 0.20,
      presence 0.10, breadth 0.05, tier 0.20; bands High>=75, Moderate 50-74,
      Low<50.
  (B) keep config/weights.json as it is, and update docs/SPEC.md section 5.1
      (weights, bands and the worked example result) to match it.

GOAL: (1) fix everything in the report that can be fixed by changing code,
config, tests or docs, and test each fix; (2) clearly list what you could not
fix and what I must do.

HARD RULES
- Never weaken, delete, skip or special-case a test, a check, or a threshold to
  make something pass. Never hardcode expected outputs. If a check is wrong
  per the spec, say so and explain, but do not edit it silently.
- Never invent data, sample rows, API keys, CDSCO records or manufacturer
  facts. Use fixtures only inside tests, clearly named as fixtures.
- Do not run `npm audit fix --force` or upgrade major versions unless the full
  test suite and build pass afterwards; if they fail, revert that upgrade.
- Do not touch anything not tied to a finding. Keep each change minimal.
- Keep AGENTS.md rules: provenance on every figure, no penalty for missing
  data, LLM never changes a score, no auto-prescribing, free tools only.
- Do not commit secrets or modify .env; edit .env.example only.
- If a requirement is ambiguous or needs a decision from me, do not guess:
  put it in the 'Needs you' list and move on.

WORK PLAN (do in this order; after each group run the full server tests and
the client build, then re-run only the related checks from /qa/checks.mjs; fix
regressions before moving on; commit each group separately with a clear message)

GROUP 0: schema and data contract
 - Product.isJanAushadhi (Boolean, default false), set in janAushadhi.js,
   returned by the equivalents API.
 - Equivalents API returns provenance {sourceName, sourceUrl, date} per item.
 - Blank TE code stored as null, not ''. Add a migration script.
 - All ingestion scripts log rows read, inserted, updated, skipped, errors
   (use bulkWrite results). Skip and count multi-ingredient rows.
 - openFDA: map Class I/II/III to HIGH/MEDIUM/LOW; keep the raw class in a
   separate field; add a migration for existing rows.
 - CDSCO: HIGH if the reason contains keywords from config (spurious,
   adulterated, counterfeit, fake), else MEDIUM; an empty-text PDF is logged as
   'needs OCR/manual entry' and does not crash.

GROUP 1: entity resolution (highest risk, do carefully)
 - config/matching.json with high=0.92 and low=0.75. Score >= high: auto-match
   and store the alias. Between: do NOT merge, write the pair (incoming name,
   best match, score) to a review collection or data/review/manufacturer-
   matches.json and mark the signal REVIEW. Below low: UNMATCHED or new
   manufacturer. Log the thresholds used.
 - Tests with 20 variant pairs including at least 5 pairs that must NOT merge.

GROUP 2: scoring (apply my DECISION above)
 - Ignore future-dated signals. Use the TE code in the approval factor
   (A=1.0, B=0.3, none/null=0, mapping in config). Cold start applies only if
   signals are below the minimum AND there is no HIGH-severity signal.
 - Throw a clear error at start-up if weights do not sum to 1 (no silent
   normalising). Return computedAt and version from the scoring function.
 - Calibrate script prints a MISMATCH marker and never writes weights.json.
 - Risk model: majority-class baseline and rule-score comparison in the
   metrics, blended mode (1-alpha)*rule + alpha*(100-100*p) with alpha in
   config, cold start skips the model, limitation note printed. Test the
   blended formula with a hand-calculated example.
 - Verify the SPEC worked example gives the result in the (final) spec.

GROUP 3: API and security
 - POST /api/substitutions/confirm: zod validation, acknowledgement must be
   literally true (400 otherwise), writes AuditLog (who, from, to, band shown,
   timestamp), never modifies Product or Score. The doctor UI calls it only
   from the explicit Confirm click (button disabled until the checkbox is
   ticked). Remove the old /api/audit write path from the UI.
 - Admin API-key middleware (x-api-key vs ADMIN_API_KEY; reject if unset) and
   routes: POST /api/admin/extract/run, GET /api/admin/review,
   PATCH /api/admin/review/:id (approve/correct/reject, store reviewer and
   time, recompute the affected manufacturer's score), GET /api/admin/audit.
   Add a minimal /admin review page in the client.
 - Barcode model, seed script and GET /api/lookup?code= (clear not-found
   response). GET /api/config/nti serving config/nti.json; the doctor UI reads
   it instead of a hardcoded array.
 - express-rate-limit; keep the 100kb body limit; CORS_ORIGIN required when
   NODE_ENV=production (fail fast, no '*' fallback).
 - Fuzzy typo fallback in /api/search (fast-fuzzy) so 'amlodpine' finds
   amlodipine.

GROUP 4: AI layer
 - llmClient: disk cache keyed by hash(provider, model, prompt) in /data/cache
   (gitignored), a requests-per-minute limiter from env, and a typed
   LlmParseError.
 - Extraction: hallucination check (extracted manufacturer and drug must
   fuzzily appear in the raw text) and needsReview on null key fields.
 - Justification returns {text, source:'llm'|'template'}, falls back to the
   template if any number or name is not in the input; the LLM only ever
   receives the score object. Update the evidence API and its consumers.

GROUP 5: frontend
 - Remove demoDrugs/demoEvidence and the hardcoded DEMO_MODE from
   client/src/api.js; derive demo mode from /api/meta. All data comes from the
   API.
 - Doctor widget as an embeddable DoctorWidget.jsx (props drugId, brandId,
   onConfirm) with a separate Vite build entry; the page uses the component.
 - Make sure every route renders the disclaimer footer, and add component
   tests for SearchBar, TrustBadge (4 bands), EvidencePanel, and the doctor
   modal (Confirm disabled until the checkbox is ticked, Cancel/Esc send no
   request).

GROUP 6: housekeeping
 - Add vercel.json (SPA rewrites) and make render.yaml, CI workflow and
   .env.example consistent with the env vars used in code.
 - Dependencies: inspect the csv-parse and zod audit findings, state whether the
   vulnerable paths are used, apply a safe upgrade only if all tests and the
   build pass; otherwise leave and report.
 - Fix the 'npm test' script so it works on Windows PowerShell and Linux
   (e.g. call 'vitest run' directly).
 - If docs/SPEC.md and implementation still differ for a reason I chose, update
   the spec and list the change.

FINAL VERIFICATION
 1. Run server tests, client tests, client build, npm audit --omit=dev.
 2. Re-run /qa/checks.mjs and write /qa/REPORT_AFTER.md with a table:
    ID | before | after | evidence (command output or file:line) | note.
    Use PASS only with evidence; use UNVERIFIED when it needs data or a browser.
 3. Show the before/after counts and the git log of your commits.

FINAL ANSWER FORMAT (exactly these sections)
 1. FIXED: list by group with the files changed and the tests added.
 2. NOT FIXED / NOT FULLY FIXED: for each item: ID, reason (missing data, needs
    browser, needs my decision, needs external account/credentials, breaking
    upgrade, out of scope), and the exact steps I must perform, with
    commands or click paths.
 3. NEEDS MY DECISION: questions with your recommended option and why.
 4. RISKS AND ASSUMPTIONS: anything you assumed, any behaviour you changed
    beyond the report, and any test you modified (with justification).
 5. MANUAL CHECKLIST for the mentor demo: what to click and the expected result.
Be literal and honest. If you did not run something, say so. If you are unsure
a fix is correct, mark it 'needs review' instead of claiming success.