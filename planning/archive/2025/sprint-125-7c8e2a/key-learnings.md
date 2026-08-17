Key Learnings – sprint-125-7c8e2a

- Token-boundary matching with a parentheses exception provides precise control and aligns with expectations, but needs extensive tests to avoid regressions.
- Enforcing ALLOWED_SIGILS prevents unexpected matches and keeps the matching pass performant, especially when multi-character sigils are introduced.
- Normalizing Firestore docs (defaulting termLocation to 'prefix') preserves backward compatibility with legacy data.
- Clear telemetry (deferred) will help triage ambiguous matching scenarios in production; prioritizing this early reduces debugging time.
- Keeping the fallback search O(tokens) by limiting reverse lookups to candidate keys from text avoids expensive Firestore scans.
- Centralizing regex/boundary utilities in a helper module could simplify maintenance across services that parse commands.
