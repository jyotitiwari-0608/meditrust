import crypto from "crypto";
import fs from "fs";
import path from "path";
import axios from "axios";

class LlmParseError extends Error {
  constructor(message, raw) {
    super(message);
    this.name = "LlmParseError";
    this.raw = raw;
  }
}

const PROVIDER = process.env.LLM_PROVIDER || "gemini";
const TEMPERATURE = 0;
const CACHE_DIR = path.join(process.cwd(), "data", "cache");
const RPM = parseInt(process.env.LLM_RPM || "20", 10);

const requestTimes = [];

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function cacheKey(provider, model, prompt) {
  const hash = crypto.createHash("sha256").update(`${provider}:${model}:${prompt}`).digest("hex");
  return path.join(CACHE_DIR, `${hash}.json");
}

function rateLimitWait() {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const recent = requestTimes.filter((t) => now - t < windowMs);
  if (recent.length >= RPM) {
    const oldest = recent[0];
    return windowMs - (now - oldest);
  }
  return 0;
}

function recordRequest() {
  requestTimes.push(Date.now());
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function extractJson(text) {
  const bt = String.fromCharCode(96);
  const fence = bt + bt + bt;
  const cleaned = text
    .split(fence + "json").join("")
    .split(fence).join("")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch (_) {
    const start = cleaned.indexOf("{");
    if (start === -1) throw new LlmParseError("no JSON object found", text);
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (inString) { if (ch === '"') inString = false; continue; }
      if (ch === '"') { inString = true; continue; }
      if (ch === "{") depth++;
      if (ch === "}") {
        depth--;
        if (depth === 0) return JSON.parse(cleaned.slice(start, i + 1));
      }
    }
    throw new LlmParseError("no JSON object found", text);
  }
}

async function callWithBackoff(fn, { retries = 3 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err.response ? err.response.status : null;
      const retryable = status === 429 || status === 408 || (status && status >= 500);
      if (!retryable || i === retries) throw err;
      const wait = Math.pow(2, i) * 1000 + Math.floor(Math.random() * 500);
      await sleep(wait);
    }
  }
  throw lastErr;
}

async function callGemini(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set");
  const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const res = await axios.post(
    url,
    { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: TEMPERATURE } },
    { timeout: 60000 }
  );
  return res.data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function callGroq(prompt) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY not set");
  const model = process.env.GROQ_MODEL || "llama-3.1-8b-instant";
  const res = await axios.post(
    "https://api.groq.com/openai/v1/chat/completions",
    { model, messages: [{ role: "user", content: prompt }], temperature: TEMPERATURE },
    { headers: { Authorization: `Bearer ${key}` }, timeout: 60000 }
  );
  return res.data.choices?.[0]?.message?.content || "";
}

async function callOllama(prompt) {
  const base = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  const model = process.env.OLLAMA_MODEL || "llama3.1:8b";
  const res = await axios.post(
    `${base}/api/chat`,
    { model, messages: [{ role: "user", content: prompt }], stream: false, options: { temperature: TEMPERATURE } },
    { timeout: 120000 }
  );
  return res.data.message?.content || "";
}

async function callAnthropic(prompt) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  const model = process.env.ANTHROPIC_MODEL || "claude-3-haiku-20240307";
  const res = await axios.post(
    "https://api.anthropic.com/v1/messages",
    { model, max_tokens: 512, temperature: TEMPERATURE, messages: [{ role: "user", content: prompt }] },
    { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" }, timeout: 60000 }
  );
  return res.data.content?.[0]?.text || "";
}

async function callOpenrouter(prompt) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY not set");
  const model = process.env.OPENROUTER_MODEL || "openrouter/auto";
  const res = await axios.post(
    "https://openrouter.ai/api/v1/chat/completions",
    { model, messages: [{ role: "user", content: prompt }], temperature: TEMPERATURE },
    { headers: { Authorization: `Bearer ${key}` }, timeout: 60000 }
  );
  return res.data.choices?.[0]?.message?.content || "";
}

function providerFn() {
  switch (PROVIDER) {
    case "gemini": return callGemini;
    case "groq": return callGroq;
    case "ollama": return callOllama;
    case "anthropic": return callAnthropic;
    case "openrouter": return callOpenrouter;
    default: throw new Error(`unsupported LLM_PROVIDER: ${PROVIDER}`);
  }
}

export async function generateJson(prompt, opts = {}) {
  const model = process.env[`${PROVIDER.toUpperCase()}_MODEL`] || "default";
  ensureCacheDir();
  const keyFile = cacheKey(PROVIDER, model, prompt);

  // Disk cache
  try {
    if (fs.existsSync(keyFile)) {
      const cached = JSON.parse(fs.readFileSync(keyFile, "utf8"));
      return cached;
    }
  } catch (_) {
    // ignore cache read errors
  }

  // Rate limiter
  const waitMs = rateLimitWait();
  if (waitMs > 0) await sleep(waitMs);
  recordRequest();

  const fn = providerFn();
  const text = await callWithBackoff(() => fn(prompt), opts);
  let parsed;
  try {
    parsed = extractJson(text);
  } catch (err) {
    if (err instanceof LlmParseError) throw err;
    throw new LlmParseError(err.message, text);
  }

  // Write to cache
  try {
    fs.writeFileSync(keyFile, JSON.stringify(parsed));
  } catch (_) {
    // ignore cache write errors
  }

  return parsed;
}

export async function generateText(prompt, opts = {}) {
  const model = process.env[`${PROVIDER.toUpperCase()}_MODEL`] || "default";
  ensureCacheDir();
  const keyFile = cacheKey(PROVIDER, model, prompt);

  try {
    if (fs.existsSync(keyFile)) {
      const cached = JSON.parse(fs.readFileSync(keyFile, "utf8"));
      return cached.text || cached;
    }
  } catch (_) {
    // ignore cache read errors
  }

  const waitMs = rateLimitWait();
  if (waitMs > 0) await sleep(waitMs);
  recordRequest();

  const fn = providerFn();
  const text = await callWithBackoff(() => fn(prompt), opts);

  try {
    fs.writeFileSync(keyFile, JSON.stringify({ text }));
  } catch (_) {
    // ignore cache write errors
  }

  return text;
}

export { PROVIDER, LlmParseError };
