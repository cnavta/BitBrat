# Sprint 9 Retro — Network & LB Epic (sprint-9-b9f8c1)

## What went well
- Network MVP delivered via synth with clear tests and outputs capture
- CI safety maintained (plan-only), apply guardrails effective
- Operator UX improved with streamed Terraform logs and consistent outputs.json

## What didn’t go well
- Early HCL emission bugs (firewall allow vs allows, variable block format) cost time
- LB remained placeholder; surfaced confusion for `infra apply lb` expectations

## Action items
- Harden synth with additional static checks to prevent invalid block patterns
- Add an end-to-end plan snapshot test for the lb module once implemented
- Document expectations in README for each module (explicitly call out placeholders)

## Risks to watch
- Provider gaps for URL map; ensure YAML-first import path in Sprint 11
- Certificate readiness delays; plan early and add readiness checks before cutover
