/**
 * Discord Webhook Utilities
 *
 * Signature verification helpers for Discord Interactions API webhooks.
 *
 * Algorithm: Ed25519 signature of `timestamp + body`
 * Reference: https://discord.com/developers/docs/interactions/receiving-and-responding#security-and-authorization
 *
 * Sprint 11: Discord Integration Modernization
 *
 * @since Sprint 11
 */

import nacl from 'tweetnacl';

/**
 * Verify Discord webhook signature
 *
 * Discord signs webhook requests using Ed25519 of the concatenated string:
 * `{timestamp}{body}`
 *
 * The signature is sent in the `x-signature-ed25519` header (hex string).
 * The timestamp is sent in the `x-signature-timestamp` header (Unix timestamp string).
 *
 * **Replay Attack Prevention**: Discord recommends rejecting requests older than 5 minutes,
 * but the timestamp validation is optional and can be enforced by the caller.
 *
 * @param publicKey - Discord application public key (hex string from Discord Developer Portal)
 * @param signature - x-signature-ed25519 header value (hex string)
 * @param timestamp - x-signature-timestamp header value (Unix timestamp string)
 * @param body - Raw request body as Buffer (NOT parsed JSON)
 * @returns true if signature is valid
 *
 * @example
 * ```typescript
 * const valid = validateDiscordSignature(
 *   process.env.DISCORD_PUBLIC_KEY,
 *   req.headers['x-signature-ed25519'],
 *   req.headers['x-signature-timestamp'],
 *   req.rawBody // Must be Buffer
 * );
 *
 * if (!valid) {
 *   return res.status(401).json({ error: 'invalid_request_signature' });
 * }
 * ```
 *
 * @example With replay attack prevention
 * ```typescript
 * const timestamp = req.headers['x-signature-timestamp'];
 * const requestTime = parseInt(timestamp, 10);
 * const currentTime = Math.floor(Date.now() / 1000);
 *
 * // Reject requests older than 5 minutes
 * if (Math.abs(currentTime - requestTime) > 300) {
 *   return res.status(401).json({ error: 'invalid_timestamp' });
 * }
 *
 * const valid = validateDiscordSignature(
 *   process.env.DISCORD_PUBLIC_KEY,
 *   req.headers['x-signature-ed25519'],
 *   timestamp,
 *   req.rawBody
 * );
 * ```
 */
export function validateDiscordSignature(
  publicKey: string,
  signature: string,
  timestamp: string,
  body: Buffer | string
): boolean {
  // Validate inputs
  if (!publicKey || !signature || !timestamp || !body) {
    return false;
  }

  try {
    // Ensure body is a Buffer
    const bodyBuffer = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');

    // Construct message: timestamp + body
    const message = Buffer.concat([
      Buffer.from(timestamp, 'utf8'),
      bodyBuffer
    ]);

    // Discord uses Ed25519 for signature verification
    // publicKey and signature are hex strings
    const publicKeyBytes = Buffer.from(publicKey, 'hex');
    const signatureBytes = Buffer.from(signature, 'hex');

    // Verify signature using tweetnacl (Ed25519)
    // tweetnacl.sign.detached.verify expects Uint8Array
    const isValid = nacl.sign.detached.verify(
      new Uint8Array(message),
      new Uint8Array(signatureBytes),
      new Uint8Array(publicKeyBytes)
    );

    return isValid;
  } catch (error) {
    // Verification error (invalid key format, signature format, etc.)
    return false;
  }
}

/**
 * Check if request timestamp is within acceptable range (replay attack prevention)
 *
 * Discord recommends rejecting requests older than 5 minutes.
 *
 * @param timestamp - x-signature-timestamp header value (Unix timestamp string)
 * @param maxAgeSeconds - Maximum age in seconds (default: 300 = 5 minutes)
 * @returns true if timestamp is valid and recent
 *
 * @example
 * ```typescript
 * if (!isTimestampValid(req.headers['x-signature-timestamp'])) {
 *   return res.status(401).json({ error: 'invalid_timestamp' });
 * }
 * ```
 */
export function isTimestampValid(
  timestamp: string,
  maxAgeSeconds: number = 300
): boolean {
  // Parse timestamp
  const requestTimestamp = parseInt(timestamp, 10);
  if (isNaN(requestTimestamp)) {
    return false;
  }

  // Check age
  const currentTimestamp = Math.floor(Date.now() / 1000);
  const age = Math.abs(currentTimestamp - requestTimestamp);

  return age <= maxAgeSeconds;
}
