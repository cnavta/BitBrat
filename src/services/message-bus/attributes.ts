import { AttributeMap } from './index';

/**
 * Normalize attribute keys and values for transport.
 * - Keys: lowerCamelCase
 * - Values: stringified; undefined/null filtered out
 */
export function normalizeAttributes(input: Record<string, unknown> | undefined | null): AttributeMap {
  const out: AttributeMap = {};
  if (!input) return out;
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined || v === null) continue;
    const key = toLowerCamelCase(String(k));
    out[key] = String(v);
  }
  return out;
}

function toLowerCamelCase(s: string): string {
  if (!s) return s;
  // Convert snake_case or kebab-case to camelCase, and ensure first char lower
  const parts = s.replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(' ');
  if (parts.length === 0) return s;
  const first = parts[0].charAt(0).toLowerCase() + parts[0].slice(1);
  const rest = parts.slice(1).map(p => p ? p.charAt(0).toUpperCase() + p.slice(1) : '');
  return [first, ...rest].join('');
}
