You are helping build "MediTrust", a MERN-stack decision-support platform that
shows cost-ranked generic equivalents of a medicine with an explainable
manufacturer trust score. It's a college minor project, so everything must use
FREE tools only (MongoDB Atlas M0, Render/Vercel free tiers, free LLM API,
open-source libraries).

Rules:
- Stack: Node.js, Express, Mongoose, React + Vite. Use ES modules.
- Every score/figure shown to a user must carry source provenance (source name, URL, date).
- Trust score = transparent weighted sum of factors; return the per-factor breakdown with the score.
- Manufacturers with sparse data get a "cold-start" baseline and are never penalized for missing data; label them "Limited data".
- LLM calls go through server/services/llmClient.js (provider-agnostic: gemini | groq | ollama | anthropic, chosen by env var). The LLM must return JSON only, grounded strictly in provided text/facts, never invent claims, and output a confidence value; low confidence sets needsReview=true.
- The system never auto-prescribes. Any substitution action requires an explicit confirm click.
- Every patient/doctor screen shows a decision-support disclaimer.
- Write small, tested modules, use .env for secrets, and add a README section for each feature.
Confirm you understand, then wait for my next instruction.