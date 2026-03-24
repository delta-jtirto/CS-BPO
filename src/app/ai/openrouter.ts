/**
 * OpenRouter API Client
 *
 * Sends chat-completion requests to OpenRouter and logs every
 * request/response to the AI debug store.
 */

import { addDebugEntry, type AIDebugEntry } from './debug-store';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/** Default model — change freely. */
export const DEFAULT_MODEL = 'openai/gpt-4o-mini';

export interface OpenRouterOptions {
  apiKey: string;
  model?: string;
  systemPrompt: string;
  userPrompt: string;
  /** Label for the debug panel */
  touchpoint: AIDebugEntry['touchpoint'];
  /** Temperature (0–2). Default 0.7 */
  temperature?: number;
  /** Max tokens. Default 1024 */
  maxTokens?: number;
}

export interface OpenRouterResult {
  text: string;
  tokensUsed: { prompt: number; completion: number; total: number } | null;
  model: string;
  durationMs: number;
}

/**
 * Call OpenRouter and return the assistant's text reply.
 * Throws on network or API error.
 */
export async function callOpenRouter(opts: OpenRouterOptions): Promise<OpenRouterResult> {
  const model = opts.model || DEFAULT_MODEL;
  const entryId = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const startMs = performance.now();

  // Partial debug entry (pre-request)
  const partial: AIDebugEntry = {
    id: entryId,
    timestamp: Date.now(),
    touchpoint: opts.touchpoint,
    model,
    systemPrompt: opts.systemPrompt,
    userPrompt: opts.userPrompt,
    response: null,
    durationMs: null,
    tokensUsed: null,
    error: false,
    status: null,
  };

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${opts.apiKey}`,
        'HTTP-Referer': window.location.origin,
        'X-Title': 'Hospitality BPO Platform',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: opts.systemPrompt },
          { role: 'user', content: opts.userPrompt },
        ],
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens ?? 1024,
      }),
    });

    const durationMs = Math.round(performance.now() - startMs);
    const json = await res.json();

    if (!res.ok) {
      const errMsg = json?.error?.message || JSON.stringify(json);
      partial.response = `Error: ${errMsg}`;
      partial.durationMs = durationMs;
      partial.error = true;
      partial.status = res.status;
      addDebugEntry(partial);
      throw new Error(errMsg);
    }

    const text = json.choices?.[0]?.message?.content || '';
    const usage = json.usage
      ? {
          prompt: json.usage.prompt_tokens ?? 0,
          completion: json.usage.completion_tokens ?? 0,
          total: json.usage.total_tokens ?? 0,
        }
      : null;

    partial.response = text;
    partial.durationMs = durationMs;
    partial.tokensUsed = usage;
    partial.status = res.status;
    addDebugEntry(partial);

    return { text, tokensUsed: usage, model, durationMs };
  } catch (err: any) {
    const durationMs = Math.round(performance.now() - startMs);
    if (!partial.error) {
      // Network error (not API error — that's handled above)
      partial.response = `Network error: ${err.message}`;
      partial.durationMs = durationMs;
      partial.error = true;
      partial.status = null;
      addDebugEntry(partial);
    }
    throw err;
  }
}
