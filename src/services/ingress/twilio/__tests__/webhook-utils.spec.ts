import { validateTwilioSignature } from '../webhook-utils';
import twilio from 'twilio';

jest.mock('twilio', () => ({
  validateRequest: jest.fn(),
}));

describe('WebhookUtils', () => {
  describe('validateTwilioSignature', () => {
    const authToken = 'test-token';
    const signature = 'test-signature';
    const url = 'https://example.com/webhooks/twilio';
    const params = { EventType: 'onConversationAdded' };

    it('should return true if twilio.validateRequest returns true', () => {
      (twilio.validateRequest as jest.Mock).mockReturnValue(true);
      const result = validateTwilioSignature(authToken, signature, url, params);
      expect(result).toBe(true);
      expect(twilio.validateRequest).toHaveBeenCalledWith(authToken, signature, url, params);
    });

    it('should return false if twilio.validateRequest returns false', () => {
      (twilio.validateRequest as jest.Mock).mockReturnValue(false);
      const result = validateTwilioSignature(authToken, signature, url, params);
      expect(result).toBe(false);
    });

    it('should return false and log error if twilio.validateRequest throws', () => {
      (twilio.validateRequest as jest.Mock).mockImplementation(() => {
        throw new Error('Validation failed');
      });
      const result = validateTwilioSignature(authToken, signature, url, params);
      expect(result).toBe(false);
    });
  });
});
