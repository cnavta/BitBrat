# Implementation Plan – sprint-125-7c8e2a

## Objective
- Implement Command Processor enhancements per the approved Technical Architecture:
  - Per-command sigil override (CommandDoc.sigil) unless sigilOptional is true
  - Required termLocation matching: prefix | suffix | anywhere (default to 'prefix' when missing)
  - Strict whitespace token boundaries, with a special allowance for an immediate opening parenthesis for args
  - Introduce ALLOWED_SIGILS configuration to constrain parsing/matching (supports multi-character)
  - Parentheses-only args immediately after the term for anywhere and suffix; for prefix, use parentheses if present, otherwise retain legacy space-separated args
  - Alias matching follows the same sigil/termLocation/boundary rules

## Scope
- In scope
  - Data normalization in command-repo.ts to pass through sigil and default termLocation
  - Processor parsing/matching changes in processor.ts (regex boundary checks, per-command sigil, termLocation logic, parentheses args)
  - Configuration surface for ALLOWED_SIGILS via getConfig (env overlay default)
  - Unit tests for normalization and matching behaviors
  - Telemetry (debug logs) for match type, sigil, and indices
- Out of scope
  - Any Firestore schema migration (we will infer defaults)
  - Broader refactors of routing or candidate/annotation effects
  - Non-Node runtimes or cross-service changes

## Deliverables
- Code changes
  - command-repo.ts: normalizeCommand to include sigil (verbatim) and termLocation default 'prefix'
  - processor.ts:
    - Helpers to compute effectiveSigil and to build regex for prefix/suffix/anywhere with boundary rules and parentheses allowance
    - Validate fast-path parse result against the matched CommandDoc rules
    - Secondary token-based lookups for suffix/anywhere; honor ALLOWED_SIGILS, sigilOptional, and aliases
    - Parentheses-only args extraction for anywhere and suffix; prefix supports parentheses, else legacy space-separated args
    - Telemetry logs (match type, indices)
  - config: expose ALLOWED_SIGILS (defaults to ['!']) through getConfig
- Tests
  - Unit tests covering normalization defaults, per-command sigil, termLocation modes, boundary rules (including punctuation), ALLOWED_SIGILS, alias matching, and parentheses args
- Documentation
  - Planning docs updated (this plan + backlog)
  - Inline code comments and logging context keys
- Publication
  - Continue using branch: feature/sprint-125-7c8e2a-command-processor-sigil-term
  - PR creation and publication.yaml update at end of sprint

## Acceptance Criteria
- Normalization
  - When termLocation is missing in Firestore data, normalize to 'prefix'
  - sigil is preserved verbatim (multi-character allowed)
- Matching
  - prefix: matches only when term is at start and followed by whitespace, end-of-string, or '('; respects per-command sigil override
  - suffix: matches only when term is at end and preceded by whitespace or start-of-string; no trailing text allowed beyond an optional immediate parentheses group
  - anywhere: matches when term appears with whitespace/start boundary before and whitespace/end-or-'(' boundary after; earliest valid occurrence chosen; trailing text allowed; only the immediate parentheses group is treated as args (if present)
  - sigilOptional=true: ignore any sigil value and match on command name with the same termLocation/boundary rules
  - ALLOWED_SIGILS enforced: only commands whose sigil is in ALLOWED_SIGILS are considered when sigilOptional !== true
  - Alias matches follow identical rules
- Arguments
  - Parentheses-only args (balanced group) are parsed when immediately following the term without spaces; no other punctuation adjacency is allowed to count as a match
  - For prefix without parentheses, legacy space-separated args after the term are preserved
- Telemetry
  - Logs include which termLocation matched, effective sigil, and match indices/occurrence order
- Tests
  - All new tests pass via npm test

## Testing Strategy
- Unit tests (tests/services/command-processor)
  - repo normalization: missing termLocation defaults to 'prefix'; sigil passthrough
  - prefix + default sigil and prefix + overridden sigil
  - sigilOptional true ignores sigil
  - suffix boundary cases (valid and invalid with punctuation adjacency)
  - anywhere boundary cases (e.g., "please !help now" matches; "please!help" does not); allow "!help(1,2) extra words" and parse args payload only
  - parentheses args parsing: "!hum(hi,4) more text" → args payload "hi,4"; anywhere ignores trailing text for args
  - ALLOWED_SIGILS enforcement
  - alias matching with each termLocation
- Mocks
  - Mock repoFindByNameOrAlias to return synthetic CommandDoc(s) for deterministic tests

## Deployment Approach
- No cloud changes; build and tests only
- validate_deliverable.sh remains logically passable (no updates required)

## Dependencies
- None beyond current stack; tests rely on Jest

## Definition of Done
- All acceptance criteria met and unit tests pass locally
- Changes are committed to the feature branch and PR is created per Sprint Protocol v2.4
- Planning artifacts (implementation plan, backlog) present in planning/sprint-125-7c8e2a

## Work Breakdown & Timeline (indicative)
- Day 1: Config + normalization + helper functions scaffolding
- Day 2: Matching logic (prefix, suffix) + tests
- Day 3: anywhere matching + ALLOWED_SIGILS + parentheses args + tests
- Day 4: Telemetry polish + full test pass + PR and documentation
