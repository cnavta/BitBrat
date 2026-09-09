# Architecture Brief — Behavioral Compilation for MCP

**Status:** Proposed Architecture  
**Audience:** Coding agents, AI platform engineers, MCP implementers  
**Implementation language:** Language-agnostic  
**Authoring format:** YAML or JSON  
**Canonical representation:** JSON-compatible abstract syntax tree (AST)  
**Primary concepts:** Primitive Tool, Composition, Reflex, Promotion  
**DSL identifier used in examples:** `mcp-compose/v1`

---

## 1. Executive Summary

This architecture defines a learning path for an AI platform that begins with fully emergent LLM-driven MCP tool use and progressively converts repeated successful behavior into cheaper, more predictable, reusable execution.

The intended progression is:

```text
Emergent reasoning
      ↓
Repeated successful tool-use pattern
      ↓
Reusable Composition
      ↓
Frequently/predictably selected Composition
      ↓
Deterministic Reflex
```

The central design idea is that **repeated reasoning can be compiled into executable behavior**.

An LLM initially solves novel situations by deciding which MCP tools to call, in what order, and how to move information between them. When the platform observes a useful pattern being repeated, that sequence can be represented as a small declarative **Composition**. The Composition is then exposed through MCP as another tool.

To an agent, primitive tools and composed tools are intentionally indistinguishable:

```text
Primitive MCP Tool ─┐
                    ├── MCP Tool
Composition ────────┘
```

A Composition may call primitives, other Compositions, or both. This gives the tool system a closure property: existing tools can be combined into new tools, and those new tools can themselves participate in later combinations.

When the platform further learns that a particular tool or Composition is reliably invoked under a deterministic condition, the LLM can be removed from that dispatch path. The condition becomes a **Reflex**:

```text
event / signal
      ↓
deterministic predicate
      ↓
tool or Composition
```

The result is a progression from probabilistic behavior toward structured and eventually deterministic behavior without creating a hard boundary between "AI behavior" and "program behavior."

This document specifies:

1. The behavioral compilation model.
2. The runtime architecture.
3. A deliberately small MCP Composition DSL.
4. Composition validation and execution semantics.
5. Reflex semantics.
6. Promotion from observations to Compositions to Reflexes.
7. Security, policy, versioning, failure handling, and observability.
8. An implementation plan suitable for any major programming language.

---

## 2. Problem Statement

MCP standardizes how an AI system discovers and invokes tools, but the protocol does not itself define a general mechanism for taking several tool calls and publishing the resulting procedure as a new reusable tool.

Without a composition layer, repeated agent behavior commonly looks like:

```text
LLM
 ├─ decide to call A
 ├─ inspect A
 ├─ decide to call B
 ├─ inspect B
 ├─ decide to call C
 └─ interpret result
```

Even when the same successful sequence has been executed dozens or hundreds of times, the system may continue paying for repeated model inference and accepting repeated nondeterminism.

This creates several problems:

- repeated inference cost;
- repeated latency;
- inconsistent execution of already-learned behavior;
- unnecessary exposure of low-level tools to the model;
- larger tool catalogs and context requirements;
- repeated opportunities for tool-selection mistakes;
- difficulty auditing what should now be a known procedure;
- no clean path from agent discovery to deterministic automation.

The proposed architecture treats repeated tool-use patterns as candidates for **behavioral compilation**.

---

## 3. Architectural Thesis

The platform should support three progressively more deterministic forms of behavior.

### 3.1 Emergent behavior

The LLM chooses tools dynamically.

```text
Situation
   ↓
LLM reasoning
   ↓
Tool A
   ↓
LLM reasoning
   ↓
Tool C
   ↓
LLM reasoning
   ↓
Tool B
```

This is the most flexible form and should remain available for novel, ambiguous, or high-entropy situations.

### 3.2 Composed behavior

A successful procedure is represented declaratively and published as a tool.

```text
Situation
   ↓
LLM
   ↓
Tool: perform_x
          ├─ Tool A
          ├─ Tool C
          └─ Tool B
```

The LLM still decides **whether** the capability is appropriate, but it no longer needs to reason through the mechanics of the procedure.

### 3.3 Reflexive behavior

The platform determines that selection itself can be deterministic.

```text
Signal
  ↓
Predicate
  ↓
Tool: perform_x
```

The LLM is absent from the normal execution path.

This produces the conceptual learning ladder:

```text
Reasoning → Pattern → Procedure → Capability → Reflex
```

Another useful framing is:

```text
Probabilistic → Structured → Deterministic
```

The architecture should make movement down this ladder gradual, observable, reversible, and policy-controlled.

---

## 4. Goals

The system SHOULD:

- allow multiple MCP calls to be represented as one reusable MCP tool;
- make Compositions easy for LLMs to author correctly;
- remain straightforward for humans to read and review;
- be serializable, diffable, versionable, and auditable;
- preserve typed values between tool calls;
- use MCP tool schemas for validation wherever practical;
- support explicit access to execution context;
- support simple deterministic conditions;
- allow Compositions to call other Compositions;
- detect dependency cycles;
- expose a Composition through MCP without requiring agents to know it is composed;
- record sufficient provenance to explain how a Composition was created;
- support promotion from observed behavior to reusable Composition;
- support later promotion from repeated tool selection to Reflex;
- remain implementation-language neutral;
- be safe to execute without embedding arbitrary code.

---

## 5. Non-Goals

The Composition DSL is deliberately **not** intended to become a general-purpose programming language.

Version 1 SHOULD NOT attempt to provide:

- arbitrary code execution;
- user-defined functions;
- unrestricted expressions;
- imports or module systems;
- arbitrary recursion;
- unrestricted loops;
- mutable global state;
- general exception programming;
- a full workflow scheduler;
- durable multi-day workflow state;
- human approval workflow modeling;
- cron scheduling;
- distributed transaction semantics;
- BPMN-style process modeling;
- a replacement for Temporal, Step Functions, Airflow, Dagster, or similar workflow systems.

If a Composition grows complicated enough to require those features, the behavior should probably be implemented as a real service or a workflow in a purpose-built workflow system and then exposed as an MCP primitive.

A useful design rule is:

> A Composition should describe a small reusable capability, not an application.

---

## 6. Core Domain Model

### 6.1 Primitive Tool

A **Primitive Tool** is an MCP tool whose implementation exists outside the Composition system.

Examples:

```text
twitch.get_user
memory.get_viewer
obs.show_alert
billing.create_account
crm.get_customer
```

Primitive tools are registered in a local Tool Catalog.

### 6.2 Composition

A **Composition** is a declarative implementation of a tool in terms of other tools.

Example:

```text
viewer_greeting
    ├─ twitch.get_user
    ├─ memory.get_viewer
    └─ obs.show_alert
```

A Composition has:

- an MCP-facing name;
- description;
- input schema;
- optional required execution-context schema;
- output schema;
- ordered execution steps;
- deterministic references between values;
- deterministic conditions;
- metadata and provenance.

### 6.3 Composed Tool

Once validated and registered, a Composition is exposed as an ordinary MCP tool.

From the caller's perspective:

```text
tools/list
```

may return:

```text
twitch.get_user
memory.get_viewer
viewer_greeting
```

The caller is not required to know that `viewer_greeting` is implemented by other tools.

### 6.4 Reflex

A **Reflex** is a deterministic mapping from a signal plus an optional predicate to one tool invocation.

A Reflex does not describe a workflow.

It answers:

> When should an already-known capability execute without model reasoning?

A Reflex MAY target either a primitive tool or a Composition.

### 6.5 Observation

An **Observation** records an emergent execution performed by an agent, including enough information to identify repeated behavior.

An observation may contain:

- triggering intent or event class;
- selected tools;
- dependency edges;
- sanitized arguments;
- result classes;
- success/failure;
- timing;
- model identity;
- policy decisions;
- user corrections;
- final outcome.

Raw secrets or sensitive payloads SHOULD NOT be retained unless explicitly necessary.

### 6.6 Candidate Composition

A **Candidate Composition** is a proposed reusable procedure derived from observations or authored directly by a human/agent.

It is not callable as a production tool until validated and promoted.

### 6.7 Promotion

**Promotion** is the controlled movement of behavior between lifecycle states.

A recommended state model is:

```text
observed
   ↓
candidate
   ↓
validated
   ↓
published
   ↓
reflex-eligible
   ↓
reflex-active
```

Demotion MUST also be supported.

---

## 7. Architectural Overview

```text
                         ┌─────────────────────────┐
                         │          Agent          │
                         └────────────┬────────────┘
                                      │ MCP
                                      ▼
                         ┌─────────────────────────┐
                         │     MCP Tool Facade     │
                         └────────────┬────────────┘
                                      │
                     ┌────────────────┴────────────────┐
                     │                                 │
                     ▼                                 ▼
          ┌────────────────────┐            ┌────────────────────┐
          │   Primitive Tool   │            │ Composition Runtime│
          │      Resolver      │            └──────────┬─────────┘
          └──────────┬─────────┘                       │
                     │                                 │ resolves
                     │                       ┌─────────▼─────────┐
                     │                       │   Tool Catalog    │
                     │                       └─────────┬─────────┘
                     │                                 │
                     └────────────────┬────────────────┘
                                      │
                                      ▼
                          downstream MCP servers


 Event / Signal
      │
      ▼
┌──────────────┐
│ Reflex Engine│
└──────┬───────┘
       │ deterministic call
       └──────────────► MCP Tool Facade / Composition Runtime


 All execution paths
      │
      ▼
┌───────────────────────┐
│ Observation / Telemetry│
└──────────┬────────────┘
           │
           ▼
┌────────────────────────┐
│ Learning / Promotion   │
│ Analysis               │
└──────────┬─────────────┘
           │
           ▼
┌────────────────────────┐
│ Candidate Generator    │
└──────────┬─────────────┘
           │
           ▼
┌────────────────────────┐
│ Validator / Compiler   │
└──────────┬─────────────┘
           │
           ▼
┌────────────────────────┐
│ Composition Registry   │
└────────────────────────┘
```

---

## 8. Major Components

### 8.1 Tool Catalog

The Tool Catalog provides a stable logical identity for callable capabilities.

A catalog record SHOULD contain:

```text
logical_tool_id
display_name
description
source_type              # primitive | composition
mcp_server_binding
mcp_tool_name
input_schema
output_schema
local_policy_metadata
schema_fingerprint
capability_fingerprint
trust_level
side_effect_class
availability
```

Example logical IDs:

```text
twitch.get_user
viewer_memory.get
obs.show_alert
viewer_greeting
```

The DSL SHOULD reference logical tool IDs rather than transport URLs or process locations.

This separates:

```text
what capability is needed
```

from:

```text
where that capability currently runs
```

### 8.2 Composition Registry

Stores versioned Composition definitions and compiled plans.

Recommended stored fields:

```text
composition_id
name
version
source_document
canonical_ast
compiled_plan
content_hash
status
created_at
created_by
derived_from_observations
tool_dependencies
dependency_fingerprints
validation_report
policy_classification
promotion_metadata
```

### 8.3 Parser

Accepts YAML or JSON authoring syntax and produces a canonical AST.

The parser MUST NOT evaluate code.

### 8.4 Validator / Compiler

Responsible for:

1. validating DSL structure;
2. resolving referenced tools;
3. resolving referenced Compositions;
4. checking names and scopes;
5. detecting cycles;
6. checking obvious schema incompatibilities;
7. calculating effective policy requirements;
8. constructing an execution plan;
9. recording tool/schema fingerprints;
10. producing an immutable compiled artifact.

### 8.5 Composition Runtime

Executes a compiled Composition.

Responsibilities include:

- validating caller input;
- injecting execution context;
- resolving references;
- executing child tools;
- applying deterministic conditions;
- enforcing time/resource limits;
- propagating authorization;
- validating downstream structured results;
- building the final structured result;
- emitting tracing and observation records.

### 8.6 MCP Tool Facade

Publishes validated Compositions through MCP.

A Composition should map naturally onto:

```text
name
description
inputSchema
outputSchema
annotations
```

The implementation MAY run as:

- a standalone MCP server;
- a feature of an MCP gateway;
- a registry-backed virtual MCP server;
- part of an agent platform's existing MCP service.

### 8.7 Observation Recorder

Captures emergent and composed tool-use traces.

The recorder is important because the platform cannot learn repeated behavior it cannot observe.

### 8.8 Promotion Analyzer

Searches observations for stable, repeated patterns.

This component may use:

- deterministic sequence analysis;
- graph similarity;
- clustering;
- statistical thresholds;
- LLM-assisted generalization;
- human review.

The architecture does not require that promotion itself be automated.

### 8.9 Reflex Engine

Consumes platform events/signals, evaluates deterministic predicates, and invokes a single tool or Composition.

The Reflex Engine MUST NOT require an LLM for normal evaluation.

---

# Part II — Composition DSL

## 9. DSL Design Principles

The DSL should be:

### Small

Every language feature adds ambiguity, validation burden, execution complexity, and attack surface.

### Declarative

The document describes what calls and bindings exist rather than embedding executable code.

### Typed

Values should retain their JSON type while moving between calls.

### Explicit

Context, conditions, and dependencies should be visible in the document.

### Boring

"Boring" syntax is a feature. LLMs and deterministic parsers both benefit from predictable structures.

### Canonicalizable

Two semantically equivalent documents SHOULD compile to a stable canonical representation suitable for hashing and versioning.

### Closed to arbitrary execution

There is no shell, `eval`, JavaScript expression, Python expression, SQL expression, or arbitrary plugin expression embedded in the DSL.

---

## 10. Authoring Format and Canonical IR

YAML is RECOMMENDED as the human/LLM authoring syntax because it is concise and readable.

JSON MUST be accepted as an equivalent representation.

The implementation SHOULD canonicalize both into a JSON-compatible AST before validation or execution.

Example:

```yaml
apiVersion: mcp-compose/v1
kind: Composition
metadata:
  name: customer_summary
spec:
  ...
```

Canonicalization SHOULD include:

- normalized key ordering for hashing;
- normalized reference nodes;
- normalized condition operators;
- explicit defaults;
- removal of comments;
- preservation of source location separately for diagnostics.

The runtime SHOULD execute only validated canonical/compiled representations, not raw source text.

---

## 11. Top-Level Composition Structure

Recommended V1 structure:

```yaml
apiVersion: mcp-compose/v1
kind: Composition

metadata:
  name: viewer_greeting
  description: Build and display the appropriate viewer greeting.

spec:
  inputSchema:
    ...

  contextSchema:
    ...

  outputSchema:
    ...

  steps:
    ...

  return:
    ...
```

### Required fields

```text
apiVersion
kind
metadata.name
spec.inputSchema
spec.steps
spec.return
```

### Recommended fields

```text
metadata.description
spec.outputSchema
```

### Optional fields

```text
metadata.labels
metadata.annotations
spec.contextSchema
```

---

## 12. Tool Naming

Composition names SHOULD follow the same naming constraints used by the hosting MCP implementation.

Internally, every callable capability SHOULD have a stable logical ID.

Recommended form:

```text
namespace.tool_name
```

Examples:

```text
twitch.get_user
viewer_memory.get
obs.show_alert
customer.create_summary
```

A Composition MUST NOT dynamically calculate a tool name at runtime.

This is invalid:

```yaml
call: $input/tool_name
```

Tool targets are static dependencies and MUST be known at compile time.

This allows:

- authorization analysis;
- dependency discovery;
- cycle detection;
- policy classification;
- reproducible builds;
- schema validation.

---

## 13. Input Schema

Composition inputs use JSON Schema.

Example:

```yaml
inputSchema:
  type: object
  additionalProperties: false
  properties:
    user_id:
      type: string
    force:
      type: boolean
      default: false
  required:
    - user_id
```

The MCP-facing tool SHOULD expose this schema directly or in a semantically equivalent form.

The compiler MUST reject execution inputs that do not validate.

---

## 14. Output Schema

Published Compositions SHOULD have an output schema.

Example:

```yaml
outputSchema:
  type: object
  additionalProperties: false
  properties:
    handled:
      type: boolean
    viewer_id:
      type: string
    greeting_type:
      type: string
  required:
    - handled
    - viewer_id
    - greeting_type
```

Candidate Compositions MAY temporarily omit an output schema while being authored.

A Composition SHOULD NOT be promoted to a stable published tool until its output contract is known.

The final `return` value MUST validate against `outputSchema`.

---

## 15. Execution Context

Some values required by a procedure should not be exposed as normal tool arguments.

Examples:

- authenticated principal;
- tenant ID;
- channel ID;
- request trace ID;
- execution timestamp;
- platform environment;
- authorization scope.

These are provided through read-only `$context`.

A Composition MAY declare the context it requires:

```yaml
contextSchema:
  type: object
  properties:
    channel_id:
      type: string
    tenant_id:
      type: string
  required:
    - tenant_id
```

The runtime MUST validate required context before executing the first step.

A Composition MUST NOT implicitly inspect the LLM's prompt or conversation context.

Replayability should be approximately:

```text
Composition Version
+ Input
+ Explicit Execution Context
+ Tool Environment
= Reproducible Procedure
```

This does not imply external tools themselves are deterministic.

---

## 16. Value Namespaces

V1 defines three Composition namespaces:

```text
$input
$context
$steps
```

Examples:

```yaml
user_id: $input/user_id
tenant_id: $context/tenant_id
display_name: $steps/user/display_name
```

### `$input`

Validated caller arguments.

### `$context`

Host-injected execution context.

### `$steps`

Outputs produced by previous steps.

A step with:

```yaml
id: user
```

binds its normalized structured result to:

```text
$steps/user
```

---

## 17. Reference Syntax

The recommended source syntax is:

```text
$input/path
$context/path
$steps/step_id/path
```

Examples:

```text
$input/user_id
$context/channel/id
$steps/customer/email
$steps/search/items/0/id
```

Paths SHOULD use JSON-Pointer-like escaping rules:

```text
~0  represents ~
~1  represents /
```

The parser SHOULD canonicalize a reference to an AST node similar to:

```json
{
  "$ref": {
    "namespace": "steps",
    "pointer": "/customer/email"
  }
}
```

The runtime MUST preserve the referenced value's type.

For example:

```yaml
age: $steps/customer/age
```

passes an integer if `age` is an integer. It does not convert it to `"42"`.

### No implicit interpolation

V1 SHOULD NOT interpret:

```yaml
message: "Hello $steps/user/name"
```

as a template.

That is an ordinary literal string.

String templating MAY be introduced later as an explicit construct such as:

```yaml
template:
  format: "Hello {name}"
  values:
    name: $steps/user/name
```

Keeping references typed and templating explicit avoids accidental type coercion.

---

## 18. Literal Values

Ordinary YAML/JSON values are literals:

```yaml
enabled: true
count: 3
mode: compact
options:
  - a
  - b
```

If an implementation chooses to treat scalar values beginning with `$input/`, `$context/`, or `$steps/` as reference shorthand, it MUST provide a literal escape form.

Recommended canonical escape:

```yaml
value:
  $literal: "$input/not-a-reference"
```

---

## 19. Call Step

The basic executable unit is a call step.

```yaml
- id: user
  call: twitch.get_user
  with:
    id: $input/user_id
```

Required:

```text
id
call
```

Optional:

```text
with
when
```

`with` defaults to `{}`.

### Step ID

Step IDs:

- MUST be unique within a Composition;
- SHOULD use `[A-Za-z][A-Za-z0-9_-]*`;
- become the symbol used under `$steps`.

### Call target

`call` MUST resolve at compile time to a primitive tool or published Composition.

### Arguments

The runtime recursively resolves references in `with`, then validates the resulting object against the target tool's input schema.

---

## 20. Structured Result Semantics

Reusable Composition depends heavily on structured data.

For a call step, the preferred result source is the downstream MCP tool's `structuredContent`.

Conceptually:

```text
MCP CallToolResult.structuredContent
        ↓
$steps/<step-id>
```

A primitive tool without structured output MAY still be called for its side effect if no later step references its result.

Example:

```yaml
- id: notification
  call: obs.show_alert
  with:
    message: $input/message
```

If a later step references:

```text
$steps/notification/foo
```

the compiler SHOULD require the tool to have a usable structured output contract.

The runtime SHOULD NOT silently parse arbitrary human-readable text into structured data.

If a legacy tool returns only text and must participate in structured Composition, implement an explicit adapter tool.

This design intentionally pushes reusable capabilities toward well-defined structured interfaces.

---

## 21. Deterministic Condition Expressions

V1 conditions are data structures, not executable expressions.

Recommended operators:

```text
exists
equals
notEquals
greaterThan
greaterThanOrEqual
lessThan
lessThanOrEqual
all
any
not
```

Examples:

```yaml
exists: $steps/user/organization_id
```

```yaml
equals:
  - $steps/memory/returning
  - true
```

```yaml
all:
  - exists: $steps/user/id
  - greaterThan:
      - $steps/user/reputation
      - 50
```

```yaml
not:
  equals:
    - $input/status
    - blocked
```

There is no arbitrary expression syntax such as:

```text
foo?.bar != null && baz.length > 7
```

This is intentional.

### Condition type rules

- comparison operators SHOULD require compatible scalar values;
- `all` and `any` receive conditions;
- `not` receives one condition;
- missing references are errors unless evaluated by `exists`;
- implementations SHOULD avoid language-specific truthiness.

---

## 22. Conditional Value Step

Simple branching can be represented using a deterministic conditional value step.

```yaml
- id: greeting_type
  if:
    condition:
      equals:
        - $steps/memory/returning
        - true
    then: returning_viewer
    else: new_viewer
```

The result is stored under:

```text
$steps/greeting_type
```

Both `then` and `else` MAY contain literals, references, arrays, or objects.

Example:

```yaml
- id: routing
  if:
    condition:
      greaterThan:
        - $steps/order/total
        - 1000
    then:
      queue: priority
      review: true
    else:
      queue: standard
      review: false
```

V1 does not require arbitrary executable branches inside `then` and `else`.

Different tool calls can be conditionally executed using guarded call steps.

---

## 23. Guarded Call Step

A call may include `when`.

```yaml
- id: organization
  call: organizations.get
  when:
    exists: $steps/user/organization_id
  with:
    id: $steps/user/organization_id
```

If the condition evaluates to false:

- the tool is not called;
- the step status is `skipped`;
- `$steps/organization` resolves to `null`.

The compiler SHOULD require downstream handling to be compatible with nullable results where practical.

Example mutually exclusive calls:

```yaml
- id: vip_alert
  call: alerts.vip
  when:
    greaterThanOrEqual:
      - $steps/customer/lifetime_value
      - 10000
  with:
    customer_id: $steps/customer/id

- id: standard_alert
  call: alerts.standard
  when:
    lessThan:
      - $steps/customer/lifetime_value
      - 10000
  with:
    customer_id: $steps/customer/id
```

---

## 24. Parallel Execution

Parallelism is useful but should remain explicit.

Recommended syntax:

```yaml
- parallel:
    - id: reputation
      call: reputation.get
      with:
        user_id: $steps/user/id

    - id: history
      call: viewer_history.get
      with:
        user_id: $steps/user/id
```

Rules:

- all child steps begin only after dependencies outside the block are available;
- child steps MUST NOT depend on outputs of siblings in the same block;
- all children complete before execution continues;
- normal failure policy applies to each child;
- child IDs are bound normally under `$steps`.

A compiler MUST reject:

```yaml
- parallel:
    - id: a
      call: foo.a

    - id: b
      call: foo.b
      with:
        value: $steps/a/value
```

because `b` depends on `a` and therefore is not parallel.

Parallel execution SHOULD be optional for an MVP implementation. Sequential correctness is more important than optimization.

---

## 25. Return

`return` constructs the Composition's structured output.

Example:

```yaml
return:
  handled: true
  viewer_id: $steps/user/id
  greeting_type: $steps/greeting_type
```

The return object is recursively reference-resolved.

The runtime MUST validate it against `outputSchema` if present.

The MCP facade SHOULD expose the result as `structuredContent`.

For compatibility with MCP clients that expect textual content, the server MAY also include a JSON serialization as text when appropriate.

---

## 26. Full Composition Example

```yaml
apiVersion: mcp-compose/v1
kind: Composition

metadata:
  name: viewer_greeting
  description: >
    Resolve a Twitch viewer, retrieve stored viewer state,
    choose a greeting type, and display an OBS alert.

spec:
  inputSchema:
    type: object
    additionalProperties: false
    properties:
      user_id:
        type: string
    required:
      - user_id

  contextSchema:
    type: object
    properties:
      channel_id:
        type: string
    required:
      - channel_id

  outputSchema:
    type: object
    additionalProperties: false
    properties:
      handled:
        type: boolean
      viewer_id:
        type: string
      greeting_type:
        type: string
        enum:
          - new_viewer
          - returning_viewer
    required:
      - handled
      - viewer_id
      - greeting_type

  steps:
    - id: user
      call: twitch.get_user
      with:
        id: $input/user_id

    - id: memory
      call: viewer_memory.get
      with:
        user_id: $steps/user/id
        channel_id: $context/channel_id

    - id: greeting_type
      if:
        condition:
          equals:
            - $steps/memory/returning
            - true
        then: returning_viewer
        else: new_viewer

    - id: alert
      call: obs.show_alert
      with:
        template: $steps/greeting_type
        name: $steps/user/display_name

  return:
    handled: true
    viewer_id: $steps/user/id
    greeting_type: $steps/greeting_type
```

The platform publishes this as approximately:

```text
viewer_greeting(user_id: string)
```

An agent need not know that the tool internally performs several calls.

---

## 27. Composition of Compositions

A Composition may call another Composition by logical tool ID.

Example:

```yaml
- id: identity
  call: player.lookup_identity
  with:
    player_name: $input/player_name

- id: reputation
  call: reputation.get
  with:
    player_id: $steps/identity/player/id
```

There should be no runtime distinction between calling:

```text
primitive → primitive
```

and:

```text
composition → composition
```

except tracing and policy metadata.

This property is fundamental.

It enables:

```text
A + B → C
C + D → E
E + F → G
```

without requiring the agent to reason about implementation depth.

---

## 28. Dependency Graph and Cycle Detection

Composition dependencies form a directed graph.

Example:

```text
composition.A
    ├─ primitive.x
    └─ composition.B
             └─ primitive.y
```

The compiler MUST reject recursive dependency cycles such as:

```text
A → B → C → A
```

V1 SHOULD prohibit both direct and indirect recursive Composition invocation.

The platform SHOULD enforce configurable limits such as:

```text
max composition nesting depth
max total tool calls
max parallel width
max execution duration
max structured result size
```

---

## 29. Error Semantics

V1 SHOULD use simple fail-fast semantics.

### Default rule

If a required tool call fails:

```text
Composition fails.
```

The Composition error SHOULD include:

```text
composition name/version
step ID
logical tool ID
downstream error classification
trace ID
```

Sensitive tool payloads MUST NOT be leaked in error messages.

### Skipped steps

A false `when` condition is not an error.

### Condition failures

A malformed condition or unresolved required reference is an execution error.

### Output validation

If the final result violates `outputSchema`, the Composition fails even if every child tool succeeded.

### Retries

Automatic retries SHOULD NOT be part of the core DSL V1.

A runtime MAY apply infrastructure-level retries only when policy indicates they are safe.

In particular, a platform SHOULD NOT retry a side-effecting call merely because transport failed unless idempotency is known.

Future versions may add explicit retry/fallback constructs if real use cases justify them.

---

## 30. Timeouts and Resource Limits

Execution controls belong primarily to runtime policy rather than the DSL.

Recommended policy:

```text
per-step timeout
composition timeout
max steps
max nested compositions
max result bytes
max concurrency
```

This prevents learned Compositions from accidentally becoming unbounded programs.

---

# Part III — Compilation and Validation

## 31. Compilation Pipeline

A recommended compiler pipeline is:

```text
source YAML/JSON
      ↓
parse
      ↓
DSL schema validation
      ↓
canonical AST
      ↓
resolve tool dependencies
      ↓
resolve Composition dependencies
      ↓
cycle detection
      ↓
reference/scope validation
      ↓
schema/type analysis
      ↓
policy analysis
      ↓
execution plan
      ↓
canonical hash
      ↓
registry artifact
```

---

## 32. Static Reference Validation

The compiler SHOULD verify that:

- every `$steps/<id>` references an earlier reachable step;
- every step ID exists;
- context references are allowed by `contextSchema`;
- input references are allowed by `inputSchema`;
- parallel siblings do not reference each other;
- return references are reachable;
- condition references are valid.

Where a JSON Schema is sufficiently specific, the compiler SHOULD also verify property existence.

---

## 33. Schema Compatibility

Full mathematical compatibility between arbitrary JSON Schemas can be expensive or undecidable in the general case.

V1 SHOULD therefore use a conservative strategy.

The compiler SHOULD detect obvious incompatibilities such as:

```text
integer → required string
boolean → object
array → scalar
```

It MAY warn rather than reject when compatibility cannot be proven.

The runtime MUST still validate the fully resolved arguments against each target tool's actual input schema immediately before invocation.

The combination of:

```text
best-effort static analysis
+
mandatory runtime validation
```

provides useful safety without requiring a complete JSON Schema theorem prover.

---

## 34. Schema Fingerprints and Drift

MCP tools may change independently of a Composition.

The registry SHOULD record fingerprints of every dependency's:

```text
logical identity
input schema
output schema
local policy metadata
```

When a dependency changes, affected Compositions SHOULD become:

```text
needs_revalidation
```

or equivalent.

A Composition SHOULD NOT silently continue as though its dependencies are unchanged when a schema contract has drifted materially.

---

## 35. Compiled Execution Plan

The runtime does not need to execute YAML directly.

The compiler SHOULD create an internal plan such as:

```json
{
  "composition": "viewer_greeting",
  "version": 3,
  "steps": [
    {
      "type": "call",
      "id": "user",
      "tool": "twitch.get_user",
      "arguments": {
        "id": {
          "$ref": {
            "namespace": "input",
            "pointer": "/user_id"
          }
        }
      }
    }
  ]
}
```

Language-specific implementations may model this using:

- classes;
- discriminated unions;
- enums plus records;
- tagged structs;
- sealed interfaces;
- algebraic data types.

The conceptual model should remain the same.

---

# Part IV — Reflexes

## 36. Reflex Definition

A Reflex is intentionally smaller than a Composition.

A Reflex contains:

```text
signal/event selector
optional deterministic condition
one tool target
argument bindings
policy metadata
```

It does not contain arbitrary multi-step procedure logic.

That logic belongs in a Composition.

---

## 37. Reflex DSL

Recommended shape:

```yaml
apiVersion: mcp-compose/v1
kind: Reflex

metadata:
  name: greet_joining_viewer

spec:
  on:
    event: twitch.viewer.joined

  when:
    greaterThan:
      - $event/viewer_count
      - 20

  call: viewer_greeting

  with:
    user_id: $event/user_id
```

Reflex namespaces:

```text
$event
$context
```

A Reflex MUST NOT reference LLM conversation state.

---

## 38. Reflex Execution

```text
event arrives
    ↓
validate event
    ↓
match event selector
    ↓
evaluate deterministic predicate
    ↓
resolve arguments
    ↓
policy check
    ↓
invoke tool
```

The invoked target may be:

```text
primitive tool
```

or:

```text
Composition
```

No special execution path is needed beyond deterministic dispatch.

---

## 39. Why Composition and Reflex Must Remain Separate

A Composition answers:

> How do I perform capability X?

A Reflex answers:

> Under what deterministic circumstances should X happen automatically?

Mixing these concerns produces a workflow engine and makes learning stages harder to reason about.

Keeping them separate allows:

```text
Composition
inputs → procedure → output
```

and:

```text
Reflex
signal + predicate → capability
```

A single Composition can be:

- called manually;
- selected by an LLM;
- called by another Composition;
- triggered by one or more Reflexes.

---

# Part V — Learning and Promotion

## 40. Observation of Emergent Behavior

Every LLM-driven tool execution SHOULD produce an observation graph.

Do not record only the literal order of calls.

Record dependencies.

Example emergent execution:

```text
A
├─ B(A.result)
└─ C(A.result)
      └─ D(C.result)
```

This is more informative than:

```text
A → B → C → D
```

because B and C may be independent.

Useful recorded information includes:

```text
intent class
tool IDs
argument dependency mappings
execution context class
success/failure
latency
side effects
final outcome
agent corrections
user corrections
```

---

## 41. Pattern Detection

The learning layer searches for repeated subgraphs.

Potential signals:

- identical tool graph shape;
- stable argument mappings;
- stable ordering;
- stable conditions;
- high success rate;
- repeated use across similar intents;
- low variance in output handling;
- repeated LLM selection of the same procedure;
- repeated post-call interpretation that can itself be made deterministic.

The first implementation does not need sophisticated ML.

A practical V1 can begin with:

```text
normalized tool-call graph hash
+
frequency count
+
success rate
```

and use an LLM only to propose generalized names, descriptions, schemas, and parameter boundaries.

---

## 42. Candidate Generation

A candidate generator receives several successful observations and attempts to separate:

```text
stable procedure
```

from:

```text
instance-specific values
```

For example, repeated calls:

```text
get_user("alice")
memory_get("alice")
show_alert("alice")
```

and:

```text
get_user("bob")
memory_get("bob")
show_alert("bob")
```

suggest:

```text
input.user_id
```

rather than a hard-coded user.

Candidate generation SHOULD produce:

- Composition source;
- proposed input schema;
- proposed output schema;
- source observation IDs;
- confidence/provenance metadata;
- unresolved assumptions.

An LLM may author this candidate, but deterministic validation controls whether it becomes executable.

---

## 43. Validation Before Promotion

A Candidate SHOULD pass multiple validation stages.

### Structural validation

The DSL is well formed.

### Tool validation

All referenced tools exist.

### Schema validation

Bindings are legal enough to execute.

### Replay validation

Where safe, replay against recorded fixtures, mocks, or test servers.

### Behavioral comparison

Compare candidate outputs/outcomes with the original observed executions.

### Policy validation

Determine whether the Composition changes approval or authorization requirements.

### Side-effect validation

Avoid replaying destructive actions against production systems.

### Human review

Optional but strongly recommended for sensitive capabilities.

---

## 44. Promotion to Tool

Once validated, the Composition is registered and published through MCP.

The next time an agent sees a matching situation, it may choose:

```text
viewer_greeting
```

instead of independently discovering:

```text
twitch.get_user
viewer_memory.get
obs.show_alert
```

This is the first major compilation step:

```text
reasoning path
      ↓
named capability
```

---

## 45. Promotion Toward Reflex

The system then observes **selection of the Composition itself**.

Suppose:

```text
event = twitch.viewer.joined
```

is repeatedly followed by:

```text
LLM → viewer_greeting
```

with little or no meaningful variation.

The platform may propose a Reflex candidate:

```text
twitch.viewer.joined → viewer_greeting
```

A Reflex candidate is appropriate only when the trigger decision can be represented using deterministic information available before invocation.

---

## 46. Reflex Promotion Criteria

Useful signals may include:

```text
high invocation frequency
high selection precision
stable event/intent classification
stable argument mapping
low correction rate
low ambiguity
acceptable side-effect risk
sufficient historical support
```

The architecture SHOULD NOT hard-code one universal numeric threshold.

Promotion policy should be configurable by capability class.

A read-only cache-refresh operation may be promoted aggressively.

A financial, destructive, privacy-sensitive, or externally visible action should require much stronger evidence and authorization.

---

## 47. Demotion and Unlearning

Learning must be reversible.

A tool or Reflex may become invalid because:

- downstream schemas changed;
- environment changed;
- observed behavior changed;
- user preferences changed;
- error rate increased;
- policy changed;
- the original pattern was overgeneralized.

The system MUST support:

```text
disable Reflex
demote Composition
rollback Composition version
invalidate dependency
return decision to LLM
```

A good learning system must be able to say:

> This is uncertain again.

---

# Part VI — Security and Policy

## 48. Principle of No Authority Escalation

A Composition MUST NOT gain more authority than the underlying execution context and tools allow.

If a Composition calls:

```text
read_customer
delete_account
```

its effective authority requirements include the delete capability.

Publishing those calls behind one friendly tool name MUST NOT bypass policy.

---

## 49. Authorization Propagation

Every child call SHOULD execute under the effective identity/authorization of the parent invocation unless an explicitly configured trusted service boundary says otherwise.

Do not treat the Composition runtime's service identity as implicit permission to perform arbitrary downstream operations.

---

## 50. Effective Policy Classification

The compiler SHOULD compute effective policy metadata from dependencies.

Conceptually:

```text
Composition risk
    >=
maximum relevant risk of child capabilities
```

Examples:

- a Composition containing a destructive call is destructive;
- a Composition containing an externally visible post is externally visible;
- a Composition requiring sensitive data inherits those data-access requirements.

MCP tool annotations may help describe behavior, but local policy metadata SHOULD remain authoritative because remote annotations are not necessarily trusted.

---

## 51. Reflex Safety

Reflexes deserve stricter policy because they remove human/model deliberation from dispatch.

Recommended default:

```text
read-only / local / reversible
    → easier Reflex promotion

external / destructive / financial / irreversible
    → explicit authorization required
```

The platform SHOULD be able to prohibit entire capability classes from autonomous Reflex execution.

---

## 52. DSL Sandbox Properties

The DSL MUST NOT provide:

- arbitrary filesystem access;
- arbitrary network access;
- shell commands;
- arbitrary code expressions;
- dynamically constructed tool names;
- reflection over runtime objects;
- unrestricted recursion.

All side effects occur through explicitly cataloged tools.

This makes the tool catalog the security boundary.

---

## 53. Secrets

Secrets SHOULD be injected by runtime/tool infrastructure, not embedded in Composition source.

A Composition should say:

```yaml
call: crm.get_customer
```

not:

```yaml
headers:
  Authorization: Bearer abc123
```

Observation logs MUST redact secret material.

---

# Part VII — Observability

## 54. Trace Model

Every Composition invocation SHOULD create a parent trace/span.

Each child step SHOULD create a child span.

Recommended fields:

```text
trace_id
composition_name
composition_version
composition_hash
step_id
logical_tool_id
source_type
start_time
duration
status
error_class
input_schema_hash
output_schema_hash
policy_decision
```

Sensitive raw payloads should be omitted or redacted by default.

---

## 55. Learning Metrics

The platform SHOULD track:

```text
composition invocation count
success rate
failure rate by step
median/p95 latency
agent selection frequency
agent bypass frequency
candidate support count
user correction rate
schema drift count
reflex firing count
reflex suppression count
reflex rollback count
```

These metrics support promotion and demotion decisions.

---

## 56. Explainability

Given a published tool, the platform SHOULD be able to answer:

```text
What is this tool?
What version is active?
What does it call?
What permissions does it require?
Which observations led to it?
When was it promoted?
What validation was performed?
What Reflexes can trigger it?
```

This is more useful than opaque "the agent learned it" behavior.

---

# Part VIII — Versioning and Registry Semantics

## 57. Immutable Versions

Published Composition versions SHOULD be immutable.

Editing creates a new version.

Example:

```text
viewer_greeting@1
viewer_greeting@2
viewer_greeting@3
```

A logical alias may point at the active version:

```text
viewer_greeting → viewer_greeting@3
```

---

## 58. Content Hash

The compiler SHOULD calculate a cryptographic hash over the canonical AST plus relevant compilation inputs.

This supports:

- deduplication;
- audit;
- cache keys;
- exact rollback;
- provenance.

---

## 59. Dependency Pinning

There are two reasonable modes.

### Logical/latest binding

```text
viewer_memory.get
```

is resolved at invocation or revalidation time.

Pros:

- operational flexibility.

Cons:

- dependency drift.

### Fingerprint binding

The Composition records expected dependency fingerprints.

Pros:

- reproducibility.

Cons:

- more revalidation effort.

Recommended approach:

> Resolve by logical ID but record and enforce compatible fingerprints.

When a dependency changes materially, mark dependents for revalidation.

---

# Part IX — MCP Alignment

## 60. MCP Boundary

The Composition layer should remain above MCP rather than modifying MCP itself.

MCP remains responsible for the tool boundary:

```text
discover tool
inspect schema
call tool
receive result
```

The Composition layer adds:

```text
compose tools
validate composition
publish composition as tool
observe reuse
promote deterministic dispatch
```

This keeps the architecture compatible with ordinary MCP clients and servers.

---

## 61. JSON Schema

Current MCP tool definitions support JSON Schema for `inputSchema` and `outputSchema`, and recent MCP specification work uses JSON Schema 2020-12 as the default schema dialect.

The Composition system SHOULD reuse those schemas rather than inventing a parallel type system.

This enables:

- input validation;
- output validation;
- typed binding analysis;
- generated tool contracts;
- editor/LLM assistance.

Reference baseline at the time of this brief:

- MCP 2026-07-28 specification release: https://blog.modelcontextprotocol.io/posts/2026-07-28/
- MCP tools specification: https://modelcontextprotocol.io/specification/2025-11-25/server/tools
- MCP roadmap, 2026-08-22: https://blog.modelcontextprotocol.io/posts/mcp-roadmap/

The Composition DSL is intentionally a platform-layer proposal, not an assertion that MCP currently standardizes composition semantics.

---

# Part X — Implementation Guidance

## 62. Language-Neutral Internal Types

A practical implementation will need conceptual types similar to:

```text
CompositionDefinition
Metadata
CompositionSpec
Step
CallStep
IfValueStep
ParallelStep
Condition
ValueExpression
Reference
CompiledComposition
ExecutionPlan
ExecutionContext
ToolDescriptor
ToolResult
ReflexDefinition
Observation
ValidationReport
```

A language with algebraic data types may implement `Step` as:

```text
Call | IfValue | Parallel
```

An object-oriented language may use an interface/base class.

A dynamic language may use tagged dictionaries plus JSON Schema validation.

Do not let language-specific type mechanics leak into the DSL.

---

## 63. Recommended Runtime Interface

Conceptual interface:

```text
compile(source) -> CompiledComposition

validate(compiled, catalog) -> ValidationReport

execute(
    compiled,
    input,
    context,
    authorization
) -> StructuredResult

publish(compiled) -> ToolRegistration
```

Tool invocation abstraction:

```text
invokeTool(
    logicalToolId,
    arguments,
    executionContext
) -> StructuredToolResult
```

The same `invokeTool` path SHOULD handle primitives and Compositions.

---

## 64. Recursive Composition Dispatch

Conceptually:

```text
invokeTool(id, args, ctx):
    descriptor = catalog.resolve(id)

    if descriptor.type == PRIMITIVE:
        return mcpClient.call(descriptor, args, ctx)

    if descriptor.type == COMPOSITION:
        return compositionRuntime.execute(
            descriptor.compiledPlan,
            args,
            ctx
        )
```

Nesting limits and cycle detection still apply.

---

## 65. Tool Result Normalization

Create one internal tool-result abstraction.

Example:

```text
StructuredToolResult {
    value
    is_error
    metadata
}
```

For primitive MCP tools:

```text
value = structuredContent
```

For Compositions:

```text
value = evaluated return object
```

Raw MCP content MAY be retained for diagnostics but should not become the implicit data-binding mechanism.

---

## 66. Reference Resolver

Conceptual algorithm:

```text
resolve(value):
    if value is Reference:
        return lookup(namespace, pointer)

    if value is Array:
        return map(resolve, value)

    if value is Object:
        return mapValues(resolve, value)

    return value
```

Reference resolution MUST preserve types.

---

## 67. Execution Algorithm

Simplified sequential algorithm:

```text
validate input
validate context

stepResults = {}

for step in steps:
    execute step
    store result under step ID

result = resolve(return)

validate result against outputSchema

return result
```

Call-step execution:

```text
if step.when exists:
    if evaluate(step.when) == false:
        stepResults[id] = null
        mark skipped
        continue

args = resolve(step.with)
validate args against target input schema

childResult = invokeTool(target, args, context)

if childResult.is_error:
    fail Composition

stepResults[id] = childResult.value
```

---

## 68. Compiler Diagnostics

Errors should be precise enough for a coding agent or LLM to repair automatically.

Good diagnostic:

```text
COMPOSE-REF-004

Step "reputation" references "$steps/player/id",
but no reachable step with id "player" exists.

Location: spec.steps[3].with.player_id
```

Good schema diagnostic:

```text
COMPOSE-TYPE-011

Value "$steps/customer/age" is known to be integer,
but argument "recipient" for tool "email.send" requires string.

Location: spec.steps[4].with.recipient
```

Avoid generic errors such as:

```text
Invalid composition.
```

---

# Part XI — MVP Scope

## 69. Recommended MVP

Implement only:

### DSL

- YAML and JSON parsing;
- metadata;
- `inputSchema`;
- optional `contextSchema`;
- `outputSchema`;
- call steps;
- typed references;
- deterministic conditions;
- conditional value steps;
- guarded calls;
- return;
- Composition calling Composition.

### Runtime

- tool catalog;
- parser;
- validator;
- compiler;
- cycle detection;
- sequential executor;
- MCP publication;
- tracing;
- immutable version registry.

### Reflex

- event selector;
- deterministic predicate;
- one tool target;
- argument references;
- policy gate.

### Learning support

- observation recording;
- manual or LLM-assisted candidate creation;
- promotion API.

Do not require automated pattern mining for the first implementation.

---

## 70. Features That Can Wait

Likely V1.x/V2 features:

```text
parallel blocks
explicit timeout overrides
retry policies
fallback calls
foreach/map over bounded arrays
explicit string template expression
richer static schema inference
automatic pattern mining
automatic candidate generalization
canary promotion
automatic Reflex proposal
distributed durable execution
```

Add features only when concrete learned procedures cannot be expressed cleanly without them.

---

# Part XII — Suggested Storage Model

## 71. Composition Record

Illustrative:

```json
{
  "id": "comp_123",
  "name": "viewer_greeting",
  "version": 3,
  "status": "published",
  "contentHash": "sha256:...",
  "source": "...",
  "compiledPlan": {},
  "dependencies": [
    {
      "tool": "twitch.get_user",
      "schemaFingerprint": "sha256:..."
    }
  ],
  "provenance": {
    "createdBy": "agent",
    "observationIds": [
      "obs_10",
      "obs_14",
      "obs_31"
    ]
  }
}
```

---

## 72. Observation Record

Illustrative:

```json
{
  "id": "obs_31",
  "intentClass": "viewer_join_handling",
  "success": true,
  "calls": [
    {
      "tool": "twitch.get_user",
      "inputShapeHash": "...",
      "outputShapeHash": "..."
    },
    {
      "tool": "viewer_memory.get",
      "inputDependencies": [
        "call[0].output.id"
      ]
    }
  ]
}
```

Do not persist raw private values merely because they were present during execution.

---

## 73. Reflex Record

Illustrative:

```json
{
  "id": "reflex_88",
  "name": "greet_joining_viewer",
  "status": "active",
  "eventType": "twitch.viewer.joined",
  "targetTool": "viewer_greeting",
  "source": "...",
  "promotionEvidence": {
    "support": 142,
    "selectionRate": 0.997
  }
}
```

Numbers above are illustrative only, not recommended universal thresholds.

---

# Part XIII — Example Learning Lifecycle

## 74. Phase 1: Emergent

An agent receives:

```text
A viewer joined.
```

The available primitive tools include:

```text
twitch.get_user
viewer_memory.get
obs.show_alert
```

The LLM determines:

```text
twitch.get_user
      ↓
viewer_memory.get
      ↓
choose greeting
      ↓
obs.show_alert
```

The Observation Recorder stores the successful dependency graph.

---

## 75. Phase 2: Repetition

The platform observes the same graph repeatedly with different `user_id` values.

The stable parts are:

```text
tool graph
argument mapping
condition
output behavior
```

The changing value is generalized into:

```text
$input/user_id
```

---

## 76. Phase 3: Candidate

A candidate Composition is produced:

```text
viewer_greeting(user_id)
```

It is validated against tool schemas and replayed against fixtures.

---

## 77. Phase 4: Published Capability

The MCP facade now exposes:

```text
viewer_greeting
```

The next agent invocation can replace multiple low-level decisions with one tool choice.

Tool catalog complexity visible to the agent may also be reduced if low-level primitives no longer need to be exposed in that context.

---

## 78. Phase 5: Reflex Candidate

The platform observes:

```text
twitch.viewer.joined
      ↓
LLM almost always chooses viewer_greeting
```

The input mapping is stable:

```text
event.user_id → viewer_greeting.user_id
```

A Reflex candidate is generated.

---

## 79. Phase 6: Reflex

After policy and validation:

```text
twitch.viewer.joined
      ↓
viewer_greeting
```

The LLM is no longer required on the normal path.

If the Reflex later encounters uncertainty, policy violation, schema drift, or repeated failure, it can be disabled and the decision returned to the LLM.

---

# Part XIV — Architectural Consequences

## 80. The Tool Catalog Becomes Learned Capability Memory

The architecture turns tools into more than integrations.

The tool catalog becomes a durable record of what the system has learned how to do reliably.

The LLM does not need to remember every procedure in prompt context because successful behavior can migrate into executable capability.

---

## 81. Reasoning Becomes a Discovery Mechanism

LLM reasoning remains most valuable at the edge of uncertainty.

Once a behavior becomes stable, continuing to spend inference on reconstructing the same solution is wasteful.

The system therefore treats reasoning as analogous to an interpreter or exploratory compiler front-end:

```text
novel problem
    ↓
reason
    ↓
successful procedure
    ↓
compile
```

---

## 82. Behavioral JIT Compilation

A useful mental model is **behavioral just-in-time compilation**.

```text
LLM = flexible interpreter

Composition = compiled procedure

Reflex = compiled dispatch
```

The analogy is not exact, but it captures the intended economic and architectural movement:

```text
expensive + flexible
        ↓
cheaper + structured
        ↓
cheap + deterministic
```

The system does not seek to eliminate the LLM.

It seeks to reserve inference for the situations where inference adds value.

---

## 83. Determinism Is Earned, Not Assumed

A core principle of this architecture is:

> Behavior begins uncertain and earns determinism through evidence.

Do not start by attempting to encode every possible procedure.

Allow agents to discover procedures.

Observe successful behavior.

Promote only what becomes stable.

Demote when reality becomes uncertain again.

---

# Part XV — Acceptance Criteria for a First Implementation

A V1 implementation is successful if it can demonstrate the following end-to-end scenario.

1. Connect to at least two MCP servers.
2. Register primitive tools from those servers in a logical Tool Catalog.
3. Load a YAML Composition.
4. Validate the Composition structure.
5. Resolve every tool dependency.
6. Validate Composition input.
7. Execute several primitive MCP calls with references between their structured results.
8. Evaluate a deterministic condition.
9. Construct and validate a structured Composition result.
10. Publish the Composition itself through MCP.
11. Invoke that Composition from an ordinary MCP client as one tool.
12. Create a second Composition that calls the first Composition.
13. Detect and reject a Composition dependency cycle.
14. Record a parent trace plus child step traces.
15. Record observation/provenance metadata.
16. Register a Reflex that deterministically invokes the Composition from an event.
17. Disable the Reflex and return the path to model-controlled invocation without changing the Composition.

If those behaviors work cleanly, the architecture has proven its central thesis.

---

# Part XVI — Final Design Rules

When implementation choices are ambiguous, prefer these rules:

1. **Keep the DSL smaller.**
2. **Keep values typed.**
3. **Make dependencies static.**
4. **Make context explicit.**
5. **Use structured tool output.**
6. **Do not parse meaning from arbitrary text inside the executor.**
7. **Do not embed a general-purpose language.**
8. **Treat Compositions exactly like tools after publication.**
9. **Keep Reflex dispatch separate from Composition procedure.**
10. **Never let Composition bypass underlying authorization.**
11. **Record provenance.**
12. **Version immutably.**
13. **Detect drift.**
14. **Make promotion reversible.**
15. **Allow uncertainty to return execution to the LLM.**

The target architecture can be summarized in one line:

> **Let the model discover behavior; let Composition preserve behavior; let Reflex execute behavior once reasoning is no longer necessary.**
