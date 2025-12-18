# Sprint Execution Plan – sprint-139-08cdff

Objective
- Implement modular connector architecture inside ingress-egress and add Discord ingress (discord.js), preserving InternalEventV2 and existing Twitch behavior.

Assumptions
- Single Discord guild; channel allowlist via IDs.
- Discord is ingress-only in Phase 1; optional egress adapter may be stubbed.
- Tests must not perform network I/O; DISCORD_ENABLED=false in CI.

Milestones and Tasks

Phase 0 – Planning & Scaffolding (Day 0)
- M0.1 Create backlog.yaml for this sprint (this file references IDs) [IE-DIS-01..13]
- M0.2 Align with architecture.yaml; confirm no cross-service changes required

Phase 1 – Connector Foundations (Days 1–2)
- T1.1 Extend config model for Discord (flags/IDs/token) [IE-DIS-01]
- T1.2 Define connector interfaces and ConnectorManager [IE-DIS-02]

Phase 2 – Discord Ingress (Days 2–4)
- T2.1 Implement DiscordIngressClient: lifecycle, messageCreate handler, filters [IE-DIS-03]
- T2.2 Implement DiscordEnvelopeBuilder mapping to InternalEventV2 [IE-DIS-04]
- T2.3 Publisher wrapper over PublisherResource [IE-DIS-05]

Phase 3 – Service Wiring & Observability (Days 4–5)
- T3.1 Wire ConnectorManager into ingress-egress-service.ts; preserve Twitch behavior [IE-DIS-06]
- T3.2 Add /_debug/discord endpoint with snapshot [IE-DIS-07]
- T3.3 Add logging namespaces and counters; redact secrets [IE-DIS-10]

Phase 4 – Tests & Validation (Days 5–6)
- T4.1 Unit tests for envelope mapping and filters [IE-DIS-08]
- T4.2 Integration tests for disabled mode & publish path [IE-DIS-09]
- T4.3 Ensure validate_deliverable.sh remains passable with Discord disabled [IE-DIS-13]

Phase 5 – Optional & Docs (Day 6)
- T5.1 Optional: Discord egress adapter stub [IE-DIS-11]
- T5.2 Docs/Runbook updates [IE-DIS-12]

Deliverables
- Code: connector interfaces, Discord ingress client/builder/publisher, service wiring, debug endpoint
- Tests: unit and integration per above
- Config: new env keys and secret placeholders
- Docs: runbook/README updates

Acceptance Criteria (mapped)
- AC1 Config available via buildConfig, env stubs updated [IE-DIS-01]
- AC2 Interfaces & manager compile, start/stop independently [IE-DIS-02]
- AC3 Discord messages normalize and publish; disabled mode safe [IE-DIS-03..05]
- AC4 Service boots with Twitch preserved; Discord disabled by default [IE-DIS-06]
- AC5 /_debug/discord returns snapshot (no secrets) [IE-DIS-07]
- AC6 Tests pass in CI with network guards [IE-DIS-08..09]
- AC7 Observability and docs complete [IE-DIS-10..12]

Dependencies & Risk Notes
- Requires discord.js dependency and bot token in secrets store.
- Risk: misconfigured guild/channel IDs; mitigated by snapshot and logs.
- Risk: accidental network I/O in CI; mitigated by feature flags and mocks.

Rollout & Toggle Strategy
- Feature flagged via discordEnabled; default false in all envs until ready.
- Dry-run locally with a test guild before enabling in dev/prod.

Sign-off Gates
- Design previously approved.
- This plan + backlog approval before starting implementation.
