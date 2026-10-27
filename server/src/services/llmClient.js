import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROMPTS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../prompts'
);

const DEFAULTS = {
  gemini: 'gemini-2.0-flash',
  groq: 'llama-3.1-8b-instant',
  ollama: 'llama3.1',
  anthropic: 'claude-3-5-haiku-latest',
};

export const PROVIDERS = Object.keys(DEFAULTS);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function loadPrompt(name) {
  return fs.readFileSync(path.join(PROMPTS_DIR, `${name}.txt`), 'utf8');
}

function providerConfig(provider) {
  switch (provider) {
    case 'gemini':
      return {
        model: process.env.GEMINI_MODEL ?? DEFAULTS.gemini,
        apiKey: process.env.GEMINI_API_KEY,
      };
    case 'groq':
      return {
        model: process.env.GROQ_MODEL ?? DEFAULTS.groq,
        apiKey: process.env.GROQ_API_KEY,
      };
    case 'ollama':
      return {
        model: process.env.OLLAMA_MODEL ?? DEFAULTS.ollama,
        baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
      };
    case 'anthropic':
      return {
        model: process.env.ANTHROPIC_MODEL ?? DEFAULTS.anthropic,
        apiKey: process.env.ANTHROPIC_API_KEY,
      };
    default:
      throw new Error(
        `Unsupported LLM_PROVIDER "${provider}". Use one of: ${PROVIDERS.join(', ')}`
      );
  }
}

function buildRequest(
  provider,
  config,
  { system, prompt, temperature, maxTokens, jsonMode }
) {
  if (provider === 'gemini') {
    if (!config.apiKey) throw new Error('GEMINI_API_KEY is not set.');
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent`,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': config.apiKey,
      },
      body: {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens,
          ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
        },
      },
    };
  }

  if (provider === 'groq') {
    if (!config.apiKey) throw new Error('GROQ_API_KEY is not set.');
    return {
      url: `${process.env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1'}/chat/completions`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: {
        model: config.model,
        temperature,
        max_tokens: maxTokens,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
      },
    };
  }

  if (provider === 'ollama') {
    return {
      url: `${config.baseUrl.replace(/\/$/, '')}/api/chat`,
      headers: { 'Content-Type': 'application/json' },
      body: {
        model: config.model,
        stream: false,
        ...(jsonMode ? { format: 'json' } : {}),
        options: { temperature, num_predict: maxTokens },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
      },
    };
  }

  if (provider === 'anthropic') {
    if (!config.apiKey) throw new Error('ANTHROPIC_API_KEY is not set.');
    return {
      url: 'https://api.anthropic.com/v1/messages',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: {
        model: config.model,
        max_tokens: maxTokens,
        temperature,
        system,
        messages: [{ role: 'user', content: prompt }],
      },
    };
  }

  throw new Error(`Unsupported provider: ${provider}`);
}

function extractText(provider, data) {
  if (provider === 'gemini') {
    const text = data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text)
      .filter(Boolean)
      .join('');
    if (!text) throw new Error('Gemini returned an empty response.');
    return text;
  }

  if (provider === 'groq') {
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('Groq returned an empty response.');
    return text;
  }

  if (provider === 'ollama') {
    const text = data.message?.content;
    if (!text) throw new Error('Ollama returned an empty response.');
    return text;
  }

  if (provider === 'anthropic') {
    const text = data.content
      ?.filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');
    if (!text) throw new Error('Anthropic returned an empty response.');
    return text;
  }

  throw new Error(`Unsupported provider: ${provider}`);
}

export async function callLLM({
  system,
  prompt,
  temperature = 0,
  maxTokens = 1024,
  jsonMode = true,
  provider = process.env.LLM_PROVIDER ?? 'gemini',
  fetchImpl = globalThis.fetch,
  maxRetries = Number(process.env.LLM_MAX_RETRIES ?? 3),
  timeoutMs = Number(process.env.LLM_TIMEOUT_MS ?? 30000),
}) {
  if (!system || !prompt) {
    throw new Error('callLLM requires both system and prompt.');
  }

  const config = providerConfig(provider);
  const request = buildRequest(provider, config, {
    system,
    prompt,
    temperature,
    maxTokens,
    jsonMode,
  });

  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetchImpl(request.url, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        const bodyText = await response.text();
        const error = new Error(
          `${provider} request failed (${response.status}): ${bodyText.slice(0, 300)}`
        );
        error.status = response.status;
        error.retryAfter = response.headers?.get?.('retry-after');

        if (response.status !== 429 && response.status < 500) throw error;
        lastError = error;
      } else {
        const data = await response.json();
        return extractText(provider, data);
      }
    } catch (error) {
      if (error.status && error.status !== 429 && error.status < 500) {
        throw error;
      }
      lastError = error;
    }

    if (attempt < maxRetries) {
      const retryAfter = Number(lastError?.retryAfter);
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.min(20000, 500 * 2 ** attempt);
      await sleep(waitMs);
    }
  }

  throw lastError ?? new Error('LLM request failed.');
}

export function parseLLMJson(text) {
  if (typeof text !== 'string') {
    throw new Error('LLM response is not text.');
  }

  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) {
    throw new Error('LLM response did not contain a JSON object.');
  }

  return JSON.parse(candidate.slice(start, end + 1));
}

export async function callLLMJson(options) {
  const text = await callLLM(options);
  return parseLLMJson(text);
}
