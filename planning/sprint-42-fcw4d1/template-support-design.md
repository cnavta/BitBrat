# Template Expression Support for Compositions

**Feature**: Template Expression Support
**Target Sprint**: sprint-43 or later
**Created**: 2026-09-06
**Author**: Architect
**Status**: Design Proposal
**Priority**: P1 (High value UX improvement)

---

## Executive Summary

This document proposes adding **template expression support** to BitBrat's composition executor to enable intuitive string interpolation in composition YAML files. This eliminates the need for workarounds (manual concatenation, helper tools) and provides a clean, declarative syntax for combining dynamic values.

**Core Proposal**: Add `TemplateExpression` as a first-class value expression type, supporting Mustache-style (`{{variable}}`) syntax with recursive reference resolution.

**Motivation**: The current `grockle` composition fails because it uses unsupported template syntax. Template support is a natural extension of the composition DSL and aligns with user expectations from other workflow engines (GitHub Actions, CircleCI, Jinja2).

---

## 1. Current Problem

### 1.1 Grockle Composition Failure

The `grockle` composition (lines 60-69 in `examples/compositions/grockle.yaml`) uses template syntax that the executor doesn't support:

```yaml
# Step 2: Prepare combined prompt (using template/literal)
- id: prepare_prompt
  ifValue:
    condition:
      exists:
        $ref:
          namespace: steps
          pointer: /retrieve_notes/value
    then:
      # ❌ FAILS: Template syntax not implemented
      prompt_text:
        template: "{{notes}} {{description}}"
        notes:
          $ref:
            namespace: steps
            pointer: /retrieve_notes/value
        description:
          $ref:
            namespace: input
            pointer: /description
```

**What happens**:
1. Executor treats this as a plain object (no special template handling)
2. Returns: `{ template: "{{notes}} {{description}}", notes: "...", description: "..." }`
3. Next step (`generate_image`) receives an **object** instead of a **string**
4. Tool execution fails with validation error or runtime error

**Error manifestation**:
```
tool_gateway.composition.execute.failed
error: "Tool execution failed: mcp:generate_image"
errorCode: "COMPOSE-EXEC-002"
```

The actual error message is hidden because the executor only reports "Tool execution failed" without surfacing the underlying cause (likely: "prompt must be string, got object").

### 1.2 Current Workarounds

**Workaround 1**: Use a dedicated string formatting tool
```yaml
- id: format_prompt
  call: string.format  # Would need to implement this tool
  with:
    format: "{} {}"
    args:
      - $ref: { namespace: steps, pointer: /retrieve_notes/value }
      - $ref: { namespace: input, pointer: /description }
```

❌ **Problems**: Requires implementing `string.format` tool, verbose, not declarative

**Workaround 2**: Pass values separately and concatenate in tool
```yaml
- id: generate_image
  call: generate_image_with_parts  # Modified tool
  with:
    prompt_parts:
      - $ref: { namespace: steps, pointer: /retrieve_notes/value }
      - $ref: { namespace: input, pointer: /description }
```

❌ **Problems**: Requires modifying every tool that needs concatenation, breaks separation of concerns

**Workaround 3**: Use JavaScript-based composition (not YAML)
```typescript
// Composition in TypeScript instead of YAML
steps: [
  {
    id: 'prepare_prompt',
    execute: (ctx) => {
      return { prompt_text: `${ctx.steps.retrieve_notes.value} ${ctx.input.description}` };
    }
  }
]
```

❌ **Problems**: Defeats the purpose of declarative YAML compositions, requires TypeScript knowledge

---

## 2. Design Proposal

### 2.1 Template Expression Syntax

**Format**: Mustache-style `{{variable}}` interpolation

**Structure**:
```yaml
# Template expression (object with 'template' key)
field_name:
  template: "{{var1}} some text {{var2}}"  # Template string
  var1:                                     # Variable definition
    $ref: { ... }                           # Can be any value expression
  var2:
    $ref: { ... }
```

**Characteristics**:
- **Detection**: Object with required `template` property (string)
- **Variables**: All other properties are variable definitions
- **Interpolation markers**: `{{variable_name}}` (double curly braces)
- **Escaping**: `\{{` to include literal `{{` in output
- **Recursive resolution**: Variable values can be references, literals, objects, arrays, or nested templates

### 2.2 Example Use Cases

**Use Case 1: Simple string concatenation** (grockle)
```yaml
combined_text:
  template: "{{notes}} {{description}}"
  notes:
    $ref:
      namespace: steps
      pointer: /user_notes/value
  description:
    $ref:
      namespace: input
      pointer: /description
# Result: "User's notes content User's description"
```

**Use Case 2: Formatted output**
```yaml
greeting:
  template: "Hello, {{name}}! You have {{count}} new messages."
  name:
    $ref:
      namespace: input
      pointer: /username
  count:
    $ref:
      namespace: steps
      pointer: /message_count/total
# Result: "Hello, Alice! You have 5 new messages."
```

**Use Case 3: Multi-line templates**
```yaml
email_body:
  template: |
    Dear {{recipient}},

    Your order #{{order_id}} has been {{status}}.

    Thank you,
    {{sender}}
  recipient:
    $ref: { namespace: input, pointer: /customer_name }
  order_id:
    $ref: { namespace: steps, pointer: /order/id }
  status:
    $ref: { namespace: steps, pointer: /order/status }
  sender: "BitBrat Support"  # Literal value
# Result: Multi-line formatted email
```

**Use Case 4: Conditional template variables**
```yaml
message:
  template: "{{greeting}} {{name}}{{punctuation}}"
  greeting:
    $ref: { namespace: steps, pointer: /greeting_text/value }
  name:
    $ref: { namespace: input, pointer: /name }
  punctuation:  # Can use ifValue for conditional logic
    ifValue:
      condition:
        exists:
          $ref: { namespace: input, pointer: /excited }
      then: "!"
      else: "."
# Result: "Good morning Alice!" or "Good morning Alice."
```

**Use Case 5: Nested templates** (advanced)
```yaml
full_message:
  template: "{{header}}\n\n{{body}}"
  header:
    template: "[{{category}}] {{title}}"
    category:
      $ref: { namespace: input, pointer: /category }
    title:
      $ref: { namespace: input, pointer: /title }
  body:
    $ref: { namespace: input, pointer: /content }
# Result: "[Announcement] New Feature\n\nWe're excited to announce..."
```

### 2.3 Type Definitions

**New types in `src/common/composition/types.ts`**:

```typescript
/**
 * Template Expression
 *
 * String interpolation using Mustache-style {{variable}} syntax.
 *
 * @example
 * ```yaml
 * greeting:
 *   template: "Hello, {{name}}!"
 *   name:
 *     $ref: { namespace: input, pointer: /username }
 * ```
 */
export interface TemplateExpression {
  /**
   * Template string with {{variable}} placeholders
   *
   * Variables are interpolated at runtime using resolved variable values.
   * Escape sequences: \{{ for literal {{
   */
  template: string;

  /**
   * Variable definitions
   *
   * All properties except 'template' are treated as variables.
   * Variable values can be any ValueExpression (references, literals, objects, etc.)
   */
  [variable: string]: ValueExpression;
}

/**
 * Type guard for TemplateExpression
 */
export function isTemplateExpression(value: unknown): value is TemplateExpression {
  return (
    value !== null &&
    typeof value === 'object' &&
    'template' in value &&
    typeof (value as any).template === 'string'
  );
}

/**
 * Updated ValueExpression union to include templates
 */
export type ValueExpression =
  | Reference           // $ref: { namespace, pointer }
  | TemplateExpression  // template: "{{var}}"  (NEW)
  | string              // "literal string"
  | number              // 42
  | boolean             // true/false
  | null                // null
  | ValueExpression[]   // [expr1, expr2]
  | { [key: string]: ValueExpression };  // { key: expr }
```

### 2.4 Executor Implementation

**Method: `resolveTemplate()`**

```typescript
/**
 * Resolve a template expression
 *
 * 1. Extract template string and variable definitions
 * 2. Recursively resolve each variable value
 * 3. Interpolate variables into template string
 * 4. Return final string
 *
 * @param template - Template expression to resolve
 * @param input - Composition input
 * @param context - Composition context
 * @param stepState - Current step state
 * @returns Interpolated string
 */
private async resolveTemplate(
  template: TemplateExpression,
  input: unknown,
  context: unknown,
  stepState: StepState
): Promise<string> {
  const templateString = template.template;

  // Extract variable definitions (all properties except 'template')
  const variableDefinitions: Record<string, ValueExpression> = {};
  for (const [key, value] of Object.entries(template)) {
    if (key !== 'template') {
      variableDefinitions[key] = value;
    }
  }

  // Resolve all variables
  const resolvedVariables: Record<string, string> = {};
  for (const [varName, varExpression] of Object.entries(variableDefinitions)) {
    const resolvedValue = await this.resolveValue(varExpression, input, context, stepState);

    // Convert to string (coercion rules)
    if (resolvedValue === null || resolvedValue === undefined) {
      resolvedVariables[varName] = '';
    } else if (typeof resolvedValue === 'string') {
      resolvedVariables[varName] = resolvedValue;
    } else if (typeof resolvedValue === 'number' || typeof resolvedValue === 'boolean') {
      resolvedVariables[varName] = String(resolvedValue);
    } else if (typeof resolvedValue === 'object') {
      // Objects/arrays stringify to JSON (with warning)
      this.logger?.warn?.('template_variable_coerced_to_json', {
        variable: varName,
        type: Array.isArray(resolvedValue) ? 'array' : 'object',
      });
      resolvedVariables[varName] = JSON.stringify(resolvedValue);
    }
  }

  // Interpolate variables into template
  let result = templateString;

  // Replace {{variable}} with resolved values
  // Use regex: /\{\{(\w+)\}\}/g
  result = result.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
    if (varName in resolvedVariables) {
      return resolvedVariables[varName];
    } else {
      // Undefined variable - throw error
      throw new ExecutionError(
        CompositionErrorCode.INVALID_REFERENCE,
        `Undefined template variable: ${varName}`,
        `template`
      );
    }
  });

  // Handle escaped braces: \{{ -> {{
  result = result.replace(/\\?\{\{/g, '{{');

  return result;
}
```

**Integration with `resolveValue()`**:

```typescript
private async resolveValue(
  value: ValueExpression,
  input: unknown,
  context: unknown,
  stepState: StepState
): Promise<unknown> {
  if (isReference(value)) {
    return this.resolveReference(value, input, context, stepState);
  } else if (isTemplateExpression(value)) {
    // NEW: Handle template expressions
    return await this.resolveTemplate(value, input, context, stepState);
  } else if (Array.isArray(value)) {
    // ... existing array handling
  } else if (value !== null && typeof value === 'object') {
    // ... existing object handling
  } else {
    // Literal value
    return value;
  }
}
```

### 2.5 Compiler Validation

**Validation checks in `CompositionCompiler.validate()`**:

1. **Template syntax validation**
   - Check for unclosed `{{` or `}}`
   - Validate variable names (alphanumeric + underscore)
   - Detect undefined variables (variables used in template but not defined)

2. **Unused variable warnings**
   - Warn if variables are defined but not used in template
   - Help catch typos and dead code

3. **Recursive template depth**
   - Track template nesting depth to prevent infinite recursion
   - Max depth: 5 levels (configurable)

**Implementation**:

```typescript
/**
 * Validate template expression
 *
 * Checks:
 * - Template string has valid syntax
 * - All used variables are defined
 * - No unused variables (warning)
 * - No recursive template loops
 */
private validateTemplate(
  template: TemplateExpression,
  location: string,
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  const templateString = template.template;

  // Extract variable names from template string
  const usedVariables = new Set<string>();
  const varRegex = /\{\{(\w+)\}\}/g;
  let match;
  while ((match = varRegex.exec(templateString)) !== null) {
    usedVariables.add(match[1]);
  }

  // Extract defined variables
  const definedVariables = new Set(
    Object.keys(template).filter((k) => k !== 'template')
  );

  // Check for undefined variables
  for (const varName of usedVariables) {
    if (!definedVariables.has(varName)) {
      errors.push({
        code: CompositionErrorCode.INVALID_REFERENCE,
        message: `Undefined template variable: {{${varName}}}`,
        location: `${location}.template`,
        severity: 'error',
      });
    }
  }

  // Warn about unused variables
  for (const varName of definedVariables) {
    if (!usedVariables.has(varName)) {
      warnings.push({
        code: 'UNUSED_TEMPLATE_VARIABLE',
        message: `Template variable "${varName}" is defined but not used`,
        location: `${location}.${varName}`,
        severity: 'warning',
      });
    }
  }

  // Check template syntax (unclosed braces)
  const openCount = (templateString.match(/\{\{/g) || []).length;
  const closeCount = (templateString.match(/\}\}/g) || []).length;
  if (openCount !== closeCount) {
    errors.push({
      code: CompositionErrorCode.INVALID_FORMAT,
      message: `Mismatched template braces ({{ vs }}): ${openCount} open, ${closeCount} close`,
      location: `${location}.template`,
      severity: 'error',
    });
  }

  // TODO: Detect recursive template loops (requires dependency graph)
}
```

### 2.6 Error Handling

**Error scenarios**:

1. **Undefined variable in template**
   ```
   ExecutionError: INVALID_REFERENCE
   Message: "Undefined template variable: nonexistent_var"
   Location: "steps[prepare_prompt].template"
   ```

2. **Mismatched braces**
   ```
   ValidationError: INVALID_FORMAT
   Message: "Mismatched template braces: 3 open, 2 close"
   Location: "steps[prepare_prompt].template"
   ```

3. **Variable coercion warning** (object/array → JSON)
   ```
   Warning: template_variable_coerced_to_json
   Variable: user_data
   Type: object
   Note: "Consider using a reference to a specific field instead"
   ```

4. **Recursive template depth exceeded**
   ```
   ExecutionError: EXECUTION_ERROR
   Message: "Template nesting depth exceeded (max: 5)"
   Location: "steps[deeply_nested].template"
   ```

---

## 3. Implementation Plan

### 3.1 Phase 1: Core Implementation (2-3 hours)

**TEMPLATE-001: Add TemplateExpression types**
- File: `src/common/composition/types.ts`
- Add `TemplateExpression` interface
- Add `isTemplateExpression()` type guard
- Update `ValueExpression` union
- Update exports

**TEMPLATE-002: Implement `resolveTemplate()` in executor**
- File: `src/common/composition/executor.ts`
- Add `resolveTemplate()` method
- Integrate with `resolveValue()`
- Handle variable resolution
- Implement interpolation logic
- Add string coercion rules

**TEMPLATE-003: Add template validation in compiler**
- File: `src/common/composition/compiler.ts`
- Add `validateTemplate()` method
- Check undefined variables
- Warn about unused variables
- Validate template syntax
- Integrate with `validate()` method

**TEMPLATE-004: Build and verify**
- Run: `npm run build`
- Fix TypeScript errors
- Ensure clean compilation

### 3.2 Phase 2: Testing (2-3 hours)

**TEMPLATE-005: Unit tests for executor**
- File: `src/common/composition/executor.test.ts`
- Test simple string interpolation
- Test multiple variables
- Test nested templates
- Test undefined variable errors
- Test variable coercion (number, boolean, null)
- Test escaped braces
- Test edge cases (empty template, no variables)

**TEMPLATE-006: Unit tests for compiler**
- File: `src/common/composition/compiler.test.ts`
- Test validation catches undefined variables
- Test validation warns about unused variables
- Test validation catches syntax errors
- Test validation allows valid templates

**TEMPLATE-007: Integration test with grockle**
- File: `examples/compositions/grockle.yaml`
- No changes needed (already uses template syntax!)
- Test full composition execution
- Verify template resolves correctly

**TEMPLATE-008: Run test suite**
- Run: `npm test -- executor.test.ts`
- Run: `npm test -- compiler.test.ts`
- Fix failures
- Ensure 100% pass rate

### 3.3 Phase 3: Documentation (1 hour)

**TEMPLATE-009: Document template syntax**
- File: `documentation/guides/compositions.md`
- Add "Template Expressions" section
- Provide examples for each use case
- Document variable resolution rules
- Document escaping rules
- Add troubleshooting tips

**TEMPLATE-010: Add JSDoc comments**
- Files: types.ts, executor.ts, compiler.ts
- Document `TemplateExpression` interface
- Document `resolveTemplate()` method
- Document `validateTemplate()` method
- Add examples in comments

**TEMPLATE-011: Update technical architecture**
- File: `planning/sprint-42-fcw4d1/technical-architecture.md`
- Add section on template expressions
- Update value expression diagram
- Document design decisions

### 3.4 Phase 4: Deployment & Validation (1 hour)

**TEMPLATE-012: Deploy to agent-dev**
- Provision agent-dev context
- Deploy tool-gateway with template support
- Test grockle composition
- Verify template resolution works

**TEMPLATE-013: Deploy to staging**
- Deploy tool-gateway to staging
- Test grockle composition in staging
- Verify no regressions
- Monitor logs for errors

**TEMPLATE-014: Validate grockle works end-to-end**
- Invoke grockle via MCP
- Provide test inputs
- Verify template interpolates correctly
- Verify generate_image receives string prompt
- Verify image generation succeeds

---

## 4. Acceptance Criteria

### 4.1 Functional Requirements

✅ **FR-1**: Template expressions support `{{variable}}` syntax
✅ **FR-2**: Variables can be references, literals, or nested expressions
✅ **FR-3**: Undefined variables throw compilation errors
✅ **FR-4**: Unused variables generate warnings
✅ **FR-5**: Nested templates resolve correctly
✅ **FR-6**: Escaped braces (`\{{`) render as literal `{{`
✅ **FR-7**: Non-string values coerce to strings with warnings

### 4.2 Technical Requirements

✅ **TR-1**: TypeScript compiles without errors
✅ **TR-2**: All unit tests pass
✅ **TR-3**: Code coverage >= 90% for new code
✅ **TR-4**: No performance regressions (template resolution < 5ms)
✅ **TR-5**: Graceful error handling with actionable messages

### 4.3 Documentation Requirements

✅ **DR-1**: Template syntax documented with examples
✅ **DR-2**: JSDoc comments on all public APIs
✅ **DR-3**: Troubleshooting guide for common errors

### 4.4 Validation Requirements

✅ **VR-1**: Grockle composition works end-to-end
✅ **VR-2**: No regressions in existing compositions
✅ **VR-3**: Deployment succeeds in agent-dev and staging
✅ **VR-4**: No errors in production logs

---

## 5. Design Decisions

### 5.1 Why Mustache Syntax?

**Decision**: Use `{{variable}}` instead of `${variable}`, `{variable}`, or `%variable%`

**Rationale**:
- **Familiarity**: Mustache/Handlebars used by GitHub Actions, Helm, Hugo
- **No conflicts**: `${}` conflicts with shell/JS syntax in multiline strings
- **Clear intent**: Double braces clearly signal template interpolation
- **Industry standard**: Widely recognized in devops/config management

**Alternatives considered**:
- `${variable}` (ES6 template literals) - ❌ Conflicts with shell syntax
- `{variable}` (single braces) - ❌ Ambiguous with JSON/YAML objects
- `%variable%` (Windows env vars) - ❌ Unfamiliar to modern developers

### 5.2 Why String Coercion?

**Decision**: Automatically coerce numbers/booleans to strings, stringify objects with warning

**Rationale**:
- **Convenience**: Most use cases interpolate strings, numbers, booleans
- **Safety**: Explicit warning for objects prevents accidental JSON dumps
- **Predictability**: Consistent behavior (no silent failures)

**Alternatives considered**:
- Strict typing (only strings allowed) - ❌ Too restrictive, verbose
- Silent coercion (no warnings) - ❌ Hides potential bugs
- Custom formatters - ❌ Too complex for v1

### 5.3 Why Not Full Mustache Features?

**Decision**: Support only variable interpolation, not sections/partials/helpers

**Rationale**:
- **Simplicity**: Keep composition DSL simple and learnable
- **Use case fit**: 95% of needs are basic interpolation
- **Composition primitives**: Use `ifValue`, `callStep` for logic instead
- **Future-proof**: Can add features later without breaking changes

**Features explicitly NOT supported** (use composition primitives instead):
- Sections (`{{#section}}...{{/section}}`) → Use `ifValue`
- Partials (`{{> partial}}`) → Use nested compositions
- Helpers (`{{format value}}`) → Use tool calls
- Lambdas → Use JavaScript-based compositions

### 5.4 Why Validate at Compile Time?

**Decision**: Catch undefined variables during compilation, not execution

**Rationale**:
- **Fail fast**: Detect errors before deployment
- **Better UX**: Clear error messages during development
- **Performance**: No runtime validation overhead
- **Type safety**: Align with TypeScript philosophy

---

## 6. Future Enhancements

### 6.1 Advanced Formatting (Post-MVP)

**Feature**: Custom formatters for common use cases

```yaml
# Hypothetical future syntax
formatted_date:
  template: "{{timestamp | date('YYYY-MM-DD')}}"
  timestamp:
    $ref: { namespace: input, pointer: /created_at }
```

**Use cases**:
- Date formatting
- Number formatting (currency, decimals)
- Case conversion (upper, lower, title)
- URL encoding/decoding

**Implementation**: Extend template syntax parser to support pipe operator

### 6.2 Conditional Interpolation (Post-MVP)

**Feature**: Inline conditionals for simple cases

```yaml
# Hypothetical future syntax
greeting:
  template: "{{#if excited}}Hello!{{else}}Hello.{{/if}}"
  excited:
    $ref: { namespace: input, pointer: /excited }
```

**Rationale**: Avoid verbose `ifValue` for simple string alternations

**Alternative**: Keep using `ifValue` (current approach is more explicit)

### 6.3 Template Caching (Performance)

**Feature**: Cache compiled templates to avoid regex re-execution

**Implementation**:
- Parse template once during compilation
- Store variable positions/names in compiled composition
- Runtime: Direct string splicing (no regex)

**Impact**: ~3-5x faster template resolution (10ms → 2ms for complex templates)

---

## 7. Risk Assessment

### 7.1 Technical Risks

**RISK-1: Regex Performance**
- **Impact**: High template count could slow execution
- **Probability**: Low (most compositions have < 5 templates)
- **Mitigation**: Template caching (future), benchmarking

**RISK-2: Escaping Edge Cases**
- **Impact**: Incorrect escaping could break templates
- **Probability**: Low (limited escape sequences)
- **Mitigation**: Comprehensive test coverage

**RISK-3: Recursive Template Loops**
- **Impact**: Infinite recursion crashes executor
- **Probability**: Low (requires intentional circular references)
- **Mitigation**: Depth limit (5 levels), validation warnings

### 7.2 UX Risks

**RISK-4: Confusing Error Messages**
- **Impact**: Users struggle to debug undefined variables
- **Probability**: Medium
- **Mitigation**: Clear error messages, documentation examples

**RISK-5: Unexpected Coercion Behavior**
- **Impact**: Users surprised by object → JSON conversion
- **Probability**: Medium
- **Mitigation**: Warnings at runtime, documentation

### 7.3 Compatibility Risks

**RISK-6: Breaking Changes to Existing Compositions**
- **Impact**: Objects with 'template' key accidentally treated as templates
- **Probability**: Very Low (unlikely to have coincidental structure)
- **Mitigation**: Type guard checks for complete structure

---

## 8. Success Metrics

### 8.1 Implementation Metrics

- ✅ Code coverage >= 90% for template-related code
- ✅ Build time increase < 500ms
- ✅ Executor performance regression < 5%

### 8.2 User Experience Metrics

- ✅ Grockle composition succeeds without modifications
- ✅ Error messages rated "clear" by reviewers
- ✅ Documentation completeness score >= 8/10

### 8.3 Production Metrics

- ✅ Zero critical bugs in first 30 days
- ✅ < 1% of template executions log warnings
- ✅ Zero incidents related to template resolution

---

## 9. Conclusion

Template expression support is a **natural evolution** of BitBrat's composition DSL that directly solves the current grockle failure. The implementation is **low-risk**, **well-scoped**, and **backwards-compatible**.

**Recommendation**: Implement in **sprint-43** as a P1 feature.

**Estimated effort**: 6-8 hours total
- Core implementation: 2-3 hours
- Testing: 2-3 hours
- Documentation: 1 hour
- Deployment/validation: 1 hour

**Dependencies**: None (can implement immediately after Sprint 42 completion)

**Impact**: High (unblocks grockle, improves composition UX across platform)
