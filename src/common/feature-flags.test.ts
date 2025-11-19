import { FeatureGate } from './feature-flags';

describe('FeatureGate', () => {
  it('parses truthy/falsey values', () => {
    const gate = new FeatureGate({ F1: 'true', F2: 'false' } as any);
    // inject mapping via overrides
    gate.setOverride('x', 'true');
    expect(gate.enabled('x')).toBe(true);
    gate.setOverride('x', 'false');
    expect(gate.enabled('x', true)).toBe(false);
  });

  it('falls back to default when env missing or malformed', () => {
    const gate = new FeatureGate({} as any);
    expect(gate.enabled('unknown.key', false)).toBe(false);
    expect(gate.enabled('unknown.key', true)).toBe(true);
  });

  it('honors overrides and clears cache on change', () => {
    const gate = new FeatureGate({} as any);
    expect(gate.enabled('k', false)).toBe(false);
    gate.setOverride('k', 'true');
    expect(gate.enabled('k', false)).toBe(true);
    gate.setOverride('k', 'false');
    expect(gate.enabled('k', true)).toBe(false);
    gate.setOverride('k', undefined);
    expect(gate.enabled('k', true)).toBe(true);
  });

  it('resolves from canonical env synonyms (backward compatibility)', () => {
    const gate = new FeatureGate({ ENABLE_EVENT_RESPONSES: 'true', TWITCH_ENABLED: 'false', PERMISSIONS_ENABLED: 'false' } as any);
    // bot.eventResponses maps to ENABLE_EVENT_RESPONSES
    expect(gate.enabled('bot.eventResponses', false)).toBe(true);
    // twitch.enabled maps to TWITCH_ENABLED
    expect(gate.enabled('twitch.enabled', true)).toBe(false);
    // permissions.enabled maps to PERMISSIONS_ENABLED
    expect(gate.enabled('permissions.enabled', true)).toBe(false);
  });
});
