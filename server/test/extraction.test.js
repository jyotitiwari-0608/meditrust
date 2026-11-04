import { describe, expect, it } from 'vitest';
import { extractSignal } from '../src/services/extraction.js';

const validPayload = {
  manufacturer: 'Acme Generics Pvt Ltd',
  drug: 'Paracetamol',
  batch: 'ABC123',
  issueType: 'NSQ',
  severity: 'HIGH',
  date: '2026-02-10',
  confidence: 0.9,
};

function mockLLM(text) {
  return async () => text;
}

describe('extraction', () => {
  it('accepts valid high-confidence JSON', async () => {
    const result = await extractSignal('raw signal text', {
      callLLM: mockLLM(JSON.stringify(validPayload)),
    });

    expect(result.needsReview).toBe(false);
    expect(result.confidence).toBe(0.9);
    expect(result.data).toEqual(validPayload);
  });

  it('flags low confidence for review', async () => {
    const result = await extractSignal('raw signal text', {
      callLLM: mockLLM(
        JSON.stringify({ ...validPayload, confidence: 0.5 })
      ),
    });

    expect(result.needsReview).toBe(true);
    expect(result.reason).toMatch(/Low confidence/);
  });

  it('flags invalid JSON for review', async () => {
    const result = await extractSignal('raw signal text', {
      callLLM: mockLLM('not json at all'),
    });

    expect(result.needsReview).toBe(true);
    expect(result.data).toBeNull();
    expect(result.reason).toMatch(/Invalid JSON/);
  });

  it('flags schema violations for review', async () => {
    const result = await extractSignal('raw signal text', {
      callLLM: mockLLM(
        JSON.stringify({ ...validPayload, severity: 'EXTREME' })
      ),
    });

    expect(result.needsReview).toBe(true);
    expect(result.data).toBeNull();
    expect(result.reason).toMatch(/schema validation/);
  });

  it('flags LLM failures for review', async () => {
    const result = await extractSignal('raw signal text', {
      callLLM: async () => {
        throw new Error('provider down');
      },
    });

    expect(result.needsReview).toBe(true);
    expect(result.reason).toMatch(/LLM call failed/);
  });
});
