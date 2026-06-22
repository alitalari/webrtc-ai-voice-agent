import { describe, it, expect } from 'vitest';
import { PROTOCOL_VERSION } from '@voice/protocol';

describe('protocol', () => {
  it('exposes a semver protocol version', () => {
    // Why: the client/server handshake compares this string; a malformed
    // version would silently break negotiation. Guard the shape, not the value.
    expect(PROTOCOL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
