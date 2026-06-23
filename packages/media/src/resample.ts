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
