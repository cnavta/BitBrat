LLM Bot – Modular Personality Injection

Overview
- The llm-bot can incorporate dynamic “personality” instructions into its system prompt based on event annotations.
- Personalities are provided inline in the annotation payload or resolved from Firestore /personalities by name, selecting the latest active version.

Annotation payload
{
  name?: string,   // Personality name used for lookup
  text?: string    // Inline text. If present, it is used and no Firestore call is made
}

Selection (Firestore)
- Collection: /personalities
- Query: where name == payload.name AND status == "active", orderBy version DESC, limit 1
- Indexing guidance: composite index on (name asc, status asc, version desc)

Document schema (recommended)
- id: Firestore auto-generated ID
- name: string
- text: string
- status: active | inactive | archived
- tags: string[]
- version: number (monotonic)
- createdAt: ISO8601 string
- updatedAt: ISO8601 string

Composition modes
- PERSONALITY_COMPOSE_MODE = append | prepend | replace (default: append)
- append: base + two newlines + personalities
- prepend: personalities + two newlines + base
- replace: personalities only (keeps a minimal safety header if result would be empty)

Limits and safety
- PERSONALITY_MAX_ANNOTATIONS (default 3): only the earliest N by createdAt are used
- PERSONALITY_MAX_CHARS (default 4000): each personality text is clamped to this length
- Sanitization removes null chars and trims text; additional hardening can be added later

Caching
- In-memory TTL cache keyed by name: PERSONALITY_CACHE_TTL_MS (default 5m)
- Inline text does not use the cache

Feature flag
- PERSONALITY_ENABLED=true|false (default true)
- When disabled or no personality annotations present, llm-bot behaves as before

Observability
- Structured logs:
  - llm_bot.personality.composed with fields: names, versions, mode, counts, preview
- Metrics (in-process counters):
  - personalities_resolved_total
  - personalities_failed_total
  - personalities_dropped_total
  - personality_cache_hit_total
  - personality_cache_miss_total
  - personality_clamped_total

Security and Firestore rules
- The llm-bot uses the Firebase Admin SDK and should be run with a least-privilege service account that only needs read access to /personalities.
- Firestore Rules do not apply to Admin SDK usage, but should still be locked down for any client access patterns:

Production rules snippet (example)
service cloud.firestore {
  match /databases/{database}/documents {
    match /personalities/{doc} {
      allow read: if request.auth != null && request.time < timestamp.date(9999,1,1);
      allow write: if false; // no client writes
    }
  }
}

Indexing
- Create a composite index on /personalities for querying by (name asc, status asc, version desc)
  - name: Ascending
  - status: Ascending
  - version: Descending

Examples
- Inline only:
  {
    kind: "personality",
    payload: { text: "You are witty and concise." }
  }

- Name only:
  {
    kind: "personality",
    payload: { name: "bitbrat-default" }
  }

- Mixed (multiple personalities):
  [
    { kind: "personality", payload: { text: "Be playful." }, createdAt: "2025-01-01T00:00:00Z" },
    { kind: "personality", payload: { name: "bitbrat-default" }, createdAt: "2025-01-01T00:00:01Z" }
  ]

Troubleshooting
- If no personality is found by name, the resolver logs personality.resolve.miss and proceeds without it.
- If a document is inactive, it is ignored with personality.resolve.inactive.
- If PERSONALITY_ENABLED=false, only the base system prompt is used.
