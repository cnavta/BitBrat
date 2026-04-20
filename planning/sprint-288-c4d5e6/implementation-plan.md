# Implementation Plan – sprint-288-c4d5e6

## Objective
- Fix massive repetition in LLM prompts by ensuring that conversation history only contains the actual user query and assistant response.
- Fix double response issue where every message results in two responses being returned to the user.

## Scope
- `src/services/llm-bot/processor.ts`: Update memory append logic. (COMPLETED)
- `src/services/ingress/twitch/twitch-irc-client.ts`: Add `disableIngress` option.
- `src/services/ingress/discord/discord-ingress-client.ts`: Add `disableIngress` option.
- `src/apps/ingress-egress-service.ts`: Set `disableIngress: true` for broadcaster client instances.
- `repro_double_response.ts`: Verify the fix for double responses.

## Deliverables
- Modified `src/services/llm-bot/processor.ts`.
- Modified `src/services/ingress/twitch/twitch-irc-client.ts`.
- Modified `src/services/ingress/discord/discord-ingress-client.ts`.
- Modified `src/apps/ingress-egress-service.ts`.
- Passing reproduction tests.

## Acceptance Criteria
- When a user sends a message, only that message (and the assistant's response) is added to the short-term memory (history).
- Subsequent prompts do not repeat the instructions from previous turns in the history section.
- Only one event is published to `internal.ingress.v1` for every physical chat message received from Twitch or Discord.
- Users receive exactly one response for every request.

## Testing Strategy
- Use `repro_repetition.ts` (already verified).
- Create `repro_double_response.ts` to simulate multiple client instances and verify that only one publishes when `disableIngress` is true.

## Definition of Done
- Code quality: Adheres to project constraints.
- Testing: Reproduction scripts pass.
- Traceability: Changes logged in `request-log.md`.
