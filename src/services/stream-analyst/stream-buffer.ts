import { getEncoding } from 'js-tiktoken';
import type { InternalEventV2 } from '../../types/events';

const encoding = getEncoding('cl100k_base');

export class StreamBuffer {
  private lines: string[] = [];
  private totalTokens: number = 0;

  constructor(private maxTokens: number = 8000) {}

  /**
   * Normalizes an event and adds it to the buffer if within token limits.
   * Format: [Timestamp] [User] [Message]
   * @returns boolean true if the event was added, false if it would exceed the token limit.
   */
  addEvent(event: InternalEventV2): boolean {
    const timestamp = event.ingress?.ingressAt || new Date().toISOString();
    const user = event.identity?.user?.displayName || event.identity?.external?.displayName || 'System';
    const message = event.message?.text || (event.payload ? JSON.stringify(event.payload) : '');
    
    const redactedMessage = this.redactPII(message);
    const line = `[${timestamp}] [${user}] ${redactedMessage}`;
    
    const tokens = encoding.encode(line).length + 1; // +1 for newline
    
    if (this.totalTokens + tokens <= this.maxTokens) {
      this.lines.push(line);
      this.totalTokens += tokens;
      return true;
    }
    return false;
  }

  /**
   * Redacts PII (emails, tokens/keys) from the text.
   */
  redactPII(text: string): string {
    if (!text) return '';
    // Basic email redaction
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    // Heuristic for tokens: 32+ alphanumeric characters without spaces
    const tokenRegex = /(?<![a-zA-Z0-9])[a-zA-Z0-9]{32,}(?![a-zA-Z0-9])/g;
    
    return text.replace(emailRegex, '[REDACTED_EMAIL]')
               .replace(tokenRegex, '[REDACTED_TOKEN]');
  }

  /**
   * Returns the buffered content, joined by newlines.
   * The events are returned in chronological order (assuming they were added in reverse chronological order).
   */
  getContent(): string {
    return this.lines.slice().reverse().join('\n');
  }

  getTokens(): number {
    return this.totalTokens;
  }

  clear(): void {
    this.lines = [];
    this.totalTokens = 0;
  }
}
