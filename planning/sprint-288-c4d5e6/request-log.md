# Request Log – sprint-288-c4d5e6

## [2026-04-19T10:59:00Z] - Initial Request
- Prompt summary: Fix massive repetition in prompt caused by entire previous history/context inclusion.
- Interpretation: The LLM prompt assembly logic or its caller is incorrectly including the full assembled prompt of the previous turn in the history of the current turn.
- Actions:
  - Created sprint directory `planning/sprint-288-c4d5e6/`
  - Created `sprint-manifest.yaml`
  - Started investigation in `src/common/prompt-assembly/assemble.ts`
  - Created reproduction script `repro_repetition.ts`
  - Confirmed bug: instructions are being saved to history instead of actual user message.
  - Created `implementation-plan.md`

## [2026-04-20T10:15:00Z] - Follow-up: Double Responses
- Prompt summary: Fix issue where two responses are returned for every request.
- Interpretation: The ingress-egress service is publishing duplicate events to the internal bus because multiple clients (bot and broadcaster) are listening to the same channels. Since they generate unique correlationIds, they are not deduped.
- Actions:
  - Updated sprint manifest and implementation plan.
  - Investigated TwitchIrcClient and DiscordIngressClient.
  - Created reproduction script `repro_double_response.ts`.
  - Added `disableIngress` option to clients.
  - Updated `ingress-egress-service.ts` to use `disableIngress` for broadcaster clients.
