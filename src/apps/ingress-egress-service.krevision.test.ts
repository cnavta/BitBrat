import request from 'supertest';
import { createApp } from './ingress-egress-service';

describe('ingress-egress K_REVISION precedence', () => {
  const OLD_ENV = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('uses K_REVISION as instanceId for egress topic', async () => {
    process.env.K_REVISION = 'krev-1234';
    process.env.TWITCH_CHANNELS = process.env.TWITCH_CHANNELS || 'testchan';

    const app = createApp();
    const res = await request(app).get('/_debug/twitch').expect(200);
    expect(res.body).toHaveProperty('egressTopic');
    expect(res.body.egressTopic).toBe(`internal.egress.v1.${process.env.K_REVISION}`);
  });
});
