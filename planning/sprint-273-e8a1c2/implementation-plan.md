# Implementation Plan – sprint-273-e8a1c2

## Objective
- Capture and prioritize Discord Bot Token (token field) during OAuth exchange to fix ingress-egress connection errors.

## Deliverables
- Code changes in DiscordAdapter.ts
- Updated tests in DiscordAdapter.test.ts
- Sprint documentation

## Acceptance Criteria
- DiscordAdapter returns the Bot Token in its accessToken field when the "bot" scope is requested.
- Tests confirm the correct field is prioritized.