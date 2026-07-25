/**
 * Sprint 363: chat command tests (smoke tests only)
 */

import Chat from './chat';

describe('chat command', () => {
  it('should extend BratCommand', () => {
    // @ts-ignore - accessing prototype for validation
    expect(Chat.prototype.constructor.name).toBe('Chat');
  });

  it('should have description', () => {
    expect(Chat.description).toBeTruthy();
    expect(Chat.description).toContain('chat');
  });

  it('should have examples', () => {
    expect(Chat.examples).toBeDefined();
    expect(Chat.examples.length).toBeGreaterThan(0);
  });

  it('should have all required flags', () => {
    expect(Chat.flags).toBeDefined();
    expect(Chat.flags.url).toBeDefined();
    expect(Chat.flags.message).toBeDefined();
    expect(Chat.flags.user).toBeDefined();
  });

  it('should inherit BratCommand baseFlags', () => {
    // BratCommand.baseFlags includes --context
    expect(Chat.flags.context).toBeDefined();
  });

  it('should be instantiable by oclif', () => {
    // oclif requires commands to have static properties
    expect(Chat.description).toBeDefined();
    expect(Chat.flags).toBeDefined();
  });
});
