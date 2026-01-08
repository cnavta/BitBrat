import { TwilioTokenProvider } from '../token-provider';
import { IConfig } from '../../../../types';

describe('TwilioTokenProvider', () => {
  const mockConfig: Partial<IConfig> = {
    twilioAccountSid: 'AC123',
    twilioApiKey: 'SK123',
    twilioApiSecret: 'secret123',
    twilioChatServiceSid: 'IS123'
  };

  it('generates a token when configuration is complete', () => {
    const provider = new TwilioTokenProvider(mockConfig as IConfig);
    const token = provider.generateToken('test-user');
    expect(token).toBeDefined();
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
  });

  it('throws an error if configuration is missing', () => {
    const provider = new TwilioTokenProvider({} as IConfig);
    expect(() => provider.generateToken('user')).toThrow(/Missing Twilio configuration/);
  });
});
