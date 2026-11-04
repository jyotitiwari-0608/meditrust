import { describe, expect, it } from 'vitest';
import {
  justifyScore,
  templateJustification,
  validateJustification,
} from '../src/services/justification.js';

const score = {
  score: 84.2,
  band: 'High',
  manufacturer: { name: 'Cipla Ltd' },
  factors: [
    {
      name: 'regulatoryApproval',
      label: 'Regulatory approval',
      value: 100,
      weight: 0.2,
      contribution: 20,
    },
    {
      name: 'recentNsq',
      label: 'Recent NSQ',
      value: 92.1,
      weight: 0.2,
      contribution: 18.42,
    },
  ],
};

function mockLLM(text) {
  return async () => text;
}

describe('justification', () => {
  it('accepts grounded LLM explanations', async () => {
    const text =
      'Cipla Ltd has a trust score of 84.2 (High). The largest contributors are Regulatory approval (100 out of 100) and Recent NSQ (92.1 out of 100).';
    const result = await justifyScore(score, { callLLM: mockLLM(text) });

    expect(result.source).toBe('llm');
    expect(result.text).toBe(text);
  });

  it('falls back when the LLM invents a number', async () => {
    const text =
      'Cipla Ltd has a trust score of 84.2 (High). The result is based on 12 audits.';
    const result = await justifyScore(score, { callLLM: mockLLM(text) });

    expect(result.source).toBe('template');
    expect(result.reason).toMatch(/absent from the score/);
    expect(result.text).toContain('84.2');
  });

  it('falls back when the band does not match', async () => {
    const text =
      'Cipla Ltd has a trust score of 84.2 (Low). The largest contributor is Regulatory approval (100 out of 100).';
    const result = await justifyScore(score, { callLLM: mockLLM(text) });

    expect(result.source).toBe('template');
    expect(result.reason).toMatch(/band does not match/);
  });

  it('falls back when the LLM fails', async () => {
    const result = await justifyScore(score, {
      callLLM: async () => {
        throw new Error('provider down');
      },
    });

    expect(result.source).toBe('template');
    expect(result.text).toContain('84.2');
  });

  it('rejects explanations that are not 2-3 sentences', () => {
    const validation = validateJustification('Too short.', score);
    expect(validation.valid).toBe(false);
  });

  it('builds a grounded template', () => {
    const text = templateJustification(score);
    expect(text).toContain('84.2');
    expect(text).toContain('High');
    expect(text).toContain('Regulatory approval');
  });
});
