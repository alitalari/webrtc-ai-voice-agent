import type {
  ASRAdapter,
  AudioChunk,
  ModelAdapter,
  ModelMessage,
  TTSAdapter,
} from '@voice/provider-interfaces';
import type { LatencyMetrics, ServerEvent, TurnEvent } from '@voice/protocol';
import {
  Endpointer,
  SessionMachine,
  type EndpointerConfig,
  type SessionEffect,
  type SessionEvent,
  type SessionState,
  type VadFrame,
} from '@voice/session';

export interface OrchestratorAdapters {
  asr: ASRAdapter;
  model: ModelAdapter;
  tts: TTSAdapter;
}

export interface OrchestratorOptions {
  sessionId: string;
  adapters: OrchestratorAdapters;
  endpointer: EndpointerConfig;
  /** Sink for protocol server events (transcripts, agent lifecycle, interrupts). */
  onEvent: (event: ServerEvent) => void;
  /** Sink for synthesized audio chunks bound for the client. */
  onAudio: (chunk: AudioChunk) => void;
  /** Monotonic clock in ms. Injected for deterministic tests; defaults to Date.now. */
  now?: () => number;
}

/**
 * Wires the pure session layer (state machine + endpointing) to the provider
 * adapters. Transport-agnostic: it knows nothing about WebRTC/WebSockets — the
 * media engine feeds it audio + VAD frames and consumes the events/audio it
 * emits. The cascade is ASR → model → TTS; barge-in cancels the in-flight
 * model + TTS via a response-generation token so a stale stream can never
 * resurrect after the user has cut in.
 */
export class SessionOrchestrator {
  private readonly sessionId: string;
  private readonly adapters: OrchestratorAdapters;
  private readonly endpointer: Endpointer;
  private readonly machine = new SessionMachine();
  private readonly onEvent: (event: ServerEvent) => void;
  private readonly onAudio: (chunk: AudioChunk) => void;
  private readonly now: () => number;

  private readonly history: ModelMessage[] = [];
  private lastFinal = '';
  private lastFinalAtMs = 0;
  private lastPartial = '';
  private responseGeneration = 0;
  private responseTask: Promise<void> = Promise.resolve();
  private audioChunkSeq = 0;

  constructor(options: OrchestratorOptions) {
    this.sessionId = options.sessionId;
    this.adapters = options.adapters;
    this.endpointer = new Endpointer(options.endpointer);
    this.onEvent = options.onEvent;
    this.onAudio = options.onAudio;
    this.now = options.now ?? (() => Date.now());

    this.adapters.asr.onPartialTranscript((text) => {
      this.lastPartial = text;
      this.emit({ type: 'transcript.partial', sessionId: this.sessionId, text });
    });
    this.adapters.asr.onFinalTranscript((text) => {
      this.lastFinal = text;
      this.lastFinalAtMs = this.now();
      this.emit({ type: 'transcript.final', sessionId: this.sessionId, text });
    });
  }

  get state(): SessionState {
    return this.machine.state;
  }

  /** Resolves when the in-flight agent response settles (test/coordination helper). */
  whenResponseSettled(): Promise<void> {
    return this.responseTask;
  }

  async start(): Promise<void> {
    await this.adapters.asr.startSession({ sampleRate: 16000 });
    this.apply({ type: 'start' });
    this.emit({ type: 'session.started', sessionId: this.sessionId });
  }

  async stop(): Promise<void> {
    this.apply({ type: 'stop' });
    await this.adapters.asr.stopSession();
    this.emit({ type: 'session.ended', sessionId: this.sessionId });
  }

  /** Manual barge-in (e.g. the user pressed "stop"). */
  interrupt(): void {
    this.apply({ type: 'manualInterrupt' });
  }

  /** Forward a captured user audio chunk to ASR. */
  pushUserAudio(chunk: AudioChunk): void {
    void this.adapters.asr.sendAudio(chunk);
  }

  /** Feed a VAD frame; drives turn-taking and barge-in. */
  pushVad(frame: VadFrame): void {
    for (const turn of this.endpointer.push(frame)) {
      const mapped = mapTurnEvent(turn);
      if (mapped) this.apply(mapped);
    }
  }

  // --- internals ---

  private apply(event: SessionEvent): void {
    const prev = this.machine.state;
    const effects = this.machine.dispatch(event);
    this.executeEffects(effects);
    if (this.machine.state === 'thinking' && prev !== 'thinking') {
      this.beginResponse();
    }
  }

  private executeEffects(effects: SessionEffect[]): void {
    for (const effect of effects) {
      switch (effect.type) {
        case 'cancelModel':
          this.responseGeneration += 1; // invalidate any in-flight response
          void this.adapters.model.cancel();
          break;
        case 'cancelTts':
          void this.adapters.tts.cancel();
          break;
        case 'notifyInterrupted':
          this.emit({ type: 'agent.interrupted', sessionId: this.sessionId });
          break;
        case 'flushPlayback':
        case 'startCapture':
        case 'stopCapture':
          // Playback buffering and mic capture are the media engine's job.
          break;
      }
    }
  }

  private beginResponse(): void {
    const gen = ++this.responseGeneration;
    const endpointAtMs = this.now(); // end-of-turn decision time
    const userText = (this.lastFinal || this.lastPartial).trim();

    if (!userText) {
      // Nothing was recognized this turn (a cough, noise, or ASR returned
      // nothing) — skip the model and return to listening rather than sending
      // an empty message.
      this.apply({ type: 'agentResponseCompleted' });
      return;
    }

    this.history.push({ role: 'user', content: userText });

    this.responseTask = (async () => {
      try {
      // Accumulate the model's text, then synthesize. Sentence-level pipelining
      // for lower latency is a Phase 3 refinement; the cancellation contract is
      // identical either way.
      let assistantText = '';
      for await (const out of this.adapters.model.generateResponse({
        messages: this.history,
      })) {
        if (gen !== this.responseGeneration) return; // cancelled (barge-in / stop)
        assistantText += out.textDelta;
      }
      if (gen !== this.responseGeneration) return;

      // The full reply is known before TTS starts — surface it for display.
      this.emit({ type: 'agent.response.text', sessionId: this.sessionId, text: assistantText });

      let started = false;
      for await (const audio of this.adapters.tts.synthesizeStream({ text: assistantText })) {
        if (gen !== this.responseGeneration) return;
        if (!started) {
          started = true;
          this.apply({ type: 'agentResponseStarted' }); // thinking → speaking
          this.emit({ type: 'agent.response.started', sessionId: this.sessionId });
          const firstAudioAtMs = this.now();
          const metrics: LatencyMetrics = { endToEndTurnMs: firstAudioAtMs - endpointAtMs };
          // Only meaningful once ASR has produced a final transcript this turn.
          if (this.lastFinalAtMs > 0) {
            metrics.timeToFirstAudioByteMs = firstAudioAtMs - this.lastFinalAtMs;
          }
          this.emit({ type: 'metrics.latency', sessionId: this.sessionId, metrics });
        }
        this.onAudio(audio);
        this.emit({
          type: 'agent.response.audio',
          sessionId: this.sessionId,
          audioChunkId: `chunk-${this.audioChunkSeq++}`,
        });
      }
      if (gen !== this.responseGeneration) return;

      this.history.push({ role: 'assistant', content: assistantText });
      this.apply({ type: 'agentResponseCompleted' }); // speaking → listening
      this.emit({ type: 'agent.response.completed', sessionId: this.sessionId });
      } catch (err) {
        if (gen !== this.responseGeneration) return; // already cancelled — ignore
        // A provider failed mid-turn. Surface it and recover to listening rather
        // than crashing the session.
        this.emit({
          type: 'error',
          sessionId: this.sessionId,
          code: 'provider_error',
          message: err instanceof Error ? err.message : String(err),
        });
        this.apply({ type: 'agentResponseCompleted' });
      }
    })();
  }

  private emit(event: ServerEvent): void {
    this.onEvent(event);
  }
}

function mapTurnEvent(turn: TurnEvent): SessionEvent | null {
  switch (turn.type) {
    case 'user_speech_started':
      return { type: 'userSpeechStarted' };
    case 'endpointed':
      return { type: 'endpointed' };
    case 'user_speech_ended':
      return null; // informational only
  }
}
