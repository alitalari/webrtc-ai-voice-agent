declare module 'opusscript' {
  export default class OpusScript {
    constructor(sampleRate: number, channels?: number, application?: number);
    decode(packet: Buffer): Buffer;
    encode(pcm: Buffer, frameSize: number): Buffer;
    delete(): void;
  }
}
