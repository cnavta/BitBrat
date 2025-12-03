import { normalizeAttributes } from '../../../src/services/message-bus';

describe('normalizeAttributes', () => {
  it('lower-camel-cases keys and stringifies values, filtering null/undefined', () => {
    const out = normalizeAttributes({
      Correlation_ID: 'abc',
      'trace-parent': 123,
      STEP_ID: 'x',
      idempotency_key: null,
      extra_value: undefined,
    });
    expect(out).toEqual({
      correlationId: 'abc',
      traceParent: '123',
      stepId: 'x',
    });
  });
});
