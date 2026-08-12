/**
 * Discord Webhook Utilities Tests
 *
 * Tests for Discord signature verification (Ed25519).
 *
 * Sprint 11: Discord Integration Modernization (DISC-003)
 *
 * @since Sprint 11
 */

import { validateDiscordSignature, isTimestampValid } from '../webhook-utils';
import nacl from 'tweetnacl';

describe('validateDiscordSignature', () => {
  // Generate a test keypair for Ed25519 signatures
  const testKeypair = nacl.sign.keyPair();
  const PUBLIC_KEY = Buffer.from(testKeypair.publicKey).toString('hex');
  const SECRET_KEY = testKeypair.secretKey;

  function generateValidSignature(timestamp: string, body: string | Buffer): string {
    const bodyBuffer = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
    const message = Buffer.concat([
      Buffer.from(timestamp, 'utf8'),
      bodyBuffer
    ]);

    const signature = nacl.sign.detached(
      new Uint8Array(message),
      SECRET_KEY
    );

    return Buffer.from(signature).toString('hex');
  }

  describe('valid signatures', () => {
    it('should pass with valid signature (string body)', () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const body = JSON.stringify({ type: 1 }); // Ping interaction
      const signature = generateValidSignature(timestamp, body);

      const result = validateDiscordSignature(PUBLIC_KEY, signature, timestamp, body);

      expect(result).toBe(true);
    });

    it('should pass with valid signature (Buffer body)', () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const body = Buffer.from(JSON.stringify({ type: 2, data: { name: 'test' } }));
      const signature = generateValidSignature(timestamp, body);

      const result = validateDiscordSignature(PUBLIC_KEY, signature, timestamp, body);

      expect(result).toBe(true);
    });

    it('should validate signatures for complex interaction payloads', () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const body = JSON.stringify({
        type: 2,
        data: {
          id: '123456789',
          name: 'hello',
          options: [{ name: 'user', value: 'U123' }]
        },
        guild_id: 'G123',
        channel_id: 'C456',
        member: {
          user: { id: 'U789', username: 'testuser' }
        }
      });
      const signature = generateValidSignature(timestamp, body);

      const result = validateDiscordSignature(PUBLIC_KEY, signature, timestamp, body);

      expect(result).toBe(true);
    });
  });

  describe('invalid signatures', () => {
    it('should fail with invalid signature', () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const body = JSON.stringify({ type: 1 });
      const invalidSignature = '0'.repeat(128); // Invalid hex signature

      const result = validateDiscordSignature(PUBLIC_KEY, invalidSignature, timestamp, body);

      expect(result).toBe(false);
    });

    it('should fail with tampered body', () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const originalBody = JSON.stringify({ type: 1 });
      const signature = generateValidSignature(timestamp, originalBody);

      // Tamper with the body
      const tamperedBody = JSON.stringify({ type: 2 });

      const result = validateDiscordSignature(PUBLIC_KEY, signature, timestamp, tamperedBody);

      expect(result).toBe(false);
    });

    it('should fail with tampered timestamp', () => {
      const originalTimestamp = String(Math.floor(Date.now() / 1000));
      const body = JSON.stringify({ type: 1 });
      const signature = generateValidSignature(originalTimestamp, body);

      // Tamper with the timestamp
      const tamperedTimestamp = String(Math.floor(Date.now() / 1000) + 100);

      const result = validateDiscordSignature(PUBLIC_KEY, signature, tamperedTimestamp, body);

      expect(result).toBe(false);
    });

    it('should fail with wrong public key', () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const body = JSON.stringify({ type: 1 });
      const signature = generateValidSignature(timestamp, body);

      // Use a different public key
      const wrongKeypair = nacl.sign.keyPair();
      const wrongPublicKey = Buffer.from(wrongKeypair.publicKey).toString('hex');

      const result = validateDiscordSignature(wrongPublicKey, signature, timestamp, body);

      expect(result).toBe(false);
    });
  });

  describe('missing or malformed inputs', () => {
    it('should fail with missing signature', () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const body = JSON.stringify({ type: 1 });

      const result = validateDiscordSignature(PUBLIC_KEY, '', timestamp, body);

      expect(result).toBe(false);
    });

    it('should fail with missing timestamp', () => {
      const body = JSON.stringify({ type: 1 });
      const signature = '0'.repeat(128);

      const result = validateDiscordSignature(PUBLIC_KEY, signature, '', body);

      expect(result).toBe(false);
    });

    it('should fail with missing body', () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = '0'.repeat(128);

      const result = validateDiscordSignature(PUBLIC_KEY, signature, timestamp, '');

      expect(result).toBe(false);
    });

    it('should fail with missing public key', () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const body = JSON.stringify({ type: 1 });
      const signature = '0'.repeat(128);

      const result = validateDiscordSignature('', signature, timestamp, body);

      expect(result).toBe(false);
    });

    it('should fail with malformed signature (invalid hex)', () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const body = JSON.stringify({ type: 1 });
      const invalidSignature = 'not-valid-hex!!!';

      const result = validateDiscordSignature(PUBLIC_KEY, invalidSignature, timestamp, body);

      expect(result).toBe(false);
    });

    it('should fail with malformed public key (invalid hex)', () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const body = JSON.stringify({ type: 1 });
      const signature = '0'.repeat(128);

      const result = validateDiscordSignature('not-valid-hex!!!', signature, timestamp, body);

      expect(result).toBe(false);
    });
  });
});

describe('isTimestampValid', () => {
  it('should pass with recent timestamp', () => {
    const timestamp = String(Math.floor(Date.now() / 1000));

    const result = isTimestampValid(timestamp);

    expect(result).toBe(true);
  });

  it('should fail with expired timestamp (> 5 minutes)', () => {
    const fiveMinutesAgo = Math.floor(Date.now() / 1000) - (6 * 60); // 6 minutes ago
    const timestamp = String(fiveMinutesAgo);

    const result = isTimestampValid(timestamp);

    expect(result).toBe(false);
  });

  it('should fail with future timestamp (> 5 minutes)', () => {
    const futureTimestamp = Math.floor(Date.now() / 1000) + (6 * 60); // 6 minutes in future
    const timestamp = String(futureTimestamp);

    const result = isTimestampValid(timestamp);

    expect(result).toBe(false);
  });

  it('should allow custom max age', () => {
    const tenMinutesAgo = Math.floor(Date.now() / 1000) - (10 * 60);
    const timestamp = String(tenMinutesAgo);

    // Should fail with default 5-minute max age
    expect(isTimestampValid(timestamp)).toBe(false);

    // Should pass with 15-minute max age
    expect(isTimestampValid(timestamp, 15 * 60)).toBe(true);
  });

  it('should fail with invalid timestamp format', () => {
    const timestamp = 'not-a-number';

    const result = isTimestampValid(timestamp);

    expect(result).toBe(false);
  });

  it('should fail with empty timestamp', () => {
    const result = isTimestampValid('');

    expect(result).toBe(false);
  });
});
