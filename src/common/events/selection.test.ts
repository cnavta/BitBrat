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

  it('returns null if candidates is missing and it is an egress event', () => {
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
});
