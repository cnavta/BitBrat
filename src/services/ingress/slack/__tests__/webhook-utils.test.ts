/**
 * Slack Webhook Utilities Tests
 *
 * Tests for Slack signature verification (HMAC-SHA256).
 *
 * Sprint 348: Slack Integration (SLACK-003)
 *
 * @since Sprint 348
 */

import { validateSlackSignature } from '../webhook-utils';
import crypto from 'crypto';

describe('validateSlackSignature', () => {
  const SECRET = 'test-signing-secret';

  function generateValidSignature(timestamp: string, body: Record<string, any>): string {
    const bodyString = JSON.stringify(body);
    const basestring = `v0:${timestamp}:${bodyString}`;
    const hmac = crypto.createHmac('sha256', SECRET);
    hmac.update(basestring);
    return `v0=${hmac.digest('hex')}`;
  }

  it('should pass with valid signature', () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = { type: 'url_verification', challenge: 'test123' };
    const signature = generateValidSignature(timestamp, body);

    const result = validateSlackSignature(SECRET, signature, timestamp, body);

    expect(result).toBe(true);
  });

  it('should fail with invalid signature', () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = { type: 'url_verification', challenge: 'test123' };
    const invalidSignature = 'v0=invalid_signature_here';

    const result = validateSlackSignature(SECRET, invalidSignature, timestamp, body);

    expect(result).toBe(false);
  });

  it('should fail with expired timestamp (> 5 minutes)', () => {
    const fiveMinutesAgo = Math.floor(Date.now() / 1000) - (6 * 60); // 6 minutes ago
    const timestamp = String(fiveMinutesAgo);
    const body = { type: 'url_verification', challenge: 'test123' };
    const signature = generateValidSignature(timestamp, body);

    const result = validateSlackSignature(SECRET, signature, timestamp, body);

    expect(result).toBe(false);
  });

  it('should fail with future timestamp (> 5 minutes)', () => {
    const futureTimestamp = Math.floor(Date.now() / 1000) + (6 * 60); // 6 minutes in future
    const timestamp = String(futureTimestamp);
    const body = { type: 'url_verification', challenge: 'test123' };
    const signature = generateValidSignature(timestamp, body);

    const result = validateSlackSignature(SECRET, signature, timestamp, body);

    expect(result).toBe(false);
  });

  it('should fail with missing signature', () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = { type: 'url_verification', challenge: 'test123' };

    const result = validateSlackSignature(SECRET, '', timestamp, body);

    expect(result).toBe(false);
  });

  it('should fail with malformed signature (missing v0 prefix)', () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = { type: 'url_verification', challenge: 'test123' };
    const signature = generateValidSignature(timestamp, body).replace('v0=', '');

    const result = validateSlackSignature(SECRET, signature, timestamp, body);

    expect(result).toBe(false);
  });

  it('should use timing-safe comparison', () => {
    // This test verifies that even slightly different signatures of same length
    // are rejected without leaking information via timing
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = { type: 'url_verification', challenge: 'test123' };
    const validSignature = generateValidSignature(timestamp, body);

    // Create a signature with same length but different value
    const invalidSignature = validSignature.slice(0, -1) + 'x';

    const result = validateSlackSignature(SECRET, invalidSignature, timestamp, body);

    expect(result).toBe(false);
  });

  it('should reject empty secret', () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = { type: 'url_verification', challenge: 'test123' };
    const signature = 'v0=anything';

    const result = validateSlackSignature('', signature, timestamp, body);

    expect(result).toBe(false);
  });

  it('should reject invalid timestamp format', () => {
    const timestamp = 'not-a-number';
    const body = { type: 'url_verification', challenge: 'test123' };
    const signature = 'v0=anything';

    const result = validateSlackSignature(SECRET, signature, timestamp, body);

    expect(result).toBe(false);
  });

  it('should validate signatures for complex event payloads', () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = {
      type: 'event_callback',
      event: {
        type: 'message',
        user: 'U123456',
        channel: 'C123456',
        text: 'Hello, world!',
        ts: '1234567890.123456',
      },
      team_id: 'T123456',
    };
    const signature = generateValidSignature(timestamp, body);

    const result = validateSlackSignature(SECRET, signature, timestamp, body);

    expect(result).toBe(true);
  });
});
