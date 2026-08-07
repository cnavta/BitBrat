# Execution Plan – sprint-265-7283d4

## Objective
- Investigate the llm-bot prompt assembly flow, reproduce the reported misplacement of requesting-user data, and remediate the issue so requesting-user metadata is rendered in the dedicated `Requesting User` section instead of leaking into lower-priority task/input text.

## Scope
### In Scope
- Trace how llm-bot constructs `PromptSpec`, how prompt annotations are combined, and how adapters render the final provider payload.
- Identify the exact path that currently injects user identity/context into prompt/task text instead of `PromptSpec.requestingUser`.
- Add or update regression tests that reproduce the current defect and cover adjacent prompt assembly edge cases.
- Implement the minimal code changes needed to correctly source, normalize, and render requesting-user data while preserving other prompt sections and existing safety/behavioral logic.
- Make tightly related prompt assembly improvements if they directly reduce the risk of section leakage or duplicated user-context rendering.
- Update sprint validation and verification artifacts for the delivered fix.

### Out of Scope
- Persona/content rewrites unrelated to the requesting-user section defect.
- Broad llm-bot architecture changes that do not materially contribute to this prompt assembly issue.
- New end-user features beyond the prompt-assembly correction and directly related hardening.
- Publication/closure steps before implementation, validation, and explicit user approval of this plan.

## Deliverables
- Root-cause analysis documented through the sprint log and reflected in implementation decisions.
- Regression test coverage for the reported prompt-assembly defect and relevant edge cases.
- llm-bot / prompt-assembly code changes that place requesting-user metadata into the canonical `Requesting User` section and prevent improper duplication into task/input text where applicable.
- Updated sprint artifacts: executable validation script, verification report, retro, key learnings, and publication metadata at closure.

## Acceptance Criteria
- The reproduced failing test demonstrates the current defect before the fix: relevant user identity/context data is absent from `Requesting User` and appears elsewhere in the assembled prompt.
- After the fix, llm-bot populates `PromptSpec.requestingUser` (or equivalent first-class prompt assembly input) from the available event/user context, and the assembled prompt shows that information in the `Requesting User` section.
- Task instructions remain limited to actionable instructions and do not absorb structured requesting-user identity fields unless explicitly intended as notes.
- Input remains centered on the user’s actual message/query rather than duplicating structured requesting-user metadata.
- Relevant automated tests pass, and no existing prompt assembly / llm-bot behavior regression is introduced.

## Testing Strategy
- Add or update a focused reproducer around llm-bot prompt assembly, likely at the processor or prompt-assembly integration level, to demonstrate the reported section-placement bug.
- Add targeted tests for structured requesting-user mapping, including fallback identity sources and cases where no user info is available.
- Run all relevant Jest suites for the touched prompt-assembly and llm-bot modules, plus any downstream tests that cover modified shared prompt assembly behavior.
- Re-run the reproducer after the fix to confirm the `Requesting User` section is populated correctly and lower-priority sections are clean.

## Deployment Approach
- Keep the change confined to the existing llm-bot / prompt-assembly path with no new infrastructure.
- Preserve `architecture.yaml` service boundaries and existing provider adapter contracts.
- Sequence implementation as: reproduce → map correct data model → fix assembly → validate via tests and sprint validation script.

## Dependencies
- Explicit user approval of this implementation plan before any production code changes begin.
- Existing llm-bot event structure, prompt annotations, and prompt assembly modules under `src/services/llm-bot` and `src/common/prompt-assembly`.
- Current project test tooling (`npm test` / Jest) and any existing llm-bot prompt tests.
- Architecture constraints defined in `architecture.yaml` and sprint workflow rules in `AGENTS.md`.

## Definition of Done
- Project-wide DoD is satisfied.
- The root cause of requesting-user section leakage is fixed in code, not merely documented.
- Regression tests cover the defect and pass.
- Validation artifacts clearly describe what was completed, any deviations, and how the issue was verified.
- Sprint publication/closure only occurs after validation and the required PR workflow, or after explicit user acceptance of any documented exception.

## Proposed Execution Order
1. Reproduce the current prompt assembly defect in a failing automated test.
2. Implement first-class requesting-user mapping/hardening in llm-bot prompt assembly.
3. Run targeted and related regression tests, then update validation/verification artifacts.
4. Prepare publication and closeout artifacts once implementation is verified.