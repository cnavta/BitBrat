import { VariableResolver } from '../variable-resolver';
import { InternalEventV2 } from '../../../../types/events';

describe('VariableResolver', () => {
  let resolver: VariableResolver;
  const mockEvent: InternalEventV2 = {
    correlationId: 'test-correlation-id',
    type: 'test.event',
    identity: {
      user: {
        id: 'user-123'
      }
    },
    payload: {
      foo: 'bar'
    }
  } as any;

  beforeEach(() => {
    resolver = new VariableResolver();
    process.env.TEST_VAR = 'env-value';
    process.env.MY_SECRET = 'secret-value';
  });

  afterEach(() => {
    delete process.env.TEST_VAR;
    delete process.env.MY_SECRET;
  });

  test('resolves event properties', () => {
    expect(resolver.resolve('${event.correlationId}', mockEvent)).toBe('test-correlation-id');
    expect(resolver.resolve('${event.identity.user.id}', mockEvent)).toBe('user-123');
    expect(resolver.resolve('${event.payload.foo}', mockEvent)).toBe('bar');
  });

  test('resolves environment variables', () => {
    expect(resolver.resolve('${ENV.TEST_VAR}', mockEvent)).toBe('env-value');
  });

  test('resolves secrets from environment', () => {
    expect(resolver.resolve('${secret.MY_SECRET}', mockEvent)).toBe('secret-value');
  });

  test('handles missing values gracefully', () => {
    expect(resolver.resolve('${event.missing}', mockEvent)).toBe('');
    expect(resolver.resolve('${ENV.MISSING}', mockEvent)).toBe('');
    expect(resolver.resolve('${secret.MISSING}', mockEvent)).toBe('');
  });

  test('resolves multiple tokens in a string', () => {
    const template = 'ID: ${event.correlationId}, User: ${event.identity.user.id}, Env: ${ENV.TEST_VAR}';
    const expected = 'ID: test-correlation-id, User: user-123, Env: env-value';
    expect(resolver.resolve(template, mockEvent)).toBe(expected);
  });

  test('resolves maps', () => {
    const headers = {
      'X-Correlation-ID': '${event.correlationId}',
      'X-User-ID': '${event.identity.user.id}',
      'Authorization': 'Bearer ${secret.MY_SECRET}',
      'Static': 'fixed'
    };
    const expected = {
      'X-Correlation-ID': 'test-correlation-id',
      'X-User-ID': 'user-123',
      'Authorization': 'Bearer secret-value',
      'Static': 'fixed'
    };
    expect(resolver.resolveMap(headers, mockEvent)).toEqual(expected);
  });

  test('leaves unknown tokens alone if regex does not match', () => {
    expect(resolver.resolve('${unknown.token}', mockEvent)).toBe('${unknown.token}');
  });
});
