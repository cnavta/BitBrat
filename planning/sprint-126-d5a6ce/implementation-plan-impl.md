# Sprint Implementation Plan – sprint-126-d5a6ce

## Objective
- Implement the simplified two-kind command matching pipeline (command → regex fallback) defined in the Technical Architecture, using only ALLOWED_SIGILS from config and removing reliance on per-command sigils, sigilOptional, and termLocation.

## Scope
- In scope
  - Update configuration access to provide allowedSigils with sensible defaults
  - Update command-repo to vNext data model and lookups
  - Implement regex command cache with safety guards
  - Modify processor to new matching flow (command then regex) and standardized annotations
  - Preserve existing policy (cooldowns, rate limits) and templating behavior
  - Add Firestore index definitions (docs) for command matching
  - Add unit, integration, and performance tests
  - Add observability (logs/metrics) per TA
- Out of scope
  - Data migration of existing command documents (handled manually later)
  - Feature flagging for legacy vs. new matcher

## Deliverables
- Code changes under src/services/command-processor:
  - command-repo.ts: CommandDoc vNext, findFirstByCommandTerm, loadRegexCommands
  - processor.ts: multi-sigil parsing, new matching pipeline, standardized annotations
- Tests under tests/services/command-processor
- planning docs: backlog.yaml (this sprint), updated validate_deliverable script assertions
- Firestore index documentation snippet under documentation/ or planning

## Work Breakdown & Milestones
1) Config and types foundation
2) Repo vNext (lookups + cache)
3) Processor flow (command → regex)
4) Policy + templates integration
5) Observability and safeguards
6) Tests (unit → integration → perf)
7) Indexes and docs

## Acceptance Criteria
- Processor uses only ALLOWED_SIGILS from config; defaults to ["!"] when unset
- Command path: first matching doc where matchType.kind='command' and values contains term, ordered by priority ASC, yields annotation { sigil, term, args, argsText }
- Regex path: evaluated only if no command match; first matching compiled pattern by priority yields annotation { pattern, groups, namedGroups }
- Single match per message; deterministic tie-break (priority then doc id)
- Regex safety limits implemented (max patterns, max message length, compile-time validation)
- Regex cache must live-reload on any change to regex commands via a Firestore onSnapshot listener bound to matchType.kind == 'regex'; initial load on startup; errors logged with backoff; optional debounce for burst updates
- Observability present: debug decisions, counters, and latency histograms hooks
- Tests pass locally (jest) covering parser, ordering, policy gates, and regex named/positional groups
- No references in production code to sigilOptional or termLocation remain

## Testing Strategy
- Unit tests
  - Multi-sigil parsing and term/args extraction (argsText fidelity)
  - Repo lookups for command terms, priority ordering
  - Regex compile and match (named and positional groups); invalid patterns skipped
  - Policy gates (mocks): global/user cooldown and rate limit invoked before emit
- Integration tests
  - End-to-end match to annotation/candidate with both command and regex flows
  - Regex cache reload behavior via mocked Firestore onSnapshot events for add/update/delete; verify compiled cache is rebuilt and used
- Performance tests (bounded)
  - Evaluate latency with N regex commands, assert under threshold on typical hardware

## Deployment Approach
- Cloud Run deployment remains unchanged; this is an internal behavior change
- Add Firestore composite index instructions; pre-create in relevant environments before enabling traffic

## Dependencies
- Firestore indexes for command lookups
- Environment config supplying ALLOWED_SIGILS

## Risks & Mitigations
- Regex ReDoS risk → compile-time validation, message-length cap, optional RE2 follow-up
- Inconsistent data during migration → prioritize safe defaults and robust null checks; treat legacy fields as absent

## Definition of Done
- All acceptance criteria met, tests passing, indexes documented, and backlog items at P0 marked done; PR created with references to this plan and backlog
