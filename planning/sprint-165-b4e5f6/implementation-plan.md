# Implementation Plan – sprint-165-b4e5f6

## Objective
Refine the matching and routing capabilities of the event-router by creating a specific routing rule for VIP users on their first message of a stream.

## Scope
- Analysis of `event-router` components (`RuleLoader`, `RouterEngine`, `JsonLogicEvaluator`).
- Creation of a new routing rule document (JSON/YAML) that matches VIP users' first session messages.
- Definition of personality and prompt annotations for the matched events.
- Configuration of the routing slip to direct events to the `llm-bot`.

## Deliverables
- `planning/sprint-165-b4e5f6/vip-routing-rule.json`: The routing rule document.
- `planning/sprint-165-b4e5f6/implementation-plan.md`: This plan.
- `planning/sprint-165-b4e5f6/verification-report.md`: Summary of the work.

## Acceptance Criteria
- A routing rule exists that matches events where:
    - `type` is `chat.message`.
    - `user.roles` contains `VIP`.
    - `user.tags` contains `FIRST_SESSION_MESSAGE`.
- The rule adds a `personality` annotation with value `bitbrat_the_ai`.
- The rule adds a `prompt` annotation with value `A VIP has arrived! Please announce their presance!`.
- The rule directs the event to `internal.llmbot.v1`.

## Testing Strategy
- Manual verification of the JsonLogic expression against the `jsonlogic-evaluator.ts` logic.
- (Optional) Create a unit test in `src/services/routing/__tests__/vip-rule.test.ts` to verify the rule matching if time permits, or simply document the expected behavior.

## Definition of Done
- Routing Rule document created and documented.
- Verification report completed.
- PR created.
