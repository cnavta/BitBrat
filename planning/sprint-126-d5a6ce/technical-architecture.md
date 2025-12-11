Technical Architecture – Command Processor Simplified Matching

Status: Draft for approval
Sprint: sprint-126-d5a6ce
Owner: @christophernavta

1. Context & Goals
- Use only globally configured ALLOWED_SIGILS for command detection.
- Remove per-command sigils, sigilOptional, and termLocation.
- Introduce two matching kinds with strict priority ordering:
  - command: starts with a sigil; token after sigil is the term; remainder is arguments attached as annotation.
  - regex: if no command match, evaluate regex commands by priority; capture groups attached as annotation.
- Migration of existing docs and feature flags are out of scope for this sprint.

2. Data Model (Firestore) – CommandDoc vNext
- Fields used:
  - id: string
  - name: string (lowercase canonical)
  - type?: 'candidate' | 'annotation'
  - annotationKind?: AnnotationKindV1
  - matchType: { kind: 'command' | 'regex'; values: string[]; priority: number }
  - description?: string
  - templates: [{ id: string; text: string }]
  - cooldowns?: { globalMs?: number; perUserMs?: number }
  - rateLimit?: { max: number; perMs: number }
  - runtime?: { lastUsedTemplateId?: string; lastExecutionAt?: string }
- Removed from design: sigil, sigilOptional, termLocation, aliases.
- Indexing:
  - Command: where kind == 'command' AND values array-contains term ORDER BY priority ASC LIMIT 1 (composite index required).
  - Regex: where kind == 'regex' then sort by priority ASC; cache in memory to avoid full scans per message.

3. Configuration
- ALLOWED_SIGILS: string[] from env configs (e.g., ["!", "@"]). If missing, default to ["!"].
- Limits: maximum regex commands and patterns per command; maximum message length considered for regex matching.

4. Matching Pipeline
- Given message text T and ALLOWED_SIGILS S:
  1) Command path
     - If T starts with any sigil s in S: extract term (first token after sigil) and args (remaining tokens and argsText).
     - Lookup first command by (kind='command', values contains term) ordered by priority.
     - If found and policies allow, emit annotation with payload { sigil, term, args, argsText } and proceed with templates as today.
  2) Regex path
     - If command path did not match: iterate regex commands by priority.
     - For each pattern in values, test against T; on first match, capture positional and named groups.
     - Emit annotation with payload { pattern, groups, namedGroups }.
- One match per message in this iteration. Tie-breaker: lower priority first, then doc id ascending for stability.

5. Processor Integration Changes (Outline)
- Read ALLOWED_SIGILS array from config; replace single-sigil parsing.
- Replace findByNameOrAlias with:
  - findFirstByCommandTerm(term): query by matchType for classic commands.
  - loadRegexCommands(): cache regex commands sorted by priority and compile patterns.
- Reuse annotation helper with standard payloads defined above.

6. Safety & Performance
- Regex safeguards: validate patterns at load time; cap message length; cap patterns/commands; consider RE2-based engine in follow-up.
- Caching: in-memory cache for regex commands (and optionally a term index). The processor MUST register a Firestore onSnapshot listener on the commands query (matchType.kind == 'regex') and rebuild the compiled regex cache on any add/update/delete. Perform an initial load at startup, handle errors with backoff and log context, and optionally debounce rapid successive rebuilds.
- Observability: debug logs for decisions; counters for matches/blocks; histograms for latency; span attributes for kind, term, commandId.

7. Schema & Index Examples (informative)
- Command example: matchType = { kind: 'command', values: ['greet','hello'], priority: 10 }
- Regex example: matchType = { kind: 'regex', values: ['^so\\s+@?(?<user>[a-z0-9_]+)$'], priority: 20 }
  - Values accept either raw pattern strings (e.g., "^so\\s+@?(?<user>[a-z0-9_]+)$") or full regex literals with flags (e.g., "/^so\\s+@?(?<user>[a-z0-9_]+)$/i"). When a literal form is used, its flags are respected; otherwise, the engine defaults to case-insensitive ('i').
- Index: (matchType.kind == 'command' AND matchType.values array-contains term) ORDER BY matchType.priority ASC

8. Downstream Behavior (unchanged)
- After match and policy checks, use existing templating and candidate/annotation production paths. Cooldowns and rate limits remain.

9. Testing Strategy (for implementation sprint)
- Unit: multi-sigil parsing; term/args extraction; priority ordering; regex named and positional groups; policy gates; invalid regex skip.
- Integration: end-to-end selection and emission; cache refresh via onSnapshot events (add/update/delete) on regex commands.
- Performance: latency under large regex sets.

10. Migration Notes
- Manual migration later: remove legacy fields; map classic commands to kind='command' with values; complex patterns to kind='regex'.

11. Decisions
- Single-match per message for now.
- Start with safeguards; consider RE2 addition later.
- Named groups supported when present; otherwise omitted.

12. Implementation Checklist (next sprint)
- Update command-repo to new CommandDoc and lookups.
- Add regex cache loader.
- Add Firestore onSnapshot listener for regex commands query to live-reload cache on changes.
- Modify processor to ALLOWED_SIGILS and new flow.
- Add indexes and tests.
- Update docs and examples.

13. Acceptance Criteria (for this design)
- Only ALLOWED_SIGILS used; sigilOptional and termLocation removed from design.
- Matching kinds: command then regex by priority; annotations include args or regex groups.
- Data model and indexes defined; safety and observability called out; testing plan specified.
- Regex cache refreshes on any change via Firestore onSnapshot listener bound to matchType.kind == 'regex'.
