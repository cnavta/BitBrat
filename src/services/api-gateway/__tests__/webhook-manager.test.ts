import { WebhookManager, WebhookResult } from '../webhook-manager';
import { VariableResolver } from '../utils/variable-resolver';
import { FormatterRegistry } from '../utils/formatters';
import { InternalEventV2 } from '../../../types/events';
import { Logger } from '../../../common/logging';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch as any;

describe('WebhookManager', () => {
  let manager: WebhookManager;
  let resolver: VariableResolver;
  let registry: FormatterRegistry;
  let logger: Logger;
  let mockPublisher: any;

  const mockEvent: InternalEventV2 = {
    correlationId: 'test-id',
    traceId: 'trace-id',
    type: 'test.event',
    egress: {
      connector: 'webhook',
      metadata: {
        webhookUrl: 'http://example.com/webhook',
        format: 'json',
        headers: {
          'X-Test': 'test-header'
        }
      }
    },
    payload: {
      foo: 'bar'
    }
  } as any;

  beforeEach(() => {
    resolver = new VariableResolver();
    registry = new FormatterRegistry();
    logger = {
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn()
    } as any;
    mockPublisher = {
      create: jest.fn().mockReturnValue({
        publishJson: jest.fn().mockResolvedValue({})
      })
    };
    manager = new WebhookManager(resolver, registry, logger, mockPublisher);
    mockFetch.mockReset();
  });

  test('successful delivery', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200
    });

    const result = await manager.handleWebhookEgress(mockEvent);

    expect(result).toBe(WebhookResult.DELIVERED);
    expect(mockFetch).toHaveBeenCalledWith('http://example.com/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Test': 'test-header'
      },
      body: JSON.stringify({
        correlationId: 'test-id',
        type: 'test.event',
        payload: { foo: 'bar' }
      })
    });
    expect(logger.info).toHaveBeenCalledWith('webhook.delivered', expect.anything());
    expect(mockPublisher.create).not.toHaveBeenCalled();
  });

  test('failed delivery (HTTP 500) publishes failure event', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error'
    });

    const result = await manager.handleWebhookEgress(mockEvent);

    expect(result).toBe(WebhookResult.FAILED);
    expect(logger.error).toHaveBeenCalledWith('webhook.delivery_failed', expect.anything());
    expect(mockPublisher.create).toHaveBeenCalledWith('internal.egress.failed.v1');
    const publishJson = mockPublisher.create.mock.results[0].value.publishJson;
    expect(publishJson).toHaveBeenCalledWith(expect.objectContaining({
      type: 'egress.failed.v1',
      payload: expect.objectContaining({
        error: expect.objectContaining({ code: 'DELIVERY_FAILED' })
      })
    }));
  });

  test('failed delivery (Network Error) publishes failure event', async () => {
    mockFetch.mockRejectedValue(new Error('DNS failed'));

    const result = await manager.handleWebhookEgress(mockEvent);

    expect(result).toBe(WebhookResult.FAILED);
    expect(logger.error).toHaveBeenCalledWith('webhook.delivery_failed', expect.anything());
    expect(mockPublisher.create).toHaveBeenCalled();
  });

  test('resolves variables before sending', async () => {
    process.env.TEST_URL = 'http://resolved.com';
    const eventWithVars = {
      ...mockEvent,
      egress: {
        ...mockEvent.egress,
        metadata: {
          webhookUrl: '${ENV.TEST_URL}/${event.correlationId}',
          headers: {
            'X-ID': '${event.correlationId}'
          }
        }
      }
    } as any;

    mockFetch.mockResolvedValue({ ok: true });

    await manager.handleWebhookEgress(eventWithVars);

    expect(mockFetch).toHaveBeenCalledWith('http://resolved.com/test-id', expect.objectContaining({
      headers: expect.objectContaining({
        'X-ID': 'test-id'
      })
    }));

    delete process.env.TEST_URL;
  });

  test('uses discord formatter when specified', async () => {
    const eventDiscord = {
      ...mockEvent,
      egress: {
        ...mockEvent.egress,
        metadata: {
          ...mockEvent.egress?.metadata,
          format: 'discord'
        }
      },
      payload: {
        text: 'hello discord'
      }
    } as any;

    mockFetch.mockResolvedValue({ ok: true });

    await manager.handleWebhookEgress(eventDiscord);

    expect(mockFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      body: JSON.stringify({
        content: 'hello discord',
        username: 'BitBrat (via Gateway)',
        avatar_url: 'https://bitbrat.com/avatar.png'
      })
    }));
  });

  test('returns failed if webhookUrl is missing', async () => {
    const eventNoUrl = { ...mockEvent, egress: { metadata: {} } } as any;
    const result = await manager.handleWebhookEgress(eventNoUrl);
    expect(result).toBe(WebhookResult.FAILED);
    expect(logger.error).toHaveBeenCalledWith('webhook.missing_url', expect.anything());
  });
});
