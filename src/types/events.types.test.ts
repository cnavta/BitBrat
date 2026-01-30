import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import fs from 'fs';
import path from 'path';
import {
  INTERNAL_BOT_REQUESTS_V1,
  INTERNAL_BOT_RESPONSES_V1,
  INTERNAL_DEADLETTER_V1,
  INTERNAL_EGRESS_V1,
  INTERNAL_INGRESS_V1,
  INTERNAL_ROUTES_V1,
  InternalEventV2,
} from './events';

describe('events.ts (InternalEventV2 refactor)', () => {
  it('exports topic constants', () => {
    expect(INTERNAL_INGRESS_V1).toBe('internal.ingress.v1');
    expect(INTERNAL_ROUTES_V1).toBe('internal.routes.v1');
    expect(INTERNAL_BOT_REQUESTS_V1).toBe('internal.bot.requests.v1');
    expect(INTERNAL_BOT_RESPONSES_V1).toBe('internal.bot.responses.v1');
    expect(INTERNAL_EGRESS_V1).toBe('internal.egress.v1');
    expect(INTERNAL_DEADLETTER_V1).toBe('internal.deadletter.v1');
  });

  it('InternalEventV2 sample conforms to refactored structure', () => {
    const event: InternalEventV2 = {
      v: '2',
      type: 'chat.message.v1',
      correlationId: 'c-123',
      traceId: 't-123',
      ingress: {
        ingressAt: '2026-01-29T22:00:00Z',
        source: 'ingress.twitch',
        channel: '#bitbrat',
      },
      identity: {
        external: {
          id: 'u123',
          platform: 'twitch',
          displayName: 'Alice',
        }
      },
      egress: { 
        destination: 'egress.twitch' 
      },
      routingSlip: [
        { id: 'router', status: 'OK' },
        { id: 'llm-bot', status: 'PENDING', nextTopic: INTERNAL_BOT_REQUESTS_V1 }
      ],
      message: {
        id: 'msg-1',
        role: 'user',
        text: 'Hello',
      },
      payload: { 
        foo: 'bar' 
      }
    };

    expect(event.v).toBe('2');
    expect(event.ingress.source).toBe('ingress.twitch');
    expect(event.identity.external.id).toBe('u123');
    expect(event.message?.text).toBe('Hello');
  });
});
