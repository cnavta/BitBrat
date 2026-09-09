# Technical Architecture: Reflex Command Arguments

**Sprint 34** | **Role: Architect** | **Owner: navta3**

## Executive Summary

Enable reflexes to capture and utilize command arguments from pattern matches, making them available as positional variables (`${1}`, `${2}`, etc.) in MCP tool parameters and candidate templates. This allows for dynamic, user-driven reflex commands like `!bid 34` where `34` is captured and passed to the `create_bid` MCP tool.

**Example use case:**
```json
{
  "match": {
    "type": "regex",
    "pattern": "^!bid\\s+(\\d+)$",
    "field": "message.text"
  },
  "action": {
    "tool": "mcp:counter.create_bid",
    "parameters": {
      "amount": "${1}",
      "userId": "{{event.identity.user.id}}"
    }
  },
  "candidateTemplate": "Bid placed for ${1} points!"
}
```

---

## 1. Problem Statement

### Current State

Reflexes support 5 pattern matching types (exact, contains, prefix, suffix, regex) but **do not capture or expose matched substrings**. Template interpolation is limited to:
- `{{event.field.path}}` - Event data access
- `{{result.field.path}}` - Tool result access

This means reflexes cannot extract user-provided arguments from commands like:
- `!bid 50` (capture amount)
- `!timer 60` (capture duration)
- `!setvolume 75` (capture level)
- `!raid @username` (capture target)

### Desired State

Reflexes should support **argument capture** via:
1. **Regex capture groups**: `!bid (\d+)` captures numeric argument
2. **Positional variables**: `${1}`, `${2}`, `${n}` for accessing captures
3. **Named capture groups** (future): `!bid (?<amount>\d+)` → `${amount}`
4. **Type coercion**: Automatic conversion to numbers/booleans when needed

---

## 2. Design Goals

### Primary Goals

1. **Backward Compatibility**: Existing reflexes continue working without modification
2. **Minimal Performance Impact**: <5ms overhead for capture extraction
3. **Type Safety**: Preserve TypeScript type safety throughout
4. **Intuitive Syntax**: Align with existing `{{}}` interpolation patterns
5. **Comprehensive Coverage**: Work in parameters, candidates, and conditions

### Non-Goals (Out of Scope)

1. **Complex parsing**: No shell-like argument parsing (quotes, escapes, flags)
2. **Validation**: No runtime validation of captured values (tool's responsibility)
3. **Default values**: No fallback syntax like `${1:default}` (Phase 2)
4. **Named captures**: No `${varName}` syntax (Phase 2)

---

## 3. Architecture Overview

### Component Impact Analysis

| Component | Impact | Changes Required |
|-----------|--------|------------------|
| **pattern-matcher.ts** | **HIGH** | Add capture group extraction |
| **template-interpolator.ts** | **HIGH** | Add `${n}` syntax support |
| **parameter-builder.ts** | **MEDIUM** | Pass captures to interpolator |
| **candidate-builder.ts** | **MEDIUM** | Pass captures to interpolator |
| **field-accessor.ts** | **LOW** | Add captures object accessor |
| **reflex.ts (types)** | **MEDIUM** | Add `MatchCaptures` type |
| **reflex-executor.ts** | **MEDIUM** | Thread captures through execution |
| **reflex-matcher.ts** | **MEDIUM** | Store and pass captures |

### Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. Event arrives: { message: { text: "!bid 34" } }                 │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 2. Pattern Matcher (NEW: Extract captures)                         │
│    pattern: "^!bid\\s+(\\d+)$"                                      │
│    → match.test() → true                                            │
│    → match.exec() → ["!bid 34", "34"]                               │
│    → captures: { 0: "!bid 34", 1: "34" }                            │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 3. Reflex Matcher (NEW: Return captures)                           │
│    return { matched: true, captures: { 0: "!bid 34", 1: "34" } }   │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 4. Reflex Executor (NEW: Pass captures to builders)                │
│    buildParameters(template, event, captures)                       │
│    buildCandidates(template, reflex, event, result, captures)       │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 5. Template Interpolator (NEW: Replace ${n} syntax)                │
│    "Bid placed for ${1} points!"                                    │
│    → "Bid placed for 34 points!"                                    │
│                                                                      │
│    { amount: "${1}" }                                               │
│    → { amount: "34" } (then type-coerced to number)                 │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 4. Detailed Design

### 4.1 Type Definitions

**New Type: MatchCaptures**

```typescript
// src/types/reflex.ts

/**
 * Captured groups from pattern matching.
 *
 * For regex patterns with capture groups:
 * - Index 0: Full match
 * - Index 1+: Capture groups in order
 *
 * @example
 * pattern: "^!bid\\s+(\\d+)$"
 * input: "!bid 34"
 * captures: { 0: "!bid 34", 1: "34" }
 *
 * @example
 * pattern: "^!raid\\s+@?(\\w+)\\s+(\\d+)$"
 * input: "!raid @username 100"
 * captures: { 0: "!raid @username 100", 1: "username", 2: "100" }
 */
export interface MatchCaptures {
  /** Full matched string (always present if match succeeded) */
  0: string;

  /** Capture group N (1-indexed) */
  [index: number]: string | undefined;
}

/**
 * Enhanced match result with optional captures.
 */
export interface MatchResult {
  /** Whether the pattern matched */
  matched: boolean;

  /** Captured groups (only for regex patterns) */
  captures?: MatchCaptures;
}
```

**Updated ReflexExecutionResult:**

```typescript
// src/types/reflex.ts

export interface ReflexExecutionResult {
  status: 'success' | 'error';
  result?: any;
  candidates?: any[];
  error?: { message: string; code?: string; stack?: string };
  latency: number;

  /** NEW: Captured values from pattern match */
  captures?: MatchCaptures;
}
```

### 4.2 Pattern Matcher Enhancement

**File: `src/services/reflex/pattern-matcher.ts`**

**Current signature:**
```typescript
export function matchPattern(
  value: string,
  pattern: string,
  type: PatternMatchType,
  options?: { caseSensitive?: boolean; flags?: string }
): boolean
```

**New signature:**
```typescript
export function matchPattern(
  value: string,
  pattern: string,
  type: PatternMatchType,
  options?: { caseSensitive?: boolean; flags?: string }
): MatchResult
```

**Implementation:**

```typescript
export function matchPattern(
  value: string,
  pattern: string,
  type: PatternMatchType,
  options: { caseSensitive?: boolean; flags?: string } = {}
): MatchResult {
  const { caseSensitive = true, flags } = options;
  const startTime = performance.now();

  let matched: boolean;
  let captures: MatchCaptures | undefined;

  switch (type) {
    case 'exact':
      matched = matchExact(value, pattern, caseSensitive);
      if (matched) {
        captures = { 0: value };
      }
      break;

    case 'contains':
      matched = matchContains(value, pattern, caseSensitive);
      if (matched) {
        captures = { 0: pattern }; // Matched substring
      }
      break;

    case 'prefix':
      matched = matchPrefix(value, pattern, caseSensitive);
      if (matched) {
        captures = { 0: pattern };
      }
      break;

    case 'suffix':
      matched = matchSuffix(value, pattern, caseSensitive);
      if (matched) {
        captures = { 0: pattern };
      }
      break;

    case 'regex':
      const result = matchRegexWithCaptures(value, pattern, flags);
      matched = result.matched;
      captures = result.captures;
      break;

    default:
      throw new Error(`Unknown pattern match type: ${type}`);
  }

  const latency = performance.now() - startTime;

  if (latency > 10) {
    logger.warn(
      `[pattern-matcher] Slow pattern match: ${latency.toFixed(2)}ms (type: ${type})`
    );
  }

  return { matched, captures };
}

/**
 * Performs regex matching and extracts capture groups.
 *
 * @param value - String to test
 * @param pattern - Regex pattern (may include capture groups)
 * @param flags - Regex flags
 * @returns Match result with captures
 */
function matchRegexWithCaptures(
  value: string,
  pattern: string,
  flags?: string
): MatchResult {
  const regex = getCompiledRegex(pattern, flags);
  const match = regex.exec(value);

  if (!match) {
    return { matched: false };
  }

  // Extract all captures (index 0 is full match, 1+ are groups)
  const captures: MatchCaptures = { 0: match[0] };
  for (let i = 1; i < match.length; i++) {
    if (match[i] !== undefined) {
      captures[i] = match[i];
    }
  }

  return { matched: true, captures };
}
```

**Backward Compatibility:**

All existing code checks `if (matchPattern(...))` which will now check the truthiness of the `MatchResult` object. We need to update all call sites to destructure:

```typescript
// OLD
if (matchPattern(value, pattern, type)) { ... }

// NEW
const { matched } = matchPattern(value, pattern, type);
if (matched) { ... }
```

**Alternative (Safer for Compatibility):**

Keep the existing `matchPattern` function and create a new `matchPatternWithCaptures`:

```typescript
/**
 * Backward-compatible boolean matcher.
 */
export function matchPattern(
  value: string,
  pattern: string,
  type: PatternMatchType,
  options?: { caseSensitive?: boolean; flags?: string }
): boolean {
  return matchPatternWithCaptures(value, pattern, type, options).matched;
}

/**
 * Enhanced matcher with capture support.
 */
export function matchPatternWithCaptures(
  value: string,
  pattern: string,
  type: PatternMatchType,
  options?: { caseSensitive?: boolean; flags?: string }
): MatchResult {
  // Implementation as shown above
}
```

**Recommendation: Use the alternative approach** to minimize breaking changes.

### 4.3 Template Interpolation Enhancement

**File: `src/services/reflex/template-interpolator.ts`**

**Current Capabilities:**
- `{{event.field.path}}` - Event field access
- `{{result.field.path}}` - Tool result access

**New Capabilities:**
- `${0}` - Full match
- `${1}`, `${2}`, `${N}` - Capture groups (1-indexed)
- `$1`, `$2`, `$N` - Alternative syntax (shell-style)

**Implementation:**

```typescript
/**
 * Interpolates a template with event data, tool result, and captures.
 *
 * Supports multiple placeholder formats:
 * - {{event.field.path}} - Event field
 * - {{result.field.path}} - Tool result field
 * - ${0}, ${1}, ${N} - Regex capture groups
 * - $1, $2, $N - Alternative capture syntax
 *
 * @param template - Template string with placeholders
 * @param event - Event object
 * @param toolResult - Optional tool result
 * @param captures - Optional regex captures
 * @returns Interpolated string
 */
export function interpolateTemplate(
  template: string,
  event: InternalEventV2,
  toolResult?: any,
  captures?: MatchCaptures
): string {
  let result = template;

  // 1. Replace {{event.path}} placeholders
  result = result.replace(/\{\{event\.([^}]+)\}\}/g, (match, path) => {
    const value = getFieldValue(event, path.trim());
    return stringifyValue(value, match);
  });

  // 2. Replace {{result.path}} placeholders
  if (toolResult) {
    result = result.replace(/\{\{result\.([^}]+)\}\}/g, (match, path) => {
      const value = getFieldValue(toolResult, path.trim());
      return stringifyValue(value, match);
    });
  }

  // 3. Replace ${N} capture placeholders (brace syntax)
  if (captures) {
    result = result.replace(/\$\{(\d+)\}/g, (match, index) => {
      const idx = parseInt(index, 10);
      const value = captures[idx];
      return value !== undefined ? value : match; // Keep placeholder if no capture
    });
  }

  // 4. Replace $N capture placeholders (shell syntax)
  if (captures) {
    result = result.replace(/\$(\d+)(?!\w)/g, (match, index) => {
      const idx = parseInt(index, 10);
      const value = captures[idx];
      return value !== undefined ? value : match;
    });
  }

  // 5. Handle escaped characters
  result = result.replace(/\\(\{\{|\}\}|\$)/g, '$1');

  return result;
}

/**
 * Converts a value to string for interpolation.
 */
function stringifyValue(value: any, fallback: string): string {
  if (value === undefined || value === null) {
    return fallback; // Keep placeholder
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '[object]';
    }
  }

  return String(value);
}
```

**Type Coercion for Parameters:**

When interpolating tool parameters, we need to **preserve types** for non-string values:

```typescript
/**
 * Interpolates a parameter value with type coercion.
 *
 * If the value is a string containing only a ${N} placeholder,
 * attempts to coerce to number/boolean if possible.
 *
 * @example
 * interpolateParameterValue("${1}", captures: { 1: "34" }) → 34 (number)
 * interpolateParameterValue("${1}", captures: { 1: "true" }) → true (boolean)
 * interpolateParameterValue("Bid: ${1}", ...) → "Bid: 34" (string)
 */
export function interpolateParameterValue(
  value: any,
  event: InternalEventV2,
  toolResult?: any,
  captures?: MatchCaptures
): any {
  // Non-string: return as-is
  if (typeof value !== 'string') {
    return value;
  }

  // String: interpolate
  const interpolated = interpolateTemplate(value, event, toolResult, captures);

  // If original was ONLY a ${N} placeholder, try type coercion
  const isSingleCapturePlaceholder = /^\$\{?\d+\}?$/.test(value.trim());
  if (isSingleCapturePlaceholder) {
    return coerceType(interpolated);
  }

  return interpolated;
}

/**
 * Attempts to coerce a string to number or boolean.
 */
function coerceType(value: string): string | number | boolean {
  // Try boolean
  if (value === 'true') return true;
  if (value === 'false') return false;

  // Try number
  const num = Number(value);
  if (!isNaN(num) && value.trim() !== '') {
    return num;
  }

  // Keep as string
  return value;
}
```

### 4.4 Parameter Builder Update

**File: `src/services/reflex/parameter-builder.ts`**

**Updated signature:**

```typescript
export function buildParameters(
  parameterTemplate: Record<string, any>,
  event: InternalEventV2,
  captures?: MatchCaptures
): Record<string, any>
```

**Implementation:**

```typescript
export function buildParameters(
  parameterTemplate: Record<string, any>,
  event: InternalEventV2,
  captures?: MatchCaptures
): Record<string, any> {
  const result: Record<string, any> = {};

  for (const [key, value] of Object.entries(parameterTemplate)) {
    result[key] = interpolateValue(value, event, undefined, captures);
  }

  return result;
}

function interpolateValue(
  value: any,
  event: InternalEventV2,
  toolResult?: any,
  captures?: MatchCaptures
): any {
  // String: Apply interpolation with type coercion
  if (typeof value === 'string') {
    return interpolateParameterValue(value, event, toolResult, captures);
  }

  // Array: Recursively interpolate
  if (Array.isArray(value)) {
    return value.map(item => interpolateValue(item, event, toolResult, captures));
  }

  // Object: Recursively interpolate
  if (value !== null && typeof value === 'object') {
    const result: Record<string, any> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = interpolateValue(val, event, toolResult, captures);
    }
    return result;
  }

  // Primitive: Return as-is
  return value;
}
```

### 4.5 Candidate Builder Update

**File: `src/services/reflex/candidate-builder.ts`**

**Updated signature:**

```typescript
export function buildCandidates(
  templates: string | string[],
  reflex: Reflex,
  event: InternalEventV2,
  toolResult: any,
  captures?: MatchCaptures
): CandidateV1[]
```

**Implementation:**

```typescript
function interpolateDualContext(
  template: string,
  event: InternalEventV2,
  toolResult: any,
  captures?: MatchCaptures
): string {
  return interpolateTemplate(template, event, toolResult, captures);
}
```

### 4.6 Reflex Executor Update

**File: `src/services/reflex/reflex-executor.ts`**

Thread captures through the execution pipeline:

```typescript
export async function executeReflex(
  reflex: Reflex,
  event: InternalEventV2,
  captures: MatchCaptures | undefined, // NEW parameter
  config: { authToken?: string; correlationId?: string } = {}
): Promise<ReflexExecutionResult> {
  const startTime = Date.now();

  try {
    let toolResult: any = undefined;

    if (reflex.action) {
      // Pass captures to parameter builder
      const parameters = buildParameters(
        reflex.action.parameters,
        event,
        captures // NEW
      );

      toolResult = await executeTool(reflex.action.tool, parameters, {
        authToken: config.authToken,
        timeout: reflex.action.timeout || 5000,
        correlationId: config.correlationId,
        userRoles: event.identity?.user?.roles || [],
      });
    }

    let candidates: CandidateV1[] | undefined;
    if (reflex.candidateTemplate) {
      // Pass captures to candidate builder
      candidates = buildCandidates(
        reflex.candidateTemplate,
        reflex,
        event,
        toolResult || {},
        captures // NEW
      );
    }

    return {
      status: 'success',
      result: toolResult,
      candidates,
      latency: Date.now() - startTime,
      captures, // NEW: Include captures in result
    };
  } catch (error) {
    // Error handling...
    return {
      status: 'error',
      error: errorDetails,
      latency: Date.now() - startTime,
      captures, // NEW: Include captures even on error
    };
  }
}
```

### 4.7 Reflex Matcher Update

**File: `src/services/reflex/reflex-matcher.ts`**

**Updated signature:**

```typescript
export function matchReflex(
  event: InternalEventV2,
  reflex: Reflex
): { matched: boolean; captures?: MatchCaptures }
```

**Implementation:**

```typescript
export function matchReflex(
  event: InternalEventV2,
  reflex: Reflex
): { matched: boolean; captures?: MatchCaptures } {
  const startTime = performance.now();

  try {
    // Step 1: Evaluate conditions
    const conditionsMatch = evaluateConditions(event, reflex.conditions);
    if (!conditionsMatch) {
      return { matched: false };
    }

    // Step 2: Extract field value
    const fieldValue = getFieldValue(event, reflex.match.field);
    if (fieldValue === undefined || fieldValue === null) {
      return { matched: false };
    }

    // Step 3: Apply pattern matching WITH capture extraction
    const matchResult = matchPatternWithCaptures(
      String(fieldValue),
      reflex.match.pattern,
      reflex.match.type,
      {
        caseSensitive: reflex.match.caseSensitive,
        flags: reflex.match.flags,
      }
    );

    if (matchResult.matched) {
      logMatchAttempt(reflex, event, true, performance.now() - startTime, 'success');
      return { matched: true, captures: matchResult.captures };
    } else {
      logMatchAttempt(reflex, event, false, performance.now() - startTime, 'pattern_mismatch');
      return { matched: false };
    }
  } catch (error) {
    logger.error('reflex.matcher.error', { ... });
    return { matched: false };
  }
}
```

### 4.8 Reflex Service Update

**File: `src/apps/reflex-service.ts`**

Update the message handler to pass captures:

```typescript
await this.onMessage<InternalEventV2>(
  'internal.ingress.v1',
  async (event, attrs, ctx) => {
    // Find matching reflexes
    for (const reflex of activeReflexes) {
      const matchResult = matchReflex(event, reflex);

      if (matchResult.matched) {
        // Execute with captures
        const result = await executeReflex(
          reflex,
          event,
          matchResult.captures, // NEW
          { correlationId: event.correlationId }
        );

        if (result.status === 'success' && result.candidates) {
          event.candidates = [...(event.candidates || []), ...result.candidates];
        }
      }
    }

    await this.next(event);
    await ctx.ack();
  }
);
```

---

## 5. Usage Examples

### Example 1: Simple Numeric Argument

```json
{
  "name": "bid-command",
  "match": {
    "type": "regex",
    "pattern": "^!bid\\s+(\\d+)$",
    "field": "message.text"
  },
  "action": {
    "tool": "mcp:counter.create_bid",
    "parameters": {
      "amount": "${1}",
      "userId": "{{event.identity.user.id}}"
    }
  },
  "candidateTemplate": "Bid placed for ${1} points by {{event.identity.user.displayName}}!"
}
```

**Input:** `!bid 50`
**Captures:** `{ 0: "!bid 50", 1: "50" }`
**Parameters:** `{ amount: 50, userId: "user123" }`
**Candidate:** `"Bid placed for 50 points by JohnDoe!"`

### Example 2: Multiple Arguments

```json
{
  "name": "timer-command",
  "match": {
    "type": "regex",
    "pattern": "^!timer\\s+(\\d+)\\s+(\\w+)$",
    "field": "message.text"
  },
  "action": {
    "tool": "mcp:scheduler.create_once",
    "parameters": {
      "delayMs": "${1}000",
      "message": "${2}"
    }
  },
  "candidateTemplate": "Timer set for ${1} seconds: ${2}"
}
```

**Input:** `!timer 60 break`
**Captures:** `{ 0: "!timer 60 break", 1: "60", 2: "break" }`
**Parameters:** `{ delayMs: 60000, message: "break" }`
**Candidate:** `"Timer set for 60 seconds: break"`

### Example 3: Optional Arguments

```json
{
  "name": "volume-command",
  "match": {
    "type": "regex",
    "pattern": "^!volume\\s+(\\d+)?$",
    "field": "message.text"
  },
  "action": {
    "tool": "mcp:obs.set_audio_volume",
    "parameters": {
      "sourceName": "Desktop Audio",
      "volume": "${1}"
    }
  },
  "candidateTemplate": [
    "Volume set to ${1}%",
    "Audio level: ${1}%"
  ]
}
```

**Input:** `!volume 75`
**Captures:** `{ 0: "!volume 75", 1: "75" }`
**Parameters:** `{ sourceName: "Desktop Audio", volume: 75 }`

### Example 4: Mixing Captures with Event Data

```json
{
  "name": "raid-command",
  "match": {
    "type": "regex",
    "pattern": "^!raid\\s+@?(\\w+)$",
    "field": "message.text",
    "flags": "i"
  },
  "action": {
    "tool": "mcp:twitch.start_raid",
    "parameters": {
      "targetUsername": "${1}",
      "broadcaster": "{{event.identity.user.displayName}}"
    }
  },
  "candidateTemplate": "{{event.identity.user.displayName}} is raiding ${1}! Follow the hype train! 🚂"
}
```

**Input:** `!raid @bitbrat`
**Captures:** `{ 0: "!raid @bitbrat", 1: "bitbrat" }`
**Parameters:** `{ targetUsername: "bitbrat", broadcaster: "JohnDoe" }`

---

## 6. Testing Strategy

### Unit Tests

**File: `src/services/reflex/__tests__/pattern-matcher-captures.test.ts`**

```typescript
describe('matchPatternWithCaptures', () => {
  it('extracts single capture group', () => {
    const result = matchPatternWithCaptures('!bid 50', '^!bid\\s+(\\d+)$', 'regex');
    expect(result.matched).toBe(true);
    expect(result.captures).toEqual({ 0: '!bid 50', 1: '50' });
  });

  it('extracts multiple capture groups', () => {
    const result = matchPatternWithCaptures('!timer 60 break', '^!timer\\s+(\\d+)\\s+(\\w+)$', 'regex');
    expect(result.matched).toBe(true);
    expect(result.captures).toEqual({ 0: '!timer 60 break', 1: '60', 2: 'break' });
  });

  it('returns undefined for non-capturing patterns', () => {
    const result = matchPatternWithCaptures('!ping', '^!ping$', 'regex');
    expect(result.matched).toBe(true);
    expect(result.captures).toEqual({ 0: '!ping' });
  });
});
```

**File: `src/services/reflex/__tests__/template-interpolator-captures.test.ts`**

```typescript
describe('interpolateTemplate with captures', () => {
  const event = {
    identity: { user: { displayName: 'JohnDoe' } }
  } as InternalEventV2;

  it('replaces ${N} placeholders', () => {
    const captures = { 0: '!bid 50', 1: '50' };
    const result = interpolateTemplate('Bid: ${1}', event, undefined, captures);
    expect(result).toBe('Bid: 50');
  });

  it('replaces $N shell syntax', () => {
    const captures = { 0: '!bid 50', 1: '50' };
    const result = interpolateTemplate('Bid: $1', event, undefined, captures);
    expect(result).toBe('Bid: 50');
  });

  it('combines captures with event data', () => {
    const captures = { 0: '!bid 50', 1: '50' };
    const result = interpolateTemplate(
      '${1} points from {{event.identity.user.displayName}}',
      event,
      undefined,
      captures
    );
    expect(result).toBe('50 points from JohnDoe');
  });
});
```

**File: `src/services/reflex/__tests__/parameter-type-coercion.test.ts`**

```typescript
describe('interpolateParameterValue type coercion', () => {
  it('coerces numeric strings to numbers', () => {
    const captures = { 0: '!bid 50', 1: '50' };
    const result = interpolateParameterValue('${1}', event, undefined, captures);
    expect(result).toBe(50);
    expect(typeof result).toBe('number');
  });

  it('coerces "true"/"false" to booleans', () => {
    const captures = { 0: '!toggle true', 1: 'true' };
    const result = interpolateParameterValue('${1}', event, undefined, captures);
    expect(result).toBe(true);
    expect(typeof result).toBe('boolean');
  });

  it('keeps mixed strings as strings', () => {
    const captures = { 0: '!bid 50', 1: '50' };
    const result = interpolateParameterValue('Amount: ${1}', event, undefined, captures);
    expect(result).toBe('Amount: 50');
    expect(typeof result).toBe('string');
  });
});
```

### Integration Tests

**File: `src/services/reflex/__tests__/reflex-executor-captures.test.ts`**

```typescript
describe('executeReflex with captures', () => {
  it('passes captures to MCP tool', async () => {
    const reflex: Reflex = {
      id: 'test-bid',
      match: { type: 'regex', pattern: '^!bid\\s+(\\d+)$', field: 'message.text' },
      action: {
        tool: 'test.bid',
        parameters: { amount: '${1}' }
      }
    };

    const event = { message: { text: '!bid 50' } } as InternalEventV2;
    const captures = { 0: '!bid 50', 1: '50' };

    const result = await executeReflex(reflex, event, captures);

    expect(result.status).toBe('success');
    expect(result.result.amount).toBe(50); // Coerced to number
  });
});
```

### End-to-End Tests

Create test reflexes and verify full flow in agent-dev context.

---

## 7. Migration Path

### Phase 1: Core Implementation (This Sprint)

1. Add `MatchCaptures` type
2. Implement `matchPatternWithCaptures()`
3. Add `${N}` syntax to `interpolateTemplate()`
4. Update parameter/candidate builders
5. Thread captures through executor
6. Update reflex matcher and service
7. Comprehensive unit tests
8. Documentation updates

### Phase 2: Enhanced Features (Future)

1. **Named capture groups**: `(?<amount>\d+)` → `${amount}`
2. **Default values**: `${1:100}` (fallback to 100 if capture missing)
3. **Validation syntax**: `${1:number}`, `${2:string}` for type assertions
4. **Capture transformations**: `${1:upper}`, `${2:lower}`, `${3:trim}`

### Backward Compatibility

**100% backward compatible** - All existing reflexes continue to work:
- No breaking changes to type signatures (captures are optional)
- Template interpolation gracefully ignores `${N}` when captures absent
- Pattern matching returns empty captures for non-regex types

---

## 8. Performance Considerations

### Computational Complexity

| Operation | Current | With Captures | Impact |
|-----------|---------|---------------|--------|
| Pattern match | O(n) | O(n) | No change (regex.exec is same as regex.test) |
| Capture extract | N/A | O(k) | k = capture groups (typically <5) |
| Template interp | O(m) | O(m + k) | m = placeholders, k = captures |

**Estimated overhead:** <5ms per reflex execution (within <150ms target)

### Memory Footprint

- **MatchCaptures object**: ~100-200 bytes (5-10 captures × 20 bytes/string)
- **No caching needed**: Captures are ephemeral, discarded after execution
- **No regex cache changes**: Already cached in pattern-matcher

### Optimization Opportunities

1. **Lazy capture extraction**: Only extract captures if template contains `${N}`
2. **Capture pooling**: Reuse capture objects (premature optimization)
3. **Template pre-analysis**: Detect `${N}` presence at reflex creation time

---

## 9. Error Handling

### Scenarios and Mitigation

| Error Scenario | Mitigation | User Impact |
|----------------|------------|-------------|
| **Missing capture** (e.g., `${2}` but only 1 group) | Keep placeholder, log warning | User sees `${2}` in output |
| **Invalid type coercion** (e.g., `${1}` = "abc" → number) | Keep as string, log warning | Tool receives string instead of number |
| **Malformed placeholder** (e.g., `${abc}`) | Treat as literal text | User sees `${abc}` in output |
| **Unsafe regex** (ReDoS) | Reject at reflex creation | Reflex creation fails with error |

### Logging Strategy

```typescript
logger.warn('reflex.captures.missing', {
  reflexId: reflex.id,
  placeholder: '${2}',
  availableCaptures: Object.keys(captures)
});

logger.warn('reflex.captures.type_coercion_failed', {
  reflexId: reflex.id,
  value: 'abc',
  expectedType: 'number'
});
```

---

## 10. Documentation Updates

### Files to Update

1. **documentation/tutorials/creating-a-reflex.md**
   - Add "Step 9: Using Command Arguments" section
   - Include `!bid` and `!timer` examples

2. **documentation/reference/reflex-mcp-tools.md**
   - Document `${N}` syntax in parameter templates
   - Add type coercion behavior
   - Show mixed usage with `{{event.path}}`

3. **src/types/reflex.ts**
   - Add JSDoc examples for `MatchCaptures`
   - Document capture behavior for each pattern type

4. **README.md**
   - Add command arguments to feature list

### New Documentation

**File: `documentation/guides/reflex-command-arguments.md`**

Comprehensive guide covering:
- Regex capture groups primer
- `${N}` syntax reference
- Type coercion rules
- Best practices (performance, UX, validation)
- Common patterns library (!bid, !timer, !raid, etc.)

---

## 11. Open Questions

### Q1: Should we support non-regex capture types?

**Proposal**: Add capture support for `contains`, `prefix`, `suffix`:
- `contains: "!lurk"` → captures `{ 0: "!lurk" }`
- `prefix: "!"` → captures `{ 0: "!", 1: "rest of string" }`

**Decision**: **No** - Keep captures exclusive to regex for simplicity. Users can use regex if they need captures.

### Q2: How to handle capture index collisions with event fields?

**Scenario**: User writes `{{1}}` intending event field, but `${1}` exists.

**Decision**: Syntax is distinct (`{{}}` vs `${}`), so no collision. `{{1}}` would access `event[1]` (unlikely field name).

### Q3: Should we validate capture placeholders at reflex creation?

**Proposal**: Reject reflexes with `${N}` if pattern has no capture groups.

**Decision**: **No** - Allow graceful degradation (placeholder kept as-is). This supports copy-paste templates across reflexes.

### Q4: Type coercion for arrays/objects?

**Scenario**: `${1}` = `"[1,2,3]"` → should we parse to array?

**Decision**: **No** - Only coerce primitives (number, boolean). Complex types require explicit JSON.parse in tool logic.

---

## 12. Security Considerations

### ReDoS Protection

**Already handled** by `safe-regex` library in pattern-matcher.ts. No additional changes needed.

### Injection Attacks

**Not applicable** - Captures are extracted from user input, not executed as code. Template interpolation is safe string replacement.

### User Input Validation

**Out of scope** - Tools are responsible for validating parameter values. Reflexes pass captures as-is.

**Example**: If `!bid -999` is captured, the `create_bid` tool should validate `amount >= 0`.

---

## 13. Success Metrics

### Functional Metrics

- ✅ All existing reflexes continue working (0 regressions)
- ✅ New `!bid` reflex executes in <150ms
- ✅ Type coercion works for 99% of numeric captures
- ✅ Capture extraction adds <5ms overhead

### Quality Metrics

- ✅ 95%+ code coverage for capture-related code
- ✅ 0 failing tests after migration
- ✅ Documentation complete and reviewed

### User Adoption Metrics (Post-Sprint)

- 🎯 5+ new argument-based reflexes created within 1 week
- 🎯 User feedback: "Captures work as expected"

---

## 14. Risks and Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Breaking changes** to existing reflexes | Low | High | Comprehensive test suite, backward compatibility design |
| **Performance degradation** | Low | Medium | Profiling, lazy extraction, complexity analysis |
| **User confusion** on syntax | Medium | Low | Clear docs, examples, error messages |
| **Type coercion bugs** | Medium | Medium | Extensive unit tests, fail-safe defaults |
| **Regex capture edge cases** | Medium | Low | Thorough testing, keep placeholders on error |

---

## 15. Timeline Estimate

| Task | Estimated Time |
|------|----------------|
| Type definitions (MatchCaptures, MatchResult) | 0.5 hours |
| Pattern matcher enhancement | 2 hours |
| Template interpolator enhancement | 3 hours |
| Parameter/candidate builder updates | 1.5 hours |
| Reflex executor/matcher threading | 1.5 hours |
| Unit tests (pattern, template, params) | 3 hours |
| Integration tests (executor, service) | 2 hours |
| Documentation updates | 2 hours |
| Agent-dev validation | 1 hour |
| **Total** | **16.5 hours** |

**Sprint Duration**: 2-3 days

---

## 16. Appendix

### A. Regex Pattern Examples

```typescript
// Single numeric argument
"^!bid\\s+(\\d+)$"
// Input: "!bid 50" → captures: { 0: "!bid 50", 1: "50" }

// Multiple arguments
"^!timer\\s+(\\d+)\\s+(\\w+)$"
// Input: "!timer 60 break" → captures: { 0: "!timer 60 break", 1: "60", 2: "break" }

// Optional argument
"^!volume(?:\\s+(\\d+))?$"
// Input: "!volume 75" → captures: { 0: "!volume 75", 1: "75" }
// Input: "!volume" → captures: { 0: "!volume", 1: undefined }

// Case-insensitive username
"^!raid\\s+@?(\\w+)$" (flags: "i")
// Input: "!RAID @BitBrat" → captures: { 0: "!RAID @BitBrat", 1: "BitBrat" }

// Flexible whitespace
"^!setvolume\\s+(\\d{1,3})\\s*%?$"
// Input: "!setvolume 75%" → captures: { 0: "!setvolume 75%", 1: "75" }
```

### B. Type Coercion Rules

```typescript
// Number coercion
"50" → 50
"0" → 0
"-10" → -10
"3.14" → 3.14
"abc" → "abc" (no coercion)

// Boolean coercion
"true" → true
"false" → false
"True" → "True" (no coercion, case-sensitive)

// Edge cases
"" → "" (empty string)
"  42  " → 42 (trimmed)
"0x10" → 16 (hex)
"1e3" → 1000 (scientific)
```

### C. Alternative Syntax Comparison

| Syntax | Example | Pros | Cons |
|--------|---------|------|------|
| `${N}` | `${1}` | Familiar (ES6 templates) | Could confuse with template literals |
| `$N` | `$1` | Shell-style, concise | Less explicit |
| `{{N}}` | `{{1}}` | Consistent with event syntax | Confusing (looks like event field) |
| `{N}` | `{1}` | Very concise | Ambiguous (could be literal) |

**Recommendation**: Support **both `${N}` and `$N`** for flexibility.

---

## Conclusion

This architecture enables powerful argument-driven reflexes while maintaining backward compatibility, performance targets (<150ms), and type safety. The implementation is straightforward, leveraging existing interpolation patterns and regex infrastructure.

**Key Innovations:**
1. **Dual-syntax support**: `${1}` (brace) and `$1` (shell) for captures
2. **Automatic type coercion**: String → number/boolean when appropriate
3. **Graceful degradation**: Missing captures keep placeholders visible
4. **Zero breaking changes**: Captures are opt-in, existing reflexes unaffected

**Next Steps:**
1. Get user/team approval on architecture
2. Implement Phase 1 (core features)
3. Validate in agent-dev context
4. Document and deploy
5. Plan Phase 2 (named captures, defaults)
