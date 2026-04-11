import { InternalEventV2 } from '../../types/events';
import { Logger } from '../../common/logging';
import { VariableResolver } from './utils/variable-resolver';
import { FormatterRegistry } from './utils/formatters';
import { PublisherResource } from '../../common/resources/publisher-manager';

export enum WebhookResult {
  DELIVERED = 'DELIVERED',
  FAILED = 'FAILED'
}

export const INTERNAL_EGRESS_FAILED_V1 = 'internal.egress.failed.v1';

export class WebhookManager {
  constructor(
    private readonly resolver: VariableResolver,
    private readonly formatterRegistry: FormatterRegistry,
    private readonly logger: Logger,
    private readonly publishers?: PublisherResource
  ) {}

  /**
   * Orchestrates the resolution, formatting, and delivery of a webhook egress event.
   */
  public async handleWebhookEgress(event: InternalEventV2): Promise<WebhookResult> {
    const metadata = event.egress?.metadata || {};
    const { webhookUrl, headers, format } = metadata;

    if (!webhookUrl) {
      this.logger.error('webhook.missing_url', { correlationId: event.correlationId });
      await this.publishFailure(event, 'MISSING_URL', 'webhookUrl is required in egress metadata');
      return WebhookResult.FAILED;
    }

    // 1. Resolve URL and Headers (Event, ENV, Secrets)
    const resolvedUrl = this.resolver.resolve(webhookUrl, event);
    const resolvedHeaders = this.resolver.resolveMap(headers, event);

    // 2. Select Formatter and Format Body
    const formatter = this.formatterRegistry.get(format || 'json');
    const body = formatter.format(event);

    this.logger.debug('webhook.delivery_attempt', {
      correlationId: event.correlationId,
      url: this.redactUrl(resolvedUrl),
      format: format || 'json'
    });

    // 3. Execute HTTP POST
    try {
      const response = await fetch(resolvedUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...resolvedHeaders
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      this.logger.info('webhook.delivered', {
        correlationId: event.correlationId,
        url: this.redactUrl(resolvedUrl),
        status: response.status
      });

      return WebhookResult.DELIVERED;
    } catch (err: any) {
      this.logger.error('webhook.delivery_failed', {
        correlationId: event.correlationId,
        url: this.redactUrl(resolvedUrl),
        error: err.message
      });
      
      await this.publishFailure(event, 'DELIVERY_FAILED', err.message);
      return WebhookResult.FAILED;
    }
  }

  /**
   * Publishes an egress.failed event to the message bus.
   */
  private async publishFailure(event: InternalEventV2, code: string, message: string) {
    if (!this.publishers) {
      this.logger.warn('webhook.publisher_not_configured', { correlationId: event.correlationId });
      return;
    }

    try {
      const failureEvent: InternalEventV2 = {
        v: '2',
        type: 'egress.failed.v1',
        correlationId: event.correlationId,
        traceId: event.traceId,
        ingress: event.ingress || {
          ingressAt: new Date().toISOString(),
          source: 'api-gateway',
          connector: 'webhook'
        },
        identity: event.identity,
        egress: event.egress,
        payload: {
          ...event.payload,
          error: { code, message }
        },
        routing: {
          stage: 'error',
          slip: [],
          history: event.routing?.history || []
        }
      };

      const publisher = this.publishers.create(INTERNAL_EGRESS_FAILED_V1);
      await publisher.publishJson(failureEvent);
      
      this.logger.info('webhook.failure_event_published', { 
        correlationId: event.correlationId, 
        code 
      });
    } catch (publishErr: any) {
      this.logger.error('webhook.failure_publish_error', { 
        correlationId: event.correlationId, 
        error: publishErr.message 
      });
    }
  }

  /**
   * Simple redaction for logging URLs that might contain sensitive tokens.
   */
  private redactUrl(url: string): string {
    try {
      const parsed = new URL(url);
      if (parsed.search) {
        return `${parsed.origin}${parsed.pathname}?redacted`;
      }
      return url;
    } catch {
      return 'invalid-url';
    }
  }
}
