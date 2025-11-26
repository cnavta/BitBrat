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
  InternalEventV1,
} from './events';

describe('events.ts (Sprint 77 contracts)', () => {
  it('exports topic constants', () => {
    expect(INTERNAL_INGRESS_V1).toBe('internal.ingress.v1');
    expect(INTERNAL_ROUTES_V1).toBe('internal.routes.v1');
    expect(INTERNAL_BOT_REQUESTS_V1).toBe('internal.bot.requests.v1');
    expect(INTERNAL_BOT_RESPONSES_V1).toBe('internal.bot.responses.v1');
    expect(INTERNAL_EGRESS_V1).toBe('internal.egress.v1');
    expect(INTERNAL_DEADLETTER_V1).toBe('internal.deadletter.v1');
  });

  it('InternalEventV1 sample conforms to envelope schema', () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);

    const schemaDir = path.join(__dirname, '..', '..', 'documentation', 'schemas');
    const envelopeSchema = JSON.parse(fs.readFileSync(path.join(schemaDir, 'envelope.v1.json'), 'utf-8'));
    const routingSchema = JSON.parse(fs.readFileSync(path.join(schemaDir, 'routing-slip.v1.json'), 'utf-8'));
    ajv.addSchema(routingSchema, routingSchema.$id || 'routing-slip.v1.json');
    const validate = ajv.getSchema(envelopeSchema.$id) || ajv.compile(envelopeSchema);

    const event: InternalEventV1 = {
      envelope: {
        v: '1',
        source: 'ingress.twitch',
        correlationId: 'c-123',
        traceId: 't-123',
        routingSlip: [
          { id: 'router', status: 'OK' },
          { id: 'llm-bot', status: 'PENDING', nextTopic: INTERNAL_BOT_REQUESTS_V1 }
        ]
      },
      type: 'chat.message.v1',
      payload: { channel: '#bitbrat', text: 'Hello' }
    };

    const ok = validate!(event.envelope);
    if (!ok) {
      // eslint-disable-next-line no-console
      console.error('[DEBUG_LOG] schema errors', validate!.errors);
    }
    expect(ok).toBe(true);
  });
});
