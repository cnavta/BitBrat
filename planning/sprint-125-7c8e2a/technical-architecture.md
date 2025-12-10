# Technical Architecture – Command Processor: per-command sigil + termLocation

## Objective
Extend the command-processor to support the following new CommandDoc properties:
- `sigil?: string` — When provided, the command must use this sigil instead of the default. If `sigilOptional: true`, any value in `sigil` is ignored.
- `sigilOptional?: boolean` — Existing behavior retained: if true, allow matching the command without a sigil according to `termLocation` rules.
- `termLocation: 'prefix' | 'suffix' | 'anywhere'` — Required in schema; when missing in Firestore docs, assume `'prefix'` for backward compatibility.

Additionally, enforce token boundaries: the target term (sigil + command name, or command name when sigilOptional) must be separated from other text by whitespace (or start/end of string) based on the selected `termLocation`. Adjacent characters (letters/digits/underscore) must not be considered a match. Exception: an opening parenthesis `(` is allowed immediately after the term to delimit arguments (see Arguments section).

## Current State
- Parsing relies on a single global `commandSigil` (default `!`) and only checks `prefix` via `text.startsWith(sigil)` in `processForParsing` → `parseCommandFromText`.
- A fallback path tries to match a full message as a command when `sigilOptional` is true (but ignores per-command sigil and `termLocation`).
- `CommandDoc` interface updated locally to include `sigil`, `sigilOptional`, and `termLocation`, but Firestore normalization does not yet set defaults for `sigil`/`termLocation`.

## Target Behavior
1) Per-command sigil override
   - If a `CommandDoc` has `sigil` set and `sigilOptional !== true`, use that sigil when matching the command’s target term.
   - Otherwise, use the process default sigil from config (e.g., `!`).

2) termLocation semantics
   - prefix: the target term must appear at the very start of the message, followed by a whitespace boundary or end-of-string.
   - suffix: the target term must appear at the very end of the message, preceded by a whitespace boundary or start-of-string.
   - anywhere: the target term may appear anywhere, but must be delimited by whitespace on both sides (or start/end boundaries). Multiple spaces or tabs are acceptable.

3) Sigil optional
   - If `sigilOptional === true`, ignore any `sigil` value and match using only the command name under the same `termLocation` and boundary rules.

4) Case handling
   - Command names are stored/lowered in repo. Matching operates on lowercased text; preserve original args tokenization afterward.

5) Backward compatibility
   - Firestore docs missing `termLocation` should default to `'prefix'` in normalization.
   - Existing behavior where only prefix + default sigil matches will remain valid when docs do not set `sigil` or `sigilOptional`.

## Proposed Design

### Configuration: ALLOWED_SIGILS
- Introduce `ALLOWED_SIGILS: string[]` in runtime config (getConfig), e.g., via env overlay or architecture defaults.
- Purpose: whitelist of sigils we will consider during initial parsing and token scanning to improve performance and avoid pathological scans.
- Enforcement:
  - Fast-path parsing and token scans only consider sigils in `ALLOWED_SIGILS`.
  - Per-command `doc.sigil` MUST be in `ALLOWED_SIGILS` to be recognized when `sigilOptional !== true`. If not, the command will not match (unless `sigilOptional` is true, in which case the sigil is ignored).
  - Multi-character sigils are supported literally (no truncation), but still must appear in `ALLOWED_SIGILS`.

### Data Normalization (command-repo.ts)
- Update `normalizeCommand` to:
  - Pass through `sigil` if present (string, trimmed to first char if multi-char? Decision: keep full string as provided to avoid breaking multi-char sigils; matching will require exact text).
  - Set `sigilOptional` to boolean (existing code already does this).
  - Add `termLocation` with default `'prefix'` when not provided.

### Matching Algorithm (processor.ts)
Refactor parsing into two phases:
1) Token scanning to find candidate command terms according to each command’s rules
2) Lookup and policy enforcement (unchanged)

However, for minimal change and performance, we will:
- Keep the initial parse to collect a fast path when the text starts with the default sigil.
- Enhance the lookup phase to evaluate `termLocation` and per-command sigil rigorously, selecting the best match.

Steps in `processEvent`:
1. Build lowercase `textLc` and a token view for whitespace boundaries.
2. Gather a candidate name from the fast parse (if any).
3. When no fast parse or when `sigilOptional`/`termLocation` may change behavior, perform a secondary matching pass:
   - Try to find a document by name in these orders:
     a) If fast parse exists: lookup that name → validate with the doc’s own rules (sigil/termLocation). If invalid, continue.
     b) Otherwise, iterate all possible names is not feasible (requires a scan). So instead, perform “reverse lookup” by attempting both name and aliases discovered from tokenization:
        - Extract a first token (prefix) and last token (suffix) from whitespace boundaries in the text; try lookups on those tokens.
        - For `anywhere`, split by whitespace and attempt lookup on each token. Only consider tokens that are in `ALLOWED_SIGILS`+name form (when not sigilOptional) or name alone (when sigilOptional) to minimize Firestore lookups.
   - For each found doc, validate boundary rules:
     - Compute targetTerm: (sigilOptional? '' : effectiveSigil) + doc.name
     - Validate according to termLocation and whitespace boundaries (regex-based matching with \b-like word boundaries replaced by whitespace boundaries). After the term, allow either whitespace/end-of-string or an opening parenthesis `(` (argument list begins).
   - First valid doc wins; break ties by earliest occurrence for anywhere.

Regex helpers:
- Escape sigil (treat literally). Let `B` represent boundary: start or whitespace, and `A` represent allowed-after: whitespace, end-of-string, or `(`.
  - prefix: new RegExp(`^${term}(?=\s|\(|$)`, 'i')
  - suffix: new RegExp(`(?<=^|\s)${term}$`, 'i')  (suffix keeps strict end anchoring; no trailing args/text)
  - anywhere: new RegExp(`(?<=^|\s)${term}(?=\s|\(|$)`, 'gi')
Where `term` is the escaped target term. This allows parentheses immediately after the term for prefix/anywhere; suffix remains end-anchored by definition.

Arguments:
- We support argument lists provided in parentheses immediately following the term with no intervening spaces, e.g., `!hum(hi,4)`.
- Parentheses parsing:
  - Extract the first balanced `(...)` group immediately after the term, if present; the inner text becomes the raw args payload.
  - No parentheses → no structured args parsed in the “anywhere” mode; trailing text is allowed but ignored for args.
- By `termLocation`:
  - prefix: if parentheses present, parse them; otherwise retain legacy behavior where args are the whitespace-separated tokens following the term.
  - suffix: term must be at the end; parentheses may be present immediately after the term and will be parsed. No trailing text allowed after suffix (by definition).
  - anywhere: parse parentheses only (if present) and allow arbitrary trailing text that is not considered args.

Performance considerations:
- We only attempt lookups for a small set of tokens (first, last, and any token for anywhere). Firestore queries remain 1-per-token (name, aliases). This preserves O(n tokens) behavior without full collection scan.

### Edge Cases
- Adjacent punctuation: Only whitespace delimits terms. A term followed by punctuation without space (e.g., `!roll,`) is NOT a match; the only exception is an opening parenthesis `(` to start the args list.
- Multi-char sigils: Supported literally; no char trimming.
- Multiple matches: Choose earliest valid match; if ties, prefer prefix over anywhere over suffix for determinism.
- Empty or whitespace-only text: no match.

### Telemetry
- Add debug logs indicating which rule matched (prefix/suffix/anywhere), effectiveSigil used, and indices.

## Testing Strategy
- Unit tests for normalization defaults (termLocation default to 'prefix').
- Unit tests for matching:
  - prefix with default sigil
  - prefix with overridden sigil
  - sigilOptional true ignores provided sigil
  - suffix matching with boundaries
  - anywhere matching with boundaries (e.g., "please !help now" matches, but "please!help" does not); allow `!help(1,2) extra words` and parse args=`1,2` only
  - punctuation adjacency should not match, except `(` which is allowed for args
  - ALLOWED_SIGILS respected (commands with sigils not in the list do not match unless sigilOptional=true)
  - alias matching obeys same rules

## Migration & Compatibility
- No data migration required; missing `termLocation` treated as 'prefix'.
- Existing clients unaffected unless they relied on punctuation-adjacent matches; this is explicitly disallowed now.

## Implementation Plan (high level)
1. command-repo.ts: update `normalizeCommand` to include `sigil` and default `termLocation: 'prefix'`.
2. processor.ts:
   - Add helper to compute effective term and regex based on doc.
   - Expand parsing to validate fast-path result against doc’s rules.
   - Add fallback token-based lookups for suffix/anywhere cases.
3. Tests: add cases under tests/services/command-processor.
4. Build, test, validate.
