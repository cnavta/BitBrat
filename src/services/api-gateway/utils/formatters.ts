import { InternalEventV2 } from '../../../types/events';
import { extractEgressTextFromEvent } from '../../../common/events/selection';

export interface WebhookFormatter {
  format(event: InternalEventV2): any;
}

export class JsonFormatter implements WebhookFormatter {
  public format(event: InternalEventV2): any {
    const text = extractEgressTextFromEvent(event);
    return {
      correlationId: event.correlationId,
      type: event.type,
      payload: text ? { ...event.payload, text } : event.payload
    };
  }
}

export class DiscordFormatter implements WebhookFormatter {
  public format(event: InternalEventV2): any {
    // Requirements: Map platform event fields to Discord's content, username, and avatar_url.
    // Use the best candidate response message text as the main content.
    const text = extractEgressTextFromEvent(event);
    return {
      content: text || event.payload?.text || 'Notification from BitBrat Platform',
      username: 'BitBrat (via Gateway)',
      avatar_url: 'https://bitbrat.com/avatar.png' // Default placeholder as per requirement notes elsewhere
    };
  }
}

export class FormatterRegistry {
  private formatters: Map<string, WebhookFormatter> = new Map();

  constructor() {
    this.register('json', new JsonFormatter());
    this.register('discord', new DiscordFormatter());
  }

  public register(name: string, formatter: WebhookFormatter): void {
    this.formatters.set(name, formatter);
  }

  public get(name: string): WebhookFormatter {
    return this.formatters.get(name) || this.formatters.get('json')!;
  }
}
