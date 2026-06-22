import type { TurnEvent } from '@voice/protocol';

/**
 * Silence-threshold endpointing — decides *when the user has finished a turn*.
 *
 * This is the hardest real-world part of a voice agent (docs → Turn-Taking &
 * Endpointing). It is kept pure and deterministic: the engine holds no real
 * clock — each frame carries its own timestamp, which *is* the clock — so the
 * same frame sequence always yields the same events, and tests need no fake
 * timers. Voice-activity detection (is this frame speech?) happens upstream; this
 * engine only reasons about the timing of speech vs silence.
 *
 * Emits `@voice/protocol` `TurnEvent`s. The session state machine only acts on
 * `user_speech_started` (→ start/barge-in) and `endpointed` (→ hand to the LLM);
 * `user_speech_ended` is a best-effort informational signal for metrics.
 */

export interface EndpointerConfig {
  /** Continuous silence after speech, in ms, before declaring end-of-turn. */
  silenceThresholdMs: number;
  /**
   * Minimum continuous speech, in ms, to confirm a real onset and debounce
   * single-frame blips. Default 0 (onset on the first speech frame).
   */
  speechOnsetMs?: number;
}

export interface VadFrame {
  /** Whether this frame contains voice activity (decided upstream). */
  speech: boolean;
  /** Monotonic milliseconds from session start. The timestamp is the clock. */
  timestampMs: number;
}

type Phase = 'silent' | 'pendingOnset' | 'speaking' | 'trailingSilence';

export class Endpointer {
  private phase: Phase = 'silent';
  private onsetStartMs = 0;
  private lastSpeechMs = 0;
  private readonly silenceThresholdMs: number;
  private readonly speechOnsetMs: number;

  constructor(config: EndpointerConfig) {
    this.silenceThresholdMs = config.silenceThresholdMs;
    this.speechOnsetMs = config.speechOnsetMs ?? 0;
  }

  /** Feed one VAD frame; returns any turn events it produced (usually none). */
  push(frame: VadFrame): TurnEvent[] {
    const { speech, timestampMs: ts } = frame;

    switch (this.phase) {
      case 'silent':
        if (speech) {
          if (this.speechOnsetMs <= 0) {
            this.phase = 'speaking';
            this.lastSpeechMs = ts;
            return [{ type: 'user_speech_started' }];
          }
          this.phase = 'pendingOnset';
          this.onsetStartMs = ts;
        }
        return [];

      case 'pendingOnset':
        if (speech) {
          if (ts - this.onsetStartMs >= this.speechOnsetMs) {
            this.phase = 'speaking';
            this.lastSpeechMs = ts;
            return [{ type: 'user_speech_started' }];
          }
          return []; // still accumulating onset
        }
        this.phase = 'silent'; // speech didn't persist — blip discarded
        return [];

      case 'speaking':
        if (speech) {
          this.lastSpeechMs = ts;
          return [];
        }
        this.phase = 'trailingSilence';
        return [{ type: 'user_speech_ended' }];

      case 'trailingSilence':
        if (speech) {
          // Resumed before the endpoint threshold — same turn continues.
          this.phase = 'speaking';
          this.lastSpeechMs = ts;
          return [{ type: 'user_speech_started' }];
        }
        if (ts - this.lastSpeechMs >= this.silenceThresholdMs) {
          this.phase = 'silent';
          return [{ type: 'endpointed' }];
        }
        return [];
    }
  }

  /** Reset to the initial state (e.g. when a session restarts). */
  reset(): void {
    this.phase = 'silent';
    this.onsetStartMs = 0;
    this.lastSpeechMs = 0;
  }
}
