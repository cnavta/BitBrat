import twilio from 'twilio';
import { logger } from '../../../common/logging';

/**
 * Validates the Twilio signature for a request.
 * @param authToken Twilio Auth Token
 * @param signature X-Twilio-Signature header
 * @param url Full URL of the request
 * @param params Request body params (urlencoded)
 */
export function validateTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, any>
): boolean {
  try {
    return twilio.validateRequest(authToken, signature, url, params);
  } catch (err: any) {
    logger.error('twilio.signature_validation_error', { error: err.message });
    return false;
  }
}
