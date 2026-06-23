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
  /** Optional per-turn latency breakdown, for debugging end-to-end delay. */
  onTiming?: (timing: TurnTiming) => void;
}

/** Per-turn latency segments (all ms). Reported when the agent's first audio is ready. */
export interface TurnTiming {
  transcript: string;
  talkMs: number; // user speech start → endpoint (talking + silence wait)
  asrMs: number | null; // user speech start → ASR final transcript
  llmTtftMs: number; // endpoint → first LLM token
  llmGenMs: number; // first LLM token → model done
  ttsMs: number; // model done → first audio byte
  endToEndMs: number; // user speech start → first audio (full perceived latency)
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
  private readonly onTiming: ((timing: TurnTiming) => void) | undefined;

  private readonly history: ModelMessage[] = [];
  private lastFinal = '';
  private lastFinalAtMs = 0;
  private lastPartial = '';
  private turnSpeechStartedAt = 0;
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
    this.onTiming = options.onTiming;

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
    if (prev === 'listening' && this.machine.state === 'userSpeaking') {
      this.turnSpeechStartedAt = this.now(); // start of a fresh user turn
      this.adapters.asr.endUtterance?.(); // fresh transcript — drop pre-turn noise
    }
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
    const speechStartedAt = this.turnSpeechStartedAt || endpointAtMs;
    const userText = (this.lastFinal || this.lastPartial).trim();
    const finalAtMs = this.lastFinalAtMs;
    // Consume the transcript so a later turn (e.g. a noise blip while silent)
    // doesn't re-send the same text and make the agent repeat itself.
    this.lastFinal = '';
    this.lastPartial = '';
    this.lastFinalAtMs = 0;

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
      // Stream the model and synthesize each sentence the moment it's complete,
      // so audio starts at the first sentence instead of after the whole reply.
      let assistantText = '';
      let pending = '';
      let firstTokenAt = 0;
      let firstSentenceAt = 0;
      let started = false;

      // Synthesize one sentence and stream its audio. Returns false if cancelled.
      const speak = async (sentence: string): Promise<boolean> => {
        for await (const audio of this.adapters.tts.synthesizeStream({ text: sentence })) {
          if (gen !== this.responseGeneration) return false;
          if (!started) {
            started = true;
            const firstAudioAtMs = this.now();
            this.apply({ type: 'agentResponseStarted' }); // thinking → speaking
            this.emit({ type: 'agent.response.started', sessionId: this.sessionId });

            const metrics: LatencyMetrics = {
              endToEndTurnMs: firstAudioAtMs - endpointAtMs,
              llmTtftMs: firstTokenAt - endpointAtMs,
              llmGenMs: firstSentenceAt - firstTokenAt, // → first *sentence* ready
              ttsMs: firstAudioAtMs - firstSentenceAt,
            };
            if (finalAtMs > 0) metrics.timeToFirstAudioByteMs = firstAudioAtMs - finalAtMs;
            this.emit({ type: 'metrics.latency', sessionId: this.sessionId, metrics });

            this.onTiming?.({
              transcript: userText,
              talkMs: endpointAtMs - speechStartedAt,
              asrMs: finalAtMs > 0 ? finalAtMs - speechStartedAt : null,
              llmTtftMs: firstTokenAt - endpointAtMs,
              llmGenMs: firstSentenceAt - firstTokenAt,
              ttsMs: firstAudioAtMs - firstSentenceAt,
              endToEndMs: firstAudioAtMs - speechStartedAt,
            });
          }
          this.onAudio(audio);
          this.emit({
            type: 'agent.response.audio',
            sessionId: this.sessionId,
            audioChunkId: `chunk-${this.audioChunkSeq++}`,
          });
        }
        // The stream can also end because cancel() closed it (barge-in) — report
        // that so the turn doesn't fall through to "completed".
        return gen === this.responseGeneration;
      };

      // Surface the sentence text (for in-sync display), then speak it.
      const flush = async (sentence: string): Promise<boolean> => {
        if (firstSentenceAt === 0) firstSentenceAt = this.now();
        this.emit({ type: 'agent.response.text', sessionId: this.sessionId, text: sentence });
        return speak(sentence);
      };

      for await (const out of this.adapters.model.generateResponse({ messages: this.history })) {
        if (gen !== this.responseGeneration) return; // cancelled (barge-in / stop)
        if (firstTokenAt === 0) firstTokenAt = this.now();
        assistantText += out.textDelta;
        pending += out.textDelta;

        let idx: number;
        while ((idx = sentenceEnd(pending)) !== -1) {
          const sentence = pending.slice(0, idx + 1).trim();
          pending = pending.slice(idx + 1);
          if (sentence && !(await flush(sentence))) return;
        }
      }
      if (gen !== this.responseGeneration) return;

      const rest = pending.trim();
      if (rest && !(await flush(rest))) return;

      this.history.push({ role: 'assistant', content: assistantText });
      this.trimHistory();
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

  /** Keep the prompt bounded: retain ~4 recent exchanges, starting with a user turn. */
  private trimHistory(): void {
    const MAX = 8;
    if (this.history.length > MAX) this.history.splice(0, this.history.length - MAX);
    if (this.history[0]?.role === 'assistant') this.history.shift(); // Claude must start with user
  }

  private emit(event: ServerEvent): void {
    this.onEvent(event);
  }
}

/** Index of the first sentence-ending punctuation in `text`, or -1. */
function sentenceEnd(text: string): number {
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '!' || c === '?') return i;
    if (c === '.') {
      const next = text[i + 1];
      if (next && next >= '0' && next <= '9') continue; // decimal like 3.14
      return i;
    }
  }
  return -1;
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
