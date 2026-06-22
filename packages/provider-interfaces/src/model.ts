export interface ModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ModelInput {
  messages: ModelMessage[];
}

export interface ModelOutput {
  /** Incremental text delta in a streamed response. */
  textDelta: string;
}

/**
 * Streaming LLM. V1 default: Claude (swappable with GPT, Gemini).
 * `cancel()` must abort an in-flight generation promptly for barge-in.
 */
export interface ModelAdapter {
  generateResponse(input: ModelInput): AsyncIterable<ModelOutput>;
  cancel(): Promise<void>;
}
