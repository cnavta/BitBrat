# Implementation Plan – sprint-283-b1a2c3

## Objective
- Add optional subheader descriptive text support for **Requesting User**, **Constraints**, and **Task** sections within the `PromptSpec` assembler.

## Scope
- Update `src/common/prompt-assembly/types.ts` to include subheader fields in `PromptSpec` or related sub-interfaces.
- Update `src/common/prompt-assembly/assemble.ts` to render these optional subheaders.
- Support environment-variable derived defaults for these subheaders.
- Add unit tests verifying correct rendering of the subheaders.

## Out of Scope
- Subheaders for other sections (e.g., Identity, Conversation State, Input) unless explicitly requested.
- Dynamic subheaders (other than env-var based).

## Deliverables
- Modified `types.ts` and `assemble.ts`.
- Unit tests in a corresponding `.spec.ts` file.
- Updated `validate_deliverable.sh` (if necessary, though standard tests should suffice).

## Acceptance Criteria
- [ ] `PromptSpec` includes optional fields for subheaders in Requesting User, Constraints, and Task sections.
- [ ] If a subheader is provided in the spec, it is rendered immediately below the section heading.
- [ ] If a subheader is NOT provided in the spec, but exists as a global/env-var default, it is rendered.
- [ ] Section headings and subheaders follow the specified format (e.g., `## [Section Name]` followed by subheader text).
- [ ] Existing functionality (truncation, etc.) is preserved.

## Testing Strategy
- Unit tests using Jest (the project's standard).
- Test cases for:
  - Subheader provided in spec.
  - Subheader missing in spec (no render).
  - Subheader missing in spec but provided as default (rendered).
  - Multi-line subheaders.
  - Integration with truncation logic (making sure subheaders don't break char caps calculation).

## Deployment Approach
- Standard CI/CD pipeline as defined in `AGENTS.md`.

## Dependencies
- None.

## Definition of Done
- All Acceptance Criteria met.
- `validate_deliverable.sh` passes.
- PR created for the feature branch.
