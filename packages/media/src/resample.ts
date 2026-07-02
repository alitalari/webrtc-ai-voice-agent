/**
 * Downsample 16-bit PCM by an integer factor using box averaging (cheap
 * anti-aliasing). Used to convert the 48kHz WebRTC mic audio to the 16kHz
 * linear16 that streaming ASR (Deepgram) expects (factor 3).
 *
 * Pure: input frame in, resampled frame out.
 */
export function downsample(input: Int16Array, factor: number): Int16Array {
  if (factor <= 1) return input;
  const outLen = Math.floor(input.length / factor);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    let sum = 0;
    for (let j = 0; j < factor; j++) sum += input[i * factor + j];
    out[i] = Math.round(sum / factor);
  }
  return out;
}

/**
 * Resample 16-bit PCM between arbitrary rates via linear interpolation. Used to
 * lift TTS audio to the 48kHz the WebRTC Opus encoder expects when a provider
 * can't emit 48kHz natively (e.g. ElevenLabs tops out at 44.1kHz PCM).
 *
 * Linear interpolation is cheap and good enough for speech; each call resamples
 * one chunk independently (tiny boundary artifacts are inaudible here).
 */
export function resampleLinear(input: Int16Array, inRate: number, outRate: number): Int16Array {
  if (inRate === outRate || input.length < 2) return input;
  const outLen = Math.max(1, Math.round((input.length * outRate) / inRate));
  const out = new Int16Array(outLen);
  const step = (input.length - 1) / (outLen - 1 || 1);
  for (let i = 0; i < outLen; i++) {
    const pos = i * step;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = pos - i0;
    out[i] = Math.round(input[i0] * (1 - frac) + input[i1] * frac);
  }
  return out;
}
