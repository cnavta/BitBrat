import twilio from 'twilio';
import { IConfig } from '../../../types';

export class TwilioTokenProvider {
  constructor(private readonly config: IConfig) {}

  /**
   * Generates a JWT Access Token for Twilio Conversations.
   * @param identity The identity of the user/bot for whom the token is generated.
   * @returns A JWT string.
   */
  generateToken(identity: string): string {
    const { twilioAccountSid, twilioApiKey, twilioApiSecret, twilioChatServiceSid } = this.config;
    const { logger } = require('../../../common/logging');

    if (!twilioAccountSid || !twilioApiKey || !twilioApiSecret || !twilioChatServiceSid) {
      const missing = [];
      if (!twilioAccountSid) missing.push('twilioAccountSid');
      if (!twilioApiKey) missing.push('twilioApiKey');
      if (!twilioApiSecret) missing.push('twilioApiSecret');
      if (!twilioChatServiceSid) missing.push('twilioChatServiceSid');
      logger.error('twilio.token_provider.config_missing', { missing });
      throw new Error('Missing Twilio configuration for token generation');
    }

    logger.debug('twilio.token_provider.generate_start', { identity, chatServiceSid: twilioChatServiceSid });

    const AccessToken = twilio.jwt.AccessToken;
    const ChatGrant = AccessToken.ChatGrant;

    // Create an access token which we will sign and return to the client,
    // containing the grant we just created
    const token = new AccessToken(
      twilioAccountSid,
      twilioApiKey,
      twilioApiSecret,
      { identity }
    );

    // Create a "grant" which enables a client to use Chat as a given user,
    // on a given device
    const chatGrant = new ChatGrant({
      serviceSid: twilioChatServiceSid,
    });

    token.addGrant(chatGrant);

    return token.toJwt();
  }
}
