import { GoogleGenAI } from '@google/genai';
import type { ModelAdapter, ModelInput, ModelOutput } from '@voice/provider-interfaces';

export interface GeminiModelAdapterOptions {
  apiKey: string;
  model: string;
  maxTokens?: number;
  system?: string;
}

const VOICE_SYSTEM_PROMPT =
  'You are a friendly voice assistant. Reply in one or two short, natural spoken ' +
  'sentences. No markdown, lists, or emoji — your reply is read aloud.';

/**
 * Real LLM adapter backed by Google Gemini (@google/genai), streaming.
 *
 * Same contract as the Claude adapter. Note: Gemini's abort is client-side only
 * — it stops our stream promptly (which is all barge-in needs) but doesn't
 * cancel server-side generation.
 */
export class GeminiModelAdapter implements ModelAdapter {
  private readonly ai: GoogleGenAI;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly system: string;
  private controller: AbortController | undefined;

  constructor(options: GeminiModelAdapterOptions) {
    this.ai = new GoogleGenAI({ apiKey: options.apiKey });
    this.model = options.model;
    this.maxTokens = options.maxTokens ?? 256;
    this.system = options.system ?? VOICE_SYSTEM_PROMPT;
  }

  async *generateResponse(input: ModelInput): AsyncIterable<ModelOutput> {
    const controller = new AbortController();
    this.controller = controller;

    // Gemini roles are 'user' | 'model'; system goes in config.systemInstruction.
    const contents = input.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    try {
      const stream = await this.ai.models.generateContentStream({
        model: this.model,
        contents,
        config: {
          systemInstruction: this.system,
          maxOutputTokens: this.maxTokens,
          abortSignal: controller.signal,
        },
      });
      for await (const chunk of stream) {
        const text = chunk.text;
        if (text) yield { textDelta: text };
      }
    } catch (err) {
      if (controller.signal.aborted) return; // cancelled (barge-in / stop)
      throw err;
    }
  }

  async cancel(): Promise<void> {
    this.controller?.abort();
  }
}
