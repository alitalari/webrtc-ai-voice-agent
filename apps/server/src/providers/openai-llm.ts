import OpenAI from 'openai';
import type { ModelAdapter, ModelInput, ModelOutput } from '@voice/provider-interfaces';

export interface OpenAIModelAdapterOptions {
  apiKey: string;
  model: string;
  maxTokens?: number;
  system?: string;
}

const VOICE_SYSTEM_PROMPT =
  'You are a friendly voice assistant. Reply in one or two short, natural spoken ' +
  'sentences. No markdown, lists, or emoji — your reply is read aloud.';

/**
 * Real LLM adapter backed by OpenAI GPT (Chat Completions), streaming.
 *
 * Same contract as the Claude adapter: streams text deltas, and `cancel()`
 * aborts the in-flight request via an AbortController for barge-in.
 */
export class OpenAIModelAdapter implements ModelAdapter {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly system: string;
  private controller: AbortController | undefined;

  constructor(options: OpenAIModelAdapterOptions) {
    this.client = new OpenAI({ apiKey: options.apiKey });
    this.model = options.model;
    this.maxTokens = options.maxTokens ?? 256; // short, spoken replies
    this.system = options.system ?? VOICE_SYSTEM_PROMPT;
  }

  async *generateResponse(input: ModelInput): AsyncIterable<ModelOutput> {
    const controller = new AbortController();
    this.controller = controller;

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: this.system },
      ...input.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
          content: m.content,
        })),
    ];

    try {
      const stream = await this.client.chat.completions.create(
        { model: this.model, max_completion_tokens: this.maxTokens, messages, stream: true },
        { signal: controller.signal },
      );
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) yield { textDelta: delta };
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
      await this.client.chat.completions.create({
        model: this.model,
        max_completion_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      });
    } catch {
      // Best-effort connection warming.
    }
  }
}
