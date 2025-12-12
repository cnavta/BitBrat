import { composeSystemPrompt } from '../prompt-composer';
import type { ResolvedPersonality } from '../personality-resolver';

describe('composeSystemPrompt', () => {
  const parts: ResolvedPersonality[] = [
    { text: 'P1', source: 'inline' },
    { text: 'P2', source: 'inline' },
  ];

  it('append (default) places personalities after base', () => {
    const out = composeSystemPrompt('BASE', parts, 'append');
    expect(out).toBe('BASE\n\nP1\n\nP2');
  });

  it('prepend places personalities before base', () => {
    const out = composeSystemPrompt('BASE', parts, 'prepend');
    expect(out).toBe('P1\n\nP2\n\nBASE');
  });

  it('replace uses personalities only', () => {
    const out = composeSystemPrompt('BASE', parts, 'replace');
    expect(out).toBe('P1\n\nP2');
  });

  it('returns base when no parts present', () => {
    const out = composeSystemPrompt('BASE', [], 'append');
    expect(out).toBe('BASE');
  });
});
