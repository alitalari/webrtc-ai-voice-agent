import type { ModelAdapter, ModelInput, ModelOutput } from '@voice/provider-interfaces';

export interface FakeModelOptions {
  /** Tokens to stream as the response. */
  script?: string[];
  /** Optional async gap before each token (default: a resolved microtask). */
  sleep?: (index: number) => Promise<void>;
}

/**
 * Deterministic, cancellable stand-in for a streaming LLM. The cancellation
 * semantics are the point: `cancel()` makes the in-flight stream stop yielding,
 * which is exactly what barge-in relies on.
 */
export class FakeModelAdapter implements ModelAdapter {
  private cancelled = false;
  private readonly script: string[];
  private readonly sleep: (index: number) => Promise<void>;

  constructor(options: FakeModelOptions = {}) {
    this.script = options.script ?? ['Hi', ' there', '!'];
    this.sleep = options.sleep ?? (() => Promise.resolve());
  }

  async *generateResponse(_input: ModelInput): AsyncIterable<ModelOutput> {
    this.cancelled = false;
    for (let i = 0; i < this.script.length; i++) {
      await this.sleep(i);
      if (this.cancelled) return;
      yield { textDelta: this.script[i] };
    }
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
  }
}
