/**
 * Slack Webhook Utilities
 *
 * Signature verification helpers for Slack Events API webhooks.
 *
 * Algorithm: HMAC-SHA256 of `v0:timestamp:body`
 * Reference: https://api.slack.com/authentication/verifying-requests-from-slack
 *
 * Sprint 348: Slack Integration
 *
 * @since Sprint 348
 */

import crypto from 'crypto';

/**
 * Verify Slack webhook signature
 *
 * Slack signs webhook requests using HMAC-SHA256 of the concatenated string:
 * `v0:{timestamp}:{body}`
 *
 * The signature is sent in the `x-slack-signature` header with format: `v0={hex}`
 * The timestamp is sent in the `x-slack-request-timestamp` header.
 *
 * **Replay Attack Prevention**: Requests older than 5 minutes are rejected.
 *
 * @param secret - Slack signing secret (from SLACK_SIGNING_SECRET env var)
 * @param signature - x-slack-signature header value (format: v0=<hex>)
 * @param timestamp - x-slack-request-timestamp header value (Unix timestamp)
 * @param body - Request body (parsed JSON object)
 * @returns true if signature is valid and timestamp is recent (< 5 minutes)
 *
 * @example
 * ```typescript
 * const valid = validateSlackSignature(
 *   process.env.SLACK_SIGNING_SECRET,
 *   req.headers['x-slack-signature'],
 *   req.headers['x-slack-request-timestamp'],
 *   req.body
 * );
 *
 * if (!valid) {
 *   return res.status(403).json({ error: 'invalid_signature' });
 * }
 * ```
 */
export function validateSlackSignature(
  secret: string,
  signature: string,
  timestamp: string,
  body: Record<string, any>
): boolean {
  // Validate inputs
  if (!secret || !signature || !timestamp || !body) {
    return false;
  }

  // Check signature format
  if (!signature.startsWith('v0=')) {
    return false;
  }

  // Replay attack prevention: reject requests older than 5 minutes
  const requestTimestamp = parseInt(timestamp, 10);
  if (isNaN(requestTimestamp)) {
    return false;
  }

  const currentTimestamp = Math.floor(Date.now() / 1000);
  const FIVE_MINUTES_IN_SECONDS = 5 * 60;

  if (Math.abs(currentTimestamp - requestTimestamp) > FIVE_MINUTES_IN_SECONDS) {
    return false; // Request too old or from future
  }

  // Slack requires the raw body string for signature verification
  // Express body-parser provides req.rawBody when configured correctly
  // For now, we reconstruct it from the parsed JSON
  const bodyString = JSON.stringify(body);

  // Construct basestring: "v0:timestamp:body"
  const basestring = `v0:${timestamp}:${bodyString}`;

  // Compute HMAC-SHA256
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(basestring);
  const computedSignature = `v0=${hmac.digest('hex')}`;

  // Timing-safe comparison
  try {
    const providedBuffer = Buffer.from(signature, 'utf8');
    const computedBuffer = Buffer.from(computedSignature, 'utf8');

    if (providedBuffer.length !== computedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(providedBuffer, computedBuffer);
  } catch (error) {
    // Buffer or comparison error
    return false;
  }
}
