import fs from "fs";
import path from "path";
import { z } from "zod";
import { generateJson } from "./llmClient.js";
import { matchManufacturer } from "../utils/fuzzy.js";

const extractionSchema = z.object({
  manufacturer: z.string().nullable().optional(),
  drug: z.string().nullable().optional(),
  batch: z.string().nullable().optional(),
  issueType: z.enum(["NSQ", "RECALL", "INSPECTION", "APPROVAL"]).nullable().optional(),
  severity: z.enum(["low", "medium", "high", "critical"]).nullable().optional(),
  date: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1),
});

const templatePath = path.join(process.cwd(), "prompts", "extraction.txt");
const EXTRACTION_TEMPLATE = fs.existsSync(templatePath)
  ? fs.readFileSync(templatePath, "utf8")
  : null;

export function buildExtractionPrompt(text) {
  if (EXTRACTION_TEMPLATE) return EXTRACTION_TEMPLATE.replace("{text}", text);
  return `Extract JSON from: ${text}\nReturn {manufacturer, drug, batch, issueType, severity, date, confidence}.`;
}

function fuzzyContains(text, needle) {
  if (!text || !needle) return false;
  const t = String(text).toLowerCase();
  const n = String(needle).toLowerCase();
  return t.includes(n);
}

export async function extractSignal(rawText, { signalId, providerOverride } = {}) {
  const prompt = buildExtractionPrompt(rawText);
  let parsed;
  let valid = false;
  try {
    parsed = await generateJson(prompt);
    const result = extractionSchema.safeParse(parsed);
    valid = result.success;
    parsed = result.success ? result.data : parsed;
  } catch (err) {
    parsed = { confidence: 0 };
    valid = false;
  }
  const confidence = Number(parsed.confidence || 0);
  const manufacturer = parsed.manufacturer || null;
  const drug = parsed.drug || null;

  // Hallucination check: manufacturer and drug must appear (fuzzily) in the raw text.
  const mfrPresent = manufacturer ? fuzzyContains(rawText, manufacturer) : true;
  const drugPresent = drug ? fuzzyContains(rawText, drug) : true;
  const hallucinationCheck = mfrPresent && drugPresent;

  // Null key field check.
  const keyFieldsPresent = manufacturer !== null && drug !== null;

  const needsReview = !valid || confidence < 0.7 || !hallucinationCheck || !keyFieldsPresent;
  const out = {
    signal: signalId || null,
    json: parsed,
    confidence,
    needsReview,
    provider: providerOverride || process.env.LLM_PROVIDER || "gemini",
  };
  return out;
}

export { extractionSchema };
