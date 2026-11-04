import fs from "fs";
import path from "path";
import { generateText } from "./llmClient.js";

const templatePath = path.join(process.cwd(), "prompts", "justification.txt");
const JUSTIFICATION_TEMPLATE = fs.existsSync(templatePath)
  ? fs.readFileSync(templatePath, "utf8")
  : null;

function templateJustification(scoreObj) {
  return `This manufacturer has a trust score of ${scoreObj.score} out of 100, rated ${scoreObj.band}. The score is built from weighted factors including regulatory approval, NSQ/recall signals, market presence, product count, and regulatory tier.`;
}

function numbersIn(text) {
  return [...text.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
}

function allNumbersPresent(text, scoreObj) {
  const inputNumbers = new Set(
    numbersIn(JSON.stringify(scoreObj)).filter((n) => n >= 0 && n <= 100)
  );
  for (const n of numbersIn(text)) {
    if (n >= 0 && n <= 100 && !inputNumbers.has(n)) return false;
  }
  return true;
}

function namesIn(text, scoreObj) {
  const names = [];
  if (scoreObj.factors) {
    for (const f of scoreObj.factors) {
      if (f.name) names.push(f.name);
    }
  }
  if (names.length === 0) return true;
  const lower = text.toLowerCase();
  return names.some((n) => lower.includes(n.toLowerCase()));
}

export function buildJustificationPrompt(scoreObj) {
  if (JUSTIFICATION_TEMPLATE) {
    return JUSTIFICATION_TEMPLATE.replace("{score}", JSON.stringify(scoreObj, null, 2));
  }
  return `Justify this score in 2-3 sentences using only input facts: ${JSON.stringify(scoreObj)}`;
}

export async function justifyScore(scoreObj, { providerOverride } = {}) {
  const prompt = buildJustificationPrompt(scoreObj);
  let text;
  try {
    text = await generateText(prompt, { providerOverride });
  } catch (err) {
    return { text: templateJustification(scoreObj), source: "template" };
  }
  text = (text || "").trim();
  if (!text || !allNumbersPresent(text, scoreObj) || !namesIn(text, scoreObj)) {
    return { text: templateJustification(scoreObj), source: "template" };
  }
  return { text, source: "llm" };
}
