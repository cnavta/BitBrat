import { extractEgressTextFromEvent } from './selection';

describe('extractEgressTextFromEvent', () => {
  it('returns null if candidates array is empty', () => {
    const evt = {
      candidates: []
    };
    expect(extractEgressTextFromEvent(evt)).toBeNull();
  });

  it('falls back to legacy message if candidates is missing', () => {
    const evt = {
      message: {
        rawPlatformPayload: {
          text: 'original message'
        }
      }
    };
    // This is the current behavior we might want to change for egress
    expect(extractEgressTextFromEvent(evt)).toBe('original message');
  });

  it('returns null if candidates is missing and it is an egress event with a V2 message block', () => {
    const evt = {
      egress: { connector: 'twitch' },
      message: {
        rawPlatformPayload: {
          text: 'original message'
        }
      }
    };
    expect(extractEgressTextFromEvent(evt)).toBeNull();
  });

  it('falls back to payload.text if message is missing even if egress is present (hybrid/legacy test cases)', () => {
    const evt = {
      v: '2',
      egress: { destination: 'discord' },
      payload: { text: 'hybrid message' }
    };
    expect(extractEgressTextFromEvent(evt)).toBe('hybrid message');
  });

  it('falls back to payload.text for pure V1 legacy events', () => {
    const evt = {
      egress: { destination: 'discord' },
      payload: { text: 'legacy message' }
    };
    expect(extractEgressTextFromEvent(evt)).toBe('legacy message');
  });
});
