# Technical Architecture — Mustache Variables in Event Router Enrichments

## Overview
This document outlines the design for adding Mustache-style variable interpolation to the `event-router` service. This feature will allow dynamic values in RuleDoc enrichments based on the incoming event data, current time, and rule-specific metadata.

## 1. Requirement Summary
Support variable interpolation in the following `RuleDoc` enrichment fields:
- `message`
- `annotations[].value`
- `annotations[].label`
- `candidates[].text`
- `candidates[].reason`

Context for interpolation:
- Incoming `InternalEventV2`
- Current timestamp (`now` as ISO string, `ts` as Unix epoch)
- `RuleDoc.metadata` (event data overrides metadata)

## 2. Proposed Design

### 2.1 Interpolation Engine
We will use the `mustache` library for interpolation. It is a industry-standard, lightweight, and robust implementation of Mustache templates that supports nested property access (e.g., `{{message.text}}` or `{{user.displayName}}`).

### 2.2 Context Construction
The context for interpolation will be built for each matching rule.

```typescript
const context = {
    ...rule.metadata,
    ...evalContext, // EvalContext from jsonlogic-evaluator
};
```

Since `evalContext` is spread after `rule.metadata`, it correctly overrides any conflicting keys.

### 2.3 Integration Points

#### `src/services/routing/router-engine.ts`
The `RouterEngine.route` method will be updated to:
1.  Import `mustache`.
2.  Define a helper function `render(template: string | undefined, context: any): string | undefined`.
3.  Interpolate fields before applying them to the output event (`evtOut`).

#### `package.json`
Add `mustache` to dependencies.

## 3. Implementation Plan

### Step 1: Add Dependency
- Install `mustache` and `@types/mustache`.

### Step 2: Update RouterEngine
- Implement interpolation logic in the `route` loop.
- Fields to interpolate:
  - `enrichments.message`
  - Each item in `enrichments.annotations`: `value`, `label`
  - Each item in `enrichments.candidates`: `text`, `reason`

### Step 3: Testing
- Unit tests in `src/services/routing/__tests__/router-engine-interpolation.spec.ts`.
- Verify:
  - Basic variable replacement.
  - Nested property access.
  - Timestamp access (`now`, `ts`).
  - Metadata override logic.
  - Missing variables behavior (Mustache defaults to empty string, but we should consider if we want to keep them intact like `command-processor` does).

*Note: The user request didn't explicitly specify keeping unknown variables intact, but `command-processor` does it. Standard Mustache renders them as empty strings. We will follow standard Mustache behavior unless otherwise specified, as it is more "Mustache style".*

## 4. Example
**Incoming Event:**
```json
{
  "type": "chat.message.v1",
  "channel": "#general",
  "user": { "displayName": "Bob" },
  "message": { "text": "Hello world" }
}
```

**Rule Metadata:**
```json
{
  "version": "1.0"
}
```

**Rule Enrichment:**
```json
{
  "message": "User {{user.displayName}} said '{{message.text}}' in {{channel}} (rule v{{version}})"
}
```

**Resulting Output Event Message:**
"User Bob said 'Hello world' in #general (rule v1.0)"
