// Basic redaction utilities for safe logging (PASM-V2-12)

export interface RedactionOptions {
  redactEmails: boolean;
  redactApiKeys: boolean; // e.g., sk-*, AKIA*
  redactLongTokens: boolean; // long opaque tokens (>=32 word chars)
  redactCardLikeNumbers: boolean; // 13-19 consecutive digits
  redactBearerTokens: boolean; // Bearer <token>
}

const DEFAULTS: RedactionOptions = {
  redactEmails: true,
  redactApiKeys: true,
  redactLongTokens: true,
  redactCardLikeNumbers: true,
  redactBearerTokens: true,
};

/**
 * Redacts obvious secrets/PII patterns from arbitrary text to reduce leak risk in logs.
 * Intentionally simple — not a comprehensive DLP solution.
 */
export function redactText(input: string, opts?: Partial<RedactionOptions>): string {
  const o = { ...DEFAULTS, ...(opts || {}) } as RedactionOptions;
  let out = String(input ?? "");

  if (!out) return out;

  if (o.redactEmails) {
    // Basic email pattern
    out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[REDACTED_EMAIL]");
  }

  if (o.redactApiKeys) {
    // OpenAI-style keys sk-<alnum>{16,}
    out = out.replace(/sk-[A-Za-z0-9]{16,}/g, "[REDACTED_KEY]");
    // AWS Access Key IDs
    out = out.replace(/AKIA[0-9A-Z]{16}/g, "[REDACTED_KEY]");
  }

  if (o.redactBearerTokens) {
    // Bearer tokens in headers/text
    out = out.replace(/Bearer\s+[A-Za-z0-9._-]{10,}/gi, "Bearer [REDACTED_TOKEN]");
  }

  if (o.redactLongTokens) {
    // Generic long token-like strings (32+ of URL-safe word chars)
    out = out.replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[REDACTED_TOKEN]");
  }

  if (o.redactCardLikeNumbers) {
    // 13–19 digit numbers (Luhn not checked — heuristic)
    out = out.replace(/\b\d{13,19}\b/g, "[REDACTED_NUMBER]");
  }

  return out;
}
