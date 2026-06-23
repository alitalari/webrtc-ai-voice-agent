import Anthropic from '@anthropic-ai/sdk';
import type { ModelAdapter, ModelInput, ModelOutput } from '@voice/provider-interfaces';

export interface ClaudeAdapterOptions {
  apiKey: string;
  model: string;
  maxTokens?: number;
  system?: string;
}

const VOICE_SYSTEM_PROMPT =
  'You are a friendly voice assistant. Reply in one or two short, natural spoken ' +
  'sentences. No markdown, lists, or emoji — your reply is read aloud.';

/**
 * Real LLM adapter backed by Claude (Anthropic SDK), streaming.
 *
 * Streams text deltas as they arrive (low time-to-first-token matters for
 * voice). `cancel()` aborts the in-flight request via an AbortController — the
 * mechanism barge-in relies on.
 */
export class ClaudeModelAdapter implements ModelAdapter {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly system: string;
  private controller: AbortController | undefined;

  constructor(options: ClaudeAdapterOptions) {
    this.client = new Anthropic({ apiKey: options.apiKey });
    this.model = options.model;
    this.maxTokens = options.maxTokens ?? 256; // short, spoken replies
    this.system = options.system ?? VOICE_SYSTEM_PROMPT;
  }

  async *generateResponse(input: ModelInput): AsyncIterable<ModelOutput> {
    const controller = new AbortController();
    this.controller = controller;

    const messages = input.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        content: m.content,
      }));

    const stream = this.client.messages.stream(
      { model: this.model, max_tokens: this.maxTokens, system: this.system, messages },
      { signal: controller.signal },
    );

    try {
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { textDelta: event.delta.text };
        }
      }
    } catch (err) {
      if (controller.signal.aborted) return; // cancelled (barge-in / stop)
      throw err;
    }
  }

  async cancel(): Promise<void> {
    this.controller?.abort();
  }

  /** Establish the HTTPS connection up front so the first real turn isn't cold. */
  async warmup(): Promise<void> {
    try {
      await this.client.messages.create({
        model: this.model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      });
    } catch {
      // Best-effort connection warming.
    }
  }
}
