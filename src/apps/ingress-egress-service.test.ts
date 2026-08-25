/**
 * Tests for IntegrationBit-based Ingress-Egress Service
 *
 * Simplified tests focusing on IntegrationBit integration.
 * IntegrationBit handles connector management, webhook routing, and debug endpoints.
 *
 * @since Sprint 12
 */

// Ensure test environment is set BEFORE importing/creating app
process.env.NODE_ENV = 'test';

import request from 'supertest';
import { createApp } from './ingress-egress-service';

describe('IngressEgressServer (IntegrationBit-based)', () => {
  const app = createApp();

  describe('Health Endpoints', () => {
    it('GET /healthz returns 200', async () => {
      await request(app).get('/healthz').expect(200);
    });

    // TODO: Intermittent NATS connection error - skip until infrastructure is available
    it.skip('GET /readyz returns 200 with ready:true', async () => {
      const res = await request(app).get('/readyz').expect(200);
      expect(res.body.ready).toBe(true);
    });

    // TODO: Intermittent NATS connection error - skip until infrastructure is available
    it.skip('GET /livez returns 200', async () => {
      await request(app).get('/livez').expect(200);
    });
  });

  describe('Debug Endpoints (IntegrationBit)', () => {
    // TODO: Intermittent NATS connection error - skip until infrastructure is available
    it.skip('GET /_debug/instance returns instance metadata', async () => {
      const res = await request(app).get('/_debug/instance').expect(200);
      // IntegrationBit returns: serviceName, instanceId, connectorCount, connectors, egressTopic
      expect(res.body).toHaveProperty('serviceName', 'ingress-egress');
      expect(res.body).toHaveProperty('instanceId');
      expect(res.body).toHaveProperty('connectorCount');
      expect(res.body).toHaveProperty('connectors');
      expect(res.body).toHaveProperty('egressTopic');
    });

    // TODO: Intermittent NATS connection error - skip until infrastructure is available
    it.skip('GET /_debug/connectors returns all connector snapshots', async () => {
      const res = await request(app).get('/_debug/connectors').expect(200);
      expect(res.body).toHaveProperty('connectors');
      expect(typeof res.body.connectors).toBe('object');
      // Should have at least twitch connector
      expect(res.body.connectors).toHaveProperty('twitch');
    });

    // TODO: Intermittent NATS connection error - skip until infrastructure is available
    it.skip('GET /_debug/twitch returns Twitch connector snapshot', async () => {
      const res = await request(app).get('/_debug/twitch').expect(200);
      // IntegrationBit returns connector snapshot directly
      expect(res.body).toHaveProperty('state');
      expect(typeof res.body.state).toBe('string');
      expect(res.body).toHaveProperty('counters');
    });

    // TODO: Intermittent NATS connection error - skip until infrastructure is available
    it.skip('GET /_debug/discord returns Discord connector snapshot or 404 if disabled', async () => {
      const res = await request(app).get('/_debug/discord');
      // Discord may be disabled in test environment, so accept both 200 and 404
      if (res.status === 200) {
        expect(res.body).toHaveProperty('state');
        expect(typeof res.body.state).toBe('string');
      } else {
        expect(res.status).toBe(404);
      }
    });

    // TODO: Intermittent NATS connection error - skip until infrastructure is available (flaky test)
    it.skip('GET /_debug/unknown returns 404 for non-existent connector', async () => {
      await request(app).get('/_debug/unknown').expect(404);
    });
  });

  describe('Webhook Endpoints (IntegrationBit)', () => {
    // TODO: Intermittent NATS connection error - skip until infrastructure is available
    it.skip('POST /webhooks/:platform is registered for generic webhook routing', async () => {
      // Without proper signature/credentials, should fail validation
      // But endpoint should exist and respond (not 404)
      const res = await request(app)
        .post('/webhooks/twitch')
        .send({ test: 'data' });

      // Should not be 404 (endpoint exists)
      expect(res.status).not.toBe(404);
    });
  });
});
