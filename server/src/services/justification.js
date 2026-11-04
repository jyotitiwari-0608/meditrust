import { callLLM as defaultCallLLM, loadPrompt } from './llmClient.js';

const SYSTEM_PROMPT =
  'You explain trust scores using only the supplied facts. Never invent numbers or claims.';

const BANDS = ['LimitedData', 'High', 'Moderate', 'Low'];

function scoreValue(score) {
  return score?.score ?? score?.value ?? null;
}

function numbersIn(text) {
  return (String(text).match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
}

function collectNumbers(value, output = []) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    output.push(value);
    return output;
  }
  if (typeof value === 'string') {
    output.push(...numbersIn(value));
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectNumbers(item, output);
    return output;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectNumbers(item, output);
  }
  return output;
}

function numberExists(number, allowed) {
  return allowed.some((candidate) => Math.abs(candidate - number) <= 0.011);
}

function countSentences(text) {
  return (String(text).match(/[^.!?]+[.!?]+/g) ?? []).filter(
    (sentence) => sentence.trim().length > 0
  ).length;
}

export function validateJustification(text, score) {
  const clean = String(text ?? '').trim();
  if (!clean) return { valid: false, reason: 'Empty justification' };

  const sentenceCount = countSentences(clean);
  if (sentenceCount < 2 || sentenceCount > 3) {
    return {
      valid: false,
      reason: `Expected 2-3 sentences, received ${sentenceCount}`,
    };
  }

  const band = score?.band;
  if (band) {
    const mentioned = BANDS.filter((item) =>
      new RegExp(`\\b${item}\\b`, 'i').test(clean)
    );
    if (mentioned.length > 0 && !mentioned.some((item) => item === band)) {
      return {
        valid: false,
        reason: `Justification band does not match ${band}`,
      };
    }
  }

  const allowed = collectNumbers(score);
  const outputNumbers = numbersIn(clean);
  const invented = outputNumbers.filter((number) => !numberExists(number, allowed));
  if (invented.length > 0) {
    return {
      valid: false,
      reason: `Justification contains numbers absent from the score: ${invented.join(', ')}`,
    };
  }

  return { valid: true };
}

export function templateJustification(score) {
  const name = score?.manufacturer?.name ?? 'This manufacturer';
  const value = scoreValue(score);
  const band = score?.band ?? 'LimitedData';
  const factors = [...(score?.factors ?? [])].sort(
    (a, b) => (b.contribution ?? 0) - (a.contribution ?? 0)
  );
  const top = factors.slice(0, 2);

  const factorText = top
    .map(
      (factor) =>
        `${factor.label ?? factor.name} (${factor.value} out of 100, weight ${factor.weight})`
    )
    .join(' and ');

  const secondSentence = factorText
    ? `The largest contributors are ${factorText}.`
    : 'The score is based on the available regulatory and quality evidence.';

  return `${name} has a trust score of ${value} (${band}). ${secondSentence} This is decision-support only; confirm any substitution with a qualified clinician.`;
}

export async function justifyScore(score, options = {}) {
  const callLLM = options.callLLM ?? defaultCallLLM;
  const promptTemplate = options.promptTemplate ?? loadPrompt('justification');
  const prompt = `${promptTemplate}\n\nSCORE JSON:\n${JSON.stringify(score)}`;

  try {
    const text = await callLLM({
      system: SYSTEM_PROMPT,
      prompt,
      temperature: 0,
      maxTokens: 256,
      jsonMode: false,
    });

    const validation = validateJustification(text, score);
    if (!validation.valid) {
      return {
        text: templateJustification(score),
        source: 'template',
        reason: validation.reason,
      };
    }

    return { text: text.trim(), source: 'llm' };
  } catch (error) {
    return {
      text: templateJustification(score),
      source: 'template',
      reason: `LLM call failed: ${error.message}`,
    };
  }
}
