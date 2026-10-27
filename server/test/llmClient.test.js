import { describe, expect, it, vi } from 'vitest';
import { callLLM, parseLLMJson } from '../src/services/llmClient.js';

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => '0.001' },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

describe('llmClient', () => {
  it('parses fenced JSON responses', () => {
    expect(parseLLMJson('```json\n{"ok":true}\n```')).toEqual({ ok: true });
    expect(() => parseLLMJson('no json here')).toThrow(/did not contain/);
  });

  it('calls the groq provider with a JSON response', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: '{"ok":true}' } }] })
    );

    const text = await callLLM({
      system: 'system',
      prompt: 'prompt',
      provider: 'groq',
      fetchImpl,
      maxRetries: 0,
    });

    expect(text).toBe('{"ok":true}');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toContain('api.groq.com');
    expect(options.body).toContain('json_object');
  });

  it('retries rate-limited requests with backoff', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'rate limited' }, 429))
      .mockResolvedValueOnce(
        jsonResponse({ choices: [{ message: { content: '{"ok":true}' } }] })
      );

    const text = await callLLM({
      system: 'system',
      prompt: 'prompt',
      provider: 'groq',
      fetchImpl,
      maxRetries: 1,
    });

    expect(text).toBe('{"ok":true}');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-retryable errors', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: 'bad request' }, 400)
    );

    await expect(
      callLLM({
        system: 'system',
        prompt: 'prompt',
        provider: 'groq',
        fetchImpl,
        maxRetries: 3,
      })
    ).rejects.toThrow(/400/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
