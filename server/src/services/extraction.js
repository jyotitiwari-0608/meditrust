import { z } from 'zod';
import { Extraction, Signal } from '../models/index.js';
import {
  callLLM as defaultCallLLM,
  loadPrompt,
  parseLLMJson,
} from './llmClient.js';

export const EXTRACTION_CONFIDENCE_THRESHOLD = 0.7;

export const extractionSchema = z
  .object({
    manufacturer: z.string().trim().nullable(),
    drug: z.string().trim().nullable(),
    batch: z.string().trim().nullable(),
    issueType: z.enum(['NSQ', 'RECALL', 'INSPECTION', 'APPROVAL', 'OTHER']),
    severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
    date: z.string().trim().nullable(),
    confidence: z.number().min(0).max(1),
  })
  .strict();

const SYSTEM_PROMPT =
  'You are a careful pharmaceutical data extractor. Return strict JSON only and never invent facts.';

export async function extractSignal(rawText, options = {}) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('extractSignal requires raw signal text.');
  }

  const callLLM = options.callLLM ?? defaultCallLLM;
  const promptTemplate = options.promptTemplate ?? loadPrompt('extraction');
  const prompt = `${promptTemplate}\n\nSIGNAL TEXT:\n"""\n${rawText}\n"""`;

  let text;
  try {
    text = await callLLM({
      system: SYSTEM_PROMPT,
      prompt,
      temperature: 0,
      maxTokens: 512,
      jsonMode: true,
    });
  } catch (error) {
    return {
      data: null,
      confidence: 0,
      needsReview: true,
      reason: `LLM call failed: ${error.message}`,
    };
  }

  let parsed;
  try {
    parsed = parseLLMJson(text);
  } catch (error) {
    return {
      data: null,
      confidence: 0,
      needsReview: true,
      reason: `Invalid JSON: ${error.message}`,
      raw: text,
    };
  }

  const validated = extractionSchema.safeParse(parsed);
  if (!validated.success) {
    return {
      data: null,
      confidence: 0,
      needsReview: true,
      reason: 'Extraction failed schema validation',
      details: validated.error.issues,
      raw: text,
    };
  }

  if (validated.data.confidence < EXTRACTION_CONFIDENCE_THRESHOLD) {
    return {
      data: validated.data,
      confidence: validated.data.confidence,
      needsReview: true,
      reason: `Low confidence (${validated.data.confidence})`,
      raw: text,
    };
  }

  return {
    data: validated.data,
    confidence: validated.data.confidence,
    needsReview: false,
    raw: text,
  };
}

export async function extractAndStore(signalId, options = {}) {
  const signal = await Signal.findById(signalId).lean();
  if (!signal) throw new Error('Signal not found.');

  const result = await extractSignal(signal.rawText ?? '', options);

  const extraction = await Extraction.create({
    signal: signal._id,
    json: result.data ?? { raw: result.raw ?? null, reason: result.reason },
    confidence: result.confidence,
    needsReview: result.needsReview,
  });

  return { result, extraction };
}
