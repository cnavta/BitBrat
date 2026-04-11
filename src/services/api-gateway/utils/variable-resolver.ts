import { InternalEventV2 } from '../../../types/events';
import get from 'lodash/get';

export class VariableResolver {
  private readonly tokenRegex = /\$\{(event|ENV|secret)\.([^}]+)\}/g;

  /**
   * Resolves tokens in a string using the provided event and environment.
   */
  public resolve(template: string, event: InternalEventV2): string {
    if (!template) return template;

    return template.replace(this.tokenRegex, (match, type, path) => {
      switch (type) {
        case 'event':
          return this.resolveEventProperty(event, path);
        case 'ENV':
          return this.resolveEnvVariable(path);
        case 'secret':
          return this.resolveSecret(path);
        default:
          return match;
      }
    });
  }

  /**
   * Resolves tokens in all values of a map.
   */
  public resolveMap(
    map: Record<string, string> | undefined,
    event: InternalEventV2
  ): Record<string, string> {
    if (!map) return {};

    const resolved: Record<string, string> = {};
    for (const [key, value] of Object.entries(map)) {
      resolved[key] = this.resolve(value, event);
    }
    return resolved;
  }

  private resolveEventProperty(event: InternalEventV2, path: string): string {
    const value = get(event, path);
    return value !== undefined && value !== null ? String(value) : '';
  }

  private resolveEnvVariable(name: string): string {
    const value = process.env[name];
    return value !== undefined ? value : '';
  }

  private resolveSecret(name: string): string {
    // For now, secrets are resolved from environment variables as per requirements.
    // This can be extended to use GCP Secret Manager in the future.
    const value = process.env[name];
    return value !== undefined ? value : '';
  }
}
